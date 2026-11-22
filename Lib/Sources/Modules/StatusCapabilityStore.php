<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

/**
 * Persists the per-source `/status` capability between the collector worker, the key reconciler
 * and restarts (stage 3b, issue #1, item 6). Missing state reads as StatusCapability::unknown().
 */
interface StatusCapabilityStore
{
    public function get(string $sourceId): StatusCapability;

    public function remember(string $sourceId, StatusCapability $capability): void;
}
