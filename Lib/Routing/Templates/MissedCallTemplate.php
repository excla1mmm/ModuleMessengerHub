<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * core.missed_call (Plan/05, example at the end of "Шаблоны").
 *
 * ```
 * 📞 Пропущенный звонок
 * +7 968 968-94-44 → Иванов И. (233)
 * 02.10.2026 15:41 · входящий
 * mikopbx-1790944900.650          [Открыть звонок]
 * ```
 */
final class MissedCallTemplate implements TemplateInterface
{
    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $call = is_array($subject['call'] ?? null) ? $subject['call'] : [];
        $client = MessageFormat::phone((string)($subject['client_number'] ?? ''), $context->maskPhone);

        $employees = [];
        foreach (is_array($subject['employees'] ?? null) ? $subject['employees'] : [] as $employee) {
            if (is_array($employee)) {
                $formatted = MessageFormat::employee($employee);
                if ($formatted !== '') {
                    $employees[] = $formatted;
                }
            }
        }

        $lines = [];
        $headline = $client;
        if ($employees !== []) {
            $headline = ($headline === '' ? '' : $headline . ' → ') . implode(', ', $employees);
        }
        if ($headline !== '') {
            $lines[] = $headline;
        }

        $meta = [];
        $startedAt = (int)($call['started_at'] ?? 0);
        if ($startedAt > 0) {
            $meta[] = MessageFormat::time($startedAt);
        }
        $direction = (string)($call['direction'] ?? '');
        if ($direction !== '') {
            $meta[] = $context->texts->t(self::directionKey($direction));
        }
        if ($meta !== []) {
            $lines[] = implode(' · ', $meta);
        }

        $buttons = [];
        $url = $context->links->callCard($event->payload, $event->eventType);
        if ($url !== '') {
            $buttons[] = ['text' => $context->texts->t('module_messenger_hub_ButtonOpenCall'), 'url' => $url];
        }

        return new RenderedMessage(
            title: '📞 ' . $context->texts->t('module_messenger_hub_EventTypeMissedCall'),
            lines: $lines,
            footer: (string)($call['linkedid'] ?? ''),
            buttons: $buttons,
        );
    }

    public static function directionKey(string $direction): string
    {
        return match ($direction) {
            'incoming' => 'module_messenger_hub_MessageDirectionIncoming',
            'outgoing' => 'module_messenger_hub_MessageDirectionOutgoing',
            'internal' => 'module_messenger_hub_MessageDirectionInternal',
            default => 'module_messenger_hub_MessageDirectionUnknown',
        };
    }
}
