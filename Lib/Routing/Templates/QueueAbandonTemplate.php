<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * core.queue_abandoned (Plan/02-sources.md, 4s-B).
 *
 * ```
 * ⏳ Очередь: клиент не дождался
 * +7 968 ***-**-44
 * Очередь: Продажи (800)
 * 02.10.2026 15:41 · Ожидание 2:30
 * mikopbx-1790944900.650          [Открыть журнал звонков]
 * ```
 *
 * A long wait of a call that was finally answered uses the same type with reason "long_wait" and its own
 * headline; the queue name is optional (the event carries the number, the name comes from Core CallQueues).
 */
final class QueueAbandonTemplate implements TemplateInterface
{
    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $call = is_array($subject['call'] ?? null) ? $subject['call'] : [];
        $texts = $context->texts;
        $longWait = (string)($call['reason'] ?? '') === 'long_wait';

        $lines = [];
        $client = MessageFormat::phone((string)($subject['client_number'] ?? ''), $context->maskPhone);
        if ($client !== '') {
            $lines[] = $client;
        }
        $queue = self::queueLabel((string)($call['queue_number'] ?? ''), (string)($call['queue_name'] ?? ''));
        if ($queue !== '') {
            $lines[] = $texts->t('module_messenger_hub_MessageQueueLine', ['queue' => $queue]);
        }

        $meta = [];
        $startedAt = (int)($call['started_at'] ?? 0);
        if ($startedAt > 0) {
            $meta[] = MessageFormat::time($startedAt);
        }
        $waited = (int)($call['waited_sec'] ?? 0);
        if ($waited > 0) {
            $meta[] = $texts->t('module_messenger_hub_MessageQueueWaited', [
                'duration' => MessageFormat::duration($waited),
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
            title: '⏳ ' . $texts->t(
                $longWait
                    ? 'module_messenger_hub_MessageQueueLongWaitTitle'
                    : 'module_messenger_hub_EventTypeQueueAbandoned'
            ),
            lines: $lines,
            footer: (string)($call['linkedid'] ?? ''),
            buttons: $buttons,
        );
    }

    /** "Продажи (800)" with a name, "800" without one, "" when the event carries neither. */
    public static function queueLabel(string $number, string $name): string
    {
        $number = trim($number);
        $name = trim($name);
        if ($name === '') {
            return $number;
        }

        return $number === '' ? $name : $name . ' (' . $number . ')';
    }
}
