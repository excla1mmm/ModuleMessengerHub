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
 * core.queue_abandoned — push source over AMI "UserEvent: CdrConnector" (Plan/02-sources.md, 4s-B).
 *
 * Core's Lua dialplan publishes the three facts of a queue leg on the same CdrConnector stream
 * (src/Core/Asterisk/Configs/lua/extensions.lua:1582-1723):
 *  - "queue_start":  dst_num = queue extension, src_num = caller, did, UNIQUEID = queue leg id, start;
 *  - "queue_answer": id = queue leg id, answer — the agent picked the call up;
 *  - "queue_end":    id = queue leg id, end, dialstatus = QUEUESTATUS (the dialplan runs
 *                    `Gosub(queue_end,...)` right after `Queue()`, src/Core/Asterisk/Configs/QueueConf.php:232).
 *
 * The source correlates the three by (linkedid, queue leg id) with a linkedid fallback for facts that
 * carry no id, waits SETTLE_SEC of silence after queue_end (a late queue_answer must be able to clear
 * an abandonment), and then records one event per (linkedid, queue).
 *
 * No event when the start was missed (worker restart, source enabled mid-call): half a call is not a
 * fact, and history is never broadcast.
 */
final class QueueAbandonSource implements SourceInterface, AmiEventSource
{
    public const string ID = 'core.queue_abandoned';
    public const string USER_EVENT = 'CdrConnector';

    public const string ACTION_START = 'queue_start';
    public const string ACTION_ANSWER = 'queue_answer';
    public const string ACTION_END = 'queue_end';
    /**
     * End-of-wait signals when the caller hangs up while waiting. Core's queue dialplan calls
     * Gosub(queue_end) only AFTER Queue() returns (QueueConf.php:169-232: start, Queue(), end), so a caller who
     * gives up never produces queue_end — station check 24.11.2026. The hangup handler set before Queue()
     * publishes hangup_chan with agi_channel = the hung-up channel (lua/extensions.lua:1509-1545); it is
     * matched against the caller channel queue_start carries (src_chan = QUEUE_SRC_CHAN), so ring-cycle
     * hangups of member channels do not close the wait. hangup_update_cdr is sent per row once the whole
     * call is finished (Workers/Libs/WorkerCallEvents/UpdateDataInDB.php:105-124): it closes whatever is
     * still open for that linkedid (a transfer start carries no src_chan).
     */
    public const string ACTION_HANGUP_CHAN = 'hangup_chan';
    public const string ACTION_HANGUP_UPDATE_CDR = 'hangup_update_cdr';

    /** "The caller left without an answer" — the primary trigger (wait >= the configured minimum). */
    public const string REASON_ABANDONED = 'abandoned';
    /** "The caller waited longer than the long-wait threshold" — the optional second trigger. */
    public const string REASON_LONG_WAIT = 'long_wait';

    /** Silence after queue_end before the verdict: an out-of-order queue_answer must still count. */
    public const int SETTLE_SEC = 3;
    /** A queue episode longer than this cannot be real; the buffer entry is dropped (bounded memory). */
    public const int MAX_EPISODE_SEC = 6 * 3600;
    /** How many unfinished queue legs are buffered at most; the oldest are dropped first. */
    public const int BUFFER_CAP = 200;
    public const int MAX_WAIT_SEC = 3600;

    /**
     * @var array<string, array{linkedid: string, id: string, queue: string, caller: string, did: string,
     *     started_at: int, first_seen: int, answered_at: int, ended_at: int, ended: bool, seen_start: bool,
     *     last_seen: int}>
     */
    private array $buffer = [];

    /** @var array<string, array{user_id: ?int, name: string}>|null internal number => employee (CORP map) */
    private ?array $internalMap;

    /** @var array<string, string> queue extension => queue name (Core CallQueues, read-only) */
    private array $queueNames = [];

