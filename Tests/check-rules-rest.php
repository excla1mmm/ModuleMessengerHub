<?php

declare(strict_types=1);

// Rules REST (notifications + wizard) and event deliveries in the journal (stage 2c):
// CRUD/validation/priority, routing through a created rule, probe marking, deliveries per event
// (including deleted bots via LEFT JOIN) and POST events:retry.

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

use Modules\ModuleMessengerHub\Lib\Delivery\NullDeliveryWaker;
use Modules\ModuleMessengerHub\Lib\Delivery\OutboxRepository;
use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\ArrayTranslator;
use Modules\ModuleMessengerHub\Lib\RestAPI\Events\Processor as EventsProcessor;
use Modules\ModuleMessengerHub\Lib\RestAPI\Rules\Processor as RulesProcessor;
use Modules\ModuleMessengerHub\Lib\Routing\ChatResolver;
use Modules\ModuleMessengerHub\Lib\Routing\Router;
use Modules\ModuleMessengerHub\Lib\Routing\RuleRepository;
use Modules\ModuleMessengerHub\Lib\Routing\Templates\TemplateRegistry;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

function dataOf(\MikoPBX\PBXCoreREST\Lib\PBXApiResult $result): array
{
    return is_array($result->data) ? $result->data : [];
}

function seedRuleWorld(HubDatabase $db): void
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
    $db->execute(
        'INSERT INTO m_MessengerHubBotChats (bot_id, chat_id, chat_kind, title, linked_user_id, enabled, state,'
        . " gone_reason, discovered_at) VALUES (1, '555', 'private', 'Иванов', 12, '1', 'active', '', 1)"
    );
}

function rulesProcessor(HubDatabase $db): RulesProcessor
{
    return new RulesProcessor($db);
}

function eventsProcessor(HubDatabase $db): EventsProcessor
{
    return new EventsProcessor(new EventStore($db), new OutboxRepository($db), new NullDeliveryWaker());
}

function missedEvent(int $userId, string $key, int $at = 1790944901, bool $probe = false): HubEvent
{
    $payload = [
        'subject' => [
            'call' => ['linkedid' => 'mikopbx-' . $key, 'direction' => 'incoming', 'started_at' => $at, 'duration_sec' => 0],
            'client_number' => '79689689444',
            'employees' => [['user_id' => $userId, 'number' => '233', 'name' => 'Иванов И.']],
            'provider' => null,
        ],
        'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
        'links' => [],
        'attachments' => [],
    ];
    if ($probe) {
        $payload['probe'] = true;
    }

    return new HubEvent('core.missed_call', 'core.missed_call', HubEvent::SEVERITY_WARNING, 'missed:' . $key, $at, $payload);
}

$db = hubTestDatabase();
seedRuleWorld($db);
$processor = rulesProcessor($db);

// ---------- defaults ----------

$defaults = dataOf($processor->process(['action' => 'getDefault']));
check($defaults['enabled'] === true, 'a new notification is enabled by default');
check($defaults['target_mode'] === 'employee_or_recipients', 'default recipient mode');
check($defaults['priority'] === 100, 'default priority');

// ---------- create ----------

$result = $processor->process(['action' => 'create', 'data' => [
    'title' => 'Пропущенные звонки',
    'enabled' => true,
    'event_types' => ['core.missed_call'],
    'min_severity' => 'info',
    'filters' => ['directions' => ['incoming']],
    'target_mode' => 'employee_or_recipients',
    'chat_ids' => [1],
    'options' => ['mask_phone' => true],
]]);
$ruleA = dataOf($result);
check($result->success && $result->httpCode === 201, 'create rule succeeds with 201');
check($ruleA['source_id'] === 'core.missed_call' && $ruleA['group'] === 'calls', 'source and group derived from the event type');
check(count($ruleA['chats']) === 1 && $ruleA['chats'][0]['title'] === 'Дежурная смена', 'selected chats are embedded');
check($ruleA['priority'] === 10, 'first rule gets priority 10');
check($ruleA['last_event_at'] === null, 'no events yet');

$result = $processor->process(['action' => 'create', 'data' => [
    'title' => 'Провайдер недоступен',
    'enabled' => true,
    'event_types' => ['core.provider_down', 'core.provider_up'],
    'target_mode' => 'recipients',
    'chat_ids' => [1],
]]);
$ruleB = dataOf($result);
check($result->success && $ruleB['priority'] === 20, 'second rule follows the first');

// ---------- validation ----------

