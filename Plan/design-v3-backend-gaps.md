# Design v3 — what the frontend needs from the backend

The v3 UI (docs/design/ModuleMessengerHub-v3.html) is implemented without API changes. These display rules
currently run on the client with fallbacks; each item lists the backend change that would make them exact.

1. **Deleted bot name in the journal banner.** A deleted bot's deliveries carry `bot_deleted: true` but an empty
   `bot_title` / no username, so the banner says «Бот удалён — …» without `@имя`.
   Need: keep a bot title/username snapshot on the outbox row (or in `GET /events` deliveries).
2. **Probe events hidden by default.** Filtered on the client after paging, so a page may show fewer than 50 rows
   and the pager counts include probes. Need: `GET /events?include_probe=0|1` (default 0) with matching `pagination.total`.
3. **«Клиенту перезвонили» inside the missed call.** `core.missed_call_resolved` rows are hidden on the client and
   paired by `call.missed_linkedid` only within the loaded page (fallback: `deliveries[].resolved_at`).
   Need: `GET /events` to exclude resolved events and return `callback_at` on the missed-call item.
4. **Undelivered counter on the «Журнал» tab.** Counted on the client from the first 200 events of today
   (non-probe, any delivery `failed`/`dropped`). Need: a counter in `GET /events` meta or a `:getStats` action.
5. **MAX bots.** ✅ (stage 3c, 21.11.2026) The MAX tile and modal are live: `SAVABLE_CHANNELS` holds `max`,
   the API accepts `channel: max`, the modal shows the MAX token help (business.max.ru, moderation up to
   48 h), the connect-chat hint («нажмите "Начать" или добавьте бота в группу»), the webhook hint for
   `max.405.webhook_set`, its own `ca_error` state («Не удалось проверить сертификат MAX» with the
   `max_ca_bundle_path` pointer), and the wizard preview shows the MAX variant when the rule targets a
   MAX bot. The station check is stage 3d.
