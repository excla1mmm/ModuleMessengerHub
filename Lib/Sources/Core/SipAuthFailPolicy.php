<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;

/**
 * Admin thresholds of `core.sip_auth_failures` (Plan/02-sources.md, section 4s-A).
 *
 * Pure value object over the stored settings values so the source stays testable without a database.
 */
final class SipAuthFailPolicy
{
    public function __construct(
        public readonly int $threshold,
        public readonly int $windowMin,
        public readonly int $quietMin,
        public readonly int $extensionsPerPoll,
    ) {
    }

    public static function defaults(): self
    {
        return self::fromValues([]);
    }

    public static function fromHubSettings(HubSettings $settings): self
    {
        return new self(
            $settings->sipAuthFailThreshold(),
            $settings->sipAuthFailWindowMin(),
            $settings->sipAuthFailQuietMin(),
            $settings->sipAuthFailExtensionsPerPoll(),
        );
    }

    /**
     * @param array<string, string> $values HubSettings key => stored value (missing keys use defaults)
     */
    public static function fromValues(array $values): self
    {
        $value = static fn (string $key): string => $values[$key] ?? (string)(HubSettings::DEFAULTS[$key] ?? '');
        $int = static function (string $key, int $min, int $max) use ($value): int {
            $raw = $value($key);

            return preg_match('/^\d+$/', $raw) === 1
                ? max($min, min($max, (int)$raw))
                : (int)HubSettings::DEFAULTS[$key];
        };

        return new self(
            $int(HubSettings::SIP_AUTHFAIL_THRESHOLD, HubSettings::AUTHFAIL_THRESHOLD_MIN, HubSettings::AUTHFAIL_THRESHOLD_MAX),
            $int(HubSettings::SIP_AUTHFAIL_WINDOW_MIN, HubSettings::WINDOW_MIN_MIN, HubSettings::WINDOW_MIN_MAX),
            $int(HubSettings::SIP_AUTHFAIL_QUIET_MIN, HubSettings::AUTHFAIL_QUIET_MIN, HubSettings::WINDOW_MIN_MAX),
            $int(HubSettings::SIP_AUTHFAIL_EXTENSIONS_PER_POLL, HubSettings::AUTHFAIL_EXTENSIONS_MIN, HubSettings::AUTHFAIL_EXTENSIONS_MAX),
        );
    }

    public function windowSec(): int
    {
        return $this->windowMin * 60;
    }

    public function quietSec(): int
    {
        return $this->quietMin * 60;
    }
}
