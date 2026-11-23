<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceException;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;

/**
 * Source of module problems with baseline, debounce and recovery (stage 3b, GitHub issue #1).
 *
 * The state of a module reaches the diff as a status snapshot (`state`, `since`, `issues[code, ref,
 * severity, since]`, `counters`). Where it comes from depends on the module (decision of 2026-11-23):
 *  - ModuleCloudSpeechToText serves the uniform `GET /pbxcore/api/v3/module-cloud-speech-to-text/status`
 *    (min version 1.120) -> reader `status`;
 *  - ModuleAISupervisor: `GET /workers` -> AiWorkerStateSource;
 *  - ModuleCloudAISupervisor: `GET /runtime` -> CloudAiRuntimeSnapshot;
 *  - ModuleLocalSpeechToText: `GET /workers` (+ `GET /jobs` for the backlog) -> LocalSttSnapshot.
 * The three modules do not ship `/status`; the hub never writes to them and never reads their tables.
 *
 * One class, one config entry per kind of problem (ModuleStatusSource::PROFILES):
 *  - diff by (code, ref) between polls, cursor in m_MessengerHubSourceState;
 *  - appearance -> event, disappearance -> recovery event where the profile defines one;
 *  - baseline on enable and on the first successful poll after the module becomes available:
 *    issues already present are recorded as known and never broadcast (history is not broadcast);
 *  - dedupe key `<source>:<code>:<ref>:<episode since>` (never the top-level `since`), so a restart,
 *    a re-poll, an acknowledged Cloud STT incident or a switch of the reader never re-alerts; a `since`
 *    that moves while the pair stays present is one incident (no event, no new debounce); a pair absent
 *    in the previous poll starts a new episode; recovery is sent only for an announced incident;
 *  - debounce: an issue must be observed for N seconds before the event (per code, e.g. 120 s for
 *    worker_offline, 0 for billing), which suppresses a worker blinking offline/online;
 *  - a 404 on the resource means the installed module version is older than the contract:
 *    availability `api_incompatible`, no events, no log noise, and the cursor is re-baselined once the
 *    module is updated (Collector).
 *
 * One source (= one wizard scenario) per kind of problem; each polls once a minute and handles only
 * its own codes.
 */
final class ModuleStatusSource implements SourceInterface
{
    public const string SOURCE_LOCAL_STT_WORKERS = 'local_stt.workers';
    public const string SOURCE_LOCAL_STT_BACKLOG = 'local_stt.backlog';
    public const string SOURCE_CLOUD_STT_INCIDENTS = 'cloud_stt.incidents';
    public const string SOURCE_CLOUD_STT_PAUSED = 'cloud_stt.paused';
    public const string SOURCE_CLOUD_AI_PAUSED = 'cloud_ai.paused';
    /** Historical id (stage 1.3): keeps the user's enabled switch, cursor and the event family. */
    public const string SOURCE_AI_SUPERVISOR = 'ai_supervisor.workers';

    public const string EVENT_LOCAL_STT_WORKER_OFFLINE = 'local_stt.worker_offline';
    public const string EVENT_LOCAL_STT_WORKER_ONLINE = 'local_stt.worker_online';
    public const string EVENT_LOCAL_STT_BACKLOG = 'local_stt.backlog_no_workers';
    public const string EVENT_LOCAL_STT_BACKLOG_RESOLVED = 'local_stt.backlog_resolved';
    public const string EVENT_CLOUD_STT_INCIDENT = 'cloud_stt.incident';
    public const string EVENT_CLOUD_STT_INCIDENT_RESOLVED = 'cloud_stt.incident_resolved';
    public const string EVENT_CLOUD_STT_PAUSED = 'cloud_stt.paused';
    public const string EVENT_CLOUD_STT_RESUMED = 'cloud_stt.resumed';
    public const string EVENT_CLOUD_AI_PAUSED = 'cloud_ai.paused';
    public const string EVENT_CLOUD_AI_RESUMED = 'cloud_ai.resumed';
    public const string EVENT_AI_SUPERVISOR_WORKER_OFFLINE = 'ai_supervisor.worker_offline';
    public const string EVENT_AI_SUPERVISOR_WORKER_ONLINE = 'ai_supervisor.worker_online';

