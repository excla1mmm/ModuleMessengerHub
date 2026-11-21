<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Rules;

use MikoPBX\PBXCoreREST\Lib\Common\AbstractDataStructure;
use MikoPBX\PBXCoreREST\Lib\Common\OpenApiSchemaProvider;

/**
 * Schema of the rules resource (Plan/06): notifications = event types + filters + recipients.
 * `priority` maps to the stored sort order; `chat_ids` are m_MessengerHubBotChats ids.
 */
class DataStructure extends AbstractDataStructure implements OpenApiSchemaProvider
{
    public static function getParameterDefinitions(): array
    {
        return [
            'request' => [
                'title' => ['type' => 'string', 'maxLength' => 128, 'description' => 'module_messenger_hub_ApiParam_rule_title'],
                'enabled' => ['type' => 'boolean', 'description' => 'module_messenger_hub_ApiParam_rule_enabled'],
                'event_types' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                    'description' => 'module_messenger_hub_ApiParam_rule_event_types',
                ],
                'min_severity' => [
                    'type' => 'string',
                    'enum' => ['info', 'warning', 'critical'],
                    'description' => 'module_messenger_hub_ApiParam_rule_min_severity',
                    'default' => 'info',
                ],
                'filters' => ['type' => 'object', 'description' => 'module_messenger_hub_ApiParam_rule_filters'],
                'target_mode' => [
                    'type' => 'string',
                    'enum' => ['recipients', 'employee', 'employee_or_recipients'],
                    'description' => 'module_messenger_hub_ApiParam_rule_target_mode',
                ],
                'chat_ids' => ['type' => 'array', 'items' => ['type' => 'integer'], 'description' => 'module_messenger_hub_ApiParam_rule_chat_ids'],
                'template_key' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_rule_template_key'],
                'options' => ['type' => 'object', 'description' => 'module_messenger_hub_ApiParam_rule_options'],
                'priority' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_rule_priority'],
                'order' => ['type' => 'array', 'items' => ['type' => 'integer'], 'description' => 'module_messenger_hub_ApiParam_rule_order'],
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
            'id' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_rule_id'],
            'title' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_rule_title'],
            'enabled' => ['type' => 'boolean', 'description' => 'module_messenger_hub_ApiParam_rule_enabled'],
            'event_types' => ['type' => 'array', 'items' => ['type' => 'string'], 'description' => 'module_messenger_hub_ApiParam_rule_event_types'],
            'min_severity' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_rule_min_severity'],
            'filters' => ['type' => 'object', 'description' => 'module_messenger_hub_ApiParam_rule_filters'],
            'target_mode' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_rule_target_mode'],
            'chat_ids' => ['type' => 'array', 'items' => ['type' => 'integer'], 'description' => 'module_messenger_hub_ApiParam_rule_chat_ids'],
            'chats' => ['type' => 'array', 'items' => ['type' => 'object'], 'description' => 'module_messenger_hub_ApiParam_rule_chats'],
            'options' => ['type' => 'object', 'description' => 'module_messenger_hub_ApiParam_rule_options'],
            'priority' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_rule_priority'],
            'template_key' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_rule_template_key'],
            'source_id' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_rule_source_id'],
            'group' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_rule_group'],
            'last_event_at' => ['type' => 'integer', 'nullable' => true, 'description' => 'module_messenger_hub_ApiParam_rule_last_event_at'],
        ]];
    }
}
