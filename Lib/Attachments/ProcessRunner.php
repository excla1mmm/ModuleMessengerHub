<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/**
 * Runs an external tool from an argument array (never a shell string) with a hard timeout.
 */
interface ProcessRunner
{
    /** @param list<string> $command */
    public function run(array $command, int $timeoutSec): ProcessResult;
}
