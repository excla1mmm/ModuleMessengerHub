<?php

declare(strict_types=1);

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Api\PagedRestReader;
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

/**
 * Id of the module row whose ref (first 12 hex of sha256("<Module>:<id>")) is $ref. The fixtures carry
 * real refs; the native answers of the modules need the ids behind them.
 */
function idForRef(string $module, string $ref): int
{
    for ($id = 1; $id <= 2000; $id++) {
        if (substr(hash('sha256', $module . ':' . $id), 0, 12) === $ref) {
            return $id;
        }
    }
    fwrite(STDERR, "no id for ref $ref\n");
    exit(1);
}

/**
 * The module's NATIVE answers (what the hub reads since the decision of 2026-11-23) derived from a status
 * snapshot fixture, so the transition scenarios run against the real readers:
 *  - 'native:local-stt': GET /workers rows (offline rows with last_seen = issue since, online rows fresh)
 *    and GET /jobs (pending jobs, oldest created_at = the backlog since);
 *  - 'native:ai-supervisor': GET /workers {items};
 *  - 'native:cloud-ai': GET /runtime {pause, summary}.
 * The clock is $GLOBALS['statusClock'] (statusPass sets it), so "online" rows are always fresh.
 *
 * @return array<string, array<mixed>|callable>
 */
function nativeRoutes(string $kind, array $snapshot): array
{
    $clock = static fn (): int => (int)$GLOBALS['statusClock'];
    $issues = $snapshot['issues'] ?? null;
    if ($kind === 'native:cloud-ai') {
        $route = '/pbxcore/api/v3/module-cloud-ai-supervisor/runtime';
        if (!is_array($issues)) {
            return [$route => $snapshot];
        }
        $pause = ['paused' => false, 'pause_reason' => '', 'paused_at' => 0, 'resume_check_at' => 0];
        foreach ($issues as $issue) {
            $pause = ['paused' => true, 'pause_reason' => $issue['ref'], 'paused_at' => $issue['since'], 'resume_check_at' => 0];
        }
        $answer = [
            'analysis_enabled' => true,
            'setup_state' => 'configured',
            'pause' => $pause,
            'balance' => ['amount' => '12.50', 'currency' => 'RUB'],
            'summary' => isset($snapshot['counters']['jobs_waiting']) ? ['analysis_pending' => $snapshot['counters']['jobs_waiting']] : [],
        ];

        return [$route => $answer];
    }

    $module = $kind === 'native:local-stt' ? 'ModuleLocalSpeechToText' : 'ModuleAISupervisor';
    $workersRoute = $kind === 'native:local-stt'
        ? '/pbxcore/api/v3/module-local-speech-to-text/workers'
        : '/pbxcore/api/v3/module-ai-supervisor/workers';
    if (!is_array($issues)) {
        return [$workersRoute => $snapshot];
    }
    $rows = static function () use ($issues, $snapshot, $module, $clock): array {
        $rows = [];
        foreach ($issues as $issue) {
            if (($issue['code'] ?? '') !== 'worker_offline') {
                continue;
            }
            $rows[] = [
                'id' => idForRef($module, (string)$issue['ref']),
                'worker_uid' => 'host-' . $issue['ref'],
                'name' => 'Private name',
                'ip' => '10.0.0.7',
                'status' => 'offline',
                'last_seen' => $issue['since'],
                'created_at' => 1700000000,
            ];
        }
        for ($i = 0; $i < (int)($snapshot['counters']['workers_online'] ?? 0); $i++) {
            $rows[] = ['id' => 1000 + $i, 'name' => 'Private name', 'ip' => '10.0.0.8', 'status' => 'online', 'last_seen' => $clock() - 30, 'created_at' => 1700000000];
        }

        return $rows;
    };
    if ($kind === 'native:ai-supervisor') {
        return [$workersRoute => static fn (): array => ['items' => $rows()]];
    }
    $backlogSince = 0;
    foreach ($issues as $issue) {
        if (($issue['code'] ?? '') === 'backlog_no_workers') {
            $backlogSince = (int)$issue['since'];
        }
    }

    return [
        $workersRoute => static fn (string $path, array $query): array => ((int)($query['offset'] ?? 0)) > 0 ? [] : $rows(),
        '/pbxcore/api/v3/module-local-speech-to-text/jobs' => static function (string $path, array $query) use ($snapshot, $backlogSince): array {
            $total = (int)($snapshot['counters']['jobs_waiting'] ?? 0);
            if ($total <= 0) {
                return [];
            }
            // ordered by id descending: the last row is the oldest pending job
            $oldest = (int)($query['offset'] ?? 0) >= $total - 1;

            return [['id' => $oldest ? 7 : 90, 'call_id' => 'secret-call', 'status' => 'pending', 'created_at' => $oldest ? $backlogSince : $backlogSince + 1000]];
        },
    ];
}

