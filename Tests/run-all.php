<?php

declare(strict_types=1);

// Runs every Tests/check-*.php in its own process; any non-zero exit fails the run.

$tests = glob(__DIR__ . '/check-*.php') ?: [];
sort($tests, SORT_STRING);

if ($tests === []) {
    fwrite(STDERR, "No contract checks found\n");
    exit(1);
}

$php = PHP_BINARY ?: 'php';

foreach ($tests as $test) {
    echo '== ' . basename($test) . PHP_EOL;
    passthru(escapeshellarg($php) . ' ' . escapeshellarg($test), $exitCode);
    if ($exitCode !== 0) {
        fwrite(STDERR, sprintf("Contract check failed: %s\n", basename($test)));
        exit($exitCode);
    }
}

echo count($tests) . " contract checks passed\n";
