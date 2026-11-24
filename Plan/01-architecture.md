# 01. Архитектура

## Поток данных

```
 Источники (только чтение)                 Хаб                                   Каналы
 ─────────────────────────      ───────────────────────────────────────      ──────────────
 AMI UserEvent (CdrConnector,  ┐
   voicemail_end)              │   ┌──────────────┐   ┌───────────────┐
 Хуки ядра, реализованные      ├──►│  Collectors  │──►│  Event store  │
   в Conf хаба                 │   │ (адаптеры    │   │ m_..._Events  │
   (onProviderStatusChange…)   │   │  источников) │   │ dedupe_key    │
 REST API v3 ядра (advice,     │   └──────────────┘   └──────┬────────┘
   firewall, …)                │                             │
 REST API v3 модулей           ┘                             ▼
   (AI Supervisor, STT,                              ┌───────────────┐
    VoiceAgent, …)                                   │   Router      │  правила → получатели
                                                     │ (rules)       │  шаблон → текст
                                                     └──────┬────────┘
                                                            ▼
                                                     ┌───────────────┐      ┌──────────────┐
                                                     │    Outbox     │─────►│  Delivery    │──► Telegram Bot API
                                                     │ m_..._Outbox  │◄─────│  (адаптеры   │──► MAX Bot API
                                                     │ (event,       │ итог │   каналов)   │
                                                     │  recipient)   │      └──────────────┘
                                                     └───────────────┘
```

1. **Collector** (адаптер источника) получает или опрашивает данные, превращает их в нормализованное
   событие (`05-events-rules-templates.md`) и сохраняет в **Event store**. Повтор того же события
   отбрасывается по `dedupe_key`.
2. **Router** для каждого нового события находит подходящие правила, вычисляет получателей,
   рендерит текст под канал и кладёт по строке в **Outbox** на каждую пару (событие, получатель).
3. **Delivery** забирает строки Outbox, отправляет через адаптер канала, фиксирует результат,
   при временной ошибке планирует повтор.

Router и Delivery не знают, откуда событие. Collector не знает, куда оно уйдёт.

## Слои кода

```
Lib/
  MessengerHubConf.php            — хуки ядра: воркеры, cron, onProviderStatusChange и т. п. (только запись факта)
  Sources/
    SourceInterface.php           — контракт адаптера источника
    SourceRegistry.php            — список источников, проверка доступности
    Core/                         — MissedCallSource, ProviderStatusSource, AdviceSource, VoicemailSource, …
    Modules/                      — AiSupervisorAttentionSource, VoiceAgentCallbackSource, …
  Events/
    HubEvent.php                  — нормализованное событие (value object)
    EventStore.php                — запись с дедупликацией
  Routing/
    RuleMatcher, RecipientResolver, TemplateRenderer  — правила, получатели, шаблоны
    Rule.php, RuleRepository.php, ChatResolver.php, Router.php
    RenderedMessage.php, RenderContext.php, TemplateInterface.php, LinkBuilder.php, PhoneMasker.php
    Templates/                    — по классу на тип события (Plan/05)
  Channels/
    ChannelInterface.php          — контракт адаптера канала
    HttpClient.php, HttpTransport.php, HttpResponse.php, SendResult.php, ChannelLimits.php, ChannelRegistry.php
    Telegram/TelegramChannel.php, TelegramApi.php, TelegramHtml.php
    Max/MaxChannel.php, MaxApiClient.php — этап 3
  Delivery/
    OutboxRepository.php, DeliveryService.php, RetryPolicy.php, RateLimiter.php, DeliveryWaker.php,
    BeanstalkDeliveryWaker.php (Core glue), DeliveryTube.php,
    RetractionPlanner.php, RetractionService.php (этап 2d: отмена/удаление после перезвона)
  Security/                       — отдельного SecretStore нет: секреты живут в БД модуля, маска номеров — Routing/PhoneMasker
  RestAPI/                        — ресурсы REST API v3 (06-rest-api-and-ui.md)
bin/
  WorkerMessengerHubCollector.php — опрос источников по расписанию
  WorkerMessengerHubAmi.php       — подписка на AMI UserEvent
  WorkerMessengerHubDelivery.php  — отправка Outbox
Models/                           — 04-data-model.md
App/                              — интерфейс администратора
```

## Воркеры

| Воркер | Тип в `getModuleWorkers()` | Что делает |
|---|---|---|
| `WorkerMessengerHubAmi` | `CHECK_BY_AMI` | Слушает `UserEvent` `CdrConnector` (`action=hangup_update_cdr`) и `voicemail_end`; передаёт в Collector соответствующего источника. Подключение как в эталонном ModuleExampleAmi: `Util::getAstManager()`, AMI-действие `Filter` на нужные UserEvent, `waitUserEvent(true)`, переподключение при пустом ответе (Q2) |
| `WorkerMessengerHubCollector` | `CHECK_BY_PID_NOT_ALERT` | Цикл опроса pull-источников по их интервалам; курсоры в `m_MessengerHubSourceState`; синхронизация ключа раз в минуту и его самовосстановление по 401/403 (Q14); после записи событий «пинает» трубу доставки |
| `WorkerMessengerHubDiscovery` | `CHECK_BY_PID_NOT_ALERT` | «Подключить чат»: опрос `getUpdates` только во время пятиминутного сеанса, найденные чаты пишутся в запись бота (выключенными). В простое — одно чтение SQLite раз в 2 с |
| `WorkerMessengerHubDelivery` | `CHECK_BY_PID_NOT_ALERT` | Router (правила → получатели → шаблон → Outbox) и отправка Outbox: лизинг строк, повторы, лимиты каналов. Труба-«будильник» — своя (`DeliveryTube`, имя класса воркера); это только оптимизация задержки, поэтому ядро следит за процессом, а не за трубой |

