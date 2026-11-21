<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Api;

/**
 * Core-free decision behind HubApiKey::sync (Q15): when the wanted path set changes, the existing
 * Core record keeps its id and secret — only allowed_paths is rewritten, so polls already running
 * with the old secret stay authorised. A new key is generated only when there is nothing usable:
 * no record at the stored id, a lost secret, or a foreign record that must not be touched.
 */
final class KeySyncPlan
{
    public const string KEEP = 'keep';
    public const string UPDATE_PATHS = 'update_paths';
    public const string CREATE = 'create';

    /** Canonical stored form of a path list (sorted, deduplicated, unescaped slashes). */
    public static function pathsJson(array $paths): string
    {
        sort($paths, SORT_STRING);
        $paths = array_values(array_unique($paths));

        return json_encode($paths, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /**
     * Canonical form of a Core allowed_paths JSON object ({"path": "read"}), comparable with
     * KeySyncPlan::pathsJson. Garbled or empty values become "[]".
     */
    public static function normalizePathsJson(string $json): string
    {
        $decoded = json_decode($json, true);
        $paths = is_array($decoded) ? array_keys($decoded) : [];
        $paths = array_values(array_filter($paths, static fn (mixed $p): bool => is_string($p) && $p !== ''));

        return self::pathsJson($paths);
    }

    /**
     * @param string $plain stored plain key ('' when unknown)
     * @param int $id stored Core record id (0 when unknown)
     * @param string $storedPaths canonical JSON of the paths recorded in the module settings
     * @param string $wantedPaths canonical JSON of the paths the enabled sources need now
     * @param bool $recordIsOurs the Core record exists and carries the hub description
     */
    public static function decide(
        string $plain,
        int $id,
        string $storedPaths,
        string $wantedPaths,
        bool $recordIsOurs
    ): string {
        if (!$recordIsOurs || $plain === '' || $id <= 0) {
            return self::CREATE;
        }

        return $storedPaths === $wantedPaths ? self::KEEP : self::UPDATE_PATHS;
    }
}
