<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Api;

/**
 * Base URL of the PBX's own REST API: always plain HTTP on 127.0.0.1, on the PBX web port.
 *
 * nginx listens only on `PbxSettings::WEB_PORT` (Core builds its internal client the same way:
 * `http://127.0.0.1:<WEBPort>`), so a hard-coded :80 breaks every REST source and every recording
 * download once the administrator changes the port. 127.0.0.1 (not localhost) keeps IPv4 and matches
 * the loopback binding of the hub key (Plan/07-security-privacy.md).
 *
 * Pure: the Core read lives in Lib/Support/CoreWebPort.
 */
final class LocalRestBase
{
    public const string HOST = '127.0.0.1';
    public const int DEFAULT_PORT = 80;

    /** Base URL for a raw WEBPort value; anything that is not a port number falls back to :80. */
    public static function forPort(int|string|null $raw): string
    {
        return 'http://' . self::HOST . ':' . (self::port($raw) ?? self::DEFAULT_PORT);
    }

    /** 1..65535 from an int or a digits-only string (surrounding whitespace allowed), otherwise null. */
    public static function port(int|string|null $raw): ?int
    {
        if (is_string($raw)) {
            $raw = trim($raw);
            if ($raw === '' || !ctype_digit($raw) || strlen($raw) > 5) {
                return null;
            }
            $raw = (int)$raw;
        }
        if (!is_int($raw) || $raw < 1 || $raw > 65535) {
            return null;
        }

        return $raw;
    }

    /**
     * True only for `http://127.0.0.1:<port>` built by forPort(): the hub key must never go anywhere else.
     */
    public static function isLocal(string $baseUrl): bool
    {
        $prefix = 'http://' . self::HOST . ':';
        if (!str_starts_with($baseUrl, $prefix)) {
            return false;
        }
        $port = substr($baseUrl, strlen($prefix));

        return ctype_digit($port) && self::port($port) !== null && (string)(int)$port === $port;
    }
}
