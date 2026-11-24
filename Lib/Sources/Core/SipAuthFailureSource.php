<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceException;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
use Throwable;

/**
 * core.sip_auth_failures — poll source over the Core SIP auth-failure statistics
 * (Plan/02-sources.md, section 4s-A).
 *
 * Core `WorkerStatusMonitor::checkAuthFailures()` asks `/pbxcore/api/v3/sip:processAuthFailures`, and
 * `Sip\ProcessAuthFailuresAction` parses Asterisk's `security_log` for `ChallengeResponseFailed`,
 * keeping only internal extensions (`Sip` rows with `type = 'peer'`, `:114-142`). The counters are
 * stored in Redis as `Extensions:AuthFailures:<extension>` = { "<source ip>": {count, last_attempt,
 * remote_address} } with a 24-hour TTL (`:302-338`), and are served per extension by
 * `GET /pbxcore/api/v3/sip/{extension}:getAuthFailureStats`
 * (`Sip\GetAuthFailureStatsAction::main`, REST route `/pbxcore/api/v3/sip/{id}:getAuthFailureStats`).
 *
 * Poll (60 s) over a rotation of the internal extension list (read from the Core `Sip` model through
 * Lib/Support/AuthFailureTargetsLoader, read-only thin glue — the model is not touched). Extensions
 * with a known failure history or an open episode go first; the rest rotate, at most
 * `sip_authfail_extensions_per_poll` requests per poll, so a large PBX is covered over several polls.
 *
 * Event: the cumulative counter of an extension grows by >= `sip_authfail_threshold` failures inside
 * `sip_authfail_window_min` minutes. One event per episode, dedupe
 * `authfail:{extension}:{episode start}`; the episode ends after `sip_authfail_quiet_min` minutes
 * without a new failed attempt (Core's `last_attempt`), and the next growth is a new episode.
 * A counter that went down (Redis TTL, manual clear) closes the episode silently.
 * Baseline: a first observation only stores the counter — history is never broadcast.
 */
final class SipAuthFailureSource implements SourceInterface
{
    public const string ID = 'core.sip_auth_failures';
    public const string EVENT_TYPE = 'core.sip_auth_failures';
    public const string API_READ_PATH = '/api/v3/sip';
    public const string PATH_PREFIX = '/pbxcore' . self::API_READ_PATH . '/';

    private const int MAX_EXTENSIONS = 500;
    private const int MAX_SAMPLES = 60;
    private const int MAX_IPS = 3;

    /** @var callable(): list<string> */
    private $targetsProvider;

    /** @var callable(): array<string, string> raw settings values (HubSettings keys) */
    private $settingsProvider;

    /**
     * @param callable(): list<string> $targetsProvider internal extension numbers to watch
     * @param callable(): array<string, string> $settingsProvider stored settings values
     */
    public function __construct(?callable $targetsProvider = null, ?callable $settingsProvider = null)
    {
        $this->targetsProvider = $targetsProvider ?? static fn (): array => [];
        $this->settingsProvider = $settingsProvider ?? static fn (): array => HubSettings::DEFAULTS;
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
        $policy = $this->policy();
        $targets = self::targets($this->targetsList());
        if ($cursor === []) {
            // baseline: only the cursor; no extension is asked and nothing is broadcast
            return SourceBatch::baseline(['exts' => [], 'rotation' => 0, 'baseline_at' => $context->now()]);
        }

        $exts = is_array($cursor['exts'] ?? null) ? $cursor['exts'] : [];
        [$selected, $rotation] = self::selectTargets(
            $targets,
            $exts,
            $policy->extensionsPerPoll,
            (int)($cursor['rotation'] ?? 0),
            $context->now(),
            $policy->quietSec()
        );

        $observed = [];
        foreach ($selected as $extension) {
            $extension = (string)$extension;
            try {
                $observed[$extension] = $context->rest->get(
                    self::PATH_PREFIX . rawurlencode($extension) . ':getAuthFailureStats'
                );
            } catch (SourceException $exception) {
                if (in_array($exception->errorCode, ['api_not_found', 'api_bad_response'], true)) {
                    continue; // an extension without stats (or removed): not the whole source failing
                }

                throw $exception;
            }
        }

        return self::buildBatch(
            $observed,
            $cursor,
            $targets,
            $rotation,
            $context->now(),
            $policy->threshold,
            $policy->windowMin,
            $policy->quietMin
        );
    }

