<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing;

use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

/**
 * Reads m_MessengerHubRules. Writes belong to the rules REST resource (stage 2c).
 */
final class RuleRepository
{
    public const string TABLE = 'm_MessengerHubRules';

    public function __construct(private readonly HubDatabase $db)
    {
    }

    /** @return list<Rule> enabled rules in evaluation order */
    public function enabled(): array
    {
        return $this->load("WHERE enabled = '1'");
    }

    /** @return list<Rule> */
    public function all(): array
    {
        return $this->load('');
    }

    /** @return list<array<string, mixed>> raw rows in evaluation order (REST serialization) */
    public function rows(): array
    {
        return $this->db->fetchAll('SELECT * FROM ' . self::TABLE . ' ORDER BY sort ASC, id ASC');
    }

    public function find(int $id): ?Rule
    {
        $row = $this->db->fetchOne('SELECT * FROM ' . self::TABLE . ' WHERE id = :id', ['id' => $id]);

        return $row === null ? null : Rule::fromRow($row);
    }

    /** @param array<string, mixed> $fields */
    public function create(array $fields, int $now): int
    {
        $this->db->execute(
            'INSERT INTO ' . self::TABLE . ' (title, enabled, event_types, min_severity, filters_json, target_mode,'
            . ' chat_ids_json, template_key, options_json, quiet_hours_json, sort, created_at, updated_at)'
            . ' VALUES (:title, :enabled, :types, :severity, :filters, :mode, :chats, :template, :options,'
            . " '{}', :sort, :created, :updated)",
            [
                'title' => (string)($fields['title'] ?? ''),
                'enabled' => (string)($fields['enabled'] ?? '1'),
                'types' => json_encode($fields['event_types'] ?? [], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'severity' => (string)($fields['min_severity'] ?? 'info'),
                'filters' => json_encode($fields['filters'] ?? [], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'mode' => (string)($fields['target_mode'] ?? Rule::MODE_RECIPIENTS),
                'chats' => json_encode($fields['chat_ids'] ?? [], JSON_THROW_ON_ERROR),
                'template' => (string)($fields['template_key'] ?? ''),
                'options' => json_encode($fields['options'] ?? [], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'sort' => (int)($fields['priority'] ?? 100),
                'created' => $now,
                'updated' => $now,
            ]
        );

        return $this->db->lastInsertId();
    }

    /** @param array<string, mixed> $fields */
    public function update(int $id, array $fields, int $now): void
    {
        $set = ['updated_at = :updated'];
        $bind = ['id' => $id, 'updated' => $now];
        $map = [
            'title' => 'title',
            'enabled' => 'enabled',
            'min_severity' => 'min_severity',
            'target_mode' => 'target_mode',
            'template_key' => 'template_key',
        ];
        foreach ($map as $field => $column) {
            if (array_key_exists($field, $fields)) {
                $set[] = $column . ' = :' . $field;
                $bind[$field] = $fields[$field];
            }
        }
        $jsonMap = [
            'event_types' => 'event_types',
            'filters' => 'filters_json',
            'chat_ids' => 'chat_ids_json',
            'options' => 'options_json',
        ];
        foreach ($jsonMap as $field => $column) {
            if (array_key_exists($field, $fields)) {
                $set[] = $column . ' = :' . $field;
                $bind[$field] = json_encode($fields[$field], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            }
        }
        if (array_key_exists('priority', $fields)) {
            $set[] = 'sort = :priority';
            $bind['priority'] = (int)$fields['priority'];
        }
        $this->db->execute(
            'UPDATE ' . self::TABLE . ' SET ' . implode(', ', $set) . ' WHERE id = :id',
            $bind
        );
    }

    public function delete(int $id): void
    {
        $this->db->execute('DELETE FROM ' . self::TABLE . ' WHERE id = :id', ['id' => $id]);
    }

    /** @param list<int> $ids new evaluation order */
    public function reorder(array $ids): void
    {
        $sort = 10;
        foreach ($ids as $id) {
            $this->db->execute(
                'UPDATE ' . self::TABLE . ' SET sort = :sort WHERE id = :id',
                ['sort' => $sort, 'id' => $id]
            );
            $sort += 10;
        }
    }

    public function maxSort(): int
    {
        $row = $this->db->fetchOne('SELECT MAX(sort) AS m FROM ' . self::TABLE);

        return (int)($row['m'] ?? 0);
    }

    /**
     * Latest event among the rule's types (for the notification row). Prefix rules use LIKE.
     *
     * @param list<string> $eventTypes
     */
    public function lastEventAt(array $eventTypes): ?int
    {
        $where = [];
        $bind = [];
        foreach (array_values($eventTypes) as $i => $type) {
            if (str_ends_with($type, '.*')) {
                $where[] = 'event_type LIKE :p' . $i;
                $bind['p' . $i] = substr($type, 0, -1) . '%';
            } else {
                $where[] = 'event_type = :t' . $i;
                $bind['t' . $i] = $type;
            }
        }
        if ($where === []) {
            return null;
        }
        $row = $this->db->fetchOne(
            'SELECT MAX(occurred_at) AS m FROM m_MessengerHubEvents WHERE ' . implode(' OR ', $where),
            $bind
        );

        return ($row['m'] ?? null) === null ? null : (int)$row['m'];
    }

    /**
     * Selected chats with their bot (for the rule record); missing rows are simply absent.
     *
     * @param list<int> $ids
     * @return list<array<string, mixed>>
     */
    public function chatsByIds(array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids, static fn (int $id): bool => $id > 0)));
        if ($ids === []) {
            return [];
        }
        $bind = [];
        $names = [];
        foreach ($ids as $i => $id) {
            $names[] = ':c' . $i;
            $bind['c' . $i] = $id;
        }

        return $this->db->fetchAll(
            'SELECT c.id, c.chat_id, c.chat_kind, c.title, c.enabled, c.state, c.bot_id, c.linked_user_id,'
            . ' b.title AS bot_title, b.channel, b.enabled AS bot_enabled'
            . ' FROM ' . ChatResolver::CHATS_TABLE . ' c JOIN ' . ChatResolver::BOTS_TABLE . ' b ON b.id = c.bot_id'
            . ' WHERE c.id IN (' . implode(',', $names) . ') ORDER BY c.id ASC',
            $bind
        );
    }

    /** @return list<Rule> */
    private function load(string $where): array
    {
        $rows = $this->db->fetchAll(
            'SELECT * FROM ' . self::TABLE . ' ' . $where . ' ORDER BY sort ASC, id ASC'
        );

        return array_map(static fn (array $row): Rule => Rule::fromRow($row), $rows);
    }
}
