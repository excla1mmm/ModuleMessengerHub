<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;

/**
 * core.advice — poll source over GET /pbxcore/api/v3/advice (read with the hub API key).
 *
 * The response data.advice is grouped by level ("error", "warning", "info", "needUpdate", ...);
 * items carry messageTpl + messageParams (+ optional severity/category), some are plain string
 * markers used by the web UI and are not messages.
 *
 * Cursor = {"seen": {"<tpl>:<hash>": {"first": "<Y-m-d>", "last": "<Y-m-d>"}}}: the fingerprints
 * of the items seen recently. A first poll (baseline) or an item already in the set produces no
 * events. A newly appeared item of level "error" or "warning" becomes an event (severity
 * critical/warning from the level). dedupe_key embeds the "first" day:
 * advice:{messageTpl}:{hash(params)}:{first_seen_day}.
 *
 * Why the set outlives the list: right after a PBX restart Core's advice list is temporarily
 * empty or partial until WorkerPrepareAdvice recomputes it, and the same warnings then come back.
 * So:
 * - a fingerprint that left the list is kept with its last-seen day and forgotten only after
 *   RETENTION_DAYS of absence; coming back within that period produces no event, coming back
 *   later is a new event (a new "first" day, so a new dedupe_key);
 * - a payload without a single usable item (empty list, missing/garbled data.advice, only UI
 *   marker strings) is "no information": no events and the cursor is returned unchanged;
 * - the set is capped at MAX_SEEN entries, absent ones are evicted first (oldest last-seen first),
 *   currently visible ones are never evicted.
 * Old cursor format {"seen": {"<fp>": "<first day>"}} is read as seen-today, so an upgrade
 * announces nothing.
 */
final class AdviceSource implements SourceInterface
{
    public const string ID = 'core.advice';
    public const string EVENT_TYPE = 'core.advice';
    public const string PATH = '/pbxcore/api/v3/advice';

    private const int MAX_SEEN = 200;
    public const int RETENTION_DAYS = 7;

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
        return ['/api/v3/advice'];
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
        $data = $context->rest->get(self::PATH);
        $advice = $data['advice'] ?? [];

