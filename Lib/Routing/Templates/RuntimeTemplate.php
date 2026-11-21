<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * voice_agent.runtime_down / voice_agent.runtime_up.
 */
final class RuntimeTemplate implements TemplateInterface
{
    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $runtime = is_array($subject['runtime'] ?? null) ? $subject['runtime'] : [];
        $isDown = $event->eventType === 'voice_agent.runtime_down';
        $texts = $context->texts;

        $lines = [];
        $error = trim((string)($runtime['error'] ?? ''));
        if ($error !== '') {
            $lines[] = $error;
        }
        $notes = [];
        $latency = (int)($runtime['latency_ms'] ?? 0);
        if ($latency > 0) {
            $notes[] = $texts->t('module_messenger_hub_MessageLatency', ['ms' => $latency]);
        }

        return new RenderedMessage(
            title: ($isDown ? '⚠️ ' : '✅ ') . $texts->t(
                $isDown
                    ? 'module_messenger_hub_EventTypeRuntimeDown'
                    : 'module_messenger_hub_EventTypeRuntimeUp'
            ),
            lines: $lines,
            notes: $notes,
        );
    }
}
