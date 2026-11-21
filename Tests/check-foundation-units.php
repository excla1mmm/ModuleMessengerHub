<?php

declare(strict_types=1);

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Api\LocalRestClient;
use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceException;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRecorder;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRegistry;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;

$db = hubTestDatabase();

// HubSettings: defaults, upsert, delete, clamps.
$settings = new HubSettings($db);
check($settings->get(HubSettings::HUB_ENABLED) === '0', 'hub disabled by default');
check($settings->retentionDays() === 30, 'default retention 30 days');
$settings->set(HubSettings::EVENTS_RETENTION_DAYS, '9999');
check($settings->retentionDays() === 365, 'retention clamped to 365');
$settings->set(HubSettings::EVENTS_RETENTION_DAYS, '7');
check($settings->retentionDays() === 7, 'upsert overwrites');
$settings->delete(HubSettings::EVENTS_RETENTION_DAYS);
check($settings->retentionDays() === 30, 'delete falls back to default');
check(in_array(HubSettings::HUB_API_KEY, HubSettings::SECRET_KEYS, true), 'hub api key is a secret');

// SourceRecorder: disabled push source records nothing; enabled records once and marks health.
$states = new SourceStateRepository($db);
$recorder = new SourceRecorder($states, new EventStore($db));
$event = new HubEvent('core.provider_status', 'core.provider_down', HubEvent::SEVERITY_WARNING, 'provider:SIP-1:OFF:100', 100);
$states->setEnabled('core.provider_status', false, 90);
check($recorder->record($event, 100) === false, 'disabled push source must not record');
$states->setEnabled('core.provider_status', true, 95);
check($recorder->record($event, 100) === true, 'enabled push source records');
check($recorder->record($event, 101) === false, 'push dedupe');
check($states->get('core.provider_status')['last_ok_at'] === 101, 'push source health updated');

// SourceRegistry: unique ids, path union.
final class PathSource implements SourceInterface
{
    /** @param list<string> $paths */
    public function __construct(private readonly string $id, private readonly array $paths, private readonly string $mode = self::MODE_POLL)
    {
    }

    public function id(): string { return $this->id; }
    public function eventTypes(): array { return []; }
    public function requiredModule(): ?string { return null; }
    public function apiReadPaths(): array { return $this->paths; }
    public function mode(): string { return $this->mode; }
    public function pollIntervalSec(): int { return 60; }
    public function poll(SourceContext $context, array $cursor): SourceBatch { return SourceBatch::baseline([]); }
}

$registry = new SourceRegistry([
    new PathSource('a.one', ['/api/v3/b', '/api/v3/a']),
    new PathSource('a.two', ['/api/v3/a']),
    new PathSource('a.push', [], SourceInterface::MODE_PUSH),
]);
check($registry->apiReadPaths(['a.one', 'a.two']) === ['/api/v3/a', '/api/v3/b'], 'paths are unique and sorted');
check($registry->apiReadPaths(['a.two']) === ['/api/v3/a'], 'only enabled sources contribute paths');
check(count($registry->pollSources()) === 2, 'poll sources filtered');
$thrown = false;
try {
    new SourceRegistry([new PathSource('dup', []), new PathSource('dup', [])]);
} catch (InvalidArgumentException) {
    $thrown = true;
}
check($thrown, 'duplicate source ids rejected');
check(SourceRegistry::default()->all() === [] || count(SourceRegistry::default()->all()) > 0, 'default registry builds');

// LocalRestClient::unwrap: status and envelope mapping.
$cases = [
    [401, '{}', 'api_unauthorized'],
    [403, '{}', 'api_forbidden'],
    [404, '{}', 'api_not_found'],
    [502, '{}', 'api_unavailable'],
    [200, 'not json', 'api_bad_response'],
    [200, '{"result":false,"data":[]}', 'api_bad_response'],
];
foreach ($cases as [$status, $body, $code]) {
    $got = '';
    try {
        LocalRestClient::unwrap($body, $status);
    } catch (SourceException $exception) {
        $got = $exception->errorCode;
    }
    check($got === $code, "unwrap($status) must throw $code, got '$got'");
}
check(LocalRestClient::unwrap('{"result":true,"data":{"items":[1]}}', 200) === ['items' => [1]], 'unwrap returns data');

// HubLogger::sanitize masks secrets and line breaks.
$masked = HubLogger::sanitize('token 123456789' . ":AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw\nkey sk_AbCdEf0123456789AbCdEf0123456789xyz");
check(!str_contains($masked, 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'), 'telegram token masked');
check(!str_contains($masked, 'AbCdEf0123456789AbCdEf0123456789'), 'long key masked');
check(!str_contains($masked, "\n"), 'newlines removed');

finish('foundation units OK');
