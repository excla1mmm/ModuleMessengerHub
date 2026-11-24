<?php

declare(strict_types=1);

// Router and templates (Plan/05-events-rules-templates.md): rule matching per the stage-2 decisions
// (employees, direction, providers, attention quality range), recipient modes, one delivery per
// (event, chat), hub_enabled = 0 records events without sending, phone masking happens at render time.

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Delivery\OutboxRepository;
use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\ChatResolver;
use Modules\ModuleMessengerHub\Lib\Routing\LinkBuilder;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\PhoneMasker;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\Router;
use Modules\ModuleMessengerHub\Lib\Routing\Rule;
use Modules\ModuleMessengerHub\Lib\Routing\RuleRepository;
use Modules\ModuleMessengerHub\Lib\Routing\Templates\TemplateRegistry;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

// ---------- phone masking ----------

check(PhoneMasker::format('79689689444') === '+7 968 968-94-44', '11-digit number formatted');
check(PhoneMasker::format('+7 (968) 968-94-44') === '+7 968 968-94-44', 'formatted input normalised');
check(PhoneMasker::format('89689689444') === '+7 968 968-94-44', '8-prefix accepted');
check(PhoneMasker::mask('79689689444') === '+7 968 ***-**-44', 'mask keeps country, area and last two digits');
check(PhoneMasker::mask('12345') === '12345', 'unparseable short number is left as is');

// ---------- rule value object ----------

/** @param array<string, mixed> $overrides */
function ruleRow(array $overrides = []): array
{
    return $overrides + [
        'id' => 1,
        'title' => 'Пропущенные',
        'enabled' => '1',
        'event_types' => '["core.missed_call"]',
        'min_severity' => 'info',
        'filters_json' => '{}',
        'target_mode' => 'recipients',
        'chat_ids_json' => '[1]',
        'template_key' => '',
        'options_json' => '{}',
        'sort' => 10,
    ];
}

function missedCallPayload(array $overrides = []): array
{
    return $overrides + [
        'subject' => [
            'call' => [
                'linkedid' => 'mikopbx-1790944900.650',
                'direction' => 'incoming',
                'started_at' => 1790944901,
                'duration_sec' => 0,
            ],
            'client_number' => '79689689444',
            'employees' => [['user_id' => 12, 'number' => '233', 'name' => 'Иванов И.']],
            'provider' => null,
        ],
        'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
        'links' => [],
        'attachments' => [],
    ];
}

function hubEvent(string $type, array $payload, string $severity = HubEvent::SEVERITY_WARNING): HubEvent
{
    return new HubEvent(
        sourceId: explode('.', $type)[0] . '.' . explode('.', $type)[1],
        eventType: $type,
        severity: $severity,
        dedupeKey: $type . ':' . md5(json_encode($payload, JSON_THROW_ON_ERROR)),
        occurredAt: 1790944901,
        payload: $payload
    );
}

$missed = hubEvent('core.missed_call', missedCallPayload());
check(Rule::fromRow(ruleRow())->matches($missed), 'exact event type matches');
check(!Rule::fromRow(ruleRow(['event_types' => '["core.voicemail"]']))->matches($missed), 'other type does not match');
check(Rule::fromRow(ruleRow(['event_types' => '["core.*"]']))->matches($missed), 'prefix.* matches');
check(Rule::fromRow(ruleRow(['event_types' => '["*"]']))->matches($missed), 'wildcard matches');
check(!Rule::fromRow(ruleRow(['min_severity' => 'critical']))->matches($missed), 'severity below the rule minimum');
check(!Rule::fromRow(ruleRow(['enabled' => '0']))->matches($missed), 'disabled rule never matches');

check(Rule::fromRow(ruleRow(['filters_json' => '{"user_ids":[12]}']))->matches($missed), 'employee filter hits');
check(!Rule::fromRow(ruleRow(['filters_json' => '{"user_ids":[99]}']))->matches($missed), 'employee filter misses');
check(Rule::fromRow(ruleRow(['filters_json' => '{"directions":["incoming"]}']))->matches($missed), 'direction filter hits');
check(!Rule::fromRow(ruleRow(['filters_json' => '{"directions":["outgoing"]}']))->matches($missed), 'direction filter misses');

