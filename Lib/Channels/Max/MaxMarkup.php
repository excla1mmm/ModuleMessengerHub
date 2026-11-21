<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels\Max;

use Modules\ModuleMessengerHub\Lib\Channels\ChannelLimits;
use Modules\ModuleMessengerHub\Lib\Channels\TextTruncator;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;

/**
 * Converts a neutral RenderedMessage into MAX `format: html` (Plan/03-channels.md, "Форматирование").
 *
 * HTML is chosen over markdown: MAX documents the allowed tags (b/strong, i/em, s/del, u/ins,
 * code/pre, a href, mark, h1–h5, blockquote) and HTML escaping is unambiguous, while markdown would
 * need undocumented escapes for *, _, ~, +, ^, #, > and [] in untrusted text. Every data field is
 * escaped, so a chat title or an AI quote can never become markup.
 *
 * The text respects the 4000 limit with the shared Plan/03 rule: the longest paragraph is shortened
 * with an ellipsis, the title, the id footer and the button stay.
 */
final class MaxMarkup
{
    /** Margin for characters MAX may count differently (entities, astral characters). */
    private const int LENGTH_MARGIN = 32;
    /** MAX link key: text 1..128, url up to 2048. */
    private const int BUTTON_TEXT_LIMIT = 128;

    public function __construct(private readonly ChannelLimits $limits)
    {
    }

    public static function escape(string $text): string
    {
        return htmlspecialchars($text, ENT_COMPAT | ENT_SUBSTITUTE, 'UTF-8');
    }

    /**
     * @return array{text: string, buttons: list<array{text: string, url: string}>}
     */
    public function render(RenderedMessage $message): array
    {
        /** @var list<array{kind: string, text: string, time: string}> $blocks */
        $blocks = [];
        if ($message->title !== '') {
            $blocks[] = ['kind' => 'title', 'text' => $message->title, 'time' => ''];
        }
        foreach ($message->lines as $line) {
            $blocks[] = ['kind' => 'line', 'text' => $line, 'time' => ''];
        }
        foreach ($message->notes as $note) {
            $blocks[] = ['kind' => 'note', 'text' => $note, 'time' => ''];
        }
        foreach ($message->quotes as $quote) {
            $text = is_string($quote['text'] ?? null) ? $quote['text'] : '';
            if ($text === '') {
                continue;
            }
            $blocks[] = [
                'kind' => 'quote',
                'text' => $text,
                'time' => is_string($quote['time'] ?? null) ? $quote['time'] : '',
            ];
        }
        if ($message->footer !== '') {
            $blocks[] = ['kind' => 'footer', 'text' => $message->footer, 'time' => ''];
        }

        $limit = max(64, $this->limits->maxTextLength - self::LENGTH_MARGIN);
        // the messenger counts the serialised markup: entities and <blockquote>…</blockquote> tags too
        TextTruncator::truncate(
            $blocks,
            $limit,
            fn (array $block): int => mb_strlen($this->renderBlock($block))
        );

        $parts = [];
        foreach ($blocks as $block) {
            $parts[] = $this->renderBlock($block);
        }

        return ['text' => implode("\n", $parts), 'buttons' => $this->buttons($message->buttons)];
    }

    /** @param array{kind: string, text: string, time: string} $block */
    private function renderBlock(array $block): string
    {
        $text = self::escape($block['text']);

        return match ($block['kind']) {
            'title' => '<b>' . $text . '</b>',
            'note' => '<i>' . $text . '</i>',
            'quote' => '<blockquote>'
                . ($block['time'] !== '' ? '<code>' . self::escape($block['time']) . '</code> ' : '')
                . '«' . $text . '»</blockquote>',
            'footer' => '<code>' . $text . '</code>',
            default => $text,
        };
    }

    /**
     * @param list<array{text: string, url: string}> $buttons
     * @return list<array{text: string, url: string}>
     */
    private function buttons(array $buttons): array
    {
        $result = [];
        foreach ($buttons as $button) {
            $text = is_string($button['text'] ?? null) ? trim($button['text']) : '';
            $url = is_string($button['url'] ?? null) ? trim($button['url']) : '';
            if ($text === '' || preg_match('~^https?://~i', $url) !== 1 || mb_strlen($url) > 2048) {
                continue; // only url buttons, never javascript: or other schemes
            }
            $result[] = ['text' => mb_substr($text, 0, self::BUTTON_TEXT_LIMIT), 'url' => $url];
        }

        return $result;
    }
}
