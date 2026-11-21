<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Support;

/**
 * Boot time of the PBX from /proc/uptime (unix seconds). Returns 0 when unknown.
 */
final class BootTime
{
    public static function detect(): int
    {
        $uptime = @file_get_contents('/proc/uptime');
        if ($uptime === false) {
            return 0;
        }
        $seconds = (float)strtok($uptime, ' ');

        return $seconds > 0 ? time() - (int)$seconds : 0;
    }
}
