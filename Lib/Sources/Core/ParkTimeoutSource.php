<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\AmiEventSource;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRecorder;

/**
 * core.park_timeout — push source over AMI "UserEvent: CdrConnector" (Plan/02-sources.md, 4s-B).
 *
 * A parked call that nobody picks up returns: the parking timeout context runs
 * `Gosub(unpark_call_timeout,...)` (src/Core/Asterisk/Configs/ResParkingConf.php:188-194) and the Lua
 * handler publishes action "unpark_call_timeout" with src_num (the caller), dst_num (the parking space),
 * start/endtime (start = now - the configured parking duration) and PARKER (the parker's channel)
 * — src/Core/Asterisk/Configs/lua/extensions.lua:1954-1994.
 *
 * PARKER is a channel name, not a number: the parked-by extension is extracted with the same rule Core
 * uses for `Goto(internal,${CUT(PARKER,/,2)},1)` (ResParkingConf.php:193) plus the channel-suffix
 * trimming of getAccountName() (extensions.lua:233-257).
 */
final class ParkTimeoutSource implements SourceInterface, AmiEventSource
{
    public const string ID = 'core.park_timeout';
    public const string USER_EVENT = 'CdrConnector';
    public const string ACTION = 'unpark_call_timeout';

    private const int MAX_PARKED_SEC = 24 * 3600;

    public function id(): string
    {
        return self::ID;
    }

    public function eventTypes(): array
    {
        return [self::ID];
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

    public function amiUserEvents(): array
    {
        return [self::USER_EVENT];
    }

    public function onAmiEvent(array $parameters, SourceRecorder $recorder, int $now): void
    {
        if (($parameters['UserEvent'] ?? '') !== self::USER_EVENT) {
            return;
        }
        $data = AgiDataDecoder::decode((string)($parameters['AgiData'] ?? ''));
        if ($data === null || ($data['action'] ?? '') !== self::ACTION) {
            return;
        }
        $event = self::buildEvent($data, $now);
        if ($event !== null) {
            $recorder->record($event, $now);
        }
    }

    public function tick(SourceRecorder $recorder, int $now): void
    {
    }

    /**
     * @param array<string, mixed> $fields decoded CdrConnector payload
     */
    public static function buildEvent(array $fields, int $now): ?HubEvent
    {
        $linkedid = trim((string)($fields['linkedid'] ?? ''));
        if ($linkedid === '') {
            return null;
        }
        $slot = trim((string)($fields['dst_num'] ?? ''));
        $caller = trim((string)($fields['src_num'] ?? ''));
        $parker = self::peerFromChannel((string)($fields['PARKER'] ?? ''));
        $did = trim((string)($fields['did'] ?? ''));
        $startedAt = MissedCallSource::strToTs((string)($fields['start'] ?? ''));
        $endedAt = MissedCallSource::strToTs((string)($fields['endtime'] ?? ''));

        return new HubEvent(
            sourceId: self::ID,
            eventType: self::ID,
            severity: HubEvent::SEVERITY_WARNING,
            dedupeKey: 'park_timeout:' . $linkedid,
            occurredAt: $endedAt > 0 ? $endedAt : $now,
            payload: [
                'subject' => [
                    'call' => [
                        'linkedid' => $linkedid,
                        // a parked call can be inbound, outbound or internal: only a DID proves "incoming"
                        'direction' => $did !== '' ? 'incoming' : 'unknown',
                        'started_at' => $startedAt > 0 ? $startedAt : ($endedAt > 0 ? $endedAt : $now),
                        'park_slot' => $slot,
                        'parked_by' => $parker,
                        'parked_sec' => self::parkedSec($startedAt, $endedAt),
                        'did' => $did,
                    ],
                    'client_number' => $caller,
                    'employees' => [],
                    'provider' => null,
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => [],
            ],
        );
    }

    public static function parkedSec(int $startedAt, int $endedAt): int
    {
        if ($startedAt <= 0 || $endedAt < $startedAt) {
            return 0;
        }

        return min(self::MAX_PARKED_SEC, $endedAt - $startedAt);
    }

    /**
     * "SIP/204-0000000a" -> "204", "Local/204@internal-0001" -> "204", "204" -> "204".
     * Mirrors Core's CUT(PARKER,/,2) plus getAccountName()'s "@" and channel-suffix trimming.
     */
    public static function peerFromChannel(string $channel): string
    {
        $channel = trim($channel);
        if ($channel === '') {
            return '';
        }
        $slash = strpos($channel, '/');
        $peer = $slash === false ? $channel : substr($channel, $slash + 1);
        $at = strpos($peer, '@');
        if ($at !== false) {
            $peer = substr($peer, 0, $at);
        }
        $dash = strrpos($peer, '-');
        if ($dash !== false && $dash > 0) {
            $peer = substr($peer, 0, $dash);
        }

        return trim($peer);
    }
}
