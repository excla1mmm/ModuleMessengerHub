<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/**
 * Path safety for a recording path taken from AMI (untrusted).
 *
 * The path is resolved with `realpath()` (so `..` and symlinks are followed) and must stay inside the
 * roots allowed for the event: the Core recording roots for a normal event, the module probe
 * directory for `probe = true`. A rejected path returns a normalised code only; the path itself never
 * reaches a log, a code, `last_error_code` or REST.
 */
final class PathGuard
{
    public const string CODE_REJECTED = 'attachment.path_rejected';
    public const string CODE_MISSING = 'attachment.path_missing';

    /** A single file bigger than this is never a sane voice recording for a messenger. */
    public const int MAX_SOURCE_BYTES = 1024 * 1024 * 1024;

    public function __construct(private readonly RecordingRoots $roots)
    {
    }

    /**
     * @return array{path?: string, bytes?: int, code?: string}
     */
    public function resolve(string $path, bool $probe): array
    {
        $path = trim($path);
        if ($path === '' || str_contains($path, "\0") || !str_starts_with($path, '/')) {
            return ['code' => self::CODE_REJECTED];
        }

        $real = realpath($path);
        if ($real === false) {
            return ['code' => self::CODE_MISSING];
        }
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

        $allowed = false;
        foreach ($this->allowedRoots($probe) as $root) {
            $realRoot = realpath($root);
            if ($realRoot === false || !is_dir($realRoot)) {
                continue;
            }
            if ($real === $realRoot || str_starts_with($real . '/', rtrim($realRoot, '/') . '/')) {
                $allowed = true;
                break;
            }
        }
        if (!$allowed) {
            return ['code' => self::CODE_REJECTED];
        }

        return ['path' => $real, 'bytes' => $bytes];
    }

    /** @return list<string> */
    private function allowedRoots(bool $probe): array
    {
        return $probe ? [$this->roots->probeRoot()] : $this->roots->monitorRoots();
    }
}
