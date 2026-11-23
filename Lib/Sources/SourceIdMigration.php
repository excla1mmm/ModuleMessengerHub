<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;
use Throwable;

/**
 * Stage 3b-4 (issue #1): the per-module status sources `local_stt.status`, `cloud_stt.status` and
 * `cloud_ai.status` were split into one source per kind of problem.
 *
 * For every legacy row of m_MessengerHubSourceState:
 *  - the enabled switch is copied to the new sources of the same module;
 *  - the new rows start with an empty cursor, so their first poll only records a baseline: what is
 *    already broken is "known" and silent (history is not broadcast), nothing is announced twice
 *    although the new dedupe keys carry the new source id, and no recovery is sent for pairs that
 *    were announced under the old id;
 *  - the legacy row and its `/status` capability cache entry are deleted.
 * Existing rules store event types, not source ids, so they keep matching without a rewrite.
 *
 * Idempotent and cheap (one SELECT when there is nothing to do); run by the collector worker at start
 * and before the settings REST reads the source list.
 */
final class SourceIdMigration
{
    /** legacy source id => new source ids of the same module */
    public const array LEGACY_SOURCES = [
        'local_stt.status' => ['local_stt.workers', 'local_stt.backlog'],
        'cloud_stt.status' => ['cloud_stt.incidents', 'cloud_stt.paused'],
        'cloud_ai.status' => ['cloud_ai.paused'],
    ];

    /** @return int number of legacy rows migrated */
    public static function run(HubDatabase $db): int
    {
        $migrated = 0;
        try {
            foreach (self::LEGACY_SOURCES as $legacyId => $newIds) {
                $row = $db->fetchOne(
                    'SELECT enabled FROM ' . SourceStateRepository::TABLE . ' WHERE source_id = :id',
                    ['id' => $legacyId]
                );
                if ($row === null) {
                    continue;
                }
                $enabled = (string)($row['enabled'] ?? '1') === '1' ? '1' : '0';
                foreach ($newIds as $newId) {
                    $db->execute(
                        'INSERT OR IGNORE INTO ' . SourceStateRepository::TABLE
                        . ' (source_id, enabled, cursor_json, availability, last_error_code)'
                        . " VALUES (:id, :enabled, '', '', '')",
                        ['id' => $newId, 'enabled' => $enabled]
                    );
                    // a row created lazily by the interface before the migration has never been polled
                    $db->execute(
                        'UPDATE ' . SourceStateRepository::TABLE
                        . " SET enabled = :enabled, cursor_json = '', baseline_set_at = NULL"
                        . ' WHERE source_id = :id AND last_poll_at IS NULL',
                        ['id' => $newId, 'enabled' => $enabled]
                    );
                }
                $db->execute(
                    'DELETE FROM ' . SourceStateRepository::TABLE . ' WHERE source_id = :id',
                    ['id' => $legacyId]
                );
                $db->execute(
                    'DELETE FROM ' . HubSettings::TABLE . ' WHERE key = :key',
                    ['key' => 'status_capability.' . $legacyId]
                );
                $migrated++;
            }
            // the /workers fallback is gone: its cached capability answer is dead weight
            $db->execute(
                'DELETE FROM ' . HubSettings::TABLE . ' WHERE key = :key',
                ['key' => 'status_capability.ai_supervisor.workers']
            );
        } catch (Throwable) {
            // the next start retries; a failed migration never stops the worker or the settings page
        }

        return $migrated;
    }
}
