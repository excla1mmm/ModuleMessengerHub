<?php

declare(strict_types=1);

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Api\RestReader;
use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\Collector;
use Modules\ModuleMessengerHub\Lib\Sources\ModuleStatusProbe;
use Modules\ModuleMessengerHub\Lib\Sources\Modules\AiAttentionCallSource;
use Modules\ModuleMessengerHub\Lib\Sources\Modules\AiWorkerStateSource;
use Modules\ModuleMessengerHub\Lib\Sources\Modules\VaCallbackSource;
use Modules\ModuleMessengerHub\Lib\Sources\Modules\VaRuntimeSource;
use Modules\ModuleMessengerHub\Lib\Sources\SourceAvailability;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceException;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRegistry;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

const FIXTURES = __DIR__ . '/fixtures';

function fixture(string $relative): array
{
    $raw = file_get_contents(FIXTURES . '/' . $relative);
    if ($raw === false) {
        fwrite(STDERR, "missing fixture $relative\n");
        exit(1);
    }

    return json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
}

/** Stored events with payload decoded, oldest first. */
function rows(HubDatabase $db): array
{
    return array_map(static function (array $row): array {
        $payload = json_decode((string)$row['payload_json'], true, 16, JSON_THROW_ON_ERROR);
        $row['payload'] = is_array($payload) ? $payload : [];
        unset($row['payload_json']);

        return $row;
    }, $db->fetchAll(
        'SELECT id, source_id, event_type, severity, dedupe_key, occurred_at, created_at, payload_json'
        . ' FROM ' . EventStore::TABLE . ' ORDER BY id'
    ));
}

function rowCount(HubDatabase $db): int
{
    return (int)($db->fetchOne('SELECT COUNT(*) AS c FROM ' . EventStore::TABLE)['c'] ?? 0);
}

/**
 * RestReader over fixture files: "path" -> fixture, "path/{id}" -> record responses.
 */
final class FixtureRestReader implements RestReader
{
    /** @var array<string, array<mixed>> */
    private array $routes;

    public int $calls = 0;

    /** @param array<string, array<mixed>> $routes */
    public function __construct(array $routes)
    {
        $this->routes = $routes;
    }

    public function get(string $path, array $query = []): array
    {
        $this->calls++;
        if (isset($this->routes[$path])) {
            return $this->routes[$path];
        }
        foreach ($this->routes as $pattern => $data) {
            if (str_ends_with($pattern, '/{id}')
                && str_starts_with($path, substr($pattern, 0, -4))
                && preg_match('/^\d+$/', substr($path, strlen($pattern) - 4)) === 1) {
                return $data;
            }
        }
        throw new SourceException('api_not_found');
    }
}

final class StaticProbe implements ModuleStatusProbe
{
    public function __construct(private readonly string $status)
    {
    }

    public function status(string $moduleUniqueId): string
    {
        return $this->status;
    }
}

function runPass(array $sources, ModuleStatusProbe $probe, RestReader $rest, SourceStateRepository $states, EventStore $store, int $now): array
{
    $collector = new Collector($sources, $states, $store, $probe, new SourceContext($rest, static fn (): int => $now));

    return $collector->runOnce();
}


function attentionRoutes(array $list): array
{
    return [
        AiAttentionCallSource::PATH => $list,
        AiAttentionCallSource::PATH . '/{id}' => fixture('ai-supervisor/calls-detail.json'),
    ];
}

const MAP = [
    '204' => ['user_id' => 12, 'name' => 'Ivanov I.'],
    '206' => ['user_id' => 14, 'name' => 'Petrov P.'],
];

