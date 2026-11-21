<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/**
 * proc_open based runner (Plan/03, decision 3a-1).
 *
 * - the command is an ARRAY: PHP executes it directly, no shell is involved, so a path with spaces or
 *   quotes cannot inject another command;
 * - stdin goes to /dev/null; stdout and stderr are read in small chunks so a chatty tool cannot
 *   deadlock; both are kept in memory only;
 * - the timeout is hard: SIGTERM, then SIGKILL after a short grace period.
 */
final class RealProcessRunner implements ProcessRunner
{
    private const int STDERR_TAIL = 2048;
    private const int STDOUT_TAIL = 8192;

    /** @param list<string> $command */
    public function run(array $command, int $timeoutSec): ProcessResult
    {
        if ($command === []) {
            return new ProcessResult(-1, false);
        }
        $command = array_values(array_map(static fn (mixed $part): string => (string)$part, $command));
        $descriptors = [
            0 => ['file', '/dev/null', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        $process = @proc_open($command, $descriptors, $pipes);
        if (!is_resource($process)) {
            return new ProcessResult(-1, false);
        }
        foreach ([1, 2] as $fd) {
            if (isset($pipes[$fd]) && is_resource($pipes[$fd])) {
                stream_set_blocking($pipes[$fd], false);
            }
        }

        $stderr = '';
        $stdout = '';
        $exitCode = -1;
        $timedOut = false;
        $deadline = microtime(true) + max(1, $timeoutSec);
        $phase = 0; // 0 = running, 1 = SIGTERM sent, 2 = SIGKILL sent
        while (true) {
            $status = proc_get_status($process);
            if (!is_array($status) || ($status['running'] ?? false) !== true) {
                $exitCode = (int)($status['exitcode'] ?? -1);
                break;
            }
            $stderr = self::drain($pipes[2] ?? null, $stderr, self::STDERR_TAIL);
            $stdout = self::drain($pipes[1] ?? null, $stdout, self::STDOUT_TAIL);
            $now = microtime(true);
            if ($phase === 0 && $now >= $deadline) {
                $timedOut = true;
                $phase = 1;
                proc_terminate($process, 15);
                $deadline = $now + 2.0;
            } elseif ($phase === 1 && $now >= $deadline) {
                $phase = 2;
                proc_terminate($process, 9);
                $deadline = $now + 2.0;
            } elseif ($phase === 2 && $now >= $deadline) {
                // the tool ignored SIGKILL (or is stuck in the kernel): stop waiting, forget it
                $exitCode = -1;
                break;
            }
            usleep(100000);
        }
        $stderr = self::drain($pipes[2] ?? null, $stderr, self::STDERR_TAIL);
        $stdout = self::drain($pipes[1] ?? null, $stdout, self::STDOUT_TAIL);
        foreach ([1, 2] as $fd) {
            if (isset($pipes[$fd]) && is_resource($pipes[$fd])) {
                fclose($pipes[$fd]);
            }
        }
        $closed = proc_close($process);
        if ($exitCode < 0 && $closed >= 0) {
            $exitCode = $closed;
        }

        return new ProcessResult($exitCode, $timedOut, $stderr, $stdout);
    }

    /** @param resource|null $pipe */
    private static function drain(mixed $pipe, string $buffer, int $keep): string
    {
        if (!is_resource($pipe)) {
            return $buffer;
        }
        $chunk = stream_get_contents($pipe);
        if (!is_string($chunk) || $chunk === '') {
            return $buffer;
        }

        return substr($buffer . $chunk, -$keep);
    }
}
