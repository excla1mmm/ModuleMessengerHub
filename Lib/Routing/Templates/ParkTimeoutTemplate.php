<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * core.park_timeout (Plan/02-sources.md, 4s-B).
 *
 * ```
 * ⏱ Звонок с парковки не забрали
 * +7 968 ***-**-44
 * Место парковки: 701
 * Припарковал: 233
 * 02.10.2026 15:41 · На парковке 0:45
 * mikopbx-1790944900.650          [Открыть журнал звонков]
 * ```
 */
final class ParkTimeoutTemplate implements TemplateInterface
{
    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $call = is_array($subject['call'] ?? null) ? $subject['call'] : [];
        $texts = $context->texts;

        $lines = [];
        $client = MessageFormat::phone((string)($subject['client_number'] ?? ''), $context->maskPhone);
        if ($client !== '') {
            $lines[] = $client;
        }
        $slot = trim((string)($call['park_slot'] ?? ''));
        if ($slot !== '') {
            $lines[] = $texts->t('module_messenger_hub_MessageParkSlot', ['slot' => $slot]);
        }
        $parker = trim((string)($call['parked_by'] ?? ''));
        if ($parker !== '') {
            $lines[] = $texts->t('module_messenger_hub_MessageParkedBy', ['number' => $parker]);
        }

        $meta = [];
        $startedAt = (int)($call['started_at'] ?? 0);
        if ($startedAt > 0) {
            $meta[] = MessageFormat::time($startedAt);
        }
        $parked = (int)($call['parked_sec'] ?? 0);
        if ($parked > 0) {
            $meta[] = $texts->t('module_messenger_hub_MessageParkedFor', [
                'duration' => MessageFormat::duration($parked),
            ]);
        }
        if ($meta !== []) {
            $lines[] = implode(' · ', $meta);
        }

        $buttons = [];
        $url = $context->links->callCard($event->payload, $event->eventType);
        if ($url !== '') {
            $buttons[] = ['text' => $texts->t('module_messenger_hub_ButtonOpenCall'), 'url' => $url];
        }

        return new RenderedMessage(
            title: '⏱ ' . $texts->t('module_messenger_hub_EventTypeParkTimeout'),
            lines: $lines,
            footer: (string)($call['linkedid'] ?? ''),
            buttons: $buttons,
        );
    }
}