// ======================= registry =======================
$registry = SourceRegistry::default();
check(count($registry->all()) === 9, 'registry: nine sources (5 core + 4 module)');
check($registry->find(AiAttentionCallSource::ID) instanceof AiAttentionCallSource, 'registry: attention_call');
check($registry->find(AiWorkerStateSource::ID) instanceof AiWorkerStateSource, 'registry: worker state');
check($registry->find(VaCallbackSource::ID) instanceof VaCallbackSource, 'registry: callbacks');
check($registry->find(VaRuntimeSource::ID) instanceof VaRuntimeSource, 'registry: runtime');
$moduleIds = ['ai_supervisor.attention_call', 'ai_supervisor.workers', 'voice_agent.callbacks', 'voice_agent.runtime'];
foreach ($moduleIds as $mid) {
    $source = $registry->find($mid);
    check($source !== null && $source->mode() === SourceInterface::MODE_POLL, "registry: $mid is poll");
    check($source !== null && $source->requiredModule() !== null, "registry: $mid has requiredModule");
}
check($registry->apiReadPaths(array_merge(['core.advice'], $moduleIds)) === [
    '/api/v3/advice',
    '/api/v3/module-ai-supervisor/calls',
    '/api/v3/module-ai-supervisor/workers',
    '/api/v3/module-voice-agent/callbacks',
    '/api/v3/module-voice-agent/runtime',
], 'registry: apiReadPaths union (all read-only)');

// ======================= ai_supervisor.attention_call =======================
$h = hubTestDatabase();
$states = new SourceStateRepository($h);
$store = new EventStore($h);
$listFixture = fixture('ai-supervisor/calls-list.json');
$rest = new FixtureRestReader(attentionRoutes($listFixture));
$attention = new AiAttentionCallSource(static fn (): array => MAP);
check($attention->id() === 'ai_supervisor.attention_call', 'attention: id');
check($attention->requiredModule() === 'ModuleAISupervisor', 'attention: module');
check($attention->apiReadPaths() === [AiAttentionCallSource::API_READ_PATH], 'attention: single read path');

// baseline: no events, no detail fetches
$now = 1791073000;
$report = runPass([$attention], new StaticProbe(SourceAvailability::AVAILABLE), $rest, $states, $store, $now);
check(($report[AiAttentionCallSource::ID]['status'] ?? '') === SourceAvailability::AVAILABLE, 'attention: pass ok');
check(count(rows($h)) === 0, 'attention: baseline records nothing');
check($rest->calls === 1, 'attention: baseline skips the detail endpoint');
$cursor = $states->get(AiAttentionCallSource::ID)['cursor'];
check(isset($cursor['seen']['4102']), 'attention: baseline cursor holds the ref id');

// second pass with the same fixture: nothing new
$now += 60;
$rest = new FixtureRestReader(attentionRoutes($listFixture));
runPass([$attention], new StaticProbe(SourceAvailability::AVAILABLE), $rest, $states, $store, $now);
check(count(rows($h)) === 0, 'attention: repeated poll does not duplicate');

// a late analysis appears in the window (an older call becomes attention hours later)
$now += 60;
$lateItem = $listFixture['items'][0];
$lateItem['id'] = 3987; // an older call
$lateItem['call_id'] = 'mikopbx-1790900000.050';
$lateItem['call_timestamp'] = 1790900000;
$lateItem['ai_result']['updated_at'] = $now - 30; // analysis finished seconds ago
$updatedList = ['items' => [$listFixture['items'][0], $lateItem], 'pagination' => $listFixture['pagination']];
$rest = new FixtureRestReader(attentionRoutes($updatedList));
runPass([$attention], new StaticProbe(SourceAvailability::AVAILABLE), $rest, $states, $store, $now);
$stored = rows($h);
check(count($stored) === 1, 'attention: late analysis produces exactly one event');
if (count($stored) === 1) {
    $row = $stored[0];
    $payload = $row['payload'];
    check($row['event_type'] === 'ai_supervisor.attention_call' && $row['source_id'] === 'ai_supervisor.attention_call', 'attention: type and source');
    check($row['dedupe_key'] === 'ai_attention:3987', 'attention: dedupe by ref id');
    check($row['severity'] === HubEvent::SEVERITY_WARNING, 'attention: warning severity');
    check((int)$row['occurred_at'] === $now - 30, 'attention: occurred_at = analysis completion time');
    check(($payload['subject']['call']['linkedid'] ?? '') === 'mikopbx-1790900000.050', 'attention: call_id = linkedid');
    check(($payload['subject']['call']['direction'] ?? '') === 'incoming', 'attention: direction incoming (src is client)');
    check(($payload['subject']['client_number'] ?? '') === '79000000001', 'attention: client number');
    check(($payload['subject']['employees'][0]['user_id'] ?? -1) === 12, 'attention: employee user_id from the internal map');
    check(($payload['subject']['employees'][0]['name'] ?? '') === 'Ivanov I.', 'attention: employee name from the internal map');
    check(($payload['subject']['attention']['summary'] ?? '') !== '', 'attention: summary present');
    check(($payload['subject']['attention']['reasons'][0] ?? '') === 'Обещание без исполнения', 'attention: reasons from list_view risks');
    check(($payload['facts']['scores']['quality'] ?? -1) === 0.41, 'attention: quality score');
    $quotes = $payload['facts']['quotes'];
    check(count($quotes) === 3, 'attention: up to 3 evidence quotes');
    check(($quotes[0]['start_ms'] ?? -1) === 42000 && ($quotes[0]['end_ms'] ?? -1) === 47500, 'attention: quotes carry timecodes');
    check(($payload['facts']['scores']['quality_v2'][0]['score'] ?? -1) === 41, 'attention: quality v2 score');
}

