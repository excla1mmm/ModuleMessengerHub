<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

/**
 * A destination chat of a bot. Only what a send needs; the row id lives in Outbox.
 */
final class Recipient
{
    public function __construct(
        public readonly string $chatId,
        public readonly string $kind = 'group',
        public readonly string $title = '',
    ) {
    }
}
