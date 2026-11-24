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
| Очередь: клиент не дождался | `core.queue_abandoned` | AMI `UserEvent: CdrConnector`, три факта одного плеча очереди: `queue_start` / `queue_answer` / `queue_end` (`lua/extensions.lua:1582-1723`), корреляция по `linkedid` + id плеча, вердикт через 3 с тишины после `queue_end`; имя очереди — чтение Core `CallQueues` | `queue_abandon:{linkedid}:{queue}` | 4s |
| Звонок в нерабочее время | `core.call_out_of_hours` | AMI `UserEvent: CdrConnector`, action `dial_outworktimes` (`lua/extensions.lua:1845-1867`, `ExtensionsOutWorkTimeConf.php:161-163`); один факт на звонок | `ooh:{linkedid}` | 4s |
| Звонок вернулся с парковки | `core.park_timeout` | AMI `UserEvent: CdrConnector`, action `unpark_call_timeout` (`lua/extensions.lua:1954-1994`, `ResParkingConf.php:188-194`) | `park_timeout:{linkedid}` | 4s |
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

### Реализация 4s-B (24.11.2026, без станции)

Три push-источника на том же AMI-потоке `UserEvent: CdrConnector`, что и пропущенные звонки.
Логика без ядра — `Lib/Sources/Core/QueueAbandonSource`, `CallOutOfHoursSource`, `ParkTimeoutSource`;
классы без ядра проверяются `Tests/check-source-calls.php` (фикстуры `Tests/fixtures/core-call-events/`,
включая `GZ:`-вариант).

**AMI-пользователь.** Воркер `WorkerMessengerHubAmi` подключается через `Util::getAstManager()` — это
учётная запись ядра `phpagi` (`read=all`, `permit=127.0.0.1`,
`src/Core/Asterisk/Configs/ManagerConf.php:219-233`), подписка — AMI-действием
`Filter: UserEvent: CdrConnector`. Пользователи менеджера, заводимые в интерфейсе, получают
`eventfilter=!UserEvent: CdrConnector` (`ManagerConf.php:210`) и эти события не получают; своей учётки
хаб не создаёт (решение Q2), поэтому смена источника AMI в ядре сломала бы все четыре CdrConnector-источника
сразу — это записано как риск приёмки на станции.

**`core.queue_abandoned`** (`QueueAbandonSource`). Факты одного плеча очереди ядро публикует тремя
событиями с одного и того же потока (`src/Core/Asterisk/Configs/lua/extensions.lua:1582-1723`;
`queue_end` выполняется сразу после `Queue()`, `src/Core/Asterisk/Configs/QueueConf.php:232`):

| action | поля, которые использует хаб |
|---|---|
| `queue_start` | `dst_num` (номер очереди), `src_num` (клиент), `did`, `UNIQUEID` (id плеча очереди), `start` |
| `queue_answer` | `id` (= `UNIQUEID` плеча), `answer` — агент снял трубку |
| `queue_end` | `id`, `end`, `dialstatus` (= `QUEUESTATUS`) |

- Корреляция — по (`linkedid`, id плеча) с откатом «единственное открытое плечо этого `linkedid`», если
  факт пришёл без id: `queue_start` при переводе/обновлении строки может не нести `start`, а `id` в
  `queue_answer`/`queue_end` берётся из переменной канала.
- Вердикт — не в момент `queue_end`, а через `SETTLE_SEC = 3` с тишины: `queue_answer`, пришедший после
  `queue_end` (порядок доставки AMI не гарантирован), ещё отменяет «не дождался». Факты, пришедшие
  раньше `queue_start`, буферизуются и дополняются стартом; если старт так и не пришёл, события нет —
  половина звонка не факт (рестарт воркера, включение источника посреди разговора).
- Событие: `queue_start` был, и либо плечо закончилось без `queue_answer` и ожидание ≥
  `queue_abandon_min_wait_sec` (default `0` — любой отказ), либо ожидание ≥ `queue_long_wait_sec`
  (default `0` — выключено; тогда событие возможно и для отвеченного звонка). `reason` в payload —
  `abandoned` (severity `warning`) или `long_wait` (severity `info`).
