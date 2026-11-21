<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

use Modules\ModuleMessengerHub\Lib\Api\ApiKeyGuard;
use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Throwable;

/**
 * One collection pass over poll sources (used by WorkerMessengerHubCollector).
 *
 * Rules (Plan/02-sources.md, Plan/08-reliability.md):
 *  - a disabled source or one whose module is missing/disabled is skipped, not polled;
 *  - a source is polled only when its interval has elapsed since the last poll attempt;
 *  - failing sources back off (interval x2 per consecutive failure, capped at 15 minutes);
 *  - the first successful poll only stores a baseline cursor (the adapter returns no events);
 *  - one source failing never stops the others.
 *
 * Self-healing hub key (Plan/11 Q14): a 401/403 on a path the key should read first asks the guard
 * to verify and, when needed, repair the key; the poll is retried once. Only a verified-healthy key
 * leaves the source in api_forbidden ("Модуль не даёт доступа к данным").
 */
final class Collector
{
    private const int MAX_BACKOFF_SEC = 900;
    private const array KEY_REJECTION_CODES = ['api_unauthorized', 'api_forbidden'];

    /** @var array<string, int> consecutive failures per source, in-process only */
    private array $failures = [];

    /** @param list<SourceInterface> $sources */
    public function __construct(
        private readonly array $sources,
        private readonly SourceStateRepository $states,
        private readonly EventStore $events,
        private readonly ModuleStatusProbe $modules,
        private readonly SourceContext $context,
        private readonly ?ApiKeyGuard $keyGuard = null,
    ) {
    }

    /**
     * @return array<string, array{status: string, recorded: int}> per-source outcome of this pass
     */
    public function runOnce(): array
    {
        $now = $this->context->now();
        $report = [];
        foreach ($this->sources as $source) {
            if ($source->mode() !== SourceInterface::MODE_POLL) {
                continue;
            }
            $id = $source->id();
            $state = $this->states->get($id);
            if (!$state['enabled']) {
                $report[$id] = ['status' => SourceAvailability::DISABLED, 'recorded' => 0];
                continue;
            }
            $module = $source->requiredModule();
            if ($module !== null) {
                $moduleStatus = $this->modules->status($module);
                if ($moduleStatus !== SourceAvailability::AVAILABLE) {
                    if ($state['availability'] !== $moduleStatus) {
                        // becoming unavailable re-baselines the source: whatever happened while the
                        // module was off is not broadcast when it comes back (Plan/02, AGENTS.md rule 5)
                        $this->states->markFailed($id, $moduleStatus, $moduleStatus, $now);
                        $this->states->resetCursor($id);
                    }
                    $report[$id] = ['status' => $moduleStatus, 'recorded' => 0];
                    continue;
                }
            }
            if (!$this->isDue($source, $state['last_poll_at'], $now)) {
                $report[$id] = ['status' => 'not_due', 'recorded' => 0];
                continue;
            }

            try {
                $batch = $this->poll($source, $state['cursor'], $now);
                $recorded = 0;
                foreach ($batch->events as $event) {
                    if ($this->events->record($event, $now)) {
                        $recorded++;
                    }
                }
                $this->states->markPolled($id, $batch->cursor, $now);
                $this->failures[$id] = 0;
                $report[$id] = ['status' => SourceAvailability::AVAILABLE, 'recorded' => $recorded];
            } catch (SourceException $exception) {
                $this->fail($id, $exception->errorCode, $now);
                $report[$id] = ['status' => SourceAvailability::fromErrorCode($exception->errorCode), 'recorded' => 0];
            } catch (Throwable) {
                $this->fail($id, 'internal_error', $now);
                $report[$id] = ['status' => SourceAvailability::ERROR, 'recorded' => 0];
            }
        }

        return $report;
    }

    /**
     * Polls the source; on a key rejection verifies and possibly repairs the hub key and retries once.
     *
     * @param array<string, mixed> $cursor
     */
    private function poll(SourceInterface $source, array $cursor, int $now): SourceBatch
    {
        try {
            return $source->poll($this->context, $cursor);
        } catch (SourceException $exception) {
            if ($this->keyGuard === null || !in_array($exception->errorCode, self::KEY_REJECTION_CODES, true)) {
                throw $exception;
            }
            $outcome = $this->keyGuard->onRejected($now);
            if ($outcome === ApiKeyGuard::THROTTLED) {
                // the key is still broken but a repair for this reason already ran: not the module's refusal
                throw new SourceException('api_key_repair_throttled');
            }
            if ($outcome === ApiKeyGuard::REPAIRED) {
                return $source->poll($this->context, $cursor);
            }

            throw $exception;
        }
    }

    private function isDue(SourceInterface $source, ?int $lastPollAt, int $now): bool
    {
        if ($lastPollAt === null) {
            return true;
        }
        $interval = max(5, $source->pollIntervalSec());
        $failures = $this->failures[$source->id()] ?? 0;
        if ($failures > 0) {
            $interval = min(self::MAX_BACKOFF_SEC, $interval * (2 ** min($failures, 10)));
        }

        return $now - $lastPollAt >= $interval;
    }

    private function fail(string $sourceId, string $code, int $now): void
    {
        $this->failures[$sourceId] = ($this->failures[$sourceId] ?? 0) + 1;
        $this->states->markFailed($sourceId, SourceAvailability::fromErrorCode($code), $code, $now);
    }
}
