<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

/**
 * SQL access to the prepared audio cache (Plan/04, stage 3a).
 *
 * `claim()` is the only way into `preparing`: it takes an expired/absent lease, so two workers can
 * never convert the same event at the same time. A row in `failed` is final for that cache key.
 */
final class PreparedRecordingsRepository
{
    public const string TABLE = 'm_MessengerHubPreparedRecordings';

    public function __construct(private readonly HubDatabase $db)
    {
    }

    /** @return array<string, mixed>|null */
    public function find(string $cacheKey): ?array
    {
        return $this->db->fetchOne(
            'SELECT * FROM ' . self::TABLE . ' WHERE cache_key = :key',
            ['key' => $cacheKey]
        );
    }

    /**
     * Inserts or takes over a cache row. False means another worker holds a live lease.
     */
    public function claim(
        int $eventId,
        string $cacheKey,
        string $owner,
        int $now,
        int $leaseSec,
    ): bool {
        $this->db->execute(
            'INSERT OR IGNORE INTO ' . self::TABLE
            . ' (event_id, cache_key, status, files_json, lease_owner, lease_until, error_code, created_at, updated_at)'
            . " VALUES (:event, :key, 'preparing', '[]', :owner, :until, '', :now, :now)",
            [
                'event' => $eventId,
                'key' => $cacheKey,
                'owner' => $owner,
                'until' => $now + max(60, $leaseSec),
                'now' => $now,
            ]
        );
        $taken = $this->db->execute(
            'UPDATE ' . self::TABLE . " SET status = 'preparing', lease_owner = :owner,"
            . ' lease_until = :until, error_code = \'\', updated_at = :now'
            . " WHERE cache_key = :key AND status = 'preparing'"
            . ' AND (lease_until IS NULL OR lease_until < :now OR lease_owner = :owner)',
            [
                'owner' => $owner,
                'until' => $now + max(60, $leaseSec),
                'now' => $now,
                'key' => $cacheKey,
            ]
        );

        return $taken === 1;
    }

    public function extend(int $id, string $owner, int $until, int $now): bool
    {
        return $this->db->execute(
            'UPDATE ' . self::TABLE . ' SET lease_until = :until, updated_at = :now'
            . " WHERE id = :id AND status = 'preparing' AND lease_owner = :owner",
            ['until' => $until, 'now' => $now, 'id' => $id, 'owner' => $owner]
        ) > 0;
    }

    /** @param array<int|string, array<string, mixed>> $files */
    public function markReady(int $id, string $owner, array $files, int $now): void
    {
        $this->db->execute(
            'UPDATE ' . self::TABLE . " SET status = 'ready', files_json = :files, lease_owner = '',"
            . ' lease_until = NULL, error_code = \'\', updated_at = :now'
            . " WHERE id = :id AND status = 'preparing' AND lease_owner = :owner",
            [
                'files' => json_encode($files, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'now' => $now,
                'id' => $id,
                'owner' => $owner,
            ]
        );
    }

    public function markFailed(int $id, string $owner, string $code, int $now): void
    {
        $this->db->execute(
            'UPDATE ' . self::TABLE . " SET status = 'failed', error_code = :code, lease_owner = '',"
            . ' lease_until = NULL, updated_at = :now'
            . " WHERE id = :id AND status = 'preparing' AND lease_owner = :owner",
            ['code' => $code, 'now' => $now, 'id' => $id, 'owner' => $owner]
        );
    }

    /** Removes a cache row (a transient failure must be retried with a fresh row). */
    public function discard(string $cacheKey, ?string $owner = null, ?int $now = null): void
    {
        $sql = 'DELETE FROM ' . self::TABLE . ' WHERE cache_key = :key';
        $bind = ['key' => $cacheKey];
        if ($owner !== null) {
            $sql .= ' AND (lease_owner = :owner OR lease_until IS NULL OR lease_until < :now)';
            $bind['owner'] = $owner;
            $bind['now'] = $now ?? time();
        }
        $this->db->execute($sql, $bind);
    }

    public function delete(int $id): void
    {
        $this->db->execute('DELETE FROM ' . self::TABLE . ' WHERE id = :id', ['id' => $id]);
    }

    /** @return list<array<string, mixed>> */
    public function forEvent(int $eventId): array
    {
        return $this->db->fetchAll(
            'SELECT * FROM ' . self::TABLE . ' WHERE event_id = :event',
            ['event' => $eventId]
        );
    }

    /** @return list<array<string, mixed>> */
    public function stalePreparing(int $now, int $before): array
    {
        return $this->db->fetchAll(
            'SELECT * FROM ' . self::TABLE . " WHERE status = 'preparing'"
            . ' AND (lease_until IS NULL OR lease_until < :now)'
            . ' AND updated_at < :before',
            ['now' => $now, 'before' => $before]
        );
    }

    /** @return list<array<string, mixed>> */
    public function staleFailed(int $before): array
    {
        return $this->db->fetchAll(
            'SELECT * FROM ' . self::TABLE . " WHERE status = 'failed' AND updated_at < :before",
            ['before' => $before]
        );
    }

    /**
     * Ready rows of events with no delivery left to make; they can be deleted with their files.
     *
     * @return list<array<string, mixed>>
     */
    public function unreferencedReady(int $before): array
    {
        return $this->db->fetchAll(
            'SELECT p.* FROM ' . self::TABLE . ' p'
            . " WHERE p.status = 'ready' AND p.updated_at < :before"
            . ' AND NOT EXISTS (SELECT 1 FROM m_MessengerHubOutbox o'
            . " WHERE o.event_id = p.event_id AND o.status IN ('pending', 'sending'))",
            ['before' => $before]
        );
    }

    /** @return list<string> */
    public function activePaths(): array
    {
        $rows = $this->db->fetchAll('SELECT files_json FROM ' . self::TABLE . " WHERE status = 'ready'");
        $paths = [];
        foreach ($rows as $row) {
            $files = json_decode((string)($row['files_json'] ?? '[]'), true);
            foreach (is_array($files) ? $files : [] as $file) {
                if (is_array($file) && is_string($file['path'] ?? null) && $file['path'] !== '') {
                    $paths[] = $file['path'];
                }
            }
        }

        return $paths;
    }
}
