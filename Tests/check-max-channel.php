<?php

declare(strict_types=1);

// MAX adapter contract (Plan/03-channels.md, docs/adding-a-channel.md): response fixtures map to
// sent | retry | permanent | recipient_gone, discovery learns chats from bot_added/bot_started only,
// HTML rendering escapes data and respects the 4000 limit, delete is idempotent, the Минцифры CA
// bundle reaches only the MAX transport, and no token ever appears in a code, a URL or a log.

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Channels\AttachmentPart;
use Modules\ModuleMessengerHub\Lib\Channels\BotCredentials;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelFactory;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelLimits;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryCursor;
use Modules\ModuleMessengerHub\Lib\Channels\HttpClient;
use Modules\ModuleMessengerHub\Lib\Channels\HttpResponse;
use Modules\ModuleMessengerHub\Lib\Channels\Max\MaxApi;
use Modules\ModuleMessengerHub\Lib\Channels\Max\MaxCaBundle;
use Modules\ModuleMessengerHub\Lib\Channels\Max\MaxChannel;
use Modules\ModuleMessengerHub\Lib\Channels\Max\MaxMarkup;
use Modules\ModuleMessengerHub\Lib\Channels\Recipient;
use Modules\ModuleMessengerHub\Lib\Channels\SendResult;
use Modules\ModuleMessengerHub\Lib\Delivery\RateLimiter;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;

/** Anonymised MAX fixtures: a canned response per call, including raw (non-JSON) bodies. */
final class ScriptedMaxHttp implements HttpClient
{
    /** @var list<array{name: ?string, status: int, error: string, retryAfter: int, raw: bool}> */
    private array $queue = [];

    /** @var list<array{method: string, url: string, payload: array<string, mixed>, headers: list<string>}> */
    public array $calls = [];

    public function queue(string $fixture, int $status = 200, bool $raw = false): self
    {
        $this->queue[] = ['name' => $fixture, 'status' => $status, 'error' => '', 'retryAfter' => 0, 'raw' => $raw];

        return $this;
    }

    public function queueRetryAfter(string $fixture, int $status, int $retryAfter): self
    {
        $this->queue[] = ['name' => $fixture, 'status' => $status, 'error' => '', 'retryAfter' => $retryAfter, 'raw' => false];

        return $this;
    }

    public function queueTransportError(string $code): self
    {
        $this->queue[] = ['name' => null, 'status' => 0, 'error' => $code, 'retryAfter' => 0, 'raw' => false];

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
        $next = array_shift($this->queue) ?? ['name' => null, 'status' => 0, 'error' => 'http.unavailable', 'retryAfter' => 0, 'raw' => false];
        if ($next['error'] !== '') {
            return new HttpResponse(0, '', $next['error']);
        }
        $file = __DIR__ . '/fixtures/max/' . (string)$next['name'] . ($next['raw'] === true ? '.txt' : '.json');
        $body = (string)@file_get_contents($file);

        return new HttpResponse((int)$next['status'], $body, '', (int)$next['retryAfter']);
    }
}

const TOKEN = 'max_fake_bot_token_0123456789abcdefghijklmnopqrstuvwxyz';
$bot = new BotCredentials('max', TOKEN);
$group = new Recipient('-70000000000001', 'group', 'Дежурная смена');
$dialog = new Recipient('777888999', 'private', 'Пётр Сидоров');
$api = static fn (ScriptedMaxHttp $http): MaxApi => new MaxApi($http, 'https://max.local');

// ---------- checkToken ----------

$http = new ScriptedMaxHttp();
$http->queue('me_ok');
$identity = $api($http)->me($bot);
check($identity->ok, 'GET /me ok');
check($identity->username === 'miko_alerts_bot', 'bot username parsed');
check($identity->externalId === '123456789', 'bot user id parsed');
check($identity->displayName === 'MIKO Alerts', 'bot display name parsed');
check($http->calls[0]['headers'] === ['Authorization: ' . TOKEN], 'token goes into Authorization without Bearer');
check(!str_contains($http->calls[0]['url'], TOKEN), 'token never appears in the URL');

$http = new ScriptedMaxHttp();
$http->queue('error_401', 401);
$identity = $api($http)->me($bot);
check(!$identity->ok, 'GET /me 401 is a failure');
check($identity->errorCode === 'max.401.unauthorized', '401 maps to a normalised code');

