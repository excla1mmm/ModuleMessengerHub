# Messenger notifications (ModuleMessengerHub)

[Русская версия](README.ru.md)

A MikoPBX module that collects events from the PBX and installed modules on its own and sends
notifications to **Telegram** and **MAX**.

> **Status: in development (stage 0 — skeleton).** The module installs, but has no notification features yet.
> Plan and stages: [`Plan/`](Plan/README.md) (Russian).

## Planned features

- Connect Telegram and MAX bots by token, find chats with "Connect chat", send a test message.
- Core events: missed call, provider unavailable, system warnings, voicemail.
- MIKO module events (when installed): call needing attention (AI Supervisor), callback request (VoiceAgent),
  offline transcription/AI workers, paused cloud services.
- Rules: which events, with which filters, to whom; personal notifications for employees.
- Reliable delivery: queue, retries, de-duplication, messenger rate limits.

The module does not change MikoPBX Core or other modules: it only reads their data.

## Requirements

- MikoPBX 2025.1.1 or newer.
- Outbound HTTPS from the PBX to `api.telegram.org` and/or `platform-api2.max.ru` (direct or via proxy).
- **MAX bot** is created by your organisation at business.max.ru: a verified organisation / sole proprietor /
  self-employed profile (Russian resident) and bot moderation (up to 48 business hours) are required.
- A Telegram bot can be created by anyone via @BotFather.

## Security and privacy

Phone numbers, employee names and event texts are sent to an external messenger. Notifications are off by
default; numbers can be masked and attachments disabled. Bot tokens are stored only on the PBX and are never
shown again after entry.

## Support

help@miko.ru

## For developers

- Docs for AI agents and developers: [`AGENTS.md`](AGENTS.md), [`docs/`](docs/).
- Checks: `php Tests/run-all.php`. Package: `./scripts/package-module.sh <dir>`.
