<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Support;

use MikoPBX\Common\Models\PbxSettings;
use Modules\ModuleMessengerHub\Lib\Api\LocalRestBase;
use Throwable;

/**
 * Thin Core glue: READS `PbxSettings::WEB_PORT` (never writes) for the local REST base URL.
 *
 * Called by the workers each time they build their REST clients (not by Core hooks), so a changed web
 * port reaches the next client rebuild. `getValueByKey()` is used on purpose: `getPortByKey()` exists only
 * since Core 2026.6, the module supports 2025.1.1+; the value is validated by LocalRestBase instead.
 */
final class CoreWebPort
{
    private static string $reported = '';

    public static function baseUrl(): string
    {
        try {
            $raw = PbxSettings::getValueByKey(PbxSettings::WEB_PORT);
        } catch (Throwable) {
            $raw = null;
        }
        if (LocalRestBase::port($raw) === null) {
            // once per process and value: the REST sources would otherwise fail without a trace
            $value = $raw === null ? 'unreadable' : 'invalid';
            if (self::$reported !== $value) {
                self::$reported = $value;
                HubLogger::event('rest', 'web_port_' . $value, ['fallback' => LocalRestBase::DEFAULT_PORT], LOG_ERR);
            }
        }

        return LocalRestBase::forPort($raw);
    }
}