// re-analysis of the same call: dedupe by ref id
$now += 60;
$rest = new FixtureRestReader(attentionRoutes($updatedList));
runPass([$attention], new StaticProbe(SourceAvailability::AVAILABLE), $rest, $states, $store, $now);
check(count(rows($h)) === 1, 'attention: repeated analysis does not duplicate');

// cursor stays bounded when the window fills up
$many = [];
for ($i = 0; $i < 600; $i++) {
    $item = $listFixture['items'][0];
    $item['id'] = 100000 + $i;
    $many[] = $item;
}
$batch = AiAttentionCallSource::buildBatch($many, ['seen' => array_fill_keys(array_map('strval', range(1, 500)), 1)], $now, static fn (int $id): array => [], MAP);
check(count($batch->cursor['seen']) === 500, 'attention: cursor is capped at 500 ids');
check(count($batch->events) === 10 && isset($batch->cursor['seen']['100009']) && !isset($batch->cursor['seen']['100599']), 'attention: cap keeps processed ids, deferred ids stay out');

// detail endpoint failing -> event without quotes
$now += 60;
$failingEvents = AiAttentionCallSource::buildBatch(
    [$lateItem],
    ['seen' => ['4102' => 1]],
    $now,
    static fn (int $id): array => throw new SourceException('api_unavailable'),
    MAP
);
check(count($failingEvents->events) === 1 && $failingEvents->events[0]->payload['facts']['quotes'] === [], 'attention: detail failure degrades to a quoteless event');

// burst: 25 new ids drain 10 per poll, nothing is lost or duplicated
$burstItems = [];
for ($i = 1; $i <= 25; $i++) {
    $item = $listFixture['items'][0];
    $item['id'] = 200000 + $i;
    $item['call_id'] = 'burst-' . $i;
    $burstItems[] = $item;
}
$burstCursor = ['seen' => ['1' => 1]];
$burstKeys = [];
$burstCounts = [];
for ($poll = 1; $poll <= 4; $poll++) {
    $burstBatch = AiAttentionCallSource::buildBatch($burstItems, $burstCursor, $now, static fn (int $id): array => [], MAP);
    $burstCursor = $burstBatch->cursor;
    $burstCounts[] = count($burstBatch->events);
    foreach ($burstBatch->events as $ev) {
        $burstKeys[] = $ev->dedupeKey;
    }
}
check($burstCounts === [10, 10, 5, 0], 'attention burst: 10/10/5/0 events per poll (got ' . implode('/', $burstCounts) . ')');
check(count($burstKeys) === 25 && count(array_unique($burstKeys)) === 25, 'attention burst: 25 unique events, none lost');

// detail failure for one id: quoteless event, marked seen, not repeated
$failId = 200003;
$failFetch = static function (int $id) use ($failId): array {
    if ($id === $failId) {
        throw new SourceException('api_unavailable');
    }
    return [];
};
$failBatch = AiAttentionCallSource::buildBatch(array_slice($burstItems, 0, 5), ['seen' => ['1' => 1]], $now, $failFetch, MAP);
$failKeys = array_map(static fn ($e) => $e->dedupeKey, $failBatch->events);
check(count($failBatch->events) === 5 && in_array('ai_attention:' . $failId, $failKeys, true), 'attention detail failure: failing id still yields an event');
$failEvent = $failBatch->events[array_search('ai_attention:' . $failId, $failKeys, true)];
check($failEvent->payload['facts']['quotes'] === [] && isset($failBatch->cursor['seen'][(string)$failId]), 'attention detail failure: no quotes, id marked seen');
$failAgain = AiAttentionCallSource::buildBatch(array_slice($burstItems, 0, 5), $failBatch->cursor, $now, $failFetch, MAP);
check($failAgain->events === [], 'attention detail failure: not repeated next poll');