    public const int POLL_INTERVAL_SEC = 60;
    public const int MAX_TRACKED_ISSUES = 500;
    private const int MAX_REF_LENGTH = 120;
    private const array STATUS_STATES = ['ok', 'degraded', 'down', 'paused'];

    /** How the snapshot is obtained (ModuleStatusProfile::$reader). */
    public const string READER_STATUS = 'status';
    public const string READER_AI_WORKERS = 'ai_workers';
    public const string READER_CLOUD_AI_RUNTIME = 'cloud_ai_runtime';
    public const string READER_LOCAL_STT_WORKERS = 'local_stt_workers';
    public const string READER_LOCAL_STT_BACKLOG = 'local_stt_backlog';

    /** source id => profile config; one source per kind of problem. */
    private const array PROFILES = [
        self::SOURCE_LOCAL_STT_WORKERS => [
            'module' => 'ModuleLocalSpeechToText',
            'reader' => self::READER_LOCAL_STT_WORKERS,
            'paths' => [LocalSttSnapshot::WORKERS_API_PATH],
            'min_version' => '',
            'rules' => [
                [
                    'code' => 'worker_offline',
                    'event' => self::EVENT_LOCAL_STT_WORKER_OFFLINE,
                    'recovery' => self::EVENT_LOCAL_STT_WORKER_ONLINE,
                    'severity' => HubEvent::SEVERITY_WARNING,
                    'debounce' => 120,
                ],
            ],
        ],
        self::SOURCE_LOCAL_STT_BACKLOG => [
            'module' => 'ModuleLocalSpeechToText',
            'reader' => self::READER_LOCAL_STT_BACKLOG,
            'paths' => [LocalSttSnapshot::WORKERS_API_PATH, LocalSttSnapshot::JOBS_API_PATH],
            'min_version' => '',
            'rules' => [
                [
                    'code' => 'backlog_no_workers',
                    'event' => self::EVENT_LOCAL_STT_BACKLOG,
                    'recovery' => self::EVENT_LOCAL_STT_BACKLOG_RESOLVED,
                    'severity' => HubEvent::SEVERITY_CRITICAL,
                    'debounce' => 0,
                ],
            ],
        ],
        self::SOURCE_CLOUD_STT_INCIDENTS => [
            'module' => 'ModuleCloudSpeechToText',
            'reader' => self::READER_STATUS,
            'paths' => ['/api/v3/module-cloud-speech-to-text/status'],
            'min_version' => '1.120',
            'rules' => [
                [
                    // one event per incident public id; an acknowledged incident stays open in
                    // the module, the stable `since` keeps the dedupe key identical
                    'code' => 'incident_open',
                    'event' => self::EVENT_CLOUD_STT_INCIDENT,
                    'recovery' => self::EVENT_CLOUD_STT_INCIDENT_RESOLVED,
                    'severity' => HubEvent::SEVERITY_WARNING,
                    'debounce' => 0,
                ],
            ],
        ],
        self::SOURCE_CLOUD_STT_PAUSED => [
            'module' => 'ModuleCloudSpeechToText',
            'reader' => self::READER_STATUS,
            'paths' => ['/api/v3/module-cloud-speech-to-text/status'],
            'min_version' => '1.120',
            'rules' => [
                [
                    'code' => 'processing_paused',
                    'event' => self::EVENT_CLOUD_STT_PAUSED,
                    'recovery' => self::EVENT_CLOUD_STT_RESUMED,
                    'severity' => HubEvent::SEVERITY_WARNING,
                    'debounce' => 0,
                ],
            ],
        ],
        self::SOURCE_CLOUD_AI_PAUSED => [
            'module' => 'ModuleCloudAISupervisor',
            'reader' => self::READER_CLOUD_AI_RUNTIME,
            'paths' => [CloudAiRuntimeSnapshot::API_PATH],
            // /runtime with the `pause` block exists only in the develop branch of ModuleCloudAISupervisor,
            // not in its released master: a 404 is api_incompatible (generic "update the module" hint while
            // min_version is empty).
            // TODO(release): set min_version to the first Cloud AI release that ships /runtime.
            'min_version' => '',
            'rules' => [
                [
                    'code' => 'processing_paused',
                    'event' => self::EVENT_CLOUD_AI_PAUSED,
                    'recovery' => self::EVENT_CLOUD_AI_RESUMED,
                    'severity' => HubEvent::SEVERITY_WARNING,
                    'debounce' => 0,
                    'severity_by_ref' => [
                        'manual' => HubEvent::SEVERITY_INFO,
                        'license_missing' => HubEvent::SEVERITY_WARNING,
                        'auth_invalid' => HubEvent::SEVERITY_WARNING,
                        'model_unavailable' => HubEvent::SEVERITY_WARNING,
                        'daily_limit_reached' => HubEvent::SEVERITY_WARNING,
                        'source_unavailable' => HubEvent::SEVERITY_WARNING,
                        'insufficient_funds' => HubEvent::SEVERITY_CRITICAL,
                        'low_balance' => HubEvent::SEVERITY_CRITICAL,
                    ],
                    // a PBX that never configured cloud AI is permanently paused: no events
                    'ignore_refs' => ['not_configured'],
                ],
            ],
        ],
        self::SOURCE_AI_SUPERVISOR => [
            'module' => 'ModuleAISupervisor',
            'reader' => self::READER_AI_WORKERS,
            'paths' => [AiWorkerStateSource::API_READ_PATH],
            'min_version' => '',
            'rules' => [
                [
                    'code' => 'worker_offline',
                    'event' => self::EVENT_AI_SUPERVISOR_WORKER_OFFLINE,
                    'recovery' => self::EVENT_AI_SUPERVISOR_WORKER_ONLINE,
                    'severity' => HubEvent::SEVERITY_WARNING,
                    'debounce' => 120,
                ],
            ],
        ],
    ];

