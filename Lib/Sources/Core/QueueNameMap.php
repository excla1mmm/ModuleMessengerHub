<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

/**
 * Core-free builder of the "queue extension => queue name" map used by QueueAbandonSource.
 * Rows come from the Core model CallQueues (extension, name), read-only
 * (see Lib/Support/QueueNamesLoader). Queue numbers and names are PBX configuration, not personal data.
 */
final class QueueNameMap
{
    /**
     * @param iterable<array<string, mixed>> $queues rows with extension, name
     * @return array<string, string>
     */
    public static function build(iterable $queues): array
    {
        $map = [];
        foreach ($queues as $queue) {
            $extension = trim((string)($queue['extension'] ?? ''));
            if ($extension === '') {
                continue;
            }
            $map[$extension] = trim((string)($queue['name'] ?? ''));
        }

        return $map;
    }
}