/** RestReader over a path map; a missing route is api_not_found, a callable route may throw. */
final class StatusPathReader implements PagedRestReader
{
    /** @var array<string, array<mixed>|callable> */
    private array $routes = [];

    /** @var array<string, callable> path => total_items for getPage */
    private array $totals = [];

    public int $calls = 0;

    /** @var list<string> */
    public array $log = [];

    /** @param array<string, array<mixed>|callable> $routes key `native:*` expands a status snapshot fixture */
    public function __construct(array $routes)
    {
        foreach ($routes as $path => $route) {
            if (str_starts_with((string)$path, 'native:') && is_array($route)) {
                $this->routes += nativeRoutes((string)$path, $route);
                if ($path === 'native:local-stt') {
                    $total = (int)($route['counters']['jobs_waiting'] ?? 0);
                    $this->totals['/pbxcore/api/v3/module-local-speech-to-text/jobs'] = static fn (): int => $total;
                }
                continue;
            }
            $this->routes[$path] = $route;
        }
    }

    public function get(string $path, array $query = []): array
    {
        $this->calls++;
        $this->log[] = $path . ($query === [] ? '' : '?' . http_build_query($query));
        $route = $this->routes[$path] ?? null;
        if ($route === null) {
            throw new SourceException('api_not_found');
        }
        if (is_callable($route)) {
            return $route($path, $query);
        }

        return $route;
    }

    public function getPage(string $path, array $query = []): array
    {
        $data = $this->get($path, $query);
        $total = isset($this->totals[$path]) ? ($this->totals[$path])() : count($data);

        return ['data' => $data, 'pagination' => ['total_items' => $total, 'limit' => (int)($query['limit'] ?? 50), 'offset' => (int)($query['offset'] ?? 0)]];
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
    $GLOBALS['statusClock'] = $now;
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
check(count($registry->all()) === 17, 'registry: seventeen sources after the per-problem split');
foreach (['local_stt.status', 'cloud_stt.status', 'cloud_ai.status'] as $retired) {
    check($registry->find($retired) === null, "registry: $retired is retired");
}
$catalog = \Modules\ModuleMessengerHub\Lib\Sources\SourceCatalog::class;
check($catalog::minVersion(ModuleStatusSource::SOURCE_CLOUD_STT_INCIDENTS) === '1.120', 'catalog: Cloud STT incidents minimal /status version');
check($catalog::minVersion(ModuleStatusSource::SOURCE_CLOUD_STT_PAUSED) === '1.120', 'catalog: Cloud STT paused minimal /status version');
foreach ([
    ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS,
    ModuleStatusSource::SOURCE_LOCAL_STT_BACKLOG,
    ModuleStatusSource::SOURCE_CLOUD_AI_PAUSED,
    ModuleStatusSource::SOURCE_AI_SUPERVISOR,
] as $id) {
    check($catalog::minVersion($id) === '', "catalog: $id reads an existing resource, no minimal version");
}
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

// which resource each source reads (decision of 2026-11-23): /status only for Cloud STT
check(statusSource(ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS)->apiReadPaths() === ['/api/v3/module-local-speech-to-text/workers'], 'local STT workers: /workers only');
check(statusSource(ModuleStatusSource::SOURCE_LOCAL_STT_BACKLOG)->apiReadPaths() === ['/api/v3/module-local-speech-to-text/workers', '/api/v3/module-local-speech-to-text/jobs'], 'local STT backlog: /workers and /jobs');
check(statusSource(ModuleStatusSource::SOURCE_CLOUD_AI_PAUSED)->apiReadPaths() === ['/api/v3/module-cloud-ai-supervisor/runtime'], 'cloud AI: /runtime');
check(statusSource(ModuleStatusSource::SOURCE_AI_SUPERVISOR)->apiReadPaths() === ['/api/v3/module-ai-supervisor/workers'], 'AI Supervisor: /workers');
check(statusSource(ModuleStatusSource::SOURCE_CLOUD_STT_INCIDENTS)->apiReadPaths() === ['/api/v3/module-cloud-speech-to-text/status'], 'cloud STT incidents: /status');
check(statusSource(ModuleStatusSource::SOURCE_CLOUD_STT_PAUSED)->apiReadPaths() === ['/api/v3/module-cloud-speech-to-text/status'], 'cloud STT paused: /status');
foreach (['module-ai-supervisor', 'module-local-speech-to-text', 'module-cloud-ai-supervisor'] as $slug) {
    foreach ($statusIds as $id) {
        check(!in_array('/api/v3/' . $slug . '/status', statusSource($id)->apiReadPaths(), true), "no source reads /$slug/status");
    }
}

$available = static fn (string $module): string => SourceAvailability::AVAILABLE;
$allPaths = ApiKeyPaths::compute(SourceRegistry::default()->pollSources(), static fn (string $id): bool => true, $available);
check($allPaths === [
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
], 'key: exact path set');
// only the workers source enabled: /jobs is not asked for
$onlyWorkers = ApiKeyPaths::compute(SourceRegistry::default()->pollSources(), static fn (string $id): bool => $id === 'local_stt.workers', $available);
check($onlyWorkers === ['/api/v3/module-local-speech-to-text/workers'], 'key: the workers source alone needs /workers only');

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
$statusPath = 'native:local-stt';

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
check(($row['dedupe_key'] ?? '') === 'local_stt.backlog:backlog_no_workers:queue:1794990000:recovered', 'local STT: recovery key is stable');
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
// (the `status` reader: Cloud STT)
$cloudSttRoute = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_CLOUD_STT_INCIDENTS)?->primaryPath();
statusPass($cloudBoth, new StatusPathReader([$cloudSttRoute => $odd]), $states4, $events4, $t0);
check(statusRows($h4) === [], 'unknown code: no event and no guessed text');
check(($states4->get(ModuleStatusSource::SOURCE_CLOUD_STT_INCIDENTS)['cursor']['issues'] ?? []) === [], 'unknown code: not tracked');
$report = statusPass($cloudBoth, new StatusPathReader([$cloudSttRoute => ['state' => 'degraded']]), $states4, $events4, $t0 + 60);
check(($report[ModuleStatusSource::SOURCE_CLOUD_STT_INCIDENTS]['status'] ?? '') === SourceAvailability::ERROR, 'malformed answer is an error');
check(statusRows($h4) === [], 'malformed answer never looks like a recovery');
// the native readers: an answer of the wrong shape is an error too, never an empty (recovered) list
foreach ([
    'local STT workers' => [$localBoth, ['/pbxcore/api/v3/module-local-speech-to-text/workers' => ['state' => 'degraded']]],
    'cloud AI runtime' => [[statusSource(ModuleStatusSource::SOURCE_CLOUD_AI_PAUSED)], ['/pbxcore/api/v3/module-cloud-ai-supervisor/runtime' => ['pause' => 'oops']]],
    'AI Supervisor workers' => [[statusSource(ModuleStatusSource::SOURCE_AI_SUPERVISOR)], ['/pbxcore/api/v3/module-ai-supervisor/workers' => ['state' => 'degraded']]],
] as $label => [$sources, $routes]) {
    $hx = hubTestDatabase();
    $report = statusPass($sources, new StatusPathReader($routes), new SourceStateRepository($hx), new EventStore($hx), $t0);
    check(($report[$sources[0]->id()]['status'] ?? '') === SourceAvailability::ERROR, "malformed $label answer is an error");
    check(statusRows($hx) === [], "malformed $label answer produces no events");
}

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
$cloudSttPath = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_CLOUD_STT_PAUSED)?->primaryPath();
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
$cloudAiPath = 'native:cloud-ai';
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

