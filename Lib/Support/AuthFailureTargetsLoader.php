<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Support;

use MikoPBX\Common\Models\Sip;

/**
 * Thin Core glue: READS the Core `Sip` model (never writes) for the list of internal extensions whose
 * SIP authentication failures Core counts (same filter as `Sip\ProcessAuthFailuresAction::loadInternalExtensions`:
 * SIP accounts with `type = 'peer'`, providers are `friend`).
 */
final class AuthFailureTargetsLoader
{
    /** @return list<string> internal extension numbers */
    public static function load(): array
    {
        $rows = Sip::find([
            'conditions' => 'type = :type:',
            'bind' => ['type' => 'peer'],
            'columns' => 'extension',
        ])->toArray();

        $extensions = [];
        foreach ($rows as $row) {
            $extension = trim((string)($row['extension'] ?? ''));
            if ($extension !== '') {
                $extensions[] = $extension;
            }
        }

        return $extensions;
    }
}
