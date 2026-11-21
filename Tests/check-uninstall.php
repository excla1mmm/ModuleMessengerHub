<?php

declare(strict_types=1);

// Module uninstall removes the hub's own Core API key (stage 3a-2): only for a real uninstall, never on a
// package update (keepSettings = true), and a failing removal never fails the uninstall.

namespace MikoPBX\Modules\Setup {

    class PbxExtensionSetupBase
    {
        public static int $uninstalled = 0;
        public static ?bool $lastKeep = null;
        protected $moduleUniqueID = 'ModuleMessengerHub';

        public function __construct(string $moduleUniqueID = '')
        {
        }

        public function uninstallModule(bool $keepSettings = false): bool
        {
            self::$uninstalled++;
            self::$lastKeep = $keepSettings;

            return true;
        }
    }
}

namespace MikoPBX\Common\Models {

    class PbxSettings
    {
    }
}

namespace {

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Api\UninstallCleanup;
use Modules\ModuleMessengerHub\Setup\PbxExtensionSetup;

check(UninstallCleanup::removeApiKey(static function (): void {
}) === true, 'a successful removal is reported');
check(UninstallCleanup::removeApiKey(static function (): void {
    throw new \RuntimeException('hub_api_key_boom');
}) === false, 'a failing removal is swallowed and reported as false');
check(UninstallCleanup::removeApiKey(static function (): void {
    throw new \Error('Core class missing');
}) === false, 'an Error from missing Core classes is swallowed as well');

final class SpySetup extends PbxExtensionSetup
{
    public int $keyRemovals = 0;
    public bool $failRemoval = false;

    protected function removeHubApiKey(): void
    {
        $this->keyRemovals++;
        UninstallCleanup::removeApiKey(function (): void {
            if ($this->failRemoval) {
                throw new \RuntimeException('hub_api_key_boom');
            }
        });
    }
}

$setup = new SpySetup('ModuleMessengerHub');
check($setup->uninstallModule(false) === true, 'uninstall succeeds');
check($setup->keyRemovals === 1, 'a real uninstall removes the hub key');
check(\MikoPBX\Modules\Setup\PbxExtensionSetupBase::$uninstalled === 1, 'the parent uninstaller still runs');

$setup->uninstallModule(true);
check($setup->keyRemovals === 1, 'uninstall with kept settings (package update) keeps the key');
check(\MikoPBX\Modules\Setup\PbxExtensionSetupBase::$lastKeep === true, 'keepSettings is passed to the parent');

$setup->failRemoval = true;
check($setup->uninstallModule(false) === true, 'a failing key removal does not fail the uninstall');
check(\MikoPBX\Modules\Setup\PbxExtensionSetupBase::$uninstalled === 3, 'the parent uninstaller runs after a failed removal');

// the real removal path without Core must not throw out of the setup class either
$plain = new PbxExtensionSetup('ModuleMessengerHub');
check($plain->uninstallModule(false) === true, 'uninstall without Core classes still succeeds');

finish('uninstall OK');
}
