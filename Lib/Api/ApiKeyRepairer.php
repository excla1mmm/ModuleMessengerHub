<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Api;

/**
 * What the collector needs from the hub key to heal it without user action (Plan/11 Q14).
 *
 * Kept as an interface so the Collector stays Core-free in unit checks: production wires the
 * Core-backed HubApiKey, tests pass a spy.
 */
interface ApiKeyRepairer
{
    /**
     * Diagnose the current key against the wanted path set.
     *
     * @param list<string> $paths Core REST paths without the /pbxcore prefix
     * @return string KeyHealth::*
     */
    public function verify(array $paths): string;

    /**
     * Bring the key to the wanted state: rewrite allowed_paths in place, or recreate the record when
     * it is gone or the secret no longer authenticates. Never returns or logs the secret.
     *
     * @param list<string> $paths
     */
    public function repair(array $paths): void;

    /**
     * The plain key in use now (after a repair it may be a newly generated one). The collector swaps
     * its REST client with it so the retried poll runs with the fresh secret.
     */
    public function plainKey(): string;
}
