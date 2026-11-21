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

### `m_MessengerHubBotChats` — чаты-получатели (было `m_MessengerHubRecipients` в первом наброске)
**Этап 2:** таблица называется `m_MessengerHubBotChats` (модель `MessengerHubBotChats`): чаты принадлежат боту
и редактируются внутри записи бота (`Plan/06`, ресурс `bots`). Отдельной сущности «получатель» нет.
`id`, `bot_id`, `chat_id` (строка; у Telegram отрицательные id групп), `chat_kind` (`private|group|channel`),
`title`, `linked_user_id` (сотрудник `m_Users.id` для личных уведомлений), `enabled`,
`state` (`active|gone`), `gone_reason`, `discovered_at`. UNIQUE(`bot_id`, `chat_id`).

### `m_MessengerHubRules` — правила маршрутизации
`id`, `title`, `enabled`, `event_types` (JSON-список, поддержка `prefix.*`), `min_severity`,
`filters_json` (сотрудники, направление, провайдеры, оценка качества для `ai_supervisor.attention_call`), `target_mode`
(`recipients` — выбранные чаты \| `employee` — чат сотрудника из события \| `employee_or_recipients`),
`chat_ids_json` (id строк `m_MessengerHubBotChats`), `template_key`, `options_json` (маскировать номер, вложения,
`retract_on_callback` — этап 2d), `quiet_hours_json` (этап 4), `sort`.

### `m_MessengerHubEvents` — нормализованные события
`id`, `source_id`, `event_type`, `severity`, `dedupe_key` (UNIQUE), `occurred_at`, `payload_json`,
`routed_at` (NULL — ещё не обработан Router), `created_at`.

### `m_MessengerHubOutbox` — отправки
| Поле | Назначение |
|---|---|
| `id` | |
| `event_id`, `chat_id`, `bot_id`, `rule_id` | UNIQUE(`event_id`, `chat_id`) — идемпотентность «одно событие — одно сообщение в чат» |
| `status` | `pending` \| `sending` \| `sent` \| `failed` \| `dropped` \| `cancelled` \| `retracted` \| `retract_failed` (три последних — этап 2d) |
| `attempts`, `uncertain_attempts`, `next_attempt_at` | повторы; `uncertain_attempts` — неизвестные исходы (не более одного, Plan/08) |
| `lease_owner`, `lease_until` | лизинг строки воркером |
| `rendered_json` | нейтральное сообщение (`RenderedMessage`) на момент рендера — номер уже замаскирован, если этого требуют правило/настройки |
| `external_message_ids` | JSON-список всех id доставки в мессенджере (текст + вложения, этап 3a) |
| `last_error_code`, `last_error_at` | нормализованный код, без токенов и персональных данных |
| `created_at`, `updated_at`, `sent_at` | |
| `retract_requested_at`, `retract_attempts`, `retract_next_attempt_at`, `retract_last_error_code` | этап 2d: запрос удаления отправленного сообщения и его повторы (Plan/12) |
| `retracted_at` | когда сообщение удалено |
| `retract_reason` | `resolved_before_send` (не отправлено) или `resolved_after_send` (удалено) |
| `resolved_at`, `resolved_by` | когда и кто перезвонил (для отметки в журнале) |

### `m_MessengerHubSourceState` — состояние источников
`source_id` (UNIQUE), `enabled`, `cursor_json`, `availability`, `last_poll_at`, `last_ok_at`,
`last_error_code`, `baseline_set_at` (момент, с которого источник шлёт события — история не рассылается).

### `m_MessengerHubDiscoverySessions` — сеансы «Подключить чат»
`id`, `bot_id`, `started_at`, `expires_at`, `updates_offset`, `found_json`, `status`.

## Индексы

- `Events(routed_at)` — выборка необработанных.
- `Outbox(status, next_attempt_at)` — выборка к отправке.
- `Outbox(event_id)`, `Outbox(chat_id, status)`.
- `BotChats(bot_id, chat_id)` UNIQUE, `BotChats(linked_user_id)` — чат сотрудника.

## Хранение и очистка

- История событий и отправок — по умолчанию 30 дней, cron-очистка батчами.
- `payload_json` хранит только то, что нужно для текста; записи разговоров не копируются — только путь.

## Миграции

Схема создаётся по аннотациям моделей (`PbxExtensionSetupBase`). Изменения схемы — через версионированные
миграции в `Setup/PbxExtensionSetup.php`; установка не должна делать тяжёлой работы над историей
(урок `modulelocalspeechtotext#5`: долгий шаг установки обрывается ядром через 120 с).