$http = new ScriptedMaxHttp();
$http->queueTransportError('http.tls');
$identity = $api($http)->me($bot);
check($identity->errorCode === 'max.tls.untrusted_ca', 'a TLS failure is reported as max.tls.untrusted_ca');

// ---------- discovery ----------

$http = new ScriptedMaxHttp();
$http->queue('updates_ok');
$http->queue('chats_ok');          // bot_added: GET /chats/{chatId} for the group
$http->queue('chats_channel');     // bot_added: GET /chats/{chatId} for the channel
$batch = $api($http)->updates($bot, new DiscoveryCursor(0, 2));
check(count($batch->chats) === 3, 'bot_added (chat, channel) and bot_started create three chats, removals none');
check($http->calls[1]['method'] === 'get' && str_ends_with($http->calls[1]['url'], '/chats/-70000000000001'), 'a bot_added group title is read from GET /chats/{chatId}');
check($batch->chats[0]->title === 'Дежурная смена', 'the group gets its real title');
check($batch->chats[2]->title === 'Уведомления АТС', 'the channel gets its real title');
$kinds = [];
foreach ($batch->chats as $chat) {
    $kinds[$chat->chatId] = $chat->kind;
}
check($kinds === [
    '-70000000000001' => 'group',
    '777888999' => 'private',
    '-70000000000003' => 'channel',
], 'a dialog is keyed by the MAX user id, a channel is marked as a channel');
check($batch->chats[1]->title === 'Пётр Сидоров', 'dialog title comes from the user name');
check($batch->nextOffset === 98765432, 'marker becomes the next cursor');
check($batch->errorCode === '', 'no error');
check(
    str_contains($http->calls[0]['url'], 'types=bot_added,bot_started,bot_removed,user_removed'),
    'only discovery event types are requested, comma separated'
);
check(!str_contains($http->calls[0]['url'], 'marker='), 'the first poll has no marker');

$http = new ScriptedMaxHttp();
$http->queue('updates_ok');
$http->queue('error_500', 500);    // the title lookup of the group fails
$http->queueTransportError('http.timeout'); // and the channel lookup blinks
$batch = $api($http)->updates($bot, new DiscoveryCursor(0, 2));
check(count($batch->chats) === 3, 'a failed title lookup still returns every chat');
check($batch->chats[0]->title === '', 'a failed title lookup leaves the title empty');
check($batch->errorCode === '', 'a failed title lookup does not fail the poll');

$http = new ScriptedMaxHttp();
check($api($http)->chatTitle($bot, '../../me') === '', 'a non-numeric chat id is refused without a request');
check($api($http)->chatTitle($bot, '1/../me') === '', 'a path-like chat id is refused');
check($http->calls === [], 'no request is sent for an invalid chat id');
$http->queue('chats_ok');
check($api($http)->chatTitle($bot, '-70000000000001') === 'Дежурная смена', 'a negative chat id is a valid MAX id');

$http = new ScriptedMaxHttp();
$http->queue('updates_empty');
$batch = $api($http)->updates($bot, new DiscoveryCursor(24640, 2));
check($batch->chats === [], 'an empty page finds nothing');
check(str_contains($http->calls[0]['url'], 'marker=24640'), 'a known marker is passed back');
check($batch->nextOffset === 24648, 'cursor follows the marker');

$http = new ScriptedMaxHttp();
$http->queue('updates_no_user');
$batch = $api($http)->updates($bot, new DiscoveryCursor(0, 2));
check($batch->chats === [], 'bot_started without user.user_id creates no dialog chat');

// Live MAX answers 200 with an empty page while a webhook subscription exists, so the first empty
// page of a session is checked against GET /subscriptions.
$http = new ScriptedMaxHttp();
$http->queue('updates_empty');
$http->queue('subscriptions_active');
$batch = $api($http)->updates($bot, new DiscoveryCursor(0, 2));
check($batch->errorCode === 'max.405.webhook_set', 'an active subscription on the first empty page is reported');
check($batch->nextOffset === 0, 'cursor unchanged when the poll is refused');

