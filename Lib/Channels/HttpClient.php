<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

/**
 * HTTP port of the channel clients: HttpTransport in production, a canned-response fake in unit
 * checks. Errors are normalised codes; the URL never reaches a log.
 */
interface HttpClient
{
    /**
     * Extra headers are only for the channel clients (MAX puts the token into Authorization). They are
     * never logged: the transport writes no request data to any log.
     *
     * @param array<string, mixed> $payload
     * @param list<string> $headers
     */
    public function postJson(string $url, array $payload, array $headers = []): HttpResponse;

    /**
     * @param array<string, scalar> $fields
     * @param list<string> $headers
     */
    public function postMultipart(
        string $url,
        array $fields,
        string $fileField,
        string $filePath,
        string $filename = '',
        string $mimeType = '',
        array $headers = [],
    ): HttpResponse;

    /** @param list<string> $headers */
    public function get(string $url, array $headers = []): HttpResponse;

    /** @param list<string> $headers */
    public function delete(string $url, array $headers = []): HttpResponse;
}
