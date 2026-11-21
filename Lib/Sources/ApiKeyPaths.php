<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

/**
 * Core REST paths the hub API key must contain (Plan/01, decision Q1).
 *
 * A source contributes its paths only when it is enabled AND its module is available: the key must
 * not hold read access to a module that is turned off or not installed (stage 1.4 decision — the key
 * follows availability, not just the enabled flag).
 */
final class ApiKeyPaths
{
    /**
     * @param list<SourceInterface> $sources
     * @param callable(string): bool $isEnabled
     * @param callable(string): string $moduleStatus module unique id → SourceAvailability::*
     * @return list<string> sorted, unique Core paths without the /pbxcore prefix
     */
    public static function compute(
        array $sources,
        callable $isEnabled,
        callable $moduleStatus
    ): array {
        $paths = [];
        foreach ($sources as $source) {
            if (!$isEnabled($source->id())) {
                continue;
            }
            $module = $source->requiredModule();
            if ($module !== null && $moduleStatus($module) !== SourceAvailability::AVAILABLE) {
                continue;
            }
            foreach ($source->apiReadPaths() as $path) {
                $paths[$path] = true;
            }
        }
        $paths = array_keys($paths);
        sort($paths, SORT_STRING);

        return $paths;
    }
}