// ======================= AI Supervisor: GET /workers =======================
$hi = hubTestDatabase();
$is = new SourceStateRepository($hi);
$ie = new EventStore($hi);
$aiSource = statusSource(ModuleStatusSource::SOURCE_AI_SUPERVISOR);
$aiStatusPath = 'native:ai-supervisor';
$aiWorkersPath = '/pbxcore/api/v3/module-ai-supervisor/workers';
$t = 1791200000; // a day after the fixture's last_seen: the module hides workers silent for 30 days
$statusSame = statusFixture('ai-supervisor-status');
$aiRef = (string)$statusSame['issues'][0]['ref'];
$aiSince = (int)$statusSame['issues'][0]['since'];
$healthy = $statusSame;
$healthy['state'] = 'ok';
$healthy['issues'] = [];
$healthy['counters'] = ['workers_online' => 2, 'workers_total' => 2];

// the real shape of GET /workers (module DataStructure: items, id, status, last_seen ...; anonymised)
$workersAnswer = [
    'items' => [
        ['id' => 12, 'name' => 'Private name', 'ip' => '10.0.0.5', 'status' => 'online', 'worker_uid' => 'uid-a', 'capabilities' => ['call_summary'], 'api_version' => 3, 'last_seen' => $t - 20],
        ['id' => 13, 'name' => 'Private name', 'ip' => '10.0.0.6', 'status' => 'offline', 'worker_uid' => 'uid-b', 'capabilities' => [], 'api_version' => 3, 'last_seen' => 1791070800],
        ['id' => 14, 'name' => 'Old', 'ip' => '', 'status' => 'offline', 'worker_uid' => 'uid-c', 'api_version' => 3, 'last_seen' => $t - 40 * 86400],
        ['status' => 'offline', 'last_seen' => 5],
    ],
];
$snapshot = \Modules\ModuleMessengerHub\Lib\Sources\Modules\AiWorkerStateSource::snapshot($workersAnswer, $t);
check(count($snapshot['issues']) === 1, 'AI Supervisor: the 30-day old worker and the row without an id are not issues');
check($snapshot['issues'][0]['ref'] === $aiRef && $snapshot['issues'][0]['since'] === $aiSince, 'AI Supervisor: ref = sha256("ModuleAISupervisor:<id>")[0:12], since = last_seen');
check($snapshot['counters'] === ['workers_online' => 1, 'workers_total' => 2] && $snapshot['state'] === 'degraded', 'AI Supervisor: counters and degraded state (the old worker is excluded)');
check($aiRef === substr(hash('sha256', 'ModuleAISupervisor:13'), 0, 12), 'AI Supervisor: the ref equals the one /status gave (cursor compatibility)');
$allOff = \Modules\ModuleMessengerHub\Lib\Sources\Modules\AiWorkerStateSource::snapshot(['items' => [$workersAnswer['items'][1]]], $t);
check($allOff['state'] === 'down', 'AI Supervisor: every worker offline is down');
check(!str_contains(json_encode($snapshot), 'Private name') && !str_contains(json_encode($snapshot), '10.0.0'), 'AI Supervisor: names and addresses never enter the snapshot');