    /**
     * Pure fold of the observed per-extension stats into events and the next cursor.
     *
     * @param array<string, array<mixed>> $observed extension => stats data ({ip: {count, last_attempt, remote_address}})
     * @param array<string, mixed> $cursor
     * @param list<string> $targets current internal extension list
     */
    public static function buildBatch(
        array $observed,
        array $cursor,
        array $targets,
        int $rotation,
        int $now,
        int $threshold,
        int $windowMin,
        int $quietMin
    ): SourceBatch {
        $exts = is_array($cursor['exts'] ?? null) ? $cursor['exts'] : [];
        $windowSec = max(60, $windowMin * 60);
        $quietSec = max(60, $quietMin * 60);
        $events = [];

        foreach ($observed as $extension => $stats) {
            $extension = (string)$extension;
            if ($extension === '' || !is_array($stats)) {
                continue;
            }
            $entry = is_array($exts[$extension] ?? null) ? $exts[$extension] : null;
            [$ips, $total, $lastAttempt] = self::summarise($stats);
            $samples = is_array($entry['samples'] ?? null) ? $entry['samples'] : [];
            $previousTotal = isset($entry['total']) && is_numeric($entry['total']) ? (int)$entry['total'] : null;
            $episode = is_array($entry['episode'] ?? null) ? $entry['episode'] : null;

            if ($previousTotal !== null && $total < $previousTotal) {
                // the Redis counter was reset (TTL or ClearAuthFailureStats): a new baseline, no event
                $samples = [];
                $episode = null;
            }
            if ($entry === null && $total === 0) {
                continue; // a silent extension needs no cursor entry until it has a failure
            }

            $samples[] = ['t' => $now, 'total' => $total];
            $samples = self::pruneSamples($samples, $now, $windowSec);
            $anchor = self::anchor($samples, $now, $windowSec);
            // a counter seen for the first time that is already high AND whose last attempt is inside
            // the window is an ongoing brute force, not history: alert with Core's last attempt as the
            // episode start (a stale counter of the 24-hour TTL has an old last_attempt and stays silent)
            $freshBurst = $entry === null
                && $total >= $threshold
                && $lastAttempt > 0
                && $lastAttempt >= $now - $windowSec;
            $growth = $freshBurst ? $total : max(0, $total - (int)$anchor['total']);
            $lastGrowthAt = (int)($entry['last_growth_at'] ?? 0);
            if ($previousTotal !== null && $total > $previousTotal) {
                $lastGrowthAt = $now;
            }

            if ($episode !== null) {
                $activity = max((int)$episode['last_activity'], $lastAttempt > 0 ? $lastAttempt : 0);
                if ($now - $activity >= $quietSec) {
                    // the wave is over: the counter history starts again so the same stale growth
                    // cannot immediately open a second episode (a new episode needs NEW failures)
                    $episode = null;
                    $samples = [['t' => $now, 'total' => $total]];
                    $growth = 0;
                    $lastGrowthAt = 0;
                } else {
                    // activity is the last real attempt or growth, never the poll time: otherwise a
                    // poll every minute would keep the episode open forever
                    $episode['last_activity'] = max($activity, $lastGrowthAt);
                }
            }
            if ($episode === null && $growth >= $threshold) {
                $episode = [
                    'start' => $freshBurst ? $lastAttempt : (int)$anchor['t'],
                    'last_activity' => max($lastAttempt, $lastGrowthAt, $now),
                ];
                $events[] = self::buildEvent(
                    $extension,
                    $total,
                    $growth,
                    $ips,
                    (int)$episode['start'],
                    $windowMin,
                    max(1, $lastAttempt > 0 ? $lastAttempt : $now)
                );
            }

            $exts[$extension] = [
                'total' => $total,
                'last_attempt' => $lastAttempt,
                'last_growth_at' => $lastGrowthAt,
                'samples' => $samples,
                'episode' => $episode,
                'touched_at' => $now,
            ];
        }

        return new SourceBatch($events, [
            'exts' => self::capExtensions($exts, $targets),
            'rotation' => $rotation,
            'baseline_at' => (int)($cursor['baseline_at'] ?? $now),
        ]);
    }

