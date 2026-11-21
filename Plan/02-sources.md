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
| Пропущенный звонок | `core.missed_call` | AMI `UserEvent: CdrConnector`, `action=hangup_update_cdr`, данные base64/`GZ:` JSON (`AsteriskManager::encodeCdrData`), поле `GLOBAL_STATUS` по linkedid. Ждать «тишины» по linkedid 10–20 с, затем решать. Страховка: опрос `cdr_general` по `id`-курсору | `missed:{linkedid}` | 1 ✅ (1.2) |
| Провайдер упал / восстановился | `core.provider_down`, `core.provider_up` | хук `onProviderStatusChange` (`changes[]: provider_id, type, old_state, new_state, host, timestamp`) | `provider:{id}:{down\|up}:{ts смены}` + debounce 120 с | 1 ✅ (1.2) |
| Системное предупреждение | `core.advice` | опрос `GET /pbxcore/api/v3/advice:getList` (как `WorkerNotifyAdministrator`), сравнение с прошлым снимком; событие на появление предупреждения | `advice:{messageTpl}:{hash(params)}` | 1 ✅ (1.2) |
| Голосовая почта | `core.voicemail` | AMI `UserEvent: voicemail_end` (`linkedid`, `vm-recordingfile`). Приходит, только если в ядре настроена почта для голосовых | `voicemail:{linkedid}` | 1 ✅ (1.2) |
| АТС запущена | `core.pbx_started` | хук `onAfterPbxStarted` | `pbx_started:{boot_time}` | 1 ✅ (1.2) |
| Сотрудник онлайн/офлайн | `core.extension_status` | хук `onExtensionStatusChange` | `ext:{number}:{state}:{ts}` | 4 (шумно, только по правилу) |
| Вход в веб-интерфейс | `core.admin_login` | без правки ядра: (а) хук `onAfterExecuteRestAPIRoute` — проверить, виден ли маршрут `auth:login` и результат; (б) чтение syslog строки `Successful login: User=… From=…` (`LoginAction.php:227`) с курсором по смещению | `login:{user}:{ip}:{ts}` | 5 |
| Неудачные входы, баны | `core.ip_banned` | опрос `firewall:getBannedIps` и diff | `ban:{ip}:{jail}:{since}` | 5 |
| Срок SSL-сертификата | `core.ssl_expiring` | cron раз в сутки, чтение сертификата | `ssl:{fingerprint}:{days_bucket}` | 5 |

Правила «что считать пропущенным» повторяют `WorkerCdr::checkNoAnswerCall()` в ядре
(`src/Core/Workers/WorkerCdr.php:498-607`): пропущенным считается linkedid, где ни одно плечо не отвечено.
Получатель по умолчанию — сотрудник, которому звонили (по номеру назначения → `m_Users` → привязка к чату),
иначе общий чат. Внутренние звонки — по настройке.

### Реализация 1.2 (18.11.2026)

Реализовано в `Lib/Sources/Core/` (логика без ядра, проверяется `Tests/check-core-sources.php`):

- **`core.missed_call`** (`MissedCallSource`, push через `WorkerMessengerHubAmi`): буфер плеч по linkedid,
  решение через 15 с тишины, буфер ограничен 200 linkedid (старые вытесняются). Плечо считается отвеченным
  при `disposition = ANSWERED` или `GLOBAL_STATUS = ANSWERED`. Severity: `warning` для входящих,
  `info` для исходящих и внутренних.
  Направление определяется по карте внутренних номеров (модели ядра `Extensions`/`Users`, только чтение,
  обновляется воркером AMI раз в 5 минут; Q12): есть плечо с DID или src не внутренний, а dst внутренний →
  `incoming`; оба внутренние → `internal`; иначе `outgoing`. `employees[]` — вызванные внутренние номера
  с пользователем (без дублей), `user_id` и `name` берутся из карты. Пока карта не загружена, решение откладывается.
- **`core.voicemail`** (`VoicemailSource`, push AMI `voicemail_end`): путь записи — только ссылка в
  `attachments`, файл читается и доставляется на следующих этапах.
