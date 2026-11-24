<?php

declare(strict_types=1);

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Api\RestReader;
use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\Collector;
use Modules\ModuleMessengerHub\Lib\Sources\Core\AgiDataDecoder;
use Modules\ModuleMessengerHub\Lib\Sources\Core\AdviceSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\InternalNumberMap;
use Modules\ModuleMessengerHub\Lib\Sources\Core\MissedCallSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\PbxStartedSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\ProviderStatusSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\VoicemailSource;
use Modules\ModuleMessengerHub\Lib\Sources\ModuleStatusProbe;
use Modules\ModuleMessengerHub\Lib\Sources\SourceAvailability;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceException;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRecorder;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRegistry;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Modules\ModuleMessengerHub\Lib\Sources\SourceTicker;
use Modules\ModuleMessengerHub\Lib\Sources\TickingSource;

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

final class FakeRestReader implements RestReader
{
    public int $calls = 0;

    /** @param array<mixed> $data */
    public function __construct(private readonly array $data)
    {
    }

    public function get(string $path, array $query = []): array
    {
        $this->calls++;
        if ($path !== AdviceSource::PATH) {
            throw new SourceException('api_not_found');
        }

        return $this->data;
    }
}

final class OkProbe implements ModuleStatusProbe
{
    public function status(string $moduleUniqueId): string
    {
        return SourceAvailability::AVAILABLE;
    }
}

final class PushHarness
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
    public function rows(): array
    {
        return $this->db->fetchAll(
            'SELECT source_id, event_type, severity, dedupe_key, occurred_at, payload_json FROM '
            . EventStore::TABLE . ' ORDER BY id'
        );
    }

    public function count(): int
    {
        return count($this->rows());
    }

    /** @return list<array<string, mixed>> stored rows of the advice source */
    public function pollOnce(RestReader $rest, int $now): array
    {
        $collector = new Collector([new AdviceSource()], $this->states, $this->store, new OkProbe(), new SourceContext($rest, static fn (): int => $now));
        $collector->runOnce();

        return $this->db->fetchAll(
            'SELECT * FROM ' . EventStore::TABLE . ' WHERE source_id = :source ORDER BY id',
            ['source' => AdviceSource::ID]
        );
    }
}

// ======================= registry =======================
$registry = SourceRegistry::default();
check(count($registry->all()) === 20, 'registry: 8 core + 9 module sources');
check($registry->find(MissedCallSource::ID) instanceof MissedCallSource, 'registry: missed_call');
check($registry->find(VoicemailSource::ID) instanceof VoicemailSource, 'registry: voicemail');
check($registry->find(ProviderStatusSource::ID) instanceof ProviderStatusSource, 'registry: provider_status');
check($registry->find(PbxStartedSource::ID) instanceof PbxStartedSource, 'registry: pbx_started');
check($registry->find(AdviceSource::ID) instanceof AdviceSource, 'registry: advice');
check($registry->apiReadPaths([AdviceSource::ID]) === ['/api/v3/advice'], 'registry: advice contributes its path');
check($registry->apiReadPaths([MissedCallSource::ID, ProviderStatusSource::ID]) === [], 'registry: push sources need no paths');
check(count($registry->pollSources()) === 12, 'registry: advice, external IP, license plus the nine module sources are polled');
check(count($registry->amiSources()) === 5, 'registry: five AMI sources');

// ======================= AgiDataDecoder =======================
$incomingMissed = fixture('core-missed-call/incoming-missed.json');
$decoded = AgiDataDecoder::decode($incomingMissed['AgiData']);
check(is_array($decoded) && ($decoded['action'] ?? '') === 'hangup_update_cdr', 'decoder: plain base64 payload');
check(($decoded['GLOBAL_STATUS'] ?? '') === 'NOANSWER', 'decoder: fields preserved');
$decodedGz = AgiDataDecoder::decode(fixture('core-missed-call/incoming-missed-gz.json')['AgiData']);
check(is_array($decodedGz) && ($decodedGz['linkedid'] ?? '') !== '', 'decoder: GZ: payload');
check(AgiDataDecoder::decode('not-base64!!!') === null, 'decoder: garbage rejected');
check(AgiDataDecoder::decode(base64_encode('not json')) === null, 'decoder: non-json rejected');
check(AgiDataDecoder::decode('') === null, 'decoder: empty rejected');

