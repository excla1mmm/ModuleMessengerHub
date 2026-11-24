# Messenger notifications (ModuleMessengerHub)

[Русская версия](README.ru.md)

A MikoPBX module that collects events from the PBX and installed modules on its own and sends
notifications to **Telegram** and **MAX**.

> **Status: stages 2 (Telegram) and 3 (MAX) are accepted on the test station (20–21.11.2026).**
> Bots, chat discovery, rules, the event journal, reliable delivery, the callback retraction and the
> MAX channel (including TLS with the Mintsifry root CA) are implemented and verified with a live bot
> and real chats. Plan and stages: [`Plan/`](Plan/README.md) (Russian).

## What the module can do

- **Connect a Telegram or MAX bot** by token, check the token, find chats ("Connect chat"), send a
  test message through the same queue as real notifications.
- **Collect events** from the PBX and from installed MIKO modules: missed call, provider down/up,
  system warnings, voicemail; a caller who gave up in a queue, a call outside working hours, a parked
  call nobody picked up; call needing attention (AI Supervisor), callback request and offline
  workers (VoiceAgent); module status changes (speech recognition workers and queue, cloud speech
  incidents, cloud AI pauses); security events — a suspected fraudulent call (dangerous international
  destination, a burst of outgoing external calls, a call outside working hours), a new device on an
  extension and SIP password guessing (brute force).
- **PBX configuration and infrastructure events**: configuration changes (one message naming the areas
  that changed — routing, providers, numbers, firewall, API keys, modules and so on, never field values),
  an external IP address change, and license expiry reminders 14/7/1 days before and once after the end
  date. The thresholds (change-coalescing window, external-IP and license poll intervals, the reminder
  day list) are set on the "Настройки" tab.
- **Rules ("Уведомления")**: choose a scenario (event type), conditions (employees, call direction,
  providers, quality score) and recipients — selected chats, the employee's linked personal chat,
  or "employee, otherwise the shared chat".
- **Reliable delivery**: queue in SQLite with a delivery worker, retries with backoff, Telegram rate
  limits, 429 `retry_after`, lease recovery, de-duplication (one message per event and chat),
  "Open call" button, phone masking.
- **Audio attachments (off by default)**: a rule option "Attach the recording" sends the voicemail file, or
  fragments around the quotes (±5 s, up to three) / the whole conversation of a call that needs attention,
  as MP3 voice messages after the text. The recording leaves the PBX only when the administrator picks
  this option in the rule; missed calls never carry audio. Needs `ffmpeg` (or `sox`/`lame`) on the PBX;
  without it, or above the channel limits (Telegram 50 MB, MAX 60 min), the message gets a short note
  instead of the file.
- **Delete the notification when the client was called back** (missed call): if an answered call with
  the same client number happens within the rule window (20 minutes by default), the bot either does
  not send the queued message at all or deletes the already sent one together with its attachments.
  Canceled/deleted/failed deliveries are marked in the journal with the callback time and employee.
- **Journal ("Журнал")**: every event with its deliveries per chat, statuses, error codes, the
  "Retry" action for failed deliveries and the callback marks.

The module does not change MikoPBX Core or other modules: it only reads their data.

## Connect a Telegram bot (administrator)

1. Create a bot in Telegram via **@BotFather** (`/newbot`) and copy the token.
2. Open the module: **Настройки → Мессенджеры → Telegram → Добавить бота**, paste the token and press
   **Проверить**. A wrong token shows a clear error and is not saved.
3. **Connect chats**: press **Подключить чат** and within five minutes either add the bot to the
   group/channel or open a private chat with the bot and press **Start** (send any message). Found
   chats appear in the bot card; enable the ones you need.
4. For a personal notification, link a private chat to an employee and choose the rule target
   "employee" (or "employee, otherwise the shared chat").
5. Press **Отправить тест** — the message goes through the delivery queue, the result is shown per chat.
6. Create a notification in **Уведомления** (scenario → conditions → where to send).
7. For the missed-call scenario enable **«Удалять сообщение, если клиенту перезвонили»**, set the
   window (5–120 minutes, 20 by default) and decide whether the client calling back himself also counts.

