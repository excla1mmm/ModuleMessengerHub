<?php

declare(strict_types=1);

// The hub's own Core API key (Plan/07, Plan/11 Q1/Q10): exact path -> level map (admin only on the two
// Local STT paths), full_permissions 0, bound to localhost, repaired in place when a filter or level drifts.
// HubApiKey runs here against stand-ins for Core's ApiKeys model and token cache.

namespace MikoPBX\Common\Models {

    class ApiKeys
    {
        /** @var array<int, ApiKeys> */
        public static array $rows = [];
        private static int $next = 1;

        public $id;
        public ?string $description = '';
        public ?string $key_hash = '';
        public ?string $key_suffix = '';
        public ?string $key_display = '';
        public ?string $networkfilterid = '';
        public ?string $full_permissions = '0';
        public ?string $allowed_paths = '';
        public ?string $created_at = '';

        public static function generateApiKey(): string
        {
            return 'hubkey' . bin2hex(random_bytes(12));
        }

        public static function findFirstById(int $id): ?self
        {
            return self::$rows[$id] ?? null;
        }

        public static function findFirst(array $params = []): ?self
        {
            foreach (self::$rows as $row) {
                if ($row->description === ($params['bind']['desc'] ?? null)) {
                    return $row;
                }
            }

            return null;
        }

        public function save(): bool
        {
            if ($this->id === null) {
                $this->id = self::$next++;
            }
            self::$rows[(int)$this->id] = $this;

            return true;
        }

        public function delete(): bool
        {
            unset(self::$rows[(int)$this->id]);

            return true;
        }
    }
}

namespace MikoPBX\PBXCoreREST\Services {

    class TokenValidationService
    {
        public static int $cleared = 0;

        public static function clearCache(): void
        {
            self::$cleared++;
        }
    }
}

