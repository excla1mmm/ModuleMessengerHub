<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRecorder;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Modules\ModuleMessengerHub\Lib\Sources\TickingSource;

/**
 * core.config_changed — push source fed by the Core hook modelsEventChangeData (4s-C).
 *
 * Where the fact comes from (read-only Core contract, never changed by the hub):
 *  - Core publishes one message per ORM write of a main-DB model:
 *    `src/Common/Models/ModelsBase.php:393-414` (publishModelChangeEvent) puts
 *    {source: 'ModelsBase->sendChangesToBackend', model, recordId, action, changedFields} on the
 *    model-change tube;
 *  - `src/Core/Workers/WorkerModelsEvents.php:605-631` (processModelChanges) decodes it and calls
 *    `hookModulesMethod(MODELS_EVENT_CHANGE_DATA, [$receivedMessage])` on every enabled module;
 *  - the CDR database is not tracked at all (`ModelsBase::processSettingsChanges`, `ModelsBase.php:293-299`,
 *    `$doNotTrackThisDB`), so call records never reach the hook.
 * `changedFields` is NOT used: for PbxSettings it carries old/new VALUES
 * (`ModelsBase.php:322-329`) and those may hold passwords. Only the model name, the action and a
 * count ever leave this class.
 *
 * The hook is called for every model write of the PBX, so it must stay cheap: fact() is a pure map
 * lookup and returns null for everything the hub does not care about (its own tables, other modules,
 * CDR, service tables, settings keys Core rewrites itself — see IGNORED_* below) BEFORE any database
 * access happens.
 *
 * Coalescing (one event instead of an avalanche):
 *  - the hook folds one fact into the source cursor (a couple of local statements, like the provider
 *    debounce) — `pending` keeps a per-area counter with the window bounds;
 *  - tick() (WorkerMessengerHubCollector, every 5 s) emits a single event once the change stream has
 *    been quiet for `quietSec` (default 60 s, HubSettings::config_change_quiet_sec), or once the
 *    window reaches MAX_WINDOW_SEC so a permanent stream of writes still reports;
 *  - dedupe_key = config:{first change ts}:{sha1 of the sorted area list, 12 hex} — a replay of the
 *    same window (worker restart) is swallowed by the UNIQUE key.
 *
 * Author of the change: Core does not put a user or session into the message (an API key request is
 * not distinguishable from the web cabinet), so the event carries no author — Plan/11 Q19.
 */
final class ConfigChangeSource implements SourceInterface, TickingSource
{
    public const string ID = 'core.config_changed';
    public const string EVENT_TYPE = 'core.config_changed';

    /** Source value Core puts into the message (BeanstalkConnectionModelsProvider::SOURCE_MODELS_CHANGED). */
    public const string CORE_SOURCE = 'ModelsBase->sendChangesToBackend';

    /** Prefix of the Core model namespace; only these classes are configuration of the PBX itself. */
    public const string CORE_MODEL_PREFIX = 'MikoPBX\\Common\\Models\\';

    /** A window that never closes emits anyway, so a steady stream of writes still reports. */
    public const int MAX_WINDOW_SEC = 1800;

    /** Hard cap of areas in one window (the map has fewer; a future Core model falls into AREA_OTHER). */
    public const int MAX_AREAS = 32;

    public const string AREA_OTHER = 'other';

    /** Core write actions (ModelsBase::processSettingsChanges) => the counter they increase. */
    private const array ACTIONS = ['afterSave' => 'set', 'afterDelete' => 'del'];

    /** Counter names of a window entry. */
    private const array FACT_ACTIONS = ['set', 'del'];

