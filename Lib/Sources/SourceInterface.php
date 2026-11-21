<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

/**
 * Event source adapter (Plan/02-sources.md, docs/adding-a-source.md).
 *
 * Push sources (AMI, Core hooks) record events themselves through SourceRecorder;
 * poll sources are driven by Collector.
 */
interface SourceInterface
{
    public const string MODE_PUSH = 'push';
    public const string MODE_POLL = 'poll';

    /** Stable id, e.g. "core.missed_call", "ai_supervisor.attention_call". */
    public function id(): string;

    /** @return list<string> event types this source can produce */
    public function eventTypes(): array;

    /** moduleUniqueID the source reads from, or null for MikoPBX Core. */
    public function requiredModule(): ?string;

    /**
     * Core REST paths (without the /pbxcore prefix, e.g. "/api/v3/module-ai-supervisor/calls")
     * the hub API key must be allowed to read for this source.
     *
     * @return list<string>
     */
    public function apiReadPaths(): array;

    public function mode(): string;

    public function pollIntervalSec(): int;

    /**
     * Poll once. Contract:
     *  - $cursor === [] means "first run": return NO events, only a cursor positioned at now (baseline);
     *  - otherwise return events newer than the cursor and the advanced cursor;
     *  - throw SourceException with a stable code on failure (never include secrets in the message).
     *
     * @param array<string, mixed> $cursor
     */
    public function poll(SourceContext $context, array $cursor): SourceBatch;
}
