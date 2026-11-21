<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

/**
 * Resolves the recipient chats of a rule (Plan/05, "Получатели правила").
 *
 * - recipients: the chats selected in the rule (enabled, active, bot enabled);
 * - employee: the chat linked to an employee of the event;
 * - employee_or_recipients: employee chats when found, the selected chats otherwise.
 *
 * Chats of disabled bots or chats marked gone/enabled=0 are never delivered to.
 */
final class ChatResolver
{
    public const string CHATS_TABLE = 'm_MessengerHubBotChats';
    public const string BOTS_TABLE = 'm_MessengerHubBots';

    public function __construct(private readonly HubDatabase $db)
    {
    }

    /**
     * @return list<array{id: int, bot_id: int, chat_id: string, chat_kind: string, title: string, channel: string}>
     */
    public function resolve(Rule $rule, HubEvent $event): array
    {
        return match ($rule->targetMode) {
            Rule::MODE_EMPLOYEE => $this->employeeChats($rule->eventUserIds($event)),
            Rule::MODE_EMPLOYEE_OR_RECIPIENTS => $this->employeeChats($rule->eventUserIds($event))
                ?: $this->recipientChats($rule->chatIds),
            default => $this->recipientChats($rule->chatIds),
        };
    }

    /**
     * @param list<int> $chatIds
     * @return list<array{id: int, bot_id: int, chat_id: string, chat_kind: string, title: string, channel: string}>
     */
    public function recipientChats(array $chatIds): array
    {
        $chatIds = array_values(array_unique(array_filter($chatIds, static fn (int $id): bool => $id > 0)));
        if ($chatIds === []) {
            return [];
        }
        $bind = [];
        $names = [];
        foreach ($chatIds as $i => $id) {
            $names[] = ':c' . $i;
            $bind['c' . $i] = $id;
        }
        $rows = $this->db->fetchAll(
            'SELECT c.id, c.bot_id, c.chat_id, c.chat_kind, c.title, b.channel'
            . ' FROM ' . self::CHATS_TABLE . ' c JOIN ' . self::BOTS_TABLE . ' b ON b.id = c.bot_id'
            . ' WHERE c.id IN (' . implode(',', $names) . ") AND c.enabled = '1' AND c.state = 'active'"
            . " AND b.enabled = '1' ORDER BY c.id ASC",
            $bind
        );

        return self::normalize($rows);
    }

    /**
     * @param list<int> $userIds
     * @return list<array{id: int, bot_id: int, chat_id: string, chat_kind: string, title: string, channel: string}>
     */
    public function employeeChats(array $userIds): array
    {
        $userIds = array_values(array_unique(array_filter($userIds, static fn (int $id): bool => $id > 0)));
        if ($userIds === []) {
            return [];
        }
        $bind = [];
        $names = [];
        foreach ($userIds as $i => $id) {
            $names[] = ':u' . $i;
            $bind['u' . $i] = $id;
        }
        $rows = $this->db->fetchAll(
            'SELECT c.id, c.bot_id, c.chat_id, c.chat_kind, c.title, b.channel'
            . ' FROM ' . self::CHATS_TABLE . ' c JOIN ' . self::BOTS_TABLE . ' b ON b.id = c.bot_id'
            . ' WHERE c.linked_user_id IN (' . implode(',', $names) . ") AND c.enabled = '1' AND c.state = 'active'"
            . " AND b.enabled = '1' ORDER BY c.id ASC",
            $bind
        );

        return self::normalize($rows);
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array{id: int, bot_id: int, chat_id: string, chat_kind: string, title: string, channel: string}>
     */
    private static function normalize(array $rows): array
    {
        return array_map(static fn (array $row): array => [
            'id' => (int)$row['id'],
            'bot_id' => (int)$row['bot_id'],
            'chat_id' => (string)$row['chat_id'],
            'chat_kind' => (string)$row['chat_kind'],
            'title' => (string)$row['title'],
            'channel' => (string)$row['channel'],
        ], $rows);
    }
}
