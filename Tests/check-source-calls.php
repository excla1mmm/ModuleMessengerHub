<?php

declare(strict_types=1);

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\LinkBuilder;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\Templates\TemplateRegistry;
use Modules\ModuleMessengerHub\Lib\Sources\Core\AgiDataDecoder;
use Modules\ModuleMessengerHub\Lib\Sources\Core\CallOutOfHoursSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\InternalNumberMap;
use Modules\ModuleMessengerHub\Lib\Sources\Core\MissedCallSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\ParkTimeoutSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\QueueAbandonSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\QueueNameMap;
use Modules\ModuleMessengerHub\Lib\Sources\SourceCatalog;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRecorder;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRegistry;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;

const FIXTURES = __DIR__ . '/fixtures/core-call-events';

/** @return array<string, mixed> */
function fixture(string $name): array
{
    $raw = file_get_contents(FIXTURES . '/' . $name);
    if ($raw === false) {
        fwrite(STDERR, "missing fixture $name\n");
        exit(1);
    }

    return json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
}

/** AgiData of a CdrConnector fixture, exactly as Core's AsteriskManager::encodeCdrData() would build it. */
function agi(string $name): string
{
    return (string)fixture($name)['AgiData'];
}

/** @param array<string, mixed> $data */
function encodeCdr(array $data): string
{
    $data = array_filter($data, static fn ($v): bool => $v !== '' && $v !== null);

    return base64_encode(json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

/** @param array<string, mixed> $data */
function cdrEvent(array $data): array
{
    return ['UserEvent' => 'CdrConnector', 'AgiData' => encodeCdr($data)];
}

final class CallsHarness
{
    public SourceRecorder $recorder;
    public SourceStateRepository $states;
    public EventStore $store;
    public PdoHubDatabase $db;

    public function __construct()
    {
        $this->db = hubTestDatabase();
        $this->states = new SourceStateRepository($this->db);
        $this->store = new EventStore($this->db);
        $this->recorder = new SourceRecorder($this->states, $this->store);
    }

    /** @return list<array<string, mixed>> */
    public function rows(string $source = ''): array
    {
        $sql = 'SELECT source_id, event_type, severity, dedupe_key, occurred_at, payload_json FROM ' . EventStore::TABLE;
        if ($source === '') {
            return $this->db->fetchAll($sql . ' ORDER BY id');
        }

        return $this->db->fetchAll($sql . ' WHERE source_id = :source ORDER BY id', ['source' => $source]);
    }

    public function count(string $source = ''): int
    {
        return count($this->rows($source));
    }

    /** @return list<string> */
    public function keys(): array
    {
        return array_column($this->rows(), 'dedupe_key');
    }

    /** @return array<string, mixed> */
    public function payload(int $index): array
    {
        $rows = $this->rows();
        $payload = json_decode((string)($rows[$index]['payload_json'] ?? ''), true);

        return is_array($payload) ? $payload : [];
    }
}

/** @param array<string, array{user_id: ?int, name: string}>|null $map */
function queueHarness(int $minWait = 0, int $longWait = 0, ?array $map = null, array $names = []): array
{
    $h = new CallsHarness();
    $h->states->setEnabled(QueueAbandonSource::ID, true, 0);
    $source = new QueueAbandonSource(minWaitSec: $minWait, longWaitSec: $longWait, internalMap: $map, queueNames: $names);

    return [$h, $source];
}

$queueNames = ['800' => 'Продажи', '801' => ''];
$internalMap = InternalNumberMap::build(
    [['number' => '203', 'type' => 'SIP', 'userid' => 12], ['number' => '800', 'type' => 'QUEUE', 'userid' => null]],
    [['id' => 12, 'username' => 'Ivanov I.']]
);
$t0 = strtotime('2026-11-18 10:00:05');
$linkedid = 'mikopbx-1791068005.200';

// ======================= catalog & registry =======================
$catalog = SourceCatalog::class;
$ru = hubTestTexts();
foreach ([
    QueueAbandonSource::ID => 'EventTypeQueueAbandoned',
    CallOutOfHoursSource::ID => 'EventTypeCallOutOfHours',
    ParkTimeoutSource::ID => 'EventTypeParkTimeout',
] as $id => $typeKey) {
    check($catalog::group($id) === SourceCatalog::GROUP_CALLS, 'catalog: ' . $id . ' belongs to the calls group');
    check($catalog::eventTypes($id) === [$id], 'catalog: ' . $id . ' produces one event type');
    check($catalog::eventTypeKey($id) === 'module_messenger_hub_' . $typeKey, 'catalog: event type key of ' . $id);
    check($ru->t('module_messenger_hub_' . $typeKey) !== 'module_messenger_hub_' . $typeKey, 'catalog: ' . $id . ' has a Russian title');
    check($ru->t($catalog::nameKey($id)) !== $catalog::nameKey($id), 'catalog: ' . $id . ' has a Russian source name');
    check($catalog::sourceForEventType($id) === $id, 'catalog: ' . $id . ' maps back from its event type');
}
$registry = SourceRegistry::default();
$amiIds = array_map(static fn ($s): string => $s->id(), $registry->amiSources());
foreach ([QueueAbandonSource::ID, CallOutOfHoursSource::ID, ParkTimeoutSource::ID] as $id) {
    check(in_array($id, $amiIds, true), 'registry: ' . $id . ' listens to AMI');
    check($registry->find($id)?->mode() === SourceInterface::MODE_PUSH, 'registry: ' . $id . ' is a push source');
    check($registry->find($id)?->apiReadPaths() === [], 'registry: ' . $id . ' needs no API path');
    check($registry->find($id)?->amiUserEvents() === ['CdrConnector'], 'registry: ' . $id . ' subscribes to CdrConnector');
}
$templates = new TemplateRegistry();
$masked = new RenderContext(hubTestTexts(), new LinkBuilder('https://pbx.example'), true);
$unmasked = new RenderContext(hubTestTexts(), new LinkBuilder('https://pbx.example'), false);

// ======================= queue names =======================
$map = QueueNameMap::build([['extension' => '800', 'name' => ' Продажи '], ['extension' => ' ', 'name' => 'x'], ['extension' => '801', 'name' => '']]);
check($map === ['800' => 'Продажи', '801' => ''], 'queue names: trimmed, empty extension skipped');

// ======================= queue: abandoned =======================
[$h, $queue] = queueHarness(names: $queueNames);
check($queue->id() === QueueAbandonSource::ID && $queue->eventTypes() === [QueueAbandonSource::ID], 'queue: identity');
check($queue->mode() === SourceInterface::MODE_PUSH && $queue->pollIntervalSec() === 0, 'queue: push mode');
check($queue->poll(new \Modules\ModuleMessengerHub\Lib\Sources\SourceContext(
    new class implements \Modules\ModuleMessengerHub\Lib\Api\RestReader {
        public function get(string $path, array $query = []): array
        {
            throw new \RuntimeException('push source must not read REST');
        }
    },
    static fn (): int => 0
), [])->events === [], 'queue: poll is a silent baseline');

$queue->onAmiEvent(fixture('queue-start.json'), $h->recorder, $t0);
check($h->count() === 0, 'queue: nothing recorded while the call is still in the queue');
$queue->onAmiEvent(fixture('queue-end-abandoned.json'), $h->recorder, $t0 + 145);
$queue->tick($h->recorder, $t0 + 147);
check($h->count() === 0, 'queue: the verdict waits for the settle window');
$queue->tick($h->recorder, $t0 + 148);
$rows = $h->rows();
check(count($rows) === 1, 'queue: an unanswered queue leg produces exactly one event');
if (count($rows) === 1) {
    $row = $rows[0];
    $payload = $h->payload(0);
    $call = $payload['subject']['call'];
    check($row['source_id'] === QueueAbandonSource::ID && $row['event_type'] === QueueAbandonSource::ID, 'queue: source and type');
    check($row['dedupe_key'] === 'queue_abandon:' . $linkedid . ':800', 'queue: dedupe_key = queue_abandon:{linkedid}:{queue}');
    check($row['severity'] === HubEvent::SEVERITY_WARNING, 'queue: an abandonment is a warning');
    check((int)$row['occurred_at'] === strtotime('2026-11-18 10:02:30'), 'queue: occurred_at is the end of the queue leg');
    check($call['queue_number'] === '800' && $call['queue_name'] === 'Продажи', 'queue: number and name from Core CallQueues');
    check($call['waited_sec'] === 145, 'queue: wait = end - start of the queue leg');
    check($call['reason'] === QueueAbandonSource::REASON_ABANDONED, 'queue: reason abandoned');
    check($call['linkedid'] === $linkedid, 'queue: linkedid in the payload (same as core.missed_call)');
    check($call['direction'] === 'incoming', 'queue: an external caller is an incoming call');
    check($payload['subject']['client_number'] === '79000000001', 'queue: full client number stays in the payload');
}

// replay of the whole sequence (worker restart, AMI redelivery) -> the dedupe key holds
$queue->onAmiEvent(fixture('queue-start.json'), $h->recorder, $t0 + 600);
$queue->onAmiEvent(fixture('queue-end-abandoned.json'), $h->recorder, $t0 + 745);
$queue->tick($h->recorder, $t0 + 760);
check($h->count() === 1, 'queue: replay of the same call is deduped');
// the same end event delivered twice
[$h2, $queue2] = queueHarness(names: $queueNames);
$queue2->onAmiEvent(fixture('queue-start.json'), $h2->recorder, $t0);
$queue2->onAmiEvent(fixture('queue-end-abandoned.json'), $h2->recorder, $t0 + 145);
$queue2->onAmiEvent(fixture('queue-end-abandoned.json'), $h2->recorder, $t0 + 146);
$queue2->tick($h2->recorder, $t0 + 150);
check($h2->count() === 1, 'queue: a repeated queue_end is one event');

// ======================= queue: answered =======================
[$h3, $queue3] = queueHarness(names: $queueNames);
$queue3->onAmiEvent(fixture('queue-start.json'), $h3->recorder, $t0);
$queue3->onAmiEvent(fixture('queue-answer.json'), $h3->recorder, $t0 + 30);
$queue3->onAmiEvent(fixture('queue-end-answered.json'), $h3->recorder, $t0 + 185);
$queue3->tick($h3->recorder, $t0 + 190);
check($h3->count() === 0, 'queue: an answered call is not an abandonment');

// out of order: queue_end arrives before queue_answer, the answer still clears the abandonment
[$h4, $queue4] = queueHarness(names: $queueNames);
$queue4->onAmiEvent(fixture('queue-start.json'), $h4->recorder, $t0);
$queue4->onAmiEvent(fixture('queue-end-answered.json'), $h4->recorder, $t0 + 185);
$queue4->onAmiEvent(fixture('queue-answer.json'), $h4->recorder, $t0 + 186);
$queue4->tick($h4->recorder, $t0 + 195);
check($h4->count() === 0, 'queue: a late queue_answer cancels the abandonment');

// out of order: queue_end before queue_start (both inside the settle window)
[$h5, $queue5] = queueHarness(names: $queueNames);
$queue5->onAmiEvent(fixture('queue-end-abandoned.json'), $h5->recorder, $t0 + 145);
$queue5->onAmiEvent(fixture('queue-start.json'), $h5->recorder, $t0 + 146);
$queue5->tick($h5->recorder, $t0 + 150);
$rows = $h5->rows();
check(count($rows) === 1 && $h5->payload(0)['subject']['call']['queue_number'] === '800', 'queue: a start that arrives after the end is still used');

// ======================= queue: thresholds =======================
[$h6, $queue6] = queueHarness(60, 0, null, $queueNames);
$queue6->onAmiEvent(fixture('queue-start.json'), $h6->recorder, $t0);
$shortEnd = ['action' => 'queue_end', 'end' => '2026-11-18 10:00:35', 'id' => 'mikopbx-1791068005.201', 'dialstatus' => 'CONTINUE', 'linkedid' => $linkedid];
$queue6->onAmiEvent(cdrEvent($shortEnd), $h6->recorder, $t0 + 30);
$queue6->tick($h6->recorder, $t0 + 40);
check($h6->count() === 0, 'queue: a wait shorter than the minimum is not reported');
[$h7, $queue7] = queueHarness(60, 0, null, $queueNames);
$queue7->onAmiEvent(fixture('queue-start.json'), $h7->recorder, $t0);
$queue7->onAmiEvent(fixture('queue-end-abandoned.json'), $h7->recorder, $t0 + 145);
$queue7->tick($h7->recorder, $t0 + 150);
check($h7->count() === 1, 'queue: a wait above the minimum is reported');

// long wait threshold (off by default): an answered call waiting 400 s is reported as an info event
[$h8, $queue8] = queueHarness(0, 300, null, $queueNames);
$queue8->onAmiEvent(fixture('queue-start.json'), $h8->recorder, $t0);
$queue8->onAmiEvent(cdrEvent(['action' => 'queue_answer', 'answer' => '2026-11-18 10:06:45', 'id' => 'mikopbx-1791068005.201', 'linkedid' => $linkedid]), $h8->recorder, $t0 + 400);
$queue8->onAmiEvent(cdrEvent(['action' => 'queue_end', 'end' => '2026-11-18 10:10:00', 'id' => 'mikopbx-1791068005.201', 'dialstatus' => '', 'linkedid' => $linkedid]), $h8->recorder, $t0 + 595);
$queue8->tick($h8->recorder, $t0 + 600);
$rows = $h8->rows();
check(count($rows) === 1, 'queue: long-wait threshold reports an answered call');
if (count($rows) === 1) {
    check($rows[0]['severity'] === HubEvent::SEVERITY_INFO, 'queue: a long wait is info, not a warning');
    check($h8->payload(0)['subject']['call']['reason'] === QueueAbandonSource::REASON_LONG_WAIT, 'queue: reason long_wait');
    check($h8->payload(0)['subject']['call']['waited_sec'] === 595, 'queue: long wait is measured from start to end');
}
// the same answered call with the long-wait threshold off is silent
[$h9, $queue9] = queueHarness(0, 0, null, $queueNames);
$queue9->onAmiEvent(fixture('queue-start.json'), $h9->recorder, $t0);
$queue9->onAmiEvent(cdrEvent(['action' => 'queue_answer', 'answer' => '2026-11-18 10:06:45', 'id' => 'mikopbx-1791068005.201', 'linkedid' => $linkedid]), $h9->recorder, $t0 + 400);
$queue9->onAmiEvent(cdrEvent(['action' => 'queue_end', 'end' => '2026-11-18 10:10:00', 'id' => 'mikopbx-1791068005.201', 'dialstatus' => '', 'linkedid' => $linkedid]), $h9->recorder, $t0 + 595);
$queue9->tick($h9->recorder, $t0 + 600);
check($h9->count() === 0, 'queue: without the long-wait threshold an answered call is silent');

// thresholds are clamped by the source itself
[$h10, $queue10] = queueHarness(names: $queueNames);
$queue10->setThresholds(-10, 999999);
$thresholds = new ReflectionProperty(QueueAbandonSource::class, 'longWaitSec');
check($thresholds->getValue($queue10) === QueueAbandonSource::MAX_WAIT_SEC, 'queue: a long-wait threshold above the maximum is clamped');
$minimum = new ReflectionProperty(QueueAbandonSource::class, 'minWaitSec');
check($minimum->getValue($queue10) === 0, 'queue: a negative minimum is clamped to 0');

// ======================= queue: two legs, ambiguity, expiry, cap =======================
[$h11, $queue11] = queueHarness(names: $queueNames);
$startA = ['action' => 'queue_start', 'dst_num' => '800', 'UNIQUEID' => 'leg-a', 'linkedid' => $linkedid, 'src_num' => '79000000001', 'start' => '2026-11-18 10:00:05'];
$startB = ['action' => 'queue_start', 'dst_num' => '801', 'UNIQUEID' => 'leg-b', 'linkedid' => $linkedid, 'src_num' => '79000000001', 'start' => '2026-11-18 10:05:00'];
$queue11->onAmiEvent(cdrEvent($startA), $h11->recorder, $t0);
$queue11->onAmiEvent(cdrEvent($startB), $h11->recorder, $t0 + 295);
$queue11->onAmiEvent(cdrEvent(['action' => 'queue_end', 'end' => '2026-11-18 10:02:30', 'id' => 'leg-a', 'linkedid' => $linkedid]), $h11->recorder, $t0 + 146);
$queue11->onAmiEvent(cdrEvent(['action' => 'queue_end', 'end' => '2026-11-18 10:07:00', 'id' => 'leg-b', 'linkedid' => $linkedid]), $h11->recorder, $t0 + 416);
$queue11->tick($h11->recorder, $t0 + 420);
check($h11->count() === 2, 'queue: two queues of one call give two events');
check($h11->keys() === ['queue_abandon:' . $linkedid . ':800', 'queue_abandon:' . $linkedid . ':801'], 'queue: each queue has its own dedupe key');
// an end without an id is ambiguous when the call has two legs: ignored instead of guessed
[$h12, $queue12] = queueHarness(names: $queueNames);
$queue12->onAmiEvent(cdrEvent($startA), $h12->recorder, $t0);
$queue12->onAmiEvent(cdrEvent($startB), $h12->recorder, $t0 + 1);
$queue12->onAmiEvent(cdrEvent(['action' => 'queue_end', 'end' => '2026-11-18 10:02:30', 'linkedid' => $linkedid]), $h12->recorder, $t0 + 146);
$queue12->tick($h12->recorder, $t0 + 150);
check($h12->count() === 0, 'queue: an end without an id next to two legs is ignored');
// the same queue twice in one call collides on the agreed dedupe key: one message
[$h13, $queue13] = queueHarness(names: $queueNames);
$queue13->onAmiEvent(cdrEvent($startA), $h13->recorder, $t0);
$queue13->onAmiEvent(cdrEvent(['action' => 'queue_end', 'end' => '2026-11-18 10:02:30', 'id' => 'leg-a', 'linkedid' => $linkedid]), $h13->recorder, $t0 + 146);
$queue13->tick($h13->recorder, $t0 + 150);
$secondLeg = $startA;
$secondLeg['UNIQUEID'] = 'leg-a2';
$queue13->onAmiEvent(cdrEvent($secondLeg), $h13->recorder, $t0 + 200);
$queue13->onAmiEvent(cdrEvent(['action' => 'queue_end', 'end' => '2026-11-18 10:04:00', 'id' => 'leg-a2', 'linkedid' => $linkedid]), $h13->recorder, $t0 + 300);
$queue13->tick($h13->recorder, $t0 + 310);
check($h13->count() === 1, 'queue: a second visit to the same queue is deduped by the agreed key');

// an end event that never arrives expires (bounded memory)
[$h14, $queue14] = queueHarness(names: $queueNames);
$queue14->onAmiEvent(cdrEvent($startA), $h14->recorder, $t0);
$buffer = new ReflectionProperty(QueueAbandonSource::class, 'buffer');
check(count($buffer->getValue($queue14)) === 1, 'queue: an unfinished leg is buffered');
$queue14->tick($h14->recorder, $t0 + QueueAbandonSource::MAX_EPISODE_SEC + 1);
check(count($buffer->getValue($queue14)) === 0, 'queue: an unfinished leg expires');
check($h14->count() === 0, 'queue: an expired leg produces no event');

// the buffer is capped, the oldest leg goes first
$capped = new QueueAbandonSource(bufferCap: 2, queueNames: $queueNames);
$cappedHarness = new CallsHarness();
$cappedHarness->states->setEnabled(QueueAbandonSource::ID, true, 0);
for ($i = 0; $i < 3; $i++) {
    $leg = $startA;
    $leg['UNIQUEID'] = 'cap-' . $i;
    $leg['linkedid'] = 'cap-linkedid';
    $leg['dst_num'] = (string)(800 + $i);
    $capped->onAmiEvent(cdrEvent($leg), $cappedHarness->recorder, $t0 + $i);
}
$buffer = new ReflectionProperty(QueueAbandonSource::class, 'buffer');
check(count($buffer->getValue($capped)) === 2, 'queue: the buffer is bounded');
foreach ([0, 1, 2] as $i) {
    $capped->onAmiEvent(cdrEvent([
        'action' => 'queue_end', 'end' => '2026-11-18 10:02:30', 'id' => 'cap-' . $i, 'linkedid' => 'cap-linkedid',
    ]), $cappedHarness->recorder, $t0 + 200 + $i);
}
$capped->tick($cappedHarness->recorder, $t0 + 210);
check($cappedHarness->keys() === ['queue_abandon:cap-linkedid:801', 'queue_abandon:cap-linkedid:802'], 'queue: the evicted leg is dropped, the newest survive');

// ======================= queue: GZ payloads, noise, disabled =======================
[$h16, $queue16] = queueHarness(names: $queueNames);
$queue16->onAmiEvent(fixture('queue-start-gz.json'), $h16->recorder, $t0);
$queue16->onAmiEvent(fixture('queue-end-gz.json'), $h16->recorder, $t0 + 145);
$queue16->tick($h16->recorder, $t0 + 150);
check($h16->count() === 1, 'queue: GZ: encoded CdrConnector payloads are handled');
[$h17, $queue17] = queueHarness(names: $queueNames);
$queue17->onAmiEvent(['UserEvent' => 'CdrConnector', 'AgiData' => 'not-base64!!'], $h17->recorder, $t0);
$queue17->onAmiEvent(['UserEvent' => 'Other', 'AgiData' => agi('queue-start.json')], $h17->recorder, $t0);
$queue17->onAmiEvent(cdrEvent(['action' => 'queue_end', 'end' => '2026-11-18 10:02:30', 'id' => 'leg-a', 'linkedid' => $linkedid]), $h17->recorder, $t0 + 145);
$queue17->onAmiEvent(cdrEvent(['action' => 'queue_start', 'UNIQUEID' => 'x', 'linkedid' => '', 'dst_num' => '800']), $h17->recorder, $t0);
$queue17->tick($h17->recorder, $t0 + 150);
check($h17->count() === 0, 'queue: garbage, other user events, an end without a start and an empty linkedid are ignored');
$hOff = new CallsHarness();
$hOff->states->setEnabled(QueueAbandonSource::ID, false, 0);
$queueOff = new QueueAbandonSource(queueNames: $queueNames);
$queueOff->onAmiEvent(fixture('queue-start.json'), $hOff->recorder, $t0);
$queueOff->onAmiEvent(fixture('queue-end-abandoned.json'), $hOff->recorder, $t0 + 145);
$queueOff->tick($hOff->recorder, $t0 + 150);
check($hOff->count() === 0, 'queue: a disabled source records nothing');
// internal caller -> internal direction
[$h18, $queue18] = queueHarness(names: $queueNames, map: $internalMap);
$internalStart = ['action' => 'queue_start', 'dst_num' => '800', 'UNIQUEID' => 'leg-i', 'linkedid' => 'internal-linkedid', 'src_num' => '203', 'start' => '2026-11-18 10:00:05'];
$queue18->onAmiEvent(cdrEvent($internalStart), $h18->recorder, $t0);
$queue18->onAmiEvent(cdrEvent(['action' => 'queue_end', 'end' => '2026-11-18 10:01:00', 'id' => 'leg-i', 'linkedid' => 'internal-linkedid']), $h18->recorder, $t0 + 55);
$queue18->tick($h18->recorder, $t0 + 60);
check($h18->count() === 1 && $h18->payload(0)['subject']['call']['direction'] === 'internal', 'queue: an internal caller is an internal call');

// ======================= queue and missed call for the same linkedid =======================
$both = new CallsHarness();
$both->states->setEnabled(QueueAbandonSource::ID, true, 0);
$both->states->setEnabled(MissedCallSource::ID, true, 0);
$queueBoth = new QueueAbandonSource(queueNames: $queueNames, internalMap: $internalMap);
$missedBoth = new MissedCallSource(internalMap: $internalMap);
$queueBoth->onAmiEvent(fixture('queue-start.json'), $both->recorder, $t0);
$queueBoth->onAmiEvent(fixture('queue-end-abandoned.json'), $both->recorder, $t0 + 145);
$queueBoth->tick($both->recorder, $t0 + 150);
$missedLeg = [
    'action' => 'hangup_update_cdr', 'linkedid' => $linkedid, 'UNIQUEID' => 'mikopbx-1791068005.202',
    'src_num' => '79000000001', 'dst_num' => '800', 'dst_name' => '', 'did' => '4990000001',
    'disposition' => 'NOANSWER', 'GLOBAL_STATUS' => 'NOANSWER', 'start' => '2026-11-18 10:00:05',
    'endtime' => '2026-11-18 10:02:30', 'duration' => '145', 'billsec' => '0', 'recordingfile' => '',
];
$missedBoth->onAmiEvent(cdrEvent($missedLeg), $both->recorder, $t0 + 145);
$missedBoth->tick($both->recorder, $t0 + 165);
check($both->count() === 2, 'queue and missed call both fire for one linkedid (a rule chooses one)');
check($both->keys() === ['queue_abandon:' . $linkedid . ':800', 'missed:' . $linkedid], 'queue and missed call keep different dedupe keys');

// ======================= out of work time =======================
$ooh = new CallOutOfHoursSource();
check($ooh->id() === CallOutOfHoursSource::ID && $ooh->eventTypes() === [CallOutOfHoursSource::ID], 'ooh: identity');
check($ooh->mode() === SourceInterface::MODE_PUSH && $ooh->amiUserEvents() === ['CdrConnector'], 'ooh: push on CdrConnector');
$h19 = new CallsHarness();
$h19->states->setEnabled(CallOutOfHoursSource::ID, true, 0);
$ooh->onAmiEvent(fixture('out-of-hours.json'), $h19->recorder, $t0);
$rows = $h19->rows();
check(count($rows) === 1, 'ooh: an out-of-work-time call produces one event');
if (count($rows) === 1) {
    $payload = $h19->payload(0);
    $call = $payload['subject']['call'];
    check($rows[0]['dedupe_key'] === 'ooh:mikopbx-1791068005.300', 'ooh: dedupe_key = ooh:{linkedid}');
    check($rows[0]['severity'] === HubEvent::SEVERITY_WARNING, 'ooh: warning severity');
    check((int)$rows[0]['occurred_at'] === strtotime('2026-11-18 22:14:00'), 'ooh: occurred_at = call start');
    check($payload['subject']['client_number'] === '79000000001', 'ooh: masked caller comes from src_num');
    check($call['did'] === '4990000001', 'ooh: DID from the event');
    check($call['direction'] === 'incoming', 'ooh: out-of-work-time calls are incoming');
    check($call['linkedid'] === 'mikopbx-1791068005.300', 'ooh: linkedid in the payload');
    check($call['rule_id'] === null && $call['rule_name'] === '', 'ooh: no rule id in the event, no invented one');
}
$ooh->onAmiEvent(fixture('out-of-hours.json'), $h19->recorder, $t0 + 30);
check($h19->count() === 1, 'ooh: a repeated event is deduped');
$ooh->onAmiEvent(fixture('out-of-hours-gz.json'), $h19->recorder, $t0 + 60);
check($h19->count() === 1, 'ooh: GZ: payload handled and deduped');
$ooh->onAmiEvent(fixture('queue-start.json'), $h19->recorder, $t0);
$ooh->onAmiEvent(cdrEvent(['action' => 'dial_outworktimes', 'linkedid' => '']), $h19->recorder, $t0);
check($h19->count() === 1, 'ooh: other CdrConnector actions and an empty linkedid are ignored');
$hOff19 = new CallsHarness();
$hOff19->states->setEnabled(CallOutOfHoursSource::ID, false, 0);
$oohOff = new CallOutOfHoursSource();
$oohOff->onAmiEvent(fixture('out-of-hours.json'), $hOff19->recorder, $t0);
check($hOff19->count() === 0, 'ooh: a disabled source records nothing');

// ======================= park timeout =======================
$park = new ParkTimeoutSource();
check($park->id() === ParkTimeoutSource::ID && $park->eventTypes() === [ParkTimeoutSource::ID], 'park: identity');
check($park->mode() === SourceInterface::MODE_PUSH && $park->amiUserEvents() === ['CdrConnector'], 'park: push on CdrConnector');
$h20 = new CallsHarness();
$h20->states->setEnabled(ParkTimeoutSource::ID, true, 0);
$park->onAmiEvent(fixture('park-timeout.json'), $h20->recorder, $t0);
$rows = $h20->rows();
check(count($rows) === 1, 'park: a timed-out parked call produces one event');
if (count($rows) === 1) {
    $payload = $h20->payload(0);
    $call = $payload['subject']['call'];
    check($rows[0]['dedupe_key'] === 'park_timeout:mikopbx-1791068005.400', 'park: dedupe_key = park_timeout:{linkedid}');
    check($rows[0]['severity'] === HubEvent::SEVERITY_WARNING, 'park: warning severity');
    check((int)$rows[0]['occurred_at'] === strtotime('2026-11-18 10:41:00'), 'park: occurred_at = endtime');
    check($call['park_slot'] === '701', 'park: parking slot from dst_num');
    check($call['parked_by'] === '233', 'park: parked-by extension extracted from the PARKER channel');
    check($call['parked_sec'] === 45, 'park: parked duration = endtime - start');
    check($payload['subject']['client_number'] === '79000000001', 'park: the caller number');
}
$park->onAmiEvent(fixture('park-timeout.json'), $h20->recorder, $t0 + 30);
check($h20->count() === 1, 'park: a repeated event is deduped');
$park->onAmiEvent(fixture('park-timeout-gz.json'), $h20->recorder, $t0 + 60);
check($h20->count() === 1, 'park: GZ: payload handled and deduped');
$park->onAmiEvent(fixture('queue-start.json'), $h20->recorder, $t0);
$park->onAmiEvent(cdrEvent(['action' => 'unpark_call_timeout', 'linkedid' => '']), $h20->recorder, $t0);
check($h20->count() === 1, 'park: other actions and an empty linkedid are ignored');
check(ParkTimeoutSource::peerFromChannel('SIP/204-0000000a') === '204', 'park: channel suffix trimmed');
check(ParkTimeoutSource::peerFromChannel('Local/204@internal-0001') === '204', 'park: @domain and suffix trimmed');
check(ParkTimeoutSource::peerFromChannel('PJSIP/204-WS-0000000a') === '204-WS', 'park: a WebRTC endpoint keeps its suffix');
check(ParkTimeoutSource::peerFromChannel('') === '', 'park: empty channel -> empty parker');
$noParker = fixture('park-timeout.json');
$decoded = AgiDataDecoder::decode((string)$noParker['AgiData']);
unset($decoded['PARKER']);
$h21 = new CallsHarness();
$h21->states->setEnabled(ParkTimeoutSource::ID, true, 0);
$park->onAmiEvent(cdrEvent($decoded), $h21->recorder, $t0);
check($h21->count() === 1 && $h21->payload(0)['subject']['call']['parked_by'] === '', 'park: a missing PARKER leaves the field empty');
$hOff21 = new CallsHarness();
$hOff21->states->setEnabled(ParkTimeoutSource::ID, false, 0);
$parkOff = new ParkTimeoutSource();
$parkOff->onAmiEvent(fixture('park-timeout.json'), $hOff21->recorder, $t0);
check($hOff21->count() === 0, 'park: a disabled source records nothing');

// ======================= templates =======================
$queueEvent = QueueAbandonSource::buildEvent(
    ['linkedid' => $linkedid, 'queue' => '800', 'caller' => '79000000001', 'started_at' => $t0, 'ended_at' => $t0 + 145, 'first_seen' => $t0, 'last_seen' => $t0 + 145, 'answered_at' => 0, 'id' => 'leg', 'did' => '', 'seen_start' => true],
    QueueAbandonSource::REASON_ABANDONED,
    null,
    $queueNames,
    $t0 + 150
);
check($queueEvent instanceof HubEvent, 'queue: buildEvent works standalone');
$rendered = $templates->forEvent(QueueAbandonSource::ID)?->render($queueEvent, $masked);
check($rendered instanceof RenderedMessage, 'queue: template registered');
if ($rendered instanceof RenderedMessage) {
    check(str_contains($rendered->title, 'Клиент не дождался в очереди'), 'queue: template title from the catalog');
    check($rendered->lines[0] === '+7 900 ***-**-01', 'queue: the client number is masked in the message');
    check(in_array('Очередь: Продажи (800)', $rendered->lines, true), 'queue: queue name and number in the message');
    check(str_contains((string)($rendered->lines[count($rendered->lines) - 1] ?? ''), 'Ожидание 2:25'), 'queue: wait time in the message');
    check($rendered->footer === $linkedid, 'queue: linkedid in the footer');
    check($rendered->buttons !== [] && str_contains($rendered->buttons[0]['url'], 'call-detail-records'), 'queue: opens the CDR journal');
    check(!str_contains(json_encode($rendered->toArray(), JSON_THROW_ON_ERROR), '79000000001'), 'queue: the raw number does not leak into the message');
}
$longWaitEvent = QueueAbandonSource::buildEvent(
    ['linkedid' => $linkedid, 'queue' => '801', 'caller' => '79000000001', 'started_at' => $t0, 'ended_at' => $t0 + 400, 'first_seen' => $t0, 'last_seen' => $t0 + 400, 'answered_at' => $t0 + 400, 'id' => 'leg', 'did' => '', 'seen_start' => true],
    QueueAbandonSource::REASON_LONG_WAIT,
    null,
    $queueNames,
    $t0 + 400
);
$renderedLong = $longWaitEvent === null ? null : $templates->forEvent(QueueAbandonSource::ID)?->render($longWaitEvent, $unmasked);
check($renderedLong instanceof RenderedMessage && str_contains($renderedLong->title, 'долго ждал'), 'queue: long wait has its own headline');
check($renderedLong instanceof RenderedMessage && $renderedLong->lines[1] === 'Очередь: 801', 'queue: a queue without a name is shown by number');
check(QueueAbandonSource::buildEvent(
    ['linkedid' => $linkedid, 'queue' => '800', 'caller' => '', 'started_at' => 0, 'ended_at' => 0, 'first_seen' => 0, 'last_seen' => 0, 'answered_at' => 0, 'id' => '', 'did' => '', 'seen_start' => true],
    null,
    null,
    [],
    $t0
) === null, 'queue: no reason -> no event');

$oohEvent = CallOutOfHoursSource::buildEvent(AgiDataDecoder::decode(agi('out-of-hours.json')) ?? [], $t0);
$renderedOoh = $oohEvent === null ? null : $templates->forEvent(CallOutOfHoursSource::ID)?->render($oohEvent, $masked);
check($renderedOoh instanceof RenderedMessage, 'ooh: template registered');
if ($renderedOoh instanceof RenderedMessage) {
    check(str_contains($renderedOoh->title, 'Звонок в нерабочее время'), 'ooh: template title');
    check($renderedOoh->lines[0] === '+7 900 ***-**-01', 'ooh: the caller is masked');
    check(in_array('Номер входа: 4990000001', $renderedOoh->lines, true), 'ooh: the DID is shown');
    check($renderedOoh->footer === 'mikopbx-1791068005.300', 'ooh: linkedid in the footer');
}

$parkEvent = ParkTimeoutSource::buildEvent(AgiDataDecoder::decode(agi('park-timeout.json')) ?? [], $t0);
$renderedPark = $parkEvent === null ? null : $templates->forEvent(ParkTimeoutSource::ID)?->render($parkEvent, $masked);
check($renderedPark instanceof RenderedMessage, 'park: template registered');
if ($renderedPark instanceof RenderedMessage) {
    check(str_contains($renderedPark->title, 'Звонок с парковки не забрали'), 'park: template title');
    check($renderedPark->lines[0] === '+7 900 ***-**-01', 'park: the caller is masked');
    check(in_array('Место парковки: 701', $renderedPark->lines, true), 'park: the slot is shown');
    check(in_array('Припарковал: 233', $renderedPark->lines, true), 'park: the parker is shown');
    check(!str_contains(json_encode($renderedPark->toArray(), JSON_THROW_ON_ERROR), '79000000001'), 'park: the raw number does not leak into the message');
}

finish('call sources OK');