namespace {

require __DIR__ . '/support/bootstrap.php';

use MikoPBX\Common\Models\ApiKeys;
use Modules\ModuleMessengerHub\Lib\Api\HubApiKey;
use Modules\ModuleMessengerHub\Lib\Api\KeyHealth;
use Modules\ModuleMessengerHub\Lib\Api\KeyPermissions;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Sources\ApiKeyPaths;
use Modules\ModuleMessengerHub\Lib\Sources\SourceAvailability;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRegistry;

// ---------- the exact path -> level map ----------

$allPaths = ApiKeyPaths::compute(
    SourceRegistry::default()->pollSources(),
    static fn (string $id): bool => true,
    static fn (string $module): string => SourceAvailability::AVAILABLE
);
$map = KeyPermissions::map($allPaths);
check($map === [
    '/api/v3/advice' => 'read',
    '/api/v3/license' => 'read',
    '/api/v3/module-ai-supervisor/calls' => 'read',
    '/api/v3/module-ai-supervisor/workers' => 'read',
    '/api/v3/module-cloud-ai-supervisor/runtime' => 'read',
    '/api/v3/module-cloud-speech-to-text/status' => 'read',
    '/api/v3/module-local-speech-to-text/jobs' => 'admin',
    '/api/v3/module-local-speech-to-text/workers' => 'admin',
    '/api/v3/module-voice-agent/callbacks' => 'read',
    '/api/v3/module-voice-agent/runtime' => 'read',
    '/api/v3/sysinfo' => 'read',
], 'key: exact path -> level map (admin only on the two Local STT paths)');
$withCdr = KeyPermissions::map(ApiKeyPaths::attentionCdr($allPaths, true));
check(($withCdr['/api/v3/cdr'] ?? '') === 'read', 'key: the CDR path (attachments rule) is read');
check(array_keys(array_filter($withCdr, static fn (string $l): bool => $l === 'admin')) === KeyPermissions::ADMIN_PATHS, 'key: admin appears on exactly the two Local STT paths');
check(!in_array('write', $withCdr, true), 'key: write is never granted');
check(KeyPermissions::levelFor('/api/v3/module-local-speech-to-text/call-transcripts') === 'read', 'key: other Local STT paths stay read');
check(KeyPermissions::levelFor('/api/v3/module-local-speech-to-text/workers/5') === 'read', 'key: the admin level is for the exact resource path only');
check(KeyPermissions::FULL_PERMISSIONS === '0' && KeyPermissions::NETWORK_FILTER === 'localhost', 'key: constants');

// ---------- KeyHealth: a changed network filter is unhealthy ----------

check(KeyHealth::diagnose(true, true, true, false) === KeyHealth::NETWORK_STALE, 'key: a filter other than localhost is unhealthy');
check(KeyHealth::diagnose(true, true, true, true) === KeyHealth::HEALTHY, 'key: localhost + paths + secret is healthy');
check(KeyHealth::diagnose(true, true, false, false) === KeyHealth::PATHS_STALE, 'key: paths drift is reported before the filter');
check(KeyHealth::needsRepair(KeyHealth::NETWORK_STALE) && KeyHealth::isInPlaceRepair(KeyHealth::NETWORK_STALE), 'key: filter drift is repaired in place');
check(!KeyHealth::isInPlaceRepair(KeyHealth::MISSING) && !KeyHealth::isInPlaceRepair(KeyHealth::SECRET_INVALID), 'key: a missing record or lost secret is recreated, not patched');
check(KeyPermissions::networkMatches('localhost') && !KeyPermissions::networkMatches('') && !KeyPermissions::networkMatches('none') && !KeyPermissions::networkMatches(null) && !KeyPermissions::networkMatches('0'), 'key: only "localhost" matches');
check(KeyPermissions::pathsMatch('{"/api/v3/b":"read","/api/v3/a":"read"}', ['/api/v3/a', '/api/v3/b']), 'key: order of stored paths does not matter');
check(!KeyPermissions::pathsMatch('{"/api/v3/module-local-speech-to-text/jobs":"read"}', ['/api/v3/module-local-speech-to-text/jobs']), 'key: a stored level below the wanted one is stale');
check(!KeyPermissions::pathsMatch('{"/api/v3/advice":"write"}', ['/api/v3/advice']), 'key: a wider stored level is stale');
check(!KeyPermissions::pathsMatch('garbage', ['/api/v3/advice']) && !KeyPermissions::pathsMatch('{}', []), 'key: garbage or empty never matches');

// ---------- HubApiKey: create, verify, repair, sync ----------

$db = hubTestDatabase();
$settings = new HubSettings($db);
$key = new HubApiKey($settings);
$paths = array_keys($map);

$plain = $key->sync($paths);
check((int)$settings->get(HubSettings::HUB_API_KEY_GRACE_UNTIL) > time(), 'create: the Core token cache grace window starts');
$id = (int)$settings->get(HubSettings::HUB_API_KEY_ID);
$record = ApiKeys::findFirstById($id);
check($plain !== '' && $record instanceof ApiKeys, 'create: a record exists');
check($record->networkfilterid === 'localhost', 'create: networkfilterid = localhost');
check($record->full_permissions === '0', 'create: full_permissions = 0');
check(json_decode((string)$record->allowed_paths, true) === $map, 'create: allowed_paths is the level map');
check($key->verify($paths) === KeyHealth::HEALTHY, 'create: the new key is healthy');

// the filter is changed by hand (or the key comes from an older package): verify notices, repair keeps id and secret
$record->networkfilterid = null;
check($key->verify($paths) === KeyHealth::NETWORK_STALE, 'verify: a missing filter is network_stale');
$key->repair($paths);
check($record->networkfilterid === 'localhost', 'repair: the localhost filter is set again');
check((int)$settings->get(HubSettings::HUB_API_KEY_ID) === $id && $settings->get(HubSettings::HUB_API_KEY) === $plain, 'repair: same id and same secret (Q15)');
check($key->verify($paths) === KeyHealth::HEALTHY, 'repair: healthy again');

$record->networkfilterid = 'none';
check($key->verify($paths) === KeyHealth::NETWORK_STALE, 'verify: filter "none" (any address) is unhealthy');
check($key->sync($paths) === $plain && $record->networkfilterid === 'localhost', 'sync with an unchanged path set still restores the filter');

// a hand-widened level or full permissions
$record->allowed_paths = json_encode(array_fill_keys($paths, 'write'), JSON_UNESCAPED_SLASHES);
check($key->verify($paths) === KeyHealth::PATHS_STALE, 'verify: wider levels are paths_stale');
$key->repair($paths);
check(json_decode((string)$record->allowed_paths, true) === $map && $record->networkfilterid === 'localhost', 'repair: levels back to the map');
$record->full_permissions = '1';
check($key->verify($paths) === KeyHealth::PATHS_STALE, 'verify: full_permissions 1 is unhealthy');
$key->sync($paths);
check($record->full_permissions === '0', 'sync: full_permissions back to 0');

// a smaller path set: no admin without the Local STT sources
$small = ['/api/v3/advice', '/api/v3/module-ai-supervisor/workers'];
$settings->set(HubSettings::HUB_API_KEY_GRACE_UNTIL, '1');
$key->sync($small);
check((int)$settings->get(HubSettings::HUB_API_KEY_GRACE_UNTIL) > time(), 'sync: a path change restarts the grace window');
check(json_decode((string)$record->allowed_paths, true) === ['/api/v3/advice' => 'read', '/api/v3/module-ai-supervisor/workers' => 'read'], 'sync: no admin path when no Local STT source needs it');
check($record->networkfilterid === 'localhost' && (int)$settings->get(HubSettings::HUB_API_KEY_ID) === $id, 'sync: still localhost, same record');

// a lost secret recreates the record with the filter
$settings->set(HubSettings::HUB_API_KEY, 'wrong');
$key->repair($paths);
$new = ApiKeys::findFirstById((int)$settings->get(HubSettings::HUB_API_KEY_ID));
check($new instanceof ApiKeys && $new->networkfilterid === 'localhost' && $new->full_permissions === '0', 'repair: a recreated key is localhost-bound too');

finish('hub key record OK');
}
