<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

/**
 * Channel limits used by RateLimiter and by markup rendering (Plan/03-channels.md).
 */
final class ChannelLimits
{
    public function __construct(
        public readonly int $maxTextLength,
        public readonly int $maxCaptionLength,
        public readonly int $perChatSec,
        public readonly int $perGroupPerMinute,
        public readonly int $perBotPerSec,
        public readonly int $maxFileBytes,
        /**
         * True when perBotPerSec is a limit of the whole platform, shared by every bot of the station
         * (MAX: 30 rps per platform-api2.max.ru), not a per-bot allowance.
         */
        public readonly bool $perBotSharedHost = false,
        /**
         * Maximum audio duration in seconds (MAX: 60 min). 0 = the channel does not document a limit.
         */
        public readonly int $maxFileDurationSec = 0,
    ) {
    }

    /** Telegram Bot API: 4096 text, 1024 caption, ~1/s per chat, ~20/min per group, ~30/s per bot, 50 MB upload. */
    public static function telegram(): self
    {
        return new self(
            maxTextLength: 4096,
            maxCaptionLength: 1024,
            perChatSec: 1,
            perGroupPerMinute: 20,
            perBotPerSec: 30,
            maxFileBytes: 50 * 1024 * 1024,
        );
    }

    /**
     * MAX Bot API (Plan/03-channels.md, checked 21.11.2026): text 4000, ≤2 messages (and deletes) per
     * second in one chat, ≤30 rps for the whole platform-api2.max.ru, audio upload 256 MB.
     *
     * MAX has no separate caption: the text travels with the attachments, so the caption limit equals
     * the text limit. RateLimiter counts whole seconds, so 2/s is declared as 1/s — a subset of the
     * documented rate — and the per-group-per-minute ceiling never binds (2/s = 120/min).
     */
    public static function max(): self
    {
        return new self(
            maxTextLength: 4000,
            maxCaptionLength: 4000,
            perChatSec: 1,
            perGroupPerMinute: 120,
            perBotPerSec: 30,
            maxFileBytes: 256 * 1024 * 1024,
            perBotSharedHost: true,
            maxFileDurationSec: 3600,
        );
    }
}
