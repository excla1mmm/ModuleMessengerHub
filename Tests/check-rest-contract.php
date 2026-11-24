<?php

declare(strict_types=1);

// REST contract of the settings and events resources (Plan/06): response shapes, validation, pagination
// bounds, baseline reset on enable, getSources catalog, key paths follow module availability, and the
// hub_api_key secret never appears in any response. Core classes are stubbed so processors stay Core-free.

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

    use Modules\ModuleMessengerHub\Lib\Events\EventStore;
    use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
    use Modules\ModuleMessengerHub\Lib\Delivery\NullDeliveryWaker;
    use Modules\ModuleMessengerHub\Lib\Delivery\OutboxRepository;
    use Modules\ModuleMessengerHub\Lib\RestAPI\Events\Processor as EventsProcessor;
    use Modules\ModuleMessengerHub\Lib\RestAPI\Settings\Processor as SettingsProcessor;
    use Modules\ModuleMessengerHub\Lib\Sources\ApiKeyPaths;
    use Modules\ModuleMessengerHub\Lib\Sources\ModuleStatusProbe;
    use Modules\ModuleMessengerHub\Lib\Sources\SourceAvailability;
use Modules\ModuleMessengerHub\Lib\Sources\SourceCatalog;
    use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
    use Modules\ModuleMessengerHub\Lib\Sources\SourceRegistry;
    use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

    const FAKE_KEY = 'HUBSECRET0123456789abcdefghijklmnopqrst';

    /** Probe with a fixed answer per module, for availability checks. */
    final class FixedProbe implements ModuleStatusProbe
    {
        public function __construct(private readonly array $statuses)
        {
        }

        public function status(string $moduleUniqueId): string
        {
            return $this->statuses[$moduleUniqueId] ?? SourceAvailability::AVAILABLE;
        }
    }

    /** Translator over the module's own English catalog, proving name keys resolve. */
    $enCatalog = require dirname(__DIR__) . '/Messages/en.php';
    $translator = new \Modules\ModuleMessengerHub\Lib\RestAPI\Common\ArrayTranslator($enCatalog);

    function freshDb(): HubDatabase
    {
        return hubTestDatabase();
    }

    function settingsProcessor(HubDatabase $db, ?ModuleStatusProbe $probe = null): SettingsProcessor
    {
        global $translator;

        return new SettingsProcessor(
            new \Modules\ModuleMessengerHub\Lib\Settings\HubSettings($db),
            new \Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository($db),
            $probe,
            $translator
        );
    }

    function eventsProcessor(HubDatabase $db): EventsProcessor
    {
        return new EventsProcessor(new EventStore($db), new OutboxRepository($db), new NullDeliveryWaker());
    }

    /** @return array<string, mixed> */
    function dataOf(object $result): array
    {
        return $result->data;
    }

    function assertNoSecret(object $result, string $what): void
    {
        check(strpos(json_encode($result, JSON_THROW_ON_ERROR), FAKE_KEY) === false, 'hub_api_key must never appear in ' . $what);
        check(
            !isset(dataOf($result)['hub_api_key'])
            && !isset(dataOf($result)[\Modules\ModuleMessengerHub\Lib\Settings\HubSettings::HUB_API_KEY]),
            'secret keys must not be part of ' . $what
        );
    }

    // ---------- settings: defaults and getList ----------

    $db = freshDb();
    $db->execute(
        'INSERT INTO m_MessengerHubSettings (key, value) VALUES (:key, :value)',
        ['key' => 'hub_api_key', 'value' => FAKE_KEY]
    );
    $processor = settingsProcessor($db);

    $result = $processor->process(['action' => 'getList']);
    check($result->success && $result->httpCode === 200, 'settings getList succeeds');
    $state = dataOf($result);
    check($state['hub_enabled'] === false, 'hub_enabled defaults to false');
    check($state['events_retention_days'] === 30, 'retention defaults to 30');
    check(count($state['sources']) === 17, 'seventeen registered sources in the map');
    check(!isset($state['hub_api_key']), 'getList exposes no secrets');
    assertNoSecret($result, 'settings getList');

    $result = $processor->process(['action' => 'getDefault']);
    check(dataOf($result) == $state, 'getDefault matches fresh defaults');

    // ---------- settings: patch and update ----------

    $result = $processor->process(['action' => 'patch', 'data' => ['events_retention_days' => '60']]);
    check($result->success && dataOf($result)['events_retention_days'] === 60, 'patch accepts a numeric string');
    check(in_array('events_retention_days', dataOf($result)['changed'], true), 'changed lists the field');

    foreach ([0, 366, 'abc', ''] as $bad) {
        $result = $processor->process(['action' => 'patch', 'data' => ['events_retention_days' => $bad]]);
        check(!$result->success && $result->httpCode === 422, 'retention out of 1..365 is rejected: ' . json_encode($bad));
        check((dataOf($result)['field'] ?? '') === 'events_retention_days', 'validation names the field');
    }

    $result = $processor->process(['action' => 'patch', 'data' => ['sources' => ['not.a.source' => false]]]);
    check(!$result->success && $result->httpCode === 422, 'unknown source id is rejected');
    check((dataOf($result)['field'] ?? '') === 'sources', 'unknown source validation names sources');
    check(strpos((string)json_encode($result->messages), 'not.a.source') === false, 'error message does not echo the id');

    // disabling a source through PATCH, then enabling it again: fresh baseline without history
    $states = new \Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository($db);
    $states->markPolled('core.missed_call', ['seen' => ['x' => 1]], 1700000000);
    $result = $processor->process(['action' => 'patch', 'data' => ['sources' => ['core.missed_call' => false]]]);
    check($result->success, 'patch disables a source');
    check(dataOf($result)['sources']['core.missed_call'] === false, 'the map shows the source off');
    $row = $states->get('core.missed_call');
    check($row['enabled'] === false, 'state row disabled');
    check($row['baseline_set_at'] === 1700000000, 'disabling keeps the old baseline');

    $result = $processor->process(['action' => 'patch', 'data' => ['sources' => ['core.missed_call' => true]]]);
    check($result->success, 'patch re-enables the source');
    $row = $states->get('core.missed_call');
    check($row['enabled'] === true, 'state row enabled again');
    check($row['cursor'] === [], 'enabling reset the cursor');
    check($row['baseline_set_at'] > 1700000000, 'enabling set a fresh baseline');
    check($row['last_poll_at'] === 1700000000, 'enabling does not fake poll health');

    $result = $processor->process(['action' => 'patch', 'data' => ['sources' => ['core.missed_call' => 'yes']]]);
    check(!$result->success && $result->httpCode === 422, 'non-boolean source value is rejected');

    $result = $processor->process(['action' => 'update', 'data' => ['hub_enabled' => true]]);
    check(!$result->success && $result->httpCode === 422, 'PUT without all fields is rejected');

    $result = $processor->process(['action' => 'update', 'data' => [
        'hub_enabled' => true,
        'events_retention_days' => 90,
        'sources' => ['core.missed_call' => false, 'ai_supervisor.workers' => true],
    ]]);
    check(!$result->success && $result->httpCode === 422, 'PUT with a partial sources map is rejected');

    $allSources = [];
    foreach (dataOf($processor->process(['action' => 'getDefault']))['sources'] as $id => $enabled) {
        $allSources[$id] = ($id === 'core.missed_call') ? false : $enabled;
    }
    $result = $processor->process(['action' => 'update', 'data' => [
        'hub_enabled' => 1,
        'events_retention_days' => 90,
        'sources' => $allSources,
        'pbx_public_url' => '',
        'mask_phone_default' => false,
        'proxy_url' => '',
        'max_ca_bundle_path' => '',
    ]]);
    check($result->success, 'PUT with a complete payload succeeds');
    $state = dataOf($result);
    check($state['hub_enabled'] === true, 'hub_enabled stored');
    check($state['events_retention_days'] === 90, 'retention stored');
    check($state['sources']['core.missed_call'] === false, 'sources replaced wholesale by PUT');
    check(count($state['sources']) === 17, 'PUT still knows all sources');
    assertNoSecret($result, 'settings update');

    // ---------- settings: stage-2 fields ----------

    $result = $processor->process(['action' => 'patch', 'data' => ['pbx_public_url' => 'https://pbx.example.ru/']]);
    check($result->success && dataOf($result)['pbx_public_url'] === 'https://pbx.example.ru', 'public URL stored without a trailing slash');
    check(in_array('pbx_public_url', dataOf($result)['changed'], true), 'public URL reported as changed');

    $result = $processor->process(['action' => 'patch', 'data' => ['pbx_public_url' => 'ftp://pbx.example.ru']]);
    check(!$result->success && $result->httpCode === 422 && dataOf($result)['field'] === 'pbx_public_url', 'non-http URL rejected');

    $result = $processor->process(['action' => 'patch', 'data' => ['mask_phone_default' => true]]);
    check($result->success && dataOf($result)['mask_phone_default'] === true, 'masking default stored');

    $result = $processor->process(['action' => 'patch', 'data' => ['proxy_url' => 'socks5://127.0.0.1:1080']]);
    check($result->success && dataOf($result)['proxy_url'] === 'socks5://127.0.0.1:1080', 'SOCKS5 proxy accepted');

    $result = $processor->process(['action' => 'patch', 'data' => ['proxy_url' => 'proxy']]);
    check(!$result->success && dataOf($result)['field'] === 'proxy_url', 'malformed proxy rejected');

    $result = $processor->process(['action' => 'patch', 'data' => ['max_ca_bundle_path' => 'relative.pem']]);
    check(!$result->success && dataOf($result)['field'] === 'max_ca_bundle_path', 'relative CA path rejected');

    $result = $processor->process(['action' => 'getList']);
    $state = dataOf($result);
    check($state['pbx_public_url'] === 'https://pbx.example.ru', 'public URL persisted');
    check($state['mask_phone_default'] === true, 'masking default persisted');

    // ---------- settings: stage 4s-B queue wait thresholds ----------

    check($state['queue_abandon_min_wait_sec'] === 0 && $state['queue_long_wait_sec'] === 0, 'queue wait thresholds default to 0 (off)');

    $result = $processor->process(['action' => 'patch', 'data' => ['queue_abandon_min_wait_sec' => 15]]);
    check($result->success && dataOf($result)['queue_abandon_min_wait_sec'] === 15, 'minimum queue wait stored');
    check(in_array('queue_abandon_min_wait_sec', dataOf($result)['changed'], true), 'minimum queue wait reported as changed');

    $result = $processor->process(['action' => 'patch', 'data' => ['queue_long_wait_sec' => '120']]);
    check($result->success && dataOf($result)['queue_long_wait_sec'] === 120, 'long queue wait accepts a numeric string');

    foreach ([-1, 3601, 'abc', '', true] as $bad) {
        $result = $processor->process(['action' => 'patch', 'data' => ['queue_long_wait_sec' => $bad]]);
        check(!$result->success && $result->httpCode === 422, 'queue wait outside 0..3600 is rejected: ' . json_encode($bad));
        check((dataOf($result)['field'] ?? '') === 'queue_long_wait_sec', 'queue wait validation names the field');
    }
    $state = dataOf($processor->process(['action' => 'getList']));
    check($state['queue_abandon_min_wait_sec'] === 15 && $state['queue_long_wait_sec'] === 120, 'queue waits persisted');
    check((new \Modules\ModuleMessengerHub\Lib\Settings\HubSettings($db))->queueLongWaitSec() === 120, 'the source reads the stored threshold');
    assertNoSecret($processor->process(['action' => 'getList']), 'settings with queue waits');

    // ---------- settings: getSources ----------

    $db = freshDb();
    $probe = new FixedProbe([
        'ModuleVoiceAgent' => SourceAvailability::MODULE_DISABLED,
        'ModuleAISupervisor' => SourceAvailability::MODULE_MISSING,
    ]);
    $processor = settingsProcessor($db, $probe);
    $result = $processor->process(['action' => 'getSources']);
    check($result->success && $result->httpCode === 200, 'getSources succeeds');
    $items = dataOf($result)['items'];
    check(count($items) === 17, 'getSources lists seventeen sources');
    $byId = [];
    foreach ($items as $item) {
        $byId[$item['id']] = $item;
    }
    check(isset($byId['ai_supervisor.attention_call']), 'module source present');
    $attention = $byId['ai_supervisor.attention_call'];
    check($attention['kind'] === 'module' && $attention['module'] === 'ModuleAISupervisor', 'kind and module');
    check($attention['group'] === 'ai_supervisor', 'group mapping');
    check($attention['name'] !== $attention['name_key'], 'name resolves from the catalog');
    check(count($attention['event_types']) === 1 && $attention['event_types'][0]['type'] === 'ai_supervisor.attention_call', 'event types listed');
    check($attention['event_types'][0]['name'] !== '', 'event type name translated');
    check($attention['availability'] === SourceAvailability::MODULE_MISSING, 'live probe wins: module_missing');
    check($byId['voice_agent.runtime']['availability'] === SourceAvailability::MODULE_DISABLED, 'live probe wins: module_disabled');
    check($byId['core.missed_call']['kind'] === 'core' && $byId['core.missed_call']['module'] === '', 'core source has no module');
    check($byId['core.provider_status']['group'] === 'pbx', 'provider status in the PBX group');
    foreach (['local_stt.workers', 'local_stt.backlog', 'cloud_stt.incidents', 'cloud_stt.paused', 'cloud_ai.paused'] as $speechSource) {
        check(isset($byId[$speechSource]) && $byId[$speechSource]['group'] === 'speech_ai', "$speechSource is in the speech recognition group");
    }
    check($byId['ai_supervisor.workers']['group'] === 'ai_supervisor', 'AI Supervisor workers stay in the AI Supervisor group');
    check(
        array_search('speech_ai', SourceCatalog::GROUP_ORDER, true) === array_search('ai_supervisor', SourceCatalog::GROUP_ORDER, true) + 1,
        'speech group follows the AI Supervisor group'
    );
    check($byId['local_stt.workers']['group_name'] !== $byId['local_stt.workers']['group_key'], 'speech group name is translated');
    check($byId['cloud_stt.incidents']['update_to'] === '1.120' && $byId['cloud_stt.paused']['update_to'] === '1.120', 'update_to carries the Cloud STT /status minimal version');
    check(
        $byId['local_stt.workers']['update_to'] === '' && $byId['local_stt.backlog']['update_to'] === ''
        && $byId['cloud_ai.paused']['update_to'] === '' && $byId['ai_supervisor.workers']['update_to'] === '',
        'sources that read existing resources have no minimal version'
    );
    check($byId['core.advice']['mode'] === 'poll' && $byId['core.advice']['poll_interval_sec'] > 0, 'poll metadata');
    check($byId['core.pbx_started']['mode'] === 'push', 'push metadata');
    assertNoSecret($result, 'settings getSources');

    $result = $processor->process(['action' => 'patch', 'data' => ['sources' => ['voice_agent.callbacks' => false]]]);
    $result = $processor->process(['action' => 'getSources']);
    $items = dataOf($result)['items'];
    foreach ($items as $item) {
        if ($item['id'] === 'voice_agent.callbacks') {
            check($item['enabled'] === false && $item['availability'] === SourceAvailability::DISABLED, 'disabled source reports disabled');
        }
    }

    // unknown action
    $result = $processor->process(['action' => 'deleteAll']);
    check(!$result->success && $result->httpCode === 400, 'unknown settings action is 400');

    // ---------- events ----------

    $db = freshDb();
    $store = new EventStore($db);
    $seed = [
        ['core.missed_call', 'core.missed_call', HubEvent::SEVERITY_WARNING, 'missed:1', 1700000100],
        ['core.missed_call', 'core.missed_call', HubEvent::SEVERITY_WARNING, 'missed:2', 1700000200],
        ['core.provider_status', 'core.provider_down', HubEvent::SEVERITY_CRITICAL, 'provider:1:down:1', 1700000300],
        ['core.advice', 'core.advice', HubEvent::SEVERITY_INFO, 'advice:1:day', 1700000400],
    ];
    foreach ($seed as [$source, $type, $severity, $key, $at]) {
        $store->record(new HubEvent($source, $type, $severity, $key, $at, ['subject' => ['client_number' => '79000000000' . $at]]), $at);
    }
    $events = eventsProcessor($db);

    $result = $events->process(['action' => 'getList']);
    check($result->success && $result->httpCode === 200, 'events getList succeeds');
    $payload = dataOf($result);
    check(isset($payload['items'], $payload['pagination']), 'list has items and pagination');
    check($payload['pagination'] === ['limit' => 50, 'offset' => 0, 'total' => 4, 'has_more' => false], 'default page');
    check(count($payload['items']) === 4 && $payload['items'][0]['occurred_at'] === 1700000400, 'newest first');
    check(!array_key_exists('dedupe_key', $payload['items'][0]), 'dedupe_key stays internal');

    $result = $events->process(['action' => 'getList', 'data' => ['severity' => 'warning']]);
    check(dataOf($result)['pagination']['total'] === 2, 'severity filter');
    $result = $events->process(['action' => 'getList', 'data' => ['event_type' => 'core.provider_down']]);
    check(dataOf($result)['pagination']['total'] === 1, 'event_type filter');
    $result = $events->process(['action' => 'getList', 'data' => ['source_id' => 'core.missed_call']]);
    check(dataOf($result)['pagination']['total'] === 2, 'source_id filter');
    $result = $events->process(['action' => 'getList', 'data' => ['date_from' => 1700000250, 'date_to' => 1700000350]]);
    check(dataOf($result)['pagination']['total'] === 1, 'period filter');
    $result = $events->process(['action' => 'getList', 'data' => ['severity' => 'loud']]);
    check(!$result->success && $result->httpCode === 422, 'unknown severity is rejected');

    $result = $events->process(['action' => 'getList', 'data' => ['limit' => 2, 'offset' => 1]]);
    $page = dataOf($result);
    check(count($page['items']) === 2 && $page['pagination']['has_more'] === true, 'second page has more');
    check($page['pagination']['total'] === 4, 'total is page-independent');
    $result = $events->process(['action' => 'getList', 'data' => ['limit' => 1000]]);
    check(dataOf($result)['pagination']['limit'] === 200, 'limit is capped at 200');
    $result = $events->process(['action' => 'getList', 'data' => ['limit' => 0]]);
    check(dataOf($result)['pagination']['limit'] === 50, 'limit falls back to 50');

    $record = $events->process(['action' => 'getRecord', 'data' => ['id' => 1]]);
    check($record->success && dataOf($record)['id'] === 1, 'getRecord by id');
    check(dataOf($record)['payload']['subject']['client_number'] === '790000000001700000100', 'record carries the full payload');
    check(!isset(dataOf($record)['dedupe_key']), 'record exposes no dedupe_key');

    $missing = $events->process(['action' => 'getRecord', 'data' => ['id' => 99999]]);
    check(!$missing->success && $missing->httpCode === 404, 'unknown event id is 404');
    check(strpos(json_encode($missing->data, JSON_THROW_ON_ERROR), '99999') === false, '404 does not echo the id');

    // ---------- hub key paths follow module availability ----------

    $registry = SourceRegistry::default();
    $sources = $registry->pollSources();

    $paths = ApiKeyPaths::compute($sources, static fn (string $id): bool => true, static fn (string $m): string => SourceAvailability::AVAILABLE);
    check(in_array('/api/v3/advice', $paths, true), 'core advice path present');
    check(in_array('/api/v3/module-ai-supervisor/calls', $paths, true), 'ai supervisor path present');
    check(in_array('/api/v3/module-voice-agent/callbacks', $paths, true), 'voice agent path present');

    $paths = ApiKeyPaths::compute(
        $sources,
        static fn (string $id): bool => true,
        static fn (string $m): string => $m === 'ModuleVoiceAgent' ? SourceAvailability::MODULE_DISABLED : SourceAvailability::AVAILABLE
    );
    check(!in_array('/api/v3/module-voice-agent/callbacks', $paths, true), 'voice agent path leaves the key when the module is off');
    check(!in_array('/api/v3/module-voice-agent/runtime', $paths, true), 'both voice agent paths leave the key');
    check(in_array('/api/v3/module-ai-supervisor/calls', $paths, true), 'other modules keep their paths');

    $paths = ApiKeyPaths::compute(
        $sources,
        static fn (string $id): bool => $id !== 'core.advice',
        static fn (string $m): string => SourceAvailability::AVAILABLE
    );
    check(!in_array('/api/v3/advice', $paths, true), 'a disabled source keeps its path out of the key');

    $paths = ApiKeyPaths::compute(
        $sources,
        static fn (string $id): bool => true,
        static fn (string $m): string => $m === 'ModuleAISupervisor' ? SourceAvailability::MODULE_MISSING : SourceAvailability::AVAILABLE
    );
    check(!in_array('/api/v3/module-ai-supervisor/workers', $paths, true), 'a missing module keeps its paths out of the key');

    finish('REST contract OK');
}