// eviction: ids visible in the window are never evicted from the cursor (no history leak)
$evictItem = $listFixture['items'][0];
$mk = static function (int $id) use ($evictItem): array {
    $item = $evictItem;
    $item['id'] = $id;
    return $item;
};
$baselineIds = range(300001, 300100);
$evCursor = AiAttentionCallSource::buildBatch(array_map($mk, $baselineIds), [], $now, static fn (int $id): array => [], MAP)->cursor;
$stable = array_slice($baselineIds, 0, 50); // stays in the window the whole time
$leaked = 0;
$nextId = 400000;
for ($poll = 0; $poll < 80; $poll++) {
    $window = $stable;
    for ($j = 0; $j < 8; $j++) {
        $window[] = $nextId++;
    }
    $evBatch = AiAttentionCallSource::buildBatch(array_map($mk, $window), $evCursor, $now, static fn (int $id): array => [], MAP);
    $evCursor = $evBatch->cursor;
    foreach ($evBatch->events as $ev) {
        if (in_array((int)substr($ev->dedupeKey, strlen('ai_attention:')), $baselineIds, true)) {
            ++$leaked;
        }
    }
}
check(count($evCursor['seen']) === 500, 'attention eviction: set reached the cap');
check($leaked === 0, 'attention eviction: baseline ids still in the window never become events');
foreach ($stable as $sid) {
    if (!isset($evCursor['seen'][(string)$sid])) {
        check(false, 'attention eviction: visible id ' . $sid . ' evicted');
        break;
    }
}

// ======================= ai_supervisor.workers =======================
$h2 = hubTestDatabase();
$states2 = new SourceStateRepository($h2);
$store2 = new EventStore($h2);
$workersFixture = fixture('ai-supervisor/workers.json');
$workers = new AiWorkerStateSource();
check($workers->eventTypes() === ['ai_supervisor.worker_offline', 'ai_supervisor.worker_online'], 'workers: event types');
check($workers->apiReadPaths() === [AiWorkerStateSource::API_READ_PATH], 'workers: read path');

runPass([$workers], new StaticProbe(SourceAvailability::AVAILABLE), new FixtureRestReader([AiWorkerStateSource::PATH => $workersFixture]), $states2, $store2, $now);
check(count(rows($h2)) === 0, 'workers: baseline records nothing');

// offline worker of the baseline comes back online -> recovery event
$now += 60;
$flippedOnline = $workersFixture;
$flippedOnline['items'][1]['status'] = 'online';
runPass([$workers], new StaticProbe(SourceAvailability::AVAILABLE), new FixtureRestReader([AiWorkerStateSource::PATH => $flippedOnline]), $states2, $store2, $now);
check(count(rows($h2)) === 1, 'workers: offline -> online emits recovery');

// and goes offline again
$now += 60;
runPass([$workers], new StaticProbe(SourceAvailability::AVAILABLE), new FixtureRestReader([AiWorkerStateSource::PATH => $workersFixture]), $states2, $store2, $now);
$stored2 = rows($h2);
check(count($stored2) === 2, 'workers: online -> offline emits one down event');
if (count($stored2) === 2) {
    $down = $stored2[1];
    $payload = $down['payload'];
    check($down['event_type'] === 'ai_supervisor.worker_offline' && $down['severity'] === HubEvent::SEVERITY_WARNING, 'workers: offline is warning');
    check(str_starts_with((string)$down['dedupe_key'], 'ai_worker:win-worker-02:offline:'), 'workers: dedupe ai_worker:{uid}:{state}:{since}');
    check(($payload['subject']['worker']['previous_status'] ?? '') === 'online', 'workers: payload carries previous state');
}

$now += 60;
runPass([$workers], new StaticProbe(SourceAvailability::AVAILABLE), new FixtureRestReader([AiWorkerStateSource::PATH => $workersFixture]), $states2, $store2, $now);
check(count(rows($h2)) === 2, 'workers: stable state emits nothing');

