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
 * and max_ca_bundle_path. Stage 4s-A adds the thresholds of the security sources (toll fraud,
 * SIP auth failures). Secrets from HubSettings::SECRET_KEYS are never part of the schema.
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
                'toll_fraud_prefixes' => [
                    'type' => 'string',
                    'description' => 'module_messenger_hub_ApiParam_toll_fraud_prefixes',
                    'default' => (string)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_PREFIXES],
                ],
                'toll_fraud_home_prefixes' => [
                    'type' => 'string',
                    'description' => 'module_messenger_hub_ApiParam_toll_fraud_home_prefixes',
                    'default' => (string)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_HOME_PREFIXES],
                ],
                'toll_fraud_burst_calls' => [
                    'type' => 'integer',
                    'description' => 'module_messenger_hub_ApiParam_toll_fraud_burst_calls',
                    'minimum' => HubSettings::BURST_CALLS_MIN,
                    'maximum' => HubSettings::BURST_CALLS_MAX,
                    'default' => (int)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_BURST_CALLS],
                ],
                'toll_fraud_burst_window_min' => [
                    'type' => 'integer',
                    'description' => 'module_messenger_hub_ApiParam_toll_fraud_burst_window_min',
                    'minimum' => HubSettings::WINDOW_MIN_MIN,
                    'maximum' => HubSettings::WINDOW_MIN_MAX,
                    'default' => (int)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_BURST_WINDOW_MIN],
                ],
                'toll_fraud_offhours_enabled' => [
                    'type' => 'boolean',
                    'description' => 'module_messenger_hub_ApiParam_toll_fraud_offhours_enabled',
                    'default' => HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_OFFHOURS_ENABLED] === '1',
                ],
                'toll_fraud_offhours_from' => [
                    'type' => 'string',
                    'description' => 'module_messenger_hub_ApiParam_toll_fraud_offhours_from',
                    'pattern' => '^([01]\d|2[0-3]):[0-5]\d$',
                    'default' => (string)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_OFFHOURS_FROM],
                ],
                'toll_fraud_offhours_to' => [
                    'type' => 'string',
                    'description' => 'module_messenger_hub_ApiParam_toll_fraud_offhours_to',
                    'pattern' => '^([01]\d|2[0-3]):[0-5]\d$',
                    'default' => (string)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_OFFHOURS_TO],
                ],
                'sip_authfail_threshold' => [
                    'type' => 'integer',
                    'description' => 'module_messenger_hub_ApiParam_sip_authfail_threshold',
                    'minimum' => HubSettings::AUTHFAIL_THRESHOLD_MIN,
                    'maximum' => HubSettings::AUTHFAIL_THRESHOLD_MAX,
                    'default' => (int)HubSettings::DEFAULTS[HubSettings::SIP_AUTHFAIL_THRESHOLD],
                ],
                'sip_authfail_window_min' => [
                    'type' => 'integer',
                    'description' => 'module_messenger_hub_ApiParam_sip_authfail_window_min',
                    'minimum' => HubSettings::WINDOW_MIN_MIN,
                    'maximum' => HubSettings::WINDOW_MIN_MAX,
                    'default' => (int)HubSettings::DEFAULTS[HubSettings::SIP_AUTHFAIL_WINDOW_MIN],
                ],
                'sip_authfail_quiet_min' => [
                    'type' => 'integer',
                    'description' => 'module_messenger_hub_ApiParam_sip_authfail_quiet_min',
                    'minimum' => HubSettings::AUTHFAIL_QUIET_MIN,
                    'maximum' => HubSettings::WINDOW_MIN_MAX,
                    'default' => (int)HubSettings::DEFAULTS[HubSettings::SIP_AUTHFAIL_QUIET_MIN],
                ],
                'sip_authfail_extensions_per_poll' => [
                    'type' => 'integer',
                    'description' => 'module_messenger_hub_ApiParam_sip_authfail_extensions_per_poll',
                    'minimum' => HubSettings::AUTHFAIL_EXTENSIONS_MIN,
                    'maximum' => HubSettings::AUTHFAIL_EXTENSIONS_MAX,
                    'default' => (int)HubSettings::DEFAULTS[HubSettings::SIP_AUTHFAIL_EXTENSIONS_PER_POLL],
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
        $properties = [
            'hub_enabled' => ['type' => 'boolean', 'description' => 'module_messenger_hub_ApiParam_hub_enabled'],
            'events_retention_days' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_events_retention_days'],
            'sources' => ['type' => 'object', 'description' => 'module_messenger_hub_ApiParam_sources'],
            'pbx_public_url' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_pbx_public_url'],
            'mask_phone_default' => ['type' => 'boolean', 'description' => 'module_messenger_hub_ApiParam_mask_phone_default'],
            'proxy_url' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_proxy_url'],
            'max_ca_bundle_path' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_max_ca_bundle_path'],
            'toll_fraud_prefixes' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_toll_fraud_prefixes'],
            'toll_fraud_home_prefixes' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_toll_fraud_home_prefixes'],
            'toll_fraud_burst_calls' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_toll_fraud_burst_calls'],
            'toll_fraud_burst_window_min' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_toll_fraud_burst_window_min'],
            'toll_fraud_offhours_enabled' => ['type' => 'boolean', 'description' => 'module_messenger_hub_ApiParam_toll_fraud_offhours_enabled'],
            'toll_fraud_offhours_from' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_toll_fraud_offhours_from'],
            'toll_fraud_offhours_to' => ['type' => 'string', 'description' => 'module_messenger_hub_ApiParam_toll_fraud_offhours_to'],
            'sip_authfail_threshold' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_sip_authfail_threshold'],
            'sip_authfail_window_min' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_sip_authfail_window_min'],
            'sip_authfail_quiet_min' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_sip_authfail_quiet_min'],
            'sip_authfail_extensions_per_poll' => ['type' => 'integer', 'description' => 'module_messenger_hub_ApiParam_sip_authfail_extensions_per_poll'],
            'changed' => ['type' => 'array', 'items' => ['type' => 'string'], 'description' => 'module_messenger_hub_ApiParam_changed'],
            'module_name' => ['type' => 'string', 'description' => 'module_name'],
        ];

        return ['type' => 'object', 'properties' => $properties];
    }
}