        return self::buildBatch(is_array($advice) ? $advice : [], $cursor, $context->now());
    }

    /**
     * Pure diff of the advice snapshot against the cursor — unit-tested against fixtures.
     *
     * @param array<string, list<array<string, mixed>|string>> $advice data.advice grouped by level
     * @param array<string, mixed> $cursor [] for the baseline poll
     */
    public static function buildBatch(array $advice, array $cursor, int $now): SourceBatch
    {
        $current = self::currentItems($advice);
        if ($current === []) {
            // no information (restart, partial response): never shrink the cursor, never alert;
            // an empty baseline stays a baseline so the first real list is not broadcast as news
            return new SourceBatch([], $cursor);
        }
        $today = date('Y-m-d', $now);
        $seen = self::readSeen($cursor, $today);

        $events = [];
        if ($cursor !== []) {
            foreach ($current as $fingerprint => $item) {
                if (isset($seen[$fingerprint]) && self::daysBetween($seen[$fingerprint]['last'], $today) <= self::RETENTION_DAYS) {
                    continue;
                }
                if ($item['level'] === 'error' || $item['level'] === 'warning') {
                    $events[] = self::buildEvent($fingerprint, $item, $today, $now);
                }
            }
        }

        return new SourceBatch($events, ['seen' => self::mergeSeen($current, $seen, $today)]);
    }

    /**
     * Reads both cursor formats into {fingerprint: {first, last}}. The old format (a plain day
     * string = first seen) gets last = today: it only ever held visible items.
     *
     * @param array<string, mixed> $cursor
     * @return array<string, array{first: string, last: string}>
     */
    private static function readSeen(array $cursor, string $today): array
    {
        $seen = [];
        $raw = $cursor['seen'] ?? [];
        foreach (is_array($raw) ? $raw : [] as $fingerprint => $entry) {
            if (!is_string($fingerprint)) {
                continue;
            }
            if (is_string($entry) && $entry !== '') {
                $seen[$fingerprint] = ['first' => $entry, 'last' => $today];
            } elseif (is_array($entry) && is_string($entry['first'] ?? null) && $entry['first'] !== '') {
                $last = is_string($entry['last'] ?? null) && $entry['last'] !== '' ? $entry['last'] : $entry['first'];
                $seen[$fingerprint] = ['first' => $entry['first'], 'last' => $last];
            }
        }

        return $seen;
    }

    private static function daysBetween(string $from, string $to): int
    {
        $a = strtotime($from . ' 12:00:00');
        $b = strtotime($to . ' 12:00:00');
        if ($a === false || $b === false) {
            return 0;
        }

        return (int)round(($b - $a) / 86400);
    }

    /**
     * Flattens the response: dict items with messageTpl only, keyed by fingerprint;
     * the same fingerprint in several levels keeps the most severe level (error first).
     *
     * @return array<string, array{message_tpl: string, params: array<string, mixed>,
     *     level: string, category: string}>
     */
    private static function currentItems(array $advice): array
    {
        $items = [];
        foreach ($advice as $level => $messages) {
            if (!is_string($level) || !is_array($messages)) {
                continue;
            }
            $level = strtolower($level);
            if (!in_array($level, ['error', 'warning', 'info'], true)) {
                continue; // "needUpdate" and friends are UI navigation markers
            }
            foreach ($messages as $message) {
                if (!is_array($message) || !is_string($message['messageTpl'] ?? null) || $message['messageTpl'] === '') {
                    continue;
                }
                $params = is_array($message['messageParams'] ?? null) ? $message['messageParams'] : [];
                $fingerprint = self::fingerprint($message['messageTpl'], $params);
                if (isset($items[$fingerprint]) && $items[$fingerprint]['level'] !== 'error' && $level === 'warning') {
                    continue; // keep the more severe level
                }
                $items[$fingerprint] = [
                    'message_tpl' => $message['messageTpl'],
                    'params' => $params,
                    'level' => $level,
                    'category' => is_string($message['category'] ?? null) ? $message['category'] : '',
                ];
            }
        }

        return $items;
    }

    /** @param array<string, array{message_tpl: string, params: array<string, mixed>, level: string, category: string}> $current */
    private static function buildEvent(string $fingerprint, array $item, string $today, int $now): HubEvent
    {
        $paramsHash = md5(self::paramsJson($item['params']));
        $isError = $item['level'] === 'error';

        return new HubEvent(
            sourceId: self::ID,
            eventType: self::EVENT_TYPE,
            severity: $isError ? HubEvent::SEVERITY_CRITICAL : HubEvent::SEVERITY_WARNING,
            dedupeKey: 'advice:' . $item['message_tpl'] . ':' . $paramsHash . ':' . $today,
            occurredAt: $now,
            payload: [
                'subject' => [
                    'call' => null,
                    'client_number' => '',
                    'employees' => [],
                    'provider' => null,
                    'advice' => [
                        'message_tpl' => $item['message_tpl'],
                        'params' => $item['params'],
                        'level' => $item['level'],
                        'category' => $item['category'],
                        'fingerprint' => $fingerprint,
                    ],
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => [],
            ],
        );
    }

    /**
     * New cursor set: visible items (first day kept for known ones, today for new or expired ones,
     * last = today) plus absent ones still within the retention period; capped, absent evicted first.
     *
     * @param array<string, array{message_tpl: string, params: array<string, mixed>, level: string, category: string}> $current
     * @param array<string, array{first: string, last: string}> $seen
     * @return array<string, array{first: string, last: string}>
     */
    private static function mergeSeen(array $current, array $seen, string $today): array
    {
        $absent = [];
        foreach ($seen as $fingerprint => $entry) {
            if (!isset($current[$fingerprint]) && self::daysBetween($entry['last'], $today) <= self::RETENTION_DAYS) {
                $absent[$fingerprint] = $entry;
            }
        }
        uasort($absent, static fn (array $x, array $y): int => strcmp($y['last'], $x['last'])); // newest first
        $visible = [];
        foreach ($current as $fingerprint => $item) {
            $known = $seen[$fingerprint] ?? null;
            $expired = $known === null || self::daysBetween($known['last'], $today) > self::RETENTION_DAYS;
            $visible[$fingerprint] = ['first' => $expired ? $today : $known['first'], 'last' => $today];
        }
        $room = max(0, self::MAX_SEEN - count($visible));

        return $visible + array_slice($absent, 0, $room, true);
    }

    /**
     * @param array<string, mixed> $params
     */
    private static function fingerprint(string $messageTpl, array $params): string
    {
        return $messageTpl . ':' . md5(self::paramsJson($params));
    }

    /**
     * @param array<string, mixed> $params
     */
    private static function paramsJson(array $params): string
    {
        self::ksortRecursive($params);

        return json_encode($params, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /** Sorts associative arrays by key at any depth so hash(params) is stable. */
    private static function ksortRecursive(array &$array): void
    {
        foreach ($array as &$value) {
            if (is_array($value)) {
                self::ksortRecursive($value);
            }
        }
        unset($value);
        if (!array_is_list($array)) {
            ksort($array, SORT_STRING);
        }
    }
}