- **`core.provider_status`** (`ProviderStatusSource`, push через хук `onProviderStatusChange`):
  сопоставление состояний — по `isSuccessState`/`isFailureState` ядра: `down` = `unregistered`,
  `rejected`, `unreachable`, `lagged` (без учёта регистра); `up` = `registered`, `ok`, `reachable`;
  `UNKNOWN`, `REMOVED` и прочие — события нет (переходы с `UNKNOWN` ядро и само не шлёт). Debounce: хук только пишет в курсор источника
  (`m_MessengerHubSourceState`) текущее состояние провайдера, время его смены и последнее отправленное
  состояние (несколько локальных SQL-запросов, без сети); коллектор (`TickingSource::tick`, каждые 5 с,
  только при включённом источнике) отправляет событие, когда состояние держится ≥ 120 с и отличается от
  последнего отправленного, поэтому восстановление не теряется. Первое увиденное состояние `up` не даёт
  события (тихая база), `down` — даёт. Курсор общий для хука и воркера: запись через compare-and-swap. Severity: `down` = `critical`, `up` = `info`.
- **`core.advice`** (`AdviceSource`, poll 60 с, путь ключа `/api/v3/advice`): курсор — набор
  отпечатков текущих пунктов (`messageTpl + md5(sorted params)`); события только по новым пунктам
  уровней `error` → `critical` и `warning` → `warning`; уровни `info`, `needUpdate` и строковые
  маркеры — только в снимке, без событий. `dedupe_key` включает день появления, поэтому предупреждение,
  исчезнувшее и вернувшееся после периода хранения, оповещает снова.
  Исправление (после рестарта АТС ядро временно отдаёт пустой/неполный список, пока `WorkerPrepareAdvice`
  не пересчитает его, и старые предупреждения приходили как «новые»): курсор —
  `{"seen": {"<отпечаток>": {"first": "<день>", "last": "<день>"}}}`; исчезнувший отпечаток не забывается,
  а хранится с датой последнего появления 7 суток (`RETENTION_DAYS`) — возврат в этот срок событий не
  даёт, после срока — новое событие с новым днём в `dedupe_key`. Ответ без единого пункта (пустой список,
  нет/испорчен `data.advice`, одни строковые маркеры) — «нет информации»: событий нет, курсор не меняется.
  Курсор ограничен 200 записями: вытесняются сначала отсутствующие (старейшие по `last`), видимые — никогда.
  Старый формат курсора `{"seen": {"<отпечаток>": "<день>"}}` читается без событий.
- **`core.pbx_started`** (`PbxStartedSource`, push через хук `onAfterPbxStarted`): время загрузки из
  `/proc/uptime`; если прочитать не удалось — событие не создаётся (не угадываем).

Известные ограничения: (а) ложного «пропущенного» из-за позднего ответа не бывает: ядро публикует `CdrConnector` только после завершения всей цепочки linkedid (Q13 снят);
(б) страхующий опрос `cdr_general` (колонка таблицы выше) пока не нужен: событие приходит по AMI,
опрос добавим, только если на станции будут пропуски; (в) переводы названий типов событий добавляются
в этапе 1.4 вместе с интерфейсом (в 1.2 текстов событий нигде не показывается).

## Модули MIKO (только их публичный REST API v3)

Перед реализацией каждого адаптера сверить ресурсы и параметры по OpenAPI модуля на целевой версии.
Если нужного чтения в API модуля нет — событие откладывается и фиксируется в `11-open-questions.md`;
модуль-источник ради хаба не меняем.

Колонка «Доступ» — результат проверки ограниченным ключом хаба на тестовой станции 18.11.2026 (Q1).

