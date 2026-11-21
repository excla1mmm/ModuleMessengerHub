<?php

declare(strict_types=1);

// Delivery pipeline (Plan/08-reliability.md): leasing, retry/backoff/429, uncertain outcomes,
// recipient_gone, stale info, rate limits, token rejection, group migration. The channel is faked,
// the queue is the real SQL implementation on SQLite.

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Channels\AttachmentPart;
use Modules\ModuleMessengerHub\Lib\Channels\AttachmentResult;
use Modules\ModuleMessengerHub\Lib\Channels\BotCredentials;
use Modules\ModuleMessengerHub\Lib\Channels\BotIdentity;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelInterface;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelLimits;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelRegistry;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryBatch;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryCursor;
use Modules\ModuleMessengerHub\Lib\Channels\Recipient;
use Modules\ModuleMessengerHub\Lib\Channels\SendResult;
use Modules\ModuleMessengerHub\Lib\Delivery\DeliveryService;
use Modules\ModuleMessengerHub\Lib\Delivery\OutboxRepository;
use Modules\ModuleMessengerHub\Lib\Delivery\RateLimiter;
use Modules\ModuleMessengerHub\Lib\Delivery\RetryPolicy;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

final class FakeChannel implements ChannelInterface
{
    /** @var list<SendResult> */
    public array $results = [];

    public int $sends = 0;

    /** @var list<AttachmentResult> */
    public array $attachmentResults = [];

    /** @var list<array{path: string, caption: string, token: string}> */
    public array $attachments = [];

    public function __construct(private readonly string $channelId = 'telegram')
    {
    }

    public function id(): string
    {
        return $this->channelId;
    }

    public function checkToken(BotCredentials $bot): BotIdentity
    {
        return BotIdentity::ok('bot', '1');
    }

    public function discoverChats(BotCredentials $bot, DiscoveryCursor $cursor): DiscoveryBatch
    {
        return new DiscoveryBatch();
    }

    public function send(BotCredentials $bot, Recipient $to, RenderedMessage $message): SendResult
    {
        $this->sends++;

        return array_shift($this->results) ?? SendResult::sent(['1']);
    }

    public function sendAttachment(BotCredentials $bot, Recipient $to, AttachmentPart $part): AttachmentResult
    {
        $this->attachments[] = ['path' => $part->filePath, 'caption' => $part->caption, 'token' => $part->pendingToken];

        return array_shift($this->attachmentResults) ?? AttachmentResult::of(SendResult::sent(['a1']));
    }

    public function delete(BotCredentials $bot, Recipient $to, string $externalMessageId): SendResult
    {
        return SendResult::sent();
    }

    public function limits(): ChannelLimits
    {
        return ChannelLimits::telegram();
    }
}

