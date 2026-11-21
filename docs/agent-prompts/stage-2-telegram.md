# Prompt: ModuleMessengerHub — stage 2 (Telegram)

You are continuing development of the MikoPBX module **ModuleMessengerHub** at
the repository root (git, branch `develop`). Answer the user in Russian;
code, identifiers and commit messages in English.

## 0. Read first (mandatory)

1. `AGENTS.md`, `CLAUDE.md`. Non-negotiable: never modify MikoPBX Core (Core models may be READ); never modify
   source modules; Core hooks stay cheap; idempotency via unique keys; **secrets (bot tokens, hub API key) never
   appear in REST responses, logs, error codes, exceptions or test output**.
2. `Plan/` — especially `03-channels.md` (Telegram section), `04-data-model.md`, `05-events-rules-templates.md`,
   `06-rest-api-and-ui.md` (agreed API: `bots`, `rules`, `events.retry`; **no other resources**), `07-security-privacy.md`,
   `08-reliability.md`, `09-roadmap.md` (stage 2), `11-open-questions.md` (decisions incl. Q14), `12-callback-retract.md`.
3. Approved UI design: `docs/design/ModuleMessengerHub.html` — screens «Уведомления», «Новое уведомление»
   (3-step wizard), «Журнал» (column «Отправка» and delivery statuses), «Настройки → Мессенджеры» (connect
   Telegram, «Подключить чат» with 4 states, empty/loading/error/test states), «Сообщение в мессенджере»,
   «Тексты интерфейса», «Компоненты модуля». Implement it faithfully with the existing theme CSS.
4. `docs/adding-a-channel.md` — checklist for the Telegram channel.
5. Stage 1 code — reuse its contracts (`HubEvent`, `EventStore`, `SourceRegistry`, `HubSettings`, REST style of
   `Lib/RestAPI/Settings` and `Events`, `HubLogger`, `Tests/support/bootstrap.php`).
6. Load the `mikopbx-module` skill before REST/UI work; `babel-compiler` for JS.

## Station and safety rules (from previous reviews — mandatory)

- Test station: access in `LOCAL.md` (not in git). Working rules from `docs/agent-prompts/stage-1-continuation.md`
  («Working rules») apply: new package version per install, resumable `files:upload`, `modules:installFromPackage`,
  single-quoted SQL inside `ssh "..."`, CLI probes with `require_once 'Globals.php';` inside try/catch, cleanup.
- **Never create Core API keys with `full_permissions=1`.** For REST checks create a key whose `allowed_paths`
  contains only the paths you test, and delete it afterwards.
- **Never change the station admin password or other credentials.** If you need the web UI logged in — stop and ask.
- At the end of every station session put into the report:
  `select id,description,full_permissions from m_ApiKeys where id>=232` as proof of cleanup.
- The station reaches `api.telegram.org` (checked 20.11.2026). `platform-api2.max.ru` fails TLS (no Минцифры root CA)
  — that is stage 3, do not work around it now.
- **Telegram bot token:** you need a test bot token from the user. Never commit it, never write it into files in
  the repo, never print it in logs or the report. When you reach the first step that needs it, STOP and ask the user
  to provide it (the user will paste it into the module UI or give it to you for a REST call). A Telegram test group
  and a private chat with the bot are also provided by the user.

## User decisions (20.11.2026, Plan/11 Q14 — they override the design)

1. **Keys are fully autonomous.** The user never deals with API keys. The hub creates, updates and, when needed,
   recreates its own key by itself. No «Выдать доступ» button anywhere. If a source module itself refuses the hub
   key — informational text «Модуль не даёт доступа к данным» only.
2. **The hub never manages other modules.** No «Включить» button — informational text «Модуль выключен» only.
3. Rule conditions in stage 2: employees, call direction, providers, and for `ai_supervisor.attention_call` the
   quality score range. Employee groups/departments are a stage 4 To Do (ModuleUsersGroups) — do not build them.