// ======================= missed calls =======================
$internalMap = InternalNumberMap::build(
    [
        ['number' => '203', 'type' => 'SIP', 'userid' => 12],
        ['number' => '204', 'type' => 'SIP', 'userid' => 13],
        ['number' => '205', 'type' => 'SIP', 'userid' => 14],
        ['number' => '800', 'type' => 'QUEUE', 'userid' => null],
        ['number' => '206', 'type' => 'SIP', 'userid' => null],
        ['number' => '79000000009', 'type' => 'EXTERNAL', 'userid' => 12], // mobile of an employee: not internal
        ['number' => '', 'type' => 'SIP', 'userid' => 12],
    ],
    [['id' => 12, 'username' => 'Ivanov I.'], ['id' => 13, 'username' => 'Sidorov S.'], ['id' => 14, 'username' => 'Petrov P.']]
);
check(count($internalMap) === 5 && !isset($internalMap['79000000009']), 'map: SIP/QUEUE kept, EXTERNAL and empty numbers dropped');
check($internalMap['203'] === ['user_id' => 12, 'name' => 'Ivanov I.'], 'map: user id and name from Users');
check($internalMap['800'] === ['user_id' => null, 'name' => ''] && $internalMap['206']['user_id'] === null, 'map: queue / userless extension are internal without employee');

$h = new PushHarness();
$source = new MissedCallSource(internalMap: $internalMap);
check($source->id() === 'core.missed_call' && $source->eventTypes() === ['core.missed_call'], 'missed: identity');
check($source->mode() === SourceInterface::MODE_PUSH, 'missed: push mode');
check($source->apiReadPaths() === [] && $source->requiredModule() === null, 'missed: core source, no paths');
check($source->amiUserEvents() === ['CdrConnector'], 'missed: subscribes to CdrConnector');

$h->states->setEnabled(MissedCallSource::ID, true, 0);
$t0 = strtotime('2026-11-18 10:00:35');
$source->onAmiEvent($incomingMissed, $h->recorder, $t0);
check($h->count() === 0, 'missed: nothing stored before silence elapses');
$source->tick($h->recorder, $t0 + 14);
check($h->count() === 0, 'missed: 14s of silence still buffers');
$source->tick($h->recorder, $t0 + 15);
$rows = $h->rows();
check(count($rows) === 1, 'missed: exactly one event after 15s of silence');
if (count($rows) === 1) {
    $row = $rows[0];
    $payload = json_decode((string)$row['payload_json'], true, 8, JSON_THROW_ON_ERROR);
    check($row['dedupe_key'] === 'missed:mikopbx-1791068005.100', 'missed: dedupe_key = missed:{linkedid}');
    check($row['event_type'] === 'core.missed_call' && $row['source_id'] === 'core.missed_call', 'missed: type and source');
    check($row['severity'] === HubEvent::SEVERITY_WARNING, 'missed: incoming is warning');
    check((int)$row['occurred_at'] === $t0, 'missed: occurred_at = endtime');
    check(($payload['subject']['call']['direction'] ?? '') === 'incoming', 'missed: direction incoming (DID present)');
    check(($payload['subject']['client_number'] ?? '') === '79000000001', 'missed: client number');
    check(($payload['subject']['employees'][0]['number'] ?? '') === '203', 'missed: employee number');
    check(($payload['subject']['employees'][0]['user_id'] ?? null) === 12 && ($payload['subject']['employees'][0]['name'] ?? '') === 'Ivanov I.', 'missed: employee user_id and name from the map');
    check(($payload['subject']['call']['duration_sec'] ?? -1) === 30, 'missed: duration');
}

// replay of the same AMI event (worker restart) must not duplicate
$replay = new MissedCallSource(internalMap: $internalMap);
$replay->onAmiEvent($incomingMissed, $h->recorder, $t0 + 600);
$replay->tick($h->recorder, $t0 + 615);
check($h->count() === 1, 'missed: replay after flush deduped by dedupe_key');

