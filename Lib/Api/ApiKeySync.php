<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Api;

/**
 * Keeps the hub's Core API key in step with the enabled sources (HubApiKey implements this).
 *
 * The settings PATCH calls it to apply a path change immediately (Q15); the collector worker
 * reconciles the key on its own slower schedule.
 */
interface ApiKeySync
{
    /**
     * Ensures exactly $paths are readable. Returns the plain key ('' when no paths are needed).
     *
     * @param list<string> $paths Core REST paths without the /pbxcore prefix, e.g. "/api/v3/advice"
     */
    public function sync(array $paths): string;
}