// an older module without /workers is api_incompatible without a version hint
$report = statusPass([$aiSource], new StatusPathReader([]), $is, $ie, $t);
check(($report[ModuleStatusSource::SOURCE_AI_SUPERVISOR]['status'] ?? '') === SourceAvailability::API_INCOMPATIBLE, 'AI Supervisor: 404 on /workers is api_incompatible');
check(statusRows($hi) === [] && $is->get(ModuleStatusSource::SOURCE_AI_SUPERVISOR)['cursor'] === [], 'AI Supervisor: 404 means no events and a fresh baseline later');

// baseline: an offline worker at the first poll is not announced
$rest = new StatusPathReader([$aiWorkersPath => $workersAnswer]);
statusPass([$aiSource], $rest, $is, $ie, $t + 60);
check(statusRows($hi) === [], 'AI Supervisor: an offline worker at baseline is not announced');
check($rest->log === [$aiWorkersPath], 'AI Supervisor: one GET /workers per poll, nothing else');

// a cursor built from /status (stage 3b-4, same ref and since) stays valid: no re-alert
$aiRoutes = [$aiStatusPath => $statusSame];
$hk = hubTestDatabase();
$ks = new SourceStateRepository($hk);
$ke = new EventStore($hk);
$ks->saveCursor(ModuleStatusSource::SOURCE_AI_SUPERVISOR, [
    'issues' => ['worker_offline|' . $aiRef => [
        'code' => 'worker_offline', 'ref' => $aiRef, 'severity' => 'warning', 'since' => $aiSince,
        'first_seen' => $t, 'last_seen' => $t, 'pending' => false, 'announced' => true,
        'episode_since' => $aiSince, 'episode_tag' => '',
    ]],
    'closed' => [], 'state' => 'degraded', 'counters' => ['workers_online' => 1, 'workers_total' => 2],
]);
statusPass([$aiSource], new StatusPathReader($aiRoutes), $ks, $ke, $t + 60);
check(statusRows($hk) === [], 'compat /status era: an announced AI Supervisor worker is not re-alerted by the /workers reader');
statusPass([$aiSource], new StatusPathReader([$aiStatusPath => $healthy]), $ks, $ke, $t + 120);
$stored = statusRows($hk);
check(count($stored) === 1 && ($stored[0]['event_type'] ?? '') === 'ai_supervisor.worker_online', 'compat /status era: the announced worker recovers with the old event type');
check(($stored[0]['dedupe_key'] ?? '') === 'ai_supervisor.workers:worker_offline:' . $aiRef . ':' . $aiSince . ':recovered', 'compat /status era: the recovery dedupe key is the one /status produced');

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
check(count($stored) === 1 && ($stored[0]['dedupe_key'] ?? '') === 'ai_supervisor.workers:worker_offline:' . $aiRef . ':' . $aiSince, 'compat /status era: the announcement key equals the /status one (ai_supervisor.workers:worker_offline:<ref>:<last_seen>)');

// ======================= Local STT: native readers, rules and /status-era compatibility =======================
use Modules\ModuleMessengerHub\Lib\Sources\Modules\CloudAiRuntimeSnapshot;
use Modules\ModuleMessengerHub\Lib\Sources\Modules\LocalSttSnapshot;

