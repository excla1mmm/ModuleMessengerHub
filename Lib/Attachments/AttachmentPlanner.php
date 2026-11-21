<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\LinkBuilder;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\Rule;
use Modules\ModuleMessengerHub\Lib\Support\Texts;

/**
 * Turns an event + a matching rule into a frozen attachment plan (Plan/03, Plan/05).
 *
 * Pure: no file access, no network, no converter. A plan may be pre-marked unavailable (e.g.
 * `fragments` without quotes); the delivery service then puts the fallback line into the text and
 * never waits for audio.
 */
final class AttachmentPlanner
{
    public const string CODE_QUOTES_MISSING = 'attachment.quotes_missing';
    public const string CODE_SOURCE_MISSING = 'attachment.source_missing';

    /** Fragments around quotes: ±5 s, overlapping spans merged; longer than this is not a "quote". */
    public const int FRAGMENT_PADDING_MS = 5000;
    private const int MAX_FRAGMENTS = 3;

    public function __construct(
        private readonly Texts $texts,
        private readonly LinkBuilder $links,
    ) {
    }

    public function plan(HubEvent $event, Rule $rule, RenderedMessage $message): ?AttachmentPlan
    {
        $mode = $rule->attachmentsMode();
        if (!AttachmentMode::enabled($mode)) {
            return null;
        }
        if (!AttachmentMode::isAudioEvent($event->eventType)) {
            // core.missed_call and every other event carry no useful recording (decision 3a-1)
            return null;
        }

        $payload = $event->payload;
        $probe = ($payload['probe'] ?? false) === true;
        $source = $this->source($payload, $event->eventType, $probe);
        $callCard = $this->links->callCard($payload, $event->eventType);
        $fallback = $this->texts->t(
            $callCard !== ''
                ? 'module_messenger_hub_MessageAttachmentInAtc'
                : 'module_messenger_hub_MessageVoicemailHint'
        );
        $caption = trim($message->title);
        $at = $event->occurredAt;
        if ($at > 0) {
            $caption = ($caption === '' ? '' : $caption . ' · ') . MessageFormat::time($at);
        }

        if ($source === []) {
            return new AttachmentPlan(
                mode: $mode,
                source: [],
                fragments: [],
                fallbackLine: $fallback,
                captionBase: mb_substr($caption, 0, 180),
                probe: $probe,
                unavailableCode: self::CODE_SOURCE_MISSING,
            );
        }

        $fragments = [];
        if ($mode === AttachmentMode::FRAGMENTS && $event->eventType === 'ai_supervisor.attention_call') {
            $fragments = self::fragments(
                is_array($payload['facts'] ?? null) ? $payload['facts'] : [],
                (int)($payload['subject']['call']['duration_sec'] ?? 0)
            );
            if ($fragments === []) {
                return new AttachmentPlan(
                    mode: $mode,
                    source: $source,
                    fragments: [],
                    fallbackLine: $fallback,
                    captionBase: mb_substr($caption, 0, 180),
                    probe: $probe,
                    unavailableCode: self::CODE_QUOTES_MISSING,
                );
            }
        }
        // core.voicemail with `fragments`: there are no timecodes and the file is the message itself,
        // so it is sent whole (decision 3a-1).

        return new AttachmentPlan(
            mode: $mode,
            source: $source,
            fragments: $fragments,
            fallbackLine: $fallback,
            captionBase: mb_substr($caption, 0, 180),
            probe: $probe,
        );
    }

    /**
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    private function source(array $payload, string $eventType, bool $probe): array
    {
        $path = '';
        $linkedid = '';
        $cdrId = 0;
        foreach (is_array($payload['attachments'] ?? null) ? $payload['attachments'] : [] as $attachment) {
            if (!is_array($attachment)) {
                continue;
            }
            if ((string)($attachment['kind'] ?? '') !== 'recording') {
                continue;
            }
            $candidate = trim((string)($attachment['path'] ?? ''));
            if ($candidate !== '' && $path === '') {
                $path = $candidate;
            }
            if ((string)($attachment['source'] ?? '') === 'cdr') {
                $linkedid = trim((string)($attachment['linkedid'] ?? ''));
                $cdrId = (int)($attachment['cdr_id'] ?? 0);
            }
        }

        if ($path !== '') {
            return ['type' => 'path', 'path' => $path];
        }
        if ($eventType !== 'ai_supervisor.attention_call' || $probe) {
            // a probe event may only reference the module probe directory: no CDR lookup
            return [];
        }
        if ($linkedid === '' && $cdrId <= 0) {
            $linkedid = trim((string)($payload['subject']['call']['linkedid'] ?? ''));
        }
        if ($linkedid === '' && $cdrId <= 0) {
            return [];
        }

        return array_filter([
            'type' => 'cdr',
            'linkedid' => $linkedid,
            'cdr_id' => $cdrId > 0 ? $cdrId : null,
        ], static fn (mixed $value): bool => $value !== null && $value !== '');
    }

    /**
     * Quotes -> padded, merged, non-overlapping spans (milliseconds from the call start).
     *
     * @param array<string, mixed> $facts
     * @return list<array{start_ms: int, end_ms: int}>
     */
    public static function fragments(array $facts, int $durationSec): array
    {
        $durationMs = $durationSec > 0 ? $durationSec * 1000 : 0;
        $spans = [];
        foreach (is_array($facts['quotes'] ?? null) ? $facts['quotes'] : [] as $quote) {
            if (!is_array($quote)) {
                continue;
            }
            $start = max(0, (int)($quote['start_ms'] ?? 0) - self::FRAGMENT_PADDING_MS);
            $end = max(0, (int)($quote['end_ms'] ?? 0) + self::FRAGMENT_PADDING_MS);
            if ($durationMs > 0) {
                $start = min($start, $durationMs);
                $end = min($end, $durationMs);
            }
            if ($end <= $start) {
                continue;
            }
            $spans[] = ['start_ms' => $start, 'end_ms' => $end];
            if (count($spans) >= self::MAX_FRAGMENTS * 2) {
                break;
            }
        }
        if ($spans === []) {
            return [];
        }
        usort($spans, static fn (array $a, array $b): int => $a['start_ms'] <=> $b['start_ms']);

        $merged = [];
        foreach ($spans as $span) {
            $last = count($merged) - 1;
            if ($last >= 0 && $span['start_ms'] <= $merged[$last]['end_ms']) {
                $merged[$last]['end_ms'] = max($merged[$last]['end_ms'], $span['end_ms']);
                continue;
            }
            $merged[] = $span;
        }

        return array_slice($merged, 0, self::MAX_FRAGMENTS);
    }
}
