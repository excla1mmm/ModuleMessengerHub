<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

/**
 * Normalised result of one HTTP call. Never carries the URL, request headers or the request body:
 * Telegram puts the bot token into the URL and personal data into the body (Plan/07).
 *
 * `retryAfterSec` is the only response header the hub keeps (Retry-After on 429): it is a number,
 * never anything that could carry data back to the caller.
 */
final class HttpResponse
{
    public function __construct(
        public readonly int $status,
        public readonly string $body,
        public readonly string $errorCode = '',
        public readonly int $retryAfterSec = 0,
    ) {
    }

    public function failed(): bool
    {
        return $this->errorCode !== '';
    }

    /** True when the body is a JSON object (a 200 with a broken body is not a success proof). */
    public function isJson(): bool
    {
        $decoded = json_decode($this->body, true);

        return is_array($decoded) && json_last_error() === JSON_ERROR_NONE;
    }

    /** @return array<string, mixed> */
    public function json(): array
    {
        $decoded = json_decode($this->body, true);

        return is_array($decoded) ? $decoded : [];
    }
}
