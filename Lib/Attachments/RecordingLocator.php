<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

use Modules\ModuleMessengerHub\Lib\Api\RestReader;
use Modules\ModuleMessengerHub\Lib\Sources\SourceException;

/**
 * Resolves an attachment source to a readable local file without touching Core directories or
 * another module's internals (Plan/03, decision 3a-1).
 *
 * - `path` (voicemail, probe) goes through PathGuard;
 * - `cdr` (AI attention call) uses the public Core REST v3: `GET /api/v3/cdr/{id}` or
 *   `?linkedid=…` gives a one-time `download_url`, which is fetched through RestFileDownloader.
 *   Only a relative Core `/pbxcore/api/v3/cdr:download?token=…` URL is accepted: no absolute URLs,
 *   no other hosts.
 */
final class RecordingLocator
{
    public const string CODE_SOURCE_MISSING = 'attachment.source_missing';
    public const string CODE_TOO_BIG = 'attachment.too_big';

    private const string CDR_PATH = '/pbxcore/api/v3/cdr';
    private const int MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;

    public function __construct(
        private readonly RestReader $rest,
        private readonly RestFileDownloader $downloader,
        private readonly PathGuard $paths,
    ) {
    }

    public function locate(AttachmentPlan $plan, string $destination): LocateResult
    {
        $source = $plan->source;
        if (($source['type'] ?? '') === 'path') {
            $resolved = $this->paths->resolve((string)($source['path'] ?? ''), $plan->probe);
            if (isset($resolved['path'], $resolved['bytes'])) {
                return new LocateResult(path: $resolved['path'], bytes: $resolved['bytes']);
            }

            return new LocateResult(code: $resolved['code'] ?? PathGuard::CODE_REJECTED);
        }
        if (($source['type'] ?? '') !== 'cdr') {
            return new LocateResult(code: self::CODE_SOURCE_MISSING);
        }

        $url = $this->cdrUrl($source);
        if (is_array($url)) {
            return new LocateResult(code: $url['code'], retryable: $url['retryable']);
        }
        $error = $this->downloader->download($url, $destination, self::MAX_DOWNLOAD_BYTES);
        if ($error === '') {
            $bytes = @filesize($destination);

            return new LocateResult(path: $destination, bytes: $bytes === false ? 0 : $bytes);
        }

        return new LocateResult(
            code: match ($error) {
                'file.too_large' => self::CODE_TOO_BIG,
                'api_not_found' => self::CODE_SOURCE_MISSING,
                default => $error,
            },
            retryable: !in_array($error, ['file.too_large', 'api_not_found'], true)
        );
    }

    /**
     * @param array<string, mixed> $source
     * @return string|array{code: string, retryable: bool}
     */
    private function cdrUrl(array $source): string|array
    {
        $cdrId = (int)($source['cdr_id'] ?? 0);
        $linkedid = trim((string)($source['linkedid'] ?? ''));
        try {
            if ($cdrId > 0) {
                $record = $this->rest->get(self::CDR_PATH . '/' . $cdrId);
                $url = self::downloadUrl($record);
                if ($url !== '' && self::belongsTo($record, $linkedid)) {
                    return $url;
                }
            }
            if ($linkedid !== '') {
                // grouped=false keeps the individual segments; the nested form is handled anyway
                $data = $this->rest->get(self::CDR_PATH, [
                    'linkedid' => $linkedid,
                    'limit' => 50,
                    'grouped' => 'false',
                ]);
                $records = is_array($data['records'] ?? null) ? $data['records'] : $data;
                $url = self::findDownloadUrl(is_array($records) ? $records : [], $linkedid);
                if ($url !== '') {
                    return $url;
                }
            }
        } catch (SourceException $exception) {
            $code = $exception->errorCode;

            return [
                'code' => match ($code) {
                    'api_not_found' => self::CODE_SOURCE_MISSING,
                    'api_unauthorized', 'api_forbidden' => 'api_forbidden',
                    'api_unavailable' => 'api_unavailable',
                    default => 'api_bad_response',
                },
                // a CDR row may not be visible yet (late analysis/S3); retry a few times, then note
                'retryable' => true,
            ];
        }

        return ['code' => self::CODE_SOURCE_MISSING, 'retryable' => false];
    }

    /**
     * Finds the first segment with a Core download URL, including the grouped response shape
     * (`records` of groups, each with its own `records` of segments).
     *
     * @param array<mixed> $records
     */
    private static function findDownloadUrl(array $records, string $linkedid): string
    {
        foreach ($records as $record) {
            if (!is_array($record)) {
                continue;
            }
            $url = self::downloadUrl($record);
            if ($url !== '' && self::belongsTo($record, $linkedid)) {
                return $url;
            }
            if (is_array($record['records'] ?? null)) {
                foreach ($record['records'] as $child) {
                    if (is_array($child)) {
                        $url = self::downloadUrl($child);
                        if ($url !== '' && self::belongsTo($child, $linkedid)) {
                            return $url;
                        }
                    }
                }
            }
        }

        return '';
    }

    /** A detail record must belong to the event's own call, not to another conversation. */
    private static function belongsTo(array $record, string $linkedid): bool
    {
        if ($linkedid === '') {
            return true;
        }
        $recordLinkedid = trim((string)($record['linkedid'] ?? ''));

        return $recordLinkedid === '' || $recordLinkedid === $linkedid;
    }

    /** @param array<string, mixed> $record */
    private static function downloadUrl(array $record): string
    {
        foreach (['download_url', 'playback_url'] as $field) {
            $url = is_string($record[$field] ?? null) ? trim($record[$field]) : '';
            // relative, Core-only, token-only query: anything else could be an SSRF or a foreign host
            if (preg_match('~^/pbxcore/api/v3/cdr:(?:download|playback)\?token=[A-Za-z0-9]+\z~', $url) === 1) {
                return $url;
            }
        }

        return '';
    }
}
