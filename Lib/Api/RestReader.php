<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Api;

use Modules\ModuleMessengerHub\Lib\Sources\SourceException;

/**
 * Read-only access to the PBX REST API v3 (Core and other modules) for poll sources.
 */
interface RestReader
{
    /**
     * GET a REST v3 path (with the /pbxcore prefix) and return the PBXApiResult "data" member.
     *
     * @param array<string, scalar> $query
     * @return array<mixed>
     * @throws SourceException api_unauthorized | api_forbidden | api_not_found | api_unavailable | api_bad_response
     */
    public function get(string $path, array $query = []): array;
}
