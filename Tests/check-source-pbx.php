<?php

declare(strict_types=1);

// Stage 4s-C sources: PBX configuration changes, external IP and license expiry (Plan/02).
// Pure logic of Lib/Sources/Core/{ConfigChange,ExternalIp,LicenseExpiry}Source plus the templates;
// Core glue (the hooks in MessengerHubConf) stays thin and is not loaded here.

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Api\RestReader;
use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\LinkBuilder;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\Templates\TemplateRegistry;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Sources\ApiKeyPaths;
use Modules\ModuleMessengerHub\Lib\Sources\Collector;
use Modules\ModuleMessengerHub\Lib\Sources\Core\ConfigChangeSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\ExternalIpSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\LicenseExpirySource;
use Modules\ModuleMessengerHub\Lib\Sources\ModuleStatusProbe;
use Modules\ModuleMessengerHub\Lib\Sources\SourceAvailability;
use Modules\ModuleMessengerHub\Lib\Sources\SourceCatalog;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceException;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRecorder;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRegistry;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Modules\ModuleMessengerHub\Lib\Sources\SourceTicker;
use Modules\ModuleMessengerHub\Lib\Sources\TickingSource;

const FIXTURES = __DIR__ . '/fixtures';

/** Raw text fixture (the license answer is a JSON string inside PBXApiResult data). */
function fixtureRaw(string $relative): string
{
    $raw = file_get_contents(FIXTURES . '/' . $relative);
    if ($raw === false) {
        fwrite(STDERR, "missing fixture $relative\n");
        exit(1);
    }

    return $raw;
}

final class OkProbe implements ModuleStatusProbe
{
    public function status(string $moduleUniqueId): string
    {
        return SourceAvailability::AVAILABLE;
    }
}

/** Reader returning a canned `data` member per path and counting the calls. */
final class PathRestReader implements RestReader
{
    /** @var array<string, int> */
    public array $calls = [];

    /** @var array<string, array<mixed>> */
    private array $answers;

    /** @param array<string, array<mixed>> $answers */
    public function __construct(array $answers, private readonly ?string $failWith = null)
    {
        $this->answers = $answers;
    }

    public function get(string $path, array $query = []): array
    {
        $this->calls[$path] = ($this->calls[$path] ?? 0) + 1;
        if ($this->failWith !== null) {
            throw new SourceException($this->failWith);
        }

        return $this->answers[$path] ?? [];
    }
}

final class PbxHarness
{
    public PdoHubDatabase $db;
    public SourceStateRepository $states;
    public EventStore $store;
    public SourceRecorder $recorder;

    public function __construct()
    {
        $this->db = hubTestDatabase();
        $this->states = new SourceStateRepository($this->db);
        $this->store = new EventStore($this->db);
        $this->recorder = new SourceRecorder($this->states, $this->store);
    }

    /** @return list<array<string, mixed>> */
    public function rows(string $sourceId): array
    {
        return $this->db->fetchAll(
            'SELECT source_id, event_type, severity, dedupe_key, occurred_at, payload_json FROM '
            . EventStore::TABLE . ' WHERE source_id = :id ORDER BY id',
            ['id' => $sourceId]
        );
    }

    public function count(string $sourceId): int
    {
        return count($this->rows($sourceId));
    }

    /** One collector pass over a single poll source. */
    public function pollOnce(SourceInterface $source, RestReader $rest, int $now): void
    {
        $collector = new Collector(
            [$source],
            $this->states,
            $this->store,
            new OkProbe(),
            new SourceContext($rest, static fn (): int => $now)
        );
        $collector->runOnce();
    }

    /** One ticker pass over the registered push sources. */
    public function tick(SourceInterface $source, int $now): void
    {
        (new SourceTicker(new SourceRegistry([$source]), $this->states, $this->recorder))->run($now);
    }

    /** @return array<string, mixed> */
    public function cursor(string $sourceId): array
    {
        return $this->states->get($sourceId)['cursor'];
    }
}

/** A Core model-change message as WorkerModelsEvents passes it to modelsEventChangeData. */
function coreModelChange(string $model, string $action = 'afterSave', mixed $recordId = 1): array
{
    return [
        'source' => ConfigChangeSource::CORE_SOURCE,
        'model' => 'MikoPBX\\Common\\Models\\' . $model,
        'recordId' => $recordId,
        'action' => $action,
        'changedFields' => ['value' => ['old' => 'secret-old', 'new' => 'secret-new']],
    ];
}