$http = new ScriptedMaxHttp();
$http->queue('updates_empty');
$http->queue('subscriptions_empty');
$batch = $api($http)->updates($bot, new DiscoveryCursor(0, 2));
check($batch->errorCode === '', 'no subscription means an empty page is just empty');
check(count($http->calls) === 2, 'the subscription list is asked once');

$http = new ScriptedMaxHttp();
$http->queue('updates_empty');
$batch = $api($http)->updates($bot, new DiscoveryCursor(24640, 2));
check($batch->errorCode === '', 'a later poll in the session does not ask again');
check(count($http->calls) === 1, 'no extra request after the first page');

check($api(new ScriptedMaxHttp()->queue('subscriptions_active'))->hasSubscription($bot), 'hasSubscription reads the list');

$http = new ScriptedMaxHttp();
$http->queue('error_405_webhook', 405);
$batch = $api($http)->updates($bot, new DiscoveryCursor(5, 2));
check($batch->errorCode === 'max.405.webhook_set', 'a 405 is still reported as a webhook conflict');
check($batch->nextOffset === 5, 'cursor unchanged on error');

$http = new ScriptedMaxHttp();
$http->queueTransportError('http.timeout');
$batch = $api($http)->updates($bot, new DiscoveryCursor(5, 2));
check($batch->errorCode === 'http.timeout', 'a transport failure keeps its code');

// ---------- send: payload shape ----------

$http = new ScriptedMaxHttp();
$http->queue('send_ok');
$result = $api($http)->sendMessage($bot, $group, '<b>Текст</b>', [['text' => 'Открыть', 'url' => 'https://pbx.local/cdr']]);
check($result->outcome === SendResult::SENT, 'sendMessage ok -> sent');
check($result->ids === ['mid.0000000000000000000000000000001'], 'message id collected');
check(str_contains($http->calls[0]['url'], 'chat_id=-70000000000001'), 'a group is addressed by chat_id');
check($http->calls[0]['payload']['format'] === 'html', 'MAX gets format: html');
check($http->calls[0]['payload']['attachments'][0]['type'] === 'inline_keyboard', 'button goes as inline_keyboard');
check(
    $http->calls[0]['payload']['attachments'][0]['payload']['buttons'][0][0]
        === ['type' => 'link', 'text' => 'Открыть', 'url' => 'https://pbx.local/cdr'],
    'button is a link button with one button per row'
);

$http = new ScriptedMaxHttp();
$http->queue('send_ok');
$api($http)->sendMessage($bot, $dialog, 'hi');
check(str_contains($http->calls[0]['url'], 'user_id=777888999'), 'a private dialog is addressed by user_id');
check(!str_contains($http->calls[0]['url'], 'chat_id='), 'a dialog does not send chat_id');

$http = new ScriptedMaxHttp();
$http->queue('send_ok_no_mid');
$result = $api($http)->sendMessage($bot, $group, 'hi');
check($result->outcome === SendResult::SENT && $result->ids === [], 'a 200 without a mid still counts as delivered');

// ---------- send: classification ----------

$http = new ScriptedMaxHttp();
$http->queueRetryAfter('error_429', 429, 17);
$result = $api($http)->sendMessage($bot, $group, 'hi');
check($result->outcome === SendResult::RETRY, '429 -> retry');
check($result->retryAfterSec === 17, 'Retry-After header honoured');
check($result->code === 'max.429.rate_limit', '429 code normalised');

$http = new ScriptedMaxHttp();
$http->queue('error_429', 429);
$result = $api($http)->sendMessage($bot, $group, 'hi');
check($result->retryAfterSec === 30, '429 without Retry-After waits the default');

$http = new ScriptedMaxHttp();
$http->queue('error_401', 401);
$result = $api($http)->sendMessage($bot, $group, 'hi');
check($result->outcome === SendResult::PERMANENT && $result->code === 'max.401.unauthorized', '401 -> permanent');

$http = new ScriptedMaxHttp();
$http->queue('error_403_chat_denied', 403);
$result = $api($http)->sendMessage($bot, $group, 'hi');
check($result->outcome === SendResult::RECIPIENT_GONE, 'chat.denied -> recipient_gone (bot suspended or removed)');
check($result->code === 'max.403.chat_denied', 'chat.denied code');

