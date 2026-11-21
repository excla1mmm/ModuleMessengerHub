<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/**
 * Module-owned temporary storage (Plan/03, decision 3a-1): `<module>/tmp/attachments` (0700) and
 * `<module>/tmp/probe` (the only source a `probe=true` event may reference).
 *
 * Nothing is ever written into Core directories; the janitor and `remove()` refuse paths outside the
 * module temp tree.
 */
final class TempDir
{
    private readonly string $root;

    public function __construct(string $moduleRoot)
    {
        $this->root = rtrim($moduleRoot, '/') . '/tmp';
    }

    /** Directory for downloaded sources and converted MP3 files. */
    public function attachmentsDir(): string
    {
        return $this->ensure($this->root . '/attachments');
    }

    /** Directory for generated probe audio (stage 3a-3); never used by a real event. */
    public function probeDir(): string
    {
        return $this->ensure($this->root . '/probe');
    }

    public function tempPath(string $prefix = 'src'): string
    {
        $safe = (string)preg_replace('/[^a-z0-9_-]/i', '', $prefix);

        return $this->attachmentsDir() . '/' . $safe . '-' . bin2hex(random_bytes(8));
    }

    /** True when the resolved path is a file inside the module attachments/probe tree. */
    public function contains(string $path): bool
    {
        $real = realpath($path);
        if ($real === false || !is_file($real)) {
            return false;
        }
        foreach ([$this->root . '/attachments', $this->root . '/probe'] as $dir) {
            $realDir = realpath($dir);
            if ($realDir !== false
                && ($real === $realDir || str_starts_with($real . '/', rtrim($realDir, '/') . '/'))) {
                return true;
            }
        }

        return false;
    }

    /**
     * Deletes one directory entry only when it is inside the module temp tree. A symlink is removed
     * itself, never its target (a planted link must not delete an arbitrary file).
     */
    public function remove(string $path): void
    {
        if (is_link($path)) {
            @unlink($path);

            return;
        }
        if ($this->contains($path)) {
            @unlink($path);
        }
    }

    /**
     * Removes files older than $maxAgeSec; prepared paths still in use are kept by the caller.
     *
     * @param list<string> $keep
     * @return int number of removed files
     */
    public function sweep(int $now, int $maxAgeSec, array $keep = []): int
    {
        $keepReal = [];
        foreach ($keep as $path) {
            $real = realpath($path);
            if ($real !== false) {
                $keepReal[$real] = true;
            }
        }
        $removed = 0;
        foreach (glob($this->root . '/*/*') ?: [] as $path) {
            if (is_link($path)) {
                if (@unlink($path)) {
                    $removed++;
                }
                continue;
            }
            $real = realpath($path);
            if ($real === false || !is_file($real) || isset($keepReal[$real])) {
                continue;
            }
            $mtime = @filemtime($real);
            if ($mtime === false || $now - $mtime < $maxAgeSec) {
                continue;
            }
            if (@unlink($path)) { // the entry inside the temp tree, not a resolved target
                $removed++;
            }
        }

        return $removed;
    }

    private function ensure(string $dir): string
    {
        if (is_link($this->root)) {
            // never follow a planted link for the whole module temp tree
            @unlink($this->root);
        }
        if (is_link($dir)) {
            // the temp tree must not be redirected through a planted symlink
            @unlink($dir);
        }
        if (!is_dir($dir)) {
            @mkdir($dir, 0700, true);
        }
        @chmod($dir, 0700);

        return $dir;
    }
}