4. **No «за прошлую неделю подошло бы N» hint and no `rules:previewMatches` method.** Keep it simple.

Where the design shows these buttons/hints, implement the decision above instead (see the «Отступления от
утверждённого дизайна» block at the end of `Plan/06`).

---

## Stage 2a — data model, delivery pipeline, Telegram channel (no UI)

0. **Self-healing hub key (decision 1).** Today the key is synced once a minute and on settings PATCH. Add:
   when a poll of a path that the key is supposed to have gets `api_unauthorized`/`api_forbidden`, the collector
   re-checks its own key record immediately (exists, ours, `allowed_paths` as expected, secret still valid) and
   repairs it — update paths in place, or recreate the key if the record is gone or the secret no longer
   authenticates (rate-limited: at most once per 5 minutes per reason, logged as a code, never the secret).
   Only when the key is verified healthy and the module still refuses, the source state becomes «module refuses
   access» (`api_forbidden`) — that is what the UI shows as «Модуль не даёт доступа к данным».
   Unit tests for the decision table; station check: delete the hub key record by hand → the hub recreates it
   within one cycle and sources return to `available` without any user action.
1. Models (annotations + test schema in `Tests/support/bootstrap.php`): `Bots`, `BotChats` (chats nested under a
   bot), `Rules`, `Outbox`, `DiscoverySessions` — per `Plan/04` with these adjustments: chats belong to bots;
   Outbox stores **all** external message ids of a delivery (text + attachments) as JSON; statuses
   `pending | sending | sent | failed | dropped | cancelled | retracted | retract_failed` (last three for 2d).
   Migrations: the installer must stay fast (`Plan/04`, «Миграции»).
2. `Lib/Channels/ChannelInterface` (`checkToken`, `discoverChats`, `send`, `delete`, `limits`) and `SendResult`
   (`sent(ids) | retry(after, code) | permanent(code) | recipient_gone(code)`).
3. `Lib/Channels/HttpTransport` (curl, timeouts, optional proxy from settings, TLS verification always on,
   injectable base URL for tests, **never logs URLs/headers/bodies**; errors become normalised codes).
4. `Lib/Channels/Telegram/*`: `getMe`, `getUpdates` (only for discovery sessions; handle "webhook is set"),
   `sendMessage` (HTML, escaping, 4096 limit, inline `url` button), `sendAudio`/`sendDocument` hooks for stage 3a,
   `deleteMessage`, `migrate_to_chat_id`, 429 `retry_after`, 403 blocked/kicked, 400 chat not found. Fixtures of
   real (anonymised) Telegram responses in `Tests/fixtures/telegram/`.
