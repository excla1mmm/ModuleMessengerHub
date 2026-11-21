<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;

/**
 * ai_supervisor.attention_call — poll source over ModuleAISupervisor REST v3
 * GET /pbxcore/api/v3/module-ai-supervisor/calls?attention=1 (Plan/02-sources.md, moduleaisupervisor#10).
 *
 * A call becomes "attention" when its analysis finishes, possibly hours after the call itself.
 * The API computes the attention set from AI results joined by call_timestamp, so the 7-day
 * period window (widest sane window; analysis lag is minutes-to-hours) always contains late
 * analyses. The cursor is a bounded set of seen ref ids (not a high-watermark): a fresh id
 * anywhere in the window is new, whether the call is recent or old. dedupe_key ai_attention:{id}
 * keeps a re-analysis (revision) from re-alerting even when the id was already trimmed.
 *
 * The list response carries the compact ai_result (summary, scores, list_view reasons) but NOT
 * the evidence quotes (only evidence_count). For every NEW id the source fetches the record
 * endpoint /calls/{id} once and takes up to 3 evidence quotes with start_ms/end_ms timecodes
 * (indicators.evidence); a failing detail fetch degrades to an event without quotes.
 * Employees (number -> user_id/name) are resolved through the internal-number map built from
 * Core models (Plan/11 Q12); the map is injected by the registry, the class stays Core-free.
 */
final class AiAttentionCallSource implements SourceInterface
{
    public const string ID = 'ai_supervisor.attention_call';
    public const string EVENT_TYPE = 'ai_supervisor.attention_call';
    public const string API_READ_PATH = '/api/v3/module-ai-supervisor/calls';
    public const string PATH = '/pbxcore' . self::API_READ_PATH;
    /**
     * The attention-call recording is delivered through the public Core REST v3 (CDR by linkedid,
     * `recording_access.cdr_id` when present). List/detail need `read`; playback/download are public
     * by their one-time token (Plan/03, decision 3a-1). Core is never modified.
     */
    public const string CDR_READ_PATH = '/api/v3/cdr';

    private const int WINDOW_DAYS = 7;
    private const int PAGE_LIMIT = 100;
    private const int MAX_PAGES = 3;
    private const int MAX_SEEN = 500;
    private const int MAX_DETAIL_FETCHES_PER_POLL = 10;
    private const int MAP_TTL_SEC = 300;
    private const int MAX_REASON_ITEMS = 12;
    private const int MAX_QUOTES = 3;

    /** @var callable(): array<string, array{user_id: ?int, name: string}> */
    private $employeeMapProvider;

    /** @var array<string, array{user_id: ?int, name: string}>|null */
    private ?array $employeeMap = null;

    private int $mapLoadedAt = 0;

    /** @param callable(): array<string, array{user_id: ?int, name: string}> $employeeMapProvider */
    public function __construct(callable $employeeMapProvider)
    {
        $this->employeeMapProvider = $employeeMapProvider;
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
        return 'ModuleAISupervisor';
    }

    public function apiReadPaths(): array
    {
        // /api/v3/cdr is added to the key only while an enabled rule asks for attention-call audio
        // (ApiKeyPaths::attentionCdr) — it is not a blanket read of every CDR (Plan/03, decision 3a-1).
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
        $items = [];
        $hasMore = true;
        for ($page = 0; $page < self::MAX_PAGES && $hasMore; $page++) {
            $data = $context->rest->get(self::PATH, [
                'attention' => '1',
                'period' => self::WINDOW_DAYS . 'd',
                'sort' => 'date_desc',
                'limit' => self::PAGE_LIMIT,
                'offset' => $page * self::PAGE_LIMIT,
            ]);
            foreach ($data['items'] ?? [] as $item) {
                if (is_array($item)) {
                    $items[] = $item;
                }
            }
            $hasMore = (bool)(($data['pagination']['has_more'] ?? false) === true);
        }

        $detailFetcher = static fn (int $id): array => $context->rest->get(self::PATH . '/' . $id);

        return self::buildBatch($items, $cursor, $context->now(), $detailFetcher, $this->employeeMap());
    }