$providerEvent = hubEvent('core.provider_down', [
    'subject' => [
        'call' => null,
        'client_number' => '',
        'employees' => [],
        'provider' => ['id' => '7', 'username' => 'beeline', 'host' => '10.0.0.1'],
    ],
]);
check(Rule::fromRow(ruleRow(['event_types' => '["core.provider_down"]', 'filters_json' => '{"providers":["beeline"]}']))->matches($providerEvent), 'provider filter by username');
check(Rule::fromRow(ruleRow(['event_types' => '["core.provider_down"]', 'filters_json' => '{"providers":["7"]}']))->matches($providerEvent), 'provider filter by id');
check(!Rule::fromRow(ruleRow(['filters_json' => '{"providers":["beeline"]}']))->matches($missed), 'provider filter on a call without a provider');

$lowQuality = hubEvent('ai_supervisor.attention_call', [
    'subject' => ['call' => [], 'client_number' => '', 'employees' => []],
    'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => ['quality' => 48]],
]);
check(
    Rule::fromRow(ruleRow([
        'event_types' => '["ai_supervisor.attention_call"]',
        'filters_json' => '{"quality_score":{"min":0,"max":60}}',
    ]))->matches($lowQuality),
    'quality range hits'
);
check(
    !Rule::fromRow(ruleRow([
        'event_types' => '["ai_supervisor.attention_call"]',
        'filters_json' => '{"quality_score":{"min":70}}',
    ]))->matches($lowQuality),
    'quality range misses'
);
check(
    !Rule::fromRow(ruleRow([
        'event_types' => '["ai_supervisor.attention_call"]',
        'filters_json' => '{"quality_score":{"min":0}}',
    ]))->matches(hubEvent('ai_supervisor.attention_call', ['subject' => ['call' => [], 'client_number' => '', 'employees' => []], 'facts' => ['scores' => []]])),
    'a range requires a score'
);

// ---------- module status: recovery switch, importance, Cloud AI reasons (stage 3b-4) ----------

function statusEvent(string $type, string $ref, string $severity, bool $recovered, string $code = 'processing_paused'): HubEvent
{
    return hubEvent($type, ['subject' => ['call' => null, 'client_number' => '', 'employees' => [], 'provider' => null,
        'module_status' => ['module' => 'M', 'code' => $code, 'ref' => $ref, 'severity' => $severity, 'recovered' => $recovered]]], $severity);
}

// «Сообщать о восстановлении» is the recovery type in event_types: without it only the problem is sent
$problemOnly = Rule::fromRow(ruleRow(['event_types' => '["local_stt.worker_offline"]']));
$withRecovery = Rule::fromRow(ruleRow(['event_types' => '["local_stt.worker_offline","local_stt.worker_online"]']));
$offline = statusEvent('local_stt.worker_offline', 'abc', 'warning', false, 'worker_offline');
$online = statusEvent('local_stt.worker_online', 'abc', 'info', true, 'worker_offline');
check($problemOnly->matches($offline) && !$problemOnly->matches($online), 'recovery switch off: the recovery event is not sent');
check($withRecovery->matches($offline) && $withRecovery->matches($online), 'recovery switch on: problem and recovery are sent');

