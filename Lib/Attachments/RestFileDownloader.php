<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/**
 * Downloads a Core REST file (CDR playback/download by one-time token) into the module temp dir.
 *
 * The URL is never logged: it carries a short-lived token. Only a normalised code leaves this call.
 */
interface RestFileDownloader
{
    /**
     * @param string $pathAndQuery Core REST path with the /pbxcore prefix, e.g. "/pbxcore/api/v3/cdr:download?token=…"
     * @return string '' on success, otherwise a normalised code (http.timeout, api_not_found, file.too_large, …)
     */
    public function download(string $pathAndQuery, string $destination, int $maxBytes): string;
}
