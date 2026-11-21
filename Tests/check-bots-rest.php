<?php

declare(strict_types=1);

// Bots REST resource (Plan/06, stage 2b): token write-only, validation, nested chats via PATCH,
// discovery sessions in a worker, sendTest through the Outbox, deletion. The channel is faked.

namespace MikoPBX\PBXCoreREST\Lib {

    class PBXApiResult
    {
        public bool $success = false;
        public array $data = [];
        public array $messages = [];
        public ?int $httpCode = null;
        public string $processor = '';
        public string $function = '';
    }
}

namespace {

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Bots\BotRepository;
use Modules\ModuleMessengerHub\Lib\Bots\DiscoveryService;
use Modules\ModuleMessengerHub\Lib\Channels\BotCredentials;
use Modules\ModuleMessengerHub\Lib\Channels\BotIdentity;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelInterface;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelLimits;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelRegistry;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryBatch;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryCursor;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveredChat;
use Modules\ModuleMessengerHub\Lib\Channels\Recipient;
use Modules\ModuleMessengerHub\Lib\Channels\SendResult;
use Modules\ModuleMessengerHub\Lib\Delivery\DeliveryWaker;
use Modules\ModuleMessengerHub\Lib\RestAPI\Bots\Processor;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

final class FakeTelegram implements ChannelInterface
{
    public BotIdentity $identity;

    /** @var list<DiscoveryBatch> */
    public array $batches = [];

    public function __construct(private readonly string $channelId = 'telegram')
    {
        $this->identity = BotIdentity::ok('miko_bot', '100', 'MIKO');
    }

    public function id(): string
    {
        return $this->channelId;
    }

    public function checkToken(BotCredentials $bot): BotIdentity
    {
        return $this->identity;
    }

    public function discoverChats(BotCredentials $bot, DiscoveryCursor $cursor): DiscoveryBatch
    {
        return array_shift($this->batches) ?? new DiscoveryBatch([], $cursor->offset);
    }

    public function send(BotCredentials $bot, Recipient $to, RenderedMessage $message): SendResult
    {
        return SendResult::sent(['1']);
    }

    public function sendAttachment(BotCredentials $bot, Recipient $to, \Modules\ModuleMessengerHub\Lib\Channels\AttachmentPart $part): \Modules\ModuleMessengerHub\Lib\Channels\AttachmentResult
    {
        return \Modules\ModuleMessengerHub\Lib\Channels\AttachmentResult::of(SendResult::sent(['a1']));
    }

    public function delete(BotCredentials $bot, Recipient $to, string $externalMessageId): SendResult
    {
        return SendResult::sent();
    }

    public function limits(): ChannelLimits
    {
        return $this->channelId === 'max' ? ChannelLimits::max() : ChannelLimits::telegram();
    }
}

final class SpyWaker implements DeliveryWaker
{
    public int $calls = 0;

