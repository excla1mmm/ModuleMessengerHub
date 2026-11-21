<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Rules;

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
 * Routing rules = the "notifications" of the hub (Plan/06), with a collection-level priority change.
 *
 * The notifications screen and the three-step wizard use this resource only; there is no
 * preview-matches method (decision Q14). Secrets do not exist here.
 */
#[ApiResource(
    path: '/pbxcore/api/v3/module-messenger-hub/rules',
    tags: ['Module Messenger Hub - Rules'],
    description: 'module_messenger_hub_ApiResourceRules',
    processor: Processor::class
)]
#[ResourceSecurity('module-messenger-hub-rules', requirements: [SecurityType::LOCALHOST, SecurityType::BEARER_TOKEN])]
#[HttpMapping(
    mapping: [
        'GET' => ['getList', 'getRecord', 'getDefault'],
        'POST' => ['create', 'changePriority'],
        'PUT' => ['update'],
        'PATCH' => ['patch'],
        'DELETE' => ['delete'],
    ],
    resourceLevelMethods: ['getRecord', 'update', 'patch', 'delete'],
    collectionLevelMethods: ['getList', 'getDefault', 'create', 'changePriority'],
    customMethods: ['getDefault', 'changePriority'],
    idPattern: '[0-9]+'
)]
class Controller extends BaseRestController
{
    protected string $processorClass = Processor::class;

    /** @route GET /pbxcore/api/v3/module-messenger-hub/rules */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'list')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_getRulesList',
        description: 'module_messenger_hub_Api_getRulesList_Description',
        operationId: 'getMessengerHubRules'
    )]
    #[ApiParameterRef('limit')]
    #[ApiParameterRef('offset')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_getRulesList')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    public function getList(): void
    {
    }

    /** @route GET /pbxcore/api/v3/module-messenger-hub/rules/{id} */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'detail')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_getRuleRecord',
        description: 'module_messenger_hub_Api_getRuleRecord_Description',
        operationId: 'getMessengerHubRule'
    )]
    #[ApiParameterRef('id')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_getRuleRecord')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(404, 'rest_response_404_not_found', 'PBXApiResult')]
    public function getRecord(string $id): void
    {
    }

    /** @route GET /pbxcore/api/v3/module-messenger-hub/rules:getDefault */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'detail')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_getRulesDefault',
        description: 'module_messenger_hub_Api_getRulesDefault_Description',
        operationId: 'getMessengerHubRulesDefault'
    )]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_getRulesDefault')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    public function getDefault(): void
    {
    }

    /** @route POST /pbxcore/api/v3/module-messenger-hub/rules */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'detail')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_createRule',
        description: 'module_messenger_hub_Api_createRule_Description',
        operationId: 'createMessengerHubRule'
    )]
    #[ApiParameterRef('title', required: true)]
    #[ApiParameterRef('enabled', required: true)]
    #[ApiParameterRef('event_types', required: true)]
    #[ApiParameterRef('target_mode', required: true)]
    #[ApiParameterRef('chat_ids')]
    #[ApiParameterRef('filters')]
    #[ApiParameterRef('min_severity')]
    #[ApiParameterRef('options')]
    #[ApiParameterRef('priority')]
    #[ApiResponse(201, 'module_messenger_hub_ApiResponse_createRule')]
    #[ApiResponse(400, 'rest_response_400_bad_request', 'PBXApiResult')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(422, 'rest_response_422_validation_error', 'PBXApiResult')]
    public function create(): void
    {
    }

    /** @route PUT /pbxcore/api/v3/module-messenger-hub/rules/{id} */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'detail')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_updateRule',
        description: 'module_messenger_hub_Api_updateRule_Description',
        operationId: 'updateMessengerHubRule'
    )]
    #[ApiParameterRef('id')]
    #[ApiParameterRef('title', required: true)]
    #[ApiParameterRef('enabled', required: true)]
    #[ApiParameterRef('event_types', required: true)]
    #[ApiParameterRef('target_mode', required: true)]
    #[ApiParameterRef('chat_ids')]
    #[ApiParameterRef('filters')]
    #[ApiParameterRef('min_severity')]
    #[ApiParameterRef('options')]
    #[ApiParameterRef('priority')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_updateRule')]
    #[ApiResponse(400, 'rest_response_400_bad_request', 'PBXApiResult')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(404, 'rest_response_404_not_found', 'PBXApiResult')]
    #[ApiResponse(422, 'rest_response_422_validation_error', 'PBXApiResult')]
    public function update(string $id): void
    {
    }

    /** @route PATCH /pbxcore/api/v3/module-messenger-hub/rules/{id} */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'detail')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_patchRule',
        description: 'module_messenger_hub_Api_patchRule_Description',
        operationId: 'patchMessengerHubRule'
    )]
    #[ApiParameterRef('id')]
    #[ApiParameterRef('title')]
    #[ApiParameterRef('enabled')]
    #[ApiParameterRef('event_types')]
    #[ApiParameterRef('target_mode')]
    #[ApiParameterRef('chat_ids')]
    #[ApiParameterRef('filters')]
    #[ApiParameterRef('min_severity')]
    #[ApiParameterRef('options')]
    #[ApiParameterRef('priority')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_patchRule')]
    #[ApiResponse(400, 'rest_response_400_bad_request', 'PBXApiResult')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(404, 'rest_response_404_not_found', 'PBXApiResult')]
    #[ApiResponse(422, 'rest_response_422_validation_error', 'PBXApiResult')]
    public function patch(string $id): void
    {
    }

    /** @route DELETE /pbxcore/api/v3/module-messenger-hub/rules/{id} */
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_deleteRule',
        description: 'module_messenger_hub_Api_deleteRule_Description',
        operationId: 'deleteMessengerHubRule'
    )]
    #[ApiParameterRef('id')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_deleteRule')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(404, 'rest_response_404_not_found', 'PBXApiResult')]
    public function delete(string $id): void
    {
    }

    /** @route POST /pbxcore/api/v3/module-messenger-hub/rules:changePriority */
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_changeRulesPriority',
        description: 'module_messenger_hub_Api_changeRulesPriority_Description',
        operationId: 'changeMessengerHubRulesPriority'
    )]
    #[ApiParameterRef('order', required: true)]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_changeRulesPriority')]
    #[ApiResponse(400, 'rest_response_400_bad_request', 'PBXApiResult')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(422, 'rest_response_422_validation_error', 'PBXApiResult')]
    public function changePriority(): void
    {
    }
}
