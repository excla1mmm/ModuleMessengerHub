<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

use Modules\ModuleMessengerHub\Lib\Channels\ChannelLimits;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

/**
 * Audio preparation with a per-event cache (Plan/03, decisions 3a-1/7).
 *
 * - one cache row per event + mode + source + fragments, so every chat of the event reuses one
 *   conversion;
 * - the cache row has its own lease: a second worker gets `busy` and postpones the row instead of
 *   converting again;
 * - the caller's row lease is extended through `$heartbeat` while a long download/conversion runs;
 * - output and downloads live only in the module temp directory.
 */
final class AttachmentService implements AttachmentPipeline
{
    private const int STALE_PREPARING_SEC = 3600;

    public function __construct(
        private readonly Converter $converter,
        private readonly RecordingLocator $locator,
        private readonly PathGuard $paths,
        private readonly PreparedRecordingsRepository $prepared,
        private readonly TempDir $tempDir,
        private readonly HubDatabase $db,
        private readonly int $preparedTtlSec = 6 * 3600,
        private readonly int $janitorAgeSec = 6 * 3600,
    ) {
    }

    public function preflight(AttachmentPlan $plan): PreflightResult
    {
        if (!$plan->available()) {
            return new PreflightResult(false, $plan->unavailableCode !== '' ? $plan->unavailableCode : RecordingLocator::CODE_SOURCE_MISSING);
        }
        if (!$this->converter->available()) {
            return new PreflightResult(false, Converter::CODE_MISSING);
        }
        if (($plan->source['type'] ?? '') === 'path') {
            $resolved = $this->paths->resolve((string)($plan->source['path'] ?? ''), $plan->probe);
            if (!isset($resolved['path'])) {
                return new PreflightResult(false, (string)($resolved['code'] ?? PathGuard::CODE_REJECTED));
            }
        }

        return new PreflightResult(true);
    }

    public function prepare(
        int $eventId,
        AttachmentPlan $plan,
        ChannelLimits $limits,
        string $owner,
        int $now,
        callable $heartbeat,
    ): PrepareResult {
        $cacheKey = $plan->cacheKey($eventId);
        $row = $this->prepared->find($cacheKey);
        if ($row !== null) {
            $state = (string)($row['status'] ?? '');
            if ($state === 'failed') {
                return PrepareResult::failed((string)($row['error_code'] ?? Converter::CODE_FAILED));
            }
            if ($state === 'ready') {
                $files = self::decodeFiles((string)($row['files_json'] ?? '[]'));
                if ($this->filesStillExist($files)) {
                    return PrepareResult::ready($files);
                }
                $this->dropRow($row);
            }
        }

        if (!$this->prepared->claim($eventId, $cacheKey, $owner, $now, 900)) {
            return PrepareResult::busy();
        }
        $row = $this->prepared->find($cacheKey);
        $id = (int)($row['id'] ?? 0);
        if ($id <= 0) {
            return PrepareResult::retry('attachment.cache_unavailable');
        }

        $alive = function () use ($id, $owner, $heartbeat): bool {
            if ($heartbeat(time()) === false) {
                return false;
            }

            return $this->prepared->extend($id, $owner, time() + 900, time());
        };
        if (!$alive()) {
            return PrepareResult::busy();
        }
        $source = $this->tempDir->tempPath('source');
        $located = $this->locator->locate($plan, $source);
        if (!$located->ok()) {
            $this->tempDir->remove($source);
            if ($located->retryable) {
                // a fresh row on the next attempt: a CDR token/network failure is not a property of the event
                $this->prepared->discard($cacheKey, $owner, time());

                return PrepareResult::retry($located->code);
            }
            $this->prepared->markFailed($id, $owner, $located->code, time());

            return PrepareResult::failed($located->code);
        }
        if (!$alive()) {
            return PrepareResult::busy();
        }

        $ranges = $plan->fragments === [] ? [null] : $plan->fragments;
        $files = [];
        foreach (array_values($ranges) as $index => $range) {
            $output = $this->tempDir->tempPath('part') . '.mp3';
            $converted = $this->converter->convert(
                $located->path,
                $output,
                is_array($range) ? $range : null,
                '',
                $alive
            );
            if ($converted->code === Converter::CODE_CANCELLED) {
                $this->tempDir->remove($output);
                $this->tempDir->remove($located->path);
                foreach ($files as $file) {
                    if (is_string($file['path'] ?? null)) {
                        $this->tempDir->remove($file['path']);
                    }
                }

                return PrepareResult::retry('delivery.lease_lost');
            }
            if (!$converted->ok()) {
                $this->tempDir->remove($output);
                $this->tempDir->remove($located->path);
                foreach ($files as $file) {
                    if (is_string($file['path'] ?? null)) {
                        $this->tempDir->remove($file['path']);
                    }
                }
                $this->prepared->markFailed($id, $owner, $converted->code, time());

                return PrepareResult::failed($converted->code);
            }
            $bytes = (int)(@filesize($converted->path) ?: 0);
            $durationMs = $converted->durationMs > 0
                ? $converted->durationMs
                : (is_array($range) ? max(0, $range['end_ms'] - $range['start_ms']) : 0);
            // The cache is shared by all chats of the event: channel size/duration limits are applied
            // per send (DeliveryService), never baked into the cached file (a MAX 60-min skip must not
            // block Telegram, which has no duration limit).
            $files[$index] = [
                'path' => $converted->path,
                'bytes' => $bytes,
                'duration_ms' => $durationMs,
                'start_ms' => is_array($range) ? (int)$range['start_ms'] : 0,
                'end_ms' => is_array($range) ? (int)$range['end_ms'] : 0,
            ];
        }
        $this->tempDir->remove($located->path);
        $this->prepared->markReady($id, $owner, $files, time());

        return PrepareResult::ready($files);
    }

