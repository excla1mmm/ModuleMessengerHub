<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * core.provider_down / core.provider_up: which provider, where it points, the state transition.
 */
final class ProviderStatusTemplate implements TemplateInterface
{
    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $provider = is_array($subject['provider'] ?? null) ? $subject['provider'] : [];
        $isDown = $event->eventType === 'core.provider_down';

        $name = trim((string)($provider['username'] ?? ''));
        if ($name === '') {
            $name = trim((string)($provider['id'] ?? ''));
        }
        $lines = [];
        if ($name !== '') {
            $lines[] = $name;
        }
        $host = trim((string)($provider['host'] ?? ''));
        if ($host !== '') {
            $lines[] = $host;
        }
        $from = trim((string)($provider['old_state'] ?? ''));
        $to = trim((string)($provider['new_state'] ?? ''));
        $notes = $from !== '' || $to !== ''
            ? [$context->texts->t('module_messenger_hub_MessageProviderTransition', ['from' => $from, 'to' => $to])]
            : [];
        $eventsAt = MessageFormat::time($event->occurredAt);
        if ($eventsAt !== '') {
            $notes[] = $eventsAt;
        }

        return new RenderedMessage(
            title: ($isDown ? '⚠️ ' : '✅ ') . $context->texts->t(
                $isDown
                    ? 'module_messenger_hub_EventTypeProviderDown'
                    : 'module_messenger_hub_EventTypeProviderUp'
            ),
            lines: $lines,
            notes: $notes,
        );
    }
}
