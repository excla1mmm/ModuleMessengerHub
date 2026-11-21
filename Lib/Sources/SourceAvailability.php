<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

/**
 * Availability values shown on the "Sources" page and in GET /sources.
 */
final class SourceAvailability
{
    public const string AVAILABLE = 'available';
    public const string DISABLED = 'disabled';
    public const string MODULE_MISSING = 'module_missing';
    public const string MODULE_DISABLED = 'module_disabled';
    public const string API_FORBIDDEN = 'api_forbidden';
    public const string ERROR = 'error';

    /** Maps a SourceException code to an availability value. */
    public static function fromErrorCode(string $code): string
    {
        return match ($code) {
            'api_unauthorized', 'api_forbidden', 'api_key_missing' => self::API_FORBIDDEN,
            'api_not_found' => self::MODULE_MISSING,
            default => self::ERROR,
        };
    }
}