$http = new ScriptedMaxHttp();
$http->queue('error_404_not_found', 404);
$result = $api($http)->sendMessage($bot, $group, 'hi');
check($result->outcome === SendResult::RECIPIENT_GONE && $result->code === 'max.404.not_found', '404 -> recipient_gone');

// live behaviour: a bot removed from the chat makes POST /messages answer 404 {"code":"error.not.found"}
$http = new ScriptedMaxHttp();
$http->queue('error_404_error_not_found', 404);
$result = $api($http)->sendMessage($bot, $group, 'hi');
check($result->outcome === SendResult::RECIPIENT_GONE, 'error.not.found after the bot left the chat -> recipient_gone');
check($result->code === 'max.404.not_found', 'the removed-bot code is normalised');

$http = new ScriptedMaxHttp();
$http->queue('malformed', 404, true);
$result = $api($http)->sendMessage($bot, $group, 'hi');
check($result->outcome === SendResult::PERMANENT, 'a bare 404 (HTML body, no code) is not a gone recipient');
check($result->code === 'max.404.unknown', 'a bare 404 carries its own code');

// live MAX: an over-long text is rejected with HTTP 400 and "Field 'text' size (N) must be at most 4000",
// i.e. the limit counts the raw text string including markup (checked 21.11.2026)
$http = new ScriptedMaxHttp();
$http->queue('error_400_text_too_long', 400);
$result = $api($http)->sendMessage($bot, $group, str_repeat('X', 4010));
check($result->outcome === SendResult::PERMANENT, 'an over-long text is a permanent error');
check($result->code === 'max.400.proto_payload', 'the over-limit code is normalised');

$http = new ScriptedMaxHttp();
$http->queue('error_500', 500);
$result = $api($http)->sendMessage($bot, $group, 'hi');
check($result->outcome === SendResult::RETRY && $result->retryAfterSec === 30, '5xx -> retry with backoff');

$http = new ScriptedMaxHttp();
$http->queueTransportError('http.timeout');
$result = $api($http)->sendMessage($bot, $group, 'hi');
check($result->outcome === SendResult::RETRY && $result->uncertain, 'timeout -> uncertain retry');
check($result->code === 'http.timeout', 'transport code kept');

$http = new ScriptedMaxHttp();
$http->queueTransportError('http.tls');
$result = $api($http)->sendMessage($bot, $group, 'hi');
check($result->outcome === SendResult::PERMANENT, 'a TLS failure is never retried forever');
check($result->code === 'max.tls.untrusted_ca', 'a TLS failure carries the actionable CA code');

$http = new ScriptedMaxHttp();
$http->queue('error_200_attachment_not_ready');
$result = $api($http)->sendMessage($bot, $group, 'hi');
check($result->outcome === SendResult::RETRY, 'HTTP 200 + success:false works as an error path');
check($result->code === 'max.attachment.not_ready', 'attachment.not.ready is a retry (stage 3a hook)');

$http = new ScriptedMaxHttp();
$http->queue('error_200_proto_payload');
$result = $api($http)->sendMessage($bot, $group, 'hi');
check($result->outcome === SendResult::PERMANENT, 'an unknown 200 + success:false is permanent, never retried');
check($result->code === 'max.200.proto_payload', 'the API code becomes the reason, not the message text');

$http = new ScriptedMaxHttp();
$http->queue('error_200_no_code');
$result = $api($http)->sendMessage($bot, $group, 'hi');
check($result->outcome === SendResult::PERMANENT && $result->code === 'max.200.error', 'a code-less failure is permanent');

$http = new ScriptedMaxHttp();
$http->queue('malformed', 200, true);
$result = $api($http)->sendMessage($bot, $group, 'hi');
check($result->outcome === SendResult::RETRY && $result->uncertain, 'an unreadable 200 body is an unknown outcome');
check($result->code === 'max.200.malformed', 'malformed body code');

// ---------- delete ----------

$http = new ScriptedMaxHttp();
$http->queue('delete_ok');
$result = $api($http)->deleteMessage($bot, 'mid.1');
check($result->outcome === SendResult::SENT, 'delete ok');
check($http->calls[0]['method'] === 'delete', 'DELETE /messages is used');
check(str_contains($http->calls[0]['url'], 'message_id=mid.1'), 'message id passed as a query parameter');

