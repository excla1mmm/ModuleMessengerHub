<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

/**
 * A push source that needs a periodic flush driven by WorkerMessengerHubCollector (every pass, ~5 s),
 * e.g. debounce of a Core hook. The source itself must respect its enabled flag.
 */
interface TickingSource
{
    public function tick(SourceStateRepository $states, SourceRecorder $recorder, int $now): void;
}
