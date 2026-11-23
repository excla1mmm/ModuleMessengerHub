<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Api;

/**
 * Core-free diagnosis of the hub's own API key (Plan/11 Q14, decision 1).
 *
 * When a poll of a path the key is supposed to read is rejected (401/403), the collector must
 * distinguish "our key is broken" from "the source module refuses the hub key". Only a healthy
 * key may leave the source in api_forbidden ("Модуль не даёт доступа к данным").
 *
 * The diagnosis never needs the secret itself: the caller compares the stored plain key with the
 * bcrypt hash of the Core record, so a lost or rotated secret is detected locally.
 */
final class KeyHealth
{
    /** The record is ours, the stored secret authenticates and allowed_paths are exactly as wanted. */
    public const string HEALTHY = 'healthy';
    /** No record at the stored id (deleted by hand, lost settings) or a foreign record sits there. */
    public const string MISSING = 'missing';
    /** The record is ours but the stored plain key no longer matches its hash. */
    public const string SECRET_INVALID = 'secret_invalid';
    /** The record and secret are fine, but its allowed_paths (paths or levels) differ from the wanted set. */
    public const string PATHS_STALE = 'paths_stale';
    /** The record, secret and paths are fine, but the key is not bound to localhost. */
    public const string NETWORK_STALE = 'network_stale';

    /**
     * @param bool $recordIsOurs the Core record exists and carries the hub description
     * @param bool $secretMatches password_verify(stored plain key, record hash)
     * @param bool $pathsMatch allowed_paths of the record (paths and levels) equal the wanted set
     * @param bool $networkMatches the record's networkfilterid is 'localhost'
     */
    public static function diagnose(
        bool $recordIsOurs,
        bool $secretMatches,
        bool $pathsMatch,
        bool $networkMatches = true
    ): string
    {
        if (!$recordIsOurs) {
            return self::MISSING;
        }
        if (!$secretMatches) {
            return self::SECRET_INVALID;
        }

        if (!$pathsMatch) {
            return self::PATHS_STALE;
        }

        return $networkMatches ? self::HEALTHY : self::NETWORK_STALE;
    }

    /** Drift that is repaired in place: same record id and secret (Q15). */
    public static function isInPlaceRepair(string $health): bool
    {
        return $health === self::PATHS_STALE || $health === self::NETWORK_STALE;
    }

    /** True when the key needs a repair (anything except HEALTHY). */
    public static function needsRepair(string $health): bool
    {
        return $health !== self::HEALTHY;
    }
}
