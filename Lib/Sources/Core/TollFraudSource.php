<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;

/**
 * core.toll_fraud — poll source over the Core CDR REST list (Plan/02-sources.md, section 4s-A).
 *
 * Facts are read from GET /pbxcore/api/v3/cdr with an id cursor (Core `Cdr\GetListAction`):
 * `grouped=false` returns individual legs in `data.records`, `idFrom` is the "id >" filter
 * (`src/PBXCoreREST/Lib/Cdr/GetListAction.php:119,250-253`), `sort=id&order=asc` walks forward
 * (allowed sort fields: `:181-191`).
 *
 * An outgoing external call is a leg without a DID whose destination is not an internal number:
 *  - `to_account` carries the dialled channel account (`extensions.lua:910`), i.e. a provider id
 *    `SIP-TRUNK-…` / `IAX-TRUNK-…` (`Providers.php:187`, `Extensions.php:70-71`) for an external leg;
 *  - otherwise the internal-number map built from the Core Extensions model is used (Q12): the source
 *    number is internal and the destination is not. Internal calls and calls with a DID are ignored.
 *
 * Three rules, all configurable through HubSettings (TollFraudPolicy):
 *  - dangerous destination: a dialled number with an international access prefix that is not a
 *    home-country form -> one event per call, dedupe `toll:dest:{linkedid}`;
 *  - burst: more than N outgoing external calls whose CDR start times fall inside M minutes ->
 *    one event per episode, dedupe `toll:burst:{first cdr id of the episode}`. The episode stays
 *    open while at least one counted call is still inside the window, so a continuing wave does
 *    not produce a second message; it ends when the window empties;
 *  - off-hours (off by default): an outgoing external call started inside the night window ->
 *    one event per call, dedupe `toll:offhours:{linkedid}`.
 *
 * Baseline: the first poll only stores the newest CDR id — history is never broadcast. Pages are
 * bounded (100 x 3 per poll); the cursor advances over every fetched id, so a long downtime skips
 * records older than MAX_HISTORY_SKIP_SEC instead of replaying them.
 */
final class TollFraudSource implements SourceInterface
{
    public const string ID = 'core.toll_fraud';
    public const string EVENT_TYPE = 'core.toll_fraud_suspected';
    public const string API_READ_PATH = '/api/v3/cdr';
    public const string PATH = '/pbxcore' . self::API_READ_PATH;

    public const string RULE_DESTINATION = 'dangerous_destination';
    public const string RULE_BURST = 'burst';
    public const string RULE_OFF_HOURS = 'off_hours';

    private const int PAGE_LIMIT = 100;
    private const int MAX_PAGES = 3;
    /** Calls older than this are fetched over (cursor advance) but never turned into events. */
    private const int MAX_HISTORY_SKIP_SEC = 2 * 86400;
    private const int MAX_RECENT = 500;
    private const int MAX_CDR_IDS = 20;
    private const int MAP_TTL_SEC = 300;

    /** Core provider ids start with these prefixes (Providers::generateUniqueID, Extensions::PREFIX_TRUNK_*). */
    private const array TRUNK_PREFIXES = ['SIP-TRUNK-', 'IAX-TRUNK-'];

    /** @var callable(): TollFraudPolicy */
    private $policyProvider;

    /** @var callable(): array<string, array{user_id: ?int, name: string}> */
    private $internalMapProvider;

    /** @var array<string, array{user_id: ?int, name: string}>|null */
    private ?array $internalMap = null;

    private int $mapLoadedAt = 0;

    /**
     * @param callable(): TollFraudPolicy $policyProvider
     * @param callable(): array<string, array{user_id: ?int, name: string}> $internalMapProvider
     */
    public function __construct(?callable $policyProvider = null, ?callable $internalMapProvider = null)
    {
        $this->policyProvider = $policyProvider ?? static fn (): TollFraudPolicy => TollFraudPolicy::defaults();
        $this->internalMapProvider = $internalMapProvider ?? static fn (): array => [];
    }

    public function id(): string
    {
        return self::ID;
    }

