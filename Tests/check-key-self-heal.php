<?php

declare(strict_types=1);

// Self-healing hub key (Plan/11 Q14, decision 1): the decision table, the 5-minute repair throttle
// and the collector behaviour — a rejected key is repaired and the poll retried once; only a healthy
// key leaves the source in api_forbidden ("Модуль не даёт доступа к данным").

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Api\ApiKeyGuard;
use Modules\ModuleMessengerHub\Lib\Api\ApiKeyRepairer;
use Modules\ModuleMessengerHub\Lib\Api\KeyGraceWindow;
use Modules\ModuleMessengerHub\Lib\Api\KeyHealth;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Api\KeySyncPlan;
use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\Collector;
use Modules\ModuleMessengerHub\Lib\Sources\ModuleStatusProbe;
use Modules\ModuleMessengerHub\Lib\Sources\SourceAvailability;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceException;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Modules\ModuleMessengerHub\Lib\Api\RestReader;

// ---------- KeyHealth decision table ----------

check(KeyHealth::diagnose(true, true, true) === KeyHealth::HEALTHY, 'ours + secret + paths -> healthy');
check(KeyHealth::diagnose(false, true, true) === KeyHealth::MISSING, 'record gone -> missing');
check(KeyHealth::diagnose(true, false, true) === KeyHealth::SECRET_INVALID, 'secret no longer authenticates');
check(KeyHealth::diagnose(true, true, false) === KeyHealth::PATHS_STALE, 'path set drifted');
check(KeyHealth::diagnose(true, false, false) === KeyHealth::SECRET_INVALID, 'secret wins over paths');
check(!KeyHealth::needsRepair(KeyHealth::HEALTHY), 'healthy needs no repair');
check(KeyHealth::needsRepair(KeyHealth::MISSING), 'missing needs a repair');
check(KeyHealth::needsRepair(KeyHealth::PATHS_STALE), 'stale paths need a repair');

check(
    KeySyncPlan::normalizePathsJson('{"/api/v3/b":"read","/api/v3/a":"read"}') === '["/api/v3/a","/api/v3/b"]',
    'record allowed_paths normalize to the canonical sorted JSON'
);
check(KeySyncPlan::normalizePathsJson('{}') === '[]', 'empty allowed_paths normalize to []');
check(KeySyncPlan::normalizePathsJson('garbage') === '[]', 'garbled allowed_paths normalize to []');

// ---------- throttle ----------

final class SpyRepairer implements ApiKeyRepairer
{
    /** @var list<string> */
    public array $repairs = [];

    public string $plain = 'fresh-key';

    public function __construct(public string $health = KeyHealth::PATHS_STALE)
    {
    }

    public function verify(array $paths): string
    {
        return $this->health;
    }

    public function repair(array $paths): void
    {
        $this->repairs[] = $this->health;
        $this->health = KeyHealth::HEALTHY;
    }

    public function plainKey(): string
    {
        return $this->plain;
    }
}

$repairer = new SpyRepairer();
$guard = new ApiKeyGuard($repairer, ['/api/v3/advice'], 300);
check($guard->onRejected(1000) === ApiKeyGuard::REPAIRED, 'unhealthy key -> repaired, poll may retry');
check($repairer->repairs === [KeyHealth::PATHS_STALE], 'repair called once with the reason');
check($guard->onRejected(1001) === ApiKeyGuard::HEALTHY, 'after a successful repair the key is healthy');

// a recreated key reaches the collector's REST client through the callback
$repairer = new SpyRepairer(KeyHealth::MISSING);
$seen = '';
$guard = new ApiKeyGuard(
    $repairer,
    [],
    300,
    static function (string $plain) use (&$seen): void {
        $seen = $plain;
    }
);
$guard->onRejected(1000);
check($seen === 'fresh-key', 'the fresh plain key is handed to the collector');

$repairer = new SpyRepairer(KeyHealth::MISSING);
$guard = new ApiKeyGuard($repairer, [], 300);
check($guard->onRejected(1000) === ApiKeyGuard::REPAIRED, 'first missing-key rejection repairs');
// a repair that did not help: the reason repeats inside the window
$repairer->health = KeyHealth::MISSING;
check($guard->onRejected(1100) === ApiKeyGuard::THROTTLED, 'same reason inside 5 min -> no repair storm');
check(count($repairer->repairs) === 1, 'still a single repair');
check($guard->onRejected(1301) === ApiKeyGuard::REPAIRED, 'after the window a repair is allowed again');