// a worker never seen before that is already offline: no event
$fresh = ['items' => [['worker_uid' => 'brand-new', 'status' => 'offline', 'name' => 'New', 'last_seen' => 0]]];
$now += 60;
runPass([$workers], new StaticProbe(SourceAvailability::AVAILABLE), new FixtureRestReader([AiWorkerStateSource::PATH => $fresh]), $states2, $store2, $now);
check(count(rows($h2)) === 2, 'workers: first sighting of an offline worker stays silent');

// ======================= voice_agent.callbacks =======================
$h3 = hubTestDatabase();
$states3 = new SourceStateRepository($h3);
$store3 = new EventStore($h3);
$callbacksFixture = fixture('voice-agent/callbacks.json');
$callbacks = new VaCallbackSource();
check($callbacks->id() === 'voice_agent.callbacks' && $callbacks->eventTypes() === ['voice_agent.callback_request'], 'callbacks: identity');
check($callbacks->requiredModule() === 'ModuleVoiceAgent', 'callbacks: module');
check($callbacks->apiReadPaths() === [VaCallbackSource::API_READ_PATH], 'callbacks: read path');

runPass([$callbacks], new StaticProbe(SourceAvailability::AVAILABLE), new FixtureRestReader([VaCallbackSource::PATH => $callbacksFixture]), $states3, $store3, $now);
check(count(rows($h3)) === 0, 'callbacks: baseline records nothing');
$cursor3 = $states3->get(VaCallbackSource::ID)['cursor'];
check(($cursor3['max_id'] ?? 0) === 84, 'callbacks: baseline cursor = max id');

$now += 60;
$newCallbacks = $callbacksFixture;
array_unshift($newCallbacks['items'], array_merge($callbacksFixture['items'][0], [
    'id' => 85,
    'created_at' => $now - 10,
    'phone' => '+79000000009',
    'topic' => 'Нов заявка',
]));
runPass([$callbacks], new StaticProbe(SourceAvailability::AVAILABLE), new FixtureRestReader([VaCallbackSource::PATH => $newCallbacks]), $states3, $store3, $now);
$stored3 = rows($h3);
check(count($stored3) === 1, 'callbacks: one new request -> one event');
if (count($stored3) === 1) {
    $row = $stored3[0];
    $payload = $row['payload'];
    check($row['dedupe_key'] === 'va_callback:85', 'callbacks: dedupe va_callback:{id}');
    check((int)$row['occurred_at'] === $now - 10, 'callbacks: occurred_at = created_at');
    check(($payload['subject']['client_number'] ?? '') === '+79000000009', 'callbacks: client phone');
    check(($payload['subject']['callback']['missed_extension'] ?? '') === '206', 'callbacks: missed extension present');
    check(($payload['subject']['callback']['missed_only'] ?? false) === true, 'callbacks: missed_only flag');
}
runPass([$callbacks], new StaticProbe(SourceAvailability::AVAILABLE), new FixtureRestReader([VaCallbackSource::PATH => $newCallbacks]), $states3, $store3, $now + 1);
check(count(rows($h3)) === 1, 'callbacks: repeated poll does not duplicate');

// ======================= voice_agent.runtime =======================
$h4 = hubTestDatabase();
$states4 = new SourceStateRepository($h4);
$store4 = new EventStore($h4);
$runtime = new VaRuntimeSource();
check($runtime->id() === 'voice_agent.runtime', 'runtime: id');
check($runtime->eventTypes() === ['voice_agent.runtime_down', 'voice_agent.runtime_up'], 'runtime: event types');
check($runtime->requiredModule() === 'ModuleVoiceAgent', 'runtime: module');
check($runtime->apiReadPaths() === [VaRuntimeSource::API_READ_PATH], 'runtime: read path');

runPass([$runtime], new StaticProbe(SourceAvailability::AVAILABLE), new FixtureRestReader([VaRuntimeSource::PATH => fixture('voice-agent/runtime-ok.json')]), $states4, $store4, $now);
check(count(rows($h4)) === 0, 'runtime: baseline (ok) records nothing');

