<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

/**
 * Core-free builder of the "internal number => employee" map used by MissedCallSource.
 * The rows come from Core models Extensions (number, type, userid) and Users (id, username), read-only
 * (see Lib/Support/InternalNumbersLoader, Plan/11 Q12).
 */
final class InternalNumberMap
{
    /** Core Extensions.type values that are numbers dialled inside the PBX. EXTERNAL (an employee's mobile) is not. */
    public const array INTERNAL_TYPES = ['SIP', 'QUEUE', 'IVR MENU', 'CONFERENCE', 'DIALPLAN APPLICATION'];

    /**
     * @param iterable<array<string, mixed>> $extensions rows with number, type, userid
     * @param iterable<array<string, mixed>> $users rows with id, username
     * @return array<string, array{user_id: ?int, name: string}>
     */
    public static function build(iterable $extensions, iterable $users): array
    {
        $names = [];
        foreach ($users as $user) {
            $names[(int)($user['id'] ?? 0)] = trim((string)($user['username'] ?? ''));
        }
        $map = [];
        foreach ($extensions as $extension) {
            $number = trim((string)($extension['number'] ?? ''));
            if ($number === '' || !in_array((string)($extension['type'] ?? ''), self::INTERNAL_TYPES, true)) {
                continue;
            }
            $userId = (int)($extension['userid'] ?? 0);
            $hasUser = $userId > 0 && isset($names[$userId]);
            $map[$number] = ['user_id' => $hasUser ? $userId : null, 'name' => $hasUser ? $names[$userId] : ''];
        }

        return $map;
    }
}
