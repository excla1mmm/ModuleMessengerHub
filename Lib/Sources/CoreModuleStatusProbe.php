<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

use MikoPBX\Common\Models\PbxExtensionModules;

/**
 * ModuleStatusProbe over Core's m_PbxExtensionModules (read only).
 */
final class CoreModuleStatusProbe implements ModuleStatusProbe
{
    public function status(string $moduleUniqueId): string
    {
        $module = PbxExtensionModules::findFirst([
            'conditions' => 'uniqid = :uniqid:',
            'bind' => ['uniqid' => $moduleUniqueId],
        ]);
        if (!$module instanceof PbxExtensionModules) {
            return SourceAvailability::MODULE_MISSING;
        }

        return (string)$module->disabled === '1'
            ? SourceAvailability::MODULE_DISABLED
            : SourceAvailability::AVAILABLE;
    }
}
