<?php

declare(strict_types=1);

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Api\RestReader;
use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\LinkBuilder;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\Templates\TemplateRegistry;
use Modules\ModuleMessengerHub\Lib\Sources\ApiKeyPaths;
use Modules\ModuleMessengerHub\Lib\Sources\Collector;
use Modules\ModuleMessengerHub\Lib\Sources\ModuleStatusProbe;
use Modules\ModuleMessengerHub\Lib\Sources\Modules\AiWorkerStateSource;
use Modules\ModuleMessengerHub\Lib\Sources\Modules\InMemoryStatusCapabilityStore;
use Modules\ModuleMessengerHub\Lib\Sources\Modules\ModuleStatusProfile;
use Modules\ModuleMessengerHub\Lib\Sources\Modules\ModuleStatusSource;
use Modules\ModuleMessengerHub\Lib\Sources\Modules\StatusCapability;
use Modules\ModuleMessengerHub\Lib\Sources\SourceAvailability;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceException;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRegistry;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

const STATUS_FIXTURES = __DIR__ . '/fixtures/modules-status';

function statusFixture(string $name): array
{
    $raw = file_get_contents(STATUS_FIXTURES . '/' . $name . '.json');
    if ($raw === false) {
        fwrite(STDERR, "missing fixture $name\n");
        exit(1);
    }

    return json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
}

/** Stored events with payload decoded, oldest first. */
function statusRows(HubDatabase $db): array
{
    return array_map(static function (array $row): array {
        $payload = json_decode((string)$row['payload_json'], true, 16, JSON_THROW_ON_ERROR);
        $row['payload'] = is_array($payload) ? $payload : [];
        unset($row['payload_json']);

        return $row;
    }, $db->fetchAll(
        'SELECT id, source_id, event_type, severity, dedupe_key, occurred_at, payload_json'
        . ' FROM ' . EventStore::TABLE . ' ORDER BY id'
    ));
}

/** RestReader over a path map; a missing route is api_not_found, a callable route may throw. */
final class StatusPathReader implements RestReader
{
    /** @var array<string, array<mixed>|callable> */
    private array $routes;

    public int $calls = 0;

    /** @param array<string, array<mixed>|callable> $routes */
    public function __construct(array $routes)
    {
        $this->routes = $routes;
    }

    public function get(string $path, array $query = []): array
    {
        $this->calls++;
        $route = $this->routes[$path] ?? null;
        if ($route === null) {
            throw new SourceException('api_not_found');
        }
        if (is_callable($route)) {
            return $route($path);
        }

        return $route;
    }
}

final class StatusProbe implements ModuleStatusProbe
{
    public function __construct(private readonly string $status)
    {
    }

    public function status(string $moduleUniqueId): string
    {
        return $this->status;
    }
}

function statusPass(
    array $sources,
    RestReader $rest,
    SourceStateRepository $states,
    EventStore $events,
    int $now,
    ModuleStatusProbe $probe = new StatusProbe(SourceAvailability::AVAILABLE)
): array {
    $collector = new Collector($sources, $states, $events, $probe, new SourceContext($rest, static fn (): int => $now));

    return $collector->runOnce();
}

function statusSource(string $sourceId, ?InMemoryStatusCapabilityStore $capabilities = null): ModuleStatusSource
{
    $profile = ModuleStatusSource::profileFor($sourceId);
    check($profile instanceof ModuleStatusProfile, "profile exists: $sourceId");
    if (!$profile instanceof ModuleStatusProfile) {
        exit(1);
    }

    return new ModuleStatusSource($profile, $capabilities);
}

/** @return array<string, mixed> payload of the single stored event */
function onlyEvent(array $rows): array
{
    check(count($rows) === 1, 'exactly one event stored (got ' . count($rows) . ')');

    return $rows[0] ?? [];
}

$now = 1795000000;
$ruCatalog = require dirname(__DIR__) . '/Messages/ru.php';