Router и отправка живут в одном воркере (одна точка записи в Outbox). Будильник — beanstalk-труба
модуля `WorkerMessengerHubDelivery` (только наша труба, чужие трубы ядра не читаем). Воркер всё равно
просыпается раз в 5 секунд, поэтому потерянный «пинок» лишь откладывает доставку.

### Аварийный выключатель `hub_enabled`

`hub_enabled = 0` (по умолчанию) означает: **сбор событий идёт, отправка — нет**. Источники продолжают
писать события в журнал (их видно в «Журнале»), Router помечает такие события обработанными и не создаёт
строк Outbox. Поэтому включение хаба позже не рассылает накопившуюся историю (правило 5 в `AGENTS.md`).

## Хуки ядра, которые реализует хаб

Хуки вызываются ядром у всех включённых модулей. Реализация в хабе обязана быть быстрой: записать
сырое событие в свою таблицу или трубу и вернуть управление.

| Хук | Где вызывает ядро | Для чего |
|---|---|---|
| `getModuleWorkers()` | WorkerSafeScriptsCore | регистрация четырёх воркеров |
| `createCronTasks()` | CronConf | очистка истории, страховочный «пинок» воркеров |
| `onProviderStatusChange(array $changeData)` | `PBXCoreREST/Lib/Providers/GetAllStatusesAction.php:344` | провайдер отключился/восстановился |
| `onExtensionStatusChange(array $changeData)` | `PBXCoreREST/Lib/Extensions/GetAllStatusesAction.php:436` | новое устройство у сотрудника (4s-A: `device_added` → сырые пары ip/User-Agent в курсор, событие собирает коллектор); онлайн/офлайн — этап 4 |
| `onAfterPbxStarted()` | `Core/System/Configs/PbxConf.php:187` | событие «АТС запущена» |
| `onAfterExecuteRestAPIRoute(Micro $app)` | `PBXCoreREST/Providers/RouterProvider.php:735` | кандидат для входов в систему (этап 5, проверить) |
| `onAfterModuleEnable/Disable` | модульный менеджер | пересчёт доступности источников |

Пути — в репозитории ядра (the Core repository (https://github.com/mikopbx/Core; local path in `LOCAL.md`)), проверены 18.11.2026. Хуки
`onProviderStatusChange`/`onExtensionStatusChange` не объявлены в интерфейсе — ядро вызывает их по
имени; перед реализацией перепроверить сигнатуру на целевой версии ядра.

## Доступ к REST API модулей-источников

Хаб ходит в REST API v3 на `http://127.0.0.1/pbxcore/api/v3/...` из своего воркера с собственным
ограниченным ключом API (решение Q1 в [11-open-questions.md](11-open-questions.md), проверено на станции):

- `Lib/Api/HubApiKey.php` при включении хаба создаёт запись `MikoPBX\Common\Models\ApiKeys`
  с `full_permissions='0'` и `allowed_paths` = только пути включённых источников со значением `read`
  (без исключений; источники STT и облачного ИИ ждут доработки модулей, решение Q10/Q11), хранит открытый ключ в `m_MessengerHubSettings` как секрет,
  вызывает `TokenValidationService::clearCache()`.
- При изменении набора источников `allowed_paths` обновляется **на месте** (тот же id и тот же открытый ключ,
  решение Q15 — пересоздание давало короткий `api_forbidden` после включения источника); пересоздание — только
  если записи нет. `PATCH settings` применяет новый набор сразу, воркер-коллектор сверяет ключ раз в минуту.
- **Выключение модуля не удаляет ключ, а снимает с него пути** (`HubApiKey::revoke`, `allowed_paths` → `{}` —
  запись с `full_permissions='0'` и пустым набором путей не даёт доступа ни к чему): обновление пакета идёт
  через disable → замена файлов → enable, и тот же id с тем же секретом возвращается синхронизацией на месте.
  Настоящее удаление модуля оставляет неактивную запись без путей; её подчищает следующая установка
  (`create()` удаляет осиротевшие записи по описанию) или администратор вручную.
- Без ключа запросы с localhost проходят, но область видимости пустая (например, звонки ИИ Супервайзера — 0 записей).
- Альтернатива без HTTP — вызов процессора REST ресурса в процессе — запрещена: это зависимость
  от внутренностей чужого модуля.

## Интерфейс

Классический для MikoPBX: Volt + jQuery + Fomantic UI (как у ModuleLocalSpeechToText), без React-сборки.
Причина: страницы — формы и таблицы, отдельный фронтенд-тулчейн не окупается. JS-исходники в
`public/assets/js/src/`, сборка Babel (skill `babel-compiler`).