$http = new ScriptedMaxHttp();
$http->queue('delete_not_found');
$result = $api($http)->deleteMessage($bot, 'mid.1');
check($result->outcome === SendResult::SENT, 'deleting a missing message counts as deleted');

$http = new ScriptedMaxHttp();
$http->queue('error_404_not_found', 404);
$result = $api($http)->deleteMessage($bot, 'mid.1');
check($result->outcome === SendResult::SENT, 'a 404 on delete also counts as deleted (idempotent retract)');

$http = new ScriptedMaxHttp();
$http->queue('error_401', 401);
$result = $api($http)->deleteMessage($bot, 'mid.1');
check($result->outcome === SendResult::PERMANENT && $result->code === 'max.401.unauthorized', 'a rejected delete ends the retraction');

$http = new ScriptedMaxHttp();
$result = (new MaxChannel($api($http)))->delete($bot, $group, '');
check($result->outcome === SendResult::SENT && $http->calls === [], 'nothing to delete is a success');

// ---------- uploads hook (stage 3a) ----------

$http = new ScriptedMaxHttp();
$http->queue('uploads_ok');
$upload = $api($http)->requestUpload($bot, 'audio');
check($upload === ['url' => 'https://uploads.max.ru/api/upload/anonymised', 'token' => 'attachment.token.anonymised'], 'POST /uploads returns url and token');
check(str_contains($http->calls[0]['url'], 'type=audio'), 'upload type is passed');

$http = new ScriptedMaxHttp();
$http->queue('uploads_foreign');
check($api($http)->requestUpload($bot, 'audio') === null, 'a foreign upload host is rejected (fail closed)');

// ---------- audio attachment (stage 3a) ----------

$http = new ScriptedMaxHttp();
$http->queue('uploads_ok')->queue('uploads_ok')->queue('send_ok');
$result = $api($http)->sendAudio($bot, $group, '/module/tmp/a.mp3', 'A &lt; B');
check($result->result->outcome === SendResult::SENT, 'attachment: MAX audio sent');
check($result->pendingToken === '' && !$result->notReady, 'attachment: a normal send has no pending token');
check(count($http->calls) === 3 && $http->calls[0]['method'] === 'post' && $http->calls[1]['method'] === 'multipart', 'attachment: upload request, file, message');
check($http->calls[2]['payload']['attachments'][0]['payload']['token'] === 'attachment.token.anonymised', 'attachment: the message carries the upload token');
check($http->calls[2]['payload']['text'] === 'A &lt; B', 'attachment: the caption is already channel markup');

$http = new ScriptedMaxHttp();
$http->queue('send_ok');
$result = $api($http)->sendAudio($bot, $group, '/module/tmp/a.mp3', '', 'tok-reuse');
check($result->result->outcome === SendResult::SENT, 'attachment: a token retry sends the message');
check(count($http->calls) === 1 && $http->calls[0]['method'] === 'post', 'attachment: a token retry never re-uploads');
check($http->calls[0]['payload']['attachments'][0]['payload']['token'] === 'tok-reuse', 'attachment: the same token is reused');

$http = new ScriptedMaxHttp();
$http->queue('uploads_ok')->queue('uploads_ok')->queue('error_200_attachment_not_ready');
$result = $api($http)->sendAudio($bot, $group, '/module/tmp/a.mp3', '');
check($result->notReady && $result->pendingToken === 'attachment.token.anonymised', 'attachment.not.ready returns the upload token');
check($result->result->outcome === SendResult::RETRY && $result->result->code === 'max.attachment.not_ready', 'attachment.not.ready is a retry');

$http = new ScriptedMaxHttp();
$http->queue('uploads_ok')->queue('uploads_ok')->queue('send_ok');
$channel = new MaxChannel($api($http));
$result = $channel->sendAttachment($bot, $group, new AttachmentPart('/module/tmp/a.mp3', 'A < B & C'));
check($result->result->outcome === SendResult::SENT, 'max channel: attachment sent');
check($http->calls[2]['payload']['text'] === 'A &lt; B &amp; C', 'max channel: the caption is escaped once');
check($channel->limits()->maxFileDurationSec === 3600, 'max channel: the 60-minute limit is declared');

// ---------- HTML rendering ----------

