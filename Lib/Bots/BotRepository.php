<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Bots;

use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

/**
 * SQL access to bots, their chats, discovery sessions and the last delivery per chat (Plan/04, Plan/06).
 *
 * Rows carry `token` — it is the REST layer's job to strip it before answering (Plan/07). Every write
 * is explicit: there is no model save() here, so the REST processor stays Core-free and testable on
 * SQLite.
 */
final class BotRepository
{
    public const string BOTS = 'm_MessengerHubBots';
    public const string CHATS = 'm_MessengerHubBotChats';
    public const string SESSIONS = 'm_MessengerHubDiscoverySessions';
    public const string OUTBOX = 'm_MessengerHubOutbox';
    public const string EVENTS = 'm_MessengerHubEvents';

    public function __construct(private readonly HubDatabase $db)
    {
    }

    /** @return list<array<string, mixed>> */
    public function all(int $limit = 50, int $offset = 0): array
    {
        return $this->db->fetchAll(
            'SELECT * FROM ' . self::BOTS . ' ORDER BY id ASC LIMIT ' . max(1, $limit) . ' OFFSET ' . max(0, $offset)
        );
    }

    public function count(): int
    {
        $row = $this->db->fetchOne('SELECT COUNT(*) AS c FROM ' . self::BOTS);

        return (int)($row['c'] ?? 0);
    }

    /** @return array<string, mixed>|null */
    public function find(int $id): ?array
    {
        return $this->db->fetchOne('SELECT * FROM ' . self::BOTS . ' WHERE id = :id', ['id' => $id]);
    }

    /** Another bot with the same messenger identity (token replaced with a different bot's token). */
    /** @return array<string, mixed>|null */
    public function findByExternalId(string $externalId): ?array
    {
        if ($externalId === '') {
            return null;
        }

        return $this->db->fetchOne(
            'SELECT * FROM ' . self::BOTS . ' WHERE bot_external_id = :external ORDER BY id ASC',
            ['external' => $externalId]
        );
    }

    /** @param array<string, mixed> $fields */
    public function create(array $fields): int
    {
        $this->db->execute(
            'INSERT INTO ' . self::BOTS . ' (channel, title, token, token_hint, bot_username, bot_external_id,'
            . ' enabled, status, status_checked_at, last_error_code, created_at, updated_at)'
            . ' VALUES (:channel, :title, :token, :token_hint, :bot_username, :bot_external_id, :enabled,'
            . ' :status, :status_checked_at, :last_error_code, :created_at, :updated_at)',
            [
                'channel' => (string)($fields['channel'] ?? 'telegram'),
                'title' => (string)($fields['title'] ?? ''),
                'token' => (string)($fields['token'] ?? ''),
                'token_hint' => (string)($fields['token_hint'] ?? ''),
                'bot_username' => (string)($fields['bot_username'] ?? ''),
                'bot_external_id' => (string)($fields['bot_external_id'] ?? ''),
                'enabled' => (string)($fields['enabled'] ?? '1'),
                'status' => (string)($fields['status'] ?? 'new'),
                'status_checked_at' => (int)($fields['status_checked_at'] ?? 0),
                'last_error_code' => (string)($fields['last_error_code'] ?? ''),
                'created_at' => (int)($fields['created_at'] ?? time()),
                'updated_at' => (int)($fields['updated_at'] ?? time()),
            ]
        );

        return $this->db->lastInsertId();
    }

    /** @param array<string, mixed> $fields only the whitelisted columns below */
    public function update(int $id, array $fields): void
    {
        $allowed = [
            'title', 'token', 'token_hint', 'bot_username', 'bot_external_id', 'enabled',
            'status', 'status_checked_at', 'last_error_code', 'updated_at',
        ];
        $set = [];
        $bind = ['id' => $id];
        foreach ($allowed as $column) {
            if (array_key_exists($column, $fields)) {
                $set[] = $column . ' = :' . $column;
                $bind[$column] = $fields[$column];
            }
        }
        if ($set === []) {
            return;
        }
        $this->db->execute(
            'UPDATE ' . self::BOTS . ' SET ' . implode(', ', $set) . ' WHERE id = :id',
            $bind
        );
    }

