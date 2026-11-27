<?php

declare(strict_types=1);

// Local Core REST base URL (EGOR-50): nginx listens only on PbxSettings::WEB_PORT, so the hub must build
// http://127.0.0.1:<WEBPort> instead of a hard-coded :80, send the key nowhere else and ignore a proxy
// from the environment.

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Api\LocalRestBase;
use Modules\ModuleMessengerHub\Lib\Api\LocalRestClient;
use Modules\ModuleMessengerHub\Lib\Attachments\LocalRestFileDownloader;
use Modules\ModuleMessengerHub\Lib\Sources\SourceException;

// ---------- 1. base URL from the WEBPort value ----------

check(LocalRestBase::forPort('8080') === 'http://127.0.0.1:8080', 'a non-default web port goes into the base URL');
check(LocalRestBase::forPort(8443) === 'http://127.0.0.1:8443', 'an integer port is accepted');
check(LocalRestBase::forPort(" 8080\n") === 'http://127.0.0.1:8080', 'whitespace around the stored port is ignored');
check(LocalRestBase::forPort('80') === 'http://127.0.0.1:80', 'the default port is explicit');
check(LocalRestBase::forPort('65535') === 'http://127.0.0.1:65535', 'the highest port is accepted');
foreach ([null, '', '0', '65536', '99999999', '80abc', '-1', '1e3', '0x50', '80/evil', '80@evil.example', 0, 70000] as $bad) {
    check(LocalRestBase::forPort($bad) === 'http://127.0.0.1:80', 'an invalid port falls back to :80: ' . var_export($bad, true));
}

check(LocalRestBase::isLocal('http://127.0.0.1:8080'), 'the loopback base URL is local');
foreach ([
    'http://127.0.0.1',
    'http://127.0.0.1:',
    'http://127.0.0.1:8080/',
    'http://127.0.0.1:080',
    'http://127.0.0.1:0',
    'http://127.0.0.1:70000',
    'http://127.0.0.1:80@evil.example',
    'https://127.0.0.1:443',
    'http://localhost:80',
    'http://evil.example:80',
] as $bad) {
    check(!LocalRestBase::isLocal($bad), 'not a local base URL: ' . $bad);
}

// ---------- 2. the key never leaves for another base ----------

$got = '';
try {
    (new LocalRestClient('test-key', 'http://evil.example:80'))->get('/pbxcore/api/v3/advice');
} catch (SourceException $exception) {
    $got = $exception->errorCode;
}
check($got === 'api_bad_path', "a non-local base URL is refused before any request, got '$got'");

$dir = sys_get_temp_dir() . '/mh-local-rest-' . getmypid();
@mkdir($dir, 0777, true);
$foreign = $dir . '/foreign.bin';
check(
    (new LocalRestFileDownloader('test-key', 'http://evil.example:80'))
        ->download('/pbxcore/api/v3/cdr:download?token=t', $foreign, 100) === 'api_bad_path',
    'downloader: a non-local base URL is refused'
);
check(!file_exists($foreign), 'downloader: nothing is written for a refused base URL');

// ---------- 3. a real request on a non-default port, with a dead proxy in the environment ----------

$router = $dir . '/router.php';
file_put_contents($router, <<<'PHP'
<?php
$path = $_SERVER['REQUEST_URI'] ?? '/';
file_put_contents(__DIR__ . '/captured.json', json_encode([
    'path' => $path,
    'authorization' => $_SERVER['HTTP_AUTHORIZATION'] ?? '',
]));
if (str_starts_with($path, '/pbxcore/api/v3/cdr:download')) {
    header('Content-Type: application/octet-stream');
    echo 'RECORDING';
    exit;
}
header('Content-Type: application/json');
echo json_encode(['result' => true, 'data' => ['port' => (int)($_SERVER['SERVER_PORT'] ?? 0)]]);
PHP);

$server = null;
$port = 0;
for ($attempt = 0; $attempt < 10 && $server === null; $attempt++) {
    $candidate = random_int(20000, 45000);
    $command = 'exec ' . escapeshellarg(PHP_BINARY) . ' -S 127.0.0.1:' . $candidate . ' ' . escapeshellarg($router);
    $process = proc_open($command, [
        0 => ['file', '/dev/null', 'r'],
        1 => ['file', '/dev/null', 'w'],
        2 => ['file', '/dev/null', 'w'],
    ], $pipes);
    if (!is_resource($process)) {
        continue;
    }
    for ($i = 0; $i < 50; $i++) {
        $socket = @fsockopen('127.0.0.1', $candidate, $errno, $errstr, 0.1);
        if (is_resource($socket)) {
            fclose($socket);
            $server = $process;
            $port = $candidate;
            break;
        }
        usleep(100000);
    }
    if ($server === null) {
        proc_terminate($process);
        proc_close($process);
    }
}
check($server !== null, 'local test server started');

if ($server !== null) {
    // a proxy from the environment (set after the server started) must not see the local request
    foreach (['http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY'] as $name) {
        putenv($name . '=http://127.0.0.1:1');
    }
    putenv('no_proxy');
    putenv('NO_PROXY');

    $base = LocalRestBase::forPort((string)$port);
    $data = [];
    $error = '';
    try {
        $data = (new LocalRestClient('test-key', $base, 5))->get('/pbxcore/api/v3/advice', ['limit' => 1]);
    } catch (SourceException $exception) {
        $error = $exception->errorCode;
    }
    check($error === '' && ($data['port'] ?? 0) === $port, "client: the request reaches the web port $port directly, got '$error'");
    $captured = json_decode((string)@file_get_contents($dir . '/captured.json'), true);
    check(($captured['authorization'] ?? '') === 'Bearer test-key', 'client: the hub key is sent to the PBX');
    check(($captured['path'] ?? '') === '/pbxcore/api/v3/advice?limit=1', 'client: path and query are kept');

    $file = $dir . '/recording.bin';
    $result = (new LocalRestFileDownloader('test-key', $base, 60))
        ->download('/pbxcore/api/v3/cdr:download?token=t', $file, 1000);
    check($result === '', "downloader: the recording is fetched from the web port, got '$result'");
    check(@file_get_contents($file) === 'RECORDING', 'downloader: the body is written');
    $captured = json_decode((string)@file_get_contents($dir . '/captured.json'), true);
    check(($captured['authorization'] ?? '') === 'Bearer test-key', 'downloader: the hub key is sent to the PBX');
    @unlink($file);

    foreach (['http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY'] as $name) {
        putenv($name);
    }
    proc_terminate($server);
    proc_close($server);
}

@unlink($router);
@unlink($dir . '/captured.json');
@rmdir($dir);

finish('local REST base URL OK');
