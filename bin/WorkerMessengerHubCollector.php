<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\bin;

require_once 'Globals.php';

use MikoPBX\Core\Workers\WorkerBase;
use MikoPBX\PBXCoreREST\Services\TokenValidationService;
use Modules\ModuleMessengerHub\Lib\Api\ApiKeyGuard;
use Modules\ModuleMessengerHub\Lib\Api\HubApiKey;
use Modules\ModuleMessengerHub\Lib\Api\LocalRestClient;
use Modules\ModuleMessengerHub\Lib\Delivery\BeanstalkDeliveryWaker;
use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Routing\RuleRepository;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Sources\ApiKeyPaths;
use Modules\ModuleMessengerHub\Lib\Sources\Collector;
use Modules\ModuleMessengerHub\Lib\Sources\CoreModuleStatusProbe;
use Modules\ModuleMessengerHub\Lib\Sources\Modules\SettingsStatusCapabilityStore;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRecorder;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRegistry;
use Modules\ModuleMessengerHub\Lib\Sources\SourceTicker;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Modules\ModuleMessengerHub\Lib\Storage\PhalconHubDatabase;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;
use Throwable;

/**
 * Polls poll-mode sources (Plan/01-architecture.md), keeps the hub API key in sync with the enabled
 * sources and purges old events.
 */
class WorkerMessengerHubCollector extends WorkerBase
{
    private const int TICK_SEC = 5;
    private const int KEY_SYNC_INTERVAL_SEC = 60;
    private const int PURGE_INTERVAL_SEC = 3600;

    public function start(array $argv): void
    {
        HubLogger::event('collector', 'started', ['pid' => getmypid()]);
        $db = new PhalconHubDatabase();
        $settings = new HubSettings($db);
        // the /status capability cache decides whether the AI Supervisor /workers path stays in the key
        $registry = SourceRegistry::default(new SettingsStatusCapabilityStore($settings));
        $states = new SourceStateRepository($db);
        $events = new EventStore($db);
        $apiKey = new HubApiKey($settings);
        // one context and one guard for the whole worker lifetime: the 5-minute repair throttle must
        // survive the periodic collector rebuild, and a recreated key must reach the very next poll
        $context = new SourceContext(new LocalRestClient(''));
        $keyGuard = new ApiKeyGuard(
            $apiKey,
            [],
            ApiKeyGuard::DEFAULT_WINDOW_SEC,
            static function (string $plainKey) use ($context): void {
                $context->rest = new LocalRestClient($plainKey);
            }
        );
        $waker = new BeanstalkDeliveryWaker();
        $ticker = new SourceTicker($registry, $states, new SourceRecorder($states, $events));

        $collector = null;
        $nextKeySync = 0;
        $nextPurge = 0;
        while ($this->needRestart === false) {
            pcntl_signal_dispatch();
            $now = time();
            $ticker->run($now); // push-source flushes (provider debounce); isolated per source
            try {
                if ($collector === null || $now >= $nextKeySync) {
                    $probe = new CoreModuleStatusProbe();
                    $enabled = array_values(array_map(
                        static fn (SourceInterface $s): string => $s->id(),
                        array_filter(
                            $registry->pollSources(),
                            static fn (SourceInterface $s): bool => $states->isEnabled($s->id())
                        )
                    ));
                    // a disabled or missing module keeps its source's paths out of the key (Plan/11)
                    $paths = ApiKeyPaths::compute(
                        $registry->pollSources(),
                        static fn (string $id): bool => in_array($id, $enabled, true),
                        static fn (string $module): string => $probe->status($module)
                    );
                    // the CDR grant follows enabled attachment rules, not just the AI source (3a-1)
                    $paths = ApiKeyPaths::attentionCdr(
                        $paths,
                        (new RuleRepository($db))->needsAttentionAttachments()
                    );
                    $firstPass = $collector === null;
                    $plainKey = $apiKey->sync($paths);
                    if ($firstPass) {
                        // an old worker still polling during a package update can re-fill Core's 5-minute
                        // token cache with the previous allowed_paths after sync() cleared it (seen on the
                        // station: 401 on the new /status paths until the TTL ended)
                        TokenValidationService::clearCache();
                    }
                    $context->rest = new LocalRestClient($plainKey);
                    $keyGuard->updatePaths($paths);
                    $collector = new Collector(
                        $registry->pollSources(),
                        $states,
                        $events,
                        $probe,
                        $context,
                        $keyGuard
                    );
                    $nextKeySync = $now + self::KEY_SYNC_INTERVAL_SEC;
                }
                $report = $collector->runOnce();
                $recorded = array_sum(array_column($report, 'recorded'));
                if ($recorded > 0) {
                    $waker->wake();
                }
                if ($now >= $nextPurge) {
                    $removed = $events->purgeOlderThan($now - $settings->retentionDays() * 86400);
                    if ($removed > 0) {
                        HubLogger::event('collector', 'events_purged', ['count' => $removed]);
                    }
                    $nextPurge = $now + self::PURGE_INTERVAL_SEC;
                }
            } catch (Throwable $exception) {
                HubLogger::event('collector', 'pass_failed', ['error' => $exception::class], LOG_ERR);
            }
            $this->sleepFor(self::TICK_SEC);
        }
        HubLogger::event('collector', 'stopped', ['pid' => getmypid()]);
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

WorkerMessengerHubCollector::startWorker($argv ?? []);