- Payload: `subject.call` = `linkedid`, `direction` (`internal`, если клиент — внутренний номер по карте
  Q12, иначе `incoming`), `started_at`, `waited_sec`, `queue_number`, `queue_name`, `reason`;
  `subject.client_number` — номер клиента полностью (маскирование — на шаблоне). Имя очереди — тонкое
  чтение модели ядра `CallQueues` (`Lib/Support/QueueNamesLoader`), обновляется воркером AMI раз в 5 минут;
  сбой чтения имён не мешает классификации звонков.
- `dedupe_key = queue_abandon:{linkedid}:{queue}`. Буфер ограничен 200 плечами и 6 часами: `queue_end`,
  который так и не пришёл, не копит память (запись просто выбрасывается).
- **Связь с `core.missed_call`.** Оба источника срабатывают на один и тот же `linkedid` независимо
  (у них разные ключи дедупликации) — это осознанно: правило выбирает сценарий. `linkedid` есть в payload
  обоих, поэтому будущая дедупликация на уровне маршрутизатора возможна без изменения источников.
- Известные ограничения: (а) повторный заход в **ту же** очередь в рамках одного `linkedid` даёт тот же
  `dedupe_key` и второе сообщение не уходит (ключ согласован в ТЗ); (б) отвеченный звонок, который ядро
  увело из очереди по `timeout_extension` (без `queue_answer`), выглядит как отказ от ожидания —
  проверить на станции (Q18).

**`core.call_out_of_hours`** (`CallOutOfHoursSource`). Правило нерабочего времени ядра уводит входящий
звонок в контекст `[playback-exit]`, который выполняет `Gosub(dial_outworktimes,...)` один раз на звонок
(`src/Core/Asterisk/Configs/ExtensionsOutWorkTimeConf.php:161-163`); lua публикует факт с полями
`event_dial()` (`src/Core/Asterisk/Configs/lua/extensions.lua:1845-1867`): `src_num` (клиент), `did`
(`FROM_DID`), `start`, `linkedid`, `UNIQUEID`. Payload: `subject.call` = `linkedid`, `direction` =
`incoming`, `started_at`, `did`, `rule_id = null`, `rule_name = ''`; `subject.client_number` — клиент.
`dedupe_key = ooh:{linkedid}`, severity `warning`. Правило нерабочего времени в событии не передаётся
(ядро не кладёт id правила в dialplan-вызов) — не выдумываем, вопрос Q17. Пропущенный звонок за тот же
`linkedid` (если после сообщения вызов завершился) приходит отдельным событием — это допустимо.

**`core.park_timeout`** (`ParkTimeoutSource`). Контекст таймаута парковки выполняет
`Gosub(unpark_call_timeout,...)` (`src/Core/Asterisk/Configs/ResParkingConf.php:188-194`); lua публикует
`src_num` (клиент), `dst_num` (место парковки), `start`/`endtime` (start = «сейчас минус длительность
парковки»), `did`, `linkedid`, `PARKER` (канал того, кто парковал) — `lua/extensions.lua:1954-1994`.
`PARKER` — имя канала, а не номер: внутренний номер извлекается тем же правилом, что и в ядре
(`CUT(PARKER,/,2)`, `ResParkingConf.php:193`, плюс отсечение `@`-домена и `-суффикса` канала как в
`getAccountName()`, `extensions.lua:233-257`). Payload: `subject.call` = `linkedid`, `direction` (`incoming`, только если в событии
есть DID — парковать можно и исходящий или внутренний звонок, поэтому без DID направление не заявляется:
`unknown`), `started_at`, `park_slot`, `parked_by`, `parked_sec`, `did`; `subject.client_number` —
клиент. `dedupe_key = park_timeout:{linkedid}`, severity `warning`. Ограничение: повторная парковка того
же `linkedid` после таймаута даст тот же ключ и не оповестит второй раз (ключ согласован в ТЗ).

**Настройки.** `HubSettings::QUEUE_ABANDON_MIN_WAIT_SEC` (`queue_abandon_min_wait_sec`) и
`HubSettings::QUEUE_LONG_WAIT_SEC` (`queue_long_wait_sec`), 0…3600 с, default `0`; отдаются в
`settings` (DataStructure + `Messages/*` + вкладка «Настройки»), читаются воркером AMI раз в минуту и
клампятся ещё раз в источнике. В PUT новые поля необязательны (старые клиенты PUT не ломаются).

