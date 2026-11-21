# Prompt: ModuleMessengerHub — stage 3 (MAX)

You are continuing development of the MikoPBX module **ModuleMessengerHub** at
the repository root (git, branch `develop`). Answer the user in Russian;
code, identifiers and commit messages in English.

Stage 2 (Telegram) is accepted (20.11.2026, package 5.0), the v3 admin UI is committed (`0b6615d`).
Stage 3 adds the **MAX** channel through the same `ChannelInterface`. No new REST resources (Plan/06:
«Этап 3 (MAX) ресурсов не добавляет — только `channel: "max"` в `bots`»). Attachments are stage 3a — do not
build uploads to MAX now beyond what the contract needs.

## 0. Read first (mandatory)

1. `AGENTS.md`, `CLAUDE.md`. Non-negotiable: never modify MikoPBX Core or source modules; secrets (bot tokens,
   hub API key) never appear in REST responses, logs, error codes, exceptions or test output.
2. `Plan/03-channels.md` (MAX section + «Реализация этапа 2» for the Telegram pattern), `Plan/06` (bots, settings
   `max_ca_bundle_path`, «MAX в этапе 2»), `Plan/07`, `Plan/08`, `Plan/09` (stage 3), `Plan/11` (Q9),
   `Plan/12-callback-retract.md` (MAX row), `Plan/design-v3-backend-gaps.md` item 5.
3. `docs/adding-a-channel.md` — follow the checklist literally.
4. Stage 2 code to mirror: `Lib/Channels/Telegram/*` (`TelegramApi`, `TelegramChannel`, `TelegramHtml`),
   `HttpTransport` (already accepts `caBundlePath`), `ChannelRegistry`, `Lib/Delivery/*` (`RateLimiter`,
   `RetryPolicy`, `RetractionService`), `Lib/RestAPI/Bots/Processor.php` (`channel_not_available`),
   `bin/WorkerMessengerHubDelivery.php`, `bin/WorkerMessengerHubDiscovery.php`,
   `public/assets/js/src/module-messenger-hub-index.js` (`SAVABLE_CHANNELS`), tests
   `Tests/check-telegram-channel.php`, `Tests/check-bots-rest.php`, `Tests/fixtures/telegram/`.
5. Load the `mikopbx-module` skill before REST/UI work; `babel-compiler` for JS (no local Docker — local Babel in the
   scratchpad, say so); `translations` skill for new keys (Russian first, 29 locales).

## Station and safety rules (unchanged — mandatory)

- Test station: access in `LOCAL.md` (not in git). Working rules from `docs/agent-prompts/stage-1-continuation.md`
  («Working rules»): new package version per install, resumable `files:upload`, `modules:installFromPackage`,
  single-quoted SQL inside `ssh "..."`, CLI probes with `require_once 'Globals.php';` inside try/catch, cleanup.
- Never create Core API keys with `full_permissions=1`; temporary REST keys carry only the tested paths and are
  deleted afterwards. Never change the station admin password or other credentials.
- End of every station session: `select id,description,full_permissions from m_ApiKeys where id>=232` in the report.
- **MAX bot token:** the user provides it. A MAX bot is created by the client on business.max.ru after moderation —
  the user may not have one yet. When you reach the first step that needs a live token, STOP and ask. Never commit
  it, never write it into repo files, never print it. The test group/chat in MAX is provided by the user too.
- **TLS:** the station fails TLS to `platform-api2.max.ru` (no НУЦ Минцифры root CA). **Never** disable
  verification (`CURLOPT_SSL_VERIFYPEER=false`, `-k`, etc.), not even "temporarily for a test".

## Stage 3a-prep — verify facts before code

The MAX table in `Plan/03` was collected 18.11.2026 and is partly unverified. Before writing the client:

1. Re-read the official docs (links at the end of `Plan/03`): base URL, auth header, `GET /me`, `GET /updates`
   (params `marker`, `timeout`, `types`; events `bot_added`, `bot_started`, `bot_removed`, `user_removed`,
   `message_created`), `POST /messages` (`chat_id` vs `user_id`, `format`, 4000 limit, `inline_keyboard` with
   `link` buttons), `DELETE /messages` (age limit), error body shape (`code`, `message`; HTTP 200 with
   `success:false`), rate limits and 429 semantics, and whether a webhook subscription blocks `GET /updates`
   (analogue of Telegram `webhook_set`).
2. Update the MAX section of `Plan/03` with the date checked; mark what is still unconfirmed and must be checked on
   the live bot (Q9: bot removed from chat, user blocked the bot, can the bot write first, rights in groups).
3. **Root CA.** Decide how the Минцифры root (and intermediate, if needed) reaches curl:
   - preferred: ship the official PEM inside the module (`Lib/Channels/Max/certs/` or `resources/`), build a bundle
     = system CA + Минцифры root at runtime into the module's tmp dir (or pass the module PEM via `CURLOPT_CAINFO`
     only for MAX requests — check that this does not break the chain), with SHA-256 fingerprint pinned in code and
     verified at load;
   - `max_ca_bundle_path` from settings overrides the shipped file (already validated in `Settings/Processor`);
   - document the source URL and fingerprint of the certificate in `Plan/03`; check the license allows shipping it.
   Telegram and the Core trust store must stay untouched (the bundle is passed only to the MAX transport).

**STOP — report the verified facts, the CA decision and open questions; wait.**

## Stage 3b — MAX channel (no UI)