    public function cleanupEvent(int $eventId, int $now): void
    {
        $active = $this->db->fetchOne(
            'SELECT COUNT(*) AS c FROM m_MessengerHubOutbox'
            . " WHERE event_id = :event AND status IN ('pending', 'sending')",
            ['event' => $eventId]
        );
        if ((int)($active['c'] ?? 0) > 0) {
            return;
        }
        foreach ($this->prepared->forEvent($eventId) as $row) {
            $this->dropRow($row);
        }
    }

    public function janitor(int $now): array
    {
        $stats = ['stale' => 0, 'expired' => 0, 'files' => 0];
        foreach ($this->prepared->stalePreparing($now, $now - self::STALE_PREPARING_SEC) as $row) {
            $this->dropRow($row);
            $stats['stale']++;
        }
        foreach ($this->prepared->staleFailed($now - $this->preparedTtlSec) as $row) {
            $this->dropRow($row);
            $stats['expired']++;
        }
        foreach ($this->prepared->unreferencedReady($now - $this->preparedTtlSec) as $row) {
            $this->dropRow($row);
            $stats['expired']++;
        }
        $stats['files'] = $this->tempDir->sweep($now, $this->janitorAgeSec, $this->prepared->activePaths());

        return $stats;
    }

    /** @param array<string, mixed> $row */
    private function dropRow(array $row, bool $deleteRow = true): void
    {
        foreach (self::decodeFiles((string)($row['files_json'] ?? '[]')) as $file) {
            if (is_string($file['path'] ?? null) && $file['path'] !== '') {
                $this->tempDir->remove($file['path']);
            }
        }
        if ($deleteRow) {
            $id = (int)($row['id'] ?? 0);
            if ($id > 0) {
                $this->prepared->delete($id);
            }
        }
    }

    /** @return array<int|string, array<string, mixed>> */
    private static function decodeFiles(string $json): array
    {
        $decoded = json_decode($json, true);
        if (!is_array($decoded)) {
            return [];
        }
        $files = [];
        foreach ($decoded as $index => $file) {
            if (is_array($file)) {
                $files[$index] = $file;
            }
        }

        return $files;
    }

    /** @param array<int|string, array<string, mixed>> $files */
    private function filesStillExist(array $files): bool
    {
        foreach ($files as $file) {
            if (!isset($file['path'])) {
                continue; // a skipped part
            }
            $path = (string)$file['path'];
            if ($path === '' || !$this->tempDir->contains($path) || (int)(@filesize($path) ?: 0) <= 0) {
                return false;
            }
        }

        return true;
    }
}
