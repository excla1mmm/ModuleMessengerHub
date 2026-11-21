# Prompt: ModuleMessengerHub — finish stage 1 (event collection)

You are continuing development of the MikoPBX module **ModuleMessengerHub** at
the repository root (git, branch `develop`). Answer the user in Russian;
code, identifiers and commit messages in English.

## 0. Read first (mandatory, before writing code)

1. `AGENTS.md` and `CLAUDE.md` — rules, layout, conventions, verification. The 9 non-negotiable rules apply to
   every line you write. The most important ones:
   - **never modify MikoPBX Core** (the local Core checkout (see `LOCAL.md`) is a read-only reference);
   - **pull model**: never modify source modules (`../ModuleAISupervisor`, `../ModuleVoiceAgent`, …) and never read
     their tables or PHP classes — only their public REST API v3 through the hub API key;
   - Core hooks only record the fact (SourceRecorder) and return — no network I/O inside hooks;
   - idempotency via `dedupe_key`; the first poll of a source only sets a baseline (no history broadcast);
   - secrets (hub API key) never in responses or logs.
2. `Plan/README.md`, then `Plan/02-sources.md`, `Plan/05-events-rules-templates.md`, `Plan/06-rest-api-and-ui.md`,
   `Plan/08-reliability.md`, `Plan/09-roadmap.md` (stage 1 section), `Plan/11-open-questions.md` (decisions).
3. `docs/adding-a-source.md` — checklist you must follow for every source.
4. The existing stage 1.1 code: `Lib/Events/*`, `Lib/Sources/*`, `Lib/Api/*`, `Lib/Settings/HubSettings.php`,
   `Lib/MessengerHubConf.php`, `bin/*`, `Tests/support/bootstrap.php`, `Tests/check-*.php`. Reuse these contracts —
   do not invent parallel ones. If a contract truly needs a change, change it in one place and update the Plan.
5. Load the `mikopbx-module` skill before writing REST resources, workers or UI (stage 1.4).

## Working rules

- Work stage by stage in the order below. **After each stage: run the checks, commit, write a short report
  (what was done, files, test output, what was verified on the station, open questions) and STOP and wait for
  the user's go-ahead.** Do not start the next stage on your own.
- Keep decision logic in Core-free classes with unit checks on SQLite/fixtures (`Tests/check-*.php`, loaded via
  `Tests/support/bootstrap.php`). Keep Core glue thin. Add new tables to the test schema in `bootstrap.php`
  exactly as in the model annotations.
- Fixtures for REST sources: record real (anonymised — no real phone numbers, names, tokens) response bodies from
  the test station into `Tests/fixtures/<source>/*.json` and test parsing against them.
- Every new source: `docs/adding-a-source.md` checklist, register in `SourceRegistry::default()`, list its
  `apiReadPaths()` (Core paths without `/pbxcore`, value is always `read`), add it to the `Plan/02-sources.md` table.
- Every commit: `php Tests/run-all.php` green; `find . -name '*.php' -not -path './vendor/*' -exec php -l {} \;`
  clean; Conventional Commits.
- Test station: access in `LOCAL.md` (not in git). No local Docker. Build `VERSION=1.<n> ./scripts/package-module.sh <dir>`
  (use a new `n` for every install), upload with `files:upload`, install with `modules:installFromPackage`, enable
  with `POST /pbxcore/api/v3/modules/ModuleMessengerHub:enable`. In sqlite3 calls inside `ssh "..."` use
  **single-quoted** SQL literals. CLI probes: PHP script with `require_once 'Globals.php';`, the whole script in
  `try/catch` (an uncaught exception from module code disables the module). Do not leave temporary API keys,
  files or processes behind. Avoid recursive greps over the whole log directory (it is huge and slow).
- Module DB on the station: `/storage/usbdisk1/mikopbx/custom_modules/ModuleMessengerHub/db/module.db`.
- If something in the Plan turns out wrong on the station, record it in `Plan/11-open-questions.md` and ask.

---

## Stage A — Core sources (Plan stage 1.2)

Implement as `Lib/Sources/Core/*Source.php`:

