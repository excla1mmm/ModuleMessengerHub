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
 * core.missed_call — push source over AMI "UserEvent: CdrConnector" (Plan/02-sources.md).
 *
 * Legs arrive per channel hangup (action = hangup_update_cdr, AgiData = base64/GZ JSON).
 * The source buffers legs per linkedid and decides after SILENCE_SEC of silence, mirroring
 * Core WorkerCdr::checkNoAnswerCall(): a linkedid where no leg was ANSWERED is missed.
 * Direction and client/employees are derived Core-free (see self::buildEvent docblock).
 */
final class MissedCallSource implements SourceInterface, AmiEventSource
{
    public const string ID = 'core.missed_call';
    public const string USER_EVENT = 'CdrConnector';
    public const string ACTION = 'hangup_update_cdr';
    public const string RESOLVED_TYPE = 'core.missed_call_resolved';

    /** The largest rule window (Plan/12): a callback older than this cannot resolve anything. */
    public const int RESOLVE_WINDOW_SEC = 7200;
    private const int RECENT_MISSED_CAP = 500;

    private const array LEG_FIELDS = [
        'linkedid', 'UNIQUEID', 'src_num', 'src_name', 'dst_num', 'dst_name', 'did',
        'disposition', 'GLOBAL_STATUS', 'start', 'endtime', 'duration', 'billsec', 'recordingfile',
    ];

    private const int MAX_DURATION_SEC = 6 * 3600;

    /** @var array<string, array{legs: list<array<string, string>>, answered: bool, last_seen: int}> */
    private array $buffer = [];

    /**
     * Recent missed calls by normalised client number (Plan/12 index). Filled from the journal at
     * worker start and extended by this process; bounded and pruned by the resolve window.
     *
     * @var list<array{linkedid: string, client_norm: string, occurred_at: int}>
     */
    private array $recentMissed = [];

    /**
     * @var array<string, array{user_id: ?int, name: string}>|null internal number => employee; null = not loaded yet.
     *     Loaded read-only from Core models by the AMI worker (Lib/Support/InternalNumbers), the class stays Core-free.
     */
    private ?array $internalMap;

    /** @param array<string, array{user_id: ?int, name: string}>|null $internalMap */
    public function __construct(
        private readonly int $silenceSec = 15,
        private readonly int $bufferCap = 200,
        ?array $internalMap = null,
    ) {
        $this->internalMap = $internalMap;
    }

    /** @param array<string, array{user_id: ?int, name: string}> $internalMap */
    public function setInternalMap(array $internalMap): void
    {
        $this->internalMap = $internalMap;
    }

    public function hasInternalMap(): bool
    {
        return $this->internalMap !== null;
    }

    /**
     * Restores the "client number → missed calls" index from the event journal (AMI worker start).
     *
     * @param list<array{linkedid: string, client_norm: string, occurred_at: int}> $items
     */
    public function seedRecentMissed(array $items): void
    {
        foreach ($items as $item) {
            $linkedid = (string)($item['linkedid'] ?? '');
            $norm = (string)($item['client_norm'] ?? '');
            $at = (int)($item['occurred_at'] ?? 0);
            if ($linkedid === '' || $norm === '' || $at <= 0) {
                continue;
            }
            $this->recentMissed[] = ['linkedid' => $linkedid, 'client_norm' => $norm, 'occurred_at' => $at];
        }
        $this->capRecentMissed();
    }

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
        $linkedid = trim((string)($data['linkedid'] ?? ''));
        if ($linkedid === '') {
            return;
        }
        unset($data['action']);
        $leg = [];
        foreach (self::LEG_FIELDS as $field) {
            $leg[$field] = (string)($data[$field] ?? '');
        }

        $entry = $this->buffer[$linkedid] ?? ['legs' => [], 'answered' => false, 'last_seen' => $now];
        $entry['legs'][] = $leg;
        $entry['answered'] = $entry['answered'] || self::legAnswered($leg);
        $entry['last_seen'] = $now;
        unset($this->buffer[$linkedid]);
        $this->buffer[$linkedid] = $entry;

