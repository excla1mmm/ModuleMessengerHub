<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/**
 * Core REST downloader over http://127.0.0.1 (call recording by one-time token).
 *
 * - only `/pbxcore/api/v3/...` paths are accepted; no redirects are followed (SSRF guard);
 * - TLS verification is never disabled (the local URL is HTTP anyway);
 * - the URL and query carry the playback token, so nothing here logs or throws them;
 * - the destination is written directly and removed on any failure.
 */
final class LocalRestFileDownloader implements RestFileDownloader
{
    public function __construct(
        private readonly string $apiKey,
        private readonly string $baseUrl = 'http://127.0.0.1',
        private readonly int $timeoutSec = 300,
    ) {
    }

    public function download(string $pathAndQuery, string $destination, int $maxBytes): string
    {
        if (!str_starts_with($pathAndQuery, '/pbxcore/api/v3/cdr:')) {
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
            CURLOPT_TIMEOUT => 900, // 15 min hard ceiling for one recording
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_LOW_SPEED_LIMIT => 1024, // a stalled CDR/S3 transfer aborts instead of hanging
            CURLOPT_LOW_SPEED_TIME => 60,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
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
