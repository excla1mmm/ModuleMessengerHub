<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\App\Controllers;

use MikoPBX\AdminCabinet\Controllers\BaseController;
use MikoPBX\Modules\PbxExtensionUtils;
use Modules\ModuleMessengerHub\App\Providers\AssetProvider;
use Phalcon\Assets\Manager as AssetsManager;
use Throwable;

/**
 * The single admin page of the hub (tabs: Notifications, Log, Settings).
 *
 * The page is data-driven: everything it shows comes from the module REST resources
 * (settings + events), so the action only registers assets and passes the environment to JS.
 */
class ModuleMessengerHubController extends BaseController
{
    private const string MODULE_UNIQUE_ID = 'ModuleMessengerHub';

    public function indexAction(): void
    {
        $this->addModuleAssets();

        $this->view->moduleEnabled = PbxExtensionUtils::isEnabled(self::MODULE_UNIQUE_ID);
        // The journal shows and filters dates in the PBX time zone (Core keeps it in date.timezone).
        $this->view->timeZoneOffsetMinutes = (int)(date('Z') / 60);
        $this->view->pick('Modules/' . self::MODULE_UNIQUE_ID . '/ModuleMessengerHub/index');
    }

    private function addModuleAssets(): void
    {
        try {
            /** @var AssetsManager $assets */
            $assets = $this->assets;
            AssetProvider::addCss($assets);
            AssetProvider::addJs($assets);
        } catch (Throwable) {
            // a broken asset registration must not render a blank page
        }
    }
}
