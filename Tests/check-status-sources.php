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
use Modules\ModuleMessengerHub\Lib\Sources\Modules\ModuleStatusProfile;
use Modules\ModuleMessengerHub\Lib\Sources\Modules\ModuleStatusSource;
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

function statusSource(string $sourceId): ModuleStatusSource
{
    $profile = ModuleStatusSource::profileFor($sourceId);
    check($profile instanceof ModuleStatusProfile, "profile exists: $sourceId");
    if (!$profile instanceof ModuleStatusProfile) {
        exit(1);
    }

    return new ModuleStatusSource($profile);
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
    ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS,
    ModuleStatusSource::SOURCE_LOCAL_STT_BACKLOG,
    ModuleStatusSource::SOURCE_CLOUD_STT_INCIDENTS,
    ModuleStatusSource::SOURCE_CLOUD_STT_PAUSED,
    ModuleStatusSource::SOURCE_CLOUD_AI_PAUSED,
    ModuleStatusSource::SOURCE_AI_SUPERVISOR,
];
foreach ($statusIds as $id) {
    $source = $registry->find($id);
    check($source instanceof ModuleStatusSource, "registry: $id is a ModuleStatusSource");
    check($source?->mode() === SourceInterface::MODE_POLL && $source->pollIntervalSec() === 60, "registry: $id polls every 60 s");
    check($source?->requiredModule() !== null, "registry: $id has requiredModule");
}
check(count($registry->all()) === 14, 'registry: fourteen sources after the per-problem split');
foreach (['local_stt.status', 'cloud_stt.status', 'cloud_ai.status'] as $retired) {
    check($registry->find($retired) === null, "registry: $retired is retired");
}
$catalog = \Modules\ModuleMessengerHub\Lib\Sources\SourceCatalog::class;
check($catalog::minVersion(ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS) === '1.154', 'catalog: Local STT workers minimal /status version');
check($catalog::minVersion(ModuleStatusSource::SOURCE_LOCAL_STT_BACKLOG) === '1.154', 'catalog: Local STT backlog minimal /status version');
check($catalog::minVersion(ModuleStatusSource::SOURCE_CLOUD_STT_INCIDENTS) === '1.120', 'catalog: Cloud STT incidents minimal /status version');
check($catalog::minVersion(ModuleStatusSource::SOURCE_CLOUD_STT_PAUSED) === '1.120', 'catalog: Cloud STT paused minimal /status version');
check($catalog::minVersion(ModuleStatusSource::SOURCE_CLOUD_AI_PAUSED) === '1.46', 'catalog: Cloud AI minimal /status version');
check($catalog::minVersion(ModuleStatusSource::SOURCE_AI_SUPERVISOR) === '1.186.6', 'catalog: AI Supervisor needs 1.186.6 (first release with /status)');
foreach ($statusIds as $id) {
    check($catalog::group($id) === ($id === ModuleStatusSource::SOURCE_AI_SUPERVISOR ? 'ai_supervisor' : 'speech_ai'), "catalog: group of $id");
    check(isset($ruCatalog[$catalog::nameKey($id)]), "catalog: $id has a translated name");
    check($catalog::eventTypes($id) === statusSource($id)->eventTypes(), "catalog: event types of $id match the adapter");
    foreach ($catalog::eventTypeKeys($id) as $type => $key) {
        check(isset($ruCatalog[$key]), "catalog: $type has a translation key");
    }
}
// one scenario per kind of problem: every event type belongs to exactly one source and the pairs stay together
$seenTypes = [];
foreach ($statusIds as $id) {
    $types = statusSource($id)->eventTypes();
    check(count($types) === 2, "split: $id has one problem type and its recovery");
    foreach ($types as $type) {
        check(!isset($seenTypes[$type]), "split: $type is produced by one source only");
        $seenTypes[$type] = $id;
    }
}
check(array_keys($seenTypes) === [
    'local_stt.worker_offline', 'local_stt.worker_online', 'local_stt.backlog_no_workers', 'local_stt.backlog_resolved',
    'cloud_stt.incident', 'cloud_stt.incident_resolved', 'cloud_stt.paused', 'cloud_stt.resumed',
    'cloud_ai.paused', 'cloud_ai.resumed', 'ai_supervisor.worker_offline', 'ai_supervisor.worker_online',
], 'split: the event types of the old sources are all still produced (rules keep matching)');
foreach ([
    'local_stt.workers' => ['worker_offline'],
    'local_stt.backlog' => ['backlog_no_workers'],
    'cloud_stt.incidents' => ['incident_open'],
    'cloud_stt.paused' => ['processing_paused'],
    'cloud_ai.paused' => ['processing_paused'],
    'ai_supervisor.workers' => ['worker_offline'],
] as $id => $codes) {
    $profile = ModuleStatusSource::profileFor($id);
    check($profile !== null && array_map(static fn ($r) => $r->code, $profile->rules) === $codes, "split: $id handles only " . implode(',', $codes));
}

