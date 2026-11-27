<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

use Modules\ModuleMessengerHub\Lib\Api\LocalRestBase;

/**
 * Core REST downloader over http://127.0.0.1:<WEBPort> (call recording by one-time token).
 *
 * - the base URL comes from LocalRestBase (workers: Lib/Support/CoreWebPort::baseUrl()), any other base is refused;
 * - only `/pbxcore/api/v3/...` paths are accepted; no redirects are followed (SSRF guard);
 * - plain HTTP only and no proxy from the environment: the key and the token stay on the PBX;
 * - the URL and query carry the playback token, so nothing here logs or throws them;
 * - the destination is written directly and removed on any failure.
 */
final class LocalRestFileDownloader implements RestFileDownloader
{
    public function __construct(
        private readonly string $apiKey,
        private readonly string $baseUrl,
        private readonly int $timeoutSec = 900,
    ) {
    }

    public function download(string $pathAndQuery, string $destination, int $maxBytes): string
    {
        if (!str_starts_with($pathAndQuery, '/pbxcore/api/v3/cdr:') || !LocalRestBase::isLocal($this->baseUrl)) {
            return 'api_bad_path';
        }
        $handle = @fopen($destination, 'wb');
        if (!is_resource($handle)) {
            return 'file.unavailable';
        }
        $curl = curl_init($this->baseUrl . $pathAndQuery);
        if ($curl === false) {
            fclose($handle);
            @unlink($destination);

            return 'http.unavailable';
        }
        $headers = ['Accept: application/octet-stream'];
        if ($this->apiKey !== '') {
            $headers[] = 'Authorization: Bearer ' . $this->apiKey;
        }
        $written = 0;
        $tooLarge = false;
        curl_setopt_array($curl, [
            // count bytes ourselves: a too-large answer must be aborted, not written to the disk first
            CURLOPT_WRITEFUNCTION => static function ($curlHandle, string $data) use ($handle, &$written, &$tooLarge, $maxBytes): int {
                $length = strlen($data);
                if ($written + $length > $maxBytes) {
                    $tooLarge = true;

                    return 0; // abort the transfer
                }
                $saved = fwrite($handle, $data);
                if ($saved === false) {
                    return 0;
                }
                $written += $saved;

                return $saved;
            },
            CURLOPT_TIMEOUT => max(60, min(900, $this->timeoutSec)), // 15 min hard ceiling
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_LOW_SPEED_LIMIT => 1024, // a stalled CDR/S3 transfer aborts instead of hanging
            CURLOPT_LOW_SPEED_TIME => 60,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP,
            // http_proxy/all_proxy from the environment must not receive the Bearer key and the token
            CURLOPT_PROXY => '',
            CURLOPT_HTTPHEADER => $headers,
        ]);
        $ok = curl_exec($curl);
        $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $errno = curl_errno($curl);
        fclose($handle);

        if ($tooLarge) {
            @unlink($destination);

            return 'file.too_large';
        }
        if ($ok === false || $errno !== 0) {
            @unlink($destination);

            return $errno === CURLE_OPERATION_TIMEDOUT ? 'http.timeout' : 'http.unavailable';
        }
        if ($status === 401 || $status === 403) {
            @unlink($destination);

            return 'api_forbidden';
        }
        if ($status === 404) {
            @unlink($destination);

            return 'api_not_found';
        }
        if ($status >= 400) {
            @unlink($destination);

            return $status >= 500 ? 'http.unavailable' : 'api_bad_response';
        }
        $bytes = @filesize($destination);
        if ($bytes === false || $bytes <= 0) {
            @unlink($destination);

            return 'file.unavailable';
        }
        if ($bytes > $maxBytes) {
            @unlink($destination);

            return 'file.too_large';
        }

        return '';
    }
}
