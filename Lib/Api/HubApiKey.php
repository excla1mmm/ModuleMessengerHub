<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Api;

use MikoPBX\Common\Models\ApiKeys;
use MikoPBX\PBXCoreREST\Services\TokenValidationService;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;
use RuntimeException;

/**
 * The hub's own restricted, read-only Core API key (Plan/11-open-questions.md, decision Q1).
 *
 * - full_permissions = '0', allowed_paths = {path: 'read'} for enabled sources only — never 'write' or 'admin';
 * - Core stores only the bcrypt hash; the plain key is a hub secret in m_MessengerHubSettings;
 * - a path-set change rewrites allowed_paths on the existing record (Q15: same id and secret, so polls
 *   running with the old secret stay authorised; TokenValidationService cache is dropped so the new
 *   paths take effect at once); a new key is generated only when the record is gone;
 * - revoked when the module is disabled: allowed_paths is emptied but the record is kept (see revoke()),
 *   so the key authorises nothing; remove() deletes the record itself.
 *
 * Uses Core's ApiKeys model (as ModuleLocalSpeechToText does for worker keys) — this does not modify Core.
 */
final class HubApiKey implements ApiKeySync, ApiKeyRepairer
{
    public const string DESCRIPTION = 'ModuleMessengerHub (read-only sources)';

    public function __construct(private readonly HubSettings $settings)
    {
    }

    /**
     * Ensures a key exists with exactly $paths readable. Returns the plain key ('' when no paths are needed).
     *
     * @param list<string> $paths Core REST paths without the /pbxcore prefix, e.g. "/api/v3/advice"
     */
    public function sync(array $paths): string
    {
        sort($paths, SORT_STRING);
        $paths = array_values(array_unique($paths));
        if ($paths === []) {
            $this->remove();

            return '';
        }
        $wanted = KeySyncPlan::pathsJson($paths);
        $plain = $this->settings->get(HubSettings::HUB_API_KEY);
        $id = (int)$this->settings->get(HubSettings::HUB_API_KEY_ID);
        $record = $this->ownKey($id);

        return match (KeySyncPlan::decide(
            $plain,
            $id,
            $this->settings->get(HubSettings::HUB_API_KEY_PATHS),
            $wanted,
            $record !== null
        )) {
            KeySyncPlan::KEEP => $plain,
            KeySyncPlan::UPDATE_PATHS => $this->updatePaths($record, $id, $paths, $wanted),
            default => $this->create($paths),
        };
    }

    /**
     * Strips every path from the key while keeping the record: a module disable (including the one
     * inside a package update) must not churn the key — the same id and secret come back through
     * sync() when the module is enabled again (Q15). A full_permissions='0' record with an empty
     * path set is inert: ApiKeyPermissionChecker denies every request. Uninstall has no hook of its
     * own, so it leaves this inert record; the next install sweeps it by description (create()).
     */
    public function revoke(): void
    {
        $record = $this->ownKey((int)$this->settings->get(HubSettings::HUB_API_KEY_ID));
        if ($record !== null) {
            $record->allowed_paths = '{}';
            if (!$record->save()) {
                throw new RuntimeException('hub_api_key_save_failed');
            }
            TokenValidationService::clearCache();
            HubLogger::event('api_key', 'revoked', ['key_id' => (int)$record->id]);
        }
        // the stored path set no longer matches the record: the next sync must not KEEP against it
        $this->settings->delete(HubSettings::HUB_API_KEY_PATHS);
    }

    public function remove(): void
    {
        $deleted = $this->deleteOwnKey((int)$this->settings->get(HubSettings::HUB_API_KEY_ID));
        if (!$deleted) {
            // the stored id is gone or points at a foreign record (crashed sync): the description finds our leftover
            $leftover = ApiKeys::findFirst(
                ['conditions' => 'description = :desc:', 'bind' => ['desc' => self::DESCRIPTION]]
            );
            if ($leftover instanceof ApiKeys && $leftover->delete()) {
                $deleted = true;
            }
        }
        if ($deleted) {
            TokenValidationService::clearCache();
        }
        $this->settings->delete(HubSettings::HUB_API_KEY);
        $this->settings->delete(HubSettings::HUB_API_KEY_ID);
        $this->settings->delete(HubSettings::HUB_API_KEY_PATHS);
    }

