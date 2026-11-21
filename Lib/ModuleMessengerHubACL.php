<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib;

use Modules\ModuleUsersUI\Lib\ACL\ACLInterface;

/**
 * ModuleUsersUI permission links: which REST resources the admin page needs.
 *
 * One page (index) reads its own two resources only. The module group is closed by default in
 * ModuleUsersUI, so only administrators (and superusers) get the page until a role is granted explicitly.
 */
final class ModuleMessengerHubACL implements ACLInterface
{
    private const string API = '/pbxcore/api/v3/module-messenger-hub';
    private const string CONTROLLER = 'Modules\\ModuleMessengerHub\\App\\Controllers\\ModuleMessengerHubController';

    /** @return array<string, array<string, array<string, array<int, string>>>> */
    public static function getLinkedControllerActions(): array
    {
        return [
            self::CONTROLLER => [
                'index' => [
                    self::API . '/settings' => ['getList', 'getDefault', 'update', 'patch', 'getSources'],
                    self::API . '/events' => ['getList', 'getRecord', 'retry'],
                    self::API . '/rules' => [
                        'getList', 'getRecord', 'getDefault', 'create', 'update', 'patch', 'delete',
                        'changePriority',
                    ],
                    self::API . '/bots' => [
                        'getList', 'getRecord', 'getDefault', 'create', 'update', 'patch', 'delete',
                        'checkToken', 'discoverChats', 'sendTest',
                    ],
                ],
            ],
        ];
    }

    public static function getAlwaysAllowed(): array
    {
        return [];
    }

    public static function getAlwaysDenied(): array
    {
        return [];
    }
}