// ======================= registry, profiles, key paths =======================
$registry = SourceRegistry::default();
$statusIds = [
    ModuleStatusSource::SOURCE_LOCAL_STT,
    ModuleStatusSource::SOURCE_CLOUD_STT,
    ModuleStatusSource::SOURCE_CLOUD_AI,
    ModuleStatusSource::SOURCE_AI_SUPERVISOR,
];
foreach ($statusIds as $id) {
    $source = $registry->find($id);
    check($source instanceof ModuleStatusSource, "registry: $id is a ModuleStatusSource");
    check($source?->mode() === SourceInterface::MODE_POLL && $source->pollIntervalSec() === 60, "registry: $id polls every 60 s");
    check($source?->requiredModule() !== null, "registry: $id has requiredModule");
}
check(count($registry->all()) === 12, 'registry: twelve sources after stage 3b-1');
check(\Modules\ModuleMessengerHub\Lib\Sources\SourceCatalog::minVersion(ModuleStatusSource::SOURCE_LOCAL_STT) === '1.154', 'catalog: Local STT minimal /status version');
check(\Modules\ModuleMessengerHub\Lib\Sources\SourceCatalog::minVersion(ModuleStatusSource::SOURCE_CLOUD_STT) === '1.120', 'catalog: Cloud STT minimal /status version');
check(\Modules\ModuleMessengerHub\Lib\Sources\SourceCatalog::minVersion(ModuleStatusSource::SOURCE_CLOUD_AI) === '1.46', 'catalog: Cloud AI minimal /status version');
check(\Modules\ModuleMessengerHub\Lib\Sources\SourceCatalog::minVersion(ModuleStatusSource::SOURCE_AI_SUPERVISOR) === '', 'catalog: AI Supervisor /status is not released yet');
foreach ($statusIds as $id) {
    foreach (\Modules\ModuleMessengerHub\Lib\Sources\SourceCatalog::eventTypeKeys($id) as $type => $key) {
        check(isset($ruCatalog[$key]), "catalog: $type has a translation key");
    }
}

check(statusSource(ModuleStatusSource::SOURCE_LOCAL_STT)->eventTypes() === [
    'local_stt.worker_offline',
    'local_stt.worker_online',
    'local_stt.backlog_no_workers',
    'local_stt.backlog_resolved',
], 'local STT: event types');
check(statusSource(ModuleStatusSource::SOURCE_CLOUD_STT)->eventTypes() === [
    'cloud_stt.incident',
    'cloud_stt.incident_resolved',
    'cloud_stt.paused',
    'cloud_stt.resumed',
], 'cloud STT: event types');
check(statusSource(ModuleStatusSource::SOURCE_CLOUD_AI)->eventTypes() === [
    'cloud_ai.paused',
    'cloud_ai.resumed',
], 'cloud AI: event types');
check(statusSource(ModuleStatusSource::SOURCE_AI_SUPERVISOR)->eventTypes() === [
    'ai_supervisor.worker_offline',
    'ai_supervisor.worker_online',
], 'AI Supervisor: keeps the stage 1.3 event types');

$localPaths = statusSource(ModuleStatusSource::SOURCE_LOCAL_STT)->apiReadPaths();
check($localPaths === ['/api/v3/module-local-speech-to-text/status'], 'local STT: only /status in the key');
$cloudAiPaths = statusSource(ModuleStatusSource::SOURCE_CLOUD_AI)->apiReadPaths();
check($cloudAiPaths === ['/api/v3/module-cloud-ai-supervisor/status'], 'cloud AI: only /status in the key');

// the /workers path is tied to the detected capability, not to the enabled flag
$capabilities = new InMemoryStatusCapabilityStore();
$ai = statusSource(ModuleStatusSource::SOURCE_AI_SUPERVISOR, $capabilities);
check($ai->apiReadPaths() === [
    '/api/v3/module-ai-supervisor/status',
    '/api/v3/module-ai-supervisor/workers',
], 'AI Supervisor: unknown capability keeps both paths (bootstrap)');
$capabilities->remember(ModuleStatusSource::SOURCE_AI_SUPERVISOR, StatusCapability::available($now));
check($ai->apiReadPaths() === ['/api/v3/module-ai-supervisor/status'], 'AI Supervisor: a /status answer drops /workers from the key');
$capabilities->remember(ModuleStatusSource::SOURCE_AI_SUPERVISOR, StatusCapability::missing($now));
check($ai->apiReadPaths() === [
    '/api/v3/module-ai-supervisor/status',
    '/api/v3/module-ai-supervisor/workers',
], 'AI Supervisor: while the fallback is in use /workers stays readable');

$available = static fn (string $module): string => SourceAvailability::AVAILABLE;
$allPaths = static fn (InMemoryStatusCapabilityStore $store): array => ApiKeyPaths::compute(
    SourceRegistry::default($store)->pollSources(),
    static fn (string $id): bool => true,
    $available
);
$unknownPaths = $allPaths(new InMemoryStatusCapabilityStore());
check($unknownPaths === [
    '/api/v3/advice',
    '/api/v3/module-ai-supervisor/calls',
    '/api/v3/module-ai-supervisor/status',
    '/api/v3/module-ai-supervisor/workers',
    '/api/v3/module-cloud-ai-supervisor/status',
    '/api/v3/module-cloud-speech-to-text/status',
    '/api/v3/module-local-speech-to-text/status',
    '/api/v3/module-voice-agent/callbacks',
    '/api/v3/module-voice-agent/runtime',
], 'key: bootstrap path set (status everywhere, /workers while unknown)');
$capTrue = new InMemoryStatusCapabilityStore();
$capTrue->remember(ModuleStatusSource::SOURCE_AI_SUPERVISOR, StatusCapability::available($now));
check(!in_array('/api/v3/module-ai-supervisor/workers', $allPaths($capTrue), true), 'key: /workers leaves the set on /status detection');
$capFalse = new InMemoryStatusCapabilityStore();
$capFalse->remember(ModuleStatusSource::SOURCE_AI_SUPERVISOR, StatusCapability::missing($now));
check(in_array('/api/v3/module-ai-supervisor/workers', $allPaths($capFalse), true), 'key: /workers present while the fallback is detected');
foreach ($allPaths($capTrue) as $path) {
    check(str_ends_with($path, '/status') || str_contains($path, '/calls') || str_contains($path, '/callbacks')
        || str_contains($path, '/runtime') || $path === '/api/v3/advice', "key: no unrelated path ($path)");
}