const LS_WORKERS = '/pbxcore/api/v3/module-local-speech-to-text/workers';
const LS_JOBS = '/pbxcore/api/v3/module-local-speech-to-text/jobs';
$tl = 1795700000;
// real shape of GET /workers (module STTWorkerResourceService::formatWorker; anonymised)
$lsWorker = static fn (int $id, string $status, ?int $lastSeen, int $created = 1700000000): array => [
    'id' => $id, 'worker_uid' => 'uid-' . $id, 'name' => 'Private name', 'ip' => '10.0.0.' . $id, 'status' => $status,
    'model' => 'whisper', 'api_key_id' => 5, 'api_version' => 3, 'app_version' => '1.2', 'capabilities' => ['transcribe'],
    'compatible' => true, 'last_seen' => $lastSeen, 'created_at' => $created, 'updated_at' => $created,
];
$lsJob = static fn (int $id, int $created): array => [
    'id' => $id, 'call_id' => 'private-call', 'status' => 'pending', 'priority' => 5, 'worker_id' => null, 'attempts' => 0,
    'created_at' => $created, 'updated_at' => $created, 'started_at' => null, 'finished_at' => null, 'error_msg' => '', 'terminal_error' => false,
];

// worker definitions: status AND last_seen inside the offline timeout (900 s); never seen -> created_at; refs
$rows = [
    $lsWorker(1, 'online', $tl - 100),
    $lsWorker(2, 'online', $tl - 901),
    $lsWorker(3, 'offline', $tl - 5000),
    $lsWorker(4, 'offline', null, 1793000000),
    $lsWorker(5, 'online', $tl - 900),
];
$w = LocalSttSnapshot::workers($rows, $tl);
check($w['online'] === 2 && $w['total'] === 5, 'local STT: online = status online and last_seen within 900 s (boundary inclusive)');
$byRef = array_column($w['issues'], null, 'ref');
check(count($byRef) === 3, 'local STT: a stale "online" worker is offline in the hub as in the module');
check(($byRef[LocalSttSnapshot::workerRef(3)]['since'] ?? 0) === $tl - 5000, 'local STT: since = last_seen');
check(($byRef[LocalSttSnapshot::workerRef(4)]['since'] ?? 0) === 1793000000, 'local STT: a worker that never reported uses created_at');
check(LocalSttSnapshot::workerRef(4) === '2df52bb5d7d9', 'local STT: ref = sha256("ModuleLocalSpeechToText:<id>")[0:12], equal to the /status era ref');
check(!str_contains(json_encode(LocalSttSnapshot::snapshot($w, null, 0, $tl)), 'Private name') && !str_contains(json_encode($w), '10.0.0'), 'local STT: names and addresses never enter the snapshot');

// the workers source reads only /workers (never /jobs) and pages by 200
$reader = new StatusPathReader([LS_WORKERS => static fn (string $p, array $q): array => $q['offset'] === 0 ? array_map(static fn (int $i): array => $lsWorker($i, 'online', $tl - 10), range(1, 200)) : [$lsWorker(201, 'offline', 1793000000)]]);
$all = LocalSttSnapshot::readWorkers($reader);
check(count($all) === 201 && $reader->log === [LS_WORKERS . '?limit=200&offset=0', LS_WORKERS . '?limit=200&offset=200'], 'local STT: more than 200 workers are read page by page');
$hw = hubTestDatabase();
$wsrc = statusSource(ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS);
$rest = new StatusPathReader([LS_WORKERS => $rows, LS_JOBS => [$lsJob(9, 1)]]);
statusPass([$wsrc], $rest, new SourceStateRepository($hw), new EventStore($hw), $tl);
check(array_map(static fn (string $l): string => strtok($l, '?'), $rest->log) === [LS_WORKERS], 'local STT workers source: GET /workers only');

// backlog source: /jobs is read only while no worker is online
$bsrc = statusSource(ModuleStatusSource::SOURCE_LOCAL_STT_BACKLOG);
$hb2 = hubTestDatabase();
$rest = new StatusPathReader([LS_WORKERS => $rows, LS_JOBS => [$lsJob(9, 1)]]);
statusPass([$bsrc], $rest, new SourceStateRepository($hb2), new EventStore($hb2), $tl);
check(array_map(static fn (string $l): string => strtok($l, '?'), $rest->log) === [LS_WORKERS], 'local STT backlog: an online worker means /jobs is not read');