    public function eventTypes(): array
    {
        return [self::EVENT_TYPE];
    }

    public function requiredModule(): ?string
    {
        return null;
    }

    public function apiReadPaths(): array
    {
        return [self::API_READ_PATH];
    }

    public function mode(): string
    {
        return SourceInterface::MODE_POLL;
    }

    public function pollIntervalSec(): int
    {
        return 60;
    }

    public function poll(SourceContext $context, array $cursor): SourceBatch
    {
        if ($cursor === []) {
            // baseline: only the newest id, no events (history is not broadcast)
            $data = $context->rest->get(self::PATH, [
                'grouped' => 'false',
                'sort' => 'id',
                'order' => 'desc',
                'limit' => 1,
            ]);

            return SourceBatch::baseline(self::baselineCursor(self::records($data), $context->now()));
        }

        $maxId = self::readMaxId($cursor);
        $cutoff = $context->now() - self::MAX_HISTORY_SKIP_SEC;
        $records = [];
        for ($page = 0; $page < self::MAX_PAGES; $page++) {
            $data = $context->rest->get(self::PATH, [
                'grouped' => 'false',
                'sort' => 'id',
                'order' => 'asc',
                'idFrom' => $maxId,
                'dateFrom' => date('Y-m-d H:i:s', $cutoff),
                'limit' => self::PAGE_LIMIT,
            ]);
            $pageRecords = self::records($data);
            foreach ($pageRecords as $record) {
                $records[] = $record;
                $maxId = max($maxId, self::recordId($record));
            }
            if (count($pageRecords) < self::PAGE_LIMIT) {
                break;
            }
        }

        return self::buildBatch($records, $cursor, $maxId, $context->now(), $this->policy(), $this->internalMap());
    }

    /** @param array<mixed> $data PBXApiResult data of the CDR list */
    private static function records(array $data): array
    {
        $records = [];
        foreach (is_array($data['records'] ?? null) ? $data['records'] : [] as $item) {
            if (!is_array($item)) {
                continue;
            }
            if (is_array($item['records'] ?? null)) {
                // defensive: a grouped answer (grouped=true) carries the legs inside `records`
                foreach ($item['records'] as $leg) {
                    if (is_array($leg)) {
                        $records[] = $leg;
                    }
                }

                continue;
            }
            $records[] = $item;
        }

        return $records;
    }

    /** @param list<array<string, mixed>> $records */
    public static function baselineCursor(array $records, int $now): array
    {
        $maxId = 0;
        foreach ($records as $record) {
            $maxId = max($maxId, self::recordId($record));
        }

        return [
            'max_id' => $maxId,
            'started_at' => $now,
            'recent' => [],
            'burst_first_id' => 0,
        ];
    }