| Модуль | Тип события | Откуда | Доступ | Курсор / дедуп | Этап |
|---|---|---|---|---|---|
| ModuleAISupervisor | `ai_supervisor.attention_call` | `GET /pbxcore/api/v3/module-ai-supervisor/calls?attention=1&period=…&limit=…` (фильтр `attention` — `Lib/RestAPI/Calls/DataStructure.php:193`); запись — публичный `GET /pbxcore/api/v3/cdr/{id}` / `?linkedid=…` (read) | ✅ `read`, звонки и CDR видны | скользящее окно по дате + `ref_id`; `ai_attention:{ref_id}` | 1 ✅ (1.3); вложение — 3a |
| ModuleAISupervisor | `ai_supervisor.worker_offline` (+ `…_online`) | `GET …/module-ai-supervisor/workers`, diff статусов | ✅ `read` | `ai_worker:{uid}:{state}:{since}` | 1 ✅ (1.3) |
| ModuleAISupervisor | `ai_supervisor.call_assigned` | `GET …/calls` с полями workflow — проверить фильтр по изменению | ✅ `read` (тот же ресурс) | `ai_assign:{ref_id}:{assignee}:{ts}` | 4 |
| ModuleCloudAISupervisor | `cloud_ai.paused` / `cloud_ai.resumed` | REST состояния очереди/биллинга — уточнить ресурс | ⏳ Cloud AI откроет `read` (решение Q10/Q11) | `cloud_ai_pause:{reason}:{since}` | после доработки Cloud AI |
| ModuleLocalSpeechToText | `local_stt.worker_offline` | `GET /pbxcore/api/v3/module-local-speech-to-text/workers`, diff статусов | ⏳ сейчас только `admin`; Local STT откроет `read` (решение Q10/Q11) | `stt_worker:{uid}:{state}:{since}` | после доработки Local STT |
| ModuleLocalSpeechToText | `local_stt.backlog_no_workers` | только по `/workers` (нет онлайн-воркеров дольше N минут); `/jobs` ограниченному ключу закрыт | ⏳ как выше | `stt_backlog:{window}` | после доработки Local STT |
| ModuleCloudSpeechToText | `cloud_stt.incident`, `cloud_stt.paused` | `incidents`, `health`, `processing-controls` | ⏳ сейчас 403 (только JWT администратора); Cloud STT откроет `read` (решение Q10/Q11) | `cloud_stt_incident:{incident_id}:{state}`, `cloud_stt_pause:{reason}:{since}` | после доработки Cloud STT |
| ModuleVoiceAgent | `voice_agent.callback_request` | `GET /pbxcore/api/v3/module-voice-agent/callbacks` — новые заявки на перезвон | ✅ `read` | `va_callback:{id}` | 1 ✅ (1.3) |
| ModuleVoiceAgent | `voice_agent.runtime_down/up` | `GET …/module-voice-agent/runtime` (`health`, `agents`) | ✅ `read` | `va_runtime:{state}:{since}` | 1 ✅ (1.3) |

Запись `attention_call` не копируется в событие: в `payload.attachments` лежит только факт
`{kind: recording, source: cdr, linkedid, cdr_id?}`; путь/токен скачивания появляются только внутри
`RecordingLocator` (этап 3a). `core.voicemail` кладёт путь из AMI (`vm-recordingfile`); `core.missed_call`
вложений не несёт.

Ядро: `GET /pbxcore/api/v3/advice` с ключом хаба — ✅ 200.

### Реализация 1.3 (18.11.2026)

Реализовано в `Lib/Sources/Modules/` (poll-режим, `requiredModule` установлен, проверяется
`Tests/check-module-sources.php`):

