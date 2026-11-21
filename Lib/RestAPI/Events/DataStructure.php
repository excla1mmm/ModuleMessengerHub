<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Events;

use MikoPBX\PBXCoreREST\Lib\Common\AbstractDataStructure;
use MikoPBX\PBXCoreREST\Lib\Common\OpenApiSchemaProvider;

/**
 * Schema of the hub event log (Plan/06): list filters and the event record fields.
 *
 * dedupe_key stays internal: it is a routing implementation detail, not part of the API contract.
 */
class DataStructure extends AbstractDataStructure implements OpenApiSchemaProvider
{
    public const string SEVERITY_INFO = 'info';
    public const string SEVERITY_WARNING = 'warning';
    public const string SEVERITY_CRITICAL = 'critical';

    public const array SEVERITIES = [
        self::SEVERITY_INFO,
        self::SEVERITY_WARNING,
        self::SEVERITY_CRITICAL,
    ];

    public static function getParameterDefinitions(): array
    {
        return [
            'request' => [
                'event_type' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_event_type', 'maxLength' => 100, 'example' => 'core.missed_call'],
                'source_id' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_source_id', 'maxLength' => 100, 'example' => 'core.missed_call'],
                'severity' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_severity', 'enum' => self::SEVERITIES],
                'date_from' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_date_from', 'example' => 1790900000],
                'date_to' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_date_to', 'example' => 1790986400],
                'limit' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_limit', 'minimum' => 1, 'maximum' => 200, 'default' => 50],
                'offset' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_offset', 'minimum' => 0, 'default' => 0],
                'id' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_event_id', 'example' => '12345'],
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
            'items' => ['type' => 'array', 'items' => ['type' => 'object'], 'description' => 'module_messenger_hub_ApiParam_events_items'],
            'pagination' => ['type' => 'object', 'description' => 'module_messenger_hub_ApiParam_pagination', 'properties' => [
                'limit' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_limit'],
                'offset' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_offset'],
                'total' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_total'],
                'has_more' => ['type' => 'boolean', 'description' => 'module_messenger_hub_ApiParam_has_more'],
            ]],
            'id' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_event_id'],
            'source_id' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_source_id'],
            'event_type' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_event_type'],
            'severity' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_severity', 'enum' => self::SEVERITIES],
            'occurred_at' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_occurred_at'],
            'payload' => ['type' => 'object', 'description' => 'module_messenger_hub_ApiParam_payload'],
            'deliveries' => ['type' => 'array', 'items' => ['type' => 'object'], 'description' => 'module_messenger_hub_ApiParam_event_deliveries'],
            'retried' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_retried'],
            'created_at' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_created_at'],
        ]];
    }
}
