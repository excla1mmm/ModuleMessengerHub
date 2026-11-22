# Prompt: ModuleMessengerHub — stage 3b (module status sources)

You are continuing development of the MikoPBX module **ModuleMessengerHub** in the repository root (git, branch
`develop`; the repository is public on GitHub, remote `github`). Answer the user in Russian; code, identifiers and
commit messages in English. Task tracker: GitHub issue **#1** of the hub repository ("Source modules: read state via the
uniform /status resource") — read the issue **and its comment**, they are part of this prompt.

## 0. Read first (mandatory)

1. `AGENTS.md`, `CLAUDE.md`, `LOCAL.md` (untracked: station access, local paths). Non-negotiable: never modify Core or
   source modules; the hub reads only their public REST API with its own `read`-only key; hooks stay cheap; idempotency;
   secrets never in REST/logs/codes; **nothing internal in tracked files** (station address, local paths, real chat/bot
   ids, tokens, personal e-mails) — the repository is public.
2. `Plan/02-sources.md` (sources table, Q10/Q11 rows), `Plan/09-roadmap.md` (stage 3b), `Plan/11-open-questions.md`
   (Q10, Q11, Q15), `docs/adding-a-source.md`.
3. Stage 1 module sources to mirror: `Lib/Sources/Modules/*` (`AiWorkerStateSource`, `VaRuntimeSource`,
   `AiAttentionCallSource`), `SourceRegistry::default()`, availability handling, `HubApiKey` / `ApiKeyReconciler`
   (key paths, Q15 in-place updates), templates in `Lib/Routing/Templates/*`, wizard categories in the admin UI.
4. Load `mikopbx-module` before code, `babel-compiler` for JS (no local Docker — local Babel in the scratchpad, same
   targets; say so), `translations` for new keys (Russian first, 29 locales).

## The source contract (implemented in the source modules)

`GET /pbxcore/api/v3/<module-slug>/status` → `PBXApiResult.data`:

```json
{
  "state": "ok | degraded | down | paused",
  "since": 0,
  "issues": [{"code": "worker_offline", "ref": "3f2a9c1d0b7e", "severity": "warning", "since": 1790944800}],
  "counters": {"workers_online": 2, "workers_total": 3}
}
```

- A separate resource: Core lets a key with `read` on exactly this path call `GET` only; no `:actions` exist.
- `issues[].code` from a fixed list, `ref` opaque and stable, `since` stable across polls; `counters` integers only.
- Top-level `since` is `0` when `state = ok` in all modules — **never use it in dedupe keys**.

| Module | Slug | Min. version with `/status` | Codes |
|---|---|---|---|
| ModuleLocalSpeechToText | `module-local-speech-to-text` | 1.154 | `worker_offline` (warning), `backlog_no_workers` (critical, ref `queue`) |
| ModuleCloudSpeechToText | `module-cloud-speech-to-text` | 1.120 | `incident_open` (severity of the incident; ref = incident public id; acknowledged incidents stay open), `processing_paused` (ref `user` or `maintenance`) |
| ModuleCloudAISupervisor | `module-cloud-ai-supervisor` | 1.46 | `processing_paused` with ref = `not_configured`, `manual`, `license_missing`, `auth_invalid`, `model_unavailable`, `daily_limit_reached`, `source_unavailable` (warning), `insufficient_funds`, `low_balance` (critical); `state` is always `paused`, never `down` |
| ModuleAISupervisor | `module-ai-supervisor` | **not released yet** (built on a feature branch; will ship after another feature merges) | `worker_offline` (warning); `state = down` when all workers are offline |

Real answers observed on the test station (anonymised, use as fixtures):

```json
{"state":"down","since":1795153998,"issues":[
  {"code":"backlog_no_workers","ref":"queue","severity":"critical","since":1795153998},
  {"code":"worker_offline","ref":"2df52bb5d7d9","severity":"warning","since":1793262107}],
 "counters":{"workers_online":0,"workers_total":4,"jobs_waiting":4}}
{"state":"ok","since":1791636276,"issues":[],"counters":{"incidents_open":0}}
{"state":"paused","since":1793254951,"issues":[
  {"code":"processing_paused","ref":"source_unavailable","severity":"warning","since":1793254951}],
 "counters":{"jobs_waiting":49}}
```

---

## Stage 3b-1 — generic adapter, events, key (no UI)

1. **`Lib/Sources/Modules/ModuleStatusSource`** — one class, configured per module (module id, slug, source id,
   event-type map per `code` (and per `ref` where needed), severity map, recovery event or none, debounce seconds).
   Registered in `SourceRegistry::default()` for Local STT, Cloud STT, Cloud AI Supervisor, and for AI Supervisor
   (see item 6). Poll cadence like the other module sources (about 60 s).
