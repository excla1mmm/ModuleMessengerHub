<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Support;

use MikoPBX\Common\Models\Extensions;
use MikoPBX\Common\Models\Users;
use Modules\ModuleMessengerHub\Lib\Sources\Core\InternalNumberMap;

/**
 * Thin Core glue: READS Core models (never writes) to build the internal number => employee map.
 * Rule: the hub may read Core models; Core must never be changed (AGENTS.md).
 */
final class InternalNumbersLoader
{
    /** @return array<string, array{user_id: ?int, name: string}> */
    public static function load(): array
    {
        $extensions = Extensions::find(['columns' => 'number,type,userid'])->toArray();
        $users = Users::find(['columns' => 'id,username'])->toArray();

        return InternalNumberMap::build($extensions, $users);
    }
}
