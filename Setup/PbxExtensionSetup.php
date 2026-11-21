<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Setup;

use MikoPBX\Modules\Setup\PbxExtensionSetupBase;

/**
 * Installer.
 *
 * Stage 0: the base class creates tables from model annotations, registers the module,
 * adds it to the sidebar and links assets/views. Keep installation fast: never process
 * event history here (see Plan/04-data-model.md, "Миграции").
 */
class PbxExtensionSetup extends PbxExtensionSetupBase
{
}