// answered call: no event
$answered = new MissedCallSource(internalMap: $internalMap);
$answered->onAmiEvent(fixture('core-missed-call/incoming-answered.json'), $h->recorder, $t0);
$answered->tick($h->recorder, $t0 + 15);
check($h->count() === 1, 'missed: answered call produces no event');

// GZ payload
$gz = new MissedCallSource(internalMap: $internalMap);
$gz->onAmiEvent(fixture('core-missed-call/incoming-missed-gz.json'), $h->recorder, $t0);
$gz->tick($h->recorder, $t0 + 15);
check($h->count() === 2, 'missed: GZ-encoded payload handled');

// wrong action / broken payload / other UserEvents are ignored
$noise = new MissedCallSource(internalMap: $internalMap);
$noise->onAmiEvent(['UserEvent' => 'CdrConnector', 'AgiData' => base64_encode('{"action":"other"}')], $h->recorder, $t0);
$noise->onAmiEvent(['UserEvent' => 'CdrConnector', 'AgiData' => '!!!!'], $h->recorder, $t0);
$noise->onAmiEvent(['UserEvent' => 'OtherEvent', 'AgiData' => 'aXZhbGlk'], $h->recorder, $t0);
$noise->tick($h->recorder, $t0 + 15);
check($h->count() === 2, 'missed: non-hangup payloads ignored');

// pure direction/client/employees building from decoded legs
$internalLeg = AgiDataDecoder::decode(fixture('core-missed-call/internal-missed.json')['AgiData']);
unset($internalLeg['action']);
$internalEvent = MissedCallSource::buildEvent([$internalLeg], $t0, $internalMap);
check($internalEvent instanceof HubEvent, 'missed: internal builds event');
check($internalEvent->payload['subject']['call']['direction'] === 'internal', 'missed: direction internal (no DID)');
check($internalEvent->severity === HubEvent::SEVERITY_INFO, 'missed: internal is info');
check($internalEvent->payload['subject']['client_number'] === '203', 'missed: internal client = caller');
check($internalEvent->payload['subject']['employees'][0]['number'] === '204' && $internalEvent->payload['subject']['employees'][0]['user_id'] === 13, 'missed: internal employee = called number with user_id');

$outgoingLeg = AgiDataDecoder::decode(fixture('core-missed-call/outgoing-missed.json')['AgiData']);
unset($outgoingLeg['action']);
$outgoingEvent = MissedCallSource::buildEvent([$outgoingLeg], $t0, $internalMap);
check($outgoingEvent->payload['subject']['call']['direction'] === 'outgoing', 'missed: direction outgoing');
check($outgoingEvent->payload['subject']['client_number'] === '79000000002', 'missed: outgoing client = dialed number');
check($outgoingEvent->payload['subject']['employees'] === [], 'missed: no employees for external destination');
check(MissedCallSource::buildEvent([], $t0, $internalMap) === null, 'missed: no legs -> no event');

// direction rules (no more digit-length heuristic)
$leg = static fn (string $src, string $dst, string $did = ''): array => ['linkedid' => 'd', 'src_num' => $src, 'dst_num' => $dst, 'did' => $did];
check(MissedCallSource::direction([$leg('79000000001', '203')], $internalMap) === 'incoming', 'direction: external -> internal without DID is incoming');
check(MissedCallSource::direction([$leg('203', '204')], $internalMap) === 'internal', 'direction: internal -> internal');
check(MissedCallSource::direction([$leg('203', '800')], $internalMap) === 'internal', 'direction: internal -> queue is internal');
check(MissedCallSource::direction([$leg('203', '79000000002')], $internalMap) === 'outgoing', 'direction: internal -> external is outgoing');
check(MissedCallSource::direction([$leg('203', '79000000002'), $leg('203', '204', 'x')], $internalMap) === 'incoming', 'direction: any DID leg wins');
check(MissedCallSource::direction([$leg('2000', '2001')], $internalMap) === 'outgoing', 'direction: short digit strings that are not extensions are NOT internal');
check(MissedCallSource::direction([$leg('203', '79000000009')], $internalMap) === 'outgoing', 'direction: employee mobile (EXTERNAL) is not internal');
$mixed = MissedCallSource::buildEvent([$leg('79000000001', '203'), $leg('79000000001', '206'), $leg('79000000001', '203'), $leg('79000000001', '800')], $t0, $internalMap);
check($mixed instanceof HubEvent && count($mixed->payload['subject']['employees']) === 1, 'missed: employees only users, deduped (userless 206 and queue 800 skipped)');