    /**
     * Pure fold of the fetched CDR legs into events and the next cursor. Unit-tested against fixtures.
     *
     * @param list<array<string, mixed>> $records legs newer than the cursor (any order)
     * @param array<string, mixed> $cursor
     * @param array<string, array{user_id: ?int, name: string}> $internalMap
     */
    public static function buildBatch(array $records, array $cursor, int $maxId, int $now, TollFraudPolicy $policy, array $internalMap): SourceBatch
    {
        $startedAt = (int)($cursor['started_at'] ?? $now);
        $maxId = max($maxId, self::readMaxId($cursor));
        $cutoff = $now - self::MAX_HISTORY_SKIP_SEC;
        $windowStart = $now - $policy->burstWindowSec();

        $recent = self::readRecent($cursor);
        $burstFirstId = (int)($cursor['burst_first_id'] ?? 0);
        $events = [];

        foreach (self::calls($records, $internalMap) as $call) {
            if ($call['start'] < $cutoff) {
                continue; // fetched only to move the cursor forward after a downtime
            }
            foreach (self::callEvents($call, $policy, $internalMap) as $event) {
                $events[] = $event;
            }
            $linkedid = (string)$call['linkedid'];
            $known = $recent[$linkedid] ?? null;
            if ($known === null || $call['start'] < (int)$known['start']) {
                $recent[$linkedid] = [
                    'start' => $call['start'],
                    'id' => (int)$call['id'],
                    'src' => (string)$call['src'],
                    'dst' => (string)$call['destination'],
                ];
            }
        }

        // the burst window is a sliding window over CDR start times, not over poll times
        $recent = array_filter(
            $recent,
            static fn (array $call): bool => (int)$call['start'] >= $windowStart
        );
        uasort($recent, static fn (array $a, array $b): int => ((int)$a['start'] <=> (int)$b['start']) ?: ((int)$a['id'] <=> (int)$b['id']));
        $recent = array_slice($recent, -self::MAX_RECENT, null, true);

        if (count($recent) > $policy->burstCalls) {
            if ($burstFirstId === 0) {
                // a new episode: its first cdr id keys the event, so the wave alerts exactly once
                $firstId = min(array_map(static fn (array $call): int => (int)$call['id'], $recent));
                $burstFirstId = $firstId;
                $events[] = self::burstEvent($recent, $policy, $now, $internalMap);
            }
        } elseif ($recent === [] && $burstFirstId !== 0) {
            $burstFirstId = 0; // the wave is over: the next one is a new episode
        }

        return new SourceBatch($events, [
            'max_id' => $maxId,
            'started_at' => $startedAt > 0 ? $startedAt : $now,
            'recent' => $recent,
            'burst_first_id' => $burstFirstId,
        ]);
    }

    /**
     * Groups the fetched legs by linkedid and keeps the outgoing external calls only.
     *
     * @param list<array<string, mixed>> $records
     * @param array<string, array{user_id: ?int, name: string}> $internalMap
     * @return list<array{linkedid: string, id: int, start: int, src: string, destination: string,
     *     cdr_ids: list<int>, duration_sec: int}>
     */
    private static function calls(array $records, array $internalMap): array
    {
        $groups = [];
        foreach ($records as $record) {
            $id = self::recordId($record);
            if ($id <= 0) {
                continue;
            }
            $linkedid = trim((string)($record['linkedid'] ?? ''));
            $groups[$linkedid !== '' ? $linkedid : ('cdr-' . $id)][] = $record;
        }

        $calls = [];
        foreach ($groups as $linkedid => $legs) {
            foreach ($legs as $leg) {
                if (!self::isOutgoingExternal($leg, $internalMap)) {
                    continue;
                }
                $id = self::recordId($leg);
                $call = $calls[$linkedid] ?? [
                    'linkedid' => (string)$linkedid,
                    'id' => $id,
                    'start' => self::start($leg),
                    'src' => trim((string)($leg['src_num'] ?? '')),
                    'destination' => trim((string)($leg['dst_num'] ?? '')),
                    'cdr_ids' => [],
                    'duration_sec' => 0,
                ];
                $call['start'] = min($call['start'], self::start($leg));
                $call['id'] = min($call['id'], $id);
                $call['duration_sec'] = max($call['duration_sec'], (int)($leg['duration'] ?? 0));
                if ($id > 0 && !in_array($id, $call['cdr_ids'], true)) {
                    $call['cdr_ids'][] = $id;
                }
                sort($call['cdr_ids']);
                $calls[$linkedid] = $call;
            }
        }

        return array_values($calls);
    }

    /**
     * One leg is an outgoing external call when it has no DID and the dialled destination is external.
     * Core writes the dialled channel account into `to_account` (`extensions.lua:910`): a provider id
     * there means the leg went out through a trunk. Without that marker the internal-number map decides.
     *
     * @param array<string, mixed> $leg
     * @param array<string, array{user_id: ?int, name: string}> $internalMap
     */
    public static function isOutgoingExternal(array $leg, array $internalMap): bool
    {
        if (trim((string)($leg['did'] ?? '')) !== '') {
            return false;
        }
        $src = trim((string)($leg['src_num'] ?? ''));
        $dst = trim((string)($leg['dst_num'] ?? ''));
        if ($src === '' || $dst === '') {
            return false;
        }
        $toAccount = trim((string)($leg['to_account'] ?? ''));
        foreach (self::TRUNK_PREFIXES as $prefix) {
            if (str_starts_with($toAccount, $prefix)) {
                return true;
            }
        }

        return $internalMap !== []
            && isset($internalMap[$src])
            && !isset($internalMap[$dst]);
    }

