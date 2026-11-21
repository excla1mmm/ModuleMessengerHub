<?php

declare(strict_types=1);

// Telegram adapter contract (Plan/03-channels.md, docs/adding-a-channel.md): response fixtures map to
// sent | retry | permanent | recipient_gone, discovery handles the webhook conflict, HTML rendering
// escapes data and respects the 4096 limit, and no token ever appears in a code or a log.

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Channels\AttachmentPart;
use Modules\ModuleMessengerHub\Lib\Channels\BotCredentials;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelLimits;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryCursor;
use Modules\ModuleMessengerHub\Lib\Channels\HttpClient;
use Modules\ModuleMessengerHub\Lib\Channels\HttpResponse;
use Modules\ModuleMessengerHub\Lib\Channels\Recipient;
use Modules\ModuleMessengerHub\Lib\Channels\SendResult;
use Modules\ModuleMessengerHub\Lib\Channels\Telegram\TelegramApi;
use Modules\ModuleMessengerHub\Lib\Channels\Telegram\TelegramChannel;
use Modules\ModuleMessengerHub\Lib\Channels\Telegram\TelegramHtml;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;

final class ScriptedHttp implements HttpClient
{
    /** @var list<array{fixture: ?string, status: int, error: string}> */
    private array $queue = [];

    /** @var list<array{method: string, url: string, payload: array<string, mixed>, headers: list<string>}> */
    public array $calls = [];

    public function queue(string $fixture, int $status = 200, string $error = ''): self
    {
        $this->queue[] = ['fixture' => $fixture, 'status' => $status, 'error' => $error];

        return $this;
    }

    public function queueTransportError(string $code): self
    {
        $this->queue[] = ['fixture' => null, 'status' => 0, 'error' => $code];

        return $this;
    }

    public function postJson(string $url, array $payload, array $headers = []): HttpResponse
    {
        $this->calls[] = ['method' => 'post', 'url' => $url, 'payload' => $payload, 'headers' => $headers];

        return $this->response();
    }

    public function postMultipart(string $url, array $fields, string $fileField, string $filePath, string $filename = '', string $mimeType = '', array $headers = []): HttpResponse
    {
        $this->calls[] = ['method' => 'multipart', 'url' => $url, 'payload' => $fields, 'headers' => $headers];

        return $this->response();
    }

    public function get(string $url, array $headers = []): HttpResponse
    {
        $this->calls[] = ['method' => 'get', 'url' => $url, 'payload' => [], 'headers' => $headers];

        return $this->response();
    }

    public function delete(string $url, array $headers = []): HttpResponse
    {
        $this->calls[] = ['method' => 'delete', 'url' => $url, 'payload' => [], 'headers' => $headers];

        return $this->response();
    }

    private function response(): HttpResponse
    {
        $next = array_shift($this->queue) ?? ['fixture' => null, 'status' => 0, 'error' => 'http.unavailable'];
        if ($next['error'] !== '') {
            return new HttpResponse(0, '', $next['error']);
        }

        return new HttpResponse(
            $next['status'],
            json_encode(telegramFixture((string)$next['fixture']), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)
        );
    }
}

const TOKEN = '123456789' . ':AAHfakeTokenValueForContractTests'; // split: not a real token, keeps secret scanners quiet
$bot = new BotCredentials('telegram', TOKEN);
$to = new Recipient('-1001234567890', 'group', 'Дежурная смена');

// ---------- checkToken ----------

$http = new ScriptedHttp();
$http->queue('get_me_ok');
$identity = (new TelegramApi($http, 'https://tg.local'))->getMe($bot);
check($identity->ok, 'getMe ok');
check($identity->username === 'miko_alerts_bot', 'bot username parsed');
check($identity->externalId === '123456789', 'bot id parsed');
check($identity->displayName === 'MIKO Alerts', 'bot display name parsed');

$http = new ScriptedHttp();
$http->queue('error_401', 401);
$identity = (new TelegramApi($http, 'https://tg.local'))->getMe($bot);
check(!$identity->ok, 'getMe 401 is a failure');
check($identity->errorCode === 'telegram.401.unauthorized', '401 maps to a normalised code');

// ---------- discovery ----------

$http = new ScriptedHttp();
$http->queue('get_updates_ok');
$batch = (new TelegramApi($http, 'https://tg.local'))->getUpdates($bot, new DiscoveryCursor(0, 1));
check(count($batch->chats) === 2, 'discovery found the group and the private chat');
check($batch->chats[0]->chatId === '-1001234567890' && $batch->chats[0]->kind === 'group', 'group chat parsed');
check($batch->chats[1]->chatId === '444555666' && $batch->chats[1]->kind === 'private', 'private chat parsed');
check($batch->chats[1]->title === 'Пётр Сидоров', 'private chat title from the name');
check($batch->nextOffset === 103, 'offset advanced past the last update');
check($batch->errorCode === '', 'no error');