// importance: «only critical» also covers the recovery of a critical incident and not of a warning one
$criticalOnly = Rule::fromRow(ruleRow(['event_types' => '["cloud_stt.incident","cloud_stt.incident_resolved"]', 'min_severity' => 'critical']));
$warningUp = Rule::fromRow(ruleRow(['event_types' => '["cloud_stt.incident","cloud_stt.incident_resolved"]', 'min_severity' => 'warning']));
$incWarn = statusEvent('cloud_stt.incident', 'inc1', 'warning', false, 'incident_open');
$incCrit = statusEvent('cloud_stt.incident', 'inc2', 'critical', false, 'incident_open');
$resWarn = new HubEvent('cloud_stt.incidents', 'cloud_stt.incident_resolved', HubEvent::SEVERITY_INFO, 'k0', 1, statusEvent('cloud_stt.incident_resolved', 'inc1', 'warning', true, 'incident_open')->payload);
$resCrit = new HubEvent('cloud_stt.incidents', 'cloud_stt.incident_resolved', HubEvent::SEVERITY_INFO, 'k', 1, statusEvent('cloud_stt.incident_resolved', 'inc2', 'critical', true, 'incident_open')->payload);
check(!$criticalOnly->matches($incWarn) && $criticalOnly->matches($incCrit), 'importance: only critical incidents pass the critical filter');
check(!$criticalOnly->matches($resWarn) && $criticalOnly->matches($resCrit), 'importance: the recovery follows the importance of its incident');
check($warningUp->matches($incWarn) && $warningUp->matches($incCrit) && $warningUp->matches($resWarn), 'importance: warning and above passes warnings and their recoveries');

// Cloud AI pause reasons: the pause and the resume follow the same reasons
$money = Rule::fromRow(ruleRow([
    'event_types' => '["cloud_ai.paused","cloud_ai.resumed"]',
    'filters_json' => '{"reasons":["insufficient_funds","low_balance"]}',
]));
check($money->matches(statusEvent('cloud_ai.paused', 'insufficient_funds', 'critical', false)), 'reasons: a selected reason matches');
check($money->matches(statusEvent('cloud_ai.resumed', 'low_balance', 'warning', true)), 'reasons: the resume of a selected reason matches');
check(!$money->matches(statusEvent('cloud_ai.paused', 'manual', 'info', false)), 'reasons: an unselected reason does not match');
check(!$money->matches(statusEvent('cloud_ai.resumed', 'manual', 'info', true)), 'reasons: the resume of an unselected reason does not match');
check($money->matches(statusEvent('cloud_ai.paused', 'brand_new_reason', 'warning', false)), 'reasons: an unknown reason passes the filter');
check($money->matches(statusEvent('cloud_ai.resumed', 'brand_new_reason', 'info', true)), 'reasons: the resume of an unknown reason passes the filter');
check(!$money->matches(statusEvent('cloud_ai.paused', 'daily_limit_reached', 'warning', false)), 'reasons: a known reason outside the selection is filtered');
check(Rule::fromRow(ruleRow(['event_types' => '["cloud_ai.paused"]']))->matches(statusEvent('cloud_ai.paused', 'manual', 'info', false)), 'reasons: no filter means every reason');
$reasonsOnOther = Rule::fromRow(ruleRow(['event_types' => '["cloud_stt.paused"]', 'filters_json' => '{"reasons":["manual"]}']));
check($reasonsOnOther->matches(statusEvent('cloud_stt.paused', 'maintenance', 'warning', false)), 'reasons: the filter applies to Cloud AI events only');
$defaults = \Modules\ModuleMessengerHub\Lib\Sources\Modules\CloudAiPauseReasons::defaults();
check(count($defaults) === 7 && !in_array('manual', $defaults, true) && in_array('source_unavailable', $defaults, true), 'reasons: defaults are everything except manual');
check(count(\Modules\ModuleMessengerHub\Lib\Sources\Modules\CloudAiPauseReasons::all()) === 8, 'reasons: eight selectable reasons in five groups');

// ---------- templates ----------

$texts = hubTestTexts();
$links = new LinkBuilder('https://pbx.example');
$context = new RenderContext($texts, $links, true);
$registry = new TemplateRegistry();

$rendered = $registry->forEvent('core.missed_call')?->render($missed, $context);
check($rendered instanceof RenderedMessage, 'missed call has a template');
check(str_contains($rendered->title, 'Пропущенный звонок'), 'missed call title');
check($rendered->lines[0] === '+7 968 ***-**-44 → Иванов И. (233)', 'masked client and employee line');
check(str_contains($rendered->lines[1], 'входящий'), 'direction line');
check($rendered->footer === 'mikopbx-1790944900.650', 'call id in the footer');
check($rendered->buttons === [['text' => 'Открыть звонок', 'url' => 'https://pbx.example/admin-cabinet/call-detail-records/index']], 'open call button');

