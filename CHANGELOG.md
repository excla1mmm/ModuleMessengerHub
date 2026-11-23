# Changelog

## Unreleased

### Fixed
- Module status sources (#1, review): a `since` that moves while a (`code`, `ref`) pair stays present in the
  `/status` answer is one incident (no new event, no new debounce); a new episode starts only when the pair was
  absent in the previous poll. The dedupe key uses the `since` of the first observation of the episode; a pair that
  returns with the same module `since` after an announced episode gets the hub first-seen time as a key suffix.
  Recovery events are sent only for announced incidents (baseline-known pairs and pairs that never passed the
  debounce disappear silently); cursors without the `announced` flag count as not announced.
- Stage 3a-3 (station acceptance): MAX `POST /uploads` returns a CDN host (`*.okcdn.ru`, cert `*.mycdn.me`);
  the upload-host check now accepts `*.max.ru`, `*.okcdn.ru` and `*.mycdn.me`, the bot token is still sent
  only to the API host / `*.max.ru`. A probe source inside the module temp tree is no longer deleted after
  its first conversion (the next chat of the event got `attachment.path_missing`). The converter removes
  scratch files only when they exist (no `SHUTDOWN-ERROR` with a temp path when a worker is stopped).

### Added
- Stage 3b-2 — UI for module status sources: scenario category «Распознавание речи и облачный ИИ»
  (`speech_ai`, after the AI Supervisor group) in the wizard, the notifications list and the journal type
  filter; informational source states without buttons, including «update the module to version N»;
  journal rows and wizard preview bubbles show `/status` events in human words (raw code only in a
  tooltip); 3 new keys in all 29 locales; JS recompiled with a local Babel setup (no Docker).
- Stage 3b-1 — module status sources (no UI, no station yet): one generic `ModuleStatusSource` reads the
  uniform `GET …/<module>/status` of Local STT (1.154+), Cloud STT (1.120+) and Cloud AI Supervisor (1.46+),
  diffs issues by (`code`, `ref`), keeps a silent baseline, debounces flapping (`worker_offline` 120 s,
  billing immediate), de-duplicates by `<source>:<code>:<ref>:<issue.since>` and emits recovery events;
  Cloud AI `not_configured` is silent, a confirmed Cloud STT incident does not re-alert. AI Supervisor
  prefers `/status` and falls back to `/workers` until its release ships it (same event type, same dedupe
  key, `/workers` stays in the hub key only while the fallback is detected; TODO(#1)). A `/status` 404 is
  `api_incompatible` with the minimal version (`update_to`) instead of a log error. Templates and 38 keys
  in all 29 locales; `Tests/check-status-sources.php`.
- Stage 3a-3 — audio attachments accepted on the station (Plan/09): voicemail file and attention-call
  fragments to Telegram (group, private) and MAX (group); `none`, oversize (Telegram 50 MB, MAX 60 min)
  fallbacks; retry sends only the missing part; multi-id retraction; hub key gains/loses `/api/v3/cdr`
  with the rule. README documents what is sent, the privacy switch and the outbound connections.
- Stage 3a-2 — attachments REST and UI (no station yet):
  - rules REST: `options.attachments` is the enum `none | fragments | recording` (default `none`; the
    stage-2 boolean is rejected with 422 `invalid_attachments_mode`). `recording` needs a voicemail or
    attention-call event type in the rule, `fragments` an attention-call type (voicemail has no fragments:
    a voicemail-only rule says `recording`); other event types accept only `none`
    (`attachments_not_supported`, 422). PATCH validates the effective combination (stored event types +
    sent options); wildcards count through the event-type matcher;
  - a rule create/update/delete applies the hub-key path set at once (`/api/v3/cdr` appears with the first
    enabled attention-call audio rule and goes with the last) through the shared `ApiKeyReconciler`, also
    used by the settings PATCH; the collector reconciles the same set every minute;
  - rule wizard step 3: «Прикладывать запись» (none / fragments with quotes / whole conversation; voicemail:
    none / recording) only for audio-capable events, a privacy hint, and an audio bubble in the preview;
  - journal: each delivery shows the recording state in words (sent / replaced by a note / skipped / not
    sent + reason); the raw code is only in a tooltip; `deliveries[].attachment` is documented in Plan/06;
  - uninstall: `PbxExtensionSetup::uninstallModule` deletes the hub's key record in Core `m_ApiKeys` for a real
    uninstall (not on a package update, where Core passes `keepSettings = true`); a failure is logged as a code
    and never fails the uninstall;
  - 27 new translation keys in all 29 locales; `Tests/check-rules-rest.php`, `Tests/check-uninstall.php`.
- Stage 3a-1 — attachments backend (decisions and code, no UI/station; Plan/03, Plan/05):
  - decisions: voicemail carries its file; `ai_supervisor.attention_call` carries fragments around its
    (up to 3) quotes by default and the whole conversation only by an explicit rule option;
    `core.missed_call` never carries audio (its `recordingfile` is IVR/greeting, not the customer);
  - `ai_supervisor.attention_call` recording comes from the public Core REST v3 by `linkedid`
    (`recording_access.cdr_id` when AI Supervisor reports it) — the hub key gains read-only
    `/api/v3/cdr`; AI Supervisor tables/files are never read;
  - `PathGuard`: `realpath()` inside `AST_MONITOR_DIR`/`voicemailarchive` (Core constants), symlink/
    traversal/missing/empty rejected with `attachment.path_*`; a `probe=true` event may only use the
    module probe directory;
  - `Converter`: ffmpeg -> sox -> sox+lame, mono 32 kbps MP3, fragments cut in one pass, `proc_open`
    argument arrays (no shell), `nice`, hard timeout with SIGTERM/SIGKILL, output only in the module
    temp dir (0700); missing tools degrade to text (`attachment.converter_missing`);
  - rule option `options.attachments` = `none|fragments|recording`, default `none` for new and existing
    rules (legacy `true` reads as `none`); the plan is frozen in `attachment_json` at routing time;
  - delivery is text first (never delayed by audio), then audio parts, then an optional short fallback
    note; per-part progress in `delivery_parts_json` means a retry never re-sends the text or a sent
    part; a long conversion extends the row lease and the per-event cache (`cache_key`) is shared by all
    chats; MAX `attachment.not.ready` reuses the same upload token (5/10/20 s), Telegram 413 / MAX size
    errors skip only that part and the row is still `sent`;
  - retraction deletes every stored id (text + parts + note), one rate reservation per delete, with
    `retract_progress_json` (done/left) and `retract_failed` without endless retries;
  - new `m_MessengerHubPreparedRecordings`, tests `Tests/check-attachments.php`, extended delivery,
    retraction, Telegram and MAX checks; 29 locales.
- Stage 3d — MAX accepted on the test station (21.11.2026, packages 6.0/6.1, live bot and real chats):
  - the shipped Минцифры root CA reaches MAX (`GET /me` ok); a broken `max_ca_bundle_path` falls back
    with `ca_override_rejected`; a wrong CA bundle fails closed with `max.tls.untrusted_ca`, the bot
    becomes `ca_error` and the row is tried exactly once; TLS verification was never disabled;
  - discovery found a group (`bot_added`, title from `GET /chats`) and a dialog (`bot_started`), test
    and probe messages arrive in every chat, an event matching a Telegram rule and a MAX rule reaches
    both, and a broken MAX does not delay Telegram;
  - MAX counts the 4000-character limit over the whole `text` string including markup (4004 and 4010
    were rejected with `proto.payload`), so the renderer's escaped-block measure is what keeps us
    inside; a 3967-character attention call with three quotes, line breaks, id and button arrived;
  - the real Q9 codes are in place: a bot removed from a chat answers `404 error.not.found`
    (now mapped to `recipient_gone`, it used to be `permanent max.404.unknown`) and a user who blocked
    the bot answers `403 chat.denied` with `error.dialog.suspended`; both mark the chat `gone` and
    drop its queue without retries;
  - a webhook subscription does **not** make `GET /updates` answer 405 — it returns 200 with an empty
    page, so the first empty page of a discovery session is checked against `GET /subscriptions` and
    becomes `max.405.webhook_set` (the 405 path is still mapped);
  - the callback retraction deletes the MAX message for real (`retracted`,
    `resolved_after_send`); the delete age limit is still unknown (the test bot has no message older
    than a day), which the rule hint states;
  - fixtures for the live responses (me, send, chat, blocked bot, removed bot, over-long text,
    subscriptions, empty updates) replace the documentation-only ones, and `Plan/03`, `Plan/09`,
    `Plan/11` (Q9 closed), `Plan/10`, `README*` and the fixtures README record the results.
- Stage 3c — MAX in REST and the admin UI (Plan/06, Plan/09):
  - `bots` accepts `channel: max`: create/patch/delete, `:checkToken`, `:discoverChats`, `sendTest` and
    `token_hint` behave exactly like Telegram; the MAX token shape is not documented, so it is checked
    only as a header-safe opaque line;
  - bot status `ca_error`: a TLS trust failure (`max.tls.untrusted_ca`) is its own state with the
    `max_ca_bundle_path` pointer in the UI; a successful send returns the bot to `ok` (`markBotOk`);
  - discovery reads a group/channel title with one `GET /chats/{chatId}` on `bot_added`; a failed
    lookup leaves the title empty and never breaks the session; a title set by an admin is not
    overwritten;
  - UI: `SAVABLE_CHANNELS` includes `max`, the MAX modal explains where the token comes from
    (business.max.ru, moderation up to 48 h), the connect-chat hint («нажмите "Начать" или добавьте
    бота в группу»), the webhook hint for `max.405.webhook_set` (`DELETE /subscriptions`), the
    `ca_error` state, the wizard preview in the MAX variant for a rule that targets a MAX bot, and the
    retraction hint that MAX does not document its delete age limit; 29 locales updated.
  - The shipped НУЦ Минцифры bundle is now the Root CA only (the server sends the Sub CA), so its
    2027 rotation needs no module release; the fingerprint is pinned and an extra certificate in the
    file is rejected;
  - «Общие» has the MAX certificate path (`max_ca_bundle_path`, absolute path or empty for the built-in
    root), so the `ca_error` hint points at a real field;
  - a saved bot's channel is immutable in `:checkToken` too (a `channel` in the body is rejected):
    otherwise the token of one messenger would be sent to the other one.
- Stage 3b — MAX channel without UI (Plan/03, Plan/09):
  - `Lib/Channels/Max/MaxApi.php` (GET /me, GET /updates, POST /messages, DELETE /messages,
    stage-3a upload hooks) and `MaxChannel` by the same `ChannelInterface`;
  - `MaxMarkup`: `format: html` with every data field escaped, the shared 4000-char truncation rule
    (longest paragraph shortened, id line and button kept), `link` buttons only http(s), text ≤ 128,
    URL ≤ 2048;
  - discovery from `bot_added` / `bot_started` with a marker cursor; `bot_removed` / `user_removed`
    never create a chat; a private dialog is stored by its MAX user id and sent with `?user_id=`;
  - error classification `sent | retry(after) | permanent | recipient_gone` with `max.<http>.<reason>`
    codes, HTTP 200 + `success:false`, `attachment.not.ready`, and `max.tls.untrusted_ca` for a TLS
    failure (permanent, never retried forever);
  - the official НУЦ Минцифры root+sub CA ships with the module (`Lib/Channels/Max/certs/`), pinned by
    SHA-256 and built into a system+bundle file for the MAX transport only; `max_ca_bundle_path`
    overrides it; TLS verification is never disabled;
  - `Tests/check-max-channel.php` and `Tests/fixtures/max/` (built from the documentation — no live
    bot yet, see the fixtures README).

### Changed
- `Lib/Channels/ChannelFactory.php` is the single place that builds channel adapters and their
  transports, used by `Bots/Processor`, `WorkerMessengerHubDelivery` and `WorkerMessengerHubDiscovery`
  (replaces three hand-built registries); both channels honour `proxy_url`, only MAX gets a CA bundle.
- `HttpTransport` passes per-channel headers (the MAX token goes into `Authorization` only, never into
  a URL or a log) and keeps the numeric `Retry-After` of a 429; the 429 `retry_after` is honoured.
- The truncation rule moved to `Lib/Channels/TextTruncator.php`, shared by Telegram and MAX.
- `Plan/03-channels.md`: MAX section re-verified against dev.max.ru and the official OpenAPI schema on
  21.11.2026, with the CA decision, the pinned fingerprints and the response → `SendResult` table;
  `Plan/11` Q9 lists what is confirmed and what still needs the live bot.
- Stage 2e — acceptance of stage 2 (Telegram), 20.11.2026:
  - every stage-2 criterion in `Plan/09` and every `Plan/12` acceptance criterion is marked with the
    check date and the verification method (live on the station / probe / synthetic); the station has
    no registered providers or phones, so there were no live calls — this is stated explicitly;
  - `README.md` / `README.ru.md`: status "stage 2 (Telegram) — accepted", what the module can do and
    a step-by-step "connect a Telegram bot" guide for the administrator;
  - bot token scan over the whole git history and the working tree: only `123456789:AA…` test
    fixtures in three test files, no real token anywhere.

### Added
- Stage 2d — delete the missed-call notification when the client was called back (Plan/12):
  - `core.missed_call_resolved` from the AMI CdrConnector stream: an answered outgoing callback always
    counts, an answered incoming client call counts by the rule switch; numbers compare by the last
    10 digits; the recent-missed index is restored from the journal at worker start;
  - rule option `retract_on_callback {enabled, window_min 5–120, count_incoming_answered}` validated
    by the API; the wizard shows the switch, the window and the nested client-call switch; the rule row
    notes "delete after a callback within N min";
  - queued deliveries become `cancelled` (never sent), sent ones are deleted through the channel,
    every external message id (text + attachments) is removed; `retracted` / `retract_failed` with
    retries and channel limits, a gone bot ends as `retract_failed` without endless retries;
  - journal deliveries show "Not sent — client was called back" / "Deleted — client was called back"
    with the callback time and employee; the deleted bot/chat history stays readable;
  - contract checks for every acceptance criterion in Plan/12 (detection, window, NOANSWER, phone
    formats, cancel before send, deletion of text and attachments, gone bot, retry, no option).
- Stage 2c — notifications (rules), the three-step wizard and the delivery column:
  - `rules` resource: CRUD, `getDefault`, `changePriority`; filters per the stage-2 decisions
    (employees, direction, providers, quality score for attention calls); no preview-matches method;
  - «Уведомления» tab: fixed category order, informational source states without action buttons,
    toggle, «…» menu (edit/delete), last event time, 30-second self-refresh, empty/loading/error states;
  - the wizard: scenario → conditions → recipients with a live Telegram preview, no "would match N"
    hint; unavailable scenarios are visible but inactive with the reason only;
  - journal: «Отправка» column and per-chat deliveries in the expanded row, `POST events/{id}:retry`
    for failed deliveries, deleted bots/chats shown as «Бот удалён» via LEFT JOIN;
  - probe events are marked in the journal and in the delivered message;
  - contract checks for rules, deliveries and retry.
- Stage 2b — bots REST resource and «Настройки → Мессенджеры»:
  - `bots` resource: getList/getRecord/getDefault/create/update/patch/delete, custom `checkToken`
    (a candidate token can be checked without saving), `discoverChats` (start/restart/stop of the
    5-minute session) and `sendTest` (a `hub.test` event through the Outbox, per-chat results);
  - token is write-only: every response is built by one serializer, `token_hint` is the only
    token-derived value; contract checks scan responses recursively;
  - chats nested in the bot record, edited through PATCH (enable/disable, `linked_user_id`, manual
    `chat_id`); discovered chats start disabled until the admin selects them;
  - `WorkerMessengerHubDiscovery`: `getUpdates` runs in a worker while a session is active, never in
    a REST request; states running / found / expired / empty / error (webhook conflict included);
  - settings stage-2 fields `pbx_public_url`, `mask_phone_default`, `proxy_url`,
    `max_ca_bundle_path` with validation, and the «Общие» UI for them;
  - «Настройки → Мессенджеры» per the design: bot cards with statuses, add/edit/delete, token check
    and replacement, connect-chat modal with countdown and found-chat selection, test results per
    chat with retry, empty/loading/error states; MAX card shown disabled with the «скоро» hint;
  - Q16 closed: the attention-call button opens the AI Supervisor call card
    (`?ais_screen=calls&ais_card=<ref_id>`); missed calls keep the Core CDR journal (no URL search);
  - 147 new keys in all 29 locales (`ru` is the source; OpenAPI keys are English outside ru/en).
- Stage 2a — delivery pipeline and the Telegram channel (no UI yet):
  - models `Bots`, `BotChats` (chats nested under a bot, UNIQUE `bot_id+chat_id`), `Rules`, `Outbox`
    (UNIQUE `event_id+chat_id`, all external message ids as JSON, statuses for stage 2d),
    `DiscoverySessions`;
  - self-healing hub key (Q14): a 401/403 on a path the key must read triggers a local diagnosis
    (record ours / secret matches its bcrypt hash / `allowed_paths` exact), an in-place path update or a
    full recreate, and one retried poll; repairs are rate-limited to one per 5 minutes per reason and
    logged as a code. Only a verified-healthy key leaves a source in `api_forbidden`
    («Модуль не даёт доступа к данным»);
  - `ChannelInterface` + `SendResult` (`sent | retry | permanent | recipient_gone`), `ChannelLimits`,
    `HttpTransport` (TLS always on, optional proxy, short timeouts, never logs URLs/headers/bodies) and
    the Telegram adapter (`getMe`, `getUpdates` for the 5-minute discovery, `sendMessage` with HTML and
    inline url buttons, `deleteMessage`, `sendAudio`/`sendDocument` hooks for stage 3a, 429/403/400
    migration mapping; anonymised fixtures in `Tests/fixtures/telegram/`);
  - Router: enabled rules → recipients (selected chats / the employee's linked chat / employee-or-chats)
    → `RenderedMessage` per event type (all stage-1 events, attention calls per the client spec with
    quality score, reasons, summary, up to three timecoded quotes, call id and «Открыть звонок») →
    outbox rows; phone masking at render time; `hub_enabled = 0` records events without sending;
  - `DeliveryService`, `RetryPolicy` (10 s … 2 h, then failed), `RateLimiter` (per chat/group/bot),
    leasing with stale-lease reclaim, one retry for an unknown outcome, `recipient_gone` drops the chat's
    queue, stale `info` rows older than 24 h are dropped;
  - `WorkerMessengerHubDelivery` (`CHECK_BY_BEANSTALK`, own wake-up tube, router + sender) and delivery
    wake-ups from the collector; 15 message-template keys in all 29 locales.
- Stage 0 skeleton: installable empty module, settings model, translation catalogs (29 locales),
  package script, contract checks, CI.
- `Plan/`: architecture, event sources (pull model), Telegram and MAX channels, data model, rules, REST API,
  security, reliability, roadmap, testing, open questions.
- Agent docs: `AGENTS.md`, `CLAUDE.md`, `docs/adding-a-source.md`, `docs/adding-a-channel.md`.
- Stage 1 — event collection (no delivery yet):
  - models `Events` (UNIQUE `dedupe_key`) and `SourceState` (cursor, availability, baseline);
  - `HubEvent`, `EventStore` (dedupe on insert), `SourceInterface`, `SourceRegistry`, `SourceAvailability`,
    `SourceRecorder`, `SourceStateRepository`, secret-free module logger;
  - core sources: `core.missed_call` (AMI `CdrConnector`, linkedid buffering with 15 s silence),
    `core.voicemail` (AMI `voicemail_end`), `core.provider_down/up` (Core hook + 120 s debounce),
    `core.advice` (poll with fingerprint cursor), `core.pbx_started` (hook, per boot);
  - module sources: `ai_supervisor.attention_call`, `ai_supervisor.worker_offline/online`,
    `voice_agent.callback_request`, `voice_agent.runtime_down/up` — public REST API v3 only,
    baseline-first, no history broadcast;
  - `WorkerMessengerHubCollector` (poll + key sync + retention) and `WorkerMessengerHubAmi`
    (push sources, internal-number map from Core models, read-only);
  - REST resources `settings` (getList/getDefault/update/patch/getSources) and `events`
    (getList with filters/pagination ≤ 200, getRecord), admin-only, secrets never returned;
  - admin page «Уведомления / Журнал / Настройки» (Volt + jQuery + Fomantic UI), journal works,
    «Уведомления» shown as design empty state until stage 2.

### Fixed
- Telegram sends answered 400 Bad Request: `HttpTransport` merged its curl options with `+`, so the
  `Content-Type: application/json` of a JSON POST lost against the default `Accept` header and the
  body went out as form-urlencoded. The merge order is fixed and covered by a local HTTP server
  regression check (`Tests/check-http-transport.php`). `curl_close()` (deprecated in PHP 8.5) is gone.
- A group migrated to a supergroup is no longer added twice: when discovery saw both the old basic
  group and its new supergroup, a send to the stale id hit the unique index. The stale duplicate row
  is now dropped together with its queue (`chat_migrated`) and removed from the bot record.
- `core.advice` no longer re-alerts long-known warnings after a PBX restart: vanished fingerprints are kept
  for 7 days with their last-seen date, an empty/incomplete advice payload is "no information" and leaves the
  cursor untouched, the cursor is capped (absent entries evicted first) and the old cursor format is migrated
  silently.
- `HubApiKey` docblock: the key is revoked (not deleted) when the module is disabled.
- The hub API key keeps its id and secret when the enabled-path set changes: `allowed_paths` is
  rewritten on the existing Core record (Q15) instead of delete+recreate, `TokenValidationService`
  cache is dropped, and a settings PATCH applies the new path set immediately — no more transient
  `api_forbidden` right after enabling a source.
- A module disable no longer deletes the key: it strips `allowed_paths` on the same record
  (deny-all for a non-privileged key), so package updates go through disable → replace → enable
  without changing the key id; provider transitions use debounce so a recovery is never swallowed.
