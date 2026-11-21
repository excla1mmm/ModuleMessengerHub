<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/**
 * Result of one external process (converter, probe). `stdout` is used only by the duration probe;
 * `stderrTail` is for classification only: neither is ever written to a log and neither becomes an
 * error code, because tool output may quote a file path.
 */
final class ProcessResult
{
    public function __construct(
        public readonly int $exitCode,
        public readonly bool $timedOut,
        public readonly string $stderrTail = '',
        public readonly string $stdout = '',
    ) {
    }

    public function ok(): bool
    {
        return !$this->timedOut && $this->exitCode === 0;
    }
}
