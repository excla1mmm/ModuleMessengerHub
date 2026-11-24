<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * core.extension_new_device: which extension, from which address and client, and how many devices
 * the extension was known with before. IP and User-Agent are untrusted input: they are trimmed and
 * bounded here, the channel escapes them.
 */
final class NewDeviceTemplate implements TemplateInterface
{
    private const int MAX_UA_LENGTH = 120;

    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $device = is_array($subject['device'] ?? null) ? $subject['device'] : [];
        $texts = $context->texts;

        $lines = [];
        $extension = trim((string)($device['extension'] ?? ''));
        if ($extension !== '') {
            $lines[] = $texts->t('module_messenger_hub_MessageExtension', ['extension' => $extension]);
        }
        $ip = trim((string)($device['ip'] ?? ''));
        $lines[] = $texts->t('module_messenger_hub_MessageDeviceIp', [
            'ip' => $ip !== '' ? mb_substr($ip, 0, 64) : $texts->t('module_messenger_hub_MessageDeviceUnknown'),
        ]);
        $userAgent = trim((string)($device['user_agent'] ?? ''));
        $lines[] = $texts->t('module_messenger_hub_MessageDeviceUserAgent', [
            'agent' => $userAgent !== ''
                ? mb_substr($userAgent, 0, self::MAX_UA_LENGTH)
                : $texts->t('module_messenger_hub_MessageDeviceUnknown'),
        ]);

        return new RenderedMessage(
            title: '🔐 ' . $texts->t('module_messenger_hub_EventTypeExtensionNewDevice'),
            lines: $lines,
            notes: [
                $texts->t('module_messenger_hub_MessageDeviceKnownCount', [
                    'count' => (int)($device['known_devices'] ?? 0),
                ]),
                MessageFormat::time($event->occurredAt),
            ],
        );
    }
}
