# 04. Модель данных

SQLite модуля (`db/module.db`), модели — наследники `MikoPBX\Modules\Models\ModulesModelsBase`,
таблицы `m_MessengerHub*`. Свойства моделей — по правилам Phalcon/SQLite (первичный ключ без типа,
строковые колонки `?string`), см. `AGENTS.md`.

## Таблицы

### `m_MessengerHubSettings` — настройки ключ/значение
`id`, `key` (UNIQUE), `value`. Глобальные параметры: включён ли хаб, маскирование номеров по умолчанию,
внешний адрес АТС для ссылок, прокси, путь к CA-сертификату MAX, срок хранения истории.
**Есть в каркасе** (этап 0).

### `m_MessengerHubBots` — подключённые боты
| Поле | Назначение |
|---|---|
| `id` | |
| `channel` | `telegram` \| `max` |
| `title` | имя для интерфейса |
| `token` | секрет; наружу не отдаётся никогда (см. 07) |
| `token_hint` | последние 4 символа для интерфейса |
| `bot_username`, `bot_external_id` | из `checkToken()` |
| `enabled` | |
| `status`, `status_checked_at`, `last_error_code` | результат проверки |
| `created_at`, `updated_at` | |

### `m_MessengerHubRecipients` — чаты-получатели
`id`, `bot_id`, `chat_id` (строка; у Telegram отрицательные id групп), `chat_kind` (`private|group|channel`),
`title`, `linked_user_id` (сотрудник `m_Users.id` для личных уведомлений), `enabled`,
`state` (`active|gone`), `gone_reason`, `discovered_at`. UNIQUE(`bot_id`, `chat_id`).

### `m_MessengerHubRules` — правила маршрутизации
`id`, `title`, `enabled`, `event_types` (JSON-список, поддержка `prefix.*`), `min_severity`,
`filters_json` (сотрудники, направление, провайдеры, …), `target_mode`
(`recipients` — выбранные чаты \| `employee` — чат сотрудника из события \| `employee_or_recipients`),
`recipient_ids_json`, `template_key`, `options_json` (маскировать номер, вложения),
`quiet_hours_json` (этап 4), `sort`.

### `m_MessengerHubEvents` — нормализованные события
`id`, `source_id`, `event_type`, `severity`, `dedupe_key` (UNIQUE), `occurred_at`, `payload_json`,
`routed_at` (NULL — ещё не обработан Router), `created_at`.

### `m_MessengerHubOutbox` — отправки
| Поле | Назначение |
|---|---|
| `id` | |
| `event_id`, `recipient_id`, `rule_id` | UNIQUE(`event_id`, `recipient_id`) — идемпотентность |
| `status` | `pending` \| `sending` \| `sent` \| `failed` \| `dropped` |
| `attempts`, `next_attempt_at` | повторы |
| `lease_owner`, `lease_until` | лизинг строки воркером |
| `rendered_json` | текст и разметка на момент рендера |
| `external_message_id` | id сообщения в мессенджере |
| `last_error_code`, `last_error_at` | без токенов и персональных данных |
| `created_at`, `sent_at` | |

### `m_MessengerHubSourceState` — состояние источников
`source_id` (UNIQUE), `enabled`, `cursor_json`, `availability`, `last_poll_at`, `last_ok_at`,
`last_error_code`, `baseline_set_at` (момент, с которого источник шлёт события — история не рассылается).

### `m_MessengerHubDiscoverySessions` — сеансы «Подключить чат»
`id`, `bot_id`, `started_at`, `expires_at`, `updates_offset`, `found_json`, `status`.

## Индексы

- `Events(routed_at)` — выборка необработанных.
- `Outbox(status, next_attempt_at)` — выборка к отправке.
- `Outbox(event_id)`, `Outbox(recipient_id, status)`.

## Хранение и очистка

- История событий и отправок — по умолчанию 30 дней, cron-очистка батчами.
- `payload_json` хранит только то, что нужно для текста; записи разговоров не копируются — только путь.

## Миграции

Схема создаётся по аннотациям моделей (`PbxExtensionSetupBase`). Изменения схемы — через версионированные
миграции в `Setup/PbxExtensionSetup.php`; установка не должна делать тяжёлой работы над историей
(урок `modulelocalspeechtotext#5`: долгий шаг установки обрывается ядром через 120 с).
