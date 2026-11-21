<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

use Modules\ModuleMessengerHub\Lib\Channels\ChannelLimits;

/**
 * Audio preparation as a port, so DeliveryService stays testable with a fake pipeline.
 */
interface AttachmentPipeline
{
    public function preflight(AttachmentPlan $plan): PreflightResult;

    /**
     * @param callable(int): mixed $heartbeat called while downloading/converting; false = the lease is lost
     */
    public function prepare(
        int $eventId,
        AttachmentPlan $plan,
        ChannelLimits $limits,
        string $owner,
        int $now,
        callable $heartbeat,
    ): PrepareResult;

    public function cleanupEvent(int $eventId, int $now): void;

    /** Releases every cache row/file of an event (a preparation exception must not hold `preparing`). */
    public function releaseEvent(int $eventId): void;

    /** @return array{stale: int, expired: int, files: int} */
    public function janitor(int $now): array;
}