$localPaths = statusSource(ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS)->apiReadPaths();
check($localPaths === ['/api/v3/module-local-speech-to-text/status'], 'local STT: only /status in the key');
check(statusSource(ModuleStatusSource::SOURCE_CLOUD_AI_PAUSED)->apiReadPaths() === ['/api/v3/module-cloud-ai-supervisor/status'], 'cloud AI: only /status in the key');
check(statusSource(ModuleStatusSource::SOURCE_AI_SUPERVISOR)->apiReadPaths() === ['/api/v3/module-ai-supervisor/status'], 'AI Supervisor: only /status in the key');

$available = static fn (string $module): string => SourceAvailability::AVAILABLE;
$allPaths = ApiKeyPaths::compute(SourceRegistry::default()->pollSources(), static fn (string $id): bool => true, $available);
check($allPaths === [
    '/api/v3/advice',
    '/api/v3/module-ai-supervisor/calls',
    '/api/v3/module-ai-supervisor/status',
    '/api/v3/module-cloud-ai-supervisor/status',
    '/api/v3/module-cloud-speech-to-text/status',
    '/api/v3/module-local-speech-to-text/status',
    '/api/v3/module-voice-agent/callbacks',
    '/api/v3/module-voice-agent/runtime',
], 'key: exact path set, no /workers');
check(!in_array('/api/v3/module-ai-supervisor/workers', $allPaths, true), 'key: /workers is gone');

// two sources of one module poll the same /status and each keeps to its own codes
$localBoth = [
    statusSource(ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS),
    statusSource(ModuleStatusSource::SOURCE_LOCAL_STT_BACKLOG),
];
$cloudBoth = [
    statusSource(ModuleStatusSource::SOURCE_CLOUD_STT_INCIDENTS),
    statusSource(ModuleStatusSource::SOURCE_CLOUD_STT_PAUSED),
];

// ======================= local STT: baseline, diff, debounce =======================
$h = hubTestDatabase();
$states = new SourceStateRepository($h);
$events = new EventStore($h);
$statusPath = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS)?->statusPath();

$report = statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-down')]), $states, $events, $now);
check(($report[ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS]['status'] ?? '') === SourceAvailability::AVAILABLE, 'local STT: pass ok');
check(statusRows($h) === [], 'local STT: existing issues are a silent baseline');
$cursor = $states->get(ModuleStatusSource::SOURCE_LOCAL_STT_BACKLOG)['cursor'];
check(count($cursor['issues'] ?? []) === 1, 'local STT: the backlog source records only its own pair as known');
check(count($states->get(ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS)['cursor']['issues'] ?? []) === 1, 'local STT: the workers source records only its own pair as known');
check(($cursor['issues']['backlog_no_workers|queue']['pending'] ?? true) === false, 'local STT: baseline pair is not pending');

$now += 60;
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-down')]), $states, $events, $now);
check(statusRows($h) === [], 'local STT: repeated poll does not duplicate');

// baseline-known pairs that disappear produce no recovery (they were never announced)
$now += 60;
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-worker-offline')]), $states, $events, $now);
check(statusRows($h) === [], 'local STT: a baseline-known pair disappearing is silent (no recovery without an announcement)');
$now += 60;
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-ok')]), $states, $events, $now);
check(statusRows($h) === [], 'local STT: all baseline pairs gone, still silent');

// a backlog appears (debounce 0), is announced, then resolves: the recovery follows the announcement
$now += 60;
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-down')]), $states, $events, $now);
check(array_column(statusRows($h), 'event_type') === ['local_stt.backlog_no_workers'], 'local STT: backlog announced after the baseline');
$now += 60;
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-worker-offline')]), $states, $events, $now);
$row = statusRows($h)[1] ?? [];
check(($row['event_type'] ?? '') === 'local_stt.backlog_resolved', 'local STT: a disappearing announced pair emits the recovery type');
check(($row['severity'] ?? '') === HubEvent::SEVERITY_INFO, 'local STT: recovery is info');
check(($row['dedupe_key'] ?? '') === 'local_stt.backlog:backlog_no_workers:queue:1795153998:recovered', 'local STT: recovery key is stable');
check(($row['payload']['subject']['module_status']['counters']['workers_total'] ?? 0) === 3, 'local STT: recovery carries the counters snapshot');

