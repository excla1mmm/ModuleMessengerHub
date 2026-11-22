<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

/**
 * Process-local capability store. Used by unit checks and as the neutral default when no
 * persistent store is supplied (the collector worker passes SettingsStatusCapabilityStore).
 */
final class InMemoryStatusCapabilityStore implements StatusCapabilityStore
{
    /** @var array<string, StatusCapability> */
    private array $values = [];

    public function get(string $sourceId): StatusCapability
    {
        return $this->values[$sourceId] ?? StatusCapability::unknown();
    }

    public function remember(string $sourceId, StatusCapability $capability): void
    {
        $this->values[$sourceId] = $capability;
    }
}
