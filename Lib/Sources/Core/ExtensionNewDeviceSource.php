<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRecorder;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Modules\ModuleMessengerHub\Lib\Sources\TickingSource;

/**
 * core.extension_new_device — push source fed by the Core hook onExtensionStatusChange
 * (Plan/02-sources.md, section 4s-A).
 *
 * Core `Extensions\GetAllStatusesAction` builds `changes[]` per extension and calls
 * `hookModulesMethod('onExtensionStatusChange', [['changes' => …, 'timestamp' => …, 'source' => …]])`
 * (`src/PBXCoreREST/Lib/Extensions/GetAllStatusesAction.php:427-439`). A device change carries
 * `event_type = device_added|device_removed`, `ip_address`, `user_agent` and the full current
 * `devices` list with `ip` / `user_agent` per device (`detectDeviceChanges`, `:275-335`).
 *
 * The hook only records the raw facts: it appends sanitised (ip, user-agent) pairs of the change to
 * the source cursor (`pending`) and returns — a couple of local SQLite statements, no network.
 * `tick()` (WorkerMessengerHubCollector, every pass) folds them into the known-device set and records
 * events. A device pair is IP + User-Agent (the same identifier Core uses, port changes are not new).
 *
 * Baseline: the first device set observed for an extension is stored silently, so enabling the source
 * never broadcasts the phones already registered; a pair already known (or evicted from the bounded
 * history and seen again) produces no event. dedupe_key = newdev:{extension}:{sha1(ip|ua) 12 hex}
 * keeps a restart or a repeated hook call from alerting twice.
 */
final class ExtensionNewDeviceSource implements SourceInterface, TickingSource
{
    public const string ID = 'core.extension_new_device';
    public const string EVENT_TYPE = 'core.extension_new_device';

    private const int MAX_PAIRS_PER_EXTENSION = 10;
    private const int MAX_PAIRS_PER_CHANGE = 10;
    private const int MAX_EXTENSIONS = 1000;
    private const int MAX_PENDING = 200;
    private const int MAX_UA_LENGTH = 120;
    private const int MAX_IP_LENGTH = 64;