    /**
     * Core model class (short name) => human area code. The template translates the code; a raw
     * class name never reaches a message. Keep in one place — see Plan/02 "Реализация 4s-C".
     */
    private const array AREA_BY_MODEL = [
        // calls and routing
        'IncomingRoutingTable' => 'routing',
        'OutgoingRoutingTable' => 'routing',
        'Providers' => 'providers',
        // telephony entities
        'Extensions' => 'extensions',
        'ExternalPhones' => 'extensions',
        'ExtensionForwardingRights' => 'extensions',
        'Sip' => 'extensions',
        'Iax' => 'extensions',
        'AsteriskManagerUsers' => 'extensions',
        'AsteriskRestUsers' => 'extensions',
        'Codecs' => 'extensions',
        // employees
        'Users' => 'employees',
        'UserPasskeys' => 'employees',
        // services: menus, queues, applications, conferences
        'IvrMenu' => 'services',
        'IvrMenuActions' => 'services',
        'DialplanApplications' => 'services',
        'CallQueues' => 'services',
        'CallQueueMembers' => 'services',
        'ConferenceRooms' => 'services',
        // prompts and extra files
        'SoundFiles' => 'media',
        'CustomFiles' => 'media',
        // schedules
        'OutWorkTimes' => 'schedule',
        'OutWorkTimesRouts' => 'schedule',
        // network and security
        'LanInterfaces' => 'network',
        'NetworkStaticRoutes' => 'network',
        'NetworkFilters' => 'network',
        'SipHosts' => 'network',
        'FirewallRules' => 'firewall',
        'Fail2BanRules' => 'firewall',
        // storage
        'Storage' => 'storage',
        'StorageSettings' => 'storage',
        // the rest
        'ApiKeys' => 'api_keys',
        'PbxExtensionModules' => 'modules',
        'PbxSettings' => 'settings',
    ];

    /**
     * Service/bookkeeping tables of Core that are not configuration: they are rewritten by workers
     * and crons (CDR bookkeeping, module operation progress, long-poll subscribers, the S3 recording
     * map pruned by WorkerS3CacheCleaner) and would only add noise.
     */
    private const array IGNORED_MODELS = [
        'CallDetailRecords',
        'CallDetailRecordsTmp',
        'RecordingStorage',
        'ModuleOperations',
        'LongPollSubscribe',
    ];

    /**
     * PbxSettings keys Core rewrites itself while the administrator changes nothing: the OAuth2 mail
     * tokens are refreshed by MailOAuth2Service (`src/Core/System/Mail/MailOAuth2Service.php:41-42`,
     * token/expiry writes at 363-390). Their values are also credentials.
     */
    private const array IGNORED_SETTING_KEYS = [
        'MailOAuth2AccessToken',
        'MailOAuth2RefreshToken',
        'MailOAuth2TokenExpires',
        'MailOAuth2State',
        'MailOAuth2StateExpiry',
    ];

    /** @var (callable(): int)|null */
    private $quietSec;

    /** @param (callable(): int)|null $quietSec quiet window in seconds; null = the default below */
    public function __construct(?callable $quietSec = null)
    {
        $this->quietSec = $quietSec;
    }

    public function id(): string
    {
        return self::ID;
    }

    public function eventTypes(): array
    {
        return [self::EVENT_TYPE];
    }

    public function requiredModule(): ?string
    {
        return null;
    }

    public function apiReadPaths(): array
    {
        return [];
    }

    public function mode(): string
    {
        return SourceInterface::MODE_PUSH;
    }

    public function pollIntervalSec(): int
    {
        return 0;
    }

    public function poll(SourceContext $context, array $cursor): SourceBatch
    {
        return SourceBatch::baseline([]);
    }

    /**
     * Hook side (pure, no database): one Core model-change message => one fact, or null.
     *
     * @param array<string, mixed> $data what Core passes to modelsEventChangeData
     * @return array{area: string, action: string}|null
     */
    public static function fact(array $data): ?array
    {
        if (($data['source'] ?? '') !== self::CORE_SOURCE) {
            return null;
        }
        $model = $data['model'] ?? '';
        if (!is_string($model) || !str_starts_with($model, self::CORE_MODEL_PREFIX)) {
            // the hub's own models (Modules\*), models of other modules and CDR classes: not ours
            return null;
        }
        $class = substr($model, strlen(self::CORE_MODEL_PREFIX));
        if ($class === '' || str_contains($class, '\\')) {
            return null;
        }
        if (in_array($class, self::IGNORED_MODELS, true)) {
            return null;
        }
        $action = self::ACTIONS[(string)($data['action'] ?? '')] ?? null;
        if ($action === null) {
            return null;
        }
        if ($class === 'PbxSettings') {
            $recordId = $data['recordId'] ?? '';
            if (!is_string($recordId) || in_array($recordId, self::IGNORED_SETTING_KEYS, true)) {
                return null;
            }
        }

        return ['area' => self::AREA_BY_MODEL[$class] ?? self::AREA_OTHER, 'action' => $action];
    }

