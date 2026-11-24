<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * core.sip_auth_failures: the extension under brute force, how many failures it gained inside the
 * window, the total counter and the top source addresses Core reported.
 */
final class SipAuthFailureTemplate implements TemplateInterface
{
    private const int MAX_IPS = 3;

    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $auth = is_array($subject['auth_failures'] ?? null) ? $subject['auth_failures'] : [];
        $texts = $context->texts;

        $lines = [];
        $extension = trim((string)($auth['extension'] ?? ''));
        if ($extension !== '') {
            $lines[] = $texts->t('module_messenger_hub_MessageExtension', ['extension' => $extension]);
        }
        $lines[] = $texts->t('module_messenger_hub_MessageAuthFailWindow', [
            'growth' => (int)($auth['growth'] ?? 0),
            'window' => (int)($auth['window_min'] ?? 0),
        ]);

        $notes = [
            $texts->t('module_messenger_hub_MessageAuthFailCount', ['count' => (int)($auth['failures'] ?? 0)]),
        ];
        $ips = [];
        foreach (is_array($auth['ips'] ?? null) ? $auth['ips'] : [] as $row) {
            if (!is_array($row)) {
                continue;
            }
            $ip = trim((string)($row['ip'] ?? ''));
            if ($ip !== '') {
                $ips[] = $ip;
            }
            if (count($ips) >= self::MAX_IPS) {
                break;
            }
        }
        if ($ips !== []) {
            $notes[] = $texts->t('module_messenger_hub_MessageAuthFailIps', ['ips' => implode(', ', $ips)]);
        }
        $since = MessageFormat::time((int)($auth['since'] ?? 0));
        if ($since !== '') {
            $notes[] = $texts->t('module_messenger_hub_MessageStatusSince', ['time' => $since]);
        }

        return new RenderedMessage(
            title: '🛡 ' . $texts->t('module_messenger_hub_EventTypeSipAuthFailures'),
            lines: $lines,
            notes: $notes,
        );
    }
}
