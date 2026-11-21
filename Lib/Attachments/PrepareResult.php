<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/**
 * Outcome of a preparation attempt.
 *
 * `files` is indexed like the plan's parts; an entry is either a ready file or `skip_code` (that part
 * exceeds the channel limit). `busy` means another worker holds the cache lease: the row must be
 * postponed, not failed. `retry` is a temporary source/CDR/network failure.
 */
final class PrepareResult
{
    public const string READY = 'ready';
    public const string BUSY = 'busy';
    public const string FAILED = 'failed';
    public const string RETRY = 'retry';

    /** @param list<array<string, mixed>> $files */
    public function __construct(
        public readonly string $state,
        public readonly array $files = [],
        public readonly string $code = '',
    ) {
    }

    public static function ready(array $files): self
    {
        return new self(self::READY, $files);
    }

    public static function busy(): self
    {
        return new self(self::BUSY);
    }

    public static function failed(string $code): self
    {
        return new self(self::FAILED, code: $code);
    }

    public static function retry(string $code): self
    {
        return new self(self::RETRY, code: $code);
    }
}
