<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Api;

/**
 * Decides what to do when a poll of a path the hub key should read is rejected (Plan/11 Q14).
 *
 * The key is healed autonomously — the user never deals with API keys. Repairs are rate-limited
 * per reason (at most one attempt per window) so a source that keeps refusing does not cause a
 * create/update storm. When the key is verified healthy the rejection is the module's own decision
 * and the caller may mark the source api_forbidden.
 *
 * Core-free: the Core-backed repairer is injected, so tests use a spy and a fake clock.
 */
final class ApiKeyGuard
{
    /** The key was repaired; the caller should retry the poll once. */
    public const string REPAIRED = 'repaired';
    /** The key is fine — the source module itself refuses the hub key. */
    public const string HEALTHY = 'healthy';
    /** The key is broken but a repair for this reason already ran inside the window. */
    public const string THROTTLED = 'throttled';

    public const int DEFAULT_WINDOW_SEC = 300;

    /** @var array<string, int> reason => last repair attempt (unix seconds) */
    private array $lastAttempt = [];

    /**
     * @param list<string> $paths paths the key should currently contain
     * @param callable(string): void|null $onRepaired receives the plain key after a repair
     */
    public function __construct(
        private readonly ApiKeyRepairer $repairer,
        private array $paths,
        private readonly int $windowSec = self::DEFAULT_WINDOW_SEC,
        private readonly ?\Closure $onRepaired = null,
    ) {
    }

    /**
     * Handles a 401/403 from a source poll.
     *
     * @param int $now current unix time (injected clock in tests)
     */
    public function onRejected(int $now): string
    {
        $reason = $this->repairer->verify($this->paths);
        if (!KeyHealth::needsRepair($reason)) {
            return self::HEALTHY;
        }
        $last = $this->lastAttempt[$reason] ?? null;
        if ($last !== null && $now - $last < $this->windowSec) {
            return self::THROTTLED;
        }
        $this->lastAttempt[$reason] = $now;
        $this->repairer->repair($this->paths);
        if (is_callable($this->onRepaired)) {
            ($this->onRepaired)($this->repairer->plainKey());
        }

        return self::REPAIRED;
    }

    /** The enabled path set changes when sources are toggled; the guard follows it. */
    public function updatePaths(array $paths): void
    {
        $this->paths = $paths;
    }
}
