<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing;

/**
 * Pattern matching for rule.event_types: exact types, "prefix.*" and "*" (Plan/05).
 */
final class EventTypeMatcher
{
    /** @param list<string> $patterns */
    public static function matches(array $patterns, string $eventType): bool
    {
        foreach ($patterns as $pattern) {
            if ($pattern === $eventType || $pattern === '*') {
                return true;
            }
            if (str_ends_with($pattern, '.*')) {
                $prefix = substr($pattern, 0, -1); // keeps the dot: "core." matches core.missed_call
                if (str_starts_with($eventType, $prefix)) {
                    return true;
                }
            }
        }

        return false;
    }
}
