<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;
use Modules\ModuleMessengerHub\Lib\Sources\SourceCatalog;

/**
 * ai_supervisor.worker_offline / ai_supervisor.worker_online.
 *
 * Two payload shapes are supported: the stage 1.3 `/workers` reader put the worker row in
 * `subject.worker`; since stage 3b-1 the same event type comes from the generic `/status`
 * adapter with `subject.module_status` (opaque ref, counters) — the reader switch does not
 * change the event type, so the template must render both.
 */
final class AiWorkerTemplate implements TemplateInterface
{
    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $worker = is_array($subject['worker'] ?? null) ? $subject['worker'] : [];
        $status = is_array($subject['module_status'] ?? null) ? $subject['module_status'] : [];
        $isOffline = $event->eventType === 'ai_supervisor.worker_offline';
        $title = ($isOffline ? '🔌 ' : '✅ ') . $context->texts->t(
            $isOffline
                ? 'module_messenger_hub_EventTypeWorkerOffline'
                : 'module_messenger_hub_EventTypeWorkerOnline'
        );

        if ($worker === [] && $status !== []) {
            return $this->renderStatus($status, $isOffline, $title, $context);
        }

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
            title: $title,
            lines: $lines,
            notes: $notes,
            footer: $uid,
        );
    }

    /** @param array<string, mixed> $status subject.module_status */
    private function renderStatus(array $status, bool $isOffline, string $title, RenderContext $context): RenderedMessage
    {
        $texts = $context->texts;
        $lines = [];
        $moduleKey = SourceCatalog::moduleNameKey((string)($status['module'] ?? ''));
        if ($moduleKey !== null) {
            $lines[] = $texts->t($moduleKey);
        }
        $lines[] = $texts->t(
            $isOffline
                ? 'module_messenger_hub_MessageStatusWorkerOffline'
                : 'module_messenger_hub_MessageStatusWorkerOnline'
        );

        $notes = [];
        $counters = is_array($status['counters'] ?? null) ? $status['counters'] : [];
        $online = $counters['workers_online'] ?? null;
        $total = $counters['workers_total'] ?? null;
        if (is_int($online) && is_int($total)) {
            $notes[] = $texts->t('module_messenger_hub_MessageStatusWorkersCounters', [
                'online' => $online,
                'total' => $total,
            ]);
        }
        $since = (int)($status['since'] ?? 0);
        if ($since > 0) {
            $notes[] = $texts->t('module_messenger_hub_MessageStatusSince', [
                'time' => MessageFormat::time($since),
            ]);
        }

        return new RenderedMessage(title: $title, lines: $lines, notes: $notes);
    }
}
