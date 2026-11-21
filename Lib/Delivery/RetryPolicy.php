<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Delivery;

/**
 * Retry schedule of the outbox (Plan/08-reliability.md): 10 s, 30 s, 2 min, 10 min, 30 min, 2 h,
 * then failed. The channel's retry_after (429) is honoured on top of this schedule by DeliveryService.
 */
final class RetryPolicy
{
    public const array DELAYS = [10, 30, 120, 600, 1800, 7200];

    /**
     * Delay after the given number of performed attempts (1 = the first send just failed).
     * Null means "give up and mark failed".
     */
    public static function delayAfter(int $attempts): ?int
    {
        if ($attempts < 1) {
            return self::DELAYS[0];
        }

        return self::DELAYS[$attempts - 1] ?? null;
    }

    public static function maxAttempts(): int
    {
        return count(self::DELAYS);
    }
}
