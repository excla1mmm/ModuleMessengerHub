<?php

declare(strict_types=1);

// Retraction of missed-call notifications after a callback (Plan/12, stage 2d):
// detection from CdrConnector, the rule window/options, cancel-before-send, deletion of text and
// attachment ids, retract_failed without endless retries, phone formats and NOANSWER callbacks.

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

use Modules\ModuleMessengerHub\Lib\Channels\BotCredentials;
use Modules\ModuleMessengerHub\Lib\Channels\BotIdentity;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelInterface;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelLimits;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelRegistry;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryBatch;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryCursor;
use Modules\ModuleMessengerHub\Lib\Channels\Recipient;
use Modules\ModuleMessengerHub\Lib\Channels\SendResult;
use Modules\ModuleMessengerHub\Lib\Delivery\OutboxRepository;
use Modules\ModuleMessengerHub\Lib\Delivery\RateLimiter;
use Modules\ModuleMessengerHub\Lib\Delivery\RetractionService;
use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\ChatResolver;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\Router;
use Modules\ModuleMessengerHub\Lib\Routing\RuleRepository;
use Modules\ModuleMessengerHub\Lib\Routing\Templates\TemplateRegistry;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Sources\Core\MissedCallSource;
use Modules\ModuleMessengerHub\Lib\Sources\Core\RecentMissedLoader;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRecorder;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

final class RetractHarness
{
    public PdoHubDatabase $db;
    public SourceStateRepository $states;
    public EventStore $store;
    public SourceRecorder $recorder;

    public function __construct()
    {
        $this->db = hubTestDatabase();
        $this->states = new SourceStateRepository($this->db);
        $this->store = new EventStore($this->db);
        $this->recorder = new SourceRecorder($this->states, $this->store);
    }

    /** @return list<string> */
    public function keys(): array
    {
        return array_column(
            $this->db->fetchAll('SELECT dedupe_key FROM m_MessengerHubEvents ORDER BY id'),
            'dedupe_key'
        );
    }

    /** @return array<string, mixed>|null */
    public function event(string $dedupeKey): ?array
    {
        return $this->db->fetchOne(
            'SELECT * FROM m_MessengerHubEvents WHERE dedupe_key = :key',
            ['key' => $dedupeKey]
        );
    }
}

/** @param array<string, mixed> $data */
function amiLeg(array $data): array
{
    $data['action'] = 'hangup_update_cdr';

    return [
        'UserEvent' => 'CdrConnector',
        'AgiData' => base64_encode(json_encode($data, JSON_THROW_ON_ERROR)),
    ];
}

function legData(string $linkedid, string $src, string $dst, string $status, int $start, int $end, string $did = ''): array
{
    return [
        'linkedid' => $linkedid,
        'UNIQUEID' => $linkedid,
        'src_num' => $src,
        'src_name' => $src,
        'dst_num' => $dst,
        'dst_name' => $dst,
        'did' => $did,
        'disposition' => $status,
        'GLOBAL_STATUS' => $status,
        'start' => date('Y-m-d H:i:s', $start),
        'endtime' => date('Y-m-d H:i:s', $end),
        'duration' => max(0, $end - $start),
        'billsec' => 0,
        'recordingfile' => '',
    ];
}

final class RetractChannel implements ChannelInterface
{
    /** @var list<SendResult> */
    public array $deleteResults = [];

    /** @var list<string> */
    public array $deleted = [];

    public int $deleteCalls = 0;

    public function id(): string
    {
        return 'telegram';
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
        return SendResult::sent(['1']);
    }

    public function sendAttachment(BotCredentials $bot, Recipient $to, \Modules\ModuleMessengerHub\Lib\Channels\AttachmentPart $part): \Modules\ModuleMessengerHub\Lib\Channels\AttachmentResult
    {
        return \Modules\ModuleMessengerHub\Lib\Channels\AttachmentResult::of(SendResult::sent(['a1']));
    }

    public function delete(BotCredentials $bot, Recipient $to, string $externalMessageId): SendResult
    {
        $this->deleteCalls++;
        $result = array_shift($this->deleteResults) ?? SendResult::sent();
        if ($result->outcome === SendResult::SENT) {
            $this->deleted[] = $externalMessageId;
        }

        return $result;
    }

    public function limits(): ChannelLimits
    {
        return ChannelLimits::telegram();
    }
}

