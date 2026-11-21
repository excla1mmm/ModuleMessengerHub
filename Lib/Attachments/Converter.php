<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/**
 * Converts a recording (or one fragment of it) to a small mono MP3 (Plan/03, decision 3a-1).
 *
 * Tool chain: ffmpeg -> sox (MP3) -> sox (WAV) + lame. Every command is an argument array executed
 * through ProcessRunner (no shell string), with `nice` and a hard timeout. Output is written only to
 * the caller's module temp directory; a failed attempt never leaves a partial file behind.
 */
final class Converter
{
    public const string CODE_MISSING = 'attachment.converter_missing';
    public const string CODE_FAILED = 'attachment.conversion_failed';
    public const string CODE_TIMEOUT = 'attachment.conversion_timeout';
    public const string CODE_CANCELLED = 'attachment.cancelled';

    private const int BITRATE_KBPS = 32;
    private const int SAMPLE_RATE = 16000;
    private const int PROBE_TIMEOUT_SEC = 30;

    public function __construct(
        private readonly ProcessRunner $runner,
        private readonly ToolFinder $tools,
        private readonly int $timeoutSec = 300,
    ) {
    }

    public function available(): bool
    {
        return $this->tools->has('ffmpeg') || $this->tools->has('sox');
    }

    /**
     * @param array{start_ms: int, end_ms: int}|null $fragment null = the whole recording
     */
    /**
     * @param callable(): bool|null $onProgress called before every tool attempt; false aborts
     */
    public function convert(
        string $source,
        string $output,
        ?array $fragment = null,
        string $wavPath = '',
        ?callable $onProgress = null,
    ): ConversionResult {
        if (!$this->available()) {
            return new ConversionResult(code: self::CODE_MISSING);
        }
        $wavPath = $wavPath !== '' ? $wavPath : (string)preg_replace('/\.mp3$/i', '', $output) . '.wav';
        $timedOut = false;
        foreach ($this->buildCommands($source, $output, $fragment, $wavPath) as $command) {
            if ($onProgress !== null && $onProgress() === false) {
                self::discard($output);
                self::discard($wavPath);

                return new ConversionResult(code: self::CODE_CANCELLED);
            }
            $result = $this->runner->run($command, $this->timeoutSec);
            if ($result->timedOut) {
                $timedOut = true;
                self::discard($output);
                break; // a second heavy attempt would only spend another timeout
            }
            if ($result->ok() && self::looksLikeMp3($output)) {
                self::discard($wavPath);

                return new ConversionResult(
                    path: $output,
                    durationMs: $this->durationMs($output),
                );
            }
            self::discard($output);
            self::discard($wavPath);
        }
        self::discard($wavPath);

        return new ConversionResult(
            code: $timedOut ? self::CODE_TIMEOUT : self::CODE_FAILED,
            timedOut: $timedOut,
        );
    }

    /**
     * The exact argument arrays, exposed for the contract check: the test asserts there is no shell
     * string, that `nice` and `-nostdin` are present and that fragments use `-ss`/`-t`.
     *
     * @param array{start_ms: int, end_ms: int}|null $fragment
     * @return list<list<string>>
     */
    public function buildCommands(string $source, string $output, ?array $fragment, string $wavPath): array
    {
        $commands = [];
        $nice = $this->tools->path('nice');
        $prefix = $nice !== '' ? [$nice, '-n', '10'] : [];
        $ss = $fragment === null ? '' : self::seconds($fragment['start_ms']);
        $duration = $fragment === null
            ? ''
            : self::seconds(max(0, $fragment['end_ms'] - $fragment['start_ms']));

        $ffmpeg = $this->tools->path('ffmpeg');
        if ($ffmpeg !== '') {
            $command = [...$prefix, $ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-y'];
            if ($ss !== '') {
                $command[] = '-ss';
                $command[] = $ss;
            }
            $command[] = '-i';
            $command[] = $source;
            if ($duration !== '') {
                $command[] = '-t';
                $command[] = $duration;
            }
            $command = [...$command,
                '-vn',
                '-ac', '1',
                '-ar', (string)self::SAMPLE_RATE,
                '-b:a', self::BITRATE_KBPS . 'k',
                '-f', 'mp3',
                $output,
            ];
            $commands[] = $command;
        }

        $sox = $this->tools->path('sox');
        if ($sox !== '') {
            $command = [...$prefix, $sox, $source, '-C', (string)self::BITRATE_KBPS, $output];
            if ($ss !== '') {
                $command = [...$command, 'trim', $ss, $duration];
            }
            $commands[] = $command;

            $lame = $this->tools->path('lame');
            if ($lame !== '') {
                $toWav = [...$prefix, $sox, $source, $wavPath];
                if ($ss !== '') {
                    $toWav = [...$toWav, 'trim', $ss, $duration];
                }
                $commands[] = $toWav;
                $commands[] = [
                    ...$prefix,
                    $lame,
                    '--silent',
                    '-m', 'm',
                    '-b', (string)self::BITRATE_KBPS,
                    $wavPath,
                    $output,
                ];
            }
        }

        return $commands;
    }

    /** MP3 duration in milliseconds, 0 when it cannot be measured (best effort, never fatal). */
    public function durationMs(string $path): int
    {
        $ffprobe = $this->tools->path('ffprobe');
        if ($ffprobe !== '') {
            $result = $this->runner->run([
                $ffprobe,
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=nw=1:nk=1',
                $path,
            ], self::PROBE_TIMEOUT_SEC);
            $seconds = self::number($result->stdout);
            if ($seconds > 0) {
                return (int)round($seconds * 1000);
            }
        }
        $soxi = $this->tools->path('soxi');
        if ($soxi !== '') {
            $result = $this->runner->run([$soxi, '-D', $path], self::PROBE_TIMEOUT_SEC);
            $seconds = self::number($result->stdout);
            if ($seconds > 0) {
                return (int)round($seconds * 1000);
            }
        }

        return 0;
    }

    /**
     * Removes a scratch file only when it exists: a suppressed unlink() warning still lands in
     * error_get_last() and a worker shutdown handler then logs it as SHUTDOWN-ERROR (seen on the station).
     */
    private static function discard(string $path): void
    {
        if (is_file($path)) {
            @unlink($path);
        }
    }

    private static function seconds(int $milliseconds): string
    {
        return number_format(max(0, $milliseconds) / 1000, 3, '.', '');
    }

    private static function number(string $text): float
    {
        $text = trim($text);
        if ($text === '' || preg_match('/^\d+(?:\.\d+)?$/', $text) !== 1) {
            return 0.0;
        }

        return (float)$text;
    }

    private static function looksLikeMp3(string $path): bool
    {
        if (!is_file($path) || (int)@filesize($path) <= 0) {
            return false;
        }
        $handle = @fopen($path, 'rb');
        if (!is_resource($handle)) {
            return false;
        }
        $head = (string)fread($handle, 3);
        fclose($handle);
        if (str_starts_with($head, 'ID3')) {
            return true;
        }
        if (strlen($head) < 2) {
            return false;
        }
        $first = ord($head[0]);
        $second = ord($head[1]);

        return $first === 0xFF && ($second & 0xE0) === 0xE0;
    }
}