    public function wake(): void
    {
        $this->calls++;
    }
}

/** @param FakeTelegram|list<FakeTelegram> $channels */
function botsProcessor(HubDatabase $db, FakeTelegram|array $channels, SpyWaker $waker): Processor
{
    return new Processor(
        $db,
        new ChannelRegistry(is_array($channels) ? $channels : [$channels]),
        $waker,
        hubTestTexts()
    );
}

function dataOf(\MikoPBX\PBXCoreREST\Lib\PBXApiResult $result): array
{
    return is_array($result->data) ? $result->data : [];
}

/** No `token` key anywhere in a response (only token_hint is allowed). */
function assertNoToken(mixed $value, string $where): void
{
    if (!is_array($value)) {
        return;
    }
    foreach ($value as $key => $item) {
        check($key !== 'token', 'response has no token key (' . $where . ')');
        assertNoToken($item, $where);
    }
}

/** The machine code of a failed request: Responder keeps it in messages.error[0]. */
function errorCodeOf(\MikoPBX\PBXCoreREST\Lib\PBXApiResult $result): string
{
    $messages = $result->messages['error'] ?? [];

    return (string)($messages[0] ?? '');
}

/** Both the payload and the error messages of a PBXApiResult. */
function assertNoTokenEverywhere(\MikoPBX\PBXCoreREST\Lib\PBXApiResult $result, string $where): void
{
    assertNoToken($result->data, $where . ' data');
    assertNoToken($result->messages, $where . ' messages');
}

const VALID_TOKEN = '123456789:AAHvalidTokenForContractTests12345';
const VALID_MAX_TOKEN = 'max_test_bot_token_0123456789abcdef';

$db = hubTestDatabase();
$channel = new FakeTelegram();
$maxChannel = new FakeTelegram('max');
$maxChannel->identity = BotIdentity::ok('miko_max_bot', '900', 'MIKO MAX');
$waker = new SpyWaker();
$processor = botsProcessor($db, [$channel, $maxChannel], $waker);

// ---------- defaults ----------

$result = $processor->process(['action' => 'getDefault']);
$defaults = dataOf($result);
check($result->success, 'getDefault succeeds');
check($defaults['channel'] === 'telegram', 'default channel is Telegram');
check(isset($defaults['discovery']) && $defaults['discovery']['active'] === false, 'default has an idle discovery');

// ---------- create ----------

$result = $processor->process(['action' => 'create', 'data' => [
    'channel' => 'telegram',
    'title' => 'Оповещения MIKO',
    'token' => VALID_TOKEN,
]]);
$bot = dataOf($result);
check($result->success && $result->httpCode === 201, 'create succeeds with 201');
check($bot['status'] === 'ok' && $bot['bot_username'] === 'miko_bot', 'token checked at create');
check($bot['token_hint'] === '2345', 'token hint is the last four characters');
check(!array_key_exists('token', $bot), 'create response has no token');
assertNoToken($result->data, 'create');
$botId = (int)$bot['id'];
check($botId > 0, 'bot id returned');

$result = $processor->process(['action' => 'create', 'data' => [
    'channel' => 'telegram', 'title' => 'Bad', 'token' => 'not-a-token',
]]);
check(!$result->success && $result->httpCode === 422 && dataOf($result)['field'] === 'token', 'invalid token format rejected');
assertNoTokenEverywhere($result, 'rejected token');
$result = $processor->process(['action' => 'create', 'data' => ['channel' => 'unknown', 'title' => 'X', 'token' => VALID_TOKEN]]);
check(!$result->success && errorCodeOf($result) === 'unknown_channel', 'an unknown channel is rejected');
$result = $processor->process(['action' => 'create', 'data' => ['title' => 'X', 'token' => VALID_TOKEN]]);
check(!$result->success && errorCodeOf($result) === 'channel_required', 'channel is required on create');

$result = $processor->process(['action' => 'create', 'data' => [
    'channel' => 'telegram', 'title' => '', 'token' => VALID_TOKEN,
]]);
check(!$result->success && dataOf($result)['field'] === 'title', 'empty title rejected');

$channel->identity = BotIdentity::failed('telegram.401.unauthorized');
$result = $processor->process(['action' => 'create', 'data' => [
    'channel' => 'telegram', 'title' => 'Bad token', 'token' => VALID_TOKEN,
]]);
$badBot = dataOf($result);
check($result->success, 'a rejected token still saves the bot (like the MAX design flow)');
check($badBot['status'] === 'token_invalid' && $badBot['last_error_code'] === 'telegram.401.unauthorized', 'rejected token is stored as a status');
$badBotId = (int)$badBot['id'];
$channel->identity = BotIdentity::ok('miko_bot', '100', 'MIKO');

// ---------- MAX: the same endpoints, the same write-only token ----------

$maxChannel->batches = [new DiscoveryBatch([
    new DiscoveredChat('-70000000000001', 'group', 'Дежурная смена'),
    new DiscoveredChat('777888999', 'private', 'Пётр Сидоров'),
], 98765432)];
$result = $processor->process(['action' => 'create', 'data' => [
    'channel' => 'max', 'title' => 'MAX — дежурная смена', 'token' => VALID_MAX_TOKEN,
]]);
$maxBot = dataOf($result);
check($result->success && $result->httpCode === 201, 'a MAX bot is created');
check($maxBot['channel'] === 'max', 'channel max stored');
check($maxBot['status'] === 'ok' && $maxBot['bot_username'] === 'miko_max_bot', 'MAX token checked through the adapter');
check($maxBot['token_hint'] === 'cdef', 'MAX token hint is the last four characters');
check(!array_key_exists('token', $maxBot), 'MAX create response has no token');
assertNoToken($result->data, 'max create');
$maxBotId = (int)$maxBot['id'];

$result = $processor->process(['action' => 'getRecord', 'data' => ['id' => $maxBotId]]);
check($result->success && dataOf($result)['token_hint'] === 'cdef', 'MAX record carries only the hint');
assertNoToken($result->data, 'max record');

$result = $processor->process(['action' => 'getList']);
$listed = dataOf($result)['items'];
$maxListed = null;
foreach ($listed as $item) {
    if ($item['id'] === $maxBotId) {
        $maxListed = $item;
    }
}
check($maxListed !== null && $maxListed['channel'] === 'max', 'MAX bot appears in the list');
assertNoToken($result->data, 'max list');

$result = $processor->process(['action' => 'checkToken', 'data' => ['id' => $maxBotId]]);
check($result->success && dataOf($result)['ok'] === true, 'MAX stored token is checked');
check(!array_key_exists('token', dataOf($result)), 'MAX checkToken response has no token');

$maxChannel->identity = BotIdentity::ok('miko_max_new', '901', 'MIKO MAX NEW');
$result = $processor->process(['action' => 'checkToken', 'data' => [
    'channel' => 'max', 'token' => VALID_MAX_TOKEN,
]]);
check($result->success && dataOf($result)['ok'] === true, 'MAX candidate token is checked without saving');
check(dataOf($result)['username'] === 'miko_max_new', 'the candidate identity is returned');
assertNoToken($result->data, 'max candidate check');
$maxChannel->identity = BotIdentity::ok('miko_max_bot', '900', 'MIKO MAX');

$maxChannel->identity = BotIdentity::failed('max.401.unauthorized');
$result = $processor->process(['action' => 'checkToken', 'data' => ['id' => $maxBotId]]);
check($result->success && dataOf($result)['status'] === 'token_invalid', 'a rejected MAX token is reported');
$result = $processor->process(['action' => 'getRecord', 'data' => ['id' => $maxBotId]]);
check(dataOf($result)['status'] === 'token_invalid', 'a rejected MAX token marks the bot');
$maxChannel->identity = BotIdentity::ok('miko_max_bot', '900', 'MIKO MAX');
$result = $processor->process(['action' => 'checkToken', 'data' => ['id' => $maxBotId]]);
check($result->success && dataOf($result)['username'] === 'miko_max_bot', 'a good MAX token recovers the bot');

$maxChannel->identity = BotIdentity::failed('max.tls.untrusted_ca');
$result = $processor->process(['action' => 'checkToken', 'data' => ['id' => $maxBotId]]);
check(dataOf($result)['status'] === 'ca_error', 'a TLS trust failure is its own bot state');
check(dataOf($result)['error_code'] === 'max.tls.untrusted_ca', 'the ca_error keeps the actionable code');
$maxChannel->identity = BotIdentity::ok('miko_max_bot', '900', 'MIKO MAX');
$processor->process(['action' => 'checkToken', 'data' => ['id' => $maxBotId]]);

$result = $processor->process(['action' => 'discoverChats', 'data' => ['id' => $maxBotId]]);
check($result->success && dataOf($result)['discovery']['active'] === true, 'MAX discovery session starts');
$maxService = new DiscoveryService(new BotRepository($db), new ChannelRegistry([$maxChannel]));
$stats = $maxService->runOnce(time());
check($stats['polled'] === 1 && $stats['found'] === 2, 'the MAX worker records both found chats');
$result = $processor->process(['action' => 'getRecord', 'data' => ['id' => $maxBotId]]);
$maxBot = dataOf($result);
check($maxBot['discovery']['status'] === 'found', 'MAX session reports found');
check($maxBot['chats'][0]['title'] === 'Дежурная смена', 'MAX group title kept');
check($maxBot['chats'][1]['chat_kind'] === 'private', 'MAX dialog kind kept');

$result = $processor->process(['action' => 'discoverChats', 'data' => ['id' => $maxBotId, 'stop' => true]]);
check(dataOf($result)['discovery']['active'] === false, 'MAX discovery stops');

$db->execute('UPDATE ' . BotRepository::CHATS . " SET enabled = '1' WHERE bot_id = :bot", ['bot' => $maxBotId]);
$result = $processor->process(['action' => 'patch', 'data' => [
    'id' => $maxBotId,
    'chats' => [['chat_id' => '-70000000000001', 'title' => 'MAX группа', 'enabled' => true]],
]]);
check($result->success && dataOf($result)['chats'][0]['title'] === 'MAX группа', 'a MAX chat is renamed through PATCH');
$result = $processor->process(['action' => 'patch', 'data' => [
    'id' => $maxBotId,
    'chats' => [['chat_id' => '-1009999999999', 'chat_kind' => 'group']],
]]);
check($result->success && count(dataOf($result)['chats']) === 3, 'a MAX chat is added by chat_id through PATCH');
$result = $processor->process(['action' => 'patch', 'data' => ['id' => $maxBotId, 'chats' => [['id' => 999999]]]]);
check(!$result->success && errorCodeOf($result) === 'unknown_chat', 'an unknown MAX chat row is rejected');

$result = $processor->process(['action' => 'update', 'data' => ['id' => $maxBotId, 'title' => 'MAX (PUT)']]);
check(!$result->success && $result->httpCode === 422, 'MAX PUT still requires every field');

$result = $processor->process(['action' => 'sendTest', 'data' => ['id' => $maxBotId]]);
$test = dataOf($result);
check($result->success && count($test['chat_ids']) === 3, 'sendTest queues every MAX chat, including the added one');
check($waker->calls === 1, 'the MAX test wakes the delivery worker');
$rows = $db->fetchAll('SELECT * FROM ' . BotRepository::OUTBOX . ' WHERE bot_id = :bot', ['bot' => $maxBotId]);
check(count($rows) === 3 && $rows[0]['status'] === 'pending', 'MAX test deliveries are pending');
assertNoToken($result->data, 'max sendTest');

$result = $processor->process(['action' => 'patch', 'data' => [
    'id' => $maxBotId, 'token' => 'max_rotated_bot_token_9876543210zyxw',
]]);
check($result->success && dataOf($result)['token_hint'] === 'zyxw', 'a MAX token can be rotated');
check(dataOf($result)['status'] === 'ok', 'a rotated MAX token is checked at once');
assertNoToken($result->data, 'max patch');

$result = $processor->process(['action' => 'create', 'data' => [
    'channel' => 'max', 'title' => 'Bad MAX', 'token' => 'has space and stuff',
]]);
check(!$result->success && dataOf($result)['field'] === 'token', 'a malformed MAX token is rejected');

// a body `channel` must never redirect a stored token to the other messenger
$result = $processor->process(['action' => 'checkToken', 'data' => ['id' => $maxBotId, 'channel' => 'telegram']]);
check(!$result->success && $result->httpCode === 422 && dataOf($result)['field'] === 'channel',
    'a foreign channel in checkToken is rejected');
$result = $processor->process(['action' => 'patch', 'data' => ['id' => $maxBotId, 'channel' => 'telegram']]);
check(!$result->success && errorCodeOf($result) === 'channel_immutable', 'the channel of a saved bot is immutable');

// a MAX token is printable ASCII only (it goes into a header value)
foreach (['max токен 0123456789', 'max"token0123456789', "max\ttoken0123456789"] as $badToken) {
    $result = $processor->process(['action' => 'create', 'data' => [
        'channel' => 'max', 'title' => 'Bad MAX', 'token' => $badToken,
    ]]);
    check(!$result->success && dataOf($result)['field'] === 'token', 'a non-ASCII or quoted MAX token is rejected');
}

// a title set by the admin survives the next discovery pass (it replays bot_added from offset 0)
$db->execute(
    'UPDATE ' . BotRepository::CHATS . " SET title = 'Дежурная смена (админ)', chat_kind = 'channel' WHERE bot_id = :bot",
    ['bot' => $maxBotId]
);
$maxChannel->batches = [new DiscoveryBatch([new DiscoveredChat('-70000000000001', 'group', 'Renamed in MAX')], 98765433)];
$maxService = new DiscoveryService(new BotRepository($db), new ChannelRegistry([$maxChannel]));
$maxService->start($maxBotId, time());
$maxService->runOnce(time());
$titleRow = $db->fetchOne(
    'SELECT title, chat_kind FROM ' . BotRepository::CHATS . ' WHERE bot_id = :bot AND chat_id = :chat',
    ['bot' => $maxBotId, 'chat' => '-70000000000001']
);
check($titleRow['title'] === 'Дежурная смена (админ)', 'discovery does not overwrite a title set by the admin');
check($titleRow['chat_kind'] === 'channel', 'discovery does not overwrite a chat kind');
$maxService->stop($maxBotId, time());

// create with an invalid nested chat rolls the bot back
$before = count($db->fetchAll('SELECT id FROM ' . BotRepository::BOTS));
$result = $processor->process(['action' => 'create', 'data' => [
    'channel' => 'max', 'title' => 'Rollback', 'token' => VALID_MAX_TOKEN,
    'chats' => [['chat_id' => '', 'chat_kind' => 'group']],
]]);
check(!$result->success && $result->httpCode === 422, 'an invalid nested chat fails create');
check(count($db->fetchAll('SELECT id FROM ' . BotRepository::BOTS)) === $before, 'the half-created MAX bot is rolled back');

// a build without the adapter answers channel_not_available instead of saving a dead bot
$telegramOnly = botsProcessor($db, $channel, $waker);
$result = $telegramOnly->process(['action' => 'create', 'data' => [
    'channel' => 'max', 'title' => 'No adapter', 'token' => VALID_MAX_TOKEN,
]]);
check(!$result->success && errorCodeOf($result) === 'channel_not_available',
    'a channel without an adapter registered is refused');

$result = $processor->process(['action' => 'delete', 'data' => ['id' => $maxBotId]]);
check($result->success && dataOf($result)['deleted'] === true, 'a MAX bot is deleted');
check($db->fetchOne('SELECT id FROM ' . BotRepository::BOTS . ' WHERE id = :id', ['id' => $maxBotId]) === null, 'the MAX bot row is gone');

// ---------- list / getRecord ----------

$result = $processor->process(['action' => 'getList']);
$list = dataOf($result);
check($result->success && count($list['items']) === 2, 'list returns both bots');
assertNoToken($result->data, 'getList');
check($list['pagination']['total'] === 2, 'list pagination total');

$result = $processor->process(['action' => 'getRecord', 'data' => ['id' => $botId]]);
check($result->success && dataOf($result)['id'] === $botId, 'getRecord returns the bot');
$result = $processor->process(['action' => 'getRecord', 'data' => ['id' => 9999]]);
check(!$result->success && $result->httpCode === 404, 'unknown bot is 404');

// ---------- update / patch ----------

$result = $processor->process(['action' => 'patch', 'data' => ['id' => $botId, 'title' => 'Дежурная смена']]);
check($result->success && dataOf($result)['title'] === 'Дежурная смена', 'patch changes the title');

$result = $processor->process(['action' => 'patch', 'data' => ['id' => $botId, 'channel' => 'max']]);
check(!$result->success && dataOf($result)['error'] === 'validation_error', 'channel cannot be changed');

$result = $processor->process(['action' => 'update', 'data' => ['id' => $botId, 'title' => 'X']]);
check(!$result->success && dataOf($result)['field'] === 'enabled', 'PUT requires enabled');

// ---------- chats ----------

$result = $processor->process(['action' => 'patch', 'data' => ['id' => $botId, 'chats' => [
    ['chat_id' => '-1001234567890', 'chat_kind' => 'group', 'title' => 'Отдел продаж', 'enabled' => true],
]]]);
$bot = dataOf($result);
check($result->success && count($bot['chats']) === 1, 'PATCH adds a manual chat');
$chatId = (int)$bot['chats'][0]['id'];
check($bot['chats'][0]['enabled'] === true && $bot['chats'][0]['state'] === 'active', 'manual chat is enabled and active');

$result = $processor->process(['action' => 'patch', 'data' => ['id' => $botId, 'chats' => [
    ['id' => $chatId, 'linked_user_id' => 12, 'title' => 'Отдел продаж — контроль'],
]]]);
$bot = dataOf($result);
check($result->success && $bot['chats'][0]['linked_user_id'] === 12, 'PATCH links an employee');
check($bot['chats'][0]['title'] === 'Отдел продаж — контроль', 'PATCH updates the chat title');

$result = $processor->process(['action' => 'patch', 'data' => ['id' => $botId, 'chats' => [
    ['id' => 9999, 'enabled' => false],
]]]);
check(!$result->success && $result->httpCode === 422, 'unknown chat row is rejected');

$result = $processor->process(['action' => 'patch', 'data' => ['id' => $botId, 'chats' => [
    ['chat_kind' => 'group'],
]]]);
check(!$result->success, 'a chat without id or chat_id is rejected');

$result = $processor->process(['action' => 'patch', 'data' => ['id' => $botId, 'chats' => [
    ['chat_id' => '-1001234567890', 'chat_kind' => 'group', 'title' => 'Дубль'],
]]]);
check($result->success && count(dataOf($result)['chats']) === 1, 'manual chat_id reuses the existing chat');

// ---------- checkToken ----------

$result = $processor->process(['action' => 'checkToken', 'data' => ['id' => $botId]]);
$check = dataOf($result);
check($result->success && $check['ok'] === true && $check['username'] === 'miko_bot', 'checkToken checks the stored token');
check(!array_key_exists('token', $check), 'checkToken returns no token');

// a token of another bot
$channel->identity = BotIdentity::ok('other_bot', '200', 'Other');
$result = $processor->process(['action' => 'create', 'data' => [
    'channel' => 'telegram', 'title' => 'Other bot', 'token' => VALID_TOKEN,
]]);
$otherId = (int)dataOf($result)['id'];
$result = $processor->process(['action' => 'checkToken', 'data' => ['id' => $botId, 'token' => VALID_TOKEN]]);
check($result->success && dataOf($result)['ok'] === false, 'a candidate token is checked without saving');
check(dataOf($result)['error_code'] === 'other_bot', 'another bot token is reported');
check((int)dataOf($result)['other_bot']['id'] === $otherId, 'other_bot names the owner');
$after = dataOf($processor->process(['action' => 'getRecord', 'data' => ['id' => $botId]]));
check($after['token_hint'] === '2345', 'checking a candidate token does not replace the stored one');
$channel->identity = BotIdentity::ok('miko_bot', '100', 'MIKO');

// ---------- discovery ----------

$channel->batches = [new DiscoveryBatch([
    new DiscoveredChat('-1001234567890', 'group', 'Отдел продаж'),
    new DiscoveredChat('444555666', 'private', 'Пётр Сидоров'),
], 103)];
$result = $processor->process(['action' => 'discoverChats', 'data' => ['id' => $botId]]);
$bot = dataOf($result);
check($result->success && $bot['discovery']['active'] === true, 'discoverChats starts a session');
check($bot['discovery']['status'] === 'running', 'a fresh session is running');
check($bot['discovery']['remaining_sec'] >= 290, 'session lasts five minutes');

$service = new DiscoveryService(new BotRepository($db), new ChannelRegistry([$channel]));
$stats = $service->runOnce(time());
check($stats['polled'] === 1 && $stats['found'] === 2, 'the worker records both found chats (the known group is not duplicated)');
$result = $processor->process(['action' => 'getRecord', 'data' => ['id' => $botId]]);
$bot = dataOf($result);
check($bot['discovery']['status'] === 'found', 'session becomes found');
check($bot['discovery']['found'][0]['chat_id'] === '-1001234567890', 'found list keeps the group');
check($bot['discovery']['found'][0]['already_connected'] === true, 'already connected chat is marked');
check($bot['discovery']['found'][1]['already_connected'] === false, 'new chat is not marked');
check(count($bot['chats']) === 2, 'the discovered private chat appears in the bot record');
$foundChat = null;
foreach ($bot['chats'] as $chat) {
    if ($chat['chat_id'] === '444555666') {
        $foundChat = $chat;
    }
}
check($foundChat !== null && $foundChat['enabled'] === false, 'discovered chats start disabled (admin opts in)');

$result = $processor->process(['action' => 'discoverChats', 'data' => ['id' => $botId, 'stop' => true]]);
$bot = dataOf($result);
check($bot['discovery']['active'] === false && $bot['discovery']['status'] === 'expired', 'stop closes the session');

// ---------- discovery: which poll errors close the session ----------
// A session closed as `error` is what the admin UI reacts to (the webhook hint, a rejected token),
// so the client-specific terminal codes must be exact.

$repo = new BotRepository($db);
$now = time();
$tgFake = new FakeTelegram();
$tgService = new DiscoveryService($repo, new ChannelRegistry([$tgFake]));
$tgService->start($botId, $now);
$tgFake->batches = [new DiscoveryBatch([], 0, 'telegram.409.webhook_set')];
$tgService->runOnce($now);
$session = $repo->latestSession($botId);
check($session['status'] === 'error', 'a Telegram webhook closes the session as error (the UI hint depends on it)');
check($session['last_error_code'] === 'telegram.409.webhook_set', 'the webhook code is kept');

$db->execute(
    'INSERT INTO ' . BotRepository::BOTS . ' (channel, title, token, token_hint, bot_username, bot_external_id,'
    . " enabled, status, status_checked_at, last_error_code, created_at, updated_at)"
    . " VALUES ('max', 'MAX', 'max_test_token', 'oken', '', '', '1', 'ok', :now, '', :now, :now)",
    ['now' => $now]
);
$maxBotId = $db->lastInsertId();
$maxFake = new FakeTelegram('max');
$maxService = new DiscoveryService($repo, new ChannelRegistry([$maxFake]));
$maxService->start($maxBotId, $now);
$maxFake->batches = [new DiscoveryBatch([], 0, 'max.405.webhook_set')];
$maxService->runOnce($now);
$session = $repo->latestSession($maxBotId);
check($session['status'] === 'error', 'a MAX webhook closes the session as error');
check($session['last_error_code'] === 'max.405.webhook_set', 'the MAX webhook code is kept');

$maxService->start($maxBotId, $now);
$maxFake->batches = [new DiscoveryBatch([], 0, 'http.timeout')];
$maxService->runOnce($now);
$session = $repo->latestSession($maxBotId);
check($session['status'] === 'running', 'a transient timeout keeps the five-minute session polling');
check($session['last_error_code'] === 'http.timeout', 'the transient error is still visible in the session');

// ---------- sendTest ----------

$waker->calls = 0;
$db->execute('UPDATE ' . BotRepository::CHATS . " SET enabled = '1' WHERE bot_id = :bot", ['bot' => $botId]);
$result = $processor->process(['action' => 'sendTest', 'data' => ['id' => $botId]]);
$test = dataOf($result);
check($result->success && count($test['chat_ids']) === 2, 'sendTest queues both chats');
check($waker->calls === 1, 'sendTest wakes the delivery worker');
$outbox = $db->fetchAll('SELECT * FROM ' . BotRepository::OUTBOX . ' WHERE bot_id = :bot', ['bot' => $botId]);
check(count($outbox) === 2, 'two outbox rows');
check($outbox[0]['status'] === 'pending', 'test deliveries are pending');
$event = $db->fetchOne('SELECT * FROM ' . BotRepository::EVENTS . ' WHERE id = :id', ['id' => $outbox[0]['event_id']]);
check($event['event_type'] === 'hub.test', 'test uses its own event type');
check((int)$event['routed_at'] > 0, 'test event is marked routed so rules ignore it');
check(!str_contains((string)$outbox[0]['rendered_json'], 'module_messenger_hub_TestMessage'), 'test text is translated from the catalog');
check(str_contains((string)$outbox[0]['rendered_json'], '🔔'), 'test message has the notification marker');

$result = $processor->process(['action' => 'sendTest', 'data' => ['id' => $botId, 'chat_ids' => [$chatId]]]);
check($result->success && count(dataOf($result)['chat_ids']) === 1, 'sendTest accepts selected chats');
$result = $processor->process(['action' => 'sendTest', 'data' => ['id' => $botId, 'chat_ids' => [9999]]]);
check(!$result->success && $result->httpCode === 422, 'unknown test chat is rejected');

// ---------- delete ----------

$result = $processor->process(['action' => 'delete', 'data' => ['id' => $botId]]);
check($result->success && dataOf($result)['deleted'] === true, 'delete succeeds');
check($db->fetchOne('SELECT id FROM ' . BotRepository::BOTS . ' WHERE id = :id', ['id' => $botId]) === null, 'bot row removed');
check(count($db->fetchAll('SELECT id FROM ' . BotRepository::CHATS . ' WHERE bot_id = :id', ['id' => $botId])) === 0, 'chats removed');
check(count($db->fetchAll('SELECT id FROM ' . BotRepository::SESSIONS . ' WHERE bot_id = :id', ['id' => $botId])) === 0, 'sessions removed');
$pending = $db->fetchAll('SELECT * FROM ' . BotRepository::OUTBOX . " WHERE status = 'pending' AND bot_id = :id", ['id' => $botId]);
check($pending === [], 'queued deliveries of the deleted bot are dropped');

finish('bots REST OK');
}
