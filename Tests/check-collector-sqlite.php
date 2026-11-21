<?php

declare(strict_types=1);

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Api\RestReader;
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

final class CounterSource implements SourceInterface
{
    public int $polls = 0;
    public bool $fail = false;

    public function __construct(private readonly string $id, private readonly ?string $module = null)
    {
    }

    public function id(): string { return $this->id; }
    public function eventTypes(): array { return ['test.tick']; }
    public function requiredModule(): ?string { return $this->module; }
    public function apiReadPaths(): array { return []; }
    public function mode(): string { return self::MODE_POLL; }
    public function pollIntervalSec(): int { return 30; }

    public function poll(SourceContext $context, array $cursor): SourceBatch
    {
        $this->polls++;
        if ($this->fail) {
            throw new SourceException('api_forbidden');
        }
        if ($cursor === []) {
            return SourceBatch::baseline(['n' => 0]);
        }
        $n = (int)$cursor['n'] + 1;

        return new SourceBatch(
            [new HubEvent($this->id, 'test.tick', HubEvent::SEVERITY_INFO, $this->id . ':' . $n, $context->now())],
            ['n' => $n]
        );
    }
}

final class FakeModules implements ModuleStatusProbe
{
    /** @param array<string, string> $statuses */
    public function __construct(public array $statuses = [])
    {
    }

    public function status(string $moduleUniqueId): string
    {
        return $this->statuses[$moduleUniqueId] ?? SourceAvailability::MODULE_MISSING;
    }
}

final class NoRest implements RestReader
{
    public function get(string $path, array $query = []): array { return []; }
}

$db = hubTestDatabase();
$now = 1700000000;
$clock = static function () use (&$now): int { return $now; };
$states = new SourceStateRepository($db);
$events = new EventStore($db);
$core = new CounterSource('test.core');
$moduleSource = new CounterSource('test.module', 'ModuleX');
$modules = new FakeModules(['ModuleX' => SourceAvailability::MODULE_DISABLED]);
$collector = new Collector([$core, $moduleSource], $states, $events, $modules, new SourceContext(new NoRest(), $clock));

// 1st pass: baseline only, no events; module source skipped (module disabled).
$report = $collector->runOnce();
check($report['test.core']['recorded'] === 0, 'baseline pass must not record events');
check($states->get('test.core')['baseline_set_at'] === $now, 'baseline time stored');
check($moduleSource->polls === 0, 'source of a disabled module must not be polled');
check($states->get('test.module')['availability'] === SourceAvailability::MODULE_DISABLED, 'module_disabled availability stored');

// Not due yet.
$now += 10;
$collector->runOnce();
check($core->polls === 1, 'source must not be polled before its interval');

// Due: one event.
$now += 30;
$report = $collector->runOnce();
check($report['test.core']['recorded'] === 1, 'second poll records one event');
check($events->page([], 50, 0)['total'] === 1, 'one event stored');

// Failure with backoff.
$core->fail = true;
$now += 30;
$report = $collector->runOnce();
check($report['test.core']['status'] === SourceAvailability::API_FORBIDDEN, 'api_forbidden mapped');
check($states->get('test.core')['last_error_code'] === 'api_forbidden', 'error code stored');
$polls = $core->polls;
$now += 30;
$collector->runOnce();
check($core->polls === $polls, 'failing source backs off (interval doubled)');
$now += 60;
$core->fail = false;
$collector->runOnce();
check($core->polls === $polls + 1, 'polled again after backoff');
check($states->get('test.core')['last_error_code'] === '', 'error cleared after success');

// Disabled source is skipped; re-enabling resets the baseline (no history broadcast).
$states->setEnabled('test.core', false, $now);
$now += 100;
$pollsBefore = $core->polls;
$collector->runOnce();
check($core->polls === $pollsBefore, 'disabled source is not polled');
$states->setEnabled('test.core', true, $now);
check($states->get('test.core')['cursor'] === [], 're-enable resets cursor');
$now += 100;
$report = $collector->runOnce();
check($report['test.core']['recorded'] === 0, 're-enabled source sets a new baseline first');

// Module becomes available.
$modules->statuses['ModuleX'] = SourceAvailability::AVAILABLE;
$now += 100;
$collector->runOnce();
check($moduleSource->polls === 1, 'module source polled once its module is enabled');

finish('collector OK');
