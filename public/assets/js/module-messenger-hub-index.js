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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sInNvdXJjZXMiOlsibW9kdWxlLW1lc3Nlbmdlci1odWItaW5kZXguanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyogTW9kdWxlTWVzc2VuZ2VySHViIGFkbWluIHBhZ2U6IG5vdGlmaWNhdGlvbnMsIHdpemFyZCwgam91cm5hbCBhbmQgc2V0dGluZ3MgKGRlc2lnbiB2MywgZG9jcy9kZXNpZ24vTW9kdWxlTWVzc2VuZ2VySHViLXYzLmh0bWwpLlxuICogRGF0YSBjb21lcyBvbmx5IGZyb20gdGhlIG1vZHVsZSBSRVNUIHJlc291cmNlcyAoc2V0dGluZ3MsIGV2ZW50cywgYm90cywgcnVsZXMpIGFuZCBDb3JlIHYzIGxpc3RzLiBObyBleHRlcm5hbCBDRE5zLlxuICogV3JpdHRlbiBpbiBwbGFpbiBFUzUgKHRhcmdldHMgQ2hyb21lIDUwIC8gRmlyZWZveCA0NSAvIElFMTEgYWZ0ZXIgdGhlIEJhYmVsIHBhc3MpLlxuICovXG4oZnVuY3Rpb24gKCkge1xuICAgICd1c2Ugc3RyaWN0JztcblxuICAgIHZhciBBUElfQkFTRSA9ICcvcGJ4Y29yZS9hcGkvdjMvbW9kdWxlLW1lc3Nlbmdlci1odWInO1xuICAgIHZhciBQQUdFX0xJTUlUID0gNTA7XG4gICAgdmFyIFJFRlJFU0hfU0VDID0gMzA7XG4gICAgdmFyIEdST1VQX09SREVSID0gWydjYWxscycsICdhaV9zdXBlcnZpc29yJywgJ3NwZWVjaF9haScsICd2b2ljZV9hZ2VudCcsICdwYngnLCAnc2VjdXJpdHknXTtcblxuICAgIHZhciBJQ09OX0VSUk9SID0gJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjxjaXJjbGUgY3g9XCI4XCIgY3k9XCI4XCIgcj1cIjYuMjVcIi8+PHBhdGggZD1cIk02IDZsNCA0TTEwIDZsLTQgNFwiLz48L3N2Zz4nO1xuICAgIHZhciBJQ09OX0NIRVZST04gPSAnPHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+PHBhdGggZD1cIk02IDMuNUwxMC41IDggNiAxMi41XCIvPjwvc3ZnPic7XG4gICAgdmFyIElDT05fUExVUyA9ICc8c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBhcmlhLWhpZGRlbj1cInRydWVcIj48cGF0aCBkPVwiTTggM3YxME0zIDhoMTBcIi8+PC9zdmc+JztcblxuICAgIHZhciByb290ID0gbnVsbDtcbiAgICB2YXIgc3RhdGUgPSB7XG4gICAgICAgIHNvdXJjZXM6IFtdLFxuICAgICAgICBwZXJpb2Q6ICd0b2RheScsXG4gICAgICAgIGV2ZW50VHlwZTogJycsXG4gICAgICAgIG9mZnNldDogMCxcbiAgICAgICAgdG90YWw6IDAsXG4gICAgICAgIGhhc0xvYWRlZDogZmFsc2UsXG4gICAgICAgIGxhc3RJdGVtczogW10sXG4gICAgICAgIGNhbGxiYWNrczoge30sXG4gICAgICAgIGV4cGFuZGVkSWQ6IG51bGwsXG4gICAgICAgIGxvYWRTZXE6IDAsXG4gICAgICAgIHJldGVudGlvbjogMzAsXG4gICAgICAgIHNldHRpbmdzOiBudWxsLFxuICAgICAgICBib3RzOiBbXSxcbiAgICAgICAgYm90c0xvYWRlZDogZmFsc2UsXG4gICAgICAgIGJvdHNFcnJvcjogbnVsbCxcbiAgICAgICAgZXhwYW5kZWRCb3RzOiB7fSxcbiAgICAgICAgZW1wbG95ZWVzOiBbXSxcbiAgICAgICAgZW1wbG95ZWVzTG9hZGVkOiBmYWxzZSxcbiAgICAgICAgZW1wbG95ZWVzRmFpbGVkOiBmYWxzZSxcbiAgICAgICAgc2hvd1Byb2JlczogZmFsc2UsXG4gICAgICAgIGJvdE1vZGFsOiBudWxsLFxuICAgICAgICBjaGF0TW9kYWw6IG51bGwsXG4gICAgICAgIHRlc3RNb2RhbDogbnVsbCxcbiAgICAgICAgcnVsZXM6IFtdLFxuICAgICAgICBydWxlc0xvYWRlZDogZmFsc2UsXG4gICAgICAgIHJ1bGVzRXJyb3I6IG51bGwsXG4gICAgICAgIHByb3ZpZGVyczogW10sXG4gICAgICAgIHByb3ZpZGVyc0xvYWRlZDogZmFsc2UsXG4gICAgICAgIHJ1bGVXaXphcmQ6IG51bGxcbiAgICB9O1xuXG4gICAgLy8gLS0tLS0tLS0tLSBpMThuIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIHQoa2V5KSB7XG4gICAgICAgIGlmICh0eXBlb2YgZ2xvYmFsVHJhbnNsYXRlICE9PSAndW5kZWZpbmVkJyAmJiBnbG9iYWxUcmFuc2xhdGVba2V5XSkge1xuICAgICAgICAgICAgcmV0dXJuIGdsb2JhbFRyYW5zbGF0ZVtrZXldO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBrZXk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdGYoa2V5LCBwYXJhbXMpIHtcbiAgICAgICAgdmFyIHRleHQgPSB0KGtleSk7XG4gICAgICAgIE9iamVjdC5rZXlzKHBhcmFtcyB8fCB7fSkuZm9yRWFjaChmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgdGV4dCA9IHRleHQuc3BsaXQoJ3snICsgbmFtZSArICd9Jykuam9pbihTdHJpbmcocGFyYW1zW25hbWVdKSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdGV4dDtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIHNtYWxsIGhlbHBlcnMgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gcGFkKHZhbHVlKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZSA8IDEwID8gJzAnICsgdmFsdWUgOiBTdHJpbmcodmFsdWUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZtdFRpbWUodHMpIHtcbiAgICAgICAgdmFyIGQgPSBuZXcgRGF0ZSh0cyAqIDEwMDApO1xuICAgICAgICByZXR1cm4gcGFkKGQuZ2V0SG91cnMoKSkgKyAnOicgKyBwYWQoZC5nZXRNaW51dGVzKCkpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZtdERhdGUodHMpIHtcbiAgICAgICAgdmFyIGQgPSBuZXcgRGF0ZSh0cyAqIDEwMDApO1xuICAgICAgICByZXR1cm4gcGFkKGQuZ2V0RGF0ZSgpKSArICcuJyArIHBhZChkLmdldE1vbnRoKCkgKyAxKSArICcuJyArIGQuZ2V0RnVsbFllYXIoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmbXREYXRlVGltZSh0cykge1xuICAgICAgICByZXR1cm4gZm10RGF0ZSh0cykgKyAnICcgKyBmbXRUaW1lKHRzKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBpc1RvZGF5KHRzKSB7XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgdmFyIG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgICAgIHJldHVybiBkLnRvRGF0ZVN0cmluZygpID09PSBub3cudG9EYXRlU3RyaW5nKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNZZXN0ZXJkYXkodHMpIHtcbiAgICAgICAgdmFyIGQgPSBuZXcgRGF0ZSh0cyAqIDEwMDApO1xuICAgICAgICB2YXIgeWVzdGVyZGF5ID0gbmV3IERhdGUoRGF0ZS5ub3coKSAtIDg2NDAwMDAwKTtcbiAgICAgICAgcmV0dXJuIGQudG9EYXRlU3RyaW5nKCkgPT09IHllc3RlcmRheS50b0RhdGVTdHJpbmcoKTtcbiAgICB9XG5cbiAgICAvLyBPbmUgbGluZSBpbiBhIDQ4IHB4IHJvdzogwqsxODozNMK7LCDCq9Cy0YfQtdGA0LAgMTg6MzTCuywgwqsxMi4xMCAxODozNMK7LlxuICAgIGZ1bmN0aW9uIGZtdENlbGxUaW1lKHRzKSB7XG4gICAgICAgIGlmIChpc1RvZGF5KHRzKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZtdFRpbWUodHMpO1xuICAgICAgICB9XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgdmFyIGRheSA9IGlzWWVzdGVyZGF5KHRzKSA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1RpbWVZZXN0ZXJkYXknKSA6IHBhZChkLmdldERhdGUoKSkgKyAnLicgKyBwYWQoZC5nZXRNb250aCgpICsgMSk7XG4gICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1tdXRlZFwiPicgKyBlc2MoZGF5KSArICc8L3NwYW4+ICcgKyBmbXRUaW1lKHRzKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBlc2ModmFsdWUpIHtcbiAgICAgICAgcmV0dXJuICQoJzxkaXYvPicpLnRleHQoU3RyaW5nKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgPyAnJyA6IHZhbHVlKSkuaHRtbCgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHN0YXJ0T2ZUb2RheSgpIHtcbiAgICAgICAgdmFyIGQgPSBuZXcgRGF0ZSgpO1xuICAgICAgICBkLnNldEhvdXJzKDAsIDAsIDAsIDApO1xuICAgICAgICByZXR1cm4gTWF0aC5mbG9vcihkLmdldFRpbWUoKSAvIDEwMDApO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHBlcmlvZEJvdW5kcygpIHtcbiAgICAgICAgdmFyIG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xuICAgICAgICB2YXIgdG9kYXlTdGFydCA9IHN0YXJ0T2ZUb2RheSgpO1xuICAgICAgICBzd2l0Y2ggKHN0YXRlLnBlcmlvZCkge1xuICAgICAgICAgICAgY2FzZSAndG9kYXknOiByZXR1cm4geyBmcm9tOiB0b2RheVN0YXJ0LCB0bzogbm93IH07XG4gICAgICAgICAgICBjYXNlICd5ZXN0ZXJkYXknOiByZXR1cm4geyBmcm9tOiB0b2RheVN0YXJ0IC0gODY0MDAsIHRvOiB0b2RheVN0YXJ0IC0gMSB9O1xuICAgICAgICAgICAgY2FzZSAnN2RheXMnOiByZXR1cm4geyBmcm9tOiB0b2RheVN0YXJ0IC0gNiAqIDg2NDAwLCB0bzogbm93IH07XG4gICAgICAgICAgICBjYXNlICczMGRheXMnOiByZXR1cm4geyBmcm9tOiB0b2RheVN0YXJ0IC0gMjkgKiA4NjQwMCwgdG86IG5vdyB9O1xuICAgICAgICAgICAgZGVmYXVsdDogcmV0dXJuIHsgZnJvbTogMCwgdG86IDAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gQVBJIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGFwaUdldChwYXRoLCBwYXJhbXMsIG9uU3VjY2Vzcywgb25GYWlsdXJlKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IENvbmZpZy5wYnhVcmwgKyBBUElfQkFTRSArIHBhdGgsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YTogcGFyYW1zIHx8IHt9LFxuICAgICAgICAgICAgY2FjaGU6IGZhbHNlXG4gICAgICAgIH0pLmRvbmUoZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2UucmVzdWx0ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgb25TdWNjZXNzKHJlc3BvbnNlLmRhdGEpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBvbkZhaWx1cmUobm9ybWFsaXplRmFpbHVyZShyZXNwb25zZSwgMjAwKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLmZhaWwoZnVuY3Rpb24gKHhocikge1xuICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUobnVsbCwgeGhyLnN0YXR1cykpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBhcGlQYXRjaChwYXRoLCBwYXlsb2FkLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBDb25maWcucGJ4VXJsICsgQVBJX0JBU0UgKyBwYXRoLFxuICAgICAgICAgICAgbWV0aG9kOiAnUEFUQ0gnLFxuICAgICAgICAgICAgZGF0YTogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXG4gICAgICAgICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJ1xuICAgICAgICB9KS5kb25lKGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlICYmIHJlc3BvbnNlLnJlc3VsdCA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgIG9uU3VjY2VzcyhyZXNwb25zZS5kYXRhKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUocmVzcG9uc2UsIDIwMCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KS5mYWlsKGZ1bmN0aW9uICh4aHIpIHtcbiAgICAgICAgICAgIG9uRmFpbHVyZShub3JtYWxpemVGYWlsdXJlKG51bGwsIHhoci5zdGF0dXMpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbm9ybWFsaXplRmFpbHVyZShyZXNwb25zZSwgc3RhdHVzKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXM6IHN0YXR1cyxcbiAgICAgICAgICAgIGVycm9yOiAocmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YSAmJiByZXNwb25zZS5kYXRhLmVycm9yKSB8fCAnaHR0cF8nICsgc3RhdHVzLFxuICAgICAgICAgICAgbWVzc2FnZXM6IChyZXNwb25zZSAmJiByZXNwb25zZS5tZXNzYWdlcyAmJiByZXNwb25zZS5tZXNzYWdlcy5lcnJvcikgfHwgW11cbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIHNvdXJjZSBjYXRhbG9nIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGxvYWRDYXRhbG9nKGRvbmUpIHtcbiAgICAgICAgYXBpR2V0KCcvc2V0dGluZ3M6Z2V0U291cmNlcycsIHt9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgc3RhdGUuc291cmNlcyA9IGRhdGEuaXRlbXMgfHwgW107XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLnNvdXJjZXMgPSBbXTtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc291cmNlQnlJZChpZCkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLnNvdXJjZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5zb3VyY2VzW2ldLmlkID09PSBpZCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzdGF0ZS5zb3VyY2VzW2ldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGV2ZW50VHlwZU5hbWVzKCkge1xuICAgICAgICB2YXIgbmFtZXMgPSB7fTtcbiAgICAgICAgc3RhdGUuc291cmNlcy5mb3JFYWNoKGZ1bmN0aW9uIChzb3VyY2UpIHtcbiAgICAgICAgICAgIChzb3VyY2UuZXZlbnRfdHlwZXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24gKHR5cGUpIHtcbiAgICAgICAgICAgICAgICBuYW1lc1t0eXBlLnR5cGVdID0gdHlwZS5uYW1lO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gbmFtZXM7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiBmaWx0ZXJzIChkZXNpZ24gdjM6IHBlcmlvZCBhbmQgZXZlbnQgb25seSkgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gYnVpbGRUeXBlTWVudSgpIHtcbiAgICAgICAgdmFyIG5hbWVzID0gZXZlbnRUeXBlTmFtZXMoKTtcbiAgICAgICAgdmFyIGl0ZW1zID0gW107XG4gICAgICAgIEdST1VQX09SREVSLmZvckVhY2goZnVuY3Rpb24gKGdyb3VwKSB7XG4gICAgICAgICAgICB2YXIgaW5Hcm91cCA9IFtdO1xuICAgICAgICAgICAgc3RhdGUuc291cmNlcy5mb3JFYWNoKGZ1bmN0aW9uIChzb3VyY2UpIHtcbiAgICAgICAgICAgICAgICBpZiAoc291cmNlLmdyb3VwICE9PSBncm91cCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIChzb3VyY2UuZXZlbnRfdHlwZXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24gKHR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgaW5Hcm91cC5wdXNoKHsgdmFsdWU6IHR5cGUudHlwZSwgdGV4dDogbmFtZXNbdHlwZS50eXBlXSB8fCB0eXBlLnR5cGUgfSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGlmIChpbkdyb3VwLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBpdGVtcy5wdXNoKHsgZ3JvdXA6IHNvdXJjZUdyb3VwTmFtZShncm91cCkgfSk7XG4gICAgICAgICAgICAgICAgaW5Hcm91cC5mb3JFYWNoKGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgICAgICAgICAgICAgIGl0ZW1zLnB1c2goaXRlbSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1maWx0ZXJzIC5taC1maWx0ZXItdHlwZScpLmRyb3Bkb3duKHtcbiAgICAgICAgICAgIHZhbHVlczogbWVudVRvVmFsdWVzKGl0ZW1zKSxcbiAgICAgICAgICAgIHBsYWNlaG9sZGVyOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9GaWx0ZXJBbGxUeXBlcycpLFxuICAgICAgICAgICAgb25DaGFuZ2U6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgIHN0YXRlLmV2ZW50VHlwZSA9IFN0cmluZyh2YWx1ZSB8fCAnJyk7XG4gICAgICAgICAgICAgICAgcmVsb2FkKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1lbnVUb1ZhbHVlcyhpdGVtcykge1xuICAgICAgICByZXR1cm4gaXRlbXMubWFwKGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgICAgICBpZiAoaXRlbS5ncm91cCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB7IHR5cGU6ICdoZWFkZXInLCBuYW1lOiBpdGVtLmdyb3VwIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4geyBuYW1lOiBpdGVtLnRleHQsIHZhbHVlOiBpdGVtLnZhbHVlIH07XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNvdXJjZUdyb3VwTmFtZShncm91cCkge1xuICAgICAgICB2YXIga2V5ID0ge1xuICAgICAgICAgICAgY2FsbHM6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Hcm91cENhbGxzJyxcbiAgICAgICAgICAgIGFpX3N1cGVydmlzb3I6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Hcm91cEFpU3VwZXJ2aXNvcicsXG4gICAgICAgICAgICBzcGVlY2hfYWk6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Hcm91cFNwZWVjaEFpJyxcbiAgICAgICAgICAgIHZvaWNlX2FnZW50OiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfR3JvdXBWb2ljZUFnZW50JyxcbiAgICAgICAgICAgIHBieDogJ21vZHVsZV9tZXNzZW5nZXJfaHViX0dyb3VwUGJ4JyxcbiAgICAgICAgICAgIHNlY3VyaXR5OiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfR3JvdXBTZWN1cml0eSdcbiAgICAgICAgfVtncm91cF0gfHwgZ3JvdXA7XG4gICAgICAgIHJldHVybiB0KGtleSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBtb2R1bGUgc3RhdHVzIGV2ZW50cyAoc3RhZ2UgM2IpOiBodW1hbiB3b3JkcyBmb3IgKGNvZGUsIHJlZiksIHJhdyBjb2RlcyBvbmx5IGluIGEgdG9vbHRpcCAtLS0tLS0tLS0tXG5cbiAgICB2YXIgU1RBVFVTX1JFQ09WRVJZX0tFWVMgPSB7XG4gICAgICAgICdsb2NhbF9zdHQud29ya2VyX29ubGluZSc6ICdNZXNzYWdlU3RhdHVzV29ya2VyT25saW5lJyxcbiAgICAgICAgJ2xvY2FsX3N0dC5iYWNrbG9nX3Jlc29sdmVkJzogJ01lc3NhZ2VTdGF0dXNCYWNrbG9nUmVzb2x2ZWQnLFxuICAgICAgICAnY2xvdWRfc3R0LmluY2lkZW50X3Jlc29sdmVkJzogJ01lc3NhZ2VTdGF0dXNJbmNpZGVudFJlc29sdmVkJyxcbiAgICAgICAgJ2Nsb3VkX3N0dC5yZXN1bWVkJzogJ01lc3NhZ2VTdGF0dXNSZXN1bWVkJyxcbiAgICAgICAgJ2Nsb3VkX2FpLnJlc3VtZWQnOiAnTWVzc2FnZVN0YXR1c0Nsb3VkQWlSZXN1bWVkJyxcbiAgICAgICAgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29ubGluZSc6ICdNZXNzYWdlU3RhdHVzV29ya2VyT25saW5lJ1xuICAgIH07XG4gICAgdmFyIFNUQVRVU19DT0RFX0tFWVMgPSB7XG4gICAgICAgIHdvcmtlcl9vZmZsaW5lOiAnTWVzc2FnZVN0YXR1c1dvcmtlck9mZmxpbmUnLFxuICAgICAgICBiYWNrbG9nX25vX3dvcmtlcnM6ICdNZXNzYWdlU3RhdHVzQmFja2xvZycsXG4gICAgICAgIGluY2lkZW50X29wZW46ICdNZXNzYWdlU3RhdHVzSW5jaWRlbnQnXG4gICAgfTtcbiAgICB2YXIgU1RBVFVTX1BBVVNFX0tFWVMgPSB7XG4gICAgICAgIHVzZXI6ICdNZXNzYWdlU3RhdHVzUGF1c2VkVXNlcicsXG4gICAgICAgIG1haW50ZW5hbmNlOiAnTWVzc2FnZVN0YXR1c1BhdXNlZE1haW50ZW5hbmNlJyxcbiAgICAgICAgbWFudWFsOiAnTWVzc2FnZVN0YXR1c0Nsb3VkQWlNYW51YWwnLFxuICAgICAgICBsaWNlbnNlX21pc3Npbmc6ICdNZXNzYWdlU3RhdHVzQ2xvdWRBaUxpY2Vuc2UnLFxuICAgICAgICBhdXRoX2ludmFsaWQ6ICdNZXNzYWdlU3RhdHVzQ2xvdWRBaUF1dGgnLFxuICAgICAgICBtb2RlbF91bmF2YWlsYWJsZTogJ01lc3NhZ2VTdGF0dXNDbG91ZEFpTW9kZWwnLFxuICAgICAgICBkYWlseV9saW1pdF9yZWFjaGVkOiAnTWVzc2FnZVN0YXR1c0Nsb3VkQWlEYWlseUxpbWl0JyxcbiAgICAgICAgc291cmNlX3VuYXZhaWxhYmxlOiAnTWVzc2FnZVN0YXR1c0Nsb3VkQWlTb3VyY2VVbmF2YWlsYWJsZScsXG4gICAgICAgIGluc3VmZmljaWVudF9mdW5kczogJ01lc3NhZ2VTdGF0dXNDbG91ZEFpSW5zdWZmaWNpZW50RnVuZHMnLFxuICAgICAgICBsb3dfYmFsYW5jZTogJ01lc3NhZ2VTdGF0dXNDbG91ZEFpTG93QmFsYW5jZSdcbiAgICB9O1xuXG4gICAgLy8gUHJvYmxlbSBldmVudCB0eXBlIC0+IGl0cyByZWNvdmVyeSB0eXBlLiBBIHN0YXR1cyBzY2VuYXJpbyBpcyBhbHdheXMgb25lIHBhaXI7IMKr0KHQvtC+0LHRidCw0YLRjCDQviDQstC+0YHRgdGC0LDQvdC+0LLQu9C10L3QuNC4wrtcbiAgICAvLyBpcyB0aGUgcmVjb3ZlcnkgdHlwZSBiZWluZyBpbiB0aGUgcnVsZSdzIGV2ZW50X3R5cGVzIChubyBzZXBhcmF0ZSBzdG9yYWdlKS5cbiAgICB2YXIgU1RBVFVTX1BBSVJTID0ge1xuICAgICAgICAnbG9jYWxfc3R0Lndvcmtlcl9vZmZsaW5lJzogJ2xvY2FsX3N0dC53b3JrZXJfb25saW5lJyxcbiAgICAgICAgJ2xvY2FsX3N0dC5iYWNrbG9nX25vX3dvcmtlcnMnOiAnbG9jYWxfc3R0LmJhY2tsb2dfcmVzb2x2ZWQnLFxuICAgICAgICAnY2xvdWRfc3R0LmluY2lkZW50JzogJ2Nsb3VkX3N0dC5pbmNpZGVudF9yZXNvbHZlZCcsXG4gICAgICAgICdjbG91ZF9zdHQucGF1c2VkJzogJ2Nsb3VkX3N0dC5yZXN1bWVkJyxcbiAgICAgICAgJ2Nsb3VkX2FpLnBhdXNlZCc6ICdjbG91ZF9haS5yZXN1bWVkJyxcbiAgICAgICAgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29mZmxpbmUnOiAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb25saW5lJ1xuICAgIH07XG4gICAgLy8gQ2xvdWQgQUkgcGF1c2UgcmVhc29ucyBieSBncm91cCAocnVsZSBmaWx0ZXIgYHJlYXNvbnNgKTsgbm90X2NvbmZpZ3VyZWQgbmV2ZXIgcHJvZHVjZXMgZXZlbnRzLlxuICAgIHZhciBDTE9VRF9BSV9SRUFTT05fR1JPVVBTID0gW1xuICAgICAgICBbJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFJlYXNvbkdyb3VwTW9uZXknLCBbJ2luc3VmZmljaWVudF9mdW5kcycsICdsb3dfYmFsYW5jZSddXSxcbiAgICAgICAgWydtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRSZWFzb25Hcm91cExpY2Vuc2UnLCBbJ2xpY2Vuc2VfbWlzc2luZycsICdhdXRoX2ludmFsaWQnXV0sXG4gICAgICAgIFsnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUmVhc29uR3JvdXBMaW1pdHMnLCBbJ2RhaWx5X2xpbWl0X3JlYWNoZWQnLCAnbW9kZWxfdW5hdmFpbGFibGUnXV0sXG4gICAgICAgIFsnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUmVhc29uR3JvdXBTb3VyY2UnLCBbJ3NvdXJjZV91bmF2YWlsYWJsZSddXSxcbiAgICAgICAgWydtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRSZWFzb25Hcm91cE1hbnVhbCcsIFsnbWFudWFsJ11dXG4gICAgXTtcblxuICAgIGZ1bmN0aW9uIGNsb3VkQWlSZWFzb25zKGluY2x1ZGVNYW51YWwpIHtcbiAgICAgICAgdmFyIHJlYXNvbnMgPSBbXTtcbiAgICAgICAgQ0xPVURfQUlfUkVBU09OX0dST1VQUy5mb3JFYWNoKGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgZ3JvdXBbMV0uZm9yRWFjaChmdW5jdGlvbiAocmVhc29uKSB7XG4gICAgICAgICAgICAgICAgaWYgKGluY2x1ZGVNYW51YWwgfHwgcmVhc29uICE9PSAnbWFudWFsJykgeyByZWFzb25zLnB1c2gocmVhc29uKTsgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcmVhc29ucztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBtb2R1bGVTdGF0dXNPZihpdGVtKSB7XG4gICAgICAgIHZhciBzdWJqZWN0ID0gaXRlbSAmJiBpdGVtLnBheWxvYWQgJiYgaXRlbS5wYXlsb2FkLnN1YmplY3QgPyBpdGVtLnBheWxvYWQuc3ViamVjdCA6IHt9O1xuICAgICAgICByZXR1cm4gc3ViamVjdC5tb2R1bGVfc3RhdHVzICYmIHR5cGVvZiBzdWJqZWN0Lm1vZHVsZV9zdGF0dXMgPT09ICdvYmplY3QnID8gc3ViamVjdC5tb2R1bGVfc3RhdHVzIDogbnVsbDtcbiAgICB9XG5cbiAgICAvKiogT25lIHNlbnRlbmNlIGZvciBhbiBldmVudCB0eXBlICsgKGNvZGUsIHJlZik7IGFuIHVua25vd24gcGFpciBnZXRzIGEgbmV1dHJhbCBsaW5lLCBuZXZlciB0aGUgcmF3IGNvZGUuICovXG4gICAgZnVuY3Rpb24gc3RhdHVzUGhyYXNlKGV2ZW50VHlwZSwgc3RhdHVzKSB7XG4gICAgICAgIHZhciBjb2RlID0gU3RyaW5nKChzdGF0dXMgJiYgc3RhdHVzLmNvZGUpIHx8ICcnKTtcbiAgICAgICAgdmFyIHJlZiA9IFN0cmluZygoc3RhdHVzICYmIHN0YXR1cy5yZWYpIHx8ICcnKTtcbiAgICAgICAgdmFyIGtleSA9IFNUQVRVU19SRUNPVkVSWV9LRVlTW2V2ZW50VHlwZV1cbiAgICAgICAgICAgIHx8IChjb2RlID09PSAncHJvY2Vzc2luZ19wYXVzZWQnID8gU1RBVFVTX1BBVVNFX0tFWVNbcmVmXSA6IG51bGwpXG4gICAgICAgICAgICB8fCBTVEFUVVNfQ09ERV9LRVlTW2NvZGVdXG4gICAgICAgICAgICB8fCAnTWVzc2FnZVN0YXR1c1Vua25vd24nO1xuICAgICAgICByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfJyArIGtleSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3RhdHVzQ291bnRlck5vdGVzKHN0YXR1cykge1xuICAgICAgICB2YXIgY291bnRlcnMgPSBzdGF0dXMgJiYgc3RhdHVzLmNvdW50ZXJzID8gc3RhdHVzLmNvdW50ZXJzIDoge307XG4gICAgICAgIHZhciBub3RlcyA9IFtdO1xuICAgICAgICBpZiAodHlwZW9mIGNvdW50ZXJzLndvcmtlcnNfb25saW5lID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgY291bnRlcnMud29ya2Vyc190b3RhbCA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIG5vdGVzLnB1c2godGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VTdGF0dXNXb3JrZXJzQ291bnRlcnMnLCB7IG9ubGluZTogY291bnRlcnMud29ya2Vyc19vbmxpbmUsIHRvdGFsOiBjb3VudGVycy53b3JrZXJzX3RvdGFsIH0pKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodHlwZW9mIGNvdW50ZXJzLmpvYnNfd2FpdGluZyA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIG5vdGVzLnB1c2godGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VTdGF0dXNKb2JzV2FpdGluZycsIHsgY291bnQ6IGNvdW50ZXJzLmpvYnNfd2FpdGluZyB9KSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHR5cGVvZiBjb3VudGVycy5pbmNpZGVudHNfb3BlbiA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIG5vdGVzLnB1c2godGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VTdGF0dXNJbmNpZGVudHNPcGVuJywgeyBjb3VudDogY291bnRlcnMuaW5jaWRlbnRzX29wZW4gfSkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBub3RlcztcbiAgICB9XG5cbiAgICAvKiogVGVjaG5pY2FsIHRvb2x0aXA6IHRoZSByYXcgY29kZSBhbmQgcmVmZXJlbmNlIG9mIHRoZSBtb2R1bGUgc3RhdHVzLCBuZXZlciB0aGUgbWFpbiB0ZXh0LiAqL1xuICAgIGZ1bmN0aW9uIHN0YXR1c1Jhd0NvZGUoaXRlbSkge1xuICAgICAgICB2YXIgc3RhdHVzID0gbW9kdWxlU3RhdHVzT2YoaXRlbSk7XG4gICAgICAgIGlmICghc3RhdHVzIHx8ICFzdGF0dXMuY29kZSkge1xuICAgICAgICAgICAgcmV0dXJuICcnO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBTdHJpbmcoc3RhdHVzLmNvZGUpICsgKHN0YXR1cy5yZWYgPyAnOicgKyBzdGF0dXMucmVmIDogJycpO1xuICAgIH1cblxuICAgIC8qKiBJbmZvcm1hdGlvbmFsIHN0YXRlIG9mIGEgc291cmNlIHdob3NlIG1vZHVsZSBjYW5ub3QgYmUgcmVhZCAobm8gYWN0aW9uIGJ1dHRvbnMsIGRlY2lzaW9uIFExNCkuICovXG4gICAgZnVuY3Rpb24gc291cmNlU3RhdGVUZXh0KHNvdXJjZSkge1xuICAgICAgICBzd2l0Y2ggKHNvdXJjZS5hdmFpbGFiaWxpdHkpIHtcbiAgICAgICAgICAgIGNhc2UgJ21vZHVsZV9taXNzaW5nJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU291cmNlU3RhdGVOb2luc3QnKTtcbiAgICAgICAgICAgIGNhc2UgJ21vZHVsZV9kaXNhYmxlZCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NvdXJjZVN0YXRlTW9kb2ZmJyk7XG4gICAgICAgICAgICBjYXNlICdhcGlfZm9yYmlkZGVuJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfTm90aWZTb3VyY2VOb0FjY2VzcycpO1xuICAgICAgICAgICAgY2FzZSAnYXBpX2luY29tcGF0aWJsZSc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHNvdXJjZS51cGRhdGVfdG9cbiAgICAgICAgICAgICAgICAgICAgPyB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfU291cmNlU3RhdGVPdXRkYXRlZFRvJywgeyB2ZXJzaW9uOiBzb3VyY2UudXBkYXRlX3RvIH0pXG4gICAgICAgICAgICAgICAgICAgIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU291cmNlU3RhdGVPdXRkYXRlZEFueScpO1xuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICByZXR1cm4gc291cmNlLmF2YWlsYWJpbGl0eV9uYW1lIHx8ICcnO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYnVpbGRQZXJpb2RNZW51KCkge1xuICAgICAgICAkKCcjbWgtam91cm5hbC1maWx0ZXJzIC5taC1maWx0ZXItcGVyaW9kJykuZHJvcGRvd24oe1xuICAgICAgICAgICAgdmFsdWVzOiBbXG4gICAgICAgICAgICAgICAgeyBuYW1lOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QZXJpb2RUb2RheScpLCB2YWx1ZTogJ3RvZGF5Jywgc2VsZWN0ZWQ6IHRydWUgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1BlcmlvZFllc3RlcmRheScpLCB2YWx1ZTogJ3llc3RlcmRheScgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1BlcmlvZDdEYXlzJyksIHZhbHVlOiAnN2RheXMnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QZXJpb2QzMERheXMnKSwgdmFsdWU6ICczMGRheXMnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QZXJpb2RBbGwnKSwgdmFsdWU6ICdhbGwnIH1cbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBvbkNoYW5nZTogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUucGVyaW9kID0gU3RyaW5nKHZhbHVlIHx8ICdhbGwnKTtcbiAgICAgICAgICAgICAgICByZWxvYWQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVzZXRGaWx0ZXJzKCkge1xuICAgICAgICBzdGF0ZS5ldmVudFR5cGUgPSAnJztcbiAgICAgICAgc3RhdGUucGVyaW9kID0gJ3RvZGF5JztcbiAgICAgICAgc3RhdGUub2Zmc2V0ID0gMDtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtZmlsdGVycyAubWgtZmlsdGVyLXR5cGUnKS5kcm9wZG93bignY2xlYXInKTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtZmlsdGVycyAubWgtZmlsdGVyLXBlcmlvZCcpLmRyb3Bkb3duKCdzZXQgc2VsZWN0ZWQnLCAndG9kYXknKTtcbiAgICAgICAgcmVsb2FkKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZmlsdGVyc0FjdGl2ZSgpIHtcbiAgICAgICAgLy8gdGhlIGRlZmF1bHQgcGVyaW9kICjCq9Ch0LXQs9C+0LTQvdGPwrspIGlzIG5vdCBhIGZpbHRlcjogYW4gZW1wdHkgbG9nIHNob3dzIMKr0KHQvtCx0YvRgtC40Lkg0L3QtdGCwrtcbiAgICAgICAgcmV0dXJuIHN0YXRlLmV2ZW50VHlwZSAhPT0gJycgfHwgc3RhdGUucGVyaW9kICE9PSAndG9kYXknO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gam91cm5hbDogbG9hZGluZyAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiByZWxvYWQoKSB7XG4gICAgICAgIHN0YXRlLm9mZnNldCA9IDA7XG4gICAgICAgIGxvYWQoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBsb2FkKG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIHNlcSA9ICsrc3RhdGUubG9hZFNlcTtcbiAgICAgICAgdmFyIGJvdW5kcyA9IHBlcmlvZEJvdW5kcygpO1xuICAgICAgICB2YXIgaXNSZWZyZXNoID0gb3B0aW9ucyAmJiBvcHRpb25zLnJlZnJlc2ggPT09IHRydWU7XG4gICAgICAgIHZhciBwYXJhbXMgPSB7XG4gICAgICAgICAgICBsaW1pdDogUEFHRV9MSU1JVCxcbiAgICAgICAgICAgIG9mZnNldDogc3RhdGUub2Zmc2V0XG4gICAgICAgIH07XG4gICAgICAgIGlmIChzdGF0ZS5ldmVudFR5cGUgIT09ICcnKSB7IHBhcmFtcy5ldmVudF90eXBlID0gc3RhdGUuZXZlbnRUeXBlOyB9XG4gICAgICAgIGlmIChib3VuZHMuZnJvbSA+IDApIHsgcGFyYW1zLmRhdGVfZnJvbSA9IGJvdW5kcy5mcm9tOyB9XG4gICAgICAgIGlmIChib3VuZHMudG8gPiAwKSB7IHBhcmFtcy5kYXRlX3RvID0gYm91bmRzLnRvOyB9XG5cbiAgICAgICAgc2V0Sm91cm5hbEJ1c3kodHJ1ZSwgaXNSZWZyZXNoKTtcbiAgICAgICAgYXBpR2V0KCcvZXZlbnRzJywgcGFyYW1zLCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgaWYgKHNlcSAhPT0gc3RhdGUubG9hZFNlcSkge1xuICAgICAgICAgICAgICAgIHJldHVybjsgLy8gYSBuZXdlciByZXF1ZXN0IGFscmVhZHkgYW5zd2VyZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHN0YXRlLnRvdGFsID0gZGF0YS5wYWdpbmF0aW9uID8gZGF0YS5wYWdpbmF0aW9uLnRvdGFsIDogMDtcbiAgICAgICAgICAgIHN0YXRlLmxhc3RJdGVtcyA9IGRhdGEuaXRlbXMgfHwgW107XG4gICAgICAgICAgICBzdGF0ZS5oYXNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc2V0Sm91cm5hbEJ1c3koZmFsc2UsIGlzUmVmcmVzaCk7XG4gICAgICAgICAgICByZW5kZXJKb3VybmFsKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICBpZiAoc2VxICE9PSBzdGF0ZS5sb2FkU2VxKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc2V0Sm91cm5hbEJ1c3koZmFsc2UsIGlzUmVmcmVzaCk7XG4gICAgICAgICAgICByZW5kZXJMb2FkRXJyb3IoZmFpbHVyZSk7XG4gICAgICAgIH0pO1xuICAgICAgICBsb2FkSm91cm5hbEJhZGdlKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2V0Sm91cm5hbEJ1c3koYnVzeSwgaXNSZWZyZXNoKSB7XG4gICAgICAgIHZhciAkdGFibGUgPSAkKCcjbWgtam91cm5hbC10YWJsZSB0YWJsZScpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmF0dHIoJ2FyaWEtYnVzeScsIGJ1c3kgPyAndHJ1ZScgOiAnZmFsc2UnKTtcbiAgICAgICAgJHRhYmxlLnRvZ2dsZUNsYXNzKCdpcy1yZWZyZXNoaW5nJywgQm9vbGVhbihidXN5ICYmIGlzUmVmcmVzaCkpO1xuICAgICAgICBpZiAoIWlzUmVmcmVzaCkge1xuICAgICAgICAgICAgaWYgKGJ1c3kpIHtcbiAgICAgICAgICAgICAgICByZW5kZXJTa2VsZXRvbigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtZXJyb3InKS5lbXB0eSgpO1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtZXJyb3ItcGxhY2Vob2xkZXInKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGpvdXJuYWxUYWJsZUhlYWQoKSB7XG4gICAgICAgIHJldHVybiAnPGNvbGdyb3VwPjxjb2wgc3R5bGU9XCJ3aWR0aDozNnB4XCI+PGNvbCBzdHlsZT1cIndpZHRoOjEwNHB4XCI+PGNvbCBzdHlsZT1cIndpZHRoOjI0MHB4XCI+PGNvbD48Y29sIHN0eWxlPVwid2lkdGg6MTYwcHhcIj48L2NvbGdyb3VwPidcbiAgICAgICAgICAgICsgJzx0aGVhZD48dHI+PHRoPjwvdGg+J1xuICAgICAgICAgICAgKyAnPHRoPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29sdW1uVGltZScpKSArICc8L3RoPidcbiAgICAgICAgICAgICsgJzx0aD4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbHVtbkV2ZW50JykpICsgJzwvdGg+J1xuICAgICAgICAgICAgKyAnPHRoPjwvdGg+J1xuICAgICAgICAgICAgKyAnPHRoPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29sdW1uRGVsaXZlcnknKSkgKyAnPC90aD4nXG4gICAgICAgICAgICArICc8L3RyPjwvdGhlYWQ+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJTa2VsZXRvbigpIHtcbiAgICAgICAgdmFyIHJvd3MgPSAnJztcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCAzOyBpKyspIHtcbiAgICAgICAgICAgIHJvd3MgKz0gJzx0ciBjbGFzcz1cIm1oLXNrZWwtcm93XCI+PHRkPjwvdGQ+PHRkPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6MzZweFwiPjwvc3Bhbj48L3RkPidcbiAgICAgICAgICAgICAgICArICc8dGQ+PHNwYW4gY2xhc3M9XCJtaC1za2VsXCIgc3R5bGU9XCJ3aWR0aDoxNjBweFwiPjwvc3Bhbj48L3RkPidcbiAgICAgICAgICAgICAgICArICc8dGQ+PHNwYW4gY2xhc3M9XCJtaC1za2VsXCIgc3R5bGU9XCJ3aWR0aDo3MCVcIj48L3NwYW4+PC90ZD4nXG4gICAgICAgICAgICAgICAgKyAnPHRkPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6OTZweDtoZWlnaHQ6MjBweDtib3JkZXItcmFkaXVzOjVweFwiPjwvc3Bhbj48L3RkPjwvdHI+JztcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmh0bWwoJzxkaXYgY2xhc3M9XCJtaC10YWJsZS13cmFwXCI+PHRhYmxlIGNsYXNzPVwidWkgdGFibGUgbWgtam91cm5hbC10YWJsZVwiIGFyaWEtYnVzeT1cInRydWVcIj4nXG4gICAgICAgICAgICArIGpvdXJuYWxUYWJsZUhlYWQoKSArICc8dGJvZHk+JyArIHJvd3MgKyAnPC90Ym9keT48L3RhYmxlPjwvZGl2PicpO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gam91cm5hbDogZGlzcGxheSBydWxlcyAocHJvYmVzIGhpZGRlbiwgY2FsbGJhY2tzIGZvbGRlZCBpbnRvIHRoZSBtaXNzZWQgY2FsbCkgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gaXNQcm9iZShpdGVtKSB7XG4gICAgICAgIHJldHVybiBCb29sZWFuKGl0ZW0gJiYgaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5wcm9iZSA9PT0gdHJ1ZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2FsbGJhY2tJbmRleChpdGVtcykge1xuICAgICAgICB2YXIgaW5kZXggPSB7fTtcbiAgICAgICAgKGl0ZW1zIHx8IFtdKS5mb3JFYWNoKGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgICAgICBpZiAoaXRlbS5ldmVudF90eXBlICE9PSAnY29yZS5taXNzZWRfY2FsbF9yZXNvbHZlZCcpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgY2FsbCA9IChpdGVtLnBheWxvYWQgJiYgaXRlbS5wYXlsb2FkLnN1YmplY3QgJiYgaXRlbS5wYXlsb2FkLnN1YmplY3QuY2FsbCkgfHwge307XG4gICAgICAgICAgICBpZiAoY2FsbC5taXNzZWRfbGlua2VkaWQgJiYgIWluZGV4W2NhbGwubWlzc2VkX2xpbmtlZGlkXSkge1xuICAgICAgICAgICAgICAgIGluZGV4W2NhbGwubWlzc2VkX2xpbmtlZGlkXSA9IGl0ZW0ub2NjdXJyZWRfYXQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gaW5kZXg7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2FsbGJhY2tUaW1lKGl0ZW0pIHtcbiAgICAgICAgdmFyIGNhbGwgPSAoaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5zdWJqZWN0ICYmIGl0ZW0ucGF5bG9hZC5zdWJqZWN0LmNhbGwpIHx8IHt9O1xuICAgICAgICBpZiAoY2FsbC5saW5rZWRpZCAmJiBzdGF0ZS5jYWxsYmFja3NbY2FsbC5saW5rZWRpZF0pIHtcbiAgICAgICAgICAgIHJldHVybiBzdGF0ZS5jYWxsYmFja3NbY2FsbC5saW5rZWRpZF07XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHJlc29sdmVkID0gMDtcbiAgICAgICAgKGl0ZW0uZGVsaXZlcmllcyB8fCBbXSkuZm9yRWFjaChmdW5jdGlvbiAoZGVsaXZlcnkpIHtcbiAgICAgICAgICAgIGlmIChkZWxpdmVyeS5yZXNvbHZlZF9hdCAmJiAocmVzb2x2ZWQgPT09IDAgfHwgZGVsaXZlcnkucmVzb2x2ZWRfYXQgPCByZXNvbHZlZCkpIHtcbiAgICAgICAgICAgICAgICByZXNvbHZlZCA9IGRlbGl2ZXJ5LnJlc29sdmVkX2F0O1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHJlc29sdmVkO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHZpc2libGVKb3VybmFsSXRlbXMoKSB7XG4gICAgICAgIHN0YXRlLmNhbGxiYWNrcyA9IGNhbGxiYWNrSW5kZXgoc3RhdGUubGFzdEl0ZW1zKTtcbiAgICAgICAgcmV0dXJuIHN0YXRlLmxhc3RJdGVtcy5maWx0ZXIoZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgICAgIGlmIChpdGVtLmV2ZW50X3R5cGUgPT09ICdjb3JlLm1pc3NlZF9jYWxsX3Jlc29sdmVkJykge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBzdGF0ZS5zaG93UHJvYmVzIHx8ICFpc1Byb2JlKGl0ZW0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJKb3VybmFsKCkge1xuICAgICAgICBoaWRlSm91cm5hbFN0YXRlcygpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvcicpLmVtcHR5KCk7XG4gICAgICAgIHJlbmRlckpvdXJuYWxCYW5uZXIoKTtcbiAgICAgICAgdmFyIGl0ZW1zID0gdmlzaWJsZUpvdXJuYWxJdGVtcygpO1xuXG4gICAgICAgIGlmIChpdGVtcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIGlmIChmaWx0ZXJzQWN0aXZlKCkpIHtcbiAgICAgICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lbXB0eS1maWx0ZXJlZCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lbXB0eScpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtdGFibGUnKS5lbXB0eSgpO1xuICAgICAgICAgICAgcmVuZGVyUGFnZXIoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBuYW1lcyA9IGV2ZW50VHlwZU5hbWVzKCk7XG4gICAgICAgIGlmICghbmFtZXNbJ2h1Yi50ZXN0J10pIHtcbiAgICAgICAgICAgIG5hbWVzWydodWIudGVzdCddID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRXZlbnRUeXBlVGVzdCcpO1xuICAgICAgICB9XG4gICAgICAgIHZhciByb3dzID0gJyc7XG4gICAgICAgIGl0ZW1zLmZvckVhY2goZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgICAgIHJvd3MgKz0gcmVuZGVyUm93KGl0ZW0sIG5hbWVzW2l0ZW0uZXZlbnRfdHlwZV0gfHwgaXRlbS5ldmVudF90eXBlKTtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5leHBhbmRlZElkID09PSBpdGVtLmlkKSB7XG4gICAgICAgICAgICAgICAgcm93cyArPSByZW5kZXJEZXRhaWxSb3coaXRlbSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmh0bWwoJzxkaXYgY2xhc3M9XCJtaC10YWJsZS13cmFwXCI+PHRhYmxlIGNsYXNzPVwidWkgc2VsZWN0YWJsZSB0YWJsZSBtaC1qb3VybmFsLXRhYmxlXCI+J1xuICAgICAgICAgICAgKyBqb3VybmFsVGFibGVIZWFkKCkgKyAnPHRib2R5PicgKyByb3dzICsgJzwvdGJvZHk+PC90YWJsZT48L2Rpdj4nKTtcblxuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZSB0Ym9keSB0ci5taC1ldmVudC1yb3cnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB0b2dnbGVSb3coJCh0aGlzKS5kYXRhKCdpZCcpKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXRhYmxlJykub2ZmKCdjbGljay5yZXRyeScpLm9uKCdjbGljay5yZXRyeScsICdbZGF0YS1hY3Rpb249XCJyZXRyeS1ldmVudFwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgICB2YXIgZXZlbnRJZCA9ICQodGhpcykuZGF0YSgnZXZlbnQtaWQnKTtcbiAgICAgICAgICAgIHZhciAkYnV0dG9uID0gJCh0aGlzKS5wcm9wKCdkaXNhYmxlZCcsIHRydWUpO1xuICAgICAgICAgICAgYXBpUG9zdCgnL2V2ZW50cy8nICsgZXZlbnRJZCArICc6cmV0cnknLCB7fSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5UmV0cmllZCcsIHsgY291bnQ6IGRhdGEucmV0cmllZCB8fCAwIH0pKTtcbiAgICAgICAgICAgICAgICBsb2FkKCk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgICAgICRidXR0b24ucHJvcCgnZGlzYWJsZWQnLCBmYWxzZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICByZW5kZXJQYWdlcigpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGhpZGVKb3VybmFsU3RhdGVzKCkge1xuICAgICAgICAkKCcjbWgtam91cm5hbC1lbXB0eScpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1lbXB0eS1maWx0ZXJlZCcpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvci1wbGFjZWhvbGRlcicpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckxvYWRFcnJvcihmYWlsdXJlKSB7XG4gICAgICAgIHZhciBoaW50ID0gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vbkxvYWRFcnJvcicsIHtcbiAgICAgICAgICAgIHdoYXQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0xvYWRXaGF0RXZlbnRzJyksXG4gICAgICAgICAgICBjb2RlOiBmYWlsdXJlLnN0YXR1cyA+IDAgPyBmYWlsdXJlLnN0YXR1cyA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblRpbWVvdXQnKVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKHN0YXRlLmhhc0xvYWRlZCAmJiBzdGF0ZS5sYXN0SXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgLy8gZGF0YSBpcyBhbHJlYWR5IG9uIHRoZSBzY3JlZW46IGtlZXAgdGhlIHRhYmxlLCBzaG93IGEgYmFubmVyIGFib3ZlIGl0XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvcicpLmh0bWwoXG4gICAgICAgICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlXCIgcm9sZT1cImFsZXJ0XCI+JyArIElDT05fRVJST1JcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtZ3Jvd1wiPicgKyBlc2MoaGludCkgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgJzxidXR0b24gY2xhc3M9XCJ1aSBiYXNpYyBidXR0b24gbWgtb24tbWVzc2FnZVwiIHR5cGU9XCJidXR0b25cIiBpZD1cIm1oLWpvdXJuYWwtcmV0cnktaW5saW5lXCI+J1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblJldHJ5JykpICsgJzwvYnV0dG9uPjwvZGl2PidcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1yZXRyeS1pbmxpbmUnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IGxvYWQoKTsgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmVtcHR5KCk7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1wYWdlcicpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtZXJyb3ItcGxhY2Vob2xkZXItaGludCcpLnRleHQoaGludCk7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvci1wbGFjZWhvbGRlcicpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiBwcm9ibGVtIGJhbm5lciBhbmQgdGhlIHVuZGVsaXZlcmVkIGNvdW50ZXIgb24gdGhlIHRhYiAtLS0tLS0tLS0tXG5cbiAgICAvLyBPbmUgcmVkIGxpbmUgYWJvdmUgdGhlIHRhYmxlIGluc3RlYWQgb2YgwqvQkdC+0YIg0YPQtNCw0LvRkdC9wrsgaW4gZXZlcnkgcm93IChkZXNpZ24gdjMsIMKr0JbRg9GA0L3QsNC7wrspLlxuICAgIGZ1bmN0aW9uIGJvdFByb2JsZW0oKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUuYm90cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGJvdCA9IHN0YXRlLmJvdHNbaV07XG4gICAgICAgICAgICBpZiAoYm90LmVuYWJsZWQgIT09IGZhbHNlICYmIGJvdC5zdGF0dXMgPT09ICd0b2tlbl9pbnZhbGlkJykge1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQ6IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9CYW5uZXJUb2tlbkludmFsaWQnLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICBib3Q6IGJvdC5ib3RfdXNlcm5hbWUgPyAnQCcgKyBib3QuYm90X3VzZXJuYW1lIDogJ8KrJyArIGJvdC50aXRsZSArICfCuydcbiAgICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgICAgIGJvdElkOiBOdW1iZXIoYm90LmlkKVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gYSBkZWxldGVkIGJvdCBpcyBvbmx5IHZpc2libGUgdGhyb3VnaCBpdHMgZmFpbGVkIGRlbGl2ZXJpZXMgKHRoZSBib3Qgcm93IGlzIGdvbmUpXG4gICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgc3RhdGUubGFzdEl0ZW1zLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICB2YXIgZGVsaXZlcmllcyA9IHN0YXRlLmxhc3RJdGVtc1tqXS5kZWxpdmVyaWVzIHx8IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgayA9IDA7IGsgPCBkZWxpdmVyaWVzLmxlbmd0aDsgaysrKSB7XG4gICAgICAgICAgICAgICAgaWYgKGRlbGl2ZXJpZXNba10uYm90X2RlbGV0ZWQgJiYgaXNGYWlsZWREZWxpdmVyeShkZWxpdmVyaWVzW2tdKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4geyB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9CYW5uZXJCb3REZWxldGVkJyksIGJvdElkOiAwIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckpvdXJuYWxCYW5uZXIoKSB7XG4gICAgICAgIHZhciBwcm9ibGVtID0gc3RhdGUuYm90c0xvYWRlZCA/IGJvdFByb2JsZW0oKSA6IG51bGw7XG4gICAgICAgIGlmIChwcm9ibGVtID09PSBudWxsKSB7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1iYW5uZXInKS5lbXB0eSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC1qb3VybmFsLWJhbm5lcicpLmh0bWwoJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlIG1oLWJhbm5lclwiIHJvbGU9XCJhbGVydFwiPicgKyBJQ09OX0VSUk9SXG4gICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtZ3Jvd1wiPicgKyBlc2MocHJvYmxlbS50ZXh0KSArICc8L2Rpdj4nXG4gICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uIG1oLW9uLW1lc3NhZ2VcIiB0eXBlPVwiYnV0dG9uXCIgZGF0YS1hY3Rpb249XCJiYW5uZXItZml4XCIgZGF0YS1ib3QtaWQ9XCInICsgcHJvYmxlbS5ib3RJZCArICdcIj4nXG4gICAgICAgICAgICArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9CYW5uZXJDb25uZWN0JykpICsgJzwvYnV0dG9uPjwvZGl2PicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGlzRmFpbGVkRGVsaXZlcnkoZGVsaXZlcnkpIHtcbiAgICAgICAgcmV0dXJuIGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2ZhaWxlZCcgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnZHJvcHBlZCc7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNVbmRlbGl2ZXJlZChpdGVtKSB7XG4gICAgICAgIHJldHVybiAoaXRlbS5kZWxpdmVyaWVzIHx8IFtdKS5zb21lKGlzRmFpbGVkRGVsaXZlcnkpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGxvYWRKb3VybmFsQmFkZ2UoKSB7XG4gICAgICAgIGFwaUdldCgnL2V2ZW50cycsIHsgZGF0ZV9mcm9tOiBzdGFydE9mVG9kYXkoKSwgbGltaXQ6IDIwMCB9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgdmFyIGNvdW50ID0gKGRhdGEuaXRlbXMgfHwgW10pLmZpbHRlcihmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICAgICAgICAgIHJldHVybiAhaXNQcm9iZShpdGVtKSAmJiBpc1VuZGVsaXZlcmVkKGl0ZW0pO1xuICAgICAgICAgICAgfSkubGVuZ3RoO1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtYmFkZ2UnKS50ZXh0KGNvdW50ID4gOTkgPyAnOTkrJyA6IFN0cmluZyhjb3VudCkpXG4gICAgICAgICAgICAgICAgLmF0dHIoJ2FyaWEtbGFiZWwnLCB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfSm91cm5hbEJhZGdlTGFiZWwnLCB7IGNvdW50OiBjb3VudCB9KSlcbiAgICAgICAgICAgICAgICAuYXR0cignaGlkZGVuJywgY291bnQgPiAwID8gbnVsbCA6IHRydWUpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoKSB7fSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiByb3dzIC0tLS0tLS0tLS1cblxuICAgIC8vIEFyZWEgY29kZSBvZiBhIGNvbmZpZ3VyYXRpb24tY2hhbmdlIGV2ZW50ID0+IGl0cyBjYXRhbG9nIGtleSAoc2FtZSBtYXAgYXMgQ29uZmlnQ2hhbmdlVGVtcGxhdGUpLlxuICAgIHZhciBDT05GSUdfQVJFQV9LRVlTID0ge1xuICAgICAgICByb3V0aW5nOiAnQ29uZmlnQXJlYVJvdXRpbmcnLFxuICAgICAgICBwcm92aWRlcnM6ICdDb25maWdBcmVhUHJvdmlkZXJzJyxcbiAgICAgICAgZXh0ZW5zaW9uczogJ0NvbmZpZ0FyZWFFeHRlbnNpb25zJyxcbiAgICAgICAgZW1wbG95ZWVzOiAnQ29uZmlnQXJlYUVtcGxveWVlcycsXG4gICAgICAgIHNlcnZpY2VzOiAnQ29uZmlnQXJlYVNlcnZpY2VzJyxcbiAgICAgICAgbWVkaWE6ICdDb25maWdBcmVhTWVkaWEnLFxuICAgICAgICBzY2hlZHVsZTogJ0NvbmZpZ0FyZWFTY2hlZHVsZScsXG4gICAgICAgIG5ldHdvcms6ICdDb25maWdBcmVhTmV0d29yaycsXG4gICAgICAgIGZpcmV3YWxsOiAnQ29uZmlnQXJlYUZpcmV3YWxsJyxcbiAgICAgICAgc3RvcmFnZTogJ0NvbmZpZ0FyZWFTdG9yYWdlJyxcbiAgICAgICAgYXBpX2tleXM6ICdDb25maWdBcmVhQXBpS2V5cycsXG4gICAgICAgIG1vZHVsZXM6ICdDb25maWdBcmVhTW9kdWxlcycsXG4gICAgICAgIHNldHRpbmdzOiAnQ29uZmlnQXJlYVNldHRpbmdzJyxcbiAgICAgICAgb3RoZXI6ICdDb25maWdBcmVhT3RoZXInXG4gICAgfTtcblxuICAgIGZ1bmN0aW9uIGJyaWVmRm9yKGl0ZW0pIHtcbiAgICAgICAgdmFyIHN1YmplY3QgPSBpdGVtLnBheWxvYWQgJiYgaXRlbS5wYXlsb2FkLnN1YmplY3QgPyBpdGVtLnBheWxvYWQuc3ViamVjdCA6IHt9O1xuICAgICAgICB2YXIgZmFjdHMgPSBpdGVtLnBheWxvYWQgJiYgaXRlbS5wYXlsb2FkLmZhY3RzID8gaXRlbS5wYXlsb2FkLmZhY3RzIDoge307XG4gICAgICAgIHN3aXRjaCAoaXRlbS5ldmVudF90eXBlKSB7XG4gICAgICAgICAgICBjYXNlICdjb3JlLm1pc3NlZF9jYWxsJzpcbiAgICAgICAgICAgIGNhc2UgJ3ZvaWNlX2FnZW50LmNhbGxiYWNrX3JlcXVlc3QnOlxuICAgICAgICAgICAgICAgIHZhciBlbXBsb3llZXMgPSAoc3ViamVjdC5lbXBsb3llZXMgfHwgW10pLm1hcChzaG9ydEVtcGxveWVlKS5qb2luKCcsICcpO1xuICAgICAgICAgICAgICAgIHZhciBjbGllbnQgPSBzdWJqZWN0LmNsaWVudF9udW1iZXIgfHwgJyc7XG4gICAgICAgICAgICAgICAgaWYgKGNsaWVudCAhPT0gJycgJiYgZW1wbG95ZWVzICE9PSAnJykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gY2xpZW50ICsgJyDihpIgJyArIGVtcGxveWVlcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNsaWVudCAhPT0gJycgPyBjbGllbnQgOiBlbXBsb3llZXM7XG4gICAgICAgICAgICBjYXNlICdjb3JlLnF1ZXVlX2FiYW5kb25lZCc6XG4gICAgICAgICAgICAgICAgdmFyIHF1ZXVlQ2FsbCA9IHN1YmplY3QuY2FsbCB8fCB7fTtcbiAgICAgICAgICAgICAgICB2YXIgcXVldWVUZXh0ID0gcXVldWVMYWJlbChxdWV1ZUNhbGwpO1xuICAgICAgICAgICAgICAgIHJldHVybiBxdWV1ZVRleHQgIT09ICcnID8gcXVldWVUZXh0IDogU3RyaW5nKHN1YmplY3QuY2xpZW50X251bWJlciB8fCAnJyk7XG4gICAgICAgICAgICBjYXNlICdjb3JlLmNhbGxfb3V0X29mX2hvdXJzJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gU3RyaW5nKHN1YmplY3QuY2xpZW50X251bWJlciB8fCAoc3ViamVjdC5jYWxsICYmIHN1YmplY3QuY2FsbC5kaWQpIHx8ICcnKTtcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUucGFya190aW1lb3V0JzpcbiAgICAgICAgICAgICAgICB2YXIgcGFya0NhbGwgPSBzdWJqZWN0LmNhbGwgfHwge307XG4gICAgICAgICAgICAgICAgdmFyIHBhcmtUZXh0ID0gcGFya0NhbGwucGFya19zbG90ID8gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VQYXJrU2xvdCcsIHsgc2xvdDogcGFya0NhbGwucGFya19zbG90IH0pIDogJyc7XG4gICAgICAgICAgICAgICAgdmFyIHBhcmtDbGllbnQgPSBTdHJpbmcoc3ViamVjdC5jbGllbnRfbnVtYmVyIHx8ICcnKTtcbiAgICAgICAgICAgICAgICBpZiAocGFya1RleHQgIT09ICcnICYmIHBhcmtDbGllbnQgIT09ICcnKSB7IHJldHVybiBwYXJrVGV4dCArICcgwrcgJyArIHBhcmtDbGllbnQ7IH1cbiAgICAgICAgICAgICAgICByZXR1cm4gcGFya1RleHQgIT09ICcnID8gcGFya1RleHQgOiBwYXJrQ2xpZW50O1xuICAgICAgICAgICAgY2FzZSAnYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCc6XG4gICAgICAgICAgICAgICAgaWYgKGZhY3RzLnNjb3JlcyAmJiBmYWN0cy5zY29yZXMucXVhbGl0eSAhPT0gbnVsbCAmJiBmYWN0cy5zY29yZXMucXVhbGl0eSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQnJpZWZTY29yZScsIHsgc2NvcmU6IGZhY3RzLnNjb3Jlcy5xdWFsaXR5IH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gZmFjdHMuc3VtbWFyeSB8fCBzdWJqZWN0LmNsaWVudF9udW1iZXIgfHwgJyc7XG4gICAgICAgICAgICBjYXNlICdjb3JlLnByb3ZpZGVyX2Rvd24nOlxuICAgICAgICAgICAgY2FzZSAnY29yZS5wcm92aWRlcl91cCc6XG4gICAgICAgICAgICAgICAgdmFyIHByb3ZpZGVyID0gc3ViamVjdC5wcm92aWRlciB8fCB7fTtcbiAgICAgICAgICAgICAgICByZXR1cm4gcHJvdmlkZXIudXNlcm5hbWUgPyAnU0lQIMKrJyArIHByb3ZpZGVyLnVzZXJuYW1lICsgJ8K7JyA6IChwcm92aWRlci5ob3N0IHx8IHByb3ZpZGVyLmlkIHx8ICcnKTtcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUuYWR2aWNlJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFjdHMuc3VtbWFyeSB8fCBhZHZpY2VUZXh0KHN1YmplY3QuYWR2aWNlIHx8IHt9KTtcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUuY29uZmlnX2NoYW5nZWQnOlxuICAgICAgICAgICAgICAgIHZhciBjb25maWcgPSBzdWJqZWN0LmNvbmZpZyB8fCB7fTtcbiAgICAgICAgICAgICAgICB2YXIgYXJlYU5hbWVzID0gKGNvbmZpZy5hcmVhcyB8fCBbXSkubWFwKGZ1bmN0aW9uIChhcmVhKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl8nICsgKENPTkZJR19BUkVBX0tFWVNbYXJlYS5hcmVhXSB8fCAnQ29uZmlnQXJlYU90aGVyJykpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIGlmIChhcmVhTmFtZXMubGVuZ3RoID4gMykge1xuICAgICAgICAgICAgICAgICAgICBhcmVhTmFtZXMgPSBhcmVhTmFtZXMuc2xpY2UoMCwgMykuY29uY2F0KFsn4oCmJ10pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gYXJlYU5hbWVzLmpvaW4oJywgJyk7XG4gICAgICAgICAgICBjYXNlICdjb3JlLmV4dGVybmFsX2lwX2NoYW5nZWQnOlxuICAgICAgICAgICAgICAgIHZhciBpcENoYW5nZSA9IHN1YmplY3QuZXh0ZXJuYWxfaXAgfHwge307XG4gICAgICAgICAgICAgICAgcmV0dXJuIGlwQ2hhbmdlLm5ldyA/IChpcENoYW5nZS5vbGQgPyBpcENoYW5nZS5vbGQgKyAnIOKGkiAnIDogJycpICsgaXBDaGFuZ2UubmV3IDogJyc7XG4gICAgICAgICAgICBjYXNlICdjb3JlLmxpY2Vuc2VfZXhwaXJpbmcnOlxuICAgICAgICAgICAgICAgIHZhciBsaWNlbnNlID0gc3ViamVjdC5saWNlbnNlIHx8IHt9O1xuICAgICAgICAgICAgICAgIHJldHVybiAobGljZW5zZS5wcm9kdWN0IHx8ICcnKSArIChsaWNlbnNlLmV4cGlyeSA/ICcgwrcgJyArIGxpY2Vuc2UuZXhwaXJ5IDogJycpO1xuICAgICAgICAgICAgY2FzZSAnaHViLnRlc3QnOlxuICAgICAgICAgICAgICAgIHZhciB0ZXN0U3lzdGVtID0gc3ViamVjdC5zeXN0ZW0gfHwge307XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRlc3RTeXN0ZW0uYm90X3RpdGxlIHx8ICcnO1xuICAgICAgICAgICAgY2FzZSAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb2ZmbGluZSc6XG4gICAgICAgICAgICBjYXNlICdhaV9zdXBlcnZpc29yLndvcmtlcl9vbmxpbmUnOlxuICAgICAgICAgICAgICAgIGlmIChzdWJqZWN0Lm1vZHVsZV9zdGF0dXMpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHN0YXR1c1BocmFzZShpdGVtLmV2ZW50X3R5cGUsIHN1YmplY3QubW9kdWxlX3N0YXR1cyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiAoc3ViamVjdC53b3JrZXIgJiYgc3ViamVjdC53b3JrZXIubmFtZSkgfHwgZmFjdHMuc3VtbWFyeSB8fCAnJztcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgaWYgKHN1YmplY3QubW9kdWxlX3N0YXR1cykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gc3RhdHVzUGhyYXNlKGl0ZW0uZXZlbnRfdHlwZSwgc3ViamVjdC5tb2R1bGVfc3RhdHVzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhY3RzLnN1bW1hcnkgfHwgJyc7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBcItCf0YDQvtC00LDQttC4ICg4MDApXCIgZnJvbSBhIHF1ZXVlIGV2ZW50OyB0aGUgcXVldWUgbmFtZSBpcyBvcHRpb25hbCAoQ29yZSBDYWxsUXVldWVzIG1heSBiZSBlbXB0eSkuXG4gICAgZnVuY3Rpb24gcXVldWVMYWJlbChjYWxsKSB7XG4gICAgICAgIHZhciBudW1iZXIgPSBTdHJpbmcoKGNhbGwgJiYgY2FsbC5xdWV1ZV9udW1iZXIpIHx8ICcnKS50cmltKCk7XG4gICAgICAgIHZhciBuYW1lID0gU3RyaW5nKChjYWxsICYmIGNhbGwucXVldWVfbmFtZSkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgaWYgKG5hbWUgPT09ICcnKSB7IHJldHVybiBudW1iZXI7IH1cbiAgICAgICAgcmV0dXJuIG51bWJlciA9PT0gJycgPyBuYW1lIDogbmFtZSArICcgKCcgKyBudW1iZXIgKyAnKSc7XG4gICAgfVxuXG4gICAgLy8gwqvQn9C+0YDRgtC90L7QsiDQkNC70LXQutGB0LXQucK7ICgyMDQpIOKGkiDCq9Cf0L7RgNGC0L3QvtCyINCQLiAoMjA0KcK7LCBhcyBpbiB0aGUgam91cm5hbCBtb2NrdXBcbiAgICBmdW5jdGlvbiBzaG9ydEVtcGxveWVlKGVtcGxveWVlKSB7XG4gICAgICAgIHZhciBuYW1lID0gU3RyaW5nKGVtcGxveWVlLm5hbWUgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgdmFyIHBhcnRzID0gbmFtZS5zcGxpdCgvXFxzKy8pO1xuICAgICAgICBpZiAocGFydHMubGVuZ3RoID49IDIgJiYgcGFydHNbMV0gIT09ICcnKSB7XG4gICAgICAgICAgICBuYW1lID0gcGFydHNbMF0gKyAnICcgKyBwYXJ0c1sxXS5jaGFyQXQoMCkgKyAnLic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG5hbWUgPT09ICcnKSB7XG4gICAgICAgICAgICByZXR1cm4gU3RyaW5nKGVtcGxveWVlLm51bWJlciB8fCAnJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGVtcGxveWVlLm51bWJlciA/IG5hbWUgKyAnICgnICsgZW1wbG95ZWUubnVtYmVyICsgJyknIDogbmFtZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmdWxsRW1wbG95ZWUoZW1wbG95ZWUpIHtcbiAgICAgICAgcmV0dXJuIGVtcGxveWVlLm5hbWUgPyBlbXBsb3llZS5uYW1lICsgKGVtcGxveWVlLm51bWJlciA/ICcgKCcgKyBlbXBsb3llZS5udW1iZXIgKyAnKScgOiAnJykgOiBTdHJpbmcoZW1wbG95ZWUubnVtYmVyIHx8ICcnKTtcbiAgICB9XG5cbiAgICAvLyBDb3JlIGFkdmljZSB0ZXh0OiB0aGUgYWRtaW4gY2FiaW5ldCBhbHJlYWR5IGhhcyB0aGUgQ29yZSBjYXRhbG9nIGluIGdsb2JhbFRyYW5zbGF0ZVxuICAgIC8vICh0ZW1wbGF0ZXMgbGlrZSBcIuKApiA8YSBocmVmPScldXJsJSc+JXZlciU8L2E+XCIpOyBzdWJzdGl0dXRlIHBhcmFtcyBhbmQgZHJvcCB0aGUgbWFya3VwIGFzIHBsYWluIHRleHQuXG4gICAgZnVuY3Rpb24gYWR2aWNlVGV4dChhZHZpY2UpIHtcbiAgICAgICAgdmFyIHRwbCA9IChhZHZpY2UgJiYgYWR2aWNlLm1lc3NhZ2VfdHBsKSB8fCAnJztcbiAgICAgICAgdmFyIHRleHQgPSB0KHRwbCk7XG4gICAgICAgIGlmICh0cGwgPT09ICcnIHx8IHRleHQgPT09IHRwbCkge1xuICAgICAgICAgICAgcmV0dXJuIHRwbDtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcGFyYW1zID0gKGFkdmljZSAmJiBhZHZpY2UucGFyYW1zKSB8fCB7fTtcbiAgICAgICAgT2JqZWN0LmtleXMocGFyYW1zKS5mb3JFYWNoKGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICB0ZXh0ID0gdGV4dC5zcGxpdCgnJScgKyBuYW1lICsgJyUnKS5qb2luKFN0cmluZyhwYXJhbXNbbmFtZV0pKTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIE5ldmVyIHBhcnNlIGFzIEhUTUwgKHBhcmFtcyBtYXkgY2FycnkgdXNlci1lbnRlcmVkIG5hbWVzKTogc3RyaXAgdGFncyBhcyB0ZXh0LCBvdXRwdXQgaXMgZXNjYXBlZCBsYXRlci5cbiAgICAgICAgcmV0dXJuIHRleHQucmVwbGFjZSgvPFtePl0qPi9nLCAnJylcbiAgICAgICAgICAgIC5yZXBsYWNlKC8mbmJzcDsvZywgJyAnKS5yZXBsYWNlKC8mcXVvdDsvZywgJ1wiJykucmVwbGFjZSgvJiMwMzk7fCYjMzk7L2csIFwiJ1wiKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZsdDsvZywgJzwnKS5yZXBsYWNlKC8mZ3Q7L2csICc+JykucmVwbGFjZSgvJmFtcDsvZywgJyYnKVxuICAgICAgICAgICAgLnJlcGxhY2UoL1xccysvZywgJyAnKS50cmltKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyUm93KGl0ZW0sIGV2ZW50TmFtZSkge1xuICAgICAgICB2YXIgcHJvYmUgPSBpc1Byb2JlKGl0ZW0pID8gJzxzcGFuIGNsYXNzPVwibWgtcHJvYmVcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Byb2JlVGFnJykpICsgJzwvc3Bhbj4nIDogJyc7XG4gICAgICAgIHZhciBicmllZiA9IGJyaWVmRm9yKGl0ZW0pO1xuICAgICAgICB2YXIgZXhwYW5kZWQgPSBzdGF0ZS5leHBhbmRlZElkID09PSBpdGVtLmlkO1xuICAgICAgICByZXR1cm4gJzx0ciBjbGFzcz1cIm1oLWV2ZW50LXJvdycgKyAoZXhwYW5kZWQgPyAnIGFjdGl2ZScgOiAnJykgKyAnXCIgZGF0YS1pZD1cIicgKyBpdGVtLmlkICsgJ1wiIGFyaWEtZXhwYW5kZWQ9XCInICsgKGV4cGFuZGVkID8gJ3RydWUnIDogJ2ZhbHNlJykgKyAnXCI+J1xuICAgICAgICAgICAgKyAnPHRkIGNsYXNzPVwibWgtY2hldnJvbi1jZWxsXCI+JyArIElDT05fQ0hFVlJPTiArICc8L3RkPidcbiAgICAgICAgICAgICsgJzx0ZCBjbGFzcz1cIm1oLWNlbGwtdGltZVwiPicgKyBmbXRDZWxsVGltZShpdGVtLm9jY3VycmVkX2F0KSArICc8L3RkPidcbiAgICAgICAgICAgICsgJzx0ZD48ZGl2IGNsYXNzPVwibWgtZXZlbnQtY2VsbFwiPjxzcGFuIGNsYXNzPVwibWgtdHJ1bmNhdGVcIiB0aXRsZT1cIicgKyBlc2MoZXZlbnROYW1lKSArICdcIj4nICsgZXNjKGV2ZW50TmFtZSkgKyAnPC9zcGFuPicgKyBwcm9iZSArICc8L2Rpdj48L3RkPidcbiAgICAgICAgICAgICsgJzx0ZCBjbGFzcz1cIm1oLXRydW5jYXRlIG1oLW11dGVkXCIgdGl0bGU9XCInICsgZXNjKHN0YXR1c1Jhd0NvZGUoaXRlbSkgIT09ICcnID8gYnJpZWYgKyAnICgnICsgc3RhdHVzUmF3Q29kZShpdGVtKSArICcpJyA6IGJyaWVmKSArICdcIj4nICsgZXNjKGJyaWVmKSArICc8L3RkPidcbiAgICAgICAgICAgICsgJzx0ZD4nICsgZGVsaXZlcnlDZWxsKGl0ZW0pICsgJzwvdGQ+J1xuICAgICAgICAgICAgKyAnPC90cj4nO1xuICAgIH1cblxuICAgIC8vIDPigJM0IGh1bWFuIGZpZWxkczsgdGVjaG5pY2FsIG9uZXMgKGV2ZW50IHR5cGUsIGNhbGwgSUQsIHNvdXJjZSkgc3RheSBvdXQgb2YgdGhlIGludGVyZmFjZS5cbiAgICBmdW5jdGlvbiBkZXRhaWxGaWVsZHMoaXRlbSkge1xuICAgICAgICB2YXIgc3ViamVjdCA9IGl0ZW0ucGF5bG9hZCAmJiBpdGVtLnBheWxvYWQuc3ViamVjdCA/IGl0ZW0ucGF5bG9hZC5zdWJqZWN0IDoge307XG4gICAgICAgIHZhciBmYWN0cyA9IGl0ZW0ucGF5bG9hZCAmJiBpdGVtLnBheWxvYWQuZmFjdHMgPyBpdGVtLnBheWxvYWQuZmFjdHMgOiB7fTtcbiAgICAgICAgdmFyIGZpZWxkcyA9IFtdO1xuICAgICAgICB2YXIgZW1wbG95ZWVzID0gKHN1YmplY3QuZW1wbG95ZWVzIHx8IFtdKS5tYXAoZnVsbEVtcGxveWVlKS5qb2luKCcsICcpO1xuICAgICAgICBpZiAoZW1wbG95ZWVzICE9PSAnJykgeyBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsRW1wbG95ZWUnKSwgZW1wbG95ZWVzXSk7IH1cbiAgICAgICAgaWYgKHN1YmplY3QuY2xpZW50X251bWJlcikgeyBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsQ2xpZW50JyksIHN1YmplY3QuY2xpZW50X251bWJlcl0pOyB9XG4gICAgICAgIGlmIChpdGVtLmV2ZW50X3R5cGUgPT09ICdjb3JlLm1pc3NlZF9jYWxsJykge1xuICAgICAgICAgICAgdmFyIGNhbGxiYWNrID0gY2FsbGJhY2tUaW1lKGl0ZW0pO1xuICAgICAgICAgICAgaWYgKGNhbGxiYWNrID4gMCkge1xuICAgICAgICAgICAgICAgIGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxDYWxsZWRCYWNrJyksIGZtdENlbGxUZXh0KGNhbGxiYWNrKV0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHZhciBwcm92aWRlciA9IHN1YmplY3QucHJvdmlkZXIgfHwge307XG4gICAgICAgIGlmIChwcm92aWRlci51c2VybmFtZSB8fCBwcm92aWRlci5ob3N0KSB7XG4gICAgICAgICAgICBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsUHJvdmlkZXInKSwgKHByb3ZpZGVyLnVzZXJuYW1lIHx8ICcnKSArIChwcm92aWRlci5ob3N0ID8gJyDCtyAnICsgcHJvdmlkZXIuaG9zdCA6ICcnKV0pO1xuICAgICAgICB9XG4gICAgICAgIGlmIChzdWJqZWN0LmFkdmljZSAmJiBzdWJqZWN0LmFkdmljZS5tZXNzYWdlX3RwbCAmJiAhZmFjdHMuc3VtbWFyeSkge1xuICAgICAgICAgICAgZmllbGRzLnB1c2goW3QoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RldGFpbFN1bW1hcnknKSwgYWR2aWNlVGV4dChzdWJqZWN0LmFkdmljZSldKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZmFjdHMuc2NvcmVzICYmIGZhY3RzLnNjb3Jlcy5xdWFsaXR5ICE9PSBudWxsICYmIGZhY3RzLnNjb3Jlcy5xdWFsaXR5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxTY29yZScpLCBmYWN0cy5zY29yZXMucXVhbGl0eV0pO1xuICAgICAgICB9XG4gICAgICAgIGlmIChmYWN0cy5zdW1tYXJ5KSB7IGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxTdW1tYXJ5JyksIGZhY3RzLnN1bW1hcnldKTsgfVxuICAgICAgICBpZiAoc3ViamVjdC5tb2R1bGVfc3RhdHVzKSB7XG4gICAgICAgICAgICBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsU3VtbWFyeScpLFxuICAgICAgICAgICAgICAgIFtzdGF0dXNQaHJhc2UoaXRlbS5ldmVudF90eXBlLCBzdWJqZWN0Lm1vZHVsZV9zdGF0dXMpXS5jb25jYXQoc3RhdHVzQ291bnRlck5vdGVzKHN1YmplY3QubW9kdWxlX3N0YXR1cykpLmpvaW4oJy4gJyldKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoKGZhY3RzLnJlYXNvbnMgfHwgW10pLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxSZWFzb25zJyksIGZhY3RzLnJlYXNvbnMuam9pbignOyAnKV0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmaWVsZHM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZm10Q2VsbFRleHQodHMpIHtcbiAgICAgICAgaWYgKGlzVG9kYXkodHMpKSB7XG4gICAgICAgICAgICByZXR1cm4gZm10VGltZSh0cyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZtdERhdGUodHMpICsgJyAnICsgZm10VGltZSh0cyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyRGV0YWlsUm93KGl0ZW0pIHtcbiAgICAgICAgdmFyIGh0bWwgPSAnPGRsIGNsYXNzPVwibWgtZmllbGRzXCI+JztcbiAgICAgICAgZGV0YWlsRmllbGRzKGl0ZW0pLmZvckVhY2goZnVuY3Rpb24gKHBhaXIpIHtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkdD4nICsgZXNjKHBhaXJbMF0pICsgJzwvZHQ+PGRkPicgKyBlc2MocGFpclsxXSkgKyAnPC9kZD4nO1xuICAgICAgICB9KTtcbiAgICAgICAgdmFyIHJldHJ5YWJsZSA9IGZhbHNlO1xuICAgICAgICAoaXRlbS5kZWxpdmVyaWVzIHx8IFtdKS5mb3JFYWNoKGZ1bmN0aW9uIChkZWxpdmVyeSkge1xuICAgICAgICAgICAgdmFyIHN0YXR1cyA9IGRlbGl2ZXJ5U3RhdHVzVGV4dChkZWxpdmVyeSk7XG4gICAgICAgICAgICB2YXIgYXVkaW8gPSBhdHRhY2htZW50TGluZShkZWxpdmVyeSk7XG4gICAgICAgICAgICB2YXIgcmF3Q29kZSA9IGRlbGl2ZXJ5Lmxhc3RfZXJyb3JfY29kZSB8fCAnJztcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkdCBjbGFzcz1cIm1oLXRydW5jYXRlXCI+JyArIGVzYyhyZWNpcGllbnRUaXRsZShkZWxpdmVyeSkpICsgJzwvZHQ+J1xuICAgICAgICAgICAgICAgICsgJzxkZCcgKyAoc3RhdHVzLmJhZCA/ICcgY2xhc3M9XCJtaC1lcnJvci10ZXh0XCInIDogJycpICsgKHJhd0NvZGUgIT09ICcnID8gJyB0aXRsZT1cIicgKyBlc2MocmF3Q29kZSkucmVwbGFjZSgvXCIvZywgJyZxdW90OycpICsgJ1wiJyA6ICcnKSArICc+J1xuICAgICAgICAgICAgICAgICsgZXNjKHN0YXR1cy50ZXh0KVxuICAgICAgICAgICAgICAgICsgKGF1ZGlvID8gJzxkaXYgY2xhc3M9XCJtaC1tZXRhJyArIChhdWRpby5iYWQgPyAnIG1oLWVycm9yLXRleHQnIDogJycpICsgJ1wiJ1xuICAgICAgICAgICAgICAgICAgICArIChhdWRpby5jb2RlICE9PSAnJyA/ICcgdGl0bGU9XCInICsgZXNjKGF1ZGlvLmNvZGUpLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKSArICdcIicgOiAnJykgKyAnPicgKyBlc2MoYXVkaW8udGV4dCkgKyAnPC9kaXY+JyA6ICcnKVxuICAgICAgICAgICAgICAgICsgJzwvZGQ+JztcbiAgICAgICAgICAgIGlmIChkZWxpdmVyeS5zdGF0dXMgPT09ICdmYWlsZWQnICYmICFkZWxpdmVyeS5ib3RfZGVsZXRlZCAmJiAhZGVsaXZlcnkuY2hhdF9kZWxldGVkKSB7XG4gICAgICAgICAgICAgICAgcmV0cnlhYmxlID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGh0bWwgKz0gJzwvZGw+JztcbiAgICAgICAgaWYgKHJldHJ5YWJsZSkge1xuICAgICAgICAgICAgaHRtbCArPSAnPGJ1dHRvbiBjbGFzcz1cInVpIGJhc2ljIGJ1dHRvblwiIHR5cGU9XCJidXR0b25cIiBkYXRhLWFjdGlvbj1cInJldHJ5LWV2ZW50XCIgZGF0YS1ldmVudC1pZD1cIicgKyBpdGVtLmlkICsgJ1wiPidcbiAgICAgICAgICAgICAgICArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeVJldHJ5JykpICsgJzwvYnV0dG9uPic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICc8dHIgY2xhc3M9XCJtaC1kZXRhaWxcIiBkYXRhLWRldGFpbC1mb3I9XCInICsgaXRlbS5pZCArICdcIj48dGQgY29sc3Bhbj1cIjVcIj48ZGl2IGNsYXNzPVwibWgtZGV0YWlsLWJvZHlcIj4nICsgaHRtbCArICc8L2Rpdj48L3RkPjwvdHI+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZWNpcGllbnRUaXRsZShkZWxpdmVyeSkge1xuICAgICAgICBpZiAoZGVsaXZlcnkuY2hhdF90aXRsZSkge1xuICAgICAgICAgICAgcmV0dXJuIGRlbGl2ZXJ5LmNoYXRfdGl0bGU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRlbGl2ZXJ5LmNoYXRfZGVsZXRlZCkge1xuICAgICAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5Q2hhdERlbGV0ZWQnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZGVsaXZlcnkuZXh0ZXJuYWxfY2hhdF9pZCB8fCAn4oCUJztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZWxpdmVyeUNvdW50cyhpdGVtKSB7XG4gICAgICAgIHZhciBjb3VudHMgPSB7IHRvdGFsOiAwLCBzZW50OiAwLCBmYWlsZWQ6IDAsIHBlbmRpbmc6IDAsIHJlc29sdmVkOiAwIH07XG4gICAgICAgIChpdGVtLmRlbGl2ZXJpZXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24gKGRlbGl2ZXJ5KSB7XG4gICAgICAgICAgICBjb3VudHMudG90YWwrKztcbiAgICAgICAgICAgIGlmIChpc0ZhaWxlZERlbGl2ZXJ5KGRlbGl2ZXJ5KSkgeyBjb3VudHMuZmFpbGVkKys7IH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3BlbmRpbmcnIHx8IGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3NlbmRpbmcnKSB7IGNvdW50cy5wZW5kaW5nKys7IH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2NhbmNlbGxlZCcpIHsgY291bnRzLnJlc29sdmVkKys7IH1cbiAgICAgICAgICAgIGVsc2UgeyBjb3VudHMuc2VudCsrOyB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gY291bnRzO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlbGl2ZXJ5Q2VsbChpdGVtKSB7XG4gICAgICAgIHZhciBjID0gZGVsaXZlcnlDb3VudHMoaXRlbSk7XG4gICAgICAgIGlmIChjLnRvdGFsID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwibWgtbXV0ZWRcIj7igJQ8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYy5mYWlsZWQgPiAwKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCI+JyArIElDT05fRVJST1IgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlOb3REZWxpdmVyZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMucGVuZGluZyA+IDApIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1kb3RcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3RRdWV1ZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMuc2VudCA9PT0gMCAmJiBjLnJlc29sdmVkID4gMCkge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIm1oLWRvdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlDYWxsZWRCYWNrJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1kb3QgaXMtb2tcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3REZWxpdmVyZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgfVxuXG4gICAgLy8gT25lIGxpbmUgcGVyIHJlY2lwaWVudDogc3RhdHVzIOKAlCByZWFzb24uXG4gICAgZnVuY3Rpb24gZGVsaXZlcnlTdGF0dXNUZXh0KGRlbGl2ZXJ5KSB7XG4gICAgICAgIGlmIChpc0ZhaWxlZERlbGl2ZXJ5KGRlbGl2ZXJ5KSkge1xuICAgICAgICAgICAgdmFyIHJlYXNvbiA9IGRlbGl2ZXJ5UmVhc29uKGRlbGl2ZXJ5KTtcbiAgICAgICAgICAgIHJldHVybiB7IGJhZDogdHJ1ZSwgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlOb3REZWxpdmVyZWQnKSArIChyZWFzb24gIT09ICcnID8gJyDCtyAnICsgcmVhc29uIDogJycpIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3BlbmRpbmcnIHx8IGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3NlbmRpbmcnKSB7XG4gICAgICAgICAgICByZXR1cm4geyBiYWQ6IGZhbHNlLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0UXVldWVkJykgKyAoZGVsaXZlcnkubmV4dF9hdHRlbXB0X2F0ID4gMFxuICAgICAgICAgICAgICAgID8gJyDCtyAnICsgdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5TmV4dCcsIHsgdGltZTogZm10Q2VsbFRleHQoZGVsaXZlcnkubmV4dF9hdHRlbXB0X2F0KSB9KVxuICAgICAgICAgICAgICAgIDogJycpIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2NhbmNlbGxlZCcpIHtcbiAgICAgICAgICAgIHJldHVybiB7IGJhZDogZmFsc2UsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5U3RhdHVzQ2FuY2VsbGVkJykgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAncmV0cmFjdGVkJykge1xuICAgICAgICAgICAgcmV0dXJuIHsgYmFkOiBmYWxzZSwgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlTdGF0dXNSZXRyYWN0ZWQnKSB9O1xuICAgICAgICB9XG4gICAgICAgIGlmIChkZWxpdmVyeS5zdGF0dXMgPT09ICdyZXRyYWN0X2ZhaWxlZCcpIHtcbiAgICAgICAgICAgIHJldHVybiB7IGJhZDogdHJ1ZSwgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlTdGF0dXNSZXRyYWN0RmFpbGVkJykgfTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geyBiYWQ6IGZhbHNlLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0RGVsaXZlcmVkJykgfTtcbiAgICB9XG5cbiAgICAvLyBOb3JtYWxpc2VkIGRlbGl2ZXJ5L2F0dGFjaG1lbnQgY29kZXMgLT4gcmVhZGFibGUgdGV4dC4gVGhlIHJhdyBjb2RlIHN0YXlzIGF2YWlsYWJsZSBpbiBhIHRvb2x0aXAgb25seS5cbiAgICB2YXIgQ09ERV9URVhUX0tFWVMgPSB7XG4gICAgICAgICdhdHRhY2htZW50LmNvbnZlcnRlcl9taXNzaW5nJzogJ1JlYXNvbk5vQ29udmVydGVyJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQuY29udmVyc2lvbl9mYWlsZWQnOiAnUmVhc29uQ29udmVydCcsXG4gICAgICAgICdhdHRhY2htZW50LmNvbnZlcnNpb25fdGltZW91dCc6ICdSZWFzb25Db252ZXJ0JyxcbiAgICAgICAgJ2F0dGFjaG1lbnQucHJlcGFyZV9mYWlsZWQnOiAnUmVhc29uQ29udmVydCcsXG4gICAgICAgICdhdHRhY2htZW50LmNhY2hlX3VuYXZhaWxhYmxlJzogJ1JlYXNvbkNvbnZlcnQnLFxuICAgICAgICAnYXR0YWNobWVudC5idXN5JzogJ1JlYXNvbkNvbnZlcnQnLFxuICAgICAgICAnYXR0YWNobWVudC50b29fYmlnJzogJ1JlYXNvblRvb0JpZycsXG4gICAgICAgICdhdHRhY2htZW50LmR1cmF0aW9uX3Rvb19sb25nJzogJ1JlYXNvblRvb0JpZycsXG4gICAgICAgICdhdHRhY2htZW50LnNvdXJjZV9taXNzaW5nJzogJ1JlYXNvbk5vUmVjb3JkaW5nJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQucGF0aF9taXNzaW5nJzogJ1JlYXNvbk5vUmVjb3JkaW5nJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQucGF0aF9yZWplY3RlZCc6ICdSZWFzb25GaWxlVW5hdmFpbGFibGUnLFxuICAgICAgICAnYXR0YWNobWVudC51bmF2YWlsYWJsZSc6ICdSZWFzb25GaWxlVW5hdmFpbGFibGUnLFxuICAgICAgICAndGVsZWdyYW0uZmlsZV91bmF2YWlsYWJsZSc6ICdSZWFzb25GaWxlVW5hdmFpbGFibGUnLFxuICAgICAgICAnYXR0YWNobWVudC5xdW90ZXNfbWlzc2luZyc6ICdSZWFzb25Ob1F1b3RlcycsXG4gICAgICAgICdhdHRhY2htZW50LnVuY2VydGFpbic6ICdSZWFzb25VbmNlcnRhaW4nLFxuICAgICAgICAnZGVsaXZlcnkudW5jZXJ0YWluJzogJ1JlYXNvblVuY2VydGFpbicsXG4gICAgICAgICdhdHRhY2htZW50LnJldHJ5X2V4aGF1c3RlZCc6ICdSZWFzb25SZXRyaWVzJyxcbiAgICAgICAgJ2RlbGl2ZXJ5LmluY29tcGxldGUnOiAnUmVhc29uUmV0cmllcycsXG4gICAgICAgICdhdHRhY2htZW50LnJlamVjdGVkJzogJ1JlYXNvblJlamVjdGVkJyxcbiAgICAgICAgJ2h0dHAuYmFkX3JlcXVlc3QnOiAnUmVhc29uUmVqZWN0ZWQnLFxuICAgICAgICAnYXR0YWNobWVudC5ub3QucmVhZHknOiAnUmVhc29uTm90UmVhZHknLFxuICAgICAgICAnbWF4LmF0dGFjaG1lbnQubm90X3JlYWR5JzogJ1JlYXNvbk5vdFJlYWR5JyxcbiAgICAgICAgJ2F0dGFjaG1lbnQuY2FuY2VsbGVkJzogJ1JlYXNvbkNhbmNlbGxlZCcsXG4gICAgICAgICdodHRwLmNvbm5lY3RfZmFpbGVkJzogJ1JlYXNvbk5vQ29ubmVjdGlvbicsXG4gICAgICAgICdodHRwLnRpbWVvdXQnOiAnUmVhc29uTm9Db25uZWN0aW9uJyxcbiAgICAgICAgJ2h0dHAudW5hdmFpbGFibGUnOiAnUmVhc29uTm9Db25uZWN0aW9uJyxcbiAgICAgICAgJ2h0dHAudGxzJzogJ1JlYXNvbk5vQ29ubmVjdGlvbidcbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gY29kZVRleHQoY29kZSkge1xuICAgICAgICB2YXIga2V5ID0gQ09ERV9URVhUX0tFWVNbY29kZV07XG4gICAgICAgIHJldHVybiBrZXkgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl8nICsga2V5KSA6IGNvZGU7XG4gICAgfVxuXG4gICAgLy8gXCJSZWNvcmRpbmc6IHNlbnQgLyByZXBsYWNlZCBieSBhIG5vdGUgLyBza2lwcGVkIMK3IHJlYXNvblwiOyBudWxsIHdoZW4gdGhlIGRlbGl2ZXJ5IGNhcnJpZXMgbm8gYXVkaW8uXG4gICAgZnVuY3Rpb24gYXR0YWNobWVudExpbmUoZGVsaXZlcnkpIHtcbiAgICAgICAgdmFyIGEgPSBkZWxpdmVyeS5hdHRhY2htZW50O1xuICAgICAgICBpZiAoIWEgfHwgIWEuc3RhdGUgfHwgYS5zdGF0ZSA9PT0gJ25vbmUnKSB7IHJldHVybiBudWxsOyB9XG4gICAgICAgIHZhciB0ZXh0O1xuICAgICAgICB2YXIgYmFkID0gZmFsc2U7XG4gICAgICAgIHZhciB0b3RhbCA9IE51bWJlcihhLnBhcnRzKSB8fCAwO1xuICAgICAgICBpZiAoYS5zdGF0ZSA9PT0gJ3BlbmRpbmcnKSB7XG4gICAgICAgICAgICB0ZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQXR0YWNoUXVldWVkJyk7XG4gICAgICAgIH0gZWxzZSBpZiAoYS5zdGF0ZSA9PT0gJ3NlbnQnKSB7XG4gICAgICAgICAgICB0ZXh0ID0gdG90YWwgPiAxXG4gICAgICAgICAgICAgICAgPyB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQXR0YWNoUGFydGlhbCcsIHsgc2VudDogYS5zZW50LCB0b3RhbDogdG90YWwgfSlcbiAgICAgICAgICAgICAgICA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0F0dGFjaFNlbnQnKTtcbiAgICAgICAgfSBlbHNlIGlmIChhLnN0YXRlID09PSAncGFydGlhbCcpIHtcbiAgICAgICAgICAgIHRleHQgPSB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQXR0YWNoUGFydGlhbCcsIHsgc2VudDogYS5zZW50LCB0b3RhbDogdG90YWwgfSk7XG4gICAgICAgIH0gZWxzZSBpZiAoYS5zdGF0ZSA9PT0gJ3NraXBwZWQnKSB7XG4gICAgICAgICAgICAvLyB0aGUgZmFsbGJhY2sgbm90ZSBpbiB0aGUgdGV4dCB0ZWxscyB3aGVyZSB0aGUgcmVjb3JkaW5nIGNhbiBiZSBmb3VuZFxuICAgICAgICAgICAgdGV4dCA9IGEubm90ZSA9PT0gJ3NlbnQnID8gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQXR0YWNoUmVwbGFjZWQnKSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0F0dGFjaFNraXBwZWQnKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hGYWlsZWQnKTtcbiAgICAgICAgICAgIGJhZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGEuY29kZSAmJiBhLnN0YXRlICE9PSAncGVuZGluZycgJiYgYS5zdGF0ZSAhPT0gJ3NlbnQnKSB7XG4gICAgICAgICAgICB0ZXh0ICs9ICcgwrcgJyArIGNvZGVUZXh0KGEuY29kZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHsgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQXR0YWNoTGFiZWwnKSArICc6ICcgKyB0ZXh0LCBjb2RlOiBhLmNvZGUgfHwgJycsIGJhZDogYmFkIH07XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZGVsaXZlcnlSZWFzb24oZGVsaXZlcnkpIHtcbiAgICAgICAgaWYgKGRlbGl2ZXJ5LmJvdF9kZWxldGVkKSB7IHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeUJvdERlbGV0ZWQnKTsgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuY2hhdF9kZWxldGVkKSB7IHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeUNoYXREZWxldGVkJyk7IH1cbiAgICAgICAgdmFyIGNvZGUgPSBkZWxpdmVyeS5sYXN0X2Vycm9yX2NvZGUgfHwgJyc7XG4gICAgICAgIGlmIChjb2RlID09PSAndGVsZWdyYW0uNDAxLnVuYXV0aG9yaXplZCcpIHsgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c1Rva2VuSW52YWxpZCcpOyB9XG4gICAgICAgIGlmIChjb2RlID09PSAndGVsZWdyYW0uNDAzLmtpY2tlZCcgfHwgY29kZSA9PT0gJ3RlbGVncmFtLjQwMy5ibG9ja2VkJyB8fCBjb2RlID09PSAndGVsZWdyYW0uNDAwLmNoYXRfbm90X2ZvdW5kJ1xuICAgICAgICAgICAgfHwgY29kZSA9PT0gJ21heC40MDMuY2hhdF9kZW5pZWQnIHx8IGNvZGUgPT09ICdtYXguNDA0Lm5vdF9mb3VuZCcgfHwgY29kZSA9PT0gJ21heC40MDQudW5rbm93bicpIHtcbiAgICAgICAgICAgIHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0U3RhdHVzR29uZScpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBjb2RlVGV4dChjb2RlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB0b2dnbGVSb3coaWQpIHtcbiAgICAgICAgc3RhdGUuZXhwYW5kZWRJZCA9IHN0YXRlLmV4cGFuZGVkSWQgPT09IGlkID8gbnVsbCA6IGlkO1xuICAgICAgICByZW5kZXJKb3VybmFsKCk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiBwYWdlciAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiByZW5kZXJQYWdlcigpIHtcbiAgICAgICAgdmFyICRwYWdlciA9ICQoJyNtaC1qb3VybmFsLXBhZ2VyJyk7XG4gICAgICAgIGlmIChzdGF0ZS5sYXN0SXRlbXMubGVuZ3RoID09PSAwIHx8IHN0YXRlLnRvdGFsIDw9IFBBR0VfTElNSVQpIHtcbiAgICAgICAgICAgICRwYWdlci5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAkcGFnZXIucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXBhZ2UtaW5mbycpLnRleHQodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0V2ZW50c1BhZ2UnLCB7XG4gICAgICAgICAgICBmcm9tOiBzdGF0ZS5vZmZzZXQgKyAxLFxuICAgICAgICAgICAgdG86IHN0YXRlLm9mZnNldCArIHN0YXRlLmxhc3RJdGVtcy5sZW5ndGgsXG4gICAgICAgICAgICB0b3RhbDogc3RhdGUudG90YWxcbiAgICAgICAgfSkpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1wcmV2JykuYXR0cignZGlzYWJsZWQnLCBzdGF0ZS5vZmZzZXQgPD0gMCk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLW5leHQnKS5hdHRyKCdkaXNhYmxlZCcsIHN0YXRlLm9mZnNldCArIHN0YXRlLmxhc3RJdGVtcy5sZW5ndGggPj0gc3RhdGUudG90YWwpO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gc2V0dGluZ3MgdGFiIC0tLS0tLS0tLS1cblxuICAgIC8vIEZpZWxkcyBjYXJyeSBubyBoaW50cyAoZGVzaWduIHYzKTsgdGhlIGhlbHAgbGluZSB1bmRlciBhIGZpZWxkIGlzIHVzZWQgb25seSBmb3IgaXRzIGVycm9yLlxuICAgIGZ1bmN0aW9uIG1hcmtGaWVsZEVycm9yKGZpZWxkU2VsZWN0b3IsIG1lc3NhZ2UpIHtcbiAgICAgICAgJChmaWVsZFNlbGVjdG9yKS5hZGRDbGFzcygnZXJyb3InKS5maW5kKCcubWgtaGVscCcpLnRleHQobWVzc2FnZSB8fCAnJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2xlYXJGaWVsZEVycm9yKGZpZWxkU2VsZWN0b3IpIHtcbiAgICAgICAgJChmaWVsZFNlbGVjdG9yKS5yZW1vdmVDbGFzcygnZXJyb3InKS5maW5kKCcubWgtaGVscCcpLnRleHQoJycpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1hcmtSZXRlbnRpb25FcnJvcihtZXNzYWdlKSB7XG4gICAgICAgIG1hcmtGaWVsZEVycm9yKCcjbWgtcmV0ZW50aW9uLWZpZWxkJywgbWVzc2FnZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2xlYXJSZXRlbnRpb25FcnJvcigpIHtcbiAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtcmV0ZW50aW9uLWZpZWxkJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZVJldGVudGlvbigpIHtcbiAgICAgICAgdmFyIHJhdyA9IFN0cmluZygkKCcjbWgtcmV0ZW50aW9uLWlucHV0JykudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgdmFyIGRheXMgPSAvXlxcZCskLy50ZXN0KHJhdykgPyBwYXJzZUludChyYXcsIDEwKSA6IC0xO1xuICAgICAgICBpZiAoZGF5cyA8IDEgfHwgZGF5cyA+IDM2NSkge1xuICAgICAgICAgICAgbWFya1JldGVudGlvbkVycm9yKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9TZXR0aW5nc1JldGVudGlvbkVycm9yJywge30pKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjbGVhclJldGVudGlvbkVycm9yKCk7XG4gICAgICAgIGFwaVBhdGNoKCcvc2V0dGluZ3MnLCB7IGV2ZW50c19yZXRlbnRpb25fZGF5czogZGF5cyB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5yZXRlbnRpb24gPSBkYXlzO1xuICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVkJykpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBtYXJrUmV0ZW50aW9uRXJyb3IodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vbkxvYWRFcnJvcicsIHtcbiAgICAgICAgICAgICAgICB3aGF0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Mb2FkV2hhdFNldHRpbmdzJyksXG4gICAgICAgICAgICAgICAgY29kZTogJ2h0dHBfZXJyb3InXG4gICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAkKCcjbWgtcmV0ZW50aW9uLWlucHV0JykudmFsKHN0YXRlLnJldGVudGlvbik7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNob3dUb2FzdChtZXNzYWdlKSB7XG4gICAgICAgIC8vIHRoZSBhZG1pbiBjYWJpbmV0J3MgRm9tYW50aWMgYnVpbGQgaGFzIG5vIHRvYXN0IG1vZHVsZSDigJQgYSB0aW55IHBpbGwgb2Ygb3VyIG93biAoNCBzKVxuICAgICAgICB2YXIgZXhpc3RpbmcgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcubWgtdG9hc3QnKTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBleGlzdGluZy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgZXhpc3RpbmdbaV0ucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChleGlzdGluZ1tpXSk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHRvYXN0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgICAgIHRvYXN0LmNsYXNzTmFtZSA9ICdtaC10b2FzdCc7XG4gICAgICAgIHRvYXN0LnNldEF0dHJpYnV0ZSgncm9sZScsICdzdGF0dXMnKTtcbiAgICAgICAgdG9hc3QudGV4dENvbnRlbnQgPSBtZXNzYWdlO1xuICAgICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKHRvYXN0KTtcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAodG9hc3QucGFyZW50Tm9kZSkge1xuICAgICAgICAgICAgICAgIHRvYXN0LnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQodG9hc3QpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LCA0MDAwKTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGJvdHM6IEFQSSAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBhcGlTZW5kKG1ldGhvZCwgcGF0aCwgcGF5bG9hZCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpIHtcbiAgICAgICAgdmFyIG9wdGlvbnMgPSB7XG4gICAgICAgICAgICB1cmw6IENvbmZpZy5wYnhVcmwgKyBBUElfQkFTRSArIHBhdGgsXG4gICAgICAgICAgICBtZXRob2Q6IG1ldGhvZCxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgICAgICBjYWNoZTogZmFsc2VcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKHBheWxvYWQgIT09IG51bGwgJiYgcGF5bG9hZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvcHRpb25zLmRhdGEgPSBKU09OLnN0cmluZ2lmeShwYXlsb2FkKTtcbiAgICAgICAgICAgIG9wdGlvbnMuY29udGVudFR5cGUgPSAnYXBwbGljYXRpb24vanNvbic7XG4gICAgICAgIH1cbiAgICAgICAgJC5hamF4KG9wdGlvbnMpLmRvbmUoZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2UucmVzdWx0ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgb25TdWNjZXNzKHJlc3BvbnNlLmRhdGEpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBvbkZhaWx1cmUobm9ybWFsaXplRmFpbHVyZShyZXNwb25zZSwgMjAwKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLmZhaWwoZnVuY3Rpb24gKHhocikge1xuICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUoeGhyLnJlc3BvbnNlSlNPTiB8fCBudWxsLCB4aHIuc3RhdHVzKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGFwaVBvc3QocGF0aCwgcGF5bG9hZCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpIHtcbiAgICAgICAgYXBpU2VuZCgnUE9TVCcsIHBhdGgsIHBheWxvYWQgfHwge30sIG9uU3VjY2Vzcywgb25GYWlsdXJlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBhcGlEZWxldGUocGF0aCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpIHtcbiAgICAgICAgYXBpU2VuZCgnREVMRVRFJywgcGF0aCwgbnVsbCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNvcmVHZXQocGF0aCwgcGFyYW1zLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBDb25maWcucGJ4VXJsICsgJy9wYnhjb3JlL2FwaS92MycgKyBwYXRoLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGRhdGE6IHBhcmFtcyB8fCB7fSxcbiAgICAgICAgICAgIGNhY2hlOiBmYWxzZVxuICAgICAgICB9KS5kb25lKGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlICYmIHJlc3BvbnNlLnJlc3VsdCA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgIG9uU3VjY2VzcyhyZXNwb25zZS5kYXRhKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUocmVzcG9uc2UsIDIwMCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KS5mYWlsKGZ1bmN0aW9uICh4aHIpIHtcbiAgICAgICAgICAgIG9uRmFpbHVyZShub3JtYWxpemVGYWlsdXJlKHhoci5yZXNwb25zZUpTT04gfHwgbnVsbCwgeGhyLnN0YXR1cykpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmYWlsdXJlVGV4dChmYWlsdXJlKSB7XG4gICAgICAgIGlmIChmYWlsdXJlICYmIGZhaWx1cmUuZmllbGQpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWlsdXJlLm1lc3NhZ2VzLmxlbmd0aCA+IDAgPyBmYWlsdXJlLm1lc3NhZ2VzWzBdIDogZmFpbHVyZS5lcnJvcjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gKGZhaWx1cmUgJiYgZmFpbHVyZS5lcnJvcikgPyBmYWlsdXJlLmVycm9yIDogJ2h0dHBfZXJyb3InO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gYm90czogc3RhdGUgJiByZW5kZXJpbmcgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gYm90QnlJZChpZCkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLmJvdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIoc3RhdGUuYm90c1tpXS5pZCkgPT09IE51bWJlcihpZCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc3RhdGUuYm90c1tpXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZXBsYWNlQm90KGJvdCkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLmJvdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIoc3RhdGUuYm90c1tpXS5pZCkgPT09IE51bWJlcihib3QuaWQpKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUuYm90c1tpXSA9IGJvdDtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgc3RhdGUuYm90cy5wdXNoKGJvdCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbG9hZEJvdHMoc2lsZW50KSB7XG4gICAgICAgIGlmICghc2lsZW50KSB7XG4gICAgICAgICAgICBzdGF0ZS5ib3RzTG9hZGVkID0gZmFsc2U7XG4gICAgICAgICAgICByZW5kZXJCb3RzU2tlbGV0b24oKTtcbiAgICAgICAgfVxuICAgICAgICBhcGlHZXQoJy9ib3RzJywgeyBsaW1pdDogMjAwIH0sIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICBzdGF0ZS5ib3RzID0gZGF0YS5pdGVtcyB8fCBbXTtcbiAgICAgICAgICAgIHN0YXRlLmJvdHNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc3RhdGUuYm90c0Vycm9yID0gbnVsbDtcbiAgICAgICAgICAgIHJlbmRlckJvdHMoKTtcbiAgICAgICAgICAgIHJlbmRlclJ1bGVzKCk7XG4gICAgICAgICAgICByZW5kZXJKb3VybmFsQmFubmVyKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICBzdGF0ZS5ib3RzTG9hZGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIHN0YXRlLmJvdHNFcnJvciA9IGZhaWx1cmU7XG4gICAgICAgICAgICByZW5kZXJCb3RzKCk7XG4gICAgICAgICAgICByZW5kZXJSdWxlcygpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJCb3RzU2tlbGV0b24oKSB7XG4gICAgICAgIHZhciBjYXJkID0gJzxkaXYgY2xhc3M9XCJtaC1ib3QtY2FyZCBtaC1ib3Qtc2tlbGV0b25cIj48c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjMycHg7aGVpZ2h0OjMycHg7Ym9yZGVyLXJhZGl1czo4cHhcIj48L3NwYW4+J1xuICAgICAgICAgICAgKyAnPGRpdiBzdHlsZT1cImZsZXg6MTtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDo2cHhcIj48c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjUwJVwiPjwvc3Bhbj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjMwJTtoZWlnaHQ6OHB4XCI+PC9zcGFuPjwvZGl2PjwvZGl2Pic7XG4gICAgICAgICQoJyNtaC1ib3RzJykuaHRtbChjYXJkICsgY2FyZCk7XG4gICAgfVxuXG4gICAgLy8gVGVsZWdyYW0gLyBNQVggdGlsZXM6IHRoZSBmaXJzdC1ydW4gc2NyZWVuIGFuZCDCq9Cd0LDRgdGC0YDQvtC50LrQuMK7IHdpdGhvdXQgYm90cyAoZGVzaWduIHYzKS5cbiAgICBmdW5jdGlvbiBtZXNzZW5nZXJUaWxlcygpIHtcbiAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwibWgtbWVzc2VuZ2VyLXRpbGVzXCI+J1xuICAgICAgICAgICAgKyAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJtaC1zY2VuYXJpbyBtaC10aWxlXCIgZGF0YS1hY3Rpb249XCJhZGQtYm90XCIgZGF0YS1jaGFubmVsPVwidGVsZWdyYW1cIj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1lc3NlbmdlciB0Z1wiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPlRHPC9zcGFuPjxiPlRlbGVncmFtPC9iPjwvYnV0dG9uPidcbiAgICAgICAgICAgICsgJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwibWgtc2NlbmFyaW8gbWgtdGlsZVwiIGRhdGEtYWN0aW9uPVwiYWRkLWJvdFwiIGRhdGEtY2hhbm5lbD1cIm1heFwiPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyIG1heFwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPk1BWDwvc3Bhbj48Yj5NQVg8L2I+PC9idXR0b24+J1xuICAgICAgICAgICAgKyAnPC9kaXY+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJCb3RzKCkge1xuICAgICAgICB2YXIgJHdyYXAgPSAkKCcjbWgtYm90cycpO1xuICAgICAgICBpZiAoc3RhdGUuYm90c0Vycm9yICE9PSBudWxsICYmIHN0YXRlLmJvdHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAkKCcjbWgtYm90LWFkZCcpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJHdyYXAuaHRtbCgnPGRpdiBjbGFzcz1cInVpIG5lZ2F0aXZlIG1lc3NhZ2VcIiByb2xlPVwiYWxlcnRcIj4nICsgSUNPTl9FUlJPUlxuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ncm93XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RzTG9hZEZhaWxlZCcpKSArICc8L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAnPGJ1dHRvbiBjbGFzcz1cInVpIGJhc2ljIGJ1dHRvbiBtaC1vbi1tZXNzYWdlXCIgdHlwZT1cImJ1dHRvblwiIGlkPVwibWgtYm90cy1yZXRyeVwiPidcbiAgICAgICAgICAgICAgICArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25SZXRyeScpKSArICc8L2J1dHRvbj48L2Rpdj4nKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3RzLXJldHJ5Jykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkgeyBsb2FkQm90cygpOyB9KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXN0YXRlLmJvdHNMb2FkZWQpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtYm90LWFkZCcpLmF0dHIoJ2hpZGRlbicsIHN0YXRlLmJvdHMubGVuZ3RoID4gMCA/IG51bGwgOiB0cnVlKTtcbiAgICAgICAgaWYgKHN0YXRlLmJvdHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAkd3JhcC5odG1sKG1lc3NlbmdlclRpbGVzKCkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBodG1sID0gJzxkaXYgY2xhc3M9XCJtaC1ib3QtbGlzdFwiPic7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUuYm90cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaHRtbCArPSByZW5kZXJCb3RDYXJkKHN0YXRlLmJvdHNbaV0pO1xuICAgICAgICB9XG4gICAgICAgICR3cmFwLmh0bWwoaHRtbCArICc8L2Rpdj4nKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJCb3RDYXJkKGJvdCkge1xuICAgICAgICB2YXIgZXhwYW5kZWQgPSBzdGF0ZS5leHBhbmRlZEJvdHNbYm90LmlkXSA9PT0gdHJ1ZTtcbiAgICAgICAgdmFyIGJvZHkgPSAnJztcbiAgICAgICAgaWYgKGV4cGFuZGVkKSB7XG4gICAgICAgICAgICBib2R5ID0gJzxkaXYgY2xhc3M9XCJtaC1ib3QtYm9keVwiPicgKyByZW5kZXJCb3RUbHNXYXJuaW5nKGJvdCkgKyByZW5kZXJCb3RDaGF0cyhib3QpICsgcmVuZGVyQm90QWN0aW9ucyhib3QpICsgJzwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGNoYXRDb3VudCA9IChib3QuY2hhdHMgfHwgW10pLmxlbmd0aDtcbiAgICAgICAgdmFyIG1ldGEgPSBbXTtcbiAgICAgICAgaWYgKGJvdC5ib3RfdXNlcm5hbWUpIHsgbWV0YS5wdXNoKCdAJyArIGJvdC5ib3RfdXNlcm5hbWUpOyB9XG4gICAgICAgIG1ldGEucHVzaChjaGF0Q291bnQgPiAwID8gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoYXRzQ291bnQnLCB7IGNvdW50OiBjaGF0Q291bnQgfSkgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGF0c05vbmUnKSk7XG4gICAgICAgIHJldHVybiAnPGRpdiBjbGFzcz1cIm1oLWJvdC1yb3cnICsgKGV4cGFuZGVkID8gJyBpcy1vcGVuJyA6ICcnKSArICdcIiBkYXRhLWJvdC1pZD1cIicgKyBib3QuaWQgKyAnXCI+J1xuICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLWJvdC1oZWFkXCIgZGF0YS1hY3Rpb249XCJ0b2dnbGVcIiByb2xlPVwiYnV0dG9uXCIgdGFiaW5kZXg9XCIwXCIgYXJpYS1leHBhbmRlZD1cIicgKyAoZXhwYW5kZWQgPyAndHJ1ZScgOiAnZmFsc2UnKSArICdcIj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1lc3NlbmdlciAnICsgKGJvdC5jaGFubmVsID09PSAnbWF4JyA/ICdtYXgnIDogJ3RnJykgKyAnXCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+JyArIChib3QuY2hhbm5lbCA9PT0gJ21heCcgPyAnTUFYJyA6ICdURycpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtYm90LXRpdGxlc1wiPjxiIGNsYXNzPVwibWgtdHJ1bmNhdGVcIj4nICsgZXNjKGJvdC50aXRsZSkgKyAnPC9iPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWV0YSBtaC10cnVuY2F0ZVwiPicgKyBlc2MobWV0YS5qb2luKCcgwrcgJykpICsgJzwvc3Bhbj48L2Rpdj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWJvdC1zdGF0dXNcIj4nICsgYm90U3RhdHVzQ2VsbChib3QpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWNoZXZyb25cIiBhcmlhLWhpZGRlbj1cInRydWVcIj4nXG4gICAgICAgICAgICArICc8c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBzdHlsZT1cInRyYW5zZm9ybTpyb3RhdGUoJyArIChleHBhbmRlZCA/ICcxODAnIDogJzAnKSArICdkZWcpXCI+PHBhdGggZD1cIk0zLjUgNkw4IDEwLjUgMTIuNSA2XCIvPjwvc3ZnPidcbiAgICAgICAgICAgICsgJzwvc3Bhbj48L2Rpdj4nICsgYm9keSArICc8L2Rpdj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJvdFN0YXR1c0NlbGwoYm90KSB7XG4gICAgICAgIGlmIChib3QuZW5hYmxlZCA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1kb3RcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c0Rpc2FibGVkJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmIChib3Quc3RhdHVzID09PSAnb2snKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwibWgtZG90IGlzLW9rXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTdGF0dXNPaycpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYm90LnN0YXR1cyA9PT0gJ3Rva2VuX2ludmFsaWQnKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTdGF0dXNUb2tlbkludmFsaWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICdjYV9lcnJvcicpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c0NhRXJyb3InKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICdlcnJvcicpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSB5ZWxsb3cgbGFiZWxcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c0NoZWNrRmFpbGVkJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1kb3RcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c05ldycpKSArICc8L3NwYW4+JztcbiAgICB9XG5cbiAgICAvLyBUaGUgTUFYIEFQSSBpcyBzaWduZWQgYnkgdGhlINCc0LjQvdGG0LjRhNGA0Ysgcm9vdCBDQTogYSB0cnVzdCBmYWlsdXJlIGlzIGEgY29uZmlndXJhdGlvbiBwcm9ibGVtLCBub3QgYVxuICAgIC8vIHRva2VuIHByb2JsZW0sIHNvIGl0IGdldHMgaXRzIG93biBleHBsYW5hdGlvbiBhbmQgcG9pbnRzIHRvIHRoZSBzZXR0aW5ncyBmaWVsZC5cbiAgICBmdW5jdGlvbiByZW5kZXJCb3RUbHNXYXJuaW5nKGJvdCkge1xuICAgICAgICBpZiAoYm90LnN0YXR1cyAhPT0gJ2NhX2Vycm9yJyAmJiAhaXNNYXhUbHNDb2RlKGJvdC5sYXN0X2Vycm9yX2NvZGUpKSB7XG4gICAgICAgICAgICByZXR1cm4gJyc7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwidWkgd2FybmluZyBtZXNzYWdlXCIgcm9sZT1cIm5vdGVcIj4nXG4gICAgICAgICAgICArICc8c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBhcmlhLWhpZGRlbj1cInRydWVcIj48Y2lyY2xlIGN4PVwiOFwiIGN5PVwiOFwiIHI9XCI2LjI1XCIvPjxwYXRoIGQ9XCJNOCA0LjV2NE04IDExaC4wMVwiLz48L3N2Zz4nXG4gICAgICAgICAgICArICc8ZGl2PicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzQ2FFcnJvcicpKSArICcuICdcbiAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENhRXJyb3JIaW50JykpICsgJzwvZGl2PjwvZGl2Pic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2hhdEtpbmRMYWJlbChraW5kKSB7XG4gICAgICAgIGlmIChraW5kID09PSAncHJpdmF0ZScpIHsgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRUeXBlUHJpdmF0ZScpOyB9XG4gICAgICAgIGlmIChraW5kID09PSAnY2hhbm5lbCcpIHsgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRUeXBlQ2hhbm5lbCcpOyB9XG4gICAgICAgIHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0VHlwZUdyb3VwJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyQm90Q2hhdHMoYm90KSB7XG4gICAgICAgIHZhciBjaGF0cyA9IGJvdC5jaGF0cyB8fCBbXTtcbiAgICAgICAgaWYgKGNoYXRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwibWgtYm90LW5vY2hhdHMgbWgtbXV0ZWRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdE5vQ2hhdHNUaXRsZScpKSArICc8L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIHZhciBodG1sID0gJzxkaXYgY2xhc3M9XCJtaC1jaGF0LWxpc3RcIj4nO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNoYXRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBodG1sICs9IHJlbmRlckNoYXRSb3coYm90LCBjaGF0c1tpXSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGh0bWwgKyAnPC9kaXY+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJDaGF0Um93KGJvdCwgY2hhdCkge1xuICAgICAgICB2YXIgZ29uZSA9IGNoYXQuc3RhdGUgPT09ICdnb25lJztcbiAgICAgICAgdmFyIHN0YXRlQ2VsbDtcbiAgICAgICAgaWYgKGdvbmUpIHtcbiAgICAgICAgICAgIHN0YXRlQ2VsbCA9ICc8c3BhbiBjbGFzcz1cInVpIHJlZCBsYWJlbFwiIHRpdGxlPVwiJyArIGVzYyhjaGF0LmdvbmVfcmVhc29uKSArICdcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRTdGF0dXNHb25lJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9IGVsc2UgaWYgKGNoYXQubGFzdF9kZWxpdmVyeSAmJiBjaGF0Lmxhc3RfZGVsaXZlcnkuc3RhdHVzID09PSAnZmFpbGVkJykge1xuICAgICAgICAgICAgc3RhdGVDZWxsID0gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0U3RhdHVzRXJyb3InKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBzdGF0ZUNlbGwgPSAnPHNwYW4gY2xhc3M9XCJtaC1kb3QgaXMtb2tcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRTdGF0dXNPaycpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJtaC1jaGF0LXJvd1wiIGRhdGEtY2hhdC1pZD1cIicgKyBjaGF0LmlkICsgJ1wiPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtY2hhdC10aXRsZVwiPjxzcGFuIGNsYXNzPVwibWgtdHJ1bmNhdGVcIj4nICsgZXNjKGNoYXQudGl0bGUgfHwgY2hhdC5jaGF0X2lkKSArICc8L3NwYW4+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tZXRhXCI+IMK3ICcgKyBlc2MoY2hhdEtpbmRMYWJlbChjaGF0LmNoYXRfa2luZCkpICsgJzwvc3Bhbj48L3NwYW4+J1xuICAgICAgICAgICAgKyBlbXBsb3llZVNlbGVjdChjaGF0KVxuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1jaGF0LXN0YXRlXCI+JyArIHN0YXRlQ2VsbCArICc8L3NwYW4+J1xuICAgICAgICAgICAgKyAnPGxhYmVsIGNsYXNzPVwidWkgdG9nZ2xlIGNoZWNrYm94JyArIChjaGF0LmVuYWJsZWQgPyAnIGNoZWNrZWQnIDogJycpICsgKGdvbmUgPyAnIGRpc2FibGVkJyA6ICcnKSArICdcIiBhcmlhLWxhYmVsPVwiJyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RFbmFibGVDaGF0JykpICsgJ1wiPidcbiAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjbGFzcz1cImhpZGRlbiBtaC1jaGF0LXRvZ2dsZVwiJyArIChjaGF0LmVuYWJsZWQgPyAnIGNoZWNrZWQnIDogJycpICsgKGdvbmUgPyAnIGRpc2FibGVkJyA6ICcnKSArICc+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC10cmFja1wiPjwvc3Bhbj48L2xhYmVsPidcbiAgICAgICAgICAgICsgJzwvZGl2Pic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZW1wbG95ZWVTZWxlY3QoY2hhdCkge1xuICAgICAgICB2YXIgb3B0aW9ucyA9ICc8b3B0aW9uIHZhbHVlPVwiMFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdE5vRW1wbG95ZWUnKSkgKyAnPC9vcHRpb24+JztcbiAgICAgICAgdmFyIGZvdW5kID0gZmFsc2U7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUuZW1wbG95ZWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgZW1wbG95ZWUgPSBzdGF0ZS5lbXBsb3llZXNbaV07XG4gICAgICAgICAgICB2YXIgc2VsZWN0ZWQgPSBOdW1iZXIoZW1wbG95ZWUuaWQpID09PSBOdW1iZXIoY2hhdC5saW5rZWRfdXNlcl9pZCk7XG4gICAgICAgICAgICBpZiAoc2VsZWN0ZWQpIHsgZm91bmQgPSB0cnVlOyB9XG4gICAgICAgICAgICBvcHRpb25zICs9ICc8b3B0aW9uIHZhbHVlPVwiJyArIGVtcGxveWVlLmlkICsgJ1wiJyArIChzZWxlY3RlZCA/ICcgc2VsZWN0ZWQnIDogJycpICsgJz4nICsgZXNjKGVtcGxveWVlLmxhYmVsKSArICc8L29wdGlvbj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmICghZm91bmQgJiYgTnVtYmVyKGNoYXQubGlua2VkX3VzZXJfaWQpID4gMCkge1xuICAgICAgICAgICAgb3B0aW9ucyArPSAnPG9wdGlvbiB2YWx1ZT1cIicgKyBjaGF0LmxpbmtlZF91c2VyX2lkICsgJ1wiIHNlbGVjdGVkPiMnICsgY2hhdC5saW5rZWRfdXNlcl9pZCArICc8L29wdGlvbj4nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnPHNlbGVjdCBjbGFzcz1cIm1oLWVtcGxveWVlLXNlbGVjdFwiIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRFbXBsb3llZScpKSArICdcIj4nICsgb3B0aW9ucyArICc8L3NlbGVjdD4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdEFjdGlvbnMoYm90KSB7XG4gICAgICAgIHJldHVybiAnPGRpdiBjbGFzcz1cIm1oLWJvdC1hY3Rpb25zXCI+J1xuICAgICAgICAgICAgKyAnPGEgaHJlZj1cIiNcIiBkYXRhLWFjdGlvbj1cImNvbm5lY3RcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdEFjdGlvbnNDb25uZWN0JykpICsgJzwvYT4nXG4gICAgICAgICAgICArICc8YSBocmVmPVwiI1wiIGRhdGEtYWN0aW9uPVwidGVzdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90QWN0aW9uc1Rlc3QnKSkgKyAnPC9hPidcbiAgICAgICAgICAgICsgJzxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJlZGl0XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RBY3Rpb25zRWRpdCcpKSArICc8L2E+J1xuICAgICAgICAgICAgKyAnPC9kaXY+JztcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGJvdHM6IGRlbGVnYXRlZCBhY3Rpb25zIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGJpbmRCb3RzQ29udGFpbmVyKCkge1xuICAgICAgICB2YXIgJHdyYXAgPSAkKCcjbWgtYm90cycpO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwidG9nZ2xlXCJdJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGlkID0gU3RyaW5nKCQodGhpcykuY2xvc2VzdCgnLm1oLWJvdC1yb3cnKS5kYXRhKCdib3QtaWQnKSk7XG4gICAgICAgICAgICBzdGF0ZS5leHBhbmRlZEJvdHNbaWRdID0gc3RhdGUuZXhwYW5kZWRCb3RzW2lkXSAhPT0gdHJ1ZTtcbiAgICAgICAgICAgIHJlbmRlckJvdHMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdrZXlkb3duJywgJ1tkYXRhLWFjdGlvbj1cInRvZ2dsZVwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgaWYgKGV2ZW50LmtleSA9PT0gJ0VudGVyJyB8fCBldmVudC5rZXkgPT09ICcgJykge1xuICAgICAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICAgICAgJCh0aGlzKS50cmlnZ2VyKCdjbGljaycpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImFkZC1ib3RcIl0nLCBmdW5jdGlvbiAoKSB7IG9wZW5Cb3RNb2RhbCgnYWRkJywgbnVsbCwgJCh0aGlzKS5kYXRhKCdjaGFubmVsJykpOyB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImNvbm5lY3RcIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBvcGVuQ2hhdE1vZGFsKGJvdEJ5SWQoJCh0aGlzKS5jbG9zZXN0KCcubWgtYm90LXJvdycpLmRhdGEoJ2JvdC1pZCcpKSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwidGVzdFwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIG9wZW5UZXN0TW9kYWwoYm90QnlJZCgkKHRoaXMpLmNsb3Nlc3QoJy5taC1ib3Qtcm93JykuZGF0YSgnYm90LWlkJykpLCBudWxsKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJlZGl0XCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgb3BlbkJvdE1vZGFsKCdlZGl0JywgYm90QnlJZCgkKHRoaXMpLmNsb3Nlc3QoJy5taC1ib3Qtcm93JykuZGF0YSgnYm90LWlkJykpKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjaGFuZ2UnLCAnLm1oLWNoYXQtdG9nZ2xlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGJvdElkID0gJCh0aGlzKS5jbG9zZXN0KCcubWgtYm90LXJvdycpLmRhdGEoJ2JvdC1pZCcpO1xuICAgICAgICAgICAgdmFyIGNoYXRJZCA9ICQodGhpcykuY2xvc2VzdCgnLm1oLWNoYXQtcm93JykuZGF0YSgnY2hhdC1pZCcpO1xuICAgICAgICAgICAgdmFyIGVuYWJsZWQgPSAkKHRoaXMpLnByb3AoJ2NoZWNrZWQnKTtcbiAgICAgICAgICAgIHBhdGNoQm90KGJvdElkLCB7IGNoYXRzOiBbeyBpZDogTnVtYmVyKGNoYXRJZCksIGVuYWJsZWQ6IGVuYWJsZWQgfV0gfSwgbnVsbCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25TYXZlRmFpbGVkJykpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2hhbmdlJywgJy5taC1lbXBsb3llZS1zZWxlY3QnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgYm90SWQgPSAkKHRoaXMpLmNsb3Nlc3QoJy5taC1ib3Qtcm93JykuZGF0YSgnYm90LWlkJyk7XG4gICAgICAgICAgICB2YXIgY2hhdElkID0gJCh0aGlzKS5jbG9zZXN0KCcubWgtY2hhdC1yb3cnKS5kYXRhKCdjaGF0LWlkJyk7XG4gICAgICAgICAgICBwYXRjaEJvdChib3RJZCwgeyBjaGF0czogW3sgaWQ6IE51bWJlcihjaGF0SWQpLCBsaW5rZWRfdXNlcl9pZDogTnVtYmVyKCQodGhpcykudmFsKCkpIH1dIH0sIG51bGwsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZUZhaWxlZCcpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBwYXRjaEJvdChib3RJZCwgcGF5bG9hZCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpIHtcbiAgICAgICAgYXBpUGF0Y2goJy9ib3RzLycgKyBib3RJZCwgcGF5bG9hZCwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgcmVwbGFjZUJvdChib3QpO1xuICAgICAgICAgICAgcmVuZGVyQm90cygpO1xuICAgICAgICAgICAgaWYgKG9uU3VjY2VzcykgeyBvblN1Y2Nlc3MoYm90KTsgfVxuICAgICAgICB9LCBvbkZhaWx1cmUgfHwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgIHNob3dUb2FzdChmYWlsdXJlVGV4dChmYWlsdXJlKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gZW1wbG95ZWVzIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGxvYWRFbXBsb3llZXMoZG9uZSkge1xuICAgICAgICBpZiAoc3RhdGUuZW1wbG95ZWVzTG9hZGVkKSB7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29yZUdldCgnL2V4dGVuc2lvbnMnLCB7IGxpbWl0OiA1MDAgfSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHZhciBpdGVtcyA9IGRhdGEuaXRlbXMgfHwgW107XG4gICAgICAgICAgICB2YXIgc2VlbiA9IHt9O1xuICAgICAgICAgICAgdmFyIGxpc3QgPSBbXTtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaXRlbXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICB2YXIgaXRlbSA9IGl0ZW1zW2ldO1xuICAgICAgICAgICAgICAgIHZhciB1c2VySWQgPSBOdW1iZXIoaXRlbS51c2VyaWQpO1xuICAgICAgICAgICAgICAgIGlmICghdXNlcklkIHx8IHNlZW5bdXNlcklkXSkge1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgc2Vlblt1c2VySWRdID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB2YXIgbmFtZSA9IGl0ZW0uY2FsbGVyaWQgfHwgaXRlbS5udW1iZXIgfHwgKCcjJyArIHVzZXJJZCk7XG4gICAgICAgICAgICAgICAgdmFyIG51bWJlciA9IGl0ZW0ubnVtYmVyID8gU3RyaW5nKGl0ZW0ubnVtYmVyKSA6ICcnO1xuICAgICAgICAgICAgICAgIHZhciBsYWJlbCA9IChudW1iZXIgIT09ICcnICYmIFN0cmluZyhuYW1lKS5pbmRleE9mKG51bWJlcikgPT09IC0xKSA/IG5hbWUgKyAnICgnICsgbnVtYmVyICsgJyknIDogbmFtZTtcbiAgICAgICAgICAgICAgICBsaXN0LnB1c2goeyBpZDogdXNlcklkLCBsYWJlbDogbGFiZWwgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBsaXN0LnNvcnQoZnVuY3Rpb24gKGEsIGIpIHsgcmV0dXJuIGEubGFiZWwubG9jYWxlQ29tcGFyZShiLmxhYmVsKTsgfSk7XG4gICAgICAgICAgICBzdGF0ZS5lbXBsb3llZXMgPSBsaXN0O1xuICAgICAgICAgICAgc3RhdGUuZW1wbG95ZWVzTG9hZGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIHN0YXRlLmVtcGxveWVlc0ZhaWxlZCA9IGZhbHNlO1xuICAgICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5lbXBsb3llZXNMb2FkZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIHN0YXRlLmVtcGxveWVlc0ZhaWxlZCA9IHRydWU7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gYm90IG1vZGFsIC0tLS0tLS0tLS1cblxuICAgIC8vIENoYW5uZWxzIHdpdGggYSBiYWNrZW5kIGFkYXB0ZXIgKGJvdGggaGF2ZSBvbmUgc2luY2Ugc3RhZ2UgM2IvM2MpLiBUaGUgY2hlY2tzIGJlbG93IHN0YXkgYXMgYVxuICAgIC8vIGd1YXJkOiBhIGNoYW5uZWwgd2l0aG91dCBhbiBhZGFwdGVyIG9uIHRoZSBzZXJ2ZXIgbXVzdCBub3QgYmUgc2F2ZWQgZnJvbSBhIHN0YWxlIHBhZ2UuXG4gICAgdmFyIFNBVkFCTEVfQ0hBTk5FTFMgPSBbJ3RlbGVncmFtJywgJ21heCddO1xuXG4gICAgZnVuY3Rpb24gb3BlbkJvdE1vZGFsKG1vZGUsIGJvdCwgY2hhbm5lbCkge1xuICAgICAgICBzdGF0ZS5ib3RNb2RhbCA9IHtcbiAgICAgICAgICAgIG1vZGU6IG1vZGUsXG4gICAgICAgICAgICBib3Q6IGJvdCxcbiAgICAgICAgICAgIGNoYW5uZWw6IG1vZGUgPT09ICdlZGl0JyAmJiBib3QgPyAoYm90LmNoYW5uZWwgfHwgJ3RlbGVncmFtJykgOiAoY2hhbm5lbCA9PT0gJ21heCcgPyAnbWF4JyA6ICd0ZWxlZ3JhbScpLFxuICAgICAgICAgICAgZHJhZnRJZDogMCxcbiAgICAgICAgICAgIHNhdmVkOiBmYWxzZSxcbiAgICAgICAgICAgIHRva2VuQ2hhbmdlZDogZmFsc2UsXG4gICAgICAgICAgICBidXN5OiBmYWxzZVxuICAgICAgICB9O1xuICAgICAgICAkKCcjbWgtYm90LWNoZWNrLW1lc3NhZ2UnKS5lbXB0eSgpO1xuICAgICAgICAkKCcjbWgtYm90LXRpdGxlLWZpZWxkJykucmVtb3ZlQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4tcm93JykucmVtb3ZlQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICQoJyNtaC1ib3QtbW9kYWwtdGl0bGUnKS50ZXh0KG1vZGUgPT09ICdlZGl0JyA/IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RFZGl0VGl0bGUnLCB7IHRpdGxlOiBib3QudGl0bGUgfSkgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RBZGRUaXRsZScpKTtcbiAgICAgICAgJCgnI21oLWJvdC10aXRsZScpLnZhbChib3QgPyBib3QudGl0bGUgOiAnJyk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4nKS52YWwoJycpO1xuICAgICAgICAkKCcjbWgtYm90LXRva2VuLW5ldycpLnZhbCgnJyk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4tbmV3LXJvdycpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAkKCcjbWgtYm90LWRlbGV0ZScpLmF0dHIoJ2hpZGRlbicsIG1vZGUgPT09ICdlZGl0JyA/IG51bGwgOiB0cnVlKTtcbiAgICAgICAgJCgnI21oLWJvdC1zYXZlJykudGV4dChtb2RlID09PSAnZWRpdCcgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTYXZlJykgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTYXZlQW5kQ29ubmVjdCcpKTtcbiAgICAgICAgaWYgKG1vZGUgPT09ICdlZGl0Jykge1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1yb3cnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4taGludC1yb3cnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4taGludCcpLnRleHQoJ+KAouKAouKAouKAoicgKyAoYm90LnRva2VuX2hpbnQgfHwgJycpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4tcm93JykucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRva2VuLWhpbnQtcm93JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgIH1cbiAgICAgICAgc3luY0JvdENoYW5uZWwoKTtcbiAgICAgICAgJCgnI21oLWJvdC1tb2RhbCcpLm1vZGFsKHsgY2xvc2FibGU6IGZhbHNlIH0pLm1vZGFsKCdzaG93Jyk7XG4gICAgICAgICQoJyNtaC1ib3QtdGl0bGUnKS50cmlnZ2VyKCdmb2N1cycpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHN5bmNCb3RDaGFubmVsKCkge1xuICAgICAgICB2YXIgbW9kYWwgPSBzdGF0ZS5ib3RNb2RhbDtcbiAgICAgICAgaWYgKCFtb2RhbCkgeyByZXR1cm47IH1cbiAgICAgICAgJCgnI21oLWJvdC1tb2RhbCAubWgtY2hhbm5lbC1jYXJkJykuZWFjaChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgY2hhbm5lbCA9IFN0cmluZygkKHRoaXMpLmRhdGEoJ2NoYW5uZWwnKSk7XG4gICAgICAgICAgICB2YXIgc2VsZWN0ZWQgPSBjaGFubmVsID09PSBtb2RhbC5jaGFubmVsO1xuICAgICAgICAgICAgdmFyIGxvY2tlZCA9IG1vZGFsLm1vZGUgPT09ICdlZGl0JyAmJiAhc2VsZWN0ZWQ7XG4gICAgICAgICAgICAkKHRoaXMpLnRvZ2dsZUNsYXNzKCdpcy1zZWxlY3RlZCcsIHNlbGVjdGVkKS50b2dnbGVDbGFzcygnaXMtZGlzYWJsZWQnLCBsb2NrZWQpXG4gICAgICAgICAgICAgICAgLmF0dHIoJ2FyaWEtZGlzYWJsZWQnLCBsb2NrZWQgPyAndHJ1ZScgOiBudWxsKTtcbiAgICAgICAgICAgICQodGhpcykuZmluZCgnaW5wdXQnKS5wcm9wKCdjaGVja2VkJywgc2VsZWN0ZWQpLnByb3AoJ2Rpc2FibGVkJywgbG9ja2VkKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHZhciBzYXZhYmxlID0gU0FWQUJMRV9DSEFOTkVMUy5pbmRleE9mKG1vZGFsLmNoYW5uZWwpID49IDA7XG4gICAgICAgICQoJyNtaC1ib3Qtc2F2ZSwgI21oLWJvdC1jaGVjaycpLnByb3AoJ2Rpc2FibGVkJywgIXNhdmFibGUpLnRvZ2dsZUNsYXNzKCdkaXNhYmxlZCcsICFzYXZhYmxlKTtcbiAgICAgICAgLy8gYSBNQVggdG9rZW4gY29tZXMgZnJvbSBidXNpbmVzcy5tYXgucnUgYWZ0ZXIgbW9kZXJhdGlvbjsgVGVsZWdyYW0gbmVlZHMgbm8gZXhwbGFuYXRpb25cbiAgICAgICAgdmFyIG1heEhlbHAgPSBtb2RhbC5jaGFubmVsID09PSAnbWF4JztcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbi1oZWxwJykudGV4dChtYXhIZWxwID8gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90VG9rZW5IZWxwTWF4JykgOiAnJyk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4taGVscC1yb3cnKS5hdHRyKCdoaWRkZW4nLCBtYXhIZWxwID8gbnVsbCA6IHRydWUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGlzTWF4VGxzQ29kZShjb2RlKSB7XG4gICAgICAgIHJldHVybiBTdHJpbmcoY29kZSB8fCAnJykuaW5kZXhPZignbWF4LnRscy4nKSA9PT0gMDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB0bHNFcnJvclRleHQoKSB7XG4gICAgICAgIHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTdGF0dXNDYUVycm9yJykgKyAnLiAnICsgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2FFcnJvckhpbnQnKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBib3RGb3JtVmFsdWVzKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdGl0bGU6IFN0cmluZygkKCcjbWgtYm90LXRpdGxlJykudmFsKCkgfHwgJycpLnRyaW0oKSxcbiAgICAgICAgICAgIHRva2VuOiBTdHJpbmcoJCgnI21oLWJvdC10b2tlbicpLnZhbCgpIHx8ICcnKS50cmltKCksXG4gICAgICAgICAgICB0b2tlbk5ldzogU3RyaW5nKCQoJyNtaC1ib3QtdG9rZW4tbmV3JykudmFsKCkgfHwgJycpLnRyaW0oKVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNob3dCb3RNZXNzYWdlKGtpbmQsIHRleHQpIHtcbiAgICAgICAgdmFyIGNscyA9IGtpbmQgPT09ICdvaycgPyAndWkgcG9zaXRpdmUgbWVzc2FnZScgOiAoa2luZCA9PT0gJ3dhcm4nID8gJ3VpIHdhcm5pbmcgbWVzc2FnZScgOiAndWkgbmVnYXRpdmUgbWVzc2FnZScpO1xuICAgICAgICB2YXIgaWNvbiA9IGtpbmQgPT09ICdvaydcbiAgICAgICAgICAgID8gJzxjaXJjbGUgY3g9XCI4XCIgY3k9XCI4XCIgcj1cIjYuMjVcIi8+PHBhdGggZD1cIk01LjUgOC4ybDEuOCAxLjggMy4zLTMuNlwiLz4nXG4gICAgICAgICAgICA6ICc8Y2lyY2xlIGN4PVwiOFwiIGN5PVwiOFwiIHI9XCI2LjI1XCIvPjxwYXRoIGQ9XCJNNiA2bDQgNE0xMCA2bC00IDRcIi8+JztcbiAgICAgICAgJCgnI21oLWJvdC1jaGVjay1tZXNzYWdlJykuaHRtbCgnPGRpdiBjbGFzcz1cIicgKyBjbHMgKyAnXCIgcm9sZT1cInN0YXR1c1wiPidcbiAgICAgICAgICAgICsgJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPicgKyBpY29uICsgJzwvc3ZnPidcbiAgICAgICAgICAgICsgJzxkaXY+JyArIGVzYyh0ZXh0KSArICc8L2Rpdj48L2Rpdj4nKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBib3RDaGVja01lc3NhZ2UoYm90KSB7XG4gICAgICAgIGlmIChib3Quc3RhdHVzID09PSAnb2snKSB7XG4gICAgICAgICAgICByZXR1cm4geyBraW5kOiAnb2snLCB0ZXh0OiB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZE9rJywge1xuICAgICAgICAgICAgICAgIHVzZXJuYW1lOiBib3QuYm90X3VzZXJuYW1lIHx8IGJvdC5ib3RfZXh0ZXJuYWxfaWQsXG4gICAgICAgICAgICAgICAgbmFtZTogYm90LmJvdF91c2VybmFtZSA/ICdAJyArIGJvdC5ib3RfdXNlcm5hbWUgOiBib3QudGl0bGVcbiAgICAgICAgICAgIH0pIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5sYXN0X2Vycm9yX2NvZGUgPT09ICdvdGhlcl9ib3QnKSB7XG4gICAgICAgICAgICByZXR1cm4geyBraW5kOiAnd2FybicsIHRleHQ6IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkT3RoZXInLCB7XG4gICAgICAgICAgICAgICAgdXNlcm5hbWU6IGJvdC5ib3RfdXNlcm5hbWUgfHwgJycsXG4gICAgICAgICAgICAgICAgYm90OiBib3QudGl0bGVcbiAgICAgICAgICAgIH0pIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICd0b2tlbl9pbnZhbGlkJykge1xuICAgICAgICAgICAgcmV0dXJuIHsga2luZDogJ2VycicsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrZWQ0MDEnKSB9O1xuICAgICAgICB9XG4gICAgICAgIGlmIChib3Quc3RhdHVzID09PSAnY2FfZXJyb3InIHx8IGlzTWF4VGxzQ29kZShib3QubGFzdF9lcnJvcl9jb2RlKSkge1xuICAgICAgICAgICAgcmV0dXJuIHsga2luZDogJ2VycicsIHRleHQ6IHRsc0Vycm9yVGV4dCgpIH07XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHsga2luZDogJ3dhcm4nLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja05ldHdvcmsnKSArIChib3QubGFzdF9lcnJvcl9jb2RlID8gJyAoJyArIGJvdC5sYXN0X2Vycm9yX2NvZGUgKyAnKScgOiAnJykgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjaGVja0JvdEZvcm0oKSB7XG4gICAgICAgIGlmICghc3RhdGUuYm90TW9kYWwgfHwgU0FWQUJMRV9DSEFOTkVMUy5pbmRleE9mKHN0YXRlLmJvdE1vZGFsLmNoYW5uZWwpIDwgMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciB2YWx1ZXMgPSBib3RGb3JtVmFsdWVzKCk7XG4gICAgICAgIGlmICh2YWx1ZXMudGl0bGUgPT09ICcnKSB7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRpdGxlLWZpZWxkJykuYWRkQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90VGl0bGVSZXF1aXJlZCcpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtYm90LXRpdGxlLWZpZWxkJykucmVtb3ZlQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgIHZhciBtb2RlID0gc3RhdGUuYm90TW9kYWwubW9kZTtcbiAgICAgICAgdmFyIHBheWxvYWQ7XG4gICAgICAgIHZhciBkb25lID0gZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgc3RhdGUuYm90TW9kYWwuYm90ID0gYm90O1xuICAgICAgICAgICAgc3RhdGUuYm90TW9kYWwuZHJhZnRJZCA9IGJvdC5pZDtcbiAgICAgICAgICAgIHJlcGxhY2VCb3QoYm90KTtcbiAgICAgICAgICAgIHZhciBtZXNzYWdlID0gYm90Q2hlY2tNZXNzYWdlKGJvdCk7XG4gICAgICAgICAgICBzaG93Qm90TWVzc2FnZShtZXNzYWdlLmtpbmQsIG1lc3NhZ2UudGV4dCk7XG4gICAgICAgIH07XG4gICAgICAgIHZhciBmYWlsdXJlID0gZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgaWYgKGVyci5maWVsZCA9PT0gJ3Rva2VuJykge1xuICAgICAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4tcm93JykuYWRkQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgZmFpbHVyZVRleHQoZXJyKSk7XG4gICAgICAgIH07XG4gICAgICAgIGlmIChtb2RlID09PSAnYWRkJykge1xuICAgICAgICAgICAgcGF5bG9hZCA9IHsgY2hhbm5lbDogc3RhdGUuYm90TW9kYWwuY2hhbm5lbCwgdGl0bGU6IHZhbHVlcy50aXRsZSwgdG9rZW46IHZhbHVlcy50b2tlbiB9O1xuICAgICAgICAgICAgaWYgKHN0YXRlLmJvdE1vZGFsLmRyYWZ0SWQgPiAwKSB7XG4gICAgICAgICAgICAgICAgYXBpUGF0Y2goJy9ib3RzLycgKyBzdGF0ZS5ib3RNb2RhbC5kcmFmdElkLCB7IHRpdGxlOiB2YWx1ZXMudGl0bGUsIHRva2VuOiB2YWx1ZXMudG9rZW4gfSwgZG9uZSwgZmFpbHVyZSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGFwaVBvc3QoJy9ib3RzJywgcGF5bG9hZCwgZG9uZSwgZmFpbHVyZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHZhbHVlcy50b2tlbk5ldyAhPT0gJycpIHtcbiAgICAgICAgICAgIGFwaVBvc3QoJy9ib3RzLycgKyBzdGF0ZS5ib3RNb2RhbC5ib3QuaWQgKyAnOmNoZWNrVG9rZW4nLCB7IHRva2VuOiB2YWx1ZXMudG9rZW5OZXcgfSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgICAgICBpZiAoZGF0YS5vaykge1xuICAgICAgICAgICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnb2snLCB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZE9rJywge1xuICAgICAgICAgICAgICAgICAgICAgICAgdXNlcm5hbWU6IGRhdGEudXNlcm5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBkYXRhLmRpc3BsYXlfbmFtZVxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChkYXRhLmVycm9yX2NvZGUgPT09ICdvdGhlcl9ib3QnKSB7XG4gICAgICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCd3YXJuJywgdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrZWRPdGhlcicsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHVzZXJuYW1lOiBkYXRhLnVzZXJuYW1lIHx8ICcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgYm90OiBzdGF0ZS5ib3RNb2RhbC5ib3QudGl0bGVcbiAgICAgICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoZGF0YS5lcnJvcl9jb2RlID09PSAndGVsZWdyYW0uNDAxLnVuYXV0aG9yaXplZCcgfHwgZGF0YS5lcnJvcl9jb2RlID09PSAnbWF4LjQwMS51bmF1dGhvcml6ZWQnKSB7XG4gICAgICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkNDAxJykpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoaXNNYXhUbHNDb2RlKGRhdGEuZXJyb3JfY29kZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgc2hvd0JvdE1lc3NhZ2UoJ2VycicsIHRsc0Vycm9yVGV4dCgpKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnd2FybicsIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrTmV0d29yaycpICsgJyAoJyArIGRhdGEuZXJyb3JfY29kZSArICcpJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgZmFpbHVyZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIHN0YXRlLmJvdE1vZGFsLmJvdC5pZCArICc6Y2hlY2tUb2tlbicsIHt9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICBpZiAoZGF0YS5vaykge1xuICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdvaycsIHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkT2snLCB7XG4gICAgICAgICAgICAgICAgICAgIHVzZXJuYW1lOiBkYXRhLnVzZXJuYW1lLFxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBkYXRhLmRpc3BsYXlfbmFtZVxuICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoaXNNYXhUbHNDb2RlKGRhdGEuZXJyb3JfY29kZSkpIHtcbiAgICAgICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgdGxzRXJyb3JUZXh0KCkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZDQwMScpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSwgZmFpbHVyZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZUJvdEZvcm0oKSB7XG4gICAgICAgIGlmICghc3RhdGUuYm90TW9kYWwgfHwgU0FWQUJMRV9DSEFOTkVMUy5pbmRleE9mKHN0YXRlLmJvdE1vZGFsLmNoYW5uZWwpIDwgMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciB2YWx1ZXMgPSBib3RGb3JtVmFsdWVzKCk7XG4gICAgICAgIGlmICh2YWx1ZXMudGl0bGUgPT09ICcnKSB7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRpdGxlLWZpZWxkJykuYWRkQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90VGl0bGVSZXF1aXJlZCcpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB2YXIgbW9kZSA9IHN0YXRlLmJvdE1vZGFsLm1vZGU7XG4gICAgICAgIHZhciBmaW5pc2ggPSBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICBzdGF0ZS5ib3RNb2RhbC5zYXZlZCA9IHRydWU7XG4gICAgICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgICAgICAkKCcjbWgtYm90LW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICAgICAgaWYgKG1vZGUgPT09ICdhZGQnKSB7XG4gICAgICAgICAgICAgICAgb3BlbkNoYXRNb2RhbChib3QpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZWQnKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIHZhciBmYWlsdXJlID0gZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgaWYgKGVyci5maWVsZCA9PT0gJ3Rva2VuJykge1xuICAgICAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4tcm93JykuYWRkQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgZmFpbHVyZVRleHQoZXJyKSk7XG4gICAgICAgIH07XG4gICAgICAgIGlmIChtb2RlID09PSAnYWRkJykge1xuICAgICAgICAgICAgdmFyIGNyZWF0ZSA9IGZ1bmN0aW9uIChpZCkge1xuICAgICAgICAgICAgICAgIGFwaVBvc3QoJy9ib3RzLycgKyBpZCArICc6ZGlzY292ZXJDaGF0cycsIHt9LCBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICAgICAgICAgIGZpbmlzaChib3QpO1xuICAgICAgICAgICAgICAgIH0sIGZhaWx1cmUpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5ib3RNb2RhbC5kcmFmdElkID4gMCkge1xuICAgICAgICAgICAgICAgIGFwaVBhdGNoKCcvYm90cy8nICsgc3RhdGUuYm90TW9kYWwuZHJhZnRJZCwgeyB0aXRsZTogdmFsdWVzLnRpdGxlLCB0b2tlbjogdmFsdWVzLnRva2VuIH0sIGZ1bmN0aW9uIChib3QpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVwbGFjZUJvdChib3QpO1xuICAgICAgICAgICAgICAgICAgICBjcmVhdGUoYm90LmlkKTtcbiAgICAgICAgICAgICAgICB9LCBmYWlsdXJlKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgYXBpUG9zdCgnL2JvdHMnLCB7IGNoYW5uZWw6IHN0YXRlLmJvdE1vZGFsLmNoYW5uZWwsIHRpdGxlOiB2YWx1ZXMudGl0bGUsIHRva2VuOiB2YWx1ZXMudG9rZW4gfSwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgICAgICAgICAgICAgIGNyZWF0ZShib3QuaWQpO1xuICAgICAgICAgICAgICAgIH0sIGZhaWx1cmUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBwYXlsb2FkID0geyB0aXRsZTogdmFsdWVzLnRpdGxlIH07XG4gICAgICAgIGlmICh2YWx1ZXMudG9rZW5OZXcgIT09ICcnKSB7XG4gICAgICAgICAgICBwYXlsb2FkLnRva2VuID0gdmFsdWVzLnRva2VuTmV3O1xuICAgICAgICB9XG4gICAgICAgIGFwaVBhdGNoKCcvYm90cy8nICsgc3RhdGUuYm90TW9kYWwuYm90LmlkLCBwYXlsb2FkLCBmaW5pc2gsIGZhaWx1cmUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNhbmNlbEJvdE1vZGFsKCkge1xuICAgICAgICB2YXIgbW9kYWwgPSBzdGF0ZS5ib3RNb2RhbDtcbiAgICAgICAgc3RhdGUuYm90TW9kYWwgPSBudWxsO1xuICAgICAgICAkKCcjbWgtYm90LW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgaWYgKG1vZGFsICYmIG1vZGFsLmRyYWZ0SWQgPiAwICYmICFtb2RhbC5zYXZlZCkge1xuICAgICAgICAgICAgLy8gdGhlIFwi0J/RgNC+0LLQtdGA0LjRgtGMXCIgYnV0dG9uIGNyZWF0ZWQgdGhlIGRyYWZ0OiBjYW5jZWxsaW5nIG11c3Qgbm90IGxlYXZlIGl0IGJlaGluZFxuICAgICAgICAgICAgYXBpRGVsZXRlKCcvYm90cy8nICsgbW9kYWwuZHJhZnRJZCwgZnVuY3Rpb24gKCkgeyBsb2FkQm90cyh0cnVlKTsgfSwgZnVuY3Rpb24gKCkgeyBsb2FkQm90cyh0cnVlKTsgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNvbmZpcm1EZWxldGVCb3QoKSB7XG4gICAgICAgIHZhciBib3QgPSBzdGF0ZS5ib3RNb2RhbC5ib3Q7XG4gICAgICAgIGlmICghYm90KSB7IHJldHVybjsgfVxuICAgICAgICAkKCcjbWgtY29uZmlybS10ZXh0JykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90RGVsZXRlQ29uZmlybScsIHsgdGl0bGU6IGJvdC50aXRsZSwgY291bnQ6IChib3QuY2hhdHMgfHwgW10pLmxlbmd0aCB9KSk7XG4gICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsJykubW9kYWwoeyBjbG9zYWJsZTogdHJ1ZSB9KS5tb2RhbCgnc2hvdycpO1xuICAgICAgICAkKCcjbWgtY29uZmlybS1vaycpLm9mZignY2xpY2snKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtY29uZmlybS1tb2RhbCcpLm1vZGFsKCdoaWRlJyk7XG4gICAgICAgICAgICBhcGlEZWxldGUoJy9ib3RzLycgKyBib3QuaWQsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5ib3RNb2RhbC5zYXZlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgc3RhdGUuYm90TW9kYWwuZHJhZnRJZCA9IDA7XG4gICAgICAgICAgICAgICAgJCgnI21oLWJvdC1tb2RhbCcpLm1vZGFsKCdoaWRlJyk7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vbkRlbGV0ZWQnKSk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KGZhaWx1cmVUZXh0KGVycikpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gZGlzY292ZXJ5IG1vZGFsIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIG9wZW5DaGF0TW9kYWwoYm90KSB7XG4gICAgICAgIGlmICghYm90KSB7IHJldHVybjsgfVxuICAgICAgICBzdGF0ZS5jaGF0TW9kYWwgPSB7IGJvdElkOiBib3QuaWQsIGJvdDogYm90LCB0aW1lcjogbnVsbCwgc2VsZWN0ZWQ6IHt9IH07XG4gICAgICAgICQoJyNtaC1jaGF0LW1vZGFsLXRpdGxlJykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RUaXRsZScsIHsgdGl0bGU6IGJvdC50aXRsZSB9KSk7XG4gICAgICAgIHZhciBpc01heCA9IGJvdC5jaGFubmVsID09PSAnbWF4JztcbiAgICAgICAgJCgnI21oLWNoYXQtc3RlcHMnKS50ZXh0KHRmKGlzTWF4ID8gJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0U3RlcHNNYXgnIDogJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0U3RlcHMnLCB7XG4gICAgICAgICAgICBib3Q6IGJvdC5ib3RfdXNlcm5hbWUgPyAnQCcgKyBib3QuYm90X3VzZXJuYW1lIDogYm90LnRpdGxlXG4gICAgICAgIH0pKTtcbiAgICAgICAgJCgnI21oLWNoYXQtZm91bmQnKS5lbXB0eSgpO1xuICAgICAgICAkKCcjbWgtY2hhdC1lcnJvcicpLmVtcHR5KCk7XG4gICAgICAgICQoJyNtaC1jaGF0LWVtcHR5JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1jaGF0LWFnYWluJykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1jaGF0LXN0b3AnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgJCgnI21oLWNoYXQtc2F2ZScpLmF0dHIoJ2Rpc2FibGVkJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1jaGF0LXN0YXR1cy10ZXh0JykudGV4dCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdFNlYXJjaGluZycpKTtcbiAgICAgICAgJCgnI21oLWNoYXQtY291bnRkb3duJykudGV4dCgnJyk7XG4gICAgICAgICQoJyNtaC1jaGF0LXByb2dyZXNzIC5iYXInKS5jc3MoJ3dpZHRoJywgJzAlJyk7XG4gICAgICAgICQoJyNtaC1jaGF0LW1vZGFsJykubW9kYWwoeyBjbG9zYWJsZTogZmFsc2UgfSkubW9kYWwoJ3Nob3cnKTtcbiAgICAgICAgc3RhcnREaXNjb3ZlcnkoYm90LmlkLCBmYWxzZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3RhcnREaXNjb3ZlcnkoYm90SWQsIHJlc3RhcnQpIHtcbiAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIGJvdElkICsgJzpkaXNjb3ZlckNoYXRzJywgeyByZXN0YXJ0OiByZXN0YXJ0ID09PSB0cnVlIH0sIGZ1bmN0aW9uIChib3QpIHtcbiAgICAgICAgICAgIGlmICghc3RhdGUuY2hhdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkID0ge307XG4gICAgICAgICAgICB1cGRhdGVDaGF0TW9kYWwoYm90KTtcbiAgICAgICAgICAgIHNjaGVkdWxlQ2hhdFBvbGwoKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgc2hvd0NoYXRFcnJvcihmYWlsdXJlVGV4dChlcnIpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2NoZWR1bGVDaGF0UG9sbCgpIHtcbiAgICAgICAgc3RvcENoYXRQb2xsKCk7XG4gICAgICAgIHN0YXRlLmNoYXRNb2RhbC50aW1lciA9IHNldEludGVydmFsKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICghc3RhdGUuY2hhdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgYXBpR2V0KCcvYm90cy8nICsgc3RhdGUuY2hhdE1vZGFsLmJvdElkLCB7fSwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgICAgIGlmICghc3RhdGUuY2hhdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICAgIHVwZGF0ZUNoYXRNb2RhbChib3QpO1xuICAgICAgICAgICAgICAgIGlmICghYm90LmRpc2NvdmVyeS5hY3RpdmUpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RvcENoYXRQb2xsKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKCkgeyAvKiBrZWVwIHRoZSBsYXN0IHN0YXRlICovIH0pO1xuICAgICAgICB9LCAyMDAwKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzdG9wQ2hhdFBvbGwoKSB7XG4gICAgICAgIGlmIChzdGF0ZS5jaGF0TW9kYWwgJiYgc3RhdGUuY2hhdE1vZGFsLnRpbWVyICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjbGVhckludGVydmFsKHN0YXRlLmNoYXRNb2RhbC50aW1lcik7XG4gICAgICAgICAgICBzdGF0ZS5jaGF0TW9kYWwudGltZXIgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdXBkYXRlQ2hhdE1vZGFsKGJvdCkge1xuICAgICAgICBpZiAoIXN0YXRlLmNoYXRNb2RhbCkgeyByZXR1cm47IH1cbiAgICAgICAgc3RhdGUuY2hhdE1vZGFsLmJvdCA9IGJvdDtcbiAgICAgICAgcmVwbGFjZUJvdChib3QpO1xuICAgICAgICB2YXIgZGlzY292ZXJ5ID0gYm90LmRpc2NvdmVyeSB8fCB7IGFjdGl2ZTogZmFsc2UsIHN0YXR1czogJ2lkbGUnLCBmb3VuZDogW10gfTtcbiAgICAgICAgdmFyIGZvdW5kID0gZGlzY292ZXJ5LmZvdW5kIHx8IFtdO1xuICAgICAgICB2YXIgc2VsZWN0ZWRDb3VudCA9IDA7XG4gICAgICAgIHZhciBodG1sID0gJyc7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZm91bmQubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBpdGVtID0gZm91bmRbaV07XG4gICAgICAgICAgICB2YXIgaW5Cb3QgPSBmaW5kQ2hhdEJ5RXh0ZXJuYWwoYm90LCBpdGVtLmNoYXRfaWQpO1xuICAgICAgICAgICAgaWYgKCFpdGVtLmFscmVhZHlfY29ubmVjdGVkICYmIHN0YXRlLmNoYXRNb2RhbC5zZWxlY3RlZFtpdGVtLmNoYXRfaWRdICE9PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIHN0YXRlLmNoYXRNb2RhbC5zZWxlY3RlZFtpdGVtLmNoYXRfaWRdID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBjaGVja2VkID0gIWl0ZW0uYWxyZWFkeV9jb25uZWN0ZWQgJiYgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkW2l0ZW0uY2hhdF9pZF0gPT09IHRydWU7XG4gICAgICAgICAgICBpZiAoY2hlY2tlZCkgeyBzZWxlY3RlZENvdW50Kys7IH1cbiAgICAgICAgICAgIGh0bWwgKz0gJzxsYWJlbCBjbGFzcz1cIm1oLWZvdW5kLXJvdycgKyAoaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCA/ICcgaXMtY29ubmVjdGVkJyA6ICcnKSArICdcIiBkYXRhLWNoYXQtcm93PVwiJyArIChpbkJvdCA/IGluQm90LmlkIDogMCkgKyAnXCIgZGF0YS1jaGF0LWtleT1cIicgKyBlc2MoaXRlbS5jaGF0X2lkKSArICdcIj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJ1aSBjaGVja2JveCcgKyAoY2hlY2tlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAoaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCA/ICcgZGlzYWJsZWQnIDogJycpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgY2xhc3M9XCJoaWRkZW4gbWgtZm91bmQtY2hlY2tcIicgKyAoY2hlY2tlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAoaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCA/ICcgZGlzYWJsZWQnIDogJycpICsgJz4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1ib3hcIj48L3NwYW4+PC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWZvdW5kLXRpdGxlXCI+PGIgY2xhc3M9XCJtaC10cnVuY2F0ZVwiPicgKyBlc2MoaXRlbS50aXRsZSB8fCBpdGVtLmNoYXRfaWQpICsgJzwvYj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tZXRhXCI+JyArIGVzYyhjaGF0S2luZExhYmVsKGl0ZW0uY2hhdF9raW5kKSkgKyAnPC9zcGFuPjwvc3Bhbj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJ1aSAnICsgKGl0ZW0uYWxyZWFkeV9jb25uZWN0ZWQgPyAnbGFiZWwnIDogJ2JsdWUgbGFiZWwnKSArICdcIj4nXG4gICAgICAgICAgICAgICAgKyBlc2MoaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0RXhpc3RzJykgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdE5ldycpKSArICc8L3NwYW4+PC9sYWJlbD4nO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC1jaGF0LWZvdW5kJykuaHRtbChodG1sKTtcbiAgICAgICAgJCgnI21oLWNoYXQtc2F2ZScpLnRleHQodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0U2F2ZScsIHsgY291bnQ6IHNlbGVjdGVkQ291bnQgfSkpO1xuICAgICAgICAkKCcjbWgtY2hhdC1zYXZlJykuYXR0cignZGlzYWJsZWQnLCBzZWxlY3RlZENvdW50ID09PSAwID8gdHJ1ZSA6IG51bGwpO1xuXG4gICAgICAgIHZhciBzdGF0dXNUZXh0ID0gJyc7XG4gICAgICAgIHZhciBjb3VudGRvd24gPSAnJztcbiAgICAgICAgdmFyIHByb2dyZXNzID0gMDtcbiAgICAgICAgaWYgKGRpc2NvdmVyeS5hY3RpdmUpIHtcbiAgICAgICAgICAgIGlmIChmb3VuZC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgc3RhdHVzVGV4dCA9IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdEZvdW5kJywgeyBjb3VudDogZm91bmQubGVuZ3RoIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNUZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RTZWFyY2hpbmcnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvdW50ZG93biA9IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdFJlbWFpbmluZycsIHsgdGltZTogZm10Q291bnRkb3duKGRpc2NvdmVyeS5yZW1haW5pbmdfc2VjKSB9KTtcbiAgICAgICAgICAgIHByb2dyZXNzID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBNYXRoLnJvdW5kKCgzMDAgLSBkaXNjb3ZlcnkucmVtYWluaW5nX3NlYykgLyAzMDAgKiAxMDApKSk7XG4gICAgICAgICAgICAkKCcjbWgtY2hhdC1lbXB0eScpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLWNoYXQtZXJyb3InKS5lbXB0eSgpO1xuICAgICAgICAgICAgJCgnI21oLWNoYXQtYWdhaW4nKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgICQoJyNtaC1jaGF0LXN0b3AnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICQoJyNtaC1jaGF0LXN0b3AnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgICQoJyNtaC1jaGF0LWFnYWluJykucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgICAgICBpZiAoZGlzY292ZXJ5LnN0YXR1cyA9PT0gJ2Vycm9yJykge1xuICAgICAgICAgICAgICAgIHZhciBjb2RlID0gU3RyaW5nKGRpc2NvdmVyeS5sYXN0X2Vycm9yX2NvZGUgfHwgJycpO1xuICAgICAgICAgICAgICAgIHZhciB0ZXh0O1xuICAgICAgICAgICAgICAgIGlmIChjb2RlID09PSAndGVsZWdyYW0uNDA5LndlYmhvb2tfc2V0Jykge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RFcnJvcldlYmhvb2snKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNvZGUgPT09ICdtYXguNDA1LndlYmhvb2tfc2V0Jykge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RFcnJvcldlYmhvb2tNYXgnKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGlzTWF4VGxzQ29kZShjb2RlKSkge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0ID0gdGxzRXJyb3JUZXh0KCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChjb2RlID09PSAnbWF4LjQwMS51bmF1dGhvcml6ZWQnIHx8IGNvZGUgPT09ICd0ZWxlZ3JhbS40MDEudW5hdXRob3JpemVkJykge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZDQwMScpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdEVycm9yJykgKyAnICgnICsgY29kZSArICcpJztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgc2hvd0NoYXRFcnJvcih0ZXh0KTtcbiAgICAgICAgICAgICAgICBzdGF0dXNUZXh0ID0gJyc7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGRpc2NvdmVyeS5zdGF0dXMgPT09ICdlbXB0eScpIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNUZXh0ID0gJyc7XG4gICAgICAgICAgICAgICAgJCgnI21oLWNoYXQtZW1wdHknKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZm91bmQubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIHN0YXR1c1RleHQgPSB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RUaW1lb3V0JywgeyBjb3VudDogZm91bmQubGVuZ3RoIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNUZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3ROb1Nlc3Npb24nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvdW50ZG93biA9ICcnO1xuICAgICAgICAgICAgcHJvZ3Jlc3MgPSAxMDA7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLWNoYXQtc3RhdHVzLXRleHQnKS50ZXh0KHN0YXR1c1RleHQpO1xuICAgICAgICAkKCcjbWgtY2hhdC1jb3VudGRvd24nKS50ZXh0KGNvdW50ZG93bik7XG4gICAgICAgICQoJyNtaC1jaGF0LXByb2dyZXNzIC5iYXInKS5jc3MoJ3dpZHRoJywgcHJvZ3Jlc3MgKyAnJScpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZpbmRDaGF0QnlFeHRlcm5hbChib3QsIGNoYXRJZCkge1xuICAgICAgICB2YXIgY2hhdHMgPSBib3QuY2hhdHMgfHwgW107XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hhdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChTdHJpbmcoY2hhdHNbaV0uY2hhdF9pZCkgPT09IFN0cmluZyhjaGF0SWQpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNoYXRzW2ldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNob3dDaGF0RXJyb3IodGV4dCkge1xuICAgICAgICAkKCcjbWgtY2hhdC1lcnJvcicpLmh0bWwoJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlXCIgcm9sZT1cImFsZXJ0XCI+J1xuICAgICAgICAgICAgKyAnPHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+PGNpcmNsZSBjeD1cIjhcIiBjeT1cIjhcIiByPVwiNi4yNVwiLz48cGF0aCBkPVwiTTYgNmw0IDRNMTAgNmwtNCA0XCIvPjwvc3ZnPidcbiAgICAgICAgICAgICsgJzxkaXY+JyArIGVzYyh0ZXh0KSArICc8L2Rpdj48L2Rpdj4nKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBiaW5kQ2hhdEZvdW5kKCkge1xuICAgICAgICAkKCcjbWgtY2hhdC1mb3VuZCcpLm9uKCdjaGFuZ2UnLCAnLm1oLWZvdW5kLWNoZWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCFzdGF0ZS5jaGF0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIga2V5ID0gU3RyaW5nKCQodGhpcykuY2xvc2VzdCgnLm1oLWZvdW5kLXJvdycpLmRhdGEoJ2NoYXQta2V5JykpO1xuICAgICAgICAgICAgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkW2tleV0gPSAkKHRoaXMpLnByb3AoJ2NoZWNrZWQnKTtcbiAgICAgICAgICAgIHVwZGF0ZUNoYXRNb2RhbChzdGF0ZS5jaGF0TW9kYWwuYm90KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZVNlbGVjdGVkQ2hhdHMoKSB7XG4gICAgICAgIGlmICghc3RhdGUuY2hhdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICB2YXIgYm90ID0gc3RhdGUuY2hhdE1vZGFsLmJvdDtcbiAgICAgICAgdmFyIHBhdGNoZXMgPSBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCAoYm90LmRpc2NvdmVyeS5mb3VuZCB8fCBbXSkubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBpdGVtID0gYm90LmRpc2NvdmVyeS5mb3VuZFtpXTtcbiAgICAgICAgICAgIGlmIChpdGVtLmFscmVhZHlfY29ubmVjdGVkIHx8IHN0YXRlLmNoYXRNb2RhbC5zZWxlY3RlZFtpdGVtLmNoYXRfaWRdICE9PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgY2hhdCA9IGZpbmRDaGF0QnlFeHRlcm5hbChib3QsIGl0ZW0uY2hhdF9pZCk7XG4gICAgICAgICAgICBpZiAoY2hhdCkge1xuICAgICAgICAgICAgICAgIHBhdGNoZXMucHVzaCh7IGlkOiBjaGF0LmlkLCBlbmFibGVkOiB0cnVlLCBjaGF0X2tpbmQ6IGl0ZW0uY2hhdF9raW5kLCB0aXRsZTogaXRlbS50aXRsZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAocGF0Y2hlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhcGlQYXRjaCgnL2JvdHMvJyArIGJvdC5pZCwgeyBjaGF0czogcGF0Y2hlcyB9LCBmdW5jdGlvbiAoc2F2ZWQpIHtcbiAgICAgICAgICAgIGFwaVBvc3QoJy9ib3RzLycgKyBib3QuaWQgKyAnOmRpc2NvdmVyQ2hhdHMnLCB7IHN0b3A6IHRydWUgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGNsb3NlQ2hhdE1vZGFsKCk7XG4gICAgICAgICAgICAgICAgcmVwbGFjZUJvdChzYXZlZCk7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVkJykpO1xuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGNsb3NlQ2hhdE1vZGFsKCk7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVkJykpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgIHNob3dDaGF0RXJyb3IoZmFpbHVyZVRleHQoZXJyKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNsb3NlQ2hhdE1vZGFsKCkge1xuICAgICAgICBzdG9wQ2hhdFBvbGwoKTtcbiAgICAgICAgc3RhdGUuY2hhdE1vZGFsID0gbnVsbDtcbiAgICAgICAgJCgnI21oLWNoYXQtbW9kYWwnKS5tb2RhbCgnaGlkZScpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHN0b3BEaXNjb3ZlcnlBbmRDbG9zZSgpIHtcbiAgICAgICAgdmFyIGJvdCA9IHN0YXRlLmNoYXRNb2RhbCA/IHN0YXRlLmNoYXRNb2RhbC5ib3QgOiBudWxsO1xuICAgICAgICBpZiAoYm90KSB7XG4gICAgICAgICAgICBhcGlQb3N0KCcvYm90cy8nICsgYm90LmlkICsgJzpkaXNjb3ZlckNoYXRzJywgeyBzdG9wOiB0cnVlIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBjbG9zZUNoYXRNb2RhbCgpO1xuICAgICAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGNsb3NlQ2hhdE1vZGFsKCk7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNsb3NlQ2hhdE1vZGFsKCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIHRlc3QgbW9kYWwgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gb3BlblRlc3RNb2RhbChib3QsIGNoYXRJZHMpIHtcbiAgICAgICAgaWYgKCFib3QpIHsgcmV0dXJuOyB9XG4gICAgICAgIHN0YXRlLnRlc3RNb2RhbCA9IHsgYm90SWQ6IGJvdC5pZCwgYm90OiBib3QsIGV2ZW50SWQ6IDAsIGNoYXRJZHM6IGNoYXRJZHMsIHRpbWVyOiBudWxsLCB0cmllczogMCB9O1xuICAgICAgICAkKCcjbWgtdGVzdC1saXN0JykuaHRtbCgnPGRpdiBjbGFzcz1cIm1oLW11dGVkXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0UnVubmluZycpKSArICc8L2Rpdj4nKTtcbiAgICAgICAgJCgnI21oLXRlc3Qtc3VtbWFyeScpLnRleHQoJycpO1xuICAgICAgICAkKCcjbWgtdGVzdC1tb2RhbCcpLm1vZGFsKHsgY2xvc2FibGU6IHRydWUsIG9uSGlkZTogZnVuY3Rpb24gKCkgeyBzdG9wVGVzdFBvbGwoKTsgfSB9KS5tb2RhbCgnc2hvdycpO1xuICAgICAgICB2YXIgcGF5bG9hZCA9IGNoYXRJZHMgPT09IG51bGwgPyB7fSA6IHsgY2hhdF9pZHM6IGNoYXRJZHMgfTtcbiAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIGJvdC5pZCArICc6c2VuZFRlc3QnLCBwYXlsb2FkLCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgaWYgKCFzdGF0ZS50ZXN0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICBzdGF0ZS50ZXN0TW9kYWwuZXZlbnRJZCA9IGRhdGEuZXZlbnRfaWQ7XG4gICAgICAgICAgICBzdGF0ZS50ZXN0TW9kYWwuYm90ID0gZGF0YS5ib3Q7XG4gICAgICAgICAgICByZXBsYWNlQm90KGRhdGEuYm90KTtcbiAgICAgICAgICAgIHJlbmRlclRlc3QoZGF0YS5ib3QpO1xuICAgICAgICAgICAgc2NoZWR1bGVUZXN0UG9sbCgpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAkKCcjbWgtdGVzdC1saXN0JykuaHRtbCgnPGRpdiBjbGFzcz1cInVpIG5lZ2F0aXZlIG1lc3NhZ2VcIj48ZGl2PicgKyBlc2MoZmFpbHVyZVRleHQoZXJyKSkgKyAnPC9kaXY+PC9kaXY+Jyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNjaGVkdWxlVGVzdFBvbGwoKSB7XG4gICAgICAgIHN0b3BUZXN0UG9sbCgpO1xuICAgICAgICBzdGF0ZS50ZXN0TW9kYWwudGltZXIgPSBzZXRJbnRlcnZhbChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoIXN0YXRlLnRlc3RNb2RhbCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHN0YXRlLnRlc3RNb2RhbC50cmllcysrO1xuICAgICAgICAgICAgYXBpR2V0KCcvYm90cy8nICsgc3RhdGUudGVzdE1vZGFsLmJvdElkLCB7fSwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgICAgIGlmICghc3RhdGUudGVzdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICAgIHN0YXRlLnRlc3RNb2RhbC5ib3QgPSBib3Q7XG4gICAgICAgICAgICAgICAgcmVwbGFjZUJvdChib3QpO1xuICAgICAgICAgICAgICAgIHJlbmRlclRlc3QoYm90KTtcbiAgICAgICAgICAgICAgICBpZiAoIXRlc3RQZW5kaW5nKGJvdCkgfHwgc3RhdGUudGVzdE1vZGFsLnRyaWVzID4gMjApIHtcbiAgICAgICAgICAgICAgICAgICAgc3RvcFRlc3RQb2xsKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGlmIChzdGF0ZS50ZXN0TW9kYWwgJiYgc3RhdGUudGVzdE1vZGFsLnRyaWVzID4gMykge1xuICAgICAgICAgICAgICAgICAgICBzdG9wVGVzdFBvbGwoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSwgMjAwMCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3RvcFRlc3RQb2xsKCkge1xuICAgICAgICBpZiAoc3RhdGUudGVzdE1vZGFsICYmIHN0YXRlLnRlc3RNb2RhbC50aW1lciAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xlYXJJbnRlcnZhbChzdGF0ZS50ZXN0TW9kYWwudGltZXIpO1xuICAgICAgICAgICAgc3RhdGUudGVzdE1vZGFsLnRpbWVyID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIHRlc3REZWxpdmVyaWVzKGJvdCkge1xuICAgICAgICB2YXIgZXZlbnRJZCA9IHN0YXRlLnRlc3RNb2RhbCA/IHN0YXRlLnRlc3RNb2RhbC5ldmVudElkIDogMDtcbiAgICAgICAgdmFyIHJlc3VsdCA9IFtdO1xuICAgICAgICB2YXIgY2hhdHMgPSBib3QuY2hhdHMgfHwgW107XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hhdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBkZWxpdmVyeSA9IGNoYXRzW2ldLmxhc3RfZGVsaXZlcnk7XG4gICAgICAgICAgICBpZiAoZGVsaXZlcnkgJiYgTnVtYmVyKGRlbGl2ZXJ5LmV2ZW50X2lkKSA9PT0gTnVtYmVyKGV2ZW50SWQpKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0LnB1c2goeyBjaGF0OiBjaGF0c1tpXSwgZGVsaXZlcnk6IGRlbGl2ZXJ5IH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdGVzdFBlbmRpbmcoYm90KSB7XG4gICAgICAgIHZhciBsaXN0ID0gdGVzdERlbGl2ZXJpZXMoYm90KTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgc3RhdHVzID0gbGlzdFtpXS5kZWxpdmVyeS5zdGF0dXM7XG4gICAgICAgICAgICBpZiAoc3RhdHVzID09PSAncGVuZGluZycgfHwgc3RhdHVzID09PSAnc2VuZGluZycpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZGVsaXZlcnlTdGF0dXNMYWJlbChkZWxpdmVyeSkge1xuICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAnc2VudCcpIHsgcmV0dXJuIHsgY2xzOiAnaXMtb2snLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0RGVsaXZlcmVkJykgfTsgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAncGVuZGluZycgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnc2VuZGluZycpIHsgcmV0dXJuIHsgY2xzOiAnJywgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdFF1ZXVlZCcpIH07IH1cbiAgICAgICAgcmV0dXJuIHsgY2xzOiAnaXMtZXJyJywgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdEVycm9yJykgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZWxpdmVyeUVycm9yVGV4dChjb2RlKSB7XG4gICAgICAgIGlmIChpc01heFRsc0NvZGUoY29kZSkpIHsgcmV0dXJuIHRsc0Vycm9yVGV4dCgpOyB9XG4gICAgICAgIGlmIChjb2RlID09PSAndGVsZWdyYW0uNDAxLnVuYXV0aG9yaXplZCcgfHwgY29kZSA9PT0gJ21heC40MDEudW5hdXRob3JpemVkJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZDQwMScpOyB9XG4gICAgICAgIGlmIChjb2RlID09PSAndGVsZWdyYW0uNDAzLmtpY2tlZCcgfHwgY29kZSA9PT0gJ3RlbGVncmFtLjQwMy5ibG9ja2VkJyB8fCBjb2RlID09PSAndGVsZWdyYW0uNDAwLmNoYXRfbm90X2ZvdW5kJ1xuICAgICAgICAgICAgfHwgY29kZSA9PT0gJ21heC40MDMuY2hhdF9kZW5pZWQnIHx8IGNvZGUgPT09ICdtYXguNDA0Lm5vdF9mb3VuZCcgfHwgY29kZSA9PT0gJ21heC40MDQudW5rbm93bicpIHtcbiAgICAgICAgICAgIHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0U3RhdHVzR29uZScpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjb2RlID09PSAndGVsZWdyYW0uNDI5LnJhdGVfbGltaXQnIHx8IGNvZGUgPT09ICdtYXguNDI5LnJhdGVfbGltaXQnKSB7IHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0RXJyb3JSYXRlTGltaXQnKTsgfVxuICAgICAgICBpZiAoY29kZSA9PT0gJ3N0YWxlJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdEVycm9yU3RhbGUnKTsgfVxuICAgICAgICByZXR1cm4gY29kZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJUZXN0KGJvdCkge1xuICAgICAgICB2YXIgbGlzdCA9IHRlc3REZWxpdmVyaWVzKGJvdCk7XG4gICAgICAgIHZhciBjb3VudHMgPSB7IHNlbnQ6IDAsIHBlbmRpbmc6IDAsIGZhaWxlZDogMCB9O1xuICAgICAgICB2YXIgaHRtbCA9ICcnO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBjaGF0ID0gbGlzdFtpXS5jaGF0O1xuICAgICAgICAgICAgdmFyIGRlbGl2ZXJ5ID0gbGlzdFtpXS5kZWxpdmVyeTtcbiAgICAgICAgICAgIHZhciBsYWJlbCA9IGRlbGl2ZXJ5U3RhdHVzTGFiZWwoZGVsaXZlcnkpO1xuICAgICAgICAgICAgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3NlbnQnKSB7IGNvdW50cy5zZW50Kys7IH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3BlbmRpbmcnIHx8IGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3NlbmRpbmcnKSB7IGNvdW50cy5wZW5kaW5nKys7IH1cbiAgICAgICAgICAgIGVsc2UgeyBjb3VudHMuZmFpbGVkKys7IH1cbiAgICAgICAgICAgIHZhciByZXRyeSA9IChkZWxpdmVyeS5zdGF0dXMgPT09ICdmYWlsZWQnIHx8IGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2Ryb3BwZWQnKVxuICAgICAgICAgICAgICAgID8gJzxidXR0b24gY2xhc3M9XCJ1aSBiYXNpYyBidXR0b24gbWgtdGVzdC1yZXRyeVwiIHR5cGU9XCJidXR0b25cIiBkYXRhLWNoYXQtaWQ9XCInICsgY2hhdC5pZCArICdcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3RSZXRyeScpKSArICc8L2J1dHRvbj4nXG4gICAgICAgICAgICAgICAgOiAnJztcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJtaC10ZXN0LXJvd1wiPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1lc3NlbmdlciAnICsgKGJvdC5jaGFubmVsID09PSAnbWF4JyA/ICdtYXgnIDogJ3RnJykgKyAnIHNcIiBhcmlhLWhpZGRlbj1cInRydWVcIj4nICsgKGJvdC5jaGFubmVsID09PSAnbWF4JyA/ICdNQVgnIDogJ1RHJykgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtdGVzdC10aXRsZVwiPjxkaXYgY2xhc3M9XCJtaC10cnVuY2F0ZVwiPicgKyBlc2MoY2hhdC50aXRsZSB8fCBjaGF0LmNoYXRfaWQpICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArIChkZWxpdmVyeS5sYXN0X2Vycm9yX2NvZGUgPyAnPGRpdiBjbGFzcz1cIm1oLW1ldGEgbWgtZXJyb3ItdGV4dFwiPicgKyBlc2MoZGVsaXZlcnlFcnJvclRleHQoZGVsaXZlcnkubGFzdF9lcnJvcl9jb2RlKSkgKyAnPC9kaXY+JyA6ICcnKVxuICAgICAgICAgICAgICAgICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXRlc3Qtc3RhdGUgJyArIGxhYmVsLmNscyArICdcIj4nICsgZXNjKGxhYmVsLnRleHQpICsgJzwvc3Bhbj4nICsgcmV0cnkgKyAnPC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoaHRtbCA9PT0gJycpIHtcbiAgICAgICAgICAgIGh0bWwgPSAnPGRpdiBjbGFzcz1cIm1oLW11dGVkXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0UnVubmluZycpKSArICc8L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC10ZXN0LWxpc3QnKS5odG1sKGh0bWwpO1xuICAgICAgICAkKCcjbWgtdGVzdC1zdW1tYXJ5JykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdFN1bW1hcnknLCB7XG4gICAgICAgICAgICBvazogY291bnRzLnNlbnQsXG4gICAgICAgICAgICBmYWlsZWQ6IGNvdW50cy5mYWlsZWQsXG4gICAgICAgICAgICBwZW5kaW5nOiBjb3VudHMucGVuZGluZ1xuICAgICAgICB9KSk7XG4gICAgICAgICQoJyNtaC10ZXN0LWxpc3QgLm1oLXRlc3QtcmV0cnknKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgY2hhdElkID0gTnVtYmVyKCQodGhpcykuZGF0YSgnY2hhdC1pZCcpKTtcbiAgICAgICAgICAgIG9wZW5UZXN0TW9kYWwoc3RhdGUudGVzdE1vZGFsID8gc3RhdGUudGVzdE1vZGFsLmJvdCA6IGJvdCwgW2NoYXRJZF0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGdlbmVyYWwgc2V0dGluZ3MgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gbG9hZEdlbmVyYWxTZXR0aW5ncygpIHtcbiAgICAgICAgYXBpR2V0KCcvc2V0dGluZ3MnLCB7fSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHN0YXRlLnJldGVudGlvbiA9IGRhdGEuZXZlbnRzX3JldGVudGlvbl9kYXlzO1xuICAgICAgICAgICAgc3RhdGUuc2V0dGluZ3MgPSBkYXRhO1xuICAgICAgICAgICAgJCgnI21oLXJldGVudGlvbi1pbnB1dCcpLnZhbChkYXRhLmV2ZW50c19yZXRlbnRpb25fZGF5cyk7XG4gICAgICAgICAgICAkKCcjbWgtcHVibGljLXVybC1pbnB1dCcpLnZhbChkYXRhLnBieF9wdWJsaWNfdXJsIHx8ICcnKTtcbiAgICAgICAgICAgICQoJyNtaC1wcm94eS1pbnB1dCcpLnZhbChkYXRhLnByb3h5X3VybCB8fCAnJyk7XG4gICAgICAgICAgICAkKCcjbWgtbWF4LWNhLWlucHV0JykudmFsKGRhdGEubWF4X2NhX2J1bmRsZV9wYXRoIHx8ICcnKTtcbiAgICAgICAgICAgICQoJyNtaC1xdWV1ZS1taW4td2FpdC1pbnB1dCcpLnZhbChkYXRhLnF1ZXVlX2FiYW5kb25fbWluX3dhaXRfc2VjIHx8IDApO1xuICAgICAgICAgICAgJCgnI21oLXF1ZXVlLWxvbmctd2FpdC1pbnB1dCcpLnZhbChkYXRhLnF1ZXVlX2xvbmdfd2FpdF9zZWMgfHwgMCk7XG4gICAgICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC1xdWV1ZS1taW4td2FpdC1maWVsZCcpO1xuICAgICAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtcXVldWUtbG9uZy13YWl0LWZpZWxkJyk7XG4gICAgICAgICAgICAkKCcjbWgtY29uZmlnLXF1aWV0LWlucHV0JykudmFsKGRhdGEuY29uZmlnX2NoYW5nZV9xdWlldF9zZWMpO1xuICAgICAgICAgICAgJCgnI21oLWV4dGVybmFsLWlwLWlucHV0JykudmFsKGRhdGEuZXh0ZXJuYWxfaXBfcG9sbF9taW4pO1xuICAgICAgICAgICAgJCgnI21oLWxpY2Vuc2UtaG91cnMtaW5wdXQnKS52YWwoZGF0YS5saWNlbnNlX3BvbGxfaG91cnMpO1xuICAgICAgICAgICAgJCgnI21oLWxpY2Vuc2UtZGF5cy1pbnB1dCcpLnZhbChkYXRhLmxpY2Vuc2Vfd2Fybl9kYXlzIHx8ICcnKTtcbiAgICAgICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLW1heC1jYS1maWVsZCcpO1xuICAgICAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtY29uZmlnLXF1aWV0LWZpZWxkJyk7XG4gICAgICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC1leHRlcm5hbC1pcC1maWVsZCcpO1xuICAgICAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtbGljZW5zZS1ob3Vycy1maWVsZCcpO1xuICAgICAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtbGljZW5zZS1kYXlzLWZpZWxkJyk7XG4gICAgICAgICAgICAkKCcjbWgtbWFzay1kZWZhdWx0JykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCBkYXRhLm1hc2tfcGhvbmVfZGVmYXVsdCA9PT0gdHJ1ZSk7XG4gICAgICAgICAgICAkKCcjbWgtbWFzay1kZWZhdWx0IGlucHV0JykucHJvcCgnY2hlY2tlZCcsIGRhdGEubWFza19waG9uZV9kZWZhdWx0ID09PSB0cnVlKTtcbiAgICAgICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLXB1YmxpYy11cmwtZmllbGQnKTtcbiAgICAgICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLXByb3h5LWZpZWxkJyk7XG4gICAgICAgICAgICBjbGVhclJldGVudGlvbkVycm9yKCk7XG4gICAgICAgICAgICBsb2FkU2VjdXJpdHlTZXR0aW5ncyhkYXRhKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgIG1hcmtSZXRlbnRpb25FcnJvcih0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uTG9hZEVycm9yJywge1xuICAgICAgICAgICAgICAgIHdoYXQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0xvYWRXaGF0U2V0dGluZ3MnKSxcbiAgICAgICAgICAgICAgICBjb2RlOiBmYWlsdXJlLnN0YXR1cyA+IDAgPyBmYWlsdXJlLnN0YXR1cyA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblRpbWVvdXQnKVxuICAgICAgICAgICAgfSkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlU2V0dGluZyhwYXlsb2FkLCBmaWVsZFNlbGVjdG9yLCByZXZlcnQpIHtcbiAgICAgICAgYXBpUGF0Y2goJy9zZXR0aW5ncycsIHBheWxvYWQsIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICBzdGF0ZS5zZXR0aW5ncyA9IGRhdGE7XG4gICAgICAgICAgICBpZiAoZmllbGRTZWxlY3RvcikgeyBjbGVhckZpZWxkRXJyb3IoZmllbGRTZWxlY3Rvcik7IH1cbiAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25TYXZlZCcpKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgIGlmIChmaWVsZFNlbGVjdG9yKSB7XG4gICAgICAgICAgICAgICAgbWFya0ZpZWxkRXJyb3IoZmllbGRTZWxlY3RvciwgZmFpbHVyZVRleHQoZmFpbHVyZSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHJldmVydCkgeyByZXZlcnQoKTsgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlUHVibGljVXJsKCkge1xuICAgICAgICB2YXIgdmFsdWUgPSBTdHJpbmcoJCgnI21oLXB1YmxpYy11cmwtaW5wdXQnKS52YWwoKSB8fCAnJykudHJpbSgpO1xuICAgICAgICB2YXIgcHJldmlvdXMgPSBzdGF0ZS5zZXR0aW5ncyA/IHN0YXRlLnNldHRpbmdzLnBieF9wdWJsaWNfdXJsIDogJyc7XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gJycpIHtcbiAgICAgICAgICAgIHNhdmVTZXR0aW5nKHsgcGJ4X3B1YmxpY191cmw6ICcnIH0sICcjbWgtcHVibGljLXVybC1maWVsZCcpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghL15odHRwcz86XFwvXFwvXFxTKyQvaS50ZXN0KHZhbHVlKSkge1xuICAgICAgICAgICAgbWFya0ZpZWxkRXJyb3IoJyNtaC1wdWJsaWMtdXJsLWZpZWxkJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU2V0dGluZ3NQdWJsaWNVcmxJbnZhbGlkJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHNhdmVTZXR0aW5nKHsgcGJ4X3B1YmxpY191cmw6IHZhbHVlIH0sICcjbWgtcHVibGljLXVybC1maWVsZCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1wdWJsaWMtdXJsLWlucHV0JykudmFsKHByZXZpb3VzKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZVByb3h5KCkge1xuICAgICAgICB2YXIgdmFsdWUgPSBTdHJpbmcoJCgnI21oLXByb3h5LWlucHV0JykudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgdmFyIHByZXZpb3VzID0gc3RhdGUuc2V0dGluZ3MgPyBzdGF0ZS5zZXR0aW5ncy5wcm94eV91cmwgOiAnJztcbiAgICAgICAgaWYgKHZhbHVlICE9PSAnJyAmJiAhL14oKGh0dHBzP3xzb2NrczVoPyk6XFwvXFwvKT9bQS1aYS16MC05LlxcLV0rOlxcZHsxLDV9JC8udGVzdCh2YWx1ZSkpIHtcbiAgICAgICAgICAgIG1hcmtGaWVsZEVycm9yKCcjbWgtcHJveHktZmllbGQnLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9TZXR0aW5nc1Byb3h5SW52YWxpZCcpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBzYXZlU2V0dGluZyh7IHByb3h5X3VybDogdmFsdWUgfSwgJyNtaC1wcm94eS1maWVsZCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1wcm94eS1pbnB1dCcpLnZhbChwcmV2aW91cyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVNYXhDYUJ1bmRsZSgpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gU3RyaW5nKCQoJyNtaC1tYXgtY2EtaW5wdXQnKS52YWwoKSB8fCAnJykudHJpbSgpO1xuICAgICAgICB2YXIgcHJldmlvdXMgPSBzdGF0ZS5zZXR0aW5ncyA/IHN0YXRlLnNldHRpbmdzLm1heF9jYV9idW5kbGVfcGF0aCA6ICcnO1xuICAgICAgICBpZiAodmFsdWUgIT09ICcnICYmIHZhbHVlLmNoYXJBdCgwKSAhPT0gJy8nKSB7XG4gICAgICAgICAgICBtYXJrRmllbGRFcnJvcignI21oLW1heC1jYS1maWVsZCcsIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NldHRpbmdzQ2FQYXRoSW52YWxpZCcpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBzYXZlU2V0dGluZyh7IG1heF9jYV9idW5kbGVfcGF0aDogdmFsdWUgfSwgJyNtaC1tYXgtY2EtZmllbGQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtbWF4LWNhLWlucHV0JykudmFsKHByZXZpb3VzKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZU1hc2tEZWZhdWx0KCkge1xuICAgICAgICB2YXIgY2hlY2tlZCA9ICQoJyNtaC1tYXNrLWRlZmF1bHQgaW5wdXQnKS5wcm9wKCdjaGVja2VkJyk7XG4gICAgICAgIHNhdmVTZXR0aW5nKHsgbWFza19waG9uZV9kZWZhdWx0OiBjaGVja2VkIH0sIG51bGwsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1tYXNrLWRlZmF1bHQgaW5wdXQnKS5wcm9wKCdjaGVja2VkJywgIWNoZWNrZWQpO1xuICAgICAgICAgICAgJCgnI21oLW1hc2stZGVmYXVsdCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgIWNoZWNrZWQpO1xuICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVGYWlsZWQnKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIFF1ZXVlIHdhaXQgdGhyZXNob2xkcyAoMC4uMzYwMCBzKS4gMCB0dXJucyB0aGUgY2hlY2sgb2ZmOyB0aGUgc291cmNlIGNsYW1wcyBhZ2FpbiBvbiBpdHMgc2lkZS5cbiAgICBmdW5jdGlvbiBzYXZlUXVldWVXYWl0KGlucHV0U2VsZWN0b3IsIGZpZWxkU2VsZWN0b3IsIGtleSkge1xuICAgICAgICB2YXIgcmF3ID0gU3RyaW5nKCQoaW5wdXRTZWxlY3RvcikudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgdmFyIHNlY29uZHMgPSAvXlxcZCskLy50ZXN0KHJhdykgPyBwYXJzZUludChyYXcsIDEwKSA6IC0xO1xuICAgICAgICB2YXIgcHJldmlvdXMgPSBzdGF0ZS5zZXR0aW5ncyA/IE51bWJlcihzdGF0ZS5zZXR0aW5nc1trZXldIHx8IDApIDogMDtcbiAgICAgICAgaWYgKHNlY29uZHMgPCAwIHx8IHNlY29uZHMgPiAzNjAwKSB7XG4gICAgICAgICAgICBtYXJrRmllbGRFcnJvcihmaWVsZFNlbGVjdG9yLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9TZXR0aW5nc1F1ZXVlV2FpdEVycm9yJykpO1xuICAgICAgICAgICAgJChpbnB1dFNlbGVjdG9yKS52YWwocHJldmlvdXMpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNsZWFyRmllbGRFcnJvcihmaWVsZFNlbGVjdG9yKTtcbiAgICAgICAgdmFyIHBheWxvYWQgPSB7fTtcbiAgICAgICAgcGF5bG9hZFtrZXldID0gc2Vjb25kcztcbiAgICAgICAgc2F2ZVNldHRpbmcocGF5bG9hZCwgZmllbGRTZWxlY3RvciwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJChpbnB1dFNlbGVjdG9yKS52YWwocHJldmlvdXMpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlUXVldWVNaW5XYWl0KCkge1xuICAgICAgICBzYXZlUXVldWVXYWl0KCcjbWgtcXVldWUtbWluLXdhaXQtaW5wdXQnLCAnI21oLXF1ZXVlLW1pbi13YWl0LWZpZWxkJywgJ3F1ZXVlX2FiYW5kb25fbWluX3dhaXRfc2VjJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZVF1ZXVlTG9uZ1dhaXQoKSB7XG4gICAgICAgIHNhdmVRdWV1ZVdhaXQoJyNtaC1xdWV1ZS1sb25nLXdhaXQtaW5wdXQnLCAnI21oLXF1ZXVlLWxvbmctd2FpdC1maWVsZCcsICdxdWV1ZV9sb25nX3dhaXRfc2VjJyk7XG4gICAgfVxuXG4gICAgLy8gU3RhZ2UgNHMtQyBudW1lcmljIHRocmVzaG9sZHM6IGNvbmZpZy1jaGFuZ2UgcXVpZXQgd2luZG93LCBleHRlcm5hbC1JUCBhbmQgbGljZW5zZSBwb2xsIGludGVydmFscy5cbiAgICBmdW5jdGlvbiBzYXZlTnVtYmVyU2V0dGluZyhwYXlsb2FkS2V5LCBpbnB1dFNlbGVjdG9yLCBmaWVsZFNlbGVjdG9yLCBtaW4sIG1heCkge1xuICAgICAgICB2YXIgcmF3ID0gU3RyaW5nKCQoaW5wdXRTZWxlY3RvcikudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgdmFyIHZhbHVlID0gL15cXGQrJC8udGVzdChyYXcpID8gcGFyc2VJbnQocmF3LCAxMCkgOiAtMTtcbiAgICAgICAgaWYgKHZhbHVlIDwgbWluIHx8IHZhbHVlID4gbWF4KSB7XG4gICAgICAgICAgICBtYXJrRmllbGRFcnJvcihmaWVsZFNlbGVjdG9yLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9TZXR0aW5nc051bWJlckVycm9yJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNsZWFyRmllbGRFcnJvcihmaWVsZFNlbGVjdG9yKTtcbiAgICAgICAgdmFyIHBheWxvYWQgPSB7fTtcbiAgICAgICAgcGF5bG9hZFtwYXlsb2FkS2V5XSA9IHZhbHVlO1xuICAgICAgICBhcGlQYXRjaCgnL3NldHRpbmdzJywgcGF5bG9hZCwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHN0YXRlLnNldHRpbmdzID0gZGF0YTtcbiAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25TYXZlZCcpKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgIG1hcmtGaWVsZEVycm9yKGZpZWxkU2VsZWN0b3IsIGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgICAgICQoaW5wdXRTZWxlY3RvcikudmFsKHN0YXRlLnNldHRpbmdzID8gc3RhdGUuc2V0dGluZ3NbcGF5bG9hZEtleV0gOiAnJyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIFwiMTQsNywxXCI6IGRheXMgc2VwYXJhdGVkIGJ5IGNvbW1hcywgMS4uMzY1LCBhdCBtb3N0IGZpdmUgdmFsdWVzLCBuZXZlciBlbXB0eS5cbiAgICBmdW5jdGlvbiBzYXZlTGljZW5zZVdhcm5EYXlzKCkge1xuICAgICAgICB2YXIgcmF3ID0gU3RyaW5nKCQoJyNtaC1saWNlbnNlLWRheXMtaW5wdXQnKS52YWwoKSB8fCAnJykudHJpbSgpO1xuICAgICAgICB2YXIgcGFydHMgPSByYXcgPT09ICcnID8gW10gOiByYXcuc3BsaXQoL1tcXHMsO10rLyk7XG4gICAgICAgIHZhciBkYXlzID0gW107XG4gICAgICAgIHZhciB2YWxpZCA9IHBhcnRzLmxlbmd0aCA+IDAgJiYgcGFydHMubGVuZ3RoIDw9IDU7XG4gICAgICAgIHBhcnRzLmZvckVhY2goZnVuY3Rpb24gKHBhcnQpIHtcbiAgICAgICAgICAgIHZhciBkYXkgPSAvXlxcZCskLy50ZXN0KHBhcnQpID8gcGFyc2VJbnQocGFydCwgMTApIDogLTE7XG4gICAgICAgICAgICBpZiAoZGF5IDwgMSB8fCBkYXkgPiAzNjUgfHwgZGF5cy5pbmRleE9mKGRheSkgPj0gMCkgeyB2YWxpZCA9IGZhbHNlOyByZXR1cm47IH1cbiAgICAgICAgICAgIGRheXMucHVzaChkYXkpO1xuICAgICAgICB9KTtcbiAgICAgICAgaWYgKCF2YWxpZCB8fCBkYXlzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgbWFya0ZpZWxkRXJyb3IoJyNtaC1saWNlbnNlLWRheXMtZmllbGQnLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9TZXR0aW5nc0xpY2Vuc2VEYXlzRXJyb3InKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgZGF5cy5zb3J0KGZ1bmN0aW9uIChhLCBiKSB7IHJldHVybiBiIC0gYTsgfSk7XG4gICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLWxpY2Vuc2UtZGF5cy1maWVsZCcpO1xuICAgICAgICBhcGlQYXRjaCgnL3NldHRpbmdzJywgeyBsaWNlbnNlX3dhcm5fZGF5czogZGF5cy5qb2luKCcsJykgfSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHN0YXRlLnNldHRpbmdzID0gZGF0YTtcbiAgICAgICAgICAgICQoJyNtaC1saWNlbnNlLWRheXMtaW5wdXQnKS52YWwoZGF0YS5saWNlbnNlX3dhcm5fZGF5cyB8fCAnJyk7XG4gICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZWQnKSk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICBtYXJrRmllbGRFcnJvcignI21oLWxpY2Vuc2UtZGF5cy1maWVsZCcsIGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgICAgICQoJyNtaC1saWNlbnNlLWRheXMtaW5wdXQnKS52YWwoc3RhdGUuc2V0dGluZ3MgPyBzdGF0ZS5zZXR0aW5ncy5saWNlbnNlX3dhcm5fZGF5cyA6ICcnKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBzZWN1cml0eSBzZXR0aW5ncyAoc3RhZ2UgNHMtQSk6IHRvbGwtZnJhdWQgcnVsZXMgYW5kIFNJUCBicnV0ZSBmb3JjZSAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBsb2FkU2VjdXJpdHlTZXR0aW5ncyhkYXRhKSB7XG4gICAgICAgICQoJyNtaC10b2xsLXByZWZpeGVzLWlucHV0JykudmFsKGRhdGEudG9sbF9mcmF1ZF9wcmVmaXhlcyB8fCAnJyk7XG4gICAgICAgICQoJyNtaC10b2xsLWhvbWUtaW5wdXQnKS52YWwoZGF0YS50b2xsX2ZyYXVkX2hvbWVfcHJlZml4ZXMgfHwgJycpO1xuICAgICAgICAkKCcjbWgtdG9sbC1idXJzdC1pbnB1dCcpLnZhbChkYXRhLnRvbGxfZnJhdWRfYnVyc3RfY2FsbHMpO1xuICAgICAgICAkKCcjbWgtdG9sbC13aW5kb3ctaW5wdXQnKS52YWwoZGF0YS50b2xsX2ZyYXVkX2J1cnN0X3dpbmRvd19taW4pO1xuICAgICAgICAkKCcjbWgtdG9sbC1mcm9tLWlucHV0JykudmFsKGRhdGEudG9sbF9mcmF1ZF9vZmZob3Vyc19mcm9tIHx8ICcnKTtcbiAgICAgICAgJCgnI21oLXRvbGwtdG8taW5wdXQnKS52YWwoZGF0YS50b2xsX2ZyYXVkX29mZmhvdXJzX3RvIHx8ICcnKTtcbiAgICAgICAgJCgnI21oLXRvbGwtb2ZmaG91cnMnKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsIGRhdGEudG9sbF9mcmF1ZF9vZmZob3Vyc19lbmFibGVkID09PSB0cnVlKTtcbiAgICAgICAgJCgnI21oLXRvbGwtb2ZmaG91cnMgaW5wdXQnKS5wcm9wKCdjaGVja2VkJywgZGF0YS50b2xsX2ZyYXVkX29mZmhvdXJzX2VuYWJsZWQgPT09IHRydWUpO1xuICAgICAgICAkKCcjbWgtYXV0aGZhaWwtdGhyZXNob2xkLWlucHV0JykudmFsKGRhdGEuc2lwX2F1dGhmYWlsX3RocmVzaG9sZCk7XG4gICAgICAgICQoJyNtaC1hdXRoZmFpbC13aW5kb3ctaW5wdXQnKS52YWwoZGF0YS5zaXBfYXV0aGZhaWxfd2luZG93X21pbik7XG4gICAgICAgICQoJyNtaC1hdXRoZmFpbC1xdWlldC1pbnB1dCcpLnZhbChkYXRhLnNpcF9hdXRoZmFpbF9xdWlldF9taW4pO1xuICAgICAgICAkKCcjbWgtYXV0aGZhaWwtcGVycG9sbC1pbnB1dCcpLnZhbChkYXRhLnNpcF9hdXRoZmFpbF9leHRlbnNpb25zX3Blcl9wb2xsKTtcbiAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtdG9sbC1wcmVmaXhlcy1maWVsZCcpO1xuICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC10b2xsLWhvbWUtZmllbGQnKTtcbiAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtdG9sbC1idXJzdC1maWVsZCcpO1xuICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC10b2xsLXdpbmRvdy1maWVsZCcpO1xuICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC10b2xsLWZyb20tZmllbGQnKTtcbiAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtdG9sbC10by1maWVsZCcpO1xuICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC1hdXRoZmFpbC10aHJlc2hvbGQtZmllbGQnKTtcbiAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtYXV0aGZhaWwtd2luZG93LWZpZWxkJyk7XG4gICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLWF1dGhmYWlsLXF1aWV0LWZpZWxkJyk7XG4gICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLWF1dGhmYWlsLXBlcnBvbGwtZmllbGQnKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzZWN1cml0eUludmFsaWQoZmllbGRTZWxlY3Rvcikge1xuICAgICAgICBtYXJrRmllbGRFcnJvcihmaWVsZFNlbGVjdG9yLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9TZXR0aW5nc1NlY3VyaXR5SW52YWxpZCcpKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlU2VjdXJpdHlJbnQoc2VsZWN0b3IsIGZpZWxkU2VsZWN0b3IsIGZpZWxkLCBtaW4sIG1heCkge1xuICAgICAgICB2YXIgcmF3ID0gU3RyaW5nKCQoc2VsZWN0b3IpLnZhbCgpIHx8ICcnKS50cmltKCk7XG4gICAgICAgIHZhciB2YWx1ZSA9IC9eXFxkKyQvLnRlc3QocmF3KSA/IHBhcnNlSW50KHJhdywgMTApIDogLTE7XG4gICAgICAgIGlmICh2YWx1ZSA8IG1pbiB8fCB2YWx1ZSA+IG1heCkgeyBzZWN1cml0eUludmFsaWQoZmllbGRTZWxlY3Rvcik7IHJldHVybjsgfVxuICAgICAgICB2YXIgcGF5bG9hZCA9IHt9O1xuICAgICAgICBwYXlsb2FkW2ZpZWxkXSA9IHZhbHVlO1xuICAgICAgICB2YXIgcHJldmlvdXMgPSBzdGF0ZS5zZXR0aW5ncyA/IHN0YXRlLnNldHRpbmdzW2ZpZWxkXSA6IHZhbHVlO1xuICAgICAgICBzYXZlU2V0dGluZyhwYXlsb2FkLCBmaWVsZFNlbGVjdG9yLCBmdW5jdGlvbiAoKSB7ICQoc2VsZWN0b3IpLnZhbChwcmV2aW91cyk7IH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVTZWN1cml0eVByZWZpeGVzKHNlbGVjdG9yLCBmaWVsZFNlbGVjdG9yLCBmaWVsZCkge1xuICAgICAgICB2YXIgdmFsdWUgPSBTdHJpbmcoJChzZWxlY3RvcikudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgaWYgKHZhbHVlICE9PSAnJyAmJiAhL15cXCs/XFxkezAsOH0oXFxzKixcXHMqXFwrP1xcZHswLDh9KSokLy50ZXN0KHZhbHVlKSkge1xuICAgICAgICAgICAgc2VjdXJpdHlJbnZhbGlkKGZpZWxkU2VsZWN0b3IpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBwYXlsb2FkID0ge307XG4gICAgICAgIHBheWxvYWRbZmllbGRdID0gdmFsdWUucmVwbGFjZSgvXFxzKy9nLCAnJyk7XG4gICAgICAgIHZhciBwcmV2aW91cyA9IHN0YXRlLnNldHRpbmdzID8gc3RhdGUuc2V0dGluZ3NbZmllbGRdIDogJyc7XG4gICAgICAgIHNhdmVTZXR0aW5nKHBheWxvYWQsIGZpZWxkU2VsZWN0b3IsIGZ1bmN0aW9uICgpIHsgJChzZWxlY3RvcikudmFsKHByZXZpb3VzKTsgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZVNlY3VyaXR5VGltZShzZWxlY3RvciwgZmllbGRTZWxlY3RvciwgZmllbGQpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gU3RyaW5nKCQoc2VsZWN0b3IpLnZhbCgpIHx8ICcnKS50cmltKCk7XG4gICAgICAgIGlmICghL14oWzAxXVxcZHwyWzAtM10pOlswLTVdXFxkJC8udGVzdCh2YWx1ZSkpIHsgc2VjdXJpdHlJbnZhbGlkKGZpZWxkU2VsZWN0b3IpOyByZXR1cm47IH1cbiAgICAgICAgdmFyIHBheWxvYWQgPSB7fTtcbiAgICAgICAgcGF5bG9hZFtmaWVsZF0gPSB2YWx1ZTtcbiAgICAgICAgdmFyIHByZXZpb3VzID0gc3RhdGUuc2V0dGluZ3MgPyBzdGF0ZS5zZXR0aW5nc1tmaWVsZF0gOiB2YWx1ZTtcbiAgICAgICAgc2F2ZVNldHRpbmcocGF5bG9hZCwgZmllbGRTZWxlY3RvciwgZnVuY3Rpb24gKCkgeyAkKHNlbGVjdG9yKS52YWwocHJldmlvdXMpOyB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlVG9sbE9mZkhvdXJzKCkge1xuICAgICAgICB2YXIgY2hlY2tlZCA9ICQoJyNtaC10b2xsLW9mZmhvdXJzIGlucHV0JykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICBzYXZlU2V0dGluZyh7IHRvbGxfZnJhdWRfb2ZmaG91cnNfZW5hYmxlZDogY2hlY2tlZCB9LCBudWxsLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtdG9sbC1vZmZob3VycyBpbnB1dCcpLnByb3AoJ2NoZWNrZWQnLCAhY2hlY2tlZCk7XG4gICAgICAgICAgICAkKCcjbWgtdG9sbC1vZmZob3VycycpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgIWNoZWNrZWQpO1xuICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVGYWlsZWQnKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZtdENvdW50ZG93bihzZWNvbmRzKSB7XG4gICAgICAgIHZhciB0b3RhbCA9IE1hdGgubWF4KDAsIHBhcnNlSW50KHNlY29uZHMsIDEwKSB8fCAwKTtcbiAgICAgICAgcmV0dXJuIE1hdGguZmxvb3IodG90YWwgLyA2MCkgKyAnOicgKyBwYWQodG90YWwgJSA2MCk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBub3RpZmljYXRpb25zOiBydWxlcyBBUEkgJiBsaXN0IC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGxvYWRSdWxlcyhzaWxlbnQpIHtcbiAgICAgICAgaWYgKCFzaWxlbnQpIHtcbiAgICAgICAgICAgIHN0YXRlLnJ1bGVzTG9hZGVkID0gZmFsc2U7XG4gICAgICAgICAgICByZW5kZXJSdWxlc1NrZWxldG9uKCk7XG4gICAgICAgIH1cbiAgICAgICAgYXBpR2V0KCcvcnVsZXMnLCB7IGxpbWl0OiAyMDAgfSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHN0YXRlLnJ1bGVzID0gZGF0YS5pdGVtcyB8fCBbXTtcbiAgICAgICAgICAgIHN0YXRlLnJ1bGVzTG9hZGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIHN0YXRlLnJ1bGVzRXJyb3IgPSBudWxsO1xuICAgICAgICAgICAgcmVuZGVyUnVsZXMoKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgIHN0YXRlLnJ1bGVzTG9hZGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIHN0YXRlLnJ1bGVzRXJyb3IgPSBmYWlsdXJlO1xuICAgICAgICAgICAgcmVuZGVyUnVsZXMoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyUnVsZXNTa2VsZXRvbigpIHtcbiAgICAgICAgdmFyIHJvdyA9ICc8ZGl2IGNsYXNzPVwibWgtbm90aWYtcm93XCI+PHNwYW4gY2xhc3M9XCJtaC1za2VsXCIgc3R5bGU9XCJ3aWR0aDozNnB4O2hlaWdodDoyMHB4O2JvcmRlci1yYWRpdXM6MTBweFwiPjwvc3Bhbj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjQwJVwiPjwvc3Bhbj48c3Bhbj48L3NwYW4+PHNwYW4+PC9zcGFuPjwvZGl2Pic7XG4gICAgICAgICQoJyNtaC1ydWxlcy1saXN0JykuaHRtbChyb3cgKyByb3cpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNvdXJjZUZvclJ1bGUocnVsZSkge1xuICAgICAgICBpZiAocnVsZS5zb3VyY2VfaWQpIHtcbiAgICAgICAgICAgIHZhciBieUlkID0gc291cmNlQnlJZChydWxlLnNvdXJjZV9pZCk7XG4gICAgICAgICAgICBpZiAoYnlJZCkgeyByZXR1cm4gYnlJZDsgfVxuICAgICAgICB9XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUuc291cmNlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIHR5cGVzID0gc3RhdGUuc291cmNlc1tpXS5ldmVudF90eXBlcyB8fCBbXTtcbiAgICAgICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgdHlwZXMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICAgICAgICBpZiAocnVsZS5ldmVudF90eXBlcyAmJiBydWxlLmV2ZW50X3R5cGVzLmluZGV4T2YodHlwZXNbal0udHlwZSkgPj0gMCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gc3RhdGUuc291cmNlc1tpXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2V0UnVsZUFkZFZpc2libGUodmlzaWJsZSkge1xuICAgICAgICAkKCcjbWgtcnVsZS1hZGQnKS5hdHRyKCdoaWRkZW4nLCB2aXNpYmxlID8gbnVsbCA6IHRydWUpO1xuICAgIH1cblxuICAgIC8vIERlc2lnbiB2MywgwqvQo9Cy0LXQtNC+0LzQu9C10L3QuNGPwrs6IG5vIGJvdCDihpIgcGljayBhIG1lc3NlbmdlcjsgYm90IGJ1dCBubyBub3RpZmljYXRpb25zIOKGkiBvbmUgcHJpbWFyeSBidXR0b247XG4gICAgLy8gb3RoZXJ3aXNlIHRoZSBsaXN0IGdyb3VwZWQg0JfQstC+0L3QutC4IOKGkiDQmNCYINCh0YPQv9C10YDQstCw0LnQt9C10YAg4oaSINCT0L7Qu9C+0YHQvtCy0L7QuSDQsNCz0LXQvdGCIOKGkiDQodCy0Y/Qt9GMINC4INCQ0KLQoSAoaGVhZGluZ3Mgb25seSBmb3IgMisgZ3JvdXBzKS5cbiAgICBmdW5jdGlvbiByZW5kZXJSdWxlcygpIHtcbiAgICAgICAgdmFyICRsaXN0ID0gJCgnI21oLXJ1bGVzLWxpc3QnKTtcbiAgICAgICAgaWYgKCFzdGF0ZS5ydWxlc0xvYWRlZCB8fCAhc3RhdGUuYm90c0xvYWRlZCkge1xuICAgICAgICAgICAgc2V0UnVsZUFkZFZpc2libGUoZmFsc2UpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmIChzdGF0ZS5ydWxlc0Vycm9yICE9PSBudWxsICYmIHN0YXRlLnJ1bGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgc2V0UnVsZUFkZFZpc2libGUoZmFsc2UpO1xuICAgICAgICAgICAgJGxpc3QuaHRtbCgnPGRpdiBjbGFzcz1cInVpIG5lZ2F0aXZlIG1lc3NhZ2VcIiByb2xlPVwiYWxlcnRcIj4nICsgSUNPTl9FUlJPUlxuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ncm93XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlc0xvYWRGYWlsZWQnKSkgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgJzxidXR0b24gY2xhc3M9XCJ1aSBiYXNpYyBidXR0b24gbWgtb24tbWVzc2FnZVwiIHR5cGU9XCJidXR0b25cIiBpZD1cIm1oLXJ1bGVzLXJldHJ5XCI+J1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblJldHJ5JykpICsgJzwvYnV0dG9uPjwvZGl2PicpO1xuICAgICAgICAgICAgJCgnI21oLXJ1bGVzLXJldHJ5Jykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkgeyBsb2FkUnVsZXMoKTsgfSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN0YXRlLmJvdHMubGVuZ3RoID09PSAwICYmIHN0YXRlLnJ1bGVzLmxlbmd0aCA9PT0gMCAmJiBzdGF0ZS5ib3RzRXJyb3IgPT09IG51bGwpIHtcbiAgICAgICAgICAgIHNldFJ1bGVBZGRWaXNpYmxlKGZhbHNlKTtcbiAgICAgICAgICAgICRsaXN0Lmh0bWwoJzxkaXYgY2xhc3M9XCJtaC1vbmJvYXJkXCIgcm9sZT1cInN0YXR1c1wiPidcbiAgICAgICAgICAgICAgICArICc8aDMgY2xhc3M9XCJ1aSBoZWFkZXIgbWgtcGFnZS10aXRsZVwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfT25ib2FyZFRpdGxlJykpICsgJzwvaDM+J1xuICAgICAgICAgICAgICAgICsgbWVzc2VuZ2VyVGlsZXMoKSArICc8L2Rpdj4nKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc3RhdGUucnVsZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBzZXRSdWxlQWRkVmlzaWJsZShmYWxzZSk7XG4gICAgICAgICAgICAkbGlzdC5odG1sKCc8ZGl2IGNsYXNzPVwibWgtZW1wdHkgbWgtZW1wdHktYm94XCIgcm9sZT1cInN0YXR1c1wiPidcbiAgICAgICAgICAgICAgICArICc8aDMgY2xhc3M9XCJ1aSBoZWFkZXIgbWgtcGFnZS10aXRsZVwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZXNFbXB0eVRpdGxlJykpICsgJzwvaDM+J1xuICAgICAgICAgICAgICAgICsgJzxidXR0b24gY2xhc3M9XCJ1aSBwcmltYXJ5IGJ1dHRvblwiIHR5cGU9XCJidXR0b25cIiBkYXRhLWFjdGlvbj1cImFkZFwiPicgKyBJQ09OX1BMVVNcbiAgICAgICAgICAgICAgICArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlc0FkZCcpKSArICc8L2J1dHRvbj48L2Rpdj4nKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBzZXRSdWxlQWRkVmlzaWJsZSh0cnVlKTtcbiAgICAgICAgdmFyIGdyb3VwcyA9IHt9O1xuICAgICAgICBzdGF0ZS5ydWxlcy5mb3JFYWNoKGZ1bmN0aW9uIChydWxlKSB7XG4gICAgICAgICAgICB2YXIgZ3JvdXAgPSBydWxlLmdyb3VwIHx8ICdwYngnO1xuICAgICAgICAgICAgaWYgKEdST1VQX09SREVSLmluZGV4T2YoZ3JvdXApIDwgMCkgeyBncm91cCA9ICdwYngnOyB9XG4gICAgICAgICAgICAoZ3JvdXBzW2dyb3VwXSA9IGdyb3Vwc1tncm91cF0gfHwgW10pLnB1c2gocnVsZSk7XG4gICAgICAgIH0pO1xuICAgICAgICB2YXIgb3JkZXIgPSBHUk9VUF9PUkRFUi5maWx0ZXIoZnVuY3Rpb24gKGdyb3VwKSB7IHJldHVybiBCb29sZWFuKGdyb3Vwc1tncm91cF0pOyB9KTtcbiAgICAgICAgdmFyIGh0bWwgPSAnJztcbiAgICAgICAgaWYgKHN0YXRlLnJ1bGVzRXJyb3IgIT09IG51bGwpIHtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlXCIgcm9sZT1cImFsZXJ0XCI+JyArIElDT05fRVJST1JcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtZ3Jvd1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZXNMb2FkRmFpbGVkJykpICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uIG1oLW9uLW1lc3NhZ2VcIiB0eXBlPVwiYnV0dG9uXCIgaWQ9XCJtaC1ydWxlcy1yZXRyeS1pbmxpbmVcIj4nXG4gICAgICAgICAgICAgICAgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uUmV0cnknKSkgKyAnPC9idXR0b24+PC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICB2YXIgc2hvd0hlYWRpbmdzID0gb3JkZXIubGVuZ3RoID4gMTtcbiAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIm1oLW5vdGlmLWxpc3QnICsgKHNob3dIZWFkaW5ncyA/ICcnIDogJyBpcy1mbGF0JykgKyAnXCIgcm9sZT1cImxpc3RcIj4nO1xuICAgICAgICBvcmRlci5mb3JFYWNoKGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgaWYgKHNob3dIZWFkaW5ncykge1xuICAgICAgICAgICAgICAgIGh0bWwgKz0gJzxoMyBjbGFzcz1cIm1oLWdyb3VwLXRpdGxlXCI+JyArIGVzYyhzb3VyY2VHcm91cE5hbWUoZ3JvdXApKSArICc8L2gzPic7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBncm91cHNbZ3JvdXBdLmZvckVhY2goZnVuY3Rpb24gKHJ1bGUpIHtcbiAgICAgICAgICAgICAgICBodG1sICs9IHJlbmRlclJ1bGVSb3cocnVsZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgICRsaXN0Lmh0bWwoaHRtbCArICc8L2Rpdj4nKTtcbiAgICAgICAgJCgnI21oLXJ1bGVzLXJldHJ5LWlubGluZScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHsgbG9hZFJ1bGVzKCk7IH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJ1bGVDaGFubmVsKHJ1bGUpIHtcbiAgICAgICAgdmFyIGNoYXRzID0gcnVsZS5jaGF0cyB8fCBbXTtcbiAgICAgICAgaWYgKGNoYXRzLmxlbmd0aCA+IDAgJiYgY2hhdHNbMF0uY2hhbm5lbCkge1xuICAgICAgICAgICAgcmV0dXJuIGNoYXRzWzBdLmNoYW5uZWw7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGJvdCA9IGNoYXRzLmxlbmd0aCA+IDAgPyBib3RCeUlkKGNoYXRzWzBdLmJvdF9pZCkgOiAoc3RhdGUuYm90c1swXSB8fCBudWxsKTtcbiAgICAgICAgcmV0dXJuIGJvdCAmJiBib3QuY2hhbm5lbCA9PT0gJ21heCcgPyAnbWF4JyA6ICd0ZWxlZ3JhbSc7XG4gICAgfVxuXG4gICAgLy8gQ29sb3VyIG9ubHkgZm9yIGEgcHJvYmxlbTogdW5hdmFpbGFibGUgc291cmNlLCByZWplY3RlZCB0b2tlbiwgZGVsZXRlZCBib3Qgb3IgY2hhdC5cbiAgICBmdW5jdGlvbiBydWxlUHJvYmxlbUxhYmVsKHJ1bGUpIHtcbiAgICAgICAgdmFyIHNvdXJjZSA9IHNvdXJjZUJ5SWQocnVsZS5zb3VyY2VfaWQpO1xuICAgICAgICBpZiAoc291cmNlICYmIHNvdXJjZS5hdmFpbGFiaWxpdHkgJiYgc291cmNlLmF2YWlsYWJpbGl0eSAhPT0gJ2F2YWlsYWJsZScpIHtcbiAgICAgICAgICAgIHZhciBsYWJlbHMgPSB7XG4gICAgICAgICAgICAgICAgbW9kdWxlX2Rpc2FibGVkOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Tb3VyY2VTdGF0ZU1vZG9mZicpLFxuICAgICAgICAgICAgICAgIG1vZHVsZV9taXNzaW5nOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Tb3VyY2VTdGF0ZU5vaW5zdCcpLFxuICAgICAgICAgICAgICAgIGFwaV9mb3JiaWRkZW46IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX05vdGlmU291cmNlTm9BY2Nlc3MnKSxcbiAgICAgICAgICAgICAgICBhcGlfaW5jb21wYXRpYmxlOiBzb3VyY2VTdGF0ZVRleHQoc291cmNlKSxcbiAgICAgICAgICAgICAgICBkaXNhYmxlZDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU291cmNlU3RhdGVPZmYnKSxcbiAgICAgICAgICAgICAgICBlcnJvcjogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU291cmNlU3RhdGVFcnInKVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGlmIChsYWJlbHNbc291cmNlLmF2YWlsYWJpbGl0eV0pIHtcbiAgICAgICAgICAgICAgICB2YXIgY2xzID0gKHNvdXJjZS5hdmFpbGFiaWxpdHkgPT09ICdtb2R1bGVfZGlzYWJsZWQnIHx8IHNvdXJjZS5hdmFpbGFiaWxpdHkgPT09ICdkaXNhYmxlZCcgfHwgc291cmNlLmF2YWlsYWJpbGl0eSA9PT0gJ2FwaV9pbmNvbXBhdGlibGUnKSA/ICd1aSB5ZWxsb3cgbGFiZWwnIDogJ3VpIHJlZCBsYWJlbCc7XG4gICAgICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIicgKyBjbHMgKyAnXCI+JyArIGVzYyhsYWJlbHNbc291cmNlLmF2YWlsYWJpbGl0eV0pICsgJzwvc3Bhbj4nO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHZhciBjaGF0cyA9IHJ1bGUuY2hhdHMgfHwgW107XG4gICAgICAgIGlmICgocnVsZS5jaGF0X2lkcyB8fCBbXSkubGVuZ3RoID4gY2hhdHMubGVuZ3RoKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCI+JyArIElDT05fRVJST1IgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlCb3REZWxldGVkJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hhdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBib3QgPSBib3RCeUlkKGNoYXRzW2ldLmJvdF9pZCk7XG4gICAgICAgICAgICBpZiAoYm90ICYmIGJvdC5lbmFibGVkICE9PSBmYWxzZSAmJiBib3Quc3RhdHVzID09PSAndG9rZW5faW52YWxpZCcpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCI+JyArIElDT05fRVJST1IgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzVG9rZW5JbnZhbGlkJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChjaGF0cy5sZW5ndGggPiAwICYmIGNoYXRzLmV2ZXJ5KGZ1bmN0aW9uIChjaGF0KSB7IHJldHVybiBjaGF0LnN0YXRlID09PSAnZ29uZSc7IH0pKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCI+JyArIElDT05fRVJST1IgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFN0YXR1c0dvbmUnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyUnVsZVJvdyhydWxlKSB7XG4gICAgICAgIHZhciBwcm9ibGVtID0gcnVsZVByb2JsZW1MYWJlbChydWxlKTtcbiAgICAgICAgdmFyIHJ1bGVGaXJzdCA9IHN0YXRlLnJ1bGVzLmxlbmd0aCA+IDAgJiYgTnVtYmVyKHN0YXRlLnJ1bGVzWzBdLmlkKSA9PT0gTnVtYmVyKHJ1bGUuaWQpO1xuICAgICAgICB2YXIgcnVsZUxhc3QgPSBzdGF0ZS5ydWxlcy5sZW5ndGggPiAwXG4gICAgICAgICAgICAmJiBOdW1iZXIoc3RhdGUucnVsZXNbc3RhdGUucnVsZXMubGVuZ3RoIC0gMV0uaWQpID09PSBOdW1iZXIocnVsZS5pZCk7XG4gICAgICAgIHZhciByaWdodCA9ICcnO1xuICAgICAgICBpZiAocHJvYmxlbSAhPT0gbnVsbCkge1xuICAgICAgICAgICAgcmlnaHQgPSBwcm9ibGVtO1xuICAgICAgICB9IGVsc2UgaWYgKHJ1bGUuZW5hYmxlZCAmJiBydWxlLmxhc3RfZXZlbnRfYXQpIHtcbiAgICAgICAgICAgIHJpZ2h0ID0gJzxzcGFuIGNsYXNzPVwibWgtbXV0ZWRcIj4nICsgZm10Q2VsbFRpbWUocnVsZS5sYXN0X2V2ZW50X2F0KSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICB2YXIgY2hhbm5lbCA9IHJ1bGVDaGFubmVsKHJ1bGUpO1xuXG4gICAgICAgIHJldHVybiAnPGRpdiBjbGFzcz1cIm1oLW5vdGlmLXJvdycgKyAocnVsZS5lbmFibGVkID8gJycgOiAnIGlzLW9mZicpICsgJ1wiIHJvbGU9XCJsaXN0aXRlbVwiIGRhdGEtcnVsZS1pZD1cIicgKyBydWxlLmlkICsgJ1wiPidcbiAgICAgICAgICAgICsgJzxsYWJlbCBjbGFzcz1cInVpIHRvZ2dsZSBjaGVja2JveCcgKyAocnVsZS5lbmFibGVkID8gJyBjaGVja2VkJyA6ICcnKSArICdcIiBhcmlhLWxhYmVsPVwiJyArIGVzYyhydWxlLnRpdGxlKSArICdcIj4nXG4gICAgICAgICAgICArICc8aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgY2xhc3M9XCJoaWRkZW4gbWgtcnVsZS10b2dnbGVcIicgKyAocnVsZS5lbmFibGVkID8gJyBjaGVja2VkJyA6ICcnKSArICc+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC10cmFja1wiPjwvc3Bhbj48L2xhYmVsPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbm90aWYtbWFpblwiPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyIHMgJyArIChjaGFubmVsID09PSAnbWF4JyA/ICdtYXgnIDogJ3RnJykgKyAnXCIgcm9sZT1cImltZ1wiIGFyaWEtbGFiZWw9XCInICsgKGNoYW5uZWwgPT09ICdtYXgnID8gJ01BWCcgOiAnVGVsZWdyYW0nKSArICdcIj4nXG4gICAgICAgICAgICArIChjaGFubmVsID09PSAnbWF4JyA/ICdNQVgnIDogJ1RHJykgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICsgJzxhIGhyZWY9XCIjXCIgY2xhc3M9XCJtaC1ub3RpZi10aXRsZSBtaC10cnVuY2F0ZVwiIGRhdGEtYWN0aW9uPVwiZWRpdFwiPicgKyBlc2MocnVsZS50aXRsZSkgKyAnPC9hPjwvc3Bhbj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW5vdGlmLXN0YXR1c1wiPicgKyByaWdodCArICc8L3NwYW4+J1xuICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLXJ1bGUtbWVudS13cmFwXCI+J1xuICAgICAgICAgICAgKyAnPGJ1dHRvbiBjbGFzcz1cInVpIHRleHQgYnV0dG9uIG1oLXJ1bGUtbWVudS1idG5cIiB0eXBlPVwiYnV0dG9uXCIgZGF0YS1hY3Rpb249XCJtZW51XCIgYXJpYS1sYWJlbD1cIicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZU1lbnVNb3JlJykpICsgJ1wiIGFyaWEtZXhwYW5kZWQ9XCJmYWxzZVwiPidcbiAgICAgICAgICAgICsgJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjxwYXRoIGQ9XCJNMy41IDhoLjAxTTggOGguMDFNMTIuNSA4aC4wMVwiIHN0cm9rZS13aWR0aD1cIjIuNFwiLz48L3N2Zz48L2J1dHRvbj4nXG4gICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtcnVsZS1tZW51XCIgaGlkZGVuPidcbiAgICAgICAgICAgICsgJzxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJlZGl0XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlTWVudUVkaXQnKSkgKyAnPC9hPidcbiAgICAgICAgICAgICsgKHJ1bGVGaXJzdCA/ICcnIDogJzxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJ1cFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZU1lbnVVcCcpKSArICc8L2E+JylcbiAgICAgICAgICAgICsgKHJ1bGVMYXN0ID8gJycgOiAnPGEgaHJlZj1cIiNcIiBkYXRhLWFjdGlvbj1cImRvd25cIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVNZW51RG93bicpKSArICc8L2E+JylcbiAgICAgICAgICAgICsgJzxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJkZWxldGVcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVNZW51RGVsZXRlJykpICsgJzwvYT4nXG4gICAgICAgICAgICArICc8L2Rpdj48L2Rpdj48L2Rpdj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJpbmRSdWxlc0NvbnRhaW5lcigpIHtcbiAgICAgICAgdmFyICR3cmFwID0gJCgnI21oLXJ1bGVzLWxpc3QnKTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImFkZFwiXScsIGZ1bmN0aW9uICgpIHsgb3BlblJ1bGVXaXphcmQobnVsbCk7IH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiYWRkLWJvdFwiXScsIGZ1bmN0aW9uICgpIHsgb3BlbkJvdE1vZGFsKCdhZGQnLCBudWxsLCAkKHRoaXMpLmRhdGEoJ2NoYW5uZWwnKSk7IH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiZWRpdFwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIG9wZW5SdWxlV2l6YXJkKHJ1bGVCeUlkKCQodGhpcykuY2xvc2VzdCgnLm1oLW5vdGlmLXJvdycpLmRhdGEoJ3J1bGUtaWQnKSkpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cIm1lbnVcIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgdmFyICRtZW51ID0gJCh0aGlzKS5zaWJsaW5ncygnLm1oLXJ1bGUtbWVudScpO1xuICAgICAgICAgICAgJCgnLm1oLXJ1bGUtbWVudScpLm5vdCgkbWVudSkucHJvcCgnaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICAgICAkbWVudS5wcm9wKCdoaWRkZW4nLCAhJG1lbnUucHJvcCgnaGlkZGVuJykpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImRlbGV0ZVwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIGNvbmZpcm1EZWxldGVSdWxlKHJ1bGVCeUlkKCQodGhpcykuY2xvc2VzdCgnLm1oLW5vdGlmLXJvdycpLmRhdGEoJ3J1bGUtaWQnKSkpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cInVwXCJdLCBbZGF0YS1hY3Rpb249XCJkb3duXCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgbW92ZVJ1bGUoXG4gICAgICAgICAgICAgICAgJCh0aGlzKS5jbG9zZXN0KCcubWgtbm90aWYtcm93JykuZGF0YSgncnVsZS1pZCcpLFxuICAgICAgICAgICAgICAgICQodGhpcykuZGF0YSgnYWN0aW9uJykgPT09ICd1cCcgPyAtMSA6IDFcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2hhbmdlJywgJy5taC1ydWxlLXRvZ2dsZScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBpZCA9ICQodGhpcykuY2xvc2VzdCgnLm1oLW5vdGlmLXJvdycpLmRhdGEoJ3J1bGUtaWQnKTtcbiAgICAgICAgICAgIHZhciBlbmFibGVkID0gJCh0aGlzKS5wcm9wKCdjaGVja2VkJyk7XG4gICAgICAgICAgICBhcGlQYXRjaCgnL3J1bGVzLycgKyBpZCwgeyBlbmFibGVkOiBlbmFibGVkIH0sIGZ1bmN0aW9uIChydWxlKSB7XG4gICAgICAgICAgICAgICAgcmVwbGFjZVJ1bGUocnVsZSk7XG4gICAgICAgICAgICAgICAgcmVuZGVyUnVsZXMoKTtcbiAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICAgICAgbG9hZFJ1bGVzKHRydWUpO1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdChmYWlsdXJlVGV4dChmYWlsdXJlKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoZG9jdW1lbnQpLm9uKCdjbGljaycsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgaWYgKCQoZXZlbnQudGFyZ2V0KS5jbG9zZXN0KCcubWgtcnVsZS1tZW51LXdyYXAnKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICAkKCcubWgtcnVsZS1tZW51JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGxvYWRQcm92aWRlcnMoZG9uZSkge1xuICAgICAgICBpZiAoc3RhdGUucHJvdmlkZXJzTG9hZGVkKSB7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29yZUdldCgnL3Byb3ZpZGVycycsIHsgbGltaXQ6IDIwMCB9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgdmFyIGl0ZW1zID0gZGF0YS5pdGVtcyB8fCBbXTtcbiAgICAgICAgICAgIHZhciBsaXN0ID0gW107XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGl0ZW1zLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgdmFyIHByb3ZpZGVyID0gaXRlbXNbaV07XG4gICAgICAgICAgICAgICAgdmFyIGlkID0gU3RyaW5nKHByb3ZpZGVyLmlkICE9PSB1bmRlZmluZWQgPyBwcm92aWRlci5pZCA6IChwcm92aWRlci5wcm92aWRlcl9pZCB8fCAnJykpO1xuICAgICAgICAgICAgICAgIGlmIChpZCA9PT0gJycpIHsgY29udGludWU7IH1cbiAgICAgICAgICAgICAgICB2YXIgbGFiZWwgPSBwcm92aWRlci5kZXNjcmlwdGlvbiB8fCBwcm92aWRlci51c2VybmFtZSB8fCAoJyMnICsgaWQpO1xuICAgICAgICAgICAgICAgIGxpc3QucHVzaCh7IGlkOiBpZCwgbGFiZWw6IGxhYmVsIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3RhdGUucHJvdmlkZXJzID0gbGlzdDtcbiAgICAgICAgICAgIHN0YXRlLnByb3ZpZGVyc0xvYWRlZCA9IHRydWU7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLnByb3ZpZGVyc0xvYWRlZCA9IGZhbHNlO1xuICAgICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBtb3ZlUnVsZShpZCwgZGVsdGEpIHtcbiAgICAgICAgdmFyIGlkcyA9IFtdO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLnJ1bGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZHMucHVzaChOdW1iZXIoc3RhdGUucnVsZXNbaV0uaWQpKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgaW5kZXggPSBpZHMuaW5kZXhPZihOdW1iZXIoaWQpKTtcbiAgICAgICAgdmFyIHRhcmdldCA9IGluZGV4ICsgZGVsdGE7XG4gICAgICAgIGlmIChpbmRleCA8IDAgfHwgdGFyZ2V0IDwgMCB8fCB0YXJnZXQgPj0gaWRzLmxlbmd0aCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBzd2FwID0gaWRzW2luZGV4XTtcbiAgICAgICAgaWRzW2luZGV4XSA9IGlkc1t0YXJnZXRdO1xuICAgICAgICBpZHNbdGFyZ2V0XSA9IHN3YXA7XG4gICAgICAgIGFwaVBvc3QoJy9ydWxlczpjaGFuZ2VQcmlvcml0eScsIHsgb3JkZXI6IGlkcyB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBsb2FkUnVsZXModHJ1ZSk7XG4gICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZU9yZGVyU2F2ZWQnKSk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICBzaG93VG9hc3QoZmFpbHVyZVRleHQoZmFpbHVyZSkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBydWxlQnlJZChpZCkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLnJ1bGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAoTnVtYmVyKHN0YXRlLnJ1bGVzW2ldLmlkKSA9PT0gTnVtYmVyKGlkKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzdGF0ZS5ydWxlc1tpXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZXBsYWNlUnVsZShydWxlKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUucnVsZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIoc3RhdGUucnVsZXNbaV0uaWQpID09PSBOdW1iZXIocnVsZS5pZCkpIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5ydWxlc1tpXSA9IHJ1bGU7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHN0YXRlLnJ1bGVzLnB1c2gocnVsZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY29uZmlybURlbGV0ZVJ1bGUocnVsZSkge1xuICAgICAgICBpZiAoIXJ1bGUpIHsgcmV0dXJuOyB9XG4gICAgICAgICQoJyNtaC1jb25maXJtLXRleHQnKS50ZXh0KHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlRGVsZXRlQ29uZmlybScsIHsgdGl0bGU6IHJ1bGUudGl0bGUgfSkpO1xuICAgICAgICAkKCcjbWgtY29uZmlybS1tb2RhbCcpLm1vZGFsKHsgY2xvc2FibGU6IHRydWUgfSkubW9kYWwoJ3Nob3cnKTtcbiAgICAgICAgJCgnI21oLWNvbmZpcm0tb2snKS5vZmYoJ2NsaWNrJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLWNvbmZpcm0tbW9kYWwnKS5tb2RhbCgnaGlkZScpO1xuICAgICAgICAgICAgYXBpRGVsZXRlKCcvcnVsZXMvJyArIHJ1bGUuaWQsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBsb2FkUnVsZXModHJ1ZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vbkRlbGV0ZWQnKSk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdChmYWlsdXJlVGV4dChmYWlsdXJlKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBub3RpZmljYXRpb25zOiB3aXphcmQgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gZW1wdHlGaWx0ZXJzKCkge1xuICAgICAgICByZXR1cm4geyB1c2VyX2lkczogW10sIGRpcmVjdGlvbnM6IFtdLCBwcm92aWRlcnM6IFtdLCBxdWFsaXR5X3Njb3JlOiBudWxsLCByZWFzb25zOiBudWxsIH07XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbm9ybWFsaXplUmV0cmFjdChvcHRpb25zKSB7XG4gICAgICAgIHZhciBjb25maWcgPSBvcHRpb25zICYmIG9wdGlvbnMucmV0cmFjdF9vbl9jYWxsYmFjayAmJiB0eXBlb2Ygb3B0aW9ucy5yZXRyYWN0X29uX2NhbGxiYWNrID09PSAnb2JqZWN0J1xuICAgICAgICAgICAgPyBvcHRpb25zLnJldHJhY3Rfb25fY2FsbGJhY2tcbiAgICAgICAgICAgIDoge307XG4gICAgICAgIHZhciB3aW5kb3cgPSBOdW1iZXIoY29uZmlnLndpbmRvd19taW4pO1xuICAgICAgICBpZiAoIXdpbmRvdyB8fCB3aW5kb3cgPCA1IHx8IHdpbmRvdyA+IDEyMCkge1xuICAgICAgICAgICAgd2luZG93ID0gMjA7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IGNvbmZpZy5lbmFibGVkID09PSB0cnVlLFxuICAgICAgICAgICAgd2luZG93X21pbjogd2luZG93LFxuICAgICAgICAgICAgY291bnRfaW5jb21pbmdfYW5zd2VyZWQ6IGNvbmZpZy5jb3VudF9pbmNvbWluZ19hbnN3ZXJlZCAhPT0gZmFsc2VcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBub3JtYWxpemVGaWx0ZXJzKGZpbHRlcnMpIHtcbiAgICAgICAgdmFyIHJlc3VsdCA9IGVtcHR5RmlsdGVycygpO1xuICAgICAgICBpZiAoIWZpbHRlcnMgfHwgdHlwZW9mIGZpbHRlcnMgIT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZpbHRlcnMudXNlcl9pZHMpKSB7XG4gICAgICAgICAgICByZXN1bHQudXNlcl9pZHMgPSBmaWx0ZXJzLnVzZXJfaWRzLm1hcChOdW1iZXIpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZpbHRlcnMuZGlyZWN0aW9ucykpIHtcbiAgICAgICAgICAgIHJlc3VsdC5kaXJlY3Rpb25zID0gZmlsdGVycy5kaXJlY3Rpb25zLnNsaWNlKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZmlsdGVycy5wcm92aWRlcnMpKSB7XG4gICAgICAgICAgICByZXN1bHQucHJvdmlkZXJzID0gZmlsdGVycy5wcm92aWRlcnMubWFwKFN0cmluZyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZmlsdGVycy5yZWFzb25zKSkge1xuICAgICAgICAgICAgcmVzdWx0LnJlYXNvbnMgPSBmaWx0ZXJzLnJlYXNvbnMubWFwKFN0cmluZyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGZpbHRlcnMucXVhbGl0eV9zY29yZSAmJiB0eXBlb2YgZmlsdGVycy5xdWFsaXR5X3Njb3JlID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgcmVzdWx0LnF1YWxpdHlfc2NvcmUgPSB7fTtcbiAgICAgICAgICAgIGlmIChmaWx0ZXJzLnF1YWxpdHlfc2NvcmUubWluICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQucXVhbGl0eV9zY29yZS5taW4gPSBOdW1iZXIoZmlsdGVycy5xdWFsaXR5X3Njb3JlLm1pbik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoZmlsdGVycy5xdWFsaXR5X3Njb3JlLm1heCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0LnF1YWxpdHlfc2NvcmUubWF4ID0gTnVtYmVyKGZpbHRlcnMucXVhbGl0eV9zY29yZS5tYXgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgLy8gQXVkaW8gYXR0YWNobWVudCBtb2RlIG9mIGEgcnVsZSAoUGxhbi8wNSkuIFRoZSBzdGFnZS0yIGJvb2xlYW4gaXMgbm90IGEgbW9kZSBhbmQgcmVhZHMgYXMgXCJub25lXCIuXG4gICAgZnVuY3Rpb24gbm9ybWFsaXplQXR0YWNobWVudHMob3B0aW9ucykge1xuICAgICAgICB2YXIgdmFsdWUgPSBvcHRpb25zID8gb3B0aW9ucy5hdHRhY2htZW50cyA6IG51bGw7XG4gICAgICAgIHJldHVybiB2YWx1ZSA9PT0gJ2ZyYWdtZW50cycgfHwgdmFsdWUgPT09ICdyZWNvcmRpbmcnID8gdmFsdWUgOiAnbm9uZSc7XG4gICAgfVxuXG4gICAgLy8gTW9kZXMgb2ZmZXJlZCBmb3IgdGhlIHNlbGVjdGVkIGV2ZW50IHR5cGVzOiBvbmx5IGV2ZW50cyB0aGF0IGNhbiBjYXJyeSBhdWRpby5cbiAgICBmdW5jdGlvbiB3aXphcmRBdHRhY2htZW50TW9kZXModHlwZXMpIHtcbiAgICAgICAgaWYgKHR5cGVzLmluZGV4T2YoJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnKSA+PSAwKSB7IHJldHVybiBbJ25vbmUnLCAnZnJhZ21lbnRzJywgJ3JlY29yZGluZyddOyB9XG4gICAgICAgIGlmICh0eXBlcy5pbmRleE9mKCdjb3JlLnZvaWNlbWFpbCcpID49IDApIHsgcmV0dXJuIFsnbm9uZScsICdyZWNvcmRpbmcnXTsgfVxuICAgICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZW5zdXJlV2l6YXJkRGF0YSgpIHtcbiAgICAgICAgbG9hZEVtcGxveWVlcyhmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoc3RhdGUucnVsZVdpemFyZCAmJiBzdGF0ZS5ydWxlV2l6YXJkLnN0ZXAgPT09IDIpIHsgcmVuZGVyV2l6YXJkQ29uZGl0aW9ucygpOyB9XG4gICAgICAgIH0pO1xuICAgICAgICBsb2FkUHJvdmlkZXJzKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5ydWxlV2l6YXJkICYmIHN0YXRlLnJ1bGVXaXphcmQuc3RlcCA9PT0gMikgeyByZW5kZXJXaXphcmRDb25kaXRpb25zKCk7IH1cbiAgICAgICAgfSk7XG4gICAgICAgIGlmICghc3RhdGUuYm90c0xvYWRlZCkge1xuICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBvcGVuUnVsZVdpemFyZChydWxlKSB7XG4gICAgICAgIGVuc3VyZVdpemFyZERhdGEoKTtcbiAgICAgICAgdmFyIHNvdXJjZSA9IHJ1bGUgPyBzb3VyY2VGb3JSdWxlKHJ1bGUpIDogbnVsbDtcbiAgICAgICAgdmFyIHJ1bGVUeXBlcyA9IHJ1bGUgPyAocnVsZS5ldmVudF90eXBlcyB8fCBbXSkuc2xpY2UoKSA6IFtdO1xuICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkID0ge1xuICAgICAgICAgICAgc3RlcDogcnVsZSA/IGZpcnN0U3RlcEFmdGVyU2NlbmFyaW8oKHJ1bGUuZXZlbnRfdHlwZXMgfHwgW10pLnNsaWNlKCkpIDogMSxcbiAgICAgICAgICAgIGVkaXRJZDogcnVsZSA/IE51bWJlcihydWxlLmlkKSA6IDAsXG4gICAgICAgICAgICBzb3VyY2VJZDogc291cmNlID8gc291cmNlLmlkIDogJycsXG4gICAgICAgICAgICBldmVudFR5cGVzOiBydWxlVHlwZXMsXG4gICAgICAgICAgICB0aXRsZTogcnVsZSA/IHJ1bGUudGl0bGUgOiAnJyxcbiAgICAgICAgICAgIGZpbHRlcnM6IG5vcm1hbGl6ZUZpbHRlcnMocnVsZSA/IHJ1bGUuZmlsdGVycyA6IG51bGwpLFxuICAgICAgICAgICAgcmVjb3ZlcjogcnVsZSA/IHdpemFyZEhhc1JlY292ZXJ5KHJ1bGVUeXBlcykgOiB0cnVlLFxuICAgICAgICAgICAgbWluU2V2ZXJpdHk6IHJ1bGUgJiYgcnVsZS5taW5fc2V2ZXJpdHkgPT09ICdjcml0aWNhbCcgPyAnY3JpdGljYWwnIDogJ3dhcm5pbmcnLFxuICAgICAgICAgICAgdGFyZ2V0TW9kZTogcnVsZSA/IHJ1bGUudGFyZ2V0X21vZGUgOiAnZW1wbG95ZWVfb3JfcmVjaXBpZW50cycsXG4gICAgICAgICAgICBjaGF0SWRzOiBydWxlXG4gICAgICAgICAgICAgICAgPyAocnVsZS5jaGF0X2lkcyB8fCBbXSkubWFwKE51bWJlcikuZmlsdGVyKGZ1bmN0aW9uIChpZCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gKHJ1bGUuY2hhdHMgfHwgW10pLnNvbWUoZnVuY3Rpb24gKGNoYXQpIHsgcmV0dXJuIE51bWJlcihjaGF0LmlkKSA9PT0gaWQ7IH0pO1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgOiBbXSxcbiAgICAgICAgICAgIG1hc2s6IHJ1bGUgPyAhIShydWxlLm9wdGlvbnMgJiYgcnVsZS5vcHRpb25zLm1hc2tfcGhvbmUgPT09IHRydWUpXG4gICAgICAgICAgICAgICAgOiAhIShzdGF0ZS5zZXR0aW5ncyAmJiBzdGF0ZS5zZXR0aW5ncy5tYXNrX3Bob25lX2RlZmF1bHQgPT09IHRydWUpLFxuICAgICAgICAgICAgcmV0cmFjdDogbm9ybWFsaXplUmV0cmFjdChydWxlID8gcnVsZS5vcHRpb25zIDogbnVsbCksXG4gICAgICAgICAgICBhdHRhY2htZW50czogbm9ybWFsaXplQXR0YWNobWVudHMocnVsZSA/IHJ1bGUub3B0aW9ucyA6IG51bGwpLFxuICAgICAgICAgICAgYm90SWQ6IHJ1bGUgJiYgcnVsZS5jaGF0cyAmJiBydWxlLmNoYXRzLmxlbmd0aCA+IDAgPyBOdW1iZXIocnVsZS5jaGF0c1swXS5ib3RfaWQpIDogMCxcbiAgICAgICAgICAgIGVycm9yOiAnJ1xuICAgICAgICB9O1xuICAgICAgICB2YXIgb3BlbmVkID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgaWYgKHJ1bGUgJiYgd2l6YXJkU3VwcG9ydHNSZWFzb25zKG9wZW5lZC5ldmVudFR5cGVzKSAmJiBvcGVuZWQuZmlsdGVycy5yZWFzb25zID09PSBudWxsKSB7XG4gICAgICAgICAgICBvcGVuZWQuZmlsdGVycy5yZWFzb25zID0gY2xvdWRBaVJlYXNvbnModHJ1ZSk7IC8vIG5vIGZpbHRlciA9IGV2ZXJ5IHJlYXNvbiwgaW5jbHVkaW5nIGEgbWFudWFsIHBhdXNlXG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLXJ1bGVzLXZpZXcnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgJCgnI21oLXdpemFyZCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAkKCcjbWVzc2VuZ2VyLWh1Yi1yb290JykuYWRkQ2xhc3MoJ21oLXdpemFyZC1vcGVuJyk7XG4gICAgICAgIGNsZWFyV2l6YXJkRXJyb3IoKTtcbiAgICAgICAgcmVuZGVyV2l6YXJkKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2xvc2VSdWxlV2l6YXJkKCkge1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXByZXZpZXcsICNtaC13aXphcmQtcHJldmlldy10YXJnZXQnKS5lbXB0eSgpO1xuICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkID0gbnVsbDtcbiAgICAgICAgJCgnI21oLXdpemFyZCcpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAkKCcjbWgtcnVsZXMtdmlldycpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAkKCcjbWVzc2VuZ2VyLWh1Yi1yb290JykucmVtb3ZlQ2xhc3MoJ21oLXdpemFyZC1vcGVuJyk7XG4gICAgICAgIHJlbmRlclJ1bGVzKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2l6YXJkU2NlbmFyaW8oKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgcmV0dXJuIHcgJiYgdy5zb3VyY2VJZCA/IHNvdXJjZUJ5SWQody5zb3VyY2VJZCkgOiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHdpemFyZFN1cHBvcnRzRW1wbG95ZWVzKHR5cGVzKSB7XG4gICAgICAgIHZhciBjYWxsVHlwZXMgPSBbJ2NvcmUubWlzc2VkX2NhbGwnLCAnYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCddO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHR5cGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAoY2FsbFR5cGVzLmluZGV4T2YodHlwZXNbaV0pID49IDApIHsgcmV0dXJuIHRydWU7IH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2l6YXJkU3VwcG9ydHNEaXJlY3Rpb25zKHR5cGVzKSB7XG4gICAgICAgIHJldHVybiB0eXBlcy5pbmRleE9mKCdjb3JlLm1pc3NlZF9jYWxsJykgPj0gMCB8fCB0eXBlcy5pbmRleE9mKCdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJykgPj0gMDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRTdXBwb3J0c1Byb3ZpZGVycyh0eXBlcykge1xuICAgICAgICByZXR1cm4gdHlwZXMuaW5kZXhPZignY29yZS5wcm92aWRlcl9kb3duJykgPj0gMCB8fCB0eXBlcy5pbmRleE9mKCdjb3JlLnByb3ZpZGVyX3VwJykgPj0gMDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRIYXNSZWNvdmVyeSh0eXBlcykge1xuICAgICAgICByZXR1cm4gT2JqZWN0LmtleXMoU1RBVFVTX1BBSVJTKS5zb21lKGZ1bmN0aW9uIChwcm9ibGVtKSB7IHJldHVybiB0eXBlcy5pbmRleE9mKFNUQVRVU19QQUlSU1twcm9ibGVtXSkgPj0gMDsgfSk7XG4gICAgfVxuXG4gICAgLy8gQSBtb2R1bGUgc3RhdHVzIHNjZW5hcmlvIChwcm9ibGVtIGFuZC9vciBpdHMgcmVjb3ZlcnkpOiBzdGVwIDIgb2ZmZXJzIMKr0KHQvtC+0LHRidCw0YLRjCDQviDQstC+0YHRgdGC0LDQvdC+0LLQu9C10L3QuNC4wrsuXG4gICAgZnVuY3Rpb24gd2l6YXJkSGFzU3RhdHVzKHR5cGVzKSB7XG4gICAgICAgIHJldHVybiB3aXphcmRIYXNSZWNvdmVyeSh0eXBlcykgfHwgT2JqZWN0LmtleXMoU1RBVFVTX1BBSVJTKS5zb21lKGZ1bmN0aW9uIChwcm9ibGVtKSB7IHJldHVybiB0eXBlcy5pbmRleE9mKHByb2JsZW0pID49IDA7IH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHdpemFyZFN1cHBvcnRzUmVhc29ucyh0eXBlcykge1xuICAgICAgICByZXR1cm4gdHlwZXMuaW5kZXhPZignY2xvdWRfYWkucGF1c2VkJykgPj0gMCB8fCB0eXBlcy5pbmRleE9mKCdjbG91ZF9haS5yZXN1bWVkJykgPj0gMDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRTdXBwb3J0c1NldmVyaXR5KHR5cGVzKSB7XG4gICAgICAgIHJldHVybiB0eXBlcy5pbmRleE9mKCdjbG91ZF9zdHQuaW5jaWRlbnQnKSA+PSAwO1xuICAgIH1cblxuICAgIC8vIEFkZHMgb3IgcmVtb3ZlcyB0aGUgcmVjb3ZlcnkgdHlwZSBvZiBldmVyeSBwcm9ibGVtIHR5cGUgaW4gdGhlIGxpc3QuXG4gICAgZnVuY3Rpb24gd2l6YXJkV2l0aFJlY292ZXJ5KHR5cGVzLCBvbikge1xuICAgICAgICB2YXIgcmVjb3ZlcmllcyA9IE9iamVjdC5rZXlzKFNUQVRVU19QQUlSUykubWFwKGZ1bmN0aW9uIChwcm9ibGVtKSB7IHJldHVybiBTVEFUVVNfUEFJUlNbcHJvYmxlbV07IH0pO1xuICAgICAgICB2YXIgcmVzdWx0ID0gdHlwZXMuZmlsdGVyKGZ1bmN0aW9uICh0eXBlKSB7IHJldHVybiByZWNvdmVyaWVzLmluZGV4T2YodHlwZSkgPCAwOyB9KTtcbiAgICAgICAgaWYgKG9uKSB7XG4gICAgICAgICAgICByZXN1bHQuc2xpY2UoKS5mb3JFYWNoKGZ1bmN0aW9uICh0eXBlKSB7XG4gICAgICAgICAgICAgICAgaWYgKFNUQVRVU19QQUlSU1t0eXBlXSAmJiByZXN1bHQuaW5kZXhPZihTVEFUVVNfUEFJUlNbdHlwZV0pIDwgMCkgeyByZXN1bHQucHVzaChTVEFUVVNfUEFJUlNbdHlwZV0pOyB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIC8vIFN0ZXAgMiBleGlzdHMgb25seSBmb3Igc2NlbmFyaW9zIHdpdGggY29uZGl0aW9uczsgdGhlIG90aGVycyBnbyBzdHJhaWdodCB0byDCq9Ca0YPQtNCwINC+0YLQv9GA0LDQstC40YLRjMK7LlxuICAgIGZ1bmN0aW9uIHdpemFyZEhhc0NvbmRpdGlvbnModHlwZXMpIHtcbiAgICAgICAgcmV0dXJuIHdpemFyZFN1cHBvcnRzRW1wbG95ZWVzKHR5cGVzKSB8fCB3aXphcmRTdXBwb3J0c0RpcmVjdGlvbnModHlwZXMpIHx8IHdpemFyZFN1cHBvcnRzUHJvdmlkZXJzKHR5cGVzKVxuICAgICAgICAgICAgfHwgd2l6YXJkSGFzU3RhdHVzKHR5cGVzKVxuICAgICAgICAgICAgfHwgdHlwZXMuaW5kZXhPZignY29yZS5taXNzZWRfY2FsbCcpID49IDAgfHwgdHlwZXMuaW5kZXhPZignYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCcpID49IDA7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZmlyc3RTdGVwQWZ0ZXJTY2VuYXJpbyh0eXBlcykge1xuICAgICAgICByZXR1cm4gd2l6YXJkSGFzQ29uZGl0aW9ucyh0eXBlcykgPyAyIDogMztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJXaXphcmQoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICAkKCcjbWgtd2l6YXJkLXN0ZXAtMScpLmF0dHIoJ2hpZGRlbicsIHcuc3RlcCAhPT0gMSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtc3RlcC0yJykuYXR0cignaGlkZGVuJywgdy5zdGVwICE9PSAyKTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1zdGVwLTMnKS5hdHRyKCdoaWRkZW4nLCB3LnN0ZXAgIT09IDMpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkJykuYXR0cignZGF0YS1zdGVwJywgU3RyaW5nKHcuc3RlcCkpO1xuICAgICAgICB2YXIgc2NlbmFyaW8gPSB3aXphcmRTY2VuYXJpbygpO1xuICAgICAgICB2YXIgdGl0bGU7XG4gICAgICAgIGlmICh3LnN0ZXAgPT09IDEpIHtcbiAgICAgICAgICAgIHRpdGxlID0gdy5lZGl0SWQgPiAwID8gdy50aXRsZSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFRpdGxlJyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aXRsZSA9IHcuZWRpdElkID4gMCA/IHcudGl0bGUgOiAoc2NlbmFyaW8gPyBzY2VuYXJpby5uYW1lIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkVGl0bGUnKSk7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLXdpemFyZC10aXRsZScpLnRleHQodGl0bGUpO1xuICAgICAgICAvLyBvbmUgYmFzaWMgYnV0dG9uIG9uIHRoZSBsZWZ0OiDCq9Ce0YLQvNC10L3QsMK7IG9uIHRoZSBmaXJzdCBzdGVwLCDCq9Cd0LDQt9Cw0LTCuyBhZnRlciBpdFxuICAgICAgICB2YXIgY2FuR29CYWNrID0gdy5zdGVwID4gMSAmJiAhKHcuZWRpdElkID4gMCAmJiB3LnN0ZXAgPT09IGZpcnN0U3RlcEFmdGVyU2NlbmFyaW8ody5ldmVudFR5cGVzKSAmJiB3LnNvdXJjZUlkID09PSAnJyk7XG4gICAgICAgICQoJyNtaC13aXphcmQtcHJldicpLnRleHQody5zdGVwID09PSAxID8gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkQ2FuY2VsJykgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRCYWNrQnV0dG9uJykpXG4gICAgICAgICAgICAuZGF0YSgnbW9kZScsIGNhbkdvQmFjayA/ICdiYWNrJyA6ICdjYW5jZWwnKTtcbiAgICAgICAgdmFyIGlzTGFzdCA9IHcuc3RlcCA9PT0gMztcbiAgICAgICAgJCgnI21oLXdpemFyZC1uZXh0JykudGV4dChpc0xhc3RcbiAgICAgICAgICAgID8gKHcuZWRpdElkID4gMCA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFNhdmUnKSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZENyZWF0ZScpKVxuICAgICAgICAgICAgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmROZXh0JykpO1xuICAgICAgICBpZiAody5zdGVwID09PSAxKSB7IHJlbmRlcldpemFyZFNjZW5hcmlvcygpOyB9XG4gICAgICAgIGlmICh3LnN0ZXAgPT09IDIpIHsgcmVuZGVyV2l6YXJkQ29uZGl0aW9ucygpOyB9XG4gICAgICAgIGlmICh3LnN0ZXAgPT09IDMpIHsgcmVuZGVyV2l6YXJkUmVjaXBpZW50cygpOyB9XG4gICAgICAgIHVwZGF0ZVdpemFyZE5leHQoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB1cGRhdGVXaXphcmROZXh0KCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgdmFyIGRpc2FibGVkID0gdy5zdGVwID09PSAxICYmIHcuc291cmNlSWQgPT09ICcnO1xuICAgICAgICBpZiAody5zdGVwID09PSAzKSB7XG4gICAgICAgICAgICBkaXNhYmxlZCA9IGFjdGl2ZVdpemFyZEJvdCgpID09PSBudWxsO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC13aXphcmQtbmV4dCcpLnByb3AoJ2Rpc2FibGVkJywgZGlzYWJsZWQpLnRvZ2dsZUNsYXNzKCdkaXNhYmxlZCcsIGRpc2FibGVkKTtcbiAgICB9XG5cbiAgICAvLyBPbmUgaWNvbiBwZXIgc2NlbmFyaW8gKGRlc2lnbiB2Mywgc3RlcCAxKS5cbiAgICB2YXIgU0NFTkFSSU9fSUNPTlMgPSB7XG4gICAgICAgIHBob25lOiAnPHBhdGggZD1cIk00LjUgMi41aDJsMSAzLTEuNSAxYTggOCAwIDAgMCAzLjUgMy41bDEtMS41IDMgMXYyYTEuNSAxLjUgMCAwIDEtMS41IDEuNUExMC41IDEwLjUgMCAwIDEgMyA0YTEuNSAxLjUgMCAwIDEgMS41LTEuNXpcIi8+JyxcbiAgICAgICAgbWljOiAnPHJlY3QgeD1cIjZcIiB5PVwiMlwiIHdpZHRoPVwiNFwiIGhlaWdodD1cIjcuNVwiIHJ4PVwiMlwiLz48cGF0aCBkPVwiTTMuNSA4YTQuNSA0LjUgMCAwIDAgOSAwTTggMTIuNVYxNFwiLz4nLFxuICAgICAgICBzcGFya2xlOiAnPHBhdGggZD1cIk04IDJ2M004IDExdjNNMiA4aDNNMTEgOGgzTTMuOCAzLjhsMiAyTTEwLjIgMTAuMmwyIDJNMy44IDEyLjJsMi0yTTEwLjIgNS44bDItMlwiLz4nLFxuICAgICAgICByb2JvdDogJzxyZWN0IHg9XCIzXCIgeT1cIjVcIiB3aWR0aD1cIjEwXCIgaGVpZ2h0PVwiOFwiIHJ4PVwiMlwiLz48cGF0aCBkPVwiTTggMi41VjVNNiA5aC4wMU0xMCA5aC4wMVwiLz4nLFxuICAgICAgICBzZXJ2ZXI6ICc8cmVjdCB4PVwiMi41XCIgeT1cIjNcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiNFwiIHJ4PVwiMVwiLz48cmVjdCB4PVwiMi41XCIgeT1cIjlcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiNFwiIHJ4PVwiMVwiLz48cGF0aCBkPVwiTTUgNWguMDFNNSAxMWguMDFcIi8+JyxcbiAgICAgICAgd2FybmluZzogJzxwYXRoIGQ9XCJNOCAyLjVsNiAxMC41SDJ6XCIvPjxwYXRoIGQ9XCJNOCA2LjV2M004IDExLjJ2LjFcIi8+JyxcbiAgICAgICAgYm9sdDogJzxwYXRoIGQ9XCJNOSAxLjVMMy41IDlIOGwtMSA1LjVMMTIuNSA3SDh6XCIvPicsXG4gICAgICAgIGdlYXI6ICc8Y2lyY2xlIGN4PVwiOFwiIGN5PVwiOFwiIHI9XCIyLjJcIi8+PHBhdGggZD1cIk04IDEuOHYxLjdNOCAxMi41djEuN00xLjggOGgxLjdNMTIuNSA4aDEuN00zLjYgMy42bDEuMiAxLjJNMTEuMiAxMS4ybDEuMiAxLjJNMy42IDEyLjRsMS4yLTEuMk0xMS4yIDQuOGwxLjItMS4yXCIvPicsXG4gICAgICAgIGdsb2JlOiAnPGNpcmNsZSBjeD1cIjhcIiBjeT1cIjhcIiByPVwiNlwiLz48cGF0aCBkPVwiTTIgOGgxMk04IDJjMS43IDEuOCAyLjYgMy44IDIuNiA2UzkuNyAxMi4yIDggMTRjLTEuNy0xLjgtMi42LTMuOC0yLjYtNlM2LjMgMy44IDggMnpcIi8+JyxcbiAgICAgICAga2V5OiAnPGNpcmNsZSBjeD1cIjUuNVwiIGN5PVwiOFwiIHI9XCIyLjVcIi8+PHBhdGggZD1cIk04IDhoNk0xMiA4djIuNU0xMCA4djJcIi8+JyxcbiAgICAgICAgc2hpZWxkOiAnPHBhdGggZD1cIk04IDJsNSAydjRjMCAzLTIuMyA1LTUgNi0yLjctMS01LTMtNS02VjR6XCIvPjxwYXRoIGQ9XCJNNi4yIDhsMS4zIDEuM0wxMCA2LjhcIi8+J1xuICAgIH07XG4gICAgdmFyIFNDRU5BUklPX0lDT05fQllfU09VUkNFID0ge1xuICAgICAgICAnY29yZS5taXNzZWRfY2FsbCc6ICdwaG9uZScsXG4gICAgICAgICdjb3JlLnZvaWNlbWFpbCc6ICdtaWMnLFxuICAgICAgICAnY29yZS5xdWV1ZV9hYmFuZG9uZWQnOiAncGhvbmUnLFxuICAgICAgICAnY29yZS5jYWxsX291dF9vZl9ob3Vycyc6ICd3YXJuaW5nJyxcbiAgICAgICAgJ2NvcmUucGFya190aW1lb3V0JzogJ3Bob25lJyxcbiAgICAgICAgJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnOiAnc3BhcmtsZScsXG4gICAgICAgICdhaV9zdXBlcnZpc29yLndvcmtlcnMnOiAncm9ib3QnLFxuICAgICAgICAnbG9jYWxfc3R0LndvcmtlcnMnOiAnbWljJyxcbiAgICAgICAgJ2xvY2FsX3N0dC5iYWNrbG9nJzogJ21pYycsXG4gICAgICAgICdjbG91ZF9zdHQuaW5jaWRlbnRzJzogJ21pYycsXG4gICAgICAgICdjbG91ZF9zdHQucGF1c2VkJzogJ21pYycsXG4gICAgICAgICdjbG91ZF9haS5wYXVzZWQnOiAnc3BhcmtsZScsXG4gICAgICAgICd2b2ljZV9hZ2VudC5jYWxsYmFja3MnOiAncGhvbmUnLFxuICAgICAgICAndm9pY2VfYWdlbnQucnVudGltZSc6ICdyb2JvdCcsXG4gICAgICAgICdjb3JlLnByb3ZpZGVyX3N0YXR1cyc6ICdzZXJ2ZXInLFxuICAgICAgICAnY29yZS5hZHZpY2UnOiAnd2FybmluZycsXG4gICAgICAgICdjb3JlLnBieF9zdGFydGVkJzogJ2JvbHQnLFxuICAgICAgICAnY29yZS5jb25maWdfY2hhbmdlZCc6ICdnZWFyJyxcbiAgICAgICAgJ2NvcmUuZXh0ZXJuYWxfaXBfY2hhbmdlZCc6ICdnbG9iZScsXG4gICAgICAgICdjb3JlLmxpY2Vuc2VfZXhwaXJpbmcnOiAna2V5JyxcbiAgICAgICAgJ2NvcmUudG9sbF9mcmF1ZCc6ICd3YXJuaW5nJyxcbiAgICAgICAgJ2NvcmUuZXh0ZW5zaW9uX25ld19kZXZpY2UnOiAnc2hpZWxkJyxcbiAgICAgICAgJ2NvcmUuc2lwX2F1dGhfZmFpbHVyZXMnOiAnc2hpZWxkJ1xuICAgIH07XG5cbiAgICBmdW5jdGlvbiBzY2VuYXJpb0ljb24oc291cmNlSWQpIHtcbiAgICAgICAgdmFyIHBhdGhzID0gU0NFTkFSSU9fSUNPTlNbU0NFTkFSSU9fSUNPTl9CWV9TT1VSQ0Vbc291cmNlSWRdIHx8ICd3YXJuaW5nJ107XG4gICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1zY2VuYXJpby1pY29uXCI+PHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+JyArIHBhdGhzICsgJzwvc3ZnPjwvc3Bhbj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlcldpemFyZFNjZW5hcmlvcygpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICB2YXIgZ3JvdXBzID0gR1JPVVBfT1JERVIuZmlsdGVyKGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgcmV0dXJuIHN0YXRlLnNvdXJjZXMuc29tZShmdW5jdGlvbiAoc291cmNlKSB7IHJldHVybiBzb3VyY2UuZ3JvdXAgPT09IGdyb3VwOyB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIHZhciBodG1sID0gJyc7XG4gICAgICAgIGdyb3Vwcy5mb3JFYWNoKGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgdmFyIHNvdXJjZXMgPSBzdGF0ZS5zb3VyY2VzLmZpbHRlcihmdW5jdGlvbiAoc291cmNlKSB7IHJldHVybiBzb3VyY2UuZ3JvdXAgPT09IGdyb3VwOyB9KTtcbiAgICAgICAgICAgIGlmIChncm91cHMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgICAgIGh0bWwgKz0gJzxoMyBjbGFzcz1cIm1oLWdyb3VwLXRpdGxlXCI+JyArIGVzYyhzb3VyY2VHcm91cE5hbWUoZ3JvdXApKSArICc8L2gzPic7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwibWgtc2NlbmFyaW8tZ3JpZFwiPic7XG4gICAgICAgICAgICBzb3VyY2VzLmZvckVhY2goZnVuY3Rpb24gKHNvdXJjZSkge1xuICAgICAgICAgICAgICAgIHZhciBkaXNhYmxlZCA9IFsnbW9kdWxlX21pc3NpbmcnLCAnbW9kdWxlX2Rpc2FibGVkJywgJ2FwaV9mb3JiaWRkZW4nLCAnYXBpX2luY29tcGF0aWJsZScsICdlcnJvcicsICdkaXNhYmxlZCddXG4gICAgICAgICAgICAgICAgICAgIC5pbmRleE9mKHNvdXJjZS5hdmFpbGFiaWxpdHkpID49IDA7XG4gICAgICAgICAgICAgICAgdmFyIHNlbGVjdGVkID0gdy5zb3VyY2VJZCA9PT0gc291cmNlLmlkO1xuICAgICAgICAgICAgICAgIC8vIFVuYXZhaWxhYmxlIHNjZW5hcmlvOiBvbmx5IHRoZSByZWFzb24sIG5vIGFjdGlvbiAodXNlciBkZWNpc2lvbiBRMTQpLlxuICAgICAgICAgICAgICAgIGh0bWwgKz0gJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwibWgtc2NlbmFyaW8nICsgKGRpc2FibGVkID8gJyBpcy1kaXNhYmxlZCcgOiAnJykgKyAoc2VsZWN0ZWQgPyAnIGlzLXNlbGVjdGVkJyA6ICcnKVxuICAgICAgICAgICAgICAgICAgICArICdcIiBkYXRhLXNvdXJjZS1pZD1cIicgKyBlc2Moc291cmNlLmlkKSArICdcIiBhcmlhLXByZXNzZWQ9XCInICsgKHNlbGVjdGVkID8gJ3RydWUnIDogJ2ZhbHNlJykgKyAnXCInXG4gICAgICAgICAgICAgICAgICAgICsgKGRpc2FibGVkID8gJyBkaXNhYmxlZCBhcmlhLWRpc2FibGVkPVwidHJ1ZVwiJyA6ICcnKSArICc+J1xuICAgICAgICAgICAgICAgICAgICArIHNjZW5hcmlvSWNvbihzb3VyY2UuaWQpXG4gICAgICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtc2NlbmFyaW8tdGV4dFwiPjxiPicgKyBlc2Moc291cmNlLm5hbWUpICsgJzwvYj4nXG4gICAgICAgICAgICAgICAgICAgICsgKGRpc2FibGVkID8gJzxzcGFuIGNsYXNzPVwibWgtbWV0YVwiPicgKyBlc2Moc291cmNlU3RhdGVUZXh0KHNvdXJjZSkpICsgJzwvc3Bhbj4nIDogJycpXG4gICAgICAgICAgICAgICAgICAgICsgJzwvc3Bhbj48L2J1dHRvbj4nO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBodG1sICs9ICc8L2Rpdj4nO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1zY2VuYXJpb3MnKS5odG1sKGh0bWwpO1xuICAgIH1cblxuICAgIC8vIC0tLS0gc3RlcCAyOiBjb25kaXRpb25zIChubyBoaW50czsgYW4gZW1wdHkgY2hvaWNlIG1lYW5zIMKr0LLRgdC1wrspIC0tLS1cblxuICAgIGZ1bmN0aW9uIHJlbmRlcldpemFyZENvbmRpdGlvbnMoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICB2YXIgaHRtbCA9ICcnO1xuICAgICAgICBpZiAod2l6YXJkU3VwcG9ydHNFbXBsb3llZXMody5ldmVudFR5cGVzKSkge1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImZpZWxkJyArIChzdGF0ZS5lbXBsb3llZXNGYWlsZWQgPyAnIGVycm9yJyA6ICcnKSArICdcIiBpZD1cIm1oLWNvbmQtZW1wbG95ZWVzLWZpZWxkXCI+J1xuICAgICAgICAgICAgICAgICsgJzxsYWJlbD4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZEVtcGxveWVlcycpKSArICc8L2xhYmVsPidcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwidWkgbXVsdGlwbGUgc2VhcmNoIHNlbGVjdGlvbiBkcm9wZG93biBtaC1jb25kLWRyb3Bkb3duXCIgaWQ9XCJtaC1jb25kLWVtcGxveWVlc1wiIHRhYmluZGV4PVwiMFwiPidcbiAgICAgICAgICAgICAgICArICc8aW5wdXQgdHlwZT1cImhpZGRlblwiPjxzcGFuIGNsYXNzPVwiZGVmYXVsdCB0ZXh0XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9GaWx0ZXJBbGwnKSkgKyAnPC9zcGFuPjxkaXYgY2xhc3M9XCJtZW51XCI+PC9kaXY+PC9kaXY+J1xuICAgICAgICAgICAgICAgICsgKHN0YXRlLmVtcGxveWVlc0ZhaWxlZFxuICAgICAgICAgICAgICAgICAgICA/ICc8c3BhbiBjbGFzcz1cIm1oLWhlbHBcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZExpc3RGYWlsZWQnKSlcbiAgICAgICAgICAgICAgICAgICAgICAgICsgJyA8YSBocmVmPVwiI1wiIGRhdGEtYWN0aW9uPVwicmV0cnktZW1wbG95ZWVzXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25SZXRyeScpKSArICc8L2E+PC9zcGFuPidcbiAgICAgICAgICAgICAgICAgICAgOiAnJylcbiAgICAgICAgICAgICAgICArICc8L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3aXphcmRTdXBwb3J0c0RpcmVjdGlvbnMody5ldmVudFR5cGVzKSkge1xuICAgICAgICAgICAgdmFyIGRpcmVjdGlvbnMgPSBbXG4gICAgICAgICAgICAgICAgWydpbmNvbWluZycsICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmREaXJlY3Rpb25JbmNvbWluZyddLFxuICAgICAgICAgICAgICAgIFsnb3V0Z29pbmcnLCAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkRGlyZWN0aW9uT3V0Z29pbmcnXSxcbiAgICAgICAgICAgICAgICBbJ2ludGVybmFsJywgJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZERpcmVjdGlvbkludGVybmFsJ11cbiAgICAgICAgICAgIF07XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZmllbGRcIj48bGFiZWw+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmREaXJlY3Rpb25zJykpICsgJzwvbGFiZWw+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1zZWdcIiByb2xlPVwiZ3JvdXBcIiBhcmlhLWxhYmVsPVwiJyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmREaXJlY3Rpb25zJykpICsgJ1wiPic7XG4gICAgICAgICAgICBkaXJlY3Rpb25zLmZvckVhY2goZnVuY3Rpb24gKHBhaXIpIHtcbiAgICAgICAgICAgICAgICB2YXIgcHJlc3NlZCA9IHcuZmlsdGVycy5kaXJlY3Rpb25zLmluZGV4T2YocGFpclswXSkgPj0gMDtcbiAgICAgICAgICAgICAgICBodG1sICs9ICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBkYXRhLWRpcmVjdGlvbj1cIicgKyBwYWlyWzBdICsgJ1wiIGFyaWEtcHJlc3NlZD1cIicgKyAocHJlc3NlZCA/ICd0cnVlJyA6ICdmYWxzZScpICsgJ1wiPidcbiAgICAgICAgICAgICAgICAgICAgKyBlc2ModChwYWlyWzFdKSkgKyAnPC9idXR0b24+JztcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgaHRtbCArPSAnPC9kaXY+PC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAod2l6YXJkU3VwcG9ydHNQcm92aWRlcnMody5ldmVudFR5cGVzKSkge1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImZpZWxkXCI+PGxhYmVsPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUHJvdmlkZXJzJykpICsgJzwvbGFiZWw+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJ1aSBtdWx0aXBsZSBzZWFyY2ggc2VsZWN0aW9uIGRyb3Bkb3duIG1oLWNvbmQtZHJvcGRvd25cIiBpZD1cIm1oLWNvbmQtcHJvdmlkZXJzXCIgdGFiaW5kZXg9XCIwXCI+J1xuICAgICAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiaGlkZGVuXCI+PHNwYW4gY2xhc3M9XCJkZWZhdWx0IHRleHRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0ZpbHRlckFsbCcpKSArICc8L3NwYW4+PGRpdiBjbGFzcz1cIm1lbnVcIj48L2Rpdj48L2Rpdj48L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3LmV2ZW50VHlwZXMuaW5kZXhPZignYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCcpID49IDApIHtcbiAgICAgICAgICAgIHZhciByYW5nZSA9IHcuZmlsdGVycy5xdWFsaXR5X3Njb3JlIHx8IHt9O1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImZpZWxkXCI+PGxhYmVsPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUXVhbGl0eScpKSArICc8L2xhYmVsPidcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtaW5saW5lLWlucHV0c1wiPidcbiAgICAgICAgICAgICAgICArICc8c3Bhbj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFF1YWxpdHlGcm9tJykpICsgJzwvc3Bhbj48aW5wdXQgdHlwZT1cIm51bWJlclwiIG1pbj1cIjBcIiBtYXg9XCIxMDBcIiBjbGFzcz1cIm1oLXF1YWxpdHktbWluIG1oLWlucHV0LXhzXCIgdmFsdWU9XCInICsgKHJhbmdlLm1pbiAhPT0gdW5kZWZpbmVkID8gcmFuZ2UubWluIDogJycpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8c3Bhbj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFF1YWxpdHlUbycpKSArICc8L3NwYW4+PGlucHV0IHR5cGU9XCJudW1iZXJcIiBtaW49XCIwXCIgbWF4PVwiMTAwXCIgY2xhc3M9XCJtaC1xdWFsaXR5LW1heCBtaC1pbnB1dC14c1wiIHZhbHVlPVwiJyArIChyYW5nZS5tYXggIT09IHVuZGVmaW5lZCA/IHJhbmdlLm1heCA6ICcnKSArICdcIj4nXG4gICAgICAgICAgICAgICAgKyAnPC9kaXY+PC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAod2l6YXJkU3VwcG9ydHNTZXZlcml0eSh3LmV2ZW50VHlwZXMpKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZmllbGRcIj48bGFiZWw+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRTZXZlcml0eScpKSArICc8L2xhYmVsPidcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtc2VnXCIgcm9sZT1cImdyb3VwXCIgYXJpYS1sYWJlbD1cIicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkU2V2ZXJpdHknKSkgKyAnXCI+JztcbiAgICAgICAgICAgIFtbJ3dhcm5pbmcnLCAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkU2V2ZXJpdHlXYXJuaW5nJ10sIFsnY3JpdGljYWwnLCAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkU2V2ZXJpdHlDcml0aWNhbCddXS5mb3JFYWNoKGZ1bmN0aW9uIChwYWlyKSB7XG4gICAgICAgICAgICAgICAgaHRtbCArPSAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgZGF0YS1zZXZlcml0eT1cIicgKyBwYWlyWzBdICsgJ1wiIGFyaWEtcHJlc3NlZD1cIicgKyAody5taW5TZXZlcml0eSA9PT0gcGFpclswXSA/ICd0cnVlJyA6ICdmYWxzZScpICsgJ1wiPidcbiAgICAgICAgICAgICAgICAgICAgKyBlc2ModChwYWlyWzFdKSkgKyAnPC9idXR0b24+JztcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgaHRtbCArPSAnPC9kaXY+PC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAod2l6YXJkU3VwcG9ydHNSZWFzb25zKHcuZXZlbnRUeXBlcykpIHtcbiAgICAgICAgICAgIHZhciBjaG9zZW4gPSB3LmZpbHRlcnMucmVhc29ucyB8fCBbXTtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJmaWVsZFwiIGlkPVwibWgtY29uZC1yZWFzb25zXCI+PGxhYmVsPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUmVhc29ucycpKSArICc8L2xhYmVsPic7XG4gICAgICAgICAgICBDTE9VRF9BSV9SRUFTT05fR1JPVVBTLmZvckVhY2goZnVuY3Rpb24gKGdyb3VwKSB7XG4gICAgICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIm1oLXJlYXNvbi1ncm91cFwiPjxkaXYgY2xhc3M9XCJtaC1yZWFzb24tdGl0bGVcIj4nICsgZXNjKHQoZ3JvdXBbMF0pKSArICc8L2Rpdj4nO1xuICAgICAgICAgICAgICAgIGdyb3VwWzFdLmZvckVhY2goZnVuY3Rpb24gKHJlYXNvbikge1xuICAgICAgICAgICAgICAgICAgICBodG1sICs9ICc8bGFiZWwgY2xhc3M9XCJtaC1yZWFzb24tY2hlY2tcIj48aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgZGF0YS1yZWFzb249XCInICsgcmVhc29uICsgJ1wiJ1xuICAgICAgICAgICAgICAgICAgICAgICAgKyAoY2hvc2VuLmluZGV4T2YocmVhc29uKSA+PSAwID8gJyBjaGVja2VkJyA6ICcnKSArICc+J1xuICAgICAgICAgICAgICAgICAgICAgICAgKyAnPHNwYW4+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl8nICsgU1RBVFVTX1BBVVNFX0tFWVNbcmVhc29uXSkpICsgJzwvc3Bhbj48L2xhYmVsPic7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgaHRtbCArPSAnPC9kaXY+JztcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgaHRtbCArPSAnPC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAod2l6YXJkSGFzU3RhdHVzKHcuZXZlbnRUeXBlcykpIHtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJtaC1zd2l0Y2gtcm93IG1oLXJlY292ZXItcm93XCI+J1xuICAgICAgICAgICAgICAgICsgJzxsYWJlbCBjbGFzcz1cInVpIHRvZ2dsZSBjaGVja2JveCcgKyAody5yZWNvdmVyID8gJyBjaGVja2VkJyA6ICcnKSArICdcIiBpZD1cIm1oLXJlY292ZXItZW5hYmxlZFwiPidcbiAgICAgICAgICAgICAgICArICc8aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgY2xhc3M9XCJoaWRkZW5cIicgKyAody5yZWNvdmVyID8gJyBjaGVja2VkJyA6ICcnKSArICcgYXJpYS1sYWJlbD1cIicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUmVjb3ZlcnknKSkgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtdHJhY2tcIj48L3NwYW4+PC9sYWJlbD4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRSZWNvdmVyeScpKSArICc8L3NwYW4+PC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAody5ldmVudFR5cGVzLmluZGV4T2YoJ2NvcmUubWlzc2VkX2NhbGwnKSA+PSAwKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwibWgtc3dpdGNoLXJvdyBtaC1yZXRyYWN0LXJvd1wiPidcbiAgICAgICAgICAgICAgICArICc8bGFiZWwgY2xhc3M9XCJ1aSB0b2dnbGUgY2hlY2tib3gnICsgKHcucmV0cmFjdC5lbmFibGVkID8gJyBjaGVja2VkJyA6ICcnKSArICdcIiBpZD1cIm1oLXJldHJhY3QtZW5hYmxlZFwiPidcbiAgICAgICAgICAgICAgICArICc8aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgY2xhc3M9XCJoaWRkZW5cIicgKyAody5yZXRyYWN0LmVuYWJsZWQgPyAnIGNoZWNrZWQnIDogJycpICsgJyBhcmlhLWxhYmVsPVwiJyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SZXRyYWN0RW5hYmxlZCcpKSArICdcIj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC10cmFja1wiPjwvc3Bhbj48L2xhYmVsPidcbiAgICAgICAgICAgICAgICArICc8c3Bhbj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1JldHJhY3RFbmFibGVkJykpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1pbmxpbmUtaW5wdXRzXCIgaWQ9XCJtaC1yZXRyYWN0LW9wdGlvbnNcIicgKyAody5yZXRyYWN0LmVuYWJsZWQgPyAnJyA6ICcgaGlkZGVuJykgKyAnPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW11dGVkXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SZXRyYWN0V2luZG93QmVmb3JlJykpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICAgICAgKyAnPGlucHV0IHR5cGU9XCJudW1iZXJcIiBtaW49XCI1XCIgbWF4PVwiMTIwXCIgaWQ9XCJtaC1yZXRyYWN0LXdpbmRvd1wiIGNsYXNzPVwibWgtaW5wdXQteHNcIiB2YWx1ZT1cIicgKyB3LnJldHJhY3Qud2luZG93X21pbiArICdcIiBhcmlhLWxhYmVsPVwiJyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SZXRyYWN0TWludXRlcycpKSArICdcIj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tdXRlZFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUmV0cmFjdE1pbnV0ZXMnKSkgKyAnPC9zcGFuPjwvc3Bhbj4nXG4gICAgICAgICAgICAgICAgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgKHdpemFyZElzTWF4KClcbiAgICAgICAgICAgICAgICAgICAgPyAnPGRpdiBjbGFzcz1cImZpZWxkXCIgaWQ9XCJtaC1yZXRyYWN0LW1heC1oaW50XCInICsgKHcucmV0cmFjdC5lbmFibGVkID8gJycgOiAnIGhpZGRlbicpICsgJz4nXG4gICAgICAgICAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWhlbHBcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1JldHJhY3RNYXhIaW50JykpICsgJzwvc3Bhbj48L2Rpdj4nXG4gICAgICAgICAgICAgICAgICAgIDogJycpO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC13aXphcmQtY29uZGl0aW9ucycpLmh0bWwoaHRtbCk7XG4gICAgICAgIGluaXRDb25kaXRpb25Ecm9wZG93bnMoKTtcbiAgICAgICAgYmluZFdpemFyZENvbmRpdGlvbnMoKTtcbiAgICAgICAgcmVuZGVyV2l6YXJkUHJldmlldygpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGluaXRDb25kaXRpb25Ecm9wZG93bnMoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgdmFyICRlbXBsb3llZXMgPSAkKCcjbWgtY29uZC1lbXBsb3llZXMnKTtcbiAgICAgICAgaWYgKCRlbXBsb3llZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdmFyIHNlbGVjdGVkVXNlcnMgPSB3LmZpbHRlcnMudXNlcl9pZHMubWFwKFN0cmluZyk7XG4gICAgICAgICAgICAkZW1wbG95ZWVzLmRyb3Bkb3duKHtcbiAgICAgICAgICAgICAgICB2YWx1ZXM6IHN0YXRlLmVtcGxveWVlcy5tYXAoZnVuY3Rpb24gKGVtcGxveWVlKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7IG5hbWU6IGVtcGxveWVlLmxhYmVsLCB2YWx1ZTogU3RyaW5nKGVtcGxveWVlLmlkKSwgc2VsZWN0ZWQ6IHNlbGVjdGVkVXNlcnMuaW5kZXhPZihTdHJpbmcoZW1wbG95ZWUuaWQpKSA+PSAwIH07XG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgcGxhY2Vob2xkZXI6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0ZpbHRlckFsbCcpLFxuICAgICAgICAgICAgICAgIGZ1bGxUZXh0U2VhcmNoOiB0cnVlLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IHsgbm9SZXN1bHRzOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9GaWx0ZXJOb3RoaW5nRm91bmQnKSB9LFxuICAgICAgICAgICAgICAgIG9uQ2hhbmdlOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS5ydWxlV2l6YXJkKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLmZpbHRlcnMudXNlcl9pZHMgPSBTdHJpbmcodmFsdWUgfHwgJycpLnNwbGl0KCcsJykuZmlsdGVyKEJvb2xlYW4pLm1hcChOdW1iZXIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHZhciAkcHJvdmlkZXJzID0gJCgnI21oLWNvbmQtcHJvdmlkZXJzJyk7XG4gICAgICAgIGlmICgkcHJvdmlkZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHZhciBzZWxlY3RlZFByb3ZpZGVycyA9IHcuZmlsdGVycy5wcm92aWRlcnMubWFwKFN0cmluZyk7XG4gICAgICAgICAgICAkcHJvdmlkZXJzLmRyb3Bkb3duKHtcbiAgICAgICAgICAgICAgICB2YWx1ZXM6IHN0YXRlLnByb3ZpZGVycy5tYXAoZnVuY3Rpb24gKHByb3ZpZGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7IG5hbWU6IHByb3ZpZGVyLmxhYmVsLCB2YWx1ZTogU3RyaW5nKHByb3ZpZGVyLmlkKSwgc2VsZWN0ZWQ6IHNlbGVjdGVkUHJvdmlkZXJzLmluZGV4T2YoU3RyaW5nKHByb3ZpZGVyLmlkKSkgPj0gMCB9O1xuICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9GaWx0ZXJBbGwnKSxcbiAgICAgICAgICAgICAgICBmdWxsVGV4dFNlYXJjaDogdHJ1ZSxcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiB7IG5vUmVzdWx0czogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRmlsdGVyTm90aGluZ0ZvdW5kJykgfSxcbiAgICAgICAgICAgICAgICBvbkNoYW5nZTogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghc3RhdGUucnVsZVdpemFyZCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgICAgICAgICAgc3RhdGUucnVsZVdpemFyZC5maWx0ZXJzLnByb3ZpZGVycyA9IFN0cmluZyh2YWx1ZSB8fCAnJykuc3BsaXQoJywnKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBiaW5kV2l6YXJkQ29uZGl0aW9ucygpIHtcbiAgICAgICAgdmFyICRmb3JtID0gJCgnI21oLXdpemFyZC1jb25kaXRpb25zJyk7XG4gICAgICAgICRmb3JtLm9mZignLndpemFyZCcpO1xuICAgICAgICAkZm9ybS5vbignY2xpY2sud2l6YXJkJywgJy5taC1zZWcgYnV0dG9uW2RhdGEtc2V2ZXJpdHldJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdy5taW5TZXZlcml0eSA9IFN0cmluZygkKHRoaXMpLmRhdGEoJ3NldmVyaXR5JykpID09PSAnY3JpdGljYWwnID8gJ2NyaXRpY2FsJyA6ICd3YXJuaW5nJztcbiAgICAgICAgICAgICQodGhpcykuY2xvc2VzdCgnLm1oLXNlZycpLmZpbmQoJ2J1dHRvbicpLmF0dHIoJ2FyaWEtcHJlc3NlZCcsICdmYWxzZScpO1xuICAgICAgICAgICAgJCh0aGlzKS5hdHRyKCdhcmlhLXByZXNzZWQnLCAndHJ1ZScpO1xuICAgICAgICAgICAgcmVuZGVyV2l6YXJkUHJldmlldygpO1xuICAgICAgICB9KTtcbiAgICAgICAgJGZvcm0ub24oJ2NoYW5nZS53aXphcmQnLCAnI21oLXJlY292ZXItZW5hYmxlZCBpbnB1dCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHcucmVjb3ZlciA9ICQodGhpcykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICAgICAgJCgnI21oLXJlY292ZXItZW5hYmxlZCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgdy5yZWNvdmVyKTtcbiAgICAgICAgICAgIHcuZXZlbnRUeXBlcyA9IHdpemFyZFdpdGhSZWNvdmVyeSh3LmV2ZW50VHlwZXMsIHcucmVjb3Zlcik7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkZm9ybS5vbignY2hhbmdlLndpemFyZCcsICcjbWgtY29uZC1yZWFzb25zIGlucHV0W2RhdGEtcmVhc29uXScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHcuZmlsdGVycy5yZWFzb25zID0gJGZvcm0uZmluZCgnI21oLWNvbmQtcmVhc29ucyBpbnB1dFtkYXRhLXJlYXNvbl06Y2hlY2tlZCcpLm1hcChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFN0cmluZygkKHRoaXMpLmRhdGEoJ3JlYXNvbicpKTtcbiAgICAgICAgICAgIH0pLmdldCgpO1xuICAgICAgICAgICAgcmVuZGVyV2l6YXJkUHJldmlldygpO1xuICAgICAgICB9KTtcbiAgICAgICAgJGZvcm0ub24oJ2NsaWNrLndpemFyZCcsICcubWgtc2VnIGJ1dHRvbltkYXRhLWRpcmVjdGlvbl0nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIgdmFsdWUgPSBTdHJpbmcoJCh0aGlzKS5kYXRhKCdkaXJlY3Rpb24nKSk7XG4gICAgICAgICAgICB2YXIgaW5kZXggPSB3LmZpbHRlcnMuZGlyZWN0aW9ucy5pbmRleE9mKHZhbHVlKTtcbiAgICAgICAgICAgIGlmIChpbmRleCA+PSAwKSB7XG4gICAgICAgICAgICAgICAgdy5maWx0ZXJzLmRpcmVjdGlvbnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdy5maWx0ZXJzLmRpcmVjdGlvbnMucHVzaCh2YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAkKHRoaXMpLmF0dHIoJ2FyaWEtcHJlc3NlZCcsIGluZGV4ID49IDAgPyAnZmFsc2UnIDogJ3RydWUnKTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZFByZXZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICRmb3JtLm9uKCdjbGljay53aXphcmQnLCAnW2RhdGEtYWN0aW9uPVwicmV0cnktZW1wbG95ZWVzXCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgc3RhdGUuZW1wbG95ZWVzRmFpbGVkID0gZmFsc2U7XG4gICAgICAgICAgICBsb2FkRW1wbG95ZWVzKGZ1bmN0aW9uICgpIHsgcmVuZGVyV2l6YXJkQ29uZGl0aW9ucygpOyB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgICRmb3JtLm9uKCdjaGFuZ2Uud2l6YXJkJywgJyNtaC1yZXRyYWN0LWVuYWJsZWQgaW5wdXQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB3LnJldHJhY3QuZW5hYmxlZCA9ICQodGhpcykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICAgICAgJCgnI21oLXJldHJhY3QtZW5hYmxlZCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgdy5yZXRyYWN0LmVuYWJsZWQpO1xuICAgICAgICAgICAgJCgnI21oLXJldHJhY3Qtb3B0aW9ucycpLnByb3AoJ2hpZGRlbicsICF3LnJldHJhY3QuZW5hYmxlZCk7XG4gICAgICAgICAgICAkKCcjbWgtcmV0cmFjdC1tYXgtaGludCcpLnByb3AoJ2hpZGRlbicsICF3LnJldHJhY3QuZW5hYmxlZCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkZm9ybS5vbignaW5wdXQud2l6YXJkIGNoYW5nZS53aXphcmQnLCAnI21oLXJldHJhY3Qtd2luZG93JywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdmFyIHZhbHVlID0gTnVtYmVyKCQodGhpcykudmFsKCkpO1xuICAgICAgICAgICAgdy5yZXRyYWN0LndpbmRvd19taW4gPSB2YWx1ZSA+PSA1ICYmIHZhbHVlIDw9IDEyMCA/IHZhbHVlIDogMjA7XG4gICAgICAgIH0pO1xuICAgICAgICAkZm9ybS5vbignaW5wdXQud2l6YXJkJywgJy5taC1xdWFsaXR5LW1pbiwgLm1oLXF1YWxpdHktbWF4JywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdmFyIG1pbiA9ICRmb3JtLmZpbmQoJy5taC1xdWFsaXR5LW1pbicpLnZhbCgpO1xuICAgICAgICAgICAgdmFyIG1heCA9ICRmb3JtLmZpbmQoJy5taC1xdWFsaXR5LW1heCcpLnZhbCgpO1xuICAgICAgICAgICAgdmFyIHJhbmdlID0ge307XG4gICAgICAgICAgICBpZiAoU3RyaW5nKG1pbikudHJpbSgpICE9PSAnJykgeyByYW5nZS5taW4gPSBOdW1iZXIobWluKTsgfVxuICAgICAgICAgICAgaWYgKFN0cmluZyhtYXgpLnRyaW0oKSAhPT0gJycpIHsgcmFuZ2UubWF4ID0gTnVtYmVyKG1heCk7IH1cbiAgICAgICAgICAgIHcuZmlsdGVycy5xdWFsaXR5X3Njb3JlID0gT2JqZWN0LmtleXMocmFuZ2UpLmxlbmd0aCA+IDAgPyByYW5nZSA6IG51bGw7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0gc3RlcCAzOiB3aGVyZSB0byBzZW5kIC0tLS1cblxuICAgIGZ1bmN0aW9uIGFjdGl2ZVdpemFyZEJvdCgpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuIG51bGw7IH1cbiAgICAgICAgdmFyIGJvdHMgPSBzdGF0ZS5ib3RzLmZpbHRlcihmdW5jdGlvbiAoYm90KSB7IHJldHVybiBib3QuZW5hYmxlZCAhPT0gZmFsc2U7IH0pO1xuICAgICAgICBpZiAody5ib3RJZCA+IDApIHtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYm90cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIGlmIChOdW1iZXIoYm90c1tpXS5pZCkgPT09IE51bWJlcih3LmJvdElkKSkgeyByZXR1cm4gYm90c1tpXTsgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBib3RzLmxlbmd0aCA+IDAgPyBib3RzWzBdIDogbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJXaXphcmRSZWNpcGllbnRzKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIHZhciBzdXBwb3J0c0VtcGxveWVlcyA9IHdpemFyZFN1cHBvcnRzRW1wbG95ZWVzKHcuZXZlbnRUeXBlcyk7XG4gICAgICAgIHZhciBib3RzID0gc3RhdGUuYm90cy5maWx0ZXIoZnVuY3Rpb24gKGJvdCkgeyByZXR1cm4gYm90LmVuYWJsZWQgIT09IGZhbHNlOyB9KTtcbiAgICAgICAgdmFyIGFjdGl2ZSA9IGFjdGl2ZVdpemFyZEJvdCgpO1xuICAgICAgICBpZiAoYWN0aXZlICE9PSBudWxsICYmIE51bWJlcih3LmJvdElkKSAhPT0gTnVtYmVyKGFjdGl2ZS5pZCkpIHtcbiAgICAgICAgICAgIHcuYm90SWQgPSBOdW1iZXIoYWN0aXZlLmlkKTsgLy8gYSBzaW5nbGUgYm90IGlzIHNlbGVjdGVkIGJ5IGl0c2VsZlxuICAgICAgICB9XG4gICAgICAgIHZhciBib3RIdG1sID0gJyc7XG4gICAgICAgIGJvdHMuZm9yRWFjaChmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICB2YXIgc2VsZWN0ZWQgPSBhY3RpdmUgIT09IG51bGwgJiYgTnVtYmVyKGFjdGl2ZS5pZCkgPT09IE51bWJlcihib3QuaWQpO1xuICAgICAgICAgICAgdmFyIGNoYW5uZWwgPSBib3QuY2hhbm5lbCA9PT0gJ21heCcgPyAnbWF4JyA6ICd0Zyc7XG4gICAgICAgICAgICBib3RIdG1sICs9ICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cIm1oLXNjZW5hcmlvIG1oLWJvdC1jaG9pY2UnICsgKHNlbGVjdGVkID8gJyBpcy1zZWxlY3RlZCcgOiAnJylcbiAgICAgICAgICAgICAgICArICdcIiBkYXRhLWJvdC1pZD1cIicgKyBib3QuaWQgKyAnXCIgYXJpYS1wcmVzc2VkPVwiJyArIChzZWxlY3RlZCA/ICd0cnVlJyA6ICdmYWxzZScpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1lc3NlbmdlciAnICsgY2hhbm5lbCArICdcIiBhcmlhLWhpZGRlbj1cInRydWVcIj4nICsgKGNoYW5uZWwgPT09ICdtYXgnID8gJ01BWCcgOiAnVEcnKSArICc8L3NwYW4+J1xuICAgICAgICAgICAgICAgICsgJzxiIGNsYXNzPVwibWgtdHJ1bmNhdGVcIj4nICsgZXNjKGJvdC50aXRsZSkgKyAnPC9iPjwvYnV0dG9uPic7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLWJvdHMnKS5odG1sKGJvdEh0bWwpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLWJvdHMtZmllbGQnKS5hdHRyKCdoaWRkZW4nLCBib3RzLmxlbmd0aCA+IDAgPyBudWxsIDogdHJ1ZSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtbm8tYm90cycpLmF0dHIoJ2hpZGRlbicsIGJvdHMubGVuZ3RoID4gMCA/IHRydWUgOiBudWxsKTtcbiAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQnKS5hdHRyKCdoaWRkZW4nLCBib3RzLmxlbmd0aCA+IDAgPyBudWxsIDogdHJ1ZSk7XG5cbiAgICAgICAgaWYgKCFzdXBwb3J0c0VtcGxveWVlcykge1xuICAgICAgICAgICAgdy50YXJnZXRNb2RlID0gJ3JlY2lwaWVudHMnO1xuICAgICAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQgW3ZhbHVlPVwiZW1wbG95ZWVcIl0sICNtaC13aXphcmQtdGFyZ2V0IFt2YWx1ZT1cImVtcGxveWVlX29yX3JlY2lwaWVudHNcIl0nKVxuICAgICAgICAgICAgICAgIC5jbG9zZXN0KCdsYWJlbCcpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQgW3ZhbHVlPVwiZW1wbG95ZWVcIl0sICNtaC13aXphcmQtdGFyZ2V0IFt2YWx1ZT1cImVtcGxveWVlX29yX3JlY2lwaWVudHNcIl0nKVxuICAgICAgICAgICAgICAgIC5jbG9zZXN0KCdsYWJlbCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC13aXphcmQtdGFyZ2V0IGlucHV0W25hbWU9XCJtaC10YXJnZXRcIl0nKS5lYWNoKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBjaGVja2VkID0gJCh0aGlzKS52YWwoKSA9PT0gdy50YXJnZXRNb2RlO1xuICAgICAgICAgICAgJCh0aGlzKS5wcm9wKCdjaGVja2VkJywgY2hlY2tlZCkuY2xvc2VzdCgnbGFiZWwnKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsIGNoZWNrZWQpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmVuZGVyV2l6YXJkQ2hhdHMoKTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1tYXNrJykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCB3Lm1hc2spO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLW1hc2sgaW5wdXQnKS5wcm9wKCdjaGVja2VkJywgdy5tYXNrKTtcbiAgICAgICAgcmVuZGVyV2l6YXJkQXR0YWNobWVudHMoKTtcbiAgICAgICAgYmluZFdpemFyZFJlY2lwaWVudHMoKTtcbiAgICAgICAgLy8gYSBzY2VuYXJpbyB3aXRob3V0IGNvbmRpdGlvbnMgZ29lcyAxIC0+IDM6IHN0ZXAgMyBtdXN0IHJlbmRlciBpdHMgb3duIHByZXZpZXdcbiAgICAgICAgcmVuZGVyV2l6YXJkUHJldmlldygpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlcldpemFyZEF0dGFjaG1lbnRzKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIHZhciBtb2RlcyA9IHdpemFyZEF0dGFjaG1lbnRNb2Rlcyh3LmV2ZW50VHlwZXMpO1xuICAgICAgICB2YXIgJGZpZWxkID0gJCgnI21oLXdpemFyZC1hdHRhY2htZW50cycpO1xuICAgICAgICBpZiAobW9kZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB3LmF0dGFjaG1lbnRzID0gJ25vbmUnO1xuICAgICAgICAgICAgJGZpZWxkLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2Rlcy5pbmRleE9mKHcuYXR0YWNobWVudHMpIDwgMCkgeyB3LmF0dGFjaG1lbnRzID0gJ25vbmUnOyB9XG4gICAgICAgICRmaWVsZC5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgLy8gYSB2b2ljZW1haWwgaXMgb25lIGZpbGU6IHRoZSB3aG9sZS1jb252ZXJzYXRpb24gd29yZGluZyBiZWNvbWVzIHBsYWluIFwiUmVjb3JkaW5nXCJcbiAgICAgICAgdmFyIHZvaWNlbWFpbE9ubHkgPSB3LmV2ZW50VHlwZXMuaW5kZXhPZignYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCcpIDwgMDtcbiAgICAgICAgJCgnI21oLXdpemFyZC1hdHRhY2gtcmVjb3JkaW5nLXRleHQnKS50ZXh0KHQodm9pY2VtYWlsT25seVxuICAgICAgICAgICAgPyAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkQXR0YWNoVm9pY2VtYWlsJ1xuICAgICAgICAgICAgOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkQXR0YWNoUmVjb3JkaW5nJykpO1xuICAgICAgICAkZmllbGQuZmluZCgnbGFiZWxbZGF0YS1tb2RlXScpLmVhY2goZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG1vZGUgPSBTdHJpbmcoJCh0aGlzKS5kYXRhKCdtb2RlJykpO1xuICAgICAgICAgICAgdmFyIGNoZWNrZWQgPSBtb2RlID09PSB3LmF0dGFjaG1lbnRzO1xuICAgICAgICAgICAgJCh0aGlzKS5hdHRyKCdoaWRkZW4nLCBtb2Rlcy5pbmRleE9mKG1vZGUpID49IDAgPyBudWxsIDogdHJ1ZSlcbiAgICAgICAgICAgICAgICAudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCBjaGVja2VkKS5maW5kKCdpbnB1dCcpLnByb3AoJ2NoZWNrZWQnLCBjaGVja2VkKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtYXR0YWNoLWhpbnQnKS5hdHRyKCdoaWRkZW4nLCB3LmF0dGFjaG1lbnRzID09PSAnbm9uZScgPyB0cnVlIDogbnVsbCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyV2l6YXJkQ2hhdHMoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgdmFyIGJvdCA9IGFjdGl2ZVdpemFyZEJvdCgpO1xuICAgICAgICB2YXIgY2hhdHMgPSBib3QgPyAoYm90LmNoYXRzIHx8IFtdKS5maWx0ZXIoZnVuY3Rpb24gKGNoYXQpIHtcbiAgICAgICAgICAgIHJldHVybiBjaGF0LnN0YXRlID09PSAnYWN0aXZlJyAmJiBjaGF0LmVuYWJsZWQgPT09IHRydWU7XG4gICAgICAgIH0pIDogW107XG4gICAgICAgIHZhciBpZHMgPSBjaGF0cy5tYXAoZnVuY3Rpb24gKGNoYXQpIHsgcmV0dXJuIE51bWJlcihjaGF0LmlkKTsgfSk7XG4gICAgICAgIHcuY2hhdElkcyA9IHcuY2hhdElkcy5maWx0ZXIoZnVuY3Rpb24gKGlkKSB7IHJldHVybiBpZHMuaW5kZXhPZihpZCkgPj0gMDsgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtY2hhdHMtZmllbGQnKS5hdHRyKCdoaWRkZW4nLCB3LnRhcmdldE1vZGUgPT09ICdlbXBsb3llZScgPyB0cnVlIDogbnVsbCk7XG4gICAgICAgIHZhciAkZHJvcGRvd24gPSAkKCcjbWgtd2l6YXJkLWNoYXRzJyk7XG4gICAgICAgICRkcm9wZG93bi5kcm9wZG93bignZGVzdHJveScpO1xuICAgICAgICAkZHJvcGRvd24uZmluZCgnYS51aS5sYWJlbCcpLnJlbW92ZSgpO1xuICAgICAgICAkZHJvcGRvd24uZHJvcGRvd24oe1xuICAgICAgICAgICAgdmFsdWVzOiBjaGF0cy5tYXAoZnVuY3Rpb24gKGNoYXQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiBlc2MoY2hhdC50aXRsZSB8fCBjaGF0LmNoYXRfaWQpICsgJyA8c3BhbiBjbGFzcz1cIm1oLW1ldGFcIj7CtyAnICsgZXNjKGNoYXRLaW5kTGFiZWwoY2hhdC5jaGF0X2tpbmQpKSArICc8L3NwYW4+JyxcbiAgICAgICAgICAgICAgICAgICAgdGV4dDogZXNjKGNoYXQudGl0bGUgfHwgY2hhdC5jaGF0X2lkKSxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IFN0cmluZyhjaGF0LmlkKSxcbiAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWQ6IHcuY2hhdElkcy5pbmRleE9mKE51bWJlcihjaGF0LmlkKSkgPj0gMFxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBjaGF0cy5sZW5ndGggPiAwID8gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkQ2hhdHNUaXRsZScpIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkTm9DaGF0cycpLFxuICAgICAgICAgICAgbWVzc2FnZTogeyBub1Jlc3VsdHM6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZE5vQ2hhdHMnKSB9LFxuICAgICAgICAgICAgb25DaGFuZ2U6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgIGlmICghc3RhdGUucnVsZVdpemFyZCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLmNoYXRJZHMgPSBTdHJpbmcodmFsdWUgfHwgJycpLnNwbGl0KCcsJykuZmlsdGVyKEJvb2xlYW4pLm1hcChOdW1iZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBiaW5kV2l6YXJkUmVjaXBpZW50cygpIHtcbiAgICAgICAgdmFyICRzdGVwID0gJCgnI21oLXdpemFyZC1zdGVwLTMnKTtcbiAgICAgICAgJHN0ZXAub2ZmKCcud2l6YXJkJyk7XG4gICAgICAgICRzdGVwLm9uKCdjbGljay53aXphcmQnLCAnLm1oLWJvdC1jaG9pY2UnLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLmJvdElkID0gTnVtYmVyKCQodGhpcykuZGF0YSgnYm90LWlkJykpO1xuICAgICAgICAgICAgc3RhdGUucnVsZVdpemFyZC5jaGF0SWRzID0gW107XG4gICAgICAgICAgICByZW5kZXJXaXphcmRSZWNpcGllbnRzKCk7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgICAgICB1cGRhdGVXaXphcmROZXh0KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkc3RlcC5vbignY2hhbmdlLndpemFyZCcsICdpbnB1dFtuYW1lPVwibWgtdGFyZ2V0XCJdJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc3RhdGUucnVsZVdpemFyZC50YXJnZXRNb2RlID0gU3RyaW5nKCQodGhpcykudmFsKCkpO1xuICAgICAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQgaW5wdXRbbmFtZT1cIm1oLXRhcmdldFwiXScpLmVhY2goZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICQodGhpcykuY2xvc2VzdCgnbGFiZWwnKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsICQodGhpcykucHJvcCgnY2hlY2tlZCcpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgJCgnI21oLXdpemFyZC1jaGF0cy1maWVsZCcpLmF0dHIoJ2hpZGRlbicsIHN0YXRlLnJ1bGVXaXphcmQudGFyZ2V0TW9kZSA9PT0gJ2VtcGxveWVlJyA/IHRydWUgOiBudWxsKTtcbiAgICAgICAgfSk7XG4gICAgICAgICRzdGVwLm9uKCdjaGFuZ2Uud2l6YXJkJywgJ2lucHV0W25hbWU9XCJtaC1hdHRhY2htZW50c1wiXScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLnJ1bGVXaXphcmQuYXR0YWNobWVudHMgPSBTdHJpbmcoJCh0aGlzKS52YWwoKSk7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRBdHRhY2htZW50cygpO1xuICAgICAgICAgICAgcmVuZGVyV2l6YXJkUHJldmlldygpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHN0ZXAub24oJ2NoYW5nZS53aXphcmQnLCAnI21oLXdpemFyZC1tYXNrIGlucHV0JywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc3RhdGUucnVsZVdpemFyZC5tYXNrID0gJCh0aGlzKS5wcm9wKCdjaGVja2VkJyk7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLW1hc2snKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsIHN0YXRlLnJ1bGVXaXphcmQubWFzayk7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0gcHJldmlldyAoc3RlcCAyLCByaWdodCBjb2x1bW4pIC0tLS1cblxuICAgIC8qKiBBIHJ1bGUgdGFyZ2V0cyBvbmUgYm90LCBzbyBpdHMgY2hhbm5lbCBpcyB0aGUgY2hhbm5lbCBvZiB0aGUgYWN0aXZlIHdpemFyZCBib3QuICovXG4gICAgZnVuY3Rpb24gd2l6YXJkSXNNYXgoKSB7XG4gICAgICAgIHZhciBib3QgPSBhY3RpdmVXaXphcmRCb3QoKTtcbiAgICAgICAgcmV0dXJuICEhYm90ICYmIGJvdC5jaGFubmVsID09PSAnbWF4JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRQcmV2aWV3Q2FsbFR5cGUodHlwZXMpIHtcbiAgICAgICAgdmFyIG9yZGVyID0gW1xuICAgICAgICAgICAgJ2NvcmUubWlzc2VkX2NhbGwnLCAnY29yZS52b2ljZW1haWwnLCAnYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCcsXG4gICAgICAgICAgICAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb2ZmbGluZScsICdhaV9zdXBlcnZpc29yLndvcmtlcl9vbmxpbmUnLFxuICAgICAgICAgICAgJ2xvY2FsX3N0dC53b3JrZXJfb2ZmbGluZScsICdsb2NhbF9zdHQud29ya2VyX29ubGluZScsICdsb2NhbF9zdHQuYmFja2xvZ19ub193b3JrZXJzJywgJ2xvY2FsX3N0dC5iYWNrbG9nX3Jlc29sdmVkJyxcbiAgICAgICAgICAgICdjbG91ZF9zdHQuaW5jaWRlbnQnLCAnY2xvdWRfc3R0LmluY2lkZW50X3Jlc29sdmVkJywgJ2Nsb3VkX3N0dC5wYXVzZWQnLCAnY2xvdWRfc3R0LnJlc3VtZWQnLFxuICAgICAgICAgICAgJ2Nsb3VkX2FpLnBhdXNlZCcsICdjbG91ZF9haS5yZXN1bWVkJyxcbiAgICAgICAgICAgICd2b2ljZV9hZ2VudC5jYWxsYmFja19yZXF1ZXN0JywgJ3ZvaWNlX2FnZW50LnJ1bnRpbWVfZG93bicsICd2b2ljZV9hZ2VudC5ydW50aW1lX3VwJyxcbiAgICAgICAgICAgICdjb3JlLnByb3ZpZGVyX2Rvd24nLCAnY29yZS5wcm92aWRlcl91cCcsICdjb3JlLmFkdmljZScsICdjb3JlLnBieF9zdGFydGVkJ1xuICAgICAgICBdO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG9yZGVyLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAodHlwZXMuaW5kZXhPZihvcmRlcltpXSkgPj0gMCkgeyByZXR1cm4gb3JkZXJbaV07IH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJyc7XG4gICAgfVxuXG4gICAgLy8gU2FtcGxlIGRhdGEgb2YgdGhlIHByZXZpZXcgYnViYmxlcyBmb3IgdGhlIG1vZHVsZSBzdGF0dXMgZXZlbnRzOyBuZXZlciByZWFsIHZhbHVlcy5cbiAgICB2YXIgU1RBVFVTX1BSRVZJRVdfU0FNUExFUyA9IHtcbiAgICAgICAgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29mZmxpbmUnOiB7IGNvZGU6ICd3b3JrZXJfb2ZmbGluZScsIHJlZjogJ3NhbXBsZScsIGNvdW50ZXJzOiB7IHdvcmtlcnNfb25saW5lOiAxLCB3b3JrZXJzX3RvdGFsOiAyIH0gfSxcbiAgICAgICAgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29ubGluZSc6IHsgY29kZTogJ3dvcmtlcl9vZmZsaW5lJywgcmVmOiAnc2FtcGxlJywgY291bnRlcnM6IHsgd29ya2Vyc19vbmxpbmU6IDIsIHdvcmtlcnNfdG90YWw6IDIgfSB9LFxuICAgICAgICAnbG9jYWxfc3R0Lndvcmtlcl9vZmZsaW5lJzogeyBjb2RlOiAnd29ya2VyX29mZmxpbmUnLCByZWY6ICdzYW1wbGUnLCBjb3VudGVyczogeyB3b3JrZXJzX29ubGluZTogMiwgd29ya2Vyc190b3RhbDogMyB9IH0sXG4gICAgICAgICdsb2NhbF9zdHQud29ya2VyX29ubGluZSc6IHsgY29kZTogJ3dvcmtlcl9vZmZsaW5lJywgcmVmOiAnc2FtcGxlJywgY291bnRlcnM6IHsgd29ya2Vyc19vbmxpbmU6IDMsIHdvcmtlcnNfdG90YWw6IDMgfSB9LFxuICAgICAgICAnbG9jYWxfc3R0LmJhY2tsb2dfbm9fd29ya2Vycyc6IHsgY29kZTogJ2JhY2tsb2dfbm9fd29ya2VycycsIHJlZjogJ3F1ZXVlJywgY291bnRlcnM6IHsgd29ya2Vyc19vbmxpbmU6IDAsIHdvcmtlcnNfdG90YWw6IDMsIGpvYnNfd2FpdGluZzogMTIgfSB9LFxuICAgICAgICAnbG9jYWxfc3R0LmJhY2tsb2dfcmVzb2x2ZWQnOiB7IGNvZGU6ICdiYWNrbG9nX25vX3dvcmtlcnMnLCByZWY6ICdxdWV1ZScsIGNvdW50ZXJzOiB7IHdvcmtlcnNfb25saW5lOiAzLCB3b3JrZXJzX3RvdGFsOiAzLCBqb2JzX3dhaXRpbmc6IDAgfSB9LFxuICAgICAgICAnY2xvdWRfc3R0LmluY2lkZW50JzogeyBjb2RlOiAnaW5jaWRlbnRfb3BlbicsIHJlZjogJ3NhbXBsZScsIGNvdW50ZXJzOiB7IGluY2lkZW50c19vcGVuOiAxIH0gfSxcbiAgICAgICAgJ2Nsb3VkX3N0dC5pbmNpZGVudF9yZXNvbHZlZCc6IHsgY29kZTogJ2luY2lkZW50X29wZW4nLCByZWY6ICdzYW1wbGUnLCBjb3VudGVyczogeyBpbmNpZGVudHNfb3BlbjogMCB9IH0sXG4gICAgICAgICdjbG91ZF9zdHQucGF1c2VkJzogeyBjb2RlOiAncHJvY2Vzc2luZ19wYXVzZWQnLCByZWY6ICdtYWludGVuYW5jZScsIGNvdW50ZXJzOiB7fSB9LFxuICAgICAgICAnY2xvdWRfc3R0LnJlc3VtZWQnOiB7IGNvZGU6ICdwcm9jZXNzaW5nX3BhdXNlZCcsIHJlZjogJ21haW50ZW5hbmNlJywgY291bnRlcnM6IHt9IH0sXG4gICAgICAgICdjbG91ZF9haS5wYXVzZWQnOiB7IGNvZGU6ICdwcm9jZXNzaW5nX3BhdXNlZCcsIHJlZjogJ2luc3VmZmljaWVudF9mdW5kcycsIGNvdW50ZXJzOiB7IGpvYnNfd2FpdGluZzogMTIgfSB9LFxuICAgICAgICAnY2xvdWRfYWkucmVzdW1lZCc6IHsgY29kZTogJ3Byb2Nlc3NpbmdfcGF1c2VkJywgcmVmOiAnaW5zdWZmaWNpZW50X2Z1bmRzJywgY291bnRlcnM6IHsgam9ic193YWl0aW5nOiAwIH0gfVxuICAgIH07XG5cbiAgICBmdW5jdGlvbiByZW5kZXJXaXphcmRQcmV2aWV3KCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgdmFyIHR5cGUgPSB3aXphcmRQcmV2aWV3Q2FsbFR5cGUody5ldmVudFR5cGVzKTtcbiAgICAgICAgaWYgKHR5cGUgPT09ICcnKSB7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLXByZXZpZXcsICNtaC13aXphcmQtcHJldmlldy10YXJnZXQnKS5lbXB0eSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBodG1sID0gd2l6YXJkUHJldmlld0J1YmJsZSh0eXBlLCB3KTtcbiAgICAgICAgLy8gdGhlIHJlY292ZXJ5IHN3aXRjaCBpcyBwYXJ0IG9mIHRoZSBwcmV2aWV3OiBhIHNlY29uZCBidWJibGUgc2hvd3Mgd2hhdCB0aGUgcmVjb3ZlcnkgbG9va3MgbGlrZVxuICAgICAgICB2YXIgcmVjb3ZlcnkgPSBTVEFUVVNfUEFJUlNbdHlwZV07XG4gICAgICAgIGlmIChyZWNvdmVyeSAmJiB3LmV2ZW50VHlwZXMuaW5kZXhPZihyZWNvdmVyeSkgPj0gMCkge1xuICAgICAgICAgICAgaHRtbCArPSB3aXphcmRQcmV2aWV3QnViYmxlKHJlY292ZXJ5LCB3KTtcbiAgICAgICAgfVxuICAgICAgICAvLyB0aGUgbWVzc2VuZ2VyIGlzIHBhcnQgb2YgdGhlIHByZXZpZXcsIHNvIHRoZSBhc2lkZSBzYXlzIHdoaWNoIGJ1YmJsZSBpdCBzaG93c1xuICAgICAgICAvLyAodGhlIGRlc2lnbiBoYXMgbm8gdmlzaWJsZSBjYXB0aW9uIGFib3ZlIHRoZSBidWJibGUpXG4gICAgICAgICQoJy5taC13aXphcmQtcHJldmlldycpLmF0dHIoJ2FyaWEtbGFiZWwnLFxuICAgICAgICAgICAgdCh3aXphcmRJc01heCgpID8gJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFByZXZpZXdDaGFubmVsTWF4JyA6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRQcmV2aWV3VGl0bGUnKSk7XG4gICAgICAgIC8vIHN0ZXAgMiBzaG93cyB0aGUgY29uZGl0aW9ucyBwcmV2aWV3LCBzdGVwIDMgdGhlIHNhbWUgcHJldmlldyBmb3IgdGhlIGNob3NlbiBib3RcbiAgICAgICAgJCgnI21oLXdpemFyZC1wcmV2aWV3LCAjbWgtd2l6YXJkLXByZXZpZXctdGFyZ2V0JykuaHRtbChodG1sKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRQcmV2aWV3QnViYmxlKHR5cGUsIHcpIHtcbiAgICAgICAgdmFyIG5hbWVzID0gZXZlbnRUeXBlTmFtZXMoKTtcbiAgICAgICAgdmFyIHRpdGxlID0gbmFtZXNbdHlwZV0gfHwgdHlwZTtcbiAgICAgICAgaWYgKHR5cGUgPT09ICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJykge1xuICAgICAgICAgICAgdGl0bGUgKz0gJyDCtyAnICsgdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VRdWFsaXR5U2NvcmUnLCB7IHNjb3JlOiA0OCB9KTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcGhvbmUgPSB3Lm1hc2sgPyAnKzcgOTY4ICoqKi0qKi00NCcgOiAnKzcgOTY4IDk2OC05NC00NCc7XG4gICAgICAgIHZhciBsaW5lcyA9IFtdO1xuICAgICAgICB2YXIgbm90ZXMgPSBbXTtcbiAgICAgICAgdmFyIGJ1dHRvbiA9IGZhbHNlO1xuICAgICAgICB2YXIgZGlyZWN0aW9uID0gdy5maWx0ZXJzLmRpcmVjdGlvbnMubGVuZ3RoID09PSAxID8gdy5maWx0ZXJzLmRpcmVjdGlvbnNbMF0gOiAnaW5jb21pbmcnO1xuICAgICAgICBzd2l0Y2ggKHR5cGUpIHtcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUubWlzc2VkX2NhbGwnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goJzxiPicgKyBlc2MocGhvbmUpICsgJzwvYj4g4oaSINCY0LLQsNC90L7QsiDQmC4gKDIzMyknKTtcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYygnMDIuMTAuMjAyNiAxNTo0MSDCtyAnICsgdCh7XG4gICAgICAgICAgICAgICAgICAgIGluY29taW5nOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZURpcmVjdGlvbkluY29taW5nJyxcbiAgICAgICAgICAgICAgICAgICAgb3V0Z29pbmc6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlRGlyZWN0aW9uT3V0Z29pbmcnLFxuICAgICAgICAgICAgICAgICAgICBpbnRlcm5hbDogJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VEaXJlY3Rpb25JbnRlcm5hbCdcbiAgICAgICAgICAgICAgICB9W2RpcmVjdGlvbl0pKSk7XG4gICAgICAgICAgICAgICAgYnV0dG9uID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUudm9pY2VtYWlsJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlVm9pY2VtYWlsSGludCcpKSk7XG4gICAgICAgICAgICAgICAgYnV0dG9uID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKCfQn9C10YLRgNC+0LLQsCDQkC4gKDI0MSkg4oaQICcgKyAody5tYXNrID8gJys3IDkxNiAqKiotKiotMTcnIDogJys3IDkxNiAyMDQtNTUtMTcnKSArICcgwrcgNjo0MicpKTtcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYyh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZVJlYXNvbnMnLCB7IHJlYXNvbnM6ICfQmtC70LjQtdC90YLRgyDQvdC1INC/0L7QvNC+0LPQu9C4OyDQv9C+0LLRgtC+0YDQvdGL0Lkg0LfQstC+0L3QvtC6JyB9KSkpO1xuICAgICAgICAgICAgICAgIG5vdGVzLnB1c2goJ9Ca0LvQuNC10L3RgtGDINC90LUg0L/QvtC80L7Qs9C70Lg6INC00LLQsNC20LTRiyDQvtGC0L/RgNCw0LLQuNC70Lgg0L3QsCDRgdCw0LnRgiwg0YDQtdGI0LXQvdC40Y8g0L3QtSDQv9GA0LXQtNC70L7QttC40LvQuC4nKTtcbiAgICAgICAgICAgICAgICBidXR0b24gPSB0cnVlO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAndm9pY2VfYWdlbnQuY2FsbGJhY2tfcmVxdWVzdCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2MoJ9Cf0ZHRgtGAIMK3ICcgKyBwaG9uZSkpO1xuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlVG9waWMnLCB7IHRvcGljOiAn0JLQvtC30LLRgNCw0YInIH0pKSk7XG4gICAgICAgICAgICAgICAgYnV0dG9uID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUucHJvdmlkZXJfZG93bic6XG4gICAgICAgICAgICBjYXNlICdjb3JlLnByb3ZpZGVyX3VwJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYygnU0lQIMKr0JzQtdCz0LDRhNC+0L3CuyDCtyAxMC4wLjAuMScpKTtcbiAgICAgICAgICAgICAgICBub3Rlcy5wdXNoKCdyZWdpc3RlcmVkIOKGkiB1bnJlZ2lzdGVyZWQnKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29mZmxpbmUnOlxuICAgICAgICAgICAgY2FzZSAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb25saW5lJzpcbiAgICAgICAgICAgIGNhc2UgJ2xvY2FsX3N0dC53b3JrZXJfb2ZmbGluZSc6XG4gICAgICAgICAgICBjYXNlICdsb2NhbF9zdHQud29ya2VyX29ubGluZSc6XG4gICAgICAgICAgICBjYXNlICdsb2NhbF9zdHQuYmFja2xvZ19ub193b3JrZXJzJzpcbiAgICAgICAgICAgIGNhc2UgJ2xvY2FsX3N0dC5iYWNrbG9nX3Jlc29sdmVkJzpcbiAgICAgICAgICAgIGNhc2UgJ2Nsb3VkX3N0dC5pbmNpZGVudCc6XG4gICAgICAgICAgICBjYXNlICdjbG91ZF9zdHQuaW5jaWRlbnRfcmVzb2x2ZWQnOlxuICAgICAgICAgICAgY2FzZSAnY2xvdWRfc3R0LnBhdXNlZCc6XG4gICAgICAgICAgICBjYXNlICdjbG91ZF9zdHQucmVzdW1lZCc6XG4gICAgICAgICAgICBjYXNlICdjbG91ZF9haS5wYXVzZWQnOlxuICAgICAgICAgICAgY2FzZSAnY2xvdWRfYWkucmVzdW1lZCc6XG4gICAgICAgICAgICAgICAgdmFyIHNhbXBsZSA9IFNUQVRVU19QUkVWSUVXX1NBTVBMRVNbdHlwZV07XG4gICAgICAgICAgICAgICAgaWYgKHdpemFyZFN1cHBvcnRzUmVhc29ucyhbdHlwZV0pICYmIHcuZmlsdGVycy5yZWFzb25zICYmIHcuZmlsdGVycy5yZWFzb25zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gdGhlIHNhbXBsZSBzaG93cyB0aGUgZmlyc3Qgc2VsZWN0ZWQgcGF1c2UgcmVhc29uLCBzbyB0aGUgY2hvaWNlIGlzIHZpc2libGVcbiAgICAgICAgICAgICAgICAgICAgc2FtcGxlID0gJC5leHRlbmQoe30sIHNhbXBsZSwgeyByZWY6IHcuZmlsdGVycy5yZWFzb25zWzBdIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB2YXIgc2NlbmFyaW9Tb3VyY2UgPSBzb3VyY2VCeUlkKHcuc291cmNlSWQpO1xuICAgICAgICAgICAgICAgIGlmIChzY2VuYXJpb1NvdXJjZSAmJiBzY2VuYXJpb1NvdXJjZS5tb2R1bGVfbmFtZSkge1xuICAgICAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYyhzY2VuYXJpb1NvdXJjZS5tb2R1bGVfbmFtZSkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYyhzdGF0dXNQaHJhc2UodHlwZSwgc2FtcGxlKSkpO1xuICAgICAgICAgICAgICAgIHN0YXR1c0NvdW50ZXJOb3RlcyhzYW1wbGUpLmZvckVhY2goZnVuY3Rpb24gKG5vdGUpIHsgbm90ZXMucHVzaChub3RlKTsgfSk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICd2b2ljZV9hZ2VudC5ydW50aW1lX2Rvd24nOlxuICAgICAgICAgICAgY2FzZSAndm9pY2VfYWdlbnQucnVudGltZV91cCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaCgnY29ubmVjdGlvbiByZWZ1c2VkJyk7XG4gICAgICAgICAgICAgICAgbm90ZXMucHVzaCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZUxhdGVuY3knLCB7IG1zOiAxMjAwIH0pKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUuYWR2aWNlJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYygn0KHQstC+0LHQvtC00L3QviA4ICUg0L3QsCDRgNCw0LfQtNC10LvQtSAvc3RvcmFnZScpKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUuY29uZmlnX2NoYW5nZWQnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlQ29uZmlnQXJlYScsIHtcbiAgICAgICAgICAgICAgICAgICAgYXJlYTogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29uZmlnQXJlYVByb3ZpZGVycycpLCBjb3VudDogMlxuICAgICAgICAgICAgICAgIH0pKSk7XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2ModGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VDb25maWdBcmVhJywge1xuICAgICAgICAgICAgICAgICAgICBhcmVhOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db25maWdBcmVhUm91dGluZycpLCBjb3VudDogMVxuICAgICAgICAgICAgICAgIH0pKSk7XG4gICAgICAgICAgICAgICAgbm90ZXMucHVzaCgnMDIuMTAuMjAyNiAxNTo0MScpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnY29yZS5leHRlcm5hbF9pcF9jaGFuZ2VkJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKCcyMDMuMC4xMTMuNSDihpIgMjAzLjAuMTEzLjknKTtcbiAgICAgICAgICAgICAgICBub3Rlcy5wdXNoKGVzYyh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZUV4dGVybmFsSXBTZWVuQXQnLCB7IHRpbWU6ICcwMi4xMC4yMDI2IDE1OjQxJyB9KSkpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnY29yZS5saWNlbnNlX2V4cGlyaW5nJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKCdNaWtvUEJYJyk7XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2ModGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VMaWNlbnNlRXhwaXJlc09uJywgeyBkYXRlOiAnMzEuMTIuMjAyNicgfSkpKTtcbiAgICAgICAgICAgICAgICBub3Rlcy5wdXNoKGVzYyh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZUxpY2Vuc2VEYXlzTGVmdCcsIHsgZGF5czogNyB9KSkpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnY29yZS5wYnhfc3RhcnRlZCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaCgnMDIuMTAuMjAyNiAwMzoxMCcpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIHZhciBpc01heCA9IHdpemFyZElzTWF4KCk7XG4gICAgICAgIHZhciBodG1sID0gJzxkaXYgY2xhc3M9XCJtaC1wcmV2aWV3LW1zZycgKyAoaXNNYXggPyAnIGlzLW1heCcgOiAnJykgKyAnXCI+PGRpdj4nICsgZXNjKGljb25Gb3JUeXBlKHR5cGUpKSArICcgPGI+JyArIGVzYyh0aXRsZSkgKyAnPC9iPjwvZGl2Pic7XG4gICAgICAgIGxpbmVzLmZvckVhY2goZnVuY3Rpb24gKGxpbmUpIHsgaHRtbCArPSAnPGRpdj4nICsgbGluZSArICc8L2Rpdj4nOyB9KTtcbiAgICAgICAgbm90ZXMuZm9yRWFjaChmdW5jdGlvbiAobm90ZSkgeyBodG1sICs9ICc8ZGl2PjxpPicgKyBlc2Mobm90ZSkgKyAnPC9pPjwvZGl2Pic7IH0pO1xuICAgICAgICBodG1sICs9ICc8c3BhbiBjbGFzcz1cIm1oLXByZXZpZXctdGltZVwiPjE1OjQxPC9zcGFuPjwvZGl2Pic7XG4gICAgICAgIGh0bWwgKz0gd2l6YXJkUHJldmlld0F1ZGlvKHR5cGUsIHcuYXR0YWNobWVudHMsIGlzTWF4KTtcbiAgICAgICAgaWYgKGJ1dHRvbikge1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIm1oLXByZXZpZXctYnV0dG9uJyArIChpc01heCA/ICcgaXMtbWF4JyA6ICcnKSArICdcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFByZXZpZXdCdXR0b24nKSkgKyAnIOKGlzwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGh0bWw7XG4gICAgfVxuXG4gICAgLy8gQXVkaW8gYnViYmxlcyBmb2xsb3cgdGhlIHRleHQgKFBsYW4vMDMpOiBmcmFnbWVudHMgPSBvbmUgYnViYmxlIHBlciBmcmFnbWVudCwgb3RoZXJ3aXNlIHRoZSB3aG9sZSBmaWxlLlxuICAgIC8vIFRoZSBudW1iZXJzIGFyZSBzYW1wbGUgdmFsdWVzIG9mIHRoZSBwcmV2aWV3LCBuZXZlciByZWFsIGRhdGEuXG4gICAgZnVuY3Rpb24gd2l6YXJkUHJldmlld0F1ZGlvKHR5cGUsIG1vZGUsIGlzTWF4KSB7XG4gICAgICAgIGlmIChtb2RlID09PSAnbm9uZScgfHwgd2l6YXJkQXR0YWNobWVudE1vZGVzKFt0eXBlXSkuaW5kZXhPZihtb2RlKSA8IDApIHsgcmV0dXJuICcnOyB9XG4gICAgICAgIHZhciBpdGVtcyA9IFtdO1xuICAgICAgICBpZiAobW9kZSA9PT0gJ2ZyYWdtZW50cycpIHtcbiAgICAgICAgICAgIHZhciBzYW1wbGUgPSBbJzA6MTInLCAnMDoxOCddO1xuICAgICAgICAgICAgc2FtcGxlLmZvckVhY2goZnVuY3Rpb24gKGR1cmF0aW9uLCBpbmRleCkge1xuICAgICAgICAgICAgICAgIGl0ZW1zLnB1c2godGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1ByZXZpZXdBdWRpb0ZyYWdtZW50JywgeyBuOiBpbmRleCArIDEsIHRvdGFsOiBzYW1wbGUubGVuZ3RoLCBkdXJhdGlvbjogZHVyYXRpb24gfSkpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpdGVtcy5wdXNoKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QcmV2aWV3QXVkaW9SZWNvcmRpbmcnLCB7IGR1cmF0aW9uOiB0eXBlID09PSAnY29yZS52b2ljZW1haWwnID8gJzA6MzInIDogJzY6NDInIH0pKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgaHRtbCA9ICcnO1xuICAgICAgICBpdGVtcy5mb3JFYWNoKGZ1bmN0aW9uIChjYXB0aW9uKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwibWgtcHJldmlldy1tc2cgbWgtcHJldmlldy1hdWRpbycgKyAoaXNNYXggPyAnIGlzLW1heCcgOiAnJykgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1wcmV2aWV3LWF1ZGlvLXJvd1wiPjxzcGFuIGNsYXNzPVwibWgtcHJldmlldy1wbGF5XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+PC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXByZXZpZXctd2F2ZVwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjwvc3Bhbj48L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLW1ldGFcIj4nICsgZXNjKGNhcHRpb24pICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXByZXZpZXctdGltZVwiPjE1OjQxPC9zcGFuPjwvZGl2Pic7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gaHRtbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBpY29uRm9yVHlwZSh0eXBlKSB7XG4gICAgICAgIGlmICh0eXBlID09PSAnY29yZS5taXNzZWRfY2FsbCcgfHwgdHlwZSA9PT0gJ3ZvaWNlX2FnZW50LmNhbGxiYWNrX3JlcXVlc3QnKSB7IHJldHVybiAn8J+Tnic7IH1cbiAgICAgICAgaWYgKHR5cGUgPT09ICdjb3JlLnZvaWNlbWFpbCcpIHsgcmV0dXJuICfwn46ZJzsgfVxuICAgICAgICBpZiAodHlwZSA9PT0gJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnIHx8IHR5cGUgPT09ICdjb3JlLnByb3ZpZGVyX2Rvd24nIHx8IHR5cGUgPT09ICd2b2ljZV9hZ2VudC5ydW50aW1lX2Rvd24nKSB7IHJldHVybiAn4pqg77iPJzsgfVxuICAgICAgICBpZiAoU1RBVFVTX1JFQ09WRVJZX0tFWVNbdHlwZV0gfHwgdHlwZSA9PT0gJ2NvcmUucHJvdmlkZXJfdXAnIHx8IHR5cGUgPT09ICd2b2ljZV9hZ2VudC5ydW50aW1lX3VwJykgeyByZXR1cm4gJ+KchSc7IH1cbiAgICAgICAgaWYgKHR5cGUgPT09ICdhaV9zdXBlcnZpc29yLndvcmtlcl9vZmZsaW5lJyB8fCB0eXBlID09PSAnbG9jYWxfc3R0Lndvcmtlcl9vZmZsaW5lJykgeyByZXR1cm4gJ/CflIwnOyB9XG4gICAgICAgIGlmICh0eXBlID09PSAnY29yZS5wYnhfc3RhcnRlZCcpIHsgcmV0dXJuICfwn5SEJzsgfVxuICAgICAgICBpZiAodHlwZSA9PT0gJ2NvcmUuY29uZmlnX2NoYW5nZWQnKSB7IHJldHVybiAn8J+boCc7IH1cbiAgICAgICAgaWYgKHR5cGUgPT09ICdjb3JlLmV4dGVybmFsX2lwX2NoYW5nZWQnKSB7IHJldHVybiAn8J+MkCc7IH1cbiAgICAgICAgaWYgKHR5cGUgPT09ICdjb3JlLmxpY2Vuc2VfZXhwaXJpbmcnKSB7IHJldHVybiAn4pqg77iPJzsgfVxuICAgICAgICByZXR1cm4gJ+KaoO+4jyc7XG4gICAgfVxuXG4gICAgLy8gLS0tLSBuYXZpZ2F0aW9uIGFuZCBzYXZlIC0tLS1cblxuICAgIGZ1bmN0aW9uIHdpemFyZE5leHQoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICBpZiAody5zdGVwID09PSAxKSB7XG4gICAgICAgICAgICBpZiAoIXcuc291cmNlSWQpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB3LnN0ZXAgPSBmaXJzdFN0ZXBBZnRlclNjZW5hcmlvKHcuZXZlbnRUeXBlcyk7XG4gICAgICAgICAgICByZW5kZXJXaXphcmQoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAody5zdGVwID09PSAyKSB7XG4gICAgICAgICAgICBpZiAod2l6YXJkU3VwcG9ydHNSZWFzb25zKHcuZXZlbnRUeXBlcykgJiYgKCF3LmZpbHRlcnMucmVhc29ucyB8fCB3LmZpbHRlcnMucmVhc29ucy5sZW5ndGggPT09IDApKSB7XG4gICAgICAgICAgICAgICAgc2hvd1dpemFyZEVycm9yKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFJlYXNvbnNSZXF1aXJlZCcpKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB3LnN0ZXAgPSAzO1xuICAgICAgICAgICAgcmVuZGVyV2l6YXJkKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgc2F2ZVJ1bGUoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRQcmV2KCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgaWYgKCQoJyNtaC13aXphcmQtcHJldicpLmRhdGEoJ21vZGUnKSAhPT0gJ2JhY2snKSB7XG4gICAgICAgICAgICBjbG9zZVJ1bGVXaXphcmQoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAody5zdGVwID09PSAzICYmIHdpemFyZEhhc0NvbmRpdGlvbnMody5ldmVudFR5cGVzKSkge1xuICAgICAgICAgICAgdy5zdGVwID0gMjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHcuc3RlcCA9IDE7XG4gICAgICAgIH1cbiAgICAgICAgY2xlYXJXaXphcmRFcnJvcigpO1xuICAgICAgICByZW5kZXJXaXphcmQoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBwcnVuZUZpbHRlcnMoZmlsdGVycykge1xuICAgICAgICB2YXIgcmVzdWx0ID0ge307XG4gICAgICAgIGlmIChmaWx0ZXJzLnVzZXJfaWRzLmxlbmd0aCA+IDApIHsgcmVzdWx0LnVzZXJfaWRzID0gZmlsdGVycy51c2VyX2lkczsgfVxuICAgICAgICBpZiAoZmlsdGVycy5kaXJlY3Rpb25zLmxlbmd0aCA+IDApIHsgcmVzdWx0LmRpcmVjdGlvbnMgPSBmaWx0ZXJzLmRpcmVjdGlvbnM7IH1cbiAgICAgICAgaWYgKGZpbHRlcnMucHJvdmlkZXJzLmxlbmd0aCA+IDApIHsgcmVzdWx0LnByb3ZpZGVycyA9IGZpbHRlcnMucHJvdmlkZXJzOyB9XG4gICAgICAgIC8vIGV2ZXJ5IHJlYXNvbiBzZWxlY3RlZCA9IG5vIGZpbHRlciAoYSBtYW51YWwgcGF1c2UgaW5jbHVkZWQpOyBhIHN1YnNldCBpcyBzdG9yZWQgYXMgY2hvc2VuXG4gICAgICAgIGlmIChmaWx0ZXJzLnJlYXNvbnMgJiYgZmlsdGVycy5yZWFzb25zLmxlbmd0aCA+IDAgJiYgZmlsdGVycy5yZWFzb25zLmxlbmd0aCA8IGNsb3VkQWlSZWFzb25zKHRydWUpLmxlbmd0aCkge1xuICAgICAgICAgICAgcmVzdWx0LnJlYXNvbnMgPSBmaWx0ZXJzLnJlYXNvbnM7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGZpbHRlcnMucXVhbGl0eV9zY29yZSAhPT0gbnVsbCAmJiBPYmplY3Qua2V5cyhmaWx0ZXJzLnF1YWxpdHlfc2NvcmUpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHJlc3VsdC5xdWFsaXR5X3Njb3JlID0gZmlsdGVycy5xdWFsaXR5X3Njb3JlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZVJ1bGUoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICB2YXIgc2NlbmFyaW8gPSB3aXphcmRTY2VuYXJpbygpO1xuICAgICAgICAvLyB0aGUgd2l6YXJkIGhhcyBubyBuYW1lIGZpZWxkIChkZXNpZ24gdjMpOiBhIG5ldyBub3RpZmljYXRpb24gaXMgbmFtZWQgYWZ0ZXIgaXRzIHNjZW5hcmlvXG4gICAgICAgIHZhciB0aXRsZSA9IFN0cmluZyh3LnRpdGxlIHx8ICcnKS50cmltKCkgfHwgKHNjZW5hcmlvID8gc2NlbmFyaW8ubmFtZSA6ICcnKTtcbiAgICAgICAgaWYgKHRpdGxlID09PSAnJykge1xuICAgICAgICAgICAgc2hvd1dpemFyZEVycm9yKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFRpdGxlUmVxdWlyZWQnKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHcudGFyZ2V0TW9kZSAhPT0gJ2VtcGxveWVlJyAmJiB3LmNoYXRJZHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBzaG93V2l6YXJkRXJyb3IodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkTmVlZENoYXRzJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBvcHRpb25zID0geyBtYXNrX3Bob25lOiB3Lm1hc2sgfTtcbiAgICAgICAgaWYgKHcuZXZlbnRUeXBlcy5pbmRleE9mKCdjb3JlLm1pc3NlZF9jYWxsJykgPj0gMCkge1xuICAgICAgICAgICAgb3B0aW9ucy5yZXRyYWN0X29uX2NhbGxiYWNrID0ge1xuICAgICAgICAgICAgICAgIGVuYWJsZWQ6IHcucmV0cmFjdC5lbmFibGVkID09PSB0cnVlLFxuICAgICAgICAgICAgICAgIHdpbmRvd19taW46IHcucmV0cmFjdC53aW5kb3dfbWluID49IDUgJiYgdy5yZXRyYWN0LndpbmRvd19taW4gPD0gMTIwID8gdy5yZXRyYWN0LndpbmRvd19taW4gOiAyMCxcbiAgICAgICAgICAgICAgICBjb3VudF9pbmNvbWluZ19hbnN3ZXJlZDogdy5yZXRyYWN0LmNvdW50X2luY29taW5nX2Fuc3dlcmVkICE9PSBmYWxzZVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAod2l6YXJkQXR0YWNobWVudE1vZGVzKHcuZXZlbnRUeXBlcykubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgb3B0aW9ucy5hdHRhY2htZW50cyA9IHcuYXR0YWNobWVudHM7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHBheWxvYWQgPSB7XG4gICAgICAgICAgICB0aXRsZTogdGl0bGUsXG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgZXZlbnRfdHlwZXM6IHcuZXZlbnRUeXBlcyxcbiAgICAgICAgICAgIG1pbl9zZXZlcml0eTogd2l6YXJkU3VwcG9ydHNTZXZlcml0eSh3LmV2ZW50VHlwZXMpID8gdy5taW5TZXZlcml0eSA6ICdpbmZvJyxcbiAgICAgICAgICAgIGZpbHRlcnM6IHBydW5lRmlsdGVycyh3aXphcmRTdXBwb3J0c1JlYXNvbnMody5ldmVudFR5cGVzKSA/IHcuZmlsdGVycyA6ICQuZXh0ZW5kKHt9LCB3LmZpbHRlcnMsIHsgcmVhc29uczogbnVsbCB9KSksXG4gICAgICAgICAgICB0YXJnZXRfbW9kZTogdy50YXJnZXRNb2RlLFxuICAgICAgICAgICAgY2hhdF9pZHM6IHcuY2hhdElkcyxcbiAgICAgICAgICAgIG9wdGlvbnM6IG9wdGlvbnNcbiAgICAgICAgfTtcbiAgICAgICAgdmFyIGRvbmUgPSBmdW5jdGlvbiAocnVsZSkge1xuICAgICAgICAgICAgY2xvc2VSdWxlV2l6YXJkKCk7XG4gICAgICAgICAgICByZXBsYWNlUnVsZShydWxlKTtcbiAgICAgICAgICAgIGxvYWRSdWxlcyh0cnVlKTtcbiAgICAgICAgICAgIHNob3dUb2FzdCh0KHcuZWRpdElkID4gMCA/ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRTYXZlZCcgOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkQ3JlYXRlZCcpKTtcbiAgICAgICAgfTtcbiAgICAgICAgdmFyIGZhaWx1cmUgPSBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICBzaG93V2l6YXJkRXJyb3IoZmFpbHVyZVRleHQoZXJyKSk7XG4gICAgICAgIH07XG4gICAgICAgIGlmICh3LmVkaXRJZCA+IDApIHtcbiAgICAgICAgICAgIGFwaVBhdGNoKCcvcnVsZXMvJyArIHcuZWRpdElkLCBwYXlsb2FkLCBkb25lLCBmYWlsdXJlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGFwaVBvc3QoJy9ydWxlcycsIHBheWxvYWQsIGRvbmUsIGZhaWx1cmUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2hvd1dpemFyZEVycm9yKHRleHQpIHtcbiAgICAgICAgJCgnI21oLXdpemFyZCAubWgtd2l6YXJkLWVycm9yLXNsb3QnKS5odG1sKCc8ZGl2IGNsYXNzPVwidWkgbmVnYXRpdmUgbWVzc2FnZVwiIHJvbGU9XCJhbGVydFwiPicgKyBJQ09OX0VSUk9SXG4gICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtZ3Jvd1wiPicgKyBlc2ModGV4dCkgKyAnPC9kaXY+PC9kaXY+Jyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2xlYXJXaXphcmRFcnJvcigpIHtcbiAgICAgICAgJCgnI21oLXdpemFyZCAubWgtd2l6YXJkLWVycm9yLXNsb3QnKS5lbXB0eSgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJpbmRXaXphcmRDb250cm9scygpIHtcbiAgICAgICAgJCgnI21oLXJ1bGUtYWRkJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkgeyBvcGVuUnVsZVdpemFyZChudWxsKTsgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtYmFjaycpLm9uKCdjbGljaycsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIGNsb3NlUnVsZVdpemFyZCgpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1uZXh0Jykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCQodGhpcykucHJvcCgnZGlzYWJsZWQnKSkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIGNsZWFyV2l6YXJkRXJyb3IoKTtcbiAgICAgICAgICAgIHdpemFyZE5leHQoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtcHJldicpLm9uKCdjbGljaycsIHdpemFyZFByZXYpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLW9wZW4tc2V0dGluZ3MnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBjbG9zZVJ1bGVXaXphcmQoKTtcbiAgICAgICAgICAgICQoJyNtaC10YWJzIC5pdGVtW2RhdGEtdGFiPVwic2V0dGluZ3NcIl0nKS50cmlnZ2VyKCdjbGljaycpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1zY2VuYXJpb3MnKS5vbignY2xpY2snLCAnLm1oLXNjZW5hcmlvJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHNvdXJjZSA9IHNvdXJjZUJ5SWQoJCh0aGlzKS5kYXRhKCdzb3VyY2UtaWQnKSk7XG4gICAgICAgICAgICBpZiAoIXNvdXJjZSB8fCAkKHRoaXMpLmhhc0NsYXNzKCdpcy1kaXNhYmxlZCcpKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICAgICAgaWYgKHcuc291cmNlSWQgIT09IHNvdXJjZS5pZCkge1xuICAgICAgICAgICAgICAgIHcuc291cmNlSWQgPSBzb3VyY2UuaWQ7XG4gICAgICAgICAgICAgICAgdy5ldmVudFR5cGVzID0gKHNvdXJjZS5ldmVudF90eXBlcyB8fCBbXSkubWFwKGZ1bmN0aW9uICh0eXBlKSB7IHJldHVybiB0eXBlLnR5cGU7IH0pO1xuICAgICAgICAgICAgICAgIGlmICh3LmVkaXRJZCA9PT0gMCkgeyB3LnRpdGxlID0gc291cmNlLm5hbWU7IH1cbiAgICAgICAgICAgICAgICB3LmZpbHRlcnMgPSBlbXB0eUZpbHRlcnMoKTtcbiAgICAgICAgICAgICAgICB3LnJlY292ZXIgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHcubWluU2V2ZXJpdHkgPSAnd2FybmluZyc7XG4gICAgICAgICAgICAgICAgaWYgKHdpemFyZFN1cHBvcnRzUmVhc29ucyh3LmV2ZW50VHlwZXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHcuZmlsdGVycy5yZWFzb25zID0gY2xvdWRBaVJlYXNvbnMoZmFsc2UpOyAvLyBuZXcgcnVsZTogZXZlcnl0aGluZyBleGNlcHQgYSBtYW51YWwgcGF1c2VcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZW5kZXJXaXphcmRTY2VuYXJpb3MoKTtcbiAgICAgICAgICAgIHVwZGF0ZVdpemFyZE5leHQoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtc2NlbmFyaW9zJykub24oJ2RibGNsaWNrJywgJy5taC1zY2VuYXJpbzpub3QoLmlzLWRpc2FibGVkKScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHdpemFyZE5leHQoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSB0YWJzICYgYXV0b3JlZnJlc2ggLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gaW5pdFRhYnMoKSB7XG4gICAgICAgICQoJyNtaC10YWJzIC5pdGVtJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHRhYiA9ICQodGhpcykuZGF0YSgndGFiJyk7XG4gICAgICAgICAgICAkKCcjbWgtdGFicyAuaXRlbScpLnJlbW92ZUNsYXNzKCdhY3RpdmUnKTtcbiAgICAgICAgICAgICQodGhpcykuYWRkQ2xhc3MoJ2FjdGl2ZScpO1xuICAgICAgICAgICAgJCgnI21lc3Nlbmdlci1odWItcm9vdCAubWgtdGFiLXBhbmUnKS5yZW1vdmVDbGFzcygnYWN0aXZlJyk7XG4gICAgICAgICAgICAkKCcjbWVzc2VuZ2VyLWh1Yi1yb290IC5taC10YWItcGFuZVtkYXRhLXRhYj1cIicgKyB0YWIgKyAnXCJdJykuYWRkQ2xhc3MoJ2FjdGl2ZScpO1xuICAgICAgICAgICAgJCgnI21lc3Nlbmdlci1odWItcm9vdCcpLmF0dHIoJ2RhdGEtYWN0aXZlLXRhYicsIHRhYik7XG4gICAgICAgICAgICBpZiAodGFiID09PSAnbm90aWZpY2F0aW9ucycpIHtcbiAgICAgICAgICAgICAgICBsb2FkUnVsZXModHJ1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodGFiID09PSAnc2V0dGluZ3MnKSB7XG4gICAgICAgICAgICAgICAgbG9hZEdlbmVyYWxTZXR0aW5ncygpO1xuICAgICAgICAgICAgICAgIGxvYWRFbXBsb3llZXMoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICBsb2FkQm90cygpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBqb3VybmFsVmlzaWJsZSgpIHtcbiAgICAgICAgcmV0dXJuICQoJyNtZXNzZW5nZXItaHViLXJvb3QgLm1oLXRhYi1wYW5lW2RhdGEtdGFiPVwiam91cm5hbFwiXScpLmhhc0NsYXNzKCdhY3RpdmUnKVxuICAgICAgICAgICAgJiYgZG9jdW1lbnQudmlzaWJpbGl0eVN0YXRlID09PSAndmlzaWJsZSc7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbm90aWZpY2F0aW9uc1Zpc2libGUoKSB7XG4gICAgICAgIHJldHVybiAkKCcjbWVzc2VuZ2VyLWh1Yi1yb290IC5taC10YWItcGFuZVtkYXRhLXRhYj1cIm5vdGlmaWNhdGlvbnNcIl0nKS5oYXNDbGFzcygnYWN0aXZlJylcbiAgICAgICAgICAgICYmIGRvY3VtZW50LnZpc2liaWxpdHlTdGF0ZSA9PT0gJ3Zpc2libGUnO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNjaGVkdWxlUmVmcmVzaCgpIHtcbiAgICAgICAgc2V0SW50ZXJ2YWwoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKGpvdXJuYWxWaXNpYmxlKCkpIHtcbiAgICAgICAgICAgICAgICBsb2FkKHsgcmVmcmVzaDogdHJ1ZSB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobm90aWZpY2F0aW9uc1Zpc2libGUoKSAmJiBzdGF0ZS5ydWxlV2l6YXJkID09PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgbG9hZFJ1bGVzKHRydWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRvY3VtZW50LnZpc2liaWxpdHlTdGF0ZSA9PT0gJ3Zpc2libGUnKSB7XG4gICAgICAgICAgICAgICAgbG9hZEpvdXJuYWxCYWRnZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LCBSRUZSRVNIX1NFQyAqIDEwMDApO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gaW5pdCAtLS0tLS0tLS0tXG5cbiAgICAkKGRvY3VtZW50KS5yZWFkeShmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJvb3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbWVzc2VuZ2VyLWh1Yi1yb290Jyk7XG4gICAgICAgIGlmICghcm9vdCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGluaXRUYWJzKCk7XG4gICAgICAgIGJ1aWxkUGVyaW9kTWVudSgpO1xuICAgICAgICByZW5kZXJTa2VsZXRvbigpO1xuXG4gICAgICAgIC8vIG91ciBjaGVja2JveGVzIGFyZSBwbGFpbiBsYWJlbHMgYXJvdW5kIGhpZGRlbiBpbnB1dHM6IGtlZXAgdGhlIHZpc3VhbCBzdGF0ZSBpbiBzeW5jXG4gICAgICAgICQoZG9jdW1lbnQpLm9uKCdjaGFuZ2UnLCAnLm1vZHVsZS1tZXNzZW5nZXItaHViIC51aS5jaGVja2JveCBpbnB1dCwgLm1oLW1vZGFsIC51aS5jaGVja2JveCBpbnB1dCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciAkaW5wdXQgPSAkKHRoaXMpO1xuICAgICAgICAgICAgaWYgKCRpbnB1dC5hdHRyKCd0eXBlJykgPT09ICdyYWRpbycpIHtcbiAgICAgICAgICAgICAgICAkKCdpbnB1dFtuYW1lPVwiJyArICRpbnB1dC5hdHRyKCduYW1lJykgKyAnXCJdJykuZWFjaChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgICQodGhpcykuY2xvc2VzdCgnLnVpLmNoZWNrYm94JykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCB0aGlzLmNoZWNrZWQpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAkaW5wdXQuY2xvc2VzdCgnLnVpLmNoZWNrYm94JykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCB0aGlzLmNoZWNrZWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAkKCcjbWgtam91cm5hbC1yZXNldC1maWx0ZXJzJykub24oJ2NsaWNrJywgcmVzZXRGaWx0ZXJzKTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtcHJvYmVzIGlucHV0Jykub24oJ2NoYW5nZScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLnNob3dQcm9iZXMgPSAkKHRoaXMpLnByb3AoJ2NoZWNrZWQnKTtcbiAgICAgICAgICAgIHJlbmRlckpvdXJuYWwoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLWJhbm5lcicpLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJiYW5uZXItZml4XCJdJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGJvdCA9IGJvdEJ5SWQoJCh0aGlzKS5kYXRhKCdib3QtaWQnKSk7XG4gICAgICAgICAgICBpZiAoYm90KSB7XG4gICAgICAgICAgICAgICAgb3BlbkJvdE1vZGFsKCdlZGl0JywgYm90KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgb3BlbkJvdE1vZGFsKCdhZGQnLCBudWxsLCAndGVsZWdyYW0nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXJldHJ5Jykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkgeyBsb2FkKCk7IH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1wcmV2Jykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHN0YXRlLm9mZnNldCA+PSBQQUdFX0xJTUlUKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUub2Zmc2V0IC09IFBBR0VfTElNSVQ7XG4gICAgICAgICAgICAgICAgbG9hZCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtbmV4dCcpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5vZmZzZXQgKyBzdGF0ZS5sYXN0SXRlbXMubGVuZ3RoIDwgc3RhdGUudG90YWwpIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5vZmZzZXQgKz0gUEFHRV9MSU1JVDtcbiAgICAgICAgICAgICAgICBsb2FkKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtcmV0ZW50aW9uLWlucHV0Jykub24oJ2NoYW5nZScsIHNhdmVSZXRlbnRpb24pO1xuICAgICAgICAkKCcjbWgtcHVibGljLXVybC1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBzYXZlUHVibGljVXJsKTtcbiAgICAgICAgJCgnI21oLXByb3h5LWlucHV0Jykub24oJ2NoYW5nZScsIHNhdmVQcm94eSk7XG4gICAgICAgICQoJyNtaC1tYXgtY2EtaW5wdXQnKS5vbignY2hhbmdlJywgc2F2ZU1heENhQnVuZGxlKTtcbiAgICAgICAgJCgnI21oLWNvbmZpZy1xdWlldC1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzYXZlTnVtYmVyU2V0dGluZygnY29uZmlnX2NoYW5nZV9xdWlldF9zZWMnLCAnI21oLWNvbmZpZy1xdWlldC1pbnB1dCcsICcjbWgtY29uZmlnLXF1aWV0LWZpZWxkJywgMTAsIDM2MDApO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWV4dGVybmFsLWlwLWlucHV0Jykub24oJ2NoYW5nZScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHNhdmVOdW1iZXJTZXR0aW5nKCdleHRlcm5hbF9pcF9wb2xsX21pbicsICcjbWgtZXh0ZXJuYWwtaXAtaW5wdXQnLCAnI21oLWV4dGVybmFsLWlwLWZpZWxkJywgNSwgMTQ0MCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtbGljZW5zZS1ob3Vycy1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzYXZlTnVtYmVyU2V0dGluZygnbGljZW5zZV9wb2xsX2hvdXJzJywgJyNtaC1saWNlbnNlLWhvdXJzLWlucHV0JywgJyNtaC1saWNlbnNlLWhvdXJzLWZpZWxkJywgMSwgMTY4KTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1saWNlbnNlLWRheXMtaW5wdXQnKS5vbignY2hhbmdlJywgc2F2ZUxpY2Vuc2VXYXJuRGF5cyk7XG4gICAgICAgICQoJyNtaC1tYXNrLWRlZmF1bHQgaW5wdXQnKS5vbignY2hhbmdlJywgc2F2ZU1hc2tEZWZhdWx0KTtcbiAgICAgICAgJCgnI21oLXF1ZXVlLW1pbi13YWl0LWlucHV0Jykub24oJ2NoYW5nZScsIHNhdmVRdWV1ZU1pbldhaXQpO1xuICAgICAgICAkKCcjbWgtcXVldWUtbG9uZy13YWl0LWlucHV0Jykub24oJ2NoYW5nZScsIHNhdmVRdWV1ZUxvbmdXYWl0KTtcbiAgICAgICAgJCgnI21oLXRvbGwtcHJlZml4ZXMtaW5wdXQnKS5vbignY2hhbmdlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc2F2ZVNlY3VyaXR5UHJlZml4ZXMoJyNtaC10b2xsLXByZWZpeGVzLWlucHV0JywgJyNtaC10b2xsLXByZWZpeGVzLWZpZWxkJywgJ3RvbGxfZnJhdWRfcHJlZml4ZXMnKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC10b2xsLWhvbWUtaW5wdXQnKS5vbignY2hhbmdlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc2F2ZVNlY3VyaXR5UHJlZml4ZXMoJyNtaC10b2xsLWhvbWUtaW5wdXQnLCAnI21oLXRvbGwtaG9tZS1maWVsZCcsICd0b2xsX2ZyYXVkX2hvbWVfcHJlZml4ZXMnKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC10b2xsLWJ1cnN0LWlucHV0Jykub24oJ2NoYW5nZScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHNhdmVTZWN1cml0eUludCgnI21oLXRvbGwtYnVyc3QtaW5wdXQnLCAnI21oLXRvbGwtYnVyc3QtZmllbGQnLCAndG9sbF9mcmF1ZF9idXJzdF9jYWxscycsIDIsIDEwMDApO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXRvbGwtd2luZG93LWlucHV0Jykub24oJ2NoYW5nZScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHNhdmVTZWN1cml0eUludCgnI21oLXRvbGwtd2luZG93LWlucHV0JywgJyNtaC10b2xsLXdpbmRvdy1maWVsZCcsICd0b2xsX2ZyYXVkX2J1cnN0X3dpbmRvd19taW4nLCAxLCAxNDQwKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC10b2xsLWZyb20taW5wdXQnKS5vbignY2hhbmdlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc2F2ZVNlY3VyaXR5VGltZSgnI21oLXRvbGwtZnJvbS1pbnB1dCcsICcjbWgtdG9sbC1mcm9tLWZpZWxkJywgJ3RvbGxfZnJhdWRfb2ZmaG91cnNfZnJvbScpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXRvbGwtdG8taW5wdXQnKS5vbignY2hhbmdlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc2F2ZVNlY3VyaXR5VGltZSgnI21oLXRvbGwtdG8taW5wdXQnLCAnI21oLXRvbGwtdG8tZmllbGQnLCAndG9sbF9mcmF1ZF9vZmZob3Vyc190bycpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXRvbGwtb2ZmaG91cnMgaW5wdXQnKS5vbignY2hhbmdlJywgc2F2ZVRvbGxPZmZIb3Vycyk7XG4gICAgICAgICQoJyNtaC1hdXRoZmFpbC10aHJlc2hvbGQtaW5wdXQnKS5vbignY2hhbmdlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc2F2ZVNlY3VyaXR5SW50KCcjbWgtYXV0aGZhaWwtdGhyZXNob2xkLWlucHV0JywgJyNtaC1hdXRoZmFpbC10aHJlc2hvbGQtZmllbGQnLCAnc2lwX2F1dGhmYWlsX3RocmVzaG9sZCcsIDEsIDEwMDApO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWF1dGhmYWlsLXdpbmRvdy1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzYXZlU2VjdXJpdHlJbnQoJyNtaC1hdXRoZmFpbC13aW5kb3ctaW5wdXQnLCAnI21oLWF1dGhmYWlsLXdpbmRvdy1maWVsZCcsICdzaXBfYXV0aGZhaWxfd2luZG93X21pbicsIDEsIDE0NDApO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWF1dGhmYWlsLXF1aWV0LWlucHV0Jykub24oJ2NoYW5nZScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHNhdmVTZWN1cml0eUludCgnI21oLWF1dGhmYWlsLXF1aWV0LWlucHV0JywgJyNtaC1hdXRoZmFpbC1xdWlldC1maWVsZCcsICdzaXBfYXV0aGZhaWxfcXVpZXRfbWluJywgNSwgMTQ0MCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtYXV0aGZhaWwtcGVycG9sbC1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzYXZlU2VjdXJpdHlJbnQoJyNtaC1hdXRoZmFpbC1wZXJwb2xsLWlucHV0JywgJyNtaC1hdXRoZmFpbC1wZXJwb2xsLWZpZWxkJywgJ3NpcF9hdXRoZmFpbF9leHRlbnNpb25zX3Blcl9wb2xsJywgNSwgMjAwKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgYmluZEJvdHNDb250YWluZXIoKTtcbiAgICAgICAgYmluZENoYXRGb3VuZCgpO1xuICAgICAgICBiaW5kUnVsZXNDb250YWluZXIoKTtcbiAgICAgICAgYmluZFdpemFyZENvbnRyb2xzKCk7XG4gICAgICAgICQoJyNtaC1ib3QtYWRkJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkgeyBvcGVuQm90TW9kYWwoJ2FkZCcsIG51bGwsICd0ZWxlZ3JhbScpOyB9KTtcbiAgICAgICAgJCgnI21oLWJvdC1jaGVjaywgI21oLWJvdC1jaGVjay1zdG9yZWQsICNtaC1ib3QtY2hlY2stbmV3Jykub24oJ2NsaWNrJywgY2hlY2tCb3RGb3JtKTtcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbi1yZXBsYWNlJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1uZXctcm93JykucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRva2VuLW5ldycpLnRyaWdnZXIoJ2ZvY3VzJyk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtYm90LXRva2VuLWNhbmNlbCcpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4tbmV3JykudmFsKCcnKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4tbmV3LXJvdycpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWJvdC1zYXZlJykub24oJ2NsaWNrJywgc2F2ZUJvdEZvcm0pO1xuICAgICAgICAkKCcjbWgtYm90LW1vZGFsJykub24oJ2NsaWNrJywgJy5taC1jaGFubmVsLWNhcmQnLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBpZiAoIXN0YXRlLmJvdE1vZGFsIHx8ICQodGhpcykuaGFzQ2xhc3MoJ2lzLWRpc2FibGVkJykpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICBzdGF0ZS5ib3RNb2RhbC5jaGFubmVsID0gU3RyaW5nKCQodGhpcykuZGF0YSgnY2hhbm5lbCcpKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtY2hlY2stbWVzc2FnZScpLmVtcHR5KCk7XG4gICAgICAgICAgICBzeW5jQm90Q2hhbm5lbCgpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWJvdC1kZWxldGUnKS5vbignY2xpY2snLCBjb25maXJtRGVsZXRlQm90KTtcbiAgICAgICAgJCgnI21oLWJvdC1tb2RhbCBbZGF0YS1hY3Rpb249XCJjYW5jZWxcIl0nKS5vbignY2xpY2snLCBjYW5jZWxCb3RNb2RhbCk7XG4gICAgICAgICQoJyNtaC1jaGF0LXN0b3AnKS5vbignY2xpY2snLCBzdG9wRGlzY292ZXJ5QW5kQ2xvc2UpO1xuICAgICAgICAkKCcjbWgtY2hhdC1hZ2FpbicpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5jaGF0TW9kYWwpIHtcbiAgICAgICAgICAgICAgICBzdGFydERpc2NvdmVyeShzdGF0ZS5jaGF0TW9kYWwuYm90SWQsIHRydWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWNoYXQtc2F2ZScpLm9uKCdjbGljaycsIHNhdmVTZWxlY3RlZENoYXRzKTtcbiAgICAgICAgJCgnI21oLWNoYXQtbW9kYWwgW2RhdGEtYWN0aW9uPVwiY2FuY2VsXCJdJykub24oJ2NsaWNrJywgc3RvcERpc2NvdmVyeUFuZENsb3NlKTtcbiAgICAgICAgJCgnI21oLXRlc3QtbW9kYWwgW2RhdGEtYWN0aW9uPVwiY2FuY2VsXCJdJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc3RvcFRlc3RQb2xsKCk7XG4gICAgICAgICAgICAkKCcjbWgtdGVzdC1tb2RhbCcpLm1vZGFsKCdoaWRlJyk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtY29uZmlybS1tb2RhbCBbZGF0YS1hY3Rpb249XCJjYW5jZWxcIl0nKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtY29uZmlybS1tb2RhbCcpLm1vZGFsKCdoaWRlJyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGxvYWRDYXRhbG9nKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGJ1aWxkVHlwZU1lbnUoKTtcbiAgICAgICAgICAgIGxvYWRFbXBsb3llZXMoZnVuY3Rpb24gKCkge30pO1xuICAgICAgICAgICAgbG9hZFByb3ZpZGVycyhmdW5jdGlvbiAoKSB7fSk7XG4gICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgIGxvYWRSdWxlcygpO1xuICAgICAgICAgICAgbG9hZCgpO1xuICAgICAgICB9KTtcbiAgICAgICAgc2NoZWR1bGVSZWZyZXNoKCk7XG4gICAgfSk7XG59KCkpO1xuIl0sIm1hcHBpbmdzIjoiO0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQyxhQUFZO0VBQ1QsWUFBWTs7RUFFWixJQUFJLFFBQVEsR0FBRyxzQ0FBc0M7RUFDckQsSUFBSSxVQUFVLEdBQUcsRUFBRTtFQUNuQixJQUFJLFdBQVcsR0FBRyxFQUFFO0VBQ3BCLElBQUksV0FBVyxHQUFHLENBQUMsT0FBTyxFQUFFLGVBQWUsRUFBRSxXQUFXLEVBQUUsYUFBYSxFQUFFLEtBQUssRUFBRSxVQUFVLENBQUM7RUFFM0YsSUFBSSxVQUFVLEdBQUcsK0hBQStIO0VBQ2hKLElBQUksWUFBWSxHQUFHLGlHQUFpRztFQUNwSCxJQUFJLFNBQVMsR0FBRywyRkFBMkY7RUFFM0csSUFBSSxJQUFJLEdBQUcsSUFBSTtFQUNmLElBQUksS0FBSyxHQUFHO0lBQ1IsT0FBTyxFQUFFLEVBQUU7SUFDWCxNQUFNLEVBQUUsT0FBTztJQUNmLFNBQVMsRUFBRSxFQUFFO0lBQ2IsTUFBTSxFQUFFLENBQUM7SUFDVCxLQUFLLEVBQUUsQ0FBQztJQUNSLFNBQVMsRUFBRSxLQUFLO0lBQ2hCLFNBQVMsRUFBRSxFQUFFO0lBQ2IsU0FBUyxFQUFFLENBQUMsQ0FBQztJQUNiLFVBQVUsRUFBRSxJQUFJO0lBQ2hCLE9BQU8sRUFBRSxDQUFDO0lBQ1YsU0FBUyxFQUFFLEVBQUU7SUFDYixRQUFRLEVBQUUsSUFBSTtJQUNkLElBQUksRUFBRSxFQUFFO0lBQ1Is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