    /**
     * Pure diff + event building; $detailFetch is called at most MAX_DETAIL_FETCHES_PER_POLL times,
     * only for ids new to the cursor, and is allowed to fail (the event just loses its quotes).
     * New ids beyond that per-poll budget are DEFERRED: they are not added to `seen`, so the next
     * poll picks them up (with quotes); nothing is lost, a burst just drains over several polls.
     *
     * Monitoring covers at most MAX_PAGES * PAGE_LIMIT (300) newest attention calls of the 7-day
     * window. A late analysis of a call older than the 300 newest attention calls is not detected
     * (documented in Plan/02-sources.md). Ids still visible in the window are re-inserted as the
     * newest `seen` entries every poll, so the MAX_SEEN cap evicts only ids that left the window
     * and a baseline-only id can never resurface as "new" history.
     *
     * @param list<array<string, mixed>> $items
     * @param callable(int): array<string, mixed> $detailFetch
     * @param array<string, array{user_id: ?int, name: string}> $employeeMap
     */
    public static function buildBatch(array $items, array $cursor, int $now, callable $detailFetch, array $employeeMap): SourceBatch
    {
        $current = self::idsFrom($items);
        $seen = self::seenFrom($cursor);
        if ($cursor === []) {
            return SourceBatch::baseline(['seen' => self::capSeen($seen + $current), 'scanned_at' => $now]);
        }

        $newIds = array_values(array_diff(array_keys($current), array_keys($seen)));
        $events = [];
        $processed = [];
        $fetches = 0;
        foreach ($newIds as $refId) {
            if ($fetches >= self::MAX_DETAIL_FETCHES_PER_POLL) {
                break; // deferred, not dropped: stays out of `seen`, the next poll handles it with quotes
            }
            ++$fetches;
            $detail = [];
            try {
                $detail = (array)$detailFetch((int)$refId);
            } catch (\Throwable) {
                $detail = []; // degrade to an event without quotes
            }
            $event = self::buildEvent((array)$current[$refId]['item'], $detail, (int)$refId, $now, $employeeMap);
            if ($event !== null) {
                $events[] = $event;
            }
            $processed[(string)$refId] = 1; // eventless (no call_id) items are final too
        }

        // Refresh positions: every current id that is already seen or was just processed becomes
        // the most recent entry, so the cap never evicts an id that is still visible in the window.
        $refresh = [];
        foreach (array_keys($current) as $refId) {
            if (isset($seen[$refId]) || isset($processed[$refId])) {
                $refresh[(string)$refId] = 1;
            }
        }

        return new SourceBatch($events, ['seen' => self::capSeen(array_diff_key($seen, $refresh) + $refresh), 'scanned_at' => $now]);
    }