/** Seeds one bot, one chat, one event and one outbox row; returns [botId, chatId, eventId, outboxId]. */
function seedDelivery(HubDatabase $db, array $row = [], array $event = []): array
{
    $db->execute(
        'INSERT INTO m_MessengerHubBots (channel, title, token, token_hint, bot_username, bot_external_id, enabled,'
        . " status, status_checked_at, last_error_code, created_at, updated_at) VALUES (:channel, 'Bot',"
        . " '123456789:secret', 'cret', 'bot', '1', '1', 'ok', 1, '', 1, 1)",
        ['channel' => (string)($row['channel'] ?? 'telegram')]
    );
    $botId = $db->lastInsertId();
    $db->execute(
        'INSERT INTO m_MessengerHubBotChats (bot_id, chat_id, chat_kind, title, linked_user_id, enabled, state,'
        . " gone_reason, discovered_at) VALUES (:bot, :chat, 'group', 'Группа', 0, '1', 'active', '', 1)",
        ['bot' => $botId, 'chat' => (string)($row['external_chat_id'] ?? '-1001')]
    );
    $chatId = $db->lastInsertId();
    $db->execute(
        'INSERT INTO m_MessengerHubEvents (source_id, event_type, severity, dedupe_key, occurred_at, payload_json,'
        . " routed_at, created_at) VALUES ('core.missed_call', 'core.missed_call', :severity, :key, :occurred,"
        . " '{}', 1, :created)",
        [
            'severity' => (string)($event['severity'] ?? 'info'),
            'key' => 'k' . uniqid('', true),
            'occurred' => (int)($event['occurred_at'] ?? 1790944901),
            'created' => (int)($event['created_at'] ?? 1790944901),
        ]
    );
    $eventId = $db->lastInsertId();
    $db->execute(
        'INSERT INTO m_MessengerHubOutbox (event_id, chat_id, bot_id, rule_id, status, attempts, uncertain_attempts,'
        . ' next_attempt_at, lease_owner, lease_until, rendered_json, external_message_ids, last_error_code,'
        . ' last_error_at, created_at, updated_at, sent_at)'
        . ' VALUES (:event, :chat, :bot, 1, :status, :attempts, :uncertain, :next, :lease_owner, :lease_until,'
        . " :rendered, '[]', '', NULL, :created, :updated, NULL)",
        [
            'event' => $eventId,
            'chat' => $chatId,
            'bot' => $botId,
            'status' => (string)($row['status'] ?? 'pending'),
            'attempts' => (int)($row['attempts'] ?? 0),
            'uncertain' => (int)($row['uncertain_attempts'] ?? 0),
            'next' => (int)($row['next_attempt_at'] ?? 0),
            'lease_owner' => $row['lease_owner'] ?? '',
            'lease_until' => $row['lease_until'] ?? null,
            'rendered' => json_encode(
                (new RenderedMessage(title: 'Заголовок', lines: ['строка'], footer: 'call-1'))->toArray(),
                JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
            ),
            'created' => (int)($row['created_at'] ?? 1790944901),
            'updated' => (int)($row['created_at'] ?? 1790944901),
        ]
    );

    return [$botId, $chatId, $eventId, $db->lastInsertId()];
}

function serviceFor(HubDatabase $db, FakeChannel $channel): DeliveryService
{
    return new DeliveryService(
        new OutboxRepository($db),
        new ChannelRegistry([$channel]),
        new RateLimiter(),
        'test',
        120,
        20
    );
}

function addEventRow(HubDatabase $db, string $severity = 'info'): int
{
    $db->execute(
        'INSERT INTO m_MessengerHubEvents (source_id, event_type, severity, dedupe_key, occurred_at, payload_json,'
        . " routed_at, created_at) VALUES ('core.missed_call', 'core.missed_call', :severity, :key, 1790944901,"
        . " '{}', 1, 1790944901)",
        ['severity' => $severity, 'key' => 'k' . uniqid('', true)]
    );

    return $db->lastInsertId();
}

function addOutboxRow(HubDatabase $db, int $eventId, int $chatId, int $botId): int
{
    $db->execute(
        'INSERT INTO m_MessengerHubOutbox (event_id, chat_id, bot_id, rule_id, status, attempts, uncertain_attempts,'
        . " next_attempt_at, lease_owner, lease_until, rendered_json, external_message_ids, last_error_code,"
        . " last_error_at, created_at, updated_at, sent_at) VALUES (:event, :chat, :bot, 1, 'pending', 0, 0, 0,"
        . " '', NULL, '{}', '[]', '', NULL, 1790944901, 1790944901, NULL)",
        ['event' => $eventId, 'chat' => $chatId, 'bot' => $botId]
    );

    return $db->lastInsertId();
}

$row = static fn (HubDatabase $db, int $id): array => (array)$db->fetchOne('SELECT * FROM ' . OutboxRepository::TABLE . ' WHERE id = :id', ['id' => $id]);

// ---------- retry policy ----------

check(RetryPolicy::delayAfter(1) === 10, 'first retry after 10 s');
check(RetryPolicy::delayAfter(6) === 7200, 'sixth retry after 2 h');
check(RetryPolicy::delayAfter(7) === null, 'seventh failure gives up');
check(RetryPolicy::delayAfter(0) === 10, 'a zero attempt still uses the first delay');

// ---------- rate limiter ----------

$limiter = new RateLimiter();
$limits = ChannelLimits::telegram();
check($limiter->reserve(1, '-1001', 'group', 1000, $limits) === 0, 'first send allowed');
check($limiter->reserve(1, '-1001', 'group', 1000, $limits) === 1, 'second send in the same second waits');
check($limiter->reserve(1, '-1001', 'group', 1001, $limits) === 0, 'next second is allowed');