**Шаблоны и тексты.** `Lib/Routing/Templates/QueueAbandonTemplate`, `CallOutOfHoursTemplate`,
`ParkTimeoutTemplate` (номер клиента — через `MessageFormat::phone`, маскирование по правилу/настройке;
кнопка «Открыть звонок» — журнал звонков ядра через `LinkBuilder`). Тексты — `Messages/*` (ru первым,
затем 28 локалей, блок `4s-B`), тип события и имя источника — в `SourceCatalog` (группа `calls`).

## Модули MIKO (только их публичный REST API v3)

Перед реализацией каждого адаптера сверить ресурсы и параметры по OpenAPI модуля на целевой версии.
Если нужного чтения в API модуля нет — событие откладывается и фиксируется в `11-open-questions.md`;
модуль-источник ради хаба не меняем.

Колонка «Доступ» — результат проверки ограниченным ключом хаба на тестовой станции 18.11.2026 (Q1).

| Модуль | Тип события | Откуда | Доступ | Курсор / дедуп | Этап |
|---|---|---|---|---|---|
| ModuleAISupervisor | `ai_supervisor.attention_call` | `GET /pbxcore/api/v3/module-ai-supervisor/calls?attention=1&period=…&limit=…` (фильтр `attention` — `Lib/RestAPI/Calls/DataStructure.php:193`); запись — публичный `GET /pbxcore/api/v3/cdr/{id}` / `?linkedid=…` (read) | ✅ `read`, звонки и CDR видны | скользящее окно по дате + `ref_id`; `ai_attention:{ref_id}` | 1 ✅ (1.3); вложение — 3a |
| ModuleAISupervisor | `ai_supervisor.worker_offline` (+ `…_online`) | `GET …/module-ai-supervisor/workers` (любая версия модуля с `/workers`; полей `id`, `status`, `last_seen`) | ✅ `read` | `<source>:worker_offline:<ref>:<since>` | 1 ✅ (1.3), 3b-1 ✅, 3b-5 ✅ |
| ModuleAISupervisor | `ai_supervisor.call_assigned` | `GET …/calls` с полями workflow — проверить фильтр по изменению | ✅ `read` (тот же ресурс) | `ai_assign:{ref_id}:{assignee}:{ts}` | 4 |
| ModuleCloudAISupervisor | `cloud_ai.paused` / `cloud_ai.resumed` | `GET …/module-cloud-ai-supervisor/runtime` (с первого релиза, v1.2): `pause.paused`, `pause.pause_reason` (= `ref`), `pause.paused_at` (= `since`), `summary.analysis_pending` (счётчик) | ✅ `read` на `/runtime` (`RestRequestContext::isAdministrator` принимает `read` для GET) | `<source>:processing_paused:<reason>:<episode since>` | 3b-5 ✅ |
| ModuleLocalSpeechToText | `local_stt.worker_offline` (+ `…_online`) | `GET …/module-local-speech-to-text/workers` (`id`, `status`, `last_seen`, `created_at`): офлайн = статус не `online` или `last_seen` старше 900 с (`STTWorker::markStaleOffline`); `ref` = первые 12 hex `sha256("ModuleLocalSpeechToText:<id>")` | ⚠️ модуль требует `admin` на `/workers` для ключа: ключ хаба получает `admin` ровно на этот путь (Plan/07) | `<source>:worker_offline:<ref>:<episode since>`, `since` = `last_seen` (нет — `created_at`) | 3b-5 ✅ |
| ModuleLocalSpeechToText | `local_stt.backlog_no_workers` (+ `…_resolved`) | `/workers` (как выше) и, только пока ни один воркер не онлайн, `GET …/module-local-speech-to-text/jobs?status=pending&limit=1` (число задач — `pagination.total_items`; самая старая — вторым запросом `offset=total-1`, список идёт по `id` по убыванию): есть ждущие задачи и нет онлайн-воркера ≥ 600 с, `ref = queue`, `since` = max(последний `last_seen`, `created_at` самой старой ждущей задачи) | ⚠️ `admin` ровно на `/workers` и `/jobs` | `<source>:backlog_no_workers:queue:<episode since>` | 3b-5 ✅ |
| ModuleCloudSpeechToText | `cloud_stt.incident` (+ `…_resolved`), `cloud_stt.paused` / `cloud_stt.resumed` | `GET …/module-cloud-speech-to-text/status` (с 1.120): `incident_open` (ref = публичный id инцидента) и `processing_paused` (ref `user`/`maintenance`) | ✅ `read` только на `/status` | `<source>:<code>:<ref>:<episode since>`, подтверждённый инцидент не алертит повторно | 3b-1 ✅; единственный модуль с `/status` (решение 23.11.2026) |
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
- **`ai_supervisor.workers`** (`ModuleStatusSource`, poll 60 с, `/api/v3/module-ai-supervisor/workers`, `read`;
  с 3b-5 читается `/workers` — модуль `/status` не выпускает): события — `worker_offline` (warning,
  debounce 120 с), `worker_online` (info, восстановление). Воркер, уже бывший офлайн на baseline, событие не даёт.
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

