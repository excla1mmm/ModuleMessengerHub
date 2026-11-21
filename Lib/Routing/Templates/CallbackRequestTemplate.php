<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * voice_agent.callback_request: who asked, about what, when it is convenient, which employee missed it.
 */
final class CallbackRequestTemplate implements TemplateInterface
{
    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $callback = is_array($subject['callback'] ?? null) ? $subject['callback'] : [];
        $texts = $context->texts;

        $name = trim((string)($callback['name'] ?? ''));
        $phone = MessageFormat::phone((string)($callback['phone'] ?? ''), $context->maskPhone);
        $who = implode(' · ', array_values(array_filter([$name, $phone], static fn (string $v): bool => $v !== '')));

        $lines = [];
        if ($who !== '') {
            $lines[] = $who;
        }
        $topic = trim((string)($callback['topic'] ?? ''));
        if ($topic !== '') {
            $lines[] = $texts->t('module_messenger_hub_MessageTopic', ['topic' => $topic]);
        }
        $preferred = trim((string)($callback['preferred_time'] ?? ''));
        if ($preferred !== '') {
            $lines[] = $texts->t('module_messenger_hub_MessagePreferredTime', ['time' => $preferred]);
        }
        $agent = trim((string)($callback['agent_name'] ?? ''));
        $missedName = trim((string)($callback['missed_name'] ?? ''));
        $missedNumber = trim((string)($callback['missed_extension'] ?? ''));
        $missed = $missedName !== '' ? MessageFormat::employee(['name' => $missedName, 'number' => $missedNumber]) : '';
        $notes = [];
        if ($agent !== '') {
            $notes[] = $texts->t('module_messenger_hub_MessageAgent', ['agent' => $agent]);
        }
        if ($missed !== '') {
            $notes[] = $texts->t('module_messenger_hub_MessageMissedBy', ['employee' => $missed]);
        }

        $buttons = [];
        $url = $context->links->callCard($event->payload, $event->eventType);
        if ($url !== '') {
            $buttons[] = ['text' => $texts->t('module_messenger_hub_ButtonOpenCall'), 'url' => $url];
        }

        return new RenderedMessage(
            title: '📞 ' . $texts->t('module_messenger_hub_EventTypeCallbackRequest'),
            lines: $lines,
            notes: $notes,
            footer: (string)($callback['call_id'] ?? ''),
            buttons: $buttons,
        );
    }
}