    public function __construct(private readonly ModuleStatusProfile $profile)
    {
    }

    /** @return list<ModuleStatusProfile> */
    public static function profiles(): array
    {
        $profiles = [];
        foreach (self::PROFILES as $sourceId => $config) {
            $profiles[] = self::buildProfile($sourceId, $config);
        }

        return $profiles;
    }

    public static function profileFor(string $sourceId): ?ModuleStatusProfile
    {
        $config = self::PROFILES[$sourceId] ?? null;

        return is_array($config) ? self::buildProfile($sourceId, $config) : null;
    }

    public function id(): string
    {
        return $this->profile->sourceId;
    }

    public function eventTypes(): array
    {
        return $this->profile->eventTypes();
    }

    public function requiredModule(): ?string
    {
        return $this->profile->moduleId;
    }

    /**
     * The resources this source reads. The level of each (read, admin for the two Local STT paths)
     * is decided by Lib/Api/KeyPermissions, never here.
     */
    public function apiReadPaths(): array
    {
        return $this->profile->readPaths;
    }

    public function mode(): string
    {
        return SourceInterface::MODE_POLL;
    }

    public function pollIntervalSec(): int
    {
        return self::POLL_INTERVAL_SEC;
    }

    public function poll(SourceContext $context, array $cursor): SourceBatch
    {
        return self::buildBatch($this->profile, $this->readSnapshot($context), $cursor, $context->now());
    }

