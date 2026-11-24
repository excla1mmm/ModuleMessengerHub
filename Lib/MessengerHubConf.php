<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib;

use MikoPBX\Core\Workers\Cron\WorkerSafeScriptsCore;
use MikoPBX\Core\System\Processes;
use MikoPBX\Modules\Config\ConfigClass;
use Modules\ModuleMessengerHub\bin\WorkerMessengerHubAmi;
use Modules\ModuleMessengerHub\bin\WorkerMessengerHubCollector;
use Modules\ModuleMessengerHub\bin\WorkerMessengerHubDelivery;
use Modules\ModuleMessengerHub\bin\WorkerMessengerHubDiscovery;
use Modules\ModuleMessengerHub\Lib\Api\HubApiKey;
use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Sources\Core\ConfigChangeSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\ExternalIpSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\ExtensionNewDeviceSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\PbxStartedSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\ProviderStatusSource;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRecorder;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Modules\ModuleMessengerHub\Lib\Storage\PhalconHubDatabase;
use Modules\ModuleMessengerHub\Lib\Support\BootTime;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;
use Throwable;

/**
 * Core hook implementations (Plan/01-architecture.md, "Хуки ядра, которые реализует хаб").
 *
 * Every hook Core calls must only record the raw fact and return — no network I/O here.
 * The decision logic lives in Core-free source classes (Lib/Sources/Core/*), hooks stay thin glue.
 */
class MessengerHubConf extends ConfigClass
{
    public function getModuleWorkers(): array
    {
        return [
            [
                'type' => WorkerSafeScriptsCore::CHECK_BY_PID_NOT_ALERT,
                'worker' => WorkerMessengerHubCollector::class,
            ],
            [
                'type' => WorkerSafeScriptsCore::CHECK_BY_AMI,
                'worker' => WorkerMessengerHubAmi::class,
            ],
            [
                // the worker uses its own beanstalk tube for wake-ups, but Core only has to watch
                // the process: a lost wake-up must not cause a restart, the worker ticks anyway
                'type' => WorkerSafeScriptsCore::CHECK_BY_PID_NOT_ALERT,
                'worker' => WorkerMessengerHubDelivery::class,
            ],
            [
                // discovery sessions only: getUpdates runs here, never inside a REST request
                'type' => WorkerSafeScriptsCore::CHECK_BY_PID_NOT_ALERT,
                'worker' => WorkerMessengerHubDiscovery::class,
            ],
        ];
    }

    /**
     * Provider transitions -> debounce state in the source cursor; the collector worker emits
     * core.provider_down / core.provider_up once a state has held (ProviderStatusSource::DEBOUNCE_SEC).
     * A few local SQLite statements only, no network.
     *
     * @param array<string, mixed> $changeData {changes: [...], timestamp: int, source: string}
     */
    public function onProviderStatusChange(array $changeData): void
    {
        try {
            $changes = $changeData['changes'] ?? [];
            if (!is_array($changes) || $changes === []) {
                return;
            }
            [, $states] = $this->recorder();
            for ($attempt = 0; $attempt < 3; $attempt++) {
                $state = $states->get(ProviderStatusSource::ID);
                if (!$state['enabled']) {
                    return;
                }
                $cursor = $state['cursor'];
                $old = is_array($cursor['providers'] ?? null) ? $cursor['providers'] : [];
                $new = ProviderStatusSource::applyChanges($changes, $old, time());
                if ($new === $old
                    || $states->compareAndSaveCursor(ProviderStatusSource::ID, $cursor, ['providers' => $new] + $cursor)) {
                    return;
                }
            }
            HubLogger::event('hook', 'provider_status_conflict', [], LOG_WARNING);
        } catch (Throwable $exception) {
            HubLogger::event('hook', 'provider_status_failed', ['error' => $exception::class], LOG_ERR);
        }
    }

    /**
     * Extension status changes -> raw device facts queued in the source cursor. The collector worker
     * folds them and records `core.extension_new_device` events (Plan/02-sources.md, 4s-A). Only
     * device_added / status_change entries carry a device list; a couple of local SQLite statements
     * and no network here, exactly like the provider hook above.
     *
     * @param array<string, mixed> $changeData {changes: [...], timestamp: int, source: string}
     */
    public function onExtensionStatusChange(array $changeData): void
    {
        try {
            $changes = $changeData['changes'] ?? [];
            if (!is_array($changes) || $changes === []) {
                return;
            }
            [, $states] = $this->recorder();
            for ($attempt = 0; $attempt < 3; $attempt++) {
                $state = $states->get(ExtensionNewDeviceSource::ID);
                if (!$state['enabled']) {
                    return;
                }
                $cursor = $state['cursor'];
                $pending = is_array($cursor['pending'] ?? null) ? $cursor['pending'] : [];
                $new = ExtensionNewDeviceSource::queueChanges($changes, $pending, time());
                if ($new === $pending
                    || $states->compareAndSaveCursor(ExtensionNewDeviceSource::ID, $cursor, ['pending' => $new] + $cursor)) {
                    return;
                }
            }
            HubLogger::event('hook', 'extension_device_conflict', [], LOG_WARNING);
        } catch (Throwable $exception) {
            HubLogger::event('hook', 'extension_device_failed', ['error' => $exception::class], LOG_ERR);
        }
    }