const MAP = [
    '233' => ['user_id' => 12, 'name' => 'Иванов И.'],
    '241' => ['user_id' => 12, 'name' => 'Петрова А.'],
];

const T = 1791068000;

// ======================= callback detection =======================

$h = new RetractHarness();
$source = new MissedCallSource(15, 200, MAP);
// missed call: client +7 968 968-94-44 -> extension 233, no answer
$source->onAmiEvent(amiLeg(legData('missed-1', '+7 968 968-94-44', '233', 'NOANSWER', T, T)), $h->recorder, T);
$source->tick($h->recorder, T + 16);
check($h->keys() === ['missed:missed-1'], 'detector: unanswered call -> missed event');

// outgoing callback answered 10 minutes later, client number written as 8...
$source->onAmiEvent(amiLeg(legData('callback-1', '233', '89689689444', 'ANSWERED', T + 600, T + 660)), $h->recorder, T + 600);
$source->tick($h->recorder, T + 676);
$resolved = $h->event('resolved:missed-1');
check($resolved !== null, 'detector: answered outgoing callback -> resolved event');
check($resolved !== null && (int)$resolved['occurred_at'] === T + 600, 'detector: resolved_at is the callback start');
$payload = $resolved === null ? [] : json_decode((string)$resolved['payload_json'], true, 8, JSON_THROW_ON_ERROR);
check(($payload['subject']['call']['missed_linkedid'] ?? '') === 'missed-1', 'detector: resolved points at the missed linkedid');
check(($payload['subject']['call']['direction'] ?? '') === 'outgoing', 'detector: outgoing callback direction');
check(($payload['subject']['employees'][0]['number'] ?? '') === '233', 'detector: callback employee');

// one missed -> one resolved even after two callbacks
$source->onAmiEvent(amiLeg(legData('callback-2', '233', '79689689444', 'ANSWERED', T + 660, T + 700)), $h->recorder, T + 660);
$source->tick($h->recorder, T + 716);
check(count(array_keys($h->keys(), 'resolved:missed-1')) === 1, 'detector: a second callback does not duplicate the resolved event');

// NOANSWER callback -> no resolved
$h2 = new RetractHarness();
$source2 = new MissedCallSource(15, 200, MAP);
$source2->onAmiEvent(amiLeg(legData('missed-2', '79162045517', '233', 'NOANSWER', T, T)), $h2->recorder, T);
$source2->tick($h2->recorder, T + 16);
$source2->onAmiEvent(amiLeg(legData('callback-3', '233', '79162045517', 'NOANSWER', T + 300, T + 310)), $h2->recorder, T + 300);
$source2->tick($h2->recorder, T + 316);
check($h2->event('resolved:missed-2') === null, 'detector: NOANSWER callback leaves the missed unresolved');

// incoming answered callback (client called back) -> resolved with direction incoming
$h3 = new RetractHarness();
$source3 = new MissedCallSource(15, 200, MAP);
$source3->onAmiEvent(amiLeg(legData('missed-3', '79689689444', '233', 'NOANSWER', T, T)), $h3->recorder, T);
$source3->tick($h3->recorder, T + 16);
$source3->onAmiEvent(amiLeg(legData('callback-4', '89689689444', '233', 'ANSWERED', T + 120, T + 180)), $h3->recorder, T + 120);
$source3->tick($h3->recorder, T + 196);
$incoming = $h3->event('resolved:missed-3');
check($incoming !== null, 'detector: answered incoming call from the client -> resolved event');
$incomingPayload = $incoming === null ? [] : json_decode((string)$incoming['payload_json'], true, 8, JSON_THROW_ON_ERROR);
check(($incomingPayload['subject']['call']['direction'] ?? '') === 'incoming', 'detector: incoming direction');
check(MissedCallSource::normalizeNumber('89689689444') === '9689689444', 'number: 8 prefix');
check(MissedCallSource::normalizeNumber('+7 968 968-94-44') === '9689689444', 'number: +7 with spaces');
check(MissedCallSource::normalizeNumber('49689689444') === '9689689444', 'number: last 10 digits only');