### Реализация 3b-1 (22.11.2026, без станции)

**Решение 23.11.2026 (3b-5): универсальный ресурс `/status` остаётся только у ModuleCloudSpeechToText (1.120+).**
Остальные три модуля его не выпускают; хаб читает их существующие ресурсы и приводит ответ к тому же снимку
(`state`, `since`, `issues`, `counters`), поэтому сценарии, условия, миграция и ключи дедупликации не изменились:

| Модуль | Ресурс | Права ключа | Читатель |
|---|---|---|---|
| Cloud STT | `GET …/module-cloud-speech-to-text/status` (с 1.120) | `read` | `ModuleStatusSource::snapshot()` |
| ИИ Супервайзер | `GET …/module-ai-supervisor/workers` | `read` | `AiWorkerStateSource` |
| Cloud AI Supervisor | `GET …/module-cloud-ai-supervisor/runtime` | `read` | `CloudAiRuntimeSnapshot` |
| Local STT | `GET …/module-local-speech-to-text/workers`, `…/jobs` | **`admin`** на эти два пути | `LocalSttSnapshot` |

Форма `/status` Cloud STT (`PBXApiResult.data`):

```json
{
  "state": "ok | degraded | down | paused",
  "since": 0,
  "issues": [{"code": "worker_offline", "ref": "3f2a9c1d0b7e", "severity": "warning", "since": 1790944800}],
  "counters": {"workers_online": 2, "workers_total": 3}
}
```

`code` — фиксированный машинный код, `ref` — непрозрачный стабильный id, `since` у issue не меняется
между опросами; верхний `since` информационный и **не участвует в дедупликации** (при `state = ok`
модули отдают `0`). Свободного текста, адресов и путей в ответе нет.

Реализовано одним адаптером `Lib/Sources/Modules/ModuleStatusSource`: профиль на источник (module id,
вид читателя, пути ресурсов, source id, минимальная версия — только у Cloud STT, правила
`code → тип события / серьёзность / recovery / debounce`) задан в `ModuleStatusSource::PROFILES`;
регистрация — `SourceRegistry::default()`.

**Один источник = один сценарий = один вид проблемы (этап 3b-4).** Источник опрашивает ресурс своего
модуля раз в минуту и обрабатывает только свои коды (общий разбор ответа между источниками не нужен: опрос
локальный, дешёвый, а связность источников хуже). `local_stt.workers` читает только `/workers`;
`local_stt.backlog` читает `/workers` и, лишь пока ни один воркер не онлайн, `/jobs`:

| Источник | Модуль | Код → события | Название (ru) |
|---|---|---|---|
| `local_stt.workers` | Local STT | `worker_offline` → `local_stt.worker_offline` / `local_stt.worker_online` | Сбой воркеров распознавания |
| `local_stt.backlog` | Local STT | `backlog_no_workers` → `local_stt.backlog_no_workers` / `local_stt.backlog_resolved` | Очередь распознавания без воркеров |
| `cloud_stt.incidents` | Cloud STT | `incident_open` → `cloud_stt.incident` / `cloud_stt.incident_resolved` | Инциденты облачного распознавания |
| `cloud_stt.paused` | Cloud STT | `processing_paused` → `cloud_stt.paused` / `cloud_stt.resumed` | Пауза облачного распознавания |
| `cloud_ai.paused` | Cloud AI Supervisor | `processing_paused` → `cloud_ai.paused` / `cloud_ai.resumed` (`not_configured` игнорируется) | Пауза облачного анализа |
| `ai_supervisor.workers` | ИИ Супервайзер | `worker_offline` → `ai_supervisor.worker_offline` / `…_online` | Сбой воркеров |