    /**
     * Pure diff of two status snapshots (no I/O, used by the poll and the contract checks).
     *
     * @param array{state: string, since: int, issues: list<array<string, mixed>>, counters: array<string, int>} $snapshot
     * @param array<string, mixed> $cursor
     */
    public static function buildBatch(
        ModuleStatusProfile $profile,
        array $snapshot,
        array $cursor,
        int $now
    ): SourceBatch {
        $current = [];
        foreach ($snapshot['issues'] as $issue) {
            $code = (string)$issue['code'];
            $ref = (string)$issue['ref'];
            $rule = $profile->rule($code);
            if ($rule === null || $rule->ignores($ref)) {
                continue; // unknown code or an ignored configuration state: never guess an event
            }
            $current[$code . '|' . $ref] = [
                'code' => $code,
                'ref' => $ref,
                'severity' => $rule->severityFor($ref, (string)$issue['severity']),
                'since' => max(0, (int)$issue['since']),
            ];
        }

        // no cursor at all (new source, re-enabled, or a stage-1.3 cursor without `issues`) — the first
        // successful poll records what is already broken as known and stays silent (issue #1 item 6)
        if ($cursor === [] || !array_key_exists('issues', $cursor)) {
            $issues = [];
            foreach ($current as $key => $issue) {
                $issues[$key] = self::startEpisode($issue, $now, false, '');
            }

            return SourceBatch::baseline(self::nextCursor($issues, [], $snapshot));
        }

        $known = is_array($cursor['issues'] ?? null) ? $cursor['issues'] : [];
        $closed = is_array($cursor['closed'] ?? null) ? $cursor['closed'] : [];
        $events = [];
        $issues = [];

        foreach ($current as $key => $issue) {
            $previous = is_array($known[$key] ?? null) ? $known[$key] : null;
            $rule = $profile->rule($issue['code']);
            if ($rule === null) {
                continue;
            }

            if ($previous === null) {
                // the pair was absent in the previous poll: a new episode. If an announced episode of
                // this pair already used the same module `since`, the key gets the hub's first-seen
                // time so the dedupe table does not swallow the new announcement.
                $tag = array_key_exists($key, $closed) && (int)$closed[$key] === $issue['since']
                    ? (string)$now
                    : '';
                $entry = self::startEpisode($issue, $now, false, $tag);
                if ($rule->debounceSec > 0) {
                    $entry['pending'] = true;
                } else {
                    $events[] = self::event($profile, $entry, $rule, $snapshot, $now, false);
                    $entry['announced'] = true;
                }
                $issues[$key] = $entry;
                continue;
            }

            // continuously present: one incident even when the module moves `since` (Cloud STT
            // maintenance, Local STT backlog); keep the episode identity, refresh the observed fields
            $entry = $previous;
            $entry['episode_since'] = (int)($previous['episode_since'] ?? $previous['since'] ?? $issue['since']);
            $entry['episode_tag'] = (string)($previous['episode_tag'] ?? '');
            $entry['severity'] = $issue['severity'];
            $entry['since'] = $issue['since'];
            $entry['last_seen'] = $now;
            $entry['first_seen'] = (int)($previous['first_seen'] ?? $now);
            $entry['pending'] = (bool)($previous['pending'] ?? false);
            $entry['announced'] = (bool)($previous['announced'] ?? false);
            if ($entry['pending'] && $now - $entry['first_seen'] >= $rule->debounceSec) {
                $events[] = self::event($profile, $entry, $rule, $snapshot, $now, false);
                $entry['pending'] = false;
                $entry['announced'] = true;
            }
            $issues[$key] = $entry;
        }

        foreach ($known as $key => $previous) {
            if (isset($current[$key]) || !is_array($previous)) {
                continue; // still present, or a cursor entry we cannot read
            }
            // recovery only for an incident that was announced; baseline-known pairs and pairs that
            // never passed debounce disappear silently
            if ((bool)($previous['announced'] ?? false) && (string)($previous['code'] ?? '') !== '') {
                $rule = $profile->rule((string)$previous['code']);
                $episodeSince = (int)($previous['episode_since'] ?? $previous['since'] ?? 0);
                if ($rule !== null && $rule->recoveryEventType !== null) {
                    $events[] = self::event(
                        $profile,
                        [
                            'code' => (string)$previous['code'],
                            'ref' => (string)$previous['ref'],
                            'severity' => (string)($previous['severity'] ?? $rule->severity),
                            'since' => max(0, (int)($previous['since'] ?? 0)),
                            'episode_since' => $episodeSince,
                            'episode_tag' => (string)($previous['episode_tag'] ?? ''),
                        ],
                        $rule,
                        $snapshot,
                        $now,
                        true
                    );
                }
                $closed[$key] = $episodeSince;
            }
        }

        return new SourceBatch($events, self::nextCursor($issues, $closed, $snapshot));
    }