$attentionPayload = [
    'subject' => [
        'call' => [
            'linkedid' => '1731924120.4471',
            'direction' => 'incoming',
            'started_at' => 1790944901,
            'duration_sec' => 402,
        ],
        'client_number' => '79162045517',
        'employees' => [['user_id' => 12, 'number' => '241', 'name' => 'Петрова А.']],
        'attention' => ['ref_id' => 1, 'quality_score' => 48],
    ],
    'facts' => [
        'reasons' => ['Клиенту не помогли', 'Повторный звонок', 'Грубость', 'Долгое ожидание', 'Пятая причина'],
        'summary' => 'Клиенту не помогли: дважды отправили на сайт, решения не предложили.',
        'quotes' => [
            ['quote' => 'Я уже третий раз звоню по этому вопросу', 'start_ms' => 134000],
            ['quote' => 'Посмотрите на сайте, там всё написано', 'start_ms' => 291000],
            ['quote' => 'Тогда я напишу жалобу', 'start_ms' => 380000],
            ['quote' => 'Четвёртая цитата не нужна', 'start_ms' => 400000],
        ],
        'scores' => ['quality' => 48],
    ],
    'links' => [],
    'attachments' => [],
];
$attention = hubEvent('ai_supervisor.attention_call', $attentionPayload);
$rendered = $registry->forEvent('ai_supervisor.attention_call')?->render(
    $attention,
    new RenderContext($texts, $links, false)
);
check(str_contains($rendered->title, 'оценка 48'), 'attention title carries the quality score');
check($rendered->lines[0] === 'Петрова А. (241) ← +7 916 204-55-17 · 6:42', 'attention employee/client/duration line');
check(str_contains($rendered->lines[1], 'Причины: Клиенту не помогли; Повторный звонок'), 'reasons line');
check(count($rendered->notes) === 1 && str_contains($rendered->notes[0], 'Клиенту не помогли'), 'AI summary as an italic note');
check(count($rendered->quotes) === 3, 'at most three quotes');
check($rendered->quotes[0] === ['time' => '02:14', 'text' => 'Я уже третий раз звоню по этому вопросу'], 'quote with timecode');
check($rendered->footer === '1731924120.4471', 'call id footer');
check($rendered->buttons[0]['text'] === 'Открыть звонок', 'attention button');
check(
    $rendered->buttons[0]['url'] === 'https://pbx.example/admin-cabinet/module-a-i-supervisor/module-a-i-supervisor/index?ais_screen=calls&ais_card=1',
    'attention button opens the AI Supervisor call card by its URL contract'
);

// the AI Supervisor deep link uses the module's own URL contract (ais_ prefix, Q16)
$cardLink = $links->callCard(['subject' => ['attention' => ['ref_id' => 42]]], 'ai_supervisor.attention_call');
check(
    $cardLink === 'https://pbx.example/admin-cabinet/module-a-i-supervisor/module-a-i-supervisor/index?ais_screen=calls&ais_card=42',
    'attention deep link: page path + ais_screen/ais_card'
);
check(
    $links->callCard(['subject' => ['attention' => ['ref_id' => 0]]], 'ai_supervisor.attention_call')
        === 'https://pbx.example/admin-cabinet/module-a-i-supervisor/module-a-i-supervisor/index',
    'attention without a ref_id opens the module page'
);
check(
    $links->callCard([], 'core.missed_call') === 'https://pbx.example/admin-cabinet/call-detail-records/index',
    'missed call opens the Core CDR journal (no URL search for linkedid)'
);
check(
    (new LinkBuilder(''))->callCard([], 'core.missed_call') === '',
    'no public URL -> no button'
);

