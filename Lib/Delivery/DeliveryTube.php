<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Delivery;

/**
 * The hub's own beanstalk tube for delivery wake-ups. Never Core tubes: they are work queues and
 * consuming them would steal jobs (AGENTS.md rule 8).
 *
 * The name matches the worker class name Core uses to name the process, so the same tube is
 * obvious in beanstalkd listings.
 */
final class DeliveryTube
{
    public const string NAME = 'Modules\ModuleMessengerHub\bin\WorkerMessengerHubDelivery';
}