    public function plainKey(): string
    {
        return $this->settings->get(HubSettings::HUB_API_KEY);
    }

    /**
     * Self-diagnosis without network (Plan/11 Q14): the record is ours, the stored plain key still
     * matches the Core hash, allowed_paths equal the wanted set.
     *
     * @param list<string> $paths
     */
    public function verify(array $paths): string
    {
        $plain = $this->settings->get(HubSettings::HUB_API_KEY);
        $record = $this->ownKey((int)$this->settings->get(HubSettings::HUB_API_KEY_ID));
        $secretMatches = $record instanceof ApiKeys
            && $plain !== ''
            && password_verify($plain, (string)$record->key_hash);
        $pathsMatch = $record instanceof ApiKeys
            && KeySyncPlan::normalizePathsJson((string)$record->allowed_paths) === KeySyncPlan::pathsJson($paths);

        return KeyHealth::diagnose($record instanceof ApiKeys, $secretMatches, $pathsMatch);
    }

    /**
     * Repairs the key in place when only the path set drifted, recreates it when the record is gone
     * or the secret no longer authenticates. Logs the reason as a code, never the secret.
     *
     * @param list<string> $paths
     */
    public function repair(array $paths): void
    {
        $health = $this->verify($paths);
        if (!KeyHealth::needsRepair($health)) {
            return;
        }
        HubLogger::event('api_key', 'self_heal', ['reason' => $health], LOG_WARNING);
        if ($health === KeyHealth::PATHS_STALE) {
            $record = $this->ownKey((int)$this->settings->get(HubSettings::HUB_API_KEY_ID));
            if ($record instanceof ApiKeys) {
                $this->updatePaths($record, (int)$record->id, $paths, KeySyncPlan::pathsJson($paths));

                return;
            }
        }
        $this->create($paths);
    }

    /**
     * Same id, same secret, new path set (Q15). Polls keep working while Core reloads the key.
     *
     * @param list<string> $paths
     */
    private function updatePaths(ApiKeys $record, int $id, array $paths, string $wanted): string
    {
        $record->allowed_paths = json_encode(
            array_fill_keys($paths, 'read'),
            JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        );
        if (!$record->save()) {
            throw new RuntimeException('hub_api_key_save_failed');
        }
        TokenValidationService::clearCache();
        $this->settings->set(HubSettings::HUB_API_KEY_PATHS, $wanted);
        HubLogger::event('api_key', 'paths_updated', ['key_id' => $id, 'paths' => count($paths)]);

        return (string)$this->settings->get(HubSettings::HUB_API_KEY);
    }

    /** @param list<string> $paths */
    private function create(array $paths): string
    {
        $this->remove();
        $plain = ApiKeys::generateApiKey();
        $key = new ApiKeys();
        $key->description = self::DESCRIPTION;
        $key->key_hash = password_hash($plain, PASSWORD_BCRYPT);
        $key->key_suffix = substr($plain, -4);
        $key->key_display = substr($plain, 0, 5) . '...' . substr($plain, -5);
        $key->networkfilterid = null;
        $key->full_permissions = '0';
        $key->allowed_paths = json_encode(
            array_fill_keys($paths, 'read'),
            JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        );
        $key->created_at = date('Y-m-d H:i:s');
        if (!$key->save()) {
            throw new RuntimeException('hub_api_key_save_failed');
        }
        TokenValidationService::clearCache();

        $this->settings->set(HubSettings::HUB_API_KEY, $plain);
        $this->settings->set(HubSettings::HUB_API_KEY_ID, (string)$key->id);
        $this->settings->set(HubSettings::HUB_API_KEY_PATHS, KeySyncPlan::pathsJson($paths));
        HubLogger::event('api_key', 'created', ['key_id' => (int)$key->id, 'paths' => count($paths)]);

        return $plain;
    }

    /** The Core record at $id when it exists and is ours; null otherwise (foreign keys are never touched). */
    private function ownKey(int $id): ?ApiKeys
    {
        if ($id <= 0) {
            return null;
        }
        $key = ApiKeys::findFirstById($id);

        return ($key instanceof ApiKeys && (string)$key->description === self::DESCRIPTION) ? $key : null;
    }

    private function deleteOwnKey(int $id): bool
    {
        $key = $this->ownKey($id);

        return $key instanceof ApiKeys && $key->delete();
    }
}
