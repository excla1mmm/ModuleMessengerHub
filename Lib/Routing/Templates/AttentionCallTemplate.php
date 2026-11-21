<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * ai_supervisor.attention_call — the client format agreed in moduleaisupervisor#10: quality score,
 * employee and client, duration, up to three quotes with timecodes, call id, «Открыть звонок».
 *
 * ```
 * ⚠️ Звонок требует внимания · оценка 48
 * Петрова А. (241) ← +7 916 ***-**-17 · 6:42
 * Причины: клиенту не помогли; повторный звонок
 * Клиенту не помогли: дважды отправили на сайт.          (italic summary)
 * «02:14» Я уже третий раз звоню по этому вопросу         (blockquote)
 * 1731924120.4471                                        [Открыть звонок]
 * ```
 */
final class AttentionCallTemplate implements TemplateInterface
{
    private const int MAX_REASONS = 4;
    private const array ARROWS = ['incoming' => '←', 'outgoing' => '→', 'internal' => '↔'];

    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $call = is_array($subject['call'] ?? null) ? $subject['call'] : [];
        $facts = is_array($event->payload['facts'] ?? null) ? $event->payload['facts'] : [];
        $attention = is_array($subject['attention'] ?? null) ? $subject['attention'] : [];
        $texts = $context->texts;

        $title = '⚠️ ' . $texts->t('module_messenger_hub_EventTypeAttentionCall');
        $score = $attention['quality_score'] ?? ($facts['scores']['quality'] ?? null);
        if (is_numeric($score)) {
            $title .= ' · ' . $texts->t('module_messenger_hub_MessageQualityScore', ['score' => self::score($score)]);
        }

        $lines = [];
        $line = self::callLine($subject, $call, $context->maskPhone);
        if ($line !== '') {
            $lines[] = $line;
        }

        $reasons = [];
        foreach (is_array($facts['reasons'] ?? null) ? $facts['reasons'] : [] as $reason) {
            if (is_string($reason) && trim($reason) !== '') {
                $reasons[] = trim($reason);
            }
            if (count($reasons) === self::MAX_REASONS) {
                break;
            }
        }
        if ($reasons !== []) {
            $lines[] = $texts->t('module_messenger_hub_MessageReasons', ['reasons' => implode('; ', $reasons)]);
        }

        $notes = [];
        $summary = trim((string)($facts['summary'] ?? ''));
        if ($summary !== '') {
            $notes[] = $summary;
        }

        $quotes = [];
        foreach (is_array($facts['quotes'] ?? null) ? $facts['quotes'] : [] as $quote) {
            if (!is_array($quote)) {
                continue;
            }
            $text = trim((string)($quote['quote'] ?? $quote['text'] ?? ''));
            if ($text === '') {
                continue;
            }
            $quotes[] = [
                'time' => self::timecode((int)($quote['start_ms'] ?? 0)),
                'text' => $text,
            ];
            if (count($quotes) === 3) {
                break;
            }
        }

        $buttons = [];
        $url = $context->links->callCard($event->payload, $event->eventType);
        if ($url !== '') {
            $buttons[] = ['text' => $texts->t('module_messenger_hub_ButtonOpenCall'), 'url' => $url];
        }

        return new RenderedMessage(
            title: $title,
            lines: $lines,
            notes: $notes,
            quotes: $quotes,
            footer: (string)($call['linkedid'] ?? ($attention['ref_id'] ?? '')),
            buttons: $buttons,
        );
    }

    /** @param array<string, mixed> $subject @param array<string, mixed> $call */
    private static function callLine(array $subject, array $call, bool $mask): string
    {
        $employee = '';
        foreach (is_array($subject['employees'] ?? null) ? $subject['employees'] : [] as $item) {
            if (is_array($item)) {
                $employee = MessageFormat::employee($item);
                if ($employee !== '') {
                    break;
                }
            }
        }
        $client = MessageFormat::phone((string)($subject['client_number'] ?? ''), $mask);
        $arrow = self::ARROWS[(string)($call['direction'] ?? '')] ?? '·';
        $parts = array_values(array_filter([$employee, $client], static fn (string $v): bool => $v !== ''));
        $line = implode(' ' . $arrow . ' ', $parts);
        $duration = (int)($call['duration_sec'] ?? 0);
        if ($duration > 0) {
            $line .= ($line === '' ? '' : ' · ') . MessageFormat::duration($duration);
        }

        return $line;
    }

    private static function score(mixed $score): string
    {
        $value = (float)$score;

        return $value === floor($value) ? (string)(int)$value : (string)round($value, 1);
    }

    private static function timecode(int $startMs): string
    {
        $seconds = max(0, intdiv($startMs, 1000));

        return sprintf('%02d:%02d', intdiv($seconds, 60), $seconds % 60);
    }
}
