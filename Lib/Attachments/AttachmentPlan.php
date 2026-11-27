<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/**
 * Frozen attachment plan of one Outbox row (Plan/03, "Вложения (этап 3a)").
 *
 * Built at routing time together with `rendered_json`, so a later rule change never alters a queued
 * message. Fragments are `start_ms`/`end_ms` offsets from the call start (already padded and merged);
 * an empty list means the whole recording. The plan never contains a messenger token; a local path is
 * kept here and in the module database only, never in logs, codes or REST responses.
 */
final class AttachmentPlan
{
    /**
     * @param list<array{start_ms: int, end_ms: int}> $fragments empty = the whole recording
     * @param array<string, mixed> $source {type: path, path, linkedid} or {type: cdr, linkedid, cdr_id}
     */
    public function __construct(
        public readonly string $mode,
        public readonly array $source,
        public readonly array $fragments,
        public readonly string $fallbackLine,
        public readonly string $captionBase,
        public readonly bool $probe = false,
        public readonly string $unavailableCode = '',
    ) {
    }

    public function available(): bool
    {
        if ($this->unavailableCode !== '' || $this->source === []) {
            return false;
        }
        $type = (string)($this->source['type'] ?? '');
        if ($type === 'path') {
            return trim((string)($this->source['path'] ?? '')) !== '';
        }
        if ($type === 'cdr') {
            return trim((string)($this->source['linkedid'] ?? '')) !== ''
                || (int)($this->source['cdr_id'] ?? 0) > 0;
        }

        return false;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'mode' => $this->mode,
            'source' => $this->source,
            'fragments' => $this->fragments,
            'fallback_line' => $this->fallbackLine,
            'caption_base' => $this->captionBase,
            'probe' => $this->probe,
            'unavailable_code' => $this->unavailableCode,
        ];
    }

    /** @param array<string, mixed> $data */
    public static function fromArray(array $data): ?self
    {
        $mode = (string)($data['mode'] ?? '');
        if (!AttachmentMode::enabled($mode)) {
            return null;
        }
        $source = is_array($data['source'] ?? null) ? $data['source'] : [];
        $probe = ($data['probe'] ?? false) === true;
        if (!$probe && ($source['type'] ?? '') === 'path' && !array_key_exists('linkedid', $source)) {
            // a plan frozen before EGOR-53 has no linkedid: Core names the INBOX copy after it, and
            // PathGuard still demands the INBOX directory and a matching stem
            $source['linkedid'] = (string)preg_replace('~\.[^./]*\z~', '', basename((string)($source['path'] ?? '')));
        }
        $fragments = [];
        foreach (is_array($data['fragments'] ?? null) ? $data['fragments'] : [] as $fragment) {
            if (!is_array($fragment)) {
                continue;
            }
            $start = (int)($fragment['start_ms'] ?? 0);
            $end = (int)($fragment['end_ms'] ?? 0);
            if ($end > $start) {
                $fragments[] = ['start_ms' => max(0, $start), 'end_ms' => $end];
            }
        }

        return new self(
            mode: $mode,
            source: $source,
            fragments: $fragments,
            fallbackLine: (string)($data['fallback_line'] ?? ''),
            captionBase: (string)($data['caption_base'] ?? ''),
            probe: $probe,
            unavailableCode: (string)($data['unavailable_code'] ?? ''),
        );
    }

    /**
     * Cache key of the prepared file: the same event, mode, source and fragments share one
     * conversion between all chats of the event (Plan/03).
     */
    public function cacheKey(int $eventId): string
    {
        $sourceKey = $this->source['type'] === 'path'
            ? (string)($this->source['path'] ?? '')
            : (string)$this->source['type'] . '|' . (string)($this->source['cdr_id'] ?? '')
                . '|' . (string)($this->source['linkedid'] ?? '');

        return hash('sha256', implode('|', [
            (string)$eventId,
            $this->mode,
            $sourceKey,
            json_encode($this->fragments, JSON_THROW_ON_ERROR),
        ]));
    }

    /** Caption of an audio part: short title+time, plus the range for a fragment. */
    public function caption(int $index): string
    {
        $caption = $this->captionBase;
        $fragment = $this->fragments[$index] ?? null;
        if ($fragment !== null) {
            $range = self::clock($fragment['start_ms']) . '–' . self::clock($fragment['end_ms']);
            $caption = $caption === '' ? $range : $caption . ' · ' . $range;
        }

        return mb_substr($caption, 0, 180);
    }

    private static function clock(int $milliseconds): string
    {
        $seconds = max(0, intdiv($milliseconds, 1000));

        return sprintf('%02d:%02d', intdiv($seconds, 60), $seconds % 60);
    }
}