// debounce: a worker must be observed for 120 s before the event
$h2 = hubTestDatabase();
$states2 = new SourceStateRepository($h2);
$events2 = new EventStore($h2);
$t0 = 1795200000;
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-ok')]), $states2, $events2, $t0);
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-worker-offline')]), $states2, $events2, $t0 + 60);
check(statusRows($h2) === [], 'debounce: first sighting is not announced');
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-worker-offline')]), $states2, $events2, $t0 + 120);
check(statusRows($h2) === [], 'debounce: 60 s of presence is not enough for worker_offline');
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-worker-offline')]), $states2, $events2, $t0 + 180);
$row = onlyEvent(statusRows($h2));
check(($row['event_type'] ?? '') === 'local_stt.worker_offline', 'debounce: event after 120 s');
check(($row['dedupe_key'] ?? '') === 'local_stt.workers:worker_offline:2df52bb5d7d9:1793262107', 'local STT: dedupe <source>:<code>:<ref>:<since>');
check(($row['severity'] ?? '') === HubEvent::SEVERITY_WARNING, 'local STT: worker_offline is warning');
check(($row['payload']['subject']['module_status']['code'] ?? '') === 'worker_offline', 'payload carries the code instead of free text');
check(($row['payload']['subject']['module_status']['counters']['workers_online'] ?? -1) === 2, 'payload carries counters');
check(($row['occurred_at'] ?? 0) === $t0 + 180, 'occurred_at is the observation time');

