<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/** Cheap local check before the text message: can audio possibly be sent? No network, no conversion. */
final class PreflightResult
{
    public function __construct(
        public readonly bool $ok,
        public readonly string $code = '',
    ) {
    }
}
