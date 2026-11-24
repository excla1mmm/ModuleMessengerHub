<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * core.config_changed (4s-C): one line per changed area of the PBX configuration.
 *
 * The event carries area CODES only (Lib/Sources/Core/ConfigChangeSource::AREA_BY_MODEL) — never model
 * class names, record ids or field values. The code becomes a human name here; an unknown code falls
 * back to the neutral "other settings" line, so a raw code never reaches a message.
 *
 * ```
 * 🛠 Изменения конфигурации АТС
 * Провайдеры — 2
 * Маршрутизация — 1
 * 02.10.2026 15:41 — 15:44 · удалено: 1
 * ```
 */
final class ConfigChangeTemplate implements TemplateInterface
{
    /** area code => catalog key suffix of its human name. */
    private const array AREA_KEYS = [
        'routing' => 'ConfigAreaRouting',
        'providers' => 'ConfigAreaProviders',
        'extensions' => 'ConfigAreaExtensions',
        'employees' => 'ConfigAreaEmployees',
        'services' => 'ConfigAreaServices',
        'media' => 'ConfigAreaMedia',
        'schedule' => 'ConfigAreaSchedule',
        'network' => 'ConfigAreaNetwork',
        'firewall' => 'ConfigAreaFirewall',
        'storage' => 'ConfigAreaStorage',
        'api_keys' => 'ConfigAreaApiKeys',
        'modules' => 'ConfigAreaModules',
        'settings' => 'ConfigAreaSettings',
        'other' => 'ConfigAreaOther',
    ];

    /** Upper bound of area lines in one message; the rest is summarised. */
    private const int MAX_LINES = 12;

    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $config = is_array($subject['config'] ?? null) ? $subject['config'] : [];
        $texts = $context->texts;

        $lines = [];
        $deleted = 0;
        $areas = is_array($config['areas'] ?? null) ? $config['areas'] : [];
        foreach ($areas as $item) {
            if (!is_array($item) || count($lines) >= self::MAX_LINES) {
                continue;
            }
            $code = (string)($item['area'] ?? '');
            $set = max(0, (int)($item['set'] ?? 0));
            $del = max(0, (int)($item['del'] ?? 0));
            $deleted += $del;
            $count = $set + $del;
            if ($count <= 0) {
                continue;
            }
            $lines[] = $texts->t('module_messenger_hub_MessageConfigArea', [
                'area' => $texts->t('module_messenger_hub_' . (self::AREA_KEYS[$code] ?? 'ConfigAreaOther')),
                'count' => $count,
            ]);
        }

        $notes = [];
        $since = (int)($config['since'] ?? 0);
        $last = (int)($config['last'] ?? 0);
        if ($since > 0) {
            $notes[] = $last > $since + 60
                ? $texts->t('module_messenger_hub_MessageConfigPeriod', [
                    'from' => MessageFormat::time($since),
                    'to' => MessageFormat::shortTime($last),
                ])
                : MessageFormat::time($since);
        }
        if ($deleted > 0) {
            $notes[] = $texts->t('module_messenger_hub_MessageConfigDeleted', ['count' => $deleted]);
        }

        return new RenderedMessage(
            title: '🛠 ' . $texts->t('module_messenger_hub_EventTypeConfigChanged'),
            lines: $lines,
            notes: $notes,
        );
    }
}
