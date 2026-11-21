<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\bin;

require_once 'Globals.php';

use MikoPBX\Core\System\BeanstalkClient;
use MikoPBX\Core\Workers\WorkerBase;
use Modules\ModuleMessengerHub\Lib\Api\LocalRestClient;
use Modules\ModuleMessengerHub\Lib\Attachments\AttachmentPipeline;
use Modules\ModuleMessengerHub\Lib\Attachments\AttachmentService;
use Modules\ModuleMessengerHub\Lib\Attachments\Converter;
use Modules\ModuleMessengerHub\Lib\Attachments\CoreRecordingRoots;
use Modules\ModuleMessengerHub\Lib\Attachments\LocalRestFileDownloader;
use Modules\ModuleMessengerHub\Lib\Attachments\PathGuard;
use Modules\ModuleMessengerHub\Lib\Attachments\PreparedRecordingsRepository;
use Modules\ModuleMessengerHub\Lib\Attachments\RealProcessRunner;
use Modules\ModuleMessengerHub\Lib\Attachments\RecordingLocator;
use Modules\ModuleMessengerHub\Lib\Attachments\TempDir;
use Modules\ModuleMessengerHub\Lib\Attachments\ToolFinder;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelFactory;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelRegistry;
use Modules\ModuleMessengerHub\Lib\Delivery\DeliveryService;
use Modules\ModuleMessengerHub\Lib\Delivery\DeliveryTube;
use Modules\ModuleMessengerHub\Lib\Delivery\OutboxRepository;
use Modules\ModuleMessengerHub\Lib\Delivery\RateLimiter;
use Modules\ModuleMessengerHub\Lib\Delivery\RetractionService;
use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Routing\ChatResolver;
use Modules\ModuleMessengerHub\Lib\Routing\Router;
use Modules\ModuleMessengerHub\Lib\Routing\RuleRepository;
use Modules\ModuleMessengerHub\Lib\Routing\Templates\TemplateRegistry;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;
use Modules\ModuleMessengerHub\Lib\Storage\PhalconHubDatabase;
use Modules\ModuleMessengerHub\Lib\Support\ArrayTexts;
use Modules\ModuleMessengerHub\Lib\Support\CoreTexts;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;
use Modules\ModuleMessengerHub\Lib\Support\Texts;
use Throwable;

/**
 * Router + delivery worker (Plan/01-architecture.md, Plan/08-reliability.md).
 *
 * Woken through the hub's own beanstalk tube; also ticks every few seconds so retries, leases and
 * backlog move even when no wake-up arrives. Core tubes are never consumed (AGENTS.md rule 8).
 * The channel registry is rebuilt periodically so a proxy change in settings applies without a
 * worker restart.
 */
class WorkerMessengerHubDelivery extends WorkerBase
{
    private const int TICK_SEC = 5;
    private const int REBUILD_SEC = 60;