// the AMI worker restores the index from the journal at startup
$h4 = new RetractHarness();
$h4->store->record(
    new HubEvent('core.missed_call', 'core.missed_call', 'warning', 'missed:restored', T, missedPayload('restored', T)),
    T
);
$restored = RecentMissedLoader::load($h4->db, T + 60);
check(count($restored) === 1 && $restored[0]['linkedid'] === 'restored', 'loader: recent missed calls restored from the journal');
$source4 = new MissedCallSource(15, 200, MAP);
$source4->seedRecentMissed($restored);
$source4->onAmiEvent(amiLeg(legData('callback-restored', '233', '89689689444', 'ANSWERED', T + 120, T + 180)), $h4->recorder, T + 120);
$source4->tick($h4->recorder, T + 196);
check($h4->event('resolved:restored') !== null, 'loader: a callback resolves a missed call restored at startup');

// ======================= router + planner =======================

function addRule(HubDatabase $db, array $options, int $chatId = 1, string $title = 'Missed'): int
{
    $db->execute(
        'INSERT INTO m_MessengerHubRules (title, enabled, event_types, min_severity, filters_json, target_mode,'
        . ' chat_ids_json, template_key, options_json, quiet_hours_json, sort, created_at, updated_at)'
        . " VALUES (:title, '1', '[\"core.missed_call\"]', 'info', '{}', 'recipients', :chats, '', :options,"
        . " '{}', 10, 1, 1)",
        [
            'title' => $title,
            'chats' => json_encode([$chatId], JSON_THROW_ON_ERROR),
            'options' => json_encode($options, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
        ]
    );

    return $db->lastInsertId();
}

function seedBotAndChats(HubDatabase $db): void
{
    $db->execute(
        'INSERT INTO m_MessengerHubBots (channel, title, token, token_hint, bot_username, bot_external_id, enabled,'
        . " status, status_checked_at, last_error_code, created_at, updated_at) VALUES ('telegram', 'Bot', 't', 'hint',"
        . " 'bot', '1', '1', 'ok', 1, '', 1, 1)"
    );
    $db->execute(
        'INSERT INTO m_MessengerHubBotChats (bot_id, chat_id, chat_kind, title, linked_user_id, enabled, state,'
        . " gone_reason, discovered_at) VALUES (1, '-1001', 'group', 'Дежурная смена', 0, '1', 'active', '', 1)"
    );
}

function missedPayload(string $linkedid, int $at, string $client = '79689689444'): array
{
    return [
        'subject' => [
            'call' => ['linkedid' => $linkedid, 'direction' => 'incoming', 'started_at' => $at, 'duration_sec' => 0],
            'client_number' => $client,
            'employees' => [['user_id' => 12, 'number' => '233', 'name' => 'Иванов И.']],
            'provider' => null,
        ],
        'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
        'links' => [],
        'attachments' => [['kind' => 'recording', 'path' => '/tmp/r.webm']],
    ];
}

function resolvedPayload(string $missedLinkedid, string $direction = 'outgoing'): array
{
    return [
        'subject' => [
            'call' => [
                'linkedid' => 'callback-1',
                'missed_linkedid' => $missedLinkedid,
                'direction' => $direction,
                'started_at' => T + 600,
                'duration_sec' => 60,
            ],
            'client_number' => '89689689444',
            'employees' => [['user_id' => 12, 'number' => '233', 'name' => 'Иванов И.']],
            'provider' => null,
        ],
        'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
        'links' => [],
        'attachments' => [],
    ];
}

function routerFor(HubDatabase $db, HubSettings $settings): Router
{
    return new Router(
        $db,
        new EventStore($db),
        new RuleRepository($db),
        new ChatResolver($db),
        new TemplateRegistry(),
        $settings,
        hubTestTexts()
    );
}

function settingsFor(HubDatabase $db): HubSettings
{
    $settings = new HubSettings($db);
    $settings->set(HubSettings::HUB_ENABLED, '1');

    return $settings;
}

// 1. answered callback within 20 minutes -> sent message gets a retraction request, both ids deleted
$db = hubTestDatabase();
seedBotAndChats($db);
addRule($db, ['retract_on_callback' => ['enabled' => true, 'window_min' => 20, 'count_incoming_answered' => true]]);
$settings = settingsFor($db);
$router = routerFor($db, $settings);
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call', 'warning', 'missed:m1', T, missedPayload('m1', T)), T);
$router->runOnce(T + 1);
$repo = new OutboxRepository($db);
$row = $db->fetchOne('SELECT * FROM ' . OutboxRepository::TABLE . ' WHERE event_id = 1');
check($row !== null, 'planner: missed event routed to the chat');
$db->execute(
    'UPDATE ' . OutboxRepository::TABLE . " SET status = 'sent', external_message_ids = '[\"10\",\"11\"]' WHERE event_id = 1"
);
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call_resolved', 'info', 'resolved:m1', T + 600, resolvedPayload('m1')), T + 600);
$router->runOnce(T + 601);
$row = $db->fetchOne('SELECT * FROM ' . OutboxRepository::TABLE . ' WHERE event_id = 1');
check((int)$row['retract_requested_at'] === T + 601, 'planner: sent delivery gets a retraction request');
check((int)$row['resolved_at'] === T + 600, 'planner: resolved_at stored');
check($row['resolved_by'] === 'Иванов И. (233)', 'planner: employee stored for the journal');

$channel = new RetractChannel();
$service = new RetractionService(new OutboxRepository($db), new ChannelRegistry([$channel]), new RateLimiter(), 'test');
$stats = $service->runOnce(T + 602);
check($stats['retried'] === 1, 'retraction: one delete per rate window, the row is postponed');
check($channel->deleted === ['10'], 'retraction: the first id is deleted');
$row = $db->fetchOne('SELECT * FROM ' . OutboxRepository::TABLE . ' WHERE event_id = 1');
check((int)$row['retract_next_attempt_at'] === T + 603, 'retraction: the next delete waits for the channel rate window');
$stats = $service->runOnce(T + 603);
check($stats['retracted'] === 1, 'retraction: row retracted');
check($channel->deleted === ['10', '11'], 'retraction: text and attachment ids are both deleted');
$row = $db->fetchOne('SELECT * FROM ' . OutboxRepository::TABLE . ' WHERE event_id = 1');
check($row['status'] === 'retracted' && (int)$row['retracted_at'] === T + 603, 'retraction: status retracted');

// 1b. a pending row whose text is already delivered is retracted, not cancelled
$db = hubTestDatabase();
seedBotAndChats($db);
addRule($db, ['retract_on_callback' => ['enabled' => true, 'window_min' => 20, 'count_incoming_answered' => true]]);
$settings = settingsFor($db);
$router = routerFor($db, $settings);
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call', 'warning', 'missed:m1b', T, missedPayload('m1b', T)), T);
$router->runOnce(T + 1);
$parts = json_encode([
    'text' => ['state' => 'sent', 'id' => '20', 'code' => ''],
    'note' => ['state' => 'none'],
    'attachment' => ['state' => 'pending'],
    'audio' => [['state' => 'pending', 'id' => '', 'code' => '', 'token' => '', 'not_ready' => 0, 'attempts' => 0, 'start_ms' => 0, 'end_ms' => 0]],
], JSON_THROW_ON_ERROR);
$db->execute(
    'UPDATE ' . OutboxRepository::TABLE . " SET delivery_parts_json = :parts, external_message_ids = '[\"20\"]' WHERE event_id = 1",
    ['parts' => $parts]
);
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call_resolved', 'info', 'resolved:m1b', T + 60, resolvedPayload('m1b')), T + 60);
$router->runOnce(T + 61);
$row = $db->fetchOne('SELECT * FROM ' . OutboxRepository::TABLE . ' WHERE event_id = 1');
check($row['status'] === 'sent' && (int)$row['retract_requested_at'] === T + 61, 'planner: a delivered text is retracted, not cancelled');
check($row['retract_reason'] === 'resolved_after_send', 'planner: resolved_after_send reason kept');
$parts = json_decode((string)$row['delivery_parts_json'], true);
check(($parts['audio'][0]['code'] ?? '') === 'resolved_after_send', 'planner: unfinished audio is skipped');

// 2. callback 25 minutes later with a 20-minute window -> message stays
$db = hubTestDatabase();
seedBotAndChats($db);
addRule($db, ['retract_on_callback' => ['enabled' => true, 'window_min' => 20, 'count_incoming_answered' => true]]);
$settings = settingsFor($db);
$router = routerFor($db, $settings);
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call', 'warning', 'missed:m2', T, missedPayload('m2', T)), T);
$router->runOnce(T + 1);
$db->execute('UPDATE ' . OutboxRepository::TABLE . " SET status = 'sent', external_message_ids = '[\"12\"]' WHERE event_id = 1");
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call_resolved', 'info', 'resolved:m2', T + 1500, resolvedPayload('m2')), T + 1500);
$router->runOnce(T + 1501);
$row = $db->fetchOne('SELECT * FROM ' . OutboxRepository::TABLE . ' WHERE event_id = 1');
check($row['status'] === 'sent' && $row['retract_requested_at'] === null, 'planner: callback after the window leaves the message');

// 3. callback before the message left the queue -> cancelled, never sent
$db = hubTestDatabase();
seedBotAndChats($db);
addRule($db, ['retract_on_callback' => ['enabled' => true, 'window_min' => 20, 'count_incoming_answered' => true]]);
$settings = settingsFor($db);
$router = routerFor($db, $settings);
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call', 'warning', 'missed:m3', T, missedPayload('m3', T)), T);
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call_resolved', 'info', 'resolved:m3', T + 60, resolvedPayload('m3')), T + 60);
$router->runOnce(T + 61);
$row = $db->fetchOne('SELECT * FROM ' . OutboxRepository::TABLE . ' WHERE event_id = 1');
check($row['status'] === 'cancelled', 'planner: pending delivery is cancelled');
check($row['last_error_code'] === 'resolved_before_send', 'planner: cancelled with the resolved_before_send reason');
check((int)$row['resolved_at'] === T + 60 && $row['resolved_by'] === 'Иванов И. (233)', 'planner: cancellation keeps time and employee');

// 4. incoming answered: counted only when the rule allows it
$db = hubTestDatabase();
seedBotAndChats($db);
$db->execute(
    'INSERT INTO m_MessengerHubBots (channel, title, token, token_hint, bot_username, bot_external_id, enabled,'
    . " status, status_checked_at, last_error_code, created_at, updated_at) VALUES ('telegram', 'Bot2', 't2', 'hint',"
    . " 'bot2', '2', '1', 'ok', 1, '', 1, 1)"
);
$db->execute(
    'INSERT INTO m_MessengerHubBotChats (bot_id, chat_id, chat_kind, title, linked_user_id, enabled, state,'
    . " gone_reason, discovered_at) VALUES (2, '-1002', 'group', 'Вторая', 0, '1', 'active', '', 1)"
);
addRule($db, ['retract_on_callback' => ['enabled' => true, 'window_min' => 20, 'count_incoming_answered' => true]], 1, 'Count yes');
addRule($db, ['retract_on_callback' => ['enabled' => true, 'window_min' => 20, 'count_incoming_answered' => false]], 2, 'Count no');
$settings = settingsFor($db);
$router = routerFor($db, $settings);
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call', 'warning', 'missed:m4', T, missedPayload('m4', T)), T);
$router->runOnce(T + 1);
$db->execute('UPDATE ' . OutboxRepository::TABLE . " SET status = 'sent', external_message_ids = '[\"13\"]'");
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call_resolved', 'info', 'resolved:m4', T + 300, resolvedPayload('m4', 'incoming')), T + 300);
$router->runOnce(T + 301);
$rows = $db->fetchAll('SELECT * FROM ' . OutboxRepository::TABLE . ' ORDER BY chat_id');
check(count($rows) === 2, 'planner: both rules delivered the missed call');
check((int)$rows[0]['retract_requested_at'] === T + 301, 'planner: incoming callback counts when enabled');
check($rows[1]['retract_requested_at'] === null, 'planner: incoming callback ignored when disabled');

// 5. a rule without the option changes nothing
$db = hubTestDatabase();
seedBotAndChats($db);
addRule($db, []);
$settings = settingsFor($db);
$router = routerFor($db, $settings);
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call', 'warning', 'missed:m5', T, missedPayload('m5', T)), T);
$router->runOnce(T + 1);
$db->execute('UPDATE ' . OutboxRepository::TABLE . " SET status = 'sent', external_message_ids = '[\"14\"]'");
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call_resolved', 'info', 'resolved:m5', T + 60, resolvedPayload('m5')), T + 60);
$router->runOnce(T + 61);
$row = $db->fetchOne('SELECT * FROM ' . OutboxRepository::TABLE . ' WHERE event_id = 1');
check($row['status'] === 'sent' && $row['retract_requested_at'] === null, 'planner: rule without the option never retracts');

// 6. bot removed from the chat -> retract_failed once, no retries
$db = hubTestDatabase();
seedBotAndChats($db);
addRule($db, ['retract_on_callback' => ['enabled' => true, 'window_min' => 20, 'count_incoming_answered' => true]]);
$settings = settingsFor($db);
$router = routerFor($db, $settings);
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call', 'warning', 'missed:m6', T, missedPayload('m6', T)), T);
$router->runOnce(T + 1);
$db->execute('UPDATE ' . OutboxRepository::TABLE . " SET status = 'sent', external_message_ids = '[\"15\"]'");
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call_resolved', 'info', 'resolved:m6', T + 60, resolvedPayload('m6')), T + 60);
$router->runOnce(T + 61);
$channel = new RetractChannel();
$channel->deleteResults = [SendResult::recipientGone('telegram.403.kicked')];
$service = new RetractionService(new OutboxRepository($db), new ChannelRegistry([$channel]), new RateLimiter(), 'test');
$stats = $service->runOnce(T + 62);
check($stats['failed'] === 1, 'retraction: a gone bot fails the retraction');
$row = $db->fetchOne('SELECT * FROM ' . OutboxRepository::TABLE . ' WHERE event_id = 1');
check($row['status'] === 'retract_failed' && $row['retract_last_error_code'] === 'telegram.403.kicked', 'retraction: retract_failed with the channel code');
check((int)$row['retract_attempts'] === 1, 'retraction: no endless retries for a gone bot');

// 7. transient deletion failure -> retry, then success
$db = hubTestDatabase();
seedBotAndChats($db);
addRule($db, ['retract_on_callback' => ['enabled' => true, 'window_min' => 20, 'count_incoming_answered' => true]]);
$settings = settingsFor($db);
$router = routerFor($db, $settings);
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call', 'warning', 'missed:m7', T, missedPayload('m7', T)), T);
$router->runOnce(T + 1);
$db->execute('UPDATE ' . OutboxRepository::TABLE . " SET status = 'sent', external_message_ids = '[\"16\"]'");
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call_resolved', 'info', 'resolved:m7', T + 60, resolvedPayload('m7')), T + 60);
$router->runOnce(T + 61);
$channel = new RetractChannel();
$channel->deleteResults = [SendResult::retry(30, 'telegram.500.server_error'), SendResult::sent()];
$service = new RetractionService(new OutboxRepository($db), new ChannelRegistry([$channel]), new RateLimiter(), 'test');
$stats = $service->runOnce(T + 62);
check($stats['retried'] === 1, 'retraction: transient failure is retried');
$row = $db->fetchOne('SELECT * FROM ' . OutboxRepository::TABLE . ' WHERE event_id = 1');
check($row['status'] === 'sent' && (int)$row['retract_next_attempt_at'] === T + 92, 'retraction: next attempt honours the delay');
$stats = $service->runOnce(T + 93);
check($stats['retracted'] === 1, 'retraction: the retry deletes the message');
$row = $db->fetchOne('SELECT * FROM ' . OutboxRepository::TABLE . ' WHERE event_id = 1');
check($row['status'] === 'retracted', 'retraction: retracted after the retry');

// 8. bot deleted from the module -> retract_failed without calling the channel
$db = hubTestDatabase();
seedBotAndChats($db);
addRule($db, ['retract_on_callback' => ['enabled' => true, 'window_min' => 20, 'count_incoming_answered' => true]]);
$settings = settingsFor($db);
$router = routerFor($db, $settings);
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call', 'warning', 'missed:m8', T, missedPayload('m8', T)), T);
$router->runOnce(T + 1);
$db->execute('UPDATE ' . OutboxRepository::TABLE . " SET status = 'sent', external_message_ids = '[\"17\"]'");
(new EventStore($db))->record(new HubEvent('core.missed_call', 'core.missed_call_resolved', 'info', 'resolved:m8', T + 60, resolvedPayload('m8')), T + 60);
$router->runOnce(T + 61);
$db->execute('DELETE FROM m_MessengerHubBots WHERE id = 1');
$channel = new RetractChannel();
$service = new RetractionService(new OutboxRepository($db), new ChannelRegistry([$channel]), new RateLimiter(), 'test');
$stats = $service->runOnce(T + 62);
check($stats['failed'] === 1, 'retraction: deleted bot row fails');
check($channel->deleteCalls === 0, 'retraction: no channel call without a bot');
$row = $db->fetchOne('SELECT * FROM ' . OutboxRepository::TABLE . ' WHERE event_id = 1');
check($row['status'] === 'retract_failed' && $row['retract_last_error_code'] === 'bot_deleted', 'retraction: bot_deleted code');

finish('callback retraction OK');
}