// no worker online: pending count from pagination (limit=1), oldest = the last row (offset total-1)
$offline = [$lsWorker(3, 'offline', $tl - 5000), $lsWorker(4, 'offline', $tl - 4000)];
$jobsRoute = static function (string $path, array $query) use ($lsJob): array {
    $oldestFirst = [$lsJob(31, 1795690000), $lsJob(20, 1795600000), $lsJob(10, 1795000000)]; // id descending
    return isset($query['offset']) ? array_slice($oldestFirst, (int)$query['offset'], 1) : array_slice($oldestFirst, 0, 1);
};
$rest = new StatusPathReader([LS_WORKERS => $offline, LS_JOBS => $jobsRoute]);
$pending = LocalSttSnapshot::readPendingJobs(new class ($rest) implements PagedRestReader {
    public function __construct(private readonly StatusPathReader $inner) {}
    public function get(string $path, array $query = []): array { return $this->inner->get($path, $query); }
    public function getPage(string $path, array $query = []): array
    {
        return ['data' => $this->inner->get($path, $query), 'pagination' => ['total_items' => 3]];
    }
});
check($pending === ['waiting' => 3, 'oldest_created_at' => 1795000000], 'local STT: pending jobs = total_items, oldest = created_at of the last row');
check(
    $rest->log === [LS_JOBS . '?status=pending&limit=1', LS_JOBS . '?status=pending&limit=1&offset=2'],
    'local STT: two one-row requests with a status filter (cheap)'
);
// backlog rules: waiting jobs + no worker online for >= 600 s; since = max(last worker heartbeat, oldest pending created_at)
$w0 = LocalSttSnapshot::workers($offline, $tl);
$since = max($tl - 4000, 1795000000);
$snap = LocalSttSnapshot::snapshot($w0, 3, 1795000000, $tl);
$backlog = array_values(array_filter($snap['issues'], static fn (array $i): bool => $i['code'] === 'backlog_no_workers'));
check(count($backlog) === 1 && $backlog[0]['ref'] === 'queue' && $backlog[0]['severity'] === 'critical' && $backlog[0]['since'] === $since, 'local STT: backlog_no_workers, critical, ref queue, since = max(last_seen, oldest created_at)');
check($snap['state'] === 'down' && $snap['counters']['jobs_waiting'] === 3, 'local STT: backlog state down with the jobs counter');
check(array_filter(LocalSttSnapshot::snapshot($w0, 3, 1795000000, $since + 599)['issues'], static fn (array $i): bool => $i['code'] === 'backlog_no_workers') === [], 'local STT: 599 s without a worker is not a backlog yet');
check(count(LocalSttSnapshot::snapshot($w0, 3, 1795000000, $since + 600)['issues']) === 3, 'local STT: 600 s is');
check(array_filter(LocalSttSnapshot::snapshot($w0, 0, 0, $tl)['issues'], static fn (array $i): bool => $i['code'] === 'backlog_no_workers') === [], 'local STT: no pending jobs, no backlog');
$w1 = LocalSttSnapshot::workers($rows, $tl);
check(array_filter(LocalSttSnapshot::snapshot($w1, 50, 1, $tl)['issues'], static fn (array $i): bool => $i['code'] === 'backlog_no_workers') === [], 'local STT: an online worker means no backlog however many jobs wait');
check(LocalSttSnapshot::snapshot($w1, null, 0, $tl)['counters'] === ['workers_online' => 2, 'workers_total' => 5], 'local STT: jobs_waiting is absent when /jobs was not read');

// a bad /jobs answer is an error, never "no backlog"
foreach (['no pagination' => [], 'not a list' => ['x' => 1]] as $label => $answer) {
    $badJobs = new class ($answer) implements PagedRestReader {
        public function __construct(private readonly array $answer) {}
        public function get(string $path, array $query = []): array { return []; }
        public function getPage(string $path, array $query = []): array
        {
            return ['data' => $this->answer, 'pagination' => []];
        }
    };
    try {
        LocalSttSnapshot::readPendingJobs($badJobs);
        check(false, "local STT: $label /jobs answer is rejected");
    } catch (SourceException $exception) {
        check($exception->errorCode === 'api_bad_response', "local STT: $label /jobs answer is api_bad_response");
    }
}

// the module refuses the hub key on a resource (403 after the key is healthy): api_forbidden, no events
$h403 = hubTestDatabase();
$report = statusPass([$wsrc, $bsrc], new StatusPathReader([
    LS_WORKERS => static function (): array {
        throw new SourceException('api_forbidden');
    },
]), new SourceStateRepository($h403), new EventStore($h403), $tl);
check(
    ($report[ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS]['status'] ?? '') === SourceAvailability::API_FORBIDDEN
    && ($report[ModuleStatusSource::SOURCE_LOCAL_STT_BACKLOG]['status'] ?? '') === SourceAvailability::API_FORBIDDEN,
    'local STT: 403 on /workers is api_forbidden for both sources'
);
check(statusRows($h403) === [], 'local STT: 403 produces no events');