// map not loaded yet: nothing is decided, the buffer waits
$h9 = new PushHarness();
$h9->states->setEnabled(MissedCallSource::ID, true, 0);
$wait = new MissedCallSource();
check(!$wait->hasInternalMap(), 'missed: map unset by default');
$wait->onAmiEvent($incomingMissed, $h9->recorder, $t0);
$wait->tick($h9->recorder, $t0 + 60);
check($h9->count() === 0, 'missed: no decision while the internal map is not loaded');
$wait->setInternalMap($internalMap);
$wait->tick($h9->recorder, $t0 + 61);
check($h9->count() === 1, 'missed: buffered call decided once the map arrives');

// bounded buffer: oldest entries dropped
$capped = new MissedCallSource(silenceSec: 15, bufferCap: 3, internalMap: $internalMap);
$encode = static function (array $leg): string {
    return base64_encode(json_encode($leg + ['action' => 'hangup_update_cdr'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
};
for ($i = 0; $i < 5; $i++) {
    $leg = $internalLeg;
    $leg['linkedid'] = 'cap-' . $i;
    $leg['UNIQUEID'] = 'cap-' . $i;
    $capped->onAmiEvent(['UserEvent' => 'CdrConnector', 'AgiData' => $encode($leg)], $h->recorder, $t0);
}
$bufferProp = new \ReflectionProperty(MissedCallSource::class, 'buffer');
check(count($bufferProp->getValue($capped)) === 3, 'missed: buffer is bounded');
$capped->tick($h->recorder, $t0 + 15);
$capKeys = array_column($h->rows(), 'dedupe_key');
check(!in_array('missed:cap-0', $capKeys, true) && in_array('missed:cap-3', $capKeys, true), 'missed: oldest buffered calls dropped first');

// disabled source records nothing
$h2 = new PushHarness();
$h2->states->setEnabled(MissedCallSource::ID, false, 0);
$off = new MissedCallSource(internalMap: $internalMap);
$off->onAmiEvent($incomingMissed, $h2->recorder, $t0);
$off->tick($h2->recorder, $t0 + 15);
check($h2->count() === 0, 'missed: disabled source must not record');

// ======================= voicemail =======================
$h3 = new PushHarness();
$vm = new VoicemailSource();
check($vm->id() === 'core.voicemail' && $vm->eventTypes() === ['core.voicemail'], 'voicemail: identity');
check($vm->amiUserEvents() === ['voicemail_end'], 'voicemail: subscribes to voicemail_end');
$h3->states->setEnabled(VoicemailSource::ID, true, 0);
$vm->onAmiEvent(fixture('core-voicemail/voicemail-end.json'), $h3->recorder, $t0);
$rows = $h3->rows();
check(count($rows) === 1, 'voicemail: enabled source records one event');
if (count($rows) === 1) {
    $row = $rows[0];
    $payload = json_decode((string)$row['payload_json'], true, 8, JSON_THROW_ON_ERROR);
    check($row['dedupe_key'] === 'voicemail:mikopbx-1791068005.100', 'voicemail: dedupe_key = voicemail:{linkedid}');
    check($row['severity'] === HubEvent::SEVERITY_INFO, 'voicemail: info severity');
    check(($payload['attachments'][0]['path'] ?? '') === '/storage/usbdisk1/mikopbx/voicemail/2026/11/18/msg0000.mp3', 'voicemail: recording as attachment reference');
    check((int)$row['occurred_at'] === strtotime('2026-11-18 10:02:00'), 'voicemail: occurred_at = endtime');
}
$vm->onAmiEvent(fixture('core-voicemail/voicemail-end.json'), $h3->recorder, $t0);
check($h3->count() === 1, 'voicemail: replay deduped');
$h3->states->setEnabled(VoicemailSource::ID, false, 0);
$vmOff = new VoicemailSource();
$vmOff->onAmiEvent(['UserEvent' => 'voicemail_end', 'linkedid' => 'other'], $h3->recorder, $t0);
check($h3->count() === 1, 'voicemail: disabled source must not record');
check(VoicemailSource::buildEvent(['linkedid' => ''], $t0) === null, 'voicemail: empty linkedid ignored');

// ======================= provider status =======================
$h4 = new PushHarness();
$ps = new ProviderStatusSource();
check($ps->id() === 'core.provider_status', 'provider: id');
check($ps->eventTypes() === ['core.provider_down', 'core.provider_up'], 'provider: event types');
check($ps->mode() === SourceInterface::MODE_PUSH && $ps->apiReadPaths() === [], 'provider: push, no paths');
check(ProviderStatusSource::eventTypeForState('UNREGISTERED') === 'core.provider_down', 'provider: unregistered -> down');
check(ProviderStatusSource::eventTypeForState('rejected') === 'core.provider_down', 'provider: rejected -> down');
check(ProviderStatusSource::eventTypeForState('lagged') === 'core.provider_down', 'provider: lagged -> down');
check(ProviderStatusSource::eventTypeForState('registered') === 'core.provider_up', 'provider: registered -> up');
check(ProviderStatusSource::eventTypeForState('OK') === 'core.provider_up', 'provider: OK -> up');
check(ProviderStatusSource::eventTypeForState('UNKNOWN') === null, 'provider: UNKNOWN ignored');
check(ProviderStatusSource::eventTypeForState('REMOVED') === null, 'provider: REMOVED ignored');

check($ps instanceof TickingSource, 'provider: ticking source');
check(ProviderStatusSource::DEBOUNCE_SEC === 120, 'provider: 120 s debounce');

/** Drives hook + tick like production: hook stores state in the cursor, tick flushes it. */
final class ProviderSim
{
    public PushHarness $h;
    public ProviderStatusSource $source;

    public function __construct(bool $enabled = true)
    {
        $this->h = new PushHarness();
        $this->source = new ProviderStatusSource();
        $this->h->states->setEnabled(ProviderStatusSource::ID, $enabled, 0);
    }

    public function hook(string $newState, int $ts, string $id = 'SIP-TRUNK-0001'): void
    {
        $state = $this->h->states->get(ProviderStatusSource::ID);
        if (!$state['enabled']) {
            return; // the production hook returns early when the source is disabled
        }
        $old = $state['cursor']['providers'] ?? [];
        $new = ProviderStatusSource::applyChanges(
            [['provider_id' => $id, 'type' => 'sip', 'old_state' => '', 'new_state' => $newState, 'host' => 'sip.example.net', 'timestamp' => $ts]],
            $old,
            $ts
        );
        $this->h->states->saveCursor(ProviderStatusSource::ID, ['providers' => $new]);
    }

    public function tick(int $now): void
    {
        (new SourceTicker(new SourceRegistry([$this->source]), $this->h->states, $this->h->recorder))->run($now);
    }

    /** @return list<string> */
    public function keys(): array
    {
        return array_column($this->h->rows(), 'dedupe_key');
    }
}

$T = 1791068000;
// down -> up within 60 s: the first state ever seen was down but never held; recovery baseline is silent
$sim = new ProviderSim();
$sim->hook('unregistered', $T);
$sim->tick($T + 30);
$sim->hook('registered', $T + 60);
foreach ([$T + 61, $T + 120, $T + 200, $T + 400] as $now) {
    $sim->tick($now);
}
check($sim->h->count() === 0, 'provider: down->up within 60 s -> 0 events');

// down held 3 minutes -> exactly one down event, stable dedupe key, repeated ticks do not duplicate
$sim = new ProviderSim();
$sim->hook('unregistered', $T);
$sim->tick($T + 119);
check($sim->h->count() === 0, 'provider: not announced before the debounce elapsed');
foreach ([$T + 120, $T + 125, $T + 180, $T + 600] as $now) {
    $sim->tick($now);
}
check($sim->keys() === ['provider:SIP-TRUNK-0001:down:' . $T], 'provider: down held 3 min -> one down event keyed by change ts');
$row = $sim->h->rows()[0];
$payload = json_decode((string)$row['payload_json'], true, 8, JSON_THROW_ON_ERROR);
check($row['event_type'] === 'core.provider_down' && $row['severity'] === HubEvent::SEVERITY_CRITICAL, 'provider: down is critical');
check($payload['subject']['provider']['host'] === 'sip.example.net' && $payload['subject']['provider']['id'] === 'SIP-TRUNK-0001', 'provider: payload carries id and host');
check((int)$row['occurred_at'] === $T, 'provider: occurred_at = time of change');

// down 3 min, then up 3 min -> down + up (the recovery is NOT swallowed)
$sim->hook('registered', $T + 300);
$sim->tick($T + 360);
check(count($sim->keys()) === 1, 'provider: up not announced before it held');
$sim->tick($T + 420);
$sim->tick($T + 425);
check($sim->keys() === ['provider:SIP-TRUNK-0001:down:' . $T, 'provider:SIP-TRUNK-0001:up:' . ($T + 300)], 'provider: down then up both emitted');
check($sim->h->rows()[1]['severity'] === HubEvent::SEVERITY_INFO, 'provider: up is info');

// recovery right after a down inside what used to be the 5-minute cooldown still arrives (the blocker)
$sim = new ProviderSim();
$sim->hook('unregistered', $T);
$sim->tick($T + 130);
$sim->hook('registered', $T + 150);
$sim->tick($T + 280);
check(count($sim->keys()) === 2 && str_contains($sim->keys()[1], ':up:'), 'provider: up 150 s after down is announced, provider never stays "down forever"');

// rapid flapping that settles down: at most one event per settled state, final state converges
$sim = new ProviderSim();
$sim->hook('unregistered', $T);
$sim->hook('registered', $T + 10);
$sim->hook('unregistered', $T + 20);
$sim->hook('registered', $T + 30);
$sim->hook('unregistered', $T + 40);
foreach ([$T + 60, $T + 100, $T + 159] as $now) {
    $sim->tick($now);
}
check($sim->h->count() === 0, 'provider: flapping inside the debounce emits nothing');
$sim->tick($T + 160);
$sim->tick($T + 400);
check($sim->keys() === ['provider:SIP-TRUNK-0001:down:' . ($T + 40)], 'provider: settled down -> exactly one down event');
// flapping back after a down was announced: down->up->down quickly -> no extra event, still converged on down
$sim->hook('registered', $T + 500);
$sim->hook('unregistered', $T + 510);
$sim->tick($T + 700);
check(count($sim->keys()) === 1, 'provider: quick up/down blip after an announced down emits nothing');
// last emitted always converges to the actual state
$cursor = $sim->h->states->get(ProviderStatusSource::ID)['cursor']['providers']['SIP-TRUNK-0001'];
check($cursor['state'] === 'down' && $cursor['emitted'] === 'down', 'provider: emitted state converged to actual state');
$sim->hook('registered', $T + 800);
$sim->tick($T + 920);
$cursor = $sim->h->states->get(ProviderStatusSource::ID)['cursor']['providers']['SIP-TRUNK-0001'];
check($cursor['state'] === 'up' && $cursor['emitted'] === 'up' && count($sim->keys()) === 2, 'provider: converged to up after recovery');

// first ever state "up" is a silent baseline (no spam for every provider on install)
$sim = new ProviderSim();
$sim->hook('registered', $T, 'SIP-TRUNK-0002');
$sim->hook('OK', $T, 'IAX-TRUNK-0003');
$sim->tick($T + 300);
check($sim->h->count() === 0, 'provider: first seen "up" emits nothing');
$cursor = $sim->h->states->get(ProviderStatusSource::ID)['cursor']['providers'];
check($cursor['SIP-TRUNK-0002']['emitted'] === 'up', 'provider: baseline "up" is recorded as emitted');
$sim->hook('unregistered', $T + 400, 'SIP-TRUNK-0002');
$sim->tick($T + 520);
check($sim->keys() === ['provider:SIP-TRUNK-0002:down:' . ($T + 400)], 'provider: down after silent up baseline is announced');

// unknown/removed states are ignored; other providers are independent
$sim = new ProviderSim();
$sim->hook('UNKNOWN', $T);
$sim->hook('REMOVED', $T);
$sim->hook('unreachable', $T, 'SIP-TRUNK-0004');
$sim->tick($T + 200);
check($sim->keys() === ['provider:SIP-TRUNK-0004:down:' . $T], 'provider: UNKNOWN/REMOVED ignored, providers independent');

// disabled source: hook stores nothing, tick emits nothing and leaves the cursor alone
$sim = new ProviderSim(enabled: false);
$sim->hook('unregistered', $T);
$sim->tick($T + 500);
check($sim->h->count() === 0 && $sim->h->states->get(ProviderStatusSource::ID)['cursor'] === [], 'provider: disabled source -> nothing');
// enabled, state stored, then disabled before the flush: tick must not emit
$sim = new ProviderSim();
$sim->hook('unregistered', $T);
$sim->h->states->setEnabled(ProviderStatusSource::ID, false, $T + 10);
$sim->tick($T + 500);
check($sim->h->count() === 0, 'provider: source disabled before flush -> nothing emitted');
$sim->h->states->setEnabled(ProviderStatusSource::ID, true, $T + 600);
$sim->tick($T + 700);
check($sim->h->count() === 0, 'provider: re-enabling resets the cursor, history is not broadcast');

// pure flush: replays are idempotent through the event store
$providers = ProviderStatusSource::applyChanges([['provider_id' => 'P', 'new_state' => 'rejected', 'timestamp' => $T]], [], $T);
[$ev1, $after] = ProviderStatusSource::flush($providers, 120, $T + 130);
[$ev2] = ProviderStatusSource::flush($after, 120, $T + 140);
check(count($ev1) === 1 && $ev2 === [], 'provider: flush emits once per settled state');

// compare-and-swap protects the hook/tick shared cursor
$h10 = new PushHarness();
$st = $h10->states;
$st->saveCursor(ProviderStatusSource::ID, ['providers' => ['a' => 1]]);
check($st->compareAndSaveCursor(ProviderStatusSource::ID, ['providers' => ['a' => 1]], ['providers' => ['a' => 2]]), 'cas: matching expectation writes');
check(!$st->compareAndSaveCursor(ProviderStatusSource::ID, ['providers' => ['a' => 1]], ['providers' => ['a' => 3]]), 'cas: stale expectation refused');
check($st->get(ProviderStatusSource::ID)['cursor'] === ['providers' => ['a' => 2]], 'cas: stale write did not change the cursor');
$h11 = new PushHarness();
check($h11->states->compareAndSaveCursor(ProviderStatusSource::ID, [], ['providers' => []]), 'cas: empty cursor is matched by []');

// ======================= advice (poll through Collector) =======================
$h5 = new PushHarness();
$advice = new AdviceSource();
check($advice->id() === 'core.advice' && $advice->eventTypes() === ['core.advice'], 'advice: identity');
check($advice->mode() === SourceInterface::MODE_POLL, 'advice: poll mode');
check($advice->apiReadPaths() === ['/api/v3/advice'], 'advice: api path');
check($advice->pollIntervalSec() >= 30, 'advice: sane interval');

$now = strtotime('2026-11-18 12:00:00');
$report = $h5->pollOnce(new FakeRestReader(fixture('core-advice/snapshot-1.json')), $now);
check($report === [], 'advice: baseline poll records nothing');
$cursor = json_decode((string)($h5->db->fetchOne('SELECT cursor_json FROM m_MessengerHubSourceState WHERE source_id = :id', ['id' => AdviceSource::ID])['cursor_json'] ?? ''), true);
check(is_array($cursor['seen'] ?? null) && count($cursor['seen']) === 2, 'advice: baseline cursor holds the fingerprint set');
check(isset($cursor['seen']['adv_ProblemWithInternetConnection:' . md5('[]')]), 'advice: fingerprint = tpl + hash(params)');

// new warning appears -> one event; the info item and the string marker never alert
$snapshot2 = fixture('core-advice/snapshot-2.json'); // warning gone, new error, info stays
$h6 = new PushHarness();
$h6->pollOnce(new FakeRestReader(fixture('core-advice/snapshot-1.json')), $now);
$h6->pollOnce(new FakeRestReader($snapshot2), $now + 60);
$rows = $h6->rows();
check(count($rows) === 1, 'advice: one event for the newly appeared error, none for the disappeared warning');
if (count($rows) === 1) {
    $row = $rows[0];
    $payload = json_decode((string)$row['payload_json'], true, 8, JSON_THROW_ON_ERROR);
    check($row['event_type'] === 'core.advice' && $row['severity'] === HubEvent::SEVERITY_CRITICAL, 'advice: error level -> critical');
    $today = date('Y-m-d', $now + 60);
    $expectedKey = 'advice:adv_SipPasswordWeak:' . md5('{"record":"203"}') . ':' . $today;
    check($row['dedupe_key'] === $expectedKey, 'advice: dedupe_key = advice:{tpl}:{hash}:{day}');
    check(($payload['subject']['advice']['message_tpl'] ?? '') === 'adv_SipPasswordWeak', 'advice: payload carries messageTpl');
    check(($payload['subject']['advice']['params'] ?? []) === ['record' => '203'], 'advice: payload carries params');
}

// repeated poll with the same snapshot -> no duplicates
$h6->pollOnce(new FakeRestReader($snapshot2), $now + 120);
check($h6->count() === 1, 'advice: repeated poll does not duplicate');

// warning returns the next day -> within the retention period: no new event
$nextDay = strtotime('2026-11-19 12:00:00');
$h6->pollOnce(new FakeRestReader(fixture('core-advice/snapshot-3.json')), $nextDay);
check($h6->count() === 1, 'advice: warning that came back within the retention period stays silent');

// failing REST marks the source unavailable
$h7 = new PushHarness();
$h7->states->setEnabled(AdviceSource::ID, true, 0);
$h7->pollOnce(new class implements RestReader {
    public function get(string $path, array $query = []): array
    {
        throw new SourceException('api_unauthorized');
    }
}, $now);
$state = $h7->states->get(AdviceSource::ID);
check($state['availability'] === SourceAvailability::API_FORBIDDEN, 'advice: 401 -> api_forbidden availability');

// ======================= pbx started =======================
$h8 = new PushHarness();
$pbs = new PbxStartedSource();
check($pbs->id() === 'core.pbx_started' && $pbs->eventTypes() === ['core.pbx_started'], 'pbx_started: identity');
check($pbs->mode() === SourceInterface::MODE_PUSH && $pbs->apiReadPaths() === [], 'pbx_started: push, no paths');
$bootTime = 1791060000;
$event = PbxStartedSource::buildEvent($bootTime, $bootTime + 25);
check($event instanceof HubEvent, 'pbx_started: event built');
check($event->dedupeKey === 'pbx_started:' . $bootTime, 'pbx_started: dedupe by boot time');
check($event->occurredAt === $bootTime, 'pbx_started: occurred_at = boot time');
check(PbxStartedSource::buildEvent(0, $now) === null, 'pbx_started: unknown boot time -> no event');
$h8->states->setEnabled(PbxStartedSource::ID, true, 0);
$h8->recorder->record($event, $bootTime + 25);
$h8->recorder->record($event, $bootTime + 30);
check($h8->count() === 1, 'pbx_started: duplicate hook call deduped');
$h8->recorder->record(PbxStartedSource::buildEvent($bootTime + 3600, $bootTime + 3620) ?? $event, $bootTime + 3620);
check($h8->count() === 2, 'pbx_started: a real restart produces a new event');

finish('core sources OK');
