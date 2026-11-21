<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\bin;

require_once 'Globals.php';

use MikoPBX\Core\Workers\WorkerBase;
use Modules\ModuleMessengerHub\Lib\Bots\BotRepository;
use Modules\ModuleMessengerHub\Lib\Bots\DiscoveryService;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelFactory;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Storage\PhalconHubDatabase;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;
use Throwable;

/**
 * «Подключить чат» worker (Plan/03, Plan/06): polls getUpdates only while a five-minute discovery
 * session is running, never from a REST request. Idle cost is one SQLite read every two seconds.
 *
 * Registered as CHECK_BY_PID_NOT_ALERT: the process must survive even when Telegram is unavailable.
 */
class WorkerMessengerHubDiscovery extends WorkerBase
{
    private const int TICK_SEC = 2;
    private const int REBUILD_SEC = 60;

    public function start(array $argv): void
    {
        HubLogger::event('discovery', 'started', ['pid' => getmypid()]);
        $db = new PhalconHubDatabase();
        $service = null;
        $nextRebuild = 0;

        while ($this->needRestart === false) {
            pcntl_signal_dispatch();
            $now = time();
            try {
                if ($service === null || $now >= $nextRebuild) {
                    $settings = new HubSettings($db);
                    $service = new DiscoveryService(
                        new BotRepository($db),
                        ChannelFactory::create($settings)
                    );
                    $nextRebuild = $now + self::REBUILD_SEC;
                }
                $stats = $service->runOnce($now);
                if ($stats['polled'] > 0) {
                    HubLogger::event('discovery', 'pass', [
                        'polled' => $stats['polled'],
                        'found' => $stats['found'],
                        'errors' => $stats['errors'],
                    ]);
                }
            } catch (Throwable $exception) {
                HubLogger::event('discovery', 'pass_failed', ['error' => $exception::class], LOG_ERR);
            }
            $this->sleepFor(self::TICK_SEC);
        }
        HubLogger::event('discovery', 'stopped', ['pid' => getmypid()]);
    }

    private function sleepFor(int $seconds): void
    {
        $until = time() + $seconds;
        while ($this->needRestart === false && time() < $until) {
            pcntl_signal_dispatch();
            sleep(1);
        }
    }
}

WorkerMessengerHubDiscovery::startWorker($argv ?? []);