- **`ai_supervisor.attention_call`** (`AiAttentionCallSource`, poll 60 с, путь ключа
  `/api/v3/module-ai-supervisor/calls`): опрос `calls?attention=1&period=7d&sort=date_desc`
  постранично (100 × до 3 страниц — самые свежие по дате звонка). Курсор — ограниченный набор
  видимых `ref_id` (500, старые вытесняются), не «водяной знак»: новый id в любом месте окна —
  новое событие, поэтому поздний анализ старого звонка не пропускается; окно 7 дней с запасом
  покрывает задержку анализа (минуты–часы). Базлайн — только набор id, без событий и без запросов
  детализации. dedupe `ai_attention:{ref_id}` — повторный анализ не алертит повторно, даже если
  id уже вытеснен из курсора. Событие собирает всё по ТЗ `moduleaisupervisor#10`: номер клиента,
  сотрудник (номер → `user_id`/имя по карте внутренних номеров, Q12), направление, дата/время,
  длительность, причины (`list_view`: risks, risk_drivers, flags, contact_reason, topics),
  оценки (quality_score/risk_score/quality_v2), краткое описание, `call_id = linkedid`.
  **Цитаты с таймкодами** в списке отсутствуют (только `evidence_count`): для каждого нового id
  дополнительно читается `GET calls/{id}` (`ai_result.indicators.evidence`: quote, start_ms,
  end_ms — миллисекунды от начала звонка), берётся до 3 цитат; не более 10 запросов детализации
  за опрос; сбой детализации деградирует к событию без цитат.
  Новые id сверх бюджета детализации (10 за опрос) **откладываются**, а не теряются: они не попадают
  в курсор и обрабатываются следующим опросом (с цитатами), пока очередь не иссякнет. Позиции
  видимых в окне id в курсоре обновляются каждый опрос, поэтому лимит 500 вытесняет только id,
  покинувшие окно. **Ограничение:** мониторинг покрывает не более `MAX_PAGES × PAGE_LIMIT` = 300
  самых свежих attention-звонков окна 7 дней; поздний анализ звонка старше 300 самых свежих
  attention-звонков не будет обнаружен.
- **`ai_supervisor.workers`** (`AiWorkerStateSource`, poll 60 с, `/api/v3/module-ai-supervisor/workers`):
  статусы `online`/`offline` сам модуль уже дебаунсит (таймаут heartbeat 900 с). События — только
  переходы уже виденного воркера: `worker_offline` (warning), `worker_online` (info, восстановление).
  Воркер, впервые увиденный офлайн, событие не даёт.
- **`voice_agent.callbacks`** (`VaCallbackSource`, poll 60 с, `/api/v3/module-voice-agent/callbacks`):
  список приходит «новейшие первыми» (`created_at DESC, id DESC`), курсор `max_id`; события только
  по новым заявкам, dedupe `va_callback:{id}`. Страница 100: при потоке >100 заявок за интервал
  опроса хвост догоняет следующий проход (курсор двигается только по реально виденным id).
- **`voice_agent.runtime`** (`VaRuntimeSource`, poll 60 с, `/api/v3/module-voice-agent/runtime`):
  `health.state`: `ok` → up; `unreachable`/`error`/`unauthorized` → down; `not_configured` — ни то
  ни другое (ничего не развёрнуто, состояние конфигурации, а не авария): без события, последнее
  реальное состояние сохраняется в курсоре. События на смену реального состояния: `runtime_down`
  (critical), `runtime_up` (info), dedupe `va_runtime:{state}:{ts перехода}`.

Доступность: недоступность модуля (`module_missing`/`module_disabled`) сбрасывает курсор источника —
после возврата модуля источник заново снимает базлайн и не выдаёт историю (правило 5).

Известные ограничения: (а) скан окна ограничен 300 свежими записями (3×100) — при >300
«требующих внимания» звонках за 7 дней новый анализ в глубине окна будет замечен на следующем
проходе только когда поднимется в выдаче; на практике набор внимания так велик не бывает, при
необходимости увеличить `MAX_PAGES`; (б) переводы названий типов событий — в этапе 1.4.

Кандидаты следующих версий (сторонние/другие модули MIKO, только при наличии читаемого API):
ModuleBackup (сбой резервной копии), ModuleGetSsl (не продлён сертификат), ModuleVPN (туннель упал),
ModuleAmoCrm/ModuleBitrix24Integration (ошибки токена/синхронизации), ModuleRemoteSupport (открыт сеанс),
ModuleQueueCallBack (результат обратного звонка). Каталог с оценкой — в `11-open-questions.md` (Q6).

## Доступность источника

`availability()` проверяет по порядку: модуль установлен (`m_PbxExtensionModules`) → включён →
API отвечает и версия контракта совместима → последний опрос без ошибки. Состояние видно в интерфейсе
хаба (страница «Источники») и в `GET …/module-messenger-hub/sources`.
