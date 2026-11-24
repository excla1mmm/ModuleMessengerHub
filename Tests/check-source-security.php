<?php

declare(strict_types=1);

// Core contracts of the stage 4s-A security sources (Plan/02-sources.md, section 4s-A):
// core.toll_fraud (CDR list), core.extension_new_device (onExtensionStatusChange hook) and
// core.sip_auth_failures (sip:getAuthFailureStats). Fixtures repeat the real Core shapes.
// Core classes are stubbed so the processors stay Core-free.

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

    use Modules\ModuleMessengerHub\Lib\Api\RestReader;
    use Modules\ModuleMessengerHub\Lib\Events\EventStore;
    use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
    use Modules\ModuleMessengerHub\Lib\RestAPI\Common\ArrayTranslator;
    use Modules\ModuleMessengerHub\Lib\RestAPI\Settings\Processor as SettingsProcessor;
    use Modules\ModuleMessengerHub\Lib\Routing\LinkBuilder;
    use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
    use Modules\ModuleMessengerHub\Lib\Routing\Templates\TemplateRegistry;
    use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
    use Modules\ModuleMessengerHub\Lib\Sources\Core\ExtensionNewDeviceSource;
    use Modules\ModuleMessengerHub\Lib\Sources\Core\InternalNumberMap;
    use Modules\ModuleMessengerHub\Lib\Sources\Core\SipAuthFailPolicy;
    use Modules\ModuleMessengerHub\Lib\Sources\Core\SipAuthFailureSource;
    use Modules\ModuleMessengerHub\Lib\Sources\Core\TollFraudPolicy;
    use Modules\ModuleMessengerHub\Lib\Sources\Core\TollFraudSource;
    use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
    use Modules\ModuleMessengerHub\Lib\Sources\SourceCatalog;
    use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
    use Modules\ModuleMessengerHub\Lib\Sources\SourceException;
    use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
    use Modules\ModuleMessengerHub\Lib\Sources\SourceRecorder;
    use Modules\ModuleMessengerHub\Lib\Sources\SourceRegistry;
    use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
    use Modules\ModuleMessengerHub\Lib\Support\ArrayTexts;

    const SECURITY_FIXTURES = __DIR__ . '/fixtures/core-security';

    /** @return array<string, mixed> */
    function securityFixture(string $name): array
    {
        $raw = file_get_contents(SECURITY_FIXTURES . '/' . $name . '.json');
        if ($raw === false) {
            fwrite(STDERR, "missing fixture $name\n");
            exit(1);
        }

        return json_decode($raw, true, 12, JSON_THROW_ON_ERROR);
    }

    /** CDR list data with an optional id filter, like Core GetListAction with idFrom. */
    final class CdrRest implements RestReader
    {
        /** @var list<array<string, mixed>> */
        public array $queries = [];

        /** @param list<array<string, mixed>> $records */
        public function __construct(public array $records)
        {
        }

        public function get(string $path, array $query = []): array
        {
            $this->queries[] = ['path' => $path, 'query' => $query];
            if ($path !== TollFraudSource::PATH) {
                throw new SourceException('api_not_found');
            }
            $idFrom = (int)($query['idFrom'] ?? 0);
            $rows = array_values(array_filter(
                $this->records,
                static fn (array $record): bool => (int)$record['id'] > $idFrom
            ));
            usort($rows, static fn (array $a, array $b): int => (int)$a['id'] <=> (int)$b['id']);
            if (($query['order'] ?? 'asc') === 'desc') {
                $rows = array_reverse($rows);
            }
            $rows = array_slice($rows, 0, (int)($query['limit'] ?? 50));

            return [
                'records' => $rows,
                'pagination' => [
                    'total' => count($this->records),
                    'limit' => (int)($query['limit'] ?? 50),
                    'offset' => 0,
                    'hasMore' => false,
                    'lastId' => $rows === [] ? null : (int)end($rows)['id'],
                ],
            ];
        }
    }

    /** sip:getAuthFailureStats over a map extension => stats; counts calls. */
    final class AuthStatsRest implements RestReader
    {
        /** @var list<string> */
        public array $paths = [];

        /** @param array<string, array<mixed>> $stats */
        public function __construct(private array $stats)
        {
        }

        public function get(string $path, array $query = []): array
        {
            $this->paths[] = $path;
            if (preg_match('~^/pbxcore/api/v3/sip/([^/:]+):getAuthFailureStats$~', $path, $m) !== 1) {
                throw new SourceException('api_not_found');
            }
            $extension = rawurldecode($m[1]);
            if ($extension === '204') {
                throw new SourceException('api_not_found');
            }
            if (!isset($this->stats[$extension])) {
                return [];
            }

            return $this->stats[$extension];
        }
    }

    final class ForbiddenRest implements RestReader
    {
        public function get(string $path, array $query = []): array
        {
            throw new SourceException('api_forbidden');
        }
    }

    /** @return array<string, mixed> a CDR leg in the shape of Core Cdr\DataStructure::createFromModel */
    function cdrLeg(int $id, int $start, string $src, string $dst, string $toAccount = 'SIP-TRUNK-0001', string $did = '', ?string $linkedid = null): array
    {
        return [
            'id' => $id,
            'start' => date('Y-m-d H:i:s', $start),
            'src_chan' => 'PJSIP/' . $src . '-0000000' . $id,
            'src_num' => $src,
            'dst_chan' => 'PJSIP/' . ($toAccount !== '' ? $toAccount : $dst) . '-0000000' . $id,
            'dst_num' => $dst,
            'linkedid' => $linkedid ?? ('mikopbx-' . $start . '.' . $id),
            'did' => $did,
            'disposition' => 'ANSWERED',
            'from_account' => $did !== '' ? 'SIP-TRUNK-0001' : '',
            'to_account' => $toAccount,
            'duration' => 30,
            'billsec' => 20,
        ];
    }

    $internalMap = InternalNumberMap::build(
        [
            ['number' => '203', 'type' => 'SIP', 'userid' => 12],
            ['number' => '204', 'type' => 'SIP', 'userid' => 13],
            ['number' => '205', 'type' => 'SIP', 'userid' => 14],
        ],
        [['id' => 12, 'username' => 'Ivanov I.'], ['id' => 13, 'username' => 'Sidorov S.'], ['id' => 14, 'username' => 'Petrov P.']]
    );

    // ======================= catalog and registry =======================

    $registry = SourceRegistry::default();
    check($registry->find(TollFraudSource::ID) instanceof TollFraudSource, 'registry: core.toll_fraud');
    check($registry->find(ExtensionNewDeviceSource::ID) instanceof ExtensionNewDeviceSource, 'registry: core.extension_new_device');
    check($registry->find(SipAuthFailureSource::ID) instanceof SipAuthFailureSource, 'registry: core.sip_auth_failures');
    check(SourceCatalog::group(TollFraudSource::ID) === SourceCatalog::GROUP_SECURITY, 'catalog: toll fraud is in the security group');
    check(SourceCatalog::group(ExtensionNewDeviceSource::ID) === SourceCatalog::GROUP_SECURITY, 'catalog: new device is in the security group');
    check(SourceCatalog::group(SipAuthFailureSource::ID) === SourceCatalog::GROUP_SECURITY, 'catalog: auth failures are in the security group');
    check(SourceCatalog::groupKey(SourceCatalog::GROUP_SECURITY) === 'module_messenger_hub_GroupSecurity', 'catalog: security group key');
    check(SourceCatalog::eventTypes(TollFraudSource::ID) === ['core.toll_fraud_suspected'], 'catalog: toll fraud event type');
    check(SourceCatalog::eventTypes(ExtensionNewDeviceSource::ID) === ['core.extension_new_device'], 'catalog: new device event type');
    check(SourceCatalog::eventTypes(SipAuthFailureSource::ID) === ['core.sip_auth_failures'], 'catalog: auth failure event type');
    check(
        array_search(SourceCatalog::GROUP_SECURITY, SourceCatalog::GROUP_ORDER, true)
            === count(SourceCatalog::GROUP_ORDER) - 1,
        'catalog: the security group closes the wizard list'
    );

    $ru = require dirname(__DIR__) . '/Messages/ru.php';
    foreach ([
        'GroupSecurity', 'SourceTollFraud', 'SourceExtensionNewDevice', 'SourceSipAuthFailures',
        'EventTypeTollFraud', 'EventTypeExtensionNewDevice', 'EventTypeSipAuthFailures',
    ] as $key) {
        check(isset($ru['module_messenger_hub_' . $key]) && $ru['module_messenger_hub_' . $key] !== '', 'catalog: ru text ' . $key);
    }
    foreach (glob(dirname(__DIR__) . '/Messages/*.php') ?: [] as $catalogFile) {
        $catalog = require $catalogFile;
        foreach (array_keys($ru) as $key) {
            if (!array_key_exists($key, $catalog)) {
                check(false, basename($catalogFile) . ' misses ' . $key);
                break;
            }
        }
        break; // key parity across locales is checked by the translation workflow; one file is enough here
    }

    check((new TollFraudSource())->apiReadPaths() === ['/api/v3/cdr'], 'toll fraud key path: /api/v3/cdr read');
    check((new ExtensionNewDeviceSource())->apiReadPaths() === [], 'new device: no REST path, hook only');
    check((new SipAuthFailureSource())->apiReadPaths() === ['/api/v3/sip'], 'auth failures key path: /api/v3/sip read');
    check((new TollFraudSource())->mode() === SourceInterface::MODE_POLL, 'toll fraud polls the CDR list');
    check((new ExtensionNewDeviceSource())->mode() === SourceInterface::MODE_PUSH, 'new device is a push source');
    check((new ExtensionNewDeviceSource())->pollIntervalSec() === 0, 'new device: no poll interval');
    check($registry->apiReadPaths([TollFraudSource::ID, SipAuthFailureSource::ID]) === ['/api/v3/cdr', '/api/v3/sip'], 'registry: security paths');

    // ======================= toll fraud: policy =======================

    $policy = TollFraudPolicy::defaults();
    check($policy->dangerPrefixes === ['810', '00', '+'], 'policy: default dangerous prefixes 810, 00, +');
    check($policy->homePrefixes === ['+7', '8107', '007'], 'policy: default home prefixes are the Russian forms');
    check($policy->burstCalls === 20 && $policy->burstWindowMin === 10, 'policy: default burst 20 calls / 10 min');
    check(!$policy->offHoursEnabled && $policy->offHoursFrom === '22:00' && $policy->offHoursTo === '07:00', 'policy: off-hours off by default');

    check($policy->isDangerous('810442071234567'), 'destination: 8-10 international prefix');
    check($policy->isDangerous('00442071234567'), 'destination: 00 international prefix');
    check($policy->isDangerous('+442071234567'), 'destination: + international prefix');
    check(!$policy->isDangerous('+79001234567'), 'destination: +7 home country is not dangerous');
    check(!$policy->isDangerous('81079001234567'), 'destination: 810 + home country is not dangerous');
    check(!$policy->isDangerous('0079001234567'), 'destination: 00 + home country is not dangerous');
    check(!$policy->isDangerous('89161234567'), 'destination: domestic 8 is not dangerous');
    check(!$policy->isDangerous('203'), 'destination: an internal number is not dangerous');
    check(!$policy->isDangerous(''), 'destination: empty is not dangerous');
    check(TollFraudPolicy::normalizeDialed('+44 (20) 7123-45-67') === '+442071234567', 'policy: normalisation of a formatted number');
    check(TollFraudPolicy::fromHubSettingsValues([HubSettings::TOLL_FRAUD_PREFIXES => ''])->isDangerous('+442071234567') === false, 'policy: an empty prefix list switches the rule off');

    $nightPolicy = TollFraudPolicy::fromHubSettingsValues([
        HubSettings::TOLL_FRAUD_OFFHOURS_ENABLED => '1',
        HubSettings::TOLL_FRAUD_OFFHOURS_FROM => '22:00',
        HubSettings::TOLL_FRAUD_OFFHOURS_TO => '07:00',
    ]);
    check($nightPolicy->isOffHours(strtotime('2026-11-18 23:30:00')), 'policy: 23:30 is inside the night window');
    check($nightPolicy->isOffHours(strtotime('2026-11-18 03:00:00')), 'policy: 03:00 is inside the night window (crosses midnight)');
    check(!$nightPolicy->isOffHours(strtotime('2026-11-18 07:00:00')), 'policy: the window end is exclusive');
    check(!$nightPolicy->isOffHours(strtotime('2026-11-18 12:00:00')), 'policy: noon is outside the window');
    $emptyWindow = TollFraudPolicy::fromHubSettingsValues([
        HubSettings::TOLL_FRAUD_OFFHOURS_ENABLED => '1',
        HubSettings::TOLL_FRAUD_OFFHOURS_FROM => '07:00',
        HubSettings::TOLL_FRAUD_OFFHOURS_TO => '07:00',
    ]);
    check(!$emptyWindow->isOffHours(strtotime('2026-11-18 07:00:00')), 'policy: equal bounds mean an empty window');

    // ======================= toll fraud: outgoing detection and events =======================

    $T = strtotime('2026-11-18 12:00:00');
    $leg = cdrLeg(1, $T - 300, '203', '+442071234567');
    check(TollFraudSource::isOutgoingExternal($leg, $internalMap), 'direction: internal extension -> external number with a trunk account');
    $legMapOnly = cdrLeg(2, $T - 300, '203', '+442071234567', '');
    check(TollFraudSource::isOutgoingExternal($legMapOnly, $internalMap), 'direction: the extension map also detects an outgoing call');
    check(!TollFraudSource::isOutgoingExternal(cdrLeg(3, $T, '204', '203', '203'), $internalMap), 'direction: internal -> internal is not outgoing');
    check(!TollFraudSource::isOutgoingExternal(cdrLeg(4, $T, '+442071234567', '203', '203', '+442071234567'), $internalMap), 'direction: a DID leg is incoming');
    check(!TollFraudSource::isOutgoingExternal(cdrLeg(5, $T, '9000', '9001', ''), $internalMap), 'direction: no trunk account and no map match is not outgoing');

    $cursor = TollFraudSource::baselineCursor([], $T - 3600);
    check($cursor['max_id'] === 0 && $cursor['recent'] === [] && $cursor['burst_first_id'] === 0, 'toll fraud: baseline cursor');

    // one call with two legs to the same dangerous number -> one event
    $records = [
        cdrLeg(10, $T - 120, '203', '+442071234567', 'SIP-TRUNK-0001', '', 'mikopbx-burst-10'),
        cdrLeg(11, $T - 120, '203', '+442071234567', 'SIP-TRUNK-0001', '', 'mikopbx-burst-10'),
    ];
    $batch = TollFraudSource::buildBatch($records, $cursor, 11, $T, $policy, $internalMap);
    check(count($batch->events) === 1, 'toll fraud: one dangerous-destination event per call (legs grouped by linkedid)');
    $event = $batch->events[0] ?? null;
    check($event instanceof HubEvent, 'toll fraud: event built');
    if ($event instanceof HubEvent) {
        check($event->eventType === 'core.toll_fraud_suspected', 'toll fraud: event type');
        check($event->dedupeKey === 'toll:dest:mikopbx-burst-10', 'toll fraud: dedupe = toll:dest:{linkedid}');
        check($event->severity === HubEvent::SEVERITY_WARNING, 'toll fraud: dangerous destination is warning');
        check($event->payload['subject']['toll_fraud']['rule'] === TollFraudSource::RULE_DESTINATION, 'toll fraud: rule in payload');
        check($event->payload['subject']['toll_fraud']['destination'] === '+442071234567', 'toll fraud: destination in payload');
        check($event->payload['subject']['toll_fraud']['extension'] === '203', 'toll fraud: caller extension in payload');
        check($event->payload['subject']['toll_fraud']['matched_prefix'] === '+', 'toll fraud: matched prefix in payload');
        check($event->payload['subject']['client_number'] === '+442071234567', 'toll fraud: destination is the client number (masking applies)');
        check($event->payload['subject']['employees'][0]['user_id'] === 12, 'toll fraud: caller employee resolved from the map');
        check($event->payload['subject']['toll_fraud']['cdr_ids'] === [10, 11], 'toll fraud: both cdr ids of the call');
    }
    check($batch->cursor['max_id'] === 11, 'toll fraud: cursor advances to the newest id');
    check(count($batch->cursor['recent']) === 1, 'toll fraud: one outgoing call counted for the burst window');

    // internal / incoming calls produce nothing
    $noise = TollFraudSource::buildBatch(
        [
            cdrLeg(20, $T, '204', '203', '203'),
            cdrLeg(21, $T, '+442071234567', '203', '203', '+442071234567'),
            cdrLeg(22, $T, '203', '89161234567'),
        ],
        $cursor,
        22,
        $T,
        $policy,
        $internalMap
    );
    check($noise->events === [], 'toll fraud: internal, incoming and domestic calls produce no events');

    // repeated poll of the same ids (replay after a restart) is stopped by the dedupe key
    $db = hubTestDatabase();
    $store = new EventStore($db);
    $store->record($event, $T);
    $store->record($event, $T + 60);
    check(
        (int)$db->fetchOne('SELECT COUNT(*) AS c FROM ' . EventStore::TABLE)['c'] === 1,
        'toll fraud: the same call replayed does not add a second event'
    );

    // ======================= toll fraud: burst =======================

    $base = TollFraudPolicy::defaults();
    $burstPolicy = new TollFraudPolicy(
        $base->dangerPrefixes,
        $base->homePrefixes,
        5,
        10,
        false,
        '22:00',
        '07:00'
    );
    $burstCursor = TollFraudSource::baselineCursor([], $T - 3600);
    $ids = 100;
    $exactlyFive = [];
    for ($i = 0; $i < 5; $i++) {
        $exactlyFive[] = cdrLeg(++$ids, $T - 240 + $i * 20, '203', '8916123456' . $i, '');
    }
    $batch = TollFraudSource::buildBatch($exactlyFive, $burstCursor, $ids, $T, $burstPolicy, $internalMap);
    check(count($batch->events) === 0, 'burst: exactly N calls is not a burst (more than N)');
    $burstCursor = $batch->cursor;

    $sixth = cdrLeg(++$ids, $T - 60, '204', '891612345666', '');
    $batch = TollFraudSource::buildBatch([$sixth], $burstCursor, $ids, $T, $burstPolicy, $internalMap);
    check(count($batch->events) === 1, 'burst: N+1 calls inside the window produce one event');
    $burst = $batch->events[0] ?? null;
    if ($burst instanceof HubEvent) {
        check($burst->severity === HubEvent::SEVERITY_CRITICAL, 'burst: critical severity');
        check($burst->payload['subject']['toll_fraud']['rule'] === TollFraudSource::RULE_BURST, 'burst: rule in payload');
        check($burst->payload['subject']['toll_fraud']['count'] === 6, 'burst: count of the window');
        check($burst->payload['subject']['toll_fraud']['window_min'] === 10, 'burst: window in payload');
        check($burst->dedupeKey === 'toll:burst:101', 'burst: dedupe = toll:burst:{first cdr id}');
        check(count($burst->payload['subject']['toll_fraud']['cdr_ids']) === 6, 'burst: cdr ids of the episode');
    }
    $burstCursor = $batch->cursor;

    // the wave continues: more calls, still the same episode -> no second event
    $more = [cdrLeg(++$ids, $T + 30, '205', '891612345667', ''), cdrLeg(++$ids, $T + 60, '203', '891612345668', '')];
    $batch = TollFraudSource::buildBatch($more, $burstCursor, $ids, $T + 90, $burstPolicy, $internalMap);
    check(count($batch->events) === 0, 'burst: a continuing wave does not alert again');
    check(($batch->cursor['burst_first_id'] ?? 0) === 101, 'burst: the episode keeps its first cdr id');
    $burstCursor = $batch->cursor;

    // window empties -> the episode ends; a later wave is a new episode with a new key
    $batch = TollFraudSource::buildBatch([], $burstCursor, $ids, $T + 90 + 11 * 60, $burstPolicy, $internalMap);
    check(($batch->cursor['burst_first_id'] ?? -1) === 0 && ($batch->cursor['recent'] ?? []) === [], 'burst: the episode ends when the window empties');
    $burstCursor = $batch->cursor;
    $late = [];
    for ($i = 0; $i < 6; $i++) {
        $late[] = cdrLeg(++$ids, $T + 700 + $i, '203', '891612345669', '');
    }
    $batch = TollFraudSource::buildBatch($late, $burstCursor, $ids, $T + 720, $burstPolicy, $internalMap);
    check(count($batch->events) === 1 && $batch->events[0]->dedupeKey === 'toll:burst:109', 'burst: a new wave after a quiet window is a new episode');

    // ======================= toll fraud: off-hours =======================

    $offHours = new TollFraudPolicy($base->dangerPrefixes, $base->homePrefixes, 5, 10, true, '22:00', '07:00');
    $nightCall = cdrLeg(200, strtotime('2026-11-18 23:15:00'), '203', '89161234567', '');
    $batch = TollFraudSource::buildBatch([$nightCall], TollFraudSource::baselineCursor([], $T - 3600), 200, $T, $offHours, $internalMap);
    check(count($batch->events) === 1, 'off-hours: one event for an external call at night');
    if (($batch->events[0] ?? null) instanceof HubEvent) {
        check($batch->events[0]->payload['subject']['toll_fraud']['rule'] === TollFraudSource::RULE_OFF_HOURS, 'off-hours: rule in payload');
        check(str_starts_with($batch->events[0]->dedupeKey, 'toll:offhours:'), 'off-hours: dedupe = toll:offhours:{linkedid}');
    }
    $daytime = cdrLeg(201, strtotime('2026-11-18 12:15:00'), '203', '89161234567', '');
    $batch = TollFraudSource::buildBatch([$daytime], TollFraudSource::baselineCursor([], $T - 3600), 201, $T, $offHours, $internalMap);
    check($batch->events === [], 'off-hours: a daytime call is silent');
    $batch = TollFraudSource::buildBatch([$nightCall], TollFraudSource::baselineCursor([], $T - 3600), 200, $T, $base, $internalMap);
    check($batch->events === [], 'off-hours: the rule is off by default');

    // old records (hub was down for days) only move the cursor, never become events
    $old = cdrLeg(300, $T - 3 * 86400, '203', '+442071234567', '');
    $batch = TollFraudSource::buildBatch([$old], TollFraudSource::baselineCursor([], $T - 3600), 300, $T, $base, $internalMap);
    check($batch->events === [] && $batch->cursor['max_id'] === 300, 'toll fraud: history older than the skip window advances the cursor silently');

    // ======================= toll fraud: poll over the REST list =======================

    $cdrFixture = securityFixture('cdr-list');
    $rest = new CdrRest($cdrFixture['records']);
    $source = new TollFraudSource(
        static fn (): TollFraudPolicy => TollFraudPolicy::defaults(),
        static fn (): array => $internalMap
    );
    $context = new SourceContext($rest, static fn (): int => $T + 120);
    $baseline = $source->poll($context, []);
    check($baseline->events === [], 'poll: the first poll is a silent baseline');
    check(($baseline->cursor['max_id'] ?? -1) === 502, 'poll: baseline stores the newest CDR id');
    check(($rest->queries[0]['query']['order'] ?? '') === 'desc', 'poll: the baseline asks for the newest record first');

    $rest->queries = [];
    $rest->records[] = cdrLeg(505, $T + 60, '203', '+442071234567');
    $batch = $source->poll($context, $baseline->cursor);
    check(($rest->queries[0]['query']['idFrom'] ?? -1) === 502, 'poll: the CDR list is read with the id cursor');
    check(($rest->queries[0]['query']['grouped'] ?? '') === 'false', 'poll: individual legs, not grouped conversations');
    check(($rest->queries[0]['query']['sort'] ?? '') === 'id' && ($rest->queries[0]['query']['order'] ?? '') === 'asc', 'poll: legs are walked forward by id');
    check(isset($rest->queries[0]['query']['dateFrom']), 'poll: the query is bounded by the skip window');
    check(count($batch->events) === 1, 'poll: a new dangerous call becomes an event');
    check(($batch->cursor['max_id'] ?? -1) === 505, 'poll: the cursor stays on the newest seen id');

    $rest->queries = [];
    $again = $source->poll($context, $batch->cursor);
    check($again->events === [] && $rest->queries !== [], 'poll: a repeated poll of the same list adds nothing');

    // ======================= extension new device: hook + tick =======================

    $change = securityFixture('extension-device-added');
    $pending = ExtensionNewDeviceSource::queueChanges($change['changes'], [], $T);
    check(count($pending) === 1, 'new device: the hook queues one raw fact');
    check($pending[0]['extension'] === '203' && count($pending[0]['pairs']) === 2, 'new device: both current devices are kept');
    check($pending[0]['pairs'][0]['ip'] === '198.51.100.20', 'new device: the change device comes first');
    check(ExtensionNewDeviceSource::queueChanges([['extension' => '203', 'event_type' => 'device_removed', 'ip_address' => '1.2.3.4']], [], $T) === [], 'new device: device_removed is not a device fact');
    check(ExtensionNewDeviceSource::queueChanges([['extension' => '', 'event_type' => 'device_added', 'ip_address' => '1.2.3.4']], [], $T) === [], 'new device: an empty extension is ignored');
    $dirty = ExtensionNewDeviceSource::queueChanges([[
        'extension' => '203',
        'event_type' => 'device_added',
        'ip_address' => "198.51.100.21\n",
        'user_agent' => "Bad\r\nAgent\x07 with control chars and a very long tail that should be truncated far below the database limit",
    ]], [], $T);
    check(!str_contains($dirty[0]['pairs'][0]['user_agent'], "\n") && !str_contains($dirty[0]['pairs'][0]['user_agent'], "\x07"), 'new device: control characters are stripped');
    check(mb_strlen($dirty[0]['pairs'][0]['user_agent']) <= 120, 'new device: the user agent is truncated');

    $capped = [];
    for ($i = 0; $i < 250; $i++) {
        $capped = ExtensionNewDeviceSource::queueChanges([[
            'extension' => (string)(100 + $i),
            'event_type' => 'device_added',
            'ip_address' => '198.51.100.' . ($i % 250),
            'user_agent' => 'agent',
        ]], $capped, $T);
    }
    check(count($capped) === 200, 'new device: the pending queue is bounded');

    $newDeviceDb = hubTestDatabase();
    $states = new SourceStateRepository($newDeviceDb);
    $store = new EventStore($newDeviceDb);
    $recorder = new SourceRecorder($states, $store);
    $newDeviceSource = new ExtensionNewDeviceSource();
    $states->setEnabled(ExtensionNewDeviceSource::ID, false, 0);
    $states->saveCursor(ExtensionNewDeviceSource::ID, ['pending' => $pending]);
    $newDeviceSource->tick($states, $recorder, $T);
    check(count($newDeviceDb->fetchAll('SELECT * FROM ' . EventStore::TABLE)) === 0, 'new device: a disabled source records nothing');

    $states->setEnabled(ExtensionNewDeviceSource::ID, true, 0);
    $states->saveCursor(ExtensionNewDeviceSource::ID, ['pending' => $pending]);
    $newDeviceSource->tick($states, $recorder, $T);
    check(count($newDeviceDb->fetchAll('SELECT * FROM ' . EventStore::TABLE)) === 0, 'new device: the first observed device set is a silent baseline');
    check(($states->get(ExtensionNewDeviceSource::ID)['cursor']['pending'] ?? null) === [], 'new device: pending is cleared after the fold');
    check(count($states->get(ExtensionNewDeviceSource::ID)['cursor']['devices']['203']['pairs'] ?? []) === 2, 'new device: the known set holds both pairs');

    $later = securityFixture('extension-device-added');
    $later['changes'][0]['ip_address'] = '198.51.100.99';
    $later['changes'][0]['user_agent'] = 'New phone 1.0';
    $later['changes'][0]['timestamp'] = $T + 300;
    $later['changes'][0]['devices'][] = [
        'id' => 'SIP-PHONE-203-ffff0000',
        'state' => 'ok',
        'ip' => '198.51.100.99',
        'port' => '5060',
        'user_agent' => 'New phone 1.0',
        'rtt' => 5,
    ];
    $pending = ExtensionNewDeviceSource::queueChanges($later['changes'], [], $T + 300);
    $states->saveCursor(
        ExtensionNewDeviceSource::ID,
        ['pending' => $pending] + $states->get(ExtensionNewDeviceSource::ID)['cursor']
    );
    $newDeviceSource->tick($states, $recorder, $T + 300);
    $rows = $newDeviceDb->fetchAll('SELECT * FROM ' . EventStore::TABLE . ' ORDER BY id');
    check(count($rows) === 1, 'new device: a genuinely new pair produces one event');
    if (count($rows) === 1) {
        $payload = json_decode((string)$rows[0]['payload_json'], true, 12, JSON_THROW_ON_ERROR);
        $signature = ExtensionNewDeviceSource::signature('198.51.100.99', 'New phone 1.0');
        check($rows[0]['dedupe_key'] === 'newdev:203:' . $signature, 'new device: dedupe = newdev:{extension}:{sha1(ip|ua) short}');
        check($rows[0]['event_type'] === 'core.extension_new_device' && $rows[0]['source_id'] === ExtensionNewDeviceSource::ID, 'new device: event type and source');
        check($rows[0]['severity'] === HubEvent::SEVERITY_WARNING, 'new device: warning severity');
        check((int)$rows[0]['occurred_at'] === $T + 300, 'new device: occurred_at is the change time');
        check(($payload['subject']['device']['extension'] ?? '') === '203', 'new device: extension in payload');
        check(($payload['subject']['device']['ip'] ?? '') === '198.51.100.99', 'new device: ip in payload');
        check(($payload['subject']['device']['user_agent'] ?? '') === 'New phone 1.0', 'new device: user agent in payload');
        check(($payload['subject']['device']['known_devices'] ?? -1) === 2, 'new device: previous known device count');
    }

    // the same pair (or the same hook fact replayed) is not new
    $states->saveCursor(
        ExtensionNewDeviceSource::ID,
        ['pending' => $pending] + $states->get(ExtensionNewDeviceSource::ID)['cursor']
    );
    $newDeviceSource->tick($states, $recorder, $T + 360);
    check(count($newDeviceDb->fetchAll('SELECT * FROM ' . EventStore::TABLE)) === 1, 'new device: the same device re-registering is not new');

    // the per-extension history is bounded: the oldest pair is dropped
    $manyPairs = ['extension' => '204', 'event_type' => 'device_added', 'timestamp' => $T, 'pairs' => []];
    for ($i = 0; $i < 12; $i++) {
        $manyPairs['pairs'][] = ['ip' => '192.0.2.' . $i, 'user_agent' => 'agent'];
    }
    [$devicesEvents, $devices] = ExtensionNewDeviceSource::flush([$manyPairs], [], $T);
    check($devicesEvents === [], 'new device: an unknown extension seeds silently');
    check(count($devices['204']['pairs']) === 10, 'new device: at most 10 pairs per extension are kept');
    check(!isset($devices['204']['pairs'][ExtensionNewDeviceSource::signature('192.0.2.0', 'agent')]), 'new device: the oldest pair is evicted first');

    // ======================= SIP auth failures =======================

    $authPolicy = SipAuthFailPolicy::defaults();
    check($authPolicy->threshold === 10 && $authPolicy->windowMin === 10 && $authPolicy->quietMin === 30, 'auth failures: default 10 failures / 10 min window / 30 min quiet');
    check(SipAuthFailureSource::targets([' 203 ', '203', '', '204']) === ['203', '204'], 'auth failures: targets are trimmed and deduplicated');

    $many = [];
    for ($i = 1; $i <= 100; $i++) {
        $many[] = (string)(200 + $i);
    }
    [$selected, $rotation] = SipAuthFailureSource::selectTargets($many, [], 25, 0, $T, 1800);
    check(count($selected) === 25 && $selected[0] === '201', 'auth failures: the rotation is bounded per poll');
    check($rotation === 25, 'auth failures: the rotation offset advances');
    [$selected2] = SipAuthFailureSource::selectTargets($many, [], 25, $rotation, $T, 1800);
    check($selected2[0] === '226' && !in_array('201', $selected2, true), 'auth failures: the next poll continues the rotation');
    [$priority] = SipAuthFailureSource::selectTargets($many, ['250' => ['episode' => ['start' => $T - 1000], 'last_attempt' => $T - 60]], 5, 0, $T, 1800);
    check(($priority[0] ?? '') === '250', 'auth failures: an open episode is polled first');

    $authStats = securityFixture('sip-auth-failures');
    foreach ($authStats as $ip => $row) {
        $authStats[$ip]['last_attempt'] = $T - 3600; // the TTL counter is 24 h old, the attack is over
    }
    $authDb = hubTestDatabase();
    $authStates = new SourceStateRepository($authDb);
    $authStore = new EventStore($authDb);
    $authRecorder = new SourceRecorder($authStates, $authStore);
    $authRest = new AuthStatsRest(['203' => $authStats, '205' => []]);
    $authSource = new SipAuthFailureSource(
        static fn (): array => ['203', '204', '205'],
        static fn (): array => [
            HubSettings::SIP_AUTHFAIL_THRESHOLD => '10',
            HubSettings::SIP_AUTHFAIL_WINDOW_MIN => '10',
            HubSettings::SIP_AUTHFAIL_QUIET_MIN => '30',
            HubSettings::SIP_AUTHFAIL_EXTENSIONS_PER_POLL => '25',
        ]
    );
    $authStates->setEnabled(SipAuthFailureSource::ID, true, 0);
    $authContext = new SourceContext($authRest, static fn (): int => $T);
    $authBaseline = $authSource->poll($authContext, []);
    check($authBaseline->events === [] && $authRest->paths === [], 'auth failures: the baseline poll asks no extension');

    $authCursor = $authBaseline->cursor;
    $authContext = new SourceContext($authRest, static fn (): int => $T);
    $batch = $authSource->poll($authContext, $authCursor);
    check($batch->events === [], 'auth failures: the first observation of a counter is a baseline');
    check($authRest->paths === [
        '/pbxcore/api/v3/sip/203:getAuthFailureStats',
        '/pbxcore/api/v3/sip/205:getAuthFailureStats',
    ] || count($authRest->paths) === 3, 'auth failures: the stats resource is asked per extension');
    check(in_array('/pbxcore/api/v3/sip/203:getAuthFailureStats', $authRest->paths, true), 'auth failures: the path follows the Core custom method route');
    check(($batch->cursor['exts']['203']['total'] ?? -1) === 54, 'auth failures: the cumulative counter is stored');
    $authCursor = $batch->cursor;

    // a counter seen for the first time with a recent last attempt is an ongoing brute force
    $fresh = securityFixture('sip-auth-failures');
    $fresh['203.0.113.10']['last_attempt'] = $T - 60;
    $freshBatch = SipAuthFailureSource::buildBatch(
        ['203' => $fresh],
        ['exts' => [], 'rotation' => 0, 'baseline_at' => $T - 7200],
        ['203'],
        0,
        $T,
        10,
        10,
        30
    );
    check(count($freshBatch->events) === 1, 'auth failures: an ongoing brute force on the first observation alerts');
    check(
        $freshBatch->events[0]->dedupeKey === 'authfail:203:' . ($T - 60),
        'auth failures: the first-observation episode starts at Core last_attempt'
    );

    // growth of >= threshold inside the window -> one event
    $grown = $authStats;
    $grown['203.0.113.10']['count'] = 53;
    $grown['203.0.113.10']['last_attempt'] = $T + 120;
    $authRest = new AuthStatsRest(['203' => $grown]);
    $authContext = new SourceContext($authRest, static fn (): int => $T + 120);
    $batch = $authSource->poll($authContext, $authCursor);
    check(count($batch->events) === 1, 'auth failures: growth of 10 failures in the window alerts');
    $authEvent = $batch->events[0] ?? null;
    if ($authEvent instanceof HubEvent) {
        check($authEvent->dedupeKey === 'authfail:203:' . $T, 'auth failures: dedupe = authfail:{extension}:{episode start}');
        check($authEvent->payload['subject']['auth_failures']['extension'] === '203', 'auth failures: extension in payload');
        check($authEvent->payload['subject']['auth_failures']['growth'] === 11, 'auth failures: growth in payload');
        check($authEvent->payload['subject']['auth_failures']['window_min'] === 10, 'auth failures: window in payload');
        check(count($authEvent->payload['subject']['auth_failures']['ips']) === 3, 'auth failures: top 3 source addresses');
        check($authEvent->payload['subject']['auth_failures']['ips'][0]['ip'] === '203.0.113.10', 'auth failures: top address first');
        check($authEvent->payload['subject']['auth_failures']['failures'] > 0, 'auth failures: total counter in payload');
    }
    $authCursor = $batch->cursor;

    // more growth in the same episode -> no second event
    $grown['203.0.113.10']['count'] = 70;
    $grown['203.0.113.10']['last_attempt'] = $T + 180;
    $authRest = new AuthStatsRest(['203' => $grown]);
    $authContext = new SourceContext($authRest, static fn (): int => $T + 180);
    $batch = $authSource->poll($authContext, $authCursor);
    check($batch->events === [], 'auth failures: a continuing wave does not alert again');
    $authCursor = $batch->cursor;

    // quiet period passes -> the episode closes; the next growth is a new episode
    $grown['203.0.113.10']['count'] = 82;
    $grown['203.0.113.10']['last_attempt'] = $T + 180;
    $authRest = new AuthStatsRest(['203' => $grown]);
    // polls every minute must not keep the episode alive by itself
    for ($minute = 4; $minute <= 33; $minute++) {
        $authContext = new SourceContext($authRest, static fn (): int => $T + 180 + ($minute - 3) * 60);
        $batch = $authSource->poll($authContext, $authCursor);
        check($batch->events === [], 'auth failures: a quiet episode stays silent at minute ' . $minute);
        $authCursor = $batch->cursor;
    }
    $authContext = new SourceContext($authRest, static fn (): int => $T + 180 + 31 * 60);
    $batch = $authSource->poll($authContext, $authCursor);
    check(array_key_exists('episode', (array)($batch->cursor['exts']['203'] ?? [])) && $batch->cursor['exts']['203']['episode'] === null, 'auth failures: the episode ends after the quiet period');
    check($batch->events === [], 'auth failures: a quiet counter produces no event');
    $authCursor = $batch->cursor;

    $grown['203.0.113.10']['count'] = 95;
    $grown['203.0.113.10']['last_attempt'] = $T + 180 + 32 * 60;
    $authRest = new AuthStatsRest(['203' => $grown]);
    $authContext = new SourceContext($authRest, static fn (): int => $T + 180 + 32 * 60);
    $batch = $authSource->poll($authContext, $authCursor);
    check(count($batch->events) === 1, 'auth failures: growth after a quiet period is a new episode');
    check(
        $batch->events[0]->dedupeKey !== 'authfail:203:' . $T,
        'auth failures: the new episode has a different dedupe key'
    );

    // a counter reset (Redis TTL or a manual clear) closes the episode silently
    $resetCursor = ['exts' => ['203' => [
        'total' => 100,
        'last_attempt' => $T,
        'samples' => [['t' => $T - 60, 'total' => 90], ['t' => $T, 'total' => 100]],
        'episode' => ['start' => $T - 600, 'last_activity' => $T],
        'last_growth_at' => $T,
    ]], 'rotation' => 0, 'baseline_at' => $T - 3600];
    $batch = SipAuthFailureSource::buildBatch(['203' => []], $resetCursor, ['203'], 0, $T + 60, 10, 10, 30);
    check($batch->events === [], 'auth failures: a reset counter is not an event');
    check(($batch->cursor['exts']['203']['total'] ?? -1) === 0 && array_key_exists('episode', $batch->cursor['exts']['203']) && $batch->cursor['exts']['203']['episode'] === null, 'auth failures: the episode is closed on a reset');

    // a 404 for one extension is skipped, a 403 fails the whole poll (the key problem is not hidden)
    $authStates->markPolled(SipAuthFailureSource::ID, $authCursor, $T);
    $authRest = new AuthStatsRest(['203' => $authStats]);
    $authContext = new SourceContext($authRest, static fn (): int => $T + 60);
    $batch = $authSource->poll($authContext, $authCursor);
    check(in_array('/pbxcore/api/v3/sip/204:getAuthFailureStats', $authRest->paths, true), 'auth failures: the extension without stats was asked');
    check($batch->cursor['exts']['203']['total'] === 54, 'auth failures: a 404 on one extension does not fail the poll');
    $thrown = false;
    try {
        $authSource->poll(new SourceContext(new ForbiddenRest(), static fn (): int => $T + 60), $authCursor);
    } catch (SourceException $exception) {
        $thrown = $exception->errorCode === 'api_forbidden';
    }
    check($thrown, 'auth failures: a 403 fails the poll and is reported as api_forbidden');

    // ======================= settings resource =======================

    $settingsDb = hubTestDatabase();
    $processor = new SettingsProcessor(
        new HubSettings($settingsDb),
        new SourceStateRepository($settingsDb),
        null,
        new ArrayTranslator([]),
        null,
        $settingsDb
    );
    $state = $processor->process(['action' => 'getList'])->data;
    check(($state['toll_fraud_prefixes'] ?? '') === '810,00,+', 'settings: default dangerous prefixes exposed');
    check(($state['toll_fraud_home_prefixes'] ?? '') === '+7,8107,007', 'settings: default home prefixes exposed');
    check(($state['toll_fraud_burst_calls'] ?? 0) === 20 && ($state['toll_fraud_burst_window_min'] ?? 0) === 10, 'settings: default burst exposed');
    check(($state['toll_fraud_offhours_enabled'] ?? true) === false, 'settings: off-hours is off by default');
    check(($state['sip_authfail_threshold'] ?? 0) === 10 && ($state['sip_authfail_extensions_per_poll'] ?? 0) === 25, 'settings: auth-failure defaults exposed');
    check($processor->process(['action' => 'getDefault'])->data == $state, 'settings: getDefault matches getList');

    $result = $processor->process(['action' => 'patch', 'data' => [
        'toll_fraud_prefixes' => ' 810 , 00,+,0011 ',
        'toll_fraud_home_prefixes' => '',
        'toll_fraud_burst_calls' => '30',
        'toll_fraud_burst_window_min' => 15,
        'toll_fraud_offhours_enabled' => true,
        'toll_fraud_offhours_from' => '21:30',
        'toll_fraud_offhours_to' => '06:15',
        'sip_authfail_threshold' => 7,
        'sip_authfail_window_min' => 20,
        'sip_authfail_quiet_min' => 45,
        'sip_authfail_extensions_per_poll' => 50,
    ]]);
    check($result->success, 'settings: the security fields are accepted');
    $state = $result->data;
    check($state['toll_fraud_prefixes'] === '810,00,+,0011', 'settings: the prefix list is canonicalised');
    check($state['toll_fraud_home_prefixes'] === '', 'settings: an empty home list is allowed (every international call is dangerous)');
    check($state['toll_fraud_burst_calls'] === 30 && $state['sip_authfail_threshold'] === 7, 'settings: numbers stored');
    check($state['toll_fraud_offhours_enabled'] === true && $state['toll_fraud_offhours_from'] === '21:30', 'settings: off-hours stored');
    check(in_array('sip_authfail_threshold', $state['changed'], true), 'settings: changed lists the security fields');

    foreach ([
        ['toll_fraud_prefixes' => 'http://x', 'field' => 'toll_fraud_prefixes'],
        ['toll_fraud_burst_calls' => 1, 'field' => 'toll_fraud_burst_calls'],
        ['toll_fraud_burst_window_min' => 0, 'field' => 'toll_fraud_burst_window_min'],
        ['toll_fraud_offhours_from' => '25:00', 'field' => 'toll_fraud_offhours_from'],
        ['sip_authfail_threshold' => 0, 'field' => 'sip_authfail_threshold'],
        ['sip_authfail_extensions_per_poll' => 1000, 'field' => 'sip_authfail_extensions_per_poll'],
    ] as $case) {
        $field = $case['field'];
        unset($case['field']);
        $result = $processor->process(['action' => 'patch', 'data' => $case]);
        check(
            !$result->success && $result->httpCode === 422 && ($result->data['field'] ?? '') === $field,
            'settings: invalid ' . $field . ' is rejected'
        );
    }

    // a full PUT that does not know the new fields keeps their values (older clients stay valid)
    $putPayload = [
        'hub_enabled' => true,
        'events_retention_days' => 30,
        'sources' => $state['sources'],
        'pbx_public_url' => '',
        'mask_phone_default' => false,
        'proxy_url' => '',
        'max_ca_bundle_path' => '',
    ];
    $result = $processor->process(['action' => 'update', 'data' => $putPayload]);
    check($result->success && $result->data['toll_fraud_burst_calls'] === 30, 'settings: PUT without security fields keeps the stored thresholds');

    // ======================= templates =======================

    $texts = new ArrayTexts(require dirname(__DIR__) . '/Messages/ru.php');
    $context = new RenderContext($texts, new LinkBuilder('https://pbx.example'), true);
    $templates = new TemplateRegistry();

    $tollTemplate = $templates->forEvent('core.toll_fraud_suspected');
    check($tollTemplate !== null, 'template: toll fraud registered');
    $tollRender = $tollTemplate?->render($event, $context);
    check($tollRender !== null && str_contains($tollRender->title, $texts->t('module_messenger_hub_EventTypeTollFraud')), 'template: toll fraud title');
    $renderedJson = json_encode($tollRender?->toArray() ?? [], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    check(!str_contains($renderedJson, '442071234567'), 'template: the full destination never reaches a masked message');
    check(str_contains($renderedJson, '***'), 'template: the destination is masked');
    check(($tollRender?->buttons[0]['url'] ?? '') === 'https://pbx.example/admin-cabinet/call-detail-records/index', 'template: the call journal button is added');

    $deviceTemplate = $templates->forEvent('core.extension_new_device');
    check($deviceTemplate !== null, 'template: new device registered');
    $deviceEvent = new HubEvent(
        ExtensionNewDeviceSource::ID,
        ExtensionNewDeviceSource::EVENT_TYPE,
        HubEvent::SEVERITY_WARNING,
        'newdev:203:abcdef123456',
        $T,
        ['subject' => ['call' => null, 'client_number' => '', 'employees' => [], 'device' => [
            'extension' => '203',
            'ip' => '198.51.100.99',
            'user_agent' => str_repeat('A', 200),
            'known_devices' => 2,
        ]]]
    );
    $deviceRender = $deviceTemplate?->render($deviceEvent, $context);
    check($deviceRender !== null && str_contains($deviceRender->title, $texts->t('module_messenger_hub_EventTypeExtensionNewDevice')), 'template: new device title');
    check(in_array($texts->t('module_messenger_hub_MessageDeviceIp', ['ip' => '198.51.100.99']), $deviceRender?->lines ?? [], true), 'template: new device ip line');
    check(mb_strlen($deviceRender?->lines[2] ?? '') < 200, 'template: the user agent is bounded');

    $authTemplate = $templates->forEvent('core.sip_auth_failures');
    check($authTemplate !== null, 'template: auth failures registered');
    $authEvent = new HubEvent(
        SipAuthFailureSource::ID,
        SipAuthFailureSource::EVENT_TYPE,
        HubEvent::SEVERITY_WARNING,
        'authfail:203:1791000000',
        $T,
        ['subject' => ['call' => null, 'client_number' => '', 'employees' => [], 'auth_failures' => [
            'extension' => '203',
            'failures' => 95,
            'growth' => 11,
            'window_min' => 10,
            'since' => $T,
            'ips' => [['ip' => '203.0.113.10', 'count' => 53], ['ip' => '203.0.113.11', 'count' => 8]],
        ]]]
    );
    $authRender = $authTemplate?->render($authEvent, $context);
    check($authRender !== null && str_contains($authRender->title, $texts->t('module_messenger_hub_EventTypeSipAuthFailures')), 'template: auth failures title');
    check(in_array($texts->t('module_messenger_hub_MessageExtension', ['extension' => '203']), $authRender?->lines ?? [], true), 'template: the extension is shown');
    check(str_contains((string)($authRender?->notes[0] ?? ''), '95'), 'template: the total counter is shown');

    // every catalogue event type has a template
    foreach (SourceCatalog::knownEventTypes() as $eventType) {
        if (in_array($eventType, ['core.missed_call_resolved'], true)) {
            continue; // rendered through the retraction planner, not as a message of its own
        }
        check($templates->forEvent($eventType) !== null, 'template registered for ' . $eventType);
    }

    finish('security sources OK');
}
