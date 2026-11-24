<?php

declare(strict_types=1);

// Q15: a path-set change must keep the hub key's id and secret — only allowed_paths changes, and the
// settings PATCH applies the new set immediately, before the next collector poll. Core-free decision
// (KeySyncPlan) plus the PATCH wiring with a spy instead of the Core-backed HubApiKey.

namespace Phalcon\Di {

    class Injectable
    {
    }
}

namespace MikoPBX\PBXCoreREST\Lib {

    class PBXApiResult
    {
        public bool $success = false;
        public array $data = [];
        public array $messages = [];
        public ?int $httpCode = null;
        public string $processor = '';
        public string $function = '';
    }
}

namespace {

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Api\ApiKeySync;
use Modules\ModuleMessengerHub\Lib\Api\KeySyncPlan;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\ArrayTranslator;
use Modules\ModuleMessengerHub\Lib\RestAPI\Settings\Processor as SettingsProcessor;
use Modules\ModuleMessengerHub\Lib\Sources\ApiKeyPaths;
use Modules\ModuleMessengerHub\Lib\Sources\ModuleStatusProbe;
use Modules\ModuleMessengerHub\Lib\Sources\SourceAvailability;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

final class AllAvailableProbe implements ModuleStatusProbe
{
    public function status(string $moduleUniqueId): string
    {
        return SourceAvailability::AVAILABLE;
    }
}

final class SpyKeySync implements ApiKeySync
{
    /** @var list<list<string>> */
    public array $calls = [];

