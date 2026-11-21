<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Api;

use Modules\ModuleMessengerHub\Lib\Support\HubLogger;
use Throwable;

/**
 * Uninstall-time deletion of the hub's own Core API key record (Plan/11, Q15).
 *
 * Kept Core-free so a check can drive it with a throwing remover: an uninstall must never fail
 * (or leave the module half-removed) because of the key, so every failure is reduced to a logged code.
 */
final class UninstallCleanup
{
    /** @param callable(): void $remove deletes the key record (HubApiKey::remove) */
    public static function removeApiKey(callable $remove): bool
    {
        try {
            $remove();
            HubLogger::event('api_key', 'removed_on_uninstall');

            return true;
        } catch (Throwable $exception) {
            HubLogger::event('api_key', 'remove_on_uninstall_failed', ['error' => $exception::class], LOG_WARNING);

            return false;
        }
    }
}
