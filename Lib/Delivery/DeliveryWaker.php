<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Delivery;

/**
 * Wakes WorkerMessengerHubDelivery when new outbox rows appear. The collector, the AMI worker and the
 * REST layer only poke the hub's own tube; a failed wake never breaks them (the worker also polls).
 */
interface DeliveryWaker
{
    public function wake(): void;
}
