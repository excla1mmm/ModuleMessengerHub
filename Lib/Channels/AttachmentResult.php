<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

/**
 * Result of one attachment send. `notReady` is MAX's `attachment.not.ready`: the same upload token
 * must be retried after a growing pause (Plan/03, decision 3a-1).
 */
final class AttachmentResult
{
    public function __construct(
        public readonly SendResult $result,
        public readonly bool $notReady = false,
        public readonly string $pendingToken = '',
    ) {
    }

    public static function of(SendResult $result, bool $notReady = false, string $pendingToken = ''): self
    {
        return new self($result, $notReady, $pendingToken);
    }
}