$bad = [
    [['title' => 'X', 'enabled' => true, 'event_types' => ['nope.nope'], 'target_mode' => 'recipients', 'chat_ids' => [1]], 'unknown_event_type'],
    [['title' => 'X', 'enabled' => true, 'event_types' => ['core.missed_call'], 'target_mode' => 'recipients', 'chat_ids' => []], 'chat_ids_required'],
    [['title' => 'X', 'enabled' => true, 'event_types' => ['core.missed_call'], 'target_mode' => 'recipients', 'chat_ids' => [999]], 'unknown_chat'],
    [['title' => 'X', 'enabled' => true, 'event_types' => ['core.missed_call'], 'target_mode' => 'nowhere', 'chat_ids' => [1]], 'invalid_target_mode'],
    [['title' => 'X', 'enabled' => true, 'event_types' => ['core.missed_call'], 'target_mode' => 'recipients', 'chat_ids' => [1], 'filters' => ['departments' => [1]]], 'unknown_filter'],
    [['title' => 'X', 'enabled' => true, 'event_types' => ['core.missed_call'], 'target_mode' => 'recipients', 'chat_ids' => [1], 'options' => ['colour' => 'red']], 'unknown_option'],
    [['title' => '', 'enabled' => true, 'event_types' => ['core.missed_call'], 'target_mode' => 'recipients', 'chat_ids' => [1]], 'invalid_title'],
];
foreach ($bad as $case) {
    $result = $processor->process(['action' => 'create', 'data' => $case[0]]);
    check(!$result->success && $result->httpCode === 422, 'validation rejects: ' . $case[1]);
}

// ---------- list / priority ----------

$result = $processor->process(['action' => 'getList']);
$items = dataOf($result)['items'];
check($result->success && count($items) === 2, 'list returns both rules');
check($items[0]['id'] === $ruleA['id'] && $items[1]['id'] === $ruleB['id'], 'list follows the priority order');

$result = $processor->process(['action' => 'changePriority', 'data' => ['order' => [$ruleB['id'], $ruleA['id']]]]);
$reordered = dataOf($result)['items'];
check($result->success && $reordered[0]['id'] === $ruleB['id'], 'changePriority moves the provider rule first');
$result = $processor->process(['action' => 'changePriority', 'data' => ['order' => [$ruleA['id']]]]);
check(!$result->success && $result->httpCode === 422, 'an incomplete order is rejected');

// ---------- patch / put / last event ----------

$result = $processor->process(['action' => 'patch', 'data' => ['id' => $ruleA['id'], 'enabled' => false]]);
check($result->success && dataOf($result)['enabled'] === false, 'toggle disables the rule');
$result = $processor->process(['action' => 'patch', 'data' => ['id' => $ruleA['id'], 'enabled' => true]]);
check($result->success && dataOf($result)['enabled'] === true, 'toggle re-enables it');

$result = $processor->process(['action' => 'update', 'data' => ['id' => $ruleA['id'], 'title' => 'X']]);
check(!$result->success && $result->httpCode === 422, 'PUT requires the main fields');

$db->execute(
    'INSERT INTO m_MessengerHubEvents (source_id, event_type, severity, dedupe_key, occurred_at, payload_json,'
    . " routed_at, created_at) VALUES ('core.missed_call', 'core.missed_call', 'warning', 'old', 1790944000, '{}', 1, 1)"
);
$result = $processor->process(['action' => 'getRecord', 'data' => ['id' => $ruleA['id']]]);
check(dataOf($result)['last_event_at'] === 1790944000, 'last_event_at is the latest event of the type');

// ---------- routing through the created rule ----------

$settings = new HubSettings($db);
$settings->set(HubSettings::HUB_ENABLED, '1');
$settings->set(HubSettings::PBX_PUBLIC_URL, 'https://pbx.local');
$router = new Router(
    $db,
    new EventStore($db),
    new RuleRepository($db),
    new ChatResolver($db),
    new TemplateRegistry(),
    $settings,
    hubTestTexts()
);
(new EventStore($db))->record(missedEvent(12, 'employee'), 1790945000);
(new EventStore($db))->record(missedEvent(99, 'fallback'), 1790945001);
(new EventStore($db))->record(missedEvent(99, 'probe', 1790945002, true), 1790945002);
$router->runOnce(1790945010);
$rows = $db->fetchAll('SELECT * FROM ' . OutboxRepository::TABLE . ' ORDER BY id ASC');
check(count($rows) === 3, 'three events -> three deliveries (employee chat and group fallback)');
$byChat = [];
foreach ($rows as $row) {
    $byChat[(int)$row['chat_id']][] = $row;
}
check(isset($byChat[2]) && count($byChat[2]) === 1, 'the employee event goes to the linked private chat');
check(isset($byChat[1]) && count($byChat[1]) === 2, 'events without a linked employee fall back to the selected chats');
check(str_contains((string)$byChat[2][0]['rendered_json'], '+7 968 ***-**-44'), 'the rule masks the client number');
check(!str_contains((string)$byChat[2][0]['rendered_json'], '79689689444'), 'the full number is not in the outbox');
$probeRow = $rows[count($rows) - 1];
check(str_contains((string)$probeRow['rendered_json'], 'Тестовая проба'), 'probe events are marked in the message');

// ---------- deliveries in the journal ----------

