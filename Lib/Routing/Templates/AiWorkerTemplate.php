<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * ai_supervisor.worker_offline / ai_supervisor.worker_online.
 */
final class AiWorkerTemplate implements TemplateInterface
{
    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $worker = is_array($subject['worker'] ?? null) ? $subject['worker'] : [];
        $isOffline = $event->eventType === 'ai_supervisor.worker_offline';

        $name = trim((string)($worker['name'] ?? ''));
        $uid = trim((string)($worker['uid'] ?? ''));
        $lines = [];
        if ($name !== '') {
            $lines[] = $name;
        }
        $notes = [];
        $lastSeen = (int)($worker['last_seen'] ?? 0);
        if ($lastSeen > 0) {
            $notes[] = $context->texts->t(
                'module_messenger_hub_MessageLastSeen',
                ['time' => MessageFormat::time($lastSeen)]
            );
        }

        return new RenderedMessage(
            title: ($isOffline ? '🔌 ' : '✅ ') . $context->texts->t(
                $isOffline
                    ? 'module_messenger_hub_EventTypeWorkerOffline'
                    : 'module_messenger_hub_EventTypeWorkerOnline'
            ),
            lines: $lines,
            notes: $notes,
            footer: $uid,
        );
    }
}