// ======================= registry and catalog =======================
$registry = SourceRegistry::default();
check(count($registry->all()) === 23, 'registry: fourteen sources plus the three 4s-C ones');
check($registry->find(ConfigChangeSource::ID) instanceof ConfigChangeSource, 'registry: config_changed');
check($registry->find(ExternalIpSource::ID) instanceof ExternalIpSource, 'registry: external_ip_changed');
check($registry->find(LicenseExpirySource::ID) instanceof LicenseExpirySource, 'registry: license_expiring');
check(count($registry->pollSources()) === 14, 'registry: two 4s-C plus two 4s-A poll sources');
check(count($registry->amiSources()) === 5, 'registry: AMI sources: core two plus the three 4s-B ones');
check($registry->apiReadPaths([ExternalIpSource::ID]) === ['/api/v3/sysinfo'], 'registry: external IP reads sysinfo');
check($registry->apiReadPaths([LicenseExpirySource::ID]) === ['/api/v3/license'], 'registry: license reads the license resource');
check($registry->apiReadPaths([ConfigChangeSource::ID]) === [], 'registry: the hook source needs no read path');

$ruCatalog = require dirname(__DIR__) . '/Messages/ru.php';
foreach ([ConfigChangeSource::ID, ExternalIpSource::ID, LicenseExpirySource::ID] as $id) {
    check(SourceCatalog::group($id) === SourceCatalog::GROUP_PBX, "catalog: $id is in the PBX group");
    check(isset($ruCatalog[SourceCatalog::nameKey($id)]), "catalog: $id has a translated name");
    check($registry->find($id) instanceof SourceInterface, "catalog: $id is registered");
    foreach (SourceCatalog::eventTypeKeys($id) as $type => $key) {
        check(isset($ruCatalog[$key]), "catalog: $type has a translation key");
    }
}
check(SourceCatalog::eventTypes(ConfigChangeSource::ID) === ['core.config_changed'], 'catalog: config_changed event type');
check(SourceCatalog::eventTypes(ExternalIpSource::ID) === ['core.external_ip_changed'], 'catalog: external IP event type');
check(SourceCatalog::eventTypes(LicenseExpirySource::ID) === ['core.license_expiring'], 'catalog: license event type');

$pbxIds = array_values(array_filter(
    array_map(static fn (SourceInterface $s): string => $s->id(), $registry->all()),
    static fn (string $id): bool => SourceCatalog::group($id) === SourceCatalog::GROUP_PBX
));
foreach ([ConfigChangeSource::ID, ExternalIpSource::ID, LicenseExpirySource::ID] as $newId) {
    check(in_array($newId, $pbxIds, true), 'catalog: ' . $newId . ' shows up as a PBX scenario in the wizard');
}

// the hub key follows the enabled flag: only enabled sources contribute their paths
$paths = ApiKeyPaths::compute(
    $registry->pollSources(),
    static fn (string $id): bool => in_array($id, [ConfigChangeSource::ID, ExternalIpSource::ID], true),
    static fn (string $module): string => SourceAvailability::AVAILABLE
);
check($paths === ['/api/v3/sysinfo'], 'key paths: disabled license source contributes nothing');

// ======================= C1: config changes =======================
check(ConfigChangeSource::fact(coreModelChange('Providers')) === ['area' => 'providers', 'action' => 'set'], 'config: providers mapped');
check(ConfigChangeSource::fact(coreModelChange('IncomingRoutingTable', 'afterDelete')) === ['area' => 'routing', 'action' => 'del'], 'config: delete action');
check(ConfigChangeSource::fact(coreModelChange('PbxSettings', 'afterSave', 'PBXLanguage')) === ['area' => 'settings', 'action' => 'set'], 'config: ordinary setting counted');
check(ConfigChangeSource::fact(coreModelChange('SomeNewCoreModel')) === ['area' => 'other', 'action' => 'set'], 'config: a future Core model falls into "other"');

// ignored: own tables, other modules, CDR, service tables, self-rewritten settings keys, other sources
$ownModel = ['source' => ConfigChangeSource::CORE_SOURCE, 'model' => 'Modules\\ModuleMessengerHub\\Models\\MessengerHubEvents', 'recordId' => 1, 'action' => 'afterSave'];
check(ConfigChangeSource::fact($ownModel) === null, 'config: the hub\'s own models are ignored (no loop)');
$otherModule = ['source' => ConfigChangeSource::CORE_SOURCE, 'model' => 'Modules\\ModuleAISupervisor\\Models\\Calls', 'recordId' => 1, 'action' => 'afterSave'];
check(ConfigChangeSource::fact($otherModule) === null, 'config: other modules\' models are ignored');
check(ConfigChangeSource::fact(coreModelChange('CallDetailRecords')) === null, 'config: CDR is ignored');
check(ConfigChangeSource::fact(coreModelChange('ModuleOperations')) === null, 'config: module operation progress is ignored');
check(ConfigChangeSource::fact(coreModelChange('RecordingStorage')) === null, 'config: the recording map pruned by cron is ignored');

