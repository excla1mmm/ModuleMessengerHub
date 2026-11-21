<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/**
 * Where a recording was found: a readable local file, or a normalised code plus whether another try
 * can help (a temporary CDR/network failure versus a missing recording).
 */
final class LocateResult
{
    public function __construct(
        public readonly string $path = '',
        public readonly int $bytes = 0,
        public readonly string $code = '',
        public readonly bool $retryable = false,
    ) {
    }

    public function ok(): bool
    {
        return $this->path !== '' && $this->bytes > 0;
    }
}