$limiter = new RateLimiter();
$groupLimits = new ChannelLimits(4096, 1024, 0, 20, 100, 50 * 1024 * 1024);
for ($i = 0; $i < 20; $i++) {
    check($limiter->reserve(1, '-1001', 'group', 2000, $groupLimits) === 0, 'group minute allows 20 sends, #' . $i);
}
check($limiter->reserve(1, '-1001', 'group', 2000, $groupLimits) === 60, '21st send waits for a minute');

$limiter = new RateLimiter();
$botLimits = new ChannelLimits(4096, 1024, 0, 1000, 30, 50 * 1024 * 1024);
for ($i = 0; $i < 30; $i++) {
    check($limiter->reserve(1, 'chat' . $i, 'private', 3000, $botLimits) === 0, 'bot allows 30 sends/s, #' . $i);
}
check($limiter->reserve(1, 'chat-other', 'private', 3000, $botLimits) === 1, '31st send waits');

// ---------- sent ----------

$db = hubTestDatabase();
[, , , $outboxId] = seedDelivery($db);
$channel = new FakeChannel();
$channel->results = [SendResult::sent(['42'])];
$stats = serviceFor($db, $channel)->runOnce(1790945000);
check($stats['sent'] === 1, 'one row sent');
$sentRow = $row($db, $outboxId);
check($sentRow['status'] === 'sent', 'status sent');
check($sentRow['external_message_ids'] === '["42"]', 'external message id stored');
check((int)$sentRow['sent_at'] === 1790945000, 'sent_at set');
check((int)$db->fetchOne('SELECT attempts FROM ' . OutboxRepository::TABLE . ' WHERE id = :id', ['id' => $outboxId])['attempts'] === 0, 'attempts count sends, unchanged by success');

// ---------- 429 respects retry_after ----------

$db = hubTestDatabase();
[, , , $outboxId] = seedDelivery($db);
$channel = new FakeChannel();
$channel->results = [SendResult::retry(37, 'telegram.429.rate_limit')];
serviceFor($db, $channel)->runOnce(1790945000);
$retryRow = $row($db, $outboxId);
check($retryRow['status'] === 'pending', '429 keeps the row pending');
check((int)$retryRow['attempts'] === 1, '429 counts the attempt');
check((int)$retryRow['next_attempt_at'] >= 1790945037, 'retry_after 37 wins over the 10 s backoff');
check($retryRow['last_error_code'] === 'telegram.429.rate_limit', '429 code stored');

// ---------- permanent token error marks the bot ----------

$db = hubTestDatabase();
[$botId, , , $outboxId] = seedDelivery($db);
$channel = new FakeChannel();
$channel->results = [SendResult::permanent('telegram.401.error')];
serviceFor($db, $channel)->runOnce(1790945000);
check($row($db, $outboxId)['status'] === 'failed', 'permanent error fails the row');
check($row($db, $outboxId)['last_error_code'] === 'telegram.401.error', 'permanent code stored');
$bot = $db->fetchOne('SELECT status, last_error_code FROM m_MessengerHubBots WHERE id = :id', ['id' => $botId]);
check($bot['status'] === 'token_invalid' && $bot['last_error_code'] === 'telegram.401.error', 'rejected token marks the bot');
check(!str_contains((string)$row($db, $outboxId)['last_error_code'], 'secret'), 'no token in the error code');

// ---------- a TLS trust error marks the bot, a good send clears it ----------

$db = hubTestDatabase();
[$botId, , , $outboxId] = seedDelivery($db);
$channel = new FakeChannel();
$channel->results = [SendResult::permanent('max.tls.untrusted_ca')];
serviceFor($db, $channel)->runOnce(1790945000);
$bot = $db->fetchOne('SELECT status, last_error_code FROM m_MessengerHubBots WHERE id = :id', ['id' => $botId]);
check($bot['status'] === 'ca_error', 'a TLS trust error puts the bot into ca_error');
check($bot['last_error_code'] === 'max.tls.untrusted_ca', 'the actionable code is kept');
check($row($db, $outboxId)['status'] === 'failed', 'the TLS row fails once, it is not retried forever');

$db->execute(
    'UPDATE ' . OutboxRepository::TABLE . " SET status = 'pending', attempts = 0, next_attempt_at = 0,"
    . " lease_owner = '', lease_until = NULL, last_error_code = '' WHERE id = :id",
    ['id' => $outboxId]
);
$channel->results = [SendResult::sent(['43'])];
serviceFor($db, $channel)->runOnce(1790945060);
$bot = $db->fetchOne('SELECT status, last_error_code FROM m_MessengerHubBots WHERE id = :id', ['id' => $botId]);
check($bot['status'] === 'ok' && $bot['last_error_code'] === '', 'a successful send returns the bot to ok');

