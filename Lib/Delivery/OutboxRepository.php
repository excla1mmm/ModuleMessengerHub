<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Delivery;

use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

/**
 * SQL access to the outbox and its recipients (Plan/04-data-model.md).
 *
 * Every state change is guarded by the status it expects, so a restarted worker or a double tick
 * cannot send the same row twice: claim() only takes rows that are still `pending`.
 */
final class OutboxRepository
{
    public const string TABLE = 'm_MessengerHubOutbox';
    public const string EVENTS_TABLE = 'm_MessengerHubEvents';
    public const string CHATS_TABLE = 'm_MessengerHubBotChats';
    public const string BOTS_TABLE = 'm_MessengerHubBots';

    public function __construct(private readonly HubDatabase $db)
    {
    }

    /** Expired leases (`sending` with lease_until in the past) return to pending for another worker. */
    public function reclaimExpiredLeases(int $now): int
    {
        return $this->db->execute(
            'UPDATE ' . self::TABLE . " SET status = 'pending', lease_owner = '', lease_until = NULL,"
            . ' updated_at = :now WHERE status = :sending AND lease_until IS NOT NULL AND lease_until < :now',
            ['now' => $now, 'sending' => 'sending']
        );
    }

    /**
     * `info` rows older than 24 hours are pointless (Plan/08): a week-old missed call is not news.
     * warning/critical rows keep waiting for the messenger to recover.
     */
    public function dropStaleInfo(int $now, int $maxAgeSec = 86400): int
    {
        return $this->db->execute(
            'UPDATE ' . self::TABLE . " SET status = 'dropped', last_error_code = 'stale', last_error_at = :now,"
            . ' updated_at = :now'
            . " WHERE status = 'pending' AND created_at < :before AND event_id IN"
            . ' (SELECT id FROM ' . self::EVENTS_TABLE . " WHERE severity = 'info')",
            ['now' => $now, 'before' => $now - $maxAgeSec]
        );
    }

    /**
     * Atomically takes up to $limit pending rows that are due.
     *
     * @return list<int> claimed row ids
     */
    public function claim(int $limit, int $now, string $owner, int $leaseSec): array
    {
        $rows = $this->db->fetchAll(
            'SELECT id FROM ' . self::TABLE
            . " WHERE status = 'pending' AND next_attempt_at <= :now ORDER BY next_attempt_at ASC, id ASC LIMIT "
            . max(1, $limit),
            ['now' => $now]
        );
        $leaseFrom = max($now, time());
        $claimed = [];
        foreach ($rows as $row) {
            $id = (int)$row['id'];
            $taken = $this->db->execute(
                'UPDATE ' . self::TABLE . " SET status = 'sending', lease_owner = :owner, lease_until = :until,"
                . " updated_at = :now WHERE id = :id AND status = 'pending'",
                ['owner' => $owner, 'until' => $leaseFrom + max(30, $leaseSec), 'now' => $now, 'id' => $id]
            );
            if ($taken === 1) {
                $claimed[] = $id;
            }
        }

        return $claimed;
    }

    /**
     * One claimed row with everything a send needs. The bot token is read here and must never be
     * logged or returned by REST.
     *
     * @return array<string, mixed>|null
     */
    public function load(int $id): ?array
    {
        return $this->db->fetchOne(
            'SELECT o.id, o.event_id, o.chat_id, o.bot_id, o.rule_id, o.status, o.attempts, o.uncertain_attempts,'
            . ' o.rendered_json, o.external_message_ids, o.last_error_code,'
            . ' o.attachment_json, o.delivery_parts_json,'
            . ' e.event_type, e.severity, e.occurred_at,'
            . ' c.chat_id AS external_chat_id, c.chat_kind, c.enabled AS chat_enabled, c.state AS chat_state,'
            . ' c.title AS chat_title,'
            . ' b.channel, b.token, b.enabled AS bot_enabled'
            . ' FROM ' . self::TABLE . ' o'
            . ' JOIN ' . self::EVENTS_TABLE . ' e ON e.id = o.event_id'
            . ' JOIN ' . self::CHATS_TABLE . ' c ON c.id = o.chat_id'
            . ' JOIN ' . self::BOTS_TABLE . ' b ON b.id = o.bot_id'
            . ' WHERE o.id = :id',
            ['id' => $id]
        );
    }

