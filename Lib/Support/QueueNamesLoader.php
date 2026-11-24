<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Support;

use MikoPBX\Common\Models\CallQueues;
use Modules\ModuleMessengerHub\Lib\Sources\Core\QueueNameMap;

/**
 * Thin Core glue: READS the Core model CallQueues (extension, name) to label the queue in events.
 * The hub may read Core models; Core is never changed (AGENTS.md, Plan/11 Q12).
 */
final class QueueNamesLoader
{
    /** @return array<string, string> queue extension => queue name */
    public static function load(): array
    {
        $queues = CallQueues::find(['columns' => 'extension,name'])->toArray();

        return QueueNameMap::build($queues);
    }
}
