<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib;

use MikoPBX\Modules\Config\ConfigClass;

/**
 * Core hook implementations.
 *
 * Stage 0: no hooks yet. Planned hooks and their constraints are listed in
 * Plan/01-architecture.md ("Хуки ядра, которые реализует хаб"). Every hook Core
 * calls must only record the raw fact and return — no network I/O here.
 */
class MessengerHubConf extends ConfigClass
{
}
