<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/**
 * Rule option `options.attachments` (Plan/05, decision 3a-1).
 *
 * `none` is the default for new and existing rules. The stage-2 boolean `true` is deliberately NOT an
 * enum value: an upgrade must never start sending recordings by itself. Unknown values fail closed.
 */
final class AttachmentMode
{
    public const string NONE = 'none';
    public const string FRAGMENTS = 'fragments';
    public const string RECORDING = 'recording';

    /** @param array<string, mixed> $options rule options_json */
    public static function fromOptions(array $options): string
    {
        $value = $options['attachments'] ?? null;
        if (!is_string($value)) {
            // legacy `attachments: true` from the stage-2 options schema is not an explicit mode
            return self::NONE;
        }

        return match ($value) {
            self::FRAGMENTS => self::FRAGMENTS,
            self::RECORDING => self::RECORDING,
            default => self::NONE,
        };
    }

    /** Event types that can carry audio at all (the wizard shows the option only for them). */
    public static function isAudioEvent(string $eventType): bool
    {
        return in_array($eventType, ['core.voicemail', 'ai_supervisor.attention_call'], true);
    }

    public static function enabled(string $mode): bool
    {
        return $mode === self::FRAGMENTS || $mode === self::RECORDING;
    }
}