// ---------- collector behaviour ----------

final class Probe implements ModuleStatusProbe
{
    public function status(string $moduleUniqueId): string
    {
        return SourceAvailability::AVAILABLE;
    }
}

final class NoRest implements RestReader
{
    public function get(string $path, array $query = []): array
    {
        return [];
    }
}

/** Rejects the poll $rejections times with $code, then returns one event. */
final class FlakyKeySource implements SourceInterface
{
    public int $polls = 0;

    public function __construct(private int $rejections = 1, private string $code = 'api_forbidden')
    {
    }

    public function id(): string
    {
        return 'fake.source';
    }

    public function eventTypes(): array
    {
        return ['fake.source'];
    }

    public function requiredModule(): ?string
    {
        return null;
    }

    public function apiReadPaths(): array
    {
        return ['/api/v3/advice'];
    }

    public function mode(): string
    {
        return SourceInterface::MODE_POLL;
    }

    public function pollIntervalSec(): int
    {
        return 1;
    }

    public function poll(SourceContext $context, array $cursor): SourceBatch
    {
        $this->polls++;
        if ($this->polls <= $this->rejections) {
            throw new SourceException($this->code);
        }

        return new SourceBatch([
            new HubEvent(
                sourceId: 'fake.source',
                eventType: 'fake.source',
                severity: HubEvent::SEVERITY_INFO,
                dedupeKey: 'fake:' . $this->polls,
                occurredAt: 1790944901,
                payload: []
            ),
        ], ['ok' => true]);
    }
}

function collectorFor(SourceInterface $source, ?ApiKeyGuard $guard, \Modules\ModuleMessengerHub\Lib\Storage\HubDatabase $db, int $now = 0): Collector
{
    return new Collector(
        [$source],
        new SourceStateRepository($db),
        new EventStore($db),
        new Probe(),
        new SourceContext(new NoRest(), $now > 0 ? static fn (): int => $now : null),
        $guard
    );
}

// 1. broken key repaired -> the retried poll succeeds -> available without user action
$db = hubTestDatabase();
$repairer = new SpyRepairer(KeyHealth::MISSING);
$guard = new ApiKeyGuard($repairer, ['/api/v3/advice'], 300);
$source = new FlakyKeySource(1);
$report = collectorFor($source, $guard, $db, 2000)->runOnce();
check($source->polls === 2, 'a rejected poll is retried once after the repair');
check(($report['fake.source']['status'] ?? '') === SourceAvailability::AVAILABLE, 'source is available after self-healing');
check(($report['fake.source']['recorded'] ?? 0) === 1, 'the retried poll records the event');
check($repairer->repairs === [KeyHealth::MISSING], 'repair ran for the missing key');

// 2. healthy key + module refusal -> api_forbidden, no repair
$db = hubTestDatabase();
$repairer = new SpyRepairer(KeyHealth::HEALTHY);
$guard = new ApiKeyGuard($repairer, [], 300);
$source = new FlakyKeySource(1, 'api_forbidden');
$report = collectorFor($source, $guard, $db, 2000)->runOnce();
check($source->polls === 1, 'healthy key: no pointless retry');
check(($report['fake.source']['status'] ?? '') === SourceAvailability::API_FORBIDDEN, 'module refusal -> api_forbidden');
check($repairer->repairs === [], 'healthy key never repaired');

// 3. unhealthy key but the repair is throttled -> error, not "module refuses"
$db = hubTestDatabase();
$repairer = new SpyRepairer(KeyHealth::MISSING);
$guard = new ApiKeyGuard($repairer, [], 300); // the first rejection repairs, the next one inside 5 min is throttled
$source = new FlakyKeySource(9);
$collector = collectorFor($source, $guard, $db, 2000);
$collector->runOnce(); // repairs; retry fails (still 9 rejections left)
$repairer->health = KeyHealth::MISSING; // the repair did not help
$report = collectorFor($source, $guard, $db, 2010)->runOnce();
check(($report['fake.source']['status'] ?? '') === SourceAvailability::ERROR, 'throttled repair is an error, not a refusal');
$state = (new SourceStateRepository($db))->get('fake.source');
check($state['last_error_code'] === 'api_key_repair_throttled', 'the throttled reason is stored as a code');

