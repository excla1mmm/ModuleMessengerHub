<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

use RuntimeException;

/**
 * Source failure with a stable machine code (stored in SourceState.last_error_code).
 * Messages must never contain secrets or personal data.
 */
final class SourceException extends RuntimeException
{
    public function __construct(public readonly string $errorCode, string $message = '')
    {
        parent::__construct($message !== '' ? $message : $errorCode);
    }
}
