<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceException;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;

/**
 * Generic reader of the uniform module monitoring resource
 * `GET /pbxcore/api/v3/<module-slug>/status` (stage 3b-1, GitHub issue #1).
 *
 * One class, one config entry per module (ModuleStatusSource::PROFILES):
 *  - diff by (code, ref) between polls, cursor in m_MessengerHubSourceState;
 *  - appearance -> event, disappearance -> recovery event where the profile defines one;
 *  - baseline on enable and on the first successful poll after the module becomes available:
 *    issues already present are recorded as known and never broadcast (history is not broadcast);
 *  - dedupe key `<source>:<code>:<ref>:<episode since>` (never the top-level `since`), so a restart,
 *    a re-poll or an acknowledged Cloud STT incident never re-alerts; a `since` that moves while the
 *    pair stays present is one incident (no event, no new debounce); a pair absent in the previous
 *    poll starts a new episode; recovery is sent only for an announced incident;
 *  - debounce: an issue must be observed for N seconds before the event (per code, e.g. 120 s for
 *    worker_offline, 0 for billing), which suppresses a worker blinking offline/online;
 *  - a 404 on `/status` means the installed module version is older than the contract: availability
 *    `api_incompatible`, no events, no log noise, and the cursor is re-baselined once the module
 *    is updated (Collector).
 *
 * ModuleAISupervisor does not serve `/status` yet: its profile prefers `/status` and falls back to
 * the `/workers` reader (AiWorkerStateSource), with identical dedupe keys. TODO(#1): drop the
 * fallback and the `/workers` read grant once the module ships `/status`.
 */
final class ModuleStatusSource implements SourceInterface
{
    public const string SOURCE_LOCAL_STT = 'local_stt.status';
    public const string SOURCE_CLOUD_STT = 'cloud_stt.status';
    public const string SOURCE_CLOUD_AI = 'cloud_ai.status';
    /** Historical id (stage 1.3): keeps the user's enabled switch and the event family. */
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
    public const int DEFAULT_CAPABILITY_RECHECK_SEC = 6 * 3600;
    public const int MAX_TRACKED_ISSUES = 500;
    private const int MAX_REF_LENGTH = 120;
    private const array STATUS_STATES = ['ok', 'degraded', 'down', 'paused'];

