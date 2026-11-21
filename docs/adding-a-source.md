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