$events = eventsProcessor($db);
$result = $events->process(['action' => 'getList', 'data' => ['limit' => 10]]);
$items = dataOf($result)['items'];
$eventWithDeliveries = null;
foreach ($items as $item) {
    if (($item['deliveries'][0]['chat_title'] ?? '') === 'Иванов') {
        $eventWithDeliveries = $item;
        break;
    }
}
check($eventWithDeliveries !== null && count($eventWithDeliveries['deliveries']) === 1, 'event list carries its deliveries');
check($eventWithDeliveries['deliveries'][0]['chat_title'] === 'Иванов', 'delivery names the chat');
check($eventWithDeliveries['deliveries'][0]['bot_deleted'] === false, 'a live bot is not flagged deleted');

// fail one delivery, then retry it through the API
$failedId = (int)$rows[0]['id'];
$db->execute(
    'UPDATE ' . OutboxRepository::TABLE . " SET status = 'failed', attempts = 5, last_error_code = 'telegram.500.server_error' WHERE id = :id",
    ['id' => $failedId]
);
$eventId = (int)$rows[0]['event_id'];
$result = $events->process(['action' => 'retry', 'data' => ['id' => $eventId]]);
$retried = dataOf($result);
check($result->success && $retried['retried'] === 1, 'retry restarts the failed delivery');
$row = $db->fetchOne('SELECT * FROM ' . OutboxRepository::TABLE . ' WHERE id = :id', ['id' => $failedId]);
check($row['status'] === 'pending' && (int)$row['attempts'] === 0, 'retried row is pending with fresh attempts');
check($row['last_error_code'] === '', 'the old error code is cleared');
check((int)$row['next_attempt_at'] <= time() + 1, 'the retried row is due immediately');
$retryDeliveries = $retried['deliveries'] ?? [];
check(count($retryDeliveries) === 1 && $retryDeliveries[0]['status'] === 'pending', 'the response shows the pending delivery');

$result = $events->process(['action' => 'retry', 'data' => ['id' => 99999]]);
check(!$result->success && $result->httpCode === 404, 'retry of an unknown event is 404');

// ---------- deleted bot/chat history is readable (LEFT JOIN) ----------

$db->execute('DELETE FROM m_MessengerHubBots WHERE id = 1');
$result = $events->process(['action' => 'getRecord', 'data' => ['id' => $eventId]]);
$delivery = dataOf($result)['deliveries'][0] ?? [];
check($result->success && $delivery['bot_deleted'] === true, 'a deleted bot is flagged instead of breaking the journal');
check($delivery['chat_title'] === 'Иванов', 'the chat title survives the deleted bot');
$db->execute('DELETE FROM m_MessengerHubBotChats WHERE id = 2');
$result = $events->process(['action' => 'getRecord', 'data' => ['id' => $eventId]]);
$delivery = dataOf($result)['deliveries'][0] ?? [];
check($result->success && $delivery['chat_deleted'] === true && $delivery['chat_title'] === '', 'a deleted chat is flagged too');

// ---------- delete rules ----------

$result = $processor->process(['action' => 'delete', 'data' => ['id' => $ruleA['id']]]);
check($result->success && dataOf($result)['deleted'] === true, 'rule deleted');
$result = $processor->process(['action' => 'getRecord', 'data' => ['id' => $ruleA['id']]]);
check(!$result->success && $result->httpCode === 404, 'deleted rule is gone');

// ---------- stage 2d: retract_on_callback option validation ----------

$db2 = hubTestDatabase();
seedRuleWorld($db2);
$processor2 = rulesProcessor($db2);
$retractRule = [
    'title' => 'Пропущенные с удалением',
    'enabled' => true,
    'event_types' => ['core.missed_call'],
    'target_mode' => 'recipients',
    'chat_ids' => [1],
    'options' => ['retract_on_callback' => [
        'enabled' => true,
        'window_min' => 20,
        'count_incoming_answered' => true,
    ]],
];
$result = $processor2->process(['action' => 'create', 'data' => $retractRule]);
$created = dataOf($result);
check($result->success && $created['options']['retract_on_callback']['enabled'] === true, 'retract option accepted');
check($created['options']['retract_on_callback']['window_min'] === 20, 'retract window stored');
check($created['options']['retract_on_callback']['count_incoming_answered'] === true, 'incoming switch stored');

foreach ([3, 121] as $window) {
    $bad = $retractRule;
    $bad['options']['retract_on_callback']['window_min'] = $window;
    $result = $processor2->process(['action' => 'create', 'data' => $bad]);
    check(!$result->success && $result->httpCode === 422, 'retract window ' . $window . ' is rejected');
}
$bad = $retractRule;
$bad['options']['retract_on_callback']['enabled'] = 'yes';
$result = $processor2->process(['action' => 'create', 'data' => $bad]);
check(!$result->success && $result->httpCode === 422, 'non-boolean retract enabled is rejected');

finish('rules and deliveries OK');
}
