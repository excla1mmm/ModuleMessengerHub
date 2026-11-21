<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

use MikoPBX\Core\System\Directories;

/**
 * Core recording roots (Plan/03, "Безопасность пути").
 *
 * Read-only glue over Core constants: the only two places MikoPBX keeps call/voicemail audio are
 * `AST_MONITOR_DIR` (call recordings and the voicemail INBOX copies made by `VoiceMailConf`) and its
 * sibling `voicemailarchive` (see `MikoPBX\Core\System\Storage::getStorageCategoryPaths`). Nothing is
 * written to either directory.
 */
final class CoreRecordingRoots implements RecordingRoots
{
    public function __construct(private readonly string $probeRoot)
    {
    }

    public function monitorRoots(): array
    {
        $monitor = (string)Directories::getDir(Directories::AST_MONITOR_DIR);

        return $monitor === '' ? [] : [$monitor, dirname($monitor) . '/voicemailarchive'];
    }

    public function probeRoot(): string
    {
        return $this->probeRoot;
    }
}
