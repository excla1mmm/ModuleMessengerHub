<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

/**
 * Result of one discovery poll: chats found so far, the next getUpdates offset and an error code
 * ('' when the poll succeeded). Telegram cannot poll while a webhook is set — that is
 * telegram.409.webhook_set and the UI explains how to remove it.
 */
final class DiscoveryBatch
{
    /**
     * @param list<DiscoveredChat> $chats
     */
    public function __construct(
        public readonly array $chats = [],
        public readonly int $nextOffset = 0,
        public readonly string $errorCode = '',
    ) {
    }
}
