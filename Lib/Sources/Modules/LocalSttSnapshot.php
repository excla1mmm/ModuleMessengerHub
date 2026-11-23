<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

use Modules\ModuleMessengerHub\Lib\Api\PagedRestReader;
use Modules\ModuleMessengerHub\Lib\Api\RestReader;
use Modules\ModuleMessengerHub\Lib\Sources\SourceException;

/**
 * Reader of ModuleLocalSpeechToText `GET /workers` and `GET /jobs` (both need `admin` for an API key:
 * the module's WorkerRequestContext::isAdministrator; the hub sends GET only). Converts the rows to the
 * status snapshot shape ModuleStatusSource diffs. Decision of 2026-11-23 (Plan/11 Q10): the module ships
 * no `/status`.
 *
 * Definitions are the module's own:
 *  - a worker is online when its status is "online" AND its last_seen is not older than the offline
 *    timeout of STTWorker::markStaleOffline (900 s); the last_seen check keeps the answer right while the
 *    module's maintenance loop is not running;
 *  - worker `ref` = first 12 hex of sha256("ModuleLocalSpeechToText:<id>"), `since` = last_seen (the
 *    registration time for a worker that never reported) — equal to the values the cursors hold from the
 *    `/status` era, so switching the reader never re-alerts;
 *  - `backlog_no_workers` (ref `queue`): pending jobs exist and no worker was online for 600 s;
 *    `since` = max(latest last_seen, created_at of the oldest pending job).
 *
 * Worker names, addresses, api keys and job call ids are never read into the snapshot.
 */
final class LocalSttSnapshot
{
    public const string MODULE_ID = 'ModuleLocalSpeechToText';
    public const string WORKERS_PATH = '/pbxcore/api/v3/module-local-speech-to-text/workers';
    public const string JOBS_PATH = '/pbxcore/api/v3/module-local-speech-to-text/jobs';
    public const string WORKERS_API_PATH = '/api/v3/module-local-speech-to-text/workers';
    public const string JOBS_API_PATH = '/api/v3/module-local-speech-to-text/jobs';

    public const int OFFLINE_TIMEOUT_SEC = 900;
    public const int BACKLOG_NO_WORKERS_AFTER_SEC = 600;
    private const int PAGE_SIZE = 200;
    private const int MAX_PAGES = 10;

    /** Worker rows through the paged list (limit 200 is the module's maximum). @return list<array<string, mixed>> */
    public static function readWorkers(RestReader $rest): array
    {
        $rows = [];
        for ($page = 0; $page < self::MAX_PAGES; $page++) {
            $data = $rest->get(self::WORKERS_PATH, ['limit' => self::PAGE_SIZE, 'offset' => $page * self::PAGE_SIZE]);
            if (!array_is_list($data)) {
                throw new SourceException('api_bad_response');
            }
            foreach ($data as $row) {
                if (is_array($row)) {
                    $rows[] = $row;
                }
            }
            if (count($data) < self::PAGE_SIZE) {
                return $rows;
            }
        }

        return $rows;
    }

    /**
     * Number of pending jobs and created_at of the oldest one: two one-row reads of /jobs
     * (the list is ordered by id descending, so the oldest job is the last row).
     *
     * @return array{waiting: int, oldest_created_at: int}
     */
    public static function readPendingJobs(RestReader $rest): array
    {
        if (!$rest instanceof PagedRestReader) {
            throw new SourceException('api_bad_response');
        }
        $query = ['status' => 'pending', 'limit' => 1];
        $first = $rest->getPage(self::JOBS_PATH, $query);
        if (!is_int($first['pagination']['total_items'] ?? null) || !array_is_list($first['data'])) {
            throw new SourceException('api_bad_response');
        }
        $total = $first['pagination']['total_items'];
        if ($total <= 0) {
            return ['waiting' => 0, 'oldest_created_at' => 0];
        }
        $oldest = $first['data'];
        if ($total > 1) {
            $oldest = $rest->get(self::JOBS_PATH, $query + ['offset' => $total - 1]);
            if (!array_is_list($oldest)) {
                throw new SourceException('api_bad_response');
            }
        }
        $row = $oldest[0] ?? null;

        return [
            'waiting' => $total,
            'oldest_created_at' => is_array($row) ? max(0, (int)($row['created_at'] ?? 0)) : 0,
        ];
    }

    /**
     * Workers only: the offline issues and the counters. Whether any worker is online decides
     * whether the backlog source needs /jobs at all.
     *
     * @param list<array<string, mixed>> $rows
     * @return array{issues: list<array<string, mixed>>, online: int, total: int, last_seen_any: int}
     */
    public static function workers(array $rows, int $now): array
    {
        $online = 0;
        $total = 0;
        $lastSeenAny = 0;
        $issues = [];
        foreach ($rows as $row) {
            $id = (int)($row['id'] ?? 0);
            if ($id <= 0) {
                continue; // no stable id: the same ref cannot be built
            }
            $total++;
            $lastSeen = max(0, (int)($row['last_seen'] ?? 0));
            $lastSeenAny = max($lastSeenAny, $lastSeen);
            if ((string)($row['status'] ?? '') === 'online'
                && $lastSeen > 0
                && $lastSeen >= $now - self::OFFLINE_TIMEOUT_SEC) {
                $online++;
                continue;
            }
            $issues[] = [
                'code' => 'worker_offline',
                'ref' => self::workerRef($id),
                'severity' => 'warning',
                'since' => $lastSeen > 0 ? $lastSeen : max(0, (int)($row['created_at'] ?? 0)),
            ];
        }

        return ['issues' => $issues, 'online' => $online, 'total' => $total, 'last_seen_any' => $lastSeenAny];
    }

    /**
     * @param array{issues: list<array<string, mixed>>, online: int, total: int, last_seen_any: int} $workers
     * @param int|null $jobsWaiting null when /jobs was not read (some worker is online)
     * @return array{state: string, since: int, issues: list<array<string, mixed>>, counters: array<string, int>}
     */
    public static function snapshot(array $workers, ?int $jobsWaiting, int $oldestCreatedAt, int $now): array
    {
        $issues = $workers['issues'];
        if ($jobsWaiting !== null && $jobsWaiting > 0 && $workers['online'] === 0) {
            $backlogSince = max($workers['last_seen_any'], max(0, $oldestCreatedAt));
            if ($now - $backlogSince >= self::BACKLOG_NO_WORKERS_AFTER_SEC) {
                $issues[] = [
                    'code' => 'backlog_no_workers',
                    'ref' => 'queue',
                    'severity' => 'critical',
                    'since' => $backlogSince,
                ];
            }
        }
        usort($issues, static fn (array $a, array $b): int => [$a['code'], $a['ref']] <=> [$b['code'], $b['ref']]);

        $state = 'ok';
        $since = 0;
        foreach ($issues as $issue) {
            $state = $issue['severity'] === 'critical' ? 'down' : ($state === 'down' ? 'down' : 'degraded');
            $since = max($since, (int)$issue['since']);
        }
        $counters = ['workers_online' => $workers['online'], 'workers_total' => $workers['total']];
        if ($jobsWaiting !== null) {
            $counters['jobs_waiting'] = max(0, $jobsWaiting);
        }

        return ['state' => $state, 'since' => $since, 'issues' => $issues, 'counters' => $counters];
    }

    /** First 12 hex of sha256("ModuleLocalSpeechToText:<id>"). */
    public static function workerRef(int $workerId): string
    {
        return substr(hash('sha256', self::MODULE_ID . ':' . $workerId), 0, 12);
    }
}