// a restarted collector with the same stored state does not duplicate
$restart = new Collector(
    $localBoth,
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
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-ok')]), $states3, $events3, $t0);
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-down')]), $states3, $events3, $t0 + 60);
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
statusPass($localBoth, new StatusPathReader([$statusPath => $odd]), $states4, $events4, $t0);
check(statusRows($h4) === [], 'unknown code: no event and no guessed text');
check(($states4->get(ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS)['cursor']['issues'] ?? []) === [], 'unknown code: not tracked');
$malformed = new StatusPathReader([$statusPath => ['state' => 'degraded']]);
$report = statusPass($localBoth, $malformed, $states4, $events4, $t0 + 60);
check(($report[ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS]['status'] ?? '') === SourceAvailability::ERROR, 'malformed answer is an error');
check(statusRows($h4) === [], 'malformed answer never looks like a recovery');

// ======================= 404 on /status: api_incompatible =======================
$h5 = hubTestDatabase();
$states5 = new SourceStateRepository($h5);
$events5 = new EventStore($h5);
$report = statusPass($localBoth, new StatusPathReader([]), $states5, $events5, $t0);
check(($report[ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS]['status'] ?? '') === SourceAvailability::API_INCOMPATIBLE, '404: api_incompatible, not a log error');
check(statusRows($h5) === [], '404: no events');
check($states5->get(ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS)['cursor'] === [], '404: cursor is dropped for a fresh baseline');
check($states5->get(ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS)['last_error_code'] === 'api_incompatible', '404: stable error code stored');
check(SourceAvailability::fromErrorCode('api_incompatible') === SourceAvailability::API_INCOMPATIBLE, '404: availability mapping');

// after the module update the first successful poll is a silent baseline
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-down')]), $states5, $events5, $t0 + 60);
check(statusRows($h5) === [], '404: after the update issues are recorded, not broadcast');

// ======================= cloud STT: incident and pause =======================
$hc = hubTestDatabase();
$cs = new SourceStateRepository($hc);
$ce = new EventStore($hc);
$cloudSttPath = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_CLOUD_STT_PAUSED)?->statusPath();
$t = 1795300000;
statusPass($cloudBoth, new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-ok')]), $cs, $ce, $t);
statusPass($cloudBoth, new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-incident')]), $cs, $ce, $t + 60);
$row = onlyEvent(statusRows($hc));
check(($row['event_type'] ?? '') === 'cloud_stt.incident', 'cloud STT: incident event');
check(($row['severity'] ?? '') === HubEvent::SEVERITY_WARNING, 'cloud STT: severity comes from the incident');
check(($row['dedupe_key'] ?? '') === 'cloud_stt.incidents:incident_open:inc_5f31c2a9:1793000000', 'cloud STT: one key per incident ref');

// acknowledging an incident keeps it open with the same ref/since: no second alert
statusPass($cloudBoth, new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-incident')]), $cs, $ce, $t + 120);
check(count(statusRows($hc)) === 1, 'cloud STT: acknowledged incident does not re-alert');
$acknowledged = statusFixture('cloud-stt-incident');
$acknowledged['issues'][0]['severity'] = 'info';
statusPass($cloudBoth, new StatusPathReader([$cloudSttPath => $acknowledged]), $cs, $ce, $t + 180);
check(count(statusRows($hc)) === 1, 'cloud STT: severity change of the same incident is not a new event');

// the incident resolves
statusPass($cloudBoth, new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-ok')]), $cs, $ce, $t + 240);
$row = statusRows($hc)[1];
check(($row['event_type'] ?? '') === 'cloud_stt.incident_resolved', 'cloud STT: incident recovery');
check(($row['severity'] ?? '') === HubEvent::SEVERITY_INFO, 'cloud STT: incident recovery is info');
check(($row['dedupe_key'] ?? '') === 'cloud_stt.incidents:incident_open:inc_5f31c2a9:1793000000:recovered', 'cloud STT: recovery key');

// a new incident with the same public id but a new since is a new episode
$newEpisode = statusFixture('cloud-stt-incident');
$newEpisode['issues'][0]['since'] = 1793050000;
statusPass($cloudBoth, new StatusPathReader([$cloudSttPath => $newEpisode]), $cs, $ce, $t + 300);
check(count(statusRows($hc)) === 3, 'cloud STT: a new episode of the same ref alerts');

// pause and resume
$hp = hubTestDatabase();
$ps = new SourceStateRepository($hp);
$pe = new EventStore($hp);
$t = 1795400000;
statusPass($cloudBoth, new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-ok')]), $ps, $pe, $t);
statusPass($cloudBoth, new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-paused')]), $ps, $pe, $t + 60);
$row = onlyEvent(statusRows($hp));
check(($row['event_type'] ?? '') === 'cloud_stt.paused' && ($row['severity'] ?? '') === HubEvent::SEVERITY_WARNING, 'cloud STT: paused is warning');
check(str_ends_with((string)($row['dedupe_key'] ?? ''), ':1793100000'), 'cloud STT: pause key uses the issue since');
statusPass($cloudBoth, new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-ok')]), $ps, $pe, $t + 120);
check((statusRows($hp)[1]['event_type'] ?? '') === 'cloud_stt.resumed', 'cloud STT: resume event');
check((statusRows($hp)[1]['severity'] ?? '') === HubEvent::SEVERITY_INFO, 'cloud STT: resume is info');

// ======================= cloud AI: silent not_configured, reason severities =======================
$ha = hubTestDatabase();
$as = new SourceStateRepository($ha);
$ae = new EventStore($ha);
$cloudAi = statusSource(ModuleStatusSource::SOURCE_CLOUD_AI_PAUSED);
$cloudAiPath = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_CLOUD_AI_PAUSED)?->statusPath();
$t = 1795500000;
statusPass([$cloudAi], new StatusPathReader([$cloudAiPath => statusFixture('cloud-ai-not-configured')]), $as, $ae, $t);
check(statusRows($ha) === [], 'cloud AI: not_configured produces nothing (baseline)');
check(($as->get(ModuleStatusSource::SOURCE_CLOUD_AI_PAUSED)['cursor']['issues'] ?? []) === [], 'cloud AI: not_configured is not tracked at all');

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
statusPass([$cloudAi], new StatusPathReader([$cloudAiPath => statusFixture('cloud-ai-not-configured')]), $bs, $be, $t);
statusPass([$cloudAi], new StatusPathReader([$cloudAiPath => statusFixture('cloud-ai-source-unavailable')]), $bs, $be, $t + 60);
statusPass([$cloudAi], new StatusPathReader([$cloudAiPath => statusFixture('cloud-ai-billing')]), $bs, $be, $t + 120);
$stored = statusRows($hb);
check(count($stored) === 3, 'cloud AI: source_unavailable pause, then one resume and one billing pause');
$byType = array_column(array_slice($stored, 1), null, 'event_type');
check(isset($byType['cloud_ai.resumed']) && isset($byType['cloud_ai.paused']), 'cloud AI: resume and pause both emitted');
check(($byType['cloud_ai.paused']['severity'] ?? '') === HubEvent::SEVERITY_CRITICAL, 'cloud AI: insufficient funds is critical');
check(str_contains((string)($byType['cloud_ai.paused']['dedupe_key'] ?? ''), ':insufficient_funds:'), 'cloud AI: billing key uses the reason ref');

// ======================= AI Supervisor: /status only =======================
$hi = hubTestDatabase();
$is = new SourceStateRepository($hi);
$ie = new EventStore($hi);
$aiSource = statusSource(ModuleStatusSource::SOURCE_AI_SUPERVISOR);
$aiProfile = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_AI_SUPERVISOR);
$aiStatusPath = $aiProfile?->statusPath();
$t = 1795600000;
$statusSame = statusFixture('ai-supervisor-status');
$aiRef = (string)$statusSame['issues'][0]['ref'];
$aiSince = (int)$statusSame['issues'][0]['since'];

// an older module (no /status) is api_incompatible with the version to update to, never a /workers read
$workersCalls = 0;
$oldModule = new StatusPathReader([
    '/pbxcore/api/v3/module-ai-supervisor/workers' => static function () use (&$workersCalls): array {
        $workersCalls++;

        return ['items' => []];
    },
]);
$report = statusPass([$aiSource], $oldModule, $is, $ie, $t);
check(($report[ModuleStatusSource::SOURCE_AI_SUPERVISOR]['status'] ?? '') === SourceAvailability::API_INCOMPATIBLE, 'AI Supervisor: 404 on /status is api_incompatible');
check($workersCalls === 0, 'AI Supervisor: /workers is never read');
check(statusRows($hi) === [] && $is->get(ModuleStatusSource::SOURCE_AI_SUPERVISOR)['cursor'] === [], 'AI Supervisor: 404 means no events and a fresh baseline later');
try {
    $aiSource->poll(new SourceContext($oldModule, static fn (): int => $t), []);
    check(false, 'AI Supervisor: poll throws api_incompatible');
} catch (SourceException $exception) {
    check($exception->errorCode === 'api_incompatible' && $exception->getMessage() === '1.186.6', 'AI Supervisor: api_incompatible carries update_to 1.186.6');
}
check(($catalog::minVersion(ModuleStatusSource::SOURCE_AI_SUPERVISOR)) === '1.186.6', 'AI Supervisor: update hint version');

// after the update: silent baseline, then debounce and the same dedupe key as before the switch
$aiRoutes = [$aiStatusPath => $statusSame];
statusPass([$aiSource], new StatusPathReader($aiRoutes), $is, $ie, $t + 60);
check(statusRows($hi) === [], 'AI Supervisor: an offline worker at baseline is not announced');

// a cursor written by the /workers fallback of the previous version stays valid: no re-alert
$hk = hubTestDatabase();
$ks = new SourceStateRepository($hk);
$ke = new EventStore($hk);
$ks->saveCursor(ModuleStatusSource::SOURCE_AI_SUPERVISOR, [
    'issues' => ['worker_offline|' . $aiRef => [
        'code' => 'worker_offline', 'ref' => $aiRef, 'severity' => 'warning', 'since' => $aiSince,
        'first_seen' => $t, 'last_seen' => $t, 'pending' => false, 'announced' => true,
        'episode_since' => $aiSince, 'episode_tag' => '',
    ]],
    'closed' => [], 'state' => 'degraded', 'counters' => [],
    'reader' => 'workers', 'reader_checked_at' => $t,
]);
statusPass([$aiSource], new StatusPathReader($aiRoutes), $ks, $ke, $t + 60);
check(statusRows($hk) === [], 'AI Supervisor: an announced worker is not re-alerted after the switch to /status-only');
$healthy = $statusSame;
$healthy['state'] = 'ok';
$healthy['issues'] = [];
statusPass([$aiSource], new StatusPathReader([$aiStatusPath => $healthy]), $ks, $ke, $t + 120);
$stored = statusRows($hk);
check(count($stored) === 1 && ($stored[0]['event_type'] ?? '') === 'ai_supervisor.worker_online', 'AI Supervisor: the announced worker recovers with the old event type');
check(($stored[0]['dedupe_key'] ?? '') === 'ai_supervisor.workers:worker_offline:' . $aiRef . ':' . $aiSince . ':recovered', 'AI Supervisor: the dedupe key is unchanged');
check(!array_key_exists('reader', $ks->get(ModuleStatusSource::SOURCE_AI_SUPERVISOR)['cursor']), 'AI Supervisor: the reader marker leaves the cursor');

// debounce: offline for 120 s before the event, key <source>:<code>:<ref>:<since>
$hn = hubTestDatabase();
$ns = new SourceStateRepository($hn);
$ne = new EventStore($hn);
statusPass([$aiSource], new StatusPathReader([$aiStatusPath => $healthy]), $ns, $ne, $t);
statusPass([$aiSource], new StatusPathReader($aiRoutes), $ns, $ne, $t + 60);
statusPass([$aiSource], new StatusPathReader($aiRoutes), $ns, $ne, $t + 120);
check(statusRows($hn) === [], 'AI Supervisor: debounce holds the first observations');
statusPass([$aiSource], new StatusPathReader($aiRoutes), $ns, $ne, $t + 180);
$stored = statusRows($hn);
check(count($stored) === 1 && ($stored[0]['dedupe_key'] ?? '') === 'ai_supervisor.workers:worker_offline:' . $aiRef . ':' . $aiSince, 'AI Supervisor: announced once with the stable key');

// ======================= split migration: legacy per-module sources =======================
$legacyStatus = ['local_stt.status', 'cloud_stt.status', 'cloud_ai.status'];
$hm = hubTestDatabase();
$ms = new SourceStateRepository($hm);
$me = new EventStore($hm);
$tm = 1796000000;
foreach ($legacyStatus as $legacyId) {
    $ms->get($legacyId); // rows exist
}
$ms->setEnabled('local_stt.status', false, $tm);
$ms->saveCursor('cloud_stt.status', ['issues' => ['incident_open|inc_5f31c2a9' => [
    'code' => 'incident_open', 'ref' => 'inc_5f31c2a9', 'severity' => 'warning', 'since' => 1793000000,
    'first_seen' => $tm - 600, 'last_seen' => $tm - 60, 'pending' => false, 'announced' => true,
    'episode_since' => 1793000000, 'episode_tag' => '',
]], 'closed' => [], 'state' => 'degraded', 'counters' => ['incidents_open' => 1]]);
$ms->get('cloud_stt.paused'); // the interface lazily created a new row before the migration ran
$hm->execute("INSERT INTO m_MessengerHubSettings (key, value) VALUES ('status_capability.ai_supervisor.workers', '{}')");
$ms->migrateLegacyIds();
foreach ($legacyStatus as $legacyId) {
    check($hm->fetchOne('SELECT 1 AS x FROM ' . SourceStateRepository::TABLE . ' WHERE source_id = :id', ['id' => $legacyId]) === null, "migration: legacy row $legacyId is gone");
}
check($ms->get('local_stt.workers')['enabled'] === false && $ms->get('local_stt.backlog')['enabled'] === false, 'migration: a disabled legacy source disables both new sources of the module');
check($ms->get('cloud_stt.incidents')['enabled'] === true && $ms->get('cloud_stt.paused')['enabled'] === true && $ms->get('cloud_ai.paused')['enabled'] === true, 'migration: enabled legacy sources stay enabled');
check($ms->get('cloud_stt.incidents')['cursor'] === [] && $ms->get('cloud_stt.paused')['cursor'] === [], 'migration: old cursors are dropped');
check($hm->fetchOne("SELECT 1 AS x FROM m_MessengerHubSettings WHERE key LIKE 'status_capability.%'") === null, 'migration: the /status capability cache is removed');
check($ms->get('ai_supervisor.workers')['enabled'] === true, 'migration: ai_supervisor.workers is untouched');
$before = $hm->fetchAll('SELECT source_id, enabled, cursor_json FROM ' . SourceStateRepository::TABLE . ' ORDER BY source_id');
$ms->migrateLegacyIds();
check($hm->fetchAll('SELECT source_id, enabled, cursor_json FROM ' . SourceStateRepository::TABLE . ' ORDER BY source_id') === $before, 'migration: running it again changes nothing');

// the new sources baseline silently: the incident announced under the old id is not announced again
$cloudIncidentPath = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_CLOUD_STT_INCIDENTS)?->statusPath();
statusPass($cloudBoth, new StatusPathReader([$cloudIncidentPath => statusFixture('cloud-stt-incident')]), $ms, $me, $tm + 60);
check(statusRows($hm) === [], 'migration: an incident already announced under the old id is a silent baseline (no re-alert)');
check(isset($ms->get('cloud_stt.incidents')['cursor']['issues']['incident_open|inc_5f31c2a9']), 'migration: the incident is tracked by the new source');
statusPass($cloudBoth, new StatusPathReader([$cloudIncidentPath => statusFixture('cloud-stt-incident')]), $ms, $me, $tm + 120);
check(statusRows($hm) === [], 'migration: and stays silent on the next poll');
// a disabled new source is not polled
$disabledReport = statusPass([statusSource(ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS)], new StatusPathReader([]), $ms, $me, $tm);
check(($disabledReport[ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS]['status'] ?? '') === SourceAvailability::DISABLED, 'migration: the disabled flag is honoured by the collector');

// existing rules store event types: they keep matching the events of the new sources
$legacyRule = \Modules\ModuleMessengerHub\Lib\Routing\Rule::fromRow([
    'id' => 1, 'enabled' => '1', 'title' => 'legacy', 'min_severity' => 'info', 'target_mode' => 'recipients',
    'event_types' => json_encode(['local_stt.worker_offline', 'local_stt.worker_online', 'local_stt.backlog_no_workers', 'local_stt.backlog_resolved']),
]);
$ht = hubTestDatabase();
statusPass($localBoth, new StatusPathReader([$statusPath = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS)?->statusPath() => statusFixture('local-stt-ok')]), new SourceStateRepository($ht), new EventStore($ht), $tm);
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-down')]), new SourceStateRepository($ht), new EventStore($ht), $tm + 60);
$legacyMatched = array_values(array_filter(statusRows($ht), static fn (array $row): bool => $legacyRule->matches(new HubEvent(
    (string)$row['source_id'], (string)$row['event_type'], (string)$row['severity'], (string)$row['dedupe_key'], (int)$row['occurred_at'], $row['payload']
))));
check(count($legacyMatched) === 1 && $legacyMatched[0]['source_id'] === 'local_stt.backlog', 'migration: a legacy rule with the four event types matches the new sources');

// the same pair is never produced by two sources: the workers source ignores the backlog
$hs = hubTestDatabase();
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-ok')]), new SourceStateRepository($hs), new EventStore($hs), $tm);
statusPass([$localBoth[0]], new StatusPathReader([$statusPath => statusFixture('local-stt-down')]), new SourceStateRepository($hs), new EventStore($hs), $tm + 60);
check(statusRows($hs) === [], 'split: the workers source (debounce) alone never announces the backlog');

// ======================= episodes: moving `since`, returning pairs, restarts, announced recovery =======================
$he = hubTestDatabase();
$es = new SourceStateRepository($he);
$ee = new EventStore($he);
$cloudBothE = [statusSource(ModuleStatusSource::SOURCE_CLOUD_STT_INCIDENTS), statusSource(ModuleStatusSource::SOURCE_CLOUD_STT_PAUSED)];
$te = 1795700000;
$pauseAt = static function (int $since): array {
    $data = statusFixture('cloud-stt-ok');
    $data['state'] = 'paused';
    $data['issues'] = [['code' => 'processing_paused', 'ref' => 'maintenance', 'severity' => 'warning', 'since' => $since]];

    return $data;
};
statusPass($cloudBothE, new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-ok')]), $es, $ee, $te);
statusPass($cloudBothE, new StatusPathReader([$cloudSttPath => $pauseAt(1793100000)]), $es, $ee, $te + 60);
check(count(statusRows($he)) === 1, 'episode: the pause is announced');
$firstKey = (string)(statusRows($he)[0]['dedupe_key'] ?? '');
check($firstKey === 'cloud_stt.paused:processing_paused:maintenance:1793100000', 'episode: key uses the since of the first observation');

// the module moves `since` during one continuous pause: same incident, no event
statusPass($cloudBothE, new StatusPathReader([$cloudSttPath => $pauseAt(1793100500)]), $es, $ee, $te + 120);
statusPass($cloudBothE, new StatusPathReader([$cloudSttPath => $pauseAt(1793101000)]), $es, $ee, $te + 180);
check(count(statusRows($he)) === 1, 'episode: a moving since of a continuous issue does not alert again');
$entry = $es->get(ModuleStatusSource::SOURCE_CLOUD_STT_PAUSED)['cursor']['issues']['processing_paused|maintenance'] ?? [];
check(($entry['since'] ?? 0) === 1793101000 && ($entry['episode_since'] ?? 0) === 1793100000, 'episode: since refreshed, episode identity kept');

// a restart (cursor reload through a new repository) mid-episode keeps the key and does not duplicate
$restartStates = new SourceStateRepository($he);
statusPass($cloudBothE, new StatusPathReader([$cloudSttPath => $pauseAt(1793101500)]), $restartStates, new EventStore($he), $te + 240);
check(count(statusRows($he)) === 1, 'episode: a restart mid-episode does not duplicate');

// it resolves with the key of the episode start
statusPass($cloudBothE, new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-ok')]), $es, $ee, $te + 300);
check(($rows = statusRows($he)) && count($rows) === 2 && ($rows[1]['dedupe_key'] ?? '') === $firstKey . ':recovered', 'episode: recovery uses the episode key');

// the pair returns with the SAME module since: a new episode, not swallowed by the dedupe table
statusPass($cloudBothE, new StatusPathReader([$cloudSttPath => $pauseAt(1793100000)]), $es, $ee, $te + 360);
$rows = statusRows($he);
check(count($rows) === 3 && ($rows[2]['event_type'] ?? '') === 'cloud_stt.paused', 'episode: a returning pair with the same since is a new event');
check(($rows[2]['dedupe_key'] ?? '') === $firstKey . ':' . ($te + 360), 'episode: the repeated episode key carries the first-seen time');
statusPass($cloudBothE, new StatusPathReader([$cloudSttPath => $pauseAt(1793100000)]), $es, $ee, $te + 420);
check(count(statusRows($he)) === 3, 'episode: the repeated episode is announced once');
statusPass($cloudBothE, new StatusPathReader([$cloudSttPath => statusFixture('cloud-stt-ok')]), $es, $ee, $te + 480);
check(count(statusRows($he)) === 4, 'episode: and recovers once');

// a pair that never passed debounce produces no recovery
$hd = hubTestDatabase();
$ds = new SourceStateRepository($hd);
$de = new EventStore($hd);
$td = 1795800000;
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-ok')]), $ds, $de, $td);
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-worker-offline')]), $ds, $de, $td + 60);
statusPass($localBoth, new StatusPathReader([$statusPath => statusFixture('local-stt-ok')]), $ds, $de, $td + 90);
check(statusRows($hd) === [], 'announced: a blink shorter than the debounce has neither event nor recovery');
$cursorD = $ds->get(ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS)['cursor'];
check(($cursorD['closed'] ?? []) === [], 'announced: no tombstone for a never-announced pair');

// cursors written before the flag existed count as not announced: no recovery, no crash
$legacyEpisode = [
    'issues' => ['backlog_no_workers|queue' => [
        'code' => 'backlog_no_workers', 'ref' => 'queue', 'severity' => 'critical', 'since' => 1795153998,
        'first_seen' => $td, 'last_seen' => $td, 'pending' => false,
    ]],
    'state' => 'down',
    'counters' => [],
];
$profileLocal = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_LOCAL_STT_BACKLOG);
$migrated = $profileLocal === null ? null : ModuleStatusSource::buildBatch(
    $profileLocal,
    ModuleStatusSource::snapshot(statusFixture('local-stt-ok')),
    $legacyEpisode,
    $td + 60
);
check($migrated !== null && $migrated->events === [], 'migration: a flagless cursor entry disappears silently');
$stillThere = $profileLocal === null ? null : ModuleStatusSource::buildBatch(
    $profileLocal,
    ModuleStatusSource::snapshot(statusFixture('local-stt-down')),
    $legacyEpisode,
    $td + 60
);
check(
    $stillThere !== null && $stillThere->events === []
    && ($stillThere->cursor['issues']['backlog_no_workers|queue']['announced'] ?? null) === false
    && ($stillThere->cursor['issues']['backlog_no_workers|queue']['episode_since'] ?? 0) === 1795153998,
    'migration: a flagless entry keeps working and is normalised'
);

// ======================= templates =======================
$texts = hubTestTexts();
$context = new RenderContext($texts, new LinkBuilder('https://pbx.example'));
$templates = new TemplateRegistry();
$billingSnapshot = ModuleStatusSource::snapshot(statusFixture('cloud-ai-billing'));
// a cursor with an empty known set (but not a first run) plus debounce 0 yields the onset at once
$profileAi = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_CLOUD_AI_PAUSED);
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
    sourceId: ModuleStatusSource::SOURCE_CLOUD_AI_PAUSED,
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
    sourceId: ModuleStatusSource::SOURCE_CLOUD_STT_PAUSED,
    eventType: 'cloud_stt.resumed',
    severity: HubEvent::SEVERITY_INFO,
    dedupeKey: 'cloud_stt.paused:processing_paused:user:1793100000:recovered',
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
