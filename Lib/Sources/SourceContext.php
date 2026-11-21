<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

use Modules\ModuleMessengerHub\Lib\Api\RestReader;

/**
 * What a poll source may use. Keeps adapters free of Core globals so they are testable.
 *
 * The reader is replaceable: after the hub key is recreated the worker swaps in a client with the
 * new secret, and the retried poll of the same collection pass already uses it.
 */
final class SourceContext
{
    /** @var callable(): int */
    private $clock;

    public function __construct(
        public RestReader $rest,
        ?callable $clock = null,
    ) {
        $this->clock = $clock ?? static fn (): int => time();
    }

    public function now(): int
    {
        return ($this->clock)();
    }
}
