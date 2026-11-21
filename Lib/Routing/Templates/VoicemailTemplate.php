<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * core.voicemail: the recording itself is an attachment of stage 3a; the message points to the journal.
 */
final class VoicemailTemplate implements TemplateInterface
{
    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $call = is_array($subject['call'] ?? null) ? $subject['call'] : [];

        $lines = [];
        $startedAt = (int)($call['started_at'] ?? 0);
        if ($startedAt > 0) {
            $lines[] = MessageFormat::time($startedAt);
        }
        $lines[] = $context->texts->t('module_messenger_hub_MessageVoicemailHint');

        $buttons = [];
        $url = $context->links->callCard($event->payload, $event->eventType);
        if ($url !== '') {
            $buttons[] = ['text' => $context->texts->t('module_messenger_hub_ButtonOpenCall'), 'url' => $url];
        }

        return new RenderedMessage(
            title: '🎙 ' . $context->texts->t('module_messenger_hub_EventTypeVoicemail'),
            lines: $lines,
            footer: (string)($call['linkedid'] ?? ''),
            buttons: $buttons,
        );
    }
}