// ---------- give up after the retry schedule ----------

$db = hubTestDatabase();
[, , , $outboxId] = seedDelivery($db, ['attempts' => 6]);
$channel = new FakeChannel();
$channel->results = [SendResult::retry(0, 'telegram.500.server_error')];
serviceFor($db, $channel)->runOnce(1790945000);
check($row($db, $outboxId)['status'] === 'failed', 'the seventh attempt gives up');
check((int)$row($db, $outboxId)['attempts'] === 7, 'attempts counted');

// ---------- unknown outcome: the text is at-most-once (stage 3a, Plan/08) ----------

$db = hubTestDatabase();
[, , , $outboxId] = seedDelivery($db, ['attempts' => 1]);
$channel = new FakeChannel();
$channel->results = [SendResult::retry(10, 'http.timeout', true)];
serviceFor($db, $channel)->runOnce(1790945000);
$uncertainRow = $row($db, $outboxId);
check($uncertainRow['status'] === 'sent', 'an unknown text outcome is not retried (no duplicate)');
$parts = json_decode((string)$uncertainRow['delivery_parts_json'], true);
check(($parts['text']['state'] ?? '') === 'sent', 'the text part is marked sent');
check(($parts['text']['code'] ?? '') === 'delivery.uncertain', 'the unknown outcome is visible as a code');

$channel->results = [SendResult::sent(['99'])];
serviceFor($db, $channel)->runOnce(1790945100);
check($channel->sends === 1, 'a later pass never sends the same text again');

// ---------- recipient gone drops the whole chat ----------

$db = hubTestDatabase();
[$botId, $chatId, $eventId1, $firstId] = seedDelivery($db);
$secondId = addOutboxRow($db, addEventRow($db), $chatId, $botId);
$channel = new FakeChannel();
$channel->results = [SendResult::recipientGone('telegram.403.kicked')];
serviceFor($db, $channel)->runOnce(1790945000);
$chat = $db->fetchOne('SELECT state, gone_reason FROM m_MessengerHubBotChats WHERE id = :id', ['id' => $chatId]);
check($chat['state'] === 'gone' && $chat['gone_reason'] === 'telegram.403.kicked', 'chat marked gone with the code');
check($row($db, $firstId)['status'] === 'dropped', 'the current row dropped');
check($row($db, $secondId)['status'] === 'dropped', 'other queued rows for the chat dropped');
check($channel->sends === 1, 'no endless retries for a gone recipient');

// ---------- stale info vs warning ----------

$db = hubTestDatabase();
$now = 1791000000;
[, , , $freshId] = seedDelivery($db, ['created_at' => $now - 60]);
$db->execute('UPDATE m_MessengerHubOutbox SET created_at = :c WHERE id = :id', ['c' => $now - 60, 'id' => $freshId]);
[, , , $oldInfoId] = seedDelivery($db, ['created_at' => $now - 90000], ['severity' => 'info']);
$db->execute('UPDATE m_MessengerHubOutbox SET created_at = :c WHERE id = :id', ['c' => $now - 90000, 'id' => $oldInfoId]);
[, , , $oldWarningId] = seedDelivery($db, ['created_at' => $now - 90000], ['severity' => 'warning']);
$db->execute('UPDATE m_MessengerHubOutbox SET created_at = :c WHERE id = :id', ['c' => $now - 90000, 'id' => $oldWarningId]);
$channel = new FakeChannel();
serviceFor($db, $channel)->runOnce($now);
check($row($db, $oldInfoId)['status'] === 'dropped', 'info older than 24 h is dropped');
check($row($db, $oldInfoId)['last_error_code'] === 'stale', 'dropped with the stale reason');
check($row($db, $oldWarningId)['status'] === 'sent', 'warnings are delivered however old');
check($row($db, $freshId)['status'] === 'sent', 'fresh info delivered');

// ---------- lease expiry ----------