    /**
     * Normalised event for moduleaisupervisor#10 (Plan/05): client number, employee, direction,
     * call date/time, duration, reasons, quality score, summary, up to 3 evidence quotes with
     * timecodes, call_id = linkedid.
     *
     * @param array<string, mixed> $item list item
     * @param array<string, mixed> $detail record endpoint response (optional)
     * @param array<string, array{user_id: ?int, name: string}> $employeeMap
     */
    public static function buildEvent(array $item, array $detail, int $refId, int $now, array $employeeMap): ?HubEvent
    {
        $linkedid = trim((string)($item['call_id'] ?? ''));
        if ($linkedid === '') {
            return null;
        }
        $listResult = is_array($item['ai_result'] ?? null) ? $item['ai_result'] : [];
        $detailResult = is_array($detail['ai_result'] ?? null) ? $detail['ai_result'] : [];
        $direction = self::direction($item);
        $clientNumber = match ($direction) {
            'outgoing' => (string)($item['dst_num'] ?? ''),
            default => (string)($item['src_num'] ?? ''),
        };
        $recording = ['kind' => 'recording', 'source' => 'cdr', 'linkedid' => $linkedid];
        $cdrId = (int)($detail['recording_access']['cdr_id'] ?? 0);
        if ($cdrId > 0) {
            $recording['cdr_id'] = $cdrId;
        }

        return new HubEvent(
            sourceId: self::ID,
            eventType: self::EVENT_TYPE,
            severity: HubEvent::SEVERITY_WARNING,
            dedupeKey: 'ai_attention:' . $refId,
            occurredAt: max(1, (int)($listResult['updated_at'] ?? $item['updated_at'] ?? $now)),
            payload: [
                'subject' => [
                    'call' => [
                        'linkedid' => $linkedid,
                        'direction' => $direction,
                        'started_at' => (int)($item['call_timestamp'] ?? 0),
                        'duration_sec' => (int)round((float)($item['duration'] ?? 0)),
                    ],
                    'client_number' => $clientNumber,
                    'employees' => self::employees($item, $employeeMap),
                    'provider' => null,
                    'attention' => [
                        'ref_id' => $refId,
                        'analysis_status' => (string)($item['analysis_status'] ?? ''),
                        'summary' => (string)($listResult['summary'] ?? ''),
                        'sentiment' => (string)($listResult['sentiment'] ?? ''),
                        'risk_score' => $listResult['risk_score'] ?? null,
                        'quality_score' => $listResult['quality_score'] ?? null,
                        'reasons' => self::reasons($listResult['list_view'] ?? []),
                        'analyzed_at' => (int)($listResult['updated_at'] ?? 0),
                    ],
                ],
                'facts' => [
                    'reasons' => self::reasons($listResult['list_view'] ?? []),
                    'summary' => (string)($listResult['summary'] ?? ''),
                    'quotes' => self::quotes($detailResult, $detail),
                    'scores' => [
                        'quality' => $listResult['quality_score'] ?? null,
                        'risk' => $listResult['risk_score'] ?? null,
                        'quality_v2' => self::qualityV2Scores($item),
                    ],
                ],
                'links' => [],
                'attachments' => [$recording],
            ],
        );
    }

    /** internal_call flag -> internal; the employee side of the call dials out -> outgoing; otherwise incoming. */
    private static function direction(array $item): string
    {
        if ((bool)($item['internal_call'] ?? false)) {
            return 'internal';
        }

        return (bool)($item['src_is_employee'] ?? false) ? 'outgoing' : 'incoming';
    }

    /**
     * Employees involved in the call: customer-facing list first, then the employee-side numbers;
     * user_id and the canonical name come from the internal-number map.
     *
     * @param array<string, mixed> $item
     * @param array<string, array{user_id: ?int, name: string}> $employeeMap
     * @return list<array<string, mixed>>
     */
    private static function employees(array $item, array $employeeMap): array
    {
        $numbers = [];
        foreach ((array)($item['customer_facing_employees'] ?? []) as $employee) {
            $number = trim((string)($employee['number'] ?? ''));
            if ($number !== '') {
                $numbers[$number] = (string)($employee['display'] ?? '');
            }
        }
        foreach (['src_num', 'dst_num'] as $field) {
            $number = trim((string)($item[$field] ?? ''));
            if ($number !== '' && isset($employeeMap[$number])) {
                $numbers[$number] ??= (string)($item[$field === 'src_num' ? 'src_display' : 'dst_display'] ?? '');
            }
        }

        $employees = [];
        foreach ($numbers as $number => $displayName) {
            $mapEntry = $employeeMap[$number] ?? null;
            $employees[] = [
                'user_id' => $mapEntry['user_id'] ?? null,
                'number' => $number,
                'name' => $mapEntry['name'] !== '' && $mapEntry['name'] !== null
                    ? (string)$mapEntry['name']
                    : (string)$displayName,
            ];
        }

        return $employees;
    }

    /**
     * Reasons for the attention flag: risk labels, risk drivers, problem flags, the contact reason
     * and topics from the compact list_view.
     *
     * @param array<string, mixed> $listView
     * @return list<string>
     */
    private static function reasons(array $listView): array
    {
        $reasons = [];
        foreach (['risks', 'risk_drivers'] as $key) {
            foreach ((array)($listView[$key] ?? []) as $risk) {
                $label = is_array($risk) ? (string)($risk['label'] ?? $risk['description'] ?? '') : (string)$risk;
                if ($label !== '') {
                    $reasons[] = $label;
                }
            }
        }
        foreach (['problem_flags', 'attention_flags', 'flags', 'issues', 'red_flags'] as $key) {
            foreach ((array)($listView[$key] ?? []) as $flag) {
                $label = is_array($flag) ? (string)($flag['label'] ?? $flag['text'] ?? '') : (string)$flag;
                if ($label !== '') {
                    $reasons[] = $label;
                }
            }
        }
        foreach (['contact_reason', 'next_action'] as $key) {
            $value = (string)($listView[$key] ?? '');
            if ($value !== '') {
                $reasons[] = $value;
            }
        }
        foreach ((array)($listView['topics'] ?? []) as $topic) {
            $label = is_array($topic) ? (string)($topic['label'] ?? '') : (string)$topic;
            if ($label !== '') {
                $reasons[] = $label;
            }
        }

        return array_slice(array_values(array_unique($reasons)), 0, self::MAX_REASON_ITEMS);
    }

