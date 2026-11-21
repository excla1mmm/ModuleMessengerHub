<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

/**
 * Core-free decoder of the AMI "CdrConnector" AgiData header
 * (mirror of Core AsteriskManager::encodeCdrData/decodeCdrData, kept local so unit tests
 * never load Core: plain base64 JSON or "GZ:" + base64 gzip).
 */
final class AgiDataDecoder
{
    private const string GZ_PREFIX = 'GZ:';

    /**
     * @return array<string, mixed>|null decoded fields, null when the payload is not decodable
     */
    public static function decode(string $encoded): ?array
    {
        if ($encoded === '') {
            return null;
        }
        if (str_starts_with($encoded, self::GZ_PREFIX)) {
            $json = gzdecode(base64_decode(substr($encoded, strlen(self::GZ_PREFIX)), true));
        } else {
            $json = base64_decode($encoded, true);
        }
        if ($json === false) {
            return null;
        }
        try {
            $data = json_decode($json, true, 8, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }

        return is_array($data) ? $data : null;
    }
}