// every stage-1 event type renders without an exception and has a title
$catalog = [
    'core.voicemail' => ['subject' => ['call' => ['linkedid' => 'v-1'], 'client_number' => '', 'employees' => []]],
    'core.provider_down' => ['subject' => ['call' => null, 'client_number' => '', 'employees' => [], 'provider' => ['id' => '7', 'username' => 'beeline']]],
    'core.provider_up' => ['subject' => ['call' => null, 'client_number' => '', 'employees' => [], 'provider' => ['id' => '7', 'username' => 'beeline']]],
    'core.advice' => ['subject' => ['call' => null, 'client_number' => '', 'employees' => [], 'advice' => ['message_tpl' => 'adv_Test', 'params' => ['x' => 1]]]],
    'core.pbx_started' => ['subject' => ['call' => null, 'client_number' => '', 'employees' => [], 'system' => ['boot_at' => 1790944000]]],
    'ai_supervisor.worker_offline' => ['subject' => ['call' => null, 'client_number' => '', 'employees' => [], 'worker' => ['uid' => 'w1', 'name' => 'stt-1', 'last_seen' => 1790944000]]],
    'ai_supervisor.worker_online' => ['subject' => ['call' => null, 'client_number' => '', 'employees' => [], 'worker' => ['uid' => 'w1', 'name' => 'stt-1', 'last_seen' => 1790944000]]],
    'voice_agent.callback_request' => ['subject' => ['call' => null, 'client_number' => '79689689444', 'employees' => [], 'callback' => ['id' => 1, 'name' => 'Пётр', 'phone' => '79689689444', 'topic' => 'Возврат', 'agent_name' => 'Агент', 'missed_name' => 'Иванов И.', 'missed_extension' => '233', 'call_id' => 'va-1']]],
    'voice_agent.runtime_down' => ['subject' => ['call' => null, 'client_number' => '', 'employees' => [], 'runtime' => ['error' => 'connection refused', 'latency_ms' => 1200]]],
    'voice_agent.runtime_up' => ['subject' => ['call' => null, 'client_number' => '', 'employees' => [], 'runtime' => ['latency_ms' => 80]]],
    'core.queue_abandoned' => ['subject' => ['call' => ['linkedid' => 'q-1', 'started_at' => 1790944000, 'waited_sec' => 150, 'queue_number' => '800', 'queue_name' => 'Продажи', 'reason' => 'abandoned'], 'client_number' => '79689689444', 'employees' => []]],
    'core.call_out_of_hours' => ['subject' => ['call' => ['linkedid' => 'o-1', 'started_at' => 1790944000, 'did' => '74950000000'], 'client_number' => '79689689444', 'employees' => []]],
    'core.park_timeout' => ['subject' => ['call' => ['linkedid' => 'p-1', 'started_at' => 1790944000, 'park_slot' => '701', 'parked_by' => '233', 'parked_sec' => 45], 'client_number' => '79689689444', 'employees' => []]],
];
foreach ($catalog as $type => $payload) {
    $template = $registry->forEvent($type);
    check($template !== null, 'template registered for ' . $type);
    $message = $template?->render(hubEvent($type, $payload), $context);
    check($message instanceof RenderedMessage && $message->title !== '', 'template renders a title for ' . $type);
}
check($registry->forEvent('core.extension_status') === null, 'unknown event type has no template');

check(!str_contains(json_encode($rendered->toArray(), JSON_THROW_ON_ERROR), '79162045517'), 'masked number does not leak into the rendered message');
check(MessageFormat::duration(402) === '6:42', 'duration formatting');
check(MessageFormat::employee(['name' => '', 'number' => '233']) === '233', 'employee without a name');

// ---------- router ----------

/** @param array<string, mixed> $rule */
function insertRule(HubDatabase $db, array $rule): int
{
    $db->execute(
        'INSERT INTO m_MessengerHubRules (title, enabled, event_types, min_severity, filters_json, target_mode,'
        . ' chat_ids_json, template_key, options_json, quiet_hours_json, sort, created_at, updated_at)'
        . " VALUES (:title, :enabled, :types, :severity, :filters, :mode, :chats, '', '{}', '{}', :sort, 1, 1)",
        [
            'title' => (string)($rule['title'] ?? 'rule'),
            'enabled' => (string)($rule['enabled'] ?? '1'),
            'types' => json_encode($rule['event_types'] ?? ['core.missed_call'], JSON_THROW_ON_ERROR),
            'severity' => (string)($rule['min_severity'] ?? 'info'),
            'filters' => json_encode($rule['filters'] ?? [], JSON_THROW_ON_ERROR),
            'mode' => (string)($rule['target_mode'] ?? 'recipients'),
            'chats' => json_encode($rule['chat_ids'] ?? [], JSON_THROW_ON_ERROR),
            'sort' => (int)($rule['sort'] ?? 100),
        ]
    );

    return $db->lastInsertId();
}

