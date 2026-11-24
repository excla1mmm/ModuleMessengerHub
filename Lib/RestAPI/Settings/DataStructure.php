<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Settings;

use MikoPBX\PBXCoreREST\Lib\Common\AbstractDataStructure;
use MikoPBX\PBXCoreREST\Lib\Common\OpenApiSchemaProvider;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;

/**
 * Schema of the hub settings singleton (Plan/06).
 *
 * Stage 1 fields: hub_enabled, events_retention_days, sources (an emergency switch per source,
 * not shown in the interface — Plan/11). Stage 2 adds pbx_public_url, mask_phone_default, proxy_url
 * and max_ca_bundle_path; stage 4s-B adds the queue wait thresholds of core.queue_abandoned.
 * Secrets from HubSettings::SECRET_KEYS are never part of the schema.
 */
class DataStructure extends AbstractDataStructure implements OpenApiSchemaProvider
{
    public static function getParameterDefinitions(): array
    {
        return [
            'request' => [
                'hub_enabled' => ['type' => 'boolean', 'description' => 'module_messenger_hub_ApiParam_hub_enabled', 'default' => false],
                'events_retention_days' => [
                    'type' => 'integer',
                    'description' => 'module_messenger_hub_ApiParam_events_retention_days',
                    'minimum' => HubSettings::RETENTION_MIN_DAYS,
                    'maximum' => HubSettings::RETENTION_MAX_DAYS,
                    'default' => (int)HubSettings::DEFAULTS[HubSettings::EVENTS_RETENTION_DAYS],
                ],
                'sources' => ['type' => 'object', 'description' => 'module_messenger_hub_ApiParam_sources'],
                'pbx_public_url' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_pbx_public_url', 'default' => ''],
                'mask_phone_default' => ['type' => 'boolean', 'description' => 'module_messenger_hub_ApiParam_mask_phone_default', 'default' => false],
                'proxy_url' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_proxy_url', 'default' => ''],
                'max_ca_bundle_path' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_max_ca_bundle_path', 'default' => ''],
                'queue_abandon_min_wait_sec' => [
                    'type' => 'integer',
                    'description' => 'module_messenger_hub_ApiParam_queue_abandon_min_wait_sec',
                    'minimum' => HubSettings::QUEUE_WAIT_MIN_SEC,
                    'maximum' => HubSettings::QUEUE_WAIT_MAX_SEC,
                    'default' => (int)HubSettings::DEFAULTS[HubSettings::QUEUE_ABANDON_MIN_WAIT_SEC],
                ],
                'queue_long_wait_sec' => [
                    'type' => 'integer',
                    'description' => 'module_messenger_hub_ApiParam_queue_long_wait_sec',
                    'minimum' => HubSettings::QUEUE_WAIT_MIN_SEC,
                    'maximum' => HubSettings::QUEUE_WAIT_MAX_SEC,
                    'default' => (int)HubSettings::DEFAULTS[HubSettings::QUEUE_LONG_WAIT_SEC],
                ],
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
            'hub_enabled' => ['type' => 'boolean', 'description' => 'module_messenger_hub_ApiParam_hub_enabled'],
            'events_retention_days' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_events_retention_days'],
            'sources' => ['type' => 'object', 'description' => 'module_messenger_hub_ApiParam_sources'],
            'pbx_public_url' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_pbx_public_url'],
            'mask_phone_default' => ['type' => 'boolean', 'description' => 'module_messenger_hub_ApiParam_mask_phone_default'],
            'proxy_url' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_proxy_url'],
            'max_ca_bundle_path' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_max_ca_bundle_path'],
            'queue_abandon_min_wait_sec' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_queue_abandon_min_wait_sec'],
            'queue_long_wait_sec' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_queue_long_wait_sec'],
            'changed' => ['type' => 'array', 'items' => ['type' => 'string'], 'description' => 'module_messenger_hub_ApiParam_changed'],
            'module_name' => ['type' => 'string', 'description' => 'module_name'],
        ]];
    }
}