    public function start(array $argv): void
    {
        HubLogger::event('delivery', 'started', ['pid' => getmypid()]);
        $client = new BeanstalkClient(DeliveryTube::NAME);
        if (!$client->isConnected()) {
            HubLogger::event('delivery', 'beanstalk_unavailable', [], LOG_ERR);

            return;
        }
        // the wake-up body carries no work: the job only interrupts wait() so the loop ticks
        $client->subscribe(DeliveryTube::NAME, [$this, 'onWake']);
        $client->subscribe($this->makePingTubeName(self::class), [$this, 'pingCallBack']);

        $db = new PhalconHubDatabase();
        $owner = (string)gethostname() . ':' . getmypid();
        $service = null;
        $retractions = null;
        $router = null;
        $pipeline = null;
        $nextRebuild = 0;
        $nextJanitor = 0;
        $moduleRoot = dirname(__DIR__);
        // one limiter for the whole worker lifetime: a rebuild must not reset the send windows
        $limiter = new RateLimiter();

        while ($this->needRestart === false) {
            $client->wait(self::TICK_SEC);
            $now = time();
            try {
                if ($service === null || $retractions === null || $router === null || $now >= $nextRebuild) {
                    $settings = new HubSettings($db);
                    $outbox = new OutboxRepository($db);
                    $channels = self::channels($settings);
                    $pipeline = self::attachments($db, $moduleRoot, (string)$settings->get(HubSettings::HUB_API_KEY));
                    $service = new DeliveryService($outbox, $channels, $limiter, $owner, 120, 20, $pipeline);
                    $retractions = new RetractionService($outbox, $channels, $limiter, $owner);
                    $router = new Router(
                        $db,
                        new EventStore($db),
                        new RuleRepository($db),
                        new ChatResolver($db),
                        new TemplateRegistry(),
                        $settings,
                        self::texts()
                    );
                    $nextRebuild = $now + self::REBUILD_SEC;
                }

                $routed = $router->runOnce($now);
                if ($routed['deliveries'] > 0) {
                    HubLogger::event('router', 'routed', [
                        'events' => $routed['events'],
                        'deliveries' => $routed['deliveries'],
                    ]);
                }
                $stats = $service->runOnce($now);
                if ($stats['claimed'] > 0) {
                    HubLogger::event('delivery', 'pass', [
                        'claimed' => $stats['claimed'],
                        'sent' => $stats['sent'],
                        'retried' => $stats['retried'],
                        'failed' => $stats['failed'],
                        'dropped' => $stats['dropped'],
                    ]);
                }
                $retractStats = $retractions->runOnce($now);
                if ($retractStats['claimed'] > 0) {
                    HubLogger::event('retraction', 'pass', [
                        'claimed' => $retractStats['claimed'],
                        'retracted' => $retractStats['retracted'],
                        'retried' => $retractStats['retried'],
                        'failed' => $retractStats['failed'],
                    ]);
                }
                if ($pipeline instanceof AttachmentPipeline && $now >= $nextJanitor) {
                    $cleaned = $pipeline->janitor($now);
                    if ($cleaned['stale'] + $cleaned['expired'] + $cleaned['files'] > 0) {
                        HubLogger::event('attachments', 'janitor', $cleaned);
                    }
                    $nextJanitor = $now + 3600;
                }
            } catch (Throwable $exception) {
                HubLogger::event('delivery', 'pass_failed', ['error' => $exception::class], LOG_ERR);
            }
        }
        HubLogger::event('delivery', 'stopped', ['pid' => getmypid()]);
    }

    /** Wake-up job: no payload work, the tick after wait() does everything. */
    public function onWake(BeanstalkClient $message): void
    {
    }

    private static function channels(HubSettings $settings): ChannelRegistry
    {
        return ChannelFactory::create($settings);
    }

    private static function attachments(HubDatabase $db, string $moduleRoot, string $apiKey): AttachmentPipeline
    {
        $temp = new TempDir($moduleRoot);
        $paths = new PathGuard(new CoreRecordingRoots($temp->probeDir()));

        return new AttachmentService(
            new Converter(new RealProcessRunner(), ToolFinder::system()),
            new RecordingLocator(
                new LocalRestClient($apiKey),
                new LocalRestFileDownloader($apiKey),
                $paths
            ),
            $paths,
            new PreparedRecordingsRepository($db),
            $temp,
            $db
        );
    }

    private static function texts(): Texts
    {
        try {
            $di = \Phalcon\Di\Di::getDefault();
            $service = $di instanceof \Phalcon\Di\Di ? $di->getShared('translation') : null;
            if (is_object($service) && method_exists($service, '_')) {
                return new CoreTexts($service);
            }
        } catch (Throwable) {
            // fall through: keys stay untranslated, better than no delivery at all
        }

        return new ArrayTexts([]);
    }
}

WorkerMessengerHubDelivery::startWorker($argv ?? []);
