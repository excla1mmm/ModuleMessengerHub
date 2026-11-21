<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

/**
 * The channel-neutral truncation rule of Plan/03-channels.md: when the text is over the channel
 * limit, the longest content paragraph is shortened with an ellipsis; the id footer and the buttons
 * are kept (they are what an operator needs to act). The title is only shortened when the content is
 * already gone. Shared by Telegram and MAX so the two channels never drift.
 *
 * A channel measures the *rendered* block: the limit the messenger checks is the length of the
 * serialised markup, so `&` costs `&amp;` and a quote costs its `<blockquote>…</blockquote>` tags.
 */
final class TextTruncator
{
    /**
     * @param list<array{kind: string, text: string, time: string}> $blocks
     * @param (\Closure(array{kind: string, text: string, time: string}): int)|null $measure
     *        rendered length of one block, tags and entities included
     */
    public static function truncate(array &$blocks, int $limit, ?\Closure $measure = null): void
    {
        $measure ??= static fn (array $block): int => mb_strlen((string)$block['text']);
        self::shrink($blocks, $limit, ['line', 'note', 'quote'], $measure);
        // a title longer than the whole channel limit is a last resort: the id footer and the
        // buttons are what an operator needs, so the title goes before anything else
        self::shrink($blocks, $limit, ['title'], $measure);
    }

    /**
     * @param list<array{kind: string, text: string, time: string}> $blocks
     * @param list<string> $kinds
     * @param \Closure(array{kind: string, text: string, time: string}): int $measure
     */
    private static function shrink(array &$blocks, int $limit, array $kinds, \Closure $measure): void
    {
        $length = static function (array $blocks) use ($measure): int {
            $total = count($blocks); // newlines between the rendered blocks
            foreach ($blocks as $block) {
                $total += $measure($block);
            }

            return $total;
        };
        $overflow = $length($blocks) - $limit;
        // only the blocks of $kinds shrink: the id footer and the buttons always stay
        while ($overflow > 0) {
            $index = null;
            $longest = 0;
            foreach ($blocks as $i => $block) {
                if (!in_array($block['kind'], $kinds, true)) {
                    continue;
                }
                $len = $measure($block);
                if ($len > $longest) {
                    $longest = $len;
                    $index = $i;
                }
            }
            if ($index === null) {
                return; // nothing left to shorten without losing the id or the buttons
            }
            $keep = self::fit($blocks[$index], $measure($blocks[$index]) - $overflow - 1, $measure);
            if ($keep < 12) {
                unset($blocks[$index]);
                $blocks = array_values($blocks);
                $overflow = $length($blocks) - $limit;

                continue;
            }
            $blocks[$index]['text'] = rtrim(mb_substr((string)$blocks[$index]['text'], 0, $keep)) . '…';
            $overflow = $length($blocks) - $limit;
        }
    }

    /**
     * How many characters fit into $available rendered units (binary search, because the rendered
     * length of a prefix is not proportional to its character count once escaping and tags apply).
     *
     * @param array{kind: string, text: string, time: string} $block
     * @param \Closure(array{kind: string, text: string, time: string}): int $measure
     */
    private static function fit(array $block, int $available, \Closure $measure): int
    {
        $text = (string)$block['text'];
        $total = mb_strlen($text);
        if ($measure($block) <= $available) {
            return $total;
        }
        $candidate = $block;
        $low = 0;
        $high = $total;
        while ($low < $high) {
            $mid = intdiv($low + $high + 1, 2);
            $candidate['text'] = mb_substr($text, 0, $mid);
            if ($measure($candidate) <= $available) {
                $low = $mid;
            } else {
                $high = $mid - 1;
            }
        }

        return $low;
    }
}