// ======================= local STT: baseline, diff, debounce =======================
$h = hubTestDatabase();
$states = new SourceStateRepository($h);
$events = new EventStore($h);
$local = statusSource(ModuleStatusSource::SOURCE_LOCAL_STT);
$statusPath = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_LOCAL_STT)?->statusPath();

$report = statusPass([$local], new StatusPathReader([$statusPath => statusFixture('local-stt-down')]), $states, $events, $now);
check(($report[ModuleStatusSource::SOURCE_LOCAL_STT]['status'] ?? '') === SourceAvailability::AVAILABLE, 'local STT: pass ok');
check(statusRows($h) === [], 'local STT: existing issues are a silent baseline');
$cursor = $states->get(ModuleStatusSource::SOURCE_LOCAL_STT)['cursor'];
check(count($cursor['issues'] ?? []) === 2, 'local STT: baseline records both pairs as known');
check(($cursor['issues']['backlog_no_workers|queue']['pending'] ?? true) === false, 'local STT: baseline pair is not pending');

$now += 60;
statusPass([$local], new StatusPathReader([$statusPath => statusFixture('local-stt-down')]), $states, $events, $now);
check(statusRows($h) === [], 'local STT: repeated poll does not duplicate');

// backlog resolves while one worker stays offline
$now += 60;
statusPass([$local], new StatusPathReader([$statusPath => statusFixture('local-stt-worker-offline')]), $states, $events, $now);
$row = onlyEvent(statusRows($h));
check(($row['event_type'] ?? '') === 'local_stt.backlog_resolved', 'local STT: a disappearing pair emits the recovery type');
check(($row['severity'] ?? '') === HubEvent::SEVERITY_INFO, 'local STT: recovery is info');
check(($row['dedupe_key'] ?? '') === 'local_stt.status:backlog_no_workers:queue:1795153998:recovered', 'local STT: recovery key is stable');
check(($row['payload']['subject']['module_status']['counters']['workers_total'] ?? 0) === 3, 'local STT: recovery carries the counters snapshot');

// the worker comes back: recovery for a baseline-known pair
$now += 60;
statusPass([$local], new StatusPathReader([$statusPath => statusFixture('local-stt-ok')]), $states, $events, $now);
check(count(statusRows($h)) === 2, 'local STT: second recovery emitted');
$last = statusRows($h)[1];
check(($last['event_type'] ?? '') === 'local_stt.worker_online', 'local STT: worker recovery type');
check(!str_contains((string)($last['dedupe_key'] ?? ''), '1795153998'), 'local STT: the top-level since is never in a key');

// debounce: a worker must be observed for 120 s before the event
$h2 = hubTestDatabase();
$states2 = new SourceStateRepository($h2);
$events2 = new EventStore($h2);
$t0 = 1795200000;
statusPass([$local], new StatusPathReader([$statusPath => statusFixture('local-stt-ok')]), $states2, $events2, $t0);
statusPass([$local], new StatusPathReader([$statusPath => statusFixture('local-stt-worker-offline')]), $states2, $events2, $t0 + 60);
check(statusRows($h2) === [], 'debounce: first sighting is not announced');
statusPass([$local], new StatusPathReader([$statusPath => statusFixture('local-stt-worker-offline')]), $states2, $events2, $t0 + 120);
check(statusRows($h2) === [], 'debounce: 60 s of presence is not enough for worker_offline');
statusPass([$local], new StatusPathReader([$statusPath => statusFixture('local-stt-worker-offline')]), $states2, $events2, $t0 + 180);
$row = onlyEvent(statusRows($h2));
check(($row['event_type'] ?? '') === 'local_stt.worker_offline', 'debounce: event after 120 s');
check(($row['dedupe_key'] ?? '') === 'local_stt.status:worker_offline:2df52bb5d7d9:1793262107', 'local STT: dedupe <source>:<code>:<ref>:<since>');
check(($row['severity'] ?? '') === HubEvent::SEVERITY_WARNING, 'local STT: worker_offline is warning');
check(($row['payload']['subject']['module_status']['code'] ?? '') === 'worker_offline', 'payload carries the code instead of free text');
check(($row['payload']['subject']['module_status']['counters']['workers_online'] ?? -1) === 2, 'payload carries counters');
check(($row['occurred_at'] ?? 0) === $t0 + 180, 'occurred_at is the observation time');