// Core touches ApiKeys.last_used_at once a minute for every key in use (station, 24.11.2026): not a change
$touch = ['changedFields' => ['last_used_at']] + coreModelChange('ApiKeys', 'afterSave', '251');
check(ConfigChangeSource::fact($touch) === null, 'config: a last_used_at touch of an API key is ignored');
$keyEdit = ['changedFields' => ['allowed_paths', 'last_used_at']] + coreModelChange('ApiKeys', 'afterSave', '300');
check(ConfigChangeSource::fact($keyEdit) === ['area' => 'api_keys', 'action' => 'set'], 'config: a real API key edit is still counted');
$keyDelete = ['changedFields' => ['last_used_at']] + coreModelChange('ApiKeys', 'afterDelete', '300');
check(ConfigChangeSource::fact($keyDelete) === ['area' => 'api_keys', 'action' => 'del'], 'config: deleting a key is counted');
// the hub's own key path sync is the hub's doing
$ownSync = ['changedFields' => ['allowed_paths']] + coreModelChange('ApiKeys', 'afterSave', '251');
check(ConfigChangeSource::fact($ownSync, 251) === null, 'config: the hub key path sync is ignored');
check(ConfigChangeSource::fact($ownSync, 0) === ['area' => 'api_keys', 'action' => 'set'], 'config: unknown own key id skips nothing');
check(ConfigChangeSource::fact($ownSync, 7) === ['area' => 'api_keys', 'action' => 'set'], 'config: another key is still counted');
check(ConfigChangeSource::fact(coreModelChange('PbxSettings', 'afterSave', 'MailOAuth2AccessToken')) === null, 'config: self-refreshed OAuth2 tokens are ignored');
check(ConfigChangeSource::fact(coreModelChange('PbxSettings', 'afterDelete', 'MailOAuth2State')) === null, 'config: the OAuth2 state keys are ignored');
check(ConfigChangeSource::fact(['source' => 'WorkerModelsEvents->invokeAction', 'action' => 'reload', 'parameters' => []]) === null, 'config: reload actions are not model changes');
check(ConfigChangeSource::fact(['source' => ConfigChangeSource::CORE_SOURCE, 'model' => 'MikoPBX\\Common\\Models\\Providers', 'action' => 'afterRestore']) === null, 'config: unknown actions are ignored');
check(ConfigChangeSource::fact([]) === null, 'config: an empty message is ignored');

// a burst inside the quiet window becomes ONE event listing the areas and their counts
$h = new PbxHarness();
$h->states->setEnabled(ConfigChangeSource::ID, true, 0);
$T = 1795000000;
$cursor = [];
for ($i = 0; $i < 30; $i++) {
    $cursor = ConfigChangeSource::applyFact($cursor, ['area' => 'providers', 'action' => 'set'], $T + ($i % 10));
}
$cursor = ConfigChangeSource::applyFact($cursor, ['area' => 'routing', 'action' => 'set'], $T + 20);
$cursor = ConfigChangeSource::applyFact($cursor, ['area' => 'routing', 'action' => 'del'], $T + 30);
check($cursor['since'] === $T, 'config: the window starts at the first change');
check($cursor['last'] === $T + 30, 'config: the window ends at the last change');
check($cursor['pending']['providers'] === ['set' => 30, 'del' => 0], 'config: counts are folded per area');
check($cursor['pending']['routing'] === ['set' => 1, 'del' => 1], 'config: deletions are counted separately');

[$early] = ConfigChangeSource::flush($cursor, 60, $T + 89);
check($early === null, 'config: nothing is emitted while the window is not quiet');
[$event, $closed] = ConfigChangeSource::flush($cursor, 60, $T + 90);
check($event instanceof HubEvent && $closed === [], 'config: one event after 60 s of silence, the window closes');
if ($event instanceof HubEvent) {
    check($event->eventType === 'core.config_changed' && $event->sourceId === 'core.config_changed', 'config: type and source');
    check($event->severity === HubEvent::SEVERITY_INFO, 'config: configuration changes are informational');
    check($event->dedupeKey === 'config:' . $T . ':' . substr(sha1('providers,routing'), 0, 12), 'config: dedupe_key = config:{first ts}:{sha1 of sorted areas}');
    check($event->occurredAt === $T, 'config: occurred_at = first change of the window');
    $areas = $event->payload['subject']['config']['areas'];
    check(array_column($areas, 'area') === ['providers', 'routing'], 'config: areas are sorted');
    check($event->payload['subject']['config']['total'] === 32, 'config: total count of the window');
    $payloadJson = (string)json_encode($event->payload, JSON_UNESCAPED_UNICODE);
    check(!str_contains($payloadJson, 'secret-old') && !str_contains($payloadJson, 'secret-new'), 'config: changed field values never reach the payload');
    check(!str_contains($payloadJson, 'MikoPBX\\\\Common'), 'config: no Core class names in the payload');
    check($event->payload['subject']['client_number'] === '' && $event->payload['subject']['employees'] === [], 'config: no phone numbers in the subject');
}

// the same window replayed (worker restart before the cursor write) is swallowed by the dedupe key
$h->recorder->record($event, $T + 90);
$h->recorder->record($event, $T + 95);
check($h->count(ConfigChangeSource::ID) === 1, 'config: replay is idempotent');

