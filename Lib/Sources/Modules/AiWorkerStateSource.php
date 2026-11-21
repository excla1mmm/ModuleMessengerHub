<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;

/**
 * ai_supervisor.workers — poll source over ModuleAISupervisor REST v3
 * GET /pbxcore/api/v3/module-ai-supervisor/workers (Plan/02-sources.md).
 *
 * Worker rows carry status online/offline (ModuleAISupervisor flips a worker to offline itself
 * after the heartbeat timeout, so the API is already debounced). The source emits a transition
 * event only for a worker it has seen before: ai_supervisor.worker_offline (warning) and
 * ai_supervisor.worker_online (info, recovery). dedupe_key ai_worker:{uid}:{state}:{since-ts}.
 */
final class AiWorkerStateSource implements SourceInterface
{
    public const string ID = 'ai_supervisor.workers';
    public const string EVENT_OFFLINE = 'ai_supervisor.worker_offline';
    public const string EVENT_ONLINE = 'ai_supervisor.worker_online';
    public const string API_READ_PATH = '/api/v3/module-ai-supervisor/workers';
    public const string PATH = '/pbxcore' . self::API_READ_PATH;

    private const int MAX_TRACKED = 200;

    public function id(): string
    {
        return self::ID;
    }

    public function eventTypes(): array
    {
        return [self::EVENT_OFFLINE, self::EVENT_ONLINE];
    }

    public function requiredModule(): ?string
    {
        return 'ModuleAISupervisor';
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
        $data = $context->rest->get(self::PATH);

        return self::buildBatch(is_array($data['items'] ?? null) ? $data['items'] : [], $cursor, $context->now());
    }

    /**
     * @param list<array<string, mixed>> $items worker rows (worker_uid, status, last_seen, ...)
     */
    public static function buildBatch(array $items, array $cursor, int $now): SourceBatch
    {
        $current = [];
        foreach ($items as $item) {
            $uid = trim((string)($item['worker_uid'] ?? ''));
            if ($uid === '') {
                continue;
            }
            $current[$uid] = [
                'status' => (string)($item['status'] ?? ''),
                'name' => (string)($item['name'] ?? ''),
                'last_seen' => (int)($item['last_seen'] ?? 0),
            ];
        }
        // keep insertion order stable (first seen first) so the cap trims deterministic entries;
        // array_merge lets the CURRENT status win for known workers and appends new ones
        $tracked = (array)($cursor['workers'] ?? []);
        if ($cursor === []) {
            return SourceBatch::baseline(['workers' => self::cap(array_merge($tracked, $current))]);
        }

        $events = [];
        foreach ($current as $uid => $worker) {
            $status = in_array($worker['status'], ['online', 'offline'], true) ? $worker['status'] : '';
            $previous = (string)($tracked[$uid]['status'] ?? '');
            if ($status === '' || $status === $previous || $previous === '') {
                continue; // unknown status, no change, or first sighting of the worker
            }
            $offline = $status === 'offline';
            $events[] = new HubEvent(
                sourceId: self::ID,
                eventType: $offline ? self::EVENT_OFFLINE : self::EVENT_ONLINE,
                severity: $offline ? HubEvent::SEVERITY_WARNING : HubEvent::SEVERITY_INFO,
                dedupeKey: 'ai_worker:' . $uid . ':' . $status . ':' . $now,
                occurredAt: $now,
                payload: [
                    'subject' => [
                        'call' => null,
                        'client_number' => '',
                        'employees' => [],
                        'provider' => null,
                        'worker' => [
                            'uid' => $uid,
                            'name' => $worker['name'],
                            'status' => $status,
                            'previous_status' => $previous,
                            'last_seen' => $worker['last_seen'],
                        ],
                    ],
                    'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                    'links' => [],
                    'attachments' => [],
                ],
            );
        }

        return new SourceBatch($events, ['workers' => self::cap(array_merge($tracked, $current))]);
    }

    private static function cap(array $workers): array
    {
        if (count($workers) <= self::MAX_TRACKED) {
            return $workers;
        }

        return array_slice($workers, -self::MAX_TRACKED, null, true);
    }
}