    /**
     * Hook side (pure): fold one fact into the open window of the cursor.
     *
     * Cursor shape:
     * `{"pending": {"<area>": {"set": n, "del": n}}, "since": <first change>, "last": <last change>}`.
     *
     * @param array<string, mixed> $cursor
     * @param array{area: string, action: string} $fact
     * @return array<string, mixed>
     */
    public static function applyFact(array $cursor, array $fact, int $now): array
    {
        $area = (string)($fact['area'] ?? '');
        $action = (string)($fact['action'] ?? '');
        if ($area === '' || !in_array($action, self::FACT_ACTIONS, true)) {
            return $cursor;
        }
        $pending = is_array($cursor['pending'] ?? null) ? $cursor['pending'] : [];
        $counts = is_array($pending[$area] ?? null) ? $pending[$area] : [];
        $counts = ['set' => (int)($counts['set'] ?? 0), 'del' => (int)($counts['del'] ?? 0)];
        $counts[$action]++;
        $pending[$area] = $counts;
        if (count($pending) > self::MAX_AREAS) {
            // cannot happen with the map above; a runaway would still be reported as one area
            $pending = [self::AREA_OTHER => ['set' => array_sum(array_column($pending, 'set')), 'del' => array_sum(array_column($pending, 'del'))]];
        }
        $since = (int)($cursor['since'] ?? 0);

        return ['pending' => $pending, 'since' => $since > 0 ? $since : $now, 'last' => $now];
    }

    /**
     * Worker side (pure): emit the window once it is quiet (or too old) and close it.
     *
     * @param array<string, mixed> $cursor
     * @return array{0: ?HubEvent, 1: array<string, mixed>}
     */
    public static function flush(array $cursor, int $quietSec, int $now): array
    {
        $pending = is_array($cursor['pending'] ?? null) ? $cursor['pending'] : [];
        if ($pending === []) {
            return [null, $cursor];
        }
        $since = (int)($cursor['since'] ?? 0);
        $last = (int)($cursor['last'] ?? 0);
        if ($since <= 0) {
            return [null, []];
        }
        $quiet = max(0, $quietSec);
        if ($now - $last < $quiet && $now - $since < self::MAX_WINDOW_SEC) {
            return [null, $cursor];
        }

        return [self::buildEvent($pending, $since, $last, $now), []];
    }

    public function tick(SourceStateRepository $states, SourceRecorder $recorder, int $now): void
    {
        $state = $states->get(self::ID);
        if (!$state['enabled']) {
            return;
        }
        $cursor = $state['cursor'];
        $pending = $cursor['pending'] ?? null;
        if (!is_array($pending) || $pending === []) {
            return;
        }
        $quietSec = $this->quietSec === null ? 60 : (int)($this->quietSec)();
        [$event, $closed] = self::flush($cursor, $quietSec, $now);
        if ($closed === $cursor) {
            return;
        }
        if (!$states->compareAndSaveCursor(self::ID, $cursor, $closed)) {
            // a hook folded a new fact in between: keep it, the next pass closes the merged window
            return;
        }
        if ($event !== null) {
            $recorder->record($event, $now);
        }
    }

    /**
     * @param array<string, array{set: int, del: int}> $pending
     */
    private static function buildEvent(array $pending, int $since, int $last, int $now): HubEvent
    {
        $areas = array_keys($pending);
        sort($areas, SORT_STRING);
        $items = [];
        $total = 0;
        foreach ($areas as $area) {
            $set = (int)($pending[$area]['set'] ?? 0);
            $del = (int)($pending[$area]['del'] ?? 0);
            $total += $set + $del;
            $items[] = ['area' => $area, 'set' => $set, 'del' => $del];
        }

        return new HubEvent(
            sourceId: self::ID,
            eventType: self::EVENT_TYPE,
            severity: HubEvent::SEVERITY_INFO,
            dedupeKey: 'config:' . $since . ':' . substr(sha1(implode(',', $areas)), 0, 12),
            occurredAt: max(1, $since),
            payload: [
                'subject' => [
                    'call' => null,
                    'client_number' => '',
                    'employees' => [],
                    'provider' => null,
                    'config' => [
                        'areas' => $items,
                        'total' => $total,
                        'since' => $since,
                        'last' => $last,
                    ],
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => [],
            ],
        );
    }
}