$limits = ChannelLimits::max();
$markup = new MaxMarkup($limits);
$rendered = $markup->render(new RenderedMessage(
    title: '⚠️ <b>Внимание</b> & "кавычки"',
    lines: ['a<b>c'],
    notes: ['x & y'],
    quotes: [['time' => '02:14', 'text' => 'цитата <i>']],
    footer: 'call-1',
    buttons: [['text' => 'Открыть', 'url' => 'https://pbx.local/cdr']]
));
check(str_contains($rendered['text'], '&lt;b&gt;Внимание&lt;/b&gt; &amp; &quot;кавычки&quot;'), 'data is escaped');
check(!str_contains($rendered['text'], '<b>Внимание</b>'), 'no raw markup from data');
check(str_contains($rendered['text'], '<b>⚠️ &lt;b&gt;Внимание&lt;/b&gt;'), 'the title is bold and its data escaped');
check(str_contains($rendered['text'], '<blockquote><code>02:14</code> «цитата &lt;i&gt;»</blockquote>'), 'quote block with timecode');
check(str_contains($rendered['text'], '<code>call-1</code>'), 'call id in monospace');
check($rendered['buttons'] === [['text' => 'Открыть', 'url' => 'https://pbx.local/cdr']], 'https button kept');

$rendered = $markup->render(new RenderedMessage(
    title: 'T',
    buttons: [['text' => 'bad', 'url' => 'javascript:alert(1)'], ['text' => 'ftp', 'url' => 'ftp://x']]
));
check($rendered['buttons'] === [], 'non-http buttons are dropped');

$rendered = $markup->render(new RenderedMessage(
    title: 'T',
    buttons: [
        ['text' => str_repeat('к', 200), 'url' => 'https://pbx.local/' . str_repeat('a', 2100)],
        ['text' => 'ok', 'url' => 'https://pbx.local/cdr'],
    ]
));
check(count($rendered['buttons']) === 1, 'an over-long URL is dropped');
check(mb_strlen($rendered['buttons'][0]['text']) <= 128, 'button text limited to 128');

$rendered = $markup->render(new RenderedMessage(title: 'T', buttons: [['text' => str_repeat('к', 200), 'url' => 'https://pbx.local/cdr']]));
check(mb_strlen($rendered['buttons'][0]['text']) === 128, 'a long button text is shortened to 128');

$long = str_repeat('Очень длинный текст. ', 400);
$rendered = $markup->render(new RenderedMessage(
    title: 'Заголовок',
    lines: ['короткая строка'],
    notes: [$long],
    footer: 'mikopbx-1790944900.650',
    buttons: [['text' => 'Открыть звонок', 'url' => 'https://pbx.local/cdr']]
));
check(mb_strlen($rendered['text']) <= $limits->maxTextLength, 'text truncated under the MAX limit');
check(str_contains($rendered['text'], '…'), 'the longest paragraph is shortened with an ellipsis');
check(str_contains($rendered['text'], 'mikopbx-1790944900.650'), 'call id kept when truncating');
check(count($rendered['buttons']) === 1, 'button kept when truncating');

$rendered = $markup->render(new RenderedMessage(
    title: str_repeat('Заголовок ', 700),
    footer: 'mikopbx-1790944900.650',
    buttons: [['text' => 'Открыть звонок', 'url' => 'https://pbx.local/cdr']]
));
check(mb_strlen($rendered['text']) <= $limits->maxTextLength, 'an over-long title alone is truncated too');
check(str_contains($rendered['text'], 'mikopbx-1790944900.650'), 'the id survives an over-long title');
check(count($rendered['buttons']) === 1, 'the button survives an over-long title');

// ---------- markup: the limit is the rendered text, tags included ----------

$quote = str_repeat('Цитата с амперсандом & и <тегами> ', 120);
$rendered = $markup->render(new RenderedMessage(
    title: 'Пропущенный & звонок',
    lines: ['+7 968 ***-**-44 -> Иванов И. (233)'],
    notes: [str_repeat('Сводка & детали. ', 60)],
    quotes: [
        ['time' => '00:12', 'text' => $quote],
        ['time' => '01:30', 'text' => $quote],
        ['time' => '02:45', 'text' => $quote],
    ],
    footer: 'mikopbx-1790944900.650',
    buttons: [['text' => 'Открыть звонок', 'url' => 'https://pbx.local/cdr']]
));
check(mb_strlen($rendered['text']) <= $limits->maxTextLength, 'three long quotes with & stay under 4000 with their markup');
check(str_contains($rendered['text'], 'mikopbx-1790944900.650'), 'the id survives the quote trimming');
check(count($rendered['buttons']) === 1, 'the button survives the quote trimming');

