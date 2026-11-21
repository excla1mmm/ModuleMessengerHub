<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Setup;

use MikoPBX\Common\Models\PbxSettings;
use MikoPBX\Modules\Setup\PbxExtensionSetupBase;
use Modules\ModuleMessengerHub\Lib\Api\HubApiKey;
use Modules\ModuleMessengerHub\Lib\Api\UninstallCleanup;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Storage\PhalconHubDatabase;

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

    /**
     * Deletes the hub's own record in Core m_ApiKeys before the module tables go (the key id lives in
     * the hub settings). Core also calls this on a package update, with $keepSettings = true: the key
     * must then survive (Plan/11 Q15: same id and secret after the update), so it is removed only for a
     * real uninstall without kept settings. Disable only revokes the key. A failure here is logged as
     * a code and never fails the uninstall itself.
     */
    public function uninstallModule(bool $keepSettings = false): bool
    {
        if (!$keepSettings) {
            $this->removeHubApiKey();
        }

        return parent::uninstallModule($keepSettings);
    }

    protected function removeHubApiKey(): void
    {
        UninstallCleanup::removeApiKey(
            static fn () => (new HubApiKey(new HubSettings(new PhalconHubDatabase())))->remove()
        );
    }
}