Имена типов событий не менялись, поэтому правила (они хранят `event_types`, а не id источника) работают без
правки: правило со всеми четырьмя типами Local STT совпадёт с событиями обоих новых источников.

**Миграция идентификаторов (`SourceIdMigration`, вызывается воркером коллектора при старте и перед чтением
настроек REST; идемпотентна).** Прежние `local_stt.status`, `cloud_stt.status`, `cloud_ai.status` исчезли:
выключатель `enabled` прежней строки `m_MessengerHubSourceState` переносится на новые источники того же
модуля, курсоры отбрасываются, прежние строки и кэш `status_capability.*` удаляются. Новые источники
стартуют с пустым курсором, то есть с тихого baseline: проблемы, существующие на момент обновления, записываются
как «известные» и не рассылаются. Ключ дедупликации содержит id источника (`cloud_stt.incidents:…` вместо
`cloud_stt.status:…`), поэтому повтор объявленного инцидента защищён не ключом, а baseline: пара, уже
присутствующая при первом опросе, события не порождает ни под каким ключом. Цена: recovery для инцидента,
объявленного до обновления, не придёт (пара не «объявлена» новым источником); новые эпизоды работают как обычно.
`ai_supervisor.workers` сохраняет id, ключ и курсор: смена читателя ничего не пересылает.

**Условия сценария на шаге 2 мастера.** «Сообщать о восстановлении» (по умолчанию включено) — наличие
recovery-типа в `event_types` правила (отдельного хранилища нет). Важность для `cloud_stt.incident` —
`min_severity` правила (`warning` — по умолчанию, `critical`); recovery-событие всегда `info`, поэтому для
правила со status-payload сравнивается серьёзность закрываемого инцидента (`module_status.severity`).
Причины паузы Cloud AI — фильтр `filters.reasons` (список из `insufficient_funds`, `low_balance`,
`license_missing`, `auth_invalid`, `daily_limit_reached`, `model_unavailable`, `source_unavailable`, `manual`),
Router сравнивает его с `subject.module_status.ref` событий `cloud_ai.paused` и `cloud_ai.resumed`; новое правило
по умолчанию берёт всё, кроме `manual`; нет фильтра — все причины; неизвестная модулю хаба причина не
совпадает. Группы в мастере: «Деньги», «Лицензия и доступ», «Лимиты и модель», «Источник данных», «Ручная пауза».

- **Diff по (`code`, `ref`)** в `m_MessengerHubSourceState`: появление → событие, исчезновение →
  recovery-событие (info) там, где оно определено. Базлайн — на включении источника и на первом
  успешном опросе после возврата модуля: уже существующие проблемы записываются как известные и не
  рассылаются. Старый курсор 1.3 (`{"workers": …}`) читается как «нет базлайна»: воркер, уже бывший
  офлайн, не алертит повторно после обновления хаба.
- **Debounce**: пара должна наблюдаться ≥ N с (в профиле: 120 с для `worker_offline`, 0 для
  `backlog_no_workers`, инцидентов и пауз). Пока пара не подтверждена, она хранится `pending`;
  исчезновение до подтверждения не даёт «восстановления». Рестарт воркера таймер не сбрасывает.
- **dedupe_key** `<source>:<code>:<ref>:<episode since>`, у recovery — тот же ключ с суффиксом
  `:recovered`. Подтверждённый инцидент Cloud STT остаётся открытым с тем же `ref`/`since`, поэтому
  повторно не алертит. Пока пара (`code`, `ref`) непрерывно присутствует в ответе, это один инцидент:
  смена `since` (Cloud STT `maintenance`, Local STT `backlog_no_workers`) обновляет курсор без события и без
  нового debounce. Новый эпизод — только если пары не было в предыдущем опросе; `<episode since>` — `since`
  при первом наблюдении эпизода (стабилен при рестарте). Вернувшаяся пара с тем же `since` после
  объявленного эпизода получает суффикс `:<время первого наблюдения хабом>`, чтобы dedupe её не проглотил.
  Recovery — только для объявленного инцидента (флаг `announced` в курсоре): пары из baseline и пары, не
  прошедшие debounce, исчезают молча; записи курсора без флага считаются не объявленными.