For message deletion Telegram requires the bot to be an **administrator of the group/channel** with the
right to delete messages. A bot removed from a chat is marked "бот удалён из чата" and is not retried
endlessly.

## Connect a MAX bot (administrator)

The steps were verified on the test station with a live MAX bot on 21.11.2026.

1. The organisation owner creates a bot at **business.max.ru** ("Chat bots") from a verified profile
   of an organisation, sole trader or self-employed person. The profile is moderated (up to 48 hours
   on business days); the token appears afterwards.
2. Open the module: **Настройки → Мессенджеры → MAX → Добавить бота**, paste the token and press
   **Проверить**. The bot name is shown; a wrong token gives a clear error and is not saved.
3. **Connect chats**: press **Подключить чат** and within five minutes either press **Start** in the
   dialog with the bot or add the bot to a group/channel. Found chats appear in the bot card; enable
   the ones you need. A group title comes from MAX when available, otherwise set it manually.
4. Press **Отправить тест** and create a notification the same way as for Telegram.
5. If MAX reports that a webhook subscription blocks chat discovery, delete it with
   `DELETE /subscriptions` and search again.
6. "Не удалось проверить сертификат MAX" in the bot card means the PBX does not trust the Mintsifry
   root CA. The module ships it (`Russian Trusted Root CA`, fingerprint pinned); an own file can be
   set with `max_ca_bundle_path`. TLS verification is never disabled.

For message deletion in a MAX group the bot must be an **administrator with the delete right**. The
age limit after which MAX refuses to delete a message is not documented and could not be determined on
the test bot (it has no message older than a day) — the rule hint says so. A bot removed from a group
gets `error.not.found`; a user who blocks the bot gets `chat.denied`: both mark the chat as "bot
removed from the chat" without endless retries.

## Requirements

- MikoPBX 2025.1.1 or newer.
- Outbound HTTPS from the PBX to `api.telegram.org` and `platform-api2.max.ru` (directly or via a
  proxy set in the module settings). MAX audio is uploaded to the upload address MAX returns, a CDN host
  under `*.okcdn.ru` / `*.mycdn.me` (the bot token is never sent there). Attachments additionally read
  call recordings through the PBX's own REST API on `127.0.0.1`.
- A Telegram bot token from @BotFather and/or a MAX bot token from business.max.ru.

## Security and privacy

Phone numbers, employee names and event texts are sent to an external messenger. Notifications are off by
default; numbers can be masked; attachments are `none` by default and a recording is sent only for a rule where the
administrator chose it (probe/test events can only use the module's own probe directory). Bot tokens are stored only on the PBX, are never
returned by the API (only a short hint is shown) and never appear in logs or error codes. The hub uses its
own restricted API key for the sources it polls: bound to the PBX itself (localhost), `read` on the resources it
polls, and `admin` only on the two ModuleLocalSpeechToText resources (`/workers`, `/jobs`) that module serves to API keys
at that level; the hub only sends GET requests to them.

The module ships the Russian Trusted Root CA (the Russian Ministry of Digital Development root) only to verify
`platform-api2.max.ru`; it is not used for any other connection and TLS verification is never disabled:

- file: `Lib/Channels/Max/certs/russian_trusted_ca.pem`
- SHA-256 fingerprint: `D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31`
  (check: `openssl x509 -noout -fingerprint -sha256 -in Lib/Channels/Max/certs/russian_trusted_ca.pem`)
- source: https://gu-st.ru/content/Other/doc/russiantrustedca.pem (official issue of the Mintsifry CA)

Vulnerabilities: see [`SECURITY.md`](SECURITY.md).

## Support

ebek@miko.ru

## For developers

- Docs for AI agents and developers: [`AGENTS.md`](AGENTS.md), [`docs/`](docs/).
- Checks: `php Tests/run-all.php`. Package: `./scripts/package-module.sh <dir>`.