$http = new ScriptedHttp();
$http->queue('get_updates_kicked');
$batch = (new TelegramApi($http, 'https://tg.local'))->getUpdates($bot, new DiscoveryCursor(200, 1));
check($batch->chats === [], 'a chat the bot was kicked from or left is not offered');
check($batch->nextOffset === 203, 'the offset still advances past those updates');

$http = new ScriptedHttp();
$http->queue('error_409_webhook', 409);
$batch = (new TelegramApi($http, 'https://tg.local'))->getUpdates($bot, new DiscoveryCursor(50, 1));
check($batch->errorCode === 'telegram.409.webhook_set', 'a webhook blocks getUpdates and is reported');
check($batch->nextOffset === 50, 'offset unchanged on error');

// ---------- send classification ----------

$http = new ScriptedHttp();
$http->queue('send_ok');
$result = (new TelegramApi($http, 'https://tg.local'))->sendMessage($bot, '-1001234567890', 'hi');
check($result->outcome === SendResult::SENT, 'sendMessage ok -> sent');
check($result->ids === ['42'], 'message id collected');
check($http->calls[0]['payload']['parse_mode'] === 'HTML', 'sendMessage uses HTML');

$http = new ScriptedHttp();
$http->queue('error_429', 429);
$result = (new TelegramApi($http, 'https://tg.local'))->sendMessage($bot, '-1001234567890', 'hi');
check($result->outcome === SendResult::RETRY, '429 -> retry');
check($result->retryAfterSec === 37, 'retry_after honoured');
check($result->code === 'telegram.429.rate_limit', '429 code normalised');

foreach ([
    'error_403_blocked' => 'telegram.403.blocked',
    'error_403_kicked' => 'telegram.403.kicked',
    'error_400_chat_not_found' => 'telegram.400.chat_not_found',
] as $fixture => $expectedCode) {
    $http = new ScriptedHttp();
    $http->queue($fixture, 403);
    $result = (new TelegramApi($http, 'https://tg.local'))->sendMessage($bot, '1', 'hi');
    check($result->outcome === SendResult::RECIPIENT_GONE, $fixture . ' -> recipient_gone');
    check($result->code === $expectedCode, $fixture . ' code');
}

$http = new ScriptedHttp();
$http->queue('error_400_migrate', 400);
$result = (new TelegramApi($http, 'https://tg.local'))->sendMessage($bot, '1', 'hi');
check($result->outcome === SendResult::RETRY, 'group migration -> retry');
check($result->migratedChatId === '-1001234567890', 'new supergroup id returned');
check($result->retryAfterSec === 0, 'migration retries immediately');

$http = new ScriptedHttp();
$http->queue('error_401', 401);
$result = (new TelegramApi($http, 'https://tg.local'))->sendMessage($bot, '1', 'hi');
check($result->outcome === SendResult::PERMANENT, '401 -> permanent');
check($result->code === 'telegram.401.unauthorized', '401 code');

$http = new ScriptedHttp();
$http->queue('error_502', 502);
$result = (new TelegramApi($http, 'https://tg.local'))->sendMessage($bot, '1', 'hi');
check($result->outcome === SendResult::RETRY, '5xx -> retry');
check($result->retryAfterSec === 30, '5xx backs off');

$http = new ScriptedHttp();
$http->queueTransportError('http.timeout');
$result = (new TelegramApi($http, 'https://tg.local'))->sendMessage($bot, '1', 'hi');
check($result->outcome === SendResult::RETRY && $result->uncertain, 'timeout -> uncertain retry');
check($result->code === 'http.timeout', 'transport code kept');

// ---------- delete ----------

$http = new ScriptedHttp();
$http->queue('delete_ok');
$result = (new TelegramApi($http, 'https://tg.local'))->deleteMessage($bot, '1', '42');
check($result->outcome === SendResult::SENT, 'delete ok');

$http = new ScriptedHttp();
$http->queue('delete_not_found', 400);
$result = (new TelegramApi($http, 'https://tg.local'))->deleteMessage($bot, '1', '42');
check($result->outcome === SendResult::SENT, 'deleting a missing message counts as deleted');

// ---------- HTML rendering ----------

$limits = ChannelLimits::telegram();
$html = new TelegramHtml($limits);
$rendered = $html->render(new RenderedMessage(
    title: '⚠️ <b>Внимание</b> & "кавычки"',
    lines: ['a<b>c'],
    notes: ['x & y'],
    quotes: [['time' => '02:14', 'text' => 'цитата <i>']],
    footer: 'call-1',
    buttons: [['text' => 'Открыть', 'url' => 'https://pbx.local/cdr']]
));
check(str_contains($rendered['text'], '&lt;b&gt;Внимание&lt;/b&gt; &amp; &quot;кавычки&quot;'), 'data is escaped');
check(!str_contains($rendered['text'], '<b>Внимание</b>'), 'no raw markup from data');
check(str_contains($rendered['text'], '<blockquote><code>02:14</code> «цитата &lt;i&gt;»</blockquote>'), 'quote block with timecode');
check(str_contains($rendered['text'], '<code>call-1</code>'), 'call id in monospace');
check($rendered['buttons'] === [['text' => 'Открыть', 'url' => 'https://pbx.local/cdr']], 'https button kept');