    /** @param list<string> $ids */
    public function markSent(int $id, array $ids, int $now): void
    {
        $this->db->execute(
            'UPDATE ' . self::TABLE . " SET status = 'sent', external_message_ids = :ids, sent_at = :now,"
            . " last_error_code = '', lease_owner = '', lease_until = NULL, updated_at = :now WHERE id = :id",
            ['ids' => json_encode(array_values($ids), JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), 'now' => $now, 'id' => $id]
        );
    }

    /**
     * Persists per-part progress only while this worker still owns the row. A lost lease means another
     * worker is (or will be) responsible, so the caller must stop instead of sending the same part twice.
     *
     * @param array<string, mixed> $parts DeliveryState::toArray()
     * @param list<string> $ids every external message id of the delivery
     */
    public function saveParts(
        int $id,
        string $owner,
        array $parts,
        array $ids,
        int $now,
        ?int $leaseUntil = null,
    ): bool {
        $saved = $this->db->execute(
            'UPDATE ' . self::TABLE . ' SET delivery_parts_json = :parts, external_message_ids = :ids,'
            . ' lease_until = COALESCE(:lease_until, lease_until), updated_at = :now'
            . ' WHERE id = :id AND status = :sending AND lease_owner = :owner',
            [
                'parts' => json_encode($parts, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'ids' => json_encode(array_values($ids), JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                'lease_until' => $leaseUntil,
                'now' => $now,
                'id' => $id,
                'sending' => 'sending',
                'owner' => $owner,
            ]
        );

        return $saved > 0;
    }

    /** Extends the row lease (long download/conversion must not let a second worker take the row). */
    public function extendLease(int $id, string $owner, int $until, int $now): bool
    {
        $saved = $this->db->execute(
            'UPDATE ' . self::TABLE . ' SET lease_until = :until, updated_at = :now'
            . " WHERE id = :id AND status = 'sending' AND lease_owner = :owner",
            ['until' => $until, 'now' => $now, 'id' => $id, 'owner' => $owner]
        );

        return $saved > 0;
    }

    /**
     * @param array<string, mixed> $parts
     * @param list<string> $ids
     */
    public function markSentWithParts(int $id, array $parts, array $ids, int $now, ?string $owner = null): bool
    {
        $guard = $owner === null ? '' : " AND status = 'sending' AND lease_owner = :owner";
        $bind = [
            'ids' => json_encode(array_values($ids), JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            'parts' => json_encode($parts, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            'now' => $now,
            'id' => $id,
        ];
        if ($owner !== null) {
            $bind['owner'] = $owner;
        }
        $saved = $this->db->execute(
            'UPDATE ' . self::TABLE . " SET status = 'sent', external_message_ids = :ids,"
            . " delivery_parts_json = :parts, sent_at = :now, last_error_code = '',"
            . " lease_owner = '', lease_until = NULL, updated_at = :now WHERE id = :id" . $guard,
            $bind
        );

        return $saved > 0;
    }

    /**
     * @param int $attempts attempts performed so far (unchanged for a rate-limit postponement)
     */
    public function markRetry(
        int $id,
        int $attempts,
        int $nextAttemptAt,
        string $code,
        bool $uncertain,
        int $now,
        ?string $owner = null,
    ): bool {
        $guard = $owner === null ? '' : " AND status = 'sending' AND lease_owner = :owner";
        $bind = [
            'attempts' => max(0, $attempts),
            'uncertain' => $uncertain ? 1 : 0,
            'next' => $nextAttemptAt,
            'code' => $code,
            'now' => $now,
            'id' => $id,
        ];
        if ($owner !== null) {
            $bind['owner'] = $owner;
        }
        $saved = $this->db->execute(
            'UPDATE ' . self::TABLE . " SET status = 'pending', attempts = :attempts,"
            . ' uncertain_attempts = uncertain_attempts + :uncertain, next_attempt_at = :next,'
            . ' last_error_code = :code, last_error_at = :now, lease_owner = \'\', lease_until = NULL,'
            . ' updated_at = :now WHERE id = :id' . $guard,
            $bind
        );

        return $saved > 0;
    }

    public function markFailed(int $id, int $attempts, string $code, int $now, ?string $owner = null): bool
    {
        $guard = $owner === null ? '' : " AND status = 'sending' AND lease_owner = :owner";
        $bind = ['attempts' => $attempts, 'code' => $code, 'now' => $now, 'id' => $id];
        if ($owner !== null) {
            $bind['owner'] = $owner;
        }

        return $this->db->execute(
            'UPDATE ' . self::TABLE . " SET status = 'failed', attempts = :attempts, last_error_code = :code,"
            . " last_error_at = :now, lease_owner = '', lease_until = NULL, updated_at = :now WHERE id = :id" . $guard,
            $bind
        ) > 0;
    }

    public function markDropped(int $id, string $code, int $now, ?string $owner = null): bool
    {
        $guard = $owner === null ? '' : " AND status = 'sending' AND lease_owner = :owner";
        $bind = ['code' => $code, 'now' => $now, 'id' => $id];
        if ($owner !== null) {
            $bind['owner'] = $owner;
        }

        return $this->db->execute(
            'UPDATE ' . self::TABLE . " SET status = 'dropped', last_error_code = :code, last_error_at = :now,"
            . " lease_owner = '', lease_until = NULL, updated_at = :now WHERE id = :id" . $guard,
            $bind
        ) > 0;
    }

    /** The recipient is gone: nothing else queued for that chat should keep retrying (Plan/08). */
    public function markChatGone(int $chatId, string $code, int $now): void
    {
        $this->db->execute(
            'UPDATE ' . self::CHATS_TABLE . " SET state = 'gone', gone_reason = :code WHERE id = :id",
            ['code' => $code, 'id' => $chatId]
        );
        $this->db->execute(
            'UPDATE ' . self::TABLE . " SET status = 'dropped', last_error_code = :code, last_error_at = :now,"
            . " lease_owner = '', lease_until = NULL, updated_at = :now"
            . " WHERE chat_id = :chat AND status IN ('pending', 'sending')",
            ['code' => $code, 'now' => $now, 'chat' => $chatId]
        );
    }

    /**
     * A Telegram group became a supergroup: the same chat gets a new id (Plan/03).
     *
     * Discovery can see both the old basic group and its new supergroup (two updates around the
     * migration), so a row for the new id may already exist. In that case this row is the stale
     * duplicate: it is marked gone and its queue is dropped instead of hitting the unique index.
     *
     * @return bool false when the row was merged into an existing chat and its queue was dropped
     */
    public function updateChatId(int $chatId, string $newChatId): bool
    {
        if ($newChatId === '') {
            return true;
        }
        $chat = $this->db->fetchOne(
            'SELECT bot_id FROM ' . self::CHATS_TABLE . ' WHERE id = :id',
            ['id' => $chatId]
        );
        $other = $this->db->fetchOne(
            'SELECT id FROM ' . self::CHATS_TABLE . ' WHERE bot_id = :bot AND chat_id = :new AND id <> :id',
            ['bot' => (int)($chat['bot_id'] ?? 0), 'new' => $newChatId, 'id' => $chatId]
        );
        if ($other !== null) {
            $now = time();
            $this->db->execute(
                'UPDATE ' . self::TABLE . " SET status = 'dropped', last_error_code = 'chat_migrated',"
                . " last_error_at = :now, lease_owner = '', lease_until = NULL, updated_at = :now"
                . " WHERE chat_id = :chat AND status IN ('pending', 'sending')",
                ['now' => $now, 'chat' => $chatId]
            );
            // the supergroup is a separate, live chat row: keeping the stale duplicate would show a
            // phantom chat in the UI and block the unique index
            $this->db->execute('DELETE FROM ' . self::CHATS_TABLE . ' WHERE id = :id', ['id' => $chatId]);

            return false;
        }
        $this->db->execute(
            'UPDATE ' . self::CHATS_TABLE . ' SET chat_id = :new WHERE id = :id',
            ['new' => $newChatId, 'id' => $chatId]
        );

        return true;
    }

    /** A rejected token stops all sends through that bot until the admin replaces it. */
    public function markBotError(int $botId, string $status, string $code, int $now): void
    {
        $this->db->execute(
            'UPDATE ' . self::BOTS_TABLE . ' SET status = :status, last_error_code = :code,'
            . ' status_checked_at = :now, updated_at = :now WHERE id = :id',
            ['status' => $status, 'code' => $code, 'now' => $now, 'id' => $botId]
        );
    }

    public function markBotOk(int $botId, int $now): void
    {
        $this->db->execute(
            'UPDATE ' . self::BOTS_TABLE . " SET status = 'ok', last_error_code = '', status_checked_at = :now,"
            . ' updated_at = :now WHERE id = :id AND status <> :ok',
            ['now' => $now, 'id' => $botId, 'ok' => 'ok']
        );
    }

    /**
     * Deliveries of a page of events, keyed by event id. LEFT JOINs on purpose: the journal must keep
     * showing the history of a deleted bot or chat («Бот удалён») without failing.
     *
     * @param list<int> $eventIds
     * @return array<int, list<array<string, mixed>>>
     */
    public function deliveriesForEvents(array $eventIds): array
    {
        $ids = array_values(array_unique(array_filter($eventIds, static fn (int $id): bool => $id > 0)));
        if ($ids === []) {
            return [];
        }
        $bind = [];
        $names = [];
        foreach ($ids as $i => $id) {
            $names[] = ':e' . $i;
            $bind['e' . $i] = $id;
        }
        $rows = $this->db->fetchAll(
            'SELECT o.event_id, o.chat_id AS chat_row_id, o.bot_id AS bot_row_id, o.status, o.attempts,'
            . ' o.last_error_code, o.sent_at, o.next_attempt_at, o.updated_at, o.created_at,'
            . ' o.external_message_ids,'
            . ' o.attachment_json, o.delivery_parts_json, o.retract_progress_json,'
            . ' o.retract_requested_at, o.retracted_at, o.retract_attempts, o.retract_last_error_code,'
            . ' o.retract_reason, o.resolved_at, o.resolved_by,'
            . ' c.id AS chat_present, c.title AS chat_title, c.chat_id AS external_chat_id,'
            . ' c.chat_kind, c.state AS chat_state,'
            . ' b.id AS bot_present, b.title AS bot_title, b.channel'
            . ' FROM ' . self::TABLE . ' o'
            . ' LEFT JOIN ' . self::CHATS_TABLE . ' c ON c.id = o.chat_id'
            . ' LEFT JOIN ' . self::BOTS_TABLE . ' b ON b.id = o.bot_id'
            . ' WHERE o.event_id IN (' . implode(',', $names) . ') ORDER BY o.event_id ASC, o.id ASC',
            $bind
        );
        $result = [];
        foreach ($rows as $row) {
            $result[(int)$row['event_id']][] = [
                'chat_id' => (int)$row['chat_row_id'],
                'bot_id' => (int)$row['bot_row_id'],
                'chat_title' => (string)($row['chat_title'] ?? ''),
                'external_chat_id' => (string)($row['external_chat_id'] ?? ''),
                'chat_kind' => (string)($row['chat_kind'] ?? ''),
                'chat_state' => (string)($row['chat_state'] ?? ''),
                'bot_title' => (string)($row['bot_title'] ?? ''),
                'channel' => (string)($row['channel'] ?? ''),
                'chat_deleted' => $row['chat_present'] === null,
                'bot_deleted' => $row['bot_present'] === null,
                'status' => (string)$row['status'],
                'attempts' => (int)$row['attempts'],
                'last_error_code' => (string)$row['last_error_code'],
                'sent_at' => $row['sent_at'] === null ? null : (int)$row['sent_at'],
                'next_attempt_at' => (int)$row['next_attempt_at'],
                'updated_at' => (int)$row['updated_at'],
                'created_at' => (int)$row['created_at'],
                'external_message_ids' => json_decode((string)$row['external_message_ids'], true) ?: [],
                'attachment' => self::attachmentSummary((string)($row['delivery_parts_json'] ?? '')),
                'retract_requested_at' => $row['retract_requested_at'] === null ? null : (int)$row['retract_requested_at'],
                'retracted_at' => $row['retracted_at'] === null ? null : (int)$row['retracted_at'],
                'retract_attempts' => (int)($row['retract_attempts'] ?? 0),
                'retract_last_error_code' => (string)($row['retract_last_error_code'] ?? ''),
                'retract_reason' => (string)($row['retract_reason'] ?? ''),
                'retract_progress' => json_decode((string)($row['retract_progress_json'] ?? ''), true) ?: [],
                'resolved_at' => $row['resolved_at'] === null ? null : (int)$row['resolved_at'],
                'resolved_by' => (string)($row['resolved_by'] ?? ''),
            ];
        }

        return $result;
    }

    /**
     * Manual journal retry: failed deliveries of one event start a fresh retry schedule.
     *
     * A row whose text is not recorded as sent gets a clean parts state, so the text is sent again
     * before any audio; a row whose text already went out keeps its progress and only resumes the
     * remaining parts. The prepared audio cache of the event is dropped so a fixed token/source can
     * prepare again.
     */
    public function retryFailedForEvent(int $eventId, int $now): int
    {
        $rows = $this->db->fetchAll(
            'SELECT id, delivery_parts_json FROM ' . self::TABLE
            . ' WHERE event_id = :event AND status = :failed',
            ['event' => $eventId, 'failed' => 'failed']
        );
        $retried = 0;
        foreach ($rows as $row) {
            $partsJson = $row['delivery_parts_json'] ?? null;
            if (is_string($partsJson) && $partsJson !== '' && !self::textWasSent($partsJson)) {
                $this->db->execute(
                    'UPDATE ' . self::TABLE . ' SET delivery_parts_json = NULL, external_message_ids = :ids'
                    . ' WHERE id = :id',
                    ['ids' => '[]', 'id' => (int)$row['id']]
                );
            }
            $retried += $this->db->execute(
                'UPDATE ' . self::TABLE . " SET status = 'pending', attempts = 0, uncertain_attempts = 0,"
                . " next_attempt_at = :now, lease_owner = '', lease_until = NULL, last_error_code = '',"
                . ' last_error_at = NULL, updated_at = :now WHERE id = :id AND status = :failed',
                ['now' => $now, 'id' => (int)$row['id'], 'failed' => 'failed']
            );
        }
        if ($retried > 0) {
            // the prepared files are not reused: a retry may follow a token/tool/source fix
            $this->db->execute(
                'DELETE FROM m_MessengerHubPreparedRecordings WHERE event_id = :event',
                ['event' => $eventId]
            );
        }

        return $retried;
    }

    private static function textWasSent(string $partsJson): bool
    {
        $parts = json_decode($partsJson, true);

        return is_array($parts) && (($parts['text']['state'] ?? '') === 'sent');
    }

    // ---------- stage 2d: retraction (Plan/12) ----------

    /** Rows of an event that can be resolved: queued or already sent. */
    /** @return list<array<string, mixed>> */
    public function rowsForEvent(int $eventId): array
    {
        return $this->db->fetchAll(
            'SELECT * FROM ' . self::TABLE . ' WHERE event_id = :event ORDER BY id ASC',
            ['event' => $eventId]
        );
    }

    /** A pending delivery of a missed call whose client was called back is never sent. */
    public function cancelForResolved(int $id, string $reason, int $resolvedAt, string $resolvedBy, int $now): int
    {
        return $this->db->execute(
            'UPDATE ' . self::TABLE . " SET status = 'cancelled', last_error_code = :reason,"
            . ' last_error_at = :now, resolved_at = :resolved_at, resolved_by = :resolved_by,'
            . ' retract_reason = :reason, lease_owner = \'\', lease_until = NULL, updated_at = :now'
            . " WHERE id = :id AND status = 'pending'",
            [
                'reason' => $reason,
                'now' => $now,
                'resolved_at' => $resolvedAt,
                'resolved_by' => $resolvedBy,
                'id' => $id,
            ]
        );
    }

    /** Sent (or still sending) delivery of a missed call: queue the deletion of its messages. */
    public function requestRetraction(
        int $id,
        string $reason,
        int $resolvedAt,
        string $resolvedBy,
        int $now
    ): int {
        return $this->db->execute(
            'UPDATE ' . self::TABLE . ' SET retract_requested_at = :now, retract_attempts = 0,'
            . ' retract_next_attempt_at = :now, retract_last_error_code = \'\', retract_reason = :reason,'
            . ' resolved_at = :resolved_at, resolved_by = :resolved_by, updated_at = :now'
            . " WHERE id = :id AND status IN ('sent', 'sending') AND retract_requested_at IS NULL",
            [
                'now' => $now,
                'reason' => $reason,
                'resolved_at' => $resolvedAt,
                'resolved_by' => $resolvedBy,
                'id' => $id,
            ]
        );
    }

    /**
     * Claims retraction work: sent rows with a pending deletion request, due and not leased.
     *
     * @return list<int>
     */
    public function claimRetractions(int $limit, int $now, string $owner, int $leaseSec): array
    {
        $rows = $this->db->fetchAll(
            'SELECT id FROM ' . self::TABLE . " WHERE status = 'sent' AND retract_requested_at IS NOT NULL"
            . ' AND (retract_next_attempt_at IS NULL OR retract_next_attempt_at <= :now)'
            . ' AND (lease_until IS NULL OR lease_until < :now)'
            . ' ORDER BY retract_next_attempt_at ASC, id ASC LIMIT ' . max(1, $limit),
            ['now' => $now]
        );
        $leaseFrom = max($now, time());
        $claimed = [];
        foreach ($rows as $row) {
            $id = (int)$row['id'];
            $taken = $this->db->execute(
                'UPDATE ' . self::TABLE . ' SET lease_owner = :owner, lease_until = :until, updated_at = :now'
                . " WHERE id = :id AND status = 'sent'"
                . ' AND (lease_until IS NULL OR lease_until < :now)',
                [
                    'owner' => $owner,
                    'until' => $leaseFrom + max(30, $leaseSec),
                    'now' => $now,
                    'id' => $id,
                ]
            );
            if ($taken === 1) {
                $claimed[] = $id;
            }
        }

        return $claimed;
    }

    /**
     * One retraction row with its bot and chat; LEFT JOINs because a deleted bot still has to be
     * reported as retract_failed instead of breaking the queue.
     *
     * @return array<string, mixed>|null
     */
    public function loadRetraction(int $id): ?array
    {
        return $this->db->fetchOne(
            'SELECT o.*, c.chat_id AS external_chat_id, c.chat_kind, c.title AS chat_title,'
            . ' c.state AS chat_state, c.enabled AS chat_enabled,'
            . ' b.channel, b.token, b.id AS bot_present, c.id AS chat_present'
            . ' FROM ' . self::TABLE . ' o'
            . ' LEFT JOIN ' . self::CHATS_TABLE . ' c ON c.id = o.chat_id'
            . ' LEFT JOIN ' . self::BOTS_TABLE . ' b ON b.id = o.bot_id'
            . ' WHERE o.id = :id',
            ['id' => $id]
        );
    }

    public function markRetracted(int $id, int $now, array $progress = [], ?string $owner = null): bool
    {
        $guard = $owner === null ? '' : " AND status = 'sent' AND lease_owner = :owner";
        $bind = [
            'now' => $now,
            'progress' => json_encode($progress, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            'id' => $id,
        ];
        if ($owner !== null) {
            $bind['owner'] = $owner;
        }

        return $this->db->execute(
            'UPDATE ' . self::TABLE . " SET status = 'retracted', retracted_at = :now,"
            . " retract_last_error_code = '', lease_owner = '', lease_until = NULL,"
            . ' retract_progress_json = :progress, updated_at = :now WHERE id = :id' . $guard,
            $bind
        ) > 0;
    }

    public function saveRetractProgress(int $id, array $progress, int $now, ?string $owner = null): bool
    {
        $guard = $owner === null ? '' : " AND status = 'sent' AND lease_owner = :owner";
        $bind = [
            'progress' => json_encode($progress, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            'now' => $now,
            'id' => $id,
        ];
        if ($owner !== null) {
            $bind['owner'] = $owner;
        }

        return $this->db->execute(
            'UPDATE ' . self::TABLE . ' SET retract_progress_json = :progress, updated_at = :now'
            . ' WHERE id = :id' . $guard,
            $bind
        ) > 0;
    }

    public function markRetractRetry(
        int $id,
        int $attempts,
        int $nextAttemptAt,
        string $code,
        int $now,
        ?string $owner = null,
    ): bool {
        $guard = $owner === null ? '' : " AND status = 'sent' AND lease_owner = :owner";
        $bind = ['attempts' => $attempts, 'next' => $nextAttemptAt, 'code' => $code, 'now' => $now, 'id' => $id];
        if ($owner !== null) {
            $bind['owner'] = $owner;
        }

        return $this->db->execute(
            'UPDATE ' . self::TABLE . ' SET retract_attempts = :attempts, retract_next_attempt_at = :next,'
            . " retract_last_error_code = :code, lease_owner = '', lease_until = NULL, updated_at = :now"
            . ' WHERE id = :id' . $guard,
            $bind
        ) > 0;
    }

    public function markRetractFailed(
        int $id,
        int $attempts,
        string $code,
        int $now,
        array $progress = [],
        ?string $owner = null,
    ): bool {
        $guard = $owner === null ? '' : " AND status = 'sent' AND lease_owner = :owner";
        $bind = [
            'attempts' => $attempts,
            'code' => $code,
            'now' => $now,
            'progress' => json_encode($progress, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            'id' => $id,
        ];
        if ($owner !== null) {
            $bind['owner'] = $owner;
        }

        return $this->db->execute(
            'UPDATE ' . self::TABLE . " SET status = 'retract_failed', retract_attempts = :attempts,"
            . " retract_last_error_code = :code, lease_owner = '', lease_until = NULL,"
            . ' retract_progress_json = :progress, updated_at = :now'
            . ' WHERE id = :id' . $guard,
            $bind
        ) > 0;
    }

    /** Number of rows in a status, for the self-test and the journal (stage 2b/2c). */
    public function countByStatus(string $status): int
    {
        $row = $this->db->fetchOne(
            'SELECT COUNT(*) AS c FROM ' . self::TABLE . ' WHERE status = :status',
            ['status' => $status]
        );

        return (int)($row['c'] ?? 0);
    }

    /**
     * Compact attachment state for the journal (3a-2 renders it as text). No paths, no codes that
     * could carry personal data.
     *
     * @return array<string, mixed>
     */
    private static function attachmentSummary(string $json): array
    {
        $data = json_decode($json, true);
        if (!is_array($data)) {
            $data = [];
        }
        $attachment = is_array($data['attachment'] ?? null) ? $data['attachment'] : [];
        $audio = is_array($data['audio'] ?? null) ? $data['audio'] : [];
        $sent = 0;
        $skipped = 0;
        foreach ($audio as $part) {
            if (!is_array($part)) {
                continue;
            }
            if (($part['state'] ?? '') === 'sent') {
                $sent++;
            } elseif (($part['state'] ?? '') === 'skipped') {
                $skipped++;
            }
        }

        return [
            'state' => (string)($attachment['state'] ?? 'none'),
            'code' => (string)($attachment['code'] ?? ''),
            'parts' => count($audio),
            'sent' => $sent,
            'skipped' => $skipped,
            'note' => (string)($data['note']['state'] ?? 'none'),
        ];
    }
}