    /**
     * Up to 3 evidence quotes with timecodes from the record endpoint (ai_result.indicators.evidence:
     * {quote, start_ms, end_ms, segment_id}); timecodes are milliseconds from the call start.
     *
     * @param array<string, mixed> $detailResult
     * @param array<string, mixed> $detail
     * @return list<array<string, mixed>>
     */
    private static function quotes(array $detailResult, array $detail): array
    {
        $indicators = $detailResult['indicators'] ?? null;
        if (!is_array($indicators)) {
            return [];
        }
        $quotes = [];
        foreach ((array)($indicators['evidence'] ?? []) as $evidence) {
            if (!is_array($evidence)) {
                continue;
            }
            $quote = trim((string)($evidence['quote'] ?? $evidence['text'] ?? ''));
            if ($quote === '') {
                continue;
            }
            $quotes[] = [
                'quote' => $quote,
                'start_ms' => (int)($evidence['start_ms'] ?? 0),
                'end_ms' => (int)($evidence['end_ms'] ?? 0),
                'segment_id' => (string)($evidence['segment_id'] ?? ''),
            ];
            if (count($quotes) >= self::MAX_QUOTES) {
                break;
            }
        }

        return $quotes;
    }

    /** @return list<array<string, mixed>> */
    private static function qualityV2Scores(array $item): array
    {
        $scores = [];
        $qualityV2 = is_array($item['quality_v2'] ?? null) ? $item['quality_v2'] : [];
        foreach ((array)($qualityV2['employees'] ?? []) as $employee) {
            if (!is_array($employee)) {
                continue;
            }
            $scores[] = [
                'number' => (string)($employee['extension'] ?? ''),
                'name' => (string)($employee['name'] ?? ''),
                'score' => $employee['score'] ?? null,
            ];
        }

        return $scores;
    }

    /**
     * @param list<array<string, mixed>> $items
     * @return array<string, array{item: array<string, mixed>}> keyed by ref id (insertion order preserved)
     */
    private static function idsFrom(array $items): array
    {
        $ids = [];
        foreach ($items as $item) {
            $refId = (int)($item['id'] ?? 0);
            if ($refId > 0) {
                $ids[(string)$refId] = ['item' => $item];
            }
        }

        return $ids;
    }

    /** @return array<string, int> map of seen ref ids */
    private static function seenFrom(array $cursor): array
    {
        $seen = [];
        foreach ((array)($cursor['seen'] ?? []) as $id => $item) {
            if (ctype_digit((string)$id)) {
                $seen[(string)$id] = 1;
            }
        }

        return $seen;
    }

    /** Keeps the newest MAX_SEEN entries (callers put the ids still visible in the window last, so they win the cap). */
    private static function capSeen(array $seen): array
    {
        if (count($seen) <= self::MAX_SEEN) {
            return $seen;
        }

        return array_slice($seen, -self::MAX_SEEN, null, true);
    }

    /** @return array<string, array{user_id: ?int, name: string}> */
    private function employeeMap(): array
    {
        $now = time();
        if ($this->employeeMap !== null && $now - $this->mapLoadedAt < self::MAP_TTL_SEC) {
            return $this->employeeMap;
        }
        try {
            $this->employeeMap = ($this->employeeMapProvider)();
            $this->mapLoadedAt = $now;
        } catch (\Throwable) {
            $this->employeeMap ??= [];
            $this->mapLoadedAt = $now;
        }

        return $this->employeeMap;
    }
}