// a restarted collector with the same stored state does not duplicate
$restart = new Collector(
    [$local],
    $states2,
    $events2,
    new StatusProbe(SourceAvailability::AVAILABLE),
    new SourceContext(new StatusPathReader([$statusPath => statusFixture('local-stt-worker-offline')]), static fn (): int => $t0 + 240)
);
$restart->runOnce();
check(count(statusRows($h2)) === 1, 'restart: the same pair is not announced again');

// debounce 0: the backlog alert fires on the first appearance
$h3 = hubTestDatabase();
$states3 = new SourceStateRepository($h3);
$events3 = new EventStore($h3);
statusPass([$local], new StatusPathReader([$statusPath => statusFixture('local-stt-ok')]), $states3, $events3, $t0);
statusPass([$local], new StatusPathReader([$statusPath => statusFixture('local-stt-down')]), $states3, $events3, $t0 + 60);
$types = array_column(statusRows($h3), 'event_type');
check($types === ['local_stt.backlog_no_workers'], 'debounce 0: backlog announced at once, worker still pending (got ' . implode(',', $types) . ')');
$row = statusRows($h3)[0];
check(($row['severity'] ?? '') === HubEvent::SEVERITY_CRITICAL, 'local STT: backlog is critical');
check(($row['payload']['subject']['module_status']['counters']['jobs_waiting'] ?? 0) === 4, 'local STT: backlog payload carries jobs_waiting');

// unknown codes and malformed answers are never guessed
$h4 = hubTestDatabase();
$states4 = new SourceStateRepository($h4);
$events4 = new EventStore($h4);
$odd = ['state' => 'degraded', 'since' => 1, 'issues' => [
    ['code' => 'mystery_code', 'ref' => 'x', 'severity' => 'critical', 'since' => 5],
], 'counters' => []];
statusPass([$local], new StatusPathReader([$statusPath => $odd]), $states4, $events4, $t0);
check(statusRows($h4) === [], 'unknown code: no event and no guessed text');
check(($states4->get(ModuleStatusSource::SOURCE_LOCAL_STT)['cursor']['issues'] ?? []) === [], 'unknown code: not tracked');
$malformed = new StatusPathReader([$statusPath => ['state' => 'degraded']]);
$report = statusPass([$local], $malformed, $states4, $events4, $t0 + 60);
check(($report[ModuleStatusSource::SOURCE_LOCAL_STT]['status'] ?? '') === SourceAvailability::ERROR, 'malformed answer is an error');
check(statusRows($h4) === [], 'malformed answer never looks like a recovery');

// ======================= 404 on /status: api_incompatible =======================
$h5 = hubTestDatabase();
$states5 = new SourceStateRepository($h5);
$events5 = new EventStore($h5);
$report = statusPass([$local], new StatusPathReader([]), $states5, $events5, $t0);
check(($report[ModuleStatusSource::SOURCE_LOCAL_STT]['status'] ?? '') === SourceAvailability::API_INCOMPATIBLE, '404: api_incompatible, not a log error');
check(statusRows($h5) === [], '404: no events');
check($states5->get(ModuleStatusSource::SOURCE_LOCAL_STT)['cursor'] === [], '404: cursor is dropped for a fresh baseline');
check($states5->get(ModuleStatusSource::SOURCE_LOCAL_STT)['last_error_code'] === 'api_incompatible', '404: stable error code stored');
check(SourceAvailability::fromErrorCode('api_incompatible') === SourceAvailability::API_INCOMPATIBLE, '404: availability mapping');

// after the module update the first successful poll is a silent baseline
statusPass([$local], new StatusPathReader([$statusPath => statusFixture('local-stt-down')]), $states5, $events5, $t0 + 60);
check(statusRows($h5) === [], '404: after the update issues are recorded, not broadcast');