    /**
     * @param array{linkedid: string, id: int, start: int, src: string, destination: string,
     *     cdr_ids: list<int>, duration_sec: int} $call
     * @param array<string, array{user_id: ?int, name: string}> $internalMap
     * @return list<HubEvent>
     */
    private static function callEvents(array $call, TollFraudPolicy $policy, array $internalMap): array
    {
        $events = [];
        $destination = (string)$call['destination'];
        if ($policy->isDangerous($destination)) {
            $events[] = self::callEvent($call, $policy, self::RULE_DESTINATION, $internalMap, [
                'matched_prefix' => self::matchedPrefix($destination, $policy->dangerPrefixes),
            ]);
        }
        if ($policy->isOffHours((int)$call['start'])) {
            $events[] = self::callEvent($call, $policy, self::RULE_OFF_HOURS, $internalMap, []);
        }

        return $events;
    }

    /**
     * @param array{linkedid: string, id: int, start: int, src: string, destination: string,
     *     cdr_ids: list<int>, duration_sec: int} $call
     * @param array<string, array{user_id: ?int, name: string}> $internalMap
     * @param array<string, mixed> $extra
     */
    private static function callEvent(array $call, TollFraudPolicy $policy, string $rule, array $internalMap, array $extra): HubEvent
    {
        $employee = $internalMap[(string)$call['src']] ?? null;

        return new HubEvent(
            sourceId: self::ID,
            eventType: self::EVENT_TYPE,
            severity: HubEvent::SEVERITY_WARNING,
            dedupeKey: ($rule === self::RULE_OFF_HOURS ? 'toll:offhours:' : 'toll:dest:') . $call['linkedid'],
            occurredAt: max(1, (int)$call['start']),
            payload: self::payload($call, $rule, $employee, [
                'count' => 0,
                'window_min' => 0,
                'cdr_ids' => array_slice((array)$call['cdr_ids'], 0, self::MAX_CDR_IDS),
            ] + $extra),
        );
    }

    /**
     * @param array<string, array{start: int, id: int, src: string, dst: string}> $recent
     * @param array<string, array{user_id: ?int, name: string}> $internalMap
     */
    private static function burstEvent(array $recent, TollFraudPolicy $policy, int $now, array $internalMap): HubEvent
    {
        $firstId = min(array_map(static fn (array $call): int => (int)$call['id'], $recent));
        $lastStart = max(array_map(static fn (array $call): int => (int)$call['start'], $recent));
        $linkedid = (string)array_key_first($recent);
        $first = (array)reset($recent);
        $ids = array_map(static fn (array $call): int => (int)$call['id'], $recent);
        sort($ids);
        $employee = $internalMap[(string)($first['src'] ?? '')] ?? null;

        return new HubEvent(
            sourceId: self::ID,
            eventType: self::EVENT_TYPE,
            severity: HubEvent::SEVERITY_CRITICAL,
            dedupeKey: 'toll:burst:' . $firstId,
            occurredAt: max(1, $lastStart > 0 ? $lastStart : $now),
            payload: self::payload([
                'linkedid' => $linkedid,
                'id' => $firstId,
                'start' => $lastStart,
                'src' => (string)($first['src'] ?? ''),
                'destination' => (string)($first['dst'] ?? ''),
                'cdr_ids' => array_slice($ids, 0, self::MAX_CDR_IDS),
                'duration_sec' => 0,
            ], self::RULE_BURST, $employee, [
                'count' => count($recent),
                'window_min' => $policy->burstWindowMin,
                'cdr_ids' => array_slice($ids, 0, self::MAX_CDR_IDS),
            ]),
        );
    }

