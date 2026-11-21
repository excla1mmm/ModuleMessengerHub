<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Bots;

use MikoPBX\PBXCoreREST\Lib\Common\AbstractDataStructure;
use MikoPBX\PBXCoreREST\Lib\Common\OpenApiSchemaProvider;

/**
 * Schema of the bots resource (Plan/06). `token` is accepted on write and never part of a response;
 * the response carries `token_hint` only (Plan/07).
 */
class DataStructure extends AbstractDataStructure implements OpenApiSchemaProvider
{
    /** Bot states of Processor::statusFor(); `ca_error` is the MAX TLS trust failure. */
    public const array STATUSES = ['new', 'ok', 'token_invalid', 'ca_error', 'error'];

    public static function getParameterDefinitions(): array
    {
        return [
            'request' => [
                'channel' => [
                    'type' => 'string',
                    'enum' => ['telegram', 'max'],
                    'description' => 'module_messenger_hub_ApiParam_bot_channel',
                ],
                'title' => ['type' => 'string', 'maxLength' => 128, 'description' => 'module_messenger_hub_ApiParam_bot_title'],
                'token' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_bot_token'],
                'enabled' => ['type' => 'boolean', 'description' => 'module_messenger_hub_ApiParam_bot_enabled', 'default' => true],
                'chats' => ['type' => 'array', 'items' => ['type' => 'object'], 'description' => 'module_messenger_hub_ApiParam_bot_chats'],
                'chat_ids' => ['type' => 'array', 'items' => ['type' => 'integer'], 'description' => 'module_messenger_hub_ApiParam_bot_chat_ids'],
                'stop' => ['type' => 'boolean', 'description' => 'module_messenger_hub_ApiParam_bot_discovery_stop'],
                'restart' => ['type' => 'boolean', 'description' => 'module_messenger_hub_ApiParam_bot_discovery_restart'],
            ],
            'response' => [],
        ];
    }

    public static function getListItemSchema(): array
    {
        return self::getDetailSchema();
    }

    public static function getDetailSchema(): array
    {
        return ['type' => 'object', 'properties' => [
            'id' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_bot_id'],
            'channel' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_bot_channel'],
            'title' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_bot_title'],
            'token_hint' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_bot_token_hint'],
            'bot_username' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_bot_username'],
            'bot_external_id' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_bot_external_id'],
            'enabled' => ['type' => 'boolean', 'description' => 'module_messenger_hub_ApiParam_bot_enabled'],
            'status' => [
                'type' => 'string',
                'enum' => self::STATUSES,
                'description' => 'module_messenger_hub_ApiParam_bot_status',
            ],
            'status_checked_at' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_bot_status_checked_at'],
            'last_error_code' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_bot_last_error_code'],
            'created_at' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_bot_created_at'],
            'updated_at' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_bot_updated_at'],
            'discovery' => ['type' => 'object', 'description' => 'module_messenger_hub_ApiParam_bot_discovery'],
            'chats' => ['type' => 'array', 'items' => ['type' => 'object'], 'description' => 'module_messenger_hub_ApiParam_bot_chats_response'],
        ]];
    }
}