1. **`core.missed_call`** (push, `AmiEventSource` + `SourceInterface` mode push).
   - AMI `UserEvent: CdrConnector`, field `AgiData` encoded by `AsteriskManager::encodeCdrData` (base64 JSON or
     `GZ:` + base64 gzip; see `Core/src/Core/Asterisk/AsteriskManager.php:1886-1925`). Write your own Core-free
     decoder with a unit test; accept only `action = hangup_update_cdr`.
   - Payload fields: read `Core/src/Core/Workers/Libs/WorkerCallEvents/UpdateDataInDB.php:106-128`
     (`GLOBAL_STATUS`, `linkedid`, `src_num`, `dst_num`, `start`, `endtime`, `disposition`, …).
   - Missed-call rules must match Core `WorkerCdr::checkNoAnswerCall()` and neighbours
     (`Core/src/Core/Workers/WorkerCdr.php:498-607`): a linkedid where no leg was answered. Buffer legs per linkedid
     and decide after ~15 s of silence in `tick()`; bounded buffer (drop the oldest entries beyond a cap).
   - Event: type `core.missed_call`, `dedupe_key = missed:{linkedid}`, payload per `Plan/05` (`subject.call`,
     `client_number`, `employees[]` = called internal numbers; direction incoming/outgoing/internal — internal calls
     are recorded with `direction: internal`, filtering happens in rules later).
2. **`core.voicemail`** (push, AMI `UserEvent: voicemail_end`): fields `linkedid`, `vm-recordingfile`, `endtime`
   (see `Core/src/Core/System/RootFS/sbin/voicemail-sender:177-188`). `dedupe_key = voicemail:{linkedid}`; payload
   stores the recording path only as an attachment reference.
3. **`core.provider_status`** (push via Core hook) → event types `core.provider_down` / `core.provider_up`.
   - Implement `public function onProviderStatusChange(array $changeData): void` in `MessengerHubConf`
     (called by Core at `Core/src/PBXCoreREST/Lib/Providers/GetAllStatusesAction.php:344`; payload
     `changes[]: provider_id, type, old_state, new_state, username, host, timestamp`). Map states to down/up
     (decide which `new_state` values mean down — read the Core code, list them in the Plan).
   - Flapping: one event per real transition; suppress repeats for the same provider within a cooldown
     (e.g. 5 min) — design it so the hook stays a single cheap DB write.
   - `dedupe_key = provider:{provider_id}:{down|up}:{timestamp}`.
4. **`core.advice`** (poll): `GET /pbxcore/api/v3/advice` (path for the key: `/api/v3/advice`). Response
   `data.advice` grouped by level with `messageTpl` + params (`Core/src/PBXCoreREST/Lib/Advice/GetAdviceListAction.php`).
   Event on a newly appeared warning/error; cursor = fingerprint set of current items; severity from the level.
   `dedupe_key = advice:{messageTpl}:{hash(params)}:{first_seen_day}` so the same warning can re-alert after it
   disappeared and came back on another day.
5. **`core.pbx_started`** (push via hook `onAfterPbxStarted()` in `MessengerHubConf`),
   `dedupe_key = pbx_started:{boot time}`.

Station verification (report each):
- make a missed call (or replay a recorded `CdrConnector` AgiData through a CLI probe calling the source with a
  fake recorder) → exactly one `core.missed_call` row; an answered call → none;
- `onProviderStatusChange` with a synthetic payload via CLI probe → one down + one up event; repeats suppressed;
- advice poll → baseline first, then events only for new items (you can check with a synthetic fixture if the
  station has no new advice);
- the hub API key now exists in `m_ApiKeys` with description `ModuleMessengerHub (read-only sources)`, contains
  only `{"/api/v3/advice":"read"}`, and the collector reads advice with it (this is the pending check from 1.1).

**STOP — report and wait.**

## Stage B — module sources (Plan stage 1.3)

Implement as `Lib/Sources/Modules/*Source.php`, poll mode, `requiredModule()` set:

1. **`ai_supervisor.attention_call`** — ModuleAISupervisor, `GET /pbxcore/api/v3/module-ai-supervisor/calls`
   with `attention=1` (filter at `../ModuleAISupervisor/Lib/RestAPI/Calls/DataStructure.php:193`), a period window,
   sort, small limit. Items carry `id`, `call_id`, `call_timestamp`, `updated_at`
   (`../ModuleAISupervisor/Lib/Services/SupervisorCallResponseFormatter.php`). A call becomes "attention" after
   analysis, possibly hours after the call — the window and cursor must not miss late analyses and must not emit
   history on baseline. `dedupe_key = ai_attention:{id}`. Payload: everything the client spec of
   `moduleaisupervisor#10` needs later (client number, employee, direction, date/time, duration, reasons, quality
   score, summary, up to 3 evidence quotes with timecodes if the API returns them, `call_id` = linkedid). If a field
   needed for the spec is not in the list response, check the record endpoint (`calls/{id}`); if it is not in the API
   at all, write it into `Plan/11-open-questions.md` — do not read AI Supervisor tables.
