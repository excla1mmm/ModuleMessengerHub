<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Settings;

use MikoPBX\PBXCoreREST\Attributes\{
    ApiDataSchema,
    ApiOperation,
    ApiParameterRef,
    ApiResource,
    ApiResponse,
    HttpMapping,
    ResourceSecurity,
    SecurityType
};
use MikoPBX\PBXCoreREST\Controllers\BaseRestController;

/**
 * Hub settings — a singleton resource (v3 API), like Core mail-settings.
 *
 * Fields of stage 1: hub_enabled, events_retention_days, sources ({<source_id>: bool}, an emergency
 * switch — not shown in the interface). Enabling a source resets its cursor: a fresh baseline without
 * history (AGENTS.md rule 5). getSources is the catalog and health state of the sources.
 */
#[ApiResource(
    path: '/pbxcore/api/v3/module-messenger-hub/settings',
    tags: ['Module Messenger Hub - Settings'],
    description: 'module_messenger_hub_ApiResourceSettings',
    processor: Processor::class
)]
#[ResourceSecurity('module-messenger-hub-settings', requirements: [SecurityType::LOCALHOST, SecurityType::BEARER_TOKEN])]
#[HttpMapping(
    mapping: ['GET' => ['getList', 'getDefault', 'getSources'], 'PUT' => ['update'], 'PATCH' => ['patch']],
    resourceLevelMethods: [],
    collectionLevelMethods: ['getList', 'getDefault', 'getSources', 'update', 'patch'],
    customMethods: ['getDefault', 'getSources'],
    idPattern: ''
)]
class Controller extends BaseRestController
{
    protected string $processorClass = Processor::class;

    /** @route GET /pbxcore/api/v3/module-messenger-hub/settings */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'detail')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_getSettings',
        description: 'module_messenger_hub_Api_getSettings_Description',
        operationId: 'getMessengerHubSettings'
    )]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_getSettings')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    public function getList(): void
    {
    }

    /** @route GET /pbxcore/api/v3/module-messenger-hub/settings:getDefault */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'detail')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_getSettingsDefault',
        description: 'module_messenger_hub_Api_getSettingsDefault_Description',
        operationId: 'getMessengerHubSettingsDefault'
    )]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_getSettingsDefault')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    public function getDefault(): void
    {
    }

    /** @route PUT /pbxcore/api/v3/module-messenger-hub/settings */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'detail')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_updateSettings',
        description: 'module_messenger_hub_Api_updateSettings_Description',
        operationId: 'updateMessengerHubSettings'
    )]
    #[ApiParameterRef('hub_enabled', required: true)]
    #[ApiParameterRef('events_retention_days', required: true)]
    #[ApiParameterRef('sources', required: true)]
    #[ApiParameterRef('pbx_public_url', required: true)]
    #[ApiParameterRef('mask_phone_default', required: true)]
    #[ApiParameterRef('proxy_url', required: true)]
    #[ApiParameterRef('max_ca_bundle_path', required: true)]
    #[ApiParameterRef('queue_abandon_min_wait_sec')]
    #[ApiParameterRef('queue_long_wait_sec')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_updateSettings')]
    #[ApiResponse(400, 'rest_response_400_bad_request', 'PBXApiResult')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(422, 'rest_response_422_validation_error', 'PBXApiResult')]
    public function update(): void
    {
    }

    /** @route PATCH /pbxcore/api/v3/module-messenger-hub/settings */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'detail')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_patchSettings',
        description: 'module_messenger_hub_Api_patchSettings_Description',
        operationId: 'patchMessengerHubSettings'
    )]
    #[ApiParameterRef('hub_enabled')]
    #[ApiParameterRef('events_retention_days')]
    #[ApiParameterRef('sources')]
    #[ApiParameterRef('pbx_public_url')]
    #[ApiParameterRef('mask_phone_default')]
    #[ApiParameterRef('proxy_url')]
    #[ApiParameterRef('max_ca_bundle_path')]
    #[ApiParameterRef('queue_abandon_min_wait_sec')]
    #[ApiParameterRef('queue_long_wait_sec')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_patchSettings')]
    #[ApiResponse(400, 'rest_response_400_bad_request', 'PBXApiResult')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(422, 'rest_response_422_validation_error', 'PBXApiResult')]
    public function patch(): void
    {
    }

    /** @route GET /pbxcore/api/v3/module-messenger-hub/settings:getSources */
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_getSources',
        description: 'module_messenger_hub_Api_getSources_Description',
        operationId: 'getMessengerHubSources'
    )]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_getSources')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    public function getSources(): void
    {
    }
}