    /** source id => profile config; a module with /status is one entry here. */
    private const array PROFILES = [
        self::SOURCE_LOCAL_STT => [
            'module' => 'ModuleLocalSpeechToText',
            'slug' => 'module-local-speech-to-text',
            'min_version' => '1.154',
            'rules' => [
                [
                    'code' => 'worker_offline',
                    'event' => self::EVENT_LOCAL_STT_WORKER_OFFLINE,
                    'recovery' => self::EVENT_LOCAL_STT_WORKER_ONLINE,
                    'severity' => HubEvent::SEVERITY_WARNING,
                    'debounce' => 120,
                ],
                [
                    'code' => 'backlog_no_workers',
                    'event' => self::EVENT_LOCAL_STT_BACKLOG,
                    'recovery' => self::EVENT_LOCAL_STT_BACKLOG_RESOLVED,
                    'severity' => HubEvent::SEVERITY_CRITICAL,
                    'debounce' => 0,
                ],
            ],
        ],
        self::SOURCE_CLOUD_STT => [
            'module' => 'ModuleCloudSpeechToText',
            'slug' => 'module-cloud-speech-to-text',
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
                [
                    'code' => 'processing_paused',
                    'event' => self::EVENT_CLOUD_STT_PAUSED,
                    'recovery' => self::EVENT_CLOUD_STT_RESUMED,
                    'severity' => HubEvent::SEVERITY_WARNING,
                    'debounce' => 0,
                ],
            ],
        ],
        self::SOURCE_CLOUD_AI => [
            'module' => 'ModuleCloudAISupervisor',
            'slug' => 'module-cloud-ai-supervisor',
            'min_version' => '1.46',
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
            // `/status` is not released yet: prefer it and fall back to /workers (TODO(#1))
            'slug' => 'module-ai-supervisor',
            'min_version' => '',
            'fallback_slug' => 'module-ai-supervisor',
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

    public function __construct(
        private readonly ModuleStatusProfile $profile,
        private readonly ?StatusCapabilityStore $capabilities = null,
    ) {
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
     * `/status` is always readable. The `/workers` fallback path stays in the key only while the
     * module is known to lack `/status` or its capability is still unknown; once `/status` answers,
     * the fallback path leaves the key (Q15 in-place update, issue #1 item 6).
     */
    public function apiReadPaths(): array
    {
        $paths = [$this->profile->statusApiPath()];
        if ($this->profile->fallbackApiPath() !== null) {
            $capability = $this->capabilities?->get($this->profile->sourceId) ?? StatusCapability::unknown();
            if ($capability->statusPathAvailable !== true) {
                $paths[] = (string)$this->profile->fallbackApiPath();
            }
        }

        return $paths;
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
        $now = $context->now();
        $reader = 'status';
        $capabilityChecked = false;

        if ($this->profile->fallbackApiPath() === null) {
            $data = $this->readStatus($context);
        } else {
            $capability = $this->capabilities?->get($this->profile->sourceId) ?? StatusCapability::unknown();
            $fallbackActive = $capability->statusPathAvailable === false;
            $useStatus = !$fallbackActive
                || $capability->dueForRecheck($now, $this->profile->capabilityRecheckSec);

            $data = null;
            if ($useStatus) {
                try {
                    $data = $context->rest->get($this->profile->statusPath());
                    if ($capability->statusPathAvailable !== true) {
                        $this->remember(true, $now); // only the flip is persisted; no write every minute
                    }
                    $capabilityChecked = true;
                } catch (SourceException $exception) {
                    if ($exception->errorCode === 'api_not_found') {
                        $this->remember(false, $now);
                        $capabilityChecked = true;
                        $reader = 'workers';
                    } elseif ($fallbackActive) {
                        // a periodic re-check failed for another reason: keep reading /workers,
                        // do not flip the capability (the next due poll asks /status again)
                        $reader = 'workers';
                    } else {
                        throw $exception;
                    }
                }
            } else {
                $reader = 'workers';
            }

            if ($reader === 'workers') {
                $data = $context->rest->get((string)$this->profile->fallbackPath());
            }
        }

        $snapshot = $reader === 'workers'
            ? AiWorkerStateSource::snapshot($data ?? [], $now)
            : self::snapshot($data ?? []);

        $batch = self::buildBatch($this->profile, $snapshot, $cursor, $now);
        $next = $batch->cursor;
        if ($this->profile->fallbackApiPath() !== null) {
            $next['reader'] = $reader;
            $next['reader_checked_at'] = $capabilityChecked
                ? $now
                : (int)($cursor['reader_checked_at'] ?? 0);
        }

        return new SourceBatch($batch->events, $next);
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

        // no cursor at all, or a stage-1.3 AiWorkerStateSource cursor ({"workers": ...}) — the first
        // successful poll records what is already broken as known and stays silent (issue #1 item 6)
        if ($cursor === [] || !array_key_exists('issues', $cursor)) {
            $issues = [];
            foreach ($current as $key => $issue) {
                $issues[$key] = self::startEpisode($issue, $now, false, '');
            }

            return SourceBatch::baseline(self::nextCursor($issues, [], $snapshot, $cursor));
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

        return new SourceBatch($events, self::nextCursor($issues, $closed, $snapshot, $cursor));
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

    /** @return array<string, mixed> */
    private function readStatus(SourceContext $context): array
    {
        try {
            return $context->rest->get($this->profile->statusPath());
        } catch (SourceException $exception) {
            if ($exception->errorCode === 'api_not_found') {
                // an older module version without /status: "update the module", not an error
                throw new SourceException('api_incompatible', $this->profile->minVersion);
            }
            throw $exception;
        }
    }

    private function remember(bool $available, int $now): void
    {
        $this->capabilities?->remember(
            $this->profile->sourceId,
            $available ? StatusCapability::available($now) : StatusCapability::missing($now)
        );
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
     * @param array<string, mixed> $cursor
     * @return array<string, mixed>
     */
    private static function nextCursor(array $issues, array $closed, array $snapshot, array $cursor): array
    {
        $issues = self::capIssues($issues);
        $next = [
            'issues' => $issues,
            'closed' => array_slice($closed, -self::MAX_TRACKED_ISSUES, null, true),
            'state' => $snapshot['state'],
            'counters' => $snapshot['counters'],
        ];
        foreach (['reader', 'reader_checked_at'] as $key) {
            if (array_key_exists($key, $cursor)) {
                $next[$key] = $cursor[$key];
            }
        }

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
            slug: (string)$config['slug'],
            sourceId: $sourceId,
            minVersion: (string)($config['min_version'] ?? ''),
            rules: $rules,
            fallbackSlug: isset($config['fallback_slug']) ? (string)$config['fallback_slug'] : null,
            capabilityRecheckSec: (int)($config['capability_recheck'] ?? self::DEFAULT_CAPABILITY_RECHECK_SEC),
        );
    }
}