// a never-ending stream still reports when the window reaches MAX_WINDOW_SEC
$stream = ['pending' => ['settings' => ['set' => 500, 'del' => 0]], 'since' => $T, 'last' => $T + 1799];
[$stillOpen] = ConfigChangeSource::flush($stream, 3600, $T + 1799);
check($stillOpen === null, 'config: a long quiet value keeps the window open');
$stream['last'] = $T + 1800;
[$forced] = ConfigChangeSource::flush($stream, 3600, $T + 1800);
check($forced instanceof HubEvent, 'config: the maximum window forces the event');

// hook -> ticker in one process: the hook only writes the cursor, the ticker closes the window
$h2 = new PbxHarness();
$source = new ConfigChangeSource(static fn (): int => 60);
$h2->states->setEnabled(ConfigChangeSource::ID, true, 0);
$apply = static function (array $data, int $now) use ($h2): void {
    $fact = ConfigChangeSource::fact($data);
    if ($fact === null) {
        return;
    }
    $current = $h2->states->get(ConfigChangeSource::ID);
    $h2->states->compareAndSaveCursor(ConfigChangeSource::ID, $current['cursor'], ConfigChangeSource::applyFact($current['cursor'], $fact, $now));
};
$apply(coreModelChange('Extensions'), $T);
$apply(coreModelChange('Users', 'afterDelete', 4), $T + 5);
$h2->tick($source, $T + 30);
check($h2->count(ConfigChangeSource::ID) === 0, 'config: tick before the quiet window emits nothing');
$h2->tick($source, $T + 65);
check($h2->count(ConfigChangeSource::ID) === 1, 'config: tick after the quiet window emits one event');
check($h2->cursor(ConfigChangeSource::ID) === [], 'config: the closed window is emptied');
$h2->tick($source, $T + 400);
check($h2->count(ConfigChangeSource::ID) === 1, 'config: an empty window never emits again');

// a disabled source stores nothing and emits nothing
$h3 = new PbxHarness();
$h3->states->setEnabled(ConfigChangeSource::ID, false, 0);
$h3->states->saveCursor(ConfigChangeSource::ID, []);
check(!$h3->states->isEnabled(ConfigChangeSource::ID), 'config: disabled');
$h3->tick($source, $T + 500);
check($h3->count(ConfigChangeSource::ID) === 0, 'config: disabled source emits nothing');

// ======================= C2: external IP =======================
check(ExternalIpSource::PATH === '/pbxcore/api/v3/sysinfo:getExternalIpInfo', 'extip: exact Core route with the custom method');
check(ExternalIpSource::API_READ_PATH === '/api/v3/sysinfo', 'extip: the key holds the resource path');
check(ExternalIpSource::ipFrom(['ip' => '203.0.113.5']) === '203.0.113.5', 'extip: an IPv4 answer is accepted');
check(ExternalIpSource::ipFrom(['ip' => 'not-an-ip']) === null, 'extip: garbage is not an address');
check(ExternalIpSource::ipFrom([]) === null, 'extip: an empty answer has no address');
check(ExternalIpSource::ipFrom(['ip' => '2001:db8::1']) === null, 'extip: Core answers IPv4 only (filter_var IPv4)');

$interval = 15 * 60;
[$e, $c] = ExternalIpSource::observe([], '203.0.113.5', $T, $interval);
check($e === null && $c['ip'] === '203.0.113.5', 'extip: the first lookup is a silent baseline');
check($c['next_check_at'] === $T + $interval, 'extip: the next check waits the interval');
[$e] = ExternalIpSource::observe($c, '203.0.113.5', $T + 900, $interval);
check($e === null, 'extip: the same address is not news');
[$e, $c1] = ExternalIpSource::observe($c, '203.0.113.9', $T + 900, $interval);
check($e === null && $c1['candidate'] === '203.0.113.9', 'extip: the first sighting only remembers the candidate');
check($c1['next_check_at'] === $T + 900 + ExternalIpSource::RECHECK_RETRY_SEC, 'extip: the confirmation is checked in a minute');
[$e, $c2] = ExternalIpSource::observe($c1, '203.0.113.9', $T + 960, $interval);
check($e instanceof HubEvent, 'extip: two consecutive sightings announce the change');
if ($e instanceof HubEvent) {
    check($e->dedupeKey === 'extip:' . substr(sha1('203.0.113.9'), 0, 12) . ':' . ($T + 900), 'extip: dedupe_key = extip:{sha1(ip) short}:{first seen}');
    check($e->payload['subject']['external_ip'] === ['old' => '203.0.113.5', 'new' => '203.0.113.9', 'since' => $T + 900], 'extip: payload carries old and new address');
    check($e->severity === HubEvent::SEVERITY_WARNING, 'extip: an address change is a warning');
    check($e->occurredAt === $T + 900, 'extip: occurred_at = first sighting of the new address');
}
check($c2['ip'] === '203.0.113.9' && !isset($c2['candidate']), 'extip: the confirmed address becomes the known one');
[$e] = ExternalIpSource::observe($c2, '203.0.113.9', $T + 2000, $interval);
check($e === null, 'extip: a repeated poll of the same address is silent');

