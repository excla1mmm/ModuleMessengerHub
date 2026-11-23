<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

/**
 * Reasons of a Cloud AI Supervisor pause (`/status` issue `processing_paused`, `ref`) and their
 * groups in the wizard (stage 3b-4, issue #1). `not_configured` is not listed: it never produces events.
 *
 * A rule keeps the wanted reasons in `filters.reasons`; the Router compares them with
 * `subject.module_status.ref` of `cloud_ai.paused` and `cloud_ai.resumed`.
 */
final class CloudAiPauseReasons
{
    public const string MONEY = 'money';
    public const string LICENSE = 'license';
    public const string LIMITS = 'limits';
    public const string SOURCE = 'source';
    public const string MANUAL = 'manual';

    /** group => reasons, in the order of the wizard */
    public const array GROUPS = [
        self::MONEY => ['insufficient_funds', 'low_balance'],
        self::LICENSE => ['license_missing', 'auth_invalid'],
        self::LIMITS => ['daily_limit_reached', 'model_unavailable'],
        self::SOURCE => ['source_unavailable'],
        self::MANUAL => ['manual'],
    ];

    /** @return list<string> */
    public static function all(): array
    {
        return array_merge(...array_values(self::GROUPS));
    }

    /** New rules: everything except a manual pause. @return list<string> */
    public static function defaults(): array
    {
        return array_values(array_diff(self::all(), self::GROUPS[self::MANUAL]));
    }

    public static function isKnown(string $reason): bool
    {
        return in_array($reason, self::all(), true);
    }
}
