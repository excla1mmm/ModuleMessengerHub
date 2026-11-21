<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * core.advice: the Core warning text (message_tpl + params) resolved through the module catalog first,
 * then Core's translation service.
 */
final class AdviceTemplate implements TemplateInterface
{
    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $advice = is_array($subject['advice'] ?? null) ? $subject['advice'] : [];
        $messageTpl = (string)($advice['message_tpl'] ?? '');
        $params = is_array($advice['params'] ?? null) ? $advice['params'] : [];
        $text = $messageTpl !== '' ? $context->texts->t($messageTpl, $params) : '';
        $isCritical = $event->severity === HubEvent::SEVERITY_CRITICAL;

        return new RenderedMessage(
            title: ($isCritical ? '🛑 ' : '⚠️ ') . $context->texts->t('module_messenger_hub_EventTypeAdvice'),
            lines: $text !== '' ? [$text] : [],
        );
    }
}