// cursors built from /status (stage 3b-4): same refs, same since -> nothing is announced again
$hc2 = hubTestDatabase();
$sc2 = new SourceStateRepository($hc2);
$ec2 = new EventStore($hc2);
$offlineRow = $lsWorker(4, 'offline', 1793262107);
$sc2->saveCursor(ModuleStatusSource::SOURCE_LOCAL_STT_WORKERS, ['issues' => ['worker_offline|2df52bb5d7d9' => [
    'code' => 'worker_offline', 'ref' => '2df52bb5d7d9', 'severity' => 'warning', 'since' => 1793262107,
    'first_seen' => $tl - 7200, 'last_seen' => $tl - 60, 'pending' => false, 'announced' => true, 'episode_since' => 1793262107, 'episode_tag' => '',
]], 'closed' => [], 'state' => 'degraded', 'counters' => []]);
$sc2->saveCursor(ModuleStatusSource::SOURCE_LOCAL_STT_BACKLOG, ['issues' => ['backlog_no_workers|queue' => [
    'code' => 'backlog_no_workers', 'ref' => 'queue', 'severity' => 'critical', 'since' => 1795600000,
    'first_seen' => $tl - 7200, 'last_seen' => $tl - 60, 'pending' => false, 'announced' => true, 'episode_since' => 1795600000, 'episode_tag' => '',
]], 'closed' => [], 'state' => 'down', 'counters' => []]);
$noWorker = new StatusPathReader([LS_WORKERS => [$offlineRow], LS_JOBS => $jobsRoute]);
statusPass([$wsrc, $bsrc], $noWorker, $sc2, $ec2, $tl);
statusPass([$wsrc, $bsrc], $noWorker, $sc2, $ec2, $tl + 60);
check(statusRows($hc2) === [], 'compat /status era: announced offline worker and backlog are not re-announced after switching to /workers + /jobs');
// the since of the backlog moves (the module read it as max(last_seen, oldest)): still one incident
check(($sc2->get(ModuleStatusSource::SOURCE_LOCAL_STT_BACKLOG)['cursor']['issues']['backlog_no_workers|queue']['episode_since'] ?? 0) === 1795600000, 'compat /status era: the backlog keeps its episode identity when since differs');
statusPass([$wsrc, $bsrc], new StatusPathReader([LS_WORKERS => [$lsWorker(4, 'online', $tl + 100)], LS_JOBS => []]), $sc2, $ec2, $tl + 120);
$rec = array_column(statusRows($hc2), 'dedupe_key', 'event_type');
check(
    ($rec['local_stt.worker_online'] ?? '') === 'local_stt.workers:worker_offline:2df52bb5d7d9:1793262107:recovered'
    && ($rec['local_stt.backlog_resolved'] ?? '') === 'local_stt.backlog:backlog_no_workers:queue:1795600000:recovered',
    'compat /status era: recovery keys equal the /status ones'
);