// ---------- adapter ----------

// the 30 rps cap belongs to platform-api2.max.ru, so two MAX bots share one bucket
$limiter = new RateLimiter();
$maxLimits = ChannelLimits::max();
for ($i = 0; $i < 30; $i++) {
    check($limiter->reserve(1, 'chat-' . $i, 'private', 5000, $maxLimits, 'max') === 0, 'bot 1 fits in the 30 rps window, #' . $i);
}
check($limiter->reserve(2, 'other-chat', 'private', 5000, $maxLimits, 'max') === 1, 'a second MAX bot shares the platform cap');
$telegramLimiter = new RateLimiter();
for ($i = 0; $i < 30; $i++) {
    $telegramLimiter->reserve(1, 'chat-' . $i, 'private', 7000, ChannelLimits::telegram(), 'telegram');
}
check($telegramLimiter->reserve(2, 'other-chat', 'private', 7000, ChannelLimits::telegram(), 'telegram') === 0, 'Telegram bots keep their own per-bot window');

$http = new ScriptedMaxHttp();
$http->queue('send_ok');
$channel = new MaxChannel($api($http));
$result = $channel->send($bot, $group, new RenderedMessage(title: 'Заголовок', lines: ['строка']));
check($result->outcome === SendResult::SENT, 'channel sends the rendered text');
check($channel->limits()->maxTextLength === 4000, 'MAX text limit exposed');
check($channel->limits()->perBotPerSec === 30, 'MAX shared host limit exposed');
check($channel->limits()->perChatSec === 1, 'per-chat limit is at most 2/s');
check($channel->id() === 'max', 'channel id');

// ---------- CA bundle: only MAX, pinned, verified ----------

$dir = sys_get_temp_dir() . '/mh-max-ca-' . bin2hex(random_bytes(6));
@mkdir($dir, 0700, true);
register_shutdown_function(static function () use ($dir): void {
    foreach (glob($dir . '/*') ?: [] as $file) {
        @unlink($file);
    }
    @rmdir($dir);
});
$settings = new HubSettings(hubTestDatabase());

check(MaxCaBundle::verify(MaxCaBundle::SHIPPED), 'the shipped НУЦ Минцифры bundle matches the pinned fingerprints');
$bundle = MaxCaBundle::resolve($settings);
check($bundle !== '' && is_file($bundle), 'a CA bundle is built');
$content = (string)file_get_contents($bundle);
check(str_contains($content, 'BEGIN CERTIFICATE'), 'the bundle holds PEM certificates');
// the shipped block must be inside the built bundle: the root is the only pinned anchor
preg_match_all('/-----BEGIN CERTIFICATE-----.+?-----END CERTIFICATE-----/s', $content, $blocks);
$fingerprints = array_map(MaxCaBundle::fingerprint(...), $blocks[0] ?? []);
preg_match('/-----BEGIN CERTIFICATE-----.+?-----END CERTIFICATE-----/s', (string)file_get_contents(MaxCaBundle::SHIPPED), $shippedBlock);
check(in_array(MaxCaBundle::fingerprint($shippedBlock[0] ?? ''), $fingerprints, true), 'the bundle carries the pinned Root CA');
check(MaxCaBundle::verify(MaxCaBundle::SHIPPED), 'verification is repeatable');

// a shipped file with one extra (foreign) certificate must not be trusted at all
$extra = $dir . '/extra-cert.pem';
$foreign = "-----BEGIN CERTIFICATE-----\n" . base64_encode(random_bytes(64)) . "\n-----END CERTIFICATE-----\n";
file_put_contents($extra, (string)file_get_contents(MaxCaBundle::SHIPPED) . $foreign);
check(!MaxCaBundle::verify($extra), 'a shipped file with an extra certificate is rejected');

