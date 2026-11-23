<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

/**
 * Reads and writes m_MessengerHubSourceState. One row per source id, created lazily.
 */
final class SourceStateRepository
{
    public const string TABLE = 'm_MessengerHubSourceState';

    public function __construct(private readonly HubDatabase $db)
    {
    }

    /** Carries the retired per-module status source ids over to the per-problem ones (stage 3b-4). */
    public function migrateLegacyIds(): void
    {
        SourceIdMigration::run($this->db);
    }

    /**
     * @return array{source_id: string, enabled: bool, cursor: array<string, mixed>, availability: string,
     *     last_poll_at: ?int, last_ok_at: ?int, last_error_code: string, baseline_set_at: ?int}
     */
    public function get(string $sourceId): array
    {
        $this->ensure($sourceId);
        $row = $this->db->fetchOne(
            'SELECT * FROM ' . self::TABLE . ' WHERE source_id = :id',
            ['id' => $sourceId]
        ) ?? [];
        $cursor = json_decode((string)($row['cursor_json'] ?? ''), true);

        return [
            'source_id' => $sourceId,
            'enabled' => (string)($row['enabled'] ?? '1') === '1',
            'cursor' => is_array($cursor) ? $cursor : [],
            'availability' => (string)($row['availability'] ?? ''),
            'last_poll_at' => self::nullableInt($row['last_poll_at'] ?? null),
            'last_ok_at' => self::nullableInt($row['last_ok_at'] ?? null),
            'last_error_code' => (string)($row['last_error_code'] ?? ''),
            'baseline_set_at' => self::nullableInt($row['baseline_set_at'] ?? null),
        ];
    }

    public function isEnabled(string $sourceId): bool
    {
        return $this->get($sourceId)['enabled'];
    }

    /**
     * Turning a source on resets its cursor so the next poll only sets a new baseline:
     * whatever happened while it was off is not broadcast.
     */
    public function setEnabled(string $sourceId, bool $enabled, int $now): void
    {
        $this->ensure($sourceId);
        $this->db->execute(
            'UPDATE ' . self::TABLE . ' SET enabled = :enabled'
            . ($enabled ? ", cursor_json = '', baseline_set_at = :now" : '')
            . ' WHERE source_id = :id',
            $enabled
                ? ['enabled' => '1', 'now' => $now, 'id' => $sourceId]
                : ['enabled' => '0', 'id' => $sourceId]
        );
    }

    /** @param array<string, mixed> $cursor */
    public function markPolled(string $sourceId, array $cursor, int $now): void
    {
        $this->db->execute(
            'UPDATE ' . self::TABLE . ' SET cursor_json = :cursor, availability = :availability,'
            . " last_poll_at = :now, last_ok_at = :now, last_error_code = '',"
            . ' baseline_set_at = COALESCE(baseline_set_at, :now) WHERE source_id = :id',
            [
                'cursor' => json_encode($cursor, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                'availability' => SourceAvailability::AVAILABLE,
                'now' => $now,
                'id' => $sourceId,
            ]
        );
    }

    public function markFailed(string $sourceId, string $availability, string $errorCode, int $now): void
    {
        $this->db->execute(
            'UPDATE ' . self::TABLE . ' SET availability = :availability, last_poll_at = :now,'
            . ' last_error_code = :code WHERE source_id = :id',
            ['availability' => $availability, 'now' => $now, 'code' => $errorCode, 'id' => $sourceId]
        );
    }

    /** Push sources report their health without a cursor. */
    public function markPushOk(string $sourceId, int $now): void
    {
        $this->ensure($sourceId);
        $this->db->execute(
            'UPDATE ' . self::TABLE . " SET availability = :availability, last_ok_at = :now, last_error_code = '',"
            . ' baseline_set_at = COALESCE(baseline_set_at, :now) WHERE source_id = :id',
            ['availability' => SourceAvailability::AVAILABLE, 'now' => $now, 'id' => $sourceId]
        );
    }

    /**
     * Overwrites the cursor without touching poll health (used by push sources that keep
     * guard state in the cursor, e.g. the provider debounce).
     *
     * @param array<string, mixed> $cursor
     */
    public function saveCursor(string $sourceId, array $cursor): void
    {
        $this->ensure($sourceId);
        $this->db->execute(
            'UPDATE ' . self::TABLE . ' SET cursor_json = :cursor WHERE source_id = :id',
            ['cursor' => json_encode($cursor, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), 'id' => $sourceId]
        );
    }

    /**
     * Clears the cursor without touching the enabled flag or health: the next poll sets a fresh
     * baseline (used when a source's module goes missing/disabled, Plan/02-sources.md).
     */
    public function resetCursor(string $sourceId): void
    {
        $this->ensure($sourceId);
        $this->db->execute(
            'UPDATE ' . self::TABLE . " SET cursor_json = '' WHERE source_id = :id",
            ['id' => $sourceId]
        );
    }

    /**
     * Compare-and-swap for cursors shared between a Core hook and a worker tick: writes $new only when the
     * stored cursor still equals $expected. Returns false when someone else changed it in between.
     *
     * @param array<string, mixed> $expected
     * @param array<string, mixed> $new
     */
    public function compareAndSaveCursor(string $sourceId, array $expected, array $new): bool
    {
        $this->ensure($sourceId);
        $encode = static fn (array $c): string => json_encode($c, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $where = $expected === []
            ? "(cursor_json IS NULL OR cursor_json = '' OR cursor_json = '[]')"
            : 'cursor_json = :expected';
        $bind = ['cursor' => $encode($new), 'id' => $sourceId];
        if ($expected !== []) {
            $bind['expected'] = $encode($expected);
        }

        return $this->db->execute(
            'UPDATE ' . self::TABLE . ' SET cursor_json = :cursor WHERE source_id = :id AND ' . $where,
            $bind
        ) === 1;
    }

    private function ensure(string $sourceId): void
    {
        $this->db->execute(
            'INSERT OR IGNORE INTO ' . self::TABLE . " (source_id, enabled, cursor_json, availability, last_error_code)"
            . " VALUES (:id, '1', '', '', '')",
            ['id' => $sourceId]
        );
    }

    private static function nullableInt(mixed $value): ?int
    {
        return $value === null || $value === '' ? null : (int)$value;
    }
}
