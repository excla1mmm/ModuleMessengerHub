<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Events;

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
 * Event history collected by the hub sources (Plan/06) — read only, like Core Cdr.
 *
 * Events are created only by source adapters inside the hub; there is no POST (pull model).
 */
#[ApiResource(
    path: '/pbxcore/api/v3/module-messenger-hub/events',
    tags: ['Module Messenger Hub - Events'],
    description: 'module_messenger_hub_ApiResourceEvents',
    processor: Processor::class
)]
#[ResourceSecurity('module-messenger-hub-events', requirements: [SecurityType::LOCALHOST, SecurityType::BEARER_TOKEN])]
#[HttpMapping(
    mapping: ['GET' => ['getList', 'getRecord'], 'POST' => ['retry']],
    resourceLevelMethods: ['getRecord', 'retry'],
    collectionLevelMethods: ['getList'],
    customMethods: ['retry'],
    idPattern: '[0-9]+'
)]
class Controller extends BaseRestController
{
    protected string $processorClass = Processor::class;

    /** @route GET /pbxcore/api/v3/module-messenger-hub/events */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'list')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_getEventsList',
        description: 'module_messenger_hub_Api_getEventsList_Description',
        operationId: 'getMessengerHubEvents'
    )]
    #[ApiParameterRef('event_type')]
    #[ApiParameterRef('source_id')]
    #[ApiParameterRef('severity')]
    #[ApiParameterRef('date_from')]
    #[ApiParameterRef('date_to')]
    #[ApiParameterRef('limit')]
    #[ApiParameterRef('offset')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_getEventsList')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    public function getList(): void
    {
    }

    /** @route GET /pbxcore/api/v3/module-messenger-hub/events/{id} */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'detail')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_getEventRecord',
        description: 'module_messenger_hub_Api_getEventRecord_Description',
        operationId: 'getMessengerHubEvent'
    )]
    #[ApiParameterRef('id')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_getEventRecord')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(404, 'rest_response_404_not_found', 'PBXApiResult')]
    public function getRecord(string $id): void
    {
    }

    /** @route POST /pbxcore/api/v3/module-messenger-hub/events/{id}:retry */
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_retryEvent',
        description: 'module_messenger_hub_Api_retryEvent_Description',
        operationId: 'retryMessengerHubEvent'
    )]
    #[ApiParameterRef('id')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_retryEvent')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(404, 'rest_response_404_not_found', 'PBXApiResult')]
    public function retry(string $id): void
    {
    }
}
