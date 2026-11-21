<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

/**
 * The only way the hub talks to a messenger (Plan/03, Plan/07-security-privacy.md).
 *
 * - URL, headers and bodies are never logged: Telegram puts the bot token into the URL, MAX into the
 *   Authorization header, and events carry personal data; errors come back as normalised codes;
 * - TLS verification is always on (a per-channel CA bundle may be added — MAX, stage 3);
 * - an HTTP(S)/SOCKS proxy from settings is honoured;
 * - timeouts are short so a dead messenger never blocks a worker forever.
 *
 * The base URL belongs to the channel client, which lets tests point it at a local fixture server.
 */
final class HttpTransport implements HttpClient
{
    private const array CURL_SSL_ERRORS = [35, 51, 53, 54, 58, 59, 60, 64, 66, 77, 80, 82, 83, 90, 91];

    public function __construct(
        private readonly string $proxyUrl = '',
        private readonly string $caBundlePath = '',
        private readonly int $timeoutSec = 15,
        private readonly int $connectTimeoutSec = 5,
    ) {
    }

    /**
     * The CA bundle this transport verifies TLS with ('' = the system store). Not a secret; it lets a
     * contract check prove that only the MAX transport gets the Минцифры bundle.
     */
    public function caBundlePath(): string
    {
        return $this->caBundlePath !== '' && is_file($this->caBundlePath) ? $this->caBundlePath : '';
    }

    /** @param array<string, mixed> $payload */
    public function postJson(string $url, array $payload, array $headers = []): HttpResponse
    {
        try {
            $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return new HttpResponse(0, '', 'http.bad_request');
        }

        return $this->request($url, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => self::mergeHeaders($headers, 'Content-Type: application/json'),
        ]);
    }

    /**
     * Multipart upload (stage 3a attachments). Never includes the file path in an error code.
     *
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
    ): HttpResponse {
        if (!is_file($filePath) || !is_readable($filePath)) {
            return new HttpResponse(0, '', 'file.unavailable');
        }
        $file = new \CURLFile($filePath, $mimeType, $filename !== '' ? $filename : basename($filePath));
        $payload = $fields;
        $payload[$fileField] = $file;
        $bytes = (int)(@filesize($filePath) ?: 0);

        return $this->request($url, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => self::mergeHeaders($headers),
        ], self::uploadTimeout($bytes));
    }

    /** @param list<string> $headers */
    public function get(string $url, array $headers = []): HttpResponse
    {
        return $this->request($url, [
            CURLOPT_HTTPGET => true,
            CURLOPT_HTTPHEADER => self::mergeHeaders($headers),
        ]);
    }

    /** @param list<string> $headers */
    public function delete(string $url, array $headers = []): HttpResponse
    {
        return $this->request($url, [
            CURLOPT_CUSTOMREQUEST => 'DELETE',
            CURLOPT_HTTPHEADER => self::mergeHeaders($headers),
        ]);
    }

    /**
     * Default headers plus channel headers; a channel header wins on the same name. Values stay in
     * memory only — this array is never logged.
     *
     * @param list<string> $headers
     * @return list<string>
     */
    private static function mergeHeaders(array $headers, string ...$extra): array
    {
        $merged = [];
        foreach ([...$extra, ...$headers, 'Accept: application/json'] as $line) {
            $name = strtolower(trim(explode(':', $line, 2)[0]));
            // a header line can never carry a line break: that would inject another header
            if ($name === '' || !str_contains($line, ':') || preg_match('/[\r\n]/', $line) === 1) {
                continue;
            }
            $merged[$name] = $line;
        }

        return array_values($merged);
    }

    /**
     * Upload timeout from the file size (Plan/03): at ~64 KB/s, at least 60 s, at most 15 min.
     * A 50 MB Telegram upload gets more than the default 15 s; a tiny voice file stays fast.
     */
    public static function uploadTimeout(int $bytes): int
    {
        return min(900, max(60, (int)ceil(max(0, $bytes) / 65536)));
    }

    /** @param array<int, mixed> $extraOptions */
    private function request(string $url, array $extraOptions, ?int $timeoutSec = null): HttpResponse
    {
        $curl = curl_init($url);
        if ($curl === false) {
            return new HttpResponse(0, '', 'http.unavailable');
        }
        $options = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => max(1, $timeoutSec ?? $this->timeoutSec),
            CURLOPT_CONNECTTIMEOUT => max(1, $this->connectTimeoutSec),
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
        ];
        if ($this->proxyUrl !== '') {
            $options[CURLOPT_PROXY] = $this->proxyUrl;
        }
        if ($this->caBundlePath !== '' && is_file($this->caBundlePath)) {
            $options[CURLOPT_CAINFO] = $this->caBundlePath;
        }
        // only the numeric Retry-After of a 429 is kept; nothing else from the response headers
        $retryAfter = 0;
        $options[CURLOPT_HEADERFUNCTION] = static function ($handle, string $line) use (&$retryAfter): int {
            if (str_starts_with(strtolower($line), 'retry-after:')) {
                // the header is untrusted: clamp so a broken proxy cannot park a row for years
                $retryAfter = max(0, min(3600, (int)trim(substr($line, 12))));
            }

            return strlen($line);
        };
        // $extraOptions must win on duplicate keys: a JSON body needs its Content-Type header,
        // otherwise libcurl labels the POST as form-urlencoded and Telegram answers 400
        curl_setopt_array($curl, $extraOptions + $options);

        $body = curl_exec($curl);
        $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $errno = curl_errno($curl);
        $connectTime = (float)curl_getinfo($curl, CURLINFO_CONNECT_TIME);

        if ($errno !== 0 || $body === false) {
            return new HttpResponse(0, '', self::errorCode($errno, $connectTime));
        }

        return new HttpResponse($status, (string)$body, '', $retryAfter);
    }

    private static function errorCode(int $errno, float $connectTime = 0.0): string
    {
        // 5/6/7 = proxy resolve / host resolve / connect: the request certainly never left the station
        if (in_array($errno, [5, 6, 7], true)) {
            return 'http.connect_failed';
        }
        if ($errno === CURLE_URL_MALFORMAT) {
            return 'http.bad_request';
        }
        if ($errno === CURLE_OPERATION_TIMEDOUT) {
            // a connect timeout did not send anything; a read timeout may be after the request
            return $connectTime > 0 ? 'http.timeout' : 'http.connect_failed';
        }

        return match (true) {
            in_array($errno, self::CURL_SSL_ERRORS, true) => 'http.tls',
            default => 'http.unavailable',
        };
    }
}
