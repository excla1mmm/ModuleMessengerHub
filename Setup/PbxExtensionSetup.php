<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Setup;

use MikoPBX\Common\Models\PbxSettings;
use MikoPBX\Modules\Setup\PbxExtensionSetupBase;

/**
 * Installer.
 *
 * The base class creates tables from model annotations, registers the module and links assets/views.
 * Keep installation fast: never process event history here (see Plan/04-data-model.md, "Миграции").
 */
class PbxExtensionSetup extends PbxExtensionSetupBase
{
    /**
     * The page lives in the "Integrations" group of the sidebar (approved design; the base class
     * would put it into "Modules").
     */
    public function addToSidebar(): bool
    {
        $key = "AdditionalMenuItem$this->moduleUniqueID";
        $menu = PbxSettings::findFirstByKey($key) ?? new PbxSettings();
        $menu->key = $key;
        $menu->value = (string)json_encode([
            'uniqid' => $this->moduleUniqueID,
            'group' => 'integrations',
            'iconClass' => 'bell',
            'caption' => "Breadcrumb$this->moduleUniqueID",
            'showAtSidebar' => true,
        ]);

        return $menu->save();
    }
}
