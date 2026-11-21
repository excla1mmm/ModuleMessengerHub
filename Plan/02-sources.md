# 02. Источники событий

Хаб **забирает** данные сам. Для каждого источника: откуда читать, как не пропустить и не задвоить,
как понять, что источник недоступен. Модули-источники не меняются.

Обозначения этапов — из [09-roadmap.md](09-roadmap.md).

## Контракт адаптера источника

```php
interface SourceInterface
{
    public function id(): string;                 // 'core.missed_call', 'ai_supervisor.attention_call'
    public function eventTypes(): array;          // типы событий, которые он порождает
    public function availability(): SourceAvailability; // available | module_missing | module_disabled | api_incompatible | error
    public function mode(): SourceMode;           // push (AMI/хук) | poll
    public function pollIntervalSec(): int;       // для poll
    public function poll(SourceCursor $cursor): SourceBatch; // события + новый курсор; без побочных эффектов во внешних системах
}
```

- Курсор и состояние — в `m_MessengerHubSourceState` (последний id/время, `last_ok_at`, `last_error`).
- При первом включении источника курсор ставится на «сейчас»: **история не рассылается**.
- `dedupe_key` строится из стабильных идентификаторов источника, не из времени опроса.
- Ошибка одного источника не останавливает цикл опроса остальных.

## Ядро MikoPBX

| Источник | Тип события | Как получать | Дедупликация | Этап |
|---|---|---|---|---|
| Пропущенный звонок | `core.missed_call` | AMI `UserEvent: CdrConnector`, `action=hangup_update_cdr`, данные base64/`GZ:` JSON (`AsteriskManager::encodeCdrData`), поле `GLOBAL_STATUS` по linkedid. Ждать «тишины» по linkedid 10–20 с, затем решать. Страховка: опрос `cdr_general` по `id`-курсору | `missed:{linkedid}` | 2 |
| Провайдер упал / восстановился | `core.provider_down`, `core.provider_up` | хук `onProviderStatusChange` (`changes[]: provider_id, type, old_state, new_state, host, timestamp`) | `provider:{id}:{new_state}:{timestamp}` + подавление флаппинга | 2 |
| Системное предупреждение | `core.advice` | опрос `GET /pbxcore/api/v3/advice:getList` (как `WorkerNotifyAdministrator`), сравнение с прошлым снимком; событие на появление предупреждения | `advice:{messageTpl}:{hash(params)}` | 2 |
| Голосовая почта | `core.voicemail` | AMI `UserEvent: voicemail_end` (`linkedid`, `vm-recordingfile`). Приходит, только если в ядре настроена почта для голосовых | `voicemail:{linkedid}` | 2 |
| АТС запущена | `core.pbx_started` | хук `onAfterPbxStarted` | `pbx_started:{boot_time}` | 2 |
| Сотрудник онлайн/офлайн | `core.extension_status` | хук `onExtensionStatusChange` | `ext:{number}:{state}:{ts}` | 4 (шумно, только по правилу) |
| Вход в веб-интерфейс | `core.admin_login` | без правки ядра: (а) хук `onAfterExecuteRestAPIRoute` — проверить, виден ли маршрут `auth:login` и результат; (б) чтение syslog строки `Successful login: User=… From=…` (`LoginAction.php:227`) с курсором по смещению | `login:{user}:{ip}:{ts}` | 5 |
| Неудачные входы, баны | `core.ip_banned` | опрос `firewall:getBannedIps` и diff | `ban:{ip}:{jail}:{since}` | 5 |
| Срок SSL-сертификата | `core.ssl_expiring` | cron раз в сутки, чтение сертификата | `ssl:{fingerprint}:{days_bucket}` | 5 |

Правила «что считать пропущенным» повторяют `WorkerCdr::checkNoAnswerCall()` в ядре
(`src/Core/Workers/WorkerCdr.php:498-607`): пропущенным считается linkedid, где ни одно плечо не отвечено.
Получатель по умолчанию — сотрудник, которому звонили (по номеру назначения → `m_Users` → привязка к чату),
иначе общий чат. Внутренние звонки — по настройке.

## Модули MIKO (только их публичный REST API v3)

Перед реализацией каждого адаптера сверить ресурсы и параметры по OpenAPI модуля на целевой версии.
Если нужного чтения в API модуля нет — событие откладывается и фиксируется в `11-open-questions.md`;
модуль-источник ради хаба не меняем.

| Модуль | Тип события | Откуда | Курсор / дедуп | Этап |
|---|---|---|---|---|
| ModuleAISupervisor | `ai_supervisor.attention_call` | `GET /pbxcore/api/v3/module-ai-supervisor/calls?attention=…&sort=…&limit=…` (фильтр `attention` есть в `Lib/RestAPI/Calls/DataStructure.php:193`) | скользящее окно по дате + `ref_id`; `dedupe: ai_attention:{ref_id}` | 3 |
| ModuleAISupervisor | `ai_supervisor.worker_offline` | `GET …/module-ai-supervisor/workers` — статусы воркеров, diff | `ai_worker:{uid}:{state}:{since}` | 3 |
| ModuleAISupervisor | `ai_supervisor.call_assigned` | `GET …/calls` с полями workflow (назначенный, эскалация) — проверить наличие фильтра по изменению | `ai_assign:{ref_id}:{assignee}:{ts}` | 4 |
| ModuleCloudAISupervisor | `cloud_ai.paused` / `cloud_ai.resumed` | REST состояния очереди/биллинга — уточнить ресурс | `cloud_ai_pause:{reason}:{since}` | 3 |
| ModuleLocalSpeechToText | `local_stt.worker_offline` | `GET /pbxcore/api/v3/module-local-speech-to-text/workers` (ресурс `Workers`), diff статусов | `stt_worker:{uid}:{state}:{since}` | 3 |
| ModuleLocalSpeechToText | `local_stt.backlog_no_workers` | `Jobs` + `Workers`: есть ожидающие задания и нет онлайн-воркеров дольше N минут | `stt_backlog:{window}` | 3 |
| ModuleCloudSpeechToText | `cloud_stt.incident` | ресурсы `Incidents`, `Health` (у модуля есть инциденты с `dedupe_key`) | `cloud_stt_incident:{incident_id}:{state}` | 3 |
| ModuleCloudSpeechToText | `cloud_stt.paused` | `ProcessingControls` / `Health` — причина остановки (баланс, лимит, авторизация) | `cloud_stt_pause:{reason}:{since}` | 3 |
| ModuleVoiceAgent | `voice_agent.callback_request` | `GET /pbxcore/api/v3/module-voice-agent/callbacks` — новые заявки на перезвон | `va_callback:{id}` | 3 |
| ModuleVoiceAgent | `voice_agent.runtime_down/up` | ресурс `Runtime` | `va_runtime:{state}:{since}` | 3 |

Кандидаты следующих версий (сторонние/другие модули MIKO, только при наличии читаемого API):
ModuleBackup (сбой резервной копии), ModuleGetSsl (не продлён сертификат), ModuleVPN (туннель упал),
ModuleAmoCrm/ModuleBitrix24Integration (ошибки токена/синхронизации), ModuleRemoteSupport (открыт сеанс),
ModuleQueueCallBack (результат обратного звонка). Каталог с оценкой — в `11-open-questions.md` (Q6).

## Доступность источника

`availability()` проверяет по порядку: модуль установлен (`m_PbxExtensionModules`) → включён →
API отвечает и версия контракта совместима → последний опрос без ошибки. Состояние видно в интерфейсе
хаба (страница «Источники») и в `GET …/module-messenger-hub/sources`.