    public function sync(array $paths): string
    {
        $this->calls[] = $paths;

        return 'plain-key';
    }
}

// ---------- KeySyncPlan ----------

check(
    KeySyncPlan::pathsJson(['/api/v3/b', '/api/v3/a', '/api/v3/b']) === '["/api/v3/a","/api/v3/b"]',
    'pathsJson sorts, deduplicates and keeps slashes'
);
check(KeySyncPlan::pathsJson([]) === '[]', 'pathsJson of an empty set');

check(
    KeySyncPlan::decide('plain', 7, '["/a"]', '["/a"]', true) === KeySyncPlan::KEEP,
    'matching paths keep the key untouched'
);
check(
    KeySyncPlan::decide('plain', 7, '["/a"]', '["/a","/b"]', true) === KeySyncPlan::UPDATE_PATHS,
    'changed paths update the existing record'
);
check(
    KeySyncPlan::decide('plain', 7, '["/a","/b"]', '["/a"]', true) === KeySyncPlan::UPDATE_PATHS,
    'a removed path also updates in place'
);
check(KeySyncPlan::decide('', 7, '["/a"]', '["/a"]', true) === KeySyncPlan::CREATE, 'lost secret -> new key');
check(KeySyncPlan::decide('plain', 0, '["/a"]', '["/a"]', true) === KeySyncPlan::CREATE, 'no stored id -> new key');
check(KeySyncPlan::decide('plain', 7, '["/a"]', '["/a"]', false) === KeySyncPlan::CREATE, 'record gone -> new key');
check(
    KeySyncPlan::decide('plain', 7, '["/a"]', '["/a","/b"]', false) === KeySyncPlan::CREATE,
    'foreign record at the stored id is never touched -> new key'
);
// the revoke-then-enable flow (module update): the record exists with its id and secret, the stored
// path set was dropped by revoke(), so the wanted set is written back on the same record
check(
    KeySyncPlan::decide('plain', 7, '', '["/a"]', true) === KeySyncPlan::UPDATE_PATHS,
    'after revoke the path set returns in place (same id and secret)'
);

// ---------- PATCH applies the new path set immediately ----------

const ALL_POLL_PATHS = [
    '/api/v3/advice',
    '/api/v3/cdr',
    '/api/v3/module-ai-supervisor/calls',
    '/api/v3/module-ai-supervisor/workers',
    '/api/v3/module-cloud-ai-supervisor/runtime',
    '/api/v3/module-cloud-speech-to-text/status',
    '/api/v3/module-local-speech-to-text/jobs',
    '/api/v3/module-local-speech-to-text/workers',
    '/api/v3/module-voice-agent/callbacks',
    '/api/v3/module-voice-agent/runtime',
    '/api/v3/sip',
];

$spy = new SpyKeySync();
$db = hubTestDatabase();
$processor = new SettingsProcessor(
    new HubSettings($db),
    new SourceStateRepository($db),
    new AllAvailableProbe(),
    new ArrayTranslator([]),
    $spy,
    $db
);

// fresh database: every registered source is enabled, so the first toggle already knows the full set
$result = $processor->process(['action' => 'patch', 'data' => ['sources' => ['core.advice' => false]]]);
check($result->success, 'patch disables core.advice');
check($spy->calls === [[
    '/api/v3/cdr',
    '/api/v3/module-ai-supervisor/calls',
    '/api/v3/module-ai-supervisor/workers',
    '/api/v3/module-cloud-ai-supervisor/runtime',
    '/api/v3/module-cloud-speech-to-text/status',
    '/api/v3/module-local-speech-to-text/jobs',
    '/api/v3/module-local-speech-to-text/workers',
    '/api/v3/module-voice-agent/callbacks',
    '/api/v3/module-voice-agent/runtime',
    '/api/v3/sip',
]], 'disabling a source syncs the key without its path');

// a foreign record at the stored id would make the real HubApiKey create a new key instead of updating
check(
    KeySyncPlan::decide('plain', 7, KeySyncPlan::pathsJson($spy->calls[0]), KeySyncPlan::pathsJson(ALL_POLL_PATHS), true)
        === KeySyncPlan::UPDATE_PATHS,
    're-enabling computes an in-place update, not a recreation'
);

$result = $processor->process(['action' => 'patch', 'data' => ['events_retention_days' => 45]]);
check($result->success && count($spy->calls) === 1, 'retention-only patch does not touch the key');

$result = $processor->process(['action' => 'patch', 'data' => ['sources' => ['not.a.source' => false]]]);
check(!$result->success && count($spy->calls) === 1, 'rejected patch does not sync the key');

$result = $processor->process(['action' => 'patch', 'data' => ['sources' => ['core.advice' => true]]]);
check($result->success, 'patch re-enables core.advice');
check(count($spy->calls) === 2, 'enabling syncs the key again');
check($spy->calls[1] === ALL_POLL_PATHS, 'the full path set is back, advice included');

// an unavailable module keeps its paths out of the set the PATCH requests (key follows availability)
$states = new SourceStateRepository($db);
$paths = ApiKeyPaths::compute(
    \Modules\ModuleMessengerHub\Lib\Sources\SourceRegistry::default()->pollSources(),
    static fn (string $id): bool => $states->isEnabled($id),
    static fn (string $module): string => $module === 'ModuleVoiceAgent'
        ? SourceAvailability::MODULE_DISABLED
        : SourceAvailability::AVAILABLE
);
check($paths === [
    '/api/v3/advice',
    '/api/v3/cdr',
    '/api/v3/module-ai-supervisor/calls',
    '/api/v3/module-ai-supervisor/workers',
    '/api/v3/module-cloud-ai-supervisor/runtime',
    '/api/v3/module-cloud-speech-to-text/status',
    '/api/v3/module-local-speech-to-text/jobs',
    '/api/v3/module-local-speech-to-text/workers',
    '/api/v3/sip',
], 'PATCH-time compute matches the collector compute (module off -> paths out)');

// /api/v3/cdr follows enabled attachment rules, not the AI source alone (stage 3a-1)
$spy->calls = [];
$db->execute(
    'INSERT INTO m_MessengerHubRules (title, enabled, event_types, min_severity, filters_json, target_mode,'
    . ' chat_ids_json, template_key, options_json, quiet_hours_json, sort, created_at, updated_at)'
    . " VALUES ('Audio', '1', '[\"ai_supervisor.attention_call\"]', 'info', '{}', 'recipients', '[]', '',"
    . " '{\"attachments\":\"fragments\"}', '{}', 10, 1, 1)"
);
$processor->process(['action' => 'patch', 'data' => ['sources' => ['core.advice' => false]]]);
check(in_array('/api/v3/cdr', $spy->calls[0] ?? [], true), 'an enabled attention-audio rule adds the CDR read path');

$spy->calls = [];
$db->execute("UPDATE m_MessengerHubRules SET enabled = '0'");
$processor->process(['action' => 'patch', 'data' => ['sources' => ['core.advice' => true]]]);
check(in_array('/api/v3/cdr', $spy->calls[0] ?? [], true), 'the enabled toll-fraud source keeps the CDR read path after the rule is gone');

// the path is present only while either the attention-audio rule or the toll-fraud source needs it
$spy->calls = [];
$processor->process(['action' => 'patch', 'data' => ['sources' => ['core.toll_fraud' => false]]]);
check(!in_array('/api/v3/cdr', $spy->calls[0] ?? [], true), 'disabling the toll-fraud source removes the CDR read path too');
$spy->calls = [];
$processor->process(['action' => 'patch', 'data' => ['sources' => ['core.toll_fraud' => true]]]);
check(in_array('/api/v3/cdr', $spy->calls[0] ?? [], true), 're-enabling the toll-fraud source returns the CDR read path');
check(
    ApiKeyPaths::attentionCdr(['/api/v3/advice'], true) === ['/api/v3/advice'],
    'the CDR path is never added without the AI calls path'
);
check(
    ApiKeyPaths::attentionCdr(['/api/v3/advice', '/api/v3/cdr'], true) === ['/api/v3/advice', '/api/v3/cdr'],
    'the CDR path is not duplicated when the toll-fraud source already contributes it'
);

finish('key sync OK');
}