// 4. without a guard the collector behaves as before
$db = hubTestDatabase();
$source = new FlakyKeySource(1);
$report = collectorFor($source, null, $db)->runOnce();
check(($report['fake.source']['status'] ?? '') === SourceAvailability::API_FORBIDDEN, 'no guard -> plain api_forbidden');

// ---------- Core token cache grace (Plan/08) ----------

function graceCollector(SourceInterface $source, ?ApiKeyGuard $guard, \Modules\ModuleMessengerHub\Lib\Storage\HubDatabase $db, int $now): Collector
{
    return new Collector(
        [$source],
        new SourceStateRepository($db),
        new EventStore($db),
        new Probe(),
        new SourceContext(new NoRest(), static fn (): int => $now),
        $guard,
        new KeyGraceWindow(new HubSettings($db))
    );
}

// first pass after install/update starts the window once; a 403 inside it changes nothing
$db = hubTestDatabase();
$settings = new HubSettings($db);
$grace = new KeyGraceWindow($settings);
check(!$grace->active(5000), 'grace: not active before anything started it');
$repairer = new SpyRepairer(KeyHealth::MISSING);
$guard = new ApiKeyGuard($repairer, ['/api/v3/advice'], 300);
$source = new FlakyKeySource(99, 'api_forbidden');
$report = graceCollector($source, $guard, $db, 5000)->runOnce();
check($settings->get(HubSettings::HUB_API_KEY_GRACE_UNTIL) === (string)(5000 + KeyGraceWindow::GRACE_SEC), 'grace: first pass starts a 6 minute window');
check(($report['fake.source']['status'] ?? '') === 'key_cache_grace' && ($report['fake.source']['recorded'] ?? 0) === 0, 'grace: 403 is reported as transient');
$state = (new SourceStateRepository($db))->get('fake.source');
check($state['availability'] === '' && $state['last_error_code'] === '' && $state['last_poll_at'] === 5000, 'grace: availability untouched, only the poll attempt is recorded');
check($repairer->repairs === [] && $source->polls === 1, 'grace: no self-heal and no retry');
check($state['cursor'] === [], 'grace: cursor not reset');

// the previous availability is kept
$states = new SourceStateRepository($db);
$states->markPolled('fake.source', ['ok' => true], 5001);
$graceKept = graceCollector($source, $guard, $db, 5100);
$graceKept->runOnce();
$state = $states->get('fake.source');
check($state['availability'] === SourceAvailability::AVAILABLE && $state['cursor'] === ['ok' => true], 'grace: a known availability and cursor are kept');

// a restart (new collector, same settings) keeps the window; the deadline is not moved by another first pass
$graceKept = graceCollector($source, $guard, $db, 5200);
$graceKept->runOnce();
check($settings->get(HubSettings::HUB_API_KEY_GRACE_UNTIL) === (string)(5000 + KeyGraceWindow::GRACE_SEC), 'grace: a worker restart keeps the deadline');
check($states->get('fake.source')['availability'] === SourceAvailability::AVAILABLE, 'grace: still no state change after a restart');

// after the window the normal logic applies (healthy key -> module refusal)
$repairer->health = KeyHealth::HEALTHY;
$report = graceCollector($source, $guard, $db, 5000 + KeyGraceWindow::GRACE_SEC + 1)->runOnce();
check(($report['fake.source']['status'] ?? '') === SourceAvailability::API_FORBIDDEN, 'grace: after the window 403 -> api_forbidden');
check($states->get('fake.source')['last_error_code'] === 'api_forbidden', 'grace: the code is stored after the window');

// another error code is never swallowed by the grace
$db = hubTestDatabase();
$source = new FlakyKeySource(99, 'api_not_found');
$report = graceCollector($source, null, $db, 6000)->runOnce();
check(($report['fake.source']['status'] ?? '') === SourceAvailability::MODULE_MISSING, 'grace: only 401/403 are transient');

// a key change restarts an expired window
$db = hubTestDatabase();
$grace = new KeyGraceWindow(new HubSettings($db));
$grace->start(100);
check($grace->active(100 + KeyGraceWindow::GRACE_SEC - 1) && !$grace->active(100 + KeyGraceWindow::GRACE_SEC), 'grace: lasts exactly 6 minutes');
$grace->ensureStarted(10000);
check(!$grace->active(10000), 'grace: ensureStarted does not restart an already started window');

finish('hub key self-healing OK');
