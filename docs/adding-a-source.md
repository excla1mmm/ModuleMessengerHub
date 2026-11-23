# Adding an event source

A source turns facts from Core or another module into normalised hub events. Spec: `Plan/02-sources.md`,
event format: `Plan/05-events-rules-templates.md`.

## Checklist

1. **Find a public interface.** Core: AMI UserEvent, a `ConfigClass` hook Core calls by name, or Core REST API v3.
   Module: its REST API v3 (read `Lib/RestAPI/*/DataStructure.php` and its OpenAPI). If the data is only in the
   module's tables or classes — stop and add a question to `Plan/11-open-questions.md`; do not read them.
2. **Pick a mode.**
   - push: AMI event (handled in `WorkerMessengerHubAmi`) or Core hook (implemented in `MessengerHubConf`,
     must only record the raw fact).
   - poll: implement `poll()` with a cursor; choose an interval (default 30–60 s).
3. **Class**: `Lib/Sources/Core/<Name>Source.php` or `Lib/Sources/Modules/<Module><Name>Source.php`
   implementing `SourceInterface`; register it in `SourceRegistry`.
4. **Event type**: `<source>.<event>` (e.g. `voice_agent.callback_request`); add it to the catalog in
   `Plan/02-sources.md` and a template in `Lib/Routing/Templates/`.
5. **dedupe_key**: built from stable identifiers of the source (linkedid, record id, state + since) —
   never from poll time.
6. **Baseline**: the first poll after enabling only stores the cursor; no events for history.
7. **Availability**: module installed → enabled → API answers with a compatible contract → last poll ok.
   Missing module = `module_missing`, not an error.
8. **Translations**: event type title and template strings in `Messages/ru.php` first, then all locales.
9. **Tests** (`Tests/check-source-<name>.php`): fixture responses → expected events; repeated poll → no new
   events; baseline; unavailable module.
10. **Docs**: update `Plan/02-sources.md` (stage, how it is read) and README event list.

## Attachments

A source may add facts to `payload.attachments` (Plan/05) — never the audio itself:

- `{"kind":"recording","path":"…"}` only for a local file the hub is allowed to read (a Core recording root);
- `{"kind":"recording","source":"cdr","linkedid":"…","cdr_id":123}` when the recording is resolved through
  the public Core REST v3 (the hub downloads it later).

A `probe=true` event may only point at the module's own `<module>/tmp/probe`. Never put a playback token, a
copy of the audio or a path from another module's internal storage into the event.

## A module problem is one config entry

A kind of module problem (Plan/02, GitHub issue #1) needs no adapter class: add one entry to
`ModuleStatusSource::PROFILES` in `Lib/Sources/Modules/ModuleStatusSource.php`. Where the state comes
from is the `reader`:

- `status` — the module serves the uniform `GET …/<module-slug>/status` (today only ModuleCloudSpeechToText,
  1.120+). Preferred when you control the module.
- a module that does not ship `/status` is read through its **existing** resource: write a small pure class
  that turns the answer into the status snapshot (`state`, `since`, `issues[code, ref, severity, since]`,
  `counters`) next to `AiWorkerStateSource`, `CloudAiRuntimeSnapshot`, `LocalSttSnapshot`, and add a reader
  kind to `ModuleStatusSource::readSnapshot()`. Use an opaque stable `ref`, the module's own notion of "offline"/
  "paused", and a `since` that does not move while the problem lasts. Never read names, addresses, paths or
  free text; never log bodies.

```php
'my_stt.workers' => [
    'module' => 'ModuleMyStt',                 // moduleUniqueID for availability
    'reader' => self::READER_STATUS,           // or a reader kind of your own
    'paths' => ['/api/v3/module-my-stt/status'], // what the hub key must hold (without /pbxcore)
    'min_version' => '1.20',                   // shown as "update the module to N" on 404; '' when unknown
    'rules' => [
        ['code' => 'worker_offline', 'event' => 'my_stt.worker_offline',
         'recovery' => 'my_stt.worker_online', 'severity' => 'warning', 'debounce' => 120],
    ],
],
```

The generic adapter already gives you: baseline on enable and after an unavailable module, diff by
(`code`, `ref`), debounce, dedupe `<source>:<code>:<ref>:<episode since>`, recovery events, counters in
the payload and `api_incompatible` on a 404. The key level of each path is decided by `Lib/Api/KeyPermissions`
(`read` for everything; `admin` is allowed only for the two Local STT paths that the module demands it for —
Plan/07; a new `admin` path needs a written reason there). What you still add:

1. event type names in `SourceCatalog` (group, source name, event type keys) and `Messages/*.php`
   (Russian first, all locales);
2. a template entry in `TemplateRegistry` (reuse `ModuleStatusTemplate` when the code fits its maps,
   otherwise extend it — a code/ref must never reach the message as raw text);
3. fixtures with the real (anonymised) answers of the resource you read (`/status` fixtures live in
   `Tests/fixtures/modules-status/`; native shapes are built in `Tests/check-status-sources.php`) and checks
   there, including compatibility with cursors written by the previous reader (no re-alert).

One source is one wizard scenario, so a module with several kinds of problems gets several entries that
poll the same resource and list only their own codes (see the table in Plan/02: `local_stt.workers` and
`local_stt.backlog`). Keep a problem and its recovery in one entry. A 404 on the resource is
`api_incompatible` (with the `min_version` when the entry has one). Prefer `read`; do not ask for `admin`
unless the module leaves no other way and the risk is written into Plan/07. When you rename or split
a source id, add the old id to `SourceIdMigration::LEGACY_SOURCES` so the enabled switch carries over and the
new sources baseline silently.