        while (count($this->buffer) > $this->bufferCap) {
            array_shift($this->buffer); // drop the oldest buffered call
        }
    }

    public function tick(SourceRecorder $recorder, int $now): void
    {
        if ($this->internalMap === null) {
            return; // cannot classify the call without the extensions map; the buffer is bounded
        }
        foreach ($this->buffer as $linkedid => $entry) {
            if ($now - $entry['last_seen'] < $this->silenceSec) {
                continue;
            }
            unset($this->buffer[$linkedid]);
            if ($entry['answered']) {
                $this->emitResolved($entry['legs'], $recorder, $now);

                continue; // an answered call is not missed, but it may be the callback
            }
            $event = self::buildEvent($entry['legs'], $now, $this->internalMap);
            if ($event !== null) {
                $recorder->record($event, $now);
                $this->rememberMissed($event);
            }
        }
        $this->pruneRecentMissed($now);
    }

    /**
     * An answered call can be the callback for recent missed calls of the same client (Plan/12).
     * The rule window and the incoming/outgoing switch are applied later by the router.
     *
     * @param list<array<string, string>> $legs
     */
    private function emitResolved(array $legs, SourceRecorder $recorder, int $now): void
    {
        if ($this->internalMap === null) {
            return;
        }
        $info = self::callbackInfo($legs, $this->internalMap);
        if ($info === null) {
            return;
        }
        $norm = self::normalizeNumber((string)$info['client_number']);
        if ($norm === '') {
            return;
        }
        $callbackAt = (int)$info['started_at'] > 0 ? (int)$info['started_at'] : $now;
        $this->pruneRecentMissed($now);
        foreach ($this->recentMissed as $missed) {
            if ($missed['client_norm'] !== $norm) {
                continue;
            }
            $delta = $callbackAt - $missed['occurred_at'];
            if ($delta < 0 || $delta > self::RESOLVE_WINDOW_SEC) {
                continue;
            }
            $resolved = self::buildResolvedEvent($info, $missed['linkedid'], $now);
            if ($resolved !== null) {
                $recorder->record($resolved, $now);
            }
        }
    }

    private function rememberMissed(HubEvent $event): void
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $call = is_array($subject['call'] ?? null) ? $subject['call'] : [];
        $linkedid = (string)($call['linkedid'] ?? '');
        $norm = self::normalizeNumber((string)($subject['client_number'] ?? ''));
        if ($linkedid === '' || $norm === '') {
            return;
        }
        foreach ($this->recentMissed as $item) {
            if ($item['linkedid'] === $linkedid) {
                return;
            }
        }
        $this->recentMissed[] = [
            'linkedid' => $linkedid,
            'client_norm' => $norm,
            'occurred_at' => $event->occurredAt,
        ];
        $this->capRecentMissed();
    }

    private function pruneRecentMissed(int $now): void
    {
        $threshold = $now - self::RESOLVE_WINDOW_SEC;
        $this->recentMissed = array_values(array_filter(
            $this->recentMissed,
            static fn (array $item): bool => $item['occurred_at'] >= $threshold
        ));
    }

    private function capRecentMissed(): void
    {
        if (count($this->recentMissed) > self::RECENT_MISSED_CAP) {
            $this->recentMissed = array_slice($this->recentMissed, -self::RECENT_MISSED_CAP);
        }
    }

    /** Last 10 digits (Plan/12): +7 968 968-94-44 and 8 968 968-94-44 compare equal. */
    public static function normalizeNumber(string $number): string
    {
        $digits = (string)preg_replace('/\D+/', '', $number);
        if ($digits === '') {
            return '';
        }

        return strlen($digits) > 10 ? substr($digits, -10) : $digits;
    }

    /**
     * The client side of an answered call (an answered leg is required).
     *
     * @param list<array<string, string>> $legs
     * @param array<string, array{user_id: ?int, name: string}> $internalMap
     * @return array{client_number: string, direction: string, employee: ?array{user_id: ?int, number: string, name: string}, linkedid: string, started_at: int, duration_sec: int}|null
     */
    public static function callbackInfo(array $legs, array $internalMap): ?array
    {
        foreach ($legs as $leg) {
            if (!self::legAnswered($leg)) {
                continue;
            }
            $src = trim((string)($leg['src_num'] ?? ''));
            $dst = trim((string)($leg['dst_num'] ?? ''));
            $srcEmployee = $internalMap[$src] ?? null;
            $dstEmployee = $internalMap[$dst] ?? null;
            $hasDid = (string)($leg['did'] ?? '') !== '';

            if ($srcEmployee !== null && $dstEmployee !== null) {
                return null; // internal call, not a client callback
            }
            if ($dstEmployee !== null) {
                $direction = 'incoming';
                $client = $src;
                $employee = $dstEmployee;
                $employeeNumber = $dst;
                $fallbackName = (string)($leg['dst_name'] ?? '');
            } elseif ($srcEmployee !== null) {
                $direction = 'outgoing';
                $client = $dst;
                $employee = $srcEmployee;
                $employeeNumber = $src;
                $fallbackName = (string)($leg['src_name'] ?? '');
            } elseif ($hasDid) {
                $direction = 'incoming';
                $client = $src;
                $employee = null;
                $employeeNumber = $dst;
                $fallbackName = '';
            } else {
                $direction = 'outgoing';
                $client = $dst;
                $employee = null;
                $employeeNumber = '';
                $fallbackName = '';
            }
            $client = trim($client);
            if ($client === '') {
                continue;
            }
            $startedAt = self::strToTs((string)($leg['start'] ?? ''));
            $endedAt = self::strToTs((string)($leg['endtime'] ?? ''));
            $duration = (int)($leg['duration'] ?? 0);
            if ($duration <= 0 && $startedAt > 0 && $endedAt > $startedAt) {
                $duration = $endedAt - $startedAt;
            }
            $employeePayload = null;
            if ($employee !== null || $employeeNumber !== '') {
                $employeePayload = [
                    'user_id' => $employee['user_id'] ?? null,
                    'number' => $employeeNumber,
                    'name' => ($employee['name'] ?? '') !== '' ? $employee['name'] : $fallbackName,
                ];
            }

            return [
                'client_number' => $client,
                'direction' => $direction,
                'employee' => $employeePayload,
                'linkedid' => (string)($leg['linkedid'] ?? ''),
                'started_at' => $startedAt,
                'duration_sec' => max(0, $duration),
            ];
        }

        return null;
    }

    /**
     * @param array{client_number: string, direction: string, employee: ?array<string, mixed>, linkedid: string, started_at: int, duration_sec: int} $info
     */
    public static function buildResolvedEvent(array $info, string $missedLinkedid, int $now): ?HubEvent
    {
        if ($missedLinkedid === '' || (string)$info['client_number'] === '') {
            return null;
        }
        $linkedid = (string)$info['linkedid'];
        $employees = $info['employee'] !== null ? [$info['employee']] : [];

        return new HubEvent(
            sourceId: self::ID,
            eventType: self::RESOLVED_TYPE,
            severity: HubEvent::SEVERITY_INFO,
            dedupeKey: 'resolved:' . $missedLinkedid,
            occurredAt: (int)$info['started_at'] > 0 ? (int)$info['started_at'] : $now,
            payload: [
                'subject' => [
                    'call' => [
                        'linkedid' => $linkedid,
                        'missed_linkedid' => $missedLinkedid,
                        'direction' => (string)$info['direction'],
                        'started_at' => (int)$info['started_at'],
                        'duration_sec' => (int)$info['duration_sec'],
                    ],
                    'client_number' => (string)$info['client_number'],
                    'employees' => $employees,
                    'provider' => null,
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => [],
            ],
        );
    }

    /** @param array<string, string> $leg */
    public static function legAnswered(array $leg): bool
    {
        return $leg['GLOBAL_STATUS'] === 'ANSWERED' || $leg['disposition'] === 'ANSWERED';
    }

    /**
     * Builds the normalised missed-call event (Plan/05-events-rules-templates.md).
     *
     * Classification uses the internal-number map (Core Extensions/Users, read-only, see Plan/11 Q12):
     *  - incoming: any leg carries a DID, or src is not internal and a dst is internal;
     *  - internal: src and a dst are both internal;
     *  - outgoing: src is internal and no dst is internal; anything else without DID is treated as outgoing.
     * employees[] lists the called internal numbers that belong to a user (no duplicates), with user_id and
     * name from the map (leg dst_name as a fallback for the name).
     *
     * @param list<array<string, string>> $legs
     * @param array<string, array{user_id: ?int, name: string}> $internalMap
     */
    public static function buildEvent(array $legs, int $now, array $internalMap): ?HubEvent
    {
        $legs = array_values(array_filter($legs, static fn (array $leg): bool => ($leg['linkedid'] ?? '') !== ''));
        if ($legs === []) {
            return null;
        }
        $linkedid = $legs[0]['linkedid'];
        $direction = self::direction($legs, $internalMap);
        $occurredAt = self::strToTs((string)(end($legs)['endtime'] ?? '')) ?: $now;
        $startedAt = self::strToTs((string)($legs[0]['start'] ?? '')) ?: $occurredAt;
        $duration = 0;
        $employees = [];
        $recording = '';
        foreach ($legs as $leg) {
            $duration = max($duration, min(self::MAX_DURATION_SEC, (int)($leg['duration'] ?? 0)));
            if ($recording === '' && ($leg['recordingfile'] ?? '') !== '') {
                $recording = (string)$leg['recordingfile'];
            }
            $dstNum = (string)($leg['dst_num'] ?? '');
            $employee = $internalMap[$dstNum] ?? null;
            if ($direction !== 'outgoing' && $employee !== null && $employee['user_id'] !== null) {
                $employees[$dstNum] ??= [
                    'user_id' => $employee['user_id'],
                    'number' => $dstNum,
                    'name' => $employee['name'] !== '' ? $employee['name'] : (string)($leg['dst_name'] ?? ''),
                ];
            }
        }

        $clientNumber = match ($direction) {
            'outgoing' => (string)($legs[0]['dst_num'] ?? ''),
            default => (string)($legs[0]['src_num'] ?? ''),
        };

        return new HubEvent(
            sourceId: self::ID,
            eventType: self::ID,
            severity: $direction === 'incoming' ? HubEvent::SEVERITY_WARNING : HubEvent::SEVERITY_INFO,
            dedupeKey: 'missed:' . $linkedid,
            occurredAt: $occurredAt,
            payload: [
                'subject' => [
                    'call' => [
                        'linkedid' => $linkedid,
                        'direction' => $direction,
                        'started_at' => $startedAt,
                        'duration_sec' => $duration,
                    ],
                    'client_number' => $clientNumber,
                    'employees' => array_values($employees),
                    'provider' => null,
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => $recording === '' ? [] : [['kind' => 'recording', 'path' => $recording]],
            ],
        );
    }

    /**
     * @param list<array<string, string>> $legs
     * @param array<string, array{user_id: ?int, name: string}> $internalMap
     * @return string incoming|outgoing|internal
     */
    public static function direction(array $legs, array $internalMap): string
    {
        foreach ($legs as $leg) {
            if (($leg['did'] ?? '') !== '') {
                return 'incoming';
            }
        }
        $srcInternal = isset($internalMap[(string)($legs[0]['src_num'] ?? '')]);
        $dstInternal = false;
        foreach ($legs as $leg) {
            if (isset($internalMap[(string)($leg['dst_num'] ?? '')])) {
                $dstInternal = true;
                break;
            }
        }

        return match (true) {
            $srcInternal && $dstInternal => 'internal',
            $dstInternal => 'incoming',
            default => 'outgoing',
        };
    }

    /** CDR timestamps are "Y-m-d H:i:s" in the PBX local timezone. */
    public static function strToTs(string $value): int
    {
        if ($value === '') {
            return 0;
        }
        $ts = strtotime($value);

        return $ts === false ? 0 : $ts;
    }
}