    /**
     * @param array<string, mixed> $issue
     * @return array<string, mixed>
     */
    private static function startEpisode(array $issue, int $now, bool $announced, string $tag): array
    {
        return $issue + [
            'first_seen' => $now,
            'last_seen' => $now,
            'pending' => false,
            'announced' => $announced,
            // the module `since` at the first observation and the tag form the dedupe identity of
            // the episode; later `since` moves do not change it
            'episode_since' => $issue['since'],
            'episode_tag' => $tag,
        ];
    }

    /**
     * Normalises a `/status` answer. A response without a readable `issues` array or with an unknown
     * `state` is an error, never "everything is fine": a broken answer must not look like a recovery.
     *
     * @param array<string, mixed> $data
     * @return array{state: string, since: int, issues: list<array<string, mixed>>, counters: array<string, int>}
     */
    public static function snapshot(array $data): array
    {
        if (!is_array($data['issues'] ?? null)) {
            throw new SourceException('api_bad_response');
        }
        $state = strtolower(trim((string)($data['state'] ?? '')));
        if (!in_array($state, self::STATUS_STATES, true)) {
            throw new SourceException('api_bad_response');
        }

        $issues = [];
        foreach ($data['issues'] as $issue) {
            if (!is_array($issue)) {
                continue;
            }
            $code = trim((string)($issue['code'] ?? ''));
            $ref = trim((string)($issue['ref'] ?? ''));
            if ($code === '' || $ref === '' || strlen($ref) > self::MAX_REF_LENGTH) {
                continue; // malformed pair: skip rather than invent a key
            }
            $issues[] = [
                'code' => $code,
                'ref' => $ref,
                'severity' => strtolower(trim((string)($issue['severity'] ?? ''))),
                'since' => max(0, (int)($issue['since'] ?? 0)),
            ];
        }

        $counters = [];
        foreach ((array)($data['counters'] ?? []) as $name => $value) {
            if (is_int($value) || (is_string($value) && preg_match('/^\d+$/', $value) === 1)) {
                $counters[(string)$name] = (int)$value;
            }
        }

        return [
            'state' => $state,
            // the top-level `since` is informational only and is never used in a dedupe key
            'since' => max(0, (int)($data['since'] ?? 0)),
            'issues' => $issues,
            'counters' => $counters,
        ];
    }

    /** @return array{state: string, since: int, issues: list<array<string, mixed>>, counters: array<string, int>} */
    private function readSnapshot(SourceContext $context): array
    {
        try {
            $now = $context->now();

            return match ($this->profile->reader) {
                self::READER_STATUS => self::snapshot($context->rest->get($this->profile->primaryPath())),
                self::READER_AI_WORKERS => AiWorkerStateSource::snapshot(
                    $context->rest->get(AiWorkerStateSource::PATH),
                    $now
                ),
                self::READER_CLOUD_AI_RUNTIME => CloudAiRuntimeSnapshot::snapshot(
                    $context->rest->get(CloudAiRuntimeSnapshot::PATH)
                ),
                self::READER_LOCAL_STT_WORKERS => LocalSttSnapshot::snapshot(
                    LocalSttSnapshot::workers(LocalSttSnapshot::readWorkers($context->rest), $now),
                    null,
                    0,
                    $now
                ),
                self::READER_LOCAL_STT_BACKLOG => $this->readLocalSttBacklog($context, $now),
                default => throw new SourceException('api_bad_response'),
            };
        } catch (SourceException $exception) {
            if ($exception->errorCode === 'api_not_found') {
                // an older module version without the resource: "update the module", not an error
                throw new SourceException('api_incompatible', $this->profile->minVersion);
            }
            throw $exception;
        }
    }

    /**
     * The jobs are read only while no worker is online: with an online worker there is no backlog problem
     * and the poll stays one cheap request.
     *
     * @return array{state: string, since: int, issues: list<array<string, mixed>>, counters: array<string, int>}
     */
    private function readLocalSttBacklog(SourceContext $context, int $now): array
    {
        $workers = LocalSttSnapshot::workers(LocalSttSnapshot::readWorkers($context->rest), $now);
        if ($workers['online'] > 0) {
            return LocalSttSnapshot::snapshot($workers, null, 0, $now);
        }
        $jobs = LocalSttSnapshot::readPendingJobs($context->rest);

        return LocalSttSnapshot::snapshot($workers, $jobs['waiting'], $jobs['oldest_created_at'], $now);
    }

