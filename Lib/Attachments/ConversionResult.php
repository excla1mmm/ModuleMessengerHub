<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/**
 * Result of one conversion attempt: a ready MP3 path or a normalised code (never a path or tool text).
 */
final class ConversionResult
{
    public function __construct(
        public readonly string $path = '',
        public readonly string $code = '',
        public readonly bool $timedOut = false,
        public readonly int $durationMs = 0,
    ) {
    }

    public function ok(): bool
    {
        return $this->path !== '';
    }
}