$now += 60;
runPass([$runtime], new StaticProbe(SourceAvailability::AVAILABLE), new FixtureRestReader([VaRuntimeSource::PATH => fixture('voice-agent/runtime-down.json')]), $states4, $store4, $now);
$stored4 = rows($h4);
check(count($stored4) === 1, 'runtime: ok -> unreachable emits down');
if (count($stored4) === 1) {
    $row = $stored4[0];
    check($row['event_type'] === 'voice_agent.runtime_down' && $row['severity'] === HubEvent::SEVERITY_CRITICAL, 'runtime: down is critical');
    check(str_starts_with((string)$row['dedupe_key'], 'va_runtime:down:'), 'runtime: dedupe va_runtime:{state}:{ts}');
    check(($row['payload']['subject']['runtime']['health_state'] ?? '') === 'unreachable', 'runtime: payload carries health state');
}
$now += 60;
runPass([$runtime], new StaticProbe(SourceAvailability::AVAILABLE), new FixtureRestReader([VaRuntimeSource::PATH => fixture('voice-agent/runtime-down.json')]), $states4, $store4, $now);
check(count(rows($h4)) === 1, 'runtime: stable down emits nothing');

// not_configured: no event, cursor keeps the last real state
$notConfigured = ['health' => ['state' => 'not_configured', 'checked_at' => $now]];
$now += 60;
runPass([$runtime], new StaticProbe(SourceAvailability::AVAILABLE), new FixtureRestReader([VaRuntimeSource::PATH => $notConfigured]), $states4, $store4, $now);
check(count(rows($h4)) === 1, 'runtime: not_configured is not an event');
check(($states4->get(VaRuntimeSource::ID)['cursor']['state'] ?? '') === 'down', 'runtime: cursor keeps the last real state');

// unreachable again after the not_configured gap: still down, nothing changed -> no event
$now += 60;
runPass([$runtime], new StaticProbe(SourceAvailability::AVAILABLE), new FixtureRestReader([VaRuntimeSource::PATH => fixture('voice-agent/runtime-down.json')]), $states4, $store4, $now);
check(count(rows($h4)) === 1, 'runtime: down after the gap is not a new transition');

// recovery
$now += 60;
runPass([$runtime], new StaticProbe(SourceAvailability::AVAILABLE), new FixtureRestReader([VaRuntimeSource::PATH => fixture('voice-agent/runtime-ok.json')]), $states4, $store4, $now);
$stored4 = rows($h4);
check(count($stored4) === 2 && $stored4[1]['event_type'] === 'voice_agent.runtime_up', 'runtime: recovery emits up');
check($stored4[1]['severity'] === HubEvent::SEVERITY_INFO, 'runtime: up is info');

// ======================= collector integration: module_disabled =======================
$h5 = hubTestDatabase();
$states5 = new SourceStateRepository($h5);
$store5 = new EventStore($h5);
$attention2 = new AiAttentionCallSource(static fn (): array => MAP);

// baseline while available
runPass([$attention2], new StaticProbe(SourceAvailability::AVAILABLE), new FixtureRestReader(attentionRoutes($listFixture)), $states5, $store5, $now);

// module becomes disabled: availability switches and the cursor resets (re-baseline)
$now += 60;
$rest5 = new FixtureRestReader([AiAttentionCallSource::PATH => $listFixture]);
$report5 = runPass([$attention2], new StaticProbe(SourceAvailability::MODULE_DISABLED), $rest5, $states5, $store5, $now);
check(($report5[AiAttentionCallSource::ID]['status'] ?? '') === SourceAvailability::MODULE_DISABLED, 'disabled: report module_disabled');
check($rest5->calls === 0, 'disabled: source is not polled');
$state5 = $states5->get(AiAttentionCallSource::ID);
check($state5['availability'] === SourceAvailability::MODULE_DISABLED, 'disabled: availability stored');
check($state5['cursor'] === [], 'disabled: cursor reset (fresh baseline on recovery)');

// module comes back: baseline again, no history even though the fixture still carries items
$now += 60;
$rest5 = new FixtureRestReader(attentionRoutes($listFixture));
runPass([$attention2], new StaticProbe(SourceAvailability::AVAILABLE), $rest5, $states5, $store5, $now);
check(count(rows($h5)) === 0, 'disabled: recovery re-baselines without history');
check($rest5->calls === 1, 'disabled: recovery poll sets a new baseline cursor');
check(count($states5->get(AiAttentionCallSource::ID)['cursor']['seen'] ?? []) === 1, 'disabled: new baseline cursor has the current ids');

finish('module sources OK');