- **Cloud AI `not_configured`** не даёт событий вообще и не попадает в курсор (постоянное состояние
  не настроенной облачной АТС). `manual` — `info`, `license_missing` / `auth_invalid` /
  `model_unavailable` / `daily_limit_reached` / `source_unavailable` — `warning`, `insufficient_funds` /
  `low_balance` — `critical`.
- **Серьёзность**: `local_stt.worker_offline` — warning, `local_stt.backlog_no_workers` — critical;
  `cloud_stt.incident` — как у инцидента; `cloud_stt.paused` и `cloud_ai.paused` — по причине;
  recovery-события — info.
- **ИИ Супервайзер** читает `/workers` (`read`): `ref` = первые 12 hex `sha256("ModuleAISupervisor:<id>")`,
  `since` = `last_seen`, офлайн — собственный статус модуля, воркеры, молчащие дольше 30 суток, не считаются.
  Ключ `<source>:worker_offline:<ref>:<since>` и курсор те же, что были при чтении `/status` (тот же `ref` и
  `since`): воркер, уже объявленный раньше, не алертит повторно, его recovery приходит со старым типом события.
- **Local STT**: онлайн — статус `online` **и** `last_seen` не старше 900 с; `ref` — первые 12 hex
  `sha256("ModuleLocalSpeechToText:<id>")`, `since` = `last_seen` (воркер, не выходивший на связь, — `created_at`)
  — как в курсорах эпохи `/status`. Имена, адреса и ключи воркеров, `call_id` задач в снимок не попадают.
  `backlog_no_workers`: ждущие задачи есть, онлайн-воркеров нет ≥ 600 с. Если `since` в эпизоде сдвигается,
  это тот же инцидент (правило «движущегося `since`» выше).
- **Cloud AI**: `/runtime` → `pause.paused = true` и непустая `pause.pause_reason` дают один `processing_paused`
  с `ref` = причина и `since` = `paused_at`; серьёзность по причине (см. выше), `not_configured` игнорируется,
  неизвестная причина проходит со `warning`. Счётчик `jobs_waiting` = `summary.analysis_pending`, если он есть.
  Баланс, модель и лимиты не читаются.
- **Доступность при старом модуле**: 404 на ресурсе → `api_incompatible` (в интерфейсе — «Нужно обновить
  модуль», `settings:getSources` отдаёт `update_to`; минимальная версия задана только у Cloud STT — 1.120,
  у остальных пусто), курсор сбрасывается, ошибок в лог нет; после обновления модуля — тихий базлайн.
  403 на ресурсе при исправном ключе (после самолечения ключа) → `api_forbidden` («Модуль не даёт доступа к данным»).
- Ключ хаба (Plan/07): `read` на ресурсах источников (у ИИ Супервайзера `/calls` и `/workers`, у Cloud AI `/runtime`,
  у Cloud STT `/status`), **`admin` ровно на `/workers` и `/jobs` Local STT**, привязан к localhost. Шаблоны — `Lib/Routing/Templates/ModuleStatusTemplate.php`
  (коды и причины переводятся в человеческий текст, счётчики и время — в заметках).

Кандидаты следующих версий (сторонние/другие модули MIKO, только при наличии читаемого API):
ModuleBackup (сбой резервной копии), ModuleGetSsl (не продлён сертификат), ModuleVPN (туннель упал),
ModuleAmoCrm/ModuleBitrix24Integration (ошибки токена/синхронизации), ModuleRemoteSupport (открыт сеанс),
ModuleQueueCallBack (результат обратного звонка). Каталог с оценкой — в `11-open-questions.md` (Q6).

## Доступность источника

`availability()` проверяет по порядку: модуль установлен (`m_PbxExtensionModules`) → включён →
API отвечает и версия контракта совместима → последний опрос без ошибки. Состояние видно в интерфейсе
хаба (страница «Источники») и в `GET …/module-messenger-hub/sources`.

Значения: `available`, `disabled`, `module_missing`, `module_disabled`, `api_forbidden`,
`api_incompatible` (модуль установлен и включён, но не отдаёт нужный ресурс — например, `/status`
Cloud STT появился только в 1.120; интерфейс показывает минимальную версию из `update_to`), `error`.