// a failed lookup breaks the "consecutive" chain and is not a change
[$e, $failed] = ExternalIpSource::observe($c1, null, $T + 960, $interval);
check($e === null && !isset($failed['candidate']), 'extip: a failed lookup drops the candidate');
check($failed['next_check_at'] === $T + 960 + ExternalIpSource::FAILED_RETRY_SEC, 'extip: a failed lookup is retried soon');
check($failed['ip'] === '203.0.113.5', 'extip: a failed lookup keeps the known address');
[$e] = ExternalIpSource::observe($failed, '203.0.113.9', $T + 1020, $interval);
check($e === null, 'extip: after a failure the address must be seen twice again');

// coming back to an earlier address later is a new event with a new key
$back = ['ip' => '203.0.113.9', 'next_check_at' => 0];
[, $c3] = ExternalIpSource::observe($back, '203.0.113.5', $T + 3000, $interval);
[$e4] = ExternalIpSource::observe($c3, '203.0.113.5', $T + 3060, $interval);
check($e4 instanceof HubEvent && str_ends_with($e4->dedupeKey, (string)($T + 3000)), 'extip: a later return is a new event');

// poll(): due / not due / urgent recheck
check(ExternalIpSource::isDue([], $T), 'extip: the baseline is due at once');
check(!ExternalIpSource::isDue(['ip' => '203.0.113.5', 'next_check_at' => $T + 600], $T), 'extip: not due before next_check_at');
check(ExternalIpSource::isDue(['ip' => '203.0.113.5', 'next_check_at' => $T + 600, 'recheck' => true], $T), 'extip: a network change makes the check due immediately');

$h4 = new PbxHarness();
$h4->states->setEnabled(ExternalIpSource::ID, true, 0);
$extIp = new ExternalIpSource(static fn (): int => 15);
$reader = new PathRestReader([ExternalIpSource::PATH => ['ip' => '203.0.113.5']]);
$h4->pollOnce($extIp, $reader, $T);
check($reader->calls[ExternalIpSource::PATH] === 1, 'extip: the baseline calls Core once');
check($h4->cursor(ExternalIpSource::ID)['ip'] === '203.0.113.5', 'extip: the baseline stores the current address');
check($h4->count(ExternalIpSource::ID) === 0, 'extip: the baseline emits nothing');
$h4->pollOnce($extIp, $reader, $T + 60);
check($reader->calls[ExternalIpSource::PATH] === 1, 'extip: a poll before the interval does not call the external service');
$h4->states->saveCursor(ExternalIpSource::ID, ['recheck' => true] + $h4->cursor(ExternalIpSource::ID));
$h4->pollOnce($extIp, $reader, $T + 120);
check($reader->calls[ExternalIpSource::PATH] === 2, 'extip: a recheck after a network change calls Core at once');

// a Core answer without an address (no internet) is not a change and not a source error
$h5 = new PbxHarness();
$h5->states->setEnabled(ExternalIpSource::ID, true, 0);
$h5->pollOnce($extIp, new PathRestReader([ExternalIpSource::PATH => ['ip' => '203.0.113.5']]), $T);
$badAnswer = new PathRestReader([], 'api_bad_response');
$h5->pollOnce($extIp, $badAnswer, $T + 900);
$state = $h5->states->get(ExternalIpSource::ID);
check($h5->count(ExternalIpSource::ID) === 0, 'extip: a failed lookup emits nothing');
check($state['availability'] === SourceAvailability::AVAILABLE, 'extip: a failed lookup is not a source error');
check($state['last_error_code'] === '', 'extip: no error code for a failed lookup');
check(ExternalIpSource::isDue($state['cursor'], $T + 960), 'extip: the next attempt happens in a minute');

// a key problem stays visible
$h6 = new PbxHarness();
$h6->states->setEnabled(ExternalIpSource::ID, true, 0);
$h6->pollOnce($extIp, new PathRestReader([], 'api_unauthorized'), $T);
check($h6->states->get(ExternalIpSource::ID)['availability'] === SourceAvailability::API_FORBIDDEN, 'extip: 401 stays api_forbidden');

// ======================= C3: license expiry =======================
$licenceJson = fixtureRaw('pbx-license/license-info.json');
$products = LicenseExpirySource::productsFrom($licenceJson);
check(is_array($products) && count($products) === 2, 'license: both products of the document are read');
check(($products[0]['name'] ?? '') === 'MikoPBX' && ($products[0]['expiry'] ?? '') === '2026-12-31', 'license: product name and expiry');
check(($products[1]['name'] ?? '') === 'Smart IVR', 'license: the second product');
check(strlen((string)($products[0]['key'] ?? '')) === 12, 'license: the product key is a short hash, never the name');
check(LicenseExpirySource::productsFrom(fixtureRaw('pbx-license/license-trial-no-date.json')) === [], 'license: a product without a date carries nothing to watch');
check(LicenseExpirySource::productsFrom('not json') === null, 'license: garbage is not a licence document');
check(LicenseExpirySource::productsFrom('') === null, 'license: an empty answer is not a licence document');
check(LicenseExpirySource::productsFrom('{"@attributes":{"companyname":"x"}}') === [], 'license: a document without products has nothing to watch');

