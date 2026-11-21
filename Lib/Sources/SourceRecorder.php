<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;

/**
 * Entry point for push sources (AMI events, Core hooks): records an event only if the source is enabled.
 *
 * Must stay cheap — it runs inside Core hooks (Plan/01-architecture.md): one SELECT + one INSERT, no network.
 */
final class SourceRecorder
{
    public function __construct(
        private readonly SourceStateRepository $states,
        private readonly EventStore $events,
    ) {
    }

    /** Returns true when a new event was stored. */
    public function record(HubEvent $event, int $now): bool
    {
        if (!$this->states->isEnabled($event->sourceId)) {
            return false;
        }
        $stored = $this->events->record($event, $now);
        $this->states->markPushOk($event->sourceId, $now);

        return $stored;
    }
}