2. **`ai_supervisor.worker_offline`** — `GET …/module-ai-supervisor/workers`; event when a worker goes offline
   (and optionally `…_online` on recovery); `dedupe_key = ai_worker:{uid}:{state}:{since}`.
3. **`voice_agent.callback_request`** — ModuleVoiceAgent, `GET /pbxcore/api/v3/module-voice-agent/callbacks`;
   new callback requests only; cursor by id/created time; `dedupe_key = va_callback:{id}`.
4. **`voice_agent.runtime_down` / `voice_agent.runtime_up`** — `GET …/module-voice-agent/runtime`
   (`health`, `agents`); event on state transitions.

Station verification: all four sources `available` with the hub key (paths in `m_ApiKeys.allowed_paths` all `read`);
baseline produced no events; one new attention call / callback (create one if possible, otherwise replay a fixture
through a CLI probe) → exactly one event; disable ModuleVoiceAgent → its sources become `module_disabled`, others keep
working; re-enable → baseline again, no history. Confirm with `git diff` against the source modules that nothing
outside `ModuleMessengerHub` changed.

**STOP — report and wait.**

## Stage C — REST API and UI (Plan stage 1.4)

Follow `Plan/06-rest-api-and-ui.md` **exactly** (agreed schema; do not add resources):

1. `Lib/RestAPI/Settings/` — singleton like Core `mail-settings`: `getList`, `getDefault`, `update` (PUT),
   `patch` (PATCH), custom `getSources` (GET). Fields for stage 1: `hub_enabled`, `events_retention_days`,
   `sources: {<id>: bool}`. Enabling a source resets its baseline (`SourceStateRepository::setEnabled`).
   Secret keys from `HubSettings::SECRET_KEYS` are never returned.
2. `Lib/RestAPI/Events/` — `getList` (filters `event_type`, `source_id`, `severity`, `date_from`, `date_to`,
   `limit` ≤ 200, `offset`; response `{items, pagination{limit, offset, total, has_more}}`) and `getRecord`.
3. Reference implementations: Core controllers (`Core/src/PBXCoreREST/Controllers/MailSettings`, `Cdr`) for
   attributes (`ApiResource`, `HttpMapping` with `collectionLevelMethods`/`resourceLevelMethods`/`customMethods`,
   `ResourceSecurity` LOCALHOST + BEARER_TOKEN) and `../ModuleVoiceAgent/Lib/RestAPI/Settings` for a module-side
   singleton. ModuleUsersUI ACL: admin only, closed by default.
4. OpenAPI texts: every tag/summary/description/parameter/field key in `Messages/en.php` and `Messages/ru.php`
   (validate with the `mikopbx-module` skill script). All 29 locales keep a valid catalog.
5. UI: one admin page (Volt + jQuery + Fomantic UI, no React), sidebar group `integrations`, tabs **Источники**
   (availability, last poll, error, on/off), **События** (paged list, filters, payload view), **Настройки**
   (retention). JS sources in `public/assets/js/src/`, compiled with the `babel-compiler` skill (no local Docker:
   use a local Babel in the scratchpad if needed, targets Chrome 50 / Firefox 45 / IE 11, and say so).
6. Contract checks for both resources: response shapes, pagination bounds, secrets never present, PATCH of an
   unknown source rejected.

Station verification: `GET settings`, `GET settings:getSources`, `PATCH settings` (toggle a source), `GET events`
and `events/{id}` with an admin session and with a restricted key; the page opens, lists sources and events.

**STOP — report and wait.**

## Stage D — stage 1 acceptance

Walk through every criterion of stage 1 in `Plan/09-roadmap.md` on the station, tick the boxes that pass, mark the
stage `✅` with the date and a short note of what was verified, update `CHANGELOG.md`, commit. Anything that does
not pass goes into the report with evidence.

**STOP — report and wait.** Stage 2 (Telegram) gets its own prompt after review.
