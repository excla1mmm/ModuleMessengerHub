<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceException;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;

/**
 * core.external_ip_changed — poll source over GET /pbxcore/api/v3/sysinfo:getExternalIpInfo (4s-C).
 *
 * The Core action runs `_myip` (src/PBXCoreREST/Lib/Sysinfo/GetExternalIpInfoAction.php:43-52), which
 * asks an OUTSIDE service — https://checkip.amazonaws.com (src/Core/System/RootFS/etc/profile:78-100,
 * `_myip()`), with a 3 s timeout. Core itself calls it from the cron only while
 * `AUTO_UPDATE_EXTERNAL_IP` is on (src/Core/System/Configs/CronConf.php:160-163: every minute) and from
 * the network page. The hub therefore polls rarely and never in a burst:
 *
 *  - the normal interval is `external_ip_poll_min` (HubSettings, default 15 min); pollIntervalSec() is
 *    only the collector's granularity — poll() returns without any request while not due;
 *  - Core calls `onAfterNetworkConfigured` (src/Core/System/Network.php:1015 and 1216) after the network
 *    is applied; the hook only writes `recheck` into the cursor (no network I/O in a hook), and the
 *    next collector pass (5 s) does the lookup;
 *  - the new address must be seen on TWO CONSECUTIVE checks (the admin usually changes the network and
 *    the address settles a minute later). After the first sighting the next check is scheduled in a
 *    minute, so the confirmation does not wait for the full interval;
 *  - a failed lookup (no internet, the service is down) is NOT a change: the candidate is dropped (so
 *    only really consecutive sightings confirm) and the next check is retried in a minute.
 *
 * Baseline: the first successful lookup only stores the address — installing the hub does not announce
 * the current address. dedupe_key = extip:{sha1(new ip) 12}:{first seen ts}, so the same address coming
 * back after a real change is a new event, while a repeated poll of the same address is swallowed.
 * The PBX's own external address is not personal data (Plan/07): it is written to pjsip.conf by Core
 * and it identifies the PBX, not a person. It is the only address in the payload — no client numbers.
 */
final class ExternalIpSource implements SourceInterface
{
    public const string ID = 'core.external_ip_changed';
    public const string EVENT_TYPE = 'core.external_ip_changed';
    public const string PATH = '/pbxcore/api/v3/sysinfo:getExternalIpInfo';
    public const string API_READ_PATH = '/api/v3/sysinfo';

    /** How soon to look again after an urgent recheck (Core changed the network) or after the first sighting of a new address. */
    public const int RECHECK_RETRY_SEC = 60;

    /** How soon to retry a failed lookup instead of waiting the whole interval. */
    public const int FAILED_RETRY_SEC = 60;

    /** @var (callable(): int)|null */
    private $intervalMin;

    /** @param (callable(): int)|null $intervalMin minutes between checks; null = 15 */
    public function __construct(?callable $intervalMin = null)
    {
        $this->intervalMin = $intervalMin;
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

    /** The collector's granularity: the real interval lives in the cursor (see poll()). */
    public function pollIntervalSec(): int
    {
        return 60;
    }

    public function poll(SourceContext $context, array $cursor): SourceBatch
    {
        $now = $context->now();
        $interval = max(1, $this->interval()) * 60;
        if (!self::isDue($cursor, $now)) {
            return new SourceBatch([], $cursor);
        }

        try {
            $data = $context->rest->get(self::PATH);
        } catch (SourceException $exception) {
            if ($exception->errorCode !== 'api_bad_response') {
                throw $exception; // a key/module problem must stay visible as the source state
            }
            $data = [];
        }

        $ip = self::ipFrom($data);
        [$event, $newCursor] = self::observe($cursor, $ip, $now, $interval);

        return new SourceBatch($event === null ? [] : [$event], $newCursor);
    }

    /** @param array<string, mixed> $cursor */
    public static function isDue(array $cursor, int $now): bool
    {
        if ($cursor === []) {
            return true; // baseline is due immediately
        }
        if (($cursor['recheck'] ?? false) === true) {
            return true;
        }
        $next = (int)($cursor['next_check_at'] ?? 0);

        return $next === 0 || $now >= $next;
    }

    /**
     * The address of the answer, or null when Core could not find one.
     *
     * Core returns 200 with `result: false` when the lookup failed ("Systems without internet access or
     * behind NAT are valid states", GetExternalIpInfoAction.php:38-41); the REST envelope then carries
     * no usable data, which unwrap() reports as api_bad_response — poll() treats it as "no answer".
     *
     * @param array<string, mixed> $data PBXApiResult data
     */
    public static function ipFrom(array $data): ?string
    {
        $ip = $data['ip'] ?? null;
        if (!is_string($ip)) {
            return null;
        }
        $ip = trim($ip);

        return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false ? null : $ip;
    }

    /**
     * Pure state machine: cursor + observed address => (event or null, new cursor).
     *
     * @param array<string, mixed> $cursor
     * @return array{0: ?HubEvent, 1: array<string, mixed>}
     */
    public static function observe(array $cursor, ?string $observed, int $now, int $intervalSec): array
    {
        $known = is_string($cursor['ip'] ?? null) ? (string)$cursor['ip'] : '';
        $candidate = is_string($cursor['candidate'] ?? null) ? (string)$cursor['candidate'] : '';
        $candidateSince = (int)($cursor['candidate_since'] ?? 0);
        $base = ['ip' => $known, 'checked_at' => $now, 'recheck' => false];

        if ($observed === null) {
            // a failed lookup is not a change and breaks the "consecutive" requirement
            return [null, $base + ['next_check_at' => $now + min(self::FAILED_RETRY_SEC, $intervalSec)]];
        }
        if ($known === '') {
            // baseline: remember the current address, announce nothing
            return [null, ['ip' => $observed] + $base + ['next_check_at' => $now + $intervalSec]];
        }
        if ($observed === $known) {
            return [null, $base + ['next_check_at' => $now + $intervalSec]];
        }
        if ($observed === $candidate && $candidateSince > 0) {
            return [
                self::buildEvent($known, $observed, $candidateSince),
                ['ip' => $observed] + $base + ['next_check_at' => $now + $intervalSec],
            ];
        }

        // first sighting of a new address: remember it and ask again soon
        return [null, $base + [
            'candidate' => $observed,
            'candidate_since' => $now,
            'next_check_at' => $now + min(self::RECHECK_RETRY_SEC, $intervalSec),
        ]];
    }

    private static function buildEvent(string $oldIp, string $newIp, int $since): HubEvent
    {
        return new HubEvent(
            sourceId: self::ID,
            eventType: self::EVENT_TYPE,
            severity: HubEvent::SEVERITY_WARNING,
            dedupeKey: 'extip:' . substr(sha1($newIp), 0, 12) . ':' . $since,
            occurredAt: max(1, $since),
            payload: [
                'subject' => [
                    'call' => null,
                    'client_number' => '',
                    'employees' => [],
                    'provider' => null,
                    'external_ip' => ['old' => $oldIp, 'new' => $newIp, 'since' => $since],
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => [],
            ],
        );
    }

    private function interval(): int
    {
        return $this->intervalMin === null ? 15 : (int)($this->intervalMin)();
    }
}