    /**
     * Deletes the bot with its chats and sessions. Queued deliveries of those chats are dropped, the
     * event history stays (the journal is the audit trail, Plan/06).
     */
    public function delete(int $id, int $now): void
    {
        $chatIds = array_map(
            static fn (array $row): int => (int)$row['id'],
            $this->db->fetchAll('SELECT id FROM ' . self::CHATS . ' WHERE bot_id = :bot', ['bot' => $id])
        );
        foreach ($chatIds as $chatId) {
            $this->db->execute(
                'UPDATE ' . self::OUTBOX . " SET status = 'dropped', last_error_code = 'bot_deleted',"
                . ' last_error_at = :now, updated_at = :now'
                . " WHERE chat_id = :chat AND status IN ('pending', 'sending')",
                ['now' => $now, 'chat' => $chatId]
            );
        }
        $this->db->execute('DELETE FROM ' . self::CHATS . ' WHERE bot_id = :bot', ['bot' => $id]);
        $this->db->execute('DELETE FROM ' . self::SESSIONS . ' WHERE bot_id = :bot', ['bot' => $id]);
        $this->db->execute('DELETE FROM ' . self::BOTS . ' WHERE id = :id', ['id' => $id]);
    }

    /** @return list<array<string, mixed>> */
    public function chats(int $botId): array
    {
        return $this->db->fetchAll(
            'SELECT * FROM ' . self::CHATS . ' WHERE bot_id = :bot ORDER BY id ASC',
            ['bot' => $botId]
        );
    }

    /** @return array<string, mixed>|null */
    public function findChat(int $botId, int $rowId): ?array
    {
        return $this->db->fetchOne(
            'SELECT * FROM ' . self::CHATS . ' WHERE id = :id AND bot_id = :bot',
            ['id' => $rowId, 'bot' => $botId]
        );
    }

    /** @return array<string, mixed>|null */
    public function findChatByExternal(int $botId, string $externalChatId): ?array
    {
        if ($externalChatId === '') {
            return null;
        }

        return $this->db->fetchOne(
            'SELECT * FROM ' . self::CHATS . ' WHERE bot_id = :bot AND chat_id = :chat',
            ['bot' => $botId, 'chat' => $externalChatId]
        );
    }

    /**
     * Adds a discovered chat once: an existing row keeps enabled/state/linked_user_id, its title and its
     * kind. Only an empty title is filled — a title (or kind) set by the admin must never be overwritten
     * by the next discovery pass, which replays `bot_added` from offset 0.
     * Discovered chats start disabled — the admin opts in before anything is sent.
     *
     * @param array<string, mixed> $fields
     */
    public function upsertChat(int $botId, array $fields, int $now): int
    {
        $external = (string)($fields['chat_id'] ?? '');
        $existing = $this->findChatByExternal($botId, $external);
        if ($existing !== null) {
            // some channels do not report a chat title at all (MAX bot_added): keep the known one
            $title = mb_substr(trim((string)($fields['title'] ?? '')), 0, 255);
            $kind = trim((string)($fields['chat_kind'] ?? ''));
            $this->db->execute(
                'UPDATE ' . self::CHATS . ' SET title = :title, chat_kind = :kind WHERE id = :id',
                [
                    'title' => trim((string)$existing['title']) !== '' ? (string)$existing['title'] : $title,
                    'kind' => trim((string)$existing['chat_kind']) !== '' ? (string)$existing['chat_kind'] : $kind,
                    'id' => (int)$existing['id'],
                ]
            );

            return (int)$existing['id'];
        }
        $this->db->execute(
            'INSERT INTO ' . self::CHATS . ' (bot_id, chat_id, chat_kind, title, linked_user_id, enabled, state,'
            . ' gone_reason, discovered_at) VALUES (:bot, :chat, :kind, :title, :linked, :enabled, :state,'
            . ' :gone, :discovered)',
            [
                'bot' => $botId,
                'chat' => $external,
                'kind' => (string)($fields['chat_kind'] ?? 'group'),
                'title' => mb_substr(trim((string)($fields['title'] ?? '')), 0, 255),
                'linked' => (int)($fields['linked_user_id'] ?? 0),
                'enabled' => (string)($fields['enabled'] ?? '0'),
                'state' => 'active',
                'gone' => '',
                'discovered' => (int)($fields['discovered_at'] ?? $now),
            ]
        );

        return $this->db->lastInsertId();
    }

    /** @param array<string, mixed> $fields */
    public function updateChat(int $rowId, array $fields): void
    {
        $allowed = ['chat_id', 'chat_kind', 'title', 'linked_user_id', 'enabled', 'state', 'gone_reason'];
        $set = [];
        $bind = ['id' => $rowId];
        foreach ($allowed as $column) {
            if (array_key_exists($column, $fields)) {
                $set[] = $column . ' = :' . $column;
                $bind[$column] = $fields[$column];
            }
        }
        if ($set === []) {
            return;
        }
        $this->db->execute(
            'UPDATE ' . self::CHATS . ' SET ' . implode(', ', $set) . ' WHERE id = :id',
            $bind
        );
    }