    /** Change kinds whose device list is the extension's current device set. */
    private const array DEVICE_EVENTS = ['device_added', 'status_change'];

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
        return [];
    }

    public function mode(): string
    {
        return SourceInterface::MODE_PUSH;
    }

    public function pollIntervalSec(): int
    {
        return 0;
    }

    public function poll(SourceContext $context, array $cursor): SourceBatch
    {
        return SourceBatch::baseline([]);
    }

    /**
     * Hook side (pure): append the raw device facts of the change list to the cursor "pending" queue.
     *
     * @param list<array<string, mixed>> $changes Core changes[] entries
     * @param list<array<string, mixed>> $pending cursor["pending"]
     * @return list<array<string, mixed>> new pending list (unchanged when nothing is relevant)
     */
    public static function queueChanges(array $changes, array $pending, int $now): array
    {
        foreach ($changes as $change) {
            if (!is_array($change)) {
                continue;
            }
            $eventType = (string)($change['event_type'] ?? '');
            if (!in_array($eventType, self::DEVICE_EVENTS, true)) {
                continue;
            }
            $extension = trim((string)($change['extension'] ?? ''));
            if ($extension === '') {
                continue;
            }
            $pairs = self::changePairs($change);
            if ($pairs === []) {
                continue;
            }
            $pending[] = [
                'extension' => $extension,
                'event' => $eventType,
                'ts' => max(1, (int)($change['timestamp'] ?? $now)),
                'pairs' => $pairs,
            ];
        }
        if (count($pending) > self::MAX_PENDING) {
            $pending = array_slice($pending, -self::MAX_PENDING);
        }

        return $pending;
    }

    /**
     * Worker side (pure): fold pending facts into the known set and build the events for new devices.
     *
     * @param list<array<string, mixed>> $pending
     * @param array<string, mixed> $devices cursor["devices"]: extension => {pairs: {sig: {first, seen}}, seen_at}
     * @return array{0: list<HubEvent>, 1: array<string, mixed>}
     */
    public static function flush(array $pending, array $devices, int $now): array
    {
        $events = [];
        foreach ($pending as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $extension = trim((string)($entry['extension'] ?? ''));
            if ($extension === '') {
                continue;
            }
            $ts = max(1, (int)($entry['ts'] ?? $now));
            $isNewExtension = !isset($devices[$extension]);
            $known = is_array($devices[$extension]['pairs'] ?? null) ? $devices[$extension]['pairs'] : [];
            foreach (is_array($entry['pairs'] ?? null) ? $entry['pairs'] : [] as $pair) {
                if (!is_array($pair)) {
                    continue;
                }
                $ip = self::sanitise((string)($pair['ip'] ?? ''), self::MAX_IP_LENGTH);
                $userAgent = self::sanitise((string)($pair['user_agent'] ?? ''), self::MAX_UA_LENGTH);
                if ($ip === '' && $userAgent === '') {
                    continue;
                }
                $signature = self::signature($ip, $userAgent);
                if (isset($known[$signature])) {
                    $known[$signature]['seen'] = $ts;

                    continue;
                }
                if (!$isNewExtension) {
                    $events[] = self::buildEvent($extension, $ip, $userAgent, $signature, $ts, count($known));
                }
                $known[$signature] = ['first' => $ts, 'seen' => $ts];
            }
            $devices[$extension] = [
                'pairs' => self::capPairs($known),
                'seen_at' => $ts,
            ];
        }

        return [$events, self::capExtensions($devices)];
    }

    public function tick(SourceStateRepository $states, SourceRecorder $recorder, int $now): void
    {
        $state = $states->get(self::ID);
        if (!$state['enabled']) {
            return;
        }
        $cursor = $state['cursor'];
        $pending = is_array($cursor['pending'] ?? null) ? $cursor['pending'] : [];
        if ($pending === []) {
            return;
        }
        $devices = is_array($cursor['devices'] ?? null) ? $cursor['devices'] : [];
        [$events, $flushed] = self::flush($pending, $devices, $now);
        foreach ($events as $event) {
            $recorder->record($event, $now); // idempotent by dedupe_key when the CAS below loses
        }
        // a hook that queued a newer fact in the meantime wins: its pending stays, the next tick folds it
        $states->compareAndSaveCursor(self::ID, $cursor, ['devices' => $flushed, 'pending' => []] + $cursor);
    }

    public static function signature(string $ip, string $userAgent): string
    {
        return substr(sha1($ip . '|' . $userAgent), 0, 12);
    }

    /**
     * Sanitised (ip, user-agent) pairs of one change: the change's own device plus its device list,
     * deduplicated by signature, bounded. Control characters never reach the cursor or a message.
     *
     * @param array<string, mixed> $change
     * @return list<array{ip: string, user_agent: string}>
     */
    private static function changePairs(array $change): array
    {
        $raw = [];
        $raw[] = ['ip' => (string)($change['ip_address'] ?? ''), 'user_agent' => (string)($change['user_agent'] ?? '')];
        foreach (is_array($change['devices'] ?? null) ? $change['devices'] : [] as $device) {
            if (is_array($device)) {
                $raw[] = ['ip' => (string)($device['ip'] ?? ''), 'user_agent' => (string)($device['user_agent'] ?? '')];
            }
        }
        $pairs = [];
        foreach ($raw as $pair) {
            $ip = self::sanitise($pair['ip'], self::MAX_IP_LENGTH);
            $userAgent = self::sanitise($pair['user_agent'], self::MAX_UA_LENGTH);
            if ($ip === '' && $userAgent === '') {
                continue;
            }
            $signature = self::signature($ip, $userAgent);
            if (!isset($pairs[$signature])) {
                $pairs[$signature] = ['ip' => $ip, 'user_agent' => $userAgent];
            }
        }

        return array_slice(array_values($pairs), 0, self::MAX_PAIRS_PER_CHANGE);
    }

    private static function buildEvent(string $extension, string $ip, string $userAgent, string $signature, int $ts, int $knownDevices): HubEvent
    {
        return new HubEvent(
            sourceId: self::ID,
            eventType: self::EVENT_TYPE,
            severity: HubEvent::SEVERITY_WARNING,
            dedupeKey: 'newdev:' . $extension . ':' . $signature,
            occurredAt: max(1, $ts),
            payload: [
                'subject' => [
                    'call' => null,
                    'client_number' => '',
                    'employees' => [],
                    'provider' => null,
                    'device' => [
                        'extension' => $extension,
                        'ip' => $ip,
                        'user_agent' => $userAgent,
                        'known_devices' => $knownDevices,
                    ],
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => [],
            ],
        );
    }

    /** Strips control characters, collapses whitespace and truncates (untrusted input). */
    private static function sanitise(string $value, int $maxLength): string
    {
        $value = (string)preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $value);
        $value = trim((string)preg_replace('/\s+/u', ' ', $value));
        if ($value === '') {
            return '';
        }

        return mb_substr($value, 0, $maxLength);
    }

    /**
     * @param array<string, array{first: int, seen: int}> $pairs
     * @return array<string, array{first: int, seen: int}>
     */
    private static function capPairs(array $pairs): array
    {
        if (count($pairs) <= self::MAX_PAIRS_PER_EXTENSION) {
            return $pairs;
        }
        uasort($pairs, static fn (array $a, array $b): int => ((int)$a['seen'] <=> (int)$b['seen']) ?: ((int)$a['first'] <=> (int)$b['first']));

        return array_slice($pairs, -self::MAX_PAIRS_PER_EXTENSION, null, true);
    }

    /** @param array<string, mixed> $devices */
    private static function capExtensions(array $devices): array
    {
        if (count($devices) <= self::MAX_EXTENSIONS) {
            return $devices;
        }
        uasort(
            $devices,
            static fn (array $a, array $b): int => (int)($a['seen_at'] ?? 0) <=> (int)($b['seen_at'] ?? 0)
        );

        return array_slice($devices, -self::MAX_EXTENSIONS, null, true);
    }
}
