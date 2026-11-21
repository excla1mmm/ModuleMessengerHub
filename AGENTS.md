# ModuleMessengerHub — notes for AI agents

## Project shape

`ModuleMessengerHub` is a MikoPBX extension module (PHP 8.4, Phalcon 5, min PBX 2025.1.1) that **collects**
events from MikoPBX Core and from other installed modules and delivers notifications to messenger bots
(v1: Telegram and MAX). Pipeline: Sources (collectors) → Event store (dedupe) → Router (rules, recipients,
templates) → Outbox → Delivery (channel adapters).

The behaviour spec lives in `Plan/` (Russian). Read `Plan/README.md` first, then the file for the area you
touch. `Plan/09-roadmap.md` says which stage is current; do not build later-stage features early.

## Non-negotiable rules

1. **Never modify MikoPBX Core** (https://github.com/mikopbx/Core or the PBX filesystem). Use only what Core
   already offers modules: `ConfigClass` hooks, AMI, Core REST API v3, module workers and cron.
   Core models (`MikoPBX\Common\Models\*`, e.g. `Extensions`, `Users`) may be **read** by the hub (thin glue in
   `Lib/Support/`, never written); Core itself must never be changed. This read access does not extend to other
   modules' tables or classes (rule 2).
2. **Pull model.** Source modules (ModuleAISupervisor, ModuleLocalSpeechToText, ModuleVoiceAgent, …) must not be
   changed for the hub and must not call it. The hub reads their **public REST API v3** only — never their
   SQLite tables, never their PHP classes.
3. **Hooks called by Core must be fast**: record the raw fact (row or own beanstalk tube) and return. No network
   I/O inside `onProviderStatusChange`, `onExtensionStatusChange`, `onAfter*` hooks.
4. **Idempotency**: `m_MessengerHubEvents.dedupe_key` UNIQUE and `m_MessengerHubOutbox(event_id, recipient_id)`
   UNIQUE. A re-poll, a restarted worker or a repeated AMI event must not produce a second message.
5. **History is not broadcast**: enabling a source sets its baseline to "now".
6. **Secrets**: bot tokens are write-only. REST responses expose `token_hint` only. Never log URLs, headers or
   bodies of messenger HTTP calls (Telegram puts the token in the URL). Errors are normalised codes.
7. **Personal data** leaves the PBX only when the admin enabled it; phone masking and attachment switches must be honoured.
8. **Only our own beanstalk tubes.** Never consume Core tubes such as `WorkerNotifyByEmail` — they are work
   queues and we would steal jobs.
9. A failing source or channel must not stop the others.

## Layout

```
module.json, composer.json            metadata (moduleUniqueID = ModuleMessengerHub)
Setup/PbxExtensionSetup.php           installer (schema from model annotations; keep install fast)
Lib/MessengerHubConf.php              Core hooks
Lib/Events/                           HubEvent, EventStore (INSERT OR IGNORE on dedupe_key)
Lib/Sources/                          SourceInterface, AmiEventSource, Collector, SourceRegistry (register adapters in default()),
                                      SourceRecorder (push sources), SourceStateRepository, availability
Lib/Api/                              RestReader, LocalRestClient (127.0.0.1 + hub key), HubApiKey (own read-only Core key)
Lib/Settings/HubSettings.php          key/value settings, SECRET_KEYS
Lib/Storage/                          HubDatabase port: PhalconHubDatabase (prod), PdoHubDatabase (Tests/support)
Lib/Support/HubLogger.php             syslog lines, secrets masked (NOTICE is not visible on the station; errors use LOG_ERR)
Lib/{Routing,Channels,Delivery,RestAPI}/   later stages, see Plan/01-architecture.md
Models/                               m_MessengerHub* tables, see Plan/04-data-model.md
bin/                                  workers (Collector, Ami, Delivery)
App/                                  admin UI: Volt + jQuery + Fomantic UI (no React)
public/assets/js/src/                 ES6 sources; compiled ES5 next to them (babel)
Messages/*.php                        29 locales, standalone literal arrays
Tests/                                contract checks, run-all.php, fixtures
scripts/package-module.sh             builds the installable zip
Plan/                                 spec and roadmap
docs/                                 how-to guides for agents
```

## Conventions

- Every PHP file: `<?php`, blank line, `declare(strict_types=1);`, no closing tag.
- Namespace `Modules\ModuleMessengerHub\…`, PSR-4 from module root.
- Models extend `MikoPBX\Modules\Models\ModulesModelsBase`; table names `m_MessengerHub*`; primary key `public $id;`
  untyped; string columns `public ?string $x = '';`; Phalcon annotations `@Primary @Identity @Column(...)`.
- Use `Phalcon\Di\Di`, not `Phalcon\Di`.
- REST API v3: one directory per resource under `Lib/RestAPI/{Resource}/` (Controller, Processor, DataStructure,
  Actions), noun paths under `/pbxcore/api/v3/module-messenger-hub`, `PBXApiResult` envelope, `:action` only for
  non-CRUD state transitions. All OpenAPI text keys defined in `Messages/en.php` and `Messages/ru.php`.
- Translations: prefix `module_messenger_hub_`; Russian first. Every `Messages/<locale>.php` returns a literal
  array — no `require`, `include`, variables, merges. Keep `AdditionalMenuItemModuleMessengerHub`,
  `BreadcrumbModuleMessengerHub`, `SubHeaderModuleMessengerHub` in all 29 locales.
- New channel → `docs/adding-a-channel.md`. New source → `docs/adding-a-source.md`.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), reference the GitLab
  issue when there is one. Work on `develop`; `master` is release-only.

## Verification

```bash
php Tests/run-all.php                                   # contract checks (must pass before any commit)
# Unit checks load module classes through Tests/support/bootstrap.php; keep logic Core-free so it is testable,
# and keep Core glue (models, Core probes, workers, HubApiKey) thin.
find . -name '*.php' -not -path './vendor/*' -exec php -l {} \; | grep -v 'No syntax errors'   # must print nothing
./scripts/package-module.sh /tmp/module-build           # installable zip
```

Integration testing happens on the MikoPBX test station, not in local Docker — see `Plan/10-testing.md`.

## Review defaults

- REST API or payload contracts → `module-contract-guardian`.
- Outbox, retries, leases, rate limits, source cursors → `queue-resilience-reviewer`.
- Tokens, auth, logs, personal data, recordings → `module-security-reviewer`.
- Admin UI → `admin-ui-reviewer`.
- Plan/README/docs consistency → `module-documentation-maintainer`.
