<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Delivery;

/** For contexts without beanstalk (unit checks, CLI probes). */
final class NullDeliveryWaker implements DeliveryWaker
{
    public function wake(): void
    {
    }
}
