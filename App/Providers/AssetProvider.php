<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\App\Providers;

use MikoPBX\AdminCabinet\Providers\AssetProvider as AdminAssetProvider;
use Phalcon\Assets\Manager;

/**
 * Registers the module stylesheet and compiled page script in the admin cabinet.
 *
 * The admin cabinet loads Semantic UI component by component; modal and progress are not part of the
 * common set, so pages that use them add them to the Semantic UI collections themselves (as Core pages do).
 * Without modal.min.css a `.ui.modal` has no `display: none` and every dialog is rendered inline.
 */
final class AssetProvider
{
    private const string MODULE_UNIQUE_ID = 'ModuleMessengerHub';
    private const string CSS_FILE = 'module-messenger-hub.css';
    private const string JS_FILE = 'module-messenger-hub-index.js';

    public static function addCss(Manager $assets): void
    {
        $assets
            ->collection(AdminAssetProvider::SEMANTIC_UI_CSS)
            ->addCss('css/vendor/semantic/modal.min.css', true)
            ->addCss('css/vendor/semantic/progress.min.css', true);
        $assets
            ->collection(AdminAssetProvider::HEADER_CSS)
            ->addCss('css/cache/' . self::MODULE_UNIQUE_ID . '/' . self::CSS_FILE, true);
    }

    public static function addJs(Manager $assets): void
    {
        $assets
            ->collection(AdminAssetProvider::SEMANTIC_UI_JS)
            ->addJs('js/vendor/semantic/modal.min.js', true);
        $assets
            ->collection(AdminAssetProvider::FOOTER_JS)
            ->addJs('js/cache/' . self::MODULE_UNIQUE_ID . '/' . self::JS_FILE, true);
    }
}
