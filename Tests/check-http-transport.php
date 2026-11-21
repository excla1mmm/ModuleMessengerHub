<?php

declare(strict_types=1);

// HttpTransport regression: a JSON body must go out with Content-Type: application/json. A merge bug
// once sent JSON labelled as form-urlencoded — Telegram answered 400 to every sendMessage while
// getUpdates (all-default params) kept working.

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Channels\HttpTransport;

$dir = sys_get_temp_dir() . '/mh-http-transport-' . getmypid();
@mkdir($dir, 0777, true);
$router = $dir . '/router.php';
file_put_contents($router, <<<'PHP'
<?php
$path = $_SERVER['REQUEST_URI'] ?? '/';
if (str_starts_with($path, '/limited')) {
    // the header is untrusted input: the transport must keep the number and clamp it
    header('Content-Type: application/json');
    header('Retry-After: ' . (str_contains($path, 'huge') ? '864000' : (str_contains($path, 'date') ? 'Wed, 21 Oct 2026 07:28:00 GMT' : '17')));
    http_response_code(429);
    echo '{"code":"rate.limit"}';
    exit;
}
file_put_contents(__DIR__ . '/captured.json', json_encode([
    'method' => $_SERVER['REQUEST_METHOD'] ?? '',
    'content_type' => $_SERVER['CONTENT_TYPE'] ?? '',
    'authorization' => $_SERVER['HTTP_AUTHORIZATION'] ?? '',
    'body' => file_get_contents('php://input'),
], JSON_UNESCAPED_UNICODE));
header('Content-Type: application/json');
echo '{"ok":true}';
PHP);

$server = null;
$port = 0;
for ($attempt = 0; $attempt < 10 && $server === null; $attempt++) {
    $candidate = random_int(20000, 45000);
    $command = 'exec ' . escapeshellarg(PHP_BINARY) . ' -S 127.0.0.1:' . $candidate
        . ' ' . escapeshellarg($router);
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
    $transport = new HttpTransport('', '', 5, 2);
    $response = $transport->postJson('http://127.0.0.1:' . $port . '/', ['chat_id' => '1', 'text' => 'hi']);
    check($response->status === 200 && !$response->failed(), 'postJson gets the server answer');

    $captured = json_decode((string)@file_get_contents($dir . '/captured.json'), true);
    check(is_array($captured), 'the server captured the request');
    check(
        is_array($captured) && str_contains((string)($captured['content_type'] ?? ''), 'application/json'),
        'JSON POST carries Content-Type: application/json'
    );
    $body = json_decode((string)($captured['body'] ?? ''), true);
    check(is_array($body) && ($body['chat_id'] ?? '') === '1' && ($body['text'] ?? '') === 'hi', 'JSON body arrives as JSON');

    @unlink($dir . '/captured.json');
    $response = $transport->get('http://127.0.0.1:' . $port . '/');
    check($response->status === 200, 'GET works');

    $response = $transport->delete('http://127.0.0.1:' . $port . '/messages?message_id=1', ['Authorization: max-token-value']);
    check($response->status === 200, 'DELETE works');
    $captured = json_decode((string)@file_get_contents($dir . '/captured.json'), true);
    check(is_array($captured) && ($captured['method'] ?? '') === 'DELETE', 'DELETE is sent as DELETE');
    check(is_array($captured) && ($captured['authorization'] ?? '') === 'max-token-value', 'channel headers reach the server');

    $response = $transport->postJson('http://127.0.0.1:' . $port . '/', ['a' => 1], ["X-Ignored: ok\r\nInjected: yes", 'Accept-Language: ru']);
    check($response->status === 200, 'a header with a line break does not break the request');
    $captured = json_decode((string)@file_get_contents($dir . '/captured.json'), true);
    check(is_array($captured) && ($captured['authorization'] ?? '') === '', 'a CRLF header line is dropped entirely');
    check(!str_contains((string)($captured['content_type'] ?? ''), 'text/plain'), 'extra headers keep the JSON content type');

    $response = $transport->get('http://127.0.0.1:' . $port . '/limited');
    check($response->status === 429 && $response->retryAfterSec === 17, 'Retry-After is parsed into the response');
    $response = $transport->get('http://127.0.0.1:' . $port . '/limited-huge');
    check($response->retryAfterSec === 3600, 'an absurd Retry-After is clamped to one hour');
    $response = $transport->get('http://127.0.0.1:' . $port . '/limited-date');
    check($response->retryAfterSec === 0, 'an HTTP-date Retry-After is not mistaken for seconds');

    proc_terminate($server);
    proc_close($server);
}

@unlink($router);
@unlink($dir . '/captured.json');
@rmdir($dir);

finish('http transport OK');