    /**
     * @param array{linkedid: string, id: int, start: int, src: string, destination: string,
     *     cdr_ids: list<int>, duration_sec: int} $call
     * @param array{user_id: ?int, name: string}|null $employee
     * @param array<string, mixed> $facts
     */
    private static function payload(array $call, string $rule, ?array $employee, array $facts): array
    {
        $employees = [];
        if ((string)$call['src'] !== '') {
            $employees[] = [
                'user_id' => $employee['user_id'] ?? null,
                'number' => (string)$call['src'],
                'name' => (string)($employee['name'] ?? ''),
            ];
        }

        return [
            'subject' => [
                'call' => [
                    'linkedid' => (string)$call['linkedid'],
                    'direction' => 'outgoing',
                    'started_at' => (int)$call['start'],
                    'duration_sec' => (int)$call['duration_sec'],
                ],
                'client_number' => (string)$call['destination'],
                'employees' => $employees,
                'provider' => null,
                'toll_fraud' => [
                    'rule' => $rule,
                    'destination' => (string)$call['destination'],
                    'extension' => (string)$call['src'],
                    'cdr_ids' => array_values(array_map('intval', (array)($facts['cdr_ids'] ?? []))),
                    'count' => (int)($facts['count'] ?? 0),
                    'window_min' => (int)($facts['window_min'] ?? 0),
                    'matched_prefix' => (string)($facts['matched_prefix'] ?? ''),
                ],
            ],
            'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
            'links' => [],
            'attachments' => [],
        ];
    }

    /** @param list<string> $prefixes */
    private static function matchedPrefix(string $destination, array $prefixes): string
    {
        $number = TollFraudPolicy::normalizeDialed($destination);
        foreach ($prefixes as $prefix) {
            if (str_starts_with($number, $prefix)) {
                return $prefix;
            }
        }

        return '';
    }

    /** @param array<string, mixed> $cursor */
    private static function readMaxId(array $cursor): int
    {
        $value = $cursor['max_id'] ?? 0;

        return is_int($value) || (is_string($value) && ctype_digit($value)) ? (int)$value : 0;
    }

    /**
     * @param array<string, mixed> $cursor
     * @return array<string, array{start: int, id: int, src: string, dst: string}>
     */
    private static function readRecent(array $cursor): array
    {
        $recent = [];
        foreach (is_array($cursor['recent'] ?? null) ? $cursor['recent'] : [] as $linkedid => $call) {
            if (!is_string($linkedid) || !is_array($call)) {
                continue;
            }
            $recent[$linkedid] = [
                'start' => (int)($call['start'] ?? 0),
                'id' => (int)($call['id'] ?? 0),
                'src' => (string)($call['src'] ?? ''),
                'dst' => (string)($call['dst'] ?? ''),
            ];
        }

        return $recent;
    }

    /** @param array<string, mixed> $record */
    private static function recordId(array $record): int
    {
        $id = $record['id'] ?? 0;

        return is_int($id) || (is_string($id) && ctype_digit($id)) ? (int)$id : 0;
    }

    /** @param array<string, mixed> $record CDR timestamps are "Y-m-d H:i:s" in the PBX timezone. */
    private static function start(array $record): int
    {
        $value = trim((string)($record['start'] ?? ''));
        if ($value === '') {
            return time();
        }
        $ts = strtotime($value);

        return $ts === false ? time() : $ts;
    }

    private function policy(): TollFraudPolicy
    {
        try {
            return ($this->policyProvider)();
        } catch (\Throwable) {
            return TollFraudPolicy::defaults();
        }
    }

    /** @return array<string, array{user_id: ?int, name: string}> */
    private function internalMap(): array
    {
        $now = time();
        if ($this->internalMap !== null && $now - $this->mapLoadedAt < self::MAP_TTL_SEC) {
            return $this->internalMap;
        }
        try {
            $this->internalMap = ($this->internalMapProvider)();
        } catch (\Throwable) {
            $this->internalMap ??= [];
        }
        $this->mapLoadedAt = $now;

        return $this->internalMap;
    }
}
