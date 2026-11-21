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
    RuleMatcher.php, RecipientResolver.php, TemplateRenderer.php
  Channels/
    ChannelInterface.php          — контракт адаптера канала
    Telegram/TelegramChannel.php, TelegramApiClient.php
    Max/MaxChannel.php, MaxApiClient.php
    HttpTransport.php             — curl, прокси, TLS, таймауты, без логирования URL с токеном
  Delivery/
    Outbox.php, DeliveryService.php, RetryPolicy.php, RateLimiter.php
  Security/
    SecretStore.php, PhoneMasker.php
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
| `WorkerMessengerHubAmi` | `CHECK_BY_AMI` | Слушает `UserEvent` `CdrConnector` (`action=hangup_update_cdr`) и `voicemail_end`; передаёт в Collector соответствующего источника |
| `WorkerMessengerHubCollector` | `CHECK_BY_BEANSTALK` или `CHECK_BY_PID_NOT_ALERT` | Цикл опроса pull-источников по их интервалам; курсоры в `m_MessengerHubSourceState`; после записи событий будит Router |
| `WorkerMessengerHubDelivery` | `CHECK_BY_BEANSTALK` | Router + отправка Outbox; лизинг строк, повторы, лимиты каналов |

Router можно держать внутри Delivery-воркера (одна точка записи в Outbox). Будильник — beanstalk-труба
модуля `WorkerMessengerHubDelivery::class` (только наша труба, чужие трубы ядра не читаем).

## Хуки ядра, которые реализует хаб

Хуки вызываются ядром у всех включённых модулей. Реализация в хабе обязана быть быстрой: записать
сырое событие в свою таблицу или трубу и вернуть управление.

| Хук | Где вызывает ядро | Для чего |
|---|---|---|
| `getModuleWorkers()` | WorkerSafeScriptsCore | регистрация трёх воркеров |
| `createCronTasks()` | CronConf | очистка истории, страховочный «пинок» воркеров |
| `onProviderStatusChange(array $changeData)` | `PBXCoreREST/Lib/Providers/GetAllStatusesAction.php:344` | провайдер отключился/восстановился |
| `onExtensionStatusChange(array $changeData)` | `PBXCoreREST/Lib/Extensions/GetAllStatusesAction.php:436` | сотрудник онлайн/офлайн (этап 4, шумно) |
| `onAfterPbxStarted()` | `Core/System/Configs/PbxConf.php:187` | событие «АТС запущена» |
| `onAfterExecuteRestAPIRoute(Micro $app)` | `PBXCoreREST/Providers/RouterProvider.php:735` | кандидат для входов в систему (этап 5, проверить) |
| `onAfterModuleEnable/Disable` | модульный менеджер | пересчёт доступности источников |

Пути — в репозитории ядра (the Core repository (https://github.com/mikopbx/Core; local path in `LOCAL.md`)), проверены 18.11.2026. Хуки
`onProviderStatusChange`/`onExtensionStatusChange` не объявлены в интерфейсе — ядро вызывает их по
имени; перед реализацией перепроверить сигнатуру на целевой версии ядра.

## Доступ к REST API модулей-источников

Хаб ходит в REST API v3 на `127.0.0.1` из своего воркера. Нужен ключ API с правами только на чтение
нужных ресурсов. Способ получения ключа без изменений ядра — открытый вопрос
([11-open-questions.md](11-open-questions.md), Q1). Альтернатива без HTTP — вызов процессора REST
ресурса в процессе — запрещена: это зависимость от внутренностей чужого модуля.

## Интерфейс

Классический для MikoPBX: Volt + jQuery + Fomantic UI (как у ModuleLocalSpeechToText), без React-сборки.
Причина: страницы — формы и таблицы, отдельный фронтенд-тулчейн не окупается. JS-исходники в
`public/assets/js/src/`, сборка Babel (skill `babel-compiler`).
