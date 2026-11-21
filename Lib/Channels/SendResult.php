<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

/**
 * Outcome of a channel call (Plan/03-channels.md). The queue understands exactly these four
 * outcomes; the adapter classifies every API error into one of them.
 *
 * `code` is a normalised machine code (`telegram.429.rate_limit`), never an API text that could
 * carry a token or personal data.
 */
final class SendResult
{
    public const string SENT = 'sent';
    public const string RETRY = 'retry';
    public const string PERMANENT = 'permanent';
    public const string RECIPIENT_GONE = 'recipient_gone';
    public const int MAX_RETRY_AFTER_SEC = 3600;

    /**
     * @param list<string> $ids external message ids (text and attachments)
     * @param bool $uncertain the request may have reached the messenger but the answer was lost
     * @param string|null $migratedChatId new chat id reported by the API (group -> supergroup)
     */
    private function __construct(
        public readonly string $outcome,
        public readonly array $ids = [],
        public readonly int $retryAfterSec = 0,
        public readonly string $code = '',
        public readonly bool $uncertain = false,
        public readonly ?string $migratedChatId = null,
    ) {
    }

    /** @param list<string> $ids */
    public static function sent(array $ids = []): self
    {
        return new self(self::SENT, ids: $ids);
    }

    /**
     * A requested pause is clamped to one hour: `retry_after` / `Retry-After` come from the messenger
     * (or from whatever sits between), and an absurd value must not park a row for days.
     */
    public static function retry(int $afterSec, string $code, bool $uncertain = false, ?string $migratedChatId = null): self
    {
        return new self(
            self::RETRY,
            retryAfterSec: max(0, min(self::MAX_RETRY_AFTER_SEC, $afterSec)),
            code: $code,
            uncertain: $uncertain,
            migratedChatId: $migratedChatId,
        );
    }

    public static function permanent(string $code): self
    {
        return new self(self::PERMANENT, code: $code);
    }

    public static function recipientGone(string $code): self
    {
        return new self(self::RECIPIENT_GONE, code: $code);
    }
}
