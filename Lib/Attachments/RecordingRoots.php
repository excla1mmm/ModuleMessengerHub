<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/**
 * Allow-list of directories a recording path may point into (Plan/03, decision 3a-1).
 *
 * Implementations read the roots from Core constants/settings (read-only). The unit checks supply a
 * static list, so the guard itself stays Core-free.
 */
interface RecordingRoots
{
    /** @return list<string> call recording and voicemail roots (AST_MONITOR_DIR + voicemailarchive) */
    public function monitorRoots(): array;

    /** Module-owned probe directory: the only root a `probe=true` event may use. */
    public function probeRoot(): string;
}
