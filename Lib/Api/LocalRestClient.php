<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Api;

use Modules\ModuleMessengerHub\Lib\Sources\SourceException;

/**
 * RestReader over http://127.0.0.1 with the hub's own restricted API key (Plan/01-architecture.md, Q1).
 *
 * Never logs the key, URLs with query strings or response bodies.
 */
final class LocalRestClient implements RestReader
{
    public function __construct(
        private readonly string $apiKey,
        private readonly string $baseUrl = 'http://127.0.0.1',
        private readonly int $timeoutSec = 15,
    ) {
    }

    public function get(string $path, array $query = []): array
    {
        if (!str_starts_with($path, '/pbxcore/api/v3/')) {
            throw new SourceException('api_bad_path');
        }
        if ($this->apiKey === '') {
            throw new SourceException('api_key_missing');
        }
        $url = $this->baseUrl . $path . ($query === [] ? '' : '?' . http_build_query($query));

        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeoutSec,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'Authorization: Bearer ' . $this->apiKey,
            ],
        ]);
        $body = curl_exec($curl);
        $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $failed = $body === false;

        if ($failed || $status === 0) {
            throw new SourceException('api_unavailable');
        }

        return self::unwrap((string)$body, $status);
    }

    /**
     * Maps an HTTP status + PBXApiResult body to the data member or a SourceException.
     *
     * @return array<mixed>
     */
    public static function unwrap(string $body, int $status): array
    {
        $code = match (true) {
            $status === 401 => 'api_unauthorized',
            $status === 403 => 'api_forbidden',
            $status === 404 => 'api_not_found',
            $status >= 500 => 'api_unavailable',
            default => null,
        };
        if ($code !== null) {
            throw new SourceException($code);
        }
        $json = json_decode($body, true);
        if (!is_array($json) || ($json['result'] ?? null) !== true) {
            throw new SourceException('api_bad_response');
        }
        $data = $json['data'] ?? [];

        return is_array($data) ? $data : [];
    }
}
