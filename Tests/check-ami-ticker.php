<?php

declare(strict_types=1);

// EGOR-51: buffered AMI sources must be flushed by a timer, not only by the next UserEvent.

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Sources\AmiEventSource;
use Modules\ModuleMessengerHub\Lib\Sources\AmiSourceTicker;
use Modules\ModuleMessengerHub\Lib\Sources\Core\InternalNumberMap;
use Modules\ModuleMessengerHub\Lib\Sources\Core\MissedCallSource;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRecorder;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;

/** Core 2026.1+ AsteriskManager: keeps the idle callback, the test plays the waitUserEvent() loop. */
final class IdleAwareAmi
{
    /** @var callable|null */
    public $callback = null;

    public int $interval = 0;

    public function setOnIdleCallback(callable $callback, int $interval = 30): void
    {
        $this->callback = $callback;
        $this->interval = $interval;
    }

    /** One read timeout with a successful ping and no UserEvent. */
    public function idle(): void
    {
        if ($this->callback !== null) {
            ($this->callback)();
        }
    }
}

/** Core 2025.1 AsteriskManager: no idle hook at all. */
final class LegacyAmi
{
}

$raw = file_get_contents(__DIR__ . '/fixtures/core-missed-call/incoming-missed.json');
$incomingMissed = json_decode((string)$raw, true, 8, JSON_THROW_ON_ERROR);
$internalMap = InternalNumberMap::build(
    [['number' => '203', 'type' => 'SIP', 'userid' => 12]],
    [['id' => 12, 'username' => 'Ivanov I.']]
);

$db = hubTestDatabase();
$states = new SourceStateRepository($db);
$recorder = new SourceRecorder($states, new EventStore($db));
$states->setEnabled(MissedCallSource::ID, true, 0);
$count = static fn (): int => count($db->fetchAll('SELECT id FROM ' . EventStore::TABLE . ' WHERE source_id = :s', ['s' => MissedCallSource::ID]));

$t0 = strtotime('2026-11-18 10:00:35');
$now = $t0;
$clock = static function () use (&$now): int {
    return $now;
};
$prepared = [];
$missed = new MissedCallSource(internalMap: $internalMap);
$ticker = new AmiSourceTicker([$missed], $recorder, static function (int $at) use (&$prepared): void {
    $prepared[] = $at;
}, $clock);

// ======================= idle callback (Core 2026.1+) =======================
$am = new IdleAwareAmi();
check($ticker->attachTo($am) === true, 'attach: Core with setOnIdleCallback is hooked');
check($am->interval === AmiSourceTicker::IDLE_INTERVAL_SEC && $am->interval === 1, 'attach: idle interval is 1 s');
check(is_callable($am->callback), 'attach: callback registered');

// the last call of a quiet evening: one UserEvent, then nothing but AMI read timeouts
$missed->onAmiEvent($incomingMissed, $recorder, $t0);
$now = $t0 + 5;
$am->idle();
check($count() === 0, 'idle: still buffered inside the silence window');
$now = $t0 + 15;
$am->idle();
check($count() === 1, 'idle: the buffered missed call is released by the timer, without a next UserEvent');
check($prepared === [$t0 + 5, $t0 + 15], 'idle: maps/settings are refreshed before every tick');

$am->idle();
check($prepared === [$t0 + 5, $t0 + 15], 'idle: at most one tick per second');
$now = $t0 + 16;
$am->idle();
check($count() === 1, 'idle: a later tick does not duplicate the event');

// ======================= Core without the hook =======================
check($ticker->attachTo(new LegacyAmi()) === false, 'attach: Core 2025.1 without setOnIdleCallback is reported, not fatal');

// ======================= failures stay inside the ticker =======================
$broken = new class implements AmiEventSource {
    public function amiUserEvents(): array
    {
        return ['CdrConnector'];
    }

    public function onAmiEvent(array $parameters, SourceRecorder $recorder, int $now): void
    {
    }

    public function tick(SourceRecorder $recorder, int $now): void
    {
        throw new RuntimeException('boom');
    }
};
$second = new MissedCallSource(internalMap: $internalMap);
$robust = new AmiSourceTicker([$broken, $second], $recorder, static function (int $at): void {
    throw new RuntimeException('map load failed');
}, $clock);
$am2 = new IdleAwareAmi();
$robust->attachTo($am2);
$other = $incomingMissed;
$other['AgiData'] = base64_encode((string)json_encode(
    array_merge(json_decode((string)base64_decode($incomingMissed['AgiData']), true), ['linkedid' => 'mikopbx-1791068005.999']),
    JSON_UNESCAPED_SLASHES
));
$now = $t0 + 100;
$second->onAmiEvent($other, $recorder, $now);
$now += 20;
$thrown = false;
try {
    $am2->idle();
} catch (Throwable) {
    $thrown = true;
}
check(!$thrown, 'robust: nothing escapes into the AMI loop');
check($count() === 2, 'robust: a failing source and a failing refresh do not stop the other sources');

// ======================= worker wiring =======================
$worker = (string)file_get_contents(dirname(__DIR__) . '/bin/WorkerMessengerHubAmi.php');
preg_match('/function connect\(\): void\s*\{(.*?)\n    \}/s', $worker, $connect);
check(str_contains($connect[1] ?? '', '$this->ticker->attachTo($this->am)'), 'worker: connect() hooks the ticker into every new AMI connection');
preg_match('/function callback\(array \$parameters\): void\s*\{(.*?)\n    \}/s', $worker, $callback);
check(
    (bool)preg_match('/replyOnPingRequest\(\$parameters\)\)\s*\{\s*\$this->ticker->tick\(\);/', $callback[1] ?? ''),
    'worker: the WorkerSafeScriptsCore ping also ticks (fallback for Core without the idle hook)'
);
check(!str_contains($worker, 'private function tick('), 'worker: no second tick implementation');

finish('AMI ticker OK');
