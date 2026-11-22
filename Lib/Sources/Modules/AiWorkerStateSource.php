<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

use Modules\ModuleMessengerHub\Lib\Sources\SourceException;

/**
 * Reader of ModuleAISupervisor `GET /pbxcore/api/v3/module-ai-supervisor/workers` (stage 1.3).
 *
 * Since stage 3b-1 this is no longer a source of its own: it is the fallback reader used by
 * ModuleStatusSource while the installed AI Supervisor version does not serve `/status` yet.
 * It converts worker rows to the same status snapshot shape as `/status` (fixed code, opaque
 * ref, stable since, integer counters) and computes the ref exactly like the module's own
 * StatusBuilder, so both readers produce identical dedupe keys.
 *
 * TODO(#1): remove this reader and the `read` grant on `/workers` once ModuleAISupervisor ships
 * `/status` in a release (then ModuleStatusSource reads `/status` only).
 */
final class AiWorkerStateSource
{
    public const string API_READ_PATH = '/api/v3/module-ai-supervisor/workers';
    public const string PATH = '/pbxcore' . self::API_READ_PATH;

    public const string MODULE_ID = 'ModuleAISupervisor';
    public const int INACTIVITY_RETENTION_SECONDS = 30 * 86400;

    /**
     * `/workers` response → status snapshot (state, since, issues, counters).
     *
     * @param array<string, mixed> $data PBXApiResult data (`items` is the worker list)
     * @return array{state: string, since: int, issues: list<array<string, mixed>>, counters: array<string, int>}
     */
    public static function snapshot(array $data, int $now): array
    {
        if (!is_array($data['items'] ?? null)) {
            throw new SourceException('api_bad_response');
        }

        $cutoff = $now - self::INACTIVITY_RETENTION_SECONDS;
        $total = 0;
        $online = 0;
        $issues = [];

        foreach ($data['items'] as $item) {
            if (!is_array($item)) {
                continue;
            }
            $internalId = trim((string)($item['id'] ?? ''));
            if ($internalId === '') {
                continue; // no stable id — cannot build the same ref as /status
            }
            $lastSeen = max(0, (int)($item['last_seen'] ?? 0));
            if ($lastSeen > 0 && $lastSeen < $cutoff) {
                // GET /workers already hides these; keep the answer identical to /status
                continue;
            }
            $total++;
            $status = (string)($item['status'] ?? '');
            if ($status === 'online') {
                $online++;
                continue;
            }
            $issues[] = [
                'code' => 'worker_offline',
                'ref' => self::ref($internalId),
                'severity' => 'warning',
                'since' => self::since($item, $lastSeen),
            ];
        }

        usort($issues, static fn (array $a, array $b): int => strcmp((string)$a['ref'], (string)$b['ref']));

        $state = 'ok';
        $since = 0;
        if ($issues !== []) {
            // every known worker is offline -> nothing can analyse calls (same rule as /status)
            $state = $online === 0 ? 'down' : 'degraded';
            $since = max(array_map(static fn (array $issue): int => (int)$issue['since'], $issues));
        }

        return [
            'state' => $state,
            'since' => $since,
            'issues' => $issues,
            'counters' => ['workers_online' => $online, 'workers_total' => $total],
        ];
    }

    /** Same opaque ref as ModuleAISupervisor's StatusBuilder: first 12 hex of sha256("<Module>:<id>"). */
    public static function ref(string $internalId): string
    {
        return substr(hash('sha256', self::MODULE_ID . ':' . $internalId), 0, 12);
    }

    /** @param array<string, mixed> $item */
    private static function since(array $item, int $lastSeen): int
    {
        if ($lastSeen > 0) {
            return $lastSeen;
        }
        // a worker that never reported: the module uses max(updated_at, created_at); /workers
        // does not expose them, so an unknown start is 0 (stable across both readers).
        return max(0, (int)($item['updated_at'] ?? 0), (int)($item['created_at'] ?? 0));
    }
}