// ======================= Cloud AI: GET /runtime =======================
// real shape (module Runtime DataStructure example; anonymised)
$runtime = static fn (array $pause, array $summary = ['analysis_pending' => 3, 'analysis_awaiting_result' => 1, 'analysis_done' => 10]): array => [
    'analysis_enabled' => true, 'setup_state' => 'configured', 'pause' => $pause,
    'balance' => ['amount' => '545.02', 'currency' => 'RUB', 'checked_at' => 1784473000000, 'warning_threshold' => 100.0, 'low_balance_warning' => false, 'shared_with_cloud_stt' => true],
    'model' => ['selected' => 'private-model', 'state' => 'available'],
    'daily_limits' => ['calls' => 0, 'tokens' => 0, 'used_calls' => 0, 'used_tokens' => 0, 'spend' => 0.0, 'used_spend' => 0.0, 'reset_at' => 1784476800],
    'summary' => $summary,
];
$running = CloudAiRuntimeSnapshot::snapshot($runtime(['paused' => false, 'pause_reason' => '', 'paused_at' => 0, 'resume_check_at' => 0]));
check($running['issues'] === [] && $running['state'] === 'ok' && $running['counters'] === ['jobs_waiting' => 3], 'cloud AI runtime: not paused -> no issue, jobs_waiting from summary.analysis_pending');
foreach ([
    ['manual', HubEvent::SEVERITY_WARNING],
    ['license_missing', HubEvent::SEVERITY_WARNING],
    ['insufficient_funds', HubEvent::SEVERITY_CRITICAL],
    ['low_balance', HubEvent::SEVERITY_CRITICAL],
    ['brand_new_reason', HubEvent::SEVERITY_WARNING],
] as [$reason, $severity]) {
    $paused = CloudAiRuntimeSnapshot::snapshot($runtime(['paused' => true, 'pause_reason' => $reason, 'paused_at' => 1793300000, 'resume_check_at' => 0]));
    $issue = $paused['issues'][0] ?? [];
    check(($issue['code'] ?? '') === 'processing_paused' && $issue['ref'] === $reason && $issue['since'] === 1793300000 && $issue['severity'] === $severity, "cloud AI runtime: paused/$reason -> processing_paused, ref = reason, since = paused_at, $severity");
}
$noSummary = CloudAiRuntimeSnapshot::snapshot(['pause' => ['paused' => true, 'pause_reason' => 'manual', 'paused_at' => 5]]);
check($noSummary['counters'] === [], 'cloud AI runtime: a missing summary means no counter');
check(!str_contains(json_encode($running), '545.02') && !str_contains(json_encode($running), 'private-model'), 'cloud AI runtime: balance and model never enter the snapshot');
check(CloudAiRuntimeSnapshot::snapshot($runtime(['paused' => true, 'pause_reason' => '', 'paused_at' => 5]))['issues'] === [], 'cloud AI runtime: paused without a reason is not an issue');
// through the source: not_configured silent, unknown reason passes with severity warning, severity by reason
$hr = hubTestDatabase();
$rs = new SourceStateRepository($hr);
$re = new EventStore($hr);
$cai = statusSource(ModuleStatusSource::SOURCE_CLOUD_AI_PAUSED);
$runtimePath = '/pbxcore/api/v3/module-cloud-ai-supervisor/runtime';
$tr = 1795800000;
statusPass([$cai], new StatusPathReader([$runtimePath => $runtime(['paused' => true, 'pause_reason' => 'not_configured', 'paused_at' => 1700000000, 'resume_check_at' => 0])]), $rs, $re, $tr);
statusPass([$cai], new StatusPathReader([$runtimePath => $runtime(['paused' => true, 'pause_reason' => 'not_configured', 'paused_at' => 1700000000, 'resume_check_at' => 0])]), $rs, $re, $tr + 60);
check(statusRows($hr) === [], 'cloud AI runtime: not_configured never alerts');
statusPass([$cai], new StatusPathReader([$runtimePath => $runtime(['paused' => true, 'pause_reason' => 'insufficient_funds', 'paused_at' => 1795800100, 'resume_check_at' => 0])]), $rs, $re, $tr + 120);
$row = onlyEvent(statusRows($hr));
check($row['event_type'] === 'cloud_ai.paused' && $row['severity'] === HubEvent::SEVERITY_CRITICAL && $row['dedupe_key'] === 'cloud_ai.paused:processing_paused:insufficient_funds:1795800100', 'cloud AI runtime: pause event with the /status-era dedupe key shape');
check(($row['payload']['subject']['module_status']['ref'] ?? '') === 'insufficient_funds' && ($row['payload']['subject']['module_status']['counters']['jobs_waiting'] ?? 0) === 3, 'cloud AI runtime: payload carries the reason and jobs_waiting');
statusPass([$cai], new StatusPathReader([$runtimePath => $runtime(['paused' => true, 'pause_reason' => 'brand_new_reason', 'paused_at' => 1795800200, 'resume_check_at' => 0])]), $rs, $re, $tr + 180);
check(count(statusRows($hr)) === 3, 'cloud AI runtime: an unknown reason is announced (the rule filter decides later) after the old one resumed');
// a /status-era cursor: the paused pair announced then is not announced again
$hs2 = hubTestDatabase();
$ss2 = new SourceStateRepository($hs2);
$ss2->saveCursor(ModuleStatusSource::SOURCE_CLOUD_AI_PAUSED, ['issues' => ['processing_paused|source_unavailable' => [
    'code' => 'processing_paused', 'ref' => 'source_unavailable', 'severity' => 'warning', 'since' => 1793254951,
    'first_seen' => $tr, 'last_seen' => $tr, 'pending' => false, 'announced' => true, 'episode_since' => 1793254951, 'episode_tag' => '',
]], 'closed' => [], 'state' => 'paused', 'counters' => ['jobs_waiting' => 49]]);
statusPass([$cai], new StatusPathReader([$runtimePath => $runtime(['paused' => true, 'pause_reason' => 'source_unavailable', 'paused_at' => 1793254951, 'resume_check_at' => 0])]), $ss2, new EventStore($hs2), $tr + 60);
check(statusRows($hs2) === [], 'compat /status era: an announced Cloud AI pause is not re-announced by the /runtime reader');
$report = statusPass([$cai], new StatusPathReader([]), $ss2, new EventStore($hs2), $tr + 120);
check(($report[ModuleStatusSource::SOURCE_CLOUD_AI_PAUSED]['status'] ?? '') === SourceAvailability::API_INCOMPATIBLE, 'cloud AI runtime: 404 is api_incompatible');

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
$cloudIncidentPath = ModuleStatusSource::profileFor(ModuleStatusSource::SOURCE_CLOUD_STT_INCIDENTS)?->primaryPath();
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
statusPass($localBoth, new StatusPathReader([($statusPath = 'native:local-stt') => statusFixture('local-stt-ok')]), new SourceStateRepository($ht), new EventStore($ht), $tm);
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