// day arithmetic around the expiry date
$expiryTs = strtotime('2026-12-31 12:00:00');
check(LicenseExpirySource::daysLeft('2026-12-31', $expiryTs) === 0, 'license: the expiry day is day 0');
check(LicenseExpirySource::daysLeft('2026-12-31', $expiryTs - 14 * 86400) === 14, 'license: fourteen days before');
check(LicenseExpirySource::daysLeft('2026-12-31', $expiryTs + 86400) === -1, 'license: the day after is negative');
check((LicenseExpirySource::productsFrom('{"product":{"@attributes":{"name":"P","expired":"31.12.2026"}}}') ?? []) === [], 'license: a non ISO date is not a date');

$buckets = [14, 7, 1];
// baseline: early buckets are silent, the urgent current state is announced
$h7 = new PbxHarness();
$h7->states->setEnabled(LicenseExpirySource::ID, true, 0);
$licenceReader = static fn (string $json): PathRestReader => new PathRestReader([LicenseExpirySource::PATH => ['licenseInfo' => $json]]);
$at20 = LicenseExpirySource::buildBatch(
    [['key' => 'aaaa', 'name' => 'MikoPBX', 'expiry' => '2026-12-31']],
    [],
    $expiryTs - 20 * 86400,
    $buckets,
    6 * 3600
);
check($at20->events === [] && $at20->cursor['baseline_done'] === true, 'license: a baseline 20 days before the expiry is silent');
$at7 = LicenseExpirySource::buildBatch(
    [['key' => 'aaaa', 'name' => 'MikoPBX', 'expiry' => '2026-12-31']],
    [],
    $expiryTs - 7 * 86400,
    $buckets,
    6 * 3600
);
check($at7->events === [], 'license: a baseline 7 days before the expiry is silent (not the last bucket)');
check($at7->cursor['products']['aaaa']['sent'] === ['14', '7'], 'license: the passed buckets are recorded as sent');
$at1 = LicenseExpirySource::buildBatch(
    [['key' => 'aaaa', 'name' => 'MikoPBX', 'expiry' => '2026-12-31']],
    [],
    $expiryTs - 86400,
    $buckets,
    6 * 3600
);
check(count($at1->events) === 1 && $at1->events[0]->payload['subject']['license']['bucket'] === '1', 'license: a baseline at 1 day announces the last reminder');
$expiredBaseline = LicenseExpirySource::buildBatch(
    [['key' => 'aaaa', 'name' => 'MikoPBX', 'expiry' => '2026-12-31']],
    [],
    $expiryTs + 86400,
    $buckets,
    6 * 3600
);
check(count($expiredBaseline->events) === 1 && $expiredBaseline->events[0]->severity === HubEvent::SEVERITY_CRITICAL, 'license: an already expired product is announced at the baseline');

// a running series: 14 -> 7 -> 1 -> expired, each exactly once
$cursor = ['baseline_done' => true, 'next_check_at' => 0];
$product = [['key' => 'k1', 'name' => 'MikoPBX', 'expiry' => '2026-12-31']];
$emitted = [];
foreach ([30, 14, 13, 7, 6, 1, 0, -1, -2] as $days) {
    $batch = LicenseExpirySource::buildBatch($product, $cursor, $expiryTs - $days * 86400, $buckets, 6 * 3600);
    $cursor = $batch->cursor;
    foreach ($batch->events as $event) {
        $emitted[] = $event->payload['subject']['license']['bucket'];
    }
}
check($emitted === ['14', '7', '1', 'expired'], 'license: one reminder per bucket and one for the expiry');
check($cursor['products']['k1']['sent'] === ['expired'], 'license: the series ends at "expired"');

// a late start (no stored series) does not dump three reminders at once
$late = LicenseExpirySource::buildBatch($product, ['baseline_done' => true], $expiryTs - 3 * 86400, $buckets, 6 * 3600);
check(count($late->events) === 1 && $late->events[0]->payload['subject']['license']['bucket'] === '7', 'license: a late start sends only the current bucket');

// a renewal (new date) starts a new series; the dedupe key carries the date
$renewalTs = strtotime('2027-12-31 12:00:00');
$renewed = LicenseExpirySource::buildBatch(
    [['key' => 'k1', 'name' => 'MikoPBX', 'expiry' => '2027-12-31']],
    $cursor,
    $renewalTs - 10 * 86400,
    $buckets,
    6 * 3600
);
check(count($renewed->events) === 1 && str_contains($renewed->events[0]->dedupeKey, '2027-12-31'), 'license: a renewal re-arms the reminders');

