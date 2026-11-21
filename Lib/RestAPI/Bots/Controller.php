<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Bots;

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
 * Messenger bots with nested chats (Plan/06), plus their state transitions as custom methods:
 * checkToken, discoverChats (5-minute session, polled by the worker) and sendTest (through the Outbox).
 *
 * Admin-only; every response carries `token_hint` only, never the token (Plan/07).
 */
#[ApiResource(
    path: '/pbxcore/api/v3/module-messenger-hub/bots',
    tags: ['Module Messenger Hub - Bots'],
    description: 'module_messenger_hub_ApiResourceBots',
    processor: Processor::class
)]
#[ResourceSecurity('module-messenger-hub-bots', requirements: [SecurityType::LOCALHOST, SecurityType::BEARER_TOKEN])]
#[HttpMapping(
    mapping: [
        'GET' => ['getList', 'getRecord', 'getDefault'],
        'POST' => ['create', 'checkToken', 'discoverChats', 'sendTest'],
        'PUT' => ['update'],
        'PATCH' => ['patch'],
        'DELETE' => ['delete'],
    ],
    resourceLevelMethods: ['getRecord', 'update', 'patch', 'delete', 'checkToken', 'discoverChats', 'sendTest'],
    collectionLevelMethods: ['getList', 'getDefault', 'create'],
    customMethods: ['getDefault', 'checkToken', 'discoverChats', 'sendTest'],
    idPattern: '[0-9]+'
)]
class Controller extends BaseRestController
{
    protected string $processorClass = Processor::class;

    /** @route GET /pbxcore/api/v3/module-messenger-hub/bots */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'list')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_getBotsList',
        description: 'module_messenger_hub_Api_getBotsList_Description',
        operationId: 'getMessengerHubBots'
    )]
    #[ApiParameterRef('limit')]
    #[ApiParameterRef('offset')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_getBotsList')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    public function getList(): void
    {
    }

    /** @route GET /pbxcore/api/v3/module-messenger-hub/bots/{id} */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'detail')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_getBotRecord',
        description: 'module_messenger_hub_Api_getBotRecord_Description',
        operationId: 'getMessengerHubBot'
    )]
    #[ApiParameterRef('id')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_getBotRecord')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(404, 'rest_response_404_not_found', 'PBXApiResult')]
    public function getRecord(string $id): void
    {
    }

    /** @route GET /pbxcore/api/v3/module-messenger-hub/bots:getDefault */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'detail')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_getBotsDefault',
        description: 'module_messenger_hub_Api_getBotsDefault_Description',
        operationId: 'getMessengerHubBotsDefault'
    )]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_getBotsDefault')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    public function getDefault(): void
    {
    }

    /** @route POST /pbxcore/api/v3/module-messenger-hub/bots */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'detail')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_createBot',
        description: 'module_messenger_hub_Api_createBot_Description',
        operationId: 'createMessengerHubBot'
    )]
    #[ApiParameterRef('channel', required: true)]
    #[ApiParameterRef('title', required: true)]
    #[ApiParameterRef('token', required: true)]
    #[ApiParameterRef('enabled')]
    #[ApiParameterRef('chats')]
    #[ApiResponse(201, 'module_messenger_hub_ApiResponse_createBot')]
    #[ApiResponse(400, 'rest_response_400_bad_request', 'PBXApiResult')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(422, 'rest_response_422_validation_error', 'PBXApiResult')]
    public function create(): void
    {
    }

    /** @route PUT /pbxcore/api/v3/module-messenger-hub/bots/{id} */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'detail')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_updateBot',
        description: 'module_messenger_hub_Api_updateBot_Description',
        operationId: 'updateMessengerHubBot'
    )]
    #[ApiParameterRef('id')]
    #[ApiParameterRef('title', required: true)]
    #[ApiParameterRef('enabled', required: true)]
    #[ApiParameterRef('token')]
    #[ApiParameterRef('chats')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_updateBot')]
    #[ApiResponse(400, 'rest_response_400_bad_request', 'PBXApiResult')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(404, 'rest_response_404_not_found', 'PBXApiResult')]
    #[ApiResponse(422, 'rest_response_422_validation_error', 'PBXApiResult')]
    public function update(string $id): void
    {
    }

    /** @route PATCH /pbxcore/api/v3/module-messenger-hub/bots/{id} */
    #[ApiDataSchema(schemaClass: DataStructure::class, type: 'detail')]
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_patchBot',
        description: 'module_messenger_hub_Api_patchBot_Description',
        operationId: 'patchMessengerHubBot'
    )]
    #[ApiParameterRef('id')]
    #[ApiParameterRef('title')]
    #[ApiParameterRef('enabled')]
    #[ApiParameterRef('token')]
    #[ApiParameterRef('chats')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_patchBot')]
    #[ApiResponse(400, 'rest_response_400_bad_request', 'PBXApiResult')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(404, 'rest_response_404_not_found', 'PBXApiResult')]
    #[ApiResponse(422, 'rest_response_422_validation_error', 'PBXApiResult')]
    public function patch(string $id): void
    {
    }

    /** @route DELETE /pbxcore/api/v3/module-messenger-hub/bots/{id} */
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_deleteBot',
        description: 'module_messenger_hub_Api_deleteBot_Description',
        operationId: 'deleteMessengerHubBot'
    )]
    #[ApiParameterRef('id')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_deleteBot')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(404, 'rest_response_404_not_found', 'PBXApiResult')]
    public function delete(string $id): void
    {
    }

    /** @route POST /pbxcore/api/v3/module-messenger-hub/bots/{id}:checkToken */
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_checkBotToken',
        description: 'module_messenger_hub_Api_checkBotToken_Description',
        operationId: 'checkMessengerHubBotToken'
    )]
    #[ApiParameterRef('id')]
    #[ApiParameterRef('token')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_checkBotToken')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(404, 'rest_response_404_not_found', 'PBXApiResult')]
    #[ApiResponse(422, 'rest_response_422_validation_error', 'PBXApiResult')]
    public function checkToken(string $id): void
    {
    }

    /** @route POST /pbxcore/api/v3/module-messenger-hub/bots/{id}:discoverChats */
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_discoverBotChats',
        description: 'module_messenger_hub_Api_discoverBotChats_Description',
        operationId: 'discoverMessengerHubBotChats'
    )]
    #[ApiParameterRef('id')]
    #[ApiParameterRef('stop')]
    #[ApiParameterRef('restart')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_discoverBotChats')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(404, 'rest_response_404_not_found', 'PBXApiResult')]
    #[ApiResponse(422, 'rest_response_422_validation_error', 'PBXApiResult')]
    public function discoverChats(string $id): void
    {
    }

    /** @route POST /pbxcore/api/v3/module-messenger-hub/bots/{id}:sendTest */
    #[ApiOperation(
        summary: 'module_messenger_hub_Api_sendBotTest',
        description: 'module_messenger_hub_Api_sendBotTest_Description',
        operationId: 'sendMessengerHubBotTest'
    )]
    #[ApiParameterRef('id')]
    #[ApiParameterRef('chat_ids')]
    #[ApiResponse(200, 'module_messenger_hub_ApiResponse_sendBotTest')]
    #[ApiResponse(401, 'rest_response_401_unauthorized', 'PBXApiResult')]
    #[ApiResponse(403, 'rest_response_403_forbidden', 'PBXApiResult')]
    #[ApiResponse(404, 'rest_response_404_not_found', 'PBXApiResult')]
    #[ApiResponse(422, 'rest_response_422_validation_error', 'PBXApiResult')]
    public function sendTest(string $id): void
    {
    }
}
