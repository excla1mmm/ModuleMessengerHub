<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

/**
 * A push source fed by AMI UserEvents (dispatched by WorkerMessengerHubAmi).
 *
 * Implementations also implement SourceInterface with mode() === MODE_PUSH.
 */
interface AmiEventSource
{
    /** @return list<string> AMI UserEvent names to subscribe to, e.g. ["CdrConnector"] */
    public function amiUserEvents(): array;

    /**
     * Handle one AMI event. Must be quick; record events through $recorder only.
     * Buffering (e.g. waiting for "silence" on a linkedid) is allowed; flush happens in tick().
     *
     * @param array<string, string> $parameters raw AMI event fields
     */
    public function onAmiEvent(array $parameters, SourceRecorder $recorder, int $now): void;

    /** Called about once a second by the AMI worker to flush buffered state. */
    public function tick(SourceRecorder $recorder, int $now): void;
}