function seedBots(HubDatabase $db): void
{
    $db->execute(
        'INSERT INTO m_MessengerHubBots (channel, title, token, token_hint, bot_username, bot_external_id, enabled,'
        . " status, status_checked_at, last_error_code, created_at, updated_at) VALUES ('telegram', 'Bot', 't', 'hint',"
        . " 'bot', '1', '1', 'ok', 1, '', 1, 1)"
    );
    $db->execute(
        'INSERT INTO m_MessengerHubBots (channel, title, token, token_hint, bot_username, bot_external_id, enabled,'
        . " status, status_checked_at, last_error_code, created_at, updated_at) VALUES ('telegram', 'Off', 't2', 'hint',"
        . " 'bot2', '2', '0', 'ok', 1, '', 1, 1)"
    );
    $db->execute(
        'INSERT INTO m_MessengerHubBotChats (bot_id, chat_id, chat_kind, title, linked_user_id, enabled, state, gone_reason, discovered_at)'
        . " VALUES (1, '-1001', 'group', 'Дежурная смена', 0, '1', 'active', '', 1)"
    );
    $db->execute(
        'INSERT INTO m_MessengerHubBotChats (bot_id, chat_id, chat_kind, title, linked_user_id, enabled, state, gone_reason, discovered_at)'
        . " VALUES (1, '555', 'private', 'Иванов', 12, '1', 'active', '', 1)"
    );
    $db->execute(
        'INSERT INTO m_MessengerHubBotChats (bot_id, chat_id, chat_kind, title, linked_user_id, enabled, state, gone_reason, discovered_at)'
        . " VALUES (1, '-1002', 'group', 'Выключенный', 0, '0', 'active', '', 1)"
    );
    $db->execute(
        'INSERT INTO m_MessengerHubBotChats (bot_id, chat_id, chat_kind, title, linked_user_id, enabled, state, gone_reason, discovered_at)'
        . " VALUES (2, '-1003', 'group', 'Чужой бот', 0, '1', 'active', '', 1)"
    );
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

$db = hubTestDatabase();
seedBots($db);
$settings = new HubSettings($db);
$settings->set(HubSettings::HUB_ENABLED, '1');
$settings->set(HubSettings::PBX_PUBLIC_URL, 'https://pbx.example');
$settings->set(HubSettings::MASK_PHONE_DEFAULT, '1');

insertRule($db, ['title' => 'A', 'chat_ids' => [1, 2], 'sort' => 1]);
insertRule($db, ['title' => 'B', 'chat_ids' => [1], 'sort' => 2]); // duplicate chat 1
insertRule($db, ['title' => 'C', 'chat_ids' => [3], 'sort' => 3]); // disabled chat
insertRule($db, ['title' => 'Off', 'enabled' => '0', 'chat_ids' => [1], 'sort' => 4]);
insertRule($db, ['title' => 'Other', 'chat_ids' => [4], 'sort' => 5]); // belongs to a disabled bot
(new EventStore($db))->record($missed, 1790944902);

$result = routerFor($db, $settings)->runOnce(1790944905);
check($result === ['events' => 1, 'deliveries' => 2], 'one event -> two chats, duplicates dropped');
$rows = $db->fetchAll('SELECT * FROM ' . OutboxRepository::TABLE . ' ORDER BY chat_id');
check(count($rows) === 2, 'two outbox rows');
check((int)$rows[0]['chat_id'] === 1 && (int)$rows[1]['chat_id'] === 2, 'rows for the active chats only');
check(str_contains((string)$rows[0]['rendered_json'], '+7 968 ***-**-44'), 'phone masked in rendered_json');
check(!str_contains((string)$rows[0]['rendered_json'], '79689689444'), 'the full number is not in the outbox');
check((int)$db->fetchOne('SELECT routed_at FROM m_MessengerHubEvents')['routed_at'] === 1790944905, 'event marked routed');
check(routerFor($db, $settings)->runOnce(1790944906)['deliveries'] === 0, 'a routed event is not routed again');

// employee mode and fallback
$db = hubTestDatabase();
seedBots($db);
$settings = new HubSettings($db);
$settings->set(HubSettings::HUB_ENABLED, '1');
insertRule($db, ['title' => 'E', 'target_mode' => 'employee', 'event_types' => ['core.missed_call']]);
(new EventStore($db))->record($missed, 1);
routerFor($db, $settings)->runOnce(2);
$rows = $db->fetchAll('SELECT * FROM ' . OutboxRepository::TABLE);
check(count($rows) === 1 && (int)$rows[0]['chat_id'] === 2, 'employee mode delivers to the linked chat');

$db = hubTestDatabase();
seedBots($db);
$settings = new HubSettings($db);
$settings->set(HubSettings::HUB_ENABLED, '1');
insertRule($db, ['title' => 'F', 'target_mode' => 'employee_or_recipients', 'chat_ids' => [1]]);
$noEmployee = hubEvent('core.missed_call', ['subject' => ['call' => ['linkedid' => 'x', 'direction' => 'incoming', 'started_at' => 1], 'client_number' => '', 'employees' => [['user_id' => 99, 'number' => '9', 'name' => 'Нет']]]]);
(new EventStore($db))->record($noEmployee, 1);
routerFor($db, $settings)->runOnce(2);
$rows = $db->fetchAll('SELECT * FROM ' . OutboxRepository::TABLE);
check(count($rows) === 1 && (int)$rows[0]['chat_id'] === 1, 'employee_or_recipients falls back to the selected chat');

$db = hubTestDatabase();
seedBots($db);
$settings = new HubSettings($db);
$settings->set(HubSettings::HUB_ENABLED, '1');
insertRule($db, ['title' => 'G', 'target_mode' => 'employee']);
(new EventStore($db))->record($noEmployee, 1);
$result = routerFor($db, $settings)->runOnce(2);
check($result['deliveries'] === 0, 'employee mode without a linked chat sends nothing');
check((int)$db->fetchOne('SELECT routed_at FROM m_MessengerHubEvents')['routed_at'] === 2, 'event still marked routed');

// no rule at all
$db = hubTestDatabase();
seedBots($db);
$settings = new HubSettings($db);
$settings->set(HubSettings::HUB_ENABLED, '1');
(new EventStore($db))->record($missed, 1);
$result = routerFor($db, $settings)->runOnce(2);
check($result === ['events' => 1, 'deliveries' => 0], 'no rule -> nothing sent');
check(count($db->fetchAll('SELECT * FROM ' . OutboxRepository::TABLE)) === 0, 'no outbox rows without a rule');

// hub switched off: events recorded, nothing routed to channels, enabling later sends no backlog
$db = hubTestDatabase();
seedBots($db);
insertRule($db, ['chat_ids' => [1]]);
$settings = new HubSettings($db);
$settings->set(HubSettings::HUB_ENABLED, '0');
(new EventStore($db))->record($missed, 1);
$result = routerFor($db, $settings)->runOnce(2);
check($result === ['events' => 1, 'deliveries' => 0], 'hub off: no deliveries');
check((int)$db->fetchOne('SELECT routed_at FROM m_MessengerHubEvents')['routed_at'] === 2, 'hub off: event still marked processed');
check(count($db->fetchAll('SELECT * FROM m_MessengerHubEvents')) === 1, 'hub off: event kept in the journal');
$settings->set(HubSettings::HUB_ENABLED, '1');
check(routerFor($db, $settings)->runOnce(3)['deliveries'] === 0, 'hub on later: the backlog is not broadcast');

finish('routing and templates OK');