    /**
     * @param array<string, mixed> $issue
     * @param array{state: string, since: int, issues: list<array<string, mixed>>, counters: array<string, int>} $snapshot
     */
    private static function event(
        ModuleStatusProfile $profile,
        array $issue,
        ModuleStatusRule $rule,
        array $snapshot,
        int $now,
        bool $recovered
    ): HubEvent {
        $code = (string)$issue['code'];
        $ref = (string)$issue['ref'];
        $since = max(0, (int)$issue['since']);
        $episodeSince = max(0, (int)($issue['episode_since'] ?? $since));
        $tag = (string)($issue['episode_tag'] ?? '');
        $dedupe = $profile->sourceId . ':' . $code . ':' . $ref . ':' . $episodeSince;
        if ($tag !== '') {
            $dedupe .= ':' . $tag;
        }
        if ($recovered) {
            $dedupe .= ':recovered';
        }

        return new HubEvent(
            sourceId: $profile->sourceId,
            eventType: $recovered ? (string)$rule->recoveryEventType : $rule->eventType,
            severity: $recovered ? HubEvent::SEVERITY_INFO : (string)$issue['severity'],
            dedupeKey: $dedupe,
            occurredAt: $now,
            payload: [
                'subject' => [
                    'call' => null,
                    'client_number' => '',
                    'employees' => [],
                    'provider' => null,
                    'module_status' => [
                        'module' => $profile->moduleId,
                        'source' => $profile->sourceId,
                        'state' => $snapshot['state'],
                        'code' => $code,
                        'ref' => $ref,
                        'severity' => (string)$issue['severity'],
                        'since' => $since,
                        'recovered' => $recovered,
                        'counters' => $snapshot['counters'],
                    ],
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => [],
            ],
        );
    }

    /**
     * @param array<string, array<string, mixed>> $issues
     * @param array<string, int> $closed tombstones: pair => episode since of the last announced, ended episode
     * @param array{state: string, since: int, issues: list<array<string, mixed>>, counters: array<string, int>} $snapshot
     * @return array<string, mixed>
     */
    private static function nextCursor(array $issues, array $closed, array $snapshot): array
    {
        $issues = self::capIssues($issues);
        $next = [
            'issues' => $issues,
            'closed' => array_slice($closed, -self::MAX_TRACKED_ISSUES, null, true),
            'state' => $snapshot['state'],
            'counters' => $snapshot['counters'],
        ];
        return $next;
    }

    /**
     * Keeps the cursor bounded: pending (debounce) pairs are never evicted, the rest by last_seen.
     *
     * @param array<string, array<string, mixed>> $issues
     * @return array<string, array<string, mixed>>
     */
    private static function capIssues(array $issues): array
    {
        if (count($issues) <= self::MAX_TRACKED_ISSUES) {
            return $issues;
        }
        $pending = array_filter($issues, static fn (array $issue): bool => (bool)($issue['pending'] ?? false));
        $rest = array_filter($issues, static fn (array $issue): bool => !(bool)($issue['pending'] ?? false));
        uasort($rest, static fn (array $a, array $b): int => (int)($a['last_seen'] ?? 0) <=> (int)($b['last_seen'] ?? 0));
        $limit = max(0, self::MAX_TRACKED_ISSUES - count($pending));
        $kept = $limit === 0 ? [] : array_slice($rest, -$limit, null, true);

        return $kept + $pending;
    }

    /** @param array<string, mixed> $config */
    private static function buildProfile(string $sourceId, array $config): ModuleStatusProfile
    {
        $rules = [];
        foreach ((array)($config['rules'] ?? []) as $rule) {
            if (is_array($rule)) {
                $rules[] = ModuleStatusRule::fromArray($rule);
            }
        }

        return new ModuleStatusProfile(
            moduleId: (string)$config['module'],
            reader: (string)$config['reader'],
            sourceId: $sourceId,
            minVersion: (string)($config['min_version'] ?? ''),
            rules: $rules,
            readPaths: array_values(array_map('strval', (array)($config['paths'] ?? []))),
        );
    }
}
