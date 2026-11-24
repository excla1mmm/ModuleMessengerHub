<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;
use Modules\ModuleMessengerHub\Lib\Sources\Core\TollFraudSource;

/**
 * core.toll_fraud_suspected: the rule name in words, the dialled number (masked like any client
 * number), the caller extension, the burst counters and the call link.
 */
final class TollFraudTemplate implements TemplateInterface
{
    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $toll = is_array($subject['toll_fraud'] ?? null) ? $subject['toll_fraud'] : [];
        $texts = $context->texts;
        $rule = (string)($toll['rule'] ?? '');

        $lines = [$texts->t(self::ruleKey($rule))];
        $destination = MessageFormat::phone((string)($toll['destination'] ?? ''), $context->maskPhone);
        if ($destination !== '') {
            $lines[] = $destination;
        }
        $extension = trim((string)($toll['extension'] ?? ''));
        if ($extension !== '') {
            $lines[] = $texts->t('module_messenger_hub_MessageExtension', ['extension' => $extension]);
        }
        if ($rule === TollFraudSource::RULE_BURST) {
            $lines[] = $texts->t('module_messenger_hub_MessageTollBurst', [
                'count' => (int)($toll['count'] ?? 0),
                'window' => (int)($toll['window_min'] ?? 0),
            ]);
        }

        $notes = [];
        $call = is_array($subject['call'] ?? null) ? $subject['call'] : [];
        $startedAt = MessageFormat::time((int)($call['started_at'] ?? 0));
        if ($startedAt !== '') {
            $notes[] = $startedAt;
        }

        $buttons = [];
        $url = $context->links->callCard($event->payload, $event->eventType);
        if ($url !== '') {
            $buttons[] = ['text' => $texts->t('module_messenger_hub_ButtonOpenCall'), 'url' => $url];
        }

        return new RenderedMessage(
            title: '🚨 ' . $texts->t('module_messenger_hub_EventTypeTollFraud'),
            lines: $lines,
            notes: $notes,
            footer: (string)($call['linkedid'] ?? ''),
            buttons: $buttons,
        );
    }

    private static function ruleKey(string $rule): string
    {
        return match ($rule) {
            TollFraudSource::RULE_BURST => 'module_messenger_hub_MessageTollRuleBurst',
            TollFraudSource::RULE_OFF_HOURS => 'module_messenger_hub_MessageTollRuleOffHours',
            default => 'module_messenger_hub_MessageTollRuleDestination',
        };
    }
}
