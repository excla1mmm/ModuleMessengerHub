<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Api;

use Modules\ModuleMessengerHub\Lib\Sources\SourceException;

/**
 * RestReader over http://127.0.0.1:<WEBPort> with the hub's own restricted API key (Plan/01-architecture.md, Q1).
 *
 * The base URL comes from LocalRestBase (workers: Lib/Support/CoreWebPort::baseUrl()); any other base is
 * refused, so the key goes only to the PBX itself. No proxy from the environment, no redirects, HTTP only.
 * Never logs the key, URLs with query strings or response bodies.
 */
final class LocalRestClient implements PagedRestReader
{
    public function __construct(
        private readonly string $apiKey,
        private readonly string $baseUrl,
        private readonly int $timeoutSec = 15,
    ) {
    }

    public function get(string $path, array $query = []): array
    {
        return self::unwrap($this->fetch($path, $query), $this->lastStatus);
    }

    public function getPage(string $path, array $query = []): array
    {
        $body = $this->fetch($path, $query);

        return ['data' => self::unwrap($body, $this->lastStatus), 'pagination' => self::pagination($body)];
    }

    /**
     * `pagination` member of a PBXApiResult body: only the integer counters (total_items, limit, offset).
     *
     * @return array<string, int>
     */
    public static function pagination(string $body): array
    {
        $json = json_decode($body, true);
        $raw = is_array($json) && is_array($json['pagination'] ?? null) ? $json['pagination'] : [];
        $page = [];
        foreach (['total_items', 'limit', 'offset'] as $key) {
            if (isset($raw[$key]) && (is_int($raw[$key]) || (is_string($raw[$key]) && ctype_digit($raw[$key])))) {
                $page[$key] = (int)$raw[$key];
            }
        }

        return $page;
    }

    private int $lastStatus = 0;

    /** Performs the GET and returns the raw body; the HTTP status is kept for unwrap(). Never logs. */
    private function fetch(string $path, array $query): string
    {
        if (!str_starts_with($path, '/pbxcore/api/v3/')) {
            throw new SourceException('api_bad_path');
        }
        if ($this->apiKey === '') {
            throw new SourceException('api_key_missing');
        }
        if (!LocalRestBase::isLocal($this->baseUrl)) {
            throw new SourceException('api_bad_path');
        }
        $url = $this->baseUrl . $path . ($query === [] ? '' : '?' . http_build_query($query));

        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeoutSec,
            CURLOPT_CONNECTTIMEOUT => 5,
            // http_proxy/all_proxy from the environment must not receive the Bearer key
            CURLOPT_PROXY => '',
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP,
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

        $this->lastStatus = $status;

        return (string)$body;
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
