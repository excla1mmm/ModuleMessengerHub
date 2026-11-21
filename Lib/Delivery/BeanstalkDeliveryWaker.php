<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Delivery;

use MikoPBX\Core\System\BeanstalkClient;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;
use Throwable;

/**
 * Pokes the delivery worker through the hub's own tube — Core glue, never used by unit checks.
 *
 * A missing beanstalkd must not break the collector or a REST request: the worker also polls every
 * few seconds, so a failed wake only delays a delivery.
 */
final class BeanstalkDeliveryWaker implements DeliveryWaker
{
    public function wake(): void
    {
        try {
            $client = new BeanstalkClient(DeliveryTube::NAME);
            if (!$client->isConnected()) {
                return;
            }
            $client->publish(['wake' => 1], DeliveryTube::NAME);
        } catch (Throwable $exception) {
            HubLogger::event('delivery', 'wake_failed', ['error' => $exception::class], LOG_WARNING);
        }
    }
}