    /**
     * Which extensions to ask this cycle: those with an open episode or recent history first, then
     * the rest of the list in rotation. Bounded by $perPoll requests.
     *
     * @param list<string> $targets
     * @param array<string, mixed> $exts
     * @return array{0: list<string>, 1: int} selected extensions and the next rotation offset
     */
    public static function selectTargets(array $targets, array $exts, int $perPoll, int $rotation, int $now, int $quietSec): array
    {
        $perPoll = max(1, $perPoll);
        if ($targets === []) {
            return [[], 0];
        }
        sort($targets, SORT_STRING);
        $priority = [];
        foreach ($targets as $extension) {
            $entry = $exts[$extension] ?? null;
            if (!is_array($entry)) {
                continue;
            }
            $hasEpisode = is_array($entry['episode'] ?? null);
            $lastAttempt = (int)($entry['last_attempt'] ?? 0);
            $recent = $lastAttempt > 0 && $now - $lastAttempt < $quietSec;
            if ($hasEpisode || $recent) {
                $priority[$extension] = [$hasEpisode ? 0 : 1, -$lastAttempt];
            }
        }
        uasort($priority, static fn (array $a, array $b): int => ($a[0] <=> $b[0]) ?: ($a[1] <=> $b[1]));
        $selected = array_slice(array_map('strval', array_keys($priority)), 0, $perPoll);

        $rest = array_values(array_diff($targets, array_map('strval', $selected)));
        if ($rest !== [] && count($selected) < $perPoll) {
            $need = min($perPoll - count($selected), count($rest));
            $offset = $rotation % count($rest);
            for ($i = 0; $i < $need; $i++) {
                $selected[] = $rest[($offset + $i) % count($rest)];
            }
            $rotation = ($offset + $need) % count($rest);
        }

        return [$selected, $rest === [] ? 0 : $rotation];
    }

    /**
     * Normalises the extension list: unique non-empty strings, bounded, stable order.
     *
     * @param list<string> $values
     * @return list<string>
     */
    public static function targets(array $values): array
    {
        $targets = [];
        foreach ($values as $value) {
            $extension = trim((string)$value);
            if ($extension !== '' && strlen($extension) <= 64 && !in_array($extension, $targets, true)) {
                $targets[] = $extension;
            }
            if (count($targets) >= self::MAX_EXTENSIONS) {
                break;
            }
        }

        return $targets;
    }

    /**
     * Totals of the Core stats object: total counter, the newest attempt time and up to 3 top source IPs.
     *
     * @param array<mixed> $stats
     * @return array{0: list<array{ip: string, count: int}>, 1: int, 2: int}
     */
    private static function summarise(array $stats): array
    {
        $ips = [];
        $total = 0;
        $lastAttempt = 0;
        foreach ($stats as $ip => $row) {
            if (!is_string($ip) || !is_array($row)) {
                continue;
            }
            $count = (int)($row['count'] ?? 0);
            $total += max(0, $count);
            $lastAttempt = max($lastAttempt, (int)($row['last_attempt'] ?? 0));
            $ips[] = ['ip' => self::sanitiseIp($ip), 'count' => max(0, $count)];
        }
        usort($ips, static fn (array $a, array $b): int => $b['count'] <=> $a['count']);

        return [array_slice($ips, 0, self::MAX_IPS), $total, $lastAttempt];
    }

    private static function sanitiseIp(string $ip): string
    {
        $clean = (string)preg_replace('/[^0-9A-Fa-f:.]/', '', $ip);

        return mb_substr($clean !== '' ? $clean : 'unknown', 0, 45);
    }

