<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Common;

/** The processor received an action it does not implement (HTTP 400). */
final class UnknownActionException extends \RuntimeException
{
}
