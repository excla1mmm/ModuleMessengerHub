"use strict";

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
/* ModuleMessengerHub admin page: notifications, wizard, journal and settings (design v3, docs/design/ModuleMessengerHub-v3.html).
 * Data comes only from the module REST resources (settings, events, bots, rules) and Core v3 lists. No external CDNs.
 * Written in plain ES5 (targets Chrome 50 / Firefox 45 / IE11 after the Babel pass).
 */
(function () {
  'use strict';

  var API_BASE = '/pbxcore/api/v3/module-messenger-hub';
  var PAGE_LIMIT = 50;
  var REFRESH_SEC = 30;
  var GROUP_ORDER = ['calls', 'ai_supervisor', 'speech_ai', 'voice_agent', 'pbx', 'security'];
  var ICON_ERROR = '<svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M6 6l4 4M10 6l-4 4"/></svg>';
  var ICON_CHEVRON = '<svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg>';
  var ICON_PLUS = '<svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
  var root = null;
  var state = {
    sources: [],
    period: 'today',
    eventType: '',
    offset: 0,
    total: 0,
    hasLoaded: false,
    lastItems: [],
    callbacks: {},
    expandedId: null,
    loadSeq: 0,
    retention: 30,
    settings: null,
    bots: [],
    botsLoaded: false,
    botsError: null,
    expandedBots: {},
    employees: [],
    employeesLoaded: false,
    employeesFailed: false,
    showProbes: false,
    botModal: null,
    chatModal: null,
    testModal: null,
    rules: [],
    rulesLoaded: false,
    rulesError: null,
    providers: [],
    providersLoaded: false,
    ruleWizard: null
  };

  // ---------- i18n ----------

  function t(key) {
    if (typeof globalTranslate !== 'undefined' && globalTranslate[key]) {
      return globalTranslate[key];
    }
    return key;
  }
  function tf(key, params) {
    var text = t(key);
    Object.keys(params || {}).forEach(function (name) {
      text = text.split('{' + name + '}').join(String(params[name]));
    });
    return text;
  }

  // ---------- small helpers ----------

  function pad(value) {
    return value < 10 ? '0' + value : String(value);
  }
  function fmtTime(ts) {
    var d = new Date(ts * 1000);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtDate(ts) {
    var d = new Date(ts * 1000);
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
  }
  function fmtDateTime(ts) {
    return fmtDate(ts) + ' ' + fmtTime(ts);
  }
  function isToday(ts) {
    var d = new Date(ts * 1000);
    var now = new Date();
    return d.toDateString() === now.toDateString();
  }
  function isYesterday(ts) {
    var d = new Date(ts * 1000);
    var yesterday = new Date(Date.now() - 86400000);
    return d.toDateString() === yesterday.toDateString();
  }

  // One line in a 48 px row: «18:34», «вчера 18:34», «12.10 18:34».
  function fmtCellTime(ts) {
    if (isToday(ts)) {
      return fmtTime(ts);
    }
    var d = new Date(ts * 1000);
    var day = isYesterday(ts) ? t('module_messenger_hub_TimeYesterday') : pad(d.getDate()) + '.' + pad(d.getMonth() + 1);
    return '<span class="mh-muted">' + esc(day) + '</span> ' + fmtTime(ts);
  }
  function esc(value) {
    return $('<div/>').text(String(value === null || value === undefined ? '' : value)).html();
  }
  function startOfToday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  }
  function periodBounds() {
    var now = Math.floor(Date.now() / 1000);
    var todayStart = startOfToday();
    switch (state.period) {
      case 'today':
        return {
          from: todayStart,
          to: now
        };
      case 'yesterday':
        return {
          from: todayStart - 86400,
          to: todayStart - 1
        };
      case '7days':
        return {
          from: todayStart - 6 * 86400,
          to: now
        };
      case '30days':
        return {
          from: todayStart - 29 * 86400,
          to: now
        };
      default:
        return {
          from: 0,
          to: 0
        };
    }
  }

  // ---------- API ----------

  function apiGet(path, params, onSuccess, onFailure) {
    $.ajax({
      url: Config.pbxUrl + API_BASE + path,
      method: 'GET',
      data: params || {},
      cache: false
    }).done(function (response) {
      if (response && response.result === true) {
        onSuccess(response.data);
      } else {
        onFailure(normalizeFailure(response, 200));
      }
    }).fail(function (xhr) {
      onFailure(normalizeFailure(null, xhr.status));
    });
  }
  function apiPatch(path, payload, onSuccess, onFailure) {
    $.ajax({
      url: Config.pbxUrl + API_BASE + path,
      method: 'PATCH',
      data: JSON.stringify(payload),
      contentType: 'application/json',
      dataType: 'json'
    }).done(function (response) {
      if (response && response.result === true) {
        onSuccess(response.data);
      } else {
        onFailure(normalizeFailure(response, 200));
      }
    }).fail(function (xhr) {
      onFailure(normalizeFailure(null, xhr.status));
    });
  }
  function normalizeFailure(response, status) {
    return {
      status: status,
      error: response && response.data && response.data.error || 'http_' + status,
      messages: response && response.messages && response.messages.error || []
    };
  }

  // ---------- source catalog ----------

  function loadCatalog(done) {
    apiGet('/settings:getSources', {}, function (data) {
      state.sources = data.items || [];
      done();
    }, function () {
      state.sources = [];
      done();
    });
  }
  function sourceById(id) {
    for (var i = 0; i < state.sources.length; i++) {
      if (state.sources[i].id === id) {
        return state.sources[i];
      }
    }
    return null;
  }
  function eventTypeNames() {
    var names = {};
    state.sources.forEach(function (source) {
      (source.event_types || []).forEach(function (type) {
        names[type.type] = type.name;
      });
    });
    return names;
  }

  // ---------- journal: filters (design v3: period and event only) ----------

  function buildTypeMenu() {
    var names = eventTypeNames();
    var items = [];
    GROUP_ORDER.forEach(function (group) {
      var inGroup = [];
      state.sources.forEach(function (source) {
        if (source.group !== group) {
          return;
        }
        (source.event_types || []).forEach(function (type) {
          inGroup.push({
            value: type.type,
            text: names[type.type] || type.type
          });
        });
      });
      if (inGroup.length > 0) {
        items.push({
          group: sourceGroupName(group)
        });
        inGroup.forEach(function (item) {
          items.push(item);
        });
      }
    });
    $('#mh-journal-filters .mh-filter-type').dropdown({
      values: menuToValues(items),
      placeholder: t('module_messenger_hub_FilterAllTypes'),
      onChange: function onChange(value) {
        state.eventType = String(value || '');
        reload();
      }
    });
  }
  function menuToValues(items) {
    return items.map(function (item) {
      if (item.group) {
        return {
          type: 'header',
          name: item.group
        };
      }
      return {
        name: item.text,
        value: item.value
      };
    });
  }
  function sourceGroupName(group) {
    var key = {
      calls: 'module_messenger_hub_GroupCalls',
      ai_supervisor: 'module_messenger_hub_GroupAiSupervisor',
      speech_ai: 'module_messenger_hub_GroupSpeechAi',
      voice_agent: 'module_messenger_hub_GroupVoiceAgent',
      pbx: 'module_messenger_hub_GroupPbx',
      security: 'module_messenger_hub_GroupSecurity'
    }[group] || group;
    return t(key);
  }

  // ---------- module status events (stage 3b): human words for (code, ref), raw codes only in a tooltip ----------

  var STATUS_RECOVERY_KEYS = {
    'local_stt.worker_online': 'MessageStatusWorkerOnline',
    'local_stt.backlog_resolved': 'MessageStatusBacklogResolved',
    'cloud_stt.incident_resolved': 'MessageStatusIncidentResolved',
    'cloud_stt.resumed': 'MessageStatusResumed',
    'cloud_ai.resumed': 'MessageStatusCloudAiResumed',
    'ai_supervisor.worker_online': 'MessageStatusWorkerOnline'
  };
  var STATUS_CODE_KEYS = {
    worker_offline: 'MessageStatusWorkerOffline',
    backlog_no_workers: 'MessageStatusBacklog',
    incident_open: 'MessageStatusIncident'
  };
  var STATUS_PAUSE_KEYS = {
    user: 'MessageStatusPausedUser',
    maintenance: 'MessageStatusPausedMaintenance',
    recovery_blocked: 'MessageStatusPausedRecoveryBlocked',
    manual: 'MessageStatusCloudAiManual',
    license_missing: 'MessageStatusCloudAiLicense',
    auth_invalid: 'MessageStatusCloudAiAuth',
    model_unavailable: 'MessageStatusCloudAiModel',
    daily_limit_reached: 'MessageStatusCloudAiDailyLimit',
    source_unavailable: 'MessageStatusCloudAiSourceUnavailable',
    insufficient_funds: 'MessageStatusCloudAiInsufficientFunds',
    low_balance: 'MessageStatusCloudAiLowBalance'
  };

  // Problem event type -> its recovery type. A status scenario is always one pair; «Сообщать о восстановлении»
  // is the recovery type being in the rule's event_types (no separate storage).
  var STATUS_PAIRS = {
    'local_stt.worker_offline': 'local_stt.worker_online',
    'local_stt.backlog_no_workers': 'local_stt.backlog_resolved',
    'cloud_stt.incident': 'cloud_stt.incident_resolved',
    'cloud_stt.paused': 'cloud_stt.resumed',
    'cloud_ai.paused': 'cloud_ai.resumed',
    'ai_supervisor.worker_offline': 'ai_supervisor.worker_online'
  };
  // Cloud AI pause reasons by group (rule filter `reasons`); not_configured never produces events.
  var CLOUD_AI_REASON_GROUPS = [['module_messenger_hub_WizardReasonGroupMoney', ['insufficient_funds', 'low_balance']], ['module_messenger_hub_WizardReasonGroupLicense', ['license_missing', 'auth_invalid']], ['module_messenger_hub_WizardReasonGroupLimits', ['daily_limit_reached', 'model_unavailable']], ['module_messenger_hub_WizardReasonGroupSource', ['source_unavailable']], ['module_messenger_hub_WizardReasonGroupManual', ['manual']]];
  function cloudAiReasons(includeManual) {
    var reasons = [];
    CLOUD_AI_REASON_GROUPS.forEach(function (group) {
      group[1].forEach(function (reason) {
        if (includeManual || reason !== 'manual') {
          reasons.push(reason);
        }
      });
    });
    return reasons;
  }
  function moduleStatusOf(item) {
    var subject = item && item.payload && item.payload.subject ? item.payload.subject : {};
    return subject.module_status && _typeof(subject.module_status) === 'object' ? subject.module_status : null;
  }

  /** One sentence for an event type + (code, ref); an unknown pair gets a neutral line, never the raw code. */
  function statusPhrase(eventType, status) {
    var code = String(status && status.code || '');
    var ref = String(status && status.ref || '');
    var key = STATUS_RECOVERY_KEYS[eventType] || (code === 'processing_paused' ? STATUS_PAUSE_KEYS[ref] : null) || STATUS_CODE_KEYS[code] || 'MessageStatusUnknown';
    return t('module_messenger_hub_' + key);
  }
  function statusCounterNotes(status) {
    var counters = status && status.counters ? status.counters : {};
    var notes = [];
    if (typeof counters.workers_online === 'number' && typeof counters.workers_total === 'number') {
      notes.push(tf('module_messenger_hub_MessageStatusWorkersCounters', {
        online: counters.workers_online,
        total: counters.workers_total
      }));
    }
    if (typeof counters.jobs_waiting === 'number') {
      notes.push(tf('module_messenger_hub_MessageStatusJobsWaiting', {
        count: counters.jobs_waiting
      }));
    }
    if (typeof counters.incidents_open === 'number') {
      notes.push(tf('module_messenger_hub_MessageStatusIncidentsOpen', {
        count: counters.incidents_open
      }));
    }
    return notes;
  }

  /** Technical tooltip: the raw code and reference of the module status, never the main text. */
  function statusRawCode(item) {
    var status = moduleStatusOf(item);
    if (!status || !status.code) {
      return '';
    }
    return String(status.code) + (status.ref ? ':' + status.ref : '');
  }

  /** Informational state of a source whose module cannot be read (no action buttons, decision Q14). */
  function sourceStateText(source) {
    switch (source.availability) {
      case 'module_missing':
        return t('module_messenger_hub_SourceStateNoinst');
      case 'module_disabled':
        return t('module_messenger_hub_SourceStateModoff');
      case 'api_forbidden':
        return t('module_messenger_hub_NotifSourceNoAccess');
      case 'api_incompatible':
        return source.update_to ? tf('module_messenger_hub_SourceStateOutdatedTo', {
          version: source.update_to
        }) : t('module_messenger_hub_SourceStateOutdatedAny');
      default:
        return source.availability_name || '';
    }
  }
  function buildPeriodMenu() {
    $('#mh-journal-filters .mh-filter-period').dropdown({
      values: [{
        name: t('module_messenger_hub_PeriodToday'),
        value: 'today',
        selected: true
      }, {
        name: t('module_messenger_hub_PeriodYesterday'),
        value: 'yesterday'
      }, {
        name: t('module_messenger_hub_Period7Days'),
        value: '7days'
      }, {
        name: t('module_messenger_hub_Period30Days'),
        value: '30days'
      }, {
        name: t('module_messenger_hub_PeriodAll'),
        value: 'all'
      }],
      onChange: function onChange(value) {
        state.period = String(value || 'all');
        reload();
      }
    });
  }
  function resetFilters() {
    state.eventType = '';
    state.period = 'today';
    state.offset = 0;
    $('#mh-journal-filters .mh-filter-type').dropdown('clear');
    $('#mh-journal-filters .mh-filter-period').dropdown('set selected', 'today');
    reload();
  }
  function filtersActive() {
    // the default period («Сегодня») is not a filter: an empty log shows «Событий нет»
    return state.eventType !== '' || state.period !== 'today';
  }

  // ---------- journal: loading ----------

  function reload() {
    state.offset = 0;
    load();
  }
  function load(options) {
    var seq = ++state.loadSeq;
    var bounds = periodBounds();
    var isRefresh = options && options.refresh === true;
    var params = {
      limit: PAGE_LIMIT,
      offset: state.offset
    };
    if (state.eventType !== '') {
      params.event_type = state.eventType;
    }
    if (bounds.from > 0) {
      params.date_from = bounds.from;
    }
    if (bounds.to > 0) {
      params.date_to = bounds.to;
    }
    setJournalBusy(true, isRefresh);
    apiGet('/events', params, function (data) {
      if (seq !== state.loadSeq) {
        return; // a newer request already answered
      }
      state.total = data.pagination ? data.pagination.total : 0;
      state.lastItems = data.items || [];
      state.hasLoaded = true;
      setJournalBusy(false, isRefresh);
      renderJournal();
    }, function (failure) {
      if (seq !== state.loadSeq) {
        return;
      }
      setJournalBusy(false, isRefresh);
      renderLoadError(failure);
    });
    loadJournalBadge();
  }
  function setJournalBusy(busy, isRefresh) {
    var $table = $('#mh-journal-table table');
    $('#mh-journal-table').attr('aria-busy', busy ? 'true' : 'false');
    $table.toggleClass('is-refreshing', Boolean(busy && isRefresh));
    if (!isRefresh) {
      if (busy) {
        renderSkeleton();
      }
      $('#mh-journal-error').empty();
      $('#mh-journal-error-placeholder').attr('hidden', true);
    }
  }
  function journalTableHead() {
    return '<colgroup><col style="width:36px"><col style="width:104px"><col style="width:240px"><col><col style="width:160px"></colgroup>' + '<thead><tr><th></th>' + '<th>' + esc(t('module_messenger_hub_ColumnTime')) + '</th>' + '<th>' + esc(t('module_messenger_hub_ColumnEvent')) + '</th>' + '<th></th>' + '<th>' + esc(t('module_messenger_hub_ColumnDelivery')) + '</th>' + '</tr></thead>';
  }
  function renderSkeleton() {
    var rows = '';
    for (var i = 0; i < 3; i++) {
      rows += '<tr class="mh-skel-row"><td></td><td><span class="mh-skel" style="width:36px"></span></td>' + '<td><span class="mh-skel" style="width:160px"></span></td>' + '<td><span class="mh-skel" style="width:70%"></span></td>' + '<td><span class="mh-skel" style="width:96px;height:20px;border-radius:5px"></span></td></tr>';
    }
    $('#mh-journal-table').html('<div class="mh-table-wrap"><table class="ui table mh-journal-table" aria-busy="true">' + journalTableHead() + '<tbody>' + rows + '</tbody></table></div>');
  }

  // ---------- journal: display rules (probes hidden, callbacks folded into the missed call) ----------

  function isProbe(item) {
    return Boolean(item && item.payload && item.payload.probe === true);
  }
  function callbackIndex(items) {
    var index = {};
    (items || []).forEach(function (item) {
      if (item.event_type !== 'core.missed_call_resolved') {
        return;
      }
      var call = item.payload && item.payload.subject && item.payload.subject.call || {};
      if (call.missed_linkedid && !index[call.missed_linkedid]) {
        index[call.missed_linkedid] = item.occurred_at;
      }
    });
    return index;
  }
  function callbackTime(item) {
    var call = item.payload && item.payload.subject && item.payload.subject.call || {};
    if (call.linkedid && state.callbacks[call.linkedid]) {
      return state.callbacks[call.linkedid];
    }
    var resolved = 0;
    (item.deliveries || []).forEach(function (delivery) {
      if (delivery.resolved_at && (resolved === 0 || delivery.resolved_at < resolved)) {
        resolved = delivery.resolved_at;
      }
    });
    return resolved;
  }
  function visibleJournalItems() {
    state.callbacks = callbackIndex(state.lastItems);
    return state.lastItems.filter(function (item) {
      if (item.event_type === 'core.missed_call_resolved') {
        return false;
      }
      return state.showProbes || !isProbe(item);
    });
  }
  function renderJournal() {
    hideJournalStates();
    $('#mh-journal-error').empty();
    renderJournalBanner();
    var items = visibleJournalItems();
    if (items.length === 0) {
      if (filtersActive()) {
        $('#mh-journal-empty-filtered').removeAttr('hidden');
      } else {
        $('#mh-journal-empty').removeAttr('hidden');
      }
      $('#mh-journal-table').empty();
      renderPager();
      return;
    }
    var names = eventTypeNames();
    if (!names['hub.test']) {
      names['hub.test'] = t('module_messenger_hub_EventTypeTest');
    }
    var rows = '';
    items.forEach(function (item) {
      rows += renderRow(item, names[item.event_type] || item.event_type);
      if (state.expandedId === item.id) {
        rows += renderDetailRow(item);
      }
    });
    $('#mh-journal-table').html('<div class="mh-table-wrap"><table class="ui selectable table mh-journal-table">' + journalTableHead() + '<tbody>' + rows + '</tbody></table></div>');
    $('#mh-journal-table tbody tr.mh-event-row').on('click', function () {
      toggleRow($(this).data('id'));
    });
    $('#mh-journal-table').off('click.retry').on('click.retry', '[data-action="retry-event"]', function (event) {
      event.stopPropagation();
      var eventId = $(this).data('event-id');
      var $button = $(this).prop('disabled', true);
      apiPost('/events/' + eventId + ':retry', {}, function (data) {
        showToast(tf('module_messenger_hub_DeliveryRetried', {
          count: data.retried || 0
        }));
        load();
      }, function (failure) {
        $button.prop('disabled', false);
        showToast(failureText(failure));
      });
    });
    renderPager();
  }
  function hideJournalStates() {
    $('#mh-journal-empty').attr('hidden', true);
    $('#mh-journal-empty-filtered').attr('hidden', true);
    $('#mh-journal-error-placeholder').attr('hidden', true);
  }
  function renderLoadError(failure) {
    var hint = tf('module_messenger_hub_CommonLoadError', {
      what: t('module_messenger_hub_LoadWhatEvents'),
      code: failure.status > 0 ? failure.status : t('module_messenger_hub_CommonTimeout')
    });
    if (state.hasLoaded && state.lastItems.length > 0) {
      // data is already on the screen: keep the table, show a banner above it
      $('#mh-journal-error').html('<div class="ui negative message" role="alert">' + ICON_ERROR + '<div class="mh-grow">' + esc(hint) + '</div>' + '<button class="ui basic button mh-on-message" type="button" id="mh-journal-retry-inline">' + esc(t('module_messenger_hub_CommonRetry')) + '</button></div>');
      $('#mh-journal-retry-inline').on('click', function () {
        load();
      });
    } else {
      $('#mh-journal-table').empty();
      $('#mh-journal-pager').attr('hidden', true);
      $('#mh-journal-error-placeholder-hint').text(hint);
      $('#mh-journal-error-placeholder').removeAttr('hidden');
    }
  }

  // ---------- journal: problem banner and the undelivered counter on the tab ----------

  // One red line above the table instead of «Бот удалён» in every row (design v3, «Журнал»).
  function botProblem() {
    for (var i = 0; i < state.bots.length; i++) {
      var bot = state.bots[i];
      if (bot.enabled !== false && bot.status === 'token_invalid') {
        return {
          text: tf('module_messenger_hub_BannerTokenInvalid', {
            bot: bot.bot_username ? '@' + bot.bot_username : '«' + bot.title + '»'
          }),
          botId: Number(bot.id)
        };
      }
    }
    // a deleted bot is only visible through its failed deliveries (the bot row is gone)
    for (var j = 0; j < state.lastItems.length; j++) {
      var deliveries = state.lastItems[j].deliveries || [];
      for (var k = 0; k < deliveries.length; k++) {
        if (deliveries[k].bot_deleted && isFailedDelivery(deliveries[k])) {
          return {
            text: t('module_messenger_hub_BannerBotDeleted'),
            botId: 0
          };
        }
      }
    }
    return null;
  }
  function renderJournalBanner() {
    var problem = state.botsLoaded ? botProblem() : null;
    if (problem === null) {
      $('#mh-journal-banner').empty();
      return;
    }
    $('#mh-journal-banner').html('<div class="ui negative message mh-banner" role="alert">' + ICON_ERROR + '<div class="mh-grow">' + esc(problem.text) + '</div>' + '<button class="ui basic button mh-on-message" type="button" data-action="banner-fix" data-bot-id="' + problem.botId + '">' + esc(t('module_messenger_hub_BannerConnect')) + '</button></div>');
  }
  function isFailedDelivery(delivery) {
    return delivery.status === 'failed' || delivery.status === 'dropped';
  }
  function isUndelivered(item) {
    return (item.deliveries || []).some(isFailedDelivery);
  }
  function loadJournalBadge() {
    apiGet('/events', {
      date_from: startOfToday(),
      limit: 200
    }, function (data) {
      var count = (data.items || []).filter(function (item) {
        return !isProbe(item) && isUndelivered(item);
      }).length;
      $('#mh-journal-badge').text(count > 99 ? '99+' : String(count)).attr('aria-label', tf('module_messenger_hub_JournalBadgeLabel', {
        count: count
      })).attr('hidden', count > 0 ? null : true);
    }, function () {});
  }

  // ---------- journal: rows ----------

  // Area code of a configuration-change event => its catalog key (same map as ConfigChangeTemplate).
  var CONFIG_AREA_KEYS = {
    routing: 'ConfigAreaRouting',
    providers: 'ConfigAreaProviders',
    extensions: 'ConfigAreaExtensions',
    employees: 'ConfigAreaEmployees',
    services: 'ConfigAreaServices',
    media: 'ConfigAreaMedia',
    schedule: 'ConfigAreaSchedule',
    network: 'ConfigAreaNetwork',
    firewall: 'ConfigAreaFirewall',
    storage: 'ConfigAreaStorage',
    api_keys: 'ConfigAreaApiKeys',
    modules: 'ConfigAreaModules',
    settings: 'ConfigAreaSettings',
    other: 'ConfigAreaOther'
  };
  function briefFor(item) {
    var subject = item.payload && item.payload.subject ? item.payload.subject : {};
    var facts = item.payload && item.payload.facts ? item.payload.facts : {};
    switch (item.event_type) {
      case 'core.missed_call':
      case 'voice_agent.callback_request':
        var employees = (subject.employees || []).map(shortEmployee).join(', ');
        var client = subject.client_number || '';
        if (client !== '' && employees !== '') {
          return client + ' → ' + employees;
        }
        return client !== '' ? client : employees;
      case 'core.queue_abandoned':
        var queueCall = subject.call || {};
        var queueText = queueLabel(queueCall);
        return queueText !== '' ? queueText : String(subject.client_number || '');
      case 'core.call_out_of_hours':
        return String(subject.client_number || subject.call && subject.call.did || '');
      case 'core.park_timeout':
        var parkCall = subject.call || {};
        var parkText = parkCall.park_slot ? tf('module_messenger_hub_MessageParkSlot', {
          slot: parkCall.park_slot
        }) : '';
        var parkClient = String(subject.client_number || '');
        if (parkText !== '' && parkClient !== '') {
          return parkText + ' · ' + parkClient;
        }
        return parkText !== '' ? parkText : parkClient;
      case 'ai_supervisor.attention_call':
        if (facts.scores && facts.scores.quality !== null && facts.scores.quality !== undefined) {
          return tf('module_messenger_hub_BriefScore', {
            score: facts.scores.quality
          });
        }
        return facts.summary || subject.client_number || '';
      case 'core.provider_down':
      case 'core.provider_up':
        var provider = subject.provider || {};
        return provider.username ? 'SIP «' + provider.username + '»' : provider.host || provider.id || '';
      case 'core.advice':
        return facts.summary || adviceText(subject.advice || {});
      case 'core.config_changed':
        var config = subject.config || {};
        var areaNames = (config.areas || []).map(function (area) {
          return t('module_messenger_hub_' + (CONFIG_AREA_KEYS[area.area] || 'ConfigAreaOther'));
        });
        if (areaNames.length > 3) {
          areaNames = areaNames.slice(0, 3).concat(['…']);
        }
        return areaNames.join(', ');
      case 'core.external_ip_changed':
        var ipChange = subject.external_ip || {};
        return ipChange.new ? (ipChange.old ? ipChange.old + ' → ' : '') + ipChange.new : '';
      case 'core.license_expiring':
        var license = subject.license || {};
        return (license.product || '') + (license.expiry ? ' · ' + license.expiry : '');
      case 'hub.test':
        var testSystem = subject.system || {};
        return testSystem.bot_title || '';
      case 'ai_supervisor.worker_offline':
      case 'ai_supervisor.worker_online':
        if (subject.module_status) {
          return statusPhrase(item.event_type, subject.module_status);
        }
        return subject.worker && subject.worker.name || facts.summary || '';
      default:
        if (subject.module_status) {
          return statusPhrase(item.event_type, subject.module_status);
        }
        return facts.summary || '';
    }
  }

  // "Продажи (800)" from a queue event; the queue name is optional (Core CallQueues may be empty).
  function queueLabel(call) {
    var number = String(call && call.queue_number || '').trim();
    var name = String(call && call.queue_name || '').trim();
    if (name === '') {
      return number;
    }
    return number === '' ? name : name + ' (' + number + ')';
  }

  // «Портнов Алексей» (204) → «Портнов А. (204)», as in the journal mockup
  function shortEmployee(employee) {
    var name = String(employee.name || '').trim();
    var parts = name.split(/\s+/);
    if (parts.length >= 2 && parts[1] !== '') {
      name = parts[0] + ' ' + parts[1].charAt(0) + '.';
    }
    if (name === '') {
      return String(employee.number || '');
    }
    return employee.number ? name + ' (' + employee.number + ')' : name;
  }
  function fullEmployee(employee) {
    return employee.name ? employee.name + (employee.number ? ' (' + employee.number + ')' : '') : String(employee.number || '');
  }

  // Core advice text: the admin cabinet already has the Core catalog in globalTranslate
  // (templates like "… <a href='%url%'>%ver%</a>"); substitute params and drop the markup as plain text.
  function adviceText(advice) {
    var tpl = advice && advice.message_tpl || '';
    var text = t(tpl);
    if (tpl === '' || text === tpl) {
      return tpl;
    }
    var params = advice && advice.params || {};
    Object.keys(params).forEach(function (name) {
      text = text.split('%' + name + '%').join(String(params[name]));
    });
    // Never parse as HTML (params may carry user-entered names): strip tags as text, output is escaped later.
    return text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  }
  function renderRow(item, eventName) {
    var probe = isProbe(item) ? '<span class="mh-probe">' + esc(t('module_messenger_hub_ProbeTag')) + '</span>' : '';
    var brief = briefFor(item);
    var expanded = state.expandedId === item.id;
    return '<tr class="mh-event-row' + (expanded ? ' active' : '') + '" data-id="' + item.id + '" aria-expanded="' + (expanded ? 'true' : 'false') + '">' + '<td class="mh-chevron-cell">' + ICON_CHEVRON + '</td>' + '<td class="mh-cell-time">' + fmtCellTime(item.occurred_at) + '</td>' + '<td><div class="mh-event-cell"><span class="mh-truncate" title="' + esc(eventName) + '">' + esc(eventName) + '</span>' + probe + '</div></td>' + '<td class="mh-truncate mh-muted" title="' + esc(statusRawCode(item) !== '' ? brief + ' (' + statusRawCode(item) + ')' : brief) + '">' + esc(brief) + '</td>' + '<td>' + deliveryCell(item) + '</td>' + '</tr>';
  }

  // 3–4 human fields; technical ones (event type, call ID, source) stay out of the interface.
  function detailFields(item) {
    var subject = item.payload && item.payload.subject ? item.payload.subject : {};
    var facts = item.payload && item.payload.facts ? item.payload.facts : {};
    var fields = [];
    var employees = (subject.employees || []).map(fullEmployee).join(', ');
    if (employees !== '') {
      fields.push([t('module_messenger_hub_DetailEmployee'), employees]);
    }
    if (subject.client_number) {
      fields.push([t('module_messenger_hub_DetailClient'), subject.client_number]);
    }
    if (item.event_type === 'core.missed_call') {
      var callback = callbackTime(item);
      if (callback > 0) {
        fields.push([t('module_messenger_hub_DetailCalledBack'), fmtCellText(callback)]);
      }
    }
    var provider = subject.provider || {};
    if (provider.username || provider.host) {
      fields.push([t('module_messenger_hub_DetailProvider'), (provider.username || '') + (provider.host ? ' · ' + provider.host : '')]);
    }
    if (subject.advice && subject.advice.message_tpl && !facts.summary) {
      fields.push([t('module_messenger_hub_DetailSummary'), adviceText(subject.advice)]);
    }
    if (facts.scores && facts.scores.quality !== null && facts.scores.quality !== undefined) {
      fields.push([t('module_messenger_hub_DetailScore'), facts.scores.quality]);
    }
    if (facts.summary) {
      fields.push([t('module_messenger_hub_DetailSummary'), facts.summary]);
    }
    if (subject.module_status) {
      fields.push([t('module_messenger_hub_DetailSummary'), [statusPhrase(item.event_type, subject.module_status)].concat(statusCounterNotes(subject.module_status)).join('. ')]);
    }
    if ((facts.reasons || []).length > 0) {
      fields.push([t('module_messenger_hub_DetailReasons'), facts.reasons.join('; ')]);
    }
    return fields;
  }
  function fmtCellText(ts) {
    if (isToday(ts)) {
      return fmtTime(ts);
    }
    return fmtDate(ts) + ' ' + fmtTime(ts);
  }
  function renderDetailRow(item) {
    var html = '<dl class="mh-fields">';
    detailFields(item).forEach(function (pair) {
      html += '<dt>' + esc(pair[0]) + '</dt><dd>' + esc(pair[1]) + '</dd>';
    });
    var retryable = false;
    (item.deliveries || []).forEach(function (delivery) {
      var status = deliveryStatusText(delivery);
      var audio = attachmentLine(delivery);
      var rawCode = delivery.last_error_code || '';
      html += '<dt class="mh-truncate">' + esc(recipientTitle(delivery)) + '</dt>' + '<dd' + (status.bad ? ' class="mh-error-text"' : '') + (rawCode !== '' ? ' title="' + esc(rawCode).replace(/"/g, '&quot;') + '"' : '') + '>' + esc(status.text) + (audio ? '<div class="mh-meta' + (audio.bad ? ' mh-error-text' : '') + '"' + (audio.code !== '' ? ' title="' + esc(audio.code).replace(/"/g, '&quot;') + '"' : '') + '>' + esc(audio.text) + '</div>' : '') + '</dd>';
      if (delivery.status === 'failed' && !delivery.bot_deleted && !delivery.chat_deleted) {
        retryable = true;
      }
    });
    html += '</dl>';
    if (retryable) {
      html += '<button class="ui basic button" type="button" data-action="retry-event" data-event-id="' + item.id + '">' + esc(t('module_messenger_hub_DeliveryRetry')) + '</button>';
    }
    return '<tr class="mh-detail" data-detail-for="' + item.id + '"><td colspan="5"><div class="mh-detail-body">' + html + '</div></td></tr>';
  }
  function recipientTitle(delivery) {
    if (delivery.chat_title) {
      return delivery.chat_title;
    }
    if (delivery.chat_deleted) {
      return t('module_messenger_hub_DeliveryChatDeleted');
    }
    return delivery.external_chat_id || '—';
  }
  function deliveryCounts(item) {
    var counts = {
      total: 0,
      sent: 0,
      failed: 0,
      pending: 0,
      resolved: 0
    };
    (item.deliveries || []).forEach(function (delivery) {
      counts.total++;
      if (isFailedDelivery(delivery)) {
        counts.failed++;
      } else if (delivery.status === 'pending' || delivery.status === 'sending') {
        counts.pending++;
      } else if (delivery.status === 'cancelled') {
        counts.resolved++;
      } else {
        counts.sent++;
      }
    });
    return counts;
  }
  function deliveryCell(item) {
    var c = deliveryCounts(item);
    if (c.total === 0) {
      return '<span class="mh-muted">—</span>';
    }
    if (c.failed > 0) {
      return '<span class="ui red label">' + ICON_ERROR + esc(t('module_messenger_hub_DeliveryNotDelivered')) + '</span>';
    }
    if (c.pending > 0) {
      return '<span class="mh-dot">' + esc(t('module_messenger_hub_TestQueued')) + '</span>';
    }
    if (c.sent === 0 && c.resolved > 0) {
      return '<span class="mh-dot">' + esc(t('module_messenger_hub_DeliveryCalledBack')) + '</span>';
    }
    return '<span class="mh-dot is-ok">' + esc(t('module_messenger_hub_TestDelivered')) + '</span>';
  }

  // One line per recipient: status — reason.
  function deliveryStatusText(delivery) {
    if (isFailedDelivery(delivery)) {
      var reason = deliveryReason(delivery);
      return {
        bad: true,
        text: t('module_messenger_hub_DeliveryNotDelivered') + (reason !== '' ? ' · ' + reason : '')
      };
    }
    if (delivery.status === 'pending' || delivery.status === 'sending') {
      return {
        bad: false,
        text: t('module_messenger_hub_TestQueued') + (delivery.next_attempt_at > 0 ? ' · ' + tf('module_messenger_hub_DeliveryNext', {
          time: fmtCellText(delivery.next_attempt_at)
        }) : '')
      };
    }
    if (delivery.status === 'cancelled') {
      return {
        bad: false,
        text: t('module_messenger_hub_DeliveryStatusCancelled')
      };
    }
    if (delivery.status === 'retracted') {
      return {
        bad: false,
        text: t('module_messenger_hub_DeliveryStatusRetracted')
      };
    }
    if (delivery.status === 'retract_failed') {
      return {
        bad: true,
        text: t('module_messenger_hub_DeliveryStatusRetractFailed')
      };
    }
    return {
      bad: false,
      text: t('module_messenger_hub_TestDelivered')
    };
  }

  // Normalised delivery/attachment codes -> readable text. The raw code stays available in a tooltip only.
  var CODE_TEXT_KEYS = {
    'attachment.converter_missing': 'ReasonNoConverter',
    'attachment.conversion_failed': 'ReasonConvert',
    'attachment.conversion_timeout': 'ReasonConvert',
    'attachment.prepare_failed': 'ReasonConvert',
    'attachment.cache_unavailable': 'ReasonConvert',
    'attachment.busy': 'ReasonConvert',
    'attachment.too_big': 'ReasonTooBig',
    'attachment.duration_too_long': 'ReasonTooBig',
    'attachment.source_missing': 'ReasonNoRecording',
    'attachment.path_missing': 'ReasonNoRecording',
    'attachment.path_rejected': 'ReasonFileUnavailable',
    'attachment.unavailable': 'ReasonFileUnavailable',
    'telegram.file_unavailable': 'ReasonFileUnavailable',
    'attachment.quotes_missing': 'ReasonNoQuotes',
    'attachment.uncertain': 'ReasonUncertain',
    'delivery.uncertain': 'ReasonUncertain',
    'attachment.retry_exhausted': 'ReasonRetries',
    'delivery.incomplete': 'ReasonRetries',
    'attachment.rejected': 'ReasonRejected',
    'http.bad_request': 'ReasonRejected',
    'attachment.not.ready': 'ReasonNotReady',
    'max.attachment.not_ready': 'ReasonNotReady',
    'attachment.cancelled': 'ReasonCancelled',
    'http.connect_failed': 'ReasonNoConnection',
    'http.timeout': 'ReasonNoConnection',
    'http.unavailable': 'ReasonNoConnection',
    'http.tls': 'ReasonNoConnection'
  };
  function codeText(code) {
    var key = CODE_TEXT_KEYS[code];
    return key ? t('module_messenger_hub_' + key) : code;
  }

  // "Recording: sent / replaced by a note / skipped · reason"; null when the delivery carries no audio.
  function attachmentLine(delivery) {
    var a = delivery.attachment;
    if (!a || !a.state || a.state === 'none') {
      return null;
    }
    var text;
    var bad = false;
    var total = Number(a.parts) || 0;
    if (a.state === 'pending') {
      text = t('module_messenger_hub_AttachQueued');
    } else if (a.state === 'sent') {
      text = total > 1 ? tf('module_messenger_hub_AttachPartial', {
        sent: a.sent,
        total: total
      }) : t('module_messenger_hub_AttachSent');
    } else if (a.state === 'partial') {
      text = tf('module_messenger_hub_AttachPartial', {
        sent: a.sent,
        total: total
      });
    } else if (a.state === 'skipped') {
      // the fallback note in the text tells where the recording can be found
      text = a.note === 'sent' ? t('module_messenger_hub_AttachReplaced') : t('module_messenger_hub_AttachSkipped');
    } else {
      text = t('module_messenger_hub_AttachFailed');
      bad = true;
    }
    if (a.code && a.state !== 'pending' && a.state !== 'sent') {
      text += ' · ' + codeText(a.code);
    }
    return {
      text: t('module_messenger_hub_AttachLabel') + ': ' + text,
      code: a.code || '',
      bad: bad
    };
  }
  function deliveryReason(delivery) {
    if (delivery.bot_deleted) {
      return t('module_messenger_hub_DeliveryBotDeleted');
    }
    if (delivery.chat_deleted) {
      return t('module_messenger_hub_DeliveryChatDeleted');
    }
    var code = delivery.last_error_code || '';
    if (code === 'telegram.401.unauthorized') {
      return t('module_messenger_hub_BotStatusTokenInvalid');
    }
    if (code === 'telegram.403.kicked' || code === 'telegram.403.blocked' || code === 'telegram.400.chat_not_found' || code === 'max.403.chat_denied' || code === 'max.404.not_found' || code === 'max.404.unknown') {
      return t('module_messenger_hub_ChatStatusGone');
    }
    return codeText(code);
  }
  function toggleRow(id) {
    state.expandedId = state.expandedId === id ? null : id;
    renderJournal();
  }

  // ---------- journal: pager ----------

  function renderPager() {
    var $pager = $('#mh-journal-pager');
    if (state.lastItems.length === 0 || state.total <= PAGE_LIMIT) {
      $pager.attr('hidden', true);
      return;
    }
    $pager.removeAttr('hidden');
    $('#mh-journal-page-info').text(tf('module_messenger_hub_EventsPage', {
      from: state.offset + 1,
      to: state.offset + state.lastItems.length,
      total: state.total
    }));
    $('#mh-journal-prev').attr('disabled', state.offset <= 0);
    $('#mh-journal-next').attr('disabled', state.offset + state.lastItems.length >= state.total);
  }

  // ---------- settings tab ----------

  // Fields carry no hints (design v3); the help line under a field is used only for its error.
  function markFieldError(fieldSelector, message) {
    $(fieldSelector).addClass('error').find('.mh-help').text(message || '');
  }
  function clearFieldError(fieldSelector) {
    $(fieldSelector).removeClass('error').find('.mh-help').text('');
  }
  function markRetentionError(message) {
    markFieldError('#mh-retention-field', message);
  }
  function clearRetentionError() {
    clearFieldError('#mh-retention-field');
  }
  function saveRetention() {
    var raw = String($('#mh-retention-input').val() || '').trim();
    var days = /^\d+$/.test(raw) ? parseInt(raw, 10) : -1;
    if (days < 1 || days > 365) {
      markRetentionError(tf('module_messenger_hub_SettingsRetentionError', {}));
      return;
    }
    clearRetentionError();
    apiPatch('/settings', {
      events_retention_days: days
    }, function () {
      state.retention = days;
      showToast(t('module_messenger_hub_CommonSaved'));
    }, function () {
      markRetentionError(tf('module_messenger_hub_CommonLoadError', {
        what: t('module_messenger_hub_LoadWhatSettings'),
        code: 'http_error'
      }));
      $('#mh-retention-input').val(state.retention);
    });
  }
  function showToast(message) {
    // the admin cabinet's Fomantic build has no toast module — a tiny pill of our own (4 s)
    var existing = document.querySelectorAll('.mh-toast');
    for (var i = 0; i < existing.length; i++) {
      existing[i].parentNode.removeChild(existing[i]);
    }
    var toast = document.createElement('div');
    toast.className = 'mh-toast';
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 4000);
  }

  // ---------- bots: API ----------

  function apiSend(method, path, payload, onSuccess, onFailure) {
    var options = {
      url: Config.pbxUrl + API_BASE + path,
      method: method,
      dataType: 'json',
      cache: false
    };
    if (payload !== null && payload !== undefined) {
      options.data = JSON.stringify(payload);
      options.contentType = 'application/json';
    }
    $.ajax(options).done(function (response) {
      if (response && response.result === true) {
        onSuccess(response.data);
      } else {
        onFailure(normalizeFailure(response, 200));
      }
    }).fail(function (xhr) {
      onFailure(normalizeFailure(xhr.responseJSON || null, xhr.status));
    });
  }
  function apiPost(path, payload, onSuccess, onFailure) {
    apiSend('POST', path, payload || {}, onSuccess, onFailure);
  }
  function apiDelete(path, onSuccess, onFailure) {
    apiSend('DELETE', path, null, onSuccess, onFailure);
  }
  function coreGet(path, params, onSuccess, onFailure) {
    $.ajax({
      url: Config.pbxUrl + '/pbxcore/api/v3' + path,
      method: 'GET',
      data: params || {},
      cache: false
    }).done(function (response) {
      if (response && response.result === true) {
        onSuccess(response.data);
      } else {
        onFailure(normalizeFailure(response, 200));
      }
    }).fail(function (xhr) {
      onFailure(normalizeFailure(xhr.responseJSON || null, xhr.status));
    });
  }
  function failureText(failure) {
    if (failure && failure.field) {
      return failure.messages.length > 0 ? failure.messages[0] : failure.error;
    }
    return failure && failure.error ? failure.error : 'http_error';
  }

  // ---------- bots: state & rendering ----------

  function botById(id) {
    for (var i = 0; i < state.bots.length; i++) {
      if (Number(state.bots[i].id) === Number(id)) {
        return state.bots[i];
      }
    }
    return null;
  }
  function replaceBot(bot) {
    for (var i = 0; i < state.bots.length; i++) {
      if (Number(state.bots[i].id) === Number(bot.id)) {
        state.bots[i] = bot;
        return;
      }
    }
    state.bots.push(bot);
  }
  function loadBots(silent) {
    if (!silent) {
      state.botsLoaded = false;
      renderBotsSkeleton();
    }
    apiGet('/bots', {
      limit: 200
    }, function (data) {
      state.bots = data.items || [];
      state.botsLoaded = true;
      state.botsError = null;
      renderBots();
      renderRules();
      renderJournalBanner();
    }, function (failure) {
      state.botsLoaded = true;
      state.botsError = failure;
      renderBots();
      renderRules();
    });
  }
  function renderBotsSkeleton() {
    var card = '<div class="mh-bot-card mh-bot-skeleton"><span class="mh-skel" style="width:32px;height:32px;border-radius:8px"></span>' + '<div style="flex:1;display:flex;flex-direction:column;gap:6px"><span class="mh-skel" style="width:50%"></span>' + '<span class="mh-skel" style="width:30%;height:8px"></span></div></div>';
    $('#mh-bots').html(card + card);
  }

  // Telegram / MAX tiles: the first-run screen and «Настройки» without bots (design v3).
  function messengerTiles() {
    return '<div class="mh-messenger-tiles">' + '<button type="button" class="mh-scenario mh-tile" data-action="add-bot" data-channel="telegram">' + '<span class="mh-messenger tg" aria-hidden="true">TG</span><b>Telegram</b></button>' + '<button type="button" class="mh-scenario mh-tile" data-action="add-bot" data-channel="max">' + '<span class="mh-messenger max" aria-hidden="true">MAX</span><b>MAX</b></button>' + '</div>';
  }
  function renderBots() {
    var $wrap = $('#mh-bots');
    if (state.botsError !== null && state.bots.length === 0) {
      $('#mh-bot-add').attr('hidden', true);
      $wrap.html('<div class="ui negative message" role="alert">' + ICON_ERROR + '<div class="mh-grow">' + esc(t('module_messenger_hub_BotsLoadFailed')) + '</div>' + '<button class="ui basic button mh-on-message" type="button" id="mh-bots-retry">' + esc(t('module_messenger_hub_CommonRetry')) + '</button></div>');
      $('#mh-bots-retry').on('click', function () {
        loadBots();
      });
      return;
    }
    if (!state.botsLoaded) {
      return;
    }
    $('#mh-bot-add').attr('hidden', state.bots.length > 0 ? null : true);
    if (state.bots.length === 0) {
      $wrap.html(messengerTiles());
      return;
    }
    var html = '<div class="mh-bot-list">';
    for (var i = 0; i < state.bots.length; i++) {
      html += renderBotCard(state.bots[i]);
    }
    $wrap.html(html + '</div>');
  }
  function renderBotCard(bot) {
    var expanded = state.expandedBots[bot.id] === true;
    var body = '';
    if (expanded) {
      body = '<div class="mh-bot-body">' + renderBotTlsWarning(bot) + renderBotChats(bot) + renderBotActions(bot) + '</div>';
    }
    var chatCount = (bot.chats || []).length;
    var meta = [];
    if (bot.bot_username) {
      meta.push('@' + bot.bot_username);
    }
    meta.push(chatCount > 0 ? tf('module_messenger_hub_BotChatsCount', {
      count: chatCount
    }) : t('module_messenger_hub_BotChatsNone'));
    return '<div class="mh-bot-row' + (expanded ? ' is-open' : '') + '" data-bot-id="' + bot.id + '">' + '<div class="mh-bot-head" data-action="toggle" role="button" tabindex="0" aria-expanded="' + (expanded ? 'true' : 'false') + '">' + '<span class="mh-messenger ' + (bot.channel === 'max' ? 'max' : 'tg') + '" aria-hidden="true">' + (bot.channel === 'max' ? 'MAX' : 'TG') + '</span>' + '<div class="mh-bot-titles"><b class="mh-truncate">' + esc(bot.title) + '</b>' + '<span class="mh-meta mh-truncate">' + esc(meta.join(' · ')) + '</span></div>' + '<span class="mh-bot-status">' + botStatusCell(bot) + '</span>' + '<span class="mh-chevron" aria-hidden="true">' + '<svg class="mh-i" viewBox="0 0 16 16" style="transform:rotate(' + (expanded ? '180' : '0') + 'deg)"><path d="M3.5 6L8 10.5 12.5 6"/></svg>' + '</span></div>' + body + '</div>';
  }
  function botStatusCell(bot) {
    if (bot.enabled === false) {
      return '<span class="mh-dot">' + esc(t('module_messenger_hub_BotStatusDisabled')) + '</span>';
    }
    if (bot.status === 'ok') {
      return '<span class="mh-dot is-ok">' + esc(t('module_messenger_hub_BotStatusOk')) + '</span>';
    }
    if (bot.status === 'token_invalid') {
      return '<span class="ui red label">' + esc(t('module_messenger_hub_BotStatusTokenInvalid')) + '</span>';
    }
    if (bot.status === 'ca_error') {
      return '<span class="ui red label">' + esc(t('module_messenger_hub_BotStatusCaError')) + '</span>';
    }
    if (bot.status === 'error') {
      return '<span class="ui yellow label">' + esc(t('module_messenger_hub_BotStatusCheckFailed')) + '</span>';
    }
    return '<span class="mh-dot">' + esc(t('module_messenger_hub_BotStatusNew')) + '</span>';
  }

  // The MAX API is signed by the Минцифры root CA: a trust failure is a configuration problem, not a
  // token problem, so it gets its own explanation and points to the settings field.
  function renderBotTlsWarning(bot) {
    if (bot.status !== 'ca_error' && !isMaxTlsCode(bot.last_error_code)) {
      return '';
    }
    return '<div class="ui warning message" role="note">' + '<svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.5v4M8 11h.01"/></svg>' + '<div>' + esc(t('module_messenger_hub_BotStatusCaError')) + '. ' + esc(t('module_messenger_hub_BotCaErrorHint')) + '</div></div>';
  }
  function chatKindLabel(kind) {
    if (kind === 'private') {
      return t('module_messenger_hub_ChatTypePrivate');
    }
    if (kind === 'channel') {
      return t('module_messenger_hub_ChatTypeChannel');
    }
    return t('module_messenger_hub_ChatTypeGroup');
  }
  function renderBotChats(bot) {
    var chats = bot.chats || [];
    if (chats.length === 0) {
      return '<div class="mh-bot-nochats mh-muted">' + esc(t('module_messenger_hub_BotNoChatsTitle')) + '</div>';
    }
    var html = '<div class="mh-chat-list">';
    for (var i = 0; i < chats.length; i++) {
      html += renderChatRow(bot, chats[i]);
    }
    return html + '</div>';
  }
  function renderChatRow(bot, chat) {
    var gone = chat.state === 'gone';
    var stateCell;
    if (gone) {
      stateCell = '<span class="ui red label" title="' + esc(chat.gone_reason) + '">' + esc(t('module_messenger_hub_ChatStatusGone')) + '</span>';
    } else if (chat.last_delivery && chat.last_delivery.status === 'failed') {
      stateCell = '<span class="ui red label">' + esc(t('module_messenger_hub_ChatStatusError')) + '</span>';
    } else {
      stateCell = '<span class="mh-dot is-ok">' + esc(t('module_messenger_hub_ChatStatusOk')) + '</span>';
    }
    return '<div class="mh-chat-row" data-chat-id="' + chat.id + '">' + '<span class="mh-chat-title"><span class="mh-truncate">' + esc(chat.title || chat.chat_id) + '</span>' + '<span class="mh-meta"> · ' + esc(chatKindLabel(chat.chat_kind)) + '</span></span>' + employeeSelect(chat) + '<span class="mh-chat-state">' + stateCell + '</span>' + '<label class="ui toggle checkbox' + (chat.enabled ? ' checked' : '') + (gone ? ' disabled' : '') + '" aria-label="' + esc(t('module_messenger_hub_BotEnableChat')) + '">' + '<input type="checkbox" class="hidden mh-chat-toggle"' + (chat.enabled ? ' checked' : '') + (gone ? ' disabled' : '') + '>' + '<span class="mh-track"></span></label>' + '</div>';
  }
  function employeeSelect(chat) {
    var options = '<option value="0">' + esc(t('module_messenger_hub_ChatNoEmployee')) + '</option>';
    var found = false;
    for (var i = 0; i < state.employees.length; i++) {
      var employee = state.employees[i];
      var selected = Number(employee.id) === Number(chat.linked_user_id);
      if (selected) {
        found = true;
      }
      options += '<option value="' + employee.id + '"' + (selected ? ' selected' : '') + '>' + esc(employee.label) + '</option>';
    }
    if (!found && Number(chat.linked_user_id) > 0) {
      options += '<option value="' + chat.linked_user_id + '" selected>#' + chat.linked_user_id + '</option>';
    }
    return '<select class="mh-employee-select" aria-label="' + esc(t('module_messenger_hub_ChatEmployee')) + '">' + options + '</select>';
  }
  function renderBotActions(bot) {
    return '<div class="mh-bot-actions">' + '<a href="#" data-action="connect">' + esc(t('module_messenger_hub_BotActionsConnect')) + '</a>' + '<a href="#" data-action="test">' + esc(t('module_messenger_hub_BotActionsTest')) + '</a>' + '<a href="#" data-action="edit">' + esc(t('module_messenger_hub_BotActionsEdit')) + '</a>' + '</div>';
  }

  // ---------- bots: delegated actions ----------

  function bindBotsContainer() {
    var $wrap = $('#mh-bots');
    $wrap.on('click', '[data-action="toggle"]', function () {
      var id = String($(this).closest('.mh-bot-row').data('bot-id'));
      state.expandedBots[id] = state.expandedBots[id] !== true;
      renderBots();
    });
    $wrap.on('keydown', '[data-action="toggle"]', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        $(this).trigger('click');
      }
    });
    $wrap.on('click', '[data-action="add-bot"]', function () {
      openBotModal('add', null, $(this).data('channel'));
    });
    $wrap.on('click', '[data-action="connect"]', function (event) {
      event.preventDefault();
      openChatModal(botById($(this).closest('.mh-bot-row').data('bot-id')));
    });
    $wrap.on('click', '[data-action="test"]', function (event) {
      event.preventDefault();
      openTestModal(botById($(this).closest('.mh-bot-row').data('bot-id')), null);
    });
    $wrap.on('click', '[data-action="edit"]', function (event) {
      event.preventDefault();
      openBotModal('edit', botById($(this).closest('.mh-bot-row').data('bot-id')));
    });
    $wrap.on('change', '.mh-chat-toggle', function () {
      var botId = $(this).closest('.mh-bot-row').data('bot-id');
      var chatId = $(this).closest('.mh-chat-row').data('chat-id');
      var enabled = $(this).prop('checked');
      patchBot(botId, {
        chats: [{
          id: Number(chatId),
          enabled: enabled
        }]
      }, null, function () {
        loadBots(true);
        showToast(t('module_messenger_hub_CommonSaveFailed'));
      });
    });
    $wrap.on('change', '.mh-employee-select', function () {
      var botId = $(this).closest('.mh-bot-row').data('bot-id');
      var chatId = $(this).closest('.mh-chat-row').data('chat-id');
      patchBot(botId, {
        chats: [{
          id: Number(chatId),
          linked_user_id: Number($(this).val())
        }]
      }, null, function () {
        loadBots(true);
        showToast(t('module_messenger_hub_CommonSaveFailed'));
      });
    });
  }
  function patchBot(botId, payload, onSuccess, onFailure) {
    apiPatch('/bots/' + botId, payload, function (bot) {
      replaceBot(bot);
      renderBots();
      if (onSuccess) {
        onSuccess(bot);
      }
    }, onFailure || function (failure) {
      showToast(failureText(failure));
    });
  }

  // ---------- employees ----------

  function loadEmployees(done) {
    if (state.employeesLoaded) {
      done();
      return;
    }
    coreGet('/extensions', {
      limit: 500
    }, function (data) {
      var items = data.items || [];
      var seen = {};
      var list = [];
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var userId = Number(item.userid);
        if (!userId || seen[userId]) {
          continue;
        }
        seen[userId] = true;
        var name = item.callerid || item.number || '#' + userId;
        var number = item.number ? String(item.number) : '';
        var label = number !== '' && String(name).indexOf(number) === -1 ? name + ' (' + number + ')' : name;
        list.push({
          id: userId,
          label: label
        });
      }
      list.sort(function (a, b) {
        return a.label.localeCompare(b.label);
      });
      state.employees = list;
      state.employeesLoaded = true;
      state.employeesFailed = false;
      done();
    }, function () {
      state.employeesLoaded = false;
      state.employeesFailed = true;
      done();
    });
  }

  // ---------- bot modal ----------

  // Channels with a backend adapter (both have one since stage 3b/3c). The checks below stay as a
  // guard: a channel without an adapter on the server must not be saved from a stale page.
  var SAVABLE_CHANNELS = ['telegram', 'max'];
  function openBotModal(mode, bot, channel) {
    state.botModal = {
      mode: mode,
      bot: bot,
      channel: mode === 'edit' && bot ? bot.channel || 'telegram' : channel === 'max' ? 'max' : 'telegram',
      draftId: 0,
      saved: false,
      tokenChanged: false,
      busy: false
    };
    $('#mh-bot-check-message').empty();
    $('#mh-bot-title-field').removeClass('error');
    $('#mh-bot-token-row').removeClass('error');
    $('#mh-bot-modal-title').text(mode === 'edit' ? tf('module_messenger_hub_BotEditTitle', {
      title: bot.title
    }) : t('module_messenger_hub_BotAddTitle'));
    $('#mh-bot-title').val(bot ? bot.title : '');
    $('#mh-bot-token').val('');
    $('#mh-bot-token-new').val('');
    $('#mh-bot-token-new-row').attr('hidden', true);
    $('#mh-bot-delete').attr('hidden', mode === 'edit' ? null : true);
    $('#mh-bot-save').text(mode === 'edit' ? t('module_messenger_hub_BotSave') : t('module_messenger_hub_BotSaveAndConnect'));
    if (mode === 'edit') {
      $('#mh-bot-token-row').attr('hidden', true);
      $('#mh-bot-token-hint-row').removeAttr('hidden');
      $('#mh-bot-token-hint').text('••••' + (bot.token_hint || ''));
    } else {
      $('#mh-bot-token-row').removeAttr('hidden');
      $('#mh-bot-token-hint-row').attr('hidden', true);
    }
    syncBotChannel();
    $('#mh-bot-modal').modal({
      closable: false
    }).modal('show');
    $('#mh-bot-title').trigger('focus');
  }
  function syncBotChannel() {
    var modal = state.botModal;
    if (!modal) {
      return;
    }
    $('#mh-bot-modal .mh-channel-card').each(function () {
      var channel = String($(this).data('channel'));
      var selected = channel === modal.channel;
      var locked = modal.mode === 'edit' && !selected;
      $(this).toggleClass('is-selected', selected).toggleClass('is-disabled', locked).attr('aria-disabled', locked ? 'true' : null);
      $(this).find('input').prop('checked', selected).prop('disabled', locked);
    });
    var savable = SAVABLE_CHANNELS.indexOf(modal.channel) >= 0;
    $('#mh-bot-save, #mh-bot-check').prop('disabled', !savable).toggleClass('disabled', !savable);
    // a MAX token comes from business.max.ru after moderation; Telegram needs no explanation
    var maxHelp = modal.channel === 'max';
    $('#mh-bot-token-help').text(maxHelp ? t('module_messenger_hub_BotTokenHelpMax') : '');
    $('#mh-bot-token-help-row').attr('hidden', maxHelp ? null : true);
  }
  function isMaxTlsCode(code) {
    return String(code || '').indexOf('max.tls.') === 0;
  }
  function tlsErrorText() {
    return t('module_messenger_hub_BotStatusCaError') + '. ' + t('module_messenger_hub_BotCaErrorHint');
  }
  function botFormValues() {
    return {
      title: String($('#mh-bot-title').val() || '').trim(),
      token: String($('#mh-bot-token').val() || '').trim(),
      tokenNew: String($('#mh-bot-token-new').val() || '').trim()
    };
  }
  function showBotMessage(kind, text) {
    var cls = kind === 'ok' ? 'ui positive message' : kind === 'warn' ? 'ui warning message' : 'ui negative message';
    var icon = kind === 'ok' ? '<circle cx="8" cy="8" r="6.25"/><path d="M5.5 8.2l1.8 1.8 3.3-3.6"/>' : '<circle cx="8" cy="8" r="6.25"/><path d="M6 6l4 4M10 6l-4 4"/>';
    $('#mh-bot-check-message').html('<div class="' + cls + '" role="status">' + '<svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true">' + icon + '</svg>' + '<div>' + esc(text) + '</div></div>');
  }
  function botCheckMessage(bot) {
    if (bot.status === 'ok') {
      return {
        kind: 'ok',
        text: tf('module_messenger_hub_BotCheckedOk', {
          username: bot.bot_username || bot.bot_external_id,
          name: bot.bot_username ? '@' + bot.bot_username : bot.title
        })
      };
    }
    if (bot.last_error_code === 'other_bot') {
      return {
        kind: 'warn',
        text: tf('module_messenger_hub_BotCheckedOther', {
          username: bot.bot_username || '',
          bot: bot.title
        })
      };
    }
    if (bot.status === 'token_invalid') {
      return {
        kind: 'err',
        text: t('module_messenger_hub_BotChecked401')
      };
    }
    if (bot.status === 'ca_error' || isMaxTlsCode(bot.last_error_code)) {
      return {
        kind: 'err',
        text: tlsErrorText()
      };
    }
    return {
      kind: 'warn',
      text: t('module_messenger_hub_BotCheckNetwork') + (bot.last_error_code ? ' (' + bot.last_error_code + ')' : '')
    };
  }
  function checkBotForm() {
    if (!state.botModal || SAVABLE_CHANNELS.indexOf(state.botModal.channel) < 0) {
      return;
    }
    var values = botFormValues();
    if (values.title === '') {
      $('#mh-bot-title-field').addClass('error');
      showBotMessage('err', t('module_messenger_hub_BotTitleRequired'));
      return;
    }
    $('#mh-bot-title-field').removeClass('error');
    var mode = state.botModal.mode;
    var payload;
    var done = function done(bot) {
      state.botModal.bot = bot;
      state.botModal.draftId = bot.id;
      replaceBot(bot);
      var message = botCheckMessage(bot);
      showBotMessage(message.kind, message.text);
    };
    var failure = function failure(err) {
      if (err.field === 'token') {
        $('#mh-bot-token-row').addClass('error');
      }
      showBotMessage('err', failureText(err));
    };
    if (mode === 'add') {
      payload = {
        channel: state.botModal.channel,
        title: values.title,
        token: values.token
      };
      if (state.botModal.draftId > 0) {
        apiPatch('/bots/' + state.botModal.draftId, {
          title: values.title,
          token: values.token
        }, done, failure);
      } else {
        apiPost('/bots', payload, done, failure);
      }
      return;
    }
    if (values.tokenNew !== '') {
      apiPost('/bots/' + state.botModal.bot.id + ':checkToken', {
        token: values.tokenNew
      }, function (data) {
        if (data.ok) {
          showBotMessage('ok', tf('module_messenger_hub_BotCheckedOk', {
            username: data.username,
            name: data.display_name
          }));
        } else if (data.error_code === 'other_bot') {
          showBotMessage('warn', tf('module_messenger_hub_BotCheckedOther', {
            username: data.username || '',
            bot: state.botModal.bot.title
          }));
        } else if (data.error_code === 'telegram.401.unauthorized' || data.error_code === 'max.401.unauthorized') {
          showBotMessage('err', t('module_messenger_hub_BotChecked401'));
        } else if (isMaxTlsCode(data.error_code)) {
          showBotMessage('err', tlsErrorText());
        } else {
          showBotMessage('warn', t('module_messenger_hub_BotCheckNetwork') + ' (' + data.error_code + ')');
        }
      }, failure);
      return;
    }
    apiPost('/bots/' + state.botModal.bot.id + ':checkToken', {}, function (data) {
      loadBots(true);
      if (data.ok) {
        showBotMessage('ok', tf('module_messenger_hub_BotCheckedOk', {
          username: data.username,
          name: data.display_name
        }));
      } else if (isMaxTlsCode(data.error_code)) {
        showBotMessage('err', tlsErrorText());
      } else {
        showBotMessage('err', t('module_messenger_hub_BotChecked401'));
      }
    }, failure);
  }
  function saveBotForm() {
    if (!state.botModal || SAVABLE_CHANNELS.indexOf(state.botModal.channel) < 0) {
      return;
    }
    var values = botFormValues();
    if (values.title === '') {
      $('#mh-bot-title-field').addClass('error');
      showBotMessage('err', t('module_messenger_hub_BotTitleRequired'));
      return;
    }
    var mode = state.botModal.mode;
    var finish = function finish(bot) {
      state.botModal.saved = true;
      replaceBot(bot);
      $('#mh-bot-modal').modal('hide');
      loadBots(true);
      if (mode === 'add') {
        openChatModal(bot);
      } else {
        showToast(t('module_messenger_hub_CommonSaved'));
      }
    };
    var failure = function failure(err) {
      if (err.field === 'token') {
        $('#mh-bot-token-row').addClass('error');
      }
      showBotMessage('err', failureText(err));
    };
    if (mode === 'add') {
      var create = function create(id) {
        apiPost('/bots/' + id + ':discoverChats', {}, function (bot) {
          finish(bot);
        }, failure);
      };
      if (state.botModal.draftId > 0) {
        apiPatch('/bots/' + state.botModal.draftId, {
          title: values.title,
          token: values.token
        }, function (bot) {
          replaceBot(bot);
          create(bot.id);
        }, failure);
      } else {
        apiPost('/bots', {
          channel: state.botModal.channel,
          title: values.title,
          token: values.token
        }, function (bot) {
          replaceBot(bot);
          create(bot.id);
        }, failure);
      }
      return;
    }
    var payload = {
      title: values.title
    };
    if (values.tokenNew !== '') {
      payload.token = values.tokenNew;
    }
    apiPatch('/bots/' + state.botModal.bot.id, payload, finish, failure);
  }
  function cancelBotModal() {
    var modal = state.botModal;
    state.botModal = null;
    $('#mh-bot-modal').modal('hide');
    if (modal && modal.draftId > 0 && !modal.saved) {
      // the "Проверить" button created the draft: cancelling must not leave it behind
      apiDelete('/bots/' + modal.draftId, function () {
        loadBots(true);
      }, function () {
        loadBots(true);
      });
    } else {
      loadBots(true);
    }
  }
  function confirmDeleteBot() {
    var bot = state.botModal.bot;
    if (!bot) {
      return;
    }
    $('#mh-confirm-text').text(tf('module_messenger_hub_BotDeleteConfirm', {
      title: bot.title,
      count: (bot.chats || []).length
    }));
    $('#mh-confirm-modal').modal({
      closable: true
    }).modal('show');
    $('#mh-confirm-ok').off('click').on('click', function () {
      $('#mh-confirm-modal').modal('hide');
      apiDelete('/bots/' + bot.id, function () {
        state.botModal.saved = true;
        state.botModal.draftId = 0;
        $('#mh-bot-modal').modal('hide');
        loadBots(true);
        showToast(t('module_messenger_hub_CommonDeleted'));
      }, function (err) {
        showToast(failureText(err));
      });
    });
  }

  // ---------- discovery modal ----------

  function openChatModal(bot) {
    if (!bot) {
      return;
    }
    state.chatModal = {
      botId: bot.id,
      bot: bot,
      timer: null,
      selected: {}
    };
    $('#mh-chat-modal-title').text(tf('module_messenger_hub_ChatConnectTitle', {
      title: bot.title
    }));
    var isMax = bot.channel === 'max';
    $('#mh-chat-steps').text(tf(isMax ? 'module_messenger_hub_ChatConnectStepsMax' : 'module_messenger_hub_ChatConnectSteps', {
      bot: bot.bot_username ? '@' + bot.bot_username : bot.title
    }));
    $('#mh-chat-found').empty();
    $('#mh-chat-error').empty();
    $('#mh-chat-empty').attr('hidden', true);
    $('#mh-chat-again').attr('hidden', true);
    $('#mh-chat-stop').removeAttr('hidden');
    $('#mh-chat-save').attr('disabled', true);
    $('#mh-chat-status-text').text(t('module_messenger_hub_ChatConnectSearching'));
    $('#mh-chat-countdown').text('');
    $('#mh-chat-progress .bar').css('width', '0%');
    $('#mh-chat-modal').modal({
      closable: false
    }).modal('show');
    startDiscovery(bot.id, false);
  }
  function startDiscovery(botId, restart) {
    apiPost('/bots/' + botId + ':discoverChats', {
      restart: restart === true
    }, function (bot) {
      if (!state.chatModal) {
        return;
      }
      state.chatModal.selected = {};
      updateChatModal(bot);
      scheduleChatPoll();
    }, function (err) {
      showChatError(failureText(err));
    });
  }
  function scheduleChatPoll() {
    stopChatPoll();
    state.chatModal.timer = setInterval(function () {
      if (!state.chatModal) {
        return;
      }
      apiGet('/bots/' + state.chatModal.botId, {}, function (bot) {
        if (!state.chatModal) {
          return;
        }
        updateChatModal(bot);
        if (!bot.discovery.active) {
          stopChatPoll();
        }
      }, function () {/* keep the last state */});
    }, 2000);
  }
  function stopChatPoll() {
    if (state.chatModal && state.chatModal.timer !== null) {
      clearInterval(state.chatModal.timer);
      state.chatModal.timer = null;
    }
  }
  function updateChatModal(bot) {
    if (!state.chatModal) {
      return;
    }
    state.chatModal.bot = bot;
    replaceBot(bot);
    var discovery = bot.discovery || {
      active: false,
      status: 'idle',
      found: []
    };
    var found = discovery.found || [];
    var selectedCount = 0;
    var html = '';
    for (var i = 0; i < found.length; i++) {
      var item = found[i];
      var inBot = findChatByExternal(bot, item.chat_id);
      if (!item.already_connected && state.chatModal.selected[item.chat_id] !== false) {
        state.chatModal.selected[item.chat_id] = true;
      }
      var checked = !item.already_connected && state.chatModal.selected[item.chat_id] === true;
      if (checked) {
        selectedCount++;
      }
      html += '<label class="mh-found-row' + (item.already_connected ? ' is-connected' : '') + '" data-chat-row="' + (inBot ? inBot.id : 0) + '" data-chat-key="' + esc(item.chat_id) + '">' + '<span class="ui checkbox' + (checked ? ' checked' : '') + (item.already_connected ? ' disabled' : '') + '">' + '<input type="checkbox" class="hidden mh-found-check"' + (checked ? ' checked' : '') + (item.already_connected ? ' disabled' : '') + '>' + '<span class="mh-box"></span></span>' + '<span class="mh-found-title"><b class="mh-truncate">' + esc(item.title || item.chat_id) + '</b>' + '<span class="mh-meta">' + esc(chatKindLabel(item.chat_kind)) + '</span></span>' + '<span class="ui ' + (item.already_connected ? 'label' : 'blue label') + '">' + esc(item.already_connected ? t('module_messenger_hub_ChatConnectExists') : t('module_messenger_hub_ChatConnectNew')) + '</span></label>';
    }
    $('#mh-chat-found').html(html);
    $('#mh-chat-save').text(tf('module_messenger_hub_ChatConnectSave', {
      count: selectedCount
    }));
    $('#mh-chat-save').attr('disabled', selectedCount === 0 ? true : null);
    var statusText = '';
    var countdown = '';
    var progress = 0;
    if (discovery.active) {
      if (found.length > 0) {
        statusText = tf('module_messenger_hub_ChatConnectFound', {
          count: found.length
        });
      } else {
        statusText = t('module_messenger_hub_ChatConnectSearching');
      }
      countdown = tf('module_messenger_hub_ChatConnectRemaining', {
        time: fmtCountdown(discovery.remaining_sec)
      });
      progress = Math.max(0, Math.min(100, Math.round((300 - discovery.remaining_sec) / 300 * 100)));
      $('#mh-chat-empty').attr('hidden', true);
      $('#mh-chat-error').empty();
      $('#mh-chat-again').attr('hidden', true);
      $('#mh-chat-stop').removeAttr('hidden');
    } else {
      $('#mh-chat-stop').attr('hidden', true);
      $('#mh-chat-again').removeAttr('hidden');
      if (discovery.status === 'error') {
        var code = String(discovery.last_error_code || '');
        var text;
        if (code === 'telegram.409.webhook_set') {
          text = t('module_messenger_hub_ChatConnectErrorWebhook');
        } else if (code === 'max.405.webhook_set') {
          text = t('module_messenger_hub_ChatConnectErrorWebhookMax');
        } else if (isMaxTlsCode(code)) {
          text = tlsErrorText();
        } else if (code === 'max.401.unauthorized' || code === 'telegram.401.unauthorized') {
          text = t('module_messenger_hub_BotChecked401');
        } else {
          text = t('module_messenger_hub_ChatConnectError') + ' (' + code + ')';
        }
        showChatError(text);
        statusText = '';
      } else if (discovery.status === 'empty') {
        statusText = '';
        $('#mh-chat-empty').removeAttr('hidden');
      } else if (found.length > 0) {
        statusText = tf('module_messenger_hub_ChatConnectTimeout', {
          count: found.length
        });
      } else {
        statusText = t('module_messenger_hub_ChatConnectNoSession');
      }
      countdown = '';
      progress = 100;
    }
    $('#mh-chat-status-text').text(statusText);
    $('#mh-chat-countdown').text(countdown);
    $('#mh-chat-progress .bar').css('width', progress + '%');
  }
  function findChatByExternal(bot, chatId) {
    var chats = bot.chats || [];
    for (var i = 0; i < chats.length; i++) {
      if (String(chats[i].chat_id) === String(chatId)) {
        return chats[i];
      }
    }
    return null;
  }
  function showChatError(text) {
    $('#mh-chat-error').html('<div class="ui negative message" role="alert">' + '<svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M6 6l4 4M10 6l-4 4"/></svg>' + '<div>' + esc(text) + '</div></div>');
  }
  function bindChatFound() {
    $('#mh-chat-found').on('change', '.mh-found-check', function () {
      if (!state.chatModal) {
        return;
      }
      var key = String($(this).closest('.mh-found-row').data('chat-key'));
      state.chatModal.selected[key] = $(this).prop('checked');
      updateChatModal(state.chatModal.bot);
    });
  }
  function saveSelectedChats() {
    if (!state.chatModal) {
      return;
    }
    var bot = state.chatModal.bot;
    var patches = [];
    for (var i = 0; i < (bot.discovery.found || []).length; i++) {
      var item = bot.discovery.found[i];
      if (item.already_connected || state.chatModal.selected[item.chat_id] !== true) {
        continue;
      }
      var chat = findChatByExternal(bot, item.chat_id);
      if (chat) {
        patches.push({
          id: chat.id,
          enabled: true,
          chat_kind: item.chat_kind,
          title: item.title
        });
      }
    }
    if (patches.length === 0) {
      return;
    }
    apiPatch('/bots/' + bot.id, {
      chats: patches
    }, function (saved) {
      apiPost('/bots/' + bot.id + ':discoverChats', {
        stop: true
      }, function () {
        closeChatModal();
        replaceBot(saved);
        loadBots(true);
        showToast(t('module_messenger_hub_CommonSaved'));
      }, function () {
        closeChatModal();
        loadBots(true);
        showToast(t('module_messenger_hub_CommonSaved'));
      });
    }, function (err) {
      showChatError(failureText(err));
    });
  }
  function closeChatModal() {
    stopChatPoll();
    state.chatModal = null;
    $('#mh-chat-modal').modal('hide');
  }
  function stopDiscoveryAndClose() {
    var bot = state.chatModal ? state.chatModal.bot : null;
    if (bot) {
      apiPost('/bots/' + bot.id + ':discoverChats', {
        stop: true
      }, function () {
        closeChatModal();
        loadBots(true);
      }, function () {
        closeChatModal();
        loadBots(true);
      });
    } else {
      closeChatModal();
    }
  }

  // ---------- test modal ----------

  function openTestModal(bot, chatIds) {
    if (!bot) {
      return;
    }
    state.testModal = {
      botId: bot.id,
      bot: bot,
      eventId: 0,
      chatIds: chatIds,
      timer: null,
      tries: 0
    };
    $('#mh-test-list').html('<div class="mh-muted">' + esc(t('module_messenger_hub_TestRunning')) + '</div>');
    $('#mh-test-summary').text('');
    $('#mh-test-modal').modal({
      closable: true,
      onHide: function onHide() {
        stopTestPoll();
      }
    }).modal('show');
    var payload = chatIds === null ? {} : {
      chat_ids: chatIds
    };
    apiPost('/bots/' + bot.id + ':sendTest', payload, function (data) {
      if (!state.testModal) {
        return;
      }
      state.testModal.eventId = data.event_id;
      state.testModal.bot = data.bot;
      replaceBot(data.bot);
      renderTest(data.bot);
      scheduleTestPoll();
    }, function (err) {
      $('#mh-test-list').html('<div class="ui negative message"><div>' + esc(failureText(err)) + '</div></div>');
    });
  }
  function scheduleTestPoll() {
    stopTestPoll();
    state.testModal.timer = setInterval(function () {
      if (!state.testModal) {
        return;
      }
      state.testModal.tries++;
      apiGet('/bots/' + state.testModal.botId, {}, function (bot) {
        if (!state.testModal) {
          return;
        }
        state.testModal.bot = bot;
        replaceBot(bot);
        renderTest(bot);
        if (!testPending(bot) || state.testModal.tries > 20) {
          stopTestPoll();
        }
      }, function () {
        if (state.testModal && state.testModal.tries > 3) {
          stopTestPoll();
        }
      });
    }, 2000);
  }
  function stopTestPoll() {
    if (state.testModal && state.testModal.timer !== null) {
      clearInterval(state.testModal.timer);
      state.testModal.timer = null;
    }
  }
  function testDeliveries(bot) {
    var eventId = state.testModal ? state.testModal.eventId : 0;
    var result = [];
    var chats = bot.chats || [];
    for (var i = 0; i < chats.length; i++) {
      var delivery = chats[i].last_delivery;
      if (delivery && Number(delivery.event_id) === Number(eventId)) {
        result.push({
          chat: chats[i],
          delivery: delivery
        });
      }
    }
    return result;
  }
  function testPending(bot) {
    var list = testDeliveries(bot);
    for (var i = 0; i < list.length; i++) {
      var status = list[i].delivery.status;
      if (status === 'pending' || status === 'sending') {
        return true;
      }
    }
    return false;
  }
  function deliveryStatusLabel(delivery) {
    if (delivery.status === 'sent') {
      return {
        cls: 'is-ok',
        text: t('module_messenger_hub_TestDelivered')
      };
    }
    if (delivery.status === 'pending' || delivery.status === 'sending') {
      return {
        cls: '',
        text: t('module_messenger_hub_TestQueued')
      };
    }
    return {
      cls: 'is-err',
      text: t('module_messenger_hub_TestError')
    };
  }
  function deliveryErrorText(code) {
    if (isMaxTlsCode(code)) {
      return tlsErrorText();
    }
    if (code === 'telegram.401.unauthorized' || code === 'max.401.unauthorized') {
      return t('module_messenger_hub_BotChecked401');
    }
    if (code === 'telegram.403.kicked' || code === 'telegram.403.blocked' || code === 'telegram.400.chat_not_found' || code === 'max.403.chat_denied' || code === 'max.404.not_found' || code === 'max.404.unknown') {
      return t('module_messenger_hub_ChatStatusGone');
    }
    if (code === 'telegram.429.rate_limit' || code === 'max.429.rate_limit') {
      return t('module_messenger_hub_ChatErrorRateLimit');
    }
    if (code === 'stale') {
      return t('module_messenger_hub_ChatErrorStale');
    }
    return code;
  }
  function renderTest(bot) {
    var list = testDeliveries(bot);
    var counts = {
      sent: 0,
      pending: 0,
      failed: 0
    };
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var chat = list[i].chat;
      var delivery = list[i].delivery;
      var label = deliveryStatusLabel(delivery);
      if (delivery.status === 'sent') {
        counts.sent++;
      } else if (delivery.status === 'pending' || delivery.status === 'sending') {
        counts.pending++;
      } else {
        counts.failed++;
      }
      var retry = delivery.status === 'failed' || delivery.status === 'dropped' ? '<button class="ui basic button mh-test-retry" type="button" data-chat-id="' + chat.id + '">' + esc(t('module_messenger_hub_TestRetry')) + '</button>' : '';
      html += '<div class="mh-test-row">' + '<span class="mh-messenger ' + (bot.channel === 'max' ? 'max' : 'tg') + ' s" aria-hidden="true">' + (bot.channel === 'max' ? 'MAX' : 'TG') + '</span>' + '<div class="mh-test-title"><div class="mh-truncate">' + esc(chat.title || chat.chat_id) + '</div>' + (delivery.last_error_code ? '<div class="mh-meta mh-error-text">' + esc(deliveryErrorText(delivery.last_error_code)) + '</div>' : '') + '</div>' + '<span class="mh-test-state ' + label.cls + '">' + esc(label.text) + '</span>' + retry + '</div>';
    }
    if (html === '') {
      html = '<div class="mh-muted">' + esc(t('module_messenger_hub_TestRunning')) + '</div>';
    }
    $('#mh-test-list').html(html);
    $('#mh-test-summary').text(tf('module_messenger_hub_TestSummary', {
      ok: counts.sent,
      failed: counts.failed,
      pending: counts.pending
    }));
    $('#mh-test-list .mh-test-retry').on('click', function () {
      var chatId = Number($(this).data('chat-id'));
      openTestModal(state.testModal ? state.testModal.bot : bot, [chatId]);
    });
  }

  // ---------- general settings ----------

  function loadGeneralSettings() {
    apiGet('/settings', {}, function (data) {
      state.retention = data.events_retention_days;
      state.settings = data;
      $('#mh-retention-input').val(data.events_retention_days);
      $('#mh-public-url-input').val(data.pbx_public_url || '');
      $('#mh-proxy-input').val(data.proxy_url || '');
      $('#mh-max-ca-input').val(data.max_ca_bundle_path || '');
      $('#mh-queue-min-wait-input').val(data.queue_abandon_min_wait_sec || 0);
      $('#mh-queue-long-wait-input').val(data.queue_long_wait_sec || 0);
      clearFieldError('#mh-queue-min-wait-field');
      clearFieldError('#mh-queue-long-wait-field');
      $('#mh-config-quiet-input').val(data.config_change_quiet_sec);
      $('#mh-external-ip-input').val(data.external_ip_poll_min);
      $('#mh-license-hours-input').val(data.license_poll_hours);
      $('#mh-license-days-input').val(data.license_warn_days || '');
      clearFieldError('#mh-max-ca-field');
      clearFieldError('#mh-config-quiet-field');
      clearFieldError('#mh-external-ip-field');
      clearFieldError('#mh-license-hours-field');
      clearFieldError('#mh-license-days-field');
      $('#mh-mask-default').toggleClass('checked', data.mask_phone_default === true);
      $('#mh-mask-default input').prop('checked', data.mask_phone_default === true);
      clearFieldError('#mh-public-url-field');
      clearFieldError('#mh-proxy-field');
      clearRetentionError();
      loadSecuritySettings(data);
    }, function (failure) {
      markRetentionError(tf('module_messenger_hub_CommonLoadError', {
        what: t('module_messenger_hub_LoadWhatSettings'),
        code: failure.status > 0 ? failure.status : t('module_messenger_hub_CommonTimeout')
      }));
    });
  }
  function saveSetting(payload, fieldSelector, revert) {
    apiPatch('/settings', payload, function (data) {
      state.settings = data;
      if (fieldSelector) {
        clearFieldError(fieldSelector);
      }
      showToast(t('module_messenger_hub_CommonSaved'));
    }, function (failure) {
      if (fieldSelector) {
        markFieldError(fieldSelector, failureText(failure));
      }
      if (revert) {
        revert();
      }
    });
  }
  function savePublicUrl() {
    var value = String($('#mh-public-url-input').val() || '').trim();
    var previous = state.settings ? state.settings.pbx_public_url : '';
    if (value === '') {
      saveSetting({
        pbx_public_url: ''
      }, '#mh-public-url-field');
      return;
    }
    if (!/^https?:\/\/\S+$/i.test(value)) {
      markFieldError('#mh-public-url-field', t('module_messenger_hub_SettingsPublicUrlInvalid'));
      return;
    }
    saveSetting({
      pbx_public_url: value
    }, '#mh-public-url-field', function () {
      $('#mh-public-url-input').val(previous);
    });
  }
  function saveProxy() {
    var value = String($('#mh-proxy-input').val() || '').trim();
    var previous = state.settings ? state.settings.proxy_url : '';
    if (value !== '' && !/^((https?|socks5h?):\/\/)?[A-Za-z0-9.\-]+:\d{1,5}$/.test(value)) {
      markFieldError('#mh-proxy-field', t('module_messenger_hub_SettingsProxyInvalid'));
      return;
    }
    saveSetting({
      proxy_url: value
    }, '#mh-proxy-field', function () {
      $('#mh-proxy-input').val(previous);
    });
  }
  function saveMaxCaBundle() {
    var value = String($('#mh-max-ca-input').val() || '').trim();
    var previous = state.settings ? state.settings.max_ca_bundle_path : '';
    if (value !== '' && value.charAt(0) !== '/') {
      markFieldError('#mh-max-ca-field', t('module_messenger_hub_SettingsCaPathInvalid'));
      return;
    }
    saveSetting({
      max_ca_bundle_path: value
    }, '#mh-max-ca-field', function () {
      $('#mh-max-ca-input').val(previous);
    });
  }
  function saveMaskDefault() {
    var checked = $('#mh-mask-default input').prop('checked');
    saveSetting({
      mask_phone_default: checked
    }, null, function () {
      $('#mh-mask-default input').prop('checked', !checked);
      $('#mh-mask-default').toggleClass('checked', !checked);
      showToast(t('module_messenger_hub_CommonSaveFailed'));
    });
  }

  // Queue wait thresholds (0..3600 s). 0 turns the check off; the source clamps again on its side.
  function saveQueueWait(inputSelector, fieldSelector, key) {
    var raw = String($(inputSelector).val() || '').trim();
    var seconds = /^\d+$/.test(raw) ? parseInt(raw, 10) : -1;
    var previous = state.settings ? Number(state.settings[key] || 0) : 0;
    if (seconds < 0 || seconds > 3600) {
      markFieldError(fieldSelector, t('module_messenger_hub_SettingsQueueWaitError'));
      $(inputSelector).val(previous);
      return;
    }
    clearFieldError(fieldSelector);
    var payload = {};
    payload[key] = seconds;
    saveSetting(payload, fieldSelector, function () {
      $(inputSelector).val(previous);
    });
  }
  function saveQueueMinWait() {
    saveQueueWait('#mh-queue-min-wait-input', '#mh-queue-min-wait-field', 'queue_abandon_min_wait_sec');
  }
  function saveQueueLongWait() {
    saveQueueWait('#mh-queue-long-wait-input', '#mh-queue-long-wait-field', 'queue_long_wait_sec');
  }

  // Stage 4s-C numeric thresholds: config-change quiet window, external-IP and license poll intervals.
  function saveNumberSetting(payloadKey, inputSelector, fieldSelector, min, max) {
    var raw = String($(inputSelector).val() || '').trim();
    var value = /^\d+$/.test(raw) ? parseInt(raw, 10) : -1;
    if (value < min || value > max) {
      markFieldError(fieldSelector, t('module_messenger_hub_SettingsNumberError'));
      return;
    }
    clearFieldError(fieldSelector);
    var payload = {};
    payload[payloadKey] = value;
    apiPatch('/settings', payload, function (data) {
      state.settings = data;
      showToast(t('module_messenger_hub_CommonSaved'));
    }, function (failure) {
      markFieldError(fieldSelector, failureText(failure));
      $(inputSelector).val(state.settings ? state.settings[payloadKey] : '');
    });
  }

  // "14,7,1": days separated by commas, 1..365, at most five values, never empty.
  function saveLicenseWarnDays() {
    var raw = String($('#mh-license-days-input').val() || '').trim();
    var parts = raw === '' ? [] : raw.split(/[\s,;]+/);
    var days = [];
    var valid = parts.length > 0 && parts.length <= 5;
    parts.forEach(function (part) {
      var day = /^\d+$/.test(part) ? parseInt(part, 10) : -1;
      if (day < 1 || day > 365 || days.indexOf(day) >= 0) {
        valid = false;
        return;
      }
      days.push(day);
    });
    if (!valid || days.length === 0) {
      markFieldError('#mh-license-days-field', t('module_messenger_hub_SettingsLicenseDaysError'));
      return;
    }
    days.sort(function (a, b) {
      return b - a;
    });
    clearFieldError('#mh-license-days-field');
    apiPatch('/settings', {
      license_warn_days: days.join(',')
    }, function (data) {
      state.settings = data;
      $('#mh-license-days-input').val(data.license_warn_days || '');
      showToast(t('module_messenger_hub_CommonSaved'));
    }, function (failure) {
      markFieldError('#mh-license-days-field', failureText(failure));
      $('#mh-license-days-input').val(state.settings ? state.settings.license_warn_days : '');
    });
  }

  // ---------- security settings (stage 4s-A): toll-fraud rules and SIP brute force ----------

  function loadSecuritySettings(data) {
    $('#mh-toll-prefixes-input').val(data.toll_fraud_prefixes || '');
    $('#mh-toll-home-input').val(data.toll_fraud_home_prefixes || '');
    $('#mh-toll-burst-input').val(data.toll_fraud_burst_calls);
    $('#mh-toll-window-input').val(data.toll_fraud_burst_window_min);
    $('#mh-toll-from-input').val(data.toll_fraud_offhours_from || '');
    $('#mh-toll-to-input').val(data.toll_fraud_offhours_to || '');
    $('#mh-toll-offhours').toggleClass('checked', data.toll_fraud_offhours_enabled === true);
    $('#mh-toll-offhours input').prop('checked', data.toll_fraud_offhours_enabled === true);
    $('#mh-authfail-threshold-input').val(data.sip_authfail_threshold);
    $('#mh-authfail-window-input').val(data.sip_authfail_window_min);
    $('#mh-authfail-quiet-input').val(data.sip_authfail_quiet_min);
    $('#mh-authfail-perpoll-input').val(data.sip_authfail_extensions_per_poll);
    clearFieldError('#mh-toll-prefixes-field');
    clearFieldError('#mh-toll-home-field');
    clearFieldError('#mh-toll-burst-field');
    clearFieldError('#mh-toll-window-field');
    clearFieldError('#mh-toll-from-field');
    clearFieldError('#mh-toll-to-field');
    clearFieldError('#mh-authfail-threshold-field');
    clearFieldError('#mh-authfail-window-field');
    clearFieldError('#mh-authfail-quiet-field');
    clearFieldError('#mh-authfail-perpoll-field');
  }
  function securityInvalid(fieldSelector) {
    markFieldError(fieldSelector, t('module_messenger_hub_SettingsSecurityInvalid'));
  }
  function saveSecurityInt(selector, fieldSelector, field, min, max) {
    var raw = String($(selector).val() || '').trim();
    var value = /^\d+$/.test(raw) ? parseInt(raw, 10) : -1;
    if (value < min || value > max) {
      securityInvalid(fieldSelector);
      return;
    }
    var payload = {};
    payload[field] = value;
    var previous = state.settings ? state.settings[field] : value;
    saveSetting(payload, fieldSelector, function () {
      $(selector).val(previous);
    });
  }
  function saveSecurityPrefixes(selector, fieldSelector, field) {
    var value = String($(selector).val() || '').trim();
    if (value !== '' && !/^\+?\d{0,8}(\s*,\s*\+?\d{0,8})*$/.test(value)) {
      securityInvalid(fieldSelector);
      return;
    }
    var payload = {};
    payload[field] = value.replace(/\s+/g, '');
    var previous = state.settings ? state.settings[field] : '';
    saveSetting(payload, fieldSelector, function () {
      $(selector).val(previous);
    });
  }
  function saveSecurityTime(selector, fieldSelector, field) {
    var value = String($(selector).val() || '').trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      securityInvalid(fieldSelector);
      return;
    }
    var payload = {};
    payload[field] = value;
    var previous = state.settings ? state.settings[field] : value;
    saveSetting(payload, fieldSelector, function () {
      $(selector).val(previous);
    });
  }
  function saveTollOffHours() {
    var checked = $('#mh-toll-offhours input').prop('checked');
    saveSetting({
      toll_fraud_offhours_enabled: checked
    }, null, function () {
      $('#mh-toll-offhours input').prop('checked', !checked);
      $('#mh-toll-offhours').toggleClass('checked', !checked);
      showToast(t('module_messenger_hub_CommonSaveFailed'));
    });
  }
  function fmtCountdown(seconds) {
    var total = Math.max(0, parseInt(seconds, 10) || 0);
    return Math.floor(total / 60) + ':' + pad(total % 60);
  }

  // ---------- notifications: rules API & list ----------

  function loadRules(silent) {
    if (!silent) {
      state.rulesLoaded = false;
      renderRulesSkeleton();
    }
    apiGet('/rules', {
      limit: 200
    }, function (data) {
      state.rules = data.items || [];
      state.rulesLoaded = true;
      state.rulesError = null;
      renderRules();
    }, function (failure) {
      state.rulesLoaded = true;
      state.rulesError = failure;
      renderRules();
    });
  }
  function renderRulesSkeleton() {
    var row = '<div class="mh-notif-row"><span class="mh-skel" style="width:36px;height:20px;border-radius:10px"></span>' + '<span class="mh-skel" style="width:40%"></span><span></span><span></span></div>';
    $('#mh-rules-list').html(row + row);
  }
  function sourceForRule(rule) {
    if (rule.source_id) {
      var byId = sourceById(rule.source_id);
      if (byId) {
        return byId;
      }
    }
    for (var i = 0; i < state.sources.length; i++) {
      var types = state.sources[i].event_types || [];
      for (var j = 0; j < types.length; j++) {
        if (rule.event_types && rule.event_types.indexOf(types[j].type) >= 0) {
          return state.sources[i];
        }
      }
    }
    return null;
  }
  function setRuleAddVisible(visible) {
    $('#mh-rule-add').attr('hidden', visible ? null : true);
  }

  // Design v3, «Уведомления»: no bot → pick a messenger; bot but no notifications → one primary button;
  // otherwise the list grouped Звонки → ИИ Супервайзер → Голосовой агент → Связь и АТС (headings only for 2+ groups).
  function renderRules() {
    var $list = $('#mh-rules-list');
    if (!state.rulesLoaded || !state.botsLoaded) {
      setRuleAddVisible(false);
      return;
    }
    if (state.rulesError !== null && state.rules.length === 0) {
      setRuleAddVisible(false);
      $list.html('<div class="ui negative message" role="alert">' + ICON_ERROR + '<div class="mh-grow">' + esc(t('module_messenger_hub_RulesLoadFailed')) + '</div>' + '<button class="ui basic button mh-on-message" type="button" id="mh-rules-retry">' + esc(t('module_messenger_hub_CommonRetry')) + '</button></div>');
      $('#mh-rules-retry').on('click', function () {
        loadRules();
      });
      return;
    }
    if (state.bots.length === 0 && state.rules.length === 0 && state.botsError === null) {
      setRuleAddVisible(false);
      $list.html('<div class="mh-onboard" role="status">' + '<h3 class="ui header mh-page-title">' + esc(t('module_messenger_hub_OnboardTitle')) + '</h3>' + messengerTiles() + '</div>');
      return;
    }
    if (state.rules.length === 0) {
      setRuleAddVisible(false);
      $list.html('<div class="mh-empty mh-empty-box" role="status">' + '<h3 class="ui header mh-page-title">' + esc(t('module_messenger_hub_RulesEmptyTitle')) + '</h3>' + '<button class="ui primary button" type="button" data-action="add">' + ICON_PLUS + esc(t('module_messenger_hub_RulesAdd')) + '</button></div>');
      return;
    }
    setRuleAddVisible(true);
    var groups = {};
    state.rules.forEach(function (rule) {
      var group = rule.group || 'pbx';
      if (GROUP_ORDER.indexOf(group) < 0) {
        group = 'pbx';
      }
      (groups[group] = groups[group] || []).push(rule);
    });
    var order = GROUP_ORDER.filter(function (group) {
      return Boolean(groups[group]);
    });
    var html = '';
    if (state.rulesError !== null) {
      html += '<div class="ui negative message" role="alert">' + ICON_ERROR + '<div class="mh-grow">' + esc(t('module_messenger_hub_RulesLoadFailed')) + '</div>' + '<button class="ui basic button mh-on-message" type="button" id="mh-rules-retry-inline">' + esc(t('module_messenger_hub_CommonRetry')) + '</button></div>';
    }
    var showHeadings = order.length > 1;
    html += '<div class="mh-notif-list' + (showHeadings ? '' : ' is-flat') + '" role="list">';
    order.forEach(function (group) {
      if (showHeadings) {
        html += '<h3 class="mh-group-title">' + esc(sourceGroupName(group)) + '</h3>';
      }
      groups[group].forEach(function (rule) {
        html += renderRuleRow(rule);
      });
    });
    $list.html(html + '</div>');
    $('#mh-rules-retry-inline').on('click', function () {
      loadRules();
    });
  }
  function ruleChannel(rule) {
    var chats = rule.chats || [];
    if (chats.length > 0 && chats[0].channel) {
      return chats[0].channel;
    }
    var bot = chats.length > 0 ? botById(chats[0].bot_id) : state.bots[0] || null;
    return bot && bot.channel === 'max' ? 'max' : 'telegram';
  }

  // Colour only for a problem: unavailable source, rejected token, deleted bot or chat.
  function ruleProblemLabel(rule) {
    var source = sourceById(rule.source_id);
    if (source && source.availability && source.availability !== 'available') {
      var labels = {
        module_disabled: t('module_messenger_hub_SourceStateModoff'),
        module_missing: t('module_messenger_hub_SourceStateNoinst'),
        api_forbidden: t('module_messenger_hub_NotifSourceNoAccess'),
        api_incompatible: sourceStateText(source),
        disabled: t('module_messenger_hub_SourceStateOff'),
        error: t('module_messenger_hub_SourceStateErr')
      };
      if (labels[source.availability]) {
        var cls = source.availability === 'module_disabled' || source.availability === 'disabled' || source.availability === 'api_incompatible' ? 'ui yellow label' : 'ui red label';
        return '<span class="' + cls + '">' + esc(labels[source.availability]) + '</span>';
      }
    }
    var chats = rule.chats || [];
    if ((rule.chat_ids || []).length > chats.length) {
      return '<span class="ui red label">' + ICON_ERROR + esc(t('module_messenger_hub_DeliveryBotDeleted')) + '</span>';
    }
    for (var i = 0; i < chats.length; i++) {
      var bot = botById(chats[i].bot_id);
      if (bot && bot.enabled !== false && bot.status === 'token_invalid') {
        return '<span class="ui red label">' + ICON_ERROR + esc(t('module_messenger_hub_BotStatusTokenInvalid')) + '</span>';
      }
    }
    if (chats.length > 0 && chats.every(function (chat) {
      return chat.state === 'gone';
    })) {
      return '<span class="ui red label">' + ICON_ERROR + esc(t('module_messenger_hub_ChatStatusGone')) + '</span>';
    }
    return null;
  }
  function renderRuleRow(rule) {
    var problem = ruleProblemLabel(rule);
    var ruleFirst = state.rules.length > 0 && Number(state.rules[0].id) === Number(rule.id);
    var ruleLast = state.rules.length > 0 && Number(state.rules[state.rules.length - 1].id) === Number(rule.id);
    var right = '';
    if (problem !== null) {
      right = problem;
    } else if (rule.enabled && rule.last_event_at) {
      right = '<span class="mh-muted">' + fmtCellTime(rule.last_event_at) + '</span>';
    }
    var channel = ruleChannel(rule);
    return '<div class="mh-notif-row' + (rule.enabled ? '' : ' is-off') + '" role="listitem" data-rule-id="' + rule.id + '">' + '<label class="ui toggle checkbox' + (rule.enabled ? ' checked' : '') + '" aria-label="' + esc(rule.title) + '">' + '<input type="checkbox" class="hidden mh-rule-toggle"' + (rule.enabled ? ' checked' : '') + '>' + '<span class="mh-track"></span></label>' + '<span class="mh-notif-main">' + '<span class="mh-messenger s ' + (channel === 'max' ? 'max' : 'tg') + '" role="img" aria-label="' + (channel === 'max' ? 'MAX' : 'Telegram') + '">' + (channel === 'max' ? 'MAX' : 'TG') + '</span>' + '<a href="#" class="mh-notif-title mh-truncate" data-action="edit">' + esc(rule.title) + '</a></span>' + '<span class="mh-notif-status">' + right + '</span>' + '<div class="mh-rule-menu-wrap">' + '<button class="ui text button mh-rule-menu-btn" type="button" data-action="menu" aria-label="' + esc(t('module_messenger_hub_RuleMenuMore')) + '" aria-expanded="false">' + '<svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h.01M8 8h.01M12.5 8h.01" stroke-width="2.4"/></svg></button>' + '<div class="mh-rule-menu" hidden>' + '<a href="#" data-action="edit">' + esc(t('module_messenger_hub_RuleMenuEdit')) + '</a>' + (ruleFirst ? '' : '<a href="#" data-action="up">' + esc(t('module_messenger_hub_RuleMenuUp')) + '</a>') + (ruleLast ? '' : '<a href="#" data-action="down">' + esc(t('module_messenger_hub_RuleMenuDown')) + '</a>') + '<a href="#" data-action="delete">' + esc(t('module_messenger_hub_RuleMenuDelete')) + '</a>' + '</div></div></div>';
  }
  function bindRulesContainer() {
    var $wrap = $('#mh-rules-list');
    $wrap.on('click', '[data-action="add"]', function () {
      openRuleWizard(null);
    });
    $wrap.on('click', '[data-action="add-bot"]', function () {
      openBotModal('add', null, $(this).data('channel'));
    });
    $wrap.on('click', '[data-action="edit"]', function (event) {
      event.preventDefault();
      openRuleWizard(ruleById($(this).closest('.mh-notif-row').data('rule-id')));
    });
    $wrap.on('click', '[data-action="menu"]', function (event) {
      event.stopPropagation();
      var $menu = $(this).siblings('.mh-rule-menu');
      $('.mh-rule-menu').not($menu).prop('hidden', true);
      $menu.prop('hidden', !$menu.prop('hidden'));
    });
    $wrap.on('click', '[data-action="delete"]', function (event) {
      event.preventDefault();
      confirmDeleteRule(ruleById($(this).closest('.mh-notif-row').data('rule-id')));
    });
    $wrap.on('click', '[data-action="up"], [data-action="down"]', function (event) {
      event.preventDefault();
      moveRule($(this).closest('.mh-notif-row').data('rule-id'), $(this).data('action') === 'up' ? -1 : 1);
    });
    $wrap.on('change', '.mh-rule-toggle', function () {
      var id = $(this).closest('.mh-notif-row').data('rule-id');
      var enabled = $(this).prop('checked');
      apiPatch('/rules/' + id, {
        enabled: enabled
      }, function (rule) {
        replaceRule(rule);
        renderRules();
      }, function (failure) {
        loadRules(true);
        showToast(failureText(failure));
      });
    });
    $(document).on('click', function (event) {
      if ($(event.target).closest('.mh-rule-menu-wrap').length === 0) {
        $('.mh-rule-menu').attr('hidden', true);
      }
    });
  }
  function loadProviders(done) {
    if (state.providersLoaded) {
      done();
      return;
    }
    coreGet('/providers', {
      limit: 200
    }, function (data) {
      var items = data.items || [];
      var list = [];
      for (var i = 0; i < items.length; i++) {
        var provider = items[i];
        var id = String(provider.id !== undefined ? provider.id : provider.provider_id || '');
        if (id === '') {
          continue;
        }
        var label = provider.description || provider.username || '#' + id;
        list.push({
          id: id,
          label: label
        });
      }
      state.providers = list;
      state.providersLoaded = true;
      done();
    }, function () {
      state.providersLoaded = false;
      done();
    });
  }
  function moveRule(id, delta) {
    var ids = [];
    for (var i = 0; i < state.rules.length; i++) {
      ids.push(Number(state.rules[i].id));
    }
    var index = ids.indexOf(Number(id));
    var target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) {
      return;
    }
    var swap = ids[index];
    ids[index] = ids[target];
    ids[target] = swap;
    apiPost('/rules:changePriority', {
      order: ids
    }, function () {
      loadRules(true);
      showToast(t('module_messenger_hub_RuleOrderSaved'));
    }, function (failure) {
      showToast(failureText(failure));
    });
  }
  function ruleById(id) {
    for (var i = 0; i < state.rules.length; i++) {
      if (Number(state.rules[i].id) === Number(id)) {
        return state.rules[i];
      }
    }
    return null;
  }
  function replaceRule(rule) {
    for (var i = 0; i < state.rules.length; i++) {
      if (Number(state.rules[i].id) === Number(rule.id)) {
        state.rules[i] = rule;
        return;
      }
    }
    state.rules.push(rule);
  }
  function confirmDeleteRule(rule) {
    if (!rule) {
      return;
    }
    $('#mh-confirm-text').text(tf('module_messenger_hub_RuleDeleteConfirm', {
      title: rule.title
    }));
    $('#mh-confirm-modal').modal({
      closable: true
    }).modal('show');
    $('#mh-confirm-ok').off('click').on('click', function () {
      $('#mh-confirm-modal').modal('hide');
      apiDelete('/rules/' + rule.id, function () {
        loadRules(true);
        showToast(t('module_messenger_hub_CommonDeleted'));
      }, function (failure) {
        showToast(failureText(failure));
      });
    });
  }

  // ---------- notifications: wizard ----------

  function emptyFilters() {
    return {
      user_ids: [],
      directions: [],
      providers: [],
      quality_score: null,
      reasons: null
    };
  }
  function normalizeRetract(options) {
    var config = options && options.retract_on_callback && _typeof(options.retract_on_callback) === 'object' ? options.retract_on_callback : {};
    var window = Number(config.window_min);
    if (!window || window < 5 || window > 120) {
      window = 20;
    }
    return {
      enabled: config.enabled === true,
      window_min: window,
      count_incoming_answered: config.count_incoming_answered !== false
    };
  }
  function normalizeFilters(filters) {
    var result = emptyFilters();
    if (!filters || _typeof(filters) !== 'object') {
      return result;
    }
    if (Array.isArray(filters.user_ids)) {
      result.user_ids = filters.user_ids.map(Number);
    }
    if (Array.isArray(filters.directions)) {
      result.directions = filters.directions.slice();
    }
    if (Array.isArray(filters.providers)) {
      result.providers = filters.providers.map(String);
    }
    if (Array.isArray(filters.reasons)) {
      result.reasons = filters.reasons.map(String);
    }
    if (filters.quality_score && _typeof(filters.quality_score) === 'object') {
      result.quality_score = {};
      if (filters.quality_score.min !== undefined) {
        result.quality_score.min = Number(filters.quality_score.min);
      }
      if (filters.quality_score.max !== undefined) {
        result.quality_score.max = Number(filters.quality_score.max);
      }
    }
    return result;
  }

  // Audio attachment mode of a rule (Plan/05). The stage-2 boolean is not a mode and reads as "none".
  function normalizeAttachments(options) {
    var value = options ? options.attachments : null;
    return value === 'fragments' || value === 'recording' ? value : 'none';
  }

  // Modes offered for the selected event types: only events that can carry audio.
  function wizardAttachmentModes(types) {
    if (types.indexOf('ai_supervisor.attention_call') >= 0) {
      return ['none', 'fragments', 'recording'];
    }
    if (types.indexOf('core.voicemail') >= 0) {
      return ['none', 'recording'];
    }
    return [];
  }
  function ensureWizardData() {
    loadEmployees(function () {
      if (state.ruleWizard && state.ruleWizard.step === 2) {
        renderWizardConditions();
      }
    });
    loadProviders(function () {
      if (state.ruleWizard && state.ruleWizard.step === 2) {
        renderWizardConditions();
      }
    });
    if (!state.botsLoaded) {
      loadBots(true);
    }
  }
  function openRuleWizard(rule) {
    ensureWizardData();
    var source = rule ? sourceForRule(rule) : null;
    var ruleTypes = rule ? (rule.event_types || []).slice() : [];
    state.ruleWizard = {
      step: rule ? firstStepAfterScenario((rule.event_types || []).slice()) : 1,
      editId: rule ? Number(rule.id) : 0,
      sourceId: source ? source.id : '',
      eventTypes: ruleTypes,
      title: rule ? rule.title : '',
      filters: normalizeFilters(rule ? rule.filters : null),
      recover: rule ? wizardHasRecovery(ruleTypes) : true,
      minSeverity: rule && rule.min_severity === 'critical' ? 'critical' : 'warning',
      targetMode: rule ? rule.target_mode : 'employee_or_recipients',
      chatIds: rule ? (rule.chat_ids || []).map(Number).filter(function (id) {
        return (rule.chats || []).some(function (chat) {
          return Number(chat.id) === id;
        });
      }) : [],
      mask: rule ? !!(rule.options && rule.options.mask_phone === true) : !!(state.settings && state.settings.mask_phone_default === true),
      retract: normalizeRetract(rule ? rule.options : null),
      attachments: normalizeAttachments(rule ? rule.options : null),
      botId: rule && rule.chats && rule.chats.length > 0 ? Number(rule.chats[0].bot_id) : 0,
      error: ''
    };
    var opened = state.ruleWizard;
    if (rule && wizardSupportsReasons(opened.eventTypes) && opened.filters.reasons === null) {
      opened.filters.reasons = cloudAiReasons(true); // no filter = every reason, including a manual pause
    }
    $('#mh-rules-view').attr('hidden', true);
    $('#mh-wizard').removeAttr('hidden');
    $('#messenger-hub-root').addClass('mh-wizard-open');
    clearWizardError();
    renderWizard();
  }
  function closeRuleWizard() {
    $('#mh-wizard-preview, #mh-wizard-preview-target').empty();
    state.ruleWizard = null;
    $('#mh-wizard').attr('hidden', true);
    $('#mh-rules-view').removeAttr('hidden');
    $('#messenger-hub-root').removeClass('mh-wizard-open');
    renderRules();
  }
  function wizardScenario() {
    var w = state.ruleWizard;
    return w && w.sourceId ? sourceById(w.sourceId) : null;
  }
  function wizardSupportsEmployees(types) {
    var callTypes = ['core.missed_call', 'ai_supervisor.attention_call'];
    for (var i = 0; i < types.length; i++) {
      if (callTypes.indexOf(types[i]) >= 0) {
        return true;
      }
    }
    return false;
  }
  function wizardSupportsDirections(types) {
    return types.indexOf('core.missed_call') >= 0 || types.indexOf('ai_supervisor.attention_call') >= 0;
  }
  function wizardSupportsProviders(types) {
    return types.indexOf('core.provider_down') >= 0 || types.indexOf('core.provider_up') >= 0;
  }
  function wizardHasRecovery(types) {
    return Object.keys(STATUS_PAIRS).some(function (problem) {
      return types.indexOf(STATUS_PAIRS[problem]) >= 0;
    });
  }

  // A module status scenario (problem and/or its recovery): step 2 offers «Сообщать о восстановлении».
  function wizardHasStatus(types) {
    return wizardHasRecovery(types) || Object.keys(STATUS_PAIRS).some(function (problem) {
      return types.indexOf(problem) >= 0;
    });
  }
  function wizardSupportsReasons(types) {
    return types.indexOf('cloud_ai.paused') >= 0 || types.indexOf('cloud_ai.resumed') >= 0;
  }
  function wizardSupportsSeverity(types) {
    return types.indexOf('cloud_stt.incident') >= 0;
  }

  // Adds or removes the recovery type of every problem type in the list.
  function wizardWithRecovery(types, on) {
    var recoveries = Object.keys(STATUS_PAIRS).map(function (problem) {
      return STATUS_PAIRS[problem];
    });
    var result = types.filter(function (type) {
      return recoveries.indexOf(type) < 0;
    });
    if (on) {
      result.slice().forEach(function (type) {
        if (STATUS_PAIRS[type] && result.indexOf(STATUS_PAIRS[type]) < 0) {
          result.push(STATUS_PAIRS[type]);
        }
      });
    }
    return result;
  }

  // Step 2 exists only for scenarios with conditions; the others go straight to «Куда отправить».
  function wizardHasConditions(types) {
    return wizardSupportsEmployees(types) || wizardSupportsDirections(types) || wizardSupportsProviders(types) || wizardHasStatus(types) || types.indexOf('core.missed_call') >= 0 || types.indexOf('ai_supervisor.attention_call') >= 0;
  }
  function firstStepAfterScenario(types) {
    return wizardHasConditions(types) ? 2 : 3;
  }
  function renderWizard() {
    var w = state.ruleWizard;
    if (!w) {
      return;
    }
    $('#mh-wizard-step-1').attr('hidden', w.step !== 1);
    $('#mh-wizard-step-2').attr('hidden', w.step !== 2);
    $('#mh-wizard-step-3').attr('hidden', w.step !== 3);
    $('#mh-wizard').attr('data-step', String(w.step));
    var scenario = wizardScenario();
    var title;
    if (w.step === 1) {
      title = w.editId > 0 ? w.title : t('module_messenger_hub_WizardTitle');
    } else {
      title = w.editId > 0 ? w.title : scenario ? scenario.name : t('module_messenger_hub_WizardTitle');
    }
    $('#mh-wizard-title').text(title);
    // one basic button on the left: «Отмена» on the first step, «Назад» after it
    var canGoBack = w.step > 1 && !(w.editId > 0 && w.step === firstStepAfterScenario(w.eventTypes) && w.sourceId === '');
    $('#mh-wizard-prev').text(w.step === 1 ? t('module_messenger_hub_WizardCancel') : t('module_messenger_hub_WizardBackButton')).data('mode', canGoBack ? 'back' : 'cancel');
    var isLast = w.step === 3;
    $('#mh-wizard-next').text(isLast ? w.editId > 0 ? t('module_messenger_hub_WizardSave') : t('module_messenger_hub_WizardCreate') : t('module_messenger_hub_WizardNext'));
    if (w.step === 1) {
      renderWizardScenarios();
    }
    if (w.step === 2) {
      renderWizardConditions();
    }
    if (w.step === 3) {
      renderWizardRecipients();
    }
    updateWizardNext();
  }
  function updateWizardNext() {
    var w = state.ruleWizard;
    if (!w) {
      return;
    }
    var disabled = w.step === 1 && w.sourceId === '';
    if (w.step === 3) {
      disabled = activeWizardBot() === null;
    }
    $('#mh-wizard-next').prop('disabled', disabled).toggleClass('disabled', disabled);
  }

  // One icon per scenario (design v3, step 1).
  var SCENARIO_ICONS = {
    phone: '<path d="M4.5 2.5h2l1 3-1.5 1a8 8 0 0 0 3.5 3.5l1-1.5 3 1v2a1.5 1.5 0 0 1-1.5 1.5A10.5 10.5 0 0 1 3 4a1.5 1.5 0 0 1 1.5-1.5z"/>',
    mic: '<rect x="6" y="2" width="4" height="7.5" rx="2"/><path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14"/>',
    sparkle: '<path d="M8 2v3M8 11v3M2 8h3M11 8h3M3.8 3.8l2 2M10.2 10.2l2 2M3.8 12.2l2-2M10.2 5.8l2-2"/>',
    robot: '<rect x="3" y="5" width="10" height="8" rx="2"/><path d="M8 2.5V5M6 9h.01M10 9h.01"/>',
    server: '<rect x="2.5" y="3" width="11" height="4" rx="1"/><rect x="2.5" y="9" width="11" height="4" rx="1"/><path d="M5 5h.01M5 11h.01"/>',
    warning: '<path d="M8 2.5l6 10.5H2z"/><path d="M8 6.5v3M8 11.2v.1"/>',
    bolt: '<path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z"/>',
    gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2"/>',
    globe: '<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c1.7 1.8 2.6 3.8 2.6 6S9.7 12.2 8 14c-1.7-1.8-2.6-3.8-2.6-6S6.3 3.8 8 2z"/>',
    key: '<circle cx="5.5" cy="8" r="2.5"/><path d="M8 8h6M12 8v2.5M10 8v2"/>',
    shield: '<path d="M8 2l5 2v4c0 3-2.3 5-5 6-2.7-1-5-3-5-6V4z"/><path d="M6.2 8l1.3 1.3L10 6.8"/>'
  };
  var SCENARIO_ICON_BY_SOURCE = {
    'core.missed_call': 'phone',
    'core.voicemail': 'mic',
    'core.queue_abandoned': 'phone',
    'core.call_out_of_hours': 'warning',
    'core.park_timeout': 'phone',
    'ai_supervisor.attention_call': 'sparkle',
    'ai_supervisor.workers': 'robot',
    'local_stt.workers': 'mic',
    'local_stt.backlog': 'mic',
    'cloud_stt.incidents': 'mic',
    'cloud_stt.paused': 'mic',
    'cloud_ai.paused': 'sparkle',
    'voice_agent.callbacks': 'phone',
    'voice_agent.runtime': 'robot',
    'core.provider_status': 'server',
    'core.advice': 'warning',
    'core.pbx_started': 'bolt',
    'core.config_changed': 'gear',
    'core.external_ip_changed': 'globe',
    'core.license_expiring': 'key',
    'core.toll_fraud': 'warning',
    'core.extension_new_device': 'shield',
    'core.sip_auth_failures': 'shield'
  };
  function scenarioIcon(sourceId) {
    var paths = SCENARIO_ICONS[SCENARIO_ICON_BY_SOURCE[sourceId] || 'warning'];
    return '<span class="mh-scenario-icon"><svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true">' + paths + '</svg></span>';
  }
  function renderWizardScenarios() {
    var w = state.ruleWizard;
    var groups = GROUP_ORDER.filter(function (group) {
      return state.sources.some(function (source) {
        return source.group === group;
      });
    });
    var html = '';
    groups.forEach(function (group) {
      var sources = state.sources.filter(function (source) {
        return source.group === group;
      });
      if (groups.length > 1) {
        html += '<h3 class="mh-group-title">' + esc(sourceGroupName(group)) + '</h3>';
      }
      html += '<div class="mh-scenario-grid">';
      sources.forEach(function (source) {
        var disabled = ['module_missing', 'module_disabled', 'api_forbidden', 'api_incompatible', 'error', 'disabled'].indexOf(source.availability) >= 0;
        var selected = w.sourceId === source.id;
        // Unavailable scenario: only the reason, no action (user decision Q14).
        html += '<button type="button" class="mh-scenario' + (disabled ? ' is-disabled' : '') + (selected ? ' is-selected' : '') + '" data-source-id="' + esc(source.id) + '" aria-pressed="' + (selected ? 'true' : 'false') + '"' + (disabled ? ' disabled aria-disabled="true"' : '') + '>' + scenarioIcon(source.id) + '<span class="mh-scenario-text"><b>' + esc(source.name) + '</b>' + (disabled ? '<span class="mh-meta">' + esc(sourceStateText(source)) + '</span>' : '') + '</span></button>';
      });
      html += '</div>';
    });
    $('#mh-wizard-scenarios').html(html);
  }

  // ---- step 2: conditions (no hints; an empty choice means «все») ----

  function renderWizardConditions() {
    var w = state.ruleWizard;
    if (!w) {
      return;
    }
    var html = '';
    if (wizardSupportsEmployees(w.eventTypes)) {
      html += '<div class="field' + (state.employeesFailed ? ' error' : '') + '" id="mh-cond-employees-field">' + '<label>' + esc(t('module_messenger_hub_WizardEmployees')) + '</label>' + '<div class="ui multiple search selection dropdown mh-cond-dropdown" id="mh-cond-employees" tabindex="0">' + '<input type="hidden"><span class="default text">' + esc(t('module_messenger_hub_FilterAll')) + '</span><div class="menu"></div></div>' + (state.employeesFailed ? '<span class="mh-help">' + esc(t('module_messenger_hub_WizardListFailed')) + ' <a href="#" data-action="retry-employees">' + esc(t('module_messenger_hub_CommonRetry')) + '</a></span>' : '') + '</div>';
    }
    if (wizardSupportsDirections(w.eventTypes)) {
      var directions = [['incoming', 'module_messenger_hub_WizardDirectionIncoming'], ['outgoing', 'module_messenger_hub_WizardDirectionOutgoing'], ['internal', 'module_messenger_hub_WizardDirectionInternal']];
      html += '<div class="field"><label>' + esc(t('module_messenger_hub_WizardDirections')) + '</label>' + '<div class="mh-seg" role="group" aria-label="' + esc(t('module_messenger_hub_WizardDirections')) + '">';
      directions.forEach(function (pair) {
        var pressed = w.filters.directions.indexOf(pair[0]) >= 0;
        html += '<button type="button" data-direction="' + pair[0] + '" aria-pressed="' + (pressed ? 'true' : 'false') + '">' + esc(t(pair[1])) + '</button>';
      });
      html += '</div></div>';
    }
    if (wizardSupportsProviders(w.eventTypes)) {
      html += '<div class="field"><label>' + esc(t('module_messenger_hub_WizardProviders')) + '</label>' + '<div class="ui multiple search selection dropdown mh-cond-dropdown" id="mh-cond-providers" tabindex="0">' + '<input type="hidden"><span class="default text">' + esc(t('module_messenger_hub_FilterAll')) + '</span><div class="menu"></div></div></div>';
    }
    if (w.eventTypes.indexOf('ai_supervisor.attention_call') >= 0) {
      var range = w.filters.quality_score || {};
      html += '<div class="field"><label>' + esc(t('module_messenger_hub_WizardQuality')) + '</label>' + '<div class="mh-inline-inputs">' + '<span>' + esc(t('module_messenger_hub_WizardQualityFrom')) + '</span><input type="number" min="0" max="100" class="mh-quality-min mh-input-xs" value="' + (range.min !== undefined ? range.min : '') + '">' + '<span>' + esc(t('module_messenger_hub_WizardQualityTo')) + '</span><input type="number" min="0" max="100" class="mh-quality-max mh-input-xs" value="' + (range.max !== undefined ? range.max : '') + '">' + '</div></div>';
    }
    if (wizardSupportsSeverity(w.eventTypes)) {
      html += '<div class="field"><label>' + esc(t('module_messenger_hub_WizardSeverity')) + '</label>' + '<div class="mh-seg" role="group" aria-label="' + esc(t('module_messenger_hub_WizardSeverity')) + '">';
      [['warning', 'module_messenger_hub_WizardSeverityWarning'], ['critical', 'module_messenger_hub_WizardSeverityCritical']].forEach(function (pair) {
        html += '<button type="button" data-severity="' + pair[0] + '" aria-pressed="' + (w.minSeverity === pair[0] ? 'true' : 'false') + '">' + esc(t(pair[1])) + '</button>';
      });
      html += '</div></div>';
    }
    if (wizardSupportsReasons(w.eventTypes)) {
      var chosen = w.filters.reasons || [];
      html += '<div class="field" id="mh-cond-reasons"><label>' + esc(t('module_messenger_hub_WizardReasons')) + '</label>';
      CLOUD_AI_REASON_GROUPS.forEach(function (group) {
        html += '<div class="mh-reason-group"><div class="mh-reason-title">' + esc(t(group[0])) + '</div>';
        group[1].forEach(function (reason) {
          html += '<label class="mh-reason-check"><input type="checkbox" data-reason="' + reason + '"' + (chosen.indexOf(reason) >= 0 ? ' checked' : '') + '>' + '<span>' + esc(t('module_messenger_hub_' + STATUS_PAUSE_KEYS[reason])) + '</span></label>';
        });
        html += '</div>';
      });
      html += '</div>';
    }
    if (wizardHasStatus(w.eventTypes)) {
      html += '<div class="mh-switch-row mh-recover-row">' + '<label class="ui toggle checkbox' + (w.recover ? ' checked' : '') + '" id="mh-recover-enabled">' + '<input type="checkbox" class="hidden"' + (w.recover ? ' checked' : '') + ' aria-label="' + esc(t('module_messenger_hub_WizardRecovery')) + '">' + '<span class="mh-track"></span></label>' + '<span>' + esc(t('module_messenger_hub_WizardRecovery')) + '</span></div>';
    }
    if (w.eventTypes.indexOf('core.missed_call') >= 0) {
      html += '<div class="mh-switch-row mh-retract-row">' + '<label class="ui toggle checkbox' + (w.retract.enabled ? ' checked' : '') + '" id="mh-retract-enabled">' + '<input type="checkbox" class="hidden"' + (w.retract.enabled ? ' checked' : '') + ' aria-label="' + esc(t('module_messenger_hub_RetractEnabled')) + '">' + '<span class="mh-track"></span></label>' + '<span>' + esc(t('module_messenger_hub_RetractEnabled')) + '</span>' + '<span class="mh-inline-inputs" id="mh-retract-options"' + (w.retract.enabled ? '' : ' hidden') + '>' + '<span class="mh-muted">' + esc(t('module_messenger_hub_RetractWindowBefore')) + '</span>' + '<input type="number" min="5" max="120" id="mh-retract-window" class="mh-input-xs" value="' + w.retract.window_min + '" aria-label="' + esc(t('module_messenger_hub_RetractMinutes')) + '">' + '<span class="mh-muted">' + esc(t('module_messenger_hub_RetractMinutes')) + '</span></span>' + '</div>' + (wizardIsMax() ? '<div class="field" id="mh-retract-max-hint"' + (w.retract.enabled ? '' : ' hidden') + '>' + '<span class="mh-help">' + esc(t('module_messenger_hub_RetractMaxHint')) + '</span></div>' : '');
    }
    $('#mh-wizard-conditions').html(html);
    initConditionDropdowns();
    bindWizardConditions();
    renderWizardPreview();
  }
  function initConditionDropdowns() {
    var w = state.ruleWizard;
    var $employees = $('#mh-cond-employees');
    if ($employees.length > 0) {
      var selectedUsers = w.filters.user_ids.map(String);
      $employees.dropdown({
        values: state.employees.map(function (employee) {
          return {
            name: employee.label,
            value: String(employee.id),
            selected: selectedUsers.indexOf(String(employee.id)) >= 0
          };
        }),
        placeholder: t('module_messenger_hub_FilterAll'),
        fullTextSearch: true,
        message: {
          noResults: t('module_messenger_hub_FilterNothingFound')
        },
        onChange: function onChange(value) {
          if (!state.ruleWizard) {
            return;
          }
          state.ruleWizard.filters.user_ids = String(value || '').split(',').filter(Boolean).map(Number);
        }
      });
    }
    var $providers = $('#mh-cond-providers');
    if ($providers.length > 0) {
      var selectedProviders = w.filters.providers.map(String);
      $providers.dropdown({
        values: state.providers.map(function (provider) {
          return {
            name: provider.label,
            value: String(provider.id),
            selected: selectedProviders.indexOf(String(provider.id)) >= 0
          };
        }),
        placeholder: t('module_messenger_hub_FilterAll'),
        fullTextSearch: true,
        message: {
          noResults: t('module_messenger_hub_FilterNothingFound')
        },
        onChange: function onChange(value) {
          if (!state.ruleWizard) {
            return;
          }
          state.ruleWizard.filters.providers = String(value || '').split(',').filter(Boolean);
        }
      });
    }
  }
  function bindWizardConditions() {
    var $form = $('#mh-wizard-conditions');
    $form.off('.wizard');
    $form.on('click.wizard', '.mh-seg button[data-severity]', function () {
      var w = state.ruleWizard;
      if (!w) {
        return;
      }
      w.minSeverity = String($(this).data('severity')) === 'critical' ? 'critical' : 'warning';
      $(this).closest('.mh-seg').find('button').attr('aria-pressed', 'false');
      $(this).attr('aria-pressed', 'true');
      renderWizardPreview();
    });
    $form.on('change.wizard', '#mh-recover-enabled input', function () {
      var w = state.ruleWizard;
      if (!w) {
        return;
      }
      w.recover = $(this).prop('checked');
      $('#mh-recover-enabled').toggleClass('checked', w.recover);
      w.eventTypes = wizardWithRecovery(w.eventTypes, w.recover);
      renderWizardPreview();
    });
    $form.on('change.wizard', '#mh-cond-reasons input[data-reason]', function () {
      var w = state.ruleWizard;
      if (!w) {
        return;
      }
      w.filters.reasons = $form.find('#mh-cond-reasons input[data-reason]:checked').map(function () {
        return String($(this).data('reason'));
      }).get();
      renderWizardPreview();
    });
    $form.on('click.wizard', '.mh-seg button[data-direction]', function () {
      var w = state.ruleWizard;
      if (!w) {
        return;
      }
      var value = String($(this).data('direction'));
      var index = w.filters.directions.indexOf(value);
      if (index >= 0) {
        w.filters.directions.splice(index, 1);
      } else {
        w.filters.directions.push(value);
      }
      $(this).attr('aria-pressed', index >= 0 ? 'false' : 'true');
      renderWizardPreview();
    });
    $form.on('click.wizard', '[data-action="retry-employees"]', function (event) {
      event.preventDefault();
      state.employeesFailed = false;
      loadEmployees(function () {
        renderWizardConditions();
      });
    });
    $form.on('change.wizard', '#mh-retract-enabled input', function () {
      var w = state.ruleWizard;
      if (!w) {
        return;
      }
      w.retract.enabled = $(this).prop('checked');
      $('#mh-retract-enabled').toggleClass('checked', w.retract.enabled);
      $('#mh-retract-options').prop('hidden', !w.retract.enabled);
      $('#mh-retract-max-hint').prop('hidden', !w.retract.enabled);
    });
    $form.on('input.wizard change.wizard', '#mh-retract-window', function () {
      var w = state.ruleWizard;
      if (!w) {
        return;
      }
      var value = Number($(this).val());
      w.retract.window_min = value >= 5 && value <= 120 ? value : 20;
    });
    $form.on('input.wizard', '.mh-quality-min, .mh-quality-max', function () {
      var w = state.ruleWizard;
      if (!w) {
        return;
      }
      var min = $form.find('.mh-quality-min').val();
      var max = $form.find('.mh-quality-max').val();
      var range = {};
      if (String(min).trim() !== '') {
        range.min = Number(min);
      }
      if (String(max).trim() !== '') {
        range.max = Number(max);
      }
      w.filters.quality_score = Object.keys(range).length > 0 ? range : null;
      renderWizardPreview();
    });
  }

  // ---- step 3: where to send ----

  function activeWizardBot() {
    var w = state.ruleWizard;
    if (!w) {
      return null;
    }
    var bots = state.bots.filter(function (bot) {
      return bot.enabled !== false;
    });
    if (w.botId > 0) {
      for (var i = 0; i < bots.length; i++) {
        if (Number(bots[i].id) === Number(w.botId)) {
          return bots[i];
        }
      }
    }
    return bots.length > 0 ? bots[0] : null;
  }
  function renderWizardRecipients() {
    var w = state.ruleWizard;
    var supportsEmployees = wizardSupportsEmployees(w.eventTypes);
    var bots = state.bots.filter(function (bot) {
      return bot.enabled !== false;
    });
    var active = activeWizardBot();
    if (active !== null && Number(w.botId) !== Number(active.id)) {
      w.botId = Number(active.id); // a single bot is selected by itself
    }
    var botHtml = '';
    bots.forEach(function (bot) {
      var selected = active !== null && Number(active.id) === Number(bot.id);
      var channel = bot.channel === 'max' ? 'max' : 'tg';
      botHtml += '<button type="button" class="mh-scenario mh-bot-choice' + (selected ? ' is-selected' : '') + '" data-bot-id="' + bot.id + '" aria-pressed="' + (selected ? 'true' : 'false') + '">' + '<span class="mh-messenger ' + channel + '" aria-hidden="true">' + (channel === 'max' ? 'MAX' : 'TG') + '</span>' + '<b class="mh-truncate">' + esc(bot.title) + '</b></button>';
    });
    $('#mh-wizard-bots').html(botHtml);
    $('#mh-wizard-bots-field').attr('hidden', bots.length > 0 ? null : true);
    $('#mh-wizard-no-bots').attr('hidden', bots.length > 0 ? true : null);
    $('#mh-wizard-target').attr('hidden', bots.length > 0 ? null : true);
    if (!supportsEmployees) {
      w.targetMode = 'recipients';
      $('#mh-wizard-target [value="employee"], #mh-wizard-target [value="employee_or_recipients"]').closest('label').attr('hidden', true);
    } else {
      $('#mh-wizard-target [value="employee"], #mh-wizard-target [value="employee_or_recipients"]').closest('label').removeAttr('hidden');
    }
    $('#mh-wizard-target input[name="mh-target"]').each(function () {
      var checked = $(this).val() === w.targetMode;
      $(this).prop('checked', checked).closest('label').toggleClass('checked', checked);
    });
    renderWizardChats();
    $('#mh-wizard-mask').toggleClass('checked', w.mask);
    $('#mh-wizard-mask input').prop('checked', w.mask);
    renderWizardAttachments();
    bindWizardRecipients();
    // a scenario without conditions goes 1 -> 3: step 3 must render its own preview
    renderWizardPreview();
  }
  function renderWizardAttachments() {
    var w = state.ruleWizard;
    var modes = wizardAttachmentModes(w.eventTypes);
    var $field = $('#mh-wizard-attachments');
    if (modes.length === 0) {
      w.attachments = 'none';
      $field.attr('hidden', true);
      return;
    }
    if (modes.indexOf(w.attachments) < 0) {
      w.attachments = 'none';
    }
    $field.removeAttr('hidden');
    // a voicemail is one file: the whole-conversation wording becomes plain "Recording"
    var voicemailOnly = w.eventTypes.indexOf('ai_supervisor.attention_call') < 0;
    $('#mh-wizard-attach-recording-text').text(t(voicemailOnly ? 'module_messenger_hub_WizardAttachVoicemail' : 'module_messenger_hub_WizardAttachRecording'));
    $field.find('label[data-mode]').each(function () {
      var mode = String($(this).data('mode'));
      var checked = mode === w.attachments;
      $(this).attr('hidden', modes.indexOf(mode) >= 0 ? null : true).toggleClass('checked', checked).find('input').prop('checked', checked);
    });
    $('#mh-wizard-attach-hint').attr('hidden', w.attachments === 'none' ? true : null);
  }
  function renderWizardChats() {
    var w = state.ruleWizard;
    var bot = activeWizardBot();
    var chats = bot ? (bot.chats || []).filter(function (chat) {
      return chat.state === 'active' && chat.enabled === true;
    }) : [];
    var ids = chats.map(function (chat) {
      return Number(chat.id);
    });
    w.chatIds = w.chatIds.filter(function (id) {
      return ids.indexOf(id) >= 0;
    });
    $('#mh-wizard-chats-field').attr('hidden', w.targetMode === 'employee' ? true : null);
    var $dropdown = $('#mh-wizard-chats');
    $dropdown.dropdown('destroy');
    $dropdown.find('a.ui.label').remove();
    $dropdown.dropdown({
      values: chats.map(function (chat) {
        return {
          name: esc(chat.title || chat.chat_id) + ' <span class="mh-meta">· ' + esc(chatKindLabel(chat.chat_kind)) + '</span>',
          text: esc(chat.title || chat.chat_id),
          value: String(chat.id),
          selected: w.chatIds.indexOf(Number(chat.id)) >= 0
        };
      }),
      placeholder: chats.length > 0 ? t('module_messenger_hub_WizardChatsTitle') : t('module_messenger_hub_WizardNoChats'),
      message: {
        noResults: t('module_messenger_hub_WizardNoChats')
      },
      onChange: function onChange(value) {
        if (!state.ruleWizard) {
          return;
        }
        state.ruleWizard.chatIds = String(value || '').split(',').filter(Boolean).map(Number);
      }
    });
  }
  function bindWizardRecipients() {
    var $step = $('#mh-wizard-step-3');
    $step.off('.wizard');
    $step.on('click.wizard', '.mh-bot-choice', function (event) {
      event.preventDefault();
      state.ruleWizard.botId = Number($(this).data('bot-id'));
      state.ruleWizard.chatIds = [];
      renderWizardRecipients();
      renderWizardPreview();
      updateWizardNext();
    });
    $step.on('change.wizard', 'input[name="mh-target"]', function () {
      state.ruleWizard.targetMode = String($(this).val());
      $('#mh-wizard-target input[name="mh-target"]').each(function () {
        $(this).closest('label').toggleClass('checked', $(this).prop('checked'));
      });
      $('#mh-wizard-chats-field').attr('hidden', state.ruleWizard.targetMode === 'employee' ? true : null);
    });
    $step.on('change.wizard', 'input[name="mh-attachments"]', function () {
      state.ruleWizard.attachments = String($(this).val());
      renderWizardAttachments();
      renderWizardPreview();
    });
    $step.on('change.wizard', '#mh-wizard-mask input', function () {
      state.ruleWizard.mask = $(this).prop('checked');
      $('#mh-wizard-mask').toggleClass('checked', state.ruleWizard.mask);
      renderWizardPreview();
    });
  }

  // ---- preview (step 2, right column) ----

  /** A rule targets one bot, so its channel is the channel of the active wizard bot. */
  function wizardIsMax() {
    var bot = activeWizardBot();
    return !!bot && bot.channel === 'max';
  }
  function wizardPreviewCallType(types) {
    var order = ['core.missed_call', 'core.voicemail', 'ai_supervisor.attention_call', 'ai_supervisor.worker_offline', 'ai_supervisor.worker_online', 'local_stt.worker_offline', 'local_stt.worker_online', 'local_stt.backlog_no_workers', 'local_stt.backlog_resolved', 'cloud_stt.incident', 'cloud_stt.incident_resolved', 'cloud_stt.paused', 'cloud_stt.resumed', 'cloud_ai.paused', 'cloud_ai.resumed', 'voice_agent.callback_request', 'voice_agent.runtime_down', 'voice_agent.runtime_up', 'core.provider_down', 'core.provider_up', 'core.advice', 'core.pbx_started'];
    for (var i = 0; i < order.length; i++) {
      if (types.indexOf(order[i]) >= 0) {
        return order[i];
      }
    }
    return '';
  }

  // Sample data of the preview bubbles for the module status events; never real values.
  var STATUS_PREVIEW_SAMPLES = {
    'ai_supervisor.worker_offline': {
      code: 'worker_offline',
      ref: 'sample',
      counters: {
        workers_online: 1,
        workers_total: 2
      }
    },
    'ai_supervisor.worker_online': {
      code: 'worker_offline',
      ref: 'sample',
      counters: {
        workers_online: 2,
        workers_total: 2
      }
    },
    'local_stt.worker_offline': {
      code: 'worker_offline',
      ref: 'sample',
      counters: {
        workers_online: 2,
        workers_total: 3
      }
    },
    'local_stt.worker_online': {
      code: 'worker_offline',
      ref: 'sample',
      counters: {
        workers_online: 3,
        workers_total: 3
      }
    },
    'local_stt.backlog_no_workers': {
      code: 'backlog_no_workers',
      ref: 'queue',
      counters: {
        workers_online: 0,
        workers_total: 3,
        jobs_waiting: 12
      }
    },
    'local_stt.backlog_resolved': {
      code: 'backlog_no_workers',
      ref: 'queue',
      counters: {
        workers_online: 3,
        workers_total: 3,
        jobs_waiting: 0
      }
    },
    'cloud_stt.incident': {
      code: 'incident_open',
      ref: 'sample',
      counters: {
        incidents_open: 1
      }
    },
    'cloud_stt.incident_resolved': {
      code: 'incident_open',
      ref: 'sample',
      counters: {
        incidents_open: 0
      }
    },
    'cloud_stt.paused': {
      code: 'processing_paused',
      ref: 'maintenance',
      counters: {}
    },
    'cloud_stt.resumed': {
      code: 'processing_paused',
      ref: 'maintenance',
      counters: {}
    },
    'cloud_ai.paused': {
      code: 'processing_paused',
      ref: 'insufficient_funds',
      counters: {
        jobs_waiting: 12
      }
    },
    'cloud_ai.resumed': {
      code: 'processing_paused',
      ref: 'insufficient_funds',
      counters: {
        jobs_waiting: 0
      }
    }
  };
  function renderWizardPreview() {
    var w = state.ruleWizard;
    if (!w) {
      return;
    }
    var type = wizardPreviewCallType(w.eventTypes);
    if (type === '') {
      $('#mh-wizard-preview, #mh-wizard-preview-target').empty();
      return;
    }
    var html = wizardPreviewBubble(type, w);
    // the recovery switch is part of the preview: a second bubble shows what the recovery looks like
    var recovery = STATUS_PAIRS[type];
    if (recovery && w.eventTypes.indexOf(recovery) >= 0) {
      html += wizardPreviewBubble(recovery, w);
    }
    // the messenger is part of the preview, so the aside says which bubble it shows
    // (the design has no visible caption above the bubble)
    $('.mh-wizard-preview').attr('aria-label', t(wizardIsMax() ? 'module_messenger_hub_WizardPreviewChannelMax' : 'module_messenger_hub_WizardPreviewTitle'));
    // step 2 shows the conditions preview, step 3 the same preview for the chosen bot
    $('#mh-wizard-preview, #mh-wizard-preview-target').html(html);
  }
  function wizardPreviewBubble(type, w) {
    var names = eventTypeNames();
    var title = names[type] || type;
    if (type === 'ai_supervisor.attention_call') {
      title += ' · ' + tf('module_messenger_hub_MessageQualityScore', {
        score: 48
      });
    }
    var phone = w.mask ? '+7 968 ***-**-44' : '+7 968 968-94-44';
    var lines = [];
    var notes = [];
    var button = false;
    var direction = w.filters.directions.length === 1 ? w.filters.directions[0] : 'incoming';
    switch (type) {
      case 'core.missed_call':
        lines.push('<b>' + esc(phone) + '</b> → Иванов И. (233)');
        lines.push(esc('02.10.2026 15:41 · ' + t({
          incoming: 'module_messenger_hub_MessageDirectionIncoming',
          outgoing: 'module_messenger_hub_MessageDirectionOutgoing',
          internal: 'module_messenger_hub_MessageDirectionInternal'
        }[direction])));
        button = true;
        break;
      case 'core.voicemail':
        lines.push(esc(t('module_messenger_hub_MessageVoicemailHint')));
        button = true;
        break;
      case 'ai_supervisor.attention_call':
        lines.push(esc('Петрова А. (241) ← ' + (w.mask ? '+7 916 ***-**-17' : '+7 916 204-55-17') + ' · 6:42'));
        lines.push(esc(tf('module_messenger_hub_MessageReasons', {
          reasons: 'Клиенту не помогли; повторный звонок'
        })));
        notes.push('Клиенту не помогли: дважды отправили на сайт, решения не предложили.');
        button = true;
        break;
      case 'voice_agent.callback_request':
        lines.push(esc('Пётр · ' + phone));
        lines.push(esc(tf('module_messenger_hub_MessageTopic', {
          topic: 'Возврат'
        })));
        button = true;
        break;
      case 'core.provider_down':
      case 'core.provider_up':
        lines.push(esc('SIP «Мегафон» · 10.0.0.1'));
        notes.push('registered → unregistered');
        break;
      case 'ai_supervisor.worker_offline':
      case 'ai_supervisor.worker_online':
      case 'local_stt.worker_offline':
      case 'local_stt.worker_online':
      case 'local_stt.backlog_no_workers':
      case 'local_stt.backlog_resolved':
      case 'cloud_stt.incident':
      case 'cloud_stt.incident_resolved':
      case 'cloud_stt.paused':
      case 'cloud_stt.resumed':
      case 'cloud_ai.paused':
      case 'cloud_ai.resumed':
        var sample = STATUS_PREVIEW_SAMPLES[type];
        if (wizardSupportsReasons([type]) && w.filters.reasons && w.filters.reasons.length > 0) {
          // the sample shows the first selected pause reason, so the choice is visible
          sample = $.extend({}, sample, {
            ref: w.filters.reasons[0]
          });
        }
        var scenarioSource = sourceById(w.sourceId);
        if (scenarioSource && scenarioSource.module_name) {
          lines.push(esc(scenarioSource.module_name));
        }
        lines.push(esc(statusPhrase(type, sample)));
        statusCounterNotes(sample).forEach(function (note) {
          notes.push(note);
        });
        break;
      case 'voice_agent.runtime_down':
      case 'voice_agent.runtime_up':
        lines.push('connection refused');
        notes.push(tf('module_messenger_hub_MessageLatency', {
          ms: 1200
        }));
        break;
      case 'core.advice':
        lines.push(esc('Свободно 8 % на разделе /storage'));
        break;
      case 'core.config_changed':
        lines.push(esc(tf('module_messenger_hub_MessageConfigArea', {
          area: t('module_messenger_hub_ConfigAreaProviders'),
          count: 2
        })));
        lines.push(esc(tf('module_messenger_hub_MessageConfigArea', {
          area: t('module_messenger_hub_ConfigAreaRouting'),
          count: 1
        })));
        notes.push('02.10.2026 15:41');
        break;
      case 'core.external_ip_changed':
        lines.push('203.0.113.5 → 203.0.113.9');
        notes.push(esc(tf('module_messenger_hub_MessageExternalIpSeenAt', {
          time: '02.10.2026 15:41'
        })));
        break;
      case 'core.license_expiring':
        lines.push('MikoPBX');
        lines.push(esc(tf('module_messenger_hub_MessageLicenseExpiresOn', {
          date: '31.12.2026'
        })));
        notes.push(esc(tf('module_messenger_hub_MessageLicenseDaysLeft', {
          days: 7
        })));
        break;
      case 'core.pbx_started':
        lines.push('02.10.2026 03:10');
        break;
    }
    var isMax = wizardIsMax();
    var html = '<div class="mh-preview-msg' + (isMax ? ' is-max' : '') + '"><div>' + esc(iconForType(type)) + ' <b>' + esc(title) + '</b></div>';
    lines.forEach(function (line) {
      html += '<div>' + line + '</div>';
    });
    notes.forEach(function (note) {
      html += '<div><i>' + esc(note) + '</i></div>';
    });
    html += '<span class="mh-preview-time">15:41</span></div>';
    html += wizardPreviewAudio(type, w.attachments, isMax);
    if (button) {
      html += '<div class="mh-preview-button' + (isMax ? ' is-max' : '') + '">' + esc(t('module_messenger_hub_WizardPreviewButton')) + ' ↗</div>';
    }
    return html;
  }

  // Audio bubbles follow the text (Plan/03): fragments = one bubble per fragment, otherwise the whole file.
  // The numbers are sample values of the preview, never real data.
  function wizardPreviewAudio(type, mode, isMax) {
    if (mode === 'none' || wizardAttachmentModes([type]).indexOf(mode) < 0) {
      return '';
    }
    var items = [];
    if (mode === 'fragments') {
      var sample = ['0:12', '0:18'];
      sample.forEach(function (duration, index) {
        items.push(tf('module_messenger_hub_PreviewAudioFragment', {
          n: index + 1,
          total: sample.length,
          duration: duration
        }));
      });
    } else {
      items.push(tf('module_messenger_hub_PreviewAudioRecording', {
        duration: type === 'core.voicemail' ? '0:32' : '6:42'
      }));
    }
    var html = '';
    items.forEach(function (caption) {
      html += '<div class="mh-preview-msg mh-preview-audio' + (isMax ? ' is-max' : '') + '">' + '<div class="mh-preview-audio-row"><span class="mh-preview-play" aria-hidden="true"></span>' + '<span class="mh-preview-wave" aria-hidden="true"></span></div>' + '<div class="mh-meta">' + esc(caption) + '</div>' + '<span class="mh-preview-time">15:41</span></div>';
    });
    return html;
  }
  function iconForType(type) {
    if (type === 'core.missed_call' || type === 'voice_agent.callback_request') {
      return '📞';
    }
    if (type === 'core.voicemail') {
      return '🎙';
    }
    if (type === 'ai_supervisor.attention_call' || type === 'core.provider_down' || type === 'voice_agent.runtime_down') {
      return '⚠️';
    }
    if (STATUS_RECOVERY_KEYS[type] || type === 'core.provider_up' || type === 'voice_agent.runtime_up') {
      return '✅';
    }
    if (type === 'ai_supervisor.worker_offline' || type === 'local_stt.worker_offline') {
      return '🔌';
    }
    if (type === 'core.pbx_started') {
      return '🔄';
    }
    if (type === 'core.config_changed') {
      return '🛠';
    }
    if (type === 'core.external_ip_changed') {
      return '🌐';
    }
    if (type === 'core.license_expiring') {
      return '⚠️';
    }
    return '⚠️';
  }

  // ---- navigation and save ----

  function wizardNext() {
    var w = state.ruleWizard;
    if (!w) {
      return;
    }
    if (w.step === 1) {
      if (!w.sourceId) {
        return;
      }
      w.step = firstStepAfterScenario(w.eventTypes);
      renderWizard();
      return;
    }
    if (w.step === 2) {
      if (wizardSupportsReasons(w.eventTypes) && (!w.filters.reasons || w.filters.reasons.length === 0)) {
        showWizardError(t('module_messenger_hub_WizardReasonsRequired'));
        return;
      }
      w.step = 3;
      renderWizard();
      return;
    }
    saveRule();
  }
  function wizardPrev() {
    var w = state.ruleWizard;
    if (!w) {
      return;
    }
    if ($('#mh-wizard-prev').data('mode') !== 'back') {
      closeRuleWizard();
      return;
    }
    if (w.step === 3 && wizardHasConditions(w.eventTypes)) {
      w.step = 2;
    } else {
      w.step = 1;
    }
    clearWizardError();
    renderWizard();
  }
  function pruneFilters(filters) {
    var result = {};
    if (filters.user_ids.length > 0) {
      result.user_ids = filters.user_ids;
    }
    if (filters.directions.length > 0) {
      result.directions = filters.directions;
    }
    if (filters.providers.length > 0) {
      result.providers = filters.providers;
    }
    // every reason selected = no filter (a manual pause included); a subset is stored as chosen
    if (filters.reasons && filters.reasons.length > 0 && filters.reasons.length < cloudAiReasons(true).length) {
      result.reasons = filters.reasons;
    }
    if (filters.quality_score !== null && Object.keys(filters.quality_score).length > 0) {
      result.quality_score = filters.quality_score;
    }
    return result;
  }
  function saveRule() {
    var w = state.ruleWizard;
    if (!w) {
      return;
    }
    var scenario = wizardScenario();
    // the wizard has no name field (design v3): a new notification is named after its scenario
    var title = String(w.title || '').trim() || (scenario ? scenario.name : '');
    if (title === '') {
      showWizardError(t('module_messenger_hub_WizardTitleRequired'));
      return;
    }
    if (w.targetMode !== 'employee' && w.chatIds.length === 0) {
      showWizardError(t('module_messenger_hub_WizardNeedChats'));
      return;
    }
    var options = {
      mask_phone: w.mask
    };
    if (w.eventTypes.indexOf('core.missed_call') >= 0) {
      options.retract_on_callback = {
        enabled: w.retract.enabled === true,
        window_min: w.retract.window_min >= 5 && w.retract.window_min <= 120 ? w.retract.window_min : 20,
        count_incoming_answered: w.retract.count_incoming_answered !== false
      };
    }
    if (wizardAttachmentModes(w.eventTypes).length > 0) {
      options.attachments = w.attachments;
    }
    var payload = {
      title: title,
      enabled: true,
      event_types: w.eventTypes,
      min_severity: wizardSupportsSeverity(w.eventTypes) ? w.minSeverity : 'info',
      filters: pruneFilters(wizardSupportsReasons(w.eventTypes) ? w.filters : $.extend({}, w.filters, {
        reasons: null
      })),
      target_mode: w.targetMode,
      chat_ids: w.chatIds,
      options: options
    };
    var done = function done(rule) {
      closeRuleWizard();
      replaceRule(rule);
      loadRules(true);
      showToast(t(w.editId > 0 ? 'module_messenger_hub_WizardSaved' : 'module_messenger_hub_WizardCreated'));
    };
    var failure = function failure(err) {
      showWizardError(failureText(err));
    };
    if (w.editId > 0) {
      apiPatch('/rules/' + w.editId, payload, done, failure);
    } else {
      apiPost('/rules', payload, done, failure);
    }
  }
  function showWizardError(text) {
    $('#mh-wizard .mh-wizard-error-slot').html('<div class="ui negative message" role="alert">' + ICON_ERROR + '<div class="mh-grow">' + esc(text) + '</div></div>');
  }
  function clearWizardError() {
    $('#mh-wizard .mh-wizard-error-slot').empty();
  }
  function bindWizardControls() {
    $('#mh-rule-add').on('click', function () {
      openRuleWizard(null);
    });
    $('#mh-wizard-back').on('click', function (event) {
      event.preventDefault();
      closeRuleWizard();
    });
    $('#mh-wizard-next').on('click', function () {
      if ($(this).prop('disabled')) {
        return;
      }
      clearWizardError();
      wizardNext();
    });
    $('#mh-wizard-prev').on('click', wizardPrev);
    $('#mh-wizard-open-settings').on('click', function (event) {
      event.preventDefault();
      closeRuleWizard();
      $('#mh-tabs .item[data-tab="settings"]').trigger('click');
    });
    $('#mh-wizard-scenarios').on('click', '.mh-scenario', function () {
      var source = sourceById($(this).data('source-id'));
      if (!source || $(this).hasClass('is-disabled')) {
        return;
      }
      var w = state.ruleWizard;
      if (w.sourceId !== source.id) {
        w.sourceId = source.id;
        w.eventTypes = (source.event_types || []).map(function (type) {
          return type.type;
        });
        if (w.editId === 0) {
          w.title = source.name;
        }
        w.filters = emptyFilters();
        w.recover = true;
        w.minSeverity = 'warning';
        if (wizardSupportsReasons(w.eventTypes)) {
          w.filters.reasons = cloudAiReasons(false); // new rule: everything except a manual pause
        }
      }
      renderWizardScenarios();
      updateWizardNext();
    });
    $('#mh-wizard-scenarios').on('dblclick', '.mh-scenario:not(.is-disabled)', function () {
      wizardNext();
    });
  }

  // ---------- tabs & autorefresh ----------

  function initTabs() {
    $('#mh-tabs .item').on('click', function () {
      var tab = $(this).data('tab');
      $('#mh-tabs .item').removeClass('active');
      $(this).addClass('active');
      $('#messenger-hub-root .mh-tab-pane').removeClass('active');
      $('#messenger-hub-root .mh-tab-pane[data-tab="' + tab + '"]').addClass('active');
      $('#messenger-hub-root').attr('data-active-tab', tab);
      if (tab === 'notifications') {
        loadRules(true);
      }
      if (tab === 'settings') {
        loadGeneralSettings();
        loadEmployees(function () {
          loadBots();
        });
      }
    });
  }
  function journalVisible() {
    return $('#messenger-hub-root .mh-tab-pane[data-tab="journal"]').hasClass('active') && document.visibilityState === 'visible';
  }
  function notificationsVisible() {
    return $('#messenger-hub-root .mh-tab-pane[data-tab="notifications"]').hasClass('active') && document.visibilityState === 'visible';
  }
  function scheduleRefresh() {
    setInterval(function () {
      if (journalVisible()) {
        load({
          refresh: true
        });
        return;
      }
      if (notificationsVisible() && state.ruleWizard === null) {
        loadRules(true);
      }
      if (document.visibilityState === 'visible') {
        loadJournalBadge();
      }
    }, REFRESH_SEC * 1000);
  }

  // ---------- init ----------

  $(document).ready(function () {
    root = document.getElementById('messenger-hub-root');
    if (!root) {
      return;
    }
    initTabs();
    buildPeriodMenu();
    renderSkeleton();

    // our checkboxes are plain labels around hidden inputs: keep the visual state in sync
    $(document).on('change', '.module-messenger-hub .ui.checkbox input, .mh-modal .ui.checkbox input', function () {
      var $input = $(this);
      if ($input.attr('type') === 'radio') {
        $('input[name="' + $input.attr('name') + '"]').each(function () {
          $(this).closest('.ui.checkbox').toggleClass('checked', this.checked);
        });
      } else {
        $input.closest('.ui.checkbox').toggleClass('checked', this.checked);
      }
    });
    $('#mh-journal-reset-filters').on('click', resetFilters);
    $('#mh-journal-probes input').on('change', function () {
      state.showProbes = $(this).prop('checked');
      renderJournal();
    });
    $('#mh-journal-banner').on('click', '[data-action="banner-fix"]', function () {
      var bot = botById($(this).data('bot-id'));
      if (bot) {
        openBotModal('edit', bot);
      } else {
        openBotModal('add', null, 'telegram');
      }
    });
    $('#mh-journal-retry').on('click', function () {
      load();
    });
    $('#mh-journal-prev').on('click', function () {
      if (state.offset >= PAGE_LIMIT) {
        state.offset -= PAGE_LIMIT;
        load();
      }
    });
    $('#mh-journal-next').on('click', function () {
      if (state.offset + state.lastItems.length < state.total) {
        state.offset += PAGE_LIMIT;
        load();
      }
    });
    $('#mh-retention-input').on('change', saveRetention);
    $('#mh-public-url-input').on('change', savePublicUrl);
    $('#mh-proxy-input').on('change', saveProxy);
    $('#mh-max-ca-input').on('change', saveMaxCaBundle);
    $('#mh-config-quiet-input').on('change', function () {
      saveNumberSetting('config_change_quiet_sec', '#mh-config-quiet-input', '#mh-config-quiet-field', 10, 3600);
    });
    $('#mh-external-ip-input').on('change', function () {
      saveNumberSetting('external_ip_poll_min', '#mh-external-ip-input', '#mh-external-ip-field', 5, 1440);
    });
    $('#mh-license-hours-input').on('change', function () {
      saveNumberSetting('license_poll_hours', '#mh-license-hours-input', '#mh-license-hours-field', 1, 168);
    });
    $('#mh-license-days-input').on('change', saveLicenseWarnDays);
    $('#mh-mask-default input').on('change', saveMaskDefault);
    $('#mh-queue-min-wait-input').on('change', saveQueueMinWait);
    $('#mh-queue-long-wait-input').on('change', saveQueueLongWait);
    $('#mh-toll-prefixes-input').on('change', function () {
      saveSecurityPrefixes('#mh-toll-prefixes-input', '#mh-toll-prefixes-field', 'toll_fraud_prefixes');
    });
    $('#mh-toll-home-input').on('change', function () {
      saveSecurityPrefixes('#mh-toll-home-input', '#mh-toll-home-field', 'toll_fraud_home_prefixes');
    });
    $('#mh-toll-burst-input').on('change', function () {
      saveSecurityInt('#mh-toll-burst-input', '#mh-toll-burst-field', 'toll_fraud_burst_calls', 2, 1000);
    });
    $('#mh-toll-window-input').on('change', function () {
      saveSecurityInt('#mh-toll-window-input', '#mh-toll-window-field', 'toll_fraud_burst_window_min', 1, 1440);
    });
    $('#mh-toll-from-input').on('change', function () {
      saveSecurityTime('#mh-toll-from-input', '#mh-toll-from-field', 'toll_fraud_offhours_from');
    });
    $('#mh-toll-to-input').on('change', function () {
      saveSecurityTime('#mh-toll-to-input', '#mh-toll-to-field', 'toll_fraud_offhours_to');
    });
    $('#mh-toll-offhours input').on('change', saveTollOffHours);
    $('#mh-authfail-threshold-input').on('change', function () {
      saveSecurityInt('#mh-authfail-threshold-input', '#mh-authfail-threshold-field', 'sip_authfail_threshold', 1, 1000);
    });
    $('#mh-authfail-window-input').on('change', function () {
      saveSecurityInt('#mh-authfail-window-input', '#mh-authfail-window-field', 'sip_authfail_window_min', 1, 1440);
    });
    $('#mh-authfail-quiet-input').on('change', function () {
      saveSecurityInt('#mh-authfail-quiet-input', '#mh-authfail-quiet-field', 'sip_authfail_quiet_min', 5, 1440);
    });
    $('#mh-authfail-perpoll-input').on('change', function () {
      saveSecurityInt('#mh-authfail-perpoll-input', '#mh-authfail-perpoll-field', 'sip_authfail_extensions_per_poll', 5, 200);
    });
    bindBotsContainer();
    bindChatFound();
    bindRulesContainer();
    bindWizardControls();
    $('#mh-bot-add').on('click', function () {
      openBotModal('add', null, 'telegram');
    });
    $('#mh-bot-check, #mh-bot-check-stored, #mh-bot-check-new').on('click', checkBotForm);
    $('#mh-bot-token-replace').on('click', function () {
      $('#mh-bot-token-new-row').removeAttr('hidden');
      $('#mh-bot-token-new').trigger('focus');
    });
    $('#mh-bot-token-cancel').on('click', function () {
      $('#mh-bot-token-new').val('');
      $('#mh-bot-token-new-row').attr('hidden', true);
    });
    $('#mh-bot-save').on('click', saveBotForm);
    $('#mh-bot-modal').on('click', '.mh-channel-card', function (event) {
      event.preventDefault();
      if (!state.botModal || $(this).hasClass('is-disabled')) {
        return;
      }
      state.botModal.channel = String($(this).data('channel'));
      $('#mh-bot-check-message').empty();
      syncBotChannel();
    });
    $('#mh-bot-delete').on('click', confirmDeleteBot);
    $('#mh-bot-modal [data-action="cancel"]').on('click', cancelBotModal);
    $('#mh-chat-stop').on('click', stopDiscoveryAndClose);
    $('#mh-chat-again').on('click', function () {
      if (state.chatModal) {
        startDiscovery(state.chatModal.botId, true);
      }
    });
    $('#mh-chat-save').on('click', saveSelectedChats);
    $('#mh-chat-modal [data-action="cancel"]').on('click', stopDiscoveryAndClose);
    $('#mh-test-modal [data-action="cancel"]').on('click', function () {
      stopTestPoll();
      $('#mh-test-modal').modal('hide');
    });
    $('#mh-confirm-modal [data-action="cancel"]').on('click', function () {
      $('#mh-confirm-modal').modal('hide');
    });
    loadCatalog(function () {
      buildTypeMenu();
      loadEmployees(function () {});
      loadProviders(function () {});
      loadBots(true);
      loadRules();
      load();
    });
    scheduleRefresh();
  });
})();
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sInNvdXJjZXMiOlsibW9kdWxlLW1lc3Nlbmdlci1odWItaW5kZXguanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyogTW9kdWxlTWVzc2VuZ2VySHViIGFkbWluIHBhZ2U6IG5vdGlmaWNhdGlvbnMsIHdpemFyZCwgam91cm5hbCBhbmQgc2V0dGluZ3MgKGRlc2lnbiB2MywgZG9jcy9kZXNpZ24vTW9kdWxlTWVzc2VuZ2VySHViLXYzLmh0bWwpLlxuICogRGF0YSBjb21lcyBvbmx5IGZyb20gdGhlIG1vZHVsZSBSRVNUIHJlc291cmNlcyAoc2V0dGluZ3MsIGV2ZW50cywgYm90cywgcnVsZXMpIGFuZCBDb3JlIHYzIGxpc3RzLiBObyBleHRlcm5hbCBDRE5zLlxuICogV3JpdHRlbiBpbiBwbGFpbiBFUzUgKHRhcmdldHMgQ2hyb21lIDUwIC8gRmlyZWZveCA0NSAvIElFMTEgYWZ0ZXIgdGhlIEJhYmVsIHBhc3MpLlxuICovXG4oZnVuY3Rpb24gKCkge1xuICAgICd1c2Ugc3RyaWN0JztcblxuICAgIHZhciBBUElfQkFTRSA9ICcvcGJ4Y29yZS9hcGkvdjMvbW9kdWxlLW1lc3Nlbmdlci1odWInO1xuICAgIHZhciBQQUdFX0xJTUlUID0gNTA7XG4gICAgdmFyIFJFRlJFU0hfU0VDID0gMzA7XG4gICAgdmFyIEdST1VQX09SREVSID0gWydjYWxscycsICdhaV9zdXBlcnZpc29yJywgJ3NwZWVjaF9haScsICd2b2ljZV9hZ2VudCcsICdwYngnLCAnc2VjdXJpdHknXTtcblxuICAgIHZhciBJQ09OX0VSUk9SID0gJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjxjaXJjbGUgY3g9XCI4XCIgY3k9XCI4XCIgcj1cIjYuMjVcIi8+PHBhdGggZD1cIk02IDZsNCA0TTEwIDZsLTQgNFwiLz48L3N2Zz4nO1xuICAgIHZhciBJQ09OX0NIRVZST04gPSAnPHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+PHBhdGggZD1cIk02IDMuNUwxMC41IDggNiAxMi41XCIvPjwvc3ZnPic7XG4gICAgdmFyIElDT05fUExVUyA9ICc8c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBhcmlhLWhpZGRlbj1cInRydWVcIj48cGF0aCBkPVwiTTggM3YxME0zIDhoMTBcIi8+PC9zdmc+JztcblxuICAgIHZhciByb290ID0gbnVsbDtcbiAgICB2YXIgc3RhdGUgPSB7XG4gICAgICAgIHNvdXJjZXM6IFtdLFxuICAgICAgICBwZXJpb2Q6ICd0b2RheScsXG4gICAgICAgIGV2ZW50VHlwZTogJycsXG4gICAgICAgIG9mZnNldDogMCxcbiAgICAgICAgdG90YWw6IDAsXG4gICAgICAgIGhhc0xvYWRlZDogZmFsc2UsXG4gICAgICAgIGxhc3RJdGVtczogW10sXG4gICAgICAgIGNhbGxiYWNrczoge30sXG4gICAgICAgIGV4cGFuZGVkSWQ6IG51bGwsXG4gICAgICAgIGxvYWRTZXE6IDAsXG4gICAgICAgIHJldGVudGlvbjogMzAsXG4gICAgICAgIHNldHRpbmdzOiBudWxsLFxuICAgICAgICBib3RzOiBbXSxcbiAgICAgICAgYm90c0xvYWRlZDogZmFsc2UsXG4gICAgICAgIGJvdHNFcnJvcjogbnVsbCxcbiAgICAgICAgZXhwYW5kZWRCb3RzOiB7fSxcbiAgICAgICAgZW1wbG95ZWVzOiBbXSxcbiAgICAgICAgZW1wbG95ZWVzTG9hZGVkOiBmYWxzZSxcbiAgICAgICAgZW1wbG95ZWVzRmFpbGVkOiBmYWxzZSxcbiAgICAgICAgc2hvd1Byb2JlczogZmFsc2UsXG4gICAgICAgIGJvdE1vZGFsOiBudWxsLFxuICAgICAgICBjaGF0TW9kYWw6IG51bGwsXG4gICAgICAgIHRlc3RNb2RhbDogbnVsbCxcbiAgICAgICAgcnVsZXM6IFtdLFxuICAgICAgICBydWxlc0xvYWRlZDogZmFsc2UsXG4gICAgICAgIHJ1bGVzRXJyb3I6IG51bGwsXG4gICAgICAgIHByb3ZpZGVyczogW10sXG4gICAgICAgIHByb3ZpZGVyc0xvYWRlZDogZmFsc2UsXG4gICAgICAgIHJ1bGVXaXphcmQ6IG51bGxcbiAgICB9O1xuXG4gICAgLy8gLS0tLS0tLS0tLSBpMThuIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIHQoa2V5KSB7XG4gICAgICAgIGlmICh0eXBlb2YgZ2xvYmFsVHJhbnNsYXRlICE9PSAndW5kZWZpbmVkJyAmJiBnbG9iYWxUcmFuc2xhdGVba2V5XSkge1xuICAgICAgICAgICAgcmV0dXJuIGdsb2JhbFRyYW5zbGF0ZVtrZXldO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBrZXk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdGYoa2V5LCBwYXJhbXMpIHtcbiAgICAgICAgdmFyIHRleHQgPSB0KGtleSk7XG4gICAgICAgIE9iamVjdC5rZXlzKHBhcmFtcyB8fCB7fSkuZm9yRWFjaChmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgdGV4dCA9IHRleHQuc3BsaXQoJ3snICsgbmFtZSArICd9Jykuam9pbihTdHJpbmcocGFyYW1zW25hbWVdKSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdGV4dDtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIHNtYWxsIGhlbHBlcnMgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gcGFkKHZhbHVlKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZSA8IDEwID8gJzAnICsgdmFsdWUgOiBTdHJpbmcodmFsdWUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZtdFRpbWUodHMpIHtcbiAgICAgICAgdmFyIGQgPSBuZXcgRGF0ZSh0cyAqIDEwMDApO1xuICAgICAgICByZXR1cm4gcGFkKGQuZ2V0SG91cnMoKSkgKyAnOicgKyBwYWQoZC5nZXRNaW51dGVzKCkpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZtdERhdGUodHMpIHtcbiAgICAgICAgdmFyIGQgPSBuZXcgRGF0ZSh0cyAqIDEwMDApO1xuICAgICAgICByZXR1cm4gcGFkKGQuZ2V0RGF0ZSgpKSArICcuJyArIHBhZChkLmdldE1vbnRoKCkgKyAxKSArICcuJyArIGQuZ2V0RnVsbFllYXIoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmbXREYXRlVGltZSh0cykge1xuICAgICAgICByZXR1cm4gZm10RGF0ZSh0cykgKyAnICcgKyBmbXRUaW1lKHRzKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBpc1RvZGF5KHRzKSB7XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgdmFyIG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgICAgIHJldHVybiBkLnRvRGF0ZVN0cmluZygpID09PSBub3cudG9EYXRlU3RyaW5nKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNZZXN0ZXJkYXkodHMpIHtcbiAgICAgICAgdmFyIGQgPSBuZXcgRGF0ZSh0cyAqIDEwMDApO1xuICAgICAgICB2YXIgeWVzdGVyZGF5ID0gbmV3IERhdGUoRGF0ZS5ub3coKSAtIDg2NDAwMDAwKTtcbiAgICAgICAgcmV0dXJuIGQudG9EYXRlU3RyaW5nKCkgPT09IHllc3RlcmRheS50b0RhdGVTdHJpbmcoKTtcbiAgICB9XG5cbiAgICAvLyBPbmUgbGluZSBpbiBhIDQ4IHB4IHJvdzogwqsxODozNMK7LCDCq9Cy0YfQtdGA0LAgMTg6MzTCuywgwqsxMi4xMCAxODozNMK7LlxuICAgIGZ1bmN0aW9uIGZtdENlbGxUaW1lKHRzKSB7XG4gICAgICAgIGlmIChpc1RvZGF5KHRzKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZtdFRpbWUodHMpO1xuICAgICAgICB9XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgdmFyIGRheSA9IGlzWWVzdGVyZGF5KHRzKSA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1RpbWVZZXN0ZXJkYXknKSA6IHBhZChkLmdldERhdGUoKSkgKyAnLicgKyBwYWQoZC5nZXRNb250aCgpICsgMSk7XG4gICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1tdXRlZFwiPicgKyBlc2MoZGF5KSArICc8L3NwYW4+ICcgKyBmbXRUaW1lKHRzKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBlc2ModmFsdWUpIHtcbiAgICAgICAgcmV0dXJuICQoJzxkaXYvPicpLnRleHQoU3RyaW5nKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgPyAnJyA6IHZhbHVlKSkuaHRtbCgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHN0YXJ0T2ZUb2RheSgpIHtcbiAgICAgICAgdmFyIGQgPSBuZXcgRGF0ZSgpO1xuICAgICAgICBkLnNldEhvdXJzKDAsIDAsIDAsIDApO1xuICAgICAgICByZXR1cm4gTWF0aC5mbG9vcihkLmdldFRpbWUoKSAvIDEwMDApO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHBlcmlvZEJvdW5kcygpIHtcbiAgICAgICAgdmFyIG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xuICAgICAgICB2YXIgdG9kYXlTdGFydCA9IHN0YXJ0T2ZUb2RheSgpO1xuICAgICAgICBzd2l0Y2ggKHN0YXRlLnBlcmlvZCkge1xuICAgICAgICAgICAgY2FzZSAndG9kYXknOiByZXR1cm4geyBmcm9tOiB0b2RheVN0YXJ0LCB0bzogbm93IH07XG4gICAgICAgICAgICBjYXNlICd5ZXN0ZXJkYXknOiByZXR1cm4geyBmcm9tOiB0b2RheVN0YXJ0IC0gODY0MDAsIHRvOiB0b2RheVN0YXJ0IC0gMSB9O1xuICAgICAgICAgICAgY2FzZSAnN2RheXMnOiByZXR1cm4geyBmcm9tOiB0b2RheVN0YXJ0IC0gNiAqIDg2NDAwLCB0bzogbm93IH07XG4gICAgICAgICAgICBjYXNlICczMGRheXMnOiByZXR1cm4geyBmcm9tOiB0b2RheVN0YXJ0IC0gMjkgKiA4NjQwMCwgdG86IG5vdyB9O1xuICAgICAgICAgICAgZGVmYXVsdDogcmV0dXJuIHsgZnJvbTogMCwgdG86IDAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gQVBJIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGFwaUdldChwYXRoLCBwYXJhbXMsIG9uU3VjY2Vzcywgb25GYWlsdXJlKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IENvbmZpZy5wYnhVcmwgKyBBUElfQkFTRSArIHBhdGgsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YTogcGFyYW1zIHx8IHt9LFxuICAgICAgICAgICAgY2FjaGU6IGZhbHNlXG4gICAgICAgIH0pLmRvbmUoZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2UucmVzdWx0ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgb25TdWNjZXNzKHJlc3BvbnNlLmRhdGEpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBvbkZhaWx1cmUobm9ybWFsaXplRmFpbHVyZShyZXNwb25zZSwgMjAwKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLmZhaWwoZnVuY3Rpb24gKHhocikge1xuICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUobnVsbCwgeGhyLnN0YXR1cykpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBhcGlQYXRjaChwYXRoLCBwYXlsb2FkLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBDb25maWcucGJ4VXJsICsgQVBJX0JBU0UgKyBwYXRoLFxuICAgICAgICAgICAgbWV0aG9kOiAnUEFUQ0gnLFxuICAgICAgICAgICAgZGF0YTogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXG4gICAgICAgICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJ1xuICAgICAgICB9KS5kb25lKGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlICYmIHJlc3BvbnNlLnJlc3VsdCA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgIG9uU3VjY2VzcyhyZXNwb25zZS5kYXRhKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUocmVzcG9uc2UsIDIwMCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KS5mYWlsKGZ1bmN0aW9uICh4aHIpIHtcbiAgICAgICAgICAgIG9uRmFpbHVyZShub3JtYWxpemVGYWlsdXJlKG51bGwsIHhoci5zdGF0dXMpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbm9ybWFsaXplRmFpbHVyZShyZXNwb25zZSwgc3RhdHVzKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXM6IHN0YXR1cyxcbiAgICAgICAgICAgIGVycm9yOiAocmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YSAmJiByZXNwb25zZS5kYXRhLmVycm9yKSB8fCAnaHR0cF8nICsgc3RhdHVzLFxuICAgICAgICAgICAgbWVzc2FnZXM6IChyZXNwb25zZSAmJiByZXNwb25zZS5tZXNzYWdlcyAmJiByZXNwb25zZS5tZXNzYWdlcy5lcnJvcikgfHwgW11cbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIHNvdXJjZSBjYXRhbG9nIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGxvYWRDYXRhbG9nKGRvbmUpIHtcbiAgICAgICAgYXBpR2V0KCcvc2V0dGluZ3M6Z2V0U291cmNlcycsIHt9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgc3RhdGUuc291cmNlcyA9IGRhdGEuaXRlbXMgfHwgW107XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLnNvdXJjZXMgPSBbXTtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc291cmNlQnlJZChpZCkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLnNvdXJjZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5zb3VyY2VzW2ldLmlkID09PSBpZCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzdGF0ZS5zb3VyY2VzW2ldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGV2ZW50VHlwZU5hbWVzKCkge1xuICAgICAgICB2YXIgbmFtZXMgPSB7fTtcbiAgICAgICAgc3RhdGUuc291cmNlcy5mb3JFYWNoKGZ1bmN0aW9uIChzb3VyY2UpIHtcbiAgICAgICAgICAgIChzb3VyY2UuZXZlbnRfdHlwZXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24gKHR5cGUpIHtcbiAgICAgICAgICAgICAgICBuYW1lc1t0eXBlLnR5cGVdID0gdHlwZS5uYW1lO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gbmFtZXM7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiBmaWx0ZXJzIChkZXNpZ24gdjM6IHBlcmlvZCBhbmQgZXZlbnQgb25seSkgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gYnVpbGRUeXBlTWVudSgpIHtcbiAgICAgICAgdmFyIG5hbWVzID0gZXZlbnRUeXBlTmFtZXMoKTtcbiAgICAgICAgdmFyIGl0ZW1zID0gW107XG4gICAgICAgIEdST1VQX09SREVSLmZvckVhY2goZnVuY3Rpb24gKGdyb3VwKSB7XG4gICAgICAgICAgICB2YXIgaW5Hcm91cCA9IFtdO1xuICAgICAgICAgICAgc3RhdGUuc291cmNlcy5mb3JFYWNoKGZ1bmN0aW9uIChzb3VyY2UpIHtcbiAgICAgICAgICAgICAgICBpZiAoc291cmNlLmdyb3VwICE9PSBncm91cCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIChzb3VyY2UuZXZlbnRfdHlwZXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24gKHR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgaW5Hcm91cC5wdXNoKHsgdmFsdWU6IHR5cGUudHlwZSwgdGV4dDogbmFtZXNbdHlwZS50eXBlXSB8fCB0eXBlLnR5cGUgfSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGlmIChpbkdyb3VwLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBpdGVtcy5wdXNoKHsgZ3JvdXA6IHNvdXJjZUdyb3VwTmFtZShncm91cCkgfSk7XG4gICAgICAgICAgICAgICAgaW5Hcm91cC5mb3JFYWNoKGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgICAgICAgICAgICAgIGl0ZW1zLnB1c2goaXRlbSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1maWx0ZXJzIC5taC1maWx0ZXItdHlwZScpLmRyb3Bkb3duKHtcbiAgICAgICAgICAgIHZhbHVlczogbWVudVRvVmFsdWVzKGl0ZW1zKSxcbiAgICAgICAgICAgIHBsYWNlaG9sZGVyOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9GaWx0ZXJBbGxUeXBlcycpLFxuICAgICAgICAgICAgb25DaGFuZ2U6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgIHN0YXRlLmV2ZW50VHlwZSA9IFN0cmluZyh2YWx1ZSB8fCAnJyk7XG4gICAgICAgICAgICAgICAgcmVsb2FkKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1lbnVUb1ZhbHVlcyhpdGVtcykge1xuICAgICAgICByZXR1cm4gaXRlbXMubWFwKGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgICAgICBpZiAoaXRlbS5ncm91cCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB7IHR5cGU6ICdoZWFkZXInLCBuYW1lOiBpdGVtLmdyb3VwIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4geyBuYW1lOiBpdGVtLnRleHQsIHZhbHVlOiBpdGVtLnZhbHVlIH07XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNvdXJjZUdyb3VwTmFtZShncm91cCkge1xuICAgICAgICB2YXIga2V5ID0ge1xuICAgICAgICAgICAgY2FsbHM6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Hcm91cENhbGxzJyxcbiAgICAgICAgICAgIGFpX3N1cGVydmlzb3I6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Hcm91cEFpU3VwZXJ2aXNvcicsXG4gICAgICAgICAgICBzcGVlY2hfYWk6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Hcm91cFNwZWVjaEFpJyxcbiAgICAgICAgICAgIHZvaWNlX2FnZW50OiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfR3JvdXBWb2ljZUFnZW50JyxcbiAgICAgICAgICAgIHBieDogJ21vZHVsZV9tZXNzZW5nZXJfaHViX0dyb3VwUGJ4JyxcbiAgICAgICAgICAgIHNlY3VyaXR5OiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfR3JvdXBTZWN1cml0eSdcbiAgICAgICAgfVtncm91cF0gfHwgZ3JvdXA7XG4gICAgICAgIHJldHVybiB0KGtleSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBtb2R1bGUgc3RhdHVzIGV2ZW50cyAoc3RhZ2UgM2IpOiBodW1hbiB3b3JkcyBmb3IgKGNvZGUsIHJlZiksIHJhdyBjb2RlcyBvbmx5IGluIGEgdG9vbHRpcCAtLS0tLS0tLS0tXG5cbiAgICB2YXIgU1RBVFVTX1JFQ09WRVJZX0tFWVMgPSB7XG4gICAgICAgICdsb2NhbF9zdHQud29ya2VyX29ubGluZSc6ICdNZXNzYWdlU3RhdHVzV29ya2VyT25saW5lJyxcbiAgICAgICAgJ2xvY2FsX3N0dC5iYWNrbG9nX3Jlc29sdmVkJzogJ01lc3NhZ2VTdGF0dXNCYWNrbG9nUmVzb2x2ZWQnLFxuICAgICAgICAnY2xvdWRfc3R0LmluY2lkZW50X3Jlc29sdmVkJzogJ01lc3NhZ2VTdGF0dXNJbmNpZGVudFJlc29sdmVkJyxcbiAgICAgICAgJ2Nsb3VkX3N0dC5yZXN1bWVkJzogJ01lc3NhZ2VTdGF0dXNSZXN1bWVkJyxcbiAgICAgICAgJ2Nsb3VkX2FpLnJlc3VtZWQnOiAnTWVzc2FnZVN0YXR1c0Nsb3VkQWlSZXN1bWVkJyxcbiAgICAgICAgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29ubGluZSc6ICdNZXNzYWdlU3RhdHVzV29ya2VyT25saW5lJ1xuICAgIH07XG4gICAgdmFyIFNUQVRVU19DT0RFX0tFWVMgPSB7XG4gICAgICAgIHdvcmtlcl9vZmZsaW5lOiAnTWVzc2FnZVN0YXR1c1dvcmtlck9mZmxpbmUnLFxuICAgICAgICBiYWNrbG9nX25vX3dvcmtlcnM6ICdNZXNzYWdlU3RhdHVzQmFja2xvZycsXG4gICAgICAgIGluY2lkZW50X29wZW46ICdNZXNzYWdlU3RhdHVzSW5jaWRlbnQnXG4gICAgfTtcbiAgICB2YXIgU1RBVFVTX1BBVVNFX0tFWVMgPSB7XG4gICAgICAgIHVzZXI6ICdNZXNzYWdlU3RhdHVzUGF1c2VkVXNlcicsXG4gICAgICAgIG1haW50ZW5hbmNlOiAnTWVzc2FnZVN0YXR1c1BhdXNlZE1haW50ZW5hbmNlJyxcbiAgICAgICAgcmVjb3ZlcnlfYmxvY2tlZDogJ01lc3NhZ2VTdGF0dXNQYXVzZWRSZWNvdmVyeUJsb2NrZWQnLFxuICAgICAgICBtYW51YWw6ICdNZXNzYWdlU3RhdHVzQ2xvdWRBaU1hbnVhbCcsXG4gICAgICAgIGxpY2Vuc2VfbWlzc2luZzogJ01lc3NhZ2VTdGF0dXNDbG91ZEFpTGljZW5zZScsXG4gICAgICAgIGF1dGhfaW52YWxpZDogJ01lc3NhZ2VTdGF0dXNDbG91ZEFpQXV0aCcsXG4gICAgICAgIG1vZGVsX3VuYXZhaWxhYmxlOiAnTWVzc2FnZVN0YXR1c0Nsb3VkQWlNb2RlbCcsXG4gICAgICAgIGRhaWx5X2xpbWl0X3JlYWNoZWQ6ICdNZXNzYWdlU3RhdHVzQ2xvdWRBaURhaWx5TGltaXQnLFxuICAgICAgICBzb3VyY2VfdW5hdmFpbGFibGU6ICdNZXNzYWdlU3RhdHVzQ2xvdWRBaVNvdXJjZVVuYXZhaWxhYmxlJyxcbiAgICAgICAgaW5zdWZmaWNpZW50X2Z1bmRzOiAnTWVzc2FnZVN0YXR1c0Nsb3VkQWlJbnN1ZmZpY2llbnRGdW5kcycsXG4gICAgICAgIGxvd19iYWxhbmNlOiAnTWVzc2FnZVN0YXR1c0Nsb3VkQWlMb3dCYWxhbmNlJ1xuICAgIH07XG5cbiAgICAvLyBQcm9ibGVtIGV2ZW50IHR5cGUgLT4gaXRzIHJlY292ZXJ5IHR5cGUuIEEgc3RhdHVzIHNjZW5hcmlvIGlzIGFsd2F5cyBvbmUgcGFpcjsgwqvQodC+0L7QsdGJ0LDRgtGMINC+INCy0L7RgdGB0YLQsNC90L7QstC70LXQvdC40LjCu1xuICAgIC8vIGlzIHRoZSByZWNvdmVyeSB0eXBlIGJlaW5nIGluIHRoZSBydWxlJ3MgZXZlbnRfdHlwZXMgKG5vIHNlcGFyYXRlIHN0b3JhZ2UpLlxuICAgIHZhciBTVEFUVVNfUEFJUlMgPSB7XG4gICAgICAgICdsb2NhbF9zdHQud29ya2VyX29mZmxpbmUnOiAnbG9jYWxfc3R0Lndvcmtlcl9vbmxpbmUnLFxuICAgICAgICAnbG9jYWxfc3R0LmJhY2tsb2dfbm9fd29ya2Vycyc6ICdsb2NhbF9zdHQuYmFja2xvZ19yZXNvbHZlZCcsXG4gICAgICAgICdjbG91ZF9zdHQuaW5jaWRlbnQnOiAnY2xvdWRfc3R0LmluY2lkZW50X3Jlc29sdmVkJyxcbiAgICAgICAgJ2Nsb3VkX3N0dC5wYXVzZWQnOiAnY2xvdWRfc3R0LnJlc3VtZWQnLFxuICAgICAgICAnY2xvdWRfYWkucGF1c2VkJzogJ2Nsb3VkX2FpLnJlc3VtZWQnLFxuICAgICAgICAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb2ZmbGluZSc6ICdhaV9zdXBlcnZpc29yLndvcmtlcl9vbmxpbmUnXG4gICAgfTtcbiAgICAvLyBDbG91ZCBBSSBwYXVzZSByZWFzb25zIGJ5IGdyb3VwIChydWxlIGZpbHRlciBgcmVhc29uc2ApOyBub3RfY29uZmlndXJlZCBuZXZlciBwcm9kdWNlcyBldmVudHMuXG4gICAgdmFyIENMT1VEX0FJX1JFQVNPTl9HUk9VUFMgPSBbXG4gICAgICAgIFsnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUmVhc29uR3JvdXBNb25leScsIFsnaW5zdWZmaWNpZW50X2Z1bmRzJywgJ2xvd19iYWxhbmNlJ11dLFxuICAgICAgICBbJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFJlYXNvbkdyb3VwTGljZW5zZScsIFsnbGljZW5zZV9taXNzaW5nJywgJ2F1dGhfaW52YWxpZCddXSxcbiAgICAgICAgWydtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRSZWFzb25Hcm91cExpbWl0cycsIFsnZGFpbHlfbGltaXRfcmVhY2hlZCcsICdtb2RlbF91bmF2YWlsYWJsZSddXSxcbiAgICAgICAgWydtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRSZWFzb25Hcm91cFNvdXJjZScsIFsnc291cmNlX3VuYXZhaWxhYmxlJ11dLFxuICAgICAgICBbJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFJlYXNvbkdyb3VwTWFudWFsJywgWydtYW51YWwnXV1cbiAgICBdO1xuXG4gICAgZnVuY3Rpb24gY2xvdWRBaVJlYXNvbnMoaW5jbHVkZU1hbnVhbCkge1xuICAgICAgICB2YXIgcmVhc29ucyA9IFtdO1xuICAgICAgICBDTE9VRF9BSV9SRUFTT05fR1JPVVBTLmZvckVhY2goZnVuY3Rpb24gKGdyb3VwKSB7XG4gICAgICAgICAgICBncm91cFsxXS5mb3JFYWNoKGZ1bmN0aW9uIChyZWFzb24pIHtcbiAgICAgICAgICAgICAgICBpZiAoaW5jbHVkZU1hbnVhbCB8fCByZWFzb24gIT09ICdtYW51YWwnKSB7IHJlYXNvbnMucHVzaChyZWFzb24pOyB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiByZWFzb25zO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1vZHVsZVN0YXR1c09mKGl0ZW0pIHtcbiAgICAgICAgdmFyIHN1YmplY3QgPSBpdGVtICYmIGl0ZW0ucGF5bG9hZCAmJiBpdGVtLnBheWxvYWQuc3ViamVjdCA/IGl0ZW0ucGF5bG9hZC5zdWJqZWN0IDoge307XG4gICAgICAgIHJldHVybiBzdWJqZWN0Lm1vZHVsZV9zdGF0dXMgJiYgdHlwZW9mIHN1YmplY3QubW9kdWxlX3N0YXR1cyA9PT0gJ29iamVjdCcgPyBzdWJqZWN0Lm1vZHVsZV9zdGF0dXMgOiBudWxsO1xuICAgIH1cblxuICAgIC8qKiBPbmUgc2VudGVuY2UgZm9yIGFuIGV2ZW50IHR5cGUgKyAoY29kZSwgcmVmKTsgYW4gdW5rbm93biBwYWlyIGdldHMgYSBuZXV0cmFsIGxpbmUsIG5ldmVyIHRoZSByYXcgY29kZS4gKi9cbiAgICBmdW5jdGlvbiBzdGF0dXNQaHJhc2UoZXZlbnRUeXBlLCBzdGF0dXMpIHtcbiAgICAgICAgdmFyIGNvZGUgPSBTdHJpbmcoKHN0YXR1cyAmJiBzdGF0dXMuY29kZSkgfHwgJycpO1xuICAgICAgICB2YXIgcmVmID0gU3RyaW5nKChzdGF0dXMgJiYgc3RhdHVzLnJlZikgfHwgJycpO1xuICAgICAgICB2YXIga2V5ID0gU1RBVFVTX1JFQ09WRVJZX0tFWVNbZXZlbnRUeXBlXVxuICAgICAgICAgICAgfHwgKGNvZGUgPT09ICdwcm9jZXNzaW5nX3BhdXNlZCcgPyBTVEFUVVNfUEFVU0VfS0VZU1tyZWZdIDogbnVsbClcbiAgICAgICAgICAgIHx8IFNUQVRVU19DT0RFX0tFWVNbY29kZV1cbiAgICAgICAgICAgIHx8ICdNZXNzYWdlU3RhdHVzVW5rbm93bic7XG4gICAgICAgIHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl8nICsga2V5KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzdGF0dXNDb3VudGVyTm90ZXMoc3RhdHVzKSB7XG4gICAgICAgIHZhciBjb3VudGVycyA9IHN0YXR1cyAmJiBzdGF0dXMuY291bnRlcnMgPyBzdGF0dXMuY291bnRlcnMgOiB7fTtcbiAgICAgICAgdmFyIG5vdGVzID0gW107XG4gICAgICAgIGlmICh0eXBlb2YgY291bnRlcnMud29ya2Vyc19vbmxpbmUgPT09ICdudW1iZXInICYmIHR5cGVvZiBjb3VudGVycy53b3JrZXJzX3RvdGFsID09PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgbm90ZXMucHVzaCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZVN0YXR1c1dvcmtlcnNDb3VudGVycycsIHsgb25saW5lOiBjb3VudGVycy53b3JrZXJzX29ubGluZSwgdG90YWw6IGNvdW50ZXJzLndvcmtlcnNfdG90YWwgfSkpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0eXBlb2YgY291bnRlcnMuam9ic193YWl0aW5nID09PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgbm90ZXMucHVzaCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZVN0YXR1c0pvYnNXYWl0aW5nJywgeyBjb3VudDogY291bnRlcnMuam9ic193YWl0aW5nIH0pKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodHlwZW9mIGNvdW50ZXJzLmluY2lkZW50c19vcGVuID09PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgbm90ZXMucHVzaCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZVN0YXR1c0luY2lkZW50c09wZW4nLCB7IGNvdW50OiBjb3VudGVycy5pbmNpZGVudHNfb3BlbiB9KSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG5vdGVzO1xuICAgIH1cblxuICAgIC8qKiBUZWNobmljYWwgdG9vbHRpcDogdGhlIHJhdyBjb2RlIGFuZCByZWZlcmVuY2Ugb2YgdGhlIG1vZHVsZSBzdGF0dXMsIG5ldmVyIHRoZSBtYWluIHRleHQuICovXG4gICAgZnVuY3Rpb24gc3RhdHVzUmF3Q29kZShpdGVtKSB7XG4gICAgICAgIHZhciBzdGF0dXMgPSBtb2R1bGVTdGF0dXNPZihpdGVtKTtcbiAgICAgICAgaWYgKCFzdGF0dXMgfHwgIXN0YXR1cy5jb2RlKSB7XG4gICAgICAgICAgICByZXR1cm4gJyc7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFN0cmluZyhzdGF0dXMuY29kZSkgKyAoc3RhdHVzLnJlZiA/ICc6JyArIHN0YXR1cy5yZWYgOiAnJyk7XG4gICAgfVxuXG4gICAgLyoqIEluZm9ybWF0aW9uYWwgc3RhdGUgb2YgYSBzb3VyY2Ugd2hvc2UgbW9kdWxlIGNhbm5vdCBiZSByZWFkIChubyBhY3Rpb24gYnV0dG9ucywgZGVjaXNpb24gUTE0KS4gKi9cbiAgICBmdW5jdGlvbiBzb3VyY2VTdGF0ZVRleHQoc291cmNlKSB7XG4gICAgICAgIHN3aXRjaCAoc291cmNlLmF2YWlsYWJpbGl0eSkge1xuICAgICAgICAgICAgY2FzZSAnbW9kdWxlX21pc3NpbmcnOlxuICAgICAgICAgICAgICAgIHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Tb3VyY2VTdGF0ZU5vaW5zdCcpO1xuICAgICAgICAgICAgY2FzZSAnbW9kdWxlX2Rpc2FibGVkJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU291cmNlU3RhdGVNb2RvZmYnKTtcbiAgICAgICAgICAgIGNhc2UgJ2FwaV9mb3JiaWRkZW4nOlxuICAgICAgICAgICAgICAgIHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Ob3RpZlNvdXJjZU5vQWNjZXNzJyk7XG4gICAgICAgICAgICBjYXNlICdhcGlfaW5jb21wYXRpYmxlJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gc291cmNlLnVwZGF0ZV90b1xuICAgICAgICAgICAgICAgICAgICA/IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Tb3VyY2VTdGF0ZU91dGRhdGVkVG8nLCB7IHZlcnNpb246IHNvdXJjZS51cGRhdGVfdG8gfSlcbiAgICAgICAgICAgICAgICAgICAgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Tb3VyY2VTdGF0ZU91dGRhdGVkQW55Jyk7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIHJldHVybiBzb3VyY2UuYXZhaWxhYmlsaXR5X25hbWUgfHwgJyc7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBidWlsZFBlcmlvZE1lbnUoKSB7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLWZpbHRlcnMgLm1oLWZpbHRlci1wZXJpb2QnKS5kcm9wZG93bih7XG4gICAgICAgICAgICB2YWx1ZXM6IFtcbiAgICAgICAgICAgICAgICB7IG5hbWU6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1BlcmlvZFRvZGF5JyksIHZhbHVlOiAndG9kYXknLCBzZWxlY3RlZDogdHJ1ZSB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUGVyaW9kWWVzdGVyZGF5JyksIHZhbHVlOiAneWVzdGVyZGF5JyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUGVyaW9kN0RheXMnKSwgdmFsdWU6ICc3ZGF5cycgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1BlcmlvZDMwRGF5cycpLCB2YWx1ZTogJzMwZGF5cycgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1BlcmlvZEFsbCcpLCB2YWx1ZTogJ2FsbCcgfVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIG9uQ2hhbmdlOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5wZXJpb2QgPSBTdHJpbmcodmFsdWUgfHwgJ2FsbCcpO1xuICAgICAgICAgICAgICAgIHJlbG9hZCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZXNldEZpbHRlcnMoKSB7XG4gICAgICAgIHN0YXRlLmV2ZW50VHlwZSA9ICcnO1xuICAgICAgICBzdGF0ZS5wZXJpb2QgPSAndG9kYXknO1xuICAgICAgICBzdGF0ZS5vZmZzZXQgPSAwO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1maWx0ZXJzIC5taC1maWx0ZXItdHlwZScpLmRyb3Bkb3duKCdjbGVhcicpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1maWx0ZXJzIC5taC1maWx0ZXItcGVyaW9kJykuZHJvcGRvd24oJ3NldCBzZWxlY3RlZCcsICd0b2RheScpO1xuICAgICAgICByZWxvYWQoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmaWx0ZXJzQWN0aXZlKCkge1xuICAgICAgICAvLyB0aGUgZGVmYXVsdCBwZXJpb2QgKMKr0KHQtdCz0L7QtNC90Y/CuykgaXMgbm90IGEgZmlsdGVyOiBhbiBlbXB0eSBsb2cgc2hvd3MgwqvQodC+0LHRi9GC0LjQuSDQvdC10YLCu1xuICAgICAgICByZXR1cm4gc3RhdGUuZXZlbnRUeXBlICE9PSAnJyB8fCBzdGF0ZS5wZXJpb2QgIT09ICd0b2RheSc7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiBsb2FkaW5nIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIHJlbG9hZCgpIHtcbiAgICAgICAgc3RhdGUub2Zmc2V0ID0gMDtcbiAgICAgICAgbG9hZCgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGxvYWQob3B0aW9ucykge1xuICAgICAgICB2YXIgc2VxID0gKytzdGF0ZS5sb2FkU2VxO1xuICAgICAgICB2YXIgYm91bmRzID0gcGVyaW9kQm91bmRzKCk7XG4gICAgICAgIHZhciBpc1JlZnJlc2ggPSBvcHRpb25zICYmIG9wdGlvbnMucmVmcmVzaCA9PT0gdHJ1ZTtcbiAgICAgICAgdmFyIHBhcmFtcyA9IHtcbiAgICAgICAgICAgIGxpbWl0OiBQQUdFX0xJTUlULFxuICAgICAgICAgICAgb2Zmc2V0OiBzdGF0ZS5vZmZzZXRcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKHN0YXRlLmV2ZW50VHlwZSAhPT0gJycpIHsgcGFyYW1zLmV2ZW50X3R5cGUgPSBzdGF0ZS5ldmVudFR5cGU7IH1cbiAgICAgICAgaWYgKGJvdW5kcy5mcm9tID4gMCkgeyBwYXJhbXMuZGF0ZV9mcm9tID0gYm91bmRzLmZyb207IH1cbiAgICAgICAgaWYgKGJvdW5kcy50byA+IDApIHsgcGFyYW1zLmRhdGVfdG8gPSBib3VuZHMudG87IH1cblxuICAgICAgICBzZXRKb3VybmFsQnVzeSh0cnVlLCBpc1JlZnJlc2gpO1xuICAgICAgICBhcGlHZXQoJy9ldmVudHMnLCBwYXJhbXMsIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICBpZiAoc2VxICE9PSBzdGF0ZS5sb2FkU2VxKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuOyAvLyBhIG5ld2VyIHJlcXVlc3QgYWxyZWFkeSBhbnN3ZXJlZFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3RhdGUudG90YWwgPSBkYXRhLnBhZ2luYXRpb24gPyBkYXRhLnBhZ2luYXRpb24udG90YWwgOiAwO1xuICAgICAgICAgICAgc3RhdGUubGFzdEl0ZW1zID0gZGF0YS5pdGVtcyB8fCBbXTtcbiAgICAgICAgICAgIHN0YXRlLmhhc0xvYWRlZCA9IHRydWU7XG4gICAgICAgICAgICBzZXRKb3VybmFsQnVzeShmYWxzZSwgaXNSZWZyZXNoKTtcbiAgICAgICAgICAgIHJlbmRlckpvdXJuYWwoKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgIGlmIChzZXEgIT09IHN0YXRlLmxvYWRTZXEpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzZXRKb3VybmFsQnVzeShmYWxzZSwgaXNSZWZyZXNoKTtcbiAgICAgICAgICAgIHJlbmRlckxvYWRFcnJvcihmYWlsdXJlKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGxvYWRKb3VybmFsQmFkZ2UoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzZXRKb3VybmFsQnVzeShidXN5LCBpc1JlZnJlc2gpIHtcbiAgICAgICAgdmFyICR0YWJsZSA9ICQoJyNtaC1qb3VybmFsLXRhYmxlIHRhYmxlJyk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXRhYmxlJykuYXR0cignYXJpYS1idXN5JywgYnVzeSA/ICd0cnVlJyA6ICdmYWxzZScpO1xuICAgICAgICAkdGFibGUudG9nZ2xlQ2xhc3MoJ2lzLXJlZnJlc2hpbmcnLCBCb29sZWFuKGJ1c3kgJiYgaXNSZWZyZXNoKSk7XG4gICAgICAgIGlmICghaXNSZWZyZXNoKSB7XG4gICAgICAgICAgICBpZiAoYnVzeSkge1xuICAgICAgICAgICAgICAgIHJlbmRlclNrZWxldG9uKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvcicpLmVtcHR5KCk7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvci1wbGFjZWhvbGRlcicpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gam91cm5hbFRhYmxlSGVhZCgpIHtcbiAgICAgICAgcmV0dXJuICc8Y29sZ3JvdXA+PGNvbCBzdHlsZT1cIndpZHRoOjM2cHhcIj48Y29sIHN0eWxlPVwid2lkdGg6MTA0cHhcIj48Y29sIHN0eWxlPVwid2lkdGg6MjQwcHhcIj48Y29sPjxjb2wgc3R5bGU9XCJ3aWR0aDoxNjBweFwiPjwvY29sZ3JvdXA+J1xuICAgICAgICAgICAgKyAnPHRoZWFkPjx0cj48dGg+PC90aD4nXG4gICAgICAgICAgICArICc8dGg+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db2x1bW5UaW1lJykpICsgJzwvdGg+J1xuICAgICAgICAgICAgKyAnPHRoPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29sdW1uRXZlbnQnKSkgKyAnPC90aD4nXG4gICAgICAgICAgICArICc8dGg+PC90aD4nXG4gICAgICAgICAgICArICc8dGg+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db2x1bW5EZWxpdmVyeScpKSArICc8L3RoPidcbiAgICAgICAgICAgICsgJzwvdHI+PC90aGVhZD4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlclNrZWxldG9uKCkge1xuICAgICAgICB2YXIgcm93cyA9ICcnO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IDM7IGkrKykge1xuICAgICAgICAgICAgcm93cyArPSAnPHRyIGNsYXNzPVwibWgtc2tlbC1yb3dcIj48dGQ+PC90ZD48dGQ+PHNwYW4gY2xhc3M9XCJtaC1za2VsXCIgc3R5bGU9XCJ3aWR0aDozNnB4XCI+PC9zcGFuPjwvdGQ+J1xuICAgICAgICAgICAgICAgICsgJzx0ZD48c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjE2MHB4XCI+PC9zcGFuPjwvdGQ+J1xuICAgICAgICAgICAgICAgICsgJzx0ZD48c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjcwJVwiPjwvc3Bhbj48L3RkPidcbiAgICAgICAgICAgICAgICArICc8dGQ+PHNwYW4gY2xhc3M9XCJtaC1za2VsXCIgc3R5bGU9XCJ3aWR0aDo5NnB4O2hlaWdodDoyMHB4O2JvcmRlci1yYWRpdXM6NXB4XCI+PC9zcGFuPjwvdGQ+PC90cj4nO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXRhYmxlJykuaHRtbCgnPGRpdiBjbGFzcz1cIm1oLXRhYmxlLXdyYXBcIj48dGFibGUgY2xhc3M9XCJ1aSB0YWJsZSBtaC1qb3VybmFsLXRhYmxlXCIgYXJpYS1idXN5PVwidHJ1ZVwiPidcbiAgICAgICAgICAgICsgam91cm5hbFRhYmxlSGVhZCgpICsgJzx0Ym9keT4nICsgcm93cyArICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+Jyk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiBkaXNwbGF5IHJ1bGVzIChwcm9iZXMgaGlkZGVuLCBjYWxsYmFja3MgZm9sZGVkIGludG8gdGhlIG1pc3NlZCBjYWxsKSAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBpc1Byb2JlKGl0ZW0pIHtcbiAgICAgICAgcmV0dXJuIEJvb2xlYW4oaXRlbSAmJiBpdGVtLnBheWxvYWQgJiYgaXRlbS5wYXlsb2FkLnByb2JlID09PSB0cnVlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjYWxsYmFja0luZGV4KGl0ZW1zKSB7XG4gICAgICAgIHZhciBpbmRleCA9IHt9O1xuICAgICAgICAoaXRlbXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgICAgIGlmIChpdGVtLmV2ZW50X3R5cGUgIT09ICdjb3JlLm1pc3NlZF9jYWxsX3Jlc29sdmVkJykge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBjYWxsID0gKGl0ZW0ucGF5bG9hZCAmJiBpdGVtLnBheWxvYWQuc3ViamVjdCAmJiBpdGVtLnBheWxvYWQuc3ViamVjdC5jYWxsKSB8fCB7fTtcbiAgICAgICAgICAgIGlmIChjYWxsLm1pc3NlZF9saW5rZWRpZCAmJiAhaW5kZXhbY2FsbC5taXNzZWRfbGlua2VkaWRdKSB7XG4gICAgICAgICAgICAgICAgaW5kZXhbY2FsbC5taXNzZWRfbGlua2VkaWRdID0gaXRlbS5vY2N1cnJlZF9hdDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBpbmRleDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjYWxsYmFja1RpbWUoaXRlbSkge1xuICAgICAgICB2YXIgY2FsbCA9IChpdGVtLnBheWxvYWQgJiYgaXRlbS5wYXlsb2FkLnN1YmplY3QgJiYgaXRlbS5wYXlsb2FkLnN1YmplY3QuY2FsbCkgfHwge307XG4gICAgICAgIGlmIChjYWxsLmxpbmtlZGlkICYmIHN0YXRlLmNhbGxiYWNrc1tjYWxsLmxpbmtlZGlkXSkge1xuICAgICAgICAgICAgcmV0dXJuIHN0YXRlLmNhbGxiYWNrc1tjYWxsLmxpbmtlZGlkXTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcmVzb2x2ZWQgPSAwO1xuICAgICAgICAoaXRlbS5kZWxpdmVyaWVzIHx8IFtdKS5mb3JFYWNoKGZ1bmN0aW9uIChkZWxpdmVyeSkge1xuICAgICAgICAgICAgaWYgKGRlbGl2ZXJ5LnJlc29sdmVkX2F0ICYmIChyZXNvbHZlZCA9PT0gMCB8fCBkZWxpdmVyeS5yZXNvbHZlZF9hdCA8IHJlc29sdmVkKSkge1xuICAgICAgICAgICAgICAgIHJlc29sdmVkID0gZGVsaXZlcnkucmVzb2x2ZWRfYXQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcmVzb2x2ZWQ7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdmlzaWJsZUpvdXJuYWxJdGVtcygpIHtcbiAgICAgICAgc3RhdGUuY2FsbGJhY2tzID0gY2FsbGJhY2tJbmRleChzdGF0ZS5sYXN0SXRlbXMpO1xuICAgICAgICByZXR1cm4gc3RhdGUubGFzdEl0ZW1zLmZpbHRlcihmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICAgICAgaWYgKGl0ZW0uZXZlbnRfdHlwZSA9PT0gJ2NvcmUubWlzc2VkX2NhbGxfcmVzb2x2ZWQnKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHN0YXRlLnNob3dQcm9iZXMgfHwgIWlzUHJvYmUoaXRlbSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckpvdXJuYWwoKSB7XG4gICAgICAgIGhpZGVKb3VybmFsU3RhdGVzKCk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLWVycm9yJykuZW1wdHkoKTtcbiAgICAgICAgcmVuZGVySm91cm5hbEJhbm5lcigpO1xuICAgICAgICB2YXIgaXRlbXMgPSB2aXNpYmxlSm91cm5hbEl0ZW1zKCk7XG5cbiAgICAgICAgaWYgKGl0ZW1zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgaWYgKGZpbHRlcnNBY3RpdmUoKSkge1xuICAgICAgICAgICAgICAgICQoJyNtaC1qb3VybmFsLWVtcHR5LWZpbHRlcmVkJykucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICQoJyNtaC1qb3VybmFsLWVtcHR5JykucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmVtcHR5KCk7XG4gICAgICAgICAgICByZW5kZXJQYWdlcigpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG5hbWVzID0gZXZlbnRUeXBlTmFtZXMoKTtcbiAgICAgICAgaWYgKCFuYW1lc1snaHViLnRlc3QnXSkge1xuICAgICAgICAgICAgbmFtZXNbJ2h1Yi50ZXN0J10gPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9FdmVudFR5cGVUZXN0Jyk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHJvd3MgPSAnJztcbiAgICAgICAgaXRlbXMuZm9yRWFjaChmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICAgICAgcm93cyArPSByZW5kZXJSb3coaXRlbSwgbmFtZXNbaXRlbS5ldmVudF90eXBlXSB8fCBpdGVtLmV2ZW50X3R5cGUpO1xuICAgICAgICAgICAgaWYgKHN0YXRlLmV4cGFuZGVkSWQgPT09IGl0ZW0uaWQpIHtcbiAgICAgICAgICAgICAgICByb3dzICs9IHJlbmRlckRldGFpbFJvdyhpdGVtKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXRhYmxlJykuaHRtbCgnPGRpdiBjbGFzcz1cIm1oLXRhYmxlLXdyYXBcIj48dGFibGUgY2xhc3M9XCJ1aSBzZWxlY3RhYmxlIHRhYmxlIG1oLWpvdXJuYWwtdGFibGVcIj4nXG4gICAgICAgICAgICArIGpvdXJuYWxUYWJsZUhlYWQoKSArICc8dGJvZHk+JyArIHJvd3MgKyAnPC90Ym9keT48L3RhYmxlPjwvZGl2PicpO1xuXG4gICAgICAgICQoJyNtaC1qb3VybmFsLXRhYmxlIHRib2R5IHRyLm1oLWV2ZW50LXJvdycpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHRvZ2dsZVJvdygkKHRoaXMpLmRhdGEoJ2lkJykpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtdGFibGUnKS5vZmYoJ2NsaWNrLnJldHJ5Jykub24oJ2NsaWNrLnJldHJ5JywgJ1tkYXRhLWFjdGlvbj1cInJldHJ5LWV2ZW50XCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICAgIHZhciBldmVudElkID0gJCh0aGlzKS5kYXRhKCdldmVudC1pZCcpO1xuICAgICAgICAgICAgdmFyICRidXR0b24gPSAkKHRoaXMpLnByb3AoJ2Rpc2FibGVkJywgdHJ1ZSk7XG4gICAgICAgICAgICBhcGlQb3N0KCcvZXZlbnRzLycgKyBldmVudElkICsgJzpyZXRyeScsIHt9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlSZXRyaWVkJywgeyBjb3VudDogZGF0YS5yZXRyaWVkIHx8IDAgfSkpO1xuICAgICAgICAgICAgICAgIGxvYWQoKTtcbiAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICAgICAgJGJ1dHRvbi5wcm9wKCdkaXNhYmxlZCcsIGZhbHNlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QoZmFpbHVyZVRleHQoZmFpbHVyZSkpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJlbmRlclBhZ2VyKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaGlkZUpvdXJuYWxTdGF0ZXMoKSB7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLWVtcHR5JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLWVtcHR5LWZpbHRlcmVkJykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLWVycm9yLXBsYWNlaG9sZGVyJykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyTG9hZEVycm9yKGZhaWx1cmUpIHtcbiAgICAgICAgdmFyIGhpbnQgPSB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uTG9hZEVycm9yJywge1xuICAgICAgICAgICAgd2hhdDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfTG9hZFdoYXRFdmVudHMnKSxcbiAgICAgICAgICAgIGNvZGU6IGZhaWx1cmUuc3RhdHVzID4gMCA/IGZhaWx1cmUuc3RhdHVzIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uVGltZW91dCcpXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoc3RhdGUuaGFzTG9hZGVkICYmIHN0YXRlLmxhc3RJdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAvLyBkYXRhIGlzIGFscmVhZHkgb24gdGhlIHNjcmVlbjoga2VlcCB0aGUgdGFibGUsIHNob3cgYSBiYW5uZXIgYWJvdmUgaXRcbiAgICAgICAgICAgICQoJyNtaC1qb3VybmFsLWVycm9yJykuaHRtbChcbiAgICAgICAgICAgICAgICAnPGRpdiBjbGFzcz1cInVpIG5lZ2F0aXZlIG1lc3NhZ2VcIiByb2xlPVwiYWxlcnRcIj4nICsgSUNPTl9FUlJPUlxuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ncm93XCI+JyArIGVzYyhoaW50KSArICc8L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAnPGJ1dHRvbiBjbGFzcz1cInVpIGJhc2ljIGJ1dHRvbiBtaC1vbi1tZXNzYWdlXCIgdHlwZT1cImJ1dHRvblwiIGlkPVwibWgtam91cm5hbC1yZXRyeS1pbmxpbmVcIj4nXG4gICAgICAgICAgICAgICAgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uUmV0cnknKSkgKyAnPC9idXR0b24+PC9kaXY+J1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICQoJyNtaC1qb3VybmFsLXJldHJ5LWlubGluZScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHsgbG9hZCgpOyB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICQoJyNtaC1qb3VybmFsLXRhYmxlJykuZW1wdHkoKTtcbiAgICAgICAgICAgICQoJyNtaC1qb3VybmFsLXBhZ2VyJykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvci1wbGFjZWhvbGRlci1oaW50JykudGV4dChoaW50KTtcbiAgICAgICAgICAgICQoJyNtaC1qb3VybmFsLWVycm9yLXBsYWNlaG9sZGVyJykucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGpvdXJuYWw6IHByb2JsZW0gYmFubmVyIGFuZCB0aGUgdW5kZWxpdmVyZWQgY291bnRlciBvbiB0aGUgdGFiIC0tLS0tLS0tLS1cblxuICAgIC8vIE9uZSByZWQgbGluZSBhYm92ZSB0aGUgdGFibGUgaW5zdGVhZCBvZiDCq9CR0L7RgiDRg9C00LDQu9GR0L3CuyBpbiBldmVyeSByb3cgKGRlc2lnbiB2MywgwqvQltGD0YDQvdCw0LvCuykuXG4gICAgZnVuY3Rpb24gYm90UHJvYmxlbSgpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5ib3RzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgYm90ID0gc3RhdGUuYm90c1tpXTtcbiAgICAgICAgICAgIGlmIChib3QuZW5hYmxlZCAhPT0gZmFsc2UgJiYgYm90LnN0YXR1cyA9PT0gJ3Rva2VuX2ludmFsaWQnKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgdGV4dDogdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0Jhbm5lclRva2VuSW52YWxpZCcsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJvdDogYm90LmJvdF91c2VybmFtZSA/ICdAJyArIGJvdC5ib3RfdXNlcm5hbWUgOiAnwqsnICsgYm90LnRpdGxlICsgJ8K7J1xuICAgICAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgICAgICAgYm90SWQ6IE51bWJlcihib3QuaWQpXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICAvLyBhIGRlbGV0ZWQgYm90IGlzIG9ubHkgdmlzaWJsZSB0aHJvdWdoIGl0cyBmYWlsZWQgZGVsaXZlcmllcyAodGhlIGJvdCByb3cgaXMgZ29uZSlcbiAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBzdGF0ZS5sYXN0SXRlbXMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICAgIHZhciBkZWxpdmVyaWVzID0gc3RhdGUubGFzdEl0ZW1zW2pdLmRlbGl2ZXJpZXMgfHwgW107XG4gICAgICAgICAgICBmb3IgKHZhciBrID0gMDsgayA8IGRlbGl2ZXJpZXMubGVuZ3RoOyBrKyspIHtcbiAgICAgICAgICAgICAgICBpZiAoZGVsaXZlcmllc1trXS5ib3RfZGVsZXRlZCAmJiBpc0ZhaWxlZERlbGl2ZXJ5KGRlbGl2ZXJpZXNba10pKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7IHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0Jhbm5lckJvdERlbGV0ZWQnKSwgYm90SWQ6IDAgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVySm91cm5hbEJhbm5lcigpIHtcbiAgICAgICAgdmFyIHByb2JsZW0gPSBzdGF0ZS5ib3RzTG9hZGVkID8gYm90UHJvYmxlbSgpIDogbnVsbDtcbiAgICAgICAgaWYgKHByb2JsZW0gPT09IG51bGwpIHtcbiAgICAgICAgICAgICQoJyNtaC1qb3VybmFsLWJhbm5lcicpLmVtcHR5KCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLWpvdXJuYWwtYmFubmVyJykuaHRtbCgnPGRpdiBjbGFzcz1cInVpIG5lZ2F0aXZlIG1lc3NhZ2UgbWgtYmFubmVyXCIgcm9sZT1cImFsZXJ0XCI+JyArIElDT05fRVJST1JcbiAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ncm93XCI+JyArIGVzYyhwcm9ibGVtLnRleHQpICsgJzwvZGl2PidcbiAgICAgICAgICAgICsgJzxidXR0b24gY2xhc3M9XCJ1aSBiYXNpYyBidXR0b24gbWgtb24tbWVzc2FnZVwiIHR5cGU9XCJidXR0b25cIiBkYXRhLWFjdGlvbj1cImJhbm5lci1maXhcIiBkYXRhLWJvdC1pZD1cIicgKyBwcm9ibGVtLmJvdElkICsgJ1wiPidcbiAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0Jhbm5lckNvbm5lY3QnKSkgKyAnPC9idXR0b24+PC9kaXY+Jyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNGYWlsZWREZWxpdmVyeShkZWxpdmVyeSkge1xuICAgICAgICByZXR1cm4gZGVsaXZlcnkuc3RhdHVzID09PSAnZmFpbGVkJyB8fCBkZWxpdmVyeS5zdGF0dXMgPT09ICdkcm9wcGVkJztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBpc1VuZGVsaXZlcmVkKGl0ZW0pIHtcbiAgICAgICAgcmV0dXJuIChpdGVtLmRlbGl2ZXJpZXMgfHwgW10pLnNvbWUoaXNGYWlsZWREZWxpdmVyeSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbG9hZEpvdXJuYWxCYWRnZSgpIHtcbiAgICAgICAgYXBpR2V0KCcvZXZlbnRzJywgeyBkYXRlX2Zyb206IHN0YXJ0T2ZUb2RheSgpLCBsaW1pdDogMjAwIH0sIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICB2YXIgY291bnQgPSAoZGF0YS5pdGVtcyB8fCBbXSkuZmlsdGVyKGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICFpc1Byb2JlKGl0ZW0pICYmIGlzVW5kZWxpdmVyZWQoaXRlbSk7XG4gICAgICAgICAgICB9KS5sZW5ndGg7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1iYWRnZScpLnRleHQoY291bnQgPiA5OSA/ICc5OSsnIDogU3RyaW5nKGNvdW50KSlcbiAgICAgICAgICAgICAgICAuYXR0cignYXJpYS1sYWJlbCcsIHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Kb3VybmFsQmFkZ2VMYWJlbCcsIHsgY291bnQ6IGNvdW50IH0pKVxuICAgICAgICAgICAgICAgIC5hdHRyKCdoaWRkZW4nLCBjb3VudCA+IDAgPyBudWxsIDogdHJ1ZSk7XG4gICAgICAgIH0sIGZ1bmN0aW9uICgpIHt9KTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGpvdXJuYWw6IHJvd3MgLS0tLS0tLS0tLVxuXG4gICAgLy8gQXJlYSBjb2RlIG9mIGEgY29uZmlndXJhdGlvbi1jaGFuZ2UgZXZlbnQgPT4gaXRzIGNhdGFsb2cga2V5IChzYW1lIG1hcCBhcyBDb25maWdDaGFuZ2VUZW1wbGF0ZSkuXG4gICAgdmFyIENPTkZJR19BUkVBX0tFWVMgPSB7XG4gICAgICAgIHJvdXRpbmc6ICdDb25maWdBcmVhUm91dGluZycsXG4gICAgICAgIHByb3ZpZGVyczogJ0NvbmZpZ0FyZWFQcm92aWRlcnMnLFxuICAgICAgICBleHRlbnNpb25zOiAnQ29uZmlnQXJlYUV4dGVuc2lvbnMnLFxuICAgICAgICBlbXBsb3llZXM6ICdDb25maWdBcmVhRW1wbG95ZWVzJyxcbiAgICAgICAgc2VydmljZXM6ICdDb25maWdBcmVhU2VydmljZXMnLFxuICAgICAgICBtZWRpYTogJ0NvbmZpZ0FyZWFNZWRpYScsXG4gICAgICAgIHNjaGVkdWxlOiAnQ29uZmlnQXJlYVNjaGVkdWxlJyxcbiAgICAgICAgbmV0d29yazogJ0NvbmZpZ0FyZWFOZXR3b3JrJyxcbiAgICAgICAgZmlyZXdhbGw6ICdDb25maWdBcmVhRmlyZXdhbGwnLFxuICAgICAgICBzdG9yYWdlOiAnQ29uZmlnQXJlYVN0b3JhZ2UnLFxuICAgICAgICBhcGlfa2V5czogJ0NvbmZpZ0FyZWFBcGlLZXlzJyxcbiAgICAgICAgbW9kdWxlczogJ0NvbmZpZ0FyZWFNb2R1bGVzJyxcbiAgICAgICAgc2V0dGluZ3M6ICdDb25maWdBcmVhU2V0dGluZ3MnLFxuICAgICAgICBvdGhlcjogJ0NvbmZpZ0FyZWFPdGhlcidcbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gYnJpZWZGb3IoaXRlbSkge1xuICAgICAgICB2YXIgc3ViamVjdCA9IGl0ZW0ucGF5bG9hZCAmJiBpdGVtLnBheWxvYWQuc3ViamVjdCA/IGl0ZW0ucGF5bG9hZC5zdWJqZWN0IDoge307XG4gICAgICAgIHZhciBmYWN0cyA9IGl0ZW0ucGF5bG9hZCAmJiBpdGVtLnBheWxvYWQuZmFjdHMgPyBpdGVtLnBheWxvYWQuZmFjdHMgOiB7fTtcbiAgICAgICAgc3dpdGNoIChpdGVtLmV2ZW50X3R5cGUpIHtcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUubWlzc2VkX2NhbGwnOlxuICAgICAgICAgICAgY2FzZSAndm9pY2VfYWdlbnQuY2FsbGJhY2tfcmVxdWVzdCc6XG4gICAgICAgICAgICAgICAgdmFyIGVtcGxveWVlcyA9IChzdWJqZWN0LmVtcGxveWVlcyB8fCBbXSkubWFwKHNob3J0RW1wbG95ZWUpLmpvaW4oJywgJyk7XG4gICAgICAgICAgICAgICAgdmFyIGNsaWVudCA9IHN1YmplY3QuY2xpZW50X251bWJlciB8fCAnJztcbiAgICAgICAgICAgICAgICBpZiAoY2xpZW50ICE9PSAnJyAmJiBlbXBsb3llZXMgIT09ICcnKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBjbGllbnQgKyAnIOKGkiAnICsgZW1wbG95ZWVzO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gY2xpZW50ICE9PSAnJyA/IGNsaWVudCA6IGVtcGxveWVlcztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUucXVldWVfYWJhbmRvbmVkJzpcbiAgICAgICAgICAgICAgICB2YXIgcXVldWVDYWxsID0gc3ViamVjdC5jYWxsIHx8IHt9O1xuICAgICAgICAgICAgICAgIHZhciBxdWV1ZVRleHQgPSBxdWV1ZUxhYmVsKHF1ZXVlQ2FsbCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHF1ZXVlVGV4dCAhPT0gJycgPyBxdWV1ZVRleHQgOiBTdHJpbmcoc3ViamVjdC5jbGllbnRfbnVtYmVyIHx8ICcnKTtcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUuY2FsbF9vdXRfb2ZfaG91cnMnOlxuICAgICAgICAgICAgICAgIHJldHVybiBTdHJpbmcoc3ViamVjdC5jbGllbnRfbnVtYmVyIHx8IChzdWJqZWN0LmNhbGwgJiYgc3ViamVjdC5jYWxsLmRpZCkgfHwgJycpO1xuICAgICAgICAgICAgY2FzZSAnY29yZS5wYXJrX3RpbWVvdXQnOlxuICAgICAgICAgICAgICAgIHZhciBwYXJrQ2FsbCA9IHN1YmplY3QuY2FsbCB8fCB7fTtcbiAgICAgICAgICAgICAgICB2YXIgcGFya1RleHQgPSBwYXJrQ2FsbC5wYXJrX3Nsb3QgPyB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZVBhcmtTbG90JywgeyBzbG90OiBwYXJrQ2FsbC5wYXJrX3Nsb3QgfSkgOiAnJztcbiAgICAgICAgICAgICAgICB2YXIgcGFya0NsaWVudCA9IFN0cmluZyhzdWJqZWN0LmNsaWVudF9udW1iZXIgfHwgJycpO1xuICAgICAgICAgICAgICAgIGlmIChwYXJrVGV4dCAhPT0gJycgJiYgcGFya0NsaWVudCAhPT0gJycpIHsgcmV0dXJuIHBhcmtUZXh0ICsgJyDCtyAnICsgcGFya0NsaWVudDsgfVxuICAgICAgICAgICAgICAgIHJldHVybiBwYXJrVGV4dCAhPT0gJycgPyBwYXJrVGV4dCA6IHBhcmtDbGllbnQ7XG4gICAgICAgICAgICBjYXNlICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJzpcbiAgICAgICAgICAgICAgICBpZiAoZmFjdHMuc2NvcmVzICYmIGZhY3RzLnNjb3Jlcy5xdWFsaXR5ICE9PSBudWxsICYmIGZhY3RzLnNjb3Jlcy5xdWFsaXR5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9CcmllZlNjb3JlJywgeyBzY29yZTogZmFjdHMuc2NvcmVzLnF1YWxpdHkgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBmYWN0cy5zdW1tYXJ5IHx8IHN1YmplY3QuY2xpZW50X251bWJlciB8fCAnJztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUucHJvdmlkZXJfZG93bic6XG4gICAgICAgICAgICBjYXNlICdjb3JlLnByb3ZpZGVyX3VwJzpcbiAgICAgICAgICAgICAgICB2YXIgcHJvdmlkZXIgPSBzdWJqZWN0LnByb3ZpZGVyIHx8IHt9O1xuICAgICAgICAgICAgICAgIHJldHVybiBwcm92aWRlci51c2VybmFtZSA/ICdTSVAgwqsnICsgcHJvdmlkZXIudXNlcm5hbWUgKyAnwrsnIDogKHByb3ZpZGVyLmhvc3QgfHwgcHJvdmlkZXIuaWQgfHwgJycpO1xuICAgICAgICAgICAgY2FzZSAnY29yZS5hZHZpY2UnOlxuICAgICAgICAgICAgICAgIHJldHVybiBmYWN0cy5zdW1tYXJ5IHx8IGFkdmljZVRleHQoc3ViamVjdC5hZHZpY2UgfHwge30pO1xuICAgICAgICAgICAgY2FzZSAnY29yZS5jb25maWdfY2hhbmdlZCc6XG4gICAgICAgICAgICAgICAgdmFyIGNvbmZpZyA9IHN1YmplY3QuY29uZmlnIHx8IHt9O1xuICAgICAgICAgICAgICAgIHZhciBhcmVhTmFtZXMgPSAoY29uZmlnLmFyZWFzIHx8IFtdKS5tYXAoZnVuY3Rpb24gKGFyZWEpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViXycgKyAoQ09ORklHX0FSRUFfS0VZU1thcmVhLmFyZWFdIHx8ICdDb25maWdBcmVhT3RoZXInKSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgaWYgKGFyZWFOYW1lcy5sZW5ndGggPiAzKSB7XG4gICAgICAgICAgICAgICAgICAgIGFyZWFOYW1lcyA9IGFyZWFOYW1lcy5zbGljZSgwLCAzKS5jb25jYXQoWyfigKYnXSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBhcmVhTmFtZXMuam9pbignLCAnKTtcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUuZXh0ZXJuYWxfaXBfY2hhbmdlZCc6XG4gICAgICAgICAgICAgICAgdmFyIGlwQ2hhbmdlID0gc3ViamVjdC5leHRlcm5hbF9pcCB8fCB7fTtcbiAgICAgICAgICAgICAgICByZXR1cm4gaXBDaGFuZ2UubmV3ID8gKGlwQ2hhbmdlLm9sZCA/IGlwQ2hhbmdlLm9sZCArICcg4oaSICcgOiAnJykgKyBpcENoYW5nZS5uZXcgOiAnJztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUubGljZW5zZV9leHBpcmluZyc6XG4gICAgICAgICAgICAgICAgdmFyIGxpY2Vuc2UgPSBzdWJqZWN0LmxpY2Vuc2UgfHwge307XG4gICAgICAgICAgICAgICAgcmV0dXJuIChsaWNlbnNlLnByb2R1Y3QgfHwgJycpICsgKGxpY2Vuc2UuZXhwaXJ5ID8gJyDCtyAnICsgbGljZW5zZS5leHBpcnkgOiAnJyk7XG4gICAgICAgICAgICBjYXNlICdodWIudGVzdCc6XG4gICAgICAgICAgICAgICAgdmFyIHRlc3RTeXN0ZW0gPSBzdWJqZWN0LnN5c3RlbSB8fCB7fTtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGVzdFN5c3RlbS5ib3RfdGl0bGUgfHwgJyc7XG4gICAgICAgICAgICBjYXNlICdhaV9zdXBlcnZpc29yLndvcmtlcl9vZmZsaW5lJzpcbiAgICAgICAgICAgIGNhc2UgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29ubGluZSc6XG4gICAgICAgICAgICAgICAgaWYgKHN1YmplY3QubW9kdWxlX3N0YXR1cykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gc3RhdHVzUGhyYXNlKGl0ZW0uZXZlbnRfdHlwZSwgc3ViamVjdC5tb2R1bGVfc3RhdHVzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIChzdWJqZWN0LndvcmtlciAmJiBzdWJqZWN0Lndvcmtlci5uYW1lKSB8fCBmYWN0cy5zdW1tYXJ5IHx8ICcnO1xuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICBpZiAoc3ViamVjdC5tb2R1bGVfc3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBzdGF0dXNQaHJhc2UoaXRlbS5ldmVudF90eXBlLCBzdWJqZWN0Lm1vZHVsZV9zdGF0dXMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gZmFjdHMuc3VtbWFyeSB8fCAnJztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFwi0J/RgNC+0LTQsNC20LggKDgwMClcIiBmcm9tIGEgcXVldWUgZXZlbnQ7IHRoZSBxdWV1ZSBuYW1lIGlzIG9wdGlvbmFsIChDb3JlIENhbGxRdWV1ZXMgbWF5IGJlIGVtcHR5KS5cbiAgICBmdW5jdGlvbiBxdWV1ZUxhYmVsKGNhbGwpIHtcbiAgICAgICAgdmFyIG51bWJlciA9IFN0cmluZygoY2FsbCAmJiBjYWxsLnF1ZXVlX251bWJlcikgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgdmFyIG5hbWUgPSBTdHJpbmcoKGNhbGwgJiYgY2FsbC5xdWV1ZV9uYW1lKSB8fCAnJykudHJpbSgpO1xuICAgICAgICBpZiAobmFtZSA9PT0gJycpIHsgcmV0dXJuIG51bWJlcjsgfVxuICAgICAgICByZXR1cm4gbnVtYmVyID09PSAnJyA/IG5hbWUgOiBuYW1lICsgJyAoJyArIG51bWJlciArICcpJztcbiAgICB9XG5cbiAgICAvLyDCq9Cf0L7RgNGC0L3QvtCyINCQ0LvQtdC60YHQtdC5wrsgKDIwNCkg4oaSIMKr0J/QvtGA0YLQvdC+0LIg0JAuICgyMDQpwrssIGFzIGluIHRoZSBqb3VybmFsIG1vY2t1cFxuICAgIGZ1bmN0aW9uIHNob3J0RW1wbG95ZWUoZW1wbG95ZWUpIHtcbiAgICAgICAgdmFyIG5hbWUgPSBTdHJpbmcoZW1wbG95ZWUubmFtZSB8fCAnJykudHJpbSgpO1xuICAgICAgICB2YXIgcGFydHMgPSBuYW1lLnNwbGl0KC9cXHMrLyk7XG4gICAgICAgIGlmIChwYXJ0cy5sZW5ndGggPj0gMiAmJiBwYXJ0c1sxXSAhPT0gJycpIHtcbiAgICAgICAgICAgIG5hbWUgPSBwYXJ0c1swXSArICcgJyArIHBhcnRzWzFdLmNoYXJBdCgwKSArICcuJztcbiAgICAgICAgfVxuICAgICAgICBpZiAobmFtZSA9PT0gJycpIHtcbiAgICAgICAgICAgIHJldHVybiBTdHJpbmcoZW1wbG95ZWUubnVtYmVyIHx8ICcnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZW1wbG95ZWUubnVtYmVyID8gbmFtZSArICcgKCcgKyBlbXBsb3llZS5udW1iZXIgKyAnKScgOiBuYW1lO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZ1bGxFbXBsb3llZShlbXBsb3llZSkge1xuICAgICAgICByZXR1cm4gZW1wbG95ZWUubmFtZSA/IGVtcGxveWVlLm5hbWUgKyAoZW1wbG95ZWUubnVtYmVyID8gJyAoJyArIGVtcGxveWVlLm51bWJlciArICcpJyA6ICcnKSA6IFN0cmluZyhlbXBsb3llZS5udW1iZXIgfHwgJycpO1xuICAgIH1cblxuICAgIC8vIENvcmUgYWR2aWNlIHRleHQ6IHRoZSBhZG1pbiBjYWJpbmV0IGFscmVhZHkgaGFzIHRoZSBDb3JlIGNhdGFsb2cgaW4gZ2xvYmFsVHJhbnNsYXRlXG4gICAgLy8gKHRlbXBsYXRlcyBsaWtlIFwi4oCmIDxhIGhyZWY9JyV1cmwlJz4ldmVyJTwvYT5cIik7IHN1YnN0aXR1dGUgcGFyYW1zIGFuZCBkcm9wIHRoZSBtYXJrdXAgYXMgcGxhaW4gdGV4dC5cbiAgICBmdW5jdGlvbiBhZHZpY2VUZXh0KGFkdmljZSkge1xuICAgICAgICB2YXIgdHBsID0gKGFkdmljZSAmJiBhZHZpY2UubWVzc2FnZV90cGwpIHx8ICcnO1xuICAgICAgICB2YXIgdGV4dCA9IHQodHBsKTtcbiAgICAgICAgaWYgKHRwbCA9PT0gJycgfHwgdGV4dCA9PT0gdHBsKSB7XG4gICAgICAgICAgICByZXR1cm4gdHBsO1xuICAgICAgICB9XG4gICAgICAgIHZhciBwYXJhbXMgPSAoYWR2aWNlICYmIGFkdmljZS5wYXJhbXMpIHx8IHt9O1xuICAgICAgICBPYmplY3Qua2V5cyhwYXJhbXMpLmZvckVhY2goZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIHRleHQgPSB0ZXh0LnNwbGl0KCclJyArIG5hbWUgKyAnJScpLmpvaW4oU3RyaW5nKHBhcmFtc1tuYW1lXSkpO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gTmV2ZXIgcGFyc2UgYXMgSFRNTCAocGFyYW1zIG1heSBjYXJyeSB1c2VyLWVudGVyZWQgbmFtZXMpOiBzdHJpcCB0YWdzIGFzIHRleHQsIG91dHB1dCBpcyBlc2NhcGVkIGxhdGVyLlxuICAgICAgICByZXR1cm4gdGV4dC5yZXBsYWNlKC88W14+XSo+L2csICcnKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZuYnNwOy9nLCAnICcpLnJlcGxhY2UoLyZxdW90Oy9nLCAnXCInKS5yZXBsYWNlKC8mIzAzOTt8JiMzOTsvZywgXCInXCIpXG4gICAgICAgICAgICAucmVwbGFjZSgvJmx0Oy9nLCAnPCcpLnJlcGxhY2UoLyZndDsvZywgJz4nKS5yZXBsYWNlKC8mYW1wOy9nLCAnJicpXG4gICAgICAgICAgICAucmVwbGFjZSgvXFxzKy9nLCAnICcpLnRyaW0oKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJSb3coaXRlbSwgZXZlbnROYW1lKSB7XG4gICAgICAgIHZhciBwcm9iZSA9IGlzUHJvYmUoaXRlbSkgPyAnPHNwYW4gY2xhc3M9XCJtaC1wcm9iZVwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUHJvYmVUYWcnKSkgKyAnPC9zcGFuPicgOiAnJztcbiAgICAgICAgdmFyIGJyaWVmID0gYnJpZWZGb3IoaXRlbSk7XG4gICAgICAgIHZhciBleHBhbmRlZCA9IHN0YXRlLmV4cGFuZGVkSWQgPT09IGl0ZW0uaWQ7XG4gICAgICAgIHJldHVybiAnPHRyIGNsYXNzPVwibWgtZXZlbnQtcm93JyArIChleHBhbmRlZCA/ICcgYWN0aXZlJyA6ICcnKSArICdcIiBkYXRhLWlkPVwiJyArIGl0ZW0uaWQgKyAnXCIgYXJpYS1leHBhbmRlZD1cIicgKyAoZXhwYW5kZWQgPyAndHJ1ZScgOiAnZmFsc2UnKSArICdcIj4nXG4gICAgICAgICAgICArICc8dGQgY2xhc3M9XCJtaC1jaGV2cm9uLWNlbGxcIj4nICsgSUNPTl9DSEVWUk9OICsgJzwvdGQ+J1xuICAgICAgICAgICAgKyAnPHRkIGNsYXNzPVwibWgtY2VsbC10aW1lXCI+JyArIGZtdENlbGxUaW1lKGl0ZW0ub2NjdXJyZWRfYXQpICsgJzwvdGQ+J1xuICAgICAgICAgICAgKyAnPHRkPjxkaXYgY2xhc3M9XCJtaC1ldmVudC1jZWxsXCI+PHNwYW4gY2xhc3M9XCJtaC10cnVuY2F0ZVwiIHRpdGxlPVwiJyArIGVzYyhldmVudE5hbWUpICsgJ1wiPicgKyBlc2MoZXZlbnROYW1lKSArICc8L3NwYW4+JyArIHByb2JlICsgJzwvZGl2PjwvdGQ+J1xuICAgICAgICAgICAgKyAnPHRkIGNsYXNzPVwibWgtdHJ1bmNhdGUgbWgtbXV0ZWRcIiB0aXRsZT1cIicgKyBlc2Moc3RhdHVzUmF3Q29kZShpdGVtKSAhPT0gJycgPyBicmllZiArICcgKCcgKyBzdGF0dXNSYXdDb2RlKGl0ZW0pICsgJyknIDogYnJpZWYpICsgJ1wiPicgKyBlc2MoYnJpZWYpICsgJzwvdGQ+J1xuICAgICAgICAgICAgKyAnPHRkPicgKyBkZWxpdmVyeUNlbGwoaXRlbSkgKyAnPC90ZD4nXG4gICAgICAgICAgICArICc8L3RyPic7XG4gICAgfVxuXG4gICAgLy8gM+KAkzQgaHVtYW4gZmllbGRzOyB0ZWNobmljYWwgb25lcyAoZXZlbnQgdHlwZSwgY2FsbCBJRCwgc291cmNlKSBzdGF5IG91dCBvZiB0aGUgaW50ZXJmYWNlLlxuICAgIGZ1bmN0aW9uIGRldGFpbEZpZWxkcyhpdGVtKSB7XG4gICAgICAgIHZhciBzdWJqZWN0ID0gaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5zdWJqZWN0ID8gaXRlbS5wYXlsb2FkLnN1YmplY3QgOiB7fTtcbiAgICAgICAgdmFyIGZhY3RzID0gaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5mYWN0cyA/IGl0ZW0ucGF5bG9hZC5mYWN0cyA6IHt9O1xuICAgICAgICB2YXIgZmllbGRzID0gW107XG4gICAgICAgIHZhciBlbXBsb3llZXMgPSAoc3ViamVjdC5lbXBsb3llZXMgfHwgW10pLm1hcChmdWxsRW1wbG95ZWUpLmpvaW4oJywgJyk7XG4gICAgICAgIGlmIChlbXBsb3llZXMgIT09ICcnKSB7IGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxFbXBsb3llZScpLCBlbXBsb3llZXNdKTsgfVxuICAgICAgICBpZiAoc3ViamVjdC5jbGllbnRfbnVtYmVyKSB7IGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxDbGllbnQnKSwgc3ViamVjdC5jbGllbnRfbnVtYmVyXSk7IH1cbiAgICAgICAgaWYgKGl0ZW0uZXZlbnRfdHlwZSA9PT0gJ2NvcmUubWlzc2VkX2NhbGwnKSB7XG4gICAgICAgICAgICB2YXIgY2FsbGJhY2sgPSBjYWxsYmFja1RpbWUoaXRlbSk7XG4gICAgICAgICAgICBpZiAoY2FsbGJhY2sgPiAwKSB7XG4gICAgICAgICAgICAgICAgZmllbGRzLnB1c2goW3QoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RldGFpbENhbGxlZEJhY2snKSwgZm10Q2VsbFRleHQoY2FsbGJhY2spXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHByb3ZpZGVyID0gc3ViamVjdC5wcm92aWRlciB8fCB7fTtcbiAgICAgICAgaWYgKHByb3ZpZGVyLnVzZXJuYW1lIHx8IHByb3ZpZGVyLmhvc3QpIHtcbiAgICAgICAgICAgIGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxQcm92aWRlcicpLCAocHJvdmlkZXIudXNlcm5hbWUgfHwgJycpICsgKHByb3ZpZGVyLmhvc3QgPyAnIMK3ICcgKyBwcm92aWRlci5ob3N0IDogJycpXSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN1YmplY3QuYWR2aWNlICYmIHN1YmplY3QuYWR2aWNlLm1lc3NhZ2VfdHBsICYmICFmYWN0cy5zdW1tYXJ5KSB7XG4gICAgICAgICAgICBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsU3VtbWFyeScpLCBhZHZpY2VUZXh0KHN1YmplY3QuYWR2aWNlKV0pO1xuICAgICAgICB9XG4gICAgICAgIGlmIChmYWN0cy5zY29yZXMgJiYgZmFjdHMuc2NvcmVzLnF1YWxpdHkgIT09IG51bGwgJiYgZmFjdHMuc2NvcmVzLnF1YWxpdHkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZmllbGRzLnB1c2goW3QoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RldGFpbFNjb3JlJyksIGZhY3RzLnNjb3Jlcy5xdWFsaXR5XSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGZhY3RzLnN1bW1hcnkpIHsgZmllbGRzLnB1c2goW3QoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RldGFpbFN1bW1hcnknKSwgZmFjdHMuc3VtbWFyeV0pOyB9XG4gICAgICAgIGlmIChzdWJqZWN0Lm1vZHVsZV9zdGF0dXMpIHtcbiAgICAgICAgICAgIGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxTdW1tYXJ5JyksXG4gICAgICAgICAgICAgICAgW3N0YXR1c1BocmFzZShpdGVtLmV2ZW50X3R5cGUsIHN1YmplY3QubW9kdWxlX3N0YXR1cyldLmNvbmNhdChzdGF0dXNDb3VudGVyTm90ZXMoc3ViamVjdC5tb2R1bGVfc3RhdHVzKSkuam9pbignLiAnKV0pO1xuICAgICAgICB9XG4gICAgICAgIGlmICgoZmFjdHMucmVhc29ucyB8fCBbXSkubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgZmllbGRzLnB1c2goW3QoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RldGFpbFJlYXNvbnMnKSwgZmFjdHMucmVhc29ucy5qb2luKCc7ICcpXSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZpZWxkcztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmbXRDZWxsVGV4dCh0cykge1xuICAgICAgICBpZiAoaXNUb2RheSh0cykpIHtcbiAgICAgICAgICAgIHJldHVybiBmbXRUaW1lKHRzKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZm10RGF0ZSh0cykgKyAnICcgKyBmbXRUaW1lKHRzKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJEZXRhaWxSb3coaXRlbSkge1xuICAgICAgICB2YXIgaHRtbCA9ICc8ZGwgY2xhc3M9XCJtaC1maWVsZHNcIj4nO1xuICAgICAgICBkZXRhaWxGaWVsZHMoaXRlbSkuZm9yRWFjaChmdW5jdGlvbiAocGFpcikge1xuICAgICAgICAgICAgaHRtbCArPSAnPGR0PicgKyBlc2MocGFpclswXSkgKyAnPC9kdD48ZGQ+JyArIGVzYyhwYWlyWzFdKSArICc8L2RkPic7XG4gICAgICAgIH0pO1xuICAgICAgICB2YXIgcmV0cnlhYmxlID0gZmFsc2U7XG4gICAgICAgIChpdGVtLmRlbGl2ZXJpZXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24gKGRlbGl2ZXJ5KSB7XG4gICAgICAgICAgICB2YXIgc3RhdHVzID0gZGVsaXZlcnlTdGF0dXNUZXh0KGRlbGl2ZXJ5KTtcbiAgICAgICAgICAgIHZhciBhdWRpbyA9IGF0dGFjaG1lbnRMaW5lKGRlbGl2ZXJ5KTtcbiAgICAgICAgICAgIHZhciByYXdDb2RlID0gZGVsaXZlcnkubGFzdF9lcnJvcl9jb2RlIHx8ICcnO1xuICAgICAgICAgICAgaHRtbCArPSAnPGR0IGNsYXNzPVwibWgtdHJ1bmNhdGVcIj4nICsgZXNjKHJlY2lwaWVudFRpdGxlKGRlbGl2ZXJ5KSkgKyAnPC9kdD4nXG4gICAgICAgICAgICAgICAgKyAnPGRkJyArIChzdGF0dXMuYmFkID8gJyBjbGFzcz1cIm1oLWVycm9yLXRleHRcIicgOiAnJykgKyAocmF3Q29kZSAhPT0gJycgPyAnIHRpdGxlPVwiJyArIGVzYyhyYXdDb2RlKS5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JykgKyAnXCInIDogJycpICsgJz4nXG4gICAgICAgICAgICAgICAgKyBlc2Moc3RhdHVzLnRleHQpXG4gICAgICAgICAgICAgICAgKyAoYXVkaW8gPyAnPGRpdiBjbGFzcz1cIm1oLW1ldGEnICsgKGF1ZGlvLmJhZCA/ICcgbWgtZXJyb3ItdGV4dCcgOiAnJykgKyAnXCInXG4gICAgICAgICAgICAgICAgICAgICsgKGF1ZGlvLmNvZGUgIT09ICcnID8gJyB0aXRsZT1cIicgKyBlc2MoYXVkaW8uY29kZSkucmVwbGFjZSgvXCIvZywgJyZxdW90OycpICsgJ1wiJyA6ICcnKSArICc+JyArIGVzYyhhdWRpby50ZXh0KSArICc8L2Rpdj4nIDogJycpXG4gICAgICAgICAgICAgICAgKyAnPC9kZD4nO1xuICAgICAgICAgICAgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2ZhaWxlZCcgJiYgIWRlbGl2ZXJ5LmJvdF9kZWxldGVkICYmICFkZWxpdmVyeS5jaGF0X2RlbGV0ZWQpIHtcbiAgICAgICAgICAgICAgICByZXRyeWFibGUgPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgaHRtbCArPSAnPC9kbD4nO1xuICAgICAgICBpZiAocmV0cnlhYmxlKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8YnV0dG9uIGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uXCIgdHlwZT1cImJ1dHRvblwiIGRhdGEtYWN0aW9uPVwicmV0cnktZXZlbnRcIiBkYXRhLWV2ZW50LWlkPVwiJyArIGl0ZW0uaWQgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5UmV0cnknKSkgKyAnPC9idXR0b24+JztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJzx0ciBjbGFzcz1cIm1oLWRldGFpbFwiIGRhdGEtZGV0YWlsLWZvcj1cIicgKyBpdGVtLmlkICsgJ1wiPjx0ZCBjb2xzcGFuPVwiNVwiPjxkaXYgY2xhc3M9XCJtaC1kZXRhaWwtYm9keVwiPicgKyBodG1sICsgJzwvZGl2PjwvdGQ+PC90cj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlY2lwaWVudFRpdGxlKGRlbGl2ZXJ5KSB7XG4gICAgICAgIGlmIChkZWxpdmVyeS5jaGF0X3RpdGxlKSB7XG4gICAgICAgICAgICByZXR1cm4gZGVsaXZlcnkuY2hhdF90aXRsZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuY2hhdF9kZWxldGVkKSB7XG4gICAgICAgICAgICByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlDaGF0RGVsZXRlZCcpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBkZWxpdmVyeS5leHRlcm5hbF9jaGF0X2lkIHx8ICfigJQnO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlbGl2ZXJ5Q291bnRzKGl0ZW0pIHtcbiAgICAgICAgdmFyIGNvdW50cyA9IHsgdG90YWw6IDAsIHNlbnQ6IDAsIGZhaWxlZDogMCwgcGVuZGluZzogMCwgcmVzb2x2ZWQ6IDAgfTtcbiAgICAgICAgKGl0ZW0uZGVsaXZlcmllcyB8fCBbXSkuZm9yRWFjaChmdW5jdGlvbiAoZGVsaXZlcnkpIHtcbiAgICAgICAgICAgIGNvdW50cy50b3RhbCsrO1xuICAgICAgICAgICAgaWYgKGlzRmFpbGVkRGVsaXZlcnkoZGVsaXZlcnkpKSB7IGNvdW50cy5mYWlsZWQrKzsgfVxuICAgICAgICAgICAgZWxzZSBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAncGVuZGluZycgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnc2VuZGluZycpIHsgY291bnRzLnBlbmRpbmcrKzsgfVxuICAgICAgICAgICAgZWxzZSBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAnY2FuY2VsbGVkJykgeyBjb3VudHMucmVzb2x2ZWQrKzsgfVxuICAgICAgICAgICAgZWxzZSB7IGNvdW50cy5zZW50Kys7IH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBjb3VudHM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZGVsaXZlcnlDZWxsKGl0ZW0pIHtcbiAgICAgICAgdmFyIGMgPSBkZWxpdmVyeUNvdW50cyhpdGVtKTtcbiAgICAgICAgaWYgKGMudG90YWwgPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1tdXRlZFwiPuKAlDwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjLmZhaWxlZCA+IDApIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgSUNPTl9FUlJPUiArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeU5vdERlbGl2ZXJlZCcpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYy5wZW5kaW5nID4gMCkge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIm1oLWRvdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdFF1ZXVlZCcpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYy5zZW50ID09PSAwICYmIGMucmVzb2x2ZWQgPiAwKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwibWgtZG90XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeUNhbGxlZEJhY2snKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIm1oLWRvdCBpcy1va1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdERlbGl2ZXJlZCcpKSArICc8L3NwYW4+JztcbiAgICB9XG5cbiAgICAvLyBPbmUgbGluZSBwZXIgcmVjaXBpZW50OiBzdGF0dXMg4oCUIHJlYXNvbi5cbiAgICBmdW5jdGlvbiBkZWxpdmVyeVN0YXR1c1RleHQoZGVsaXZlcnkpIHtcbiAgICAgICAgaWYgKGlzRmFpbGVkRGVsaXZlcnkoZGVsaXZlcnkpKSB7XG4gICAgICAgICAgICB2YXIgcmVhc29uID0gZGVsaXZlcnlSZWFzb24oZGVsaXZlcnkpO1xuICAgICAgICAgICAgcmV0dXJuIHsgYmFkOiB0cnVlLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeU5vdERlbGl2ZXJlZCcpICsgKHJlYXNvbiAhPT0gJycgPyAnIMK3ICcgKyByZWFzb24gOiAnJykgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAncGVuZGluZycgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnc2VuZGluZycpIHtcbiAgICAgICAgICAgIHJldHVybiB7IGJhZDogZmFsc2UsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3RRdWV1ZWQnKSArIChkZWxpdmVyeS5uZXh0X2F0dGVtcHRfYXQgPiAwXG4gICAgICAgICAgICAgICAgPyAnIMK3ICcgKyB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlOZXh0JywgeyB0aW1lOiBmbXRDZWxsVGV4dChkZWxpdmVyeS5uZXh0X2F0dGVtcHRfYXQpIH0pXG4gICAgICAgICAgICAgICAgOiAnJykgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAnY2FuY2VsbGVkJykge1xuICAgICAgICAgICAgcmV0dXJuIHsgYmFkOiBmYWxzZSwgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlTdGF0dXNDYW5jZWxsZWQnKSB9O1xuICAgICAgICB9XG4gICAgICAgIGlmIChkZWxpdmVyeS5zdGF0dXMgPT09ICdyZXRyYWN0ZWQnKSB7XG4gICAgICAgICAgICByZXR1cm4geyBiYWQ6IGZhbHNlLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeVN0YXR1c1JldHJhY3RlZCcpIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3JldHJhY3RfZmFpbGVkJykge1xuICAgICAgICAgICAgcmV0dXJuIHsgYmFkOiB0cnVlLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeVN0YXR1c1JldHJhY3RGYWlsZWQnKSB9O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7IGJhZDogZmFsc2UsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3REZWxpdmVyZWQnKSB9O1xuICAgIH1cblxuICAgIC8vIE5vcm1hbGlzZWQgZGVsaXZlcnkvYXR0YWNobWVudCBjb2RlcyAtPiByZWFkYWJsZSB0ZXh0LiBUaGUgcmF3IGNvZGUgc3RheXMgYXZhaWxhYmxlIGluIGEgdG9vbHRpcCBvbmx5LlxuICAgIHZhciBDT0RFX1RFWFRfS0VZUyA9IHtcbiAgICAgICAgJ2F0dGFjaG1lbnQuY29udmVydGVyX21pc3NpbmcnOiAnUmVhc29uTm9Db252ZXJ0ZXInLFxuICAgICAgICAnYXR0YWNobWVudC5jb252ZXJzaW9uX2ZhaWxlZCc6ICdSZWFzb25Db252ZXJ0JyxcbiAgICAgICAgJ2F0dGFjaG1lbnQuY29udmVyc2lvbl90aW1lb3V0JzogJ1JlYXNvbkNvbnZlcnQnLFxuICAgICAgICAnYXR0YWNobWVudC5wcmVwYXJlX2ZhaWxlZCc6ICdSZWFzb25Db252ZXJ0JyxcbiAgICAgICAgJ2F0dGFjaG1lbnQuY2FjaGVfdW5hdmFpbGFibGUnOiAnUmVhc29uQ29udmVydCcsXG4gICAgICAgICdhdHRhY2htZW50LmJ1c3knOiAnUmVhc29uQ29udmVydCcsXG4gICAgICAgICdhdHRhY2htZW50LnRvb19iaWcnOiAnUmVhc29uVG9vQmlnJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQuZHVyYXRpb25fdG9vX2xvbmcnOiAnUmVhc29uVG9vQmlnJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQuc291cmNlX21pc3NpbmcnOiAnUmVhc29uTm9SZWNvcmRpbmcnLFxuICAgICAgICAnYXR0YWNobWVudC5wYXRoX21pc3NpbmcnOiAnUmVhc29uTm9SZWNvcmRpbmcnLFxuICAgICAgICAnYXR0YWNobWVudC5wYXRoX3JlamVjdGVkJzogJ1JlYXNvbkZpbGVVbmF2YWlsYWJsZScsXG4gICAgICAgICdhdHRhY2htZW50LnVuYXZhaWxhYmxlJzogJ1JlYXNvbkZpbGVVbmF2YWlsYWJsZScsXG4gICAgICAgICd0ZWxlZ3JhbS5maWxlX3VuYXZhaWxhYmxlJzogJ1JlYXNvbkZpbGVVbmF2YWlsYWJsZScsXG4gICAgICAgICdhdHRhY2htZW50LnF1b3Rlc19taXNzaW5nJzogJ1JlYXNvbk5vUXVvdGVzJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQudW5jZXJ0YWluJzogJ1JlYXNvblVuY2VydGFpbicsXG4gICAgICAgICdkZWxpdmVyeS51bmNlcnRhaW4nOiAnUmVhc29uVW5jZXJ0YWluJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQucmV0cnlfZXhoYXVzdGVkJzogJ1JlYXNvblJldHJpZXMnLFxuICAgICAgICAnZGVsaXZlcnkuaW5jb21wbGV0ZSc6ICdSZWFzb25SZXRyaWVzJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQucmVqZWN0ZWQnOiAnUmVhc29uUmVqZWN0ZWQnLFxuICAgICAgICAnaHR0cC5iYWRfcmVxdWVzdCc6ICdSZWFzb25SZWplY3RlZCcsXG4gICAgICAgICdhdHRhY2htZW50Lm5vdC5yZWFkeSc6ICdSZWFzb25Ob3RSZWFkeScsXG4gICAgICAgICdtYXguYXR0YWNobWVudC5ub3RfcmVhZHknOiAnUmVhc29uTm90UmVhZHknLFxuICAgICAgICAnYXR0YWNobWVudC5jYW5jZWxsZWQnOiAnUmVhc29uQ2FuY2VsbGVkJyxcbiAgICAgICAgJ2h0dHAuY29ubmVjdF9mYWlsZWQnOiAnUmVhc29uTm9Db25uZWN0aW9uJyxcbiAgICAgICAgJ2h0dHAudGltZW91dCc6ICdSZWFzb25Ob0Nvbm5lY3Rpb24nLFxuICAgICAgICAnaHR0cC51bmF2YWlsYWJsZSc6ICdSZWFzb25Ob0Nvbm5lY3Rpb24nLFxuICAgICAgICAnaHR0cC50bHMnOiAnUmVhc29uTm9Db25uZWN0aW9uJ1xuICAgIH07XG5cbiAgICBmdW5jdGlvbiBjb2RlVGV4dChjb2RlKSB7XG4gICAgICAgIHZhciBrZXkgPSBDT0RFX1RFWFRfS0VZU1tjb2RlXTtcbiAgICAgICAgcmV0dXJuIGtleSA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViXycgKyBrZXkpIDogY29kZTtcbiAgICB9XG5cbiAgICAvLyBcIlJlY29yZGluZzogc2VudCAvIHJlcGxhY2VkIGJ5IGEgbm90ZSAvIHNraXBwZWQgwrcgcmVhc29uXCI7IG51bGwgd2hlbiB0aGUgZGVsaXZlcnkgY2FycmllcyBubyBhdWRpby5cbiAgICBmdW5jdGlvbiBhdHRhY2htZW50TGluZShkZWxpdmVyeSkge1xuICAgICAgICB2YXIgYSA9IGRlbGl2ZXJ5LmF0dGFjaG1lbnQ7XG4gICAgICAgIGlmICghYSB8fCAhYS5zdGF0ZSB8fCBhLnN0YXRlID09PSAnbm9uZScpIHsgcmV0dXJuIG51bGw7IH1cbiAgICAgICAgdmFyIHRleHQ7XG4gICAgICAgIHZhciBiYWQgPSBmYWxzZTtcbiAgICAgICAgdmFyIHRvdGFsID0gTnVtYmVyKGEucGFydHMpIHx8IDA7XG4gICAgICAgIGlmIChhLnN0YXRlID09PSAncGVuZGluZycpIHtcbiAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hRdWV1ZWQnKTtcbiAgICAgICAgfSBlbHNlIGlmIChhLnN0YXRlID09PSAnc2VudCcpIHtcbiAgICAgICAgICAgIHRleHQgPSB0b3RhbCA+IDFcbiAgICAgICAgICAgICAgICA/IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hQYXJ0aWFsJywgeyBzZW50OiBhLnNlbnQsIHRvdGFsOiB0b3RhbCB9KVxuICAgICAgICAgICAgICAgIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQXR0YWNoU2VudCcpO1xuICAgICAgICB9IGVsc2UgaWYgKGEuc3RhdGUgPT09ICdwYXJ0aWFsJykge1xuICAgICAgICAgICAgdGV4dCA9IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hQYXJ0aWFsJywgeyBzZW50OiBhLnNlbnQsIHRvdGFsOiB0b3RhbCB9KTtcbiAgICAgICAgfSBlbHNlIGlmIChhLnN0YXRlID09PSAnc2tpcHBlZCcpIHtcbiAgICAgICAgICAgIC8vIHRoZSBmYWxsYmFjayBub3RlIGluIHRoZSB0ZXh0IHRlbGxzIHdoZXJlIHRoZSByZWNvcmRpbmcgY2FuIGJlIGZvdW5kXG4gICAgICAgICAgICB0ZXh0ID0gYS5ub3RlID09PSAnc2VudCcgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hSZXBsYWNlZCcpIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQXR0YWNoU2tpcHBlZCcpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGV4dCA9IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0F0dGFjaEZhaWxlZCcpO1xuICAgICAgICAgICAgYmFkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYS5jb2RlICYmIGEuc3RhdGUgIT09ICdwZW5kaW5nJyAmJiBhLnN0YXRlICE9PSAnc2VudCcpIHtcbiAgICAgICAgICAgIHRleHQgKz0gJyDCtyAnICsgY29kZVRleHQoYS5jb2RlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geyB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hMYWJlbCcpICsgJzogJyArIHRleHQsIGNvZGU6IGEuY29kZSB8fCAnJywgYmFkOiBiYWQgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZWxpdmVyeVJlYXNvbihkZWxpdmVyeSkge1xuICAgICAgICBpZiAoZGVsaXZlcnkuYm90X2RlbGV0ZWQpIHsgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5Qm90RGVsZXRlZCcpOyB9XG4gICAgICAgIGlmIChkZWxpdmVyeS5jaGF0X2RlbGV0ZWQpIHsgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5Q2hhdERlbGV0ZWQnKTsgfVxuICAgICAgICB2YXIgY29kZSA9IGRlbGl2ZXJ5Lmxhc3RfZXJyb3JfY29kZSB8fCAnJztcbiAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MDEudW5hdXRob3JpemVkJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzVG9rZW5JbnZhbGlkJyk7IH1cbiAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MDMua2lja2VkJyB8fCBjb2RlID09PSAndGVsZWdyYW0uNDAzLmJsb2NrZWQnIHx8IGNvZGUgPT09ICd0ZWxlZ3JhbS40MDAuY2hhdF9ub3RfZm91bmQnXG4gICAgICAgICAgICB8fCBjb2RlID09PSAnbWF4LjQwMy5jaGF0X2RlbmllZCcgfHwgY29kZSA9PT0gJ21heC40MDQubm90X2ZvdW5kJyB8fCBjb2RlID09PSAnbWF4LjQwNC51bmtub3duJykge1xuICAgICAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRTdGF0dXNHb25lJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGNvZGVUZXh0KGNvZGUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHRvZ2dsZVJvdyhpZCkge1xuICAgICAgICBzdGF0ZS5leHBhbmRlZElkID0gc3RhdGUuZXhwYW5kZWRJZCA9PT0gaWQgPyBudWxsIDogaWQ7XG4gICAgICAgIHJlbmRlckpvdXJuYWwoKTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGpvdXJuYWw6IHBhZ2VyIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIHJlbmRlclBhZ2VyKCkge1xuICAgICAgICB2YXIgJHBhZ2VyID0gJCgnI21oLWpvdXJuYWwtcGFnZXInKTtcbiAgICAgICAgaWYgKHN0YXRlLmxhc3RJdGVtcy5sZW5ndGggPT09IDAgfHwgc3RhdGUudG90YWwgPD0gUEFHRV9MSU1JVCkge1xuICAgICAgICAgICAgJHBhZ2VyLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICRwYWdlci5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtcGFnZS1pbmZvJykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfRXZlbnRzUGFnZScsIHtcbiAgICAgICAgICAgIGZyb206IHN0YXRlLm9mZnNldCArIDEsXG4gICAgICAgICAgICB0bzogc3RhdGUub2Zmc2V0ICsgc3RhdGUubGFzdEl0ZW1zLmxlbmd0aCxcbiAgICAgICAgICAgIHRvdGFsOiBzdGF0ZS50b3RhbFxuICAgICAgICB9KSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXByZXYnKS5hdHRyKCdkaXNhYmxlZCcsIHN0YXRlLm9mZnNldCA8PSAwKTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtbmV4dCcpLmF0dHIoJ2Rpc2FibGVkJywgc3RhdGUub2Zmc2V0ICsgc3RhdGUubGFzdEl0ZW1zLmxlbmd0aCA+PSBzdGF0ZS50b3RhbCk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBzZXR0aW5ncyB0YWIgLS0tLS0tLS0tLVxuXG4gICAgLy8gRmllbGRzIGNhcnJ5IG5vIGhpbnRzIChkZXNpZ24gdjMpOyB0aGUgaGVscCBsaW5lIHVuZGVyIGEgZmllbGQgaXMgdXNlZCBvbmx5IGZvciBpdHMgZXJyb3IuXG4gICAgZnVuY3Rpb24gbWFya0ZpZWxkRXJyb3IoZmllbGRTZWxlY3RvciwgbWVzc2FnZSkge1xuICAgICAgICAkKGZpZWxkU2VsZWN0b3IpLmFkZENsYXNzKCdlcnJvcicpLmZpbmQoJy5taC1oZWxwJykudGV4dChtZXNzYWdlIHx8ICcnKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjbGVhckZpZWxkRXJyb3IoZmllbGRTZWxlY3Rvcikge1xuICAgICAgICAkKGZpZWxkU2VsZWN0b3IpLnJlbW92ZUNsYXNzKCdlcnJvcicpLmZpbmQoJy5taC1oZWxwJykudGV4dCgnJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbWFya1JldGVudGlvbkVycm9yKG1lc3NhZ2UpIHtcbiAgICAgICAgbWFya0ZpZWxkRXJyb3IoJyNtaC1yZXRlbnRpb24tZmllbGQnLCBtZXNzYWdlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjbGVhclJldGVudGlvbkVycm9yKCkge1xuICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC1yZXRlbnRpb24tZmllbGQnKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlUmV0ZW50aW9uKCkge1xuICAgICAgICB2YXIgcmF3ID0gU3RyaW5nKCQoJyNtaC1yZXRlbnRpb24taW5wdXQnKS52YWwoKSB8fCAnJykudHJpbSgpO1xuICAgICAgICB2YXIgZGF5cyA9IC9eXFxkKyQvLnRlc3QocmF3KSA/IHBhcnNlSW50KHJhdywgMTApIDogLTE7XG4gICAgICAgIGlmIChkYXlzIDwgMSB8fCBkYXlzID4gMzY1KSB7XG4gICAgICAgICAgICBtYXJrUmV0ZW50aW9uRXJyb3IodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NldHRpbmdzUmV0ZW50aW9uRXJyb3InLCB7fSkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNsZWFyUmV0ZW50aW9uRXJyb3IoKTtcbiAgICAgICAgYXBpUGF0Y2goJy9zZXR0aW5ncycsIHsgZXZlbnRzX3JldGVudGlvbl9kYXlzOiBkYXlzIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLnJldGVudGlvbiA9IGRheXM7XG4gICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZWQnKSk7XG4gICAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIG1hcmtSZXRlbnRpb25FcnJvcih0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uTG9hZEVycm9yJywge1xuICAgICAgICAgICAgICAgIHdoYXQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0xvYWRXaGF0U2V0dGluZ3MnKSxcbiAgICAgICAgICAgICAgICBjb2RlOiAnaHR0cF9lcnJvcidcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICQoJyNtaC1yZXRlbnRpb24taW5wdXQnKS52YWwoc3RhdGUucmV0ZW50aW9uKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2hvd1RvYXN0KG1lc3NhZ2UpIHtcbiAgICAgICAgLy8gdGhlIGFkbWluIGNhYmluZXQncyBGb21hbnRpYyBidWlsZCBoYXMgbm8gdG9hc3QgbW9kdWxlIOKAlCBhIHRpbnkgcGlsbCBvZiBvdXIgb3duICg0IHMpXG4gICAgICAgIHZhciBleGlzdGluZyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJy5taC10b2FzdCcpO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGV4aXN0aW5nLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBleGlzdGluZ1tpXS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGV4aXN0aW5nW2ldKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgdG9hc3QgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICAgICAgdG9hc3QuY2xhc3NOYW1lID0gJ21oLXRvYXN0JztcbiAgICAgICAgdG9hc3Quc2V0QXR0cmlidXRlKCdyb2xlJywgJ3N0YXR1cycpO1xuICAgICAgICB0b2FzdC50ZXh0Q29udGVudCA9IG1lc3NhZ2U7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQodG9hc3QpO1xuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICh0b2FzdC5wYXJlbnROb2RlKSB7XG4gICAgICAgICAgICAgICAgdG9hc3QucGFyZW50Tm9kZS5yZW1vdmVDaGlsZCh0b2FzdCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sIDQwMDApO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gYm90czogQVBJIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGFwaVNlbmQobWV0aG9kLCBwYXRoLCBwYXlsb2FkLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICB2YXIgb3B0aW9ucyA9IHtcbiAgICAgICAgICAgIHVybDogQ29uZmlnLnBieFVybCArIEFQSV9CQVNFICsgcGF0aCxcbiAgICAgICAgICAgIG1ldGhvZDogbWV0aG9kLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgIGNhY2hlOiBmYWxzZVxuICAgICAgICB9O1xuICAgICAgICBpZiAocGF5bG9hZCAhPT0gbnVsbCAmJiBwYXlsb2FkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIG9wdGlvbnMuZGF0YSA9IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpO1xuICAgICAgICAgICAgb3B0aW9ucy5jb250ZW50VHlwZSA9ICdhcHBsaWNhdGlvbi9qc29uJztcbiAgICAgICAgfVxuICAgICAgICAkLmFqYXgob3B0aW9ucykuZG9uZShmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgICAgICAgIGlmIChyZXNwb25zZSAmJiByZXNwb25zZS5yZXN1bHQgPT09IHRydWUpIHtcbiAgICAgICAgICAgICAgICBvblN1Y2Nlc3MocmVzcG9uc2UuZGF0YSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG9uRmFpbHVyZShub3JtYWxpemVGYWlsdXJlKHJlc3BvbnNlLCAyMDApKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkuZmFpbChmdW5jdGlvbiAoeGhyKSB7XG4gICAgICAgICAgICBvbkZhaWx1cmUobm9ybWFsaXplRmFpbHVyZSh4aHIucmVzcG9uc2VKU09OIHx8IG51bGwsIHhoci5zdGF0dXMpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYXBpUG9zdChwYXRoLCBwYXlsb2FkLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICBhcGlTZW5kKCdQT1NUJywgcGF0aCwgcGF5bG9hZCB8fCB7fSwgb25TdWNjZXNzLCBvbkZhaWx1cmUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGFwaURlbGV0ZShwYXRoLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICBhcGlTZW5kKCdERUxFVEUnLCBwYXRoLCBudWxsLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY29yZUdldChwYXRoLCBwYXJhbXMsIG9uU3VjY2Vzcywgb25GYWlsdXJlKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IENvbmZpZy5wYnhVcmwgKyAnL3BieGNvcmUvYXBpL3YzJyArIHBhdGgsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YTogcGFyYW1zIHx8IHt9LFxuICAgICAgICAgICAgY2FjaGU6IGZhbHNlXG4gICAgICAgIH0pLmRvbmUoZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2UucmVzdWx0ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgb25TdWNjZXNzKHJlc3BvbnNlLmRhdGEpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBvbkZhaWx1cmUobm9ybWFsaXplRmFpbHVyZShyZXNwb25zZSwgMjAwKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLmZhaWwoZnVuY3Rpb24gKHhocikge1xuICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUoeGhyLnJlc3BvbnNlSlNPTiB8fCBudWxsLCB4aHIuc3RhdHVzKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZhaWx1cmVUZXh0KGZhaWx1cmUpIHtcbiAgICAgICAgaWYgKGZhaWx1cmUgJiYgZmFpbHVyZS5maWVsZCkge1xuICAgICAgICAgICAgcmV0dXJuIGZhaWx1cmUubWVzc2FnZXMubGVuZ3RoID4gMCA/IGZhaWx1cmUubWVzc2FnZXNbMF0gOiBmYWlsdXJlLmVycm9yO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAoZmFpbHVyZSAmJiBmYWlsdXJlLmVycm9yKSA/IGZhaWx1cmUuZXJyb3IgOiAnaHR0cF9lcnJvcic7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBib3RzOiBzdGF0ZSAmIHJlbmRlcmluZyAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBib3RCeUlkKGlkKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUuYm90cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKE51bWJlcihzdGF0ZS5ib3RzW2ldLmlkKSA9PT0gTnVtYmVyKGlkKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzdGF0ZS5ib3RzW2ldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlcGxhY2VCb3QoYm90KSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUuYm90cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKE51bWJlcihzdGF0ZS5ib3RzW2ldLmlkKSA9PT0gTnVtYmVyKGJvdC5pZCkpIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5ib3RzW2ldID0gYm90O1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBzdGF0ZS5ib3RzLnB1c2goYm90KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBsb2FkQm90cyhzaWxlbnQpIHtcbiAgICAgICAgaWYgKCFzaWxlbnQpIHtcbiAgICAgICAgICAgIHN0YXRlLmJvdHNMb2FkZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIHJlbmRlckJvdHNTa2VsZXRvbigpO1xuICAgICAgICB9XG4gICAgICAgIGFwaUdldCgnL2JvdHMnLCB7IGxpbWl0OiAyMDAgfSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHN0YXRlLmJvdHMgPSBkYXRhLml0ZW1zIHx8IFtdO1xuICAgICAgICAgICAgc3RhdGUuYm90c0xvYWRlZCA9IHRydWU7XG4gICAgICAgICAgICBzdGF0ZS5ib3RzRXJyb3IgPSBudWxsO1xuICAgICAgICAgICAgcmVuZGVyQm90cygpO1xuICAgICAgICAgICAgcmVuZGVyUnVsZXMoKTtcbiAgICAgICAgICAgIHJlbmRlckpvdXJuYWxCYW5uZXIoKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgIHN0YXRlLmJvdHNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc3RhdGUuYm90c0Vycm9yID0gZmFpbHVyZTtcbiAgICAgICAgICAgIHJlbmRlckJvdHMoKTtcbiAgICAgICAgICAgIHJlbmRlclJ1bGVzKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdHNTa2VsZXRvbigpIHtcbiAgICAgICAgdmFyIGNhcmQgPSAnPGRpdiBjbGFzcz1cIm1oLWJvdC1jYXJkIG1oLWJvdC1za2VsZXRvblwiPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6MzJweDtoZWlnaHQ6MzJweDtib3JkZXItcmFkaXVzOjhweFwiPjwvc3Bhbj4nXG4gICAgICAgICAgICArICc8ZGl2IHN0eWxlPVwiZmxleDoxO2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjZweFwiPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6NTAlXCI+PC9zcGFuPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6MzAlO2hlaWdodDo4cHhcIj48L3NwYW4+PC9kaXY+PC9kaXY+JztcbiAgICAgICAgJCgnI21oLWJvdHMnKS5odG1sKGNhcmQgKyBjYXJkKTtcbiAgICB9XG5cbiAgICAvLyBUZWxlZ3JhbSAvIE1BWCB0aWxlczogdGhlIGZpcnN0LXJ1biBzY3JlZW4gYW5kIMKr0J3QsNGB0YLRgNC+0LnQutC4wrsgd2l0aG91dCBib3RzIChkZXNpZ24gdjMpLlxuICAgIGZ1bmN0aW9uIG1lc3NlbmdlclRpbGVzKCkge1xuICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJtaC1tZXNzZW5nZXItdGlsZXNcIj4nXG4gICAgICAgICAgICArICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cIm1oLXNjZW5hcmlvIG1oLXRpbGVcIiBkYXRhLWFjdGlvbj1cImFkZC1ib3RcIiBkYXRhLWNoYW5uZWw9XCJ0ZWxlZ3JhbVwiPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyIHRnXCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+VEc8L3NwYW4+PGI+VGVsZWdyYW08L2I+PC9idXR0b24+J1xuICAgICAgICAgICAgKyAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJtaC1zY2VuYXJpbyBtaC10aWxlXCIgZGF0YS1hY3Rpb249XCJhZGQtYm90XCIgZGF0YS1jaGFubmVsPVwibWF4XCI+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tZXNzZW5nZXIgbWF4XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+TUFYPC9zcGFuPjxiPk1BWDwvYj48L2J1dHRvbj4nXG4gICAgICAgICAgICArICc8L2Rpdj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdHMoKSB7XG4gICAgICAgIHZhciAkd3JhcCA9ICQoJyNtaC1ib3RzJyk7XG4gICAgICAgIGlmIChzdGF0ZS5ib3RzRXJyb3IgIT09IG51bGwgJiYgc3RhdGUuYm90cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtYWRkJykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICAgICAkd3JhcC5odG1sKCc8ZGl2IGNsYXNzPVwidWkgbmVnYXRpdmUgbWVzc2FnZVwiIHJvbGU9XCJhbGVydFwiPicgKyBJQ09OX0VSUk9SXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLWdyb3dcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdHNMb2FkRmFpbGVkJykpICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uIG1oLW9uLW1lc3NhZ2VcIiB0eXBlPVwiYnV0dG9uXCIgaWQ9XCJtaC1ib3RzLXJldHJ5XCI+J1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblJldHJ5JykpICsgJzwvYnV0dG9uPjwvZGl2PicpO1xuICAgICAgICAgICAgJCgnI21oLWJvdHMtcmV0cnknKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IGxvYWRCb3RzKCk7IH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghc3RhdGUuYm90c0xvYWRlZCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC1ib3QtYWRkJykuYXR0cignaGlkZGVuJywgc3RhdGUuYm90cy5sZW5ndGggPiAwID8gbnVsbCA6IHRydWUpO1xuICAgICAgICBpZiAoc3RhdGUuYm90cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICR3cmFwLmh0bWwobWVzc2VuZ2VyVGlsZXMoKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGh0bWwgPSAnPGRpdiBjbGFzcz1cIm1oLWJvdC1saXN0XCI+JztcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5ib3RzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBodG1sICs9IHJlbmRlckJvdENhcmQoc3RhdGUuYm90c1tpXSk7XG4gICAgICAgIH1cbiAgICAgICAgJHdyYXAuaHRtbChodG1sICsgJzwvZGl2PicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdENhcmQoYm90KSB7XG4gICAgICAgIHZhciBleHBhbmRlZCA9IHN0YXRlLmV4cGFuZGVkQm90c1tib3QuaWRdID09PSB0cnVlO1xuICAgICAgICB2YXIgYm9keSA9ICcnO1xuICAgICAgICBpZiAoZXhwYW5kZWQpIHtcbiAgICAgICAgICAgIGJvZHkgPSAnPGRpdiBjbGFzcz1cIm1oLWJvdC1ib2R5XCI+JyArIHJlbmRlckJvdFRsc1dhcm5pbmcoYm90KSArIHJlbmRlckJvdENoYXRzKGJvdCkgKyByZW5kZXJCb3RBY3Rpb25zKGJvdCkgKyAnPC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICB2YXIgY2hhdENvdW50ID0gKGJvdC5jaGF0cyB8fCBbXSkubGVuZ3RoO1xuICAgICAgICB2YXIgbWV0YSA9IFtdO1xuICAgICAgICBpZiAoYm90LmJvdF91c2VybmFtZSkgeyBtZXRhLnB1c2goJ0AnICsgYm90LmJvdF91c2VybmFtZSk7IH1cbiAgICAgICAgbWV0YS5wdXNoKGNoYXRDb3VudCA+IDAgPyB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hhdHNDb3VudCcsIHsgY291bnQ6IGNoYXRDb3VudCB9KSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoYXRzTm9uZScpKTtcbiAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwibWgtYm90LXJvdycgKyAoZXhwYW5kZWQgPyAnIGlzLW9wZW4nIDogJycpICsgJ1wiIGRhdGEtYm90LWlkPVwiJyArIGJvdC5pZCArICdcIj4nXG4gICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtYm90LWhlYWRcIiBkYXRhLWFjdGlvbj1cInRvZ2dsZVwiIHJvbGU9XCJidXR0b25cIiB0YWJpbmRleD1cIjBcIiBhcmlhLWV4cGFuZGVkPVwiJyArIChleHBhbmRlZCA/ICd0cnVlJyA6ICdmYWxzZScpICsgJ1wiPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyICcgKyAoYm90LmNoYW5uZWwgPT09ICdtYXgnID8gJ21heCcgOiAndGcnKSArICdcIiBhcmlhLWhpZGRlbj1cInRydWVcIj4nICsgKGJvdC5jaGFubmVsID09PSAnbWF4JyA/ICdNQVgnIDogJ1RHJykgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ib3QtdGl0bGVzXCI+PGIgY2xhc3M9XCJtaC10cnVuY2F0ZVwiPicgKyBlc2MoYm90LnRpdGxlKSArICc8L2I+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tZXRhIG1oLXRydW5jYXRlXCI+JyArIGVzYyhtZXRhLmpvaW4oJyDCtyAnKSkgKyAnPC9zcGFuPjwvZGl2PidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtYm90LXN0YXR1c1wiPicgKyBib3RTdGF0dXNDZWxsKGJvdCkgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtY2hldnJvblwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPidcbiAgICAgICAgICAgICsgJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIHN0eWxlPVwidHJhbnNmb3JtOnJvdGF0ZSgnICsgKGV4cGFuZGVkID8gJzE4MCcgOiAnMCcpICsgJ2RlZylcIj48cGF0aCBkPVwiTTMuNSA2TDggMTAuNSAxMi41IDZcIi8+PC9zdmc+J1xuICAgICAgICAgICAgKyAnPC9zcGFuPjwvZGl2PicgKyBib2R5ICsgJzwvZGl2Pic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYm90U3RhdHVzQ2VsbChib3QpIHtcbiAgICAgICAgaWYgKGJvdC5lbmFibGVkID09PSBmYWxzZSkge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIm1oLWRvdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzRGlzYWJsZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICdvaycpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1kb3QgaXMtb2tcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c09rJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmIChib3Quc3RhdHVzID09PSAndG9rZW5faW52YWxpZCcpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c1Rva2VuSW52YWxpZCcpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYm90LnN0YXR1cyA9PT0gJ2NhX2Vycm9yJykge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cInVpIHJlZCBsYWJlbFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzQ2FFcnJvcicpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYm90LnN0YXR1cyA9PT0gJ2Vycm9yJykge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cInVpIHllbGxvdyBsYWJlbFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzQ2hlY2tGYWlsZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIm1oLWRvdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzTmV3JykpICsgJzwvc3Bhbj4nO1xuICAgIH1cblxuICAgIC8vIFRoZSBNQVggQVBJIGlzIHNpZ25lZCBieSB0aGUg0JzQuNC90YbQuNGE0YDRiyByb290IENBOiBhIHRydXN0IGZhaWx1cmUgaXMgYSBjb25maWd1cmF0aW9uIHByb2JsZW0sIG5vdCBhXG4gICAgLy8gdG9rZW4gcHJvYmxlbSwgc28gaXQgZ2V0cyBpdHMgb3duIGV4cGxhbmF0aW9uIGFuZCBwb2ludHMgdG8gdGhlIHNldHRpbmdzIGZpZWxkLlxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdFRsc1dhcm5pbmcoYm90KSB7XG4gICAgICAgIGlmIChib3Quc3RhdHVzICE9PSAnY2FfZXJyb3InICYmICFpc01heFRsc0NvZGUoYm90Lmxhc3RfZXJyb3JfY29kZSkpIHtcbiAgICAgICAgICAgIHJldHVybiAnJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJ1aSB3YXJuaW5nIG1lc3NhZ2VcIiByb2xlPVwibm90ZVwiPidcbiAgICAgICAgICAgICsgJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjxjaXJjbGUgY3g9XCI4XCIgY3k9XCI4XCIgcj1cIjYuMjVcIi8+PHBhdGggZD1cIk04IDQuNXY0TTggMTFoLjAxXCIvPjwvc3ZnPidcbiAgICAgICAgICAgICsgJzxkaXY+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTdGF0dXNDYUVycm9yJykpICsgJy4gJ1xuICAgICAgICAgICAgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2FFcnJvckhpbnQnKSkgKyAnPC9kaXY+PC9kaXY+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjaGF0S2luZExhYmVsKGtpbmQpIHtcbiAgICAgICAgaWYgKGtpbmQgPT09ICdwcml2YXRlJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFR5cGVQcml2YXRlJyk7IH1cbiAgICAgICAgaWYgKGtpbmQgPT09ICdjaGFubmVsJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFR5cGVDaGFubmVsJyk7IH1cbiAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRUeXBlR3JvdXAnKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJCb3RDaGF0cyhib3QpIHtcbiAgICAgICAgdmFyIGNoYXRzID0gYm90LmNoYXRzIHx8IFtdO1xuICAgICAgICBpZiAoY2hhdHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJtaC1ib3Qtbm9jaGF0cyBtaC1tdXRlZFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Tm9DaGF0c1RpdGxlJykpICsgJzwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGh0bWwgPSAnPGRpdiBjbGFzcz1cIm1oLWNoYXQtbGlzdFwiPic7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hhdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGh0bWwgKz0gcmVuZGVyQ2hhdFJvdyhib3QsIGNoYXRzW2ldKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gaHRtbCArICc8L2Rpdj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckNoYXRSb3coYm90LCBjaGF0KSB7XG4gICAgICAgIHZhciBnb25lID0gY2hhdC5zdGF0ZSA9PT0gJ2dvbmUnO1xuICAgICAgICB2YXIgc3RhdGVDZWxsO1xuICAgICAgICBpZiAoZ29uZSkge1xuICAgICAgICAgICAgc3RhdGVDZWxsID0gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCIgdGl0bGU9XCInICsgZXNjKGNoYXQuZ29uZV9yZWFzb24pICsgJ1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFN0YXR1c0dvbmUnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH0gZWxzZSBpZiAoY2hhdC5sYXN0X2RlbGl2ZXJ5ICYmIGNoYXQubGFzdF9kZWxpdmVyeS5zdGF0dXMgPT09ICdmYWlsZWQnKSB7XG4gICAgICAgICAgICBzdGF0ZUNlbGwgPSAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRTdGF0dXNFcnJvcicpKSArICc8L3NwYW4+JztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHN0YXRlQ2VsbCA9ICc8c3BhbiBjbGFzcz1cIm1oLWRvdCBpcy1va1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFN0YXR1c09rJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnPGRpdiBjbGFzcz1cIm1oLWNoYXQtcm93XCIgZGF0YS1jaGF0LWlkPVwiJyArIGNoYXQuaWQgKyAnXCI+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1jaGF0LXRpdGxlXCI+PHNwYW4gY2xhc3M9XCJtaC10cnVuY2F0ZVwiPicgKyBlc2MoY2hhdC50aXRsZSB8fCBjaGF0LmNoYXRfaWQpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1ldGFcIj4gwrcgJyArIGVzYyhjaGF0S2luZExhYmVsKGNoYXQuY2hhdF9raW5kKSkgKyAnPC9zcGFuPjwvc3Bhbj4nXG4gICAgICAgICAgICArIGVtcGxveWVlU2VsZWN0KGNoYXQpXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWNoYXQtc3RhdGVcIj4nICsgc3RhdGVDZWxsICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICArICc8bGFiZWwgY2xhc3M9XCJ1aSB0b2dnbGUgY2hlY2tib3gnICsgKGNoYXQuZW5hYmxlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAoZ29uZSA/ICcgZGlzYWJsZWQnIDogJycpICsgJ1wiIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdEVuYWJsZUNoYXQnKSkgKyAnXCI+J1xuICAgICAgICAgICAgKyAnPGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGNsYXNzPVwiaGlkZGVuIG1oLWNoYXQtdG9nZ2xlXCInICsgKGNoYXQuZW5hYmxlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAoZ29uZSA/ICcgZGlzYWJsZWQnIDogJycpICsgJz4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXRyYWNrXCI+PC9zcGFuPjwvbGFiZWw+J1xuICAgICAgICAgICAgKyAnPC9kaXY+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBlbXBsb3llZVNlbGVjdChjaGF0KSB7XG4gICAgICAgIHZhciBvcHRpb25zID0gJzxvcHRpb24gdmFsdWU9XCIwXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Tm9FbXBsb3llZScpKSArICc8L29wdGlvbj4nO1xuICAgICAgICB2YXIgZm91bmQgPSBmYWxzZTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5lbXBsb3llZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBlbXBsb3llZSA9IHN0YXRlLmVtcGxveWVlc1tpXTtcbiAgICAgICAgICAgIHZhciBzZWxlY3RlZCA9IE51bWJlcihlbXBsb3llZS5pZCkgPT09IE51bWJlcihjaGF0LmxpbmtlZF91c2VyX2lkKTtcbiAgICAgICAgICAgIGlmIChzZWxlY3RlZCkgeyBmb3VuZCA9IHRydWU7IH1cbiAgICAgICAgICAgIG9wdGlvbnMgKz0gJzxvcHRpb24gdmFsdWU9XCInICsgZW1wbG95ZWUuaWQgKyAnXCInICsgKHNlbGVjdGVkID8gJyBzZWxlY3RlZCcgOiAnJykgKyAnPicgKyBlc2MoZW1wbG95ZWUubGFiZWwpICsgJzwvb3B0aW9uPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFmb3VuZCAmJiBOdW1iZXIoY2hhdC5saW5rZWRfdXNlcl9pZCkgPiAwKSB7XG4gICAgICAgICAgICBvcHRpb25zICs9ICc8b3B0aW9uIHZhbHVlPVwiJyArIGNoYXQubGlua2VkX3VzZXJfaWQgKyAnXCIgc2VsZWN0ZWQ+IycgKyBjaGF0LmxpbmtlZF91c2VyX2lkICsgJzwvb3B0aW9uPic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICc8c2VsZWN0IGNsYXNzPVwibWgtZW1wbG95ZWUtc2VsZWN0XCIgYXJpYS1sYWJlbD1cIicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdEVtcGxveWVlJykpICsgJ1wiPicgKyBvcHRpb25zICsgJzwvc2VsZWN0Pic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyQm90QWN0aW9ucyhib3QpIHtcbiAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwibWgtYm90LWFjdGlvbnNcIj4nXG4gICAgICAgICAgICArICc8YSBocmVmPVwiI1wiIGRhdGEtYWN0aW9uPVwiY29ubmVjdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90QWN0aW9uc0Nvbm5lY3QnKSkgKyAnPC9hPidcbiAgICAgICAgICAgICsgJzxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJ0ZXN0XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RBY3Rpb25zVGVzdCcpKSArICc8L2E+J1xuICAgICAgICAgICAgKyAnPGEgaHJlZj1cIiNcIiBkYXRhLWFjdGlvbj1cImVkaXRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdEFjdGlvbnNFZGl0JykpICsgJzwvYT4nXG4gICAgICAgICAgICArICc8L2Rpdj4nO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gYm90czogZGVsZWdhdGVkIGFjdGlvbnMgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gYmluZEJvdHNDb250YWluZXIoKSB7XG4gICAgICAgIHZhciAkd3JhcCA9ICQoJyNtaC1ib3RzJyk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJ0b2dnbGVcIl0nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgaWQgPSBTdHJpbmcoJCh0aGlzKS5jbG9zZXN0KCcubWgtYm90LXJvdycpLmRhdGEoJ2JvdC1pZCcpKTtcbiAgICAgICAgICAgIHN0YXRlLmV4cGFuZGVkQm90c1tpZF0gPSBzdGF0ZS5leHBhbmRlZEJvdHNbaWRdICE9PSB0cnVlO1xuICAgICAgICAgICAgcmVuZGVyQm90cygpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2tleWRvd24nLCAnW2RhdGEtYWN0aW9uPVwidG9nZ2xlXCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBpZiAoZXZlbnQua2V5ID09PSAnRW50ZXInIHx8IGV2ZW50LmtleSA9PT0gJyAnKSB7XG4gICAgICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgICAgICAkKHRoaXMpLnRyaWdnZXIoJ2NsaWNrJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiYWRkLWJvdFwiXScsIGZ1bmN0aW9uICgpIHsgb3BlbkJvdE1vZGFsKCdhZGQnLCBudWxsLCAkKHRoaXMpLmRhdGEoJ2NoYW5uZWwnKSk7IH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiY29ubmVjdFwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIG9wZW5DaGF0TW9kYWwoYm90QnlJZCgkKHRoaXMpLmNsb3Nlc3QoJy5taC1ib3Qtcm93JykuZGF0YSgnYm90LWlkJykpKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJ0ZXN0XCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgb3BlblRlc3RNb2RhbChib3RCeUlkKCQodGhpcykuY2xvc2VzdCgnLm1oLWJvdC1yb3cnKS5kYXRhKCdib3QtaWQnKSksIG51bGwpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImVkaXRcIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBvcGVuQm90TW9kYWwoJ2VkaXQnLCBib3RCeUlkKCQodGhpcykuY2xvc2VzdCgnLm1oLWJvdC1yb3cnKS5kYXRhKCdib3QtaWQnKSkpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NoYW5nZScsICcubWgtY2hhdC10b2dnbGUnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgYm90SWQgPSAkKHRoaXMpLmNsb3Nlc3QoJy5taC1ib3Qtcm93JykuZGF0YSgnYm90LWlkJyk7XG4gICAgICAgICAgICB2YXIgY2hhdElkID0gJCh0aGlzKS5jbG9zZXN0KCcubWgtY2hhdC1yb3cnKS5kYXRhKCdjaGF0LWlkJyk7XG4gICAgICAgICAgICB2YXIgZW5hYmxlZCA9ICQodGhpcykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICAgICAgcGF0Y2hCb3QoYm90SWQsIHsgY2hhdHM6IFt7IGlkOiBOdW1iZXIoY2hhdElkKSwgZW5hYmxlZDogZW5hYmxlZCB9XSB9LCBudWxsLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVGYWlsZWQnKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjaGFuZ2UnLCAnLm1oLWVtcGxveWVlLXNlbGVjdCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBib3RJZCA9ICQodGhpcykuY2xvc2VzdCgnLm1oLWJvdC1yb3cnKS5kYXRhKCdib3QtaWQnKTtcbiAgICAgICAgICAgIHZhciBjaGF0SWQgPSAkKHRoaXMpLmNsb3Nlc3QoJy5taC1jaGF0LXJvdycpLmRhdGEoJ2NoYXQtaWQnKTtcbiAgICAgICAgICAgIHBhdGNoQm90KGJvdElkLCB7IGNoYXRzOiBbeyBpZDogTnVtYmVyKGNoYXRJZCksIGxpbmtlZF91c2VyX2lkOiBOdW1iZXIoJCh0aGlzKS52YWwoKSkgfV0gfSwgbnVsbCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25TYXZlRmFpbGVkJykpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHBhdGNoQm90KGJvdElkLCBwYXlsb2FkLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICBhcGlQYXRjaCgnL2JvdHMvJyArIGJvdElkLCBwYXlsb2FkLCBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgICAgICByZW5kZXJCb3RzKCk7XG4gICAgICAgICAgICBpZiAob25TdWNjZXNzKSB7IG9uU3VjY2Vzcyhib3QpOyB9XG4gICAgICAgIH0sIG9uRmFpbHVyZSB8fCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgc2hvd1RvYXN0KGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBlbXBsb3llZXMgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gbG9hZEVtcGxveWVlcyhkb25lKSB7XG4gICAgICAgIGlmIChzdGF0ZS5lbXBsb3llZXNMb2FkZWQpIHtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb3JlR2V0KCcvZXh0ZW5zaW9ucycsIHsgbGltaXQ6IDUwMCB9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgdmFyIGl0ZW1zID0gZGF0YS5pdGVtcyB8fCBbXTtcbiAgICAgICAgICAgIHZhciBzZWVuID0ge307XG4gICAgICAgICAgICB2YXIgbGlzdCA9IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIHZhciBpdGVtID0gaXRlbXNbaV07XG4gICAgICAgICAgICAgICAgdmFyIHVzZXJJZCA9IE51bWJlcihpdGVtLnVzZXJpZCk7XG4gICAgICAgICAgICAgICAgaWYgKCF1c2VySWQgfHwgc2Vlblt1c2VySWRdKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzZWVuW3VzZXJJZF0gPSB0cnVlO1xuICAgICAgICAgICAgICAgIHZhciBuYW1lID0gaXRlbS5jYWxsZXJpZCB8fCBpdGVtLm51bWJlciB8fCAoJyMnICsgdXNlcklkKTtcbiAgICAgICAgICAgICAgICB2YXIgbnVtYmVyID0gaXRlbS5udW1iZXIgPyBTdHJpbmcoaXRlbS5udW1iZXIpIDogJyc7XG4gICAgICAgICAgICAgICAgdmFyIGxhYmVsID0gKG51bWJlciAhPT0gJycgJiYgU3RyaW5nKG5hbWUpLmluZGV4T2YobnVtYmVyKSA9PT0gLTEpID8gbmFtZSArICcgKCcgKyBudW1iZXIgKyAnKScgOiBuYW1lO1xuICAgICAgICAgICAgICAgIGxpc3QucHVzaCh7IGlkOiB1c2VySWQsIGxhYmVsOiBsYWJlbCB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGxpc3Quc29ydChmdW5jdGlvbiAoYSwgYikgeyByZXR1cm4gYS5sYWJlbC5sb2NhbGVDb21wYXJlKGIubGFiZWwpOyB9KTtcbiAgICAgICAgICAgIHN0YXRlLmVtcGxveWVlcyA9IGxpc3Q7XG4gICAgICAgICAgICBzdGF0ZS5lbXBsb3llZXNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc3RhdGUuZW1wbG95ZWVzRmFpbGVkID0gZmFsc2U7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLmVtcGxveWVlc0xvYWRlZCA9IGZhbHNlO1xuICAgICAgICAgICAgc3RhdGUuZW1wbG95ZWVzRmFpbGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBib3QgbW9kYWwgLS0tLS0tLS0tLVxuXG4gICAgLy8gQ2hhbm5lbHMgd2l0aCBhIGJhY2tlbmQgYWRhcHRlciAoYm90aCBoYXZlIG9uZSBzaW5jZSBzdGFnZSAzYi8zYykuIFRoZSBjaGVja3MgYmVsb3cgc3RheSBhcyBhXG4gICAgLy8gZ3VhcmQ6IGEgY2hhbm5lbCB3aXRob3V0IGFuIGFkYXB0ZXIgb24gdGhlIHNlcnZlciBtdXN0IG5vdCBiZSBzYXZlZCBmcm9tIGEgc3RhbGUgcGFnZS5cbiAgICB2YXIgU0FWQUJMRV9DSEFOTkVMUyA9IFsndGVsZWdyYW0nLCAnbWF4J107XG5cbiAgICBmdW5jdGlvbiBvcGVuQm90TW9kYWwobW9kZSwgYm90LCBjaGFubmVsKSB7XG4gICAgICAgIHN0YXRlLmJvdE1vZGFsID0ge1xuICAgICAgICAgICAgbW9kZTogbW9kZSxcbiAgICAgICAgICAgIGJvdDogYm90LFxuICAgICAgICAgICAgY2hhbm5lbDogbW9kZSA9PT0gJ2VkaXQnICYmIGJvdCA/IChib3QuY2hhbm5lbCB8fCAndGVsZWdyYW0nKSA6IChjaGFubmVsID09PSAnbWF4JyA/ICdtYXgnIDogJ3RlbGVncmFtJyksXG4gICAgICAgICAgICBkcmFmdElkOiAwLFxuICAgICAgICAgICAgc2F2ZWQ6IGZhbHNlLFxuICAgICAgICAgICAgdG9rZW5DaGFuZ2VkOiBmYWxzZSxcbiAgICAgICAgICAgIGJ1c3k6IGZhbHNlXG4gICAgICAgIH07XG4gICAgICAgICQoJyNtaC1ib3QtY2hlY2stbWVzc2FnZScpLmVtcHR5KCk7XG4gICAgICAgICQoJyNtaC1ib3QtdGl0bGUtZmllbGQnKS5yZW1vdmVDbGFzcygnZXJyb3InKTtcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbi1yb3cnKS5yZW1vdmVDbGFzcygnZXJyb3InKTtcbiAgICAgICAgJCgnI21oLWJvdC1tb2RhbC10aXRsZScpLnRleHQobW9kZSA9PT0gJ2VkaXQnID8gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdEVkaXRUaXRsZScsIHsgdGl0bGU6IGJvdC50aXRsZSB9KSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdEFkZFRpdGxlJykpO1xuICAgICAgICAkKCcjbWgtYm90LXRpdGxlJykudmFsKGJvdCA/IGJvdC50aXRsZSA6ICcnKTtcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbicpLnZhbCgnJyk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4tbmV3JykudmFsKCcnKTtcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbi1uZXctcm93JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1ib3QtZGVsZXRlJykuYXR0cignaGlkZGVuJywgbW9kZSA9PT0gJ2VkaXQnID8gbnVsbCA6IHRydWUpO1xuICAgICAgICAkKCcjbWgtYm90LXNhdmUnKS50ZXh0KG1vZGUgPT09ICdlZGl0JyA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFNhdmUnKSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFNhdmVBbmRDb25uZWN0JykpO1xuICAgICAgICBpZiAobW9kZSA9PT0gJ2VkaXQnKSB7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRva2VuLXJvdycpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1oaW50LXJvdycpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1oaW50JykudGV4dCgn4oCi4oCi4oCi4oCiJyArIChib3QudG9rZW5faGludCB8fCAnJykpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1yb3cnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4taGludC1yb3cnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgfVxuICAgICAgICBzeW5jQm90Q2hhbm5lbCgpO1xuICAgICAgICAkKCcjbWgtYm90LW1vZGFsJykubW9kYWwoeyBjbG9zYWJsZTogZmFsc2UgfSkubW9kYWwoJ3Nob3cnKTtcbiAgICAgICAgJCgnI21oLWJvdC10aXRsZScpLnRyaWdnZXIoJ2ZvY3VzJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3luY0JvdENoYW5uZWwoKSB7XG4gICAgICAgIHZhciBtb2RhbCA9IHN0YXRlLmJvdE1vZGFsO1xuICAgICAgICBpZiAoIW1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAkKCcjbWgtYm90LW1vZGFsIC5taC1jaGFubmVsLWNhcmQnKS5lYWNoKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBjaGFubmVsID0gU3RyaW5nKCQodGhpcykuZGF0YSgnY2hhbm5lbCcpKTtcbiAgICAgICAgICAgIHZhciBzZWxlY3RlZCA9IGNoYW5uZWwgPT09IG1vZGFsLmNoYW5uZWw7XG4gICAgICAgICAgICB2YXIgbG9ja2VkID0gbW9kYWwubW9kZSA9PT0gJ2VkaXQnICYmICFzZWxlY3RlZDtcbiAgICAgICAgICAgICQodGhpcykudG9nZ2xlQ2xhc3MoJ2lzLXNlbGVjdGVkJywgc2VsZWN0ZWQpLnRvZ2dsZUNsYXNzKCdpcy1kaXNhYmxlZCcsIGxvY2tlZClcbiAgICAgICAgICAgICAgICAuYXR0cignYXJpYS1kaXNhYmxlZCcsIGxvY2tlZCA/ICd0cnVlJyA6IG51bGwpO1xuICAgICAgICAgICAgJCh0aGlzKS5maW5kKCdpbnB1dCcpLnByb3AoJ2NoZWNrZWQnLCBzZWxlY3RlZCkucHJvcCgnZGlzYWJsZWQnLCBsb2NrZWQpO1xuICAgICAgICB9KTtcbiAgICAgICAgdmFyIHNhdmFibGUgPSBTQVZBQkxFX0NIQU5ORUxTLmluZGV4T2YobW9kYWwuY2hhbm5lbCkgPj0gMDtcbiAgICAgICAgJCgnI21oLWJvdC1zYXZlLCAjbWgtYm90LWNoZWNrJykucHJvcCgnZGlzYWJsZWQnLCAhc2F2YWJsZSkudG9nZ2xlQ2xhc3MoJ2Rpc2FibGVkJywgIXNhdmFibGUpO1xuICAgICAgICAvLyBhIE1BWCB0b2tlbiBjb21lcyBmcm9tIGJ1c2luZXNzLm1heC5ydSBhZnRlciBtb2RlcmF0aW9uOyBUZWxlZ3JhbSBuZWVkcyBubyBleHBsYW5hdGlvblxuICAgICAgICB2YXIgbWF4SGVscCA9IG1vZGFsLmNoYW5uZWwgPT09ICdtYXgnO1xuICAgICAgICAkKCcjbWgtYm90LXRva2VuLWhlbHAnKS50ZXh0KG1heEhlbHAgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RUb2tlbkhlbHBNYXgnKSA6ICcnKTtcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbi1oZWxwLXJvdycpLmF0dHIoJ2hpZGRlbicsIG1heEhlbHAgPyBudWxsIDogdHJ1ZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNNYXhUbHNDb2RlKGNvZGUpIHtcbiAgICAgICAgcmV0dXJuIFN0cmluZyhjb2RlIHx8ICcnKS5pbmRleE9mKCdtYXgudGxzLicpID09PSAwO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHRsc0Vycm9yVGV4dCgpIHtcbiAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c0NhRXJyb3InKSArICcuICcgKyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDYUVycm9ySGludCcpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJvdEZvcm1WYWx1ZXMoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0aXRsZTogU3RyaW5nKCQoJyNtaC1ib3QtdGl0bGUnKS52YWwoKSB8fCAnJykudHJpbSgpLFxuICAgICAgICAgICAgdG9rZW46IFN0cmluZygkKCcjbWgtYm90LXRva2VuJykudmFsKCkgfHwgJycpLnRyaW0oKSxcbiAgICAgICAgICAgIHRva2VuTmV3OiBTdHJpbmcoJCgnI21oLWJvdC10b2tlbi1uZXcnKS52YWwoKSB8fCAnJykudHJpbSgpXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2hvd0JvdE1lc3NhZ2Uoa2luZCwgdGV4dCkge1xuICAgICAgICB2YXIgY2xzID0ga2luZCA9PT0gJ29rJyA/ICd1aSBwb3NpdGl2ZSBtZXNzYWdlJyA6IChraW5kID09PSAnd2FybicgPyAndWkgd2FybmluZyBtZXNzYWdlJyA6ICd1aSBuZWdhdGl2ZSBtZXNzYWdlJyk7XG4gICAgICAgIHZhciBpY29uID0ga2luZCA9PT0gJ29rJ1xuICAgICAgICAgICAgPyAnPGNpcmNsZSBjeD1cIjhcIiBjeT1cIjhcIiByPVwiNi4yNVwiLz48cGF0aCBkPVwiTTUuNSA4LjJsMS44IDEuOCAzLjMtMy42XCIvPidcbiAgICAgICAgICAgIDogJzxjaXJjbGUgY3g9XCI4XCIgY3k9XCI4XCIgcj1cIjYuMjVcIi8+PHBhdGggZD1cIk02IDZsNCA0TTEwIDZsLTQgNFwiLz4nO1xuICAgICAgICAkKCcjbWgtYm90LWNoZWNrLW1lc3NhZ2UnKS5odG1sKCc8ZGl2IGNsYXNzPVwiJyArIGNscyArICdcIiByb2xlPVwic3RhdHVzXCI+J1xuICAgICAgICAgICAgKyAnPHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+JyArIGljb24gKyAnPC9zdmc+J1xuICAgICAgICAgICAgKyAnPGRpdj4nICsgZXNjKHRleHQpICsgJzwvZGl2PjwvZGl2PicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJvdENoZWNrTWVzc2FnZShib3QpIHtcbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICdvaycpIHtcbiAgICAgICAgICAgIHJldHVybiB7IGtpbmQ6ICdvaycsIHRleHQ6IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkT2snLCB7XG4gICAgICAgICAgICAgICAgdXNlcm5hbWU6IGJvdC5ib3RfdXNlcm5hbWUgfHwgYm90LmJvdF9leHRlcm5hbF9pZCxcbiAgICAgICAgICAgICAgICBuYW1lOiBib3QuYm90X3VzZXJuYW1lID8gJ0AnICsgYm90LmJvdF91c2VybmFtZSA6IGJvdC50aXRsZVxuICAgICAgICAgICAgfSkgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYm90Lmxhc3RfZXJyb3JfY29kZSA9PT0gJ290aGVyX2JvdCcpIHtcbiAgICAgICAgICAgIHJldHVybiB7IGtpbmQ6ICd3YXJuJywgdGV4dDogdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrZWRPdGhlcicsIHtcbiAgICAgICAgICAgICAgICB1c2VybmFtZTogYm90LmJvdF91c2VybmFtZSB8fCAnJyxcbiAgICAgICAgICAgICAgICBib3Q6IGJvdC50aXRsZVxuICAgICAgICAgICAgfSkgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYm90LnN0YXR1cyA9PT0gJ3Rva2VuX2ludmFsaWQnKSB7XG4gICAgICAgICAgICByZXR1cm4geyBraW5kOiAnZXJyJywgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZDQwMScpIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICdjYV9lcnJvcicgfHwgaXNNYXhUbHNDb2RlKGJvdC5sYXN0X2Vycm9yX2NvZGUpKSB7XG4gICAgICAgICAgICByZXR1cm4geyBraW5kOiAnZXJyJywgdGV4dDogdGxzRXJyb3JUZXh0KCkgfTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geyBraW5kOiAnd2FybicsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrTmV0d29yaycpICsgKGJvdC5sYXN0X2Vycm9yX2NvZGUgPyAnICgnICsgYm90Lmxhc3RfZXJyb3JfY29kZSArICcpJyA6ICcnKSB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNoZWNrQm90Rm9ybSgpIHtcbiAgICAgICAgaWYgKCFzdGF0ZS5ib3RNb2RhbCB8fCBTQVZBQkxFX0NIQU5ORUxTLmluZGV4T2Yoc3RhdGUuYm90TW9kYWwuY2hhbm5lbCkgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHZhbHVlcyA9IGJvdEZvcm1WYWx1ZXMoKTtcbiAgICAgICAgaWYgKHZhbHVlcy50aXRsZSA9PT0gJycpIHtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdGl0bGUtZmllbGQnKS5hZGRDbGFzcygnZXJyb3InKTtcbiAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RUaXRsZVJlcXVpcmVkJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC1ib3QtdGl0bGUtZmllbGQnKS5yZW1vdmVDbGFzcygnZXJyb3InKTtcbiAgICAgICAgdmFyIG1vZGUgPSBzdGF0ZS5ib3RNb2RhbC5tb2RlO1xuICAgICAgICB2YXIgcGF5bG9hZDtcbiAgICAgICAgdmFyIGRvbmUgPSBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICBzdGF0ZS5ib3RNb2RhbC5ib3QgPSBib3Q7XG4gICAgICAgICAgICBzdGF0ZS5ib3RNb2RhbC5kcmFmdElkID0gYm90LmlkO1xuICAgICAgICAgICAgcmVwbGFjZUJvdChib3QpO1xuICAgICAgICAgICAgdmFyIG1lc3NhZ2UgPSBib3RDaGVja01lc3NhZ2UoYm90KTtcbiAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKG1lc3NhZ2Uua2luZCwgbWVzc2FnZS50ZXh0KTtcbiAgICAgICAgfTtcbiAgICAgICAgdmFyIGZhaWx1cmUgPSBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICBpZiAoZXJyLmZpZWxkID09PSAndG9rZW4nKSB7XG4gICAgICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1yb3cnKS5hZGRDbGFzcygnZXJyb3InKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCBmYWlsdXJlVGV4dChlcnIpKTtcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKG1vZGUgPT09ICdhZGQnKSB7XG4gICAgICAgICAgICBwYXlsb2FkID0geyBjaGFubmVsOiBzdGF0ZS5ib3RNb2RhbC5jaGFubmVsLCB0aXRsZTogdmFsdWVzLnRpdGxlLCB0b2tlbjogdmFsdWVzLnRva2VuIH07XG4gICAgICAgICAgICBpZiAoc3RhdGUuYm90TW9kYWwuZHJhZnRJZCA+IDApIHtcbiAgICAgICAgICAgICAgICBhcGlQYXRjaCgnL2JvdHMvJyArIHN0YXRlLmJvdE1vZGFsLmRyYWZ0SWQsIHsgdGl0bGU6IHZhbHVlcy50aXRsZSwgdG9rZW46IHZhbHVlcy50b2tlbiB9LCBkb25lLCBmYWlsdXJlKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgYXBpUG9zdCgnL2JvdHMnLCBwYXlsb2FkLCBkb25lLCBmYWlsdXJlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAodmFsdWVzLnRva2VuTmV3ICE9PSAnJykge1xuICAgICAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIHN0YXRlLmJvdE1vZGFsLmJvdC5pZCArICc6Y2hlY2tUb2tlbicsIHsgdG9rZW46IHZhbHVlcy50b2tlbk5ldyB9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgICAgIGlmIChkYXRhLm9rKSB7XG4gICAgICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdvaycsIHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkT2snLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICB1c2VybmFtZTogZGF0YS51c2VybmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IGRhdGEuZGlzcGxheV9uYW1lXG4gICAgICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGRhdGEuZXJyb3JfY29kZSA9PT0gJ290aGVyX2JvdCcpIHtcbiAgICAgICAgICAgICAgICAgICAgc2hvd0JvdE1lc3NhZ2UoJ3dhcm4nLCB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZE90aGVyJywge1xuICAgICAgICAgICAgICAgICAgICAgICAgdXNlcm5hbWU6IGRhdGEudXNlcm5hbWUgfHwgJycsXG4gICAgICAgICAgICAgICAgICAgICAgICBib3Q6IHN0YXRlLmJvdE1vZGFsLmJvdC50aXRsZVxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChkYXRhLmVycm9yX2NvZGUgPT09ICd0ZWxlZ3JhbS40MDEudW5hdXRob3JpemVkJyB8fCBkYXRhLmVycm9yX2NvZGUgPT09ICdtYXguNDAxLnVuYXV0aG9yaXplZCcpIHtcbiAgICAgICAgICAgICAgICAgICAgc2hvd0JvdE1lc3NhZ2UoJ2VycicsIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrZWQ0MDEnKSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChpc01heFRsc0NvZGUoZGF0YS5lcnJvcl9jb2RlKSkge1xuICAgICAgICAgICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgdGxzRXJyb3JUZXh0KCkpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCd3YXJuJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tOZXR3b3JrJykgKyAnICgnICsgZGF0YS5lcnJvcl9jb2RlICsgJyknKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCBmYWlsdXJlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhcGlQb3N0KCcvYm90cy8nICsgc3RhdGUuYm90TW9kYWwuYm90LmlkICsgJzpjaGVja1Rva2VuJywge30sIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgIGlmIChkYXRhLm9rKSB7XG4gICAgICAgICAgICAgICAgc2hvd0JvdE1lc3NhZ2UoJ29rJywgdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrZWRPaycsIHtcbiAgICAgICAgICAgICAgICAgICAgdXNlcm5hbWU6IGRhdGEudXNlcm5hbWUsXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGRhdGEuZGlzcGxheV9uYW1lXG4gICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChpc01heFRsc0NvZGUoZGF0YS5lcnJvcl9jb2RlKSkge1xuICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCB0bHNFcnJvclRleHQoKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkNDAxJykpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LCBmYWlsdXJlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlQm90Rm9ybSgpIHtcbiAgICAgICAgaWYgKCFzdGF0ZS5ib3RNb2RhbCB8fCBTQVZBQkxFX0NIQU5ORUxTLmluZGV4T2Yoc3RhdGUuYm90TW9kYWwuY2hhbm5lbCkgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHZhbHVlcyA9IGJvdEZvcm1WYWx1ZXMoKTtcbiAgICAgICAgaWYgKHZhbHVlcy50aXRsZSA9PT0gJycpIHtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdGl0bGUtZmllbGQnKS5hZGRDbGFzcygnZXJyb3InKTtcbiAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RUaXRsZVJlcXVpcmVkJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBtb2RlID0gc3RhdGUuYm90TW9kYWwubW9kZTtcbiAgICAgICAgdmFyIGZpbmlzaCA9IGZ1bmN0aW9uIChib3QpIHtcbiAgICAgICAgICAgIHN0YXRlLmJvdE1vZGFsLnNhdmVkID0gdHJ1ZTtcbiAgICAgICAgICAgIHJlcGxhY2VCb3QoYm90KTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtbW9kYWwnKS5tb2RhbCgnaGlkZScpO1xuICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICBpZiAobW9kZSA9PT0gJ2FkZCcpIHtcbiAgICAgICAgICAgICAgICBvcGVuQ2hhdE1vZGFsKGJvdCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25TYXZlZCcpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgdmFyIGZhaWx1cmUgPSBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICBpZiAoZXJyLmZpZWxkID09PSAndG9rZW4nKSB7XG4gICAgICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1yb3cnKS5hZGRDbGFzcygnZXJyb3InKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCBmYWlsdXJlVGV4dChlcnIpKTtcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKG1vZGUgPT09ICdhZGQnKSB7XG4gICAgICAgICAgICB2YXIgY3JlYXRlID0gZnVuY3Rpb24gKGlkKSB7XG4gICAgICAgICAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIGlkICsgJzpkaXNjb3ZlckNoYXRzJywge30sIGZ1bmN0aW9uIChib3QpIHtcbiAgICAgICAgICAgICAgICAgICAgZmluaXNoKGJvdCk7XG4gICAgICAgICAgICAgICAgfSwgZmFpbHVyZSk7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgaWYgKHN0YXRlLmJvdE1vZGFsLmRyYWZ0SWQgPiAwKSB7XG4gICAgICAgICAgICAgICAgYXBpUGF0Y2goJy9ib3RzLycgKyBzdGF0ZS5ib3RNb2RhbC5kcmFmdElkLCB7IHRpdGxlOiB2YWx1ZXMudGl0bGUsIHRva2VuOiB2YWx1ZXMudG9rZW4gfSwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgICAgICAgICAgICAgIGNyZWF0ZShib3QuaWQpO1xuICAgICAgICAgICAgICAgIH0sIGZhaWx1cmUpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBhcGlQb3N0KCcvYm90cycsIHsgY2hhbm5lbDogc3RhdGUuYm90TW9kYWwuY2hhbm5lbCwgdGl0bGU6IHZhbHVlcy50aXRsZSwgdG9rZW46IHZhbHVlcy50b2tlbiB9LCBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICAgICAgICAgIHJlcGxhY2VCb3QoYm90KTtcbiAgICAgICAgICAgICAgICAgICAgY3JlYXRlKGJvdC5pZCk7XG4gICAgICAgICAgICAgICAgfSwgZmFpbHVyZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHBheWxvYWQgPSB7IHRpdGxlOiB2YWx1ZXMudGl0bGUgfTtcbiAgICAgICAgaWYgKHZhbHVlcy50b2tlbk5ldyAhPT0gJycpIHtcbiAgICAgICAgICAgIHBheWxvYWQudG9rZW4gPSB2YWx1ZXMudG9rZW5OZXc7XG4gICAgICAgIH1cbiAgICAgICAgYXBpUGF0Y2goJy9ib3RzLycgKyBzdGF0ZS5ib3RNb2RhbC5ib3QuaWQsIHBheWxvYWQsIGZpbmlzaCwgZmFpbHVyZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2FuY2VsQm90TW9kYWwoKSB7XG4gICAgICAgIHZhciBtb2RhbCA9IHN0YXRlLmJvdE1vZGFsO1xuICAgICAgICBzdGF0ZS5ib3RNb2RhbCA9IG51bGw7XG4gICAgICAgICQoJyNtaC1ib3QtbW9kYWwnKS5tb2RhbCgnaGlkZScpO1xuICAgICAgICBpZiAobW9kYWwgJiYgbW9kYWwuZHJhZnRJZCA+IDAgJiYgIW1vZGFsLnNhdmVkKSB7XG4gICAgICAgICAgICAvLyB0aGUgXCLQn9GA0L7QstC10YDQuNGC0YxcIiBidXR0b24gY3JlYXRlZCB0aGUgZHJhZnQ6IGNhbmNlbGxpbmcgbXVzdCBub3QgbGVhdmUgaXQgYmVoaW5kXG4gICAgICAgICAgICBhcGlEZWxldGUoJy9ib3RzLycgKyBtb2RhbC5kcmFmdElkLCBmdW5jdGlvbiAoKSB7IGxvYWRCb3RzKHRydWUpOyB9LCBmdW5jdGlvbiAoKSB7IGxvYWRCb3RzKHRydWUpOyB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY29uZmlybURlbGV0ZUJvdCgpIHtcbiAgICAgICAgdmFyIGJvdCA9IHN0YXRlLmJvdE1vZGFsLmJvdDtcbiAgICAgICAgaWYgKCFib3QpIHsgcmV0dXJuOyB9XG4gICAgICAgICQoJyNtaC1jb25maXJtLXRleHQnKS50ZXh0KHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3REZWxldGVDb25maXJtJywgeyB0aXRsZTogYm90LnRpdGxlLCBjb3VudDogKGJvdC5jaGF0cyB8fCBbXSkubGVuZ3RoIH0pKTtcbiAgICAgICAgJCgnI21oLWNvbmZpcm0tbW9kYWwnKS5tb2RhbCh7IGNsb3NhYmxlOiB0cnVlIH0pLm1vZGFsKCdzaG93Jyk7XG4gICAgICAgICQoJyNtaC1jb25maXJtLW9rJykub2ZmKCdjbGljaycpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgICAgIGFwaURlbGV0ZSgnL2JvdHMvJyArIGJvdC5pZCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHN0YXRlLmJvdE1vZGFsLnNhdmVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBzdGF0ZS5ib3RNb2RhbC5kcmFmdElkID0gMDtcbiAgICAgICAgICAgICAgICAkKCcjbWgtYm90LW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uRGVsZXRlZCcpKTtcbiAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QoZmFpbHVyZVRleHQoZXJyKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBkaXNjb3ZlcnkgbW9kYWwgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gb3BlbkNoYXRNb2RhbChib3QpIHtcbiAgICAgICAgaWYgKCFib3QpIHsgcmV0dXJuOyB9XG4gICAgICAgIHN0YXRlLmNoYXRNb2RhbCA9IHsgYm90SWQ6IGJvdC5pZCwgYm90OiBib3QsIHRpbWVyOiBudWxsLCBzZWxlY3RlZDoge30gfTtcbiAgICAgICAgJCgnI21oLWNoYXQtbW9kYWwtdGl0bGUnKS50ZXh0KHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdFRpdGxlJywgeyB0aXRsZTogYm90LnRpdGxlIH0pKTtcbiAgICAgICAgdmFyIGlzTWF4ID0gYm90LmNoYW5uZWwgPT09ICdtYXgnO1xuICAgICAgICAkKCcjbWgtY2hhdC1zdGVwcycpLnRleHQodGYoaXNNYXggPyAnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RTdGVwc01heCcgOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RTdGVwcycsIHtcbiAgICAgICAgICAgIGJvdDogYm90LmJvdF91c2VybmFtZSA/ICdAJyArIGJvdC5ib3RfdXNlcm5hbWUgOiBib3QudGl0bGVcbiAgICAgICAgfSkpO1xuICAgICAgICAkKCcjbWgtY2hhdC1mb3VuZCcpLmVtcHR5KCk7XG4gICAgICAgICQoJyNtaC1jaGF0LWVycm9yJykuZW1wdHkoKTtcbiAgICAgICAgJCgnI21oLWNoYXQtZW1wdHknKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgJCgnI21oLWNoYXQtYWdhaW4nKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgJCgnI21oLWNoYXQtc3RvcCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAkKCcjbWgtY2hhdC1zYXZlJykuYXR0cignZGlzYWJsZWQnLCB0cnVlKTtcbiAgICAgICAgJCgnI21oLWNoYXQtc3RhdHVzLXRleHQnKS50ZXh0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0U2VhcmNoaW5nJykpO1xuICAgICAgICAkKCcjbWgtY2hhdC1jb3VudGRvd24nKS50ZXh0KCcnKTtcbiAgICAgICAgJCgnI21oLWNoYXQtcHJvZ3Jlc3MgLmJhcicpLmNzcygnd2lkdGgnLCAnMCUnKTtcbiAgICAgICAgJCgnI21oLWNoYXQtbW9kYWwnKS5tb2RhbCh7IGNsb3NhYmxlOiBmYWxzZSB9KS5tb2RhbCgnc2hvdycpO1xuICAgICAgICBzdGFydERpc2NvdmVyeShib3QuaWQsIGZhbHNlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzdGFydERpc2NvdmVyeShib3RJZCwgcmVzdGFydCkge1xuICAgICAgICBhcGlQb3N0KCcvYm90cy8nICsgYm90SWQgKyAnOmRpc2NvdmVyQ2hhdHMnLCB7IHJlc3RhcnQ6IHJlc3RhcnQgPT09IHRydWUgfSwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgaWYgKCFzdGF0ZS5jaGF0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICBzdGF0ZS5jaGF0TW9kYWwuc2VsZWN0ZWQgPSB7fTtcbiAgICAgICAgICAgIHVwZGF0ZUNoYXRNb2RhbChib3QpO1xuICAgICAgICAgICAgc2NoZWR1bGVDaGF0UG9sbCgpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICBzaG93Q2hhdEVycm9yKGZhaWx1cmVUZXh0KGVycikpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzY2hlZHVsZUNoYXRQb2xsKCkge1xuICAgICAgICBzdG9wQ2hhdFBvbGwoKTtcbiAgICAgICAgc3RhdGUuY2hhdE1vZGFsLnRpbWVyID0gc2V0SW50ZXJ2YWwoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCFzdGF0ZS5jaGF0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICBhcGlHZXQoJy9ib3RzLycgKyBzdGF0ZS5jaGF0TW9kYWwuYm90SWQsIHt9LCBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS5jaGF0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICAgICAgdXBkYXRlQ2hhdE1vZGFsKGJvdCk7XG4gICAgICAgICAgICAgICAgaWYgKCFib3QuZGlzY292ZXJ5LmFjdGl2ZSkge1xuICAgICAgICAgICAgICAgICAgICBzdG9wQ2hhdFBvbGwoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoKSB7IC8qIGtlZXAgdGhlIGxhc3Qgc3RhdGUgKi8gfSk7XG4gICAgICAgIH0sIDIwMDApO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHN0b3BDaGF0UG9sbCgpIHtcbiAgICAgICAgaWYgKHN0YXRlLmNoYXRNb2RhbCAmJiBzdGF0ZS5jaGF0TW9kYWwudGltZXIgIT09IG51bGwpIHtcbiAgICAgICAgICAgIGNsZWFySW50ZXJ2YWwoc3RhdGUuY2hhdE1vZGFsLnRpbWVyKTtcbiAgICAgICAgICAgIHN0YXRlLmNoYXRNb2RhbC50aW1lciA9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiB1cGRhdGVDaGF0TW9kYWwoYm90KSB7XG4gICAgICAgIGlmICghc3RhdGUuY2hhdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICBzdGF0ZS5jaGF0TW9kYWwuYm90ID0gYm90O1xuICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgIHZhciBkaXNjb3ZlcnkgPSBib3QuZGlzY292ZXJ5IHx8IHsgYWN0aXZlOiBmYWxzZSwgc3RhdHVzOiAnaWRsZScsIGZvdW5kOiBbXSB9O1xuICAgICAgICB2YXIgZm91bmQgPSBkaXNjb3ZlcnkuZm91bmQgfHwgW107XG4gICAgICAgIHZhciBzZWxlY3RlZENvdW50ID0gMDtcbiAgICAgICAgdmFyIGh0bWwgPSAnJztcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmb3VuZC5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGl0ZW0gPSBmb3VuZFtpXTtcbiAgICAgICAgICAgIHZhciBpbkJvdCA9IGZpbmRDaGF0QnlFeHRlcm5hbChib3QsIGl0ZW0uY2hhdF9pZCk7XG4gICAgICAgICAgICBpZiAoIWl0ZW0uYWxyZWFkeV9jb25uZWN0ZWQgJiYgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkW2l0ZW0uY2hhdF9pZF0gIT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkW2l0ZW0uY2hhdF9pZF0gPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFyIGNoZWNrZWQgPSAhaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCAmJiBzdGF0ZS5jaGF0TW9kYWwuc2VsZWN0ZWRbaXRlbS5jaGF0X2lkXSA9PT0gdHJ1ZTtcbiAgICAgICAgICAgIGlmIChjaGVja2VkKSB7IHNlbGVjdGVkQ291bnQrKzsgfVxuICAgICAgICAgICAgaHRtbCArPSAnPGxhYmVsIGNsYXNzPVwibWgtZm91bmQtcm93JyArIChpdGVtLmFscmVhZHlfY29ubmVjdGVkID8gJyBpcy1jb25uZWN0ZWQnIDogJycpICsgJ1wiIGRhdGEtY2hhdC1yb3c9XCInICsgKGluQm90ID8gaW5Cb3QuaWQgOiAwKSArICdcIiBkYXRhLWNoYXQta2V5PVwiJyArIGVzYyhpdGVtLmNoYXRfaWQpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cInVpIGNoZWNrYm94JyArIChjaGVja2VkID8gJyBjaGVja2VkJyA6ICcnKSArIChpdGVtLmFscmVhZHlfY29ubmVjdGVkID8gJyBkaXNhYmxlZCcgOiAnJykgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjbGFzcz1cImhpZGRlbiBtaC1mb3VuZC1jaGVja1wiJyArIChjaGVja2VkID8gJyBjaGVja2VkJyA6ICcnKSArIChpdGVtLmFscmVhZHlfY29ubmVjdGVkID8gJyBkaXNhYmxlZCcgOiAnJykgKyAnPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWJveFwiPjwvc3Bhbj48L3NwYW4+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtZm91bmQtdGl0bGVcIj48YiBjbGFzcz1cIm1oLXRydW5jYXRlXCI+JyArIGVzYyhpdGVtLnRpdGxlIHx8IGl0ZW0uY2hhdF9pZCkgKyAnPC9iPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1ldGFcIj4nICsgZXNjKGNoYXRLaW5kTGFiZWwoaXRlbS5jaGF0X2tpbmQpKSArICc8L3NwYW4+PC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cInVpICcgKyAoaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCA/ICdsYWJlbCcgOiAnYmx1ZSBsYWJlbCcpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArIGVzYyhpdGVtLmFscmVhZHlfY29ubmVjdGVkID8gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RFeGlzdHMnKSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0TmV3JykpICsgJzwvc3Bhbj48L2xhYmVsPic7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLWNoYXQtZm91bmQnKS5odG1sKGh0bWwpO1xuICAgICAgICAkKCcjbWgtY2hhdC1zYXZlJykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RTYXZlJywgeyBjb3VudDogc2VsZWN0ZWRDb3VudCB9KSk7XG4gICAgICAgICQoJyNtaC1jaGF0LXNhdmUnKS5hdHRyKCdkaXNhYmxlZCcsIHNlbGVjdGVkQ291bnQgPT09IDAgPyB0cnVlIDogbnVsbCk7XG5cbiAgICAgICAgdmFyIHN0YXR1c1RleHQgPSAnJztcbiAgICAgICAgdmFyIGNvdW50ZG93biA9ICcnO1xuICAgICAgICB2YXIgcHJvZ3Jlc3MgPSAwO1xuICAgICAgICBpZiAoZGlzY292ZXJ5LmFjdGl2ZSkge1xuICAgICAgICAgICAgaWYgKGZvdW5kLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNUZXh0ID0gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0Rm91bmQnLCB7IGNvdW50OiBmb3VuZC5sZW5ndGggfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHN0YXR1c1RleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdFNlYXJjaGluZycpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY291bnRkb3duID0gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0UmVtYWluaW5nJywgeyB0aW1lOiBmbXRDb3VudGRvd24oZGlzY292ZXJ5LnJlbWFpbmluZ19zZWMpIH0pO1xuICAgICAgICAgICAgcHJvZ3Jlc3MgPSBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIE1hdGgucm91bmQoKDMwMCAtIGRpc2NvdmVyeS5yZW1haW5pbmdfc2VjKSAvIDMwMCAqIDEwMCkpKTtcbiAgICAgICAgICAgICQoJyNtaC1jaGF0LWVtcHR5JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICAgICAkKCcjbWgtY2hhdC1lcnJvcicpLmVtcHR5KCk7XG4gICAgICAgICAgICAkKCcjbWgtY2hhdC1hZ2FpbicpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLWNoYXQtc3RvcCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgJCgnI21oLWNoYXQtc3RvcCcpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLWNoYXQtYWdhaW4nKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgIGlmIChkaXNjb3Zlcnkuc3RhdHVzID09PSAnZXJyb3InKSB7XG4gICAgICAgICAgICAgICAgdmFyIGNvZGUgPSBTdHJpbmcoZGlzY292ZXJ5Lmxhc3RfZXJyb3JfY29kZSB8fCAnJyk7XG4gICAgICAgICAgICAgICAgdmFyIHRleHQ7XG4gICAgICAgICAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MDkud2ViaG9va19zZXQnKSB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdEVycm9yV2ViaG9vaycpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoY29kZSA9PT0gJ21heC40MDUud2ViaG9va19zZXQnKSB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdEVycm9yV2ViaG9va01heCcpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoaXNNYXhUbHNDb2RlKGNvZGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQgPSB0bHNFcnJvclRleHQoKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNvZGUgPT09ICdtYXguNDAxLnVuYXV0aG9yaXplZCcgfHwgY29kZSA9PT0gJ3RlbGVncmFtLjQwMS51bmF1dGhvcml6ZWQnKSB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkNDAxJyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGV4dCA9IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0RXJyb3InKSArICcgKCcgKyBjb2RlICsgJyknO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzaG93Q2hhdEVycm9yKHRleHQpO1xuICAgICAgICAgICAgICAgIHN0YXR1c1RleHQgPSAnJztcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZGlzY292ZXJ5LnN0YXR1cyA9PT0gJ2VtcHR5Jykge1xuICAgICAgICAgICAgICAgIHN0YXR1c1RleHQgPSAnJztcbiAgICAgICAgICAgICAgICAkKCcjbWgtY2hhdC1lbXB0eScpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChmb3VuZC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgc3RhdHVzVGV4dCA9IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdFRpbWVvdXQnLCB7IGNvdW50OiBmb3VuZC5sZW5ndGggfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHN0YXR1c1RleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdE5vU2Vzc2lvbicpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY291bnRkb3duID0gJyc7XG4gICAgICAgICAgICBwcm9ncmVzcyA9IDEwMDtcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtY2hhdC1zdGF0dXMtdGV4dCcpLnRleHQoc3RhdHVzVGV4dCk7XG4gICAgICAgICQoJyNtaC1jaGF0LWNvdW50ZG93bicpLnRleHQoY291bnRkb3duKTtcbiAgICAgICAgJCgnI21oLWNoYXQtcHJvZ3Jlc3MgLmJhcicpLmNzcygnd2lkdGgnLCBwcm9ncmVzcyArICclJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZmluZENoYXRCeUV4dGVybmFsKGJvdCwgY2hhdElkKSB7XG4gICAgICAgIHZhciBjaGF0cyA9IGJvdC5jaGF0cyB8fCBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGF0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKFN0cmluZyhjaGF0c1tpXS5jaGF0X2lkKSA9PT0gU3RyaW5nKGNoYXRJZCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gY2hhdHNbaV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2hvd0NoYXRFcnJvcih0ZXh0KSB7XG4gICAgICAgICQoJyNtaC1jaGF0LWVycm9yJykuaHRtbCgnPGRpdiBjbGFzcz1cInVpIG5lZ2F0aXZlIG1lc3NhZ2VcIiByb2xlPVwiYWxlcnRcIj4nXG4gICAgICAgICAgICArICc8c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBhcmlhLWhpZGRlbj1cInRydWVcIj48Y2lyY2xlIGN4PVwiOFwiIGN5PVwiOFwiIHI9XCI2LjI1XCIvPjxwYXRoIGQ9XCJNNiA2bDQgNE0xMCA2bC00IDRcIi8+PC9zdmc+J1xuICAgICAgICAgICAgKyAnPGRpdj4nICsgZXNjKHRleHQpICsgJzwvZGl2PjwvZGl2PicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJpbmRDaGF0Rm91bmQoKSB7XG4gICAgICAgICQoJyNtaC1jaGF0LWZvdW5kJykub24oJ2NoYW5nZScsICcubWgtZm91bmQtY2hlY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoIXN0YXRlLmNoYXRNb2RhbCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHZhciBrZXkgPSBTdHJpbmcoJCh0aGlzKS5jbG9zZXN0KCcubWgtZm91bmQtcm93JykuZGF0YSgnY2hhdC1rZXknKSk7XG4gICAgICAgICAgICBzdGF0ZS5jaGF0TW9kYWwuc2VsZWN0ZWRba2V5XSA9ICQodGhpcykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICAgICAgdXBkYXRlQ2hhdE1vZGFsKHN0YXRlLmNoYXRNb2RhbC5ib3QpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlU2VsZWN0ZWRDaGF0cygpIHtcbiAgICAgICAgaWYgKCFzdGF0ZS5jaGF0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgIHZhciBib3QgPSBzdGF0ZS5jaGF0TW9kYWwuYm90O1xuICAgICAgICB2YXIgcGF0Y2hlcyA9IFtdO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IChib3QuZGlzY292ZXJ5LmZvdW5kIHx8IFtdKS5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGl0ZW0gPSBib3QuZGlzY292ZXJ5LmZvdW5kW2ldO1xuICAgICAgICAgICAgaWYgKGl0ZW0uYWxyZWFkeV9jb25uZWN0ZWQgfHwgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkW2l0ZW0uY2hhdF9pZF0gIT09IHRydWUpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBjaGF0ID0gZmluZENoYXRCeUV4dGVybmFsKGJvdCwgaXRlbS5jaGF0X2lkKTtcbiAgICAgICAgICAgIGlmIChjaGF0KSB7XG4gICAgICAgICAgICAgICAgcGF0Y2hlcy5wdXNoKHsgaWQ6IGNoYXQuaWQsIGVuYWJsZWQ6IHRydWUsIGNoYXRfa2luZDogaXRlbS5jaGF0X2tpbmQsIHRpdGxlOiBpdGVtLnRpdGxlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChwYXRjaGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGFwaVBhdGNoKCcvYm90cy8nICsgYm90LmlkLCB7IGNoYXRzOiBwYXRjaGVzIH0sIGZ1bmN0aW9uIChzYXZlZCkge1xuICAgICAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIGJvdC5pZCArICc6ZGlzY292ZXJDaGF0cycsIHsgc3RvcDogdHJ1ZSB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgY2xvc2VDaGF0TW9kYWwoKTtcbiAgICAgICAgICAgICAgICByZXBsYWNlQm90KHNhdmVkKTtcbiAgICAgICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZWQnKSk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgY2xvc2VDaGF0TW9kYWwoKTtcbiAgICAgICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZWQnKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgc2hvd0NoYXRFcnJvcihmYWlsdXJlVGV4dChlcnIpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2xvc2VDaGF0TW9kYWwoKSB7XG4gICAgICAgIHN0b3BDaGF0UG9sbCgpO1xuICAgICAgICBzdGF0ZS5jaGF0TW9kYWwgPSBudWxsO1xuICAgICAgICAkKCcjbWgtY2hhdC1tb2RhbCcpLm1vZGFsKCdoaWRlJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3RvcERpc2NvdmVyeUFuZENsb3NlKCkge1xuICAgICAgICB2YXIgYm90ID0gc3RhdGUuY2hhdE1vZGFsID8gc3RhdGUuY2hhdE1vZGFsLmJvdCA6IG51bGw7XG4gICAgICAgIGlmIChib3QpIHtcbiAgICAgICAgICAgIGFwaVBvc3QoJy9ib3RzLycgKyBib3QuaWQgKyAnOmRpc2NvdmVyQ2hhdHMnLCB7IHN0b3A6IHRydWUgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGNsb3NlQ2hhdE1vZGFsKCk7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgY2xvc2VDaGF0TW9kYWwoKTtcbiAgICAgICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2xvc2VDaGF0TW9kYWwoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gdGVzdCBtb2RhbCAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBvcGVuVGVzdE1vZGFsKGJvdCwgY2hhdElkcykge1xuICAgICAgICBpZiAoIWJvdCkgeyByZXR1cm47IH1cbiAgICAgICAgc3RhdGUudGVzdE1vZGFsID0geyBib3RJZDogYm90LmlkLCBib3Q6IGJvdCwgZXZlbnRJZDogMCwgY2hhdElkczogY2hhdElkcywgdGltZXI6IG51bGwsIHRyaWVzOiAwIH07XG4gICAgICAgICQoJyNtaC10ZXN0LWxpc3QnKS5odG1sKCc8ZGl2IGNsYXNzPVwibWgtbXV0ZWRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3RSdW5uaW5nJykpICsgJzwvZGl2PicpO1xuICAgICAgICAkKCcjbWgtdGVzdC1zdW1tYXJ5JykudGV4dCgnJyk7XG4gICAgICAgICQoJyNtaC10ZXN0LW1vZGFsJykubW9kYWwoeyBjbG9zYWJsZTogdHJ1ZSwgb25IaWRlOiBmdW5jdGlvbiAoKSB7IHN0b3BUZXN0UG9sbCgpOyB9IH0pLm1vZGFsKCdzaG93Jyk7XG4gICAgICAgIHZhciBwYXlsb2FkID0gY2hhdElkcyA9PT0gbnVsbCA/IHt9IDogeyBjaGF0X2lkczogY2hhdElkcyB9O1xuICAgICAgICBhcGlQb3N0KCcvYm90cy8nICsgYm90LmlkICsgJzpzZW5kVGVzdCcsIHBheWxvYWQsIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICBpZiAoIXN0YXRlLnRlc3RNb2RhbCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHN0YXRlLnRlc3RNb2RhbC5ldmVudElkID0gZGF0YS5ldmVudF9pZDtcbiAgICAgICAgICAgIHN0YXRlLnRlc3RNb2RhbC5ib3QgPSBkYXRhLmJvdDtcbiAgICAgICAgICAgIHJlcGxhY2VCb3QoZGF0YS5ib3QpO1xuICAgICAgICAgICAgcmVuZGVyVGVzdChkYXRhLmJvdCk7XG4gICAgICAgICAgICBzY2hlZHVsZVRlc3RQb2xsKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICQoJyNtaC10ZXN0LWxpc3QnKS5odG1sKCc8ZGl2IGNsYXNzPVwidWkgbmVnYXRpdmUgbWVzc2FnZVwiPjxkaXY+JyArIGVzYyhmYWlsdXJlVGV4dChlcnIpKSArICc8L2Rpdj48L2Rpdj4nKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2NoZWR1bGVUZXN0UG9sbCgpIHtcbiAgICAgICAgc3RvcFRlc3RQb2xsKCk7XG4gICAgICAgIHN0YXRlLnRlc3RNb2RhbC50aW1lciA9IHNldEludGVydmFsKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICghc3RhdGUudGVzdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgc3RhdGUudGVzdE1vZGFsLnRyaWVzKys7XG4gICAgICAgICAgICBhcGlHZXQoJy9ib3RzLycgKyBzdGF0ZS50ZXN0TW9kYWwuYm90SWQsIHt9LCBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS50ZXN0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICAgICAgc3RhdGUudGVzdE1vZGFsLmJvdCA9IGJvdDtcbiAgICAgICAgICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgICAgICAgICAgcmVuZGVyVGVzdChib3QpO1xuICAgICAgICAgICAgICAgIGlmICghdGVzdFBlbmRpbmcoYm90KSB8fCBzdGF0ZS50ZXN0TW9kYWwudHJpZXMgPiAyMCkge1xuICAgICAgICAgICAgICAgICAgICBzdG9wVGVzdFBvbGwoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgaWYgKHN0YXRlLnRlc3RNb2RhbCAmJiBzdGF0ZS50ZXN0TW9kYWwudHJpZXMgPiAzKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0b3BUZXN0UG9sbCgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9LCAyMDAwKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzdG9wVGVzdFBvbGwoKSB7XG4gICAgICAgIGlmIChzdGF0ZS50ZXN0TW9kYWwgJiYgc3RhdGUudGVzdE1vZGFsLnRpbWVyICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjbGVhckludGVydmFsKHN0YXRlLnRlc3RNb2RhbC50aW1lcik7XG4gICAgICAgICAgICBzdGF0ZS50ZXN0TW9kYWwudGltZXIgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdGVzdERlbGl2ZXJpZXMoYm90KSB7XG4gICAgICAgIHZhciBldmVudElkID0gc3RhdGUudGVzdE1vZGFsID8gc3RhdGUudGVzdE1vZGFsLmV2ZW50SWQgOiAwO1xuICAgICAgICB2YXIgcmVzdWx0ID0gW107XG4gICAgICAgIHZhciBjaGF0cyA9IGJvdC5jaGF0cyB8fCBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGF0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGRlbGl2ZXJ5ID0gY2hhdHNbaV0ubGFzdF9kZWxpdmVyeTtcbiAgICAgICAgICAgIGlmIChkZWxpdmVyeSAmJiBOdW1iZXIoZGVsaXZlcnkuZXZlbnRfaWQpID09PSBOdW1iZXIoZXZlbnRJZCkpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQucHVzaCh7IGNoYXQ6IGNoYXRzW2ldLCBkZWxpdmVyeTogZGVsaXZlcnkgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB0ZXN0UGVuZGluZyhib3QpIHtcbiAgICAgICAgdmFyIGxpc3QgPSB0ZXN0RGVsaXZlcmllcyhib3QpO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBzdGF0dXMgPSBsaXN0W2ldLmRlbGl2ZXJ5LnN0YXR1cztcbiAgICAgICAgICAgIGlmIChzdGF0dXMgPT09ICdwZW5kaW5nJyB8fCBzdGF0dXMgPT09ICdzZW5kaW5nJykge1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZWxpdmVyeVN0YXR1c0xhYmVsKGRlbGl2ZXJ5KSB7XG4gICAgICAgIGlmIChkZWxpdmVyeS5zdGF0dXMgPT09ICdzZW50JykgeyByZXR1cm4geyBjbHM6ICdpcy1vaycsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3REZWxpdmVyZWQnKSB9OyB9XG4gICAgICAgIGlmIChkZWxpdmVyeS5zdGF0dXMgPT09ICdwZW5kaW5nJyB8fCBkZWxpdmVyeS5zdGF0dXMgPT09ICdzZW5kaW5nJykgeyByZXR1cm4geyBjbHM6ICcnLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0UXVldWVkJykgfTsgfVxuICAgICAgICByZXR1cm4geyBjbHM6ICdpcy1lcnInLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0RXJyb3InKSB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlbGl2ZXJ5RXJyb3JUZXh0KGNvZGUpIHtcbiAgICAgICAgaWYgKGlzTWF4VGxzQ29kZShjb2RlKSkgeyByZXR1cm4gdGxzRXJyb3JUZXh0KCk7IH1cbiAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MDEudW5hdXRob3JpemVkJyB8fCBjb2RlID09PSAnbWF4LjQwMS51bmF1dGhvcml6ZWQnKSB7IHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkNDAxJyk7IH1cbiAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MDMua2lja2VkJyB8fCBjb2RlID09PSAndGVsZWdyYW0uNDAzLmJsb2NrZWQnIHx8IGNvZGUgPT09ICd0ZWxlZ3JhbS40MDAuY2hhdF9ub3RfZm91bmQnXG4gICAgICAgICAgICB8fCBjb2RlID09PSAnbWF4LjQwMy5jaGF0X2RlbmllZCcgfHwgY29kZSA9PT0gJ21heC40MDQubm90X2ZvdW5kJyB8fCBjb2RlID09PSAnbWF4LjQwNC51bmtub3duJykge1xuICAgICAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRTdGF0dXNHb25lJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MjkucmF0ZV9saW1pdCcgfHwgY29kZSA9PT0gJ21heC40MjkucmF0ZV9saW1pdCcpIHsgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRFcnJvclJhdGVMaW1pdCcpOyB9XG4gICAgICAgIGlmIChjb2RlID09PSAnc3RhbGUnKSB7IHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0RXJyb3JTdGFsZScpOyB9XG4gICAgICAgIHJldHVybiBjb2RlO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlclRlc3QoYm90KSB7XG4gICAgICAgIHZhciBsaXN0ID0gdGVzdERlbGl2ZXJpZXMoYm90KTtcbiAgICAgICAgdmFyIGNvdW50cyA9IHsgc2VudDogMCwgcGVuZGluZzogMCwgZmFpbGVkOiAwIH07XG4gICAgICAgIHZhciBodG1sID0gJyc7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGNoYXQgPSBsaXN0W2ldLmNoYXQ7XG4gICAgICAgICAgICB2YXIgZGVsaXZlcnkgPSBsaXN0W2ldLmRlbGl2ZXJ5O1xuICAgICAgICAgICAgdmFyIGxhYmVsID0gZGVsaXZlcnlTdGF0dXNMYWJlbChkZWxpdmVyeSk7XG4gICAgICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAnc2VudCcpIHsgY291bnRzLnNlbnQrKzsgfVxuICAgICAgICAgICAgZWxzZSBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAncGVuZGluZycgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnc2VuZGluZycpIHsgY291bnRzLnBlbmRpbmcrKzsgfVxuICAgICAgICAgICAgZWxzZSB7IGNvdW50cy5mYWlsZWQrKzsgfVxuICAgICAgICAgICAgdmFyIHJldHJ5ID0gKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2ZhaWxlZCcgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnZHJvcHBlZCcpXG4gICAgICAgICAgICAgICAgPyAnPGJ1dHRvbiBjbGFzcz1cInVpIGJhc2ljIGJ1dHRvbiBtaC10ZXN0LXJldHJ5XCIgdHlwZT1cImJ1dHRvblwiIGRhdGEtY2hhdC1pZD1cIicgKyBjaGF0LmlkICsgJ1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdFJldHJ5JykpICsgJzwvYnV0dG9uPidcbiAgICAgICAgICAgICAgICA6ICcnO1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIm1oLXRlc3Qtcm93XCI+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyICcgKyAoYm90LmNoYW5uZWwgPT09ICdtYXgnID8gJ21heCcgOiAndGcnKSArICcgc1wiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPicgKyAoYm90LmNoYW5uZWwgPT09ICdtYXgnID8gJ01BWCcgOiAnVEcnKSArICc8L3NwYW4+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC10ZXN0LXRpdGxlXCI+PGRpdiBjbGFzcz1cIm1oLXRydW5jYXRlXCI+JyArIGVzYyhjaGF0LnRpdGxlIHx8IGNoYXQuY2hhdF9pZCkgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgKGRlbGl2ZXJ5Lmxhc3RfZXJyb3JfY29kZSA/ICc8ZGl2IGNsYXNzPVwibWgtbWV0YSBtaC1lcnJvci10ZXh0XCI+JyArIGVzYyhkZWxpdmVyeUVycm9yVGV4dChkZWxpdmVyeS5sYXN0X2Vycm9yX2NvZGUpKSArICc8L2Rpdj4nIDogJycpXG4gICAgICAgICAgICAgICAgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtdGVzdC1zdGF0ZSAnICsgbGFiZWwuY2xzICsgJ1wiPicgKyBlc2MobGFiZWwudGV4dCkgKyAnPC9zcGFuPicgKyByZXRyeSArICc8L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmIChodG1sID09PSAnJykge1xuICAgICAgICAgICAgaHRtbCA9ICc8ZGl2IGNsYXNzPVwibWgtbXV0ZWRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3RSdW5uaW5nJykpICsgJzwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLXRlc3QtbGlzdCcpLmh0bWwoaHRtbCk7XG4gICAgICAgICQoJyNtaC10ZXN0LXN1bW1hcnknKS50ZXh0KHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0U3VtbWFyeScsIHtcbiAgICAgICAgICAgIG9rOiBjb3VudHMuc2VudCxcbiAgICAgICAgICAgIGZhaWxlZDogY291bnRzLmZhaWxlZCxcbiAgICAgICAgICAgIHBlbmRpbmc6IGNvdW50cy5wZW5kaW5nXG4gICAgICAgIH0pKTtcbiAgICAgICAgJCgnI21oLXRlc3QtbGlzdCAubWgtdGVzdC1yZXRyeScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBjaGF0SWQgPSBOdW1iZXIoJCh0aGlzKS5kYXRhKCdjaGF0LWlkJykpO1xuICAgICAgICAgICAgb3BlblRlc3RNb2RhbChzdGF0ZS50ZXN0TW9kYWwgPyBzdGF0ZS50ZXN0TW9kYWwuYm90IDogYm90LCBbY2hhdElkXSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gZ2VuZXJhbCBzZXR0aW5ncyAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBsb2FkR2VuZXJhbFNldHRpbmdzKCkge1xuICAgICAgICBhcGlHZXQoJy9zZXR0aW5ncycsIHt9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgc3RhdGUucmV0ZW50aW9uID0gZGF0YS5ldmVudHNfcmV0ZW50aW9uX2RheXM7XG4gICAgICAgICAgICBzdGF0ZS5zZXR0aW5ncyA9IGRhdGE7XG4gICAgICAgICAgICAkKCcjbWgtcmV0ZW50aW9uLWlucHV0JykudmFsKGRhdGEuZXZlbnRzX3JldGVudGlvbl9kYXlzKTtcbiAgICAgICAgICAgICQoJyNtaC1wdWJsaWMtdXJsLWlucHV0JykudmFsKGRhdGEucGJ4X3B1YmxpY191cmwgfHwgJycpO1xuICAgICAgICAgICAgJCgnI21oLXByb3h5LWlucHV0JykudmFsKGRhdGEucHJveHlfdXJsIHx8ICcnKTtcbiAgICAgICAgICAgICQoJyNtaC1tYXgtY2EtaW5wdXQnKS52YWwoZGF0YS5tYXhfY2FfYnVuZGxlX3BhdGggfHwgJycpO1xuICAgICAgICAgICAgJCgnI21oLXF1ZXVlLW1pbi13YWl0LWlucHV0JykudmFsKGRhdGEucXVldWVfYWJhbmRvbl9taW5fd2FpdF9zZWMgfHwgMCk7XG4gICAgICAgICAgICAkKCcjbWgtcXVldWUtbG9uZy13YWl0LWlucHV0JykudmFsKGRhdGEucXVldWVfbG9uZ193YWl0X3NlYyB8fCAwKTtcbiAgICAgICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLXF1ZXVlLW1pbi13YWl0LWZpZWxkJyk7XG4gICAgICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC1xdWV1ZS1sb25nLXdhaXQtZmllbGQnKTtcbiAgICAgICAgICAgICQoJyNtaC1jb25maWctcXVpZXQtaW5wdXQnKS52YWwoZGF0YS5jb25maWdfY2hhbmdlX3F1aWV0X3NlYyk7XG4gICAgICAgICAgICAkKCcjbWgtZXh0ZXJuYWwtaXAtaW5wdXQnKS52YWwoZGF0YS5leHRlcm5hbF9pcF9wb2xsX21pbik7XG4gICAgICAgICAgICAkKCcjbWgtbGljZW5zZS1ob3Vycy1pbnB1dCcpLnZhbChkYXRhLmxpY2Vuc2VfcG9sbF9ob3Vycyk7XG4gICAgICAgICAgICAkKCcjbWgtbGljZW5zZS1kYXlzLWlucHV0JykudmFsKGRhdGEubGljZW5zZV93YXJuX2RheXMgfHwgJycpO1xuICAgICAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtbWF4LWNhLWZpZWxkJyk7XG4gICAgICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC1jb25maWctcXVpZXQtZmllbGQnKTtcbiAgICAgICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLWV4dGVybmFsLWlwLWZpZWxkJyk7XG4gICAgICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC1saWNlbnNlLWhvdXJzLWZpZWxkJyk7XG4gICAgICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC1saWNlbnNlLWRheXMtZmllbGQnKTtcbiAgICAgICAgICAgICQoJyNtaC1tYXNrLWRlZmF1bHQnKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsIGRhdGEubWFza19waG9uZV9kZWZhdWx0ID09PSB0cnVlKTtcbiAgICAgICAgICAgICQoJyNtaC1tYXNrLWRlZmF1bHQgaW5wdXQnKS5wcm9wKCdjaGVja2VkJywgZGF0YS5tYXNrX3Bob25lX2RlZmF1bHQgPT09IHRydWUpO1xuICAgICAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtcHVibGljLXVybC1maWVsZCcpO1xuICAgICAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtcHJveHktZmllbGQnKTtcbiAgICAgICAgICAgIGNsZWFyUmV0ZW50aW9uRXJyb3IoKTtcbiAgICAgICAgICAgIGxvYWRTZWN1cml0eVNldHRpbmdzKGRhdGEpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgbWFya1JldGVudGlvbkVycm9yKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25Mb2FkRXJyb3InLCB7XG4gICAgICAgICAgICAgICAgd2hhdDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfTG9hZFdoYXRTZXR0aW5ncycpLFxuICAgICAgICAgICAgICAgIGNvZGU6IGZhaWx1cmUuc3RhdHVzID4gMCA/IGZhaWx1cmUuc3RhdHVzIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uVGltZW91dCcpXG4gICAgICAgICAgICB9KSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVTZXR0aW5nKHBheWxvYWQsIGZpZWxkU2VsZWN0b3IsIHJldmVydCkge1xuICAgICAgICBhcGlQYXRjaCgnL3NldHRpbmdzJywgcGF5bG9hZCwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHN0YXRlLnNldHRpbmdzID0gZGF0YTtcbiAgICAgICAgICAgIGlmIChmaWVsZFNlbGVjdG9yKSB7IGNsZWFyRmllbGRFcnJvcihmaWVsZFNlbGVjdG9yKTsgfVxuICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVkJykpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgaWYgKGZpZWxkU2VsZWN0b3IpIHtcbiAgICAgICAgICAgICAgICBtYXJrRmllbGRFcnJvcihmaWVsZFNlbGVjdG9yLCBmYWlsdXJlVGV4dChmYWlsdXJlKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocmV2ZXJ0KSB7IHJldmVydCgpOyB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVQdWJsaWNVcmwoKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IFN0cmluZygkKCcjbWgtcHVibGljLXVybC1pbnB1dCcpLnZhbCgpIHx8ICcnKS50cmltKCk7XG4gICAgICAgIHZhciBwcmV2aW91cyA9IHN0YXRlLnNldHRpbmdzID8gc3RhdGUuc2V0dGluZ3MucGJ4X3B1YmxpY191cmwgOiAnJztcbiAgICAgICAgaWYgKHZhbHVlID09PSAnJykge1xuICAgICAgICAgICAgc2F2ZVNldHRpbmcoeyBwYnhfcHVibGljX3VybDogJycgfSwgJyNtaC1wdWJsaWMtdXJsLWZpZWxkJyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCEvXmh0dHBzPzpcXC9cXC9cXFMrJC9pLnRlc3QodmFsdWUpKSB7XG4gICAgICAgICAgICBtYXJrRmllbGRFcnJvcignI21oLXB1YmxpYy11cmwtZmllbGQnLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9TZXR0aW5nc1B1YmxpY1VybEludmFsaWQnKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgc2F2ZVNldHRpbmcoeyBwYnhfcHVibGljX3VybDogdmFsdWUgfSwgJyNtaC1wdWJsaWMtdXJsLWZpZWxkJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLXB1YmxpYy11cmwtaW5wdXQnKS52YWwocHJldmlvdXMpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlUHJveHkoKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IFN0cmluZygkKCcjbWgtcHJveHktaW5wdXQnKS52YWwoKSB8fCAnJykudHJpbSgpO1xuICAgICAgICB2YXIgcHJldmlvdXMgPSBzdGF0ZS5zZXR0aW5ncyA/IHN0YXRlLnNldHRpbmdzLnByb3h5X3VybCA6ICcnO1xuICAgICAgICBpZiAodmFsdWUgIT09ICcnICYmICEvXigoaHR0cHM/fHNvY2tzNWg/KTpcXC9cXC8pP1tBLVphLXowLTkuXFwtXSs6XFxkezEsNX0kLy50ZXN0KHZhbHVlKSkge1xuICAgICAgICAgICAgbWFya0ZpZWxkRXJyb3IoJyNtaC1wcm94eS1maWVsZCcsIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NldHRpbmdzUHJveHlJbnZhbGlkJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHNhdmVTZXR0aW5nKHsgcHJveHlfdXJsOiB2YWx1ZSB9LCAnI21oLXByb3h5LWZpZWxkJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLXByb3h5LWlucHV0JykudmFsKHByZXZpb3VzKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZU1heENhQnVuZGxlKCkge1xuICAgICAgICB2YXIgdmFsdWUgPSBTdHJpbmcoJCgnI21oLW1heC1jYS1pbnB1dCcpLnZhbCgpIHx8ICcnKS50cmltKCk7XG4gICAgICAgIHZhciBwcmV2aW91cyA9IHN0YXRlLnNldHRpbmdzID8gc3RhdGUuc2V0dGluZ3MubWF4X2NhX2J1bmRsZV9wYXRoIDogJyc7XG4gICAgICAgIGlmICh2YWx1ZSAhPT0gJycgJiYgdmFsdWUuY2hhckF0KDApICE9PSAnLycpIHtcbiAgICAgICAgICAgIG1hcmtGaWVsZEVycm9yKCcjbWgtbWF4LWNhLWZpZWxkJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU2V0dGluZ3NDYVBhdGhJbnZhbGlkJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHNhdmVTZXR0aW5nKHsgbWF4X2NhX2J1bmRsZV9wYXRoOiB2YWx1ZSB9LCAnI21oLW1heC1jYS1maWVsZCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1tYXgtY2EtaW5wdXQnKS52YWwocHJldmlvdXMpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlTWFza0RlZmF1bHQoKSB7XG4gICAgICAgIHZhciBjaGVja2VkID0gJCgnI21oLW1hc2stZGVmYXVsdCBpbnB1dCcpLnByb3AoJ2NoZWNrZWQnKTtcbiAgICAgICAgc2F2ZVNldHRpbmcoeyBtYXNrX3Bob25lX2RlZmF1bHQ6IGNoZWNrZWQgfSwgbnVsbCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLW1hc2stZGVmYXVsdCBpbnB1dCcpLnByb3AoJ2NoZWNrZWQnLCAhY2hlY2tlZCk7XG4gICAgICAgICAgICAkKCcjbWgtbWFzay1kZWZhdWx0JykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCAhY2hlY2tlZCk7XG4gICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZUZhaWxlZCcpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gUXVldWUgd2FpdCB0aHJlc2hvbGRzICgwLi4zNjAwIHMpLiAwIHR1cm5zIHRoZSBjaGVjayBvZmY7IHRoZSBzb3VyY2UgY2xhbXBzIGFnYWluIG9uIGl0cyBzaWRlLlxuICAgIGZ1bmN0aW9uIHNhdmVRdWV1ZVdhaXQoaW5wdXRTZWxlY3RvciwgZmllbGRTZWxlY3Rvciwga2V5KSB7XG4gICAgICAgIHZhciByYXcgPSBTdHJpbmcoJChpbnB1dFNlbGVjdG9yKS52YWwoKSB8fCAnJykudHJpbSgpO1xuICAgICAgICB2YXIgc2Vjb25kcyA9IC9eXFxkKyQvLnRlc3QocmF3KSA/IHBhcnNlSW50KHJhdywgMTApIDogLTE7XG4gICAgICAgIHZhciBwcmV2aW91cyA9IHN0YXRlLnNldHRpbmdzID8gTnVtYmVyKHN0YXRlLnNldHRpbmdzW2tleV0gfHwgMCkgOiAwO1xuICAgICAgICBpZiAoc2Vjb25kcyA8IDAgfHwgc2Vjb25kcyA+IDM2MDApIHtcbiAgICAgICAgICAgIG1hcmtGaWVsZEVycm9yKGZpZWxkU2VsZWN0b3IsIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NldHRpbmdzUXVldWVXYWl0RXJyb3InKSk7XG4gICAgICAgICAgICAkKGlucHV0U2VsZWN0b3IpLnZhbChwcmV2aW91cyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY2xlYXJGaWVsZEVycm9yKGZpZWxkU2VsZWN0b3IpO1xuICAgICAgICB2YXIgcGF5bG9hZCA9IHt9O1xuICAgICAgICBwYXlsb2FkW2tleV0gPSBzZWNvbmRzO1xuICAgICAgICBzYXZlU2V0dGluZyhwYXlsb2FkLCBmaWVsZFNlbGVjdG9yLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKGlucHV0U2VsZWN0b3IpLnZhbChwcmV2aW91cyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVRdWV1ZU1pbldhaXQoKSB7XG4gICAgICAgIHNhdmVRdWV1ZVdhaXQoJyNtaC1xdWV1ZS1taW4td2FpdC1pbnB1dCcsICcjbWgtcXVldWUtbWluLXdhaXQtZmllbGQnLCAncXVldWVfYWJhbmRvbl9taW5fd2FpdF9zZWMnKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlUXVldWVMb25nV2FpdCgpIHtcbiAgICAgICAgc2F2ZVF1ZXVlV2FpdCgnI21oLXF1ZXVlLWxvbmctd2FpdC1pbnB1dCcsICcjbWgtcXVldWUtbG9uZy13YWl0LWZpZWxkJywgJ3F1ZXVlX2xvbmdfd2FpdF9zZWMnKTtcbiAgICB9XG5cbiAgICAvLyBTdGFnZSA0cy1DIG51bWVyaWMgdGhyZXNob2xkczogY29uZmlnLWNoYW5nZSBxdWlldCB3aW5kb3csIGV4dGVybmFsLUlQIGFuZCBsaWNlbnNlIHBvbGwgaW50ZXJ2YWxzLlxuICAgIGZ1bmN0aW9uIHNhdmVOdW1iZXJTZXR0aW5nKHBheWxvYWRLZXksIGlucHV0U2VsZWN0b3IsIGZpZWxkU2VsZWN0b3IsIG1pbiwgbWF4KSB7XG4gICAgICAgIHZhciByYXcgPSBTdHJpbmcoJChpbnB1dFNlbGVjdG9yKS52YWwoKSB8fCAnJykudHJpbSgpO1xuICAgICAgICB2YXIgdmFsdWUgPSAvXlxcZCskLy50ZXN0KHJhdykgPyBwYXJzZUludChyYXcsIDEwKSA6IC0xO1xuICAgICAgICBpZiAodmFsdWUgPCBtaW4gfHwgdmFsdWUgPiBtYXgpIHtcbiAgICAgICAgICAgIG1hcmtGaWVsZEVycm9yKGZpZWxkU2VsZWN0b3IsIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NldHRpbmdzTnVtYmVyRXJyb3InKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY2xlYXJGaWVsZEVycm9yKGZpZWxkU2VsZWN0b3IpO1xuICAgICAgICB2YXIgcGF5bG9hZCA9IHt9O1xuICAgICAgICBwYXlsb2FkW3BheWxvYWRLZXldID0gdmFsdWU7XG4gICAgICAgIGFwaVBhdGNoKCcvc2V0dGluZ3MnLCBwYXlsb2FkLCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgc3RhdGUuc2V0dGluZ3MgPSBkYXRhO1xuICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVkJykpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgbWFya0ZpZWxkRXJyb3IoZmllbGRTZWxlY3RvciwgZmFpbHVyZVRleHQoZmFpbHVyZSkpO1xuICAgICAgICAgICAgJChpbnB1dFNlbGVjdG9yKS52YWwoc3RhdGUuc2V0dGluZ3MgPyBzdGF0ZS5zZXR0aW5nc1twYXlsb2FkS2V5XSA6ICcnKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gXCIxNCw3LDFcIjogZGF5cyBzZXBhcmF0ZWQgYnkgY29tbWFzLCAxLi4zNjUsIGF0IG1vc3QgZml2ZSB2YWx1ZXMsIG5ldmVyIGVtcHR5LlxuICAgIGZ1bmN0aW9uIHNhdmVMaWNlbnNlV2FybkRheXMoKSB7XG4gICAgICAgIHZhciByYXcgPSBTdHJpbmcoJCgnI21oLWxpY2Vuc2UtZGF5cy1pbnB1dCcpLnZhbCgpIHx8ICcnKS50cmltKCk7XG4gICAgICAgIHZhciBwYXJ0cyA9IHJhdyA9PT0gJycgPyBbXSA6IHJhdy5zcGxpdCgvW1xccyw7XSsvKTtcbiAgICAgICAgdmFyIGRheXMgPSBbXTtcbiAgICAgICAgdmFyIHZhbGlkID0gcGFydHMubGVuZ3RoID4gMCAmJiBwYXJ0cy5sZW5ndGggPD0gNTtcbiAgICAgICAgcGFydHMuZm9yRWFjaChmdW5jdGlvbiAocGFydCkge1xuICAgICAgICAgICAgdmFyIGRheSA9IC9eXFxkKyQvLnRlc3QocGFydCkgPyBwYXJzZUludChwYXJ0LCAxMCkgOiAtMTtcbiAgICAgICAgICAgIGlmIChkYXkgPCAxIHx8IGRheSA+IDM2NSB8fCBkYXlzLmluZGV4T2YoZGF5KSA+PSAwKSB7IHZhbGlkID0gZmFsc2U7IHJldHVybjsgfVxuICAgICAgICAgICAgZGF5cy5wdXNoKGRheSk7XG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoIXZhbGlkIHx8IGRheXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBtYXJrRmllbGRFcnJvcignI21oLWxpY2Vuc2UtZGF5cy1maWVsZCcsIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NldHRpbmdzTGljZW5zZURheXNFcnJvcicpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBkYXlzLnNvcnQoZnVuY3Rpb24gKGEsIGIpIHsgcmV0dXJuIGIgLSBhOyB9KTtcbiAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtbGljZW5zZS1kYXlzLWZpZWxkJyk7XG4gICAgICAgIGFwaVBhdGNoKCcvc2V0dGluZ3MnLCB7IGxpY2Vuc2Vfd2Fybl9kYXlzOiBkYXlzLmpvaW4oJywnKSB9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgc3RhdGUuc2V0dGluZ3MgPSBkYXRhO1xuICAgICAgICAgICAgJCgnI21oLWxpY2Vuc2UtZGF5cy1pbnB1dCcpLnZhbChkYXRhLmxpY2Vuc2Vfd2Fybl9kYXlzIHx8ICcnKTtcbiAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25TYXZlZCcpKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgIG1hcmtGaWVsZEVycm9yKCcjbWgtbGljZW5zZS1kYXlzLWZpZWxkJywgZmFpbHVyZVRleHQoZmFpbHVyZSkpO1xuICAgICAgICAgICAgJCgnI21oLWxpY2Vuc2UtZGF5cy1pbnB1dCcpLnZhbChzdGF0ZS5zZXR0aW5ncyA/IHN0YXRlLnNldHRpbmdzLmxpY2Vuc2Vfd2Fybl9kYXlzIDogJycpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIHNlY3VyaXR5IHNldHRpbmdzIChzdGFnZSA0cy1BKTogdG9sbC1mcmF1ZCBydWxlcyBhbmQgU0lQIGJydXRlIGZvcmNlIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGxvYWRTZWN1cml0eVNldHRpbmdzKGRhdGEpIHtcbiAgICAgICAgJCgnI21oLXRvbGwtcHJlZml4ZXMtaW5wdXQnKS52YWwoZGF0YS50b2xsX2ZyYXVkX3ByZWZpeGVzIHx8ICcnKTtcbiAgICAgICAgJCgnI21oLXRvbGwtaG9tZS1pbnB1dCcpLnZhbChkYXRhLnRvbGxfZnJhdWRfaG9tZV9wcmVmaXhlcyB8fCAnJyk7XG4gICAgICAgICQoJyNtaC10b2xsLWJ1cnN0LWlucHV0JykudmFsKGRhdGEudG9sbF9mcmF1ZF9idXJzdF9jYWxscyk7XG4gICAgICAgICQoJyNtaC10b2xsLXdpbmRvdy1pbnB1dCcpLnZhbChkYXRhLnRvbGxfZnJhdWRfYnVyc3Rfd2luZG93X21pbik7XG4gICAgICAgICQoJyNtaC10b2xsLWZyb20taW5wdXQnKS52YWwoZGF0YS50b2xsX2ZyYXVkX29mZmhvdXJzX2Zyb20gfHwgJycpO1xuICAgICAgICAkKCcjbWgtdG9sbC10by1pbnB1dCcpLnZhbChkYXRhLnRvbGxfZnJhdWRfb2ZmaG91cnNfdG8gfHwgJycpO1xuICAgICAgICAkKCcjbWgtdG9sbC1vZmZob3VycycpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgZGF0YS50b2xsX2ZyYXVkX29mZmhvdXJzX2VuYWJsZWQgPT09IHRydWUpO1xuICAgICAgICAkKCcjbWgtdG9sbC1vZmZob3VycyBpbnB1dCcpLnByb3AoJ2NoZWNrZWQnLCBkYXRhLnRvbGxfZnJhdWRfb2ZmaG91cnNfZW5hYmxlZCA9PT0gdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1hdXRoZmFpbC10aHJlc2hvbGQtaW5wdXQnKS52YWwoZGF0YS5zaXBfYXV0aGZhaWxfdGhyZXNob2xkKTtcbiAgICAgICAgJCgnI21oLWF1dGhmYWlsLXdpbmRvdy1pbnB1dCcpLnZhbChkYXRhLnNpcF9hdXRoZmFpbF93aW5kb3dfbWluKTtcbiAgICAgICAgJCgnI21oLWF1dGhmYWlsLXF1aWV0LWlucHV0JykudmFsKGRhdGEuc2lwX2F1dGhmYWlsX3F1aWV0X21pbik7XG4gICAgICAgICQoJyNtaC1hdXRoZmFpbC1wZXJwb2xsLWlucHV0JykudmFsKGRhdGEuc2lwX2F1dGhmYWlsX2V4dGVuc2lvbnNfcGVyX3BvbGwpO1xuICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC10b2xsLXByZWZpeGVzLWZpZWxkJyk7XG4gICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLXRvbGwtaG9tZS1maWVsZCcpO1xuICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC10b2xsLWJ1cnN0LWZpZWxkJyk7XG4gICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLXRvbGwtd2luZG93LWZpZWxkJyk7XG4gICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLXRvbGwtZnJvbS1maWVsZCcpO1xuICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC10b2xsLXRvLWZpZWxkJyk7XG4gICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLWF1dGhmYWlsLXRocmVzaG9sZC1maWVsZCcpO1xuICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC1hdXRoZmFpbC13aW5kb3ctZmllbGQnKTtcbiAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtYXV0aGZhaWwtcXVpZXQtZmllbGQnKTtcbiAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtYXV0aGZhaWwtcGVycG9sbC1maWVsZCcpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNlY3VyaXR5SW52YWxpZChmaWVsZFNlbGVjdG9yKSB7XG4gICAgICAgIG1hcmtGaWVsZEVycm9yKGZpZWxkU2VsZWN0b3IsIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NldHRpbmdzU2VjdXJpdHlJbnZhbGlkJykpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVTZWN1cml0eUludChzZWxlY3RvciwgZmllbGRTZWxlY3RvciwgZmllbGQsIG1pbiwgbWF4KSB7XG4gICAgICAgIHZhciByYXcgPSBTdHJpbmcoJChzZWxlY3RvcikudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgdmFyIHZhbHVlID0gL15cXGQrJC8udGVzdChyYXcpID8gcGFyc2VJbnQocmF3LCAxMCkgOiAtMTtcbiAgICAgICAgaWYgKHZhbHVlIDwgbWluIHx8IHZhbHVlID4gbWF4KSB7IHNlY3VyaXR5SW52YWxpZChmaWVsZFNlbGVjdG9yKTsgcmV0dXJuOyB9XG4gICAgICAgIHZhciBwYXlsb2FkID0ge307XG4gICAgICAgIHBheWxvYWRbZmllbGRdID0gdmFsdWU7XG4gICAgICAgIHZhciBwcmV2aW91cyA9IHN0YXRlLnNldHRpbmdzID8gc3RhdGUuc2V0dGluZ3NbZmllbGRdIDogdmFsdWU7XG4gICAgICAgIHNhdmVTZXR0aW5nKHBheWxvYWQsIGZpZWxkU2VsZWN0b3IsIGZ1bmN0aW9uICgpIHsgJChzZWxlY3RvcikudmFsKHByZXZpb3VzKTsgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZVNlY3VyaXR5UHJlZml4ZXMoc2VsZWN0b3IsIGZpZWxkU2VsZWN0b3IsIGZpZWxkKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IFN0cmluZygkKHNlbGVjdG9yKS52YWwoKSB8fCAnJykudHJpbSgpO1xuICAgICAgICBpZiAodmFsdWUgIT09ICcnICYmICEvXlxcKz9cXGR7MCw4fShcXHMqLFxccypcXCs/XFxkezAsOH0pKiQvLnRlc3QodmFsdWUpKSB7XG4gICAgICAgICAgICBzZWN1cml0eUludmFsaWQoZmllbGRTZWxlY3Rvcik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHBheWxvYWQgPSB7fTtcbiAgICAgICAgcGF5bG9hZFtmaWVsZF0gPSB2YWx1ZS5yZXBsYWNlKC9cXHMrL2csICcnKTtcbiAgICAgICAgdmFyIHByZXZpb3VzID0gc3RhdGUuc2V0dGluZ3MgPyBzdGF0ZS5zZXR0aW5nc1tmaWVsZF0gOiAnJztcbiAgICAgICAgc2F2ZVNldHRpbmcocGF5bG9hZCwgZmllbGRTZWxlY3RvciwgZnVuY3Rpb24gKCkgeyAkKHNlbGVjdG9yKS52YWwocHJldmlvdXMpOyB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlU2VjdXJpdHlUaW1lKHNlbGVjdG9yLCBmaWVsZFNlbGVjdG9yLCBmaWVsZCkge1xuICAgICAgICB2YXIgdmFsdWUgPSBTdHJpbmcoJChzZWxlY3RvcikudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgaWYgKCEvXihbMDFdXFxkfDJbMC0zXSk6WzAtNV1cXGQkLy50ZXN0KHZhbHVlKSkgeyBzZWN1cml0eUludmFsaWQoZmllbGRTZWxlY3Rvcik7IHJldHVybjsgfVxuICAgICAgICB2YXIgcGF5bG9hZCA9IHt9O1xuICAgICAgICBwYXlsb2FkW2ZpZWxkXSA9IHZhbHVlO1xuICAgICAgICB2YXIgcHJldmlvdXMgPSBzdGF0ZS5zZXR0aW5ncyA/IHN0YXRlLnNldHRpbmdzW2ZpZWxkXSA6IHZhbHVlO1xuICAgICAgICBzYXZlU2V0dGluZyhwYXlsb2FkLCBmaWVsZFNlbGVjdG9yLCBmdW5jdGlvbiAoKSB7ICQoc2VsZWN0b3IpLnZhbChwcmV2aW91cyk7IH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVUb2xsT2ZmSG91cnMoKSB7XG4gICAgICAgIHZhciBjaGVja2VkID0gJCgnI21oLXRvbGwtb2ZmaG91cnMgaW5wdXQnKS5wcm9wKCdjaGVja2VkJyk7XG4gICAgICAgIHNhdmVTZXR0aW5nKHsgdG9sbF9mcmF1ZF9vZmZob3Vyc19lbmFibGVkOiBjaGVja2VkIH0sIG51bGwsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC10b2xsLW9mZmhvdXJzIGlucHV0JykucHJvcCgnY2hlY2tlZCcsICFjaGVja2VkKTtcbiAgICAgICAgICAgICQoJyNtaC10b2xsLW9mZmhvdXJzJykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCAhY2hlY2tlZCk7XG4gICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZUZhaWxlZCcpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZm10Q291bnRkb3duKHNlY29uZHMpIHtcbiAgICAgICAgdmFyIHRvdGFsID0gTWF0aC5tYXgoMCwgcGFyc2VJbnQoc2Vjb25kcywgMTApIHx8IDApO1xuICAgICAgICByZXR1cm4gTWF0aC5mbG9vcih0b3RhbCAvIDYwKSArICc6JyArIHBhZCh0b3RhbCAlIDYwKTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIG5vdGlmaWNhdGlvbnM6IHJ1bGVzIEFQSSAmIGxpc3QgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gbG9hZFJ1bGVzKHNpbGVudCkge1xuICAgICAgICBpZiAoIXNpbGVudCkge1xuICAgICAgICAgICAgc3RhdGUucnVsZXNMb2FkZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIHJlbmRlclJ1bGVzU2tlbGV0b24oKTtcbiAgICAgICAgfVxuICAgICAgICBhcGlHZXQoJy9ydWxlcycsIHsgbGltaXQ6IDIwMCB9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgc3RhdGUucnVsZXMgPSBkYXRhLml0ZW1zIHx8IFtdO1xuICAgICAgICAgICAgc3RhdGUucnVsZXNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc3RhdGUucnVsZXNFcnJvciA9IG51bGw7XG4gICAgICAgICAgICByZW5kZXJSdWxlcygpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgc3RhdGUucnVsZXNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc3RhdGUucnVsZXNFcnJvciA9IGZhaWx1cmU7XG4gICAgICAgICAgICByZW5kZXJSdWxlcygpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJSdWxlc1NrZWxldG9uKCkge1xuICAgICAgICB2YXIgcm93ID0gJzxkaXYgY2xhc3M9XCJtaC1ub3RpZi1yb3dcIj48c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjM2cHg7aGVpZ2h0OjIwcHg7Ym9yZGVyLXJhZGl1czoxMHB4XCI+PC9zcGFuPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6NDAlXCI+PC9zcGFuPjxzcGFuPjwvc3Bhbj48c3Bhbj48L3NwYW4+PC9kaXY+JztcbiAgICAgICAgJCgnI21oLXJ1bGVzLWxpc3QnKS5odG1sKHJvdyArIHJvdyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc291cmNlRm9yUnVsZShydWxlKSB7XG4gICAgICAgIGlmIChydWxlLnNvdXJjZV9pZCkge1xuICAgICAgICAgICAgdmFyIGJ5SWQgPSBzb3VyY2VCeUlkKHJ1bGUuc291cmNlX2lkKTtcbiAgICAgICAgICAgIGlmIChieUlkKSB7IHJldHVybiBieUlkOyB9XG4gICAgICAgIH1cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5zb3VyY2VzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgdHlwZXMgPSBzdGF0ZS5zb3VyY2VzW2ldLmV2ZW50X3R5cGVzIHx8IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCB0eXBlcy5sZW5ndGg7IGorKykge1xuICAgICAgICAgICAgICAgIGlmIChydWxlLmV2ZW50X3R5cGVzICYmIHJ1bGUuZXZlbnRfdHlwZXMuaW5kZXhPZih0eXBlc1tqXS50eXBlKSA+PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBzdGF0ZS5zb3VyY2VzW2ldO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzZXRSdWxlQWRkVmlzaWJsZSh2aXNpYmxlKSB7XG4gICAgICAgICQoJyNtaC1ydWxlLWFkZCcpLmF0dHIoJ2hpZGRlbicsIHZpc2libGUgPyBudWxsIDogdHJ1ZSk7XG4gICAgfVxuXG4gICAgLy8gRGVzaWduIHYzLCDCq9Cj0LLQtdC00L7QvNC70LXQvdC40Y/Cuzogbm8gYm90IOKGkiBwaWNrIGEgbWVzc2VuZ2VyOyBib3QgYnV0IG5vIG5vdGlmaWNhdGlvbnMg4oaSIG9uZSBwcmltYXJ5IGJ1dHRvbjtcbiAgICAvLyBvdGhlcndpc2UgdGhlIGxpc3QgZ3JvdXBlZCDQl9Cy0L7QvdC60Lgg4oaSINCY0Jgg0KHRg9C/0LXRgNCy0LDQudC30LXRgCDihpIg0JPQvtC70L7RgdC+0LLQvtC5INCw0LPQtdC90YIg4oaSINCh0LLRj9C30Ywg0Lgg0JDQotChIChoZWFkaW5ncyBvbmx5IGZvciAyKyBncm91cHMpLlxuICAgIGZ1bmN0aW9uIHJlbmRlclJ1bGVzKCkge1xuICAgICAgICB2YXIgJGxpc3QgPSAkKCcjbWgtcnVsZXMtbGlzdCcpO1xuICAgICAgICBpZiAoIXN0YXRlLnJ1bGVzTG9hZGVkIHx8ICFzdGF0ZS5ib3RzTG9hZGVkKSB7XG4gICAgICAgICAgICBzZXRSdWxlQWRkVmlzaWJsZShmYWxzZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN0YXRlLnJ1bGVzRXJyb3IgIT09IG51bGwgJiYgc3RhdGUucnVsZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBzZXRSdWxlQWRkVmlzaWJsZShmYWxzZSk7XG4gICAgICAgICAgICAkbGlzdC5odG1sKCc8ZGl2IGNsYXNzPVwidWkgbmVnYXRpdmUgbWVzc2FnZVwiIHJvbGU9XCJhbGVydFwiPicgKyBJQ09OX0VSUk9SXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLWdyb3dcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVzTG9hZEZhaWxlZCcpKSArICc8L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAnPGJ1dHRvbiBjbGFzcz1cInVpIGJhc2ljIGJ1dHRvbiBtaC1vbi1tZXNzYWdlXCIgdHlwZT1cImJ1dHRvblwiIGlkPVwibWgtcnVsZXMtcmV0cnlcIj4nXG4gICAgICAgICAgICAgICAgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uUmV0cnknKSkgKyAnPC9idXR0b24+PC9kaXY+Jyk7XG4gICAgICAgICAgICAkKCcjbWgtcnVsZXMtcmV0cnknKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IGxvYWRSdWxlcygpOyB9KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc3RhdGUuYm90cy5sZW5ndGggPT09IDAgJiYgc3RhdGUucnVsZXMubGVuZ3RoID09PSAwICYmIHN0YXRlLmJvdHNFcnJvciA9PT0gbnVsbCkge1xuICAgICAgICAgICAgc2V0UnVsZUFkZFZpc2libGUoZmFsc2UpO1xuICAgICAgICAgICAgJGxpc3QuaHRtbCgnPGRpdiBjbGFzcz1cIm1oLW9uYm9hcmRcIiByb2xlPVwic3RhdHVzXCI+J1xuICAgICAgICAgICAgICAgICsgJzxoMyBjbGFzcz1cInVpIGhlYWRlciBtaC1wYWdlLXRpdGxlXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9PbmJvYXJkVGl0bGUnKSkgKyAnPC9oMz4nXG4gICAgICAgICAgICAgICAgKyBtZXNzZW5nZXJUaWxlcygpICsgJzwvZGl2PicpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmIChzdGF0ZS5ydWxlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHNldFJ1bGVBZGRWaXNpYmxlKGZhbHNlKTtcbiAgICAgICAgICAgICRsaXN0Lmh0bWwoJzxkaXYgY2xhc3M9XCJtaC1lbXB0eSBtaC1lbXB0eS1ib3hcIiByb2xlPVwic3RhdHVzXCI+J1xuICAgICAgICAgICAgICAgICsgJzxoMyBjbGFzcz1cInVpIGhlYWRlciBtaC1wYWdlLXRpdGxlXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlc0VtcHR5VGl0bGUnKSkgKyAnPC9oMz4nXG4gICAgICAgICAgICAgICAgKyAnPGJ1dHRvbiBjbGFzcz1cInVpIHByaW1hcnkgYnV0dG9uXCIgdHlwZT1cImJ1dHRvblwiIGRhdGEtYWN0aW9uPVwiYWRkXCI+JyArIElDT05fUExVU1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVzQWRkJykpICsgJzwvYnV0dG9uPjwvZGl2PicpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHNldFJ1bGVBZGRWaXNpYmxlKHRydWUpO1xuICAgICAgICB2YXIgZ3JvdXBzID0ge307XG4gICAgICAgIHN0YXRlLnJ1bGVzLmZvckVhY2goZnVuY3Rpb24gKHJ1bGUpIHtcbiAgICAgICAgICAgIHZhciBncm91cCA9IHJ1bGUuZ3JvdXAgfHwgJ3BieCc7XG4gICAgICAgICAgICBpZiAoR1JPVVBfT1JERVIuaW5kZXhPZihncm91cCkgPCAwKSB7IGdyb3VwID0gJ3BieCc7IH1cbiAgICAgICAgICAgIChncm91cHNbZ3JvdXBdID0gZ3JvdXBzW2dyb3VwXSB8fCBbXSkucHVzaChydWxlKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHZhciBvcmRlciA9IEdST1VQX09SREVSLmZpbHRlcihmdW5jdGlvbiAoZ3JvdXApIHsgcmV0dXJuIEJvb2xlYW4oZ3JvdXBzW2dyb3VwXSk7IH0pO1xuICAgICAgICB2YXIgaHRtbCA9ICcnO1xuICAgICAgICBpZiAoc3RhdGUucnVsZXNFcnJvciAhPT0gbnVsbCkge1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInVpIG5lZ2F0aXZlIG1lc3NhZ2VcIiByb2xlPVwiYWxlcnRcIj4nICsgSUNPTl9FUlJPUlxuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ncm93XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlc0xvYWRGYWlsZWQnKSkgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgJzxidXR0b24gY2xhc3M9XCJ1aSBiYXNpYyBidXR0b24gbWgtb24tbWVzc2FnZVwiIHR5cGU9XCJidXR0b25cIiBpZD1cIm1oLXJ1bGVzLXJldHJ5LWlubGluZVwiPidcbiAgICAgICAgICAgICAgICArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25SZXRyeScpKSArICc8L2J1dHRvbj48L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIHZhciBzaG93SGVhZGluZ3MgPSBvcmRlci5sZW5ndGggPiAxO1xuICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwibWgtbm90aWYtbGlzdCcgKyAoc2hvd0hlYWRpbmdzID8gJycgOiAnIGlzLWZsYXQnKSArICdcIiByb2xlPVwibGlzdFwiPic7XG4gICAgICAgIG9yZGVyLmZvckVhY2goZnVuY3Rpb24gKGdyb3VwKSB7XG4gICAgICAgICAgICBpZiAoc2hvd0hlYWRpbmdzKSB7XG4gICAgICAgICAgICAgICAgaHRtbCArPSAnPGgzIGNsYXNzPVwibWgtZ3JvdXAtdGl0bGVcIj4nICsgZXNjKHNvdXJjZUdyb3VwTmFtZShncm91cCkpICsgJzwvaDM+JztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGdyb3Vwc1tncm91cF0uZm9yRWFjaChmdW5jdGlvbiAocnVsZSkge1xuICAgICAgICAgICAgICAgIGh0bWwgKz0gcmVuZGVyUnVsZVJvdyhydWxlKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgJGxpc3QuaHRtbChodG1sICsgJzwvZGl2PicpO1xuICAgICAgICAkKCcjbWgtcnVsZXMtcmV0cnktaW5saW5lJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkgeyBsb2FkUnVsZXMoKTsgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcnVsZUNoYW5uZWwocnVsZSkge1xuICAgICAgICB2YXIgY2hhdHMgPSBydWxlLmNoYXRzIHx8IFtdO1xuICAgICAgICBpZiAoY2hhdHMubGVuZ3RoID4gMCAmJiBjaGF0c1swXS5jaGFubmVsKSB7XG4gICAgICAgICAgICByZXR1cm4gY2hhdHNbMF0uY2hhbm5lbDtcbiAgICAgICAgfVxuICAgICAgICB2YXIgYm90ID0gY2hhdHMubGVuZ3RoID4gMCA/IGJvdEJ5SWQoY2hhdHNbMF0uYm90X2lkKSA6IChzdGF0ZS5ib3RzWzBdIHx8IG51bGwpO1xuICAgICAgICByZXR1cm4gYm90ICYmIGJvdC5jaGFubmVsID09PSAnbWF4JyA/ICdtYXgnIDogJ3RlbGVncmFtJztcbiAgICB9XG5cbiAgICAvLyBDb2xvdXIgb25seSBmb3IgYSBwcm9ibGVtOiB1bmF2YWlsYWJsZSBzb3VyY2UsIHJlamVjdGVkIHRva2VuLCBkZWxldGVkIGJvdCBvciBjaGF0LlxuICAgIGZ1bmN0aW9uIHJ1bGVQcm9ibGVtTGFiZWwocnVsZSkge1xuICAgICAgICB2YXIgc291cmNlID0gc291cmNlQnlJZChydWxlLnNvdXJjZV9pZCk7XG4gICAgICAgIGlmIChzb3VyY2UgJiYgc291cmNlLmF2YWlsYWJpbGl0eSAmJiBzb3VyY2UuYXZhaWxhYmlsaXR5ICE9PSAnYXZhaWxhYmxlJykge1xuICAgICAgICAgICAgdmFyIGxhYmVscyA9IHtcbiAgICAgICAgICAgICAgICBtb2R1bGVfZGlzYWJsZWQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NvdXJjZVN0YXRlTW9kb2ZmJyksXG4gICAgICAgICAgICAgICAgbW9kdWxlX21pc3Npbmc6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NvdXJjZVN0YXRlTm9pbnN0JyksXG4gICAgICAgICAgICAgICAgYXBpX2ZvcmJpZGRlbjogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfTm90aWZTb3VyY2VOb0FjY2VzcycpLFxuICAgICAgICAgICAgICAgIGFwaV9pbmNvbXBhdGlibGU6IHNvdXJjZVN0YXRlVGV4dChzb3VyY2UpLFxuICAgICAgICAgICAgICAgIGRpc2FibGVkOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Tb3VyY2VTdGF0ZU9mZicpLFxuICAgICAgICAgICAgICAgIGVycm9yOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Tb3VyY2VTdGF0ZUVycicpXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgaWYgKGxhYmVsc1tzb3VyY2UuYXZhaWxhYmlsaXR5XSkge1xuICAgICAgICAgICAgICAgIHZhciBjbHMgPSAoc291cmNlLmF2YWlsYWJpbGl0eSA9PT0gJ21vZHVsZV9kaXNhYmxlZCcgfHwgc291cmNlLmF2YWlsYWJpbGl0eSA9PT0gJ2Rpc2FibGVkJyB8fCBzb3VyY2UuYXZhaWxhYmlsaXR5ID09PSAnYXBpX2luY29tcGF0aWJsZScpID8gJ3VpIHllbGxvdyBsYWJlbCcgOiAndWkgcmVkIGxhYmVsJztcbiAgICAgICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwiJyArIGNscyArICdcIj4nICsgZXNjKGxhYmVsc1tzb3VyY2UuYXZhaWxhYmlsaXR5XSkgKyAnPC9zcGFuPic7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGNoYXRzID0gcnVsZS5jaGF0cyB8fCBbXTtcbiAgICAgICAgaWYgKChydWxlLmNoYXRfaWRzIHx8IFtdKS5sZW5ndGggPiBjaGF0cy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgSUNPTl9FUlJPUiArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeUJvdERlbGV0ZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGF0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGJvdCA9IGJvdEJ5SWQoY2hhdHNbaV0uYm90X2lkKTtcbiAgICAgICAgICAgIGlmIChib3QgJiYgYm90LmVuYWJsZWQgIT09IGZhbHNlICYmIGJvdC5zdGF0dXMgPT09ICd0b2tlbl9pbnZhbGlkJykge1xuICAgICAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgSUNPTl9FUlJPUiArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTdGF0dXNUb2tlbkludmFsaWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoYXRzLmxlbmd0aCA+IDAgJiYgY2hhdHMuZXZlcnkoZnVuY3Rpb24gKGNoYXQpIHsgcmV0dXJuIGNoYXQuc3RhdGUgPT09ICdnb25lJzsgfSkpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgSUNPTl9FUlJPUiArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0U3RhdHVzR29uZScpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJSdWxlUm93KHJ1bGUpIHtcbiAgICAgICAgdmFyIHByb2JsZW0gPSBydWxlUHJvYmxlbUxhYmVsKHJ1bGUpO1xuICAgICAgICB2YXIgcnVsZUZpcnN0ID0gc3RhdGUucnVsZXMubGVuZ3RoID4gMCAmJiBOdW1iZXIoc3RhdGUucnVsZXNbMF0uaWQpID09PSBOdW1iZXIocnVsZS5pZCk7XG4gICAgICAgIHZhciBydWxlTGFzdCA9IHN0YXRlLnJ1bGVzLmxlbmd0aCA+IDBcbiAgICAgICAgICAgICYmIE51bWJlcihzdGF0ZS5ydWxlc1tzdGF0ZS5ydWxlcy5sZW5ndGggLSAxXS5pZCkgPT09IE51bWJlcihydWxlLmlkKTtcbiAgICAgICAgdmFyIHJpZ2h0ID0gJyc7XG4gICAgICAgIGlmIChwcm9ibGVtICE9PSBudWxsKSB7XG4gICAgICAgICAgICByaWdodCA9IHByb2JsZW07XG4gICAgICAgIH0gZWxzZSBpZiAocnVsZS5lbmFibGVkICYmIHJ1bGUubGFzdF9ldmVudF9hdCkge1xuICAgICAgICAgICAgcmlnaHQgPSAnPHNwYW4gY2xhc3M9XCJtaC1tdXRlZFwiPicgKyBmbXRDZWxsVGltZShydWxlLmxhc3RfZXZlbnRfYXQpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIHZhciBjaGFubmVsID0gcnVsZUNoYW5uZWwocnVsZSk7XG5cbiAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwibWgtbm90aWYtcm93JyArIChydWxlLmVuYWJsZWQgPyAnJyA6ICcgaXMtb2ZmJykgKyAnXCIgcm9sZT1cImxpc3RpdGVtXCIgZGF0YS1ydWxlLWlkPVwiJyArIHJ1bGUuaWQgKyAnXCI+J1xuICAgICAgICAgICAgKyAnPGxhYmVsIGNsYXNzPVwidWkgdG9nZ2xlIGNoZWNrYm94JyArIChydWxlLmVuYWJsZWQgPyAnIGNoZWNrZWQnIDogJycpICsgJ1wiIGFyaWEtbGFiZWw9XCInICsgZXNjKHJ1bGUudGl0bGUpICsgJ1wiPidcbiAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjbGFzcz1cImhpZGRlbiBtaC1ydWxlLXRvZ2dsZVwiJyArIChydWxlLmVuYWJsZWQgPyAnIGNoZWNrZWQnIDogJycpICsgJz4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXRyYWNrXCI+PC9zcGFuPjwvbGFiZWw+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1ub3RpZi1tYWluXCI+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tZXNzZW5nZXIgcyAnICsgKGNoYW5uZWwgPT09ICdtYXgnID8gJ21heCcgOiAndGcnKSArICdcIiByb2xlPVwiaW1nXCIgYXJpYS1sYWJlbD1cIicgKyAoY2hhbm5lbCA9PT0gJ21heCcgPyAnTUFYJyA6ICdUZWxlZ3JhbScpICsgJ1wiPidcbiAgICAgICAgICAgICsgKGNoYW5uZWwgPT09ICdtYXgnID8gJ01BWCcgOiAnVEcnKSArICc8L3NwYW4+J1xuICAgICAgICAgICAgKyAnPGEgaHJlZj1cIiNcIiBjbGFzcz1cIm1oLW5vdGlmLXRpdGxlIG1oLXRydW5jYXRlXCIgZGF0YS1hY3Rpb249XCJlZGl0XCI+JyArIGVzYyhydWxlLnRpdGxlKSArICc8L2E+PC9zcGFuPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbm90aWYtc3RhdHVzXCI+JyArIHJpZ2h0ICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtcnVsZS1tZW51LXdyYXBcIj4nXG4gICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgdGV4dCBidXR0b24gbWgtcnVsZS1tZW51LWJ0blwiIHR5cGU9XCJidXR0b25cIiBkYXRhLWFjdGlvbj1cIm1lbnVcIiBhcmlhLWxhYmVsPVwiJyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlTWVudU1vcmUnKSkgKyAnXCIgYXJpYS1leHBhbmRlZD1cImZhbHNlXCI+J1xuICAgICAgICAgICAgKyAnPHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+PHBhdGggZD1cIk0zLjUgOGguMDFNOCA4aC4wMU0xMi41IDhoLjAxXCIgc3Ryb2tlLXdpZHRoPVwiMi40XCIvPjwvc3ZnPjwvYnV0dG9uPidcbiAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ydWxlLW1lbnVcIiBoaWRkZW4+J1xuICAgICAgICAgICAgKyAnPGEgaHJlZj1cIiNcIiBkYXRhLWFjdGlvbj1cImVkaXRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVNZW51RWRpdCcpKSArICc8L2E+J1xuICAgICAgICAgICAgKyAocnVsZUZpcnN0ID8gJycgOiAnPGEgaHJlZj1cIiNcIiBkYXRhLWFjdGlvbj1cInVwXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlTWVudVVwJykpICsgJzwvYT4nKVxuICAgICAgICAgICAgKyAocnVsZUxhc3QgPyAnJyA6ICc8YSBocmVmPVwiI1wiIGRhdGEtYWN0aW9uPVwiZG93blwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZU1lbnVEb3duJykpICsgJzwvYT4nKVxuICAgICAgICAgICAgKyAnPGEgaHJlZj1cIiNcIiBkYXRhLWFjdGlvbj1cImRlbGV0ZVwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZU1lbnVEZWxldGUnKSkgKyAnPC9hPidcbiAgICAgICAgICAgICsgJzwvZGl2PjwvZGl2PjwvZGl2Pic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYmluZFJ1bGVzQ29udGFpbmVyKCkge1xuICAgICAgICB2YXIgJHdyYXAgPSAkKCcjbWgtcnVsZXMtbGlzdCcpO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiYWRkXCJdJywgZnVuY3Rpb24gKCkgeyBvcGVuUnVsZVdpemFyZChudWxsKTsgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJhZGQtYm90XCJdJywgZnVuY3Rpb24gKCkgeyBvcGVuQm90TW9kYWwoJ2FkZCcsIG51bGwsICQodGhpcykuZGF0YSgnY2hhbm5lbCcpKTsgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJlZGl0XCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgb3BlblJ1bGVXaXphcmQocnVsZUJ5SWQoJCh0aGlzKS5jbG9zZXN0KCcubWgtbm90aWYtcm93JykuZGF0YSgncnVsZS1pZCcpKSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwibWVudVwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgICB2YXIgJG1lbnUgPSAkKHRoaXMpLnNpYmxpbmdzKCcubWgtcnVsZS1tZW51Jyk7XG4gICAgICAgICAgICAkKCcubWgtcnVsZS1tZW51Jykubm90KCRtZW51KS5wcm9wKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgICRtZW51LnByb3AoJ2hpZGRlbicsICEkbWVudS5wcm9wKCdoaWRkZW4nKSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiZGVsZXRlXCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgY29uZmlybURlbGV0ZVJ1bGUocnVsZUJ5SWQoJCh0aGlzKS5jbG9zZXN0KCcubWgtbm90aWYtcm93JykuZGF0YSgncnVsZS1pZCcpKSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwidXBcIl0sIFtkYXRhLWFjdGlvbj1cImRvd25cIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBtb3ZlUnVsZShcbiAgICAgICAgICAgICAgICAkKHRoaXMpLmNsb3Nlc3QoJy5taC1ub3RpZi1yb3cnKS5kYXRhKCdydWxlLWlkJyksXG4gICAgICAgICAgICAgICAgJCh0aGlzKS5kYXRhKCdhY3Rpb24nKSA9PT0gJ3VwJyA/IC0xIDogMVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjaGFuZ2UnLCAnLm1oLXJ1bGUtdG9nZ2xlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGlkID0gJCh0aGlzKS5jbG9zZXN0KCcubWgtbm90aWYtcm93JykuZGF0YSgncnVsZS1pZCcpO1xuICAgICAgICAgICAgdmFyIGVuYWJsZWQgPSAkKHRoaXMpLnByb3AoJ2NoZWNrZWQnKTtcbiAgICAgICAgICAgIGFwaVBhdGNoKCcvcnVsZXMvJyArIGlkLCB7IGVuYWJsZWQ6IGVuYWJsZWQgfSwgZnVuY3Rpb24gKHJ1bGUpIHtcbiAgICAgICAgICAgICAgICByZXBsYWNlUnVsZShydWxlKTtcbiAgICAgICAgICAgICAgICByZW5kZXJSdWxlcygpO1xuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgICAgICBsb2FkUnVsZXModHJ1ZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgJChkb2N1bWVudCkub24oJ2NsaWNrJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBpZiAoJChldmVudC50YXJnZXQpLmNsb3Nlc3QoJy5taC1ydWxlLW1lbnUtd3JhcCcpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgICQoJy5taC1ydWxlLW1lbnUnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbG9hZFByb3ZpZGVycyhkb25lKSB7XG4gICAgICAgIGlmIChzdGF0ZS5wcm92aWRlcnNMb2FkZWQpIHtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb3JlR2V0KCcvcHJvdmlkZXJzJywgeyBsaW1pdDogMjAwIH0sIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICB2YXIgaXRlbXMgPSBkYXRhLml0ZW1zIHx8IFtdO1xuICAgICAgICAgICAgdmFyIGxpc3QgPSBbXTtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaXRlbXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICB2YXIgcHJvdmlkZXIgPSBpdGVtc1tpXTtcbiAgICAgICAgICAgICAgICB2YXIgaWQgPSBTdHJpbmcocHJvdmlkZXIuaWQgIT09IHVuZGVmaW5lZCA/IHByb3ZpZGVyLmlkIDogKHByb3ZpZGVyLnByb3ZpZGVyX2lkIHx8ICcnKSk7XG4gICAgICAgICAgICAgICAgaWYgKGlkID09PSAnJykgeyBjb250aW51ZTsgfVxuICAgICAgICAgICAgICAgIHZhciBsYWJlbCA9IHByb3ZpZGVyLmRlc2NyaXB0aW9uIHx8IHByb3ZpZGVyLnVzZXJuYW1lIHx8ICgnIycgKyBpZCk7XG4gICAgICAgICAgICAgICAgbGlzdC5wdXNoKHsgaWQ6IGlkLCBsYWJlbDogbGFiZWwgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzdGF0ZS5wcm92aWRlcnMgPSBsaXN0O1xuICAgICAgICAgICAgc3RhdGUucHJvdmlkZXJzTG9hZGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc3RhdGUucHJvdmlkZXJzTG9hZGVkID0gZmFsc2U7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1vdmVSdWxlKGlkLCBkZWx0YSkge1xuICAgICAgICB2YXIgaWRzID0gW107XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUucnVsZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlkcy5wdXNoKE51bWJlcihzdGF0ZS5ydWxlc1tpXS5pZCkpO1xuICAgICAgICB9XG4gICAgICAgIHZhciBpbmRleCA9IGlkcy5pbmRleE9mKE51bWJlcihpZCkpO1xuICAgICAgICB2YXIgdGFyZ2V0ID0gaW5kZXggKyBkZWx0YTtcbiAgICAgICAgaWYgKGluZGV4IDwgMCB8fCB0YXJnZXQgPCAwIHx8IHRhcmdldCA+PSBpZHMubGVuZ3RoKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHN3YXAgPSBpZHNbaW5kZXhdO1xuICAgICAgICBpZHNbaW5kZXhdID0gaWRzW3RhcmdldF07XG4gICAgICAgIGlkc1t0YXJnZXRdID0gc3dhcDtcbiAgICAgICAgYXBpUG9zdCgnL3J1bGVzOmNoYW5nZVByaW9yaXR5JywgeyBvcmRlcjogaWRzIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGxvYWRSdWxlcyh0cnVlKTtcbiAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlT3JkZXJTYXZlZCcpKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgIHNob3dUb2FzdChmYWlsdXJlVGV4dChmYWlsdXJlKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJ1bGVCeUlkKGlkKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUucnVsZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIoc3RhdGUucnVsZXNbaV0uaWQpID09PSBOdW1iZXIoaWQpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHN0YXRlLnJ1bGVzW2ldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlcGxhY2VSdWxlKHJ1bGUpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5ydWxlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKE51bWJlcihzdGF0ZS5ydWxlc1tpXS5pZCkgPT09IE51bWJlcihydWxlLmlkKSkge1xuICAgICAgICAgICAgICAgIHN0YXRlLnJ1bGVzW2ldID0gcnVsZTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgc3RhdGUucnVsZXMucHVzaChydWxlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjb25maXJtRGVsZXRlUnVsZShydWxlKSB7XG4gICAgICAgIGlmICghcnVsZSkgeyByZXR1cm47IH1cbiAgICAgICAgJCgnI21oLWNvbmZpcm0tdGV4dCcpLnRleHQodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVEZWxldGVDb25maXJtJywgeyB0aXRsZTogcnVsZS50aXRsZSB9KSk7XG4gICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsJykubW9kYWwoeyBjbG9zYWJsZTogdHJ1ZSB9KS5tb2RhbCgnc2hvdycpO1xuICAgICAgICAkKCcjbWgtY29uZmlybS1vaycpLm9mZignY2xpY2snKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtY29uZmlybS1tb2RhbCcpLm1vZGFsKCdoaWRlJyk7XG4gICAgICAgICAgICBhcGlEZWxldGUoJy9ydWxlcy8nICsgcnVsZS5pZCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGxvYWRSdWxlcyh0cnVlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uRGVsZXRlZCcpKTtcbiAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIG5vdGlmaWNhdGlvbnM6IHdpemFyZCAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBlbXB0eUZpbHRlcnMoKSB7XG4gICAgICAgIHJldHVybiB7IHVzZXJfaWRzOiBbXSwgZGlyZWN0aW9uczogW10sIHByb3ZpZGVyczogW10sIHF1YWxpdHlfc2NvcmU6IG51bGwsIHJlYXNvbnM6IG51bGwgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBub3JtYWxpemVSZXRyYWN0KG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIGNvbmZpZyA9IG9wdGlvbnMgJiYgb3B0aW9ucy5yZXRyYWN0X29uX2NhbGxiYWNrICYmIHR5cGVvZiBvcHRpb25zLnJldHJhY3Rfb25fY2FsbGJhY2sgPT09ICdvYmplY3QnXG4gICAgICAgICAgICA/IG9wdGlvbnMucmV0cmFjdF9vbl9jYWxsYmFja1xuICAgICAgICAgICAgOiB7fTtcbiAgICAgICAgdmFyIHdpbmRvdyA9IE51bWJlcihjb25maWcud2luZG93X21pbik7XG4gICAgICAgIGlmICghd2luZG93IHx8IHdpbmRvdyA8IDUgfHwgd2luZG93ID4gMTIwKSB7XG4gICAgICAgICAgICB3aW5kb3cgPSAyMDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZW5hYmxlZDogY29uZmlnLmVuYWJsZWQgPT09IHRydWUsXG4gICAgICAgICAgICB3aW5kb3dfbWluOiB3aW5kb3csXG4gICAgICAgICAgICBjb3VudF9pbmNvbWluZ19hbnN3ZXJlZDogY29uZmlnLmNvdW50X2luY29taW5nX2Fuc3dlcmVkICE9PSBmYWxzZVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG5vcm1hbGl6ZUZpbHRlcnMoZmlsdGVycykge1xuICAgICAgICB2YXIgcmVzdWx0ID0gZW1wdHlGaWx0ZXJzKCk7XG4gICAgICAgIGlmICghZmlsdGVycyB8fCB0eXBlb2YgZmlsdGVycyAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZmlsdGVycy51c2VyX2lkcykpIHtcbiAgICAgICAgICAgIHJlc3VsdC51c2VyX2lkcyA9IGZpbHRlcnMudXNlcl9pZHMubWFwKE51bWJlcik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZmlsdGVycy5kaXJlY3Rpb25zKSkge1xuICAgICAgICAgICAgcmVzdWx0LmRpcmVjdGlvbnMgPSBmaWx0ZXJzLmRpcmVjdGlvbnMuc2xpY2UoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaWx0ZXJzLnByb3ZpZGVycykpIHtcbiAgICAgICAgICAgIHJlc3VsdC5wcm92aWRlcnMgPSBmaWx0ZXJzLnByb3ZpZGVycy5tYXAoU3RyaW5nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaWx0ZXJzLnJlYXNvbnMpKSB7XG4gICAgICAgICAgICByZXN1bHQucmVhc29ucyA9IGZpbHRlcnMucmVhc29ucy5tYXAoU3RyaW5nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZmlsdGVycy5xdWFsaXR5X3Njb3JlICYmIHR5cGVvZiBmaWx0ZXJzLnF1YWxpdHlfc2NvcmUgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICByZXN1bHQucXVhbGl0eV9zY29yZSA9IHt9O1xuICAgICAgICAgICAgaWYgKGZpbHRlcnMucXVhbGl0eV9zY29yZS5taW4gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHJlc3VsdC5xdWFsaXR5X3Njb3JlLm1pbiA9IE51bWJlcihmaWx0ZXJzLnF1YWxpdHlfc2NvcmUubWluKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChmaWx0ZXJzLnF1YWxpdHlfc2NvcmUubWF4ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQucXVhbGl0eV9zY29yZS5tYXggPSBOdW1iZXIoZmlsdGVycy5xdWFsaXR5X3Njb3JlLm1heCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICAvLyBBdWRpbyBhdHRhY2htZW50IG1vZGUgb2YgYSBydWxlIChQbGFuLzA1KS4gVGhlIHN0YWdlLTIgYm9vbGVhbiBpcyBub3QgYSBtb2RlIGFuZCByZWFkcyBhcyBcIm5vbmVcIi5cbiAgICBmdW5jdGlvbiBub3JtYWxpemVBdHRhY2htZW50cyhvcHRpb25zKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IG9wdGlvbnMgPyBvcHRpb25zLmF0dGFjaG1lbnRzIDogbnVsbDtcbiAgICAgICAgcmV0dXJuIHZhbHVlID09PSAnZnJhZ21lbnRzJyB8fCB2YWx1ZSA9PT0gJ3JlY29yZGluZycgPyB2YWx1ZSA6ICdub25lJztcbiAgICB9XG5cbiAgICAvLyBNb2RlcyBvZmZlcmVkIGZvciB0aGUgc2VsZWN0ZWQgZXZlbnQgdHlwZXM6IG9ubHkgZXZlbnRzIHRoYXQgY2FuIGNhcnJ5IGF1ZGlvLlxuICAgIGZ1bmN0aW9uIHdpemFyZEF0dGFjaG1lbnRNb2Rlcyh0eXBlcykge1xuICAgICAgICBpZiAodHlwZXMuaW5kZXhPZignYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCcpID49IDApIHsgcmV0dXJuIFsnbm9uZScsICdmcmFnbWVudHMnLCAncmVjb3JkaW5nJ107IH1cbiAgICAgICAgaWYgKHR5cGVzLmluZGV4T2YoJ2NvcmUudm9pY2VtYWlsJykgPj0gMCkgeyByZXR1cm4gWydub25lJywgJ3JlY29yZGluZyddOyB9XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBlbnN1cmVXaXphcmREYXRhKCkge1xuICAgICAgICBsb2FkRW1wbG95ZWVzKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5ydWxlV2l6YXJkICYmIHN0YXRlLnJ1bGVXaXphcmQuc3RlcCA9PT0gMikgeyByZW5kZXJXaXphcmRDb25kaXRpb25zKCk7IH1cbiAgICAgICAgfSk7XG4gICAgICAgIGxvYWRQcm92aWRlcnMoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHN0YXRlLnJ1bGVXaXphcmQgJiYgc3RhdGUucnVsZVdpemFyZC5zdGVwID09PSAyKSB7IHJlbmRlcldpemFyZENvbmRpdGlvbnMoKTsgfVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKCFzdGF0ZS5ib3RzTG9hZGVkKSB7XG4gICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIG9wZW5SdWxlV2l6YXJkKHJ1bGUpIHtcbiAgICAgICAgZW5zdXJlV2l6YXJkRGF0YSgpO1xuICAgICAgICB2YXIgc291cmNlID0gcnVsZSA/IHNvdXJjZUZvclJ1bGUocnVsZSkgOiBudWxsO1xuICAgICAgICB2YXIgcnVsZVR5cGVzID0gcnVsZSA/IChydWxlLmV2ZW50X3R5cGVzIHx8IFtdKS5zbGljZSgpIDogW107XG4gICAgICAgIHN0YXRlLnJ1bGVXaXphcmQgPSB7XG4gICAgICAgICAgICBzdGVwOiBydWxlID8gZmlyc3RTdGVwQWZ0ZXJTY2VuYXJpbygocnVsZS5ldmVudF90eXBlcyB8fCBbXSkuc2xpY2UoKSkgOiAxLFxuICAgICAgICAgICAgZWRpdElkOiBydWxlID8gTnVtYmVyKHJ1bGUuaWQpIDogMCxcbiAgICAgICAgICAgIHNvdXJjZUlkOiBzb3VyY2UgPyBzb3VyY2UuaWQgOiAnJyxcbiAgICAgICAgICAgIGV2ZW50VHlwZXM6IHJ1bGVUeXBlcyxcbiAgICAgICAgICAgIHRpdGxlOiBydWxlID8gcnVsZS50aXRsZSA6ICcnLFxuICAgICAgICAgICAgZmlsdGVyczogbm9ybWFsaXplRmlsdGVycyhydWxlID8gcnVsZS5maWx0ZXJzIDogbnVsbCksXG4gICAgICAgICAgICByZWNvdmVyOiBydWxlID8gd2l6YXJkSGFzUmVjb3ZlcnkocnVsZVR5cGVzKSA6IHRydWUsXG4gICAgICAgICAgICBtaW5TZXZlcml0eTogcnVsZSAmJiBydWxlLm1pbl9zZXZlcml0eSA9PT0gJ2NyaXRpY2FsJyA/ICdjcml0aWNhbCcgOiAnd2FybmluZycsXG4gICAgICAgICAgICB0YXJnZXRNb2RlOiBydWxlID8gcnVsZS50YXJnZXRfbW9kZSA6ICdlbXBsb3llZV9vcl9yZWNpcGllbnRzJyxcbiAgICAgICAgICAgIGNoYXRJZHM6IHJ1bGVcbiAgICAgICAgICAgICAgICA/IChydWxlLmNoYXRfaWRzIHx8IFtdKS5tYXAoTnVtYmVyKS5maWx0ZXIoZnVuY3Rpb24gKGlkKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAocnVsZS5jaGF0cyB8fCBbXSkuc29tZShmdW5jdGlvbiAoY2hhdCkgeyByZXR1cm4gTnVtYmVyKGNoYXQuaWQpID09PSBpZDsgfSk7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICA6IFtdLFxuICAgICAgICAgICAgbWFzazogcnVsZSA/ICEhKHJ1bGUub3B0aW9ucyAmJiBydWxlLm9wdGlvbnMubWFza19waG9uZSA9PT0gdHJ1ZSlcbiAgICAgICAgICAgICAgICA6ICEhKHN0YXRlLnNldHRpbmdzICYmIHN0YXRlLnNldHRpbmdzLm1hc2tfcGhvbmVfZGVmYXVsdCA9PT0gdHJ1ZSksXG4gICAgICAgICAgICByZXRyYWN0OiBub3JtYWxpemVSZXRyYWN0KHJ1bGUgPyBydWxlLm9wdGlvbnMgOiBudWxsKSxcbiAgICAgICAgICAgIGF0dGFjaG1lbnRzOiBub3JtYWxpemVBdHRhY2htZW50cyhydWxlID8gcnVsZS5vcHRpb25zIDogbnVsbCksXG4gICAgICAgICAgICBib3RJZDogcnVsZSAmJiBydWxlLmNoYXRzICYmIHJ1bGUuY2hhdHMubGVuZ3RoID4gMCA/IE51bWJlcihydWxlLmNoYXRzWzBdLmJvdF9pZCkgOiAwLFxuICAgICAgICAgICAgZXJyb3I6ICcnXG4gICAgICAgIH07XG4gICAgICAgIHZhciBvcGVuZWQgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAocnVsZSAmJiB3aXphcmRTdXBwb3J0c1JlYXNvbnMob3BlbmVkLmV2ZW50VHlwZXMpICYmIG9wZW5lZC5maWx0ZXJzLnJlYXNvbnMgPT09IG51bGwpIHtcbiAgICAgICAgICAgIG9wZW5lZC5maWx0ZXJzLnJlYXNvbnMgPSBjbG91ZEFpUmVhc29ucyh0cnVlKTsgLy8gbm8gZmlsdGVyID0gZXZlcnkgcmVhc29uLCBpbmNsdWRpbmcgYSBtYW51YWwgcGF1c2VcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtcnVsZXMtdmlldycpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkJykucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgICQoJyNtZXNzZW5nZXItaHViLXJvb3QnKS5hZGRDbGFzcygnbWgtd2l6YXJkLW9wZW4nKTtcbiAgICAgICAgY2xlYXJXaXphcmRFcnJvcigpO1xuICAgICAgICByZW5kZXJXaXphcmQoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjbG9zZVJ1bGVXaXphcmQoKSB7XG4gICAgICAgICQoJyNtaC13aXphcmQtcHJldmlldywgI21oLXdpemFyZC1wcmV2aWV3LXRhcmdldCcpLmVtcHR5KCk7XG4gICAgICAgIHN0YXRlLnJ1bGVXaXphcmQgPSBudWxsO1xuICAgICAgICAkKCcjbWgtd2l6YXJkJykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1ydWxlcy12aWV3JykucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgICQoJyNtZXNzZW5nZXItaHViLXJvb3QnKS5yZW1vdmVDbGFzcygnbWgtd2l6YXJkLW9wZW4nKTtcbiAgICAgICAgcmVuZGVyUnVsZXMoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRTY2VuYXJpbygpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICByZXR1cm4gdyAmJiB3LnNvdXJjZUlkID8gc291cmNlQnlJZCh3LnNvdXJjZUlkKSA6IG51bGw7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2l6YXJkU3VwcG9ydHNFbXBsb3llZXModHlwZXMpIHtcbiAgICAgICAgdmFyIGNhbGxUeXBlcyA9IFsnY29yZS5taXNzZWRfY2FsbCcsICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJ107XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdHlwZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChjYWxsVHlwZXMuaW5kZXhPZih0eXBlc1tpXSkgPj0gMCkgeyByZXR1cm4gdHJ1ZTsgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRTdXBwb3J0c0RpcmVjdGlvbnModHlwZXMpIHtcbiAgICAgICAgcmV0dXJuIHR5cGVzLmluZGV4T2YoJ2NvcmUubWlzc2VkX2NhbGwnKSA+PSAwIHx8IHR5cGVzLmluZGV4T2YoJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnKSA+PSAwO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHdpemFyZFN1cHBvcnRzUHJvdmlkZXJzKHR5cGVzKSB7XG4gICAgICAgIHJldHVybiB0eXBlcy5pbmRleE9mKCdjb3JlLnByb3ZpZGVyX2Rvd24nKSA+PSAwIHx8IHR5cGVzLmluZGV4T2YoJ2NvcmUucHJvdmlkZXJfdXAnKSA+PSAwO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHdpemFyZEhhc1JlY292ZXJ5KHR5cGVzKSB7XG4gICAgICAgIHJldHVybiBPYmplY3Qua2V5cyhTVEFUVVNfUEFJUlMpLnNvbWUoZnVuY3Rpb24gKHByb2JsZW0pIHsgcmV0dXJuIHR5cGVzLmluZGV4T2YoU1RBVFVTX1BBSVJTW3Byb2JsZW1dKSA+PSAwOyB9KTtcbiAgICB9XG5cbiAgICAvLyBBIG1vZHVsZSBzdGF0dXMgc2NlbmFyaW8gKHByb2JsZW0gYW5kL29yIGl0cyByZWNvdmVyeSk6IHN0ZXAgMiBvZmZlcnMgwqvQodC+0L7QsdGJ0LDRgtGMINC+INCy0L7RgdGB0YLQsNC90L7QstC70LXQvdC40LjCuy5cbiAgICBmdW5jdGlvbiB3aXphcmRIYXNTdGF0dXModHlwZXMpIHtcbiAgICAgICAgcmV0dXJuIHdpemFyZEhhc1JlY292ZXJ5KHR5cGVzKSB8fCBPYmplY3Qua2V5cyhTVEFUVVNfUEFJUlMpLnNvbWUoZnVuY3Rpb24gKHByb2JsZW0pIHsgcmV0dXJuIHR5cGVzLmluZGV4T2YocHJvYmxlbSkgPj0gMDsgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2l6YXJkU3VwcG9ydHNSZWFzb25zKHR5cGVzKSB7XG4gICAgICAgIHJldHVybiB0eXBlcy5pbmRleE9mKCdjbG91ZF9haS5wYXVzZWQnKSA+PSAwIHx8IHR5cGVzLmluZGV4T2YoJ2Nsb3VkX2FpLnJlc3VtZWQnKSA+PSAwO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHdpemFyZFN1cHBvcnRzU2V2ZXJpdHkodHlwZXMpIHtcbiAgICAgICAgcmV0dXJuIHR5cGVzLmluZGV4T2YoJ2Nsb3VkX3N0dC5pbmNpZGVudCcpID49IDA7XG4gICAgfVxuXG4gICAgLy8gQWRkcyBvciByZW1vdmVzIHRoZSByZWNvdmVyeSB0eXBlIG9mIGV2ZXJ5IHByb2JsZW0gdHlwZSBpbiB0aGUgbGlzdC5cbiAgICBmdW5jdGlvbiB3aXphcmRXaXRoUmVjb3ZlcnkodHlwZXMsIG9uKSB7XG4gICAgICAgIHZhciByZWNvdmVyaWVzID0gT2JqZWN0LmtleXMoU1RBVFVTX1BBSVJTKS5tYXAoZnVuY3Rpb24gKHByb2JsZW0pIHsgcmV0dXJuIFNUQVRVU19QQUlSU1twcm9ibGVtXTsgfSk7XG4gICAgICAgIHZhciByZXN1bHQgPSB0eXBlcy5maWx0ZXIoZnVuY3Rpb24gKHR5cGUpIHsgcmV0dXJuIHJlY292ZXJpZXMuaW5kZXhPZih0eXBlKSA8IDA7IH0pO1xuICAgICAgICBpZiAob24pIHtcbiAgICAgICAgICAgIHJlc3VsdC5zbGljZSgpLmZvckVhY2goZnVuY3Rpb24gKHR5cGUpIHtcbiAgICAgICAgICAgICAgICBpZiAoU1RBVFVTX1BBSVJTW3R5cGVdICYmIHJlc3VsdC5pbmRleE9mKFNUQVRVU19QQUlSU1t0eXBlXSkgPCAwKSB7IHJlc3VsdC5wdXNoKFNUQVRVU19QQUlSU1t0eXBlXSk7IH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgLy8gU3RlcCAyIGV4aXN0cyBvbmx5IGZvciBzY2VuYXJpb3Mgd2l0aCBjb25kaXRpb25zOyB0aGUgb3RoZXJzIGdvIHN0cmFpZ2h0IHRvIMKr0JrRg9C00LAg0L7RgtC/0YDQsNCy0LjRgtGMwrsuXG4gICAgZnVuY3Rpb24gd2l6YXJkSGFzQ29uZGl0aW9ucyh0eXBlcykge1xuICAgICAgICByZXR1cm4gd2l6YXJkU3VwcG9ydHNFbXBsb3llZXModHlwZXMpIHx8IHdpemFyZFN1cHBvcnRzRGlyZWN0aW9ucyh0eXBlcykgfHwgd2l6YXJkU3VwcG9ydHNQcm92aWRlcnModHlwZXMpXG4gICAgICAgICAgICB8fCB3aXphcmRIYXNTdGF0dXModHlwZXMpXG4gICAgICAgICAgICB8fCB0eXBlcy5pbmRleE9mKCdjb3JlLm1pc3NlZF9jYWxsJykgPj0gMCB8fCB0eXBlcy5pbmRleE9mKCdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJykgPj0gMDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmaXJzdFN0ZXBBZnRlclNjZW5hcmlvKHR5cGVzKSB7XG4gICAgICAgIHJldHVybiB3aXphcmRIYXNDb25kaXRpb25zKHR5cGVzKSA/IDIgOiAzO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlcldpemFyZCgpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgICQoJyNtaC13aXphcmQtc3RlcC0xJykuYXR0cignaGlkZGVuJywgdy5zdGVwICE9PSAxKTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1zdGVwLTInKS5hdHRyKCdoaWRkZW4nLCB3LnN0ZXAgIT09IDIpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXN0ZXAtMycpLmF0dHIoJ2hpZGRlbicsIHcuc3RlcCAhPT0gMyk7XG4gICAgICAgICQoJyNtaC13aXphcmQnKS5hdHRyKCdkYXRhLXN0ZXAnLCBTdHJpbmcody5zdGVwKSk7XG4gICAgICAgIHZhciBzY2VuYXJpbyA9IHdpemFyZFNjZW5hcmlvKCk7XG4gICAgICAgIHZhciB0aXRsZTtcbiAgICAgICAgaWYgKHcuc3RlcCA9PT0gMSkge1xuICAgICAgICAgICAgdGl0bGUgPSB3LmVkaXRJZCA+IDAgPyB3LnRpdGxlIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkVGl0bGUnKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRpdGxlID0gdy5lZGl0SWQgPiAwID8gdy50aXRsZSA6IChzY2VuYXJpbyA/IHNjZW5hcmlvLm5hbWUgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRUaXRsZScpKTtcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtd2l6YXJkLXRpdGxlJykudGV4dCh0aXRsZSk7XG4gICAgICAgIC8vIG9uZSBiYXNpYyBidXR0b24gb24gdGhlIGxlZnQ6IMKr0J7RgtC80LXQvdCwwrsgb24gdGhlIGZpcnN0IHN0ZXAsIMKr0J3QsNC30LDQtMK7IGFmdGVyIGl0XG4gICAgICAgIHZhciBjYW5Hb0JhY2sgPSB3LnN0ZXAgPiAxICYmICEody5lZGl0SWQgPiAwICYmIHcuc3RlcCA9PT0gZmlyc3RTdGVwQWZ0ZXJTY2VuYXJpbyh3LmV2ZW50VHlwZXMpICYmIHcuc291cmNlSWQgPT09ICcnKTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1wcmV2JykudGV4dCh3LnN0ZXAgPT09IDEgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRDYW5jZWwnKSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZEJhY2tCdXR0b24nKSlcbiAgICAgICAgICAgIC5kYXRhKCdtb2RlJywgY2FuR29CYWNrID8gJ2JhY2snIDogJ2NhbmNlbCcpO1xuICAgICAgICB2YXIgaXNMYXN0ID0gdy5zdGVwID09PSAzO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLW5leHQnKS50ZXh0KGlzTGFzdFxuICAgICAgICAgICAgPyAody5lZGl0SWQgPiAwID8gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkU2F2ZScpIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkQ3JlYXRlJykpXG4gICAgICAgICAgICA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZE5leHQnKSk7XG4gICAgICAgIGlmICh3LnN0ZXAgPT09IDEpIHsgcmVuZGVyV2l6YXJkU2NlbmFyaW9zKCk7IH1cbiAgICAgICAgaWYgKHcuc3RlcCA9PT0gMikgeyByZW5kZXJXaXphcmRDb25kaXRpb25zKCk7IH1cbiAgICAgICAgaWYgKHcuc3RlcCA9PT0gMykgeyByZW5kZXJXaXphcmRSZWNpcGllbnRzKCk7IH1cbiAgICAgICAgdXBkYXRlV2l6YXJkTmV4dCgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHVwZGF0ZVdpemFyZE5leHQoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICB2YXIgZGlzYWJsZWQgPSB3LnN0ZXAgPT09IDEgJiYgdy5zb3VyY2VJZCA9PT0gJyc7XG4gICAgICAgIGlmICh3LnN0ZXAgPT09IDMpIHtcbiAgICAgICAgICAgIGRpc2FibGVkID0gYWN0aXZlV2l6YXJkQm90KCkgPT09IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLXdpemFyZC1uZXh0JykucHJvcCgnZGlzYWJsZWQnLCBkaXNhYmxlZCkudG9nZ2xlQ2xhc3MoJ2Rpc2FibGVkJywgZGlzYWJsZWQpO1xuICAgIH1cblxuICAgIC8vIE9uZSBpY29uIHBlciBzY2VuYXJpbyAoZGVzaWduIHYzLCBzdGVwIDEpLlxuICAgIHZhciBTQ0VOQVJJT19JQ09OUyA9IHtcbiAgICAgICAgcGhvbmU6ICc8cGF0aCBkPVwiTTQuNSAyLjVoMmwxIDMtMS41IDFhOCA4IDAgMCAwIDMuNSAzLjVsMS0xLjUgMyAxdjJhMS41IDEuNSAwIDAgMS0xLjUgMS41QTEwLjUgMTAuNSAwIDAgMSAzIDRhMS41IDEuNSAwIDAgMSAxLjUtMS41elwiLz4nLFxuICAgICAgICBtaWM6ICc8cmVjdCB4PVwiNlwiIHk9XCIyXCIgd2lkdGg9XCI0XCIgaGVpZ2h0PVwiNy41XCIgcng9XCIyXCIvPjxwYXRoIGQ9XCJNMy41IDhhNC41IDQuNSAwIDAgMCA5IDBNOCAxMi41VjE0XCIvPicsXG4gICAgICAgIHNwYXJrbGU6ICc8cGF0aCBkPVwiTTggMnYzTTggMTF2M00yIDhoM00xMSA4aDNNMy44IDMuOGwyIDJNMTAuMiAxMC4ybDIgMk0zLjggMTIuMmwyLTJNMTAuMiA1LjhsMi0yXCIvPicsXG4gICAgICAgIHJvYm90OiAnPHJlY3QgeD1cIjNcIiB5PVwiNVwiIHdpZHRoPVwiMTBcIiBoZWlnaHQ9XCI4XCIgcng9XCIyXCIvPjxwYXRoIGQ9XCJNOCAyLjVWNU02IDloLjAxTTEwIDloLjAxXCIvPicsXG4gICAgICAgIHNlcnZlcjogJzxyZWN0IHg9XCIyLjVcIiB5PVwiM1wiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCI0XCIgcng9XCIxXCIvPjxyZWN0IHg9XCIyLjVcIiB5PVwiOVwiIHdpZHRoPVwiMTFcIiBoZWlnaHQ9XCI0XCIgcng9XCIxXCIvPjxwYXRoIGQ9XCJNNSA1aC4wMU01IDExaC4wMVwiLz4nLFxuICAgICAgICB3YXJuaW5nOiAnPHBhdGggZD1cIk04IDIuNWw2IDEwLjVIMnpcIi8+PHBhdGggZD1cIk04IDYuNXYzTTggMTEuMnYuMVwiLz4nLFxuICAgICAgICBib2x0OiAnPHBhdGggZD1cIk05IDEuNUwzLjUgOUg4bC0xIDUuNUwxMi41IDdIOHpcIi8+JyxcbiAgICAgICAgZ2VhcjogJzxjaXJjbGUgY3g9XCI4XCIgY3k9XCI4XCIgcj1cIjIuMlwiLz48cGF0aCBkPVwiTTggMS44djEuN004IDEyLjV2MS43TTEuOCA4aDEuN00xMi41IDhoMS43TTMuNiAzLjZsMS4yIDEuMk0xMS4yIDExLjJsMS4yIDEuMk0zLjYgMTIuNGwxLjItMS4yTTExLjIgNC44bDEuMi0xLjJcIi8+JyxcbiAgICAgICAgZ2xvYmU6ICc8Y2lyY2xlIGN4PVwiOFwiIGN5PVwiOFwiIHI9XCI2XCIvPjxwYXRoIGQ9XCJNMiA4aDEyTTggMmMxLjcgMS44IDIuNiAzLjggMi42IDZTOS43IDEyLjIgOCAxNGMtMS43LTEuOC0yLjYtMy44LTIuNi02UzYuMyAzLjggOCAyelwiLz4nLFxuICAgICAgICBrZXk6ICc8Y2lyY2xlIGN4PVwiNS41XCIgY3k9XCI4XCIgcj1cIjIuNVwiLz48cGF0aCBkPVwiTTggOGg2TTEyIDh2Mi41TTEwIDh2MlwiLz4nLFxuICAgICAgICBzaGllbGQ6ICc8cGF0aCBkPVwiTTggMmw1IDJ2NGMwIDMtMi4zIDUtNSA2LTIuNy0xLTUtMy01LTZWNHpcIi8+PHBhdGggZD1cIk02LjIgOGwxLjMgMS4zTDEwIDYuOFwiLz4nXG4gICAgfTtcbiAgICB2YXIgU0NFTkFSSU9fSUNPTl9CWV9TT1VSQ0UgPSB7XG4gICAgICAgICdjb3JlLm1pc3NlZF9jYWxsJzogJ3Bob25lJyxcbiAgICAgICAgJ2NvcmUudm9pY2VtYWlsJzogJ21pYycsXG4gICAgICAgICdjb3JlLnF1ZXVlX2FiYW5kb25lZCc6ICdwaG9uZScsXG4gICAgICAgICdjb3JlLmNhbGxfb3V0X29mX2hvdXJzJzogJ3dhcm5pbmcnLFxuICAgICAgICAnY29yZS5wYXJrX3RpbWVvdXQnOiAncGhvbmUnLFxuICAgICAgICAnYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCc6ICdzcGFya2xlJyxcbiAgICAgICAgJ2FpX3N1cGVydmlzb3Iud29ya2Vycyc6ICdyb2JvdCcsXG4gICAgICAgICdsb2NhbF9zdHQud29ya2Vycyc6ICdtaWMnLFxuICAgICAgICAnbG9jYWxfc3R0LmJhY2tsb2cnOiAnbWljJyxcbiAgICAgICAgJ2Nsb3VkX3N0dC5pbmNpZGVudHMnOiAnbWljJyxcbiAgICAgICAgJ2Nsb3VkX3N0dC5wYXVzZWQnOiAnbWljJyxcbiAgICAgICAgJ2Nsb3VkX2FpLnBhdXNlZCc6ICdzcGFya2xlJyxcbiAgICAgICAgJ3ZvaWNlX2FnZW50LmNhbGxiYWNrcyc6ICdwaG9uZScsXG4gICAgICAgICd2b2ljZV9hZ2VudC5ydW50aW1lJzogJ3JvYm90JyxcbiAgICAgICAgJ2NvcmUucHJvdmlkZXJfc3RhdHVzJzogJ3NlcnZlcicsXG4gICAgICAgICdjb3JlLmFkdmljZSc6ICd3YXJuaW5nJyxcbiAgICAgICAgJ2NvcmUucGJ4X3N0YXJ0ZWQnOiAnYm9sdCcsXG4gICAgICAgICdjb3JlLmNvbmZpZ19jaGFuZ2VkJzogJ2dlYXInLFxuICAgICAgICAnY29yZS5leHRlcm5hbF9pcF9jaGFuZ2VkJzogJ2dsb2JlJyxcbiAgICAgICAgJ2NvcmUubGljZW5zZV9leHBpcmluZyc6ICdrZXknLFxuICAgICAgICAnY29yZS50b2xsX2ZyYXVkJzogJ3dhcm5pbmcnLFxuICAgICAgICAnY29yZS5leHRlbnNpb25fbmV3X2RldmljZSc6ICdzaGllbGQnLFxuICAgICAgICAnY29yZS5zaXBfYXV0aF9mYWlsdXJlcyc6ICdzaGllbGQnXG4gICAgfTtcblxuICAgIGZ1bmN0aW9uIHNjZW5hcmlvSWNvbihzb3VyY2VJZCkge1xuICAgICAgICB2YXIgcGF0aHMgPSBTQ0VOQVJJT19JQ09OU1tTQ0VOQVJJT19JQ09OX0JZX1NPVVJDRVtzb3VyY2VJZF0gfHwgJ3dhcm5pbmcnXTtcbiAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIm1oLXNjZW5hcmlvLWljb25cIj48c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBhcmlhLWhpZGRlbj1cInRydWVcIj4nICsgcGF0aHMgKyAnPC9zdmc+PC9zcGFuPic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyV2l6YXJkU2NlbmFyaW9zKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIHZhciBncm91cHMgPSBHUk9VUF9PUkRFUi5maWx0ZXIoZnVuY3Rpb24gKGdyb3VwKSB7XG4gICAgICAgICAgICByZXR1cm4gc3RhdGUuc291cmNlcy5zb21lKGZ1bmN0aW9uIChzb3VyY2UpIHsgcmV0dXJuIHNvdXJjZS5ncm91cCA9PT0gZ3JvdXA7IH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgdmFyIGh0bWwgPSAnJztcbiAgICAgICAgZ3JvdXBzLmZvckVhY2goZnVuY3Rpb24gKGdyb3VwKSB7XG4gICAgICAgICAgICB2YXIgc291cmNlcyA9IHN0YXRlLnNvdXJjZXMuZmlsdGVyKGZ1bmN0aW9uIChzb3VyY2UpIHsgcmV0dXJuIHNvdXJjZS5ncm91cCA9PT0gZ3JvdXA7IH0pO1xuICAgICAgICAgICAgaWYgKGdyb3Vwcy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICAgICAgaHRtbCArPSAnPGgzIGNsYXNzPVwibWgtZ3JvdXAtdGl0bGVcIj4nICsgZXNjKHNvdXJjZUdyb3VwTmFtZShncm91cCkpICsgJzwvaDM+JztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJtaC1zY2VuYXJpby1ncmlkXCI+JztcbiAgICAgICAgICAgIHNvdXJjZXMuZm9yRWFjaChmdW5jdGlvbiAoc291cmNlKSB7XG4gICAgICAgICAgICAgICAgdmFyIGRpc2FibGVkID0gWydtb2R1bGVfbWlzc2luZycsICdtb2R1bGVfZGlzYWJsZWQnLCAnYXBpX2ZvcmJpZGRlbicsICdhcGlfaW5jb21wYXRpYmxlJywgJ2Vycm9yJywgJ2Rpc2FibGVkJ11cbiAgICAgICAgICAgICAgICAgICAgLmluZGV4T2Yoc291cmNlLmF2YWlsYWJpbGl0eSkgPj0gMDtcbiAgICAgICAgICAgICAgICB2YXIgc2VsZWN0ZWQgPSB3LnNvdXJjZUlkID09PSBzb3VyY2UuaWQ7XG4gICAgICAgICAgICAgICAgLy8gVW5hdmFpbGFibGUgc2NlbmFyaW86IG9ubHkgdGhlIHJlYXNvbiwgbm8gYWN0aW9uICh1c2VyIGRlY2lzaW9uIFExNCkuXG4gICAgICAgICAgICAgICAgaHRtbCArPSAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJtaC1zY2VuYXJpbycgKyAoZGlzYWJsZWQgPyAnIGlzLWRpc2FibGVkJyA6ICcnKSArIChzZWxlY3RlZCA/ICcgaXMtc2VsZWN0ZWQnIDogJycpXG4gICAgICAgICAgICAgICAgICAgICsgJ1wiIGRhdGEtc291cmNlLWlkPVwiJyArIGVzYyhzb3VyY2UuaWQpICsgJ1wiIGFyaWEtcHJlc3NlZD1cIicgKyAoc2VsZWN0ZWQgPyAndHJ1ZScgOiAnZmFsc2UnKSArICdcIidcbiAgICAgICAgICAgICAgICAgICAgKyAoZGlzYWJsZWQgPyAnIGRpc2FibGVkIGFyaWEtZGlzYWJsZWQ9XCJ0cnVlXCInIDogJycpICsgJz4nXG4gICAgICAgICAgICAgICAgICAgICsgc2NlbmFyaW9JY29uKHNvdXJjZS5pZClcbiAgICAgICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1zY2VuYXJpby10ZXh0XCI+PGI+JyArIGVzYyhzb3VyY2UubmFtZSkgKyAnPC9iPidcbiAgICAgICAgICAgICAgICAgICAgKyAoZGlzYWJsZWQgPyAnPHNwYW4gY2xhc3M9XCJtaC1tZXRhXCI+JyArIGVzYyhzb3VyY2VTdGF0ZVRleHQoc291cmNlKSkgKyAnPC9zcGFuPicgOiAnJylcbiAgICAgICAgICAgICAgICAgICAgKyAnPC9zcGFuPjwvYnV0dG9uPic7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGh0bWwgKz0gJzwvZGl2Pic7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXNjZW5hcmlvcycpLmh0bWwoaHRtbCk7XG4gICAgfVxuXG4gICAgLy8gLS0tLSBzdGVwIDI6IGNvbmRpdGlvbnMgKG5vIGhpbnRzOyBhbiBlbXB0eSBjaG9pY2UgbWVhbnMgwqvQstGB0LXCuykgLS0tLVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyV2l6YXJkQ29uZGl0aW9ucygpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgIHZhciBodG1sID0gJyc7XG4gICAgICAgIGlmICh3aXphcmRTdXBwb3J0c0VtcGxveWVlcyh3LmV2ZW50VHlwZXMpKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZmllbGQnICsgKHN0YXRlLmVtcGxveWVlc0ZhaWxlZCA/ICcgZXJyb3InIDogJycpICsgJ1wiIGlkPVwibWgtY29uZC1lbXBsb3llZXMtZmllbGRcIj4nXG4gICAgICAgICAgICAgICAgKyAnPGxhYmVsPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkRW1wbG95ZWVzJykpICsgJzwvbGFiZWw+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJ1aSBtdWx0aXBsZSBzZWFyY2ggc2VsZWN0aW9uIGRyb3Bkb3duIG1oLWNvbmQtZHJvcGRvd25cIiBpZD1cIm1oLWNvbmQtZW1wbG95ZWVzXCIgdGFiaW5kZXg9XCIwXCI+J1xuICAgICAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiaGlkZGVuXCI+PHNwYW4gY2xhc3M9XCJkZWZhdWx0IHRleHRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0ZpbHRlckFsbCcpKSArICc8L3NwYW4+PGRpdiBjbGFzcz1cIm1lbnVcIj48L2Rpdj48L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAoc3RhdGUuZW1wbG95ZWVzRmFpbGVkXG4gICAgICAgICAgICAgICAgICAgID8gJzxzcGFuIGNsYXNzPVwibWgtaGVscFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkTGlzdEZhaWxlZCcpKVxuICAgICAgICAgICAgICAgICAgICAgICAgKyAnIDxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJyZXRyeS1lbXBsb3llZXNcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblJldHJ5JykpICsgJzwvYT48L3NwYW4+J1xuICAgICAgICAgICAgICAgICAgICA6ICcnKVxuICAgICAgICAgICAgICAgICsgJzwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHdpemFyZFN1cHBvcnRzRGlyZWN0aW9ucyh3LmV2ZW50VHlwZXMpKSB7XG4gICAgICAgICAgICB2YXIgZGlyZWN0aW9ucyA9IFtcbiAgICAgICAgICAgICAgICBbJ2luY29taW5nJywgJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZERpcmVjdGlvbkluY29taW5nJ10sXG4gICAgICAgICAgICAgICAgWydvdXRnb2luZycsICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmREaXJlY3Rpb25PdXRnb2luZyddLFxuICAgICAgICAgICAgICAgIFsnaW50ZXJuYWwnLCAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkRGlyZWN0aW9uSW50ZXJuYWwnXVxuICAgICAgICAgICAgXTtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJmaWVsZFwiPjxsYWJlbD4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZERpcmVjdGlvbnMnKSkgKyAnPC9sYWJlbD4nXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLXNlZ1wiIHJvbGU9XCJncm91cFwiIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZERpcmVjdGlvbnMnKSkgKyAnXCI+JztcbiAgICAgICAgICAgIGRpcmVjdGlvbnMuZm9yRWFjaChmdW5jdGlvbiAocGFpcikge1xuICAgICAgICAgICAgICAgIHZhciBwcmVzc2VkID0gdy5maWx0ZXJzLmRpcmVjdGlvbnMuaW5kZXhPZihwYWlyWzBdKSA+PSAwO1xuICAgICAgICAgICAgICAgIGh0bWwgKz0gJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGRhdGEtZGlyZWN0aW9uPVwiJyArIHBhaXJbMF0gKyAnXCIgYXJpYS1wcmVzc2VkPVwiJyArIChwcmVzc2VkID8gJ3RydWUnIDogJ2ZhbHNlJykgKyAnXCI+J1xuICAgICAgICAgICAgICAgICAgICArIGVzYyh0KHBhaXJbMV0pKSArICc8L2J1dHRvbj4nO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBodG1sICs9ICc8L2Rpdj48L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3aXphcmRTdXBwb3J0c1Byb3ZpZGVycyh3LmV2ZW50VHlwZXMpKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZmllbGRcIj48bGFiZWw+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRQcm92aWRlcnMnKSkgKyAnPC9sYWJlbD4nXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cInVpIG11bHRpcGxlIHNlYXJjaCBzZWxlY3Rpb24gZHJvcGRvd24gbWgtY29uZC1kcm9wZG93blwiIGlkPVwibWgtY29uZC1wcm92aWRlcnNcIiB0YWJpbmRleD1cIjBcIj4nXG4gICAgICAgICAgICAgICAgKyAnPGlucHV0IHR5cGU9XCJoaWRkZW5cIj48c3BhbiBjbGFzcz1cImRlZmF1bHQgdGV4dFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRmlsdGVyQWxsJykpICsgJzwvc3Bhbj48ZGl2IGNsYXNzPVwibWVudVwiPjwvZGl2PjwvZGl2PjwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHcuZXZlbnRUeXBlcy5pbmRleE9mKCdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJykgPj0gMCkge1xuICAgICAgICAgICAgdmFyIHJhbmdlID0gdy5maWx0ZXJzLnF1YWxpdHlfc2NvcmUgfHwge307XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZmllbGRcIj48bGFiZWw+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRRdWFsaXR5JykpICsgJzwvbGFiZWw+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1pbmxpbmUtaW5wdXRzXCI+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUXVhbGl0eUZyb20nKSkgKyAnPC9zcGFuPjxpbnB1dCB0eXBlPVwibnVtYmVyXCIgbWluPVwiMFwiIG1heD1cIjEwMFwiIGNsYXNzPVwibWgtcXVhbGl0eS1taW4gbWgtaW5wdXQteHNcIiB2YWx1ZT1cIicgKyAocmFuZ2UubWluICE9PSB1bmRlZmluZWQgPyByYW5nZS5taW4gOiAnJykgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUXVhbGl0eVRvJykpICsgJzwvc3Bhbj48aW5wdXQgdHlwZT1cIm51bWJlclwiIG1pbj1cIjBcIiBtYXg9XCIxMDBcIiBjbGFzcz1cIm1oLXF1YWxpdHktbWF4IG1oLWlucHV0LXhzXCIgdmFsdWU9XCInICsgKHJhbmdlLm1heCAhPT0gdW5kZWZpbmVkID8gcmFuZ2UubWF4IDogJycpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8L2Rpdj48L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3aXphcmRTdXBwb3J0c1NldmVyaXR5KHcuZXZlbnRUeXBlcykpIHtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJmaWVsZFwiPjxsYWJlbD4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFNldmVyaXR5JykpICsgJzwvbGFiZWw+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1zZWdcIiByb2xlPVwiZ3JvdXBcIiBhcmlhLWxhYmVsPVwiJyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRTZXZlcml0eScpKSArICdcIj4nO1xuICAgICAgICAgICAgW1snd2FybmluZycsICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRTZXZlcml0eVdhcm5pbmcnXSwgWydjcml0aWNhbCcsICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRTZXZlcml0eUNyaXRpY2FsJ11dLmZvckVhY2goZnVuY3Rpb24gKHBhaXIpIHtcbiAgICAgICAgICAgICAgICBodG1sICs9ICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBkYXRhLXNldmVyaXR5PVwiJyArIHBhaXJbMF0gKyAnXCIgYXJpYS1wcmVzc2VkPVwiJyArICh3Lm1pblNldmVyaXR5ID09PSBwYWlyWzBdID8gJ3RydWUnIDogJ2ZhbHNlJykgKyAnXCI+J1xuICAgICAgICAgICAgICAgICAgICArIGVzYyh0KHBhaXJbMV0pKSArICc8L2J1dHRvbj4nO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBodG1sICs9ICc8L2Rpdj48L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3aXphcmRTdXBwb3J0c1JlYXNvbnMody5ldmVudFR5cGVzKSkge1xuICAgICAgICAgICAgdmFyIGNob3NlbiA9IHcuZmlsdGVycy5yZWFzb25zIHx8IFtdO1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImZpZWxkXCIgaWQ9XCJtaC1jb25kLXJlYXNvbnNcIj48bGFiZWw+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRSZWFzb25zJykpICsgJzwvbGFiZWw+JztcbiAgICAgICAgICAgIENMT1VEX0FJX1JFQVNPTl9HUk9VUFMuZm9yRWFjaChmdW5jdGlvbiAoZ3JvdXApIHtcbiAgICAgICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwibWgtcmVhc29uLWdyb3VwXCI+PGRpdiBjbGFzcz1cIm1oLXJlYXNvbi10aXRsZVwiPicgKyBlc2ModChncm91cFswXSkpICsgJzwvZGl2Pic7XG4gICAgICAgICAgICAgICAgZ3JvdXBbMV0uZm9yRWFjaChmdW5jdGlvbiAocmVhc29uKSB7XG4gICAgICAgICAgICAgICAgICAgIGh0bWwgKz0gJzxsYWJlbCBjbGFzcz1cIm1oLXJlYXNvbi1jaGVja1wiPjxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBkYXRhLXJlYXNvbj1cIicgKyByZWFzb24gKyAnXCInXG4gICAgICAgICAgICAgICAgICAgICAgICArIChjaG9zZW4uaW5kZXhPZihyZWFzb24pID49IDAgPyAnIGNoZWNrZWQnIDogJycpICsgJz4nXG4gICAgICAgICAgICAgICAgICAgICAgICArICc8c3Bhbj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViXycgKyBTVEFUVVNfUEFVU0VfS0VZU1tyZWFzb25dKSkgKyAnPC9zcGFuPjwvbGFiZWw+JztcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBodG1sICs9ICc8L2Rpdj4nO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBodG1sICs9ICc8L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3aXphcmRIYXNTdGF0dXMody5ldmVudFR5cGVzKSkge1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIm1oLXN3aXRjaC1yb3cgbWgtcmVjb3Zlci1yb3dcIj4nXG4gICAgICAgICAgICAgICAgKyAnPGxhYmVsIGNsYXNzPVwidWkgdG9nZ2xlIGNoZWNrYm94JyArICh3LnJlY292ZXIgPyAnIGNoZWNrZWQnIDogJycpICsgJ1wiIGlkPVwibWgtcmVjb3Zlci1lbmFibGVkXCI+J1xuICAgICAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjbGFzcz1cImhpZGRlblwiJyArICh3LnJlY292ZXIgPyAnIGNoZWNrZWQnIDogJycpICsgJyBhcmlhLWxhYmVsPVwiJyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRSZWNvdmVyeScpKSArICdcIj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC10cmFja1wiPjwvc3Bhbj48L2xhYmVsPidcbiAgICAgICAgICAgICAgICArICc8c3Bhbj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFJlY292ZXJ5JykpICsgJzwvc3Bhbj48L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3LmV2ZW50VHlwZXMuaW5kZXhPZignY29yZS5taXNzZWRfY2FsbCcpID49IDApIHtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJtaC1zd2l0Y2gtcm93IG1oLXJldHJhY3Qtcm93XCI+J1xuICAgICAgICAgICAgICAgICsgJzxsYWJlbCBjbGFzcz1cInVpIHRvZ2dsZSBjaGVja2JveCcgKyAody5yZXRyYWN0LmVuYWJsZWQgPyAnIGNoZWNrZWQnIDogJycpICsgJ1wiIGlkPVwibWgtcmV0cmFjdC1lbmFibGVkXCI+J1xuICAgICAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjbGFzcz1cImhpZGRlblwiJyArICh3LnJldHJhY3QuZW5hYmxlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAnIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1JldHJhY3RFbmFibGVkJykpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXRyYWNrXCI+PC9zcGFuPjwvbGFiZWw+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUmV0cmFjdEVuYWJsZWQnKSkgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWlubGluZS1pbnB1dHNcIiBpZD1cIm1oLXJldHJhY3Qtb3B0aW9uc1wiJyArICh3LnJldHJhY3QuZW5hYmxlZCA/ICcnIDogJyBoaWRkZW4nKSArICc+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbXV0ZWRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1JldHJhY3RXaW5kb3dCZWZvcmUnKSkgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8aW5wdXQgdHlwZT1cIm51bWJlclwiIG1pbj1cIjVcIiBtYXg9XCIxMjBcIiBpZD1cIm1oLXJldHJhY3Qtd2luZG93XCIgY2xhc3M9XCJtaC1pbnB1dC14c1wiIHZhbHVlPVwiJyArIHcucmV0cmFjdC53aW5kb3dfbWluICsgJ1wiIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1JldHJhY3RNaW51dGVzJykpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW11dGVkXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SZXRyYWN0TWludXRlcycpKSArICc8L3NwYW4+PC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAod2l6YXJkSXNNYXgoKVxuICAgICAgICAgICAgICAgICAgICA/ICc8ZGl2IGNsYXNzPVwiZmllbGRcIiBpZD1cIm1oLXJldHJhY3QtbWF4LWhpbnRcIicgKyAody5yZXRyYWN0LmVuYWJsZWQgPyAnJyA6ICcgaGlkZGVuJykgKyAnPidcbiAgICAgICAgICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtaGVscFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUmV0cmFjdE1heEhpbnQnKSkgKyAnPC9zcGFuPjwvZGl2PidcbiAgICAgICAgICAgICAgICAgICAgOiAnJyk7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLXdpemFyZC1jb25kaXRpb25zJykuaHRtbChodG1sKTtcbiAgICAgICAgaW5pdENvbmRpdGlvbkRyb3Bkb3ducygpO1xuICAgICAgICBiaW5kV2l6YXJkQ29uZGl0aW9ucygpO1xuICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaW5pdENvbmRpdGlvbkRyb3Bkb3ducygpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICB2YXIgJGVtcGxveWVlcyA9ICQoJyNtaC1jb25kLWVtcGxveWVlcycpO1xuICAgICAgICBpZiAoJGVtcGxveWVlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB2YXIgc2VsZWN0ZWRVc2VycyA9IHcuZmlsdGVycy51c2VyX2lkcy5tYXAoU3RyaW5nKTtcbiAgICAgICAgICAgICRlbXBsb3llZXMuZHJvcGRvd24oe1xuICAgICAgICAgICAgICAgIHZhbHVlczogc3RhdGUuZW1wbG95ZWVzLm1hcChmdW5jdGlvbiAoZW1wbG95ZWUpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgbmFtZTogZW1wbG95ZWUubGFiZWwsIHZhbHVlOiBTdHJpbmcoZW1wbG95ZWUuaWQpLCBzZWxlY3RlZDogc2VsZWN0ZWRVc2Vycy5pbmRleE9mKFN0cmluZyhlbXBsb3llZS5pZCkpID49IDAgfTtcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcjogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRmlsdGVyQWxsJyksXG4gICAgICAgICAgICAgICAgZnVsbFRleHRTZWFyY2g6IHRydWUsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogeyBub1Jlc3VsdHM6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0ZpbHRlck5vdGhpbmdGb3VuZCcpIH0sXG4gICAgICAgICAgICAgICAgb25DaGFuZ2U6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXN0YXRlLnJ1bGVXaXphcmQpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLnJ1bGVXaXphcmQuZmlsdGVycy51c2VyX2lkcyA9IFN0cmluZyh2YWx1ZSB8fCAnJykuc3BsaXQoJywnKS5maWx0ZXIoQm9vbGVhbikubWFwKE51bWJlcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyICRwcm92aWRlcnMgPSAkKCcjbWgtY29uZC1wcm92aWRlcnMnKTtcbiAgICAgICAgaWYgKCRwcm92aWRlcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdmFyIHNlbGVjdGVkUHJvdmlkZXJzID0gdy5maWx0ZXJzLnByb3ZpZGVycy5tYXAoU3RyaW5nKTtcbiAgICAgICAgICAgICRwcm92aWRlcnMuZHJvcGRvd24oe1xuICAgICAgICAgICAgICAgIHZhbHVlczogc3RhdGUucHJvdmlkZXJzLm1hcChmdW5jdGlvbiAocHJvdmlkZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgbmFtZTogcHJvdmlkZXIubGFiZWwsIHZhbHVlOiBTdHJpbmcocHJvdmlkZXIuaWQpLCBzZWxlY3RlZDogc2VsZWN0ZWRQcm92aWRlcnMuaW5kZXhPZihTdHJpbmcocHJvdmlkZXIuaWQpKSA+PSAwIH07XG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgcGxhY2Vob2xkZXI6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0ZpbHRlckFsbCcpLFxuICAgICAgICAgICAgICAgIGZ1bGxUZXh0U2VhcmNoOiB0cnVlLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IHsgbm9SZXN1bHRzOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9GaWx0ZXJOb3RoaW5nRm91bmQnKSB9LFxuICAgICAgICAgICAgICAgIG9uQ2hhbmdlOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS5ydWxlV2l6YXJkKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLmZpbHRlcnMucHJvdmlkZXJzID0gU3RyaW5nKHZhbHVlIHx8ICcnKS5zcGxpdCgnLCcpLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJpbmRXaXphcmRDb25kaXRpb25zKCkge1xuICAgICAgICB2YXIgJGZvcm0gPSAkKCcjbWgtd2l6YXJkLWNvbmRpdGlvbnMnKTtcbiAgICAgICAgJGZvcm0ub2ZmKCcud2l6YXJkJyk7XG4gICAgICAgICRmb3JtLm9uKCdjbGljay53aXphcmQnLCAnLm1oLXNlZyBidXR0b25bZGF0YS1zZXZlcml0eV0nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB3Lm1pblNldmVyaXR5ID0gU3RyaW5nKCQodGhpcykuZGF0YSgnc2V2ZXJpdHknKSkgPT09ICdjcml0aWNhbCcgPyAnY3JpdGljYWwnIDogJ3dhcm5pbmcnO1xuICAgICAgICAgICAgJCh0aGlzKS5jbG9zZXN0KCcubWgtc2VnJykuZmluZCgnYnV0dG9uJykuYXR0cignYXJpYS1wcmVzc2VkJywgJ2ZhbHNlJyk7XG4gICAgICAgICAgICAkKHRoaXMpLmF0dHIoJ2FyaWEtcHJlc3NlZCcsICd0cnVlJyk7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkZm9ybS5vbignY2hhbmdlLndpemFyZCcsICcjbWgtcmVjb3Zlci1lbmFibGVkIGlucHV0JywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdy5yZWNvdmVyID0gJCh0aGlzKS5wcm9wKCdjaGVja2VkJyk7XG4gICAgICAgICAgICAkKCcjbWgtcmVjb3Zlci1lbmFibGVkJykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCB3LnJlY292ZXIpO1xuICAgICAgICAgICAgdy5ldmVudFR5cGVzID0gd2l6YXJkV2l0aFJlY292ZXJ5KHcuZXZlbnRUeXBlcywgdy5yZWNvdmVyKTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZFByZXZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICRmb3JtLm9uKCdjaGFuZ2Uud2l6YXJkJywgJyNtaC1jb25kLXJlYXNvbnMgaW5wdXRbZGF0YS1yZWFzb25dJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdy5maWx0ZXJzLnJlYXNvbnMgPSAkZm9ybS5maW5kKCcjbWgtY29uZC1yZWFzb25zIGlucHV0W2RhdGEtcmVhc29uXTpjaGVja2VkJykubWFwKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gU3RyaW5nKCQodGhpcykuZGF0YSgncmVhc29uJykpO1xuICAgICAgICAgICAgfSkuZ2V0KCk7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkZm9ybS5vbignY2xpY2sud2l6YXJkJywgJy5taC1zZWcgYnV0dG9uW2RhdGEtZGlyZWN0aW9uXScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHZhciB2YWx1ZSA9IFN0cmluZygkKHRoaXMpLmRhdGEoJ2RpcmVjdGlvbicpKTtcbiAgICAgICAgICAgIHZhciBpbmRleCA9IHcuZmlsdGVycy5kaXJlY3Rpb25zLmluZGV4T2YodmFsdWUpO1xuICAgICAgICAgICAgaWYgKGluZGV4ID49IDApIHtcbiAgICAgICAgICAgICAgICB3LmZpbHRlcnMuZGlyZWN0aW9ucy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB3LmZpbHRlcnMuZGlyZWN0aW9ucy5wdXNoKHZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICQodGhpcykuYXR0cignYXJpYS1wcmVzc2VkJywgaW5kZXggPj0gMCA/ICdmYWxzZScgOiAndHJ1ZScpO1xuICAgICAgICAgICAgcmVuZGVyV2l6YXJkUHJldmlldygpO1xuICAgICAgICB9KTtcbiAgICAgICAgJGZvcm0ub24oJ2NsaWNrLndpemFyZCcsICdbZGF0YS1hY3Rpb249XCJyZXRyeS1lbXBsb3llZXNcIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBzdGF0ZS5lbXBsb3llZXNGYWlsZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGxvYWRFbXBsb3llZXMoZnVuY3Rpb24gKCkgeyByZW5kZXJXaXphcmRDb25kaXRpb25zKCk7IH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgJGZvcm0ub24oJ2NoYW5nZS53aXphcmQnLCAnI21oLXJldHJhY3QtZW5hYmxlZCBpbnB1dCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHcucmV0cmFjdC5lbmFibGVkID0gJCh0aGlzKS5wcm9wKCdjaGVja2VkJyk7XG4gICAgICAgICAgICAkKCcjbWgtcmV0cmFjdC1lbmFibGVkJykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCB3LnJldHJhY3QuZW5hYmxlZCk7XG4gICAgICAgICAgICAkKCcjbWgtcmV0cmFjdC1vcHRpb25zJykucHJvcCgnaGlkZGVuJywgIXcucmV0cmFjdC5lbmFibGVkKTtcbiAgICAgICAgICAgICQoJyNtaC1yZXRyYWN0LW1heC1oaW50JykucHJvcCgnaGlkZGVuJywgIXcucmV0cmFjdC5lbmFibGVkKTtcbiAgICAgICAgfSk7XG4gICAgICAgICRmb3JtLm9uKCdpbnB1dC53aXphcmQgY2hhbmdlLndpemFyZCcsICcjbWgtcmV0cmFjdC13aW5kb3cnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIgdmFsdWUgPSBOdW1iZXIoJCh0aGlzKS52YWwoKSk7XG4gICAgICAgICAgICB3LnJldHJhY3Qud2luZG93X21pbiA9IHZhbHVlID49IDUgJiYgdmFsdWUgPD0gMTIwID8gdmFsdWUgOiAyMDtcbiAgICAgICAgfSk7XG4gICAgICAgICRmb3JtLm9uKCdpbnB1dC53aXphcmQnLCAnLm1oLXF1YWxpdHktbWluLCAubWgtcXVhbGl0eS1tYXgnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIgbWluID0gJGZvcm0uZmluZCgnLm1oLXF1YWxpdHktbWluJykudmFsKCk7XG4gICAgICAgICAgICB2YXIgbWF4ID0gJGZvcm0uZmluZCgnLm1oLXF1YWxpdHktbWF4JykudmFsKCk7XG4gICAgICAgICAgICB2YXIgcmFuZ2UgPSB7fTtcbiAgICAgICAgICAgIGlmIChTdHJpbmcobWluKS50cmltKCkgIT09ICcnKSB7IHJhbmdlLm1pbiA9IE51bWJlcihtaW4pOyB9XG4gICAgICAgICAgICBpZiAoU3RyaW5nKG1heCkudHJpbSgpICE9PSAnJykgeyByYW5nZS5tYXggPSBOdW1iZXIobWF4KTsgfVxuICAgICAgICAgICAgdy5maWx0ZXJzLnF1YWxpdHlfc2NvcmUgPSBPYmplY3Qua2V5cyhyYW5nZSkubGVuZ3RoID4gMCA/IHJhbmdlIDogbnVsbDtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZFByZXZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLSBzdGVwIDM6IHdoZXJlIHRvIHNlbmQgLS0tLVxuXG4gICAgZnVuY3Rpb24gYWN0aXZlV2l6YXJkQm90KCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm4gbnVsbDsgfVxuICAgICAgICB2YXIgYm90cyA9IHN0YXRlLmJvdHMuZmlsdGVyKGZ1bmN0aW9uIChib3QpIHsgcmV0dXJuIGJvdC5lbmFibGVkICE9PSBmYWxzZTsgfSk7XG4gICAgICAgIGlmICh3LmJvdElkID4gMCkge1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBib3RzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgaWYgKE51bWJlcihib3RzW2ldLmlkKSA9PT0gTnVtYmVyKHcuYm90SWQpKSB7IHJldHVybiBib3RzW2ldOyB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGJvdHMubGVuZ3RoID4gMCA/IGJvdHNbMF0gOiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlcldpemFyZFJlY2lwaWVudHMoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgdmFyIHN1cHBvcnRzRW1wbG95ZWVzID0gd2l6YXJkU3VwcG9ydHNFbXBsb3llZXMody5ldmVudFR5cGVzKTtcbiAgICAgICAgdmFyIGJvdHMgPSBzdGF0ZS5ib3RzLmZpbHRlcihmdW5jdGlvbiAoYm90KSB7IHJldHVybiBib3QuZW5hYmxlZCAhPT0gZmFsc2U7IH0pO1xuICAgICAgICB2YXIgYWN0aXZlID0gYWN0aXZlV2l6YXJkQm90KCk7XG4gICAgICAgIGlmIChhY3RpdmUgIT09IG51bGwgJiYgTnVtYmVyKHcuYm90SWQpICE9PSBOdW1iZXIoYWN0aXZlLmlkKSkge1xuICAgICAgICAgICAgdy5ib3RJZCA9IE51bWJlcihhY3RpdmUuaWQpOyAvLyBhIHNpbmdsZSBib3QgaXMgc2VsZWN0ZWQgYnkgaXRzZWxmXG4gICAgICAgIH1cbiAgICAgICAgdmFyIGJvdEh0bWwgPSAnJztcbiAgICAgICAgYm90cy5mb3JFYWNoKGZ1bmN0aW9uIChib3QpIHtcbiAgICAgICAgICAgIHZhciBzZWxlY3RlZCA9IGFjdGl2ZSAhPT0gbnVsbCAmJiBOdW1iZXIoYWN0aXZlLmlkKSA9PT0gTnVtYmVyKGJvdC5pZCk7XG4gICAgICAgICAgICB2YXIgY2hhbm5lbCA9IGJvdC5jaGFubmVsID09PSAnbWF4JyA/ICdtYXgnIDogJ3RnJztcbiAgICAgICAgICAgIGJvdEh0bWwgKz0gJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwibWgtc2NlbmFyaW8gbWgtYm90LWNob2ljZScgKyAoc2VsZWN0ZWQgPyAnIGlzLXNlbGVjdGVkJyA6ICcnKVxuICAgICAgICAgICAgICAgICsgJ1wiIGRhdGEtYm90LWlkPVwiJyArIGJvdC5pZCArICdcIiBhcmlhLXByZXNzZWQ9XCInICsgKHNlbGVjdGVkID8gJ3RydWUnIDogJ2ZhbHNlJykgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyICcgKyBjaGFubmVsICsgJ1wiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPicgKyAoY2hhbm5lbCA9PT0gJ21heCcgPyAnTUFYJyA6ICdURycpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICAgICAgKyAnPGIgY2xhc3M9XCJtaC10cnVuY2F0ZVwiPicgKyBlc2MoYm90LnRpdGxlKSArICc8L2I+PC9idXR0b24+JztcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtYm90cycpLmh0bWwoYm90SHRtbCk7XG4gICAgICAgICQoJyNtaC13aXphcmQtYm90cy1maWVsZCcpLmF0dHIoJ2hpZGRlbicsIGJvdHMubGVuZ3RoID4gMCA/IG51bGwgOiB0cnVlKTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1uby1ib3RzJykuYXR0cignaGlkZGVuJywgYm90cy5sZW5ndGggPiAwID8gdHJ1ZSA6IG51bGwpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXRhcmdldCcpLmF0dHIoJ2hpZGRlbicsIGJvdHMubGVuZ3RoID4gMCA/IG51bGwgOiB0cnVlKTtcblxuICAgICAgICBpZiAoIXN1cHBvcnRzRW1wbG95ZWVzKSB7XG4gICAgICAgICAgICB3LnRhcmdldE1vZGUgPSAncmVjaXBpZW50cyc7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLXRhcmdldCBbdmFsdWU9XCJlbXBsb3llZVwiXSwgI21oLXdpemFyZC10YXJnZXQgW3ZhbHVlPVwiZW1wbG95ZWVfb3JfcmVjaXBpZW50c1wiXScpXG4gICAgICAgICAgICAgICAgLmNsb3Nlc3QoJ2xhYmVsJykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLXRhcmdldCBbdmFsdWU9XCJlbXBsb3llZVwiXSwgI21oLXdpemFyZC10YXJnZXQgW3ZhbHVlPVwiZW1wbG95ZWVfb3JfcmVjaXBpZW50c1wiXScpXG4gICAgICAgICAgICAgICAgLmNsb3Nlc3QoJ2xhYmVsJykucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQgaW5wdXRbbmFtZT1cIm1oLXRhcmdldFwiXScpLmVhY2goZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGNoZWNrZWQgPSAkKHRoaXMpLnZhbCgpID09PSB3LnRhcmdldE1vZGU7XG4gICAgICAgICAgICAkKHRoaXMpLnByb3AoJ2NoZWNrZWQnLCBjaGVja2VkKS5jbG9zZXN0KCdsYWJlbCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgY2hlY2tlZCk7XG4gICAgICAgIH0pO1xuICAgICAgICByZW5kZXJXaXphcmRDaGF0cygpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLW1hc2snKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsIHcubWFzayk7XG4gICAgICAgICQoJyNtaC13aXphcmQtbWFzayBpbnB1dCcpLnByb3AoJ2NoZWNrZWQnLCB3Lm1hc2spO1xuICAgICAgICByZW5kZXJXaXphcmRBdHRhY2htZW50cygpO1xuICAgICAgICBiaW5kV2l6YXJkUmVjaXBpZW50cygpO1xuICAgICAgICAvLyBhIHNjZW5hcmlvIHdpdGhvdXQgY29uZGl0aW9ucyBnb2VzIDEgLT4gMzogc3RlcCAzIG11c3QgcmVuZGVyIGl0cyBvd24gcHJldmlld1xuICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyV2l6YXJkQXR0YWNobWVudHMoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgdmFyIG1vZGVzID0gd2l6YXJkQXR0YWNobWVudE1vZGVzKHcuZXZlbnRUeXBlcyk7XG4gICAgICAgIHZhciAkZmllbGQgPSAkKCcjbWgtd2l6YXJkLWF0dGFjaG1lbnRzJyk7XG4gICAgICAgIGlmIChtb2Rlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHcuYXR0YWNobWVudHMgPSAnbm9uZSc7XG4gICAgICAgICAgICAkZmllbGQuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1vZGVzLmluZGV4T2Yody5hdHRhY2htZW50cykgPCAwKSB7IHcuYXR0YWNobWVudHMgPSAnbm9uZSc7IH1cbiAgICAgICAgJGZpZWxkLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAvLyBhIHZvaWNlbWFpbCBpcyBvbmUgZmlsZTogdGhlIHdob2xlLWNvbnZlcnNhdGlvbiB3b3JkaW5nIGJlY29tZXMgcGxhaW4gXCJSZWNvcmRpbmdcIlxuICAgICAgICB2YXIgdm9pY2VtYWlsT25seSA9IHcuZXZlbnRUeXBlcy5pbmRleE9mKCdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJykgPCAwO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLWF0dGFjaC1yZWNvcmRpbmctdGV4dCcpLnRleHQodCh2b2ljZW1haWxPbmx5XG4gICAgICAgICAgICA/ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRBdHRhY2hWb2ljZW1haWwnXG4gICAgICAgICAgICA6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRBdHRhY2hSZWNvcmRpbmcnKSk7XG4gICAgICAgICRmaWVsZC5maW5kKCdsYWJlbFtkYXRhLW1vZGVdJykuZWFjaChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgbW9kZSA9IFN0cmluZygkKHRoaXMpLmRhdGEoJ21vZGUnKSk7XG4gICAgICAgICAgICB2YXIgY2hlY2tlZCA9IG1vZGUgPT09IHcuYXR0YWNobWVudHM7XG4gICAgICAgICAgICAkKHRoaXMpLmF0dHIoJ2hpZGRlbicsIG1vZGVzLmluZGV4T2YobW9kZSkgPj0gMCA/IG51bGwgOiB0cnVlKVxuICAgICAgICAgICAgICAgIC50b2dnbGVDbGFzcygnY2hlY2tlZCcsIGNoZWNrZWQpLmZpbmQoJ2lucHV0JykucHJvcCgnY2hlY2tlZCcsIGNoZWNrZWQpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1hdHRhY2gtaGludCcpLmF0dHIoJ2hpZGRlbicsIHcuYXR0YWNobWVudHMgPT09ICdub25lJyA/IHRydWUgOiBudWxsKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJXaXphcmRDaGF0cygpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICB2YXIgYm90ID0gYWN0aXZlV2l6YXJkQm90KCk7XG4gICAgICAgIHZhciBjaGF0cyA9IGJvdCA/IChib3QuY2hhdHMgfHwgW10pLmZpbHRlcihmdW5jdGlvbiAoY2hhdCkge1xuICAgICAgICAgICAgcmV0dXJuIGNoYXQuc3RhdGUgPT09ICdhY3RpdmUnICYmIGNoYXQuZW5hYmxlZCA9PT0gdHJ1ZTtcbiAgICAgICAgfSkgOiBbXTtcbiAgICAgICAgdmFyIGlkcyA9IGNoYXRzLm1hcChmdW5jdGlvbiAoY2hhdCkgeyByZXR1cm4gTnVtYmVyKGNoYXQuaWQpOyB9KTtcbiAgICAgICAgdy5jaGF0SWRzID0gdy5jaGF0SWRzLmZpbHRlcihmdW5jdGlvbiAoaWQpIHsgcmV0dXJuIGlkcy5pbmRleE9mKGlkKSA+PSAwOyB9KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1jaGF0cy1maWVsZCcpLmF0dHIoJ2hpZGRlbicsIHcudGFyZ2V0TW9kZSA9PT0gJ2VtcGxveWVlJyA/IHRydWUgOiBudWxsKTtcbiAgICAgICAgdmFyICRkcm9wZG93biA9ICQoJyNtaC13aXphcmQtY2hhdHMnKTtcbiAgICAgICAgJGRyb3Bkb3duLmRyb3Bkb3duKCdkZXN0cm95Jyk7XG4gICAgICAgICRkcm9wZG93bi5maW5kKCdhLnVpLmxhYmVsJykucmVtb3ZlKCk7XG4gICAgICAgICRkcm9wZG93bi5kcm9wZG93bih7XG4gICAgICAgICAgICB2YWx1ZXM6IGNoYXRzLm1hcChmdW5jdGlvbiAoY2hhdCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGVzYyhjaGF0LnRpdGxlIHx8IGNoYXQuY2hhdF9pZCkgKyAnIDxzcGFuIGNsYXNzPVwibWgtbWV0YVwiPsK3ICcgKyBlc2MoY2hhdEtpbmRMYWJlbChjaGF0LmNoYXRfa2luZCkpICsgJzwvc3Bhbj4nLFxuICAgICAgICAgICAgICAgICAgICB0ZXh0OiBlc2MoY2hhdC50aXRsZSB8fCBjaGF0LmNoYXRfaWQpLFxuICAgICAgICAgICAgICAgICAgICB2YWx1ZTogU3RyaW5nKGNoYXQuaWQpLFxuICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZDogdy5jaGF0SWRzLmluZGV4T2YoTnVtYmVyKGNoYXQuaWQpKSA+PSAwXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgcGxhY2Vob2xkZXI6IGNoYXRzLmxlbmd0aCA+IDAgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRDaGF0c1RpdGxlJykgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmROb0NoYXRzJyksXG4gICAgICAgICAgICBtZXNzYWdlOiB7IG5vUmVzdWx0czogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkTm9DaGF0cycpIH0sXG4gICAgICAgICAgICBvbkNoYW5nZTogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS5ydWxlV2l6YXJkKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICAgIHN0YXRlLnJ1bGVXaXphcmQuY2hhdElkcyA9IFN0cmluZyh2YWx1ZSB8fCAnJykuc3BsaXQoJywnKS5maWx0ZXIoQm9vbGVhbikubWFwKE51bWJlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJpbmRXaXphcmRSZWNpcGllbnRzKCkge1xuICAgICAgICB2YXIgJHN0ZXAgPSAkKCcjbWgtd2l6YXJkLXN0ZXAtMycpO1xuICAgICAgICAkc3RlcC5vZmYoJy53aXphcmQnKTtcbiAgICAgICAgJHN0ZXAub24oJ2NsaWNrLndpemFyZCcsICcubWgtYm90LWNob2ljZScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIHN0YXRlLnJ1bGVXaXphcmQuYm90SWQgPSBOdW1iZXIoJCh0aGlzKS5kYXRhKCdib3QtaWQnKSk7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLmNoYXRJZHMgPSBbXTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZFJlY2lwaWVudHMoKTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZFByZXZpZXcoKTtcbiAgICAgICAgICAgIHVwZGF0ZVdpemFyZE5leHQoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICRzdGVwLm9uKCdjaGFuZ2Uud2l6YXJkJywgJ2lucHV0W25hbWU9XCJtaC10YXJnZXRcIl0nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLnRhcmdldE1vZGUgPSBTdHJpbmcoJCh0aGlzKS52YWwoKSk7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLXRhcmdldCBpbnB1dFtuYW1lPVwibWgtdGFyZ2V0XCJdJykuZWFjaChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgJCh0aGlzKS5jbG9zZXN0KCdsYWJlbCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgJCh0aGlzKS5wcm9wKCdjaGVja2VkJykpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLWNoYXRzLWZpZWxkJykuYXR0cignaGlkZGVuJywgc3RhdGUucnVsZVdpemFyZC50YXJnZXRNb2RlID09PSAnZW1wbG95ZWUnID8gdHJ1ZSA6IG51bGwpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHN0ZXAub24oJ2NoYW5nZS53aXphcmQnLCAnaW5wdXRbbmFtZT1cIm1oLWF0dGFjaG1lbnRzXCJdJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc3RhdGUucnVsZVdpemFyZC5hdHRhY2htZW50cyA9IFN0cmluZygkKHRoaXMpLnZhbCgpKTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZEF0dGFjaG1lbnRzKCk7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkc3RlcC5vbignY2hhbmdlLndpemFyZCcsICcjbWgtd2l6YXJkLW1hc2sgaW5wdXQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLm1hc2sgPSAkKHRoaXMpLnByb3AoJ2NoZWNrZWQnKTtcbiAgICAgICAgICAgICQoJyNtaC13aXphcmQtbWFzaycpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgc3RhdGUucnVsZVdpemFyZC5tYXNrKTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZFByZXZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLSBwcmV2aWV3IChzdGVwIDIsIHJpZ2h0IGNvbHVtbikgLS0tLVxuXG4gICAgLyoqIEEgcnVsZSB0YXJnZXRzIG9uZSBib3QsIHNvIGl0cyBjaGFubmVsIGlzIHRoZSBjaGFubmVsIG9mIHRoZSBhY3RpdmUgd2l6YXJkIGJvdC4gKi9cbiAgICBmdW5jdGlvbiB3aXphcmRJc01heCgpIHtcbiAgICAgICAgdmFyIGJvdCA9IGFjdGl2ZVdpemFyZEJvdCgpO1xuICAgICAgICByZXR1cm4gISFib3QgJiYgYm90LmNoYW5uZWwgPT09ICdtYXgnO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHdpemFyZFByZXZpZXdDYWxsVHlwZSh0eXBlcykge1xuICAgICAgICB2YXIgb3JkZXIgPSBbXG4gICAgICAgICAgICAnY29yZS5taXNzZWRfY2FsbCcsICdjb3JlLnZvaWNlbWFpbCcsICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJyxcbiAgICAgICAgICAgICdhaV9zdXBlcnZpc29yLndvcmtlcl9vZmZsaW5lJywgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29ubGluZScsXG4gICAgICAgICAgICAnbG9jYWxfc3R0Lndvcmtlcl9vZmZsaW5lJywgJ2xvY2FsX3N0dC53b3JrZXJfb25saW5lJywgJ2xvY2FsX3N0dC5iYWNrbG9nX25vX3dvcmtlcnMnLCAnbG9jYWxfc3R0LmJhY2tsb2dfcmVzb2x2ZWQnLFxuICAgICAgICAgICAgJ2Nsb3VkX3N0dC5pbmNpZGVudCcsICdjbG91ZF9zdHQuaW5jaWRlbnRfcmVzb2x2ZWQnLCAnY2xvdWRfc3R0LnBhdXNlZCcsICdjbG91ZF9zdHQucmVzdW1lZCcsXG4gICAgICAgICAgICAnY2xvdWRfYWkucGF1c2VkJywgJ2Nsb3VkX2FpLnJlc3VtZWQnLFxuICAgICAgICAgICAgJ3ZvaWNlX2FnZW50LmNhbGxiYWNrX3JlcXVlc3QnLCAndm9pY2VfYWdlbnQucnVudGltZV9kb3duJywgJ3ZvaWNlX2FnZW50LnJ1bnRpbWVfdXAnLFxuICAgICAgICAgICAgJ2NvcmUucHJvdmlkZXJfZG93bicsICdjb3JlLnByb3ZpZGVyX3VwJywgJ2NvcmUuYWR2aWNlJywgJ2NvcmUucGJ4X3N0YXJ0ZWQnXG4gICAgICAgIF07XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgb3JkZXIubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmICh0eXBlcy5pbmRleE9mKG9yZGVyW2ldKSA+PSAwKSB7IHJldHVybiBvcmRlcltpXTsgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICAvLyBTYW1wbGUgZGF0YSBvZiB0aGUgcHJldmlldyBidWJibGVzIGZvciB0aGUgbW9kdWxlIHN0YXR1cyBldmVudHM7IG5ldmVyIHJlYWwgdmFsdWVzLlxuICAgIHZhciBTVEFUVVNfUFJFVklFV19TQU1QTEVTID0ge1xuICAgICAgICAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb2ZmbGluZSc6IHsgY29kZTogJ3dvcmtlcl9vZmZsaW5lJywgcmVmOiAnc2FtcGxlJywgY291bnRlcnM6IHsgd29ya2Vyc19vbmxpbmU6IDEsIHdvcmtlcnNfdG90YWw6IDIgfSB9LFxuICAgICAgICAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb25saW5lJzogeyBjb2RlOiAnd29ya2VyX29mZmxpbmUnLCByZWY6ICdzYW1wbGUnLCBjb3VudGVyczogeyB3b3JrZXJzX29ubGluZTogMiwgd29ya2Vyc190b3RhbDogMiB9IH0sXG4gICAgICAgICdsb2NhbF9zdHQud29ya2VyX29mZmxpbmUnOiB7IGNvZGU6ICd3b3JrZXJfb2ZmbGluZScsIHJlZjogJ3NhbXBsZScsIGNvdW50ZXJzOiB7IHdvcmtlcnNfb25saW5lOiAyLCB3b3JrZXJzX3RvdGFsOiAzIH0gfSxcbiAgICAgICAgJ2xvY2FsX3N0dC53b3JrZXJfb25saW5lJzogeyBjb2RlOiAnd29ya2VyX29mZmxpbmUnLCByZWY6ICdzYW1wbGUnLCBjb3VudGVyczogeyB3b3JrZXJzX29ubGluZTogMywgd29ya2Vyc190b3RhbDogMyB9IH0sXG4gICAgICAgICdsb2NhbF9zdHQuYmFja2xvZ19ub193b3JrZXJzJzogeyBjb2RlOiAnYmFja2xvZ19ub193b3JrZXJzJywgcmVmOiAncXVldWUnLCBjb3VudGVyczogeyB3b3JrZXJzX29ubGluZTogMCwgd29ya2Vyc190b3RhbDogMywgam9ic193YWl0aW5nOiAxMiB9IH0sXG4gICAgICAgICdsb2NhbF9zdHQuYmFja2xvZ19yZXNvbHZlZCc6IHsgY29kZTogJ2JhY2tsb2dfbm9fd29ya2VycycsIHJlZjogJ3F1ZXVlJywgY291bnRlcnM6IHsgd29ya2Vyc19vbmxpbmU6IDMsIHdvcmtlcnNfdG90YWw6IDMsIGpvYnNfd2FpdGluZzogMCB9IH0sXG4gICAgICAgICdjbG91ZF9zdHQuaW5jaWRlbnQnOiB7IGNvZGU6ICdpbmNpZGVudF9vcGVuJywgcmVmOiAnc2FtcGxlJywgY291bnRlcnM6IHsgaW5jaWRlbnRzX29wZW46IDEgfSB9LFxuICAgICAgICAnY2xvdWRfc3R0LmluY2lkZW50X3Jlc29sdmVkJzogeyBjb2RlOiAnaW5jaWRlbnRfb3BlbicsIHJlZjogJ3NhbXBsZScsIGNvdW50ZXJzOiB7IGluY2lkZW50c19vcGVuOiAwIH0gfSxcbiAgICAgICAgJ2Nsb3VkX3N0dC5wYXVzZWQnOiB7IGNvZGU6ICdwcm9jZXNzaW5nX3BhdXNlZCcsIHJlZjogJ21haW50ZW5hbmNlJywgY291bnRlcnM6IHt9IH0sXG4gICAgICAgICdjbG91ZF9zdHQucmVzdW1lZCc6IHsgY29kZTogJ3Byb2Nlc3NpbmdfcGF1c2VkJywgcmVmOiAnbWFpbnRlbmFuY2UnLCBjb3VudGVyczoge30gfSxcbiAgICAgICAgJ2Nsb3VkX2FpLnBhdXNlZCc6IHsgY29kZTogJ3Byb2Nlc3NpbmdfcGF1c2VkJywgcmVmOiAnaW5zdWZmaWNpZW50X2Z1bmRzJywgY291bnRlcnM6IHsgam9ic193YWl0aW5nOiAxMiB9IH0sXG4gICAgICAgICdjbG91ZF9haS5yZXN1bWVkJzogeyBjb2RlOiAncHJvY2Vzc2luZ19wYXVzZWQnLCByZWY6ICdpbnN1ZmZpY2llbnRfZnVuZHMnLCBjb3VudGVyczogeyBqb2JzX3dhaXRpbmc6IDAgfSB9XG4gICAgfTtcblxuICAgIGZ1bmN0aW9uIHJlbmRlcldpemFyZFByZXZpZXcoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICB2YXIgdHlwZSA9IHdpemFyZFByZXZpZXdDYWxsVHlwZSh3LmV2ZW50VHlwZXMpO1xuICAgICAgICBpZiAodHlwZSA9PT0gJycpIHtcbiAgICAgICAgICAgICQoJyNtaC13aXphcmQtcHJldmlldywgI21oLXdpemFyZC1wcmV2aWV3LXRhcmdldCcpLmVtcHR5KCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGh0bWwgPSB3aXphcmRQcmV2aWV3QnViYmxlKHR5cGUsIHcpO1xuICAgICAgICAvLyB0aGUgcmVjb3Zlcnkgc3dpdGNoIGlzIHBhcnQgb2YgdGhlIHByZXZpZXc6IGEgc2Vjb25kIGJ1YmJsZSBzaG93cyB3aGF0IHRoZSByZWNvdmVyeSBsb29rcyBsaWtlXG4gICAgICAgIHZhciByZWNvdmVyeSA9IFNUQVRVU19QQUlSU1t0eXBlXTtcbiAgICAgICAgaWYgKHJlY292ZXJ5ICYmIHcuZXZlbnRUeXBlcy5pbmRleE9mKHJlY292ZXJ5KSA+PSAwKSB7XG4gICAgICAgICAgICBodG1sICs9IHdpemFyZFByZXZpZXdCdWJibGUocmVjb3ZlcnksIHcpO1xuICAgICAgICB9XG4gICAgICAgIC8vIHRoZSBtZXNzZW5nZXIgaXMgcGFydCBvZiB0aGUgcHJldmlldywgc28gdGhlIGFzaWRlIHNheXMgd2hpY2ggYnViYmxlIGl0IHNob3dzXG4gICAgICAgIC8vICh0aGUgZGVzaWduIGhhcyBubyB2aXNpYmxlIGNhcHRpb24gYWJvdmUgdGhlIGJ1YmJsZSlcbiAgICAgICAgJCgnLm1oLXdpemFyZC1wcmV2aWV3JykuYXR0cignYXJpYS1sYWJlbCcsXG4gICAgICAgICAgICB0KHdpemFyZElzTWF4KCkgPyAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUHJldmlld0NoYW5uZWxNYXgnIDogJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFByZXZpZXdUaXRsZScpKTtcbiAgICAgICAgLy8gc3RlcCAyIHNob3dzIHRoZSBjb25kaXRpb25zIHByZXZpZXcsIHN0ZXAgMyB0aGUgc2FtZSBwcmV2aWV3IGZvciB0aGUgY2hvc2VuIGJvdFxuICAgICAgICAkKCcjbWgtd2l6YXJkLXByZXZpZXcsICNtaC13aXphcmQtcHJldmlldy10YXJnZXQnKS5odG1sKGh0bWwpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHdpemFyZFByZXZpZXdCdWJibGUodHlwZSwgdykge1xuICAgICAgICB2YXIgbmFtZXMgPSBldmVudFR5cGVOYW1lcygpO1xuICAgICAgICB2YXIgdGl0bGUgPSBuYW1lc1t0eXBlXSB8fCB0eXBlO1xuICAgICAgICBpZiAodHlwZSA9PT0gJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnKSB7XG4gICAgICAgICAgICB0aXRsZSArPSAnIMK3ICcgKyB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZVF1YWxpdHlTY29yZScsIHsgc2NvcmU6IDQ4IH0pO1xuICAgICAgICB9XG4gICAgICAgIHZhciBwaG9uZSA9IHcubWFzayA/ICcrNyA5NjggKioqLSoqLTQ0JyA6ICcrNyA5NjggOTY4LTk0LTQ0JztcbiAgICAgICAgdmFyIGxpbmVzID0gW107XG4gICAgICAgIHZhciBub3RlcyA9IFtdO1xuICAgICAgICB2YXIgYnV0dG9uID0gZmFsc2U7XG4gICAgICAgIHZhciBkaXJlY3Rpb24gPSB3LmZpbHRlcnMuZGlyZWN0aW9ucy5sZW5ndGggPT09IDEgPyB3LmZpbHRlcnMuZGlyZWN0aW9uc1swXSA6ICdpbmNvbWluZyc7XG4gICAgICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgICAgICAgY2FzZSAnY29yZS5taXNzZWRfY2FsbCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaCgnPGI+JyArIGVzYyhwaG9uZSkgKyAnPC9iPiDihpIg0JjQstCw0L3QvtCyINCYLiAoMjMzKScpO1xuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKCcwMi4xMC4yMDI2IDE1OjQxIMK3ICcgKyB0KHtcbiAgICAgICAgICAgICAgICAgICAgaW5jb21pbmc6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlRGlyZWN0aW9uSW5jb21pbmcnLFxuICAgICAgICAgICAgICAgICAgICBvdXRnb2luZzogJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VEaXJlY3Rpb25PdXRnb2luZycsXG4gICAgICAgICAgICAgICAgICAgIGludGVybmFsOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZURpcmVjdGlvbkludGVybmFsJ1xuICAgICAgICAgICAgICAgIH1bZGlyZWN0aW9uXSkpKTtcbiAgICAgICAgICAgICAgICBidXR0b24gPSB0cnVlO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnY29yZS52b2ljZW1haWwnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VWb2ljZW1haWxIaW50JykpKTtcbiAgICAgICAgICAgICAgICBidXR0b24gPSB0cnVlO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2MoJ9Cf0LXRgtGA0L7QstCwINCQLiAoMjQxKSDihpAgJyArICh3Lm1hc2sgPyAnKzcgOTE2ICoqKi0qKi0xNycgOiAnKzcgOTE2IDIwNC01NS0xNycpICsgJyDCtyA2OjQyJykpO1xuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlUmVhc29ucycsIHsgcmVhc29uczogJ9Ca0LvQuNC10L3RgtGDINC90LUg0L/QvtC80L7Qs9C70Lg7INC/0L7QstGC0L7RgNC90YvQuSDQt9Cy0L7QvdC+0LonIH0pKSk7XG4gICAgICAgICAgICAgICAgbm90ZXMucHVzaCgn0JrQu9C40LXQvdGC0YMg0L3QtSDQv9C+0LzQvtCz0LvQuDog0LTQstCw0LbQtNGLINC+0YLQv9GA0LDQstC40LvQuCDQvdCwINGB0LDQudGCLCDRgNC10YjQtdC90LjRjyDQvdC1INC/0YDQtdC00LvQvtC20LjQu9C4LicpO1xuICAgICAgICAgICAgICAgIGJ1dHRvbiA9IHRydWU7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICd2b2ljZV9hZ2VudC5jYWxsYmFja19yZXF1ZXN0JzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYygn0J/RkdGC0YAgwrcgJyArIHBob25lKSk7XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2ModGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VUb3BpYycsIHsgdG9waWM6ICfQktC+0LfQstGA0LDRgicgfSkpKTtcbiAgICAgICAgICAgICAgICBidXR0b24gPSB0cnVlO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnY29yZS5wcm92aWRlcl9kb3duJzpcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUucHJvdmlkZXJfdXAnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKCdTSVAgwqvQnNC10LPQsNGE0L7QvcK7IMK3IDEwLjAuMC4xJykpO1xuICAgICAgICAgICAgICAgIG5vdGVzLnB1c2goJ3JlZ2lzdGVyZWQg4oaSIHVucmVnaXN0ZXJlZCcpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb2ZmbGluZSc6XG4gICAgICAgICAgICBjYXNlICdhaV9zdXBlcnZpc29yLndvcmtlcl9vbmxpbmUnOlxuICAgICAgICAgICAgY2FzZSAnbG9jYWxfc3R0Lndvcmtlcl9vZmZsaW5lJzpcbiAgICAgICAgICAgIGNhc2UgJ2xvY2FsX3N0dC53b3JrZXJfb25saW5lJzpcbiAgICAgICAgICAgIGNhc2UgJ2xvY2FsX3N0dC5iYWNrbG9nX25vX3dvcmtlcnMnOlxuICAgICAgICAgICAgY2FzZSAnbG9jYWxfc3R0LmJhY2tsb2dfcmVzb2x2ZWQnOlxuICAgICAgICAgICAgY2FzZSAnY2xvdWRfc3R0LmluY2lkZW50JzpcbiAgICAgICAgICAgIGNhc2UgJ2Nsb3VkX3N0dC5pbmNpZGVudF9yZXNvbHZlZCc6XG4gICAgICAgICAgICBjYXNlICdjbG91ZF9zdHQucGF1c2VkJzpcbiAgICAgICAgICAgIGNhc2UgJ2Nsb3VkX3N0dC5yZXN1bWVkJzpcbiAgICAgICAgICAgIGNhc2UgJ2Nsb3VkX2FpLnBhdXNlZCc6XG4gICAgICAgICAgICBjYXNlICdjbG91ZF9haS5yZXN1bWVkJzpcbiAgICAgICAgICAgICAgICB2YXIgc2FtcGxlID0gU1RBVFVTX1BSRVZJRVdfU0FNUExFU1t0eXBlXTtcbiAgICAgICAgICAgICAgICBpZiAod2l6YXJkU3VwcG9ydHNSZWFzb25zKFt0eXBlXSkgJiYgdy5maWx0ZXJzLnJlYXNvbnMgJiYgdy5maWx0ZXJzLnJlYXNvbnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICAvLyB0aGUgc2FtcGxlIHNob3dzIHRoZSBmaXJzdCBzZWxlY3RlZCBwYXVzZSByZWFzb24sIHNvIHRoZSBjaG9pY2UgaXMgdmlzaWJsZVxuICAgICAgICAgICAgICAgICAgICBzYW1wbGUgPSAkLmV4dGVuZCh7fSwgc2FtcGxlLCB7IHJlZjogdy5maWx0ZXJzLnJlYXNvbnNbMF0gfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHZhciBzY2VuYXJpb1NvdXJjZSA9IHNvdXJjZUJ5SWQody5zb3VyY2VJZCk7XG4gICAgICAgICAgICAgICAgaWYgKHNjZW5hcmlvU291cmNlICYmIHNjZW5hcmlvU291cmNlLm1vZHVsZV9uYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKHNjZW5hcmlvU291cmNlLm1vZHVsZV9uYW1lKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKHN0YXR1c1BocmFzZSh0eXBlLCBzYW1wbGUpKSk7XG4gICAgICAgICAgICAgICAgc3RhdHVzQ291bnRlck5vdGVzKHNhbXBsZSkuZm9yRWFjaChmdW5jdGlvbiAobm90ZSkgeyBub3Rlcy5wdXNoKG5vdGUpOyB9KTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ3ZvaWNlX2FnZW50LnJ1bnRpbWVfZG93bic6XG4gICAgICAgICAgICBjYXNlICd2b2ljZV9hZ2VudC5ydW50aW1lX3VwJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKCdjb25uZWN0aW9uIHJlZnVzZWQnKTtcbiAgICAgICAgICAgICAgICBub3Rlcy5wdXNoKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlTGF0ZW5jeScsIHsgbXM6IDEyMDAgfSkpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnY29yZS5hZHZpY2UnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKCfQodCy0L7QsdC+0LTQvdC+IDggJSDQvdCwINGA0LDQt9C00LXQu9C1IC9zdG9yYWdlJykpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnY29yZS5jb25maWdfY2hhbmdlZCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2ModGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VDb25maWdBcmVhJywge1xuICAgICAgICAgICAgICAgICAgICBhcmVhOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db25maWdBcmVhUHJvdmlkZXJzJyksIGNvdW50OiAyXG4gICAgICAgICAgICAgICAgfSkpKTtcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYyh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZUNvbmZpZ0FyZWEnLCB7XG4gICAgICAgICAgICAgICAgICAgIGFyZWE6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbmZpZ0FyZWFSb3V0aW5nJyksIGNvdW50OiAxXG4gICAgICAgICAgICAgICAgfSkpKTtcbiAgICAgICAgICAgICAgICBub3Rlcy5wdXNoKCcwMi4xMC4yMDI2IDE1OjQxJyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdjb3JlLmV4dGVybmFsX2lwX2NoYW5nZWQnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goJzIwMy4wLjExMy41IOKGkiAyMDMuMC4xMTMuOScpO1xuICAgICAgICAgICAgICAgIG5vdGVzLnB1c2goZXNjKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlRXh0ZXJuYWxJcFNlZW5BdCcsIHsgdGltZTogJzAyLjEwLjIwMjYgMTU6NDEnIH0pKSk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdjb3JlLmxpY2Vuc2VfZXhwaXJpbmcnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goJ01pa29QQlgnKTtcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYyh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZUxpY2Vuc2VFeHBpcmVzT24nLCB7IGRhdGU6ICczMS4xMi4yMDI2JyB9KSkpO1xuICAgICAgICAgICAgICAgIG5vdGVzLnB1c2goZXNjKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlTGljZW5zZURheXNMZWZ0JywgeyBkYXlzOiA3IH0pKSk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdjb3JlLnBieF9zdGFydGVkJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKCcwMi4xMC4yMDI2IDAzOjEwJyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGlzTWF4ID0gd2l6YXJkSXNNYXgoKTtcbiAgICAgICAgdmFyIGh0bWwgPSAnPGRpdiBjbGFzcz1cIm1oLXByZXZpZXctbXNnJyArIChpc01heCA/ICcgaXMtbWF4JyA6ICcnKSArICdcIj48ZGl2PicgKyBlc2MoaWNvbkZvclR5cGUodHlwZSkpICsgJyA8Yj4nICsgZXNjKHRpdGxlKSArICc8L2I+PC9kaXY+JztcbiAgICAgICAgbGluZXMuZm9yRWFjaChmdW5jdGlvbiAobGluZSkgeyBodG1sICs9ICc8ZGl2PicgKyBsaW5lICsgJzwvZGl2Pic7IH0pO1xuICAgICAgICBub3Rlcy5mb3JFYWNoKGZ1bmN0aW9uIChub3RlKSB7IGh0bWwgKz0gJzxkaXY+PGk+JyArIGVzYyhub3RlKSArICc8L2k+PC9kaXY+JzsgfSk7XG4gICAgICAgIGh0bWwgKz0gJzxzcGFuIGNsYXNzPVwibWgtcHJldmlldy10aW1lXCI+MTU6NDE8L3NwYW4+PC9kaXY+JztcbiAgICAgICAgaHRtbCArPSB3aXphcmRQcmV2aWV3QXVkaW8odHlwZSwgdy5hdHRhY2htZW50cywgaXNNYXgpO1xuICAgICAgICBpZiAoYnV0dG9uKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwibWgtcHJldmlldy1idXR0b24nICsgKGlzTWF4ID8gJyBpcy1tYXgnIDogJycpICsgJ1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUHJldmlld0J1dHRvbicpKSArICcg4oaXPC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gaHRtbDtcbiAgICB9XG5cbiAgICAvLyBBdWRpbyBidWJibGVzIGZvbGxvdyB0aGUgdGV4dCAoUGxhbi8wMyk6IGZyYWdtZW50cyA9IG9uZSBidWJibGUgcGVyIGZyYWdtZW50LCBvdGhlcndpc2UgdGhlIHdob2xlIGZpbGUuXG4gICAgLy8gVGhlIG51bWJlcnMgYXJlIHNhbXBsZSB2YWx1ZXMgb2YgdGhlIHByZXZpZXcsIG5ldmVyIHJlYWwgZGF0YS5cbiAgICBmdW5jdGlvbiB3aXphcmRQcmV2aWV3QXVkaW8odHlwZSwgbW9kZSwgaXNNYXgpIHtcbiAgICAgICAgaWYgKG1vZGUgPT09ICdub25lJyB8fCB3aXphcmRBdHRhY2htZW50TW9kZXMoW3R5cGVdKS5pbmRleE9mKG1vZGUpIDwgMCkgeyByZXR1cm4gJyc7IH1cbiAgICAgICAgdmFyIGl0ZW1zID0gW107XG4gICAgICAgIGlmIChtb2RlID09PSAnZnJhZ21lbnRzJykge1xuICAgICAgICAgICAgdmFyIHNhbXBsZSA9IFsnMDoxMicsICcwOjE4J107XG4gICAgICAgICAgICBzYW1wbGUuZm9yRWFjaChmdW5jdGlvbiAoZHVyYXRpb24sIGluZGV4KSB7XG4gICAgICAgICAgICAgICAgaXRlbXMucHVzaCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfUHJldmlld0F1ZGlvRnJhZ21lbnQnLCB7IG46IGluZGV4ICsgMSwgdG90YWw6IHNhbXBsZS5sZW5ndGgsIGR1cmF0aW9uOiBkdXJhdGlvbiB9KSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGl0ZW1zLnB1c2godGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1ByZXZpZXdBdWRpb1JlY29yZGluZycsIHsgZHVyYXRpb246IHR5cGUgPT09ICdjb3JlLnZvaWNlbWFpbCcgPyAnMDozMicgOiAnNjo0MicgfSkpO1xuICAgICAgICB9XG4gICAgICAgIHZhciBodG1sID0gJyc7XG4gICAgICAgIGl0ZW1zLmZvckVhY2goZnVuY3Rpb24gKGNhcHRpb24pIHtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJtaC1wcmV2aWV3LW1zZyBtaC1wcmV2aWV3LWF1ZGlvJyArIChpc01heCA/ICcgaXMtbWF4JyA6ICcnKSArICdcIj4nXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLXByZXZpZXctYXVkaW8tcm93XCI+PHNwYW4gY2xhc3M9XCJtaC1wcmV2aWV3LXBsYXlcIiBhcmlhLWhpZGRlbj1cInRydWVcIj48L3NwYW4+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtcHJldmlldy13YXZlXCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+PC9zcGFuPjwvZGl2PidcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtbWV0YVwiPicgKyBlc2MoY2FwdGlvbikgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtcHJldmlldy10aW1lXCI+MTU6NDE8L3NwYW4+PC9kaXY+JztcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBodG1sO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGljb25Gb3JUeXBlKHR5cGUpIHtcbiAgICAgICAgaWYgKHR5cGUgPT09ICdjb3JlLm1pc3NlZF9jYWxsJyB8fCB0eXBlID09PSAndm9pY2VfYWdlbnQuY2FsbGJhY2tfcmVxdWVzdCcpIHsgcmV0dXJuICfwn5OeJzsgfVxuICAgICAgICBpZiAodHlwZSA9PT0gJ2NvcmUudm9pY2VtYWlsJykgeyByZXR1cm4gJ/CfjpknOyB9XG4gICAgICAgIGlmICh0eXBlID09PSAnYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCcgfHwgdHlwZSA9PT0gJ2NvcmUucHJvdmlkZXJfZG93bicgfHwgdHlwZSA9PT0gJ3ZvaWNlX2FnZW50LnJ1bnRpbWVfZG93bicpIHsgcmV0dXJuICfimqDvuI8nOyB9XG4gICAgICAgIGlmIChTVEFUVVNfUkVDT1ZFUllfS0VZU1t0eXBlXSB8fCB0eXBlID09PSAnY29yZS5wcm92aWRlcl91cCcgfHwgdHlwZSA9PT0gJ3ZvaWNlX2FnZW50LnJ1bnRpbWVfdXAnKSB7IHJldHVybiAn4pyFJzsgfVxuICAgICAgICBpZiAodHlwZSA9PT0gJ2FpX3N1cGVydmlzb3Iud29ya2VyX29mZmxpbmUnIHx8IHR5cGUgPT09ICdsb2NhbF9zdHQud29ya2VyX29mZmxpbmUnKSB7IHJldHVybiAn8J+UjCc7IH1cbiAgICAgICAgaWYgKHR5cGUgPT09ICdjb3JlLnBieF9zdGFydGVkJykgeyByZXR1cm4gJ/CflIQnOyB9XG4gICAgICAgIGlmICh0eXBlID09PSAnY29yZS5jb25maWdfY2hhbmdlZCcpIHsgcmV0dXJuICfwn5ugJzsgfVxuICAgICAgICBpZiAodHlwZSA9PT0gJ2NvcmUuZXh0ZXJuYWxfaXBfY2hhbmdlZCcpIHsgcmV0dXJuICfwn4yQJzsgfVxuICAgICAgICBpZiAodHlwZSA9PT0gJ2NvcmUubGljZW5zZV9leHBpcmluZycpIHsgcmV0dXJuICfimqDvuI8nOyB9XG4gICAgICAgIHJldHVybiAn4pqg77iPJztcbiAgICB9XG5cbiAgICAvLyAtLS0tIG5hdmlnYXRpb24gYW5kIHNhdmUgLS0tLVxuXG4gICAgZnVuY3Rpb24gd2l6YXJkTmV4dCgpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgIGlmICh3LnN0ZXAgPT09IDEpIHtcbiAgICAgICAgICAgIGlmICghdy5zb3VyY2VJZCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHcuc3RlcCA9IGZpcnN0U3RlcEFmdGVyU2NlbmFyaW8ody5ldmVudFR5cGVzKTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZCgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3LnN0ZXAgPT09IDIpIHtcbiAgICAgICAgICAgIGlmICh3aXphcmRTdXBwb3J0c1JlYXNvbnMody5ldmVudFR5cGVzKSAmJiAoIXcuZmlsdGVycy5yZWFzb25zIHx8IHcuZmlsdGVycy5yZWFzb25zLmxlbmd0aCA9PT0gMCkpIHtcbiAgICAgICAgICAgICAgICBzaG93V2l6YXJkRXJyb3IodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUmVhc29uc1JlcXVpcmVkJykpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHcuc3RlcCA9IDM7XG4gICAgICAgICAgICByZW5kZXJXaXphcmQoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBzYXZlUnVsZSgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHdpemFyZFByZXYoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICBpZiAoJCgnI21oLXdpemFyZC1wcmV2JykuZGF0YSgnbW9kZScpICE9PSAnYmFjaycpIHtcbiAgICAgICAgICAgIGNsb3NlUnVsZVdpemFyZCgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3LnN0ZXAgPT09IDMgJiYgd2l6YXJkSGFzQ29uZGl0aW9ucyh3LmV2ZW50VHlwZXMpKSB7XG4gICAgICAgICAgICB3LnN0ZXAgPSAyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdy5zdGVwID0gMTtcbiAgICAgICAgfVxuICAgICAgICBjbGVhcldpemFyZEVycm9yKCk7XG4gICAgICAgIHJlbmRlcldpemFyZCgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHBydW5lRmlsdGVycyhmaWx0ZXJzKSB7XG4gICAgICAgIHZhciByZXN1bHQgPSB7fTtcbiAgICAgICAgaWYgKGZpbHRlcnMudXNlcl9pZHMubGVuZ3RoID4gMCkgeyByZXN1bHQudXNlcl9pZHMgPSBmaWx0ZXJzLnVzZXJfaWRzOyB9XG4gICAgICAgIGlmIChmaWx0ZXJzLmRpcmVjdGlvbnMubGVuZ3RoID4gMCkgeyByZXN1bHQuZGlyZWN0aW9ucyA9IGZpbHRlcnMuZGlyZWN0aW9uczsgfVxuICAgICAgICBpZiAoZmlsdGVycy5wcm92aWRlcnMubGVuZ3RoID4gMCkgeyByZXN1bHQucHJvdmlkZXJzID0gZmlsdGVycy5wcm92aWRlcnM7IH1cbiAgICAgICAgLy8gZXZlcnkgcmVhc29uIHNlbGVjdGVkID0gbm8gZmlsdGVyIChhIG1hbnVhbCBwYXVzZSBpbmNsdWRlZCk7IGEgc3Vic2V0IGlzIHN0b3JlZCBhcyBjaG9zZW5cbiAgICAgICAgaWYgKGZpbHRlcnMucmVhc29ucyAmJiBmaWx0ZXJzLnJlYXNvbnMubGVuZ3RoID4gMCAmJiBmaWx0ZXJzLnJlYXNvbnMubGVuZ3RoIDwgY2xvdWRBaVJlYXNvbnModHJ1ZSkubGVuZ3RoKSB7XG4gICAgICAgICAgICByZXN1bHQucmVhc29ucyA9IGZpbHRlcnMucmVhc29ucztcbiAgICAgICAgfVxuICAgICAgICBpZiAoZmlsdGVycy5xdWFsaXR5X3Njb3JlICE9PSBudWxsICYmIE9iamVjdC5rZXlzKGZpbHRlcnMucXVhbGl0eV9zY29yZSkubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgcmVzdWx0LnF1YWxpdHlfc2NvcmUgPSBmaWx0ZXJzLnF1YWxpdHlfc2NvcmU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlUnVsZSgpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgIHZhciBzY2VuYXJpbyA9IHdpemFyZFNjZW5hcmlvKCk7XG4gICAgICAgIC8vIHRoZSB3aXphcmQgaGFzIG5vIG5hbWUgZmllbGQgKGRlc2lnbiB2Myk6IGEgbmV3IG5vdGlmaWNhdGlvbiBpcyBuYW1lZCBhZnRlciBpdHMgc2NlbmFyaW9cbiAgICAgICAgdmFyIHRpdGxlID0gU3RyaW5nKHcudGl0bGUgfHwgJycpLnRyaW0oKSB8fCAoc2NlbmFyaW8gPyBzY2VuYXJpby5uYW1lIDogJycpO1xuICAgICAgICBpZiAodGl0bGUgPT09ICcnKSB7XG4gICAgICAgICAgICBzaG93V2l6YXJkRXJyb3IodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkVGl0bGVSZXF1aXJlZCcpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAody50YXJnZXRNb2RlICE9PSAnZW1wbG95ZWUnICYmIHcuY2hhdElkcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHNob3dXaXphcmRFcnJvcih0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmROZWVkQ2hhdHMnKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIG9wdGlvbnMgPSB7IG1hc2tfcGhvbmU6IHcubWFzayB9O1xuICAgICAgICBpZiAody5ldmVudFR5cGVzLmluZGV4T2YoJ2NvcmUubWlzc2VkX2NhbGwnKSA+PSAwKSB7XG4gICAgICAgICAgICBvcHRpb25zLnJldHJhY3Rfb25fY2FsbGJhY2sgPSB7XG4gICAgICAgICAgICAgICAgZW5hYmxlZDogdy5yZXRyYWN0LmVuYWJsZWQgPT09IHRydWUsXG4gICAgICAgICAgICAgICAgd2luZG93X21pbjogdy5yZXRyYWN0LndpbmRvd19taW4gPj0gNSAmJiB3LnJldHJhY3Qud2luZG93X21pbiA8PSAxMjAgPyB3LnJldHJhY3Qud2luZG93X21pbiA6IDIwLFxuICAgICAgICAgICAgICAgIGNvdW50X2luY29taW5nX2Fuc3dlcmVkOiB3LnJldHJhY3QuY291bnRfaW5jb21pbmdfYW5zd2VyZWQgIT09IGZhbHNlXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGlmICh3aXphcmRBdHRhY2htZW50TW9kZXMody5ldmVudFR5cGVzKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBvcHRpb25zLmF0dGFjaG1lbnRzID0gdy5hdHRhY2htZW50cztcbiAgICAgICAgfVxuICAgICAgICB2YXIgcGF5bG9hZCA9IHtcbiAgICAgICAgICAgIHRpdGxlOiB0aXRsZSxcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBldmVudF90eXBlczogdy5ldmVudFR5cGVzLFxuICAgICAgICAgICAgbWluX3NldmVyaXR5OiB3aXphcmRTdXBwb3J0c1NldmVyaXR5KHcuZXZlbnRUeXBlcykgPyB3Lm1pblNldmVyaXR5IDogJ2luZm8nLFxuICAgICAgICAgICAgZmlsdGVyczogcHJ1bmVGaWx0ZXJzKHdpemFyZFN1cHBvcnRzUmVhc29ucyh3LmV2ZW50VHlwZXMpID8gdy5maWx0ZXJzIDogJC5leHRlbmQoe30sIHcuZmlsdGVycywgeyByZWFzb25zOiBudWxsIH0pKSxcbiAgICAgICAgICAgIHRhcmdldF9tb2RlOiB3LnRhcmdldE1vZGUsXG4gICAgICAgICAgICBjaGF0X2lkczogdy5jaGF0SWRzLFxuICAgICAgICAgICAgb3B0aW9uczogb3B0aW9uc1xuICAgICAgICB9O1xuICAgICAgICB2YXIgZG9uZSA9IGZ1bmN0aW9uIChydWxlKSB7XG4gICAgICAgICAgICBjbG9zZVJ1bGVXaXphcmQoKTtcbiAgICAgICAgICAgIHJlcGxhY2VSdWxlKHJ1bGUpO1xuICAgICAgICAgICAgbG9hZFJ1bGVzKHRydWUpO1xuICAgICAgICAgICAgc2hvd1RvYXN0KHQody5lZGl0SWQgPiAwID8gJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFNhdmVkJyA6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRDcmVhdGVkJykpO1xuICAgICAgICB9O1xuICAgICAgICB2YXIgZmFpbHVyZSA9IGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgIHNob3dXaXphcmRFcnJvcihmYWlsdXJlVGV4dChlcnIpKTtcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKHcuZWRpdElkID4gMCkge1xuICAgICAgICAgICAgYXBpUGF0Y2goJy9ydWxlcy8nICsgdy5lZGl0SWQsIHBheWxvYWQsIGRvbmUsIGZhaWx1cmUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYXBpUG9zdCgnL3J1bGVzJywgcGF5bG9hZCwgZG9uZSwgZmFpbHVyZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzaG93V2l6YXJkRXJyb3IodGV4dCkge1xuICAgICAgICAkKCcjbWgtd2l6YXJkIC5taC13aXphcmQtZXJyb3Itc2xvdCcpLmh0bWwoJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlXCIgcm9sZT1cImFsZXJ0XCI+JyArIElDT05fRVJST1JcbiAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ncm93XCI+JyArIGVzYyh0ZXh0KSArICc8L2Rpdj48L2Rpdj4nKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjbGVhcldpemFyZEVycm9yKCkge1xuICAgICAgICAkKCcjbWgtd2l6YXJkIC5taC13aXphcmQtZXJyb3Itc2xvdCcpLmVtcHR5KCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYmluZFdpemFyZENvbnRyb2xzKCkge1xuICAgICAgICAkKCcjbWgtcnVsZS1hZGQnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IG9wZW5SdWxlV2l6YXJkKG51bGwpOyB9KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1iYWNrJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgY2xvc2VSdWxlV2l6YXJkKCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLW5leHQnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoJCh0aGlzKS5wcm9wKCdkaXNhYmxlZCcpKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgY2xlYXJXaXphcmRFcnJvcigpO1xuICAgICAgICAgICAgd2l6YXJkTmV4dCgpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1wcmV2Jykub24oJ2NsaWNrJywgd2l6YXJkUHJldik7XG4gICAgICAgICQoJyNtaC13aXphcmQtb3Blbi1zZXR0aW5ncycpLm9uKCdjbGljaycsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIGNsb3NlUnVsZVdpemFyZCgpO1xuICAgICAgICAgICAgJCgnI21oLXRhYnMgLml0ZW1bZGF0YS10YWI9XCJzZXR0aW5nc1wiXScpLnRyaWdnZXIoJ2NsaWNrJyk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXNjZW5hcmlvcycpLm9uKCdjbGljaycsICcubWgtc2NlbmFyaW8nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgc291cmNlID0gc291cmNlQnlJZCgkKHRoaXMpLmRhdGEoJ3NvdXJjZS1pZCcpKTtcbiAgICAgICAgICAgIGlmICghc291cmNlIHx8ICQodGhpcykuaGFzQ2xhc3MoJ2lzLWRpc2FibGVkJykpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgICAgICBpZiAody5zb3VyY2VJZCAhPT0gc291cmNlLmlkKSB7XG4gICAgICAgICAgICAgICAgdy5zb3VyY2VJZCA9IHNvdXJjZS5pZDtcbiAgICAgICAgICAgICAgICB3LmV2ZW50VHlwZXMgPSAoc291cmNlLmV2ZW50X3R5cGVzIHx8IFtdKS5tYXAoZnVuY3Rpb24gKHR5cGUpIHsgcmV0dXJuIHR5cGUudHlwZTsgfSk7XG4gICAgICAgICAgICAgICAgaWYgKHcuZWRpdElkID09PSAwKSB7IHcudGl0bGUgPSBzb3VyY2UubmFtZTsgfVxuICAgICAgICAgICAgICAgIHcuZmlsdGVycyA9IGVtcHR5RmlsdGVycygpO1xuICAgICAgICAgICAgICAgIHcucmVjb3ZlciA9IHRydWU7XG4gICAgICAgICAgICAgICAgdy5taW5TZXZlcml0eSA9ICd3YXJuaW5nJztcbiAgICAgICAgICAgICAgICBpZiAod2l6YXJkU3VwcG9ydHNSZWFzb25zKHcuZXZlbnRUeXBlcykpIHtcbiAgICAgICAgICAgICAgICAgICAgdy5maWx0ZXJzLnJlYXNvbnMgPSBjbG91ZEFpUmVhc29ucyhmYWxzZSk7IC8vIG5ldyBydWxlOiBldmVyeXRoaW5nIGV4Y2VwdCBhIG1hbnVhbCBwYXVzZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlbmRlcldpemFyZFNjZW5hcmlvcygpO1xuICAgICAgICAgICAgdXBkYXRlV2l6YXJkTmV4dCgpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1zY2VuYXJpb3MnKS5vbignZGJsY2xpY2snLCAnLm1oLXNjZW5hcmlvOm5vdCguaXMtZGlzYWJsZWQpJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgd2l6YXJkTmV4dCgpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIHRhYnMgJiBhdXRvcmVmcmVzaCAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBpbml0VGFicygpIHtcbiAgICAgICAgJCgnI21oLXRhYnMgLml0ZW0nKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgdGFiID0gJCh0aGlzKS5kYXRhKCd0YWInKTtcbiAgICAgICAgICAgICQoJyNtaC10YWJzIC5pdGVtJykucmVtb3ZlQ2xhc3MoJ2FjdGl2ZScpO1xuICAgICAgICAgICAgJCh0aGlzKS5hZGRDbGFzcygnYWN0aXZlJyk7XG4gICAgICAgICAgICAkKCcjbWVzc2VuZ2VyLWh1Yi1yb290IC5taC10YWItcGFuZScpLnJlbW92ZUNsYXNzKCdhY3RpdmUnKTtcbiAgICAgICAgICAgICQoJyNtZXNzZW5nZXItaHViLXJvb3QgLm1oLXRhYi1wYW5lW2RhdGEtdGFiPVwiJyArIHRhYiArICdcIl0nKS5hZGRDbGFzcygnYWN0aXZlJyk7XG4gICAgICAgICAgICAkKCcjbWVzc2VuZ2VyLWh1Yi1yb290JykuYXR0cignZGF0YS1hY3RpdmUtdGFiJywgdGFiKTtcbiAgICAgICAgICAgIGlmICh0YWIgPT09ICdub3RpZmljYXRpb25zJykge1xuICAgICAgICAgICAgICAgIGxvYWRSdWxlcyh0cnVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh0YWIgPT09ICdzZXR0aW5ncycpIHtcbiAgICAgICAgICAgICAgICBsb2FkR2VuZXJhbFNldHRpbmdzKCk7XG4gICAgICAgICAgICAgICAgbG9hZEVtcGxveWVlcyhmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIGxvYWRCb3RzKCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGpvdXJuYWxWaXNpYmxlKCkge1xuICAgICAgICByZXR1cm4gJCgnI21lc3Nlbmdlci1odWItcm9vdCAubWgtdGFiLXBhbmVbZGF0YS10YWI9XCJqb3VybmFsXCJdJykuaGFzQ2xhc3MoJ2FjdGl2ZScpXG4gICAgICAgICAgICAmJiBkb2N1bWVudC52aXNpYmlsaXR5U3RhdGUgPT09ICd2aXNpYmxlJztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBub3RpZmljYXRpb25zVmlzaWJsZSgpIHtcbiAgICAgICAgcmV0dXJuICQoJyNtZXNzZW5nZXItaHViLXJvb3QgLm1oLXRhYi1wYW5lW2RhdGEtdGFiPVwibm90aWZpY2F0aW9uc1wiXScpLmhhc0NsYXNzKCdhY3RpdmUnKVxuICAgICAgICAgICAgJiYgZG9jdW1lbnQudmlzaWJpbGl0eVN0YXRlID09PSAndmlzaWJsZSc7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2NoZWR1bGVSZWZyZXNoKCkge1xuICAgICAgICBzZXRJbnRlcnZhbChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoam91cm5hbFZpc2libGUoKSkge1xuICAgICAgICAgICAgICAgIGxvYWQoeyByZWZyZXNoOiB0cnVlIH0pO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChub3RpZmljYXRpb25zVmlzaWJsZSgpICYmIHN0YXRlLnJ1bGVXaXphcmQgPT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICBsb2FkUnVsZXModHJ1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoZG9jdW1lbnQudmlzaWJpbGl0eVN0YXRlID09PSAndmlzaWJsZScpIHtcbiAgICAgICAgICAgICAgICBsb2FkSm91cm5hbEJhZGdlKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sIFJFRlJFU0hfU0VDICogMTAwMCk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBpbml0IC0tLS0tLS0tLS1cblxuICAgICQoZG9jdW1lbnQpLnJlYWR5KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcm9vdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdtZXNzZW5nZXItaHViLXJvb3QnKTtcbiAgICAgICAgaWYgKCFyb290KSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaW5pdFRhYnMoKTtcbiAgICAgICAgYnVpbGRQZXJpb2RNZW51KCk7XG4gICAgICAgIHJlbmRlclNrZWxldG9uKCk7XG5cbiAgICAgICAgLy8gb3VyIGNoZWNrYm94ZXMgYXJlIHBsYWluIGxhYmVscyBhcm91bmQgaGlkZGVuIGlucHV0czoga2VlcCB0aGUgdmlzdWFsIHN0YXRlIGluIHN5bmNcbiAgICAgICAgJChkb2N1bWVudCkub24oJ2NoYW5nZScsICcubW9kdWxlLW1lc3Nlbmdlci1odWIgLnVpLmNoZWNrYm94IGlucHV0LCAubWgtbW9kYWwgLnVpLmNoZWNrYm94IGlucHV0JywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyICRpbnB1dCA9ICQodGhpcyk7XG4gICAgICAgICAgICBpZiAoJGlucHV0LmF0dHIoJ3R5cGUnKSA9PT0gJ3JhZGlvJykge1xuICAgICAgICAgICAgICAgICQoJ2lucHV0W25hbWU9XCInICsgJGlucHV0LmF0dHIoJ25hbWUnKSArICdcIl0nKS5lYWNoKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgJCh0aGlzKS5jbG9zZXN0KCcudWkuY2hlY2tib3gnKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsIHRoaXMuY2hlY2tlZCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICRpbnB1dC5jbG9zZXN0KCcudWkuY2hlY2tib3gnKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsIHRoaXMuY2hlY2tlZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgICQoJyNtaC1qb3VybmFsLXJlc2V0LWZpbHRlcnMnKS5vbignY2xpY2snLCByZXNldEZpbHRlcnMpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1wcm9iZXMgaW5wdXQnKS5vbignY2hhbmdlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc3RhdGUuc2hvd1Byb2JlcyA9ICQodGhpcykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICAgICAgcmVuZGVySm91cm5hbCgpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtYmFubmVyJykub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImJhbm5lci1maXhcIl0nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgYm90ID0gYm90QnlJZCgkKHRoaXMpLmRhdGEoJ2JvdC1pZCcpKTtcbiAgICAgICAgICAgIGlmIChib3QpIHtcbiAgICAgICAgICAgICAgICBvcGVuQm90TW9kYWwoJ2VkaXQnLCBib3QpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBvcGVuQm90TW9kYWwoJ2FkZCcsIG51bGwsICd0ZWxlZ3JhbScpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtcmV0cnknKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IGxvYWQoKTsgfSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXByZXYnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoc3RhdGUub2Zmc2V0ID49IFBBR0VfTElNSVQpIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5vZmZzZXQgLT0gUEFHRV9MSU1JVDtcbiAgICAgICAgICAgICAgICBsb2FkKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1uZXh0Jykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHN0YXRlLm9mZnNldCArIHN0YXRlLmxhc3RJdGVtcy5sZW5ndGggPCBzdGF0ZS50b3RhbCkge1xuICAgICAgICAgICAgICAgIHN0YXRlLm9mZnNldCArPSBQQUdFX0xJTUlUO1xuICAgICAgICAgICAgICAgIGxvYWQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1yZXRlbnRpb24taW5wdXQnKS5vbignY2hhbmdlJywgc2F2ZVJldGVudGlvbik7XG4gICAgICAgICQoJyNtaC1wdWJsaWMtdXJsLWlucHV0Jykub24oJ2NoYW5nZScsIHNhdmVQdWJsaWNVcmwpO1xuICAgICAgICAkKCcjbWgtcHJveHktaW5wdXQnKS5vbignY2hhbmdlJywgc2F2ZVByb3h5KTtcbiAgICAgICAgJCgnI21oLW1heC1jYS1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBzYXZlTWF4Q2FCdW5kbGUpO1xuICAgICAgICAkKCcjbWgtY29uZmlnLXF1aWV0LWlucHV0Jykub24oJ2NoYW5nZScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHNhdmVOdW1iZXJTZXR0aW5nKCdjb25maWdfY2hhbmdlX3F1aWV0X3NlYycsICcjbWgtY29uZmlnLXF1aWV0LWlucHV0JywgJyNtaC1jb25maWctcXVpZXQtZmllbGQnLCAxMCwgMzYwMCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtZXh0ZXJuYWwtaXAtaW5wdXQnKS5vbignY2hhbmdlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc2F2ZU51bWJlclNldHRpbmcoJ2V4dGVybmFsX2lwX3BvbGxfbWluJywgJyNtaC1leHRlcm5hbC1pcC1pbnB1dCcsICcjbWgtZXh0ZXJuYWwtaXAtZmllbGQnLCA1LCAxNDQwKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1saWNlbnNlLWhvdXJzLWlucHV0Jykub24oJ2NoYW5nZScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHNhdmVOdW1iZXJTZXR0aW5nKCdsaWNlbnNlX3BvbGxfaG91cnMnLCAnI21oLWxpY2Vuc2UtaG91cnMtaW5wdXQnLCAnI21oLWxpY2Vuc2UtaG91cnMtZmllbGQnLCAxLCAxNjgpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWxpY2Vuc2UtZGF5cy1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBzYXZlTGljZW5zZVdhcm5EYXlzKTtcbiAgICAgICAgJCgnI21oLW1hc2stZGVmYXVsdCBpbnB1dCcpLm9uKCdjaGFuZ2UnLCBzYXZlTWFza0RlZmF1bHQpO1xuICAgICAgICAkKCcjbWgtcXVldWUtbWluLXdhaXQtaW5wdXQnKS5vbignY2hhbmdlJywgc2F2ZVF1ZXVlTWluV2FpdCk7XG4gICAgICAgICQoJyNtaC1xdWV1ZS1sb25nLXdhaXQtaW5wdXQnKS5vbignY2hhbmdlJywgc2F2ZVF1ZXVlTG9uZ1dhaXQpO1xuICAgICAgICAkKCcjbWgtdG9sbC1wcmVmaXhlcy1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzYXZlU2VjdXJpdHlQcmVmaXhlcygnI21oLXRvbGwtcHJlZml4ZXMtaW5wdXQnLCAnI21oLXRvbGwtcHJlZml4ZXMtZmllbGQnLCAndG9sbF9mcmF1ZF9wcmVmaXhlcycpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXRvbGwtaG9tZS1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzYXZlU2VjdXJpdHlQcmVmaXhlcygnI21oLXRvbGwtaG9tZS1pbnB1dCcsICcjbWgtdG9sbC1ob21lLWZpZWxkJywgJ3RvbGxfZnJhdWRfaG9tZV9wcmVmaXhlcycpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXRvbGwtYnVyc3QtaW5wdXQnKS5vbignY2hhbmdlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc2F2ZVNlY3VyaXR5SW50KCcjbWgtdG9sbC1idXJzdC1pbnB1dCcsICcjbWgtdG9sbC1idXJzdC1maWVsZCcsICd0b2xsX2ZyYXVkX2J1cnN0X2NhbGxzJywgMiwgMTAwMCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtdG9sbC13aW5kb3ctaW5wdXQnKS5vbignY2hhbmdlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc2F2ZVNlY3VyaXR5SW50KCcjbWgtdG9sbC13aW5kb3ctaW5wdXQnLCAnI21oLXRvbGwtd2luZG93LWZpZWxkJywgJ3RvbGxfZnJhdWRfYnVyc3Rfd2luZG93X21pbicsIDEsIDE0NDApO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXRvbGwtZnJvbS1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzYXZlU2VjdXJpdHlUaW1lKCcjbWgtdG9sbC1mcm9tLWlucHV0JywgJyNtaC10b2xsLWZyb20tZmllbGQnLCAndG9sbF9mcmF1ZF9vZmZob3Vyc19mcm9tJyk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtdG9sbC10by1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzYXZlU2VjdXJpdHlUaW1lKCcjbWgtdG9sbC10by1pbnB1dCcsICcjbWgtdG9sbC10by1maWVsZCcsICd0b2xsX2ZyYXVkX29mZmhvdXJzX3RvJyk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtdG9sbC1vZmZob3VycyBpbnB1dCcpLm9uKCdjaGFuZ2UnLCBzYXZlVG9sbE9mZkhvdXJzKTtcbiAgICAgICAgJCgnI21oLWF1dGhmYWlsLXRocmVzaG9sZC1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzYXZlU2VjdXJpdHlJbnQoJyNtaC1hdXRoZmFpbC10aHJlc2hvbGQtaW5wdXQnLCAnI21oLWF1dGhmYWlsLXRocmVzaG9sZC1maWVsZCcsICdzaXBfYXV0aGZhaWxfdGhyZXNob2xkJywgMSwgMTAwMCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtYXV0aGZhaWwtd2luZG93LWlucHV0Jykub24oJ2NoYW5nZScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHNhdmVTZWN1cml0eUludCgnI21oLWF1dGhmYWlsLXdpbmRvdy1pbnB1dCcsICcjbWgtYXV0aGZhaWwtd2luZG93LWZpZWxkJywgJ3NpcF9hdXRoZmFpbF93aW5kb3dfbWluJywgMSwgMTQ0MCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtYXV0aGZhaWwtcXVpZXQtaW5wdXQnKS5vbignY2hhbmdlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc2F2ZVNlY3VyaXR5SW50KCcjbWgtYXV0aGZhaWwtcXVpZXQtaW5wdXQnLCAnI21oLWF1dGhmYWlsLXF1aWV0LWZpZWxkJywgJ3NpcF9hdXRoZmFpbF9xdWlldF9taW4nLCA1LCAxNDQwKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1hdXRoZmFpbC1wZXJwb2xsLWlucHV0Jykub24oJ2NoYW5nZScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHNhdmVTZWN1cml0eUludCgnI21oLWF1dGhmYWlsLXBlcnBvbGwtaW5wdXQnLCAnI21oLWF1dGhmYWlsLXBlcnBvbGwtZmllbGQnLCAnc2lwX2F1dGhmYWlsX2V4dGVuc2lvbnNfcGVyX3BvbGwnLCA1LCAyMDApO1xuICAgICAgICB9KTtcblxuICAgICAgICBiaW5kQm90c0NvbnRhaW5lcigpO1xuICAgICAgICBiaW5kQ2hhdEZvdW5kKCk7XG4gICAgICAgIGJpbmRSdWxlc0NvbnRhaW5lcigpO1xuICAgICAgICBiaW5kV2l6YXJkQ29udHJvbHMoKTtcbiAgICAgICAgJCgnI21oLWJvdC1hZGQnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IG9wZW5Cb3RNb2RhbCgnYWRkJywgbnVsbCwgJ3RlbGVncmFtJyk7IH0pO1xuICAgICAgICAkKCcjbWgtYm90LWNoZWNrLCAjbWgtYm90LWNoZWNrLXN0b3JlZCwgI21oLWJvdC1jaGVjay1uZXcnKS5vbignY2xpY2snLCBjaGVja0JvdEZvcm0pO1xuICAgICAgICAkKCcjbWgtYm90LXRva2VuLXJlcGxhY2UnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRva2VuLW5ldy1yb3cnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4tbmV3JykudHJpZ2dlcignZm9jdXMnKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4tY2FuY2VsJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1uZXcnKS52YWwoJycpO1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1uZXctcm93JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtYm90LXNhdmUnKS5vbignY2xpY2snLCBzYXZlQm90Rm9ybSk7XG4gICAgICAgICQoJyNtaC1ib3QtbW9kYWwnKS5vbignY2xpY2snLCAnLm1oLWNoYW5uZWwtY2FyZCcsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIGlmICghc3RhdGUuYm90TW9kYWwgfHwgJCh0aGlzKS5oYXNDbGFzcygnaXMtZGlzYWJsZWQnKSkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHN0YXRlLmJvdE1vZGFsLmNoYW5uZWwgPSBTdHJpbmcoJCh0aGlzKS5kYXRhKCdjaGFubmVsJykpO1xuICAgICAgICAgICAgJCgnI21oLWJvdC1jaGVjay1tZXNzYWdlJykuZW1wdHkoKTtcbiAgICAgICAgICAgIHN5bmNCb3RDaGFubmVsKCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtYm90LWRlbGV0ZScpLm9uKCdjbGljaycsIGNvbmZpcm1EZWxldGVCb3QpO1xuICAgICAgICAkKCcjbWgtYm90LW1vZGFsIFtkYXRhLWFjdGlvbj1cImNhbmNlbFwiXScpLm9uKCdjbGljaycsIGNhbmNlbEJvdE1vZGFsKTtcbiAgICAgICAgJCgnI21oLWNoYXQtc3RvcCcpLm9uKCdjbGljaycsIHN0b3BEaXNjb3ZlcnlBbmRDbG9zZSk7XG4gICAgICAgICQoJyNtaC1jaGF0LWFnYWluJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHN0YXRlLmNoYXRNb2RhbCkge1xuICAgICAgICAgICAgICAgIHN0YXJ0RGlzY292ZXJ5KHN0YXRlLmNoYXRNb2RhbC5ib3RJZCwgdHJ1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtY2hhdC1zYXZlJykub24oJ2NsaWNrJywgc2F2ZVNlbGVjdGVkQ2hhdHMpO1xuICAgICAgICAkKCcjbWgtY2hhdC1tb2RhbCBbZGF0YS1hY3Rpb249XCJjYW5jZWxcIl0nKS5vbignY2xpY2snLCBzdG9wRGlzY292ZXJ5QW5kQ2xvc2UpO1xuICAgICAgICAkKCcjbWgtdGVzdC1tb2RhbCBbZGF0YS1hY3Rpb249XCJjYW5jZWxcIl0nKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdG9wVGVzdFBvbGwoKTtcbiAgICAgICAgICAgICQoJyNtaC10ZXN0LW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsIFtkYXRhLWFjdGlvbj1cImNhbmNlbFwiXScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbG9hZENhdGFsb2coZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgYnVpbGRUeXBlTWVudSgpO1xuICAgICAgICAgICAgbG9hZEVtcGxveWVlcyhmdW5jdGlvbiAoKSB7fSk7XG4gICAgICAgICAgICBsb2FkUHJvdmlkZXJzKGZ1bmN0aW9uICgpIHt9KTtcbiAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICAgICAgbG9hZFJ1bGVzKCk7XG4gICAgICAgICAgICBsb2FkKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBzY2hlZHVsZVJlZnJlc2goKTtcbiAgICB9KTtcbn0oKSk7XG4iXSwibWFwcGluZ3MiOiI7OztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0MsYUFBWTtFQUNULFlBQVk7O0VBRVosSUFBSSxRQUFRLEdBQUcsc0NBQXNDO0VBQ3JELElBQUksVUFBVSxHQUFHLEVBQUU7RUFDbkIsSUFBSSxXQUFXLEdBQUcsRUFBRTtFQUNwQixJQUFJLFdBQVcsR0FBRyxDQUFDLE9BQU8sRUFBRSxlQUFlLEVBQUUsV0FBVyxFQUFFLGFBQWEsRUFBRSxLQUFLLEVBQUUsVUFBVSxDQUFDO0VBRTNGLElBQUksVUFBVSxHQUFHLCtIQUErSDtFQUNoSixJQUFJLFlBQVksR0FBRyxpR0FBaUc7RUFDcEgsSUFBSSxTQUFTLEdBQUcsMkZBQTJGO0VBRTNHLElBQUksSUFBSSxHQUFHLElBQUk7RUFDZixJQUFJLEtBQUssR0FBRztJQUNSLE9BQU8sRUFBRSxFQUFFO0lBQ1gsTUFBTSxFQUFFLE9BQU87SUFDZixTQUFTLEVBQUUsRUFBRTtJQUNiLE1BQU0sRUFBRSxDQUFDO0lBQ1QsS0FBSyxFQUFFLENBQUM7SUFDUixTQUFTLEVBQUUsS0FBSztJQUNoQixTQUFTLEVBQUUsRUFBRTtJQUNiLFNBQVMsRUFBRSxDQUFDLENBQUM7SUFDYixVQUFVLEVBQUUsSUFBSTtJQUNoQixPQUFPLEVBQUUsQ0FB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
