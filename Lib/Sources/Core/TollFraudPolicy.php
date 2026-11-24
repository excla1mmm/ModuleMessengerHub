<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;

/**
 * Admin rules of `core.toll_fraud` (Plan/02-sources.md, section 4s-A).
 *
 * Pure value object: the source reads it through an injected provider, unit checks build it directly.
 *
 * Dialled-prefix matching is done on the normalised number (spaces, dashes, brackets and dots removed,
 * a leading "+" kept):
 *  - "dangerous destination": the number starts with one of the international access prefixes
 *    (default 810 = the Russian 8-10 international prefix, 00 = the European one, "+" = full
 *    international format) and not with one of the home-country forms (default +7 / 8107 / 007 for
 *    the Russian Federation, the module's primary locale);
 *  - "off-hours": the call started inside the configured night window (the window may cross midnight).
 */
final class TollFraudPolicy
{
    /**
     * @param list<string> $dangerPrefixes
     * @param list<string> $homePrefixes
     */
    public function __construct(
        public readonly array $dangerPrefixes,
        public readonly array $homePrefixes,
        public readonly int $burstCalls,
        public readonly int $burstWindowMin,
        public readonly bool $offHoursEnabled,
        public readonly string $offHoursFrom,
        public readonly string $offHoursTo,
    ) {
    }

    public static function defaults(): self
    {
        return self::fromHubSettingsValues([
            HubSettings::TOLL_FRAUD_PREFIXES => (string)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_PREFIXES],
            HubSettings::TOLL_FRAUD_HOME_PREFIXES => (string)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_HOME_PREFIXES],
            HubSettings::TOLL_FRAUD_BURST_CALLS => (string)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_BURST_CALLS],
            HubSettings::TOLL_FRAUD_BURST_WINDOW_MIN => (string)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_BURST_WINDOW_MIN],
            HubSettings::TOLL_FRAUD_OFFHOURS_ENABLED => (string)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_OFFHOURS_ENABLED],
            HubSettings::TOLL_FRAUD_OFFHOURS_FROM => (string)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_OFFHOURS_FROM],
            HubSettings::TOLL_FRAUD_OFFHOURS_TO => (string)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_OFFHOURS_TO],
        ]);
    }

    public static function fromHubSettings(HubSettings $settings): self
    {
        return new self(
            HubSettings::prefixList((string)$settings->get(HubSettings::TOLL_FRAUD_PREFIXES)),
            HubSettings::prefixList((string)$settings->get(HubSettings::TOLL_FRAUD_HOME_PREFIXES)),
            $settings->tollFraudBurstCalls(),
            $settings->tollFraudBurstWindowMin(),
            $settings->tollFraudOffHoursEnabled(),
            $settings->tollFraudOffHoursFrom(),
            $settings->tollFraudOffHoursTo(),
        );
    }

    /**
     * Same as fromHubSettings() but over raw stored values: keeps the class testable without a database.
     *
     * @param array<string, string> $values key => stored value (missing keys fall back to defaults)
     */
    public static function fromHubSettingsValues(array $values): self
    {
        $value = static fn (string $key): string => $values[$key] ?? (string)(HubSettings::DEFAULTS[$key] ?? '');
        $int = static function (string $key, int $min, int $max) use ($value): int {
            $raw = $value($key);

            return preg_match('/^\d+$/', $raw) === 1
                ? max($min, min($max, (int)$raw))
                : (int)HubSettings::DEFAULTS[$key];
        };
        $time = static function (string $key) use ($value): string {
            $raw = $value($key);

            return preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $raw) === 1 ? $raw : (string)HubSettings::DEFAULTS[$key];
        };

        return new self(
            HubSettings::prefixList($value(HubSettings::TOLL_FRAUD_PREFIXES)),
            HubSettings::prefixList($value(HubSettings::TOLL_FRAUD_HOME_PREFIXES)),
            $int(HubSettings::TOLL_FRAUD_BURST_CALLS, HubSettings::BURST_CALLS_MIN, HubSettings::BURST_CALLS_MAX),
            $int(HubSettings::TOLL_FRAUD_BURST_WINDOW_MIN, HubSettings::WINDOW_MIN_MIN, HubSettings::WINDOW_MIN_MAX),
            $value(HubSettings::TOLL_FRAUD_OFFHOURS_ENABLED) === '1',
            $time(HubSettings::TOLL_FRAUD_OFFHOURS_FROM),
            $time(HubSettings::TOLL_FRAUD_OFFHOURS_TO),
        );
    }

    /** Removes formatting characters: "+7 (900) 123-45-67" -> "+79001234567". */
    public static function normalizeDialed(string $dialed): string
    {
        $trimmed = trim($dialed);
        $plus = str_starts_with($trimmed, '+') ? '+' : '';
        $digits = (string)preg_replace('/\D+/', '', $trimmed);

        return $digits === '' ? '' : $plus . $digits;
    }

    public function isDangerous(string $dialed): bool
    {
        if ($this->dangerPrefixes === []) {
            return false; // the rule is switched off by an empty list
        }
        $number = self::normalizeDialed($dialed);
        if ($number === '') {
            return false;
        }
        foreach ($this->homePrefixes as $prefix) {
            if (str_starts_with($number, $prefix)) {
                return false;
            }
        }
        foreach ($this->dangerPrefixes as $prefix) {
            if (str_starts_with($number, $prefix)) {
                return true;
            }
        }

        return false;
    }

    /** True when the call start falls into the configured night window (handles a window across midnight). */
    public function isOffHours(int $timestamp): bool
    {
        if (!$this->offHoursEnabled || $timestamp <= 0) {
            return false;
        }
        $at = date('H:i', $timestamp);
        if ($this->offHoursFrom === $this->offHoursTo) {
            return false; // an empty window, not "all day"
        }
        if ($this->offHoursFrom < $this->offHoursTo) {
            return $at >= $this->offHoursFrom && $at < $this->offHoursTo;
        }

        return $at >= $this->offHoursFrom || $at < $this->offHoursTo;
    }

    public function burstWindowSec(): int
    {
        return $this->burstWindowMin * 60;
    }
}
