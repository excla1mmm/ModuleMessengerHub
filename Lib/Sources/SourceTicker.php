<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

use Modules\ModuleMessengerHub\Lib\Support\HubLogger;
use Throwable;

/**
 * Runs tick() of every TickingSource in the registry; one failing source does not stop the others.
 */
final class SourceTicker
{
    public function __construct(
        private readonly SourceRegistry $registry,
        private readonly SourceStateRepository $states,
        private readonly SourceRecorder $recorder,
    ) {
    }

    public function run(int $now): void
    {
        foreach ($this->registry->all() as $source) {
            if (!$source instanceof TickingSource) {
                continue;
            }
            try {
                $source->tick($this->states, $this->recorder, $now);
            } catch (Throwable $exception) {
                HubLogger::event('collector', 'tick_failed', ['source' => $source->id(), 'error' => $exception::class], LOG_ERR);
            }
        }
    }
}
