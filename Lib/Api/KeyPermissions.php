<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Api;

/**
 * What the hub's own Core API key looks like, as a pure specification (Plan/07, Plan/11 Q1, Q10).
 *
 * - `full_permissions` is always '0';
 * - every path is `read`, except the two ModuleLocalSpeechToText resources `/workers` and `/jobs`, which
 *   that module serves to API keys only at level `admin` (its WorkerRequestContext::isAdministrator).
 *   The hub sends GET to them and nothing else; `write` is never granted;
 * - `networkfilterid` is 'localhost': Core's TokenValidationService::checkNetworkFilter then accepts the
 *   key only from 127.0.0.1 / ::1, which is the only place the hub uses it from.
 *
 * HubApiKey (Core glue) writes exactly these fields on create and on every sync/repair and reads them
 * back in verify(), so a hand-edited key (wider level, other network filter) is repaired in place.
 */
final class KeyPermissions
{
    public const string LEVEL_READ = 'read';
    public const string LEVEL_ADMIN = 'admin';
    public const string FULL_PERMISSIONS = '0';
    public const string NETWORK_FILTER = 'localhost';

    /** The only paths that carry `admin` (the module demands it for GET). */
    public const array ADMIN_PATHS = [
        '/api/v3/module-local-speech-to-text/jobs',
        '/api/v3/module-local-speech-to-text/workers',
    ];

    public static function levelFor(string $path): string
    {
        return in_array($path, self::ADMIN_PATHS, true) ? self::LEVEL_ADMIN : self::LEVEL_READ;
    }

    /**
     * @param list<string> $paths
     * @return array<string, string> path => level, sorted by path
     */
    public static function map(array $paths): array
    {
        $map = [];
        foreach ($paths as $path) {
            $map[$path] = self::levelFor($path);
        }
        ksort($map, SORT_STRING);

        return $map;
    }

    /** Value of ApiKeys::$allowed_paths for the path set. @param list<string> $paths */
    public static function allowedPathsJson(array $paths): string
    {
        return json_encode(self::map($paths), JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /** Canonical (sorted) form of a stored allowed_paths object; garbled or non-object input becomes '{}'. */
    public static function normalizeAllowedPaths(string $json): string
    {
        $decoded = json_decode($json, true);
        $map = [];
        if (is_array($decoded)) {
            foreach ($decoded as $path => $level) {
                if (is_string($path) && $path !== '' && is_string($level)) {
                    $map[$path] = $level;
                }
            }
        }
        ksort($map, SORT_STRING);

        return json_encode($map === [] ? new \stdClass() : $map, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /**
     * The fields the hub writes into the Core record.
     *
     * @param list<string> $paths
     * @return array{networkfilterid: string, full_permissions: string, allowed_paths: string}
     */
    public static function recordFields(array $paths): array
    {
        return [
            'networkfilterid' => self::NETWORK_FILTER,
            'full_permissions' => self::FULL_PERMISSIONS,
            'allowed_paths' => self::allowedPathsJson($paths),
        ];
    }

    /** @param list<string> $paths */
    public static function pathsMatch(string $allowedPaths, array $paths): bool
    {
        return self::normalizeAllowedPaths($allowedPaths) === self::normalizeAllowedPaths(self::allowedPathsJson($paths))
            && $paths !== [];
    }

    public static function networkMatches(?string $networkFilterId): bool
    {
        return (string)$networkFilterId === self::NETWORK_FILTER;
    }
}
