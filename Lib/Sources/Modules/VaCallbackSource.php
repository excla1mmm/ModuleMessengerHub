<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;

/**
 * voice_agent.callbacks — poll source over ModuleVoiceAgent REST v3
 * GET /pbxcore/api/v3/module-voice-agent/callbacks (Plan/02-sources.md).
 *
 * The endpoint returns callbacks newest-first (created_at DESC, id DESC), so a max-id cursor
 * catches new requests; ids grow monotonically. dedupe_key va_callback:{id}. The page limit
 * covers 100 requests per poll — a higher burst spills over to the next pass, not lost forever
 * (cursor only advances to the ids actually seen).
 */
final class VaCallbackSource implements SourceInterface
{
    public const string ID = 'voice_agent.callbacks';
    public const string EVENT_TYPE = 'voice_agent.callback_request';
    public const string API_READ_PATH = '/api/v3/module-voice-agent/callbacks';
    public const string PATH = '/pbxcore' . self::API_READ_PATH;

    private const int PAGE_LIMIT = 100;

    public function id(): string
    {
        return self::ID;
    }

    public function eventTypes(): array
    {
        return [self::EVENT_TYPE];
    }

    public function requiredModule(): ?string
    {
        return 'ModuleVoiceAgent';
    }

    public function apiReadPaths(): array
    {
        return [self::API_READ_PATH];
    }

    public function mode(): string
    {
        return SourceInterface::MODE_POLL;
    }

    public function pollIntervalSec(): int
    {
        return 60;
    }

    public function poll(SourceContext $context, array $cursor): SourceBatch
    {
        $data = $context->rest->get(self::PATH, ['limit' => self::PAGE_LIMIT]);

        return self::buildBatch(is_array($data['items'] ?? null) ? $data['items'] : [], $cursor, $context->now());
    }

    /**
     * @param list<array<string, mixed>> $items callback rows (id, created_at, phone, topic, status, ...)
     */
    public static function buildBatch(array $items, array $cursor, int $now): SourceBatch
    {
        $maxId = (int)($cursor['max_id'] ?? 0);
        if ($cursor === []) {
            return SourceBatch::baseline(['max_id' => self::maxSeenId($items)]);
        }

        $newItems = array_values(array_filter(
            $items,
            static fn (array $item): bool => (int)($item['id'] ?? 0) > $maxId
        ));
        usort($newItems, static fn (array $a, array $b): int => (int)$a['id'] <=> (int)$b['id']); // oldest first

        $events = [];
        foreach ($newItems as $item) {
            $event = self::buildEvent($item, $now);
            if ($event !== null) {
                $events[] = $event;
            }
        }

        return new SourceBatch($events, ['max_id' => max($maxId, self::maxSeenId($items))]);
    }

    /**
     * @param array<string, mixed> $item
     */
    public static function buildEvent(array $item, int $now): ?HubEvent
    {
        $id = (int)($item['id'] ?? 0);
        if ($id <= 0) {
            return null;
        }

        return new HubEvent(
            sourceId: self::ID,
            eventType: self::EVENT_TYPE,
            severity: HubEvent::SEVERITY_INFO,
            dedupeKey: 'va_callback:' . $id,
            occurredAt: max(1, (int)($item['created_at'] ?? $now)),
            payload: [
                'subject' => [
                    'call' => null,
                    'client_number' => (string)($item['phone'] ?? ''),
                    'employees' => [],
                    'provider' => null,
                    'callback' => [
                        'id' => $id,
                        'name' => (string)($item['name'] ?? ''),
                        'phone' => (string)($item['phone'] ?? ''),
                        'caller' => (string)($item['caller'] ?? ''),
                        'topic' => (string)($item['topic'] ?? ''),
                        'status' => (string)($item['status'] ?? ''),
                        'agent_id' => (int)($item['agent_id'] ?? 0),
                        'agent_name' => (string)($item['agent_name'] ?? ''),
                        'preferred_time' => (string)($item['preferred_time'] ?? ''),
                        'callback_at' => (string)($item['callback_at'] ?? ''),
                        'missed_extension' => (string)($item['missed_extension'] ?? ''),
                        'missed_name' => (string)($item['missed_name'] ?? ''),
                        'missed_only' => (bool)($item['missed_only'] ?? false),
                        'call_id' => (string)($item['call_id'] ?? ''),
                        'created_at' => (int)($item['created_at'] ?? 0),
                    ],
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => [],
            ],
        );
    }

    /** @param list<array<string, mixed>> $items */
    private static function maxSeenId(array $items): int
    {
        $max = 0;
        foreach ($items as $item) {
            $max = max($max, (int)($item['id'] ?? 0));
        }

        return $max;
    }
}
