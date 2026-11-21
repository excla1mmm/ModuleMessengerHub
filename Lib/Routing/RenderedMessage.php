<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing;

/**
 * Channel-neutral message produced by a template (Plan/03-channels.md, "Форматирование").
 *
 * Templates never render markup: they fill a title, plain lines, italic notes, quotes, a monospace
 * footer (call id), url buttons and attachments. A channel adapter converts this to its own markup
 * and escapes every data field.
 *
 * The array form is what Outbox.rendered_json stores, so the text is frozen at routing time
 * (already masked if the rule or settings ask for it).
 */
final class RenderedMessage
{
    /**
     * @param list<string> $lines plain lines, e.g. "+7 968 ***-**-44 -> Иванов И. (233)"
     * @param list<string> $notes italic paragraphs (AI summary, hints)
     * @param list<array{time?: string, text: string}> $quotes up to 3 AI quotes with timecodes
     * @param list<array{text: string, url: string}> $buttons url buttons only (no callbacks in v1)
     * @param list<array{kind: string, path: string, title?: string, caption?: string}> $attachments
     */
    public function __construct(
        public readonly string $title = '',
        public readonly array $lines = [],
        public readonly array $notes = [],
        public readonly array $quotes = [],
        public readonly string $footer = '',
        public readonly array $buttons = [],
        public readonly array $attachments = [],
    ) {
    }

    /** Appends an italic note (used to mark probe/preview messages). */
    public function withNote(string $note): self
    {
        if ($note === '') {
            return $this;
        }

        return new self(
            title: $this->title,
            lines: $this->lines,
            notes: [...$this->notes, $note],
            quotes: $this->quotes,
            footer: $this->footer,
            buttons: $this->buttons,
            attachments: $this->attachments,
        );
    }

    /** Appends a plain line (used for the "recording is available in the PBX" fallback). */
    public function withLine(string $line): self
    {
        if ($line === '' || in_array($line, $this->lines, true)) {
            return $this;
        }

        return new self(
            title: $this->title,
            lines: [...$this->lines, $line],
            notes: $this->notes,
            quotes: $this->quotes,
            footer: $this->footer,
            buttons: $this->buttons,
            attachments: $this->attachments,
        );
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'title' => $this->title,
            'lines' => $this->lines,
            'notes' => $this->notes,
            'quotes' => $this->quotes,
            'footer' => $this->footer,
            'buttons' => $this->buttons,
            'attachments' => $this->attachments,
        ];
    }

    /** @param array<string, mixed> $data */
    public static function fromArray(array $data): self
    {
        $strings = static function (mixed $value): array {
            return is_array($value)
                ? array_values(array_filter($value, static fn (mixed $v): bool => is_string($v) && $v !== ''))
                : [];
        };
        $objects = static function (mixed $value): array {
            return is_array($value)
                ? array_values(array_filter($value, static fn (mixed $v): bool => is_array($v)))
                : [];
        };

        return new self(
            title: is_string($data['title'] ?? null) ? $data['title'] : '',
            lines: $strings($data['lines'] ?? []),
            notes: $strings($data['notes'] ?? []),
            quotes: $objects($data['quotes'] ?? []),
            footer: is_string($data['footer'] ?? null) ? $data['footer'] : '',
            buttons: $objects($data['buttons'] ?? []),
            attachments: $objects($data['attachments'] ?? []),
        );
    }
}
