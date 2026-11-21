<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;

final class SourceBatch
{
    /**
     * @param list<HubEvent> $events
     * @param array<string, mixed> $cursor
     */
    public function __construct(
        public readonly array $events,
        public readonly array $cursor,
    ) {
    }

    /** @param array<string, mixed> $cursor */
    public static function baseline(array $cursor): self
    {
        return new self([], $cursor);
    }
}
