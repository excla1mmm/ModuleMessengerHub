<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Api;

use Modules\ModuleMessengerHub\Lib\Sources\SourceException;

/**
 * A RestReader that also exposes the `pagination` member of a list answer (total_items, limit, offset).
 *
 * Needed where a source must know a collection size without reading it (Local STT pending jobs).
 */
interface PagedRestReader extends RestReader
{
    /**
     * @param array<string, scalar> $query
     * @return array{data: array<mixed>, pagination: array<string, int>}
     * @throws SourceException same codes as RestReader::get
     */
    public function getPage(string $path, array $query = []): array;
}
