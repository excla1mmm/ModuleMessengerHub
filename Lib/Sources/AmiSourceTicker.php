<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

use Closure;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;
use Throwable;

/**
 * Flushes the buffers of the AMI sources (AmiEventSource::tick) about once a second, also while no UserEvent arrives.
 *
 * Core's AsteriskManager::waitUserEvent() never returns while the AMI connection is alive: it reads, pings on a read
 * timeout and loops. A tick driven only by incoming UserEvents would keep the last missed call of a quiet evening in
 * the buffer until the next call. attachTo() hooks the tick into that loop through setOnIdleCallback() (Core 2026.1+);
 * on older Core the worker also ticks on the WorkerSafeScriptsCore ping UserEvent, which bounds the delay by the
 * ping interval instead of the next call.
 */
final class AmiSourceTicker
{
    /** Minimum interval between idle callbacks; the real cadence is bounded by the AMI socket read timeout. */
    public const int IDLE_INTERVAL_SEC = 1;

    private int $lastTick = 0;

    private readonly Closure $clock;

    /**
     * @param list<AmiEventSource> $sources
     * @param (Closure(int): void)|null $beforeTick refresh of the maps/settings the sources need (worker glue)
     * @param (Closure(): int)|null $clock
     */
    public function __construct(
        private readonly array $sources,
        private readonly SourceRecorder $recorder,
        private readonly ?Closure $beforeTick = null,
        ?Closure $clock = null,
    ) {
        $this->clock = $clock ?? static fn (): int => time();
    }

    /**
     * Registers tick() as the idle callback of the AMI connection. Returns false when Core has no such hook.
     * Must be called again after every reconnect: the callback lives on the AsteriskManager instance.
     */
    public function attachTo(object $am): bool
    {
        if (!method_exists($am, 'setOnIdleCallback')) {
            return false;
        }
        $am->setOnIdleCallback(fn () => $this->tick(), self::IDLE_INTERVAL_SEC);

        return true;
    }

    /** At most once per second; one failing source does not stop the others, nothing escapes into the AMI loop. */
    public function tick(): void
    {
        $now = ($this->clock)();
        if ($now === $this->lastTick) {
            return;
        }
        $this->lastTick = $now;
        if ($this->beforeTick !== null) {
            try {
                ($this->beforeTick)($now);
            } catch (Throwable $exception) {
                HubLogger::event('ami', 'tick_prepare_failed', ['error' => $exception::class], LOG_ERR);
            }
        }
        foreach ($this->sources as $source) {
            try {
                $source->tick($this->recorder, $now);
            } catch (Throwable $exception) {
                HubLogger::event('ami', 'tick_failed', ['error' => $exception::class], LOG_ERR);
            }
        }
    }
}
