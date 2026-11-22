<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

use InvalidArgumentException;

/**
 * Configuration of one ModuleStatusSource (stage 3b, issue #1): which module, its `/status` path,
 * which codes become which event types, severities, recovery events and debounce.
 *
 * A module that gets `/status` later is one entry in ModuleStatusSource::PROFILES — no new adapter.
 */
final class ModuleStatusProfile
{
    /**
     * @param list<ModuleStatusRule> $rules
     * @param string|null $fallbackSlug module slug whose `/workers` reader is used when /status is absent
     */
    public function __construct(
        public readonly string $moduleId,
        public readonly string $slug,
        public readonly string $sourceId,
        public readonly string $minVersion,
        public readonly array $rules,
        public readonly ?string $fallbackSlug = null,
        public readonly int $capabilityRecheckSec = 21600,
    ) {
        if ($this->moduleId === '' || $this->slug === '' || $this->sourceId === '' || $this->rules === []) {
            throw new InvalidArgumentException('module status profile is incomplete');
        }
    }

    public function statusApiPath(): string
    {
        return '/api/v3/' . $this->slug . '/status';
    }

    public function statusPath(): string
    {
        return '/pbxcore' . $this->statusApiPath();
    }

    public function fallbackApiPath(): ?string
    {
        return $this->fallbackSlug === null ? null : '/api/v3/' . $this->fallbackSlug . '/workers';
    }

    public function fallbackPath(): ?string
    {
        $path = $this->fallbackApiPath();

        return $path === null ? null : '/pbxcore' . $path;
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
