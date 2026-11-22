<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

/**
 * What the hub has learned about a source module's `/status` resource (stage 3b, issue #1, item 6).
 *
 * A module either serves `/status` (a release with the resource) or does not (an older version,
 * where the hub falls back to the module's own administrative reader). The answer is cached so the
 * hub key holds the fallback path only while the fallback is really in use; `checkedAt` bounds how
 * often a fallback source re-asks, so a module update is noticed without a restart.
 */
final class StatusCapability
{
    public function __construct(
        public readonly ?bool $statusPathAvailable,
        public readonly int $checkedAt,
    ) {
    }

    public static function unknown(): self
    {
        return new self(null, 0);
    }

    public static function available(int $now): self
    {
        return new self(true, $now);
    }

    public static function missing(int $now): self
    {
        return new self(false, $now);
    }

    /** A stored value that does not decode is treated as "not checked yet". */
    public static function fromArray(array $data): self
    {
        $available = $data['available'] ?? null;
        if (!is_bool($available)) {
            return self::unknown();
        }

        return new self($available, max(0, (int)($data['checked_at'] ?? 0)));
    }

    /** @return array{available: ?bool, checked_at: int} */
    public function toArray(): array
    {
        return ['available' => $this->statusPathAvailable, 'checked_at' => $this->checkedAt];
    }

    public function dueForRecheck(int $now, int $intervalSec): bool
    {
        return $this->checkedAt <= 0 || $now - $this->checkedAt >= $intervalSec;
    }
}
