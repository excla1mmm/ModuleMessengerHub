<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * core.pbx_started: one message per boot.
 */
final class PbxStartedTemplate implements TemplateInterface
{
    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $system = is_array($subject['system'] ?? null) ? $subject['system'] : [];
        $bootAt = (int)($system['boot_at'] ?? $event->occurredAt);

        return new RenderedMessage(
            title: '🔄 ' . $context->texts->t('module_messenger_hub_EventTypePbxStarted'),
            lines: [MessageFormat::time($bootAt)],
        );
    }
}
