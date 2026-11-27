<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/**
 * Path safety for a recording path taken from AMI (untrusted).
 *
 * - `probe = true`: the path is resolved with `realpath()` (so `..` and symlinks are followed) and must
 *   stay inside the module probe directory.
 * - a real event (only `core.voicemail` carries a path): the path must be the voicemail INBOX copy of
 *   this very call, `<monitor root>/Y/m/d/INBOX/<linkedid>.(webm|wav|mp3)`. Any other file under the
 *   monitor root (a call recording of another conversation) is rejected, so a forged `voicemail_end`
 *   from another AMI client cannot send an arbitrary recording to a chat.
 *
 * Core `sbin/voicemail-sender` publishes the `.webm` name, but at that moment only the `.wav` copy
 * exists: WorkerCdr queues the conversion and WorkerWav2Webm writes the `.webm` seconds later (and
 * deletes the `.wav` once the `.webm` is validated). So the guard picks the first existing sibling in
 * the order `.wav` (complete as soon as the event fires, while a present `.webm` may still be written by
 * ffmpeg), `.webm`, `.mp3`.
 *
 * Roots are checked right after `realpath()`, before anything else is learned about the file. A rejected
 * path returns a normalised code only; the path itself never reaches a log, a code, `last_error_code` or
 * REST.
 */
final class PathGuard
{
    public const string CODE_REJECTED = 'attachment.path_rejected';
    public const string CODE_MISSING = 'attachment.path_missing';

    /** A single file bigger than this is never a sane voice recording for a messenger. */
    public const int MAX_SOURCE_BYTES = 1024 * 1024 * 1024;

    /** Sibling order of a voicemail copy: the source `.wav` first (see the class comment). */
    public const array VOICEMAIL_EXTENSIONS = ['wav', 'webm', 'mp3'];

    public function __construct(private readonly RecordingRoots $roots)
    {
    }

    /**
     * @param string $linkedid the event's own call; required for a real (non-probe) event
     * @return array{path?: string, bytes?: int, code?: string}
     */
    public function resolve(string $path, bool $probe, string $linkedid = ''): array
    {
        $path = trim($path);
        if ($path === '' || str_contains($path, "\0") || !str_starts_with($path, '/')) {
            return ['code' => self::CODE_REJECTED];
        }

        return $probe ? $this->resolveProbe($path) : $this->resolveVoicemail($path, trim($linkedid));
    }

    /** @return array{path?: string, bytes?: int, code?: string} */
    private function resolveProbe(string $path): array
    {
        $real = realpath($path);
        if ($real === false) {
            return ['code' => self::CODE_MISSING];
        }
        if (!self::inside($real, $this->roots->probeRoot())) {
            return ['code' => self::CODE_REJECTED];
        }

        return self::readable($real);
    }

    /** @return array{path?: string, bytes?: int, code?: string} */
    private function resolveVoicemail(string $path, string $linkedid): array
    {
        // a linkedid that could leave the directory or hide a dot-file is never a file stem
        if ($linkedid === '' || preg_match('~^[A-Za-z0-9_-][A-Za-z0-9._-]*\z~', $linkedid) !== 1) {
            return ['code' => self::CODE_REJECTED];
        }
        if (preg_match('~^' . preg_quote($linkedid, '~') . '\.(?:webm|wav|mp3)\z~', basename($path)) !== 1) {
            return ['code' => self::CODE_REJECTED];
        }

        // the directory exists even while the published `.webm` does not
        $dir = realpath(dirname($path));
        if ($dir === false || !is_dir($dir) || !$this->isInboxDir($dir)) {
            return ['code' => self::CODE_REJECTED];
        }

        foreach (self::VOICEMAIL_EXTENSIONS as $extension) {
            $candidate = $dir . '/' . $linkedid . '.' . $extension;
            $real = realpath($candidate);
            if ($real === false) {
                continue;
            }
            if ($real !== $candidate) {
                // a symlink: the INBOX copy is always a plain file made by Core
                return ['code' => self::CODE_REJECTED];
            }
            $resolved = self::readable($real);
            if (isset($resolved['path'])) {
                return $resolved;
            }
            if (($resolved['code'] ?? '') === self::CODE_REJECTED) {
                return $resolved;
            }
            // an empty sibling (a `.webm` ffmpeg has just opened) is skipped, the next one is tried
        }

        return ['code' => self::CODE_MISSING];
    }

    /** `<monitor root>/YYYY/MM/DD/INBOX`, compared on resolved paths. */
    private function isInboxDir(string $realDir): bool
    {
        foreach ($this->roots->monitorRoots() as $root) {
            $realRoot = realpath($root);
            if ($realRoot === false || !is_dir($realRoot)) {
                continue;
            }
            $prefix = rtrim($realRoot, '/') . '/';
            if (!str_starts_with($realDir, $prefix)) {
                continue;
            }
            if (preg_match('~^\d{4}/\d{2}/\d{2}/INBOX\z~', substr($realDir, strlen($prefix))) === 1) {
                return true;
            }
        }

        return false;
    }

    private static function inside(string $real, string $root): bool
    {
        $realRoot = realpath($root);
        if ($realRoot === false || !is_dir($realRoot)) {
            return false;
        }

        return $real === $realRoot || str_starts_with($real . '/', rtrim($realRoot, '/') . '/');
    }

    /** @return array{path?: string, bytes?: int, code?: string} */
    private static function readable(string $real): array
    {
        if (!is_file($real) || !is_readable($real)) {
            return ['code' => self::CODE_MISSING];
        }
        $bytes = @filesize($real);
        if ($bytes === false || $bytes <= 0) {
            return ['code' => self::CODE_MISSING];
        }
        if ($bytes > self::MAX_SOURCE_BYTES) {
            return ['code' => self::CODE_REJECTED];
        }

        return ['path' => $real, 'bytes' => $bytes];
    }
}
