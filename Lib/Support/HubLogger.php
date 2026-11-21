<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Support;

use MikoPBX\Core\System\SystemMessages;
use Throwable;

/**
 * Structured syslog lines "ModuleMessengerHub [component] event key=value ...".
 *
 * Callers pass codes and ids only — never tokens, API keys, URLs with secrets, message texts or phone numbers.
 * Values that look like secrets are masked as a last line of defence.
 */
final class HubLogger
{
    private const string IDENT = 'ModuleMessengerHub';

    /** @param array<string, scalar|null> $context */
    public static function event(string $component, string $event, array $context = [], int $level = LOG_NOTICE): void
    {
        $parts = [];
        foreach ($context as $key => $value) {
            $parts[] = $key . '=' . self::sanitize((string)$value);
        }
        $line = '[' . $component . '] ' . $event . ($parts === [] ? '' : ' ' . implode(' ', $parts));
        try {
            SystemMessages::sysLogMsg(self::IDENT, $line, $level);
        } catch (Throwable) {
            // Logging must never break a worker or a Core hook.
        }
    }

    public static function sanitize(string $value): string
    {
        // Telegram bot tokens: 123456789:AA... ; long opaque keys: 32+ base64/hex-like chars.
        $value = (string)preg_replace('/\d{6,}:[A-Za-z0-9_-]{20,}/', '***', $value);
        $value = (string)preg_replace('/[A-Za-z0-9_\-+\/=]{32,}/', '***', $value);
        $value = str_replace(["\r", "\n"], ' ', $value);

        return mb_substr($value, 0, 200);
    }
}