    /**
     * @param array<string, array{user_id: ?int, name: string}>|null $internalMap
     * @param array<string, string> $queueNames
     */
    public function __construct(
        private readonly int $settleSec = self::SETTLE_SEC,
        private readonly int $bufferCap = self::BUFFER_CAP,
        private int $minWaitSec = 0,
        private int $longWaitSec = 0,
        ?array $internalMap = null,
        array $queueNames = [],
    ) {
        $this->internalMap = $internalMap;
        $this->queueNames = $queueNames;
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

    /** @param array<string, array{user_id: ?int, name: string}> $internalMap */
    public function setInternalMap(array $internalMap): void
    {
        $this->internalMap = $internalMap;
    }

    /** @param array<string, string> $queueNames */
    public function setQueueNames(array $queueNames): void
    {
        $this->queueNames = $queueNames;
    }

    /** Thresholds come from the hub settings, refreshed by the AMI worker. Values are clamped, never trusted. */
    public function setThresholds(int $minWaitSec, int $longWaitSec): void
    {
        $this->minWaitSec = max(0, min(self::MAX_WAIT_SEC, $minWaitSec));
        $this->longWaitSec = max(0, min(self::MAX_WAIT_SEC, $longWaitSec));
    }

    public function onAmiEvent(array $parameters, SourceRecorder $recorder, int $now): void
    {
        if (($parameters['UserEvent'] ?? '') !== self::USER_EVENT) {
            return;
        }
        $data = AgiDataDecoder::decode((string)($parameters['AgiData'] ?? ''));
        if ($data === null) {
            return;
        }
        $linkedid = trim((string)($data['linkedid'] ?? ''));
        if ($linkedid === '') {
            return;
        }
        $action = (string)($data['action'] ?? '');
        $legId = trim((string)($data['id'] ?? $data['UNIQUEID'] ?? ''));

        if ($action === self::ACTION_START) {
            $this->onStart($linkedid, $legId, $data, $now);

            return;
        }
        if ($action === self::ACTION_HANGUP_CHAN || $action === self::ACTION_HANGUP_UPDATE_CDR) {
            $this->onCallerGone($action, $linkedid, $data, $now);

            return;
        }
        if ($action !== self::ACTION_ANSWER && $action !== self::ACTION_END) {
            return;
        }
        $key = $this->keyFor($linkedid, $legId);
        if ($key === null) {
            if ($this->legsOf($linkedid) > 0) {
                return; // ambiguous: several queue legs of the same call and the fact carries no usable id
            }
            // The start has not arrived yet (AMI/worker restart): buffer the fact anyway, a late queue_start
            // fills the queue and the caller in. A fact that never gets its start is dropped at settle time.
            $key = $linkedid . '|' . $legId;
            $this->buffer[$key] = self::emptyEntry($linkedid, $legId, $now);
        }
        if ($action === self::ACTION_ANSWER) {
            if ($this->buffer[$key]['answered_at'] === 0) {
                $this->buffer[$key]['answered_at'] = MissedCallSource::strToTs((string)($data['answer'] ?? '')) ?: $now;
            }
        } else {
            $this->buffer[$key]['ended'] = true;
            $this->buffer[$key]['ended_at'] = MissedCallSource::strToTs((string)($data['end'] ?? '')) ?: $now;
        }
        $this->touch($key, $now);
    }

    public function tick(SourceRecorder $recorder, int $now): void
    {
        foreach ($this->buffer as $key => $entry) {
            if ($entry['ended']) {
                if ($now - $entry['last_seen'] >= $this->settleSec) {
                    unset($this->buffer[$key]);
                    $event = self::buildEvent($entry, $this->reasonFor($entry), $this->internalMap, $this->queueNames, $now);
                    if ($event !== null) {
                        $recorder->record($event, $now);
                    }
                }

                continue;
            }
            if ($now - $entry['first_seen'] > self::MAX_EPISODE_SEC) {
                unset($this->buffer[$key]); // an end event that never arrives must not leak memory
            }
        }
    }

    /**
     * The caller left (hangup_chan of the caller channel) or the call is finished (hangup_update_cdr):
     * close the open waits of that call. A leg that is already answered or ended is left as it is.
     *
     * @param array<string, mixed> $data
     */
    private function onCallerGone(string $action, string $linkedid, array $data, int $now): void
    {
        $channel = trim((string)($data['agi_channel'] ?? ''));
        $endField = $action === self::ACTION_HANGUP_CHAN ? 'end' : 'endtime';
        $endedAt = MissedCallSource::strToTs((string)($data[$endField] ?? '')) ?: $now;
        foreach (array_keys($this->buffer) as $key) {
            $entry = $this->buffer[$key];
            if ($entry['linkedid'] !== $linkedid || $entry['ended'] || !$entry['seen_start']) {
                continue;
            }
            if ($action === self::ACTION_HANGUP_CHAN && ($channel === '' || $entry['src_chan'] !== $channel)) {
                continue; // a member channel or another leg of the call: the caller is still waiting
            }
            $this->buffer[$key]['ended'] = true;
            $this->buffer[$key]['ended_at'] = $endedAt;
            $this->touch($key, $now);
        }
    }

    /** @param array<string, mixed> $data */
    private function onStart(string $linkedid, string $legId, array $data, int $now): void
    {
        $key = $linkedid . '|' . $legId;
        $idless = $linkedid . '|';
        if ($legId !== '' && isset($this->buffer[$idless])) {
            // a fact of this call arrived before the start and had no leg id: adopt it
            $this->buffer[$key] = $this->buffer[$idless];
            unset($this->buffer[$idless]);
        } elseif ($legId === '') {
            $found = $this->keyFor($linkedid, '');
            if ($found !== null) {
                $key = $found;
            }
        }
        $existing = $this->buffer[$key] ?? null;
        $startedAt = MissedCallSource::strToTs((string)($data['start'] ?? ''));
        $this->buffer[$key] = [
            'linkedid' => $linkedid,
            'id' => $legId !== '' ? $legId : (string)($existing['id'] ?? ''),
            'queue' => trim((string)($data['dst_num'] ?? '')) !== ''
                ? trim((string)$data['dst_num'])
                : (string)($existing['queue'] ?? ''),
            'caller' => trim((string)($data['src_num'] ?? '')) !== ''
                ? trim((string)$data['src_num'])
                : (string)($existing['caller'] ?? ''),
            'did' => trim((string)($data['did'] ?? '')) !== ''
                ? trim((string)$data['did'])
                : (string)($existing['did'] ?? ''),
            'src_chan' => trim((string)($data['src_chan'] ?? '')) !== ''
                ? trim((string)$data['src_chan'])
                : (string)($existing['src_chan'] ?? ''),
            'started_at' => $startedAt > 0 ? $startedAt : (int)($existing['started_at'] ?? 0),
            'first_seen' => (int)($existing['first_seen'] ?? $now),
            'answered_at' => (int)($existing['answered_at'] ?? 0),
            'ended_at' => (int)($existing['ended_at'] ?? 0),
            'ended' => (bool)($existing['ended'] ?? false),
            'seen_start' => true,
            'last_seen' => $now,
        ];
        $this->touch($key, $now);
    }

    /**
     * @return array{linkedid: string, id: string, queue: string, caller: string, did: string, src_chan: string, started_at: int,
     *     first_seen: int, answered_at: int, ended_at: int, ended: bool, seen_start: bool, last_seen: int}
     */
    private static function emptyEntry(string $linkedid, string $legId, int $now): array
    {
        return [
            'linkedid' => $linkedid,
            'id' => $legId,
            'queue' => '',
            'caller' => '',
            'did' => '',
            'src_chan' => '',
            'started_at' => 0,
            'first_seen' => $now,
            'answered_at' => 0,
            'ended_at' => 0,
            'ended' => false,
            'seen_start' => false,
            'last_seen' => $now,
        ];
    }

    /** How many buffered queue legs belong to a call. */
    private function legsOf(string $linkedid): int
    {
        $count = 0;
        foreach ($this->buffer as $entry) {
            if ($entry['linkedid'] === $linkedid) {
                $count++;
            }
        }

        return $count;
    }

    /**
     * Buffer key of an answer/end fact: the exact (linkedid, leg id) when both are known, otherwise the
     * single open episode of that linkedid. An update-only queue_start may leave the leg id empty.
     */
    private function keyFor(string $linkedid, string $legId): ?string
    {
        $exact = $linkedid . '|' . $legId;
        if (isset($this->buffer[$exact])) {
            return $exact;
        }
        $found = null;
        foreach (array_keys($this->buffer) as $key) {
            if ($this->buffer[$key]['linkedid'] !== $linkedid) {
                continue;
            }
            if ($found !== null) {
                return null; // ambiguous: several queue legs of the same call
            }
            $found = $key;
        }

        return $found;
    }

    private function touch(string $key, int $now): void
    {
        if (!isset($this->buffer[$key])) {
            return;
        }
        $entry = $this->buffer[$key];
        $entry['last_seen'] = $now;
        unset($this->buffer[$key]);
        $this->buffer[$key] = $entry;
        while (count($this->buffer) > $this->bufferCap) {
            array_shift($this->buffer);
        }
    }

    /**
     * @param array{linkedid: string, id: string, queue: string, caller: string, did: string, src_chan: string, started_at: int,
     *     first_seen: int, answered_at: int, ended_at: int, ended: bool, seen_start: bool, last_seen: int} $entry
     */
    private function reasonFor(array $entry): ?string
    {
        $waited = self::waitedSec($entry);
        $answered = $entry['answered_at'] > 0;
        if (!$answered && $waited >= $this->minWaitSec) {
            return self::REASON_ABANDONED;
        }
        if ($this->longWaitSec > 0 && $waited >= $this->longWaitSec) {
            return self::REASON_LONG_WAIT;
        }

        return null;
    }

    /**
     * @param array{started_at: int, ended_at: int, first_seen: int, last_seen: int} $entry
     */
    public static function waitedSec(array $entry): int
    {
        $startedAt = (int)($entry['started_at'] ?? 0);
        $endedAt = (int)($entry['ended_at'] ?? 0);
        $waited = $startedAt > 0 && $endedAt >= $startedAt
            ? $endedAt - $startedAt
            : (int)($entry['last_seen'] ?? 0) - (int)($entry['first_seen'] ?? 0);

        return max(0, min(self::MAX_WAIT_SEC, $waited));
    }

    /**
     * Builds the normalised event. A queue call is inbound unless the caller is an internal number
     * (the map is the Core Extensions/Users map, Plan/11 Q12); without the map the caller counts as external.
     *
     * @param array{linkedid: string, id: string, queue: string, caller: string, did: string, src_chan: string, started_at: int,
     *     first_seen: int, answered_at: int, ended_at: int, ended: bool, seen_start: bool, last_seen: int} $entry
     * @param array<string, array{user_id: ?int, name: string}>|null $internalMap
     * @param array<string, string> $queueNames
     */
    public static function buildEvent(array $entry, ?string $reason, ?array $internalMap, array $queueNames, int $now): ?HubEvent
    {
        if ($reason === null || !($entry['seen_start'] ?? false)) {
            return null; // half a call is not a fact: no queue_start has been seen
        }
        $linkedid = (string)($entry['linkedid'] ?? '');
        if ($linkedid === '') {
            return null;
        }
        $queue = (string)($entry['queue'] ?? '');
        $caller = (string)($entry['caller'] ?? '');
        $direction = $internalMap !== null && $caller !== '' && isset($internalMap[$caller]) ? 'internal' : 'incoming';
        $startedAt = (int)($entry['started_at'] ?? 0);
        $occurredAt = (int)($entry['ended_at'] ?? 0) > 0 ? (int)$entry['ended_at'] : $now;

        return new HubEvent(
            sourceId: self::ID,
            eventType: self::ID,
            severity: $reason === self::REASON_ABANDONED ? HubEvent::SEVERITY_WARNING : HubEvent::SEVERITY_INFO,
            dedupeKey: 'queue_abandon:' . $linkedid . ':' . ($queue !== '' ? $queue : 'unknown'),
            occurredAt: $occurredAt,
            payload: [
                'subject' => [
                    'call' => [
                        'linkedid' => $linkedid,
                        'direction' => $direction,
                        'started_at' => $startedAt > 0 ? $startedAt : $occurredAt,
                        'waited_sec' => self::waitedSec($entry),
                        'queue_number' => $queue,
                        'queue_name' => (string)($queueNames[$queue] ?? ''),
                        'reason' => $reason,
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
}
