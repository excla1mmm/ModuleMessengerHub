<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * core.call_out_of_hours (Plan/02-sources.md, 4s-B).
 *
 * ```
 * 🌙 Звонок в нерабочее время
 * +7 968 ***-**-44
 * Номер входа: +7 495 000-00-00
 * 02.10.2026 22:14
 * mikopbx-1790944900.650          [Открыть журнал звонков]
 * ```
 */
final class CallOutOfHoursTemplate implements TemplateInterface
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
        $did = trim((string)($call['did'] ?? ''));
        if ($did !== '') {
            $lines[] = $texts->t('module_messenger_hub_MessageOutOfHoursDid', ['did' => $did]);
        }
        $startedAt = (int)($call['started_at'] ?? 0);
        if ($startedAt > 0) {
            $lines[] = MessageFormat::time($startedAt);
        }

        $buttons = [];
        $url = $context->links->callCard($event->payload, $event->eventType);
        if ($url !== '') {
            $buttons[] = ['text' => $texts->t('module_messenger_hub_ButtonOpenCall'), 'url' => $url];
        }

        return new RenderedMessage(
            title: '🌙 ' . $texts->t('module_messenger_hub_EventTypeCallOutOfHours'),
            lines: $lines,
            footer: (string)($call['linkedid'] ?? ''),
            buttons: $buttons,
        );
    }
}