$tampered = $dir . '/tampered.pem';
$original = (string)file_get_contents(MaxCaBundle::SHIPPED);
$pos = (int)strpos($original, "\n", (int)strpos($original, 'BEGIN CERTIFICATE')) + 10;
file_put_contents($tampered, substr_replace($original, substr($original, $pos, 1) === 'A' ? 'B' : 'A', $pos, 1));
check(!MaxCaBundle::verify($tampered), 'a modified certificate is rejected');
check(!MaxCaBundle::verify($dir . '/missing.pem'), 'a missing file is not trusted');

$own = $dir . '/own-ca.pem';
file_put_contents($own, (string)file_get_contents(MaxCaBundle::SHIPPED));
$override = new HubSettings(hubTestDatabase());
$override->set(HubSettings::MAX_CA_BUNDLE_PATH, $own);
check(MaxCaBundle::resolve($override) === $own, 'max_ca_bundle_path overrides the shipped file');
$notACert = $dir . '/not-a-cert.pem';
file_put_contents($notACert, "not a certificate\n");
check(!MaxCaBundle::hasCertificate($notACert), 'an override without a certificate is rejected');
check(MaxCaBundle::hasCertificate($own), 'a certificate file is accepted as an override');
$override->set(HubSettings::MAX_CA_BUNDLE_PATH, $dir . '/absent.pem');
check(MaxCaBundle::resolve($override) !== $dir . '/absent.pem', 'an unreadable override falls back to the verified bundle');

$telegramTransport = ChannelFactory::transportFor('telegram', $settings);
$maxTransport = ChannelFactory::transportFor('max', $settings);
check($telegramTransport->caBundlePath() === '', 'Telegram keeps the system trust store');
check($maxTransport->caBundlePath() !== '' && is_file($maxTransport->caBundlePath()), 'only the MAX transport gets the bundle');
check(ChannelFactory::create($settings)->find('max') !== null, 'the factory registers the MAX channel');
check(ChannelFactory::create($settings)->find('telegram') !== null, 'the factory registers the Telegram channel');

@unlink($tampered);
@unlink($own);
@rmdir($dir);

// ---------- secrets never leak ----------

$http = new ScriptedMaxHttp();
$http->queue('error_401', 401);
$result = $api($http)->sendMessage($bot, $group, 'hi');
$serialised = json_encode($result) . '|' . $result->code;
check(!str_contains($serialised, TOKEN), 'SendResult carries no token');
check(!str_contains($result->code, 'max_fake'), 'codes carry no token parts');
check(!str_contains($http->calls[0]['url'], TOKEN), 'the URL carries no token');
check(in_array('Authorization: ' . TOKEN, $http->calls[0]['headers'], true), 'the token is only in the Authorization header');
check(isset($bot->__debugInfo()['token']) && $bot->__debugInfo()['token'] === '***', 'credentials debug output masks the token');
check(!str_contains(HubLogger::sanitize('token ' . TOKEN), TOKEN), 'logger masks a MAX token');
check(str_contains(HubLogger::sanitize('token ' . TOKEN), '***'), 'logger replaces it with ***');

$sources = [
    __DIR__ . '/../Lib/Channels/Max/MaxApi.php',
    __DIR__ . '/../Lib/Channels/Max/MaxChannel.php',
    __DIR__ . '/../Lib/Channels/Max/MaxMarkup.php',
    __DIR__ . '/../Lib/Channels/HttpTransport.php',
];
foreach ($sources as $file) {
    $code = (string)file_get_contents($file);
    check(preg_match('/(?<![A-Za-z0-9_\\\\])error_log\s*\(/', $code) !== 1, basename($file) . ' writes no ad-hoc log line');
    check(!str_contains($code, 'sysLogMsg'), basename($file) . ' never logs through Core directly');
    check(preg_match('/(?<![A-Za-z0-9_\\\\])var_dump\s*\(/', $code) !== 1, basename($file) . ' dumps nothing');
    check(preg_match('/(?<![A-Za-z0-9_\\\\])print_r\s*\(/', $code) !== 1, basename($file) . ' prints nothing');
    check(preg_match('/CURLOPT_SSL_VERIFYPEER\s*=>\s*false/i', $code) !== 1, basename($file) . ' never disables TLS verification');
}

finish('max channel OK');