2. **Availability** exactly like the existing module sources: module not installed / disabled / refuses the key
   (after the key self-heal check) / **`/status` missing (404 — older module version)** → source `unavailable` with a
   readable reason («Обновите модуль до версии N»), no errors in the log, no events.
3. **Diff by (`code`, `ref`)** between polls, stored in `m_MessengerHubSourceState` (cursor). Appearance → event,
   disappearance → recovery event where defined. **Baseline on enable and on the first successful poll after the
   module becomes available**: issues already present are recorded as known, not broadcast (history is not
   broadcast). Dedupe key `<source>:<code>:<ref>:<issue.since>` so a restart or re-poll never duplicates.
   Debounce flapping pairs (e.g. a worker that blinks offline/online) like `core.provider_status`: an issue must be
   present ≥ N s (configurable per code; e.g. 120 s for `worker_offline`, 0 for billing) before the event.
4. **Event types** (keep names from Plan/02):
   - `local_stt.worker_offline` (+ `local_stt.worker_online` recovery, info), `local_stt.backlog_no_workers`
     (+ recovery `local_stt.backlog_resolved`, info);
   - `cloud_stt.incident` (one event per incident `ref`; acknowledging must not re-alert; recovery when it disappears
     — info), `cloud_stt.paused` / `cloud_stt.resumed`;
   - `cloud_ai.paused` / `cloud_ai.resumed`, payload carries the reason code; **`not_configured` produces no
     event at all**, `manual` is `info`, billing/auth/license/limit/model/source are `warning`/`critical` per the
     table above;
   - `ai_supervisor.worker_offline` — same event type and a dedupe key compatible with today's
     `AiWorkerStateSource`, so switching the reader never re-alerts a worker that is already offline.
   Payload: module, code, ref, severity, since, counters snapshot. No free text from the module (there is none).
5. **Hub key**: add `read` on each `/status` path of an installed module (through `ApiKeyReconciler`, in place,
   Q15); never `write`/`admin`. Test the exact path set.
6. **AI Supervisor transition**: its `/status` is not on the station yet. Implement it so the source prefers
   `/status` and **falls back to the current `/workers` reader** (`AiWorkerStateSource`) when `/status` returns 404;
   the key keeps `read` on `/workers` only while the fallback is in use (decide per detected capability, cached, re-
   checked periodically). Dedupe must be identical across both readers. Document that the fallback and the `/workers`
   path will be removed once AI Supervisor ships `/status` (leave a `TODO(#1)`).
7. **Templates** (`Lib/Routing/Templates/*`) for every new event type: short title, module name, what happened in human
   words per code/ref (map codes to texts; never show raw codes as the main text), counters where useful
   («в очереди 49 задач»), time since. Translations (Russian first, 29 locales).
8. **Tests** (`Tests/check-status-sources.php` + registry/key tests): fixtures from the block above plus synthetic
   ones for every code/ref; baseline; appearance/disappearance; debounce; dedupe across restart; `not_configured`
   silent; acknowledged incident no re-alert; 404 → unavailable with reason; fallback switch for AI Supervisor without
   duplicate events; key path set exact.
9. Docs: Plan/02 (rows switch from ⏳ to the `/status` contract, minimal versions), Plan/09 stage 3b,
   `docs/adding-a-source.md` («a module with `/status` is one config entry»), CHANGELOG.

Before every commit: `php Tests/run-all.php`, `php -l` over all PHP (empty), `./scripts/package-module.sh`.
Conventional Commits on `develop`, reference `#1`; `git push github develop`; check CI.

**STOP — report and wait.**

## Stage 3b-2 — UI

1. Wizard «Новое уведомление»: new scenario category for the modules (e.g. «Распознавание речи и облачный ИИ»), with
   per-module rows and the informational statuses already used (module not installed / disabled / needs update /
   refuses access — no action buttons, decisions of Q14).
2. Notifications list and journal show the new events with readable texts; preview bubbles for the new templates.
3. Translations, recompiled JS, Plan/06.

**STOP — report and wait.**

## Stage 3b-3 — station

Test station: Local STT 1.154, Cloud STT 1.120 and Cloud AI Supervisor 1.46 already have `/status`; AI Supervisor
does not yet (fallback path). Install the new hub package; check: each source `available`; baseline — the current
issues (STT workers offline, backlog, Cloud AI `source_unavailable`) produce **no** events on enable; a probe rule
(«[3b probe] …») delivers a synthetic transition (e.g. via a probe event or by toggling a safe condition — never break
the modules on purpose without asking), recovery event, no duplicates after a hub worker restart; the hub key holds
exactly the expected `read` paths (`m_ApiKeys` row of the hub key); AI Supervisor sources still work through the
fallback. Never touch the source modules' settings or workers. Remove only rules you created. Mark stage 3b criteria in
Plan/09; m_ApiKeys proof; CI green.

**STOP — report and wait.** The AI Supervisor `/status` check happens after its next release.
