<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

/**
 * Answers whether a PBX extension module is installed and enabled.
 */
interface ModuleStatusProbe
{
    /** @return string SourceAvailability::AVAILABLE | MODULE_MISSING | MODULE_DISABLED */
    public function status(string $moduleUniqueId): string;
}