1. One place that builds channels: a `ChannelFactory` (or `ChannelRegistry::default(HubSettings)`) used by
   `Bots/Processor`, the delivery worker and the discovery worker — replaces the three hand-built registries.
   Telegram gets the plain transport, MAX gets a transport with the CA bundle; both honour `proxy_url`.
2. `Lib/Channels/Max/MaxApi.php` — `me`, `updates` (discovery sessions only), `sendMessage`, `deleteMessage`,
   hooks for `uploads` (stage 3a). Token only in the `Authorization` header (no `Bearer`); `HttpTransport` needs a
   way to pass extra headers — add it without logging them. Base URL injectable for tests.
3. `MaxChannel` (`checkToken`, `discoverChats`, `send`, `delete`, `limits`) and `MaxMarkup` (RenderedMessage →
   MAX `html` or `markdown` — choose and justify; escape every data field; 4000-char limit with the same
   truncation rule as Telegram: shorten the longest paragraph, keep the ID line and the button; `link` button text
   ≤ 128, URL ≤ 2048, only `http(s)`).
4. Discovery: `bot_added` → group chat, `bot_started` → private dialog (store `chat_id` and, if the API needs it,
   `user_id`; decide which one `send` uses for private dialogs and document it). Marker-based cursor in
   `DiscoveryCursor`. `bot_removed`/`user_removed` seen during discovery do not create chats.
5. Result mapping to `sent | retry(after) | permanent | recipient_gone` with codes `max.<http>.<reason>`:
   rate limit (`retry_after` if MAX gives one, else `RetryPolicy`), unauthorized token, chat not found, bot removed /
   blocked (exact codes from the live bot — until confirmed, map conservatively and leave a `TODO(Q9)` test),
   `attachment.not.ready` (retry with growing pause — hook for 3a), HTTP 200 + `success:false`, malformed JSON,
   `http.tls`. A TLS failure must show a clear code `max.tls.untrusted_ca` (or similar) that the UI explains.
6. `delete`: idempotent like Telegram (message already gone = success); age limit → `retract_failed` with a code.
7. `limits()`: ≤ 2 msg/s per chat, ≤ 30 rps per bot (shared host limit) — `RateLimiter` must enforce them.
8. Fixtures in `Tests/fixtures/max/` (anonymised; until the live bot exists, built from docs and marked as such in a
   README there) and `Tests/check-max-channel.php`: markup/escaping/truncation, every mapping branch, discovery,
   delete idempotency, token never in `SendResult`/exceptions/logs (scan), Authorization header never logged,
   CA bundle used only by MAX. Register in `Tests/run-all.php`.

**STOP — report and wait.**

## Stage 3c — REST + UI

1. `Bots/Processor`: accept `channel: max` (drop `channel_not_available` for MAX); `checkToken`/`discoverChats`/
   `sendTest` work for MAX; `token_hint` rule identical; contract tests extended in `Tests/check-bots-rest.php`
   (every endpoint, both channels, token never returned).
2. UI: `SAVABLE_CHANNELS` gets `max`; the MAX tile/modal per `docs/design/ModuleMessengerHub-v3.html`: token help
   (business.max.ru, moderation up to 48 h), «Подключить чат» hint «нажмите "Начать" или добавьте бота в группу»,
   TLS error state with a short explanation and the path setting. Message preview in the wizard: show the MAX
   variant when the rule targets MAX chats (or explain why one preview is enough). Recompile JS.
3. Wizard «Удалять, если перезвонили»: works for MAX chats; if the MAX age limit is shorter than the rule window,
   say it in the hint.
4. Translations (Russian first, 29 locales; all OpenAPI keys in `en.php` and `ru.php`).
5. `Plan/design-v3-backend-gaps.md` item 5 — mark done.

**STOP — report and wait.**

## Stage 3d — station + acceptance

Ask the user for the MAX bot token and test chats first. Then, on the station:

1. TLS: without the bundle → clear `max.tls…` error, nothing retried forever; with the shipped CA → `GET /me` ok;
   verification still on (prove with a wrong bundle → fails).
2. Bot connects by token; invalid token → clear error.
3. «Подключить чат» finds a group (`bot_added`) and a private dialog (`bot_started`).
4. Test message and probe events arrive by rules; one event → one message per chat; Telegram and MAX chats in one
   rule both receive it; a dead MAX does not delay Telegram (rule 9).
5. Bot removed from the group / user blocked the bot → record the **real** codes into `Plan/03` and `Plan/11` Q9
   (close Q9), recipient `gone`, no endless retries.
6. «Удалять, если перезвонили» on MAX — real deletion in the test group; record the age limit.
7. Token nowhere: DB, logs, `/tmp`, `/root`, REST, git history (check by length/hash, never print it).
8. Mark stage 3 criteria in `Plan/09` (live / probe / synthetic + date), update `CHANGELOG.md`, `README*.md`
   («как подключить бота MAX»), final `m_ApiKeys` proof.

Before every commit: `php Tests/run-all.php`, `php -l` over all PHP, `./scripts/package-module.sh`. Commits on
`develop`, Conventional Commits. Review defaults from `AGENTS.md`: `module-security-reviewer` (token, TLS, logs),
`queue-resilience-reviewer` (retries, rate limits), `module-contract-guardian` (bots REST), `admin-ui-reviewer`.

**STOP — report and wait.** Stage 3a (attachments) gets its own prompt.
