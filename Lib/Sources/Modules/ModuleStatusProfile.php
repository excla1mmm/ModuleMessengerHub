<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

use InvalidArgumentException;

/**
 * Configuration of one ModuleStatusSource (stage 3b, issue #1): which module, how its state is read
 * (the reader kind and the REST paths the hub key must hold), which codes become which event types,
 * severities, recovery events and debounce.
 *
 * Only ModuleCloudSpeechToText serves `/status` (reader `status`); the other modules are read through
 * their existing resources (decision of 2026-11-23): one entry per kind of problem, no new adapter class.
 */
final class ModuleStatusProfile
{
    /**
     * @param list<ModuleStatusRule> $rules
     * @param list<string> $readPaths REST paths without /pbxcore the hub key must hold for this source
     */
    public function __construct(
        public readonly string $moduleId,
        public readonly string $reader,
        public readonly string $sourceId,
        public readonly string $minVersion,
        public readonly array $rules,
        public readonly array $readPaths,
    ) {
        if ($this->moduleId === '' || $this->reader === '' || $this->sourceId === '' || $this->rules === []
            || $this->readPaths === []) {
            throw new InvalidArgumentException('module status profile is incomplete');
        }
    }

    /** `/pbxcore` path of the first (for the `status` reader the only) read path. */
    public function primaryPath(): string
    {
        return '/pbxcore' . $this->readPaths[0];
    }

    public function rule(string $code): ?ModuleStatusRule
    {
        foreach ($this->rules as $rule) {
            if ($rule->code === $code) {
                return $rule;
            }
        }

        return null;
    }

    /** @return list<string> */
    public function eventTypes(): array
    {
        $types = [];
        foreach ($this->rules as $rule) {
            $types[$rule->eventType] = true;
            if ($rule->recoveryEventType !== null) {
                $types[$rule->recoveryEventType] = true;
            }
        }

        return array_keys($types);
    }
}