$db = hubTestDatabase();
[, , , $outboxId] = seedDelivery($db, ['status' => 'sending', 'lease_owner' => 'dead', 'lease_until' => 1790944000]);
$repo = new OutboxRepository($db);
check($repo->reclaimExpiredLeases(1790945000) === 1, 'an expired lease returns to pending');
check($row($db, $outboxId)['status'] === 'pending', 'row reclaimable');
check($repo->reclaimExpiredLeases(1790945000) === 0, 'nothing else to reclaim');

// ---------- group migration ----------

$db = hubTestDatabase();
[, $chatId, , $outboxId] = seedDelivery($db);
$channel = new FakeChannel();
$channel->results = [SendResult::retry(0, 'telegram.400.migrate', false, '-100999')];
serviceFor($db, $channel)->runOnce(1790945000);
$chat = $db->fetchOne('SELECT chat_id FROM m_MessengerHubBotChats WHERE id = :id', ['id' => $chatId]);
check($chat['chat_id'] === '-100999', 'chat id updated after the migration');
$migrated = $row($db, $outboxId);
check($migrated['status'] === 'pending' && (int)$migrated['next_attempt_at'] === 1790945000, 'resent immediately with the new id');

// ---------- migration into an already discovered supergroup ----------

$db = hubTestDatabase();
[$botId, $basicChatId, , $outboxId] = seedDelivery($db, ['external_chat_id' => '-5328408093']);
$db->execute(
    'INSERT INTO m_MessengerHubBotChats (bot_id, chat_id, chat_kind, title, linked_user_id, enabled, state,'
    . " gone_reason, discovered_at) VALUES (:bot, '-1001234567890', 'group', 'Тестовая', 0, '1', 'active', '', 1)",
    ['bot' => $botId]
);
$channel = new FakeChannel();
$channel->results = [SendResult::retry(0, 'telegram.400.migrate', false, '-1001234567890')];
$stats = serviceFor($db, $channel)->runOnce(1790945000);
check($stats['dropped'] === 1, 'a stale basic-group row is dropped after the migration');
$basic = $db->fetchOne('SELECT id FROM m_MessengerHubBotChats WHERE id = :id', ['id' => $basicChatId]);
check($basic === null, 'the stale duplicate chat row is removed');
check($row($db, $outboxId)['status'] === 'dropped', 'its delivery is dropped, not failed');
check($row($db, $outboxId)['last_error_code'] === 'chat_migrated', 'the merge is visible as a code');
check($channel->sends === 1, 'nothing is retried against the stale id');

// ---------- unknown channel ----------

$db = hubTestDatabase();
[, , , $outboxId] = seedDelivery($db, ['channel' => 'max']);
$channel = new FakeChannel();
serviceFor($db, $channel)->runOnce(1790945000);
check($row($db, $outboxId)['status'] === 'failed', 'a channel without an adapter fails the row');
check($row($db, $outboxId)['last_error_code'] === 'channel_unknown', 'channel_unknown code');

// ---------- vanished chat/bot row is not a stuck lease ----------

$db = hubTestDatabase();
[$botId, , , $outboxId] = seedDelivery($db);
$db->execute('DELETE FROM m_MessengerHubBots WHERE id = :id', ['id' => $botId]);
$channel = new FakeChannel();
serviceFor($db, $channel)->runOnce(1790945000);
check($row($db, $outboxId)['status'] === 'failed', 'a row whose bot vanished fails instead of looping');
check($row($db, $outboxId)['last_error_code'] === 'delivery_missing', 'delivery_missing code');

// ---------- rate-limited row is postponed, not failed ----------

$db = hubTestDatabase();
[$botId, $chatId] = seedDelivery($db);
$secondRow = addOutboxRow($db, addEventRow($db), $chatId, $botId);
$channel = new FakeChannel();
$channel->results = [SendResult::sent(['1']), SendResult::sent(['2'])];
$stats = serviceFor($db, $channel)->runOnce(1790945000);
check($stats['sent'] === 1 && $stats['retried'] === 1, 'one send per second per chat');
check($channel->sends === 1, 'the limited row was not sent');
$postponed = $db->fetchOne(
    'SELECT * FROM ' . OutboxRepository::TABLE . " WHERE status = 'pending' AND id = :id",
    ['id' => $secondRow]
);
check($postponed !== null && (int)$postponed['next_attempt_at'] > 1790945000, 'limited row postponed');
check((int)$postponed['attempts'] === 0, 'a postponement is not an attempt');

finish('delivery pipeline OK');
