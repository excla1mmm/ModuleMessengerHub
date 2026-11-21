<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;

/**
 * core.pbx_started — push source fed by the Core hook onAfterPbxStarted (once per PBX boot).
 *
 * dedupe_key embeds the boot time, so a second hook call within the same boot is deduped
 * and a real restart produces a new event. Boot time comes from /proc/uptime (Core-free);
 * when it cannot be read the event is skipped rather than guessed.
 */
final class PbxStartedSource implements SourceInterface
{
    public const string ID = 'core.pbx_started';
    public const string EVENT_TYPE = 'core.pbx_started';

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

    /** @return HubEvent|null null when the boot time is unknown */
    public static function buildEvent(int $bootTime, int $now): ?HubEvent
    {
        if ($bootTime <= 0) {
            return null;
        }

        return new HubEvent(
            sourceId: self::ID,
            eventType: self::EVENT_TYPE,
            severity: HubEvent::SEVERITY_INFO,
            dedupeKey: 'pbx_started:' . $bootTime,
            occurredAt: $bootTime,
            payload: [
                'subject' => [
                    'call' => null,
                    'client_number' => '',
                    'employees' => [],
                    'provider' => null,
                    'system' => ['boot_at' => $bootTime, 'uptime_sec' => max(0, $now - $bootTime)],
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => [],
            ],
        );
    }
}