    /** PBX boot -> one core.pbx_started event per boot (dedupe by boot time). */
    public function onAfterPbxStarted(): void
    {
        try {
            $event = PbxStartedSource::buildEvent(BootTime::detect(), time());
            if ($event === null) {
                return;
            }
            [$recorder] = $this->recorder();
            $recorder->record($event, time());
        } catch (Throwable $exception) {
            HubLogger::event('hook', 'pbx_started_failed', ['error' => $exception::class], LOG_ERR);
        }
    }

    /**
     * Core reports one ORM write of a main-DB model (WorkerModelsEvents::processModelChanges,
     * src/Core/Workers/WorkerModelsEvents.php:605-631). The hook only folds the fact into the source
     * cursor: ConfigChangeSource::fact() filters out everything the hub does not care about (its own
     * tables, other modules, CDR, service tables, self-rewritten settings keys) before any database
     * access, and the collector worker coalesces the facts into one event after a quiet window.
     * Changed field VALUES are never stored or logged (PbxSettings changes carry old/new values).
     *
     * @param mixed $data {source, model, recordId, action, changedFields}
     */
    public function modelsEventChangeData($data): void
    {
        try {
            if (!is_array($data)) {
                return;
            }
            $fact = ConfigChangeSource::fact($data);
            if ($fact === null) {
                return;
            }
            if (($data['model'] ?? '') === ConfigChangeSource::CORE_MODEL_PREFIX . 'ApiKeys') {
                // the hub's own key path sync is not an administrator's change; one local read, only here
                $ownKeyId = (int)(new HubSettings(new PhalconHubDatabase()))->get(HubSettings::HUB_API_KEY_ID);
                $fact = ConfigChangeSource::fact($data, $ownKeyId);
                if ($fact === null) {
                    return;
                }
            }
            [, $states] = $this->recorder();
            for ($attempt = 0; $attempt < 3; $attempt++) {
                $state = $states->get(ConfigChangeSource::ID);
                if (!$state['enabled']) {
                    return;
                }
                $cursor = $state['cursor'];
                $new = ConfigChangeSource::applyFact($cursor, $fact, time());
                if ($new === $cursor || $states->compareAndSaveCursor(ConfigChangeSource::ID, $cursor, $new)) {
                    return;
                }
            }
            HubLogger::event('hook', 'config_change_conflict', [], LOG_WARNING);
        } catch (Throwable $exception) {
            HubLogger::event('hook', 'config_change_failed', ['error' => $exception::class], LOG_ERR);
        }
    }

    /**
     * Core applied the network configuration (src/Core/System/Network.php:1015 and 1216). The external
     * address may have changed, so the next collector pass re-checks it instead of waiting for the
     * regular interval. Only a flag is written — no network I/O inside a Core hook.
     */
    public function onAfterNetworkConfigured(): void
    {
        try {
            [, $states] = $this->recorder();
            for ($attempt = 0; $attempt < 3; $attempt++) {
                $state = $states->get(ExternalIpSource::ID);
                if (!$state['enabled']) {
                    return;
                }
                $cursor = $state['cursor'];
                if (($cursor['recheck'] ?? false) === true) {
                    return;
                }
                if ($states->compareAndSaveCursor(ExternalIpSource::ID, $cursor, ['recheck' => true] + $cursor)) {
                    return;
                }
            }
            HubLogger::event('hook', 'external_ip_recheck_conflict', [], LOG_WARNING);
        } catch (Throwable $exception) {
            HubLogger::event('hook', 'external_ip_recheck_failed', ['error' => $exception::class], LOG_ERR);
        }
    }

    /**
     * After a module update the workers keep running the old code in memory: kill the hub's own workers
     * so WorkerSafeScriptsCore restarts them with the new code. Core names a worker process by its class name
     * (WorkerBase::startWorker -> cli_set_process_title(static::class)), PbxExtensionState kills by the same name.
     */
    public function onAfterModuleEnable(): void
    {
        foreach ([
                     WorkerMessengerHubCollector::class,
                     WorkerMessengerHubAmi::class,
                     WorkerMessengerHubDelivery::class,
                     WorkerMessengerHubDiscovery::class,
                 ] as $worker) {
            try {
                Processes::killByName($worker);
            } catch (Throwable $exception) {
                HubLogger::event('module', 'worker_restart_failed', ['worker' => $worker, 'error' => $exception::class], LOG_WARNING);
            }
        }
    }

    /**
     * A disabled module must hold no read access, but the key record survives with an empty path set
     * (HubApiKey::revoke): a package update goes disable → replace → enable, and the same key id and
     * secret then come back through sync() — only a real uninstall leaves the inert record behind.
     */
    public function onAfterModuleDisable(): void
    {
        try {
            (new HubApiKey(new HubSettings(new PhalconHubDatabase())))->revoke();
        } catch (Throwable $exception) {
            HubLogger::event('api_key', 'revoke_failed', ['error' => $exception::class], LOG_WARNING);
        }
    }

    /**
     * @return array{0: SourceRecorder, 1: SourceStateRepository}
     */
    private function recorder(): array
    {
        $db = new PhalconHubDatabase();
        $states = new SourceStateRepository($db);

        return [new SourceRecorder($states, new EventStore($db)), $states];
    }
}