5. Router: new events (`routed_at IS NULL`) → matching enabled rules (Plan/05) → recipients (selected chats /
   employee's linked chat / employee-or-chats) → rendered message → Outbox rows (UNIQUE event+chat). Rendering via
   templates per event type (`Lib/Routing/Templates/*`) producing a neutral `RenderedMessage`; the Telegram adapter
   converts it to HTML. Templates for all stage 1 event types; the attention-call template follows the client spec of
   `moduleaisupervisor#10` (reasons, quality score, short summary, up to 3 quotes with timecodes, call ID, button
   «Открыть звонок»). Phone masking (`Plan/05`).
6. `DeliveryService` + `RetryPolicy` + `RateLimiter` (Telegram ~1 msg/s per chat, ~20/min per group, ~30/s per bot)
   + lease handling; worker `WorkerMessengerHubDelivery` (CHECK_BY_PID_NOT_ALERT, own beanstalk tube for wake-ups;
   never consume Core tubes). Stale `info` deliveries older than 24 h → `dropped` (`stale`).
7. `hub_enabled = 0` means: collect and route nothing to channels (events still recorded); document it.
8. Unit tests: rendering/escaping/truncation, routing (all target modes, dedupe event+chat, disabled rule, no rule),
   retry/backoff/429, recipient_gone, lease expiry, rate limiting, secrets never in `SendResult`/logs/exceptions.

**STOP — report and wait.**

## Stage 2b — bots REST + «Настройки → Мессенджеры» UI

1. `Lib/RestAPI/Bots/` per `Plan/06`: `getList`, `getRecord`, `getDefault`, `create`, `update`, `patch`, `delete`,
   custom `checkToken`, `discoverChats`, `sendTest`. `token` is write-only; responses carry `token_hint` only.
   Chats are nested in the bot record and edited through PATCH (enable/disable, `linked_user_id`, manual `chat_id`).
2. Discovery session: 5 minutes of `getUpdates` in a worker (not in the REST request), found chats appear in the bot
   record; states «идёт поиск / найдено / время вышло / ничего не найдено» as in the design.
3. `sendTest` goes through the Outbox (same path as real notifications); results visible per chat.
4. Settings stage-2 fields: `pbx_public_url`, `mask_phone_default`, `proxy_url` (+ «Общие» UI per design).
5. UI «Настройки → Мессенджеры» per design (Telegram only in this stage; MAX card visible but marked «скоро» or hidden
   — choose and explain), including the MAX hint text for later.
6. Contract tests: token never returned (every bot endpoint), validation errors, chats PATCH, sendTest creates Outbox rows.

Station: **ask the user for the test bot token and chats first.** Then: add bot → «Проверить» → «Подключить чат»
finds the group and the private chat → «Отправить тест» arrives in both → remove the bot from the group → test marks
the chat «бот удалён из чата» without endless retries → grep logs/DB/REST for the token: not found.

**STOP — report and wait.**

## Stage 2c — rules REST + «Уведомления» UI and wizard

1. `Lib/RestAPI/Rules/` per `Plan/06`: CRUD, `getDefault`, custom `changePriority`. No `previewMatches`.
2. «Уведомления» tab per design: categories in the fixed order (Звонки → ИИ Супервайзер → Голосовой агент → Связь и АТС),
   per-row status as information only («Модуль выключен», «Модуль не установлен», «Модуль не даёт доступа к данным»,
   no action buttons — decisions 1–2), last event time,
   toggle, «…» menu; wizard «Новое уведомление» (сценарий → условия → куда отправить) with live preview of the
   Telegram message (no «подошло бы N» hint — decision 4); conditions per decision 3; empty/loading/error states;
   the list refreshes itself every 30 s like the journal.
3. «Журнал»: show the «Отправка» column and delivery statuses per event; `events.retry` for failed deliveries.
4. Station: create «Пропущенные звонки → сотруднику, иначе в группу» and «Провайдер недоступен → группа»;
   deliver real messages from replayed/probe events (mark probes as probes), verify one event → one message per chat,
   phone masking, «Открыть звонок» URL, retry of a failed delivery.

**STOP — report and wait.**

## Stage 2d — «Удалять сообщение, если клиенту перезвонили» (`Plan/12-callback-retract.md`)

Implement exactly as specified there (resolved event `core.missed_call_resolved`, rule option
`retract_on_callback {enabled, window_min, count_incoming_answered}`, cancel pending / delete sent via
`deleteMessage`, statuses and journal marks, UI switch in the wizard). Unit tests for every acceptance criterion in
`Plan/12`; on the station — probe events (no real calls are possible there: no providers or phones registered),
real Telegram deletion in the test group.

**STOP — report and wait.**

## Stage 2e — acceptance

Walk through every stage 2 criterion in `Plan/09` and `Plan/12`; mark them with date and how verified
(live / probe / synthetic); update `CHANGELOG.md`; final `m_ApiKeys` proof; confirm the token is nowhere in the repo
(`git log -p | grep` for its prefix is not allowed to print it — check by length/hash only).

**STOP — report and wait.** Stage 3 (MAX) gets its own prompt.