$rendered = $html->render(new RenderedMessage(
    title: 'T',
    lines: ['ok'],
    buttons: [['text' => 'bad', 'url' => 'javascript:alert(1)'], ['text' => 'ftp', 'url' => 'ftp://x']]
));
check($rendered['buttons'] === [], 'non-http buttons are dropped');

$long = str_repeat('Очень длинный текст. ', 400);
$rendered = $html->render(new RenderedMessage(
    title: 'Заголовок',
    lines: ['короткая строка'],
    notes: [$long],
    footer: 'mikopbx-1790944900.650',
    buttons: [['text' => 'Открыть звонок', 'url' => 'https://pbx.local/cdr']]
));
check(mb_strlen($rendered['text']) <= $limits->maxTextLength, 'text truncated under the Telegram limit');
check(str_contains($rendered['text'], '…'), 'the longest paragraph is shortened with an ellipsis');
check(str_contains($rendered['text'], 'mikopbx-1790944900.650'), 'call id kept when truncating');
check(count($rendered['buttons']) === 1, 'button kept when truncating');

// ---------- adapter ----------

$http = new ScriptedHttp();
$http->queue('send_ok');
$channel = new TelegramChannel(new TelegramApi($http, 'https://tg.local'));
$result = $channel->send($bot, $to, new RenderedMessage(title: 'Заголовок', lines: ['строка']));
check($result->outcome === SendResult::SENT, 'channel sends the rendered text');
check($channel->limits()->maxTextLength === 4096, 'Telegram limits exposed');
check($channel->id() === 'telegram', 'channel id');

// ---------- transport outcomes: connect failure vs read timeout ----------

$http = new ScriptedHttp();
$http->queueTransportError('http.connect_failed');
$result = (new TelegramApi($http, 'https://tg.local'))->sendMessage($bot, '1', 'hi');
check($result->outcome === SendResult::RETRY && !$result->uncertain, 'a connect failure is retried without uncertain');

$http = new ScriptedHttp();
$http->queueTransportError('http.timeout');
$result = (new TelegramApi($http, 'https://tg.local'))->sendMessage($bot, '1', 'hi');
check($result->outcome === SendResult::RETRY && $result->uncertain, 'a read timeout after the request is uncertain');

// ---------- a locally unavailable file is permanent, not uncertain ----------

$http = new ScriptedHttp();
$http->queueTransportError('file.unavailable');
$result = (new TelegramApi($http, 'https://tg.local'))->sendAudio($bot, '1', '/nope.mp3');
check($result->outcome === SendResult::PERMANENT && $result->code === 'telegram.file_unavailable', 'a missing local file is permanent');

// ---------- audio attachment (stage 3a) ----------

$http = new ScriptedHttp();
$http->queue('send_ok');
$channel = new TelegramChannel(new TelegramApi($http, 'https://tg.local'));
$result = $channel->sendAttachment($bot, $to, new AttachmentPart('/module/tmp/a.mp3', 'A < B & C'));
check($result->result->outcome === SendResult::SENT && $result->result->ids === ['42'], 'attachment: sendAudio result mapped');
check($http->calls[0]['method'] === 'multipart', 'attachment: audio goes as multipart');
check(str_ends_with($http->calls[0]['url'], '/sendAudio'), 'attachment: sendAudio method');
check($http->calls[0]['payload']['caption'] === 'A &lt; B &amp; C', 'attachment: the caption is escaped');
check($http->calls[0]['payload']['parse_mode'] === 'HTML', 'attachment: caption uses HTML mode');
check(!str_contains((string)$result->result->code, '/module/tmp'), 'attachment: no file path in the code');

// ---------- secrets never leak ----------

$http = new ScriptedHttp();
$http->queue('error_401', 401);
$result = (new TelegramApi($http, 'https://tg.local'))->sendMessage($bot, '1', 'hi');
$serialised = json_encode($result) . '|' . $result->code;
check(!str_contains($serialised, TOKEN), 'SendResult carries no token');
check(!str_contains($result->code, explode(':', TOKEN)[0]), 'codes carry no token parts');
check(!str_contains(json_encode($http->calls[0]['payload']), TOKEN), 'payload carries no token');
check(isset($bot->__debugInfo()['token']) && $bot->__debugInfo()['token'] === '***', 'credentials debug output masks the token');
check(!str_contains(HubLogger::sanitize('token ' . TOKEN), TOKEN), 'logger masks a telegram token');
check(str_contains(HubLogger::sanitize('token ' . TOKEN), '***'), 'logger replaces it with ***');

finish('telegram channel OK');