// ======================= cloud STT: incident and pause =======================
$hc = hubTestDatabase();
$cs = new SourceStateRepository($hc);
$ce = new EventStore($hc);
$cloudStt = statusSource(ModuleStatusSource::SOURCE_CLOUD_STT);
$cloudSttPath = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_CLOUD_STT)?->statusPath();
$t = 1795300000;
statusPass([$cloudStt], new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-ok')]), $cs, $ce, $t);
statusPass([$cloudStt], new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-incident')]), $cs, $ce, $t + 60);
$row = onlyEvent(statusRows($hc));
check(($row['event_type'] ?? '') === 'cloud_stt.incident', 'cloud STT: incident event');
check(($row['severity'] ?? '') === HubEvent::SEVERITY_WARNING, 'cloud STT: severity comes from the incident');
check(($row['dedupe_key'] ?? '') === 'cloud_stt.status:incident_open:inc_5f31c2a9:1793000000', 'cloud STT: one key per incident ref');

// acknowledging an incident keeps it open with the same ref/since: no second alert
statusPass([$cloudStt], new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-incident')]), $cs, $ce, $t + 120);
check(count(statusRows($hc)) === 1, 'cloud STT: acknowledged incident does not re-alert');
$acknowledged = statusFixture('cloud-stt-incident');
$acknowledged['issues'][0]['severity'] = 'info';
statusPass([$cloudStt], new StatusPathReader([$cloudSttPath => $acknowledged]), $cs, $ce, $t + 180);
check(count(statusRows($hc)) === 1, 'cloud STT: severity change of the same incident is not a new event');

// the incident resolves
statusPass([$cloudStt], new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-ok')]), $cs, $ce, $t + 240);
$row = statusRows($hc)[1];
check(($row['event_type'] ?? '') === 'cloud_stt.incident_resolved', 'cloud STT: incident recovery');
check(($row['severity'] ?? '') === HubEvent::SEVERITY_INFO, 'cloud STT: incident recovery is info');
check(($row['dedupe_key'] ?? '') === 'cloud_stt.status:incident_open:inc_5f31c2a9:1793000000:recovered', 'cloud STT: recovery key');

// a new incident with the same public id but a new since is a new episode
$newEpisode = statusFixture('cloud-stt-incident');
$newEpisode['issues'][0]['since'] = 1793050000;
statusPass([$cloudStt], new StatusPathReader([$cloudSttPath => $newEpisode]), $cs, $ce, $t + 300);
check(count(statusRows($hc)) === 3, 'cloud STT: a new episode of the same ref alerts');

// pause and resume
$hp = hubTestDatabase();
$ps = new SourceStateRepository($hp);
$pe = new EventStore($hp);
$t = 1795400000;
statusPass([$cloudStt], new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-ok')]), $ps, $pe, $t);
statusPass([$cloudStt], new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-paused')]), $ps, $pe, $t + 60);
$row = onlyEvent(statusRows($hp));
check(($row['event_type'] ?? '') === 'cloud_stt.paused' && ($row['severity'] ?? '') === HubEvent::SEVERITY_WARNING, 'cloud STT: paused is warning');
check(str_ends_with((string)($row['dedupe_key'] ?? ''), ':1793100000'), 'cloud STT: pause key uses the issue since');
statusPass([$cloudStt], new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-ok')]), $ps, $pe, $t + 120);
check((statusRows($hp)[1]['event_type'] ?? '') === 'cloud_stt.resumed', 'cloud STT: resume event');
check((statusRows($hp)[1]['severity'] ?? '') === HubEvent::SEVERITY_INFO, 'cloud STT: resume is info');

// ======================= cloud AI: silent not_configured, reason severities =======================
$ha = hubTestDatabase();
$as = new SourceStateRepository($ha);
$ae = new EventStore($ha);
$cloudAi = statusSource(ModuleStatusSource::SOURCE_CLOUD_AI);
$cloudAiPath = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_CLOUD_AI)?->statusPath();
$t = 1795500000;
statusPass([$cloudAi], new StatusPathReader([$cloudAiPath => statusFixture('cloud-ai-not-configured')]), $as, $ae, $t);
check(statusRows($ha) === [], 'cloud AI: not_configured produces nothing (baseline)');
check(($as->get(ModuleStatusSource::SOURCE_CLOUD_AI)['cursor']['issues'] ?? []) === [], 'cloud AI: not_configured is not tracked at all');

// a real pause appears while not_configured disappears: only the manual pause is announced
statusPass([$cloudAi], new StatusPathReader([$cloudAiPath => statusFixture('cloud-ai-manual')]), $as, $ae, $t + 60);
$row = onlyEvent(statusRows($ha));
check(($row['event_type'] ?? '') === 'cloud_ai.paused', 'cloud AI: manual pause event');
check(($row['severity'] ?? '') === HubEvent::SEVERITY_INFO, 'cloud AI: manual pause is info');
check(($row['payload']['subject']['module_status']['ref'] ?? '') === 'manual', 'cloud AI: payload carries the reason code');
check(($row['payload']['subject']['module_status']['counters']['jobs_waiting'] ?? 0) === 3, 'cloud AI: jobs_waiting is in the payload');

// back to not_configured: the manual pause is over, the ignored state adds nothing
statusPass([$cloudAi], new StatusPathReader([$cloudAiPath => statusFixture('cloud-ai-not-configured')]), $as, $ae, $t + 120);
check(count(statusRows($ha)) === 2, 'cloud AI: resume emitted for the pause, nothing for not_configured');
$row = statusRows($ha)[1];
check(($row['event_type'] ?? '') === 'cloud_ai.resumed' && ($row['severity'] ?? '') === HubEvent::SEVERITY_INFO, 'cloud AI: resume is info');

// billing: critical, and the source_unavailable pause resolves
$hb = hubTestDatabase();
$bs = new SourceStateRepository($hb);
$be = new EventStore($hb);
statusPass([$cloudAi], new StatusPathReader([$cloudAiPath => statusFixture('cloud-ai-source-unavailable')]), $bs, $be, $t);
statusPass([$cloudAi], new StatusPathReader([$cloudAiPath => statusFixture('cloud-ai-billing')]), $bs, $be, $t + 60);
$stored = statusRows($hb);
check(count($stored) === 2, 'cloud AI: one resume and one billing pause');
$byType = array_column($stored, null, 'event_type');
check(isset($byType['cloud_ai.resumed']) && isset($byType['cloud_ai.paused']), 'cloud AI: resume and pause both emitted');
check(($byType['cloud_ai.paused']['severity'] ?? '') === HubEvent::SEVERITY_CRITICAL, 'cloud AI: insufficient funds is critical');
check(str_contains((string)($byType['cloud_ai.paused']['dedupe_key'] ?? ''), ':insufficient_funds:'), 'cloud AI: billing key uses the reason ref');

// ======================= AI Supervisor: /status preferred, /workers fallback =======================
$hi = hubTestDatabase();
$is = new SourceStateRepository($hi);
$ie = new EventStore($hi);
$aiCap = new InMemoryStatusCapabilityStore();
$aiSource = statusSource(ModuleStatusSource::SOURCE_AI_SUPERVISOR, $aiCap);
$aiStatusPath = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_AI_SUPERVISOR)?->statusPath();
$aiApiStatusPath = (string)ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_AI_SUPERVISOR)?->statusApiPath();
$aiWorkersPath = AiWorkerStateSource::PATH;
$workersFixture = json_decode((string)file_get_contents(__DIR__ . '/fixtures/ai-supervisor/workers.json'), true, 16, JSON_THROW_ON_ERROR);
$t = 1795600000;
// the fixtures were written once; keep the workers inside the module's 30-day retention window
$workersFixture['items'][0]['last_seen'] = $t - 60;
$workersFixture['items'][1]['last_seen'] = $t - 3600;

$report = statusPass([$aiSource], new StatusPathReader([
    $aiStatusPath => static function (): array {
        throw new SourceException('api_not_found'); // the released module has no /status yet
    },
    $aiWorkersPath => $workersFixture,
]), $is, $ie, $t);
check(($report[ModuleStatusSource::SOURCE_AI_SUPERVISOR]['status'] ?? '') === SourceAvailability::AVAILABLE, 'AI fallback: /workers keeps the source available');
check(statusRows($hi) === [], 'AI fallback: worker already offline before the switch is not re-alerted');
$cursor = $is->get(ModuleStatusSource::SOURCE_AI_SUPERVISOR)['cursor'];
check(($cursor['reader'] ?? '') === 'workers', 'AI fallback: reader is recorded');
check($aiCap->get(ModuleStatusSource::SOURCE_AI_SUPERVISOR)->statusPathAvailable === false, 'AI fallback: capability cached as missing');
check(isset($cursor['issues']['worker_offline|87355afe8690']), 'AI fallback: offline worker ref is the /status ref');
check(($cursor['issues']['worker_offline|87355afe8690']['since'] ?? 0) === $t - 3600, 'AI fallback: since = last_seen, same as /status');

// the worker recovers, then fails again after the debounce window
$workersOnline = $workersFixture;
$workersOnline['items'][1]['status'] = 'online';
statusPass([$aiSource], new StatusPathReader([$aiStatusPath => static fn (): array => throw new SourceException('api_not_found'), $aiWorkersPath => $workersOnline]), $is, $ie, $t + 60);
check((statusRows($hi)[0]['event_type'] ?? '') === 'ai_supervisor.worker_online', 'AI fallback: worker recovery keeps the old event type');

$newOfflineSince = $t + 1000;
$workersOfflineAgain = $workersFixture;
$workersOfflineAgain['items'][1]['last_seen'] = $newOfflineSince;
$fallbackRoutes = [$aiStatusPath => static fn (): array => throw new SourceException('api_not_found'), $aiWorkersPath => $workersOfflineAgain];
statusPass([$aiSource], new StatusPathReader($fallbackRoutes), $is, $ie, $t + 120);
statusPass([$aiSource], new StatusPathReader($fallbackRoutes), $is, $ie, $t + 180);
check(count(statusRows($hi)) === 1, 'AI fallback: debounce suppresses the first two observations');
statusPass([$aiSource], new StatusPathReader($fallbackRoutes), $is, $ie, $t + 240);
$stored = statusRows($hi);
check(count($stored) === 2, 'AI fallback: the second failure is announced once after the debounce');
check(($stored[1]['dedupe_key'] ?? '') === 'ai_supervisor.workers:worker_offline:87355afe8690:' . $newOfflineSince, 'AI fallback: dedupe <source>:<code>:<ref>:<since>');

// the module is updated: /status now answers with the same pair — no duplicate, no gap
$statusSame = statusFixture('ai-supervisor-status');
$statusSame['issues'][0]['since'] = $newOfflineSince;
$aiCap->remember(ModuleStatusSource::SOURCE_AI_SUPERVISOR, StatusCapability::missing(0)); // re-check is due
$report = statusPass([$aiSource], new StatusPathReader([$aiStatusPath => $statusSame, $aiWorkersPath => $workersOfflineAgain]), $is, $ie, $t + 300);
check(($report[ModuleStatusSource::SOURCE_AI_SUPERVISOR]['status'] ?? '') === SourceAvailability::AVAILABLE, 'AI switch: /status pass ok');
check(count(statusRows($hi)) === 2, 'AI switch: same worker pair does not alert again');
check($aiCap->get(ModuleStatusSource::SOURCE_AI_SUPERVISOR)->statusPathAvailable === true, 'AI switch: capability flipped to /status');
check(($is->get(ModuleStatusSource::SOURCE_AI_SUPERVISOR)['cursor']['reader'] ?? '') === 'status', 'AI switch: reader is status');
check($aiSource->apiReadPaths() === [$aiApiStatusPath], 'AI switch: /workers leaves the key');

// a downgrade (404 again) falls back in the same poll without events
$report = statusPass([$aiSource], new StatusPathReader([$aiStatusPath => static fn (): array => throw new SourceException('api_not_found'), $aiWorkersPath => $workersOfflineAgain]), $is, $ie, $t + 360);
check(($report[ModuleStatusSource::SOURCE_AI_SUPERVISOR]['status'] ?? '') === SourceAvailability::AVAILABLE, 'AI downgrade: fallback works');
check(count(statusRows($hi)) === 2, 'AI downgrade: no event on the reader switch');
check($aiSource->apiReadPaths() === [$aiApiStatusPath, '/api/v3/module-ai-supervisor/workers'], 'AI downgrade: /workers returns to the key');

// the same snapshot gives the same dedupe key from both readers
$statusSnapshot = ModuleStatusSource::snapshot($statusSame);
$workersSnapshot = AiWorkerStateSource::snapshot($workersOfflineAgain, $t + 360);
$statusIssue = $statusSnapshot['issues'][0];
$workersIssue = $workersSnapshot['issues'][0];
check(
    [$statusIssue['code'], $statusIssue['ref'], $statusIssue['since']] === [$workersIssue['code'], $workersIssue['ref'], $workersIssue['since']],
    'AI readers: /status and /workers describe the same pair'
);
$pendingCursor = [
    'issues' => ['worker_offline|87355afe8690' => [
        'code' => 'worker_offline',
        'ref' => '87355afe8690',
        'severity' => 'warning',
        'since' => $newOfflineSince,
        'first_seen' => $t + 1,
        'last_seen' => $t + 1,
        'pending' => true,
    ]],
];
$profile = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_AI_SUPERVISOR);
$fromStatus = $profile === null ? null : ModuleStatusSource::buildBatch($profile, $statusSnapshot, $pendingCursor, $t + 200);
$fromWorkers = $profile === null ? null : ModuleStatusSource::buildBatch($profile, $workersSnapshot, $pendingCursor, $t + 200);
check(
    $fromStatus !== null && $fromWorkers !== null
    && $fromStatus->events[0]->dedupeKey === $fromWorkers->events[0]->dedupeKey,
    'AI readers: identical dedupe key across /status and /workers'
);

// a stage 1.3 cursor ({"workers": ...}) is migrated as a silent baseline
$hl = hubTestDatabase();
$ls = new SourceStateRepository($hl);
$le = new EventStore($hl);
$ls->saveCursor(ModuleStatusSource::SOURCE_AI_SUPERVISOR, ['workers' => [
    'win-worker-02' => ['status' => 'offline', 'name' => 'Legacy', 'last_seen' => 1791070800],
]]);
$legacySource = statusSource(ModuleStatusSource::SOURCE_AI_SUPERVISOR, new InMemoryStatusCapabilityStore());
statusPass([$legacySource], new StatusPathReader([$aiStatusPath => $statusSame, $aiWorkersPath => $workersFixture]), $ls, $le, $t);
check(statusRows($hl) === [], 'legacy cursor: an offline worker is not re-alerted on upgrade');
check(isset($ls->get(ModuleStatusSource::SOURCE_AI_SUPERVISOR)['cursor']['issues']), 'legacy cursor: replaced by the status cursor');

// ======================= templates =======================
$texts = hubTestTexts();
$context = new RenderContext($texts, new LinkBuilder('https://pbx.example'));
$templates = new TemplateRegistry();
$billingSnapshot = ModuleStatusSource::snapshot(statusFixture('cloud-ai-billing'));
// a cursor with an empty known set (but not a first run) plus debounce 0 yields the onset at once
$profileAi = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_CLOUD_AI);
$onset = $profileAi === null ? null : ModuleStatusSource::buildBatch(
    $profileAi,
    $billingSnapshot,
    ['issues' => [], 'state' => 'ok', 'counters' => []],
    $t
);
check($onset !== null && count($onset->events) === 1, 'template fixture: onset event built');
$pausedEvent = $onset?->events[0];
$rendered = $pausedEvent === null ? null : $templates->forEvent($pausedEvent->eventType)?->render($pausedEvent, $context);
check($rendered !== null && str_contains($rendered->title, 'Облачный ИИ приостановлен'), 'template: cloud AI pause title');
$lines = $rendered?->lines ?? [];
check(in_array('Облачный ИИ Супервайзер', $lines, true), 'template: module name in words');
check(in_array('Недостаточно средств на счёте облачного ИИ', $lines, true), 'template: reason in words, not the raw code');
check(
    !str_contains(implode(' ', $lines), 'insufficient_funds')
    && !str_contains($rendered?->title ?? '', 'insufficient_funds'),
    'template: the raw ref is never the main text'
);
check(in_array('В очереди 12 задач', $rendered?->notes ?? [], true), 'template: counters as a note');

$unknownEvent = new HubEvent(
    sourceId: ModuleStatusSource::SOURCE_CLOUD_AI,
    eventType: 'cloud_ai.paused',
    severity: HubEvent::SEVERITY_WARNING,
    dedupeKey: 'x:y:z:1',
    occurredAt: $t,
    payload: ['subject' => ['module_status' => [
        'module' => 'ModuleCloudAISupervisor',
        'code' => 'brand_new_code',
        'ref' => 'brand_new_ref',
        'severity' => 'warning',
        'since' => 0,
        'recovered' => false,
        'counters' => [],
    ]]],
);
$renderedUnknown = $templates->forEvent('cloud_ai.paused')?->render($unknownEvent, $context);
check(
    in_array('Изменилось состояние модуля', $renderedUnknown?->lines ?? [], true)
    && !str_contains(implode(' ', $renderedUnknown?->lines ?? []), 'brand_new_code'),
    'template: an unknown pair falls back to neutral text'
);

$resumedPayload = [
    'subject' => ['module_status' => [
        'module' => 'ModuleCloudSpeechToText',
        'code' => 'processing_paused',
        'ref' => 'user',
        'severity' => 'warning',
        'since' => 1793100000,
        'recovered' => true,
        'counters' => ['incidents_open' => 0],
    ]],
];
$resumedEvent = new HubEvent(
    sourceId: ModuleStatusSource::SOURCE_CLOUD_STT,
    eventType: 'cloud_stt.resumed',
    severity: HubEvent::SEVERITY_INFO,
    dedupeKey: 'cloud_stt.status:processing_paused:user:1793100000:recovered',
    occurredAt: $t,
    payload: $resumedPayload,
);
$renderedResumed = $templates->forEvent('cloud_stt.resumed')?->render($resumedEvent, $context);
check(str_contains($renderedResumed?->title ?? '', 'возобновлено'), 'template: resume title');
check(in_array('Обработка возобновлена', $renderedResumed?->lines ?? [], true), 'template: resume line');

// the AI Supervisor event type keeps working when the payload comes from /status
$aiStatusSnapshot = ModuleStatusSource::snapshot(statusFixture('ai-supervisor-status'));
$profileAiWorker = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_AI_SUPERVISOR);
$aiOnset = $profileAiWorker === null ? null : ModuleStatusSource::buildBatch(
    $profileAiWorker,
    $aiStatusSnapshot,
    ['issues' => ['worker_offline|87355afe8690' => [
        'code' => 'worker_offline',
        'ref' => '87355afe8690',
        'severity' => 'warning',
        'since' => 1791070800,
        'first_seen' => $t + 80,
        'last_seen' => $t + 80,
        'pending' => true,
    ]], 'state' => 'degraded', 'counters' => []],
    $t + 200
);
$aiEvent = $aiOnset?->events[0] ?? null;
$renderedAi = $aiEvent === null ? null : $templates->forEvent($aiEvent->eventType)?->render($aiEvent, $context);
check(
    in_array('ИИ Супервайзер', $renderedAi?->lines ?? [], true)
    && in_array('Воркер не выходит на связь', $renderedAi?->lines ?? [], true),
    'template: the old AI Supervisor event type renders the /status payload'
);
check(in_array('В сети 1 из 2 воркеров', $renderedAi?->notes ?? [], true), 'template: AI worker counters');

finish('module status sources OK');