    /**
     * Latest delivery per chat of the bot, newest first — shown next to the chat and in the test result.
     *
     * @return array<int, array<string, mixed>> chat row id => delivery
     */
    public function lastDeliveries(int $botId): array
    {
        $rows = $this->db->fetchAll(
            'SELECT o.chat_id, o.event_id, o.status, o.attempts, o.last_error_code, o.sent_at, o.created_at,'
            . ' e.event_type FROM ' . self::OUTBOX . ' o JOIN ' . self::EVENTS . ' e ON e.id = o.event_id'
            . ' WHERE o.bot_id = :bot AND o.id IN (SELECT MAX(id) FROM ' . self::OUTBOX
            . ' WHERE bot_id = :bot2 GROUP BY chat_id)',
            ['bot' => $botId, 'bot2' => $botId]
        );
        $result = [];
        foreach ($rows as $row) {
            $result[(int)$row['chat_id']] = [
                'event_id' => (int)$row['event_id'],
                'event_type' => (string)$row['event_type'],
                'status' => (string)$row['status'],
                'attempts' => (int)$row['attempts'],
                'last_error_code' => (string)$row['last_error_code'],
                'sent_at' => $row['sent_at'] === null ? null : (int)$row['sent_at'],
                'created_at' => (int)$row['created_at'],
            ];
        }

        return $result;
    }

    // ---------- discovery sessions ----------

    /** @return array<string, mixed>|null */
    public function latestSession(int $botId): ?array
    {
        return $this->db->fetchOne(
            'SELECT * FROM ' . self::SESSIONS . ' WHERE bot_id = :bot ORDER BY id DESC',
            ['bot' => $botId]
        );
    }

    /** @return array<string, mixed>|null */
    public function activeSession(int $botId): ?array
    {
        return $this->db->fetchOne(
            'SELECT * FROM ' . self::SESSIONS . " WHERE bot_id = :bot AND status IN ('running', 'found')"
            . ' ORDER BY id DESC',
            ['bot' => $botId]
        );
    }

    public function createSession(int $botId, int $now, int $ttlSec): int
    {
        $this->db->execute(
            'INSERT INTO ' . self::SESSIONS . ' (bot_id, started_at, expires_at, updates_offset, found_json, status,'
            . " last_error_code) VALUES (:bot, :started, :expires, 0, '[]', 'running', '')",
            ['bot' => $botId, 'started' => $now, 'expires' => $now + max(60, $ttlSec)]
        );

        return $this->db->lastInsertId();
    }

    /**
     * Sessions the discovery worker must poll now.
     *
     * @return list<array<string, mixed>>
     */
    public function sessionsToPoll(int $now): array
    {
        return $this->db->fetchAll(
            'SELECT * FROM ' . self::SESSIONS . " WHERE status IN ('running', 'found') AND expires_at > :now"
            . ' ORDER BY id ASC',
            ['now' => $now]
        );
    }

    /** Turns sessions whose five minutes are over into expired/empty (worker missed them, e.g. restart). */
    public function finalizeExpired(int $now): int
    {
        return $this->db->execute(
            'UPDATE ' . self::SESSIONS . " SET status = CASE"
            . " WHEN found_json IS NULL OR found_json = '' OR found_json = '[]' THEN 'empty' ELSE 'expired' END"
            . " WHERE status IN ('running', 'found') AND expires_at <= :now",
            ['now' => $now]
        );
    }

    /**
     * @param list<array<string, mixed>> $found
     */
    public function saveSession(int $id, int $offset, array $found, string $status, string $error, int $now): void
    {
        $this->db->execute(
            'UPDATE ' . self::SESSIONS . ' SET updates_offset = :offset, found_json = :found, status = :status,'
            . ' last_error_code = :error WHERE id = :id',
            [
                'offset' => $offset,
                'found' => json_encode(array_values($found), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                'status' => $status,
                'error' => $error,
                'id' => $id,
            ]
        );
    }

    public function stopSession(int $id, string $status, int $now): void
    {
        $this->db->execute(
            'UPDATE ' . self::SESSIONS . ' SET status = :status WHERE id = :id',
            ['status' => $status, 'id' => $id]
        );
    }
}
