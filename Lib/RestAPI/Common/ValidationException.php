<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Common;

/**
 * Request data failed validation (HTTP 422).
 *
 * The message is a stable code-like string (shown to the admin); $field names the offending
 * request field so the UI can mark it without parsing the message.
 */
final class ValidationException extends \RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $field = '',
    ) {
        parent::__construct($message);
    }
}
