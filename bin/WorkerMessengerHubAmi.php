<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\bin;

require_once 'Globals.php';

use MikoPBX\Core\Asterisk\AsteriskManager;
use MikoPBX\Core\System\Util;
use MikoPBX\Core\Workers\WorkerBase;
use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Sources\AmiEventSource;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRecorder;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRegistry;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Modules\ModuleMessengerHub\Lib\Storage\PhalconHubDatabase;
use Modules\ModuleMessengerHub\Lib\Sources\Core\MissedCallSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\QueueAbandonSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\RecentMissedLoader;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;
use Modules\ModuleMessengerHub\Lib\Support\InternalNumbersLoader;
use Modules\ModuleMessengerHub\Lib\Support\QueueNamesLoader;
use Throwable;

/**
 * Listens to AMI UserEvents for push sources (Plan/01-architecture.md, decision Q2):
 * Core's own AMI connection (Util::getAstManager), AMI "Filter" per UserEvent, reconnect on empty result,
 * answers the WorkerSafeScriptsCore ping.
 */
class WorkerMessengerHubAmi extends WorkerBase
{
    protected AsteriskManager $am;

    /** @var list<AmiEventSource> */
    private array $sources = [];

    /** @var array<string, list<AmiEventSource>> UserEvent name => sources */
    private array $routes = [];

    private SourceRecorder $recorder;

    private PhalconHubDatabase $db;

    private int $lastTick = 0;

    private const int MAP_REFRESH_SEC = 300;
    private const int MAP_RETRY_SEC = 30;
    /** Queue wait thresholds are read from the settings every minute; a change must not wait for the map. */
    private const int SETTINGS_REFRESH_SEC = 60;

    private int $nextMapLoad = 0;

    private int $nextSettingsLoad = 0;

    public function start(array $argv): void
    {
        HubLogger::event('ami', 'started', ['pid' => getmypid()]);
        $db = new PhalconHubDatabase();
        $this->db = $db;
        $this->recorder = new SourceRecorder(new SourceStateRepository($db), new EventStore($db));
        $this->sources = SourceRegistry::default()->amiSources();
        foreach ($this->sources as $source) {
            foreach ($source->amiUserEvents() as $name) {
                $this->routes[$name][] = $source;
            }
        }

        try {
            $recent = RecentMissedLoader::load($db, time());
            foreach ($this->sources as $source) {
                if ($source instanceof MissedCallSource) {
                    $source->seedRecentMissed($recent);
                }
            }
        } catch (Throwable $exception) {
            HubLogger::event('ami', 'recent_missed_failed', ['error' => $exception::class], LOG_WARNING);
        }

        $this->refreshInternalNumbers(time());
        $this->refreshQueueOptions(time());
        $this->connect();
        while ($this->needRestart === false) {
            pcntl_signal_dispatch();
            $result = $this->am->waitUserEvent(true);
            if ($result === []) {
                usleep(100000);
                $this->connect();
            }
            $this->tick();
        }
        HubLogger::event('ami', 'stopped', ['pid' => getmypid()]);
    }

    /** @param array<string, string> $parameters */
    public function callback(array $parameters): void
    {
        if ($this->replyOnPingRequest($parameters)) {
            return;
        }
        $name = (string)($parameters['UserEvent'] ?? '');
        foreach ($this->routes[$name] ?? [] as $source) {
            try {
                $source->onAmiEvent($parameters, $this->recorder, time());
            } catch (Throwable $exception) {
                HubLogger::event('ami', 'source_failed', ['user_event' => $name, 'error' => $exception::class], LOG_ERR);
            }
        }
        $this->tick();
    }

    private function tick(): void
    {
        $now = time();
        if ($now === $this->lastTick) {
            return;
        }
        $this->lastTick = $now;
        $this->refreshInternalNumbers($now);
        $this->refreshQueueOptions($now);
        foreach ($this->sources as $source) {
            try {
                $source->tick($this->recorder, $now);
            } catch (Throwable $exception) {
                HubLogger::event('ami', 'tick_failed', ['error' => $exception::class], LOG_ERR);
            }
        }
    }

    /** Read-only copy of Core extensions/users for call classification, refreshed every 5 minutes. */
    private function refreshInternalNumbers(int $now): void
    {
        if ($now < $this->nextMapLoad) {
            return;
        }
        $this->nextMapLoad = $now + self::MAP_RETRY_SEC;
        try {
            $map = InternalNumbersLoader::load();
            $queueNames = [];
            try {
                $queueNames = QueueNamesLoader::load();
            } catch (Throwable $exception) {
                // the queue is still reported by its number; a missing name must not block call classification
                HubLogger::event('ami', 'queue_names_failed', ['error' => $exception::class], LOG_WARNING);
            }
            foreach ($this->sources as $source) {
                if ($source instanceof MissedCallSource) {
                    $source->setInternalMap($map);
                }
                if ($source instanceof QueueAbandonSource) {
                    $source->setInternalMap($map);
                    $source->setQueueNames($queueNames);
                }
            }
            $this->nextMapLoad = $now + self::MAP_REFRESH_SEC;
        } catch (Throwable $exception) {
            HubLogger::event('ami', 'internal_numbers_failed', ['error' => $exception::class], LOG_ERR);
        }
    }

    /** Queue wait thresholds from the hub settings (read-only, one query per minute; clamped by the source). */
    private function refreshQueueOptions(int $now): void
    {
        if ($now < $this->nextSettingsLoad) {
            return;
        }
        $this->nextSettingsLoad = $now + self::SETTINGS_REFRESH_SEC;
        try {
            $settings = new HubSettings($this->db);
            $minWait = $settings->queueAbandonMinWaitSec();
            $longWait = $settings->queueLongWaitSec();
            foreach ($this->sources as $source) {
                if ($source instanceof QueueAbandonSource) {
                    $source->setThresholds($minWait, $longWait);
                }
            }
        } catch (Throwable $exception) {
            HubLogger::event('ami', 'queue_options_failed', ['error' => $exception::class], LOG_WARNING);
        }
    }

    private function connect(): void
    {
        $this->am = Util::getAstManager();
        $filters = array_merge([$this->makePingTubeName(self::class)], array_keys($this->routes));
        foreach ($filters as $name) {
            $this->am->sendRequestTimeout('Filter', ['Operation' => 'Add', 'Filter' => 'UserEvent: ' . $name]);
        }
        $this->am->addEventHandler('userevent', [$this, 'callback']);
    }
}

WorkerMessengerHubAmi::startWorker($argv ?? []);