// no document: nothing emitted, the series survives, the next check is sooner
$noDoc = LicenseExpirySource::buildBatch(null, $cursor, $T, $buckets, 6 * 3600);
check($noDoc->events === [], 'license: a missing document emits nothing');
check($noDoc->cursor['products'] === $cursor['products'], 'license: a missing document keeps the series');
check($noDoc->cursor['next_check_at'] === $T + LicenseExpirySource::FAILED_RETRY_SEC, 'license: a missing document retries in 30 minutes');

// a custom bucket list
$custom = LicenseExpirySource::buildBatch(
    [['key' => 'k2', 'name' => 'Smart IVR', 'expiry' => '2026-12-31']],
    ['baseline_done' => true],
    $expiryTs - 20 * 86400,
    [30, 3],
    6 * 3600
);
check(count($custom->events) === 1 && $custom->events[0]->payload['subject']['license']['bucket'] === '30', 'license: a custom bucket list is honoured');

// poll(): baseline, cadence, document shape
$h8 = new PbxHarness();
$h8->states->setEnabled(LicenseExpirySource::ID, true, 0);
$licenseSource = new LicenseExpirySource(static fn (): int => 6, static fn (): array => [14, 7, 1]);
$reader8 = $licenceReader($licenceJson);
$h8->pollOnce($licenseSource, $reader8, $T);
check($reader8->calls[LicenseExpirySource::PATH] === 1, 'license: the baseline asks Core once');
$licenseCursor = $h8->cursor(LicenseExpirySource::ID);
check($licenseCursor['baseline_done'] === true && count($licenseCursor['products']) === 2, 'license: the baseline stores both products');
check($h8->count(LicenseExpirySource::ID) === 0, 'license: the baseline emits nothing');
$h8->pollOnce($licenseSource, $reader8, $T + 300);
check($reader8->calls[LicenseExpirySource::PATH] === 1, 'license: no check before six hours');

$h9 = new PbxHarness();
$h9->states->setEnabled(LicenseExpirySource::ID, true, 0);
$h9->pollOnce($licenseSource, new PathRestReader([], 'api_bad_response'), $T);
check($h9->states->get(LicenseExpirySource::ID)['availability'] === SourceAvailability::AVAILABLE, 'license: "no licence document" is not a source error');
check($h9->count(LicenseExpirySource::ID) === 0, 'license: "no licence document" emits nothing');

// ======================= templates =======================
$texts = hubTestTexts();
$context = new RenderContext($texts, new LinkBuilder('https://pbx.example'));
$templates = new TemplateRegistry();

$configEvent = ConfigChangeSource::flush(
    ['pending' => ['providers' => ['set' => 2, 'del' => 0], 'routing' => ['set' => 1, 'del' => 1]], 'since' => $T, 'last' => $T + 30],
    60,
    $T + 90
)[0];
$rendered = $configEvent === null ? null : $templates->forEvent('core.config_changed')?->render($configEvent, $context);
check($rendered !== null && str_contains($rendered->title, 'Изменения конфигурации АТС'), 'template: config title');
check(in_array('Провайдеры — 2', $rendered?->lines ?? [], true), 'template: area name and count');
check(in_array('Маршрутизация — 2', $rendered?->lines ?? [], true), 'template: changed and deleted are counted together');
check(in_array('удалено записей: 1', $rendered?->notes ?? [], true), 'template: deletions as a note');
check(!str_contains(implode(' ', $rendered?->lines ?? []), 'IncomingRoutingTable'), 'template: no raw model names');

$ipEvent = new HubEvent(
    sourceId: ExternalIpSource::ID,
    eventType: 'core.external_ip_changed',
    severity: HubEvent::SEVERITY_WARNING,
    dedupeKey: 'extip:x:1',
    occurredAt: $T,
    payload: ['subject' => ['external_ip' => ['old' => '203.0.113.5', 'new' => '203.0.113.9', 'since' => $T]]]
);
$rendered = $templates->forEvent('core.external_ip_changed')?->render($ipEvent, $context);
check($rendered !== null && str_contains($rendered->title, 'Внешний IP-адрес изменился'), 'template: external IP title');
check(($rendered?->lines[0] ?? '') === '203.0.113.5 → 203.0.113.9', 'template: old and new address');

$licenseEvent = new HubEvent(
    sourceId: LicenseExpirySource::ID,
    eventType: 'core.license_expiring',
    severity: HubEvent::SEVERITY_WARNING,
    dedupeKey: 'license:x:2026-12-31:7',
    occurredAt: $T,
    payload: ['subject' => ['license' => ['product' => 'MikoPBX', 'expiry' => '2026-12-31', 'days_left' => 7, 'bucket' => '7']]]
);
$rendered = $templates->forEvent('core.license_expiring')?->render($licenseEvent, $context);
check($rendered !== null && str_contains($rendered->title, 'Срок лицензии истекает'), 'template: license title');
check(in_array('MikoPBX', $rendered?->lines ?? [], true), 'template: product name');
check(in_array('Действует до 31.12.2026', $rendered?->lines ?? [], true), 'template: expiry date in the PBX format');
check(in_array('Осталось дней: 7', $rendered?->notes ?? [], true), 'template: days left');
check(!str_contains((string)json_encode($rendered?->toArray()), 'MIKO-'), 'template: the licence key never appears');

