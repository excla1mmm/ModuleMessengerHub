# 03. Каналы: Telegram и MAX

Оба канала реализуют один контракт. Факты об API ниже собраны 18.11.2026; перед реализацией
сверить с официальной документацией (ссылки в конце) — API мессенджеров меняются.

## Контракт адаптера канала

```php
interface ChannelInterface
{
    public function id(): string;                                  // 'telegram' | 'max'
    public function checkToken(BotCredentials $bot): BotIdentity;  // имя/username бота или ошибка
    public function discoverChats(BotCredentials $bot, DiscoveryCursor $c): DiscoveryBatch; // для «Подключить чат»
    public function send(BotCredentials $bot, Recipient $to, RenderedMessage $m): SendResult;
    public function limits(): ChannelLimits;                       // длина текста, размер файла, скорость
}
```

`SendResult`: `sent(message_id)` | `retry(after_sec, code)` | `permanent(code)` | `recipient_gone(code)`.
Классификация ошибок — в адаптере; очередь работает только с этими четырьмя исходами.

## Общий сценарий подключения (оба канала)

1. Администратор вставляет токен → `checkToken()` → показываем имя бота, сохраняем токен (только запись).
2. «Подключить чат»: хаб на **5 минут** запускает опрос обновлений бота (`discoverChats`).
   Пользователь за это время добавляет бота в группу/канал или пишет боту в личку (Telegram: `/start`,
   MAX: «Начать»). Найденные чаты показываются списком, администратор отмечает нужные.
3. Опрос прекращается. Постоянный приём апдейтов в v1 не ведётся.
4. Ручной ввод `chat_id` — запасной путь.
5. «Отправить тест» — сообщение во все выбранные чаты бота.

## Telegram Bot API

| Что | Значение |
|---|---|
| Адрес | `https://api.telegram.org/bot<token>/<method>` — **токен в URL**, поэтому URL никогда не логируется |
| Бот | создаётся любым пользователем через @BotFather, модерации нет |
| Проверка токена | `getMe` |
| Получение чатов | `getUpdates` (long polling; не работает, если у бота установлен вебхук — тогда показать ошибку «у бота настроен вебхук, отключите `deleteWebhook`») — события `message`, `my_chat_member` |
| Личные сообщения | бот не может написать первым: пользователь должен нажать `/start` |
| Группы | бота добавляют в группу; в режиме приватности бот видит только команды и упоминания — для `discoverChats` достаточно события `my_chat_member` |
| Отправка текста | `sendMessage`, `parse_mode: HTML`, текст до **4096** символов; подпись к файлу до **1024** |
| Кнопка | `reply_markup.inline_keyboard` с кнопкой `url` |
| Аудио | `sendAudio` (MP3/M4A) или `sendVoice` (OGG/Opus); загрузка до **50 МБ** |
| Лимиты | ~1 сообщение/с в один чат, ~20/мин в группу, ~30/с суммарно на бота |
| 429 | `parameters.retry_after` — ждать указанное число секунд |
| Получатель недоступен | 403 «bot was blocked by the user», 403 «bot was kicked…», 400 «chat not found» → `recipient_gone` |
| Миграция группы | 400 с `parameters.migrate_to_chat_id` → обновить `chat_id` получателя и повторить |

## MAX Bot API

| Что | Значение |
|---|---|
| Адрес | `https://platform-api2.max.ru` (`platform-api.max.ru` — устаревший) |
| Токен | заголовок `Authorization: <token>` без `Bearer`; в query больше не поддерживается |
| TLS | сертификат НУЦ Минцифры — нужен корневой сертификат в доверенных (поставлять с модулем или путь в настройках); проверку TLS не отключать |
| Бот | создаёт **клиент** на business.max.ru: верифицированный профиль организации/ИП/самозанятого (резидент РФ), модерация до 48 ч в рабочие дни; токен — после модерации |
| Проверка токена | `GET /me` |
| Получение чатов | `GET /chats` не поддерживается с июня 2026; `chat_id` только из событий `bot_added`, `bot_started` через `GET /updates` (long polling рекомендован только для разработки — у нас он только на 5 минут подключения) или вебхук `POST /subscriptions` |
| Отправка | `POST /messages?chat_id=…` или `?user_id=…`; `format: markdown` или `html`; текст до **4000** символов |
| Кнопка | вложение `inline_keyboard`, кнопка `type: link` (текст ≤ 128, URL ≤ 2048) |
| Аудио | `POST /uploads?type=audio` → `url` + `token` → загрузка файла → вложение `{type: audio, payload: {token}}`; MP3/M4A; до 256 МБ и 60 мин |
| Готовность вложения | ответ `attachment.not.ready` → пауза и повтор с ростом интервала |
| Лимиты | ≤ 2 сообщения/с в один чат; ≤ 30 rps суммарно на `platform-api2.max.ru` |
| Ошибки | разбирать поле `code` (бывает HTTP 200 с `success: false`); коды «бот удалён/заблокирован» в документации не перечислены — выяснить на тестовом боте |

## Форматирование

Шаблоны рендерятся в нейтральную разметку (`RenderedMessage`: заголовок, строки «ключ: значение»,
абзацы, цитаты, кнопки, вложения). Адаптер канала превращает её в HTML (Telegram) или markdown/html (MAX)
и **экранирует** всё, что пришло из данных (имена, тексты расшифровок).
Обрезка под лимит канала: сокращается самый длинный абзац с многоточием; ID и кнопка сохраняются.

## Вложения (этап 3+)

- Записи АТС бывают `.webm`/`.wav` — конвертация в MP3 перед отправкой (ffmpeg/sox на АТС — проверить наличие).
- Файл больше лимита канала → без вложения, в тексте «запись доступна по ссылке».
- Временные файлы удаляются после отправки.

## Источники

- Telegram: https://core.telegram.org/bots/api
- MAX: https://dev.max.ru/docs-api, https://dev.max.ru/docs-api/methods/POST/messages,
  https://dev.max.ru/docs-api/methods/POST/uploads, https://dev.max.ru/docs-api/use-cases/getting-chat-id/,
  https://dev.max.ru/docs/chatbots/bots-create/create/
