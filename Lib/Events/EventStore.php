<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Events;

use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

/**
 * Event persistence with idempotency on dedupe_key (Plan/08-reliability.md).
 *
 * INSERT OR IGNORE makes the dedupe atomic across the AMI worker, the collector and Core hooks
 * that may all write at once.
 */
final class EventStore
{
    public const string TABLE = 'm_MessengerHubEvents';

    public function __construct(private readonly HubDatabase $db)
    {
    }

    /** Returns true when the event is new, false when the dedupe_key was already stored. */
    public function record(HubEvent $event, ?int $now = null): bool
    {
        $affected = $this->db->execute(
            'INSERT OR IGNORE INTO ' . self::TABLE
            . ' (source_id, event_type, severity, dedupe_key, occurred_at, payload_json, routed_at, created_at)'
            . ' VALUES (:source_id, :event_type, :severity, :dedupe_key, :occurred_at, :payload_json, NULL, :created_at)',
            [
                'source_id' => $event->sourceId,
                'event_type' => $event->eventType,
                'severity' => $event->severity,
                'dedupe_key' => $event->dedupeKey,
                'occurred_at' => $event->occurredAt,
                'payload_json' => $event->payloadJson(),
                'created_at' => $now ?? time(),
            ]
        );

        return $affected > 0;
    }

    /**
     * Page of events, newest first, for REST GET /events.
     *
     * @param array{event_type?: string, source_id?: string, severity?: string, from?: int, to?: int} $filters
     * @return array{items: list<array<string, mixed>>, total: int}
     */
    public function page(array $filters, int $limit, int $offset): array
    {
        $where = ['1 = 1'];
        $bind = [];
        foreach (['event_type', 'source_id', 'severity'] as $column) {
            if (($filters[$column] ?? '') !== '') {
                $where[] = $column . ' = :' . $column;
                $bind[$column] = (string)$filters[$column];
            }
        }
        if (($filters['from'] ?? 0) > 0) {
            $where[] = 'occurred_at >= :from';
            $bind['from'] = (int)$filters['from'];
        }
        if (($filters['to'] ?? 0) > 0) {
            $where[] = 'occurred_at <= :to';
            $bind['to'] = (int)$filters['to'];
        }
        $whereSql = implode(' AND ', $where);
        $limit = max(1, min(200, $limit));
        $offset = max(0, $offset);

        $rows = $this->db->fetchAll(
            'SELECT id, source_id, event_type, severity, dedupe_key, occurred_at, payload_json, routed_at, created_at'
            . ' FROM ' . self::TABLE . ' WHERE ' . $whereSql
            . ' ORDER BY occurred_at DESC, id DESC LIMIT ' . $limit . ' OFFSET ' . $offset,
            $bind
        );
        $total = (int)($this->db->fetchOne('SELECT COUNT(*) AS c FROM ' . self::TABLE . ' WHERE ' . $whereSql, $bind)['c'] ?? 0);

        $items = array_map(static function (array $row): array {
            $payload = json_decode((string)($row['payload_json'] ?? ''), true);

            return [
                'id' => (int)$row['id'],
                'source_id' => (string)$row['source_id'],
                'event_type' => (string)$row['event_type'],
                'severity' => (string)$row['severity'],
                'occurred_at' => (int)$row['occurred_at'],
                'payload' => is_array($payload) ? $payload : [],
                'routed_at' => $row['routed_at'] === null ? null : (int)$row['routed_at'],
                'created_at' => (int)$row['created_at'],
            ];
        }, $rows);

        return ['items' => $items, 'total' => $total];
    }

    /**
     * One event with its full payload, for REST GET /events/{id}; null when the id does not exist.
     *
     * @return array<string, mixed>|null
     */
    public function getRecord(int $id): ?array
    {
        $row = $this->db->fetchOne(
            'SELECT id, source_id, event_type, severity, occurred_at, payload_json, routed_at, created_at'
            . ' FROM ' . self::TABLE . ' WHERE id = :id',
            ['id' => $id]
        );
        if ($row === null) {
            return null;
        }
        $payload = json_decode((string)($row['payload_json'] ?? ''), true);

        return [
            'id' => (int)$row['id'],
            'source_id' => (string)$row['source_id'],
            'event_type' => (string)$row['event_type'],
            'severity' => (string)$row['severity'],
            'occurred_at' => (int)$row['occurred_at'],
            'payload' => is_array($payload) ? $payload : [],
            'routed_at' => $row['routed_at'] === null ? null : (int)$row['routed_at'],
            'created_at' => (int)$row['created_at'],
        ];
    }

    /**
     * Events the router has not processed yet, oldest first (one batch per pass).
     *
     * @return list<array<string, mixed>>
     */
    public function unrouted(int $limit = 200): array
    {
        return $this->db->fetchAll(
            'SELECT id, source_id, event_type, severity, dedupe_key, occurred_at, payload_json'
            . ' FROM ' . self::TABLE . ' WHERE routed_at IS NULL ORDER BY id ASC LIMIT ' . max(1, min(1000, $limit))
        );
    }

    /** @param list<int> $ids */
    public function markRouted(array $ids, int $now): void
    {
        foreach (array_chunk($ids, 200) as $chunk) {
            $bind = ['now' => $now];
            $names = [];
            foreach ($chunk as $i => $id) {
                $names[] = ':i' . $i;
                $bind['i' . $i] = $id;
            }
            $this->db->execute(
                'UPDATE ' . self::TABLE . ' SET routed_at = :now WHERE id IN (' . implode(',', $names) . ')',
                $bind
            );
        }
    }

    /**
     * Marks every unrouted event as processed without producing deliveries: the hub is switched off
     * (hub_enabled = 0), so events are still collected but nothing leaves the PBX (Plan/08).
     */
    public function markAllRouted(int $now): int
    {
        return $this->db->execute(
            'UPDATE ' . self::TABLE . ' SET routed_at = :now WHERE routed_at IS NULL',
            ['now' => $now]
        );
    }

    /** Deletes events older than $before in batches; returns the number removed. */
    public function purgeOlderThan(int $before, int $batch = 500): int
    {
        $removed = 0;
        do {
            $affected = $this->db->execute(
                'DELETE FROM ' . self::TABLE . ' WHERE id IN (SELECT id FROM ' . self::TABLE
                . ' WHERE created_at < :before ORDER BY id LIMIT ' . max(1, $batch) . ')',
                ['before' => $before]
            );
            $removed += $affected;
        } while ($affected >= $batch);

        return $removed;
    }
}