$expiredEvent = new HubEvent(
    sourceId: LicenseExpirySource::ID,
    eventType: 'core.license_expiring',
    severity: HubEvent::SEVERITY_CRITICAL,
    dedupeKey: 'license:x:2026-12-31:expired',
    occurredAt: $T,
    payload: ['subject' => ['license' => ['product' => 'MikoPBX', 'expiry' => '2026-12-31', 'days_left' => -1, 'bucket' => 'expired']]]
);
$rendered = $templates->forEvent('core.license_expiring')?->render($expiredEvent, $context);
check(in_array('Истекла 31.12.2026', $rendered?->lines ?? [], true), 'template: the expired state is worded differently');
check(str_starts_with($rendered?->title ?? '', '🛑'), 'template: expired is critical-looking');

// ======================= settings =======================
$db = hubTestDatabase();
$settings = new HubSettings($db);
check($settings->configChangeQuietSec() === 60, 'settings: the quiet window defaults to 60 s');
check($settings->externalIpPollMin() === 15, 'settings: the external IP check defaults to 15 minutes');
check($settings->licensePollHours() === 6, 'settings: the license check defaults to 6 hours');
check($settings->licenseWarnDays() === [14, 7, 1], 'settings: the licence buckets default to 14,7,1');

$settings->set(HubSettings::CONFIG_CHANGE_QUIET_SEC, '5');
check($settings->configChangeQuietSec() === HubSettings::CONFIG_QUIET_MIN_SEC, 'settings: a value below the minimum is clamped');
$settings->set(HubSettings::CONFIG_CHANGE_QUIET_SEC, '120');
check($settings->configChangeQuietSec() === 120, 'settings: a stored value inside the range is used');
$settings->set(HubSettings::EXTERNAL_IP_POLL_MIN, 'abc');
check($settings->externalIpPollMin() === 15, 'settings: garbage falls back to the default');
$settings->set(HubSettings::LICENSE_POLL_HOURS, '9999');
check($settings->licensePollHours() === HubSettings::LICENSE_POLL_HOURS_MAX, 'settings: an out-of-range interval is clamped');

$settings->set(HubSettings::LICENSE_WARN_DAYS, '30, 30,3');
check($settings->licenseWarnDays() === [30, 3], 'settings: buckets are unique and newest first');
$settings->set(HubSettings::LICENSE_WARN_DAYS, '0,400');
check($settings->licenseWarnDays() === [14, 7, 1], 'settings: out-of-range buckets fall back to the default list');
$settings->set(HubSettings::LICENSE_WARN_DAYS, '365,300,200,100,50,10');
check(count($settings->licenseWarnDays()) === 5, 'settings: at most five buckets are kept');
check(HubSettings::warnDaysToString([7, 14, 1]) === '14,7,1', 'settings: canonical storage form');
check(HubSettings::parseWarnDays('') === [14, 7, 1], 'settings: an empty list parses to the default');
check(HubSettings::SECRET_KEYS === [HubSettings::HUB_API_KEY], 'settings: no new secret keys');

// nothing personal or secret leaves the three events: no phone numbers, no licence key, no registration data
$payloads = [
    (string)json_encode($configEvent?->payload, JSON_UNESCAPED_UNICODE),
    (string)json_encode($ipEvent->payload, JSON_UNESCAPED_UNICODE),
    (string)json_encode($licenseEvent->payload, JSON_UNESCAPED_UNICODE),
    (string)json_encode($expiredEvent->payload, JSON_UNESCAPED_UNICODE),
];
foreach ($payloads as $index => $payloadJson) {
    check(!preg_match('~\+7|79\d{9}~', $payloadJson), 'payload ' . $index . ': no phone numbers');
}
foreach ([$licenseEvent, $expiredEvent] as $event) {
    $license = $event->payload['subject']['license'];
    check(!array_key_exists('key', $license) && !array_key_exists('companyname', $license), 'license: no licence key or registration data in the payload');
}

// the values the sources read are the same keys the settings resource exposes
foreach ([
    HubSettings::CONFIG_CHANGE_QUIET_SEC,
    HubSettings::EXTERNAL_IP_POLL_MIN,
    HubSettings::LICENSE_POLL_HOURS,
    HubSettings::LICENSE_WARN_DAYS,
] as $key) {
    check(isset(HubSettings::DEFAULTS[$key]), 'settings: ' . $key . ' has a default');
}

finish('PBX configuration sources OK');
