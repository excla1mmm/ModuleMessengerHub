<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

/**
 * Cursor of a discovery session (Plan/03-channels.md: five minutes of getUpdates).
 */
final class DiscoveryCursor
{
    public function __construct(
        public readonly int $offset = 0,
        public readonly int $longPollSec = 0,
    ) {
    }
}