    /**
     * Keeps the samples inside the window plus one anchor sample just before it, newest last.
     *
     * @param list<array{t: int, total: int}> $samples
     * @return list<array{t: int, total: int}>
     */
    private static function pruneSamples(array $samples, int $now, int $windowSec): array
    {
        $windowStart = $now - $windowSec;
        $inside = [];
        $anchor = null;
        foreach ($samples as $sample) {
            if (!is_array($sample)) {
                continue;
            }
            $t = (int)($sample['t'] ?? 0);
            $total = (int)($sample['total'] ?? 0);
            if ($t <= $windowStart) {
                $anchor = ['t' => $t, 'total' => $total];
            } else {
                $inside[] = ['t' => $t, 'total' => $total];
            }
        }
        $result = $anchor === null ? $inside : array_merge([$anchor], $inside);
        if ($result === []) {
            $result[] = ['t' => $now, 'total' => 0];
        }

        return array_slice($result, -self::MAX_SAMPLES);
    }

    /**
     * The sample growth is counted from: the newest one at or before the window start, else the
     * oldest sample inside the window.
     *
     * @param list<array{t: int, total: int}> $samples
     * @return array{t: int, total: int}
     */
    private static function anchor(array $samples, int $now, int $windowSec): array
    {
        $windowStart = $now - $windowSec;
        $candidate = $samples[0];
        foreach ($samples as $sample) {
            if ((int)$sample['t'] <= $windowStart) {
                $candidate = $sample;
            }
        }

        return $candidate;
    }

    /**
     * @param list<array{ip: string, count: int}> $ips
     */
    private static function buildEvent(
        string $extension,
        int $total,
        int $growth,
        array $ips,
        int $episodeStart,
        int $windowMin,
        int $lastAttempt
    ): HubEvent {
        return new HubEvent(
            sourceId: self::ID,
            eventType: self::EVENT_TYPE,
            severity: HubEvent::SEVERITY_WARNING,
            dedupeKey: 'authfail:' . $extension . ':' . $episodeStart,
            occurredAt: max(1, $lastAttempt),
            payload: [
                'subject' => [
                    'call' => null,
                    'client_number' => '',
                    'employees' => [['user_id' => null, 'number' => $extension, 'name' => '']],
                    'provider' => null,
                    'auth_failures' => [
                        'extension' => $extension,
                        'failures' => $total,
                        'growth' => $growth,
                        'window_min' => $windowMin,
                        'since' => $episodeStart,
                        'ips' => $ips,
                    ],
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => [],
            ],
        );
    }

    /**
     * Drops entries of extensions that left the configuration and caps the number of tracked ones.
     *
     * @param array<string, mixed> $exts
     * @param list<string> $targets
     * @return array<string, mixed>
     */
    private static function capExtensions(array $exts, array $targets): array
    {
        if ($targets !== []) {
            $known = array_flip($targets);
            $exts = array_filter(
                $exts,
                static fn (mixed $value, mixed $extension): bool => isset($known[(string)$extension]),
                ARRAY_FILTER_USE_BOTH
            );
        }
        if (count($exts) <= self::MAX_EXTENSIONS) {
            return $exts;
        }
        uasort($exts, static fn (array $a, array $b): int => (int)($a['touched_at'] ?? 0) <=> (int)($b['touched_at'] ?? 0));

        return array_slice($exts, -self::MAX_EXTENSIONS, null, true);
    }

    /** @return list<string> */
    private function targetsList(): array
    {
        try {
            return ($this->targetsProvider)();
        } catch (Throwable) {
            return []; // Core models unavailable: nothing to poll, the next pass retries
        }
    }

    private function policy(): SipAuthFailPolicy
    {
        try {
            $values = ($this->settingsProvider)();

            return SipAuthFailPolicy::fromValues(is_array($values) ? $values : []);
        } catch (Throwable) {
            return SipAuthFailPolicy::defaults();
        }
    }
}
