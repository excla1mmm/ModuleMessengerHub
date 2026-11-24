<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * core.external_ip_changed (4s-C).
 *
 * ```
 * 🌐 Внешний IP-адрес изменился
 * 203.0.113.5 → 203.0.113.9
 * Обнаружено 02.10.2026 15:41
 * ```
 */
final class ExternalIpTemplate implements TemplateInterface
{
    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $change = is_array($subject['external_ip'] ?? null) ? $subject['external_ip'] : [];
        $texts = $context->texts;

        $old = trim((string)($change['old'] ?? ''));
        $new = trim((string)($change['new'] ?? ''));
        $lines = [];
        if ($new !== '') {
            // "old → new" is a formatting-only string: no words to translate
            $lines[] = $old === '' ? $new : $old . ' → ' . $new;
        }

        $notes = [];
        $since = (int)($change['since'] ?? 0);
        if ($since > 0) {
            $notes[] = $texts->t('module_messenger_hub_MessageExternalIpSeenAt', ['time' => MessageFormat::time($since)]);
        }

        return new RenderedMessage(
            title: '🌐 ' . $texts->t('module_messenger_hub_EventTypeExternalIpChanged'),
            lines: $lines,
            notes: $notes,
        );
    }
}
