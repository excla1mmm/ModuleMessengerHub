<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * core.license_expiring (4s-C): one product, one reminder bucket (or the expired state).
 *
 * The event carries the product name and its expiry date only — no licence key, no company name, no
 * e-mail or phone of the registration (Plan/07).
 *
 * ```
 * ⚠️ Срок лицензии истекает
 * MikoPBX
 * Действует до 31.12.2026
 * Осталось дней: 7
 * ```
 */
final class LicenseExpiryTemplate implements TemplateInterface
{
    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $license = is_array($subject['license'] ?? null) ? $subject['license'] : [];
        $texts = $context->texts;

        $expired = (string)($license['bucket'] ?? '') === 'expired';
        $product = trim((string)($license['product'] ?? ''));
        $expiry = trim((string)($license['expiry'] ?? ''));
        $date = self::date($expiry);

        $lines = [];
        if ($product !== '') {
            $lines[] = $product;
        }
        if ($date !== '') {
            $lines[] = $texts->t(
                $expired
                    ? 'module_messenger_hub_MessageLicenseExpiredOn'
                    : 'module_messenger_hub_MessageLicenseExpiresOn',
                ['date' => $date]
            );
        }

        $notes = [];
        $days = (int)($license['days_left'] ?? 0);
        if (!$expired && $days >= 0) {
            $notes[] = $texts->t('module_messenger_hub_MessageLicenseDaysLeft', ['days' => $days]);
        }

        return new RenderedMessage(
            title: ($expired ? '🛑 ' : '⚠️ ') . $texts->t('module_messenger_hub_EventTypeLicenseExpiring'),
            lines: $lines,
            notes: $notes,
        );
    }

    /** "2026-12-31" => "31.12.2026" (PBX date format), unchanged when unparsable. */
    private static function date(string $value): string
    {
        $timestamp = strtotime($value . ' 12:00:00');

        return $timestamp === false ? $value : date('d.m.Y', $timestamp);
    }
}
