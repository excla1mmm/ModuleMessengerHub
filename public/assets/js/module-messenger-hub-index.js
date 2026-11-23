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
  var GROUP_ORDER = ['calls', 'ai_supervisor', 'speech_ai', 'voice_agent', 'pbx'];
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
      pbx: 'module_messenger_hub_GroupPbx'
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
      clearFieldError('#mh-max-ca-field');
      $('#mh-mask-default').toggleClass('checked', data.mask_phone_default === true);
      $('#mh-mask-default input').prop('checked', data.mask_phone_default === true);
      clearFieldError('#mh-public-url-field');
      clearFieldError('#mh-proxy-field');
      clearRetentionError();
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
    bolt: '<path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z"/>'
  };
  var SCENARIO_ICON_BY_SOURCE = {
    'core.missed_call': 'phone',
    'core.voicemail': 'mic',
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
    'core.pbx_started': 'bolt'
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
    $('#mh-mask-default input').on('change', saveMaskDefault);
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

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sInNvdXJjZXMiOlsibmV3LmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qIE1vZHVsZU1lc3Nlbmdlckh1YiBhZG1pbiBwYWdlOiBub3RpZmljYXRpb25zLCB3aXphcmQsIGpvdXJuYWwgYW5kIHNldHRpbmdzIChkZXNpZ24gdjMsIGRvY3MvZGVzaWduL01vZHVsZU1lc3Nlbmdlckh1Yi12My5odG1sKS5cbiAqIERhdGEgY29tZXMgb25seSBmcm9tIHRoZSBtb2R1bGUgUkVTVCByZXNvdXJjZXMgKHNldHRpbmdzLCBldmVudHMsIGJvdHMsIHJ1bGVzKSBhbmQgQ29yZSB2MyBsaXN0cy4gTm8gZXh0ZXJuYWwgQ0ROcy5cbiAqIFdyaXR0ZW4gaW4gcGxhaW4gRVM1ICh0YXJnZXRzIENocm9tZSA1MCAvIEZpcmVmb3ggNDUgLyBJRTExIGFmdGVyIHRoZSBCYWJlbCBwYXNzKS5cbiAqL1xuKGZ1bmN0aW9uICgpIHtcbiAgICAndXNlIHN0cmljdCc7XG5cbiAgICB2YXIgQVBJX0JBU0UgPSAnL3BieGNvcmUvYXBpL3YzL21vZHVsZS1tZXNzZW5nZXItaHViJztcbiAgICB2YXIgUEFHRV9MSU1JVCA9IDUwO1xuICAgIHZhciBSRUZSRVNIX1NFQyA9IDMwO1xuICAgIHZhciBHUk9VUF9PUkRFUiA9IFsnY2FsbHMnLCAnYWlfc3VwZXJ2aXNvcicsICdzcGVlY2hfYWknLCAndm9pY2VfYWdlbnQnLCAncGJ4J107XG5cbiAgICB2YXIgSUNPTl9FUlJPUiA9ICc8c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBhcmlhLWhpZGRlbj1cInRydWVcIj48Y2lyY2xlIGN4PVwiOFwiIGN5PVwiOFwiIHI9XCI2LjI1XCIvPjxwYXRoIGQ9XCJNNiA2bDQgNE0xMCA2bC00IDRcIi8+PC9zdmc+JztcbiAgICB2YXIgSUNPTl9DSEVWUk9OID0gJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjxwYXRoIGQ9XCJNNiAzLjVMMTAuNSA4IDYgMTIuNVwiLz48L3N2Zz4nO1xuICAgIHZhciBJQ09OX1BMVVMgPSAnPHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+PHBhdGggZD1cIk04IDN2MTBNMyA4aDEwXCIvPjwvc3ZnPic7XG5cbiAgICB2YXIgcm9vdCA9IG51bGw7XG4gICAgdmFyIHN0YXRlID0ge1xuICAgICAgICBzb3VyY2VzOiBbXSxcbiAgICAgICAgcGVyaW9kOiAndG9kYXknLFxuICAgICAgICBldmVudFR5cGU6ICcnLFxuICAgICAgICBvZmZzZXQ6IDAsXG4gICAgICAgIHRvdGFsOiAwLFxuICAgICAgICBoYXNMb2FkZWQ6IGZhbHNlLFxuICAgICAgICBsYXN0SXRlbXM6IFtdLFxuICAgICAgICBjYWxsYmFja3M6IHt9LFxuICAgICAgICBleHBhbmRlZElkOiBudWxsLFxuICAgICAgICBsb2FkU2VxOiAwLFxuICAgICAgICByZXRlbnRpb246IDMwLFxuICAgICAgICBzZXR0aW5nczogbnVsbCxcbiAgICAgICAgYm90czogW10sXG4gICAgICAgIGJvdHNMb2FkZWQ6IGZhbHNlLFxuICAgICAgICBib3RzRXJyb3I6IG51bGwsXG4gICAgICAgIGV4cGFuZGVkQm90czoge30sXG4gICAgICAgIGVtcGxveWVlczogW10sXG4gICAgICAgIGVtcGxveWVlc0xvYWRlZDogZmFsc2UsXG4gICAgICAgIGVtcGxveWVlc0ZhaWxlZDogZmFsc2UsXG4gICAgICAgIHNob3dQcm9iZXM6IGZhbHNlLFxuICAgICAgICBib3RNb2RhbDogbnVsbCxcbiAgICAgICAgY2hhdE1vZGFsOiBudWxsLFxuICAgICAgICB0ZXN0TW9kYWw6IG51bGwsXG4gICAgICAgIHJ1bGVzOiBbXSxcbiAgICAgICAgcnVsZXNMb2FkZWQ6IGZhbHNlLFxuICAgICAgICBydWxlc0Vycm9yOiBudWxsLFxuICAgICAgICBwcm92aWRlcnM6IFtdLFxuICAgICAgICBwcm92aWRlcnNMb2FkZWQ6IGZhbHNlLFxuICAgICAgICBydWxlV2l6YXJkOiBudWxsXG4gICAgfTtcblxuICAgIC8vIC0tLS0tLS0tLS0gaTE4biAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiB0KGtleSkge1xuICAgICAgICBpZiAodHlwZW9mIGdsb2JhbFRyYW5zbGF0ZSAhPT0gJ3VuZGVmaW5lZCcgJiYgZ2xvYmFsVHJhbnNsYXRlW2tleV0pIHtcbiAgICAgICAgICAgIHJldHVybiBnbG9iYWxUcmFuc2xhdGVba2V5XTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ga2V5O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHRmKGtleSwgcGFyYW1zKSB7XG4gICAgICAgIHZhciB0ZXh0ID0gdChrZXkpO1xuICAgICAgICBPYmplY3Qua2V5cyhwYXJhbXMgfHwge30pLmZvckVhY2goZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIHRleHQgPSB0ZXh0LnNwbGl0KCd7JyArIG5hbWUgKyAnfScpLmpvaW4oU3RyaW5nKHBhcmFtc1tuYW1lXSkpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHRleHQ7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBzbWFsbCBoZWxwZXJzIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIHBhZCh2YWx1ZSkge1xuICAgICAgICByZXR1cm4gdmFsdWUgPCAxMCA/ICcwJyArIHZhbHVlIDogU3RyaW5nKHZhbHVlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmbXRUaW1lKHRzKSB7XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgcmV0dXJuIHBhZChkLmdldEhvdXJzKCkpICsgJzonICsgcGFkKGQuZ2V0TWludXRlcygpKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmbXREYXRlKHRzKSB7XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgcmV0dXJuIHBhZChkLmdldERhdGUoKSkgKyAnLicgKyBwYWQoZC5nZXRNb250aCgpICsgMSkgKyAnLicgKyBkLmdldEZ1bGxZZWFyKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZm10RGF0ZVRpbWUodHMpIHtcbiAgICAgICAgcmV0dXJuIGZtdERhdGUodHMpICsgJyAnICsgZm10VGltZSh0cyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNUb2RheSh0cykge1xuICAgICAgICB2YXIgZCA9IG5ldyBEYXRlKHRzICogMTAwMCk7XG4gICAgICAgIHZhciBub3cgPSBuZXcgRGF0ZSgpO1xuICAgICAgICByZXR1cm4gZC50b0RhdGVTdHJpbmcoKSA9PT0gbm93LnRvRGF0ZVN0cmluZygpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGlzWWVzdGVyZGF5KHRzKSB7XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgdmFyIHllc3RlcmRheSA9IG5ldyBEYXRlKERhdGUubm93KCkgLSA4NjQwMDAwMCk7XG4gICAgICAgIHJldHVybiBkLnRvRGF0ZVN0cmluZygpID09PSB5ZXN0ZXJkYXkudG9EYXRlU3RyaW5nKCk7XG4gICAgfVxuXG4gICAgLy8gT25lIGxpbmUgaW4gYSA0OCBweCByb3c6IMKrMTg6MzTCuywgwqvQstGH0LXRgNCwIDE4OjM0wrssIMKrMTIuMTAgMTg6MzTCuy5cbiAgICBmdW5jdGlvbiBmbXRDZWxsVGltZSh0cykge1xuICAgICAgICBpZiAoaXNUb2RheSh0cykpIHtcbiAgICAgICAgICAgIHJldHVybiBmbXRUaW1lKHRzKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgZCA9IG5ldyBEYXRlKHRzICogMTAwMCk7XG4gICAgICAgIHZhciBkYXkgPSBpc1llc3RlcmRheSh0cykgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UaW1lWWVzdGVyZGF5JykgOiBwYWQoZC5nZXREYXRlKCkpICsgJy4nICsgcGFkKGQuZ2V0TW9udGgoKSArIDEpO1xuICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwibWgtbXV0ZWRcIj4nICsgZXNjKGRheSkgKyAnPC9zcGFuPiAnICsgZm10VGltZSh0cyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZXNjKHZhbHVlKSB7XG4gICAgICAgIHJldHVybiAkKCc8ZGl2Lz4nKS50ZXh0KFN0cmluZyh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkID8gJycgOiB2YWx1ZSkpLmh0bWwoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzdGFydE9mVG9kYXkoKSB7XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUoKTtcbiAgICAgICAgZC5zZXRIb3VycygwLCAwLCAwLCAwKTtcbiAgICAgICAgcmV0dXJuIE1hdGguZmxvb3IoZC5nZXRUaW1lKCkgLyAxMDAwKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBwZXJpb2RCb3VuZHMoKSB7XG4gICAgICAgIHZhciBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcbiAgICAgICAgdmFyIHRvZGF5U3RhcnQgPSBzdGFydE9mVG9kYXkoKTtcbiAgICAgICAgc3dpdGNoIChzdGF0ZS5wZXJpb2QpIHtcbiAgICAgICAgICAgIGNhc2UgJ3RvZGF5JzogcmV0dXJuIHsgZnJvbTogdG9kYXlTdGFydCwgdG86IG5vdyB9O1xuICAgICAgICAgICAgY2FzZSAneWVzdGVyZGF5JzogcmV0dXJuIHsgZnJvbTogdG9kYXlTdGFydCAtIDg2NDAwLCB0bzogdG9kYXlTdGFydCAtIDEgfTtcbiAgICAgICAgICAgIGNhc2UgJzdkYXlzJzogcmV0dXJuIHsgZnJvbTogdG9kYXlTdGFydCAtIDYgKiA4NjQwMCwgdG86IG5vdyB9O1xuICAgICAgICAgICAgY2FzZSAnMzBkYXlzJzogcmV0dXJuIHsgZnJvbTogdG9kYXlTdGFydCAtIDI5ICogODY0MDAsIHRvOiBub3cgfTtcbiAgICAgICAgICAgIGRlZmF1bHQ6IHJldHVybiB7IGZyb206IDAsIHRvOiAwIH07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIEFQSSAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBhcGlHZXQocGF0aCwgcGFyYW1zLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBDb25maWcucGJ4VXJsICsgQVBJX0JBU0UgKyBwYXRoLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGRhdGE6IHBhcmFtcyB8fCB7fSxcbiAgICAgICAgICAgIGNhY2hlOiBmYWxzZVxuICAgICAgICB9KS5kb25lKGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlICYmIHJlc3BvbnNlLnJlc3VsdCA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgIG9uU3VjY2VzcyhyZXNwb25zZS5kYXRhKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUocmVzcG9uc2UsIDIwMCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KS5mYWlsKGZ1bmN0aW9uICh4aHIpIHtcbiAgICAgICAgICAgIG9uRmFpbHVyZShub3JtYWxpemVGYWlsdXJlKG51bGwsIHhoci5zdGF0dXMpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYXBpUGF0Y2gocGF0aCwgcGF5bG9hZCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpIHtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogQ29uZmlnLnBieFVybCArIEFQSV9CQVNFICsgcGF0aCxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BBVENIJyxcbiAgICAgICAgICAgIGRhdGE6IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxuICAgICAgICAgICAgY29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbidcbiAgICAgICAgfSkuZG9uZShmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgICAgICAgIGlmIChyZXNwb25zZSAmJiByZXNwb25zZS5yZXN1bHQgPT09IHRydWUpIHtcbiAgICAgICAgICAgICAgICBvblN1Y2Nlc3MocmVzcG9uc2UuZGF0YSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG9uRmFpbHVyZShub3JtYWxpemVGYWlsdXJlKHJlc3BvbnNlLCAyMDApKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkuZmFpbChmdW5jdGlvbiAoeGhyKSB7XG4gICAgICAgICAgICBvbkZhaWx1cmUobm9ybWFsaXplRmFpbHVyZShudWxsLCB4aHIuc3RhdHVzKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG5vcm1hbGl6ZUZhaWx1cmUocmVzcG9uc2UsIHN0YXR1cykge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzOiBzdGF0dXMsXG4gICAgICAgICAgICBlcnJvcjogKHJlc3BvbnNlICYmIHJlc3BvbnNlLmRhdGEgJiYgcmVzcG9uc2UuZGF0YS5lcnJvcikgfHwgJ2h0dHBfJyArIHN0YXR1cyxcbiAgICAgICAgICAgIG1lc3NhZ2VzOiAocmVzcG9uc2UgJiYgcmVzcG9uc2UubWVzc2FnZXMgJiYgcmVzcG9uc2UubWVzc2FnZXMuZXJyb3IpIHx8IFtdXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBzb3VyY2UgY2F0YWxvZyAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBsb2FkQ2F0YWxvZyhkb25lKSB7XG4gICAgICAgIGFwaUdldCgnL3NldHRpbmdzOmdldFNvdXJjZXMnLCB7fSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHN0YXRlLnNvdXJjZXMgPSBkYXRhLml0ZW1zIHx8IFtdO1xuICAgICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5zb3VyY2VzID0gW107XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNvdXJjZUJ5SWQoaWQpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5zb3VyY2VzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAoc3RhdGUuc291cmNlc1tpXS5pZCA9PT0gaWQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc3RhdGUuc291cmNlc1tpXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBldmVudFR5cGVOYW1lcygpIHtcbiAgICAgICAgdmFyIG5hbWVzID0ge307XG4gICAgICAgIHN0YXRlLnNvdXJjZXMuZm9yRWFjaChmdW5jdGlvbiAoc291cmNlKSB7XG4gICAgICAgICAgICAoc291cmNlLmV2ZW50X3R5cGVzIHx8IFtdKS5mb3JFYWNoKGZ1bmN0aW9uICh0eXBlKSB7XG4gICAgICAgICAgICAgICAgbmFtZXNbdHlwZS50eXBlXSA9IHR5cGUubmFtZTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIG5hbWVzO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gam91cm5hbDogZmlsdGVycyAoZGVzaWduIHYzOiBwZXJpb2QgYW5kIGV2ZW50IG9ubHkpIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGJ1aWxkVHlwZU1lbnUoKSB7XG4gICAgICAgIHZhciBuYW1lcyA9IGV2ZW50VHlwZU5hbWVzKCk7XG4gICAgICAgIHZhciBpdGVtcyA9IFtdO1xuICAgICAgICBHUk9VUF9PUkRFUi5mb3JFYWNoKGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgdmFyIGluR3JvdXAgPSBbXTtcbiAgICAgICAgICAgIHN0YXRlLnNvdXJjZXMuZm9yRWFjaChmdW5jdGlvbiAoc291cmNlKSB7XG4gICAgICAgICAgICAgICAgaWYgKHNvdXJjZS5ncm91cCAhPT0gZ3JvdXApIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAoc291cmNlLmV2ZW50X3R5cGVzIHx8IFtdKS5mb3JFYWNoKGZ1bmN0aW9uICh0eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgIGluR3JvdXAucHVzaCh7IHZhbHVlOiB0eXBlLnR5cGUsIHRleHQ6IG5hbWVzW3R5cGUudHlwZV0gfHwgdHlwZS50eXBlIH0pO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBpZiAoaW5Hcm91cC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgaXRlbXMucHVzaCh7IGdyb3VwOiBzb3VyY2VHcm91cE5hbWUoZ3JvdXApIH0pO1xuICAgICAgICAgICAgICAgIGluR3JvdXAuZm9yRWFjaChmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICAgICAgICAgICAgICBpdGVtcy5wdXNoKGl0ZW0pO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtZmlsdGVycyAubWgtZmlsdGVyLXR5cGUnKS5kcm9wZG93bih7XG4gICAgICAgICAgICB2YWx1ZXM6IG1lbnVUb1ZhbHVlcyhpdGVtcyksXG4gICAgICAgICAgICBwbGFjZWhvbGRlcjogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRmlsdGVyQWxsVHlwZXMnKSxcbiAgICAgICAgICAgIG9uQ2hhbmdlOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5ldmVudFR5cGUgPSBTdHJpbmcodmFsdWUgfHwgJycpO1xuICAgICAgICAgICAgICAgIHJlbG9hZCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBtZW51VG9WYWx1ZXMoaXRlbXMpIHtcbiAgICAgICAgcmV0dXJuIGl0ZW1zLm1hcChmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICAgICAgaWYgKGl0ZW0uZ3JvdXApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4geyB0eXBlOiAnaGVhZGVyJywgbmFtZTogaXRlbS5ncm91cCB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHsgbmFtZTogaXRlbS50ZXh0LCB2YWx1ZTogaXRlbS52YWx1ZSB9O1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzb3VyY2VHcm91cE5hbWUoZ3JvdXApIHtcbiAgICAgICAgdmFyIGtleSA9IHtcbiAgICAgICAgICAgIGNhbGxzOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfR3JvdXBDYWxscycsXG4gICAgICAgICAgICBhaV9zdXBlcnZpc29yOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfR3JvdXBBaVN1cGVydmlzb3InLFxuICAgICAgICAgICAgc3BlZWNoX2FpOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfR3JvdXBTcGVlY2hBaScsXG4gICAgICAgICAgICB2b2ljZV9hZ2VudDogJ21vZHVsZV9tZXNzZW5nZXJfaHViX0dyb3VwVm9pY2VBZ2VudCcsXG4gICAgICAgICAgICBwYng6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Hcm91cFBieCdcbiAgICAgICAgfVtncm91cF0gfHwgZ3JvdXA7XG4gICAgICAgIHJldHVybiB0KGtleSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBtb2R1bGUgc3RhdHVzIGV2ZW50cyAoc3RhZ2UgM2IpOiBodW1hbiB3b3JkcyBmb3IgKGNvZGUsIHJlZiksIHJhdyBjb2RlcyBvbmx5IGluIGEgdG9vbHRpcCAtLS0tLS0tLS0tXG5cbiAgICB2YXIgU1RBVFVTX1JFQ09WRVJZX0tFWVMgPSB7XG4gICAgICAgICdsb2NhbF9zdHQud29ya2VyX29ubGluZSc6ICdNZXNzYWdlU3RhdHVzV29ya2VyT25saW5lJyxcbiAgICAgICAgJ2xvY2FsX3N0dC5iYWNrbG9nX3Jlc29sdmVkJzogJ01lc3NhZ2VTdGF0dXNCYWNrbG9nUmVzb2x2ZWQnLFxuICAgICAgICAnY2xvdWRfc3R0LmluY2lkZW50X3Jlc29sdmVkJzogJ01lc3NhZ2VTdGF0dXNJbmNpZGVudFJlc29sdmVkJyxcbiAgICAgICAgJ2Nsb3VkX3N0dC5yZXN1bWVkJzogJ01lc3NhZ2VTdGF0dXNSZXN1bWVkJyxcbiAgICAgICAgJ2Nsb3VkX2FpLnJlc3VtZWQnOiAnTWVzc2FnZVN0YXR1c0Nsb3VkQWlSZXN1bWVkJyxcbiAgICAgICAgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29ubGluZSc6ICdNZXNzYWdlU3RhdHVzV29ya2VyT25saW5lJ1xuICAgIH07XG4gICAgdmFyIFNUQVRVU19DT0RFX0tFWVMgPSB7XG4gICAgICAgIHdvcmtlcl9vZmZsaW5lOiAnTWVzc2FnZVN0YXR1c1dvcmtlck9mZmxpbmUnLFxuICAgICAgICBiYWNrbG9nX25vX3dvcmtlcnM6ICdNZXNzYWdlU3RhdHVzQmFja2xvZycsXG4gICAgICAgIGluY2lkZW50X29wZW46ICdNZXNzYWdlU3RhdHVzSW5jaWRlbnQnXG4gICAgfTtcbiAgICB2YXIgU1RBVFVTX1BBVVNFX0tFWVMgPSB7XG4gICAgICAgIHVzZXI6ICdNZXNzYWdlU3RhdHVzUGF1c2VkVXNlcicsXG4gICAgICAgIG1haW50ZW5hbmNlOiAnTWVzc2FnZVN0YXR1c1BhdXNlZE1haW50ZW5hbmNlJyxcbiAgICAgICAgbWFudWFsOiAnTWVzc2FnZVN0YXR1c0Nsb3VkQWlNYW51YWwnLFxuICAgICAgICBsaWNlbnNlX21pc3Npbmc6ICdNZXNzYWdlU3RhdHVzQ2xvdWRBaUxpY2Vuc2UnLFxuICAgICAgICBhdXRoX2ludmFsaWQ6ICdNZXNzYWdlU3RhdHVzQ2xvdWRBaUF1dGgnLFxuICAgICAgICBtb2RlbF91bmF2YWlsYWJsZTogJ01lc3NhZ2VTdGF0dXNDbG91ZEFpTW9kZWwnLFxuICAgICAgICBkYWlseV9saW1pdF9yZWFjaGVkOiAnTWVzc2FnZVN0YXR1c0Nsb3VkQWlEYWlseUxpbWl0JyxcbiAgICAgICAgc291cmNlX3VuYXZhaWxhYmxlOiAnTWVzc2FnZVN0YXR1c0Nsb3VkQWlTb3VyY2VVbmF2YWlsYWJsZScsXG4gICAgICAgIGluc3VmZmljaWVudF9mdW5kczogJ01lc3NhZ2VTdGF0dXNDbG91ZEFpSW5zdWZmaWNpZW50RnVuZHMnLFxuICAgICAgICBsb3dfYmFsYW5jZTogJ01lc3NhZ2VTdGF0dXNDbG91ZEFpTG93QmFsYW5jZSdcbiAgICB9O1xuXG4gICAgLy8gUHJvYmxlbSBldmVudCB0eXBlIC0+IGl0cyByZWNvdmVyeSB0eXBlLiBBIHN0YXR1cyBzY2VuYXJpbyBpcyBhbHdheXMgb25lIHBhaXI7IMKr0KHQvtC+0LHRidCw0YLRjCDQviDQstC+0YHRgdGC0LDQvdC+0LLQu9C10L3QuNC4wrtcbiAgICAvLyBpcyB0aGUgcmVjb3ZlcnkgdHlwZSBiZWluZyBpbiB0aGUgcnVsZSdzIGV2ZW50X3R5cGVzIChubyBzZXBhcmF0ZSBzdG9yYWdlKS5cbiAgICB2YXIgU1RBVFVTX1BBSVJTID0ge1xuICAgICAgICAnbG9jYWxfc3R0Lndvcmtlcl9vZmZsaW5lJzogJ2xvY2FsX3N0dC53b3JrZXJfb25saW5lJyxcbiAgICAgICAgJ2xvY2FsX3N0dC5iYWNrbG9nX25vX3dvcmtlcnMnOiAnbG9jYWxfc3R0LmJhY2tsb2dfcmVzb2x2ZWQnLFxuICAgICAgICAnY2xvdWRfc3R0LmluY2lkZW50JzogJ2Nsb3VkX3N0dC5pbmNpZGVudF9yZXNvbHZlZCcsXG4gICAgICAgICdjbG91ZF9zdHQucGF1c2VkJzogJ2Nsb3VkX3N0dC5yZXN1bWVkJyxcbiAgICAgICAgJ2Nsb3VkX2FpLnBhdXNlZCc6ICdjbG91ZF9haS5yZXN1bWVkJyxcbiAgICAgICAgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29mZmxpbmUnOiAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb25saW5lJ1xuICAgIH07XG4gICAgLy8gQ2xvdWQgQUkgcGF1c2UgcmVhc29ucyBieSBncm91cCAocnVsZSBmaWx0ZXIgYHJlYXNvbnNgKTsgbm90X2NvbmZpZ3VyZWQgbmV2ZXIgcHJvZHVjZXMgZXZlbnRzLlxuICAgIHZhciBDTE9VRF9BSV9SRUFTT05fR1JPVVBTID0gW1xuICAgICAgICBbJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFJlYXNvbkdyb3VwTW9uZXknLCBbJ2luc3VmZmljaWVudF9mdW5kcycsICdsb3dfYmFsYW5jZSddXSxcbiAgICAgICAgWydtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRSZWFzb25Hcm91cExpY2Vuc2UnLCBbJ2xpY2Vuc2VfbWlzc2luZycsICdhdXRoX2ludmFsaWQnXV0sXG4gICAgICAgIFsnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUmVhc29uR3JvdXBMaW1pdHMnLCBbJ2RhaWx5X2xpbWl0X3JlYWNoZWQnLCAnbW9kZWxfdW5hdmFpbGFibGUnXV0sXG4gICAgICAgIFsnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUmVhc29uR3JvdXBTb3VyY2UnLCBbJ3NvdXJjZV91bmF2YWlsYWJsZSddXSxcbiAgICAgICAgWydtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRSZWFzb25Hcm91cE1hbnVhbCcsIFsnbWFudWFsJ11dXG4gICAgXTtcblxuICAgIGZ1bmN0aW9uIGNsb3VkQWlSZWFzb25zKGluY2x1ZGVNYW51YWwpIHtcbiAgICAgICAgdmFyIHJlYXNvbnMgPSBbXTtcbiAgICAgICAgQ0xPVURfQUlfUkVBU09OX0dST1VQUy5mb3JFYWNoKGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgZ3JvdXBbMV0uZm9yRWFjaChmdW5jdGlvbiAocmVhc29uKSB7XG4gICAgICAgICAgICAgICAgaWYgKGluY2x1ZGVNYW51YWwgfHwgcmVhc29uICE9PSAnbWFudWFsJykgeyByZWFzb25zLnB1c2gocmVhc29uKTsgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcmVhc29ucztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBtb2R1bGVTdGF0dXNPZihpdGVtKSB7XG4gICAgICAgIHZhciBzdWJqZWN0ID0gaXRlbSAmJiBpdGVtLnBheWxvYWQgJiYgaXRlbS5wYXlsb2FkLnN1YmplY3QgPyBpdGVtLnBheWxvYWQuc3ViamVjdCA6IHt9O1xuICAgICAgICByZXR1cm4gc3ViamVjdC5tb2R1bGVfc3RhdHVzICYmIHR5cGVvZiBzdWJqZWN0Lm1vZHVsZV9zdGF0dXMgPT09ICdvYmplY3QnID8gc3ViamVjdC5tb2R1bGVfc3RhdHVzIDogbnVsbDtcbiAgICB9XG5cbiAgICAvKiogT25lIHNlbnRlbmNlIGZvciBhbiBldmVudCB0eXBlICsgKGNvZGUsIHJlZik7IGFuIHVua25vd24gcGFpciBnZXRzIGEgbmV1dHJhbCBsaW5lLCBuZXZlciB0aGUgcmF3IGNvZGUuICovXG4gICAgZnVuY3Rpb24gc3RhdHVzUGhyYXNlKGV2ZW50VHlwZSwgc3RhdHVzKSB7XG4gICAgICAgIHZhciBjb2RlID0gU3RyaW5nKChzdGF0dXMgJiYgc3RhdHVzLmNvZGUpIHx8ICcnKTtcbiAgICAgICAgdmFyIHJlZiA9IFN0cmluZygoc3RhdHVzICYmIHN0YXR1cy5yZWYpIHx8ICcnKTtcbiAgICAgICAgdmFyIGtleSA9IFNUQVRVU19SRUNPVkVSWV9LRVlTW2V2ZW50VHlwZV1cbiAgICAgICAgICAgIHx8IChjb2RlID09PSAncHJvY2Vzc2luZ19wYXVzZWQnID8gU1RBVFVTX1BBVVNFX0tFWVNbcmVmXSA6IG51bGwpXG4gICAgICAgICAgICB8fCBTVEFUVVNfQ09ERV9LRVlTW2NvZGVdXG4gICAgICAgICAgICB8fCAnTWVzc2FnZVN0YXR1c1Vua25vd24nO1xuICAgICAgICByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfJyArIGtleSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3RhdHVzQ291bnRlck5vdGVzKHN0YXR1cykge1xuICAgICAgICB2YXIgY291bnRlcnMgPSBzdGF0dXMgJiYgc3RhdHVzLmNvdW50ZXJzID8gc3RhdHVzLmNvdW50ZXJzIDoge307XG4gICAgICAgIHZhciBub3RlcyA9IFtdO1xuICAgICAgICBpZiAodHlwZW9mIGNvdW50ZXJzLndvcmtlcnNfb25saW5lID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgY291bnRlcnMud29ya2Vyc190b3RhbCA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIG5vdGVzLnB1c2godGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VTdGF0dXNXb3JrZXJzQ291bnRlcnMnLCB7IG9ubGluZTogY291bnRlcnMud29ya2Vyc19vbmxpbmUsIHRvdGFsOiBjb3VudGVycy53b3JrZXJzX3RvdGFsIH0pKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodHlwZW9mIGNvdW50ZXJzLmpvYnNfd2FpdGluZyA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIG5vdGVzLnB1c2godGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VTdGF0dXNKb2JzV2FpdGluZycsIHsgY291bnQ6IGNvdW50ZXJzLmpvYnNfd2FpdGluZyB9KSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHR5cGVvZiBjb3VudGVycy5pbmNpZGVudHNfb3BlbiA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAgIG5vdGVzLnB1c2godGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VTdGF0dXNJbmNpZGVudHNPcGVuJywgeyBjb3VudDogY291bnRlcnMuaW5jaWRlbnRzX29wZW4gfSkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBub3RlcztcbiAgICB9XG5cbiAgICAvKiogVGVjaG5pY2FsIHRvb2x0aXA6IHRoZSByYXcgY29kZSBhbmQgcmVmZXJlbmNlIG9mIHRoZSBtb2R1bGUgc3RhdHVzLCBuZXZlciB0aGUgbWFpbiB0ZXh0LiAqL1xuICAgIGZ1bmN0aW9uIHN0YXR1c1Jhd0NvZGUoaXRlbSkge1xuICAgICAgICB2YXIgc3RhdHVzID0gbW9kdWxlU3RhdHVzT2YoaXRlbSk7XG4gICAgICAgIGlmICghc3RhdHVzIHx8ICFzdGF0dXMuY29kZSkge1xuICAgICAgICAgICAgcmV0dXJuICcnO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBTdHJpbmcoc3RhdHVzLmNvZGUpICsgKHN0YXR1cy5yZWYgPyAnOicgKyBzdGF0dXMucmVmIDogJycpO1xuICAgIH1cblxuICAgIC8qKiBJbmZvcm1hdGlvbmFsIHN0YXRlIG9mIGEgc291cmNlIHdob3NlIG1vZHVsZSBjYW5ub3QgYmUgcmVhZCAobm8gYWN0aW9uIGJ1dHRvbnMsIGRlY2lzaW9uIFExNCkuICovXG4gICAgZnVuY3Rpb24gc291cmNlU3RhdGVUZXh0KHNvdXJjZSkge1xuICAgICAgICBzd2l0Y2ggKHNvdXJjZS5hdmFpbGFiaWxpdHkpIHtcbiAgICAgICAgICAgIGNhc2UgJ21vZHVsZV9taXNzaW5nJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU291cmNlU3RhdGVOb2luc3QnKTtcbiAgICAgICAgICAgIGNhc2UgJ21vZHVsZV9kaXNhYmxlZCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NvdXJjZVN0YXRlTW9kb2ZmJyk7XG4gICAgICAgICAgICBjYXNlICdhcGlfZm9yYmlkZGVuJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfTm90aWZTb3VyY2VOb0FjY2VzcycpO1xuICAgICAgICAgICAgY2FzZSAnYXBpX2luY29tcGF0aWJsZSc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHNvdXJjZS51cGRhdGVfdG9cbiAgICAgICAgICAgICAgICAgICAgPyB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfU291cmNlU3RhdGVPdXRkYXRlZFRvJywgeyB2ZXJzaW9uOiBzb3VyY2UudXBkYXRlX3RvIH0pXG4gICAgICAgICAgICAgICAgICAgIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU291cmNlU3RhdGVPdXRkYXRlZEFueScpO1xuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICByZXR1cm4gc291cmNlLmF2YWlsYWJpbGl0eV9uYW1lIHx8ICcnO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYnVpbGRQZXJpb2RNZW51KCkge1xuICAgICAgICAkKCcjbWgtam91cm5hbC1maWx0ZXJzIC5taC1maWx0ZXItcGVyaW9kJykuZHJvcGRvd24oe1xuICAgICAgICAgICAgdmFsdWVzOiBbXG4gICAgICAgICAgICAgICAgeyBuYW1lOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QZXJpb2RUb2RheScpLCB2YWx1ZTogJ3RvZGF5Jywgc2VsZWN0ZWQ6IHRydWUgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1BlcmlvZFllc3RlcmRheScpLCB2YWx1ZTogJ3llc3RlcmRheScgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1BlcmlvZDdEYXlzJyksIHZhbHVlOiAnN2RheXMnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QZXJpb2QzMERheXMnKSwgdmFsdWU6ICczMGRheXMnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QZXJpb2RBbGwnKSwgdmFsdWU6ICdhbGwnIH1cbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBvbkNoYW5nZTogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUucGVyaW9kID0gU3RyaW5nKHZhbHVlIHx8ICdhbGwnKTtcbiAgICAgICAgICAgICAgICByZWxvYWQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVzZXRGaWx0ZXJzKCkge1xuICAgICAgICBzdGF0ZS5ldmVudFR5cGUgPSAnJztcbiAgICAgICAgc3RhdGUucGVyaW9kID0gJ3RvZGF5JztcbiAgICAgICAgc3RhdGUub2Zmc2V0ID0gMDtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtZmlsdGVycyAubWgtZmlsdGVyLXR5cGUnKS5kcm9wZG93bignY2xlYXInKTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtZmlsdGVycyAubWgtZmlsdGVyLXBlcmlvZCcpLmRyb3Bkb3duKCdzZXQgc2VsZWN0ZWQnLCAndG9kYXknKTtcbiAgICAgICAgcmVsb2FkKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZmlsdGVyc0FjdGl2ZSgpIHtcbiAgICAgICAgLy8gdGhlIGRlZmF1bHQgcGVyaW9kICjCq9Ch0LXQs9C+0LTQvdGPwrspIGlzIG5vdCBhIGZpbHRlcjogYW4gZW1wdHkgbG9nIHNob3dzIMKr0KHQvtCx0YvRgtC40Lkg0L3QtdGCwrtcbiAgICAgICAgcmV0dXJuIHN0YXRlLmV2ZW50VHlwZSAhPT0gJycgfHwgc3RhdGUucGVyaW9kICE9PSAndG9kYXknO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gam91cm5hbDogbG9hZGluZyAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiByZWxvYWQoKSB7XG4gICAgICAgIHN0YXRlLm9mZnNldCA9IDA7XG4gICAgICAgIGxvYWQoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBsb2FkKG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIHNlcSA9ICsrc3RhdGUubG9hZFNlcTtcbiAgICAgICAgdmFyIGJvdW5kcyA9IHBlcmlvZEJvdW5kcygpO1xuICAgICAgICB2YXIgaXNSZWZyZXNoID0gb3B0aW9ucyAmJiBvcHRpb25zLnJlZnJlc2ggPT09IHRydWU7XG4gICAgICAgIHZhciBwYXJhbXMgPSB7XG4gICAgICAgICAgICBsaW1pdDogUEFHRV9MSU1JVCxcbiAgICAgICAgICAgIG9mZnNldDogc3RhdGUub2Zmc2V0XG4gICAgICAgIH07XG4gICAgICAgIGlmIChzdGF0ZS5ldmVudFR5cGUgIT09ICcnKSB7IHBhcmFtcy5ldmVudF90eXBlID0gc3RhdGUuZXZlbnRUeXBlOyB9XG4gICAgICAgIGlmIChib3VuZHMuZnJvbSA+IDApIHsgcGFyYW1zLmRhdGVfZnJvbSA9IGJvdW5kcy5mcm9tOyB9XG4gICAgICAgIGlmIChib3VuZHMudG8gPiAwKSB7IHBhcmFtcy5kYXRlX3RvID0gYm91bmRzLnRvOyB9XG5cbiAgICAgICAgc2V0Sm91cm5hbEJ1c3kodHJ1ZSwgaXNSZWZyZXNoKTtcbiAgICAgICAgYXBpR2V0KCcvZXZlbnRzJywgcGFyYW1zLCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgaWYgKHNlcSAhPT0gc3RhdGUubG9hZFNlcSkge1xuICAgICAgICAgICAgICAgIHJldHVybjsgLy8gYSBuZXdlciByZXF1ZXN0IGFscmVhZHkgYW5zd2VyZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHN0YXRlLnRvdGFsID0gZGF0YS5wYWdpbmF0aW9uID8gZGF0YS5wYWdpbmF0aW9uLnRvdGFsIDogMDtcbiAgICAgICAgICAgIHN0YXRlLmxhc3RJdGVtcyA9IGRhdGEuaXRlbXMgfHwgW107XG4gICAgICAgICAgICBzdGF0ZS5oYXNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc2V0Sm91cm5hbEJ1c3koZmFsc2UsIGlzUmVmcmVzaCk7XG4gICAgICAgICAgICByZW5kZXJKb3VybmFsKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICBpZiAoc2VxICE9PSBzdGF0ZS5sb2FkU2VxKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc2V0Sm91cm5hbEJ1c3koZmFsc2UsIGlzUmVmcmVzaCk7XG4gICAgICAgICAgICByZW5kZXJMb2FkRXJyb3IoZmFpbHVyZSk7XG4gICAgICAgIH0pO1xuICAgICAgICBsb2FkSm91cm5hbEJhZGdlKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2V0Sm91cm5hbEJ1c3koYnVzeSwgaXNSZWZyZXNoKSB7XG4gICAgICAgIHZhciAkdGFibGUgPSAkKCcjbWgtam91cm5hbC10YWJsZSB0YWJsZScpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmF0dHIoJ2FyaWEtYnVzeScsIGJ1c3kgPyAndHJ1ZScgOiAnZmFsc2UnKTtcbiAgICAgICAgJHRhYmxlLnRvZ2dsZUNsYXNzKCdpcy1yZWZyZXNoaW5nJywgQm9vbGVhbihidXN5ICYmIGlzUmVmcmVzaCkpO1xuICAgICAgICBpZiAoIWlzUmVmcmVzaCkge1xuICAgICAgICAgICAgaWYgKGJ1c3kpIHtcbiAgICAgICAgICAgICAgICByZW5kZXJTa2VsZXRvbigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtZXJyb3InKS5lbXB0eSgpO1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtZXJyb3ItcGxhY2Vob2xkZXInKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGpvdXJuYWxUYWJsZUhlYWQoKSB7XG4gICAgICAgIHJldHVybiAnPGNvbGdyb3VwPjxjb2wgc3R5bGU9XCJ3aWR0aDozNnB4XCI+PGNvbCBzdHlsZT1cIndpZHRoOjEwNHB4XCI+PGNvbCBzdHlsZT1cIndpZHRoOjI0MHB4XCI+PGNvbD48Y29sIHN0eWxlPVwid2lkdGg6MTYwcHhcIj48L2NvbGdyb3VwPidcbiAgICAgICAgICAgICsgJzx0aGVhZD48dHI+PHRoPjwvdGg+J1xuICAgICAgICAgICAgKyAnPHRoPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29sdW1uVGltZScpKSArICc8L3RoPidcbiAgICAgICAgICAgICsgJzx0aD4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbHVtbkV2ZW50JykpICsgJzwvdGg+J1xuICAgICAgICAgICAgKyAnPHRoPjwvdGg+J1xuICAgICAgICAgICAgKyAnPHRoPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29sdW1uRGVsaXZlcnknKSkgKyAnPC90aD4nXG4gICAgICAgICAgICArICc8L3RyPjwvdGhlYWQ+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJTa2VsZXRvbigpIHtcbiAgICAgICAgdmFyIHJvd3MgPSAnJztcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCAzOyBpKyspIHtcbiAgICAgICAgICAgIHJvd3MgKz0gJzx0ciBjbGFzcz1cIm1oLXNrZWwtcm93XCI+PHRkPjwvdGQ+PHRkPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6MzZweFwiPjwvc3Bhbj48L3RkPidcbiAgICAgICAgICAgICAgICArICc8dGQ+PHNwYW4gY2xhc3M9XCJtaC1za2VsXCIgc3R5bGU9XCJ3aWR0aDoxNjBweFwiPjwvc3Bhbj48L3RkPidcbiAgICAgICAgICAgICAgICArICc8dGQ+PHNwYW4gY2xhc3M9XCJtaC1za2VsXCIgc3R5bGU9XCJ3aWR0aDo3MCVcIj48L3NwYW4+PC90ZD4nXG4gICAgICAgICAgICAgICAgKyAnPHRkPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6OTZweDtoZWlnaHQ6MjBweDtib3JkZXItcmFkaXVzOjVweFwiPjwvc3Bhbj48L3RkPjwvdHI+JztcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmh0bWwoJzxkaXYgY2xhc3M9XCJtaC10YWJsZS13cmFwXCI+PHRhYmxlIGNsYXNzPVwidWkgdGFibGUgbWgtam91cm5hbC10YWJsZVwiIGFyaWEtYnVzeT1cInRydWVcIj4nXG4gICAgICAgICAgICArIGpvdXJuYWxUYWJsZUhlYWQoKSArICc8dGJvZHk+JyArIHJvd3MgKyAnPC90Ym9keT48L3RhYmxlPjwvZGl2PicpO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gam91cm5hbDogZGlzcGxheSBydWxlcyAocHJvYmVzIGhpZGRlbiwgY2FsbGJhY2tzIGZvbGRlZCBpbnRvIHRoZSBtaXNzZWQgY2FsbCkgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gaXNQcm9iZShpdGVtKSB7XG4gICAgICAgIHJldHVybiBCb29sZWFuKGl0ZW0gJiYgaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5wcm9iZSA9PT0gdHJ1ZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2FsbGJhY2tJbmRleChpdGVtcykge1xuICAgICAgICB2YXIgaW5kZXggPSB7fTtcbiAgICAgICAgKGl0ZW1zIHx8IFtdKS5mb3JFYWNoKGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgICAgICBpZiAoaXRlbS5ldmVudF90eXBlICE9PSAnY29yZS5taXNzZWRfY2FsbF9yZXNvbHZlZCcpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgY2FsbCA9IChpdGVtLnBheWxvYWQgJiYgaXRlbS5wYXlsb2FkLnN1YmplY3QgJiYgaXRlbS5wYXlsb2FkLnN1YmplY3QuY2FsbCkgfHwge307XG4gICAgICAgICAgICBpZiAoY2FsbC5taXNzZWRfbGlua2VkaWQgJiYgIWluZGV4W2NhbGwubWlzc2VkX2xpbmtlZGlkXSkge1xuICAgICAgICAgICAgICAgIGluZGV4W2NhbGwubWlzc2VkX2xpbmtlZGlkXSA9IGl0ZW0ub2NjdXJyZWRfYXQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gaW5kZXg7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2FsbGJhY2tUaW1lKGl0ZW0pIHtcbiAgICAgICAgdmFyIGNhbGwgPSAoaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5zdWJqZWN0ICYmIGl0ZW0ucGF5bG9hZC5zdWJqZWN0LmNhbGwpIHx8IHt9O1xuICAgICAgICBpZiAoY2FsbC5saW5rZWRpZCAmJiBzdGF0ZS5jYWxsYmFja3NbY2FsbC5saW5rZWRpZF0pIHtcbiAgICAgICAgICAgIHJldHVybiBzdGF0ZS5jYWxsYmFja3NbY2FsbC5saW5rZWRpZF07XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHJlc29sdmVkID0gMDtcbiAgICAgICAgKGl0ZW0uZGVsaXZlcmllcyB8fCBbXSkuZm9yRWFjaChmdW5jdGlvbiAoZGVsaXZlcnkpIHtcbiAgICAgICAgICAgIGlmIChkZWxpdmVyeS5yZXNvbHZlZF9hdCAmJiAocmVzb2x2ZWQgPT09IDAgfHwgZGVsaXZlcnkucmVzb2x2ZWRfYXQgPCByZXNvbHZlZCkpIHtcbiAgICAgICAgICAgICAgICByZXNvbHZlZCA9IGRlbGl2ZXJ5LnJlc29sdmVkX2F0O1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHJlc29sdmVkO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHZpc2libGVKb3VybmFsSXRlbXMoKSB7XG4gICAgICAgIHN0YXRlLmNhbGxiYWNrcyA9IGNhbGxiYWNrSW5kZXgoc3RhdGUubGFzdEl0ZW1zKTtcbiAgICAgICAgcmV0dXJuIHN0YXRlLmxhc3RJdGVtcy5maWx0ZXIoZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgICAgIGlmIChpdGVtLmV2ZW50X3R5cGUgPT09ICdjb3JlLm1pc3NlZF9jYWxsX3Jlc29sdmVkJykge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBzdGF0ZS5zaG93UHJvYmVzIHx8ICFpc1Byb2JlKGl0ZW0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJKb3VybmFsKCkge1xuICAgICAgICBoaWRlSm91cm5hbFN0YXRlcygpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvcicpLmVtcHR5KCk7XG4gICAgICAgIHJlbmRlckpvdXJuYWxCYW5uZXIoKTtcbiAgICAgICAgdmFyIGl0ZW1zID0gdmlzaWJsZUpvdXJuYWxJdGVtcygpO1xuXG4gICAgICAgIGlmIChpdGVtcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIGlmIChmaWx0ZXJzQWN0aXZlKCkpIHtcbiAgICAgICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lbXB0eS1maWx0ZXJlZCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lbXB0eScpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtdGFibGUnKS5lbXB0eSgpO1xuICAgICAgICAgICAgcmVuZGVyUGFnZXIoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBuYW1lcyA9IGV2ZW50VHlwZU5hbWVzKCk7XG4gICAgICAgIGlmICghbmFtZXNbJ2h1Yi50ZXN0J10pIHtcbiAgICAgICAgICAgIG5hbWVzWydodWIudGVzdCddID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRXZlbnRUeXBlVGVzdCcpO1xuICAgICAgICB9XG4gICAgICAgIHZhciByb3dzID0gJyc7XG4gICAgICAgIGl0ZW1zLmZvckVhY2goZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgICAgIHJvd3MgKz0gcmVuZGVyUm93KGl0ZW0sIG5hbWVzW2l0ZW0uZXZlbnRfdHlwZV0gfHwgaXRlbS5ldmVudF90eXBlKTtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5leHBhbmRlZElkID09PSBpdGVtLmlkKSB7XG4gICAgICAgICAgICAgICAgcm93cyArPSByZW5kZXJEZXRhaWxSb3coaXRlbSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmh0bWwoJzxkaXYgY2xhc3M9XCJtaC10YWJsZS13cmFwXCI+PHRhYmxlIGNsYXNzPVwidWkgc2VsZWN0YWJsZSB0YWJsZSBtaC1qb3VybmFsLXRhYmxlXCI+J1xuICAgICAgICAgICAgKyBqb3VybmFsVGFibGVIZWFkKCkgKyAnPHRib2R5PicgKyByb3dzICsgJzwvdGJvZHk+PC90YWJsZT48L2Rpdj4nKTtcblxuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZSB0Ym9keSB0ci5taC1ldmVudC1yb3cnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB0b2dnbGVSb3coJCh0aGlzKS5kYXRhKCdpZCcpKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXRhYmxlJykub2ZmKCdjbGljay5yZXRyeScpLm9uKCdjbGljay5yZXRyeScsICdbZGF0YS1hY3Rpb249XCJyZXRyeS1ldmVudFwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgICB2YXIgZXZlbnRJZCA9ICQodGhpcykuZGF0YSgnZXZlbnQtaWQnKTtcbiAgICAgICAgICAgIHZhciAkYnV0dG9uID0gJCh0aGlzKS5wcm9wKCdkaXNhYmxlZCcsIHRydWUpO1xuICAgICAgICAgICAgYXBpUG9zdCgnL2V2ZW50cy8nICsgZXZlbnRJZCArICc6cmV0cnknLCB7fSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5UmV0cmllZCcsIHsgY291bnQ6IGRhdGEucmV0cmllZCB8fCAwIH0pKTtcbiAgICAgICAgICAgICAgICBsb2FkKCk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgICAgICRidXR0b24ucHJvcCgnZGlzYWJsZWQnLCBmYWxzZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICByZW5kZXJQYWdlcigpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGhpZGVKb3VybmFsU3RhdGVzKCkge1xuICAgICAgICAkKCcjbWgtam91cm5hbC1lbXB0eScpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1lbXB0eS1maWx0ZXJlZCcpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvci1wbGFjZWhvbGRlcicpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckxvYWRFcnJvcihmYWlsdXJlKSB7XG4gICAgICAgIHZhciBoaW50ID0gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vbkxvYWRFcnJvcicsIHtcbiAgICAgICAgICAgIHdoYXQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0xvYWRXaGF0RXZlbnRzJyksXG4gICAgICAgICAgICBjb2RlOiBmYWlsdXJlLnN0YXR1cyA+IDAgPyBmYWlsdXJlLnN0YXR1cyA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblRpbWVvdXQnKVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKHN0YXRlLmhhc0xvYWRlZCAmJiBzdGF0ZS5sYXN0SXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgLy8gZGF0YSBpcyBhbHJlYWR5IG9uIHRoZSBzY3JlZW46IGtlZXAgdGhlIHRhYmxlLCBzaG93IGEgYmFubmVyIGFib3ZlIGl0XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvcicpLmh0bWwoXG4gICAgICAgICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlXCIgcm9sZT1cImFsZXJ0XCI+JyArIElDT05fRVJST1JcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtZ3Jvd1wiPicgKyBlc2MoaGludCkgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgJzxidXR0b24gY2xhc3M9XCJ1aSBiYXNpYyBidXR0b24gbWgtb24tbWVzc2FnZVwiIHR5cGU9XCJidXR0b25cIiBpZD1cIm1oLWpvdXJuYWwtcmV0cnktaW5saW5lXCI+J1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblJldHJ5JykpICsgJzwvYnV0dG9uPjwvZGl2PidcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1yZXRyeS1pbmxpbmUnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IGxvYWQoKTsgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmVtcHR5KCk7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1wYWdlcicpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtZXJyb3ItcGxhY2Vob2xkZXItaGludCcpLnRleHQoaGludCk7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvci1wbGFjZWhvbGRlcicpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiBwcm9ibGVtIGJhbm5lciBhbmQgdGhlIHVuZGVsaXZlcmVkIGNvdW50ZXIgb24gdGhlIHRhYiAtLS0tLS0tLS0tXG5cbiAgICAvLyBPbmUgcmVkIGxpbmUgYWJvdmUgdGhlIHRhYmxlIGluc3RlYWQgb2YgwqvQkdC+0YIg0YPQtNCw0LvRkdC9wrsgaW4gZXZlcnkgcm93IChkZXNpZ24gdjMsIMKr0JbRg9GA0L3QsNC7wrspLlxuICAgIGZ1bmN0aW9uIGJvdFByb2JsZW0oKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUuYm90cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGJvdCA9IHN0YXRlLmJvdHNbaV07XG4gICAgICAgICAgICBpZiAoYm90LmVuYWJsZWQgIT09IGZhbHNlICYmIGJvdC5zdGF0dXMgPT09ICd0b2tlbl9pbnZhbGlkJykge1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQ6IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9CYW5uZXJUb2tlbkludmFsaWQnLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICBib3Q6IGJvdC5ib3RfdXNlcm5hbWUgPyAnQCcgKyBib3QuYm90X3VzZXJuYW1lIDogJ8KrJyArIGJvdC50aXRsZSArICfCuydcbiAgICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgICAgIGJvdElkOiBOdW1iZXIoYm90LmlkKVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gYSBkZWxldGVkIGJvdCBpcyBvbmx5IHZpc2libGUgdGhyb3VnaCBpdHMgZmFpbGVkIGRlbGl2ZXJpZXMgKHRoZSBib3Qgcm93IGlzIGdvbmUpXG4gICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgc3RhdGUubGFzdEl0ZW1zLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICB2YXIgZGVsaXZlcmllcyA9IHN0YXRlLmxhc3RJdGVtc1tqXS5kZWxpdmVyaWVzIHx8IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgayA9IDA7IGsgPCBkZWxpdmVyaWVzLmxlbmd0aDsgaysrKSB7XG4gICAgICAgICAgICAgICAgaWYgKGRlbGl2ZXJpZXNba10uYm90X2RlbGV0ZWQgJiYgaXNGYWlsZWREZWxpdmVyeShkZWxpdmVyaWVzW2tdKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4geyB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9CYW5uZXJCb3REZWxldGVkJyksIGJvdElkOiAwIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckpvdXJuYWxCYW5uZXIoKSB7XG4gICAgICAgIHZhciBwcm9ibGVtID0gc3RhdGUuYm90c0xvYWRlZCA/IGJvdFByb2JsZW0oKSA6IG51bGw7XG4gICAgICAgIGlmIChwcm9ibGVtID09PSBudWxsKSB7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1iYW5uZXInKS5lbXB0eSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC1qb3VybmFsLWJhbm5lcicpLmh0bWwoJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlIG1oLWJhbm5lclwiIHJvbGU9XCJhbGVydFwiPicgKyBJQ09OX0VSUk9SXG4gICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtZ3Jvd1wiPicgKyBlc2MocHJvYmxlbS50ZXh0KSArICc8L2Rpdj4nXG4gICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uIG1oLW9uLW1lc3NhZ2VcIiB0eXBlPVwiYnV0dG9uXCIgZGF0YS1hY3Rpb249XCJiYW5uZXItZml4XCIgZGF0YS1ib3QtaWQ9XCInICsgcHJvYmxlbS5ib3RJZCArICdcIj4nXG4gICAgICAgICAgICArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9CYW5uZXJDb25uZWN0JykpICsgJzwvYnV0dG9uPjwvZGl2PicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGlzRmFpbGVkRGVsaXZlcnkoZGVsaXZlcnkpIHtcbiAgICAgICAgcmV0dXJuIGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2ZhaWxlZCcgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnZHJvcHBlZCc7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNVbmRlbGl2ZXJlZChpdGVtKSB7XG4gICAgICAgIHJldHVybiAoaXRlbS5kZWxpdmVyaWVzIHx8IFtdKS5zb21lKGlzRmFpbGVkRGVsaXZlcnkpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGxvYWRKb3VybmFsQmFkZ2UoKSB7XG4gICAgICAgIGFwaUdldCgnL2V2ZW50cycsIHsgZGF0ZV9mcm9tOiBzdGFydE9mVG9kYXkoKSwgbGltaXQ6IDIwMCB9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgdmFyIGNvdW50ID0gKGRhdGEuaXRlbXMgfHwgW10pLmZpbHRlcihmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICAgICAgICAgIHJldHVybiAhaXNQcm9iZShpdGVtKSAmJiBpc1VuZGVsaXZlcmVkKGl0ZW0pO1xuICAgICAgICAgICAgfSkubGVuZ3RoO1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtYmFkZ2UnKS50ZXh0KGNvdW50ID4gOTkgPyAnOTkrJyA6IFN0cmluZyhjb3VudCkpXG4gICAgICAgICAgICAgICAgLmF0dHIoJ2FyaWEtbGFiZWwnLCB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfSm91cm5hbEJhZGdlTGFiZWwnLCB7IGNvdW50OiBjb3VudCB9KSlcbiAgICAgICAgICAgICAgICAuYXR0cignaGlkZGVuJywgY291bnQgPiAwID8gbnVsbCA6IHRydWUpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoKSB7fSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiByb3dzIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGJyaWVmRm9yKGl0ZW0pIHtcbiAgICAgICAgdmFyIHN1YmplY3QgPSBpdGVtLnBheWxvYWQgJiYgaXRlbS5wYXlsb2FkLnN1YmplY3QgPyBpdGVtLnBheWxvYWQuc3ViamVjdCA6IHt9O1xuICAgICAgICB2YXIgZmFjdHMgPSBpdGVtLnBheWxvYWQgJiYgaXRlbS5wYXlsb2FkLmZhY3RzID8gaXRlbS5wYXlsb2FkLmZhY3RzIDoge307XG4gICAgICAgIHN3aXRjaCAoaXRlbS5ldmVudF90eXBlKSB7XG4gICAgICAgICAgICBjYXNlICdjb3JlLm1pc3NlZF9jYWxsJzpcbiAgICAgICAgICAgIGNhc2UgJ3ZvaWNlX2FnZW50LmNhbGxiYWNrX3JlcXVlc3QnOlxuICAgICAgICAgICAgICAgIHZhciBlbXBsb3llZXMgPSAoc3ViamVjdC5lbXBsb3llZXMgfHwgW10pLm1hcChzaG9ydEVtcGxveWVlKS5qb2luKCcsICcpO1xuICAgICAgICAgICAgICAgIHZhciBjbGllbnQgPSBzdWJqZWN0LmNsaWVudF9udW1iZXIgfHwgJyc7XG4gICAgICAgICAgICAgICAgaWYgKGNsaWVudCAhPT0gJycgJiYgZW1wbG95ZWVzICE9PSAnJykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gY2xpZW50ICsgJyDihpIgJyArIGVtcGxveWVlcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNsaWVudCAhPT0gJycgPyBjbGllbnQgOiBlbXBsb3llZXM7XG4gICAgICAgICAgICBjYXNlICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJzpcbiAgICAgICAgICAgICAgICBpZiAoZmFjdHMuc2NvcmVzICYmIGZhY3RzLnNjb3Jlcy5xdWFsaXR5ICE9PSBudWxsICYmIGZhY3RzLnNjb3Jlcy5xdWFsaXR5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9CcmllZlNjb3JlJywgeyBzY29yZTogZmFjdHMuc2NvcmVzLnF1YWxpdHkgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBmYWN0cy5zdW1tYXJ5IHx8IHN1YmplY3QuY2xpZW50X251bWJlciB8fCAnJztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUucHJvdmlkZXJfZG93bic6XG4gICAgICAgICAgICBjYXNlICdjb3JlLnByb3ZpZGVyX3VwJzpcbiAgICAgICAgICAgICAgICB2YXIgcHJvdmlkZXIgPSBzdWJqZWN0LnByb3ZpZGVyIHx8IHt9O1xuICAgICAgICAgICAgICAgIHJldHVybiBwcm92aWRlci51c2VybmFtZSA/ICdTSVAgwqsnICsgcHJvdmlkZXIudXNlcm5hbWUgKyAnwrsnIDogKHByb3ZpZGVyLmhvc3QgfHwgcHJvdmlkZXIuaWQgfHwgJycpO1xuICAgICAgICAgICAgY2FzZSAnY29yZS5hZHZpY2UnOlxuICAgICAgICAgICAgICAgIHJldHVybiBmYWN0cy5zdW1tYXJ5IHx8IGFkdmljZVRleHQoc3ViamVjdC5hZHZpY2UgfHwge30pO1xuICAgICAgICAgICAgY2FzZSAnaHViLnRlc3QnOlxuICAgICAgICAgICAgICAgIHZhciB0ZXN0U3lzdGVtID0gc3ViamVjdC5zeXN0ZW0gfHwge307XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRlc3RTeXN0ZW0uYm90X3RpdGxlIHx8ICcnO1xuICAgICAgICAgICAgY2FzZSAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb2ZmbGluZSc6XG4gICAgICAgICAgICBjYXNlICdhaV9zdXBlcnZpc29yLndvcmtlcl9vbmxpbmUnOlxuICAgICAgICAgICAgICAgIGlmIChzdWJqZWN0Lm1vZHVsZV9zdGF0dXMpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHN0YXR1c1BocmFzZShpdGVtLmV2ZW50X3R5cGUsIHN1YmplY3QubW9kdWxlX3N0YXR1cyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiAoc3ViamVjdC53b3JrZXIgJiYgc3ViamVjdC53b3JrZXIubmFtZSkgfHwgZmFjdHMuc3VtbWFyeSB8fCAnJztcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgaWYgKHN1YmplY3QubW9kdWxlX3N0YXR1cykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gc3RhdHVzUGhyYXNlKGl0ZW0uZXZlbnRfdHlwZSwgc3ViamVjdC5tb2R1bGVfc3RhdHVzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhY3RzLnN1bW1hcnkgfHwgJyc7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyDCq9Cf0L7RgNGC0L3QvtCyINCQ0LvQtdC60YHQtdC5wrsgKDIwNCkg4oaSIMKr0J/QvtGA0YLQvdC+0LIg0JAuICgyMDQpwrssIGFzIGluIHRoZSBqb3VybmFsIG1vY2t1cFxuICAgIGZ1bmN0aW9uIHNob3J0RW1wbG95ZWUoZW1wbG95ZWUpIHtcbiAgICAgICAgdmFyIG5hbWUgPSBTdHJpbmcoZW1wbG95ZWUubmFtZSB8fCAnJykudHJpbSgpO1xuICAgICAgICB2YXIgcGFydHMgPSBuYW1lLnNwbGl0KC9cXHMrLyk7XG4gICAgICAgIGlmIChwYXJ0cy5sZW5ndGggPj0gMiAmJiBwYXJ0c1sxXSAhPT0gJycpIHtcbiAgICAgICAgICAgIG5hbWUgPSBwYXJ0c1swXSArICcgJyArIHBhcnRzWzFdLmNoYXJBdCgwKSArICcuJztcbiAgICAgICAgfVxuICAgICAgICBpZiAobmFtZSA9PT0gJycpIHtcbiAgICAgICAgICAgIHJldHVybiBTdHJpbmcoZW1wbG95ZWUubnVtYmVyIHx8ICcnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZW1wbG95ZWUubnVtYmVyID8gbmFtZSArICcgKCcgKyBlbXBsb3llZS5udW1iZXIgKyAnKScgOiBuYW1lO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZ1bGxFbXBsb3llZShlbXBsb3llZSkge1xuICAgICAgICByZXR1cm4gZW1wbG95ZWUubmFtZSA/IGVtcGxveWVlLm5hbWUgKyAoZW1wbG95ZWUubnVtYmVyID8gJyAoJyArIGVtcGxveWVlLm51bWJlciArICcpJyA6ICcnKSA6IFN0cmluZyhlbXBsb3llZS5udW1iZXIgfHwgJycpO1xuICAgIH1cblxuICAgIC8vIENvcmUgYWR2aWNlIHRleHQ6IHRoZSBhZG1pbiBjYWJpbmV0IGFscmVhZHkgaGFzIHRoZSBDb3JlIGNhdGFsb2cgaW4gZ2xvYmFsVHJhbnNsYXRlXG4gICAgLy8gKHRlbXBsYXRlcyBsaWtlIFwi4oCmIDxhIGhyZWY9JyV1cmwlJz4ldmVyJTwvYT5cIik7IHN1YnN0aXR1dGUgcGFyYW1zIGFuZCBkcm9wIHRoZSBtYXJrdXAgYXMgcGxhaW4gdGV4dC5cbiAgICBmdW5jdGlvbiBhZHZpY2VUZXh0KGFkdmljZSkge1xuICAgICAgICB2YXIgdHBsID0gKGFkdmljZSAmJiBhZHZpY2UubWVzc2FnZV90cGwpIHx8ICcnO1xuICAgICAgICB2YXIgdGV4dCA9IHQodHBsKTtcbiAgICAgICAgaWYgKHRwbCA9PT0gJycgfHwgdGV4dCA9PT0gdHBsKSB7XG4gICAgICAgICAgICByZXR1cm4gdHBsO1xuICAgICAgICB9XG4gICAgICAgIHZhciBwYXJhbXMgPSAoYWR2aWNlICYmIGFkdmljZS5wYXJhbXMpIHx8IHt9O1xuICAgICAgICBPYmplY3Qua2V5cyhwYXJhbXMpLmZvckVhY2goZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIHRleHQgPSB0ZXh0LnNwbGl0KCclJyArIG5hbWUgKyAnJScpLmpvaW4oU3RyaW5nKHBhcmFtc1tuYW1lXSkpO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gTmV2ZXIgcGFyc2UgYXMgSFRNTCAocGFyYW1zIG1heSBjYXJyeSB1c2VyLWVudGVyZWQgbmFtZXMpOiBzdHJpcCB0YWdzIGFzIHRleHQsIG91dHB1dCBpcyBlc2NhcGVkIGxhdGVyLlxuICAgICAgICByZXR1cm4gdGV4dC5yZXBsYWNlKC88W14+XSo+L2csICcnKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZuYnNwOy9nLCAnICcpLnJlcGxhY2UoLyZxdW90Oy9nLCAnXCInKS5yZXBsYWNlKC8mIzAzOTt8JiMzOTsvZywgXCInXCIpXG4gICAgICAgICAgICAucmVwbGFjZSgvJmx0Oy9nLCAnPCcpLnJlcGxhY2UoLyZndDsvZywgJz4nKS5yZXBsYWNlKC8mYW1wOy9nLCAnJicpXG4gICAgICAgICAgICAucmVwbGFjZSgvXFxzKy9nLCAnICcpLnRyaW0oKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJSb3coaXRlbSwgZXZlbnROYW1lKSB7XG4gICAgICAgIHZhciBwcm9iZSA9IGlzUHJvYmUoaXRlbSkgPyAnPHNwYW4gY2xhc3M9XCJtaC1wcm9iZVwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUHJvYmVUYWcnKSkgKyAnPC9zcGFuPicgOiAnJztcbiAgICAgICAgdmFyIGJyaWVmID0gYnJpZWZGb3IoaXRlbSk7XG4gICAgICAgIHZhciBleHBhbmRlZCA9IHN0YXRlLmV4cGFuZGVkSWQgPT09IGl0ZW0uaWQ7XG4gICAgICAgIHJldHVybiAnPHRyIGNsYXNzPVwibWgtZXZlbnQtcm93JyArIChleHBhbmRlZCA/ICcgYWN0aXZlJyA6ICcnKSArICdcIiBkYXRhLWlkPVwiJyArIGl0ZW0uaWQgKyAnXCIgYXJpYS1leHBhbmRlZD1cIicgKyAoZXhwYW5kZWQgPyAndHJ1ZScgOiAnZmFsc2UnKSArICdcIj4nXG4gICAgICAgICAgICArICc8dGQgY2xhc3M9XCJtaC1jaGV2cm9uLWNlbGxcIj4nICsgSUNPTl9DSEVWUk9OICsgJzwvdGQ+J1xuICAgICAgICAgICAgKyAnPHRkIGNsYXNzPVwibWgtY2VsbC10aW1lXCI+JyArIGZtdENlbGxUaW1lKGl0ZW0ub2NjdXJyZWRfYXQpICsgJzwvdGQ+J1xuICAgICAgICAgICAgKyAnPHRkPjxkaXYgY2xhc3M9XCJtaC1ldmVudC1jZWxsXCI+PHNwYW4gY2xhc3M9XCJtaC10cnVuY2F0ZVwiIHRpdGxlPVwiJyArIGVzYyhldmVudE5hbWUpICsgJ1wiPicgKyBlc2MoZXZlbnROYW1lKSArICc8L3NwYW4+JyArIHByb2JlICsgJzwvZGl2PjwvdGQ+J1xuICAgICAgICAgICAgKyAnPHRkIGNsYXNzPVwibWgtdHJ1bmNhdGUgbWgtbXV0ZWRcIiB0aXRsZT1cIicgKyBlc2Moc3RhdHVzUmF3Q29kZShpdGVtKSAhPT0gJycgPyBicmllZiArICcgKCcgKyBzdGF0dXNSYXdDb2RlKGl0ZW0pICsgJyknIDogYnJpZWYpICsgJ1wiPicgKyBlc2MoYnJpZWYpICsgJzwvdGQ+J1xuICAgICAgICAgICAgKyAnPHRkPicgKyBkZWxpdmVyeUNlbGwoaXRlbSkgKyAnPC90ZD4nXG4gICAgICAgICAgICArICc8L3RyPic7XG4gICAgfVxuXG4gICAgLy8gM+KAkzQgaHVtYW4gZmllbGRzOyB0ZWNobmljYWwgb25lcyAoZXZlbnQgdHlwZSwgY2FsbCBJRCwgc291cmNlKSBzdGF5IG91dCBvZiB0aGUgaW50ZXJmYWNlLlxuICAgIGZ1bmN0aW9uIGRldGFpbEZpZWxkcyhpdGVtKSB7XG4gICAgICAgIHZhciBzdWJqZWN0ID0gaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5zdWJqZWN0ID8gaXRlbS5wYXlsb2FkLnN1YmplY3QgOiB7fTtcbiAgICAgICAgdmFyIGZhY3RzID0gaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5mYWN0cyA/IGl0ZW0ucGF5bG9hZC5mYWN0cyA6IHt9O1xuICAgICAgICB2YXIgZmllbGRzID0gW107XG4gICAgICAgIHZhciBlbXBsb3llZXMgPSAoc3ViamVjdC5lbXBsb3llZXMgfHwgW10pLm1hcChmdWxsRW1wbG95ZWUpLmpvaW4oJywgJyk7XG4gICAgICAgIGlmIChlbXBsb3llZXMgIT09ICcnKSB7IGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxFbXBsb3llZScpLCBlbXBsb3llZXNdKTsgfVxuICAgICAgICBpZiAoc3ViamVjdC5jbGllbnRfbnVtYmVyKSB7IGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxDbGllbnQnKSwgc3ViamVjdC5jbGllbnRfbnVtYmVyXSk7IH1cbiAgICAgICAgaWYgKGl0ZW0uZXZlbnRfdHlwZSA9PT0gJ2NvcmUubWlzc2VkX2NhbGwnKSB7XG4gICAgICAgICAgICB2YXIgY2FsbGJhY2sgPSBjYWxsYmFja1RpbWUoaXRlbSk7XG4gICAgICAgICAgICBpZiAoY2FsbGJhY2sgPiAwKSB7XG4gICAgICAgICAgICAgICAgZmllbGRzLnB1c2goW3QoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RldGFpbENhbGxlZEJhY2snKSwgZm10Q2VsbFRleHQoY2FsbGJhY2spXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHByb3ZpZGVyID0gc3ViamVjdC5wcm92aWRlciB8fCB7fTtcbiAgICAgICAgaWYgKHByb3ZpZGVyLnVzZXJuYW1lIHx8IHByb3ZpZGVyLmhvc3QpIHtcbiAgICAgICAgICAgIGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxQcm92aWRlcicpLCAocHJvdmlkZXIudXNlcm5hbWUgfHwgJycpICsgKHByb3ZpZGVyLmhvc3QgPyAnIMK3ICcgKyBwcm92aWRlci5ob3N0IDogJycpXSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN1YmplY3QuYWR2aWNlICYmIHN1YmplY3QuYWR2aWNlLm1lc3NhZ2VfdHBsICYmICFmYWN0cy5zdW1tYXJ5KSB7XG4gICAgICAgICAgICBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsU3VtbWFyeScpLCBhZHZpY2VUZXh0KHN1YmplY3QuYWR2aWNlKV0pO1xuICAgICAgICB9XG4gICAgICAgIGlmIChmYWN0cy5zY29yZXMgJiYgZmFjdHMuc2NvcmVzLnF1YWxpdHkgIT09IG51bGwgJiYgZmFjdHMuc2NvcmVzLnF1YWxpdHkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZmllbGRzLnB1c2goW3QoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RldGFpbFNjb3JlJyksIGZhY3RzLnNjb3Jlcy5xdWFsaXR5XSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGZhY3RzLnN1bW1hcnkpIHsgZmllbGRzLnB1c2goW3QoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RldGFpbFN1bW1hcnknKSwgZmFjdHMuc3VtbWFyeV0pOyB9XG4gICAgICAgIGlmIChzdWJqZWN0Lm1vZHVsZV9zdGF0dXMpIHtcbiAgICAgICAgICAgIGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxTdW1tYXJ5JyksXG4gICAgICAgICAgICAgICAgW3N0YXR1c1BocmFzZShpdGVtLmV2ZW50X3R5cGUsIHN1YmplY3QubW9kdWxlX3N0YXR1cyldLmNvbmNhdChzdGF0dXNDb3VudGVyTm90ZXMoc3ViamVjdC5tb2R1bGVfc3RhdHVzKSkuam9pbignLiAnKV0pO1xuICAgICAgICB9XG4gICAgICAgIGlmICgoZmFjdHMucmVhc29ucyB8fCBbXSkubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgZmllbGRzLnB1c2goW3QoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RldGFpbFJlYXNvbnMnKSwgZmFjdHMucmVhc29ucy5qb2luKCc7ICcpXSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZpZWxkcztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmbXRDZWxsVGV4dCh0cykge1xuICAgICAgICBpZiAoaXNUb2RheSh0cykpIHtcbiAgICAgICAgICAgIHJldHVybiBmbXRUaW1lKHRzKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZm10RGF0ZSh0cykgKyAnICcgKyBmbXRUaW1lKHRzKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJEZXRhaWxSb3coaXRlbSkge1xuICAgICAgICB2YXIgaHRtbCA9ICc8ZGwgY2xhc3M9XCJtaC1maWVsZHNcIj4nO1xuICAgICAgICBkZXRhaWxGaWVsZHMoaXRlbSkuZm9yRWFjaChmdW5jdGlvbiAocGFpcikge1xuICAgICAgICAgICAgaHRtbCArPSAnPGR0PicgKyBlc2MocGFpclswXSkgKyAnPC9kdD48ZGQ+JyArIGVzYyhwYWlyWzFdKSArICc8L2RkPic7XG4gICAgICAgIH0pO1xuICAgICAgICB2YXIgcmV0cnlhYmxlID0gZmFsc2U7XG4gICAgICAgIChpdGVtLmRlbGl2ZXJpZXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24gKGRlbGl2ZXJ5KSB7XG4gICAgICAgICAgICB2YXIgc3RhdHVzID0gZGVsaXZlcnlTdGF0dXNUZXh0KGRlbGl2ZXJ5KTtcbiAgICAgICAgICAgIHZhciBhdWRpbyA9IGF0dGFjaG1lbnRMaW5lKGRlbGl2ZXJ5KTtcbiAgICAgICAgICAgIHZhciByYXdDb2RlID0gZGVsaXZlcnkubGFzdF9lcnJvcl9jb2RlIHx8ICcnO1xuICAgICAgICAgICAgaHRtbCArPSAnPGR0IGNsYXNzPVwibWgtdHJ1bmNhdGVcIj4nICsgZXNjKHJlY2lwaWVudFRpdGxlKGRlbGl2ZXJ5KSkgKyAnPC9kdD4nXG4gICAgICAgICAgICAgICAgKyAnPGRkJyArIChzdGF0dXMuYmFkID8gJyBjbGFzcz1cIm1oLWVycm9yLXRleHRcIicgOiAnJykgKyAocmF3Q29kZSAhPT0gJycgPyAnIHRpdGxlPVwiJyArIGVzYyhyYXdDb2RlKS5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JykgKyAnXCInIDogJycpICsgJz4nXG4gICAgICAgICAgICAgICAgKyBlc2Moc3RhdHVzLnRleHQpXG4gICAgICAgICAgICAgICAgKyAoYXVkaW8gPyAnPGRpdiBjbGFzcz1cIm1oLW1ldGEnICsgKGF1ZGlvLmJhZCA/ICcgbWgtZXJyb3ItdGV4dCcgOiAnJykgKyAnXCInXG4gICAgICAgICAgICAgICAgICAgICsgKGF1ZGlvLmNvZGUgIT09ICcnID8gJyB0aXRsZT1cIicgKyBlc2MoYXVkaW8uY29kZSkucmVwbGFjZSgvXCIvZywgJyZxdW90OycpICsgJ1wiJyA6ICcnKSArICc+JyArIGVzYyhhdWRpby50ZXh0KSArICc8L2Rpdj4nIDogJycpXG4gICAgICAgICAgICAgICAgKyAnPC9kZD4nO1xuICAgICAgICAgICAgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2ZhaWxlZCcgJiYgIWRlbGl2ZXJ5LmJvdF9kZWxldGVkICYmICFkZWxpdmVyeS5jaGF0X2RlbGV0ZWQpIHtcbiAgICAgICAgICAgICAgICByZXRyeWFibGUgPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgaHRtbCArPSAnPC9kbD4nO1xuICAgICAgICBpZiAocmV0cnlhYmxlKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8YnV0dG9uIGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uXCIgdHlwZT1cImJ1dHRvblwiIGRhdGEtYWN0aW9uPVwicmV0cnktZXZlbnRcIiBkYXRhLWV2ZW50LWlkPVwiJyArIGl0ZW0uaWQgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5UmV0cnknKSkgKyAnPC9idXR0b24+JztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJzx0ciBjbGFzcz1cIm1oLWRldGFpbFwiIGRhdGEtZGV0YWlsLWZvcj1cIicgKyBpdGVtLmlkICsgJ1wiPjx0ZCBjb2xzcGFuPVwiNVwiPjxkaXYgY2xhc3M9XCJtaC1kZXRhaWwtYm9keVwiPicgKyBodG1sICsgJzwvZGl2PjwvdGQ+PC90cj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlY2lwaWVudFRpdGxlKGRlbGl2ZXJ5KSB7XG4gICAgICAgIGlmIChkZWxpdmVyeS5jaGF0X3RpdGxlKSB7XG4gICAgICAgICAgICByZXR1cm4gZGVsaXZlcnkuY2hhdF90aXRsZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuY2hhdF9kZWxldGVkKSB7XG4gICAgICAgICAgICByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlDaGF0RGVsZXRlZCcpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBkZWxpdmVyeS5leHRlcm5hbF9jaGF0X2lkIHx8ICfigJQnO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlbGl2ZXJ5Q291bnRzKGl0ZW0pIHtcbiAgICAgICAgdmFyIGNvdW50cyA9IHsgdG90YWw6IDAsIHNlbnQ6IDAsIGZhaWxlZDogMCwgcGVuZGluZzogMCwgcmVzb2x2ZWQ6IDAgfTtcbiAgICAgICAgKGl0ZW0uZGVsaXZlcmllcyB8fCBbXSkuZm9yRWFjaChmdW5jdGlvbiAoZGVsaXZlcnkpIHtcbiAgICAgICAgICAgIGNvdW50cy50b3RhbCsrO1xuICAgICAgICAgICAgaWYgKGlzRmFpbGVkRGVsaXZlcnkoZGVsaXZlcnkpKSB7IGNvdW50cy5mYWlsZWQrKzsgfVxuICAgICAgICAgICAgZWxzZSBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAncGVuZGluZycgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnc2VuZGluZycpIHsgY291bnRzLnBlbmRpbmcrKzsgfVxuICAgICAgICAgICAgZWxzZSBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAnY2FuY2VsbGVkJykgeyBjb3VudHMucmVzb2x2ZWQrKzsgfVxuICAgICAgICAgICAgZWxzZSB7IGNvdW50cy5zZW50Kys7IH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBjb3VudHM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZGVsaXZlcnlDZWxsKGl0ZW0pIHtcbiAgICAgICAgdmFyIGMgPSBkZWxpdmVyeUNvdW50cyhpdGVtKTtcbiAgICAgICAgaWYgKGMudG90YWwgPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1tdXRlZFwiPuKAlDwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjLmZhaWxlZCA+IDApIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgSUNPTl9FUlJPUiArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeU5vdERlbGl2ZXJlZCcpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYy5wZW5kaW5nID4gMCkge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIm1oLWRvdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdFF1ZXVlZCcpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYy5zZW50ID09PSAwICYmIGMucmVzb2x2ZWQgPiAwKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwibWgtZG90XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeUNhbGxlZEJhY2snKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIm1oLWRvdCBpcy1va1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdERlbGl2ZXJlZCcpKSArICc8L3NwYW4+JztcbiAgICB9XG5cbiAgICAvLyBPbmUgbGluZSBwZXIgcmVjaXBpZW50OiBzdGF0dXMg4oCUIHJlYXNvbi5cbiAgICBmdW5jdGlvbiBkZWxpdmVyeVN0YXR1c1RleHQoZGVsaXZlcnkpIHtcbiAgICAgICAgaWYgKGlzRmFpbGVkRGVsaXZlcnkoZGVsaXZlcnkpKSB7XG4gICAgICAgICAgICB2YXIgcmVhc29uID0gZGVsaXZlcnlSZWFzb24oZGVsaXZlcnkpO1xuICAgICAgICAgICAgcmV0dXJuIHsgYmFkOiB0cnVlLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeU5vdERlbGl2ZXJlZCcpICsgKHJlYXNvbiAhPT0gJycgPyAnIMK3ICcgKyByZWFzb24gOiAnJykgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAncGVuZGluZycgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnc2VuZGluZycpIHtcbiAgICAgICAgICAgIHJldHVybiB7IGJhZDogZmFsc2UsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3RRdWV1ZWQnKSArIChkZWxpdmVyeS5uZXh0X2F0dGVtcHRfYXQgPiAwXG4gICAgICAgICAgICAgICAgPyAnIMK3ICcgKyB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlOZXh0JywgeyB0aW1lOiBmbXRDZWxsVGV4dChkZWxpdmVyeS5uZXh0X2F0dGVtcHRfYXQpIH0pXG4gICAgICAgICAgICAgICAgOiAnJykgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAnY2FuY2VsbGVkJykge1xuICAgICAgICAgICAgcmV0dXJuIHsgYmFkOiBmYWxzZSwgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlTdGF0dXNDYW5jZWxsZWQnKSB9O1xuICAgICAgICB9XG4gICAgICAgIGlmIChkZWxpdmVyeS5zdGF0dXMgPT09ICdyZXRyYWN0ZWQnKSB7XG4gICAgICAgICAgICByZXR1cm4geyBiYWQ6IGZhbHNlLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeVN0YXR1c1JldHJhY3RlZCcpIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3JldHJhY3RfZmFpbGVkJykge1xuICAgICAgICAgICAgcmV0dXJuIHsgYmFkOiB0cnVlLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeVN0YXR1c1JldHJhY3RGYWlsZWQnKSB9O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7IGJhZDogZmFsc2UsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3REZWxpdmVyZWQnKSB9O1xuICAgIH1cblxuICAgIC8vIE5vcm1hbGlzZWQgZGVsaXZlcnkvYXR0YWNobWVudCBjb2RlcyAtPiByZWFkYWJsZSB0ZXh0LiBUaGUgcmF3IGNvZGUgc3RheXMgYXZhaWxhYmxlIGluIGEgdG9vbHRpcCBvbmx5LlxuICAgIHZhciBDT0RFX1RFWFRfS0VZUyA9IHtcbiAgICAgICAgJ2F0dGFjaG1lbnQuY29udmVydGVyX21pc3NpbmcnOiAnUmVhc29uTm9Db252ZXJ0ZXInLFxuICAgICAgICAnYXR0YWNobWVudC5jb252ZXJzaW9uX2ZhaWxlZCc6ICdSZWFzb25Db252ZXJ0JyxcbiAgICAgICAgJ2F0dGFjaG1lbnQuY29udmVyc2lvbl90aW1lb3V0JzogJ1JlYXNvbkNvbnZlcnQnLFxuICAgICAgICAnYXR0YWNobWVudC5wcmVwYXJlX2ZhaWxlZCc6ICdSZWFzb25Db252ZXJ0JyxcbiAgICAgICAgJ2F0dGFjaG1lbnQuY2FjaGVfdW5hdmFpbGFibGUnOiAnUmVhc29uQ29udmVydCcsXG4gICAgICAgICdhdHRhY2htZW50LmJ1c3knOiAnUmVhc29uQ29udmVydCcsXG4gICAgICAgICdhdHRhY2htZW50LnRvb19iaWcnOiAnUmVhc29uVG9vQmlnJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQuZHVyYXRpb25fdG9vX2xvbmcnOiAnUmVhc29uVG9vQmlnJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQuc291cmNlX21pc3NpbmcnOiAnUmVhc29uTm9SZWNvcmRpbmcnLFxuICAgICAgICAnYXR0YWNobWVudC5wYXRoX21pc3NpbmcnOiAnUmVhc29uTm9SZWNvcmRpbmcnLFxuICAgICAgICAnYXR0YWNobWVudC5wYXRoX3JlamVjdGVkJzogJ1JlYXNvbkZpbGVVbmF2YWlsYWJsZScsXG4gICAgICAgICdhdHRhY2htZW50LnVuYXZhaWxhYmxlJzogJ1JlYXNvbkZpbGVVbmF2YWlsYWJsZScsXG4gICAgICAgICd0ZWxlZ3JhbS5maWxlX3VuYXZhaWxhYmxlJzogJ1JlYXNvbkZpbGVVbmF2YWlsYWJsZScsXG4gICAgICAgICdhdHRhY2htZW50LnF1b3Rlc19taXNzaW5nJzogJ1JlYXNvbk5vUXVvdGVzJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQudW5jZXJ0YWluJzogJ1JlYXNvblVuY2VydGFpbicsXG4gICAgICAgICdkZWxpdmVyeS51bmNlcnRhaW4nOiAnUmVhc29uVW5jZXJ0YWluJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQucmV0cnlfZXhoYXVzdGVkJzogJ1JlYXNvblJldHJpZXMnLFxuICAgICAgICAnZGVsaXZlcnkuaW5jb21wbGV0ZSc6ICdSZWFzb25SZXRyaWVzJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQucmVqZWN0ZWQnOiAnUmVhc29uUmVqZWN0ZWQnLFxuICAgICAgICAnaHR0cC5iYWRfcmVxdWVzdCc6ICdSZWFzb25SZWplY3RlZCcsXG4gICAgICAgICdhdHRhY2htZW50Lm5vdC5yZWFkeSc6ICdSZWFzb25Ob3RSZWFkeScsXG4gICAgICAgICdtYXguYXR0YWNobWVudC5ub3RfcmVhZHknOiAnUmVhc29uTm90UmVhZHknLFxuICAgICAgICAnYXR0YWNobWVudC5jYW5jZWxsZWQnOiAnUmVhc29uQ2FuY2VsbGVkJyxcbiAgICAgICAgJ2h0dHAuY29ubmVjdF9mYWlsZWQnOiAnUmVhc29uTm9Db25uZWN0aW9uJyxcbiAgICAgICAgJ2h0dHAudGltZW91dCc6ICdSZWFzb25Ob0Nvbm5lY3Rpb24nLFxuICAgICAgICAnaHR0cC51bmF2YWlsYWJsZSc6ICdSZWFzb25Ob0Nvbm5lY3Rpb24nLFxuICAgICAgICAnaHR0cC50bHMnOiAnUmVhc29uTm9Db25uZWN0aW9uJ1xuICAgIH07XG5cbiAgICBmdW5jdGlvbiBjb2RlVGV4dChjb2RlKSB7XG4gICAgICAgIHZhciBrZXkgPSBDT0RFX1RFWFRfS0VZU1tjb2RlXTtcbiAgICAgICAgcmV0dXJuIGtleSA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViXycgKyBrZXkpIDogY29kZTtcbiAgICB9XG5cbiAgICAvLyBcIlJlY29yZGluZzogc2VudCAvIHJlcGxhY2VkIGJ5IGEgbm90ZSAvIHNraXBwZWQgwrcgcmVhc29uXCI7IG51bGwgd2hlbiB0aGUgZGVsaXZlcnkgY2FycmllcyBubyBhdWRpby5cbiAgICBmdW5jdGlvbiBhdHRhY2htZW50TGluZShkZWxpdmVyeSkge1xuICAgICAgICB2YXIgYSA9IGRlbGl2ZXJ5LmF0dGFjaG1lbnQ7XG4gICAgICAgIGlmICghYSB8fCAhYS5zdGF0ZSB8fCBhLnN0YXRlID09PSAnbm9uZScpIHsgcmV0dXJuIG51bGw7IH1cbiAgICAgICAgdmFyIHRleHQ7XG4gICAgICAgIHZhciBiYWQgPSBmYWxzZTtcbiAgICAgICAgdmFyIHRvdGFsID0gTnVtYmVyKGEucGFydHMpIHx8IDA7XG4gICAgICAgIGlmIChhLnN0YXRlID09PSAncGVuZGluZycpIHtcbiAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hRdWV1ZWQnKTtcbiAgICAgICAgfSBlbHNlIGlmIChhLnN0YXRlID09PSAnc2VudCcpIHtcbiAgICAgICAgICAgIHRleHQgPSB0b3RhbCA+IDFcbiAgICAgICAgICAgICAgICA/IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hQYXJ0aWFsJywgeyBzZW50OiBhLnNlbnQsIHRvdGFsOiB0b3RhbCB9KVxuICAgICAgICAgICAgICAgIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQXR0YWNoU2VudCcpO1xuICAgICAgICB9IGVsc2UgaWYgKGEuc3RhdGUgPT09ICdwYXJ0aWFsJykge1xuICAgICAgICAgICAgdGV4dCA9IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hQYXJ0aWFsJywgeyBzZW50OiBhLnNlbnQsIHRvdGFsOiB0b3RhbCB9KTtcbiAgICAgICAgfSBlbHNlIGlmIChhLnN0YXRlID09PSAnc2tpcHBlZCcpIHtcbiAgICAgICAgICAgIC8vIHRoZSBmYWxsYmFjayBub3RlIGluIHRoZSB0ZXh0IHRlbGxzIHdoZXJlIHRoZSByZWNvcmRpbmcgY2FuIGJlIGZvdW5kXG4gICAgICAgICAgICB0ZXh0ID0gYS5ub3RlID09PSAnc2VudCcgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hSZXBsYWNlZCcpIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQXR0YWNoU2tpcHBlZCcpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGV4dCA9IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0F0dGFjaEZhaWxlZCcpO1xuICAgICAgICAgICAgYmFkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYS5jb2RlICYmIGEuc3RhdGUgIT09ICdwZW5kaW5nJyAmJiBhLnN0YXRlICE9PSAnc2VudCcpIHtcbiAgICAgICAgICAgIHRleHQgKz0gJyDCtyAnICsgY29kZVRleHQoYS5jb2RlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geyB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hMYWJlbCcpICsgJzogJyArIHRleHQsIGNvZGU6IGEuY29kZSB8fCAnJywgYmFkOiBiYWQgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZWxpdmVyeVJlYXNvbihkZWxpdmVyeSkge1xuICAgICAgICBpZiAoZGVsaXZlcnkuYm90X2RlbGV0ZWQpIHsgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5Qm90RGVsZXRlZCcpOyB9XG4gICAgICAgIGlmIChkZWxpdmVyeS5jaGF0X2RlbGV0ZWQpIHsgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5Q2hhdERlbGV0ZWQnKTsgfVxuICAgICAgICB2YXIgY29kZSA9IGRlbGl2ZXJ5Lmxhc3RfZXJyb3JfY29kZSB8fCAnJztcbiAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MDEudW5hdXRob3JpemVkJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzVG9rZW5JbnZhbGlkJyk7IH1cbiAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MDMua2lja2VkJyB8fCBjb2RlID09PSAndGVsZWdyYW0uNDAzLmJsb2NrZWQnIHx8IGNvZGUgPT09ICd0ZWxlZ3JhbS40MDAuY2hhdF9ub3RfZm91bmQnXG4gICAgICAgICAgICB8fCBjb2RlID09PSAnbWF4LjQwMy5jaGF0X2RlbmllZCcgfHwgY29kZSA9PT0gJ21heC40MDQubm90X2ZvdW5kJyB8fCBjb2RlID09PSAnbWF4LjQwNC51bmtub3duJykge1xuICAgICAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRTdGF0dXNHb25lJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGNvZGVUZXh0KGNvZGUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHRvZ2dsZVJvdyhpZCkge1xuICAgICAgICBzdGF0ZS5leHBhbmRlZElkID0gc3RhdGUuZXhwYW5kZWRJZCA9PT0gaWQgPyBudWxsIDogaWQ7XG4gICAgICAgIHJlbmRlckpvdXJuYWwoKTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGpvdXJuYWw6IHBhZ2VyIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIHJlbmRlclBhZ2VyKCkge1xuICAgICAgICB2YXIgJHBhZ2VyID0gJCgnI21oLWpvdXJuYWwtcGFnZXInKTtcbiAgICAgICAgaWYgKHN0YXRlLmxhc3RJdGVtcy5sZW5ndGggPT09IDAgfHwgc3RhdGUudG90YWwgPD0gUEFHRV9MSU1JVCkge1xuICAgICAgICAgICAgJHBhZ2VyLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICRwYWdlci5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtcGFnZS1pbmZvJykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfRXZlbnRzUGFnZScsIHtcbiAgICAgICAgICAgIGZyb206IHN0YXRlLm9mZnNldCArIDEsXG4gICAgICAgICAgICB0bzogc3RhdGUub2Zmc2V0ICsgc3RhdGUubGFzdEl0ZW1zLmxlbmd0aCxcbiAgICAgICAgICAgIHRvdGFsOiBzdGF0ZS50b3RhbFxuICAgICAgICB9KSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXByZXYnKS5hdHRyKCdkaXNhYmxlZCcsIHN0YXRlLm9mZnNldCA8PSAwKTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtbmV4dCcpLmF0dHIoJ2Rpc2FibGVkJywgc3RhdGUub2Zmc2V0ICsgc3RhdGUubGFzdEl0ZW1zLmxlbmd0aCA+PSBzdGF0ZS50b3RhbCk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBzZXR0aW5ncyB0YWIgLS0tLS0tLS0tLVxuXG4gICAgLy8gRmllbGRzIGNhcnJ5IG5vIGhpbnRzIChkZXNpZ24gdjMpOyB0aGUgaGVscCBsaW5lIHVuZGVyIGEgZmllbGQgaXMgdXNlZCBvbmx5IGZvciBpdHMgZXJyb3IuXG4gICAgZnVuY3Rpb24gbWFya0ZpZWxkRXJyb3IoZmllbGRTZWxlY3RvciwgbWVzc2FnZSkge1xuICAgICAgICAkKGZpZWxkU2VsZWN0b3IpLmFkZENsYXNzKCdlcnJvcicpLmZpbmQoJy5taC1oZWxwJykudGV4dChtZXNzYWdlIHx8ICcnKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjbGVhckZpZWxkRXJyb3IoZmllbGRTZWxlY3Rvcikge1xuICAgICAgICAkKGZpZWxkU2VsZWN0b3IpLnJlbW92ZUNsYXNzKCdlcnJvcicpLmZpbmQoJy5taC1oZWxwJykudGV4dCgnJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbWFya1JldGVudGlvbkVycm9yKG1lc3NhZ2UpIHtcbiAgICAgICAgbWFya0ZpZWxkRXJyb3IoJyNtaC1yZXRlbnRpb24tZmllbGQnLCBtZXNzYWdlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjbGVhclJldGVudGlvbkVycm9yKCkge1xuICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC1yZXRlbnRpb24tZmllbGQnKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlUmV0ZW50aW9uKCkge1xuICAgICAgICB2YXIgcmF3ID0gU3RyaW5nKCQoJyNtaC1yZXRlbnRpb24taW5wdXQnKS52YWwoKSB8fCAnJykudHJpbSgpO1xuICAgICAgICB2YXIgZGF5cyA9IC9eXFxkKyQvLnRlc3QocmF3KSA/IHBhcnNlSW50KHJhdywgMTApIDogLTE7XG4gICAgICAgIGlmIChkYXlzIDwgMSB8fCBkYXlzID4gMzY1KSB7XG4gICAgICAgICAgICBtYXJrUmV0ZW50aW9uRXJyb3IodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NldHRpbmdzUmV0ZW50aW9uRXJyb3InLCB7fSkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNsZWFyUmV0ZW50aW9uRXJyb3IoKTtcbiAgICAgICAgYXBpUGF0Y2goJy9zZXR0aW5ncycsIHsgZXZlbnRzX3JldGVudGlvbl9kYXlzOiBkYXlzIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLnJldGVudGlvbiA9IGRheXM7XG4gICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZWQnKSk7XG4gICAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIG1hcmtSZXRlbnRpb25FcnJvcih0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uTG9hZEVycm9yJywge1xuICAgICAgICAgICAgICAgIHdoYXQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0xvYWRXaGF0U2V0dGluZ3MnKSxcbiAgICAgICAgICAgICAgICBjb2RlOiAnaHR0cF9lcnJvcidcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICQoJyNtaC1yZXRlbnRpb24taW5wdXQnKS52YWwoc3RhdGUucmV0ZW50aW9uKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2hvd1RvYXN0KG1lc3NhZ2UpIHtcbiAgICAgICAgLy8gdGhlIGFkbWluIGNhYmluZXQncyBGb21hbnRpYyBidWlsZCBoYXMgbm8gdG9hc3QgbW9kdWxlIOKAlCBhIHRpbnkgcGlsbCBvZiBvdXIgb3duICg0IHMpXG4gICAgICAgIHZhciBleGlzdGluZyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJy5taC10b2FzdCcpO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGV4aXN0aW5nLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBleGlzdGluZ1tpXS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGV4aXN0aW5nW2ldKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgdG9hc3QgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICAgICAgdG9hc3QuY2xhc3NOYW1lID0gJ21oLXRvYXN0JztcbiAgICAgICAgdG9hc3Quc2V0QXR0cmlidXRlKCdyb2xlJywgJ3N0YXR1cycpO1xuICAgICAgICB0b2FzdC50ZXh0Q29udGVudCA9IG1lc3NhZ2U7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQodG9hc3QpO1xuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICh0b2FzdC5wYXJlbnROb2RlKSB7XG4gICAgICAgICAgICAgICAgdG9hc3QucGFyZW50Tm9kZS5yZW1vdmVDaGlsZCh0b2FzdCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sIDQwMDApO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gYm90czogQVBJIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGFwaVNlbmQobWV0aG9kLCBwYXRoLCBwYXlsb2FkLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICB2YXIgb3B0aW9ucyA9IHtcbiAgICAgICAgICAgIHVybDogQ29uZmlnLnBieFVybCArIEFQSV9CQVNFICsgcGF0aCxcbiAgICAgICAgICAgIG1ldGhvZDogbWV0aG9kLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgIGNhY2hlOiBmYWxzZVxuICAgICAgICB9O1xuICAgICAgICBpZiAocGF5bG9hZCAhPT0gbnVsbCAmJiBwYXlsb2FkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIG9wdGlvbnMuZGF0YSA9IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpO1xuICAgICAgICAgICAgb3B0aW9ucy5jb250ZW50VHlwZSA9ICdhcHBsaWNhdGlvbi9qc29uJztcbiAgICAgICAgfVxuICAgICAgICAkLmFqYXgob3B0aW9ucykuZG9uZShmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgICAgICAgIGlmIChyZXNwb25zZSAmJiByZXNwb25zZS5yZXN1bHQgPT09IHRydWUpIHtcbiAgICAgICAgICAgICAgICBvblN1Y2Nlc3MocmVzcG9uc2UuZGF0YSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG9uRmFpbHVyZShub3JtYWxpemVGYWlsdXJlKHJlc3BvbnNlLCAyMDApKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkuZmFpbChmdW5jdGlvbiAoeGhyKSB7XG4gICAgICAgICAgICBvbkZhaWx1cmUobm9ybWFsaXplRmFpbHVyZSh4aHIucmVzcG9uc2VKU09OIHx8IG51bGwsIHhoci5zdGF0dXMpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYXBpUG9zdChwYXRoLCBwYXlsb2FkLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICBhcGlTZW5kKCdQT1NUJywgcGF0aCwgcGF5bG9hZCB8fCB7fSwgb25TdWNjZXNzLCBvbkZhaWx1cmUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGFwaURlbGV0ZShwYXRoLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICBhcGlTZW5kKCdERUxFVEUnLCBwYXRoLCBudWxsLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY29yZUdldChwYXRoLCBwYXJhbXMsIG9uU3VjY2Vzcywgb25GYWlsdXJlKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IENvbmZpZy5wYnhVcmwgKyAnL3BieGNvcmUvYXBpL3YzJyArIHBhdGgsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YTogcGFyYW1zIHx8IHt9LFxuICAgICAgICAgICAgY2FjaGU6IGZhbHNlXG4gICAgICAgIH0pLmRvbmUoZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2UucmVzdWx0ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgb25TdWNjZXNzKHJlc3BvbnNlLmRhdGEpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBvbkZhaWx1cmUobm9ybWFsaXplRmFpbHVyZShyZXNwb25zZSwgMjAwKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLmZhaWwoZnVuY3Rpb24gKHhocikge1xuICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUoeGhyLnJlc3BvbnNlSlNPTiB8fCBudWxsLCB4aHIuc3RhdHVzKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZhaWx1cmVUZXh0KGZhaWx1cmUpIHtcbiAgICAgICAgaWYgKGZhaWx1cmUgJiYgZmFpbHVyZS5maWVsZCkge1xuICAgICAgICAgICAgcmV0dXJuIGZhaWx1cmUubWVzc2FnZXMubGVuZ3RoID4gMCA/IGZhaWx1cmUubWVzc2FnZXNbMF0gOiBmYWlsdXJlLmVycm9yO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAoZmFpbHVyZSAmJiBmYWlsdXJlLmVycm9yKSA/IGZhaWx1cmUuZXJyb3IgOiAnaHR0cF9lcnJvcic7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBib3RzOiBzdGF0ZSAmIHJlbmRlcmluZyAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBib3RCeUlkKGlkKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUuYm90cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKE51bWJlcihzdGF0ZS5ib3RzW2ldLmlkKSA9PT0gTnVtYmVyKGlkKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzdGF0ZS5ib3RzW2ldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlcGxhY2VCb3QoYm90KSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUuYm90cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKE51bWJlcihzdGF0ZS5ib3RzW2ldLmlkKSA9PT0gTnVtYmVyKGJvdC5pZCkpIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5ib3RzW2ldID0gYm90O1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBzdGF0ZS5ib3RzLnB1c2goYm90KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBsb2FkQm90cyhzaWxlbnQpIHtcbiAgICAgICAgaWYgKCFzaWxlbnQpIHtcbiAgICAgICAgICAgIHN0YXRlLmJvdHNMb2FkZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIHJlbmRlckJvdHNTa2VsZXRvbigpO1xuICAgICAgICB9XG4gICAgICAgIGFwaUdldCgnL2JvdHMnLCB7IGxpbWl0OiAyMDAgfSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHN0YXRlLmJvdHMgPSBkYXRhLml0ZW1zIHx8IFtdO1xuICAgICAgICAgICAgc3RhdGUuYm90c0xvYWRlZCA9IHRydWU7XG4gICAgICAgICAgICBzdGF0ZS5ib3RzRXJyb3IgPSBudWxsO1xuICAgICAgICAgICAgcmVuZGVyQm90cygpO1xuICAgICAgICAgICAgcmVuZGVyUnVsZXMoKTtcbiAgICAgICAgICAgIHJlbmRlckpvdXJuYWxCYW5uZXIoKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgIHN0YXRlLmJvdHNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc3RhdGUuYm90c0Vycm9yID0gZmFpbHVyZTtcbiAgICAgICAgICAgIHJlbmRlckJvdHMoKTtcbiAgICAgICAgICAgIHJlbmRlclJ1bGVzKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdHNTa2VsZXRvbigpIHtcbiAgICAgICAgdmFyIGNhcmQgPSAnPGRpdiBjbGFzcz1cIm1oLWJvdC1jYXJkIG1oLWJvdC1za2VsZXRvblwiPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6MzJweDtoZWlnaHQ6MzJweDtib3JkZXItcmFkaXVzOjhweFwiPjwvc3Bhbj4nXG4gICAgICAgICAgICArICc8ZGl2IHN0eWxlPVwiZmxleDoxO2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjZweFwiPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6NTAlXCI+PC9zcGFuPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6MzAlO2hlaWdodDo4cHhcIj48L3NwYW4+PC9kaXY+PC9kaXY+JztcbiAgICAgICAgJCgnI21oLWJvdHMnKS5odG1sKGNhcmQgKyBjYXJkKTtcbiAgICB9XG5cbiAgICAvLyBUZWxlZ3JhbSAvIE1BWCB0aWxlczogdGhlIGZpcnN0LXJ1biBzY3JlZW4gYW5kIMKr0J3QsNGB0YLRgNC+0LnQutC4wrsgd2l0aG91dCBib3RzIChkZXNpZ24gdjMpLlxuICAgIGZ1bmN0aW9uIG1lc3NlbmdlclRpbGVzKCkge1xuICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJtaC1tZXNzZW5nZXItdGlsZXNcIj4nXG4gICAgICAgICAgICArICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cIm1oLXNjZW5hcmlvIG1oLXRpbGVcIiBkYXRhLWFjdGlvbj1cImFkZC1ib3RcIiBkYXRhLWNoYW5uZWw9XCJ0ZWxlZ3JhbVwiPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyIHRnXCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+VEc8L3NwYW4+PGI+VGVsZWdyYW08L2I+PC9idXR0b24+J1xuICAgICAgICAgICAgKyAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJtaC1zY2VuYXJpbyBtaC10aWxlXCIgZGF0YS1hY3Rpb249XCJhZGQtYm90XCIgZGF0YS1jaGFubmVsPVwibWF4XCI+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tZXNzZW5nZXIgbWF4XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+TUFYPC9zcGFuPjxiPk1BWDwvYj48L2J1dHRvbj4nXG4gICAgICAgICAgICArICc8L2Rpdj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdHMoKSB7XG4gICAgICAgIHZhciAkd3JhcCA9ICQoJyNtaC1ib3RzJyk7XG4gICAgICAgIGlmIChzdGF0ZS5ib3RzRXJyb3IgIT09IG51bGwgJiYgc3RhdGUuYm90cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtYWRkJykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICAgICAkd3JhcC5odG1sKCc8ZGl2IGNsYXNzPVwidWkgbmVnYXRpdmUgbWVzc2FnZVwiIHJvbGU9XCJhbGVydFwiPicgKyBJQ09OX0VSUk9SXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLWdyb3dcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdHNMb2FkRmFpbGVkJykpICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uIG1oLW9uLW1lc3NhZ2VcIiB0eXBlPVwiYnV0dG9uXCIgaWQ9XCJtaC1ib3RzLXJldHJ5XCI+J1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblJldHJ5JykpICsgJzwvYnV0dG9uPjwvZGl2PicpO1xuICAgICAgICAgICAgJCgnI21oLWJvdHMtcmV0cnknKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IGxvYWRCb3RzKCk7IH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghc3RhdGUuYm90c0xvYWRlZCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC1ib3QtYWRkJykuYXR0cignaGlkZGVuJywgc3RhdGUuYm90cy5sZW5ndGggPiAwID8gbnVsbCA6IHRydWUpO1xuICAgICAgICBpZiAoc3RhdGUuYm90cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICR3cmFwLmh0bWwobWVzc2VuZ2VyVGlsZXMoKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGh0bWwgPSAnPGRpdiBjbGFzcz1cIm1oLWJvdC1saXN0XCI+JztcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5ib3RzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBodG1sICs9IHJlbmRlckJvdENhcmQoc3RhdGUuYm90c1tpXSk7XG4gICAgICAgIH1cbiAgICAgICAgJHdyYXAuaHRtbChodG1sICsgJzwvZGl2PicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdENhcmQoYm90KSB7XG4gICAgICAgIHZhciBleHBhbmRlZCA9IHN0YXRlLmV4cGFuZGVkQm90c1tib3QuaWRdID09PSB0cnVlO1xuICAgICAgICB2YXIgYm9keSA9ICcnO1xuICAgICAgICBpZiAoZXhwYW5kZWQpIHtcbiAgICAgICAgICAgIGJvZHkgPSAnPGRpdiBjbGFzcz1cIm1oLWJvdC1ib2R5XCI+JyArIHJlbmRlckJvdFRsc1dhcm5pbmcoYm90KSArIHJlbmRlckJvdENoYXRzKGJvdCkgKyByZW5kZXJCb3RBY3Rpb25zKGJvdCkgKyAnPC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICB2YXIgY2hhdENvdW50ID0gKGJvdC5jaGF0cyB8fCBbXSkubGVuZ3RoO1xuICAgICAgICB2YXIgbWV0YSA9IFtdO1xuICAgICAgICBpZiAoYm90LmJvdF91c2VybmFtZSkgeyBtZXRhLnB1c2goJ0AnICsgYm90LmJvdF91c2VybmFtZSk7IH1cbiAgICAgICAgbWV0YS5wdXNoKGNoYXRDb3VudCA+IDAgPyB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hhdHNDb3VudCcsIHsgY291bnQ6IGNoYXRDb3VudCB9KSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoYXRzTm9uZScpKTtcbiAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwibWgtYm90LXJvdycgKyAoZXhwYW5kZWQgPyAnIGlzLW9wZW4nIDogJycpICsgJ1wiIGRhdGEtYm90LWlkPVwiJyArIGJvdC5pZCArICdcIj4nXG4gICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtYm90LWhlYWRcIiBkYXRhLWFjdGlvbj1cInRvZ2dsZVwiIHJvbGU9XCJidXR0b25cIiB0YWJpbmRleD1cIjBcIiBhcmlhLWV4cGFuZGVkPVwiJyArIChleHBhbmRlZCA/ICd0cnVlJyA6ICdmYWxzZScpICsgJ1wiPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyICcgKyAoYm90LmNoYW5uZWwgPT09ICdtYXgnID8gJ21heCcgOiAndGcnKSArICdcIiBhcmlhLWhpZGRlbj1cInRydWVcIj4nICsgKGJvdC5jaGFubmVsID09PSAnbWF4JyA/ICdNQVgnIDogJ1RHJykgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ib3QtdGl0bGVzXCI+PGIgY2xhc3M9XCJtaC10cnVuY2F0ZVwiPicgKyBlc2MoYm90LnRpdGxlKSArICc8L2I+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tZXRhIG1oLXRydW5jYXRlXCI+JyArIGVzYyhtZXRhLmpvaW4oJyDCtyAnKSkgKyAnPC9zcGFuPjwvZGl2PidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtYm90LXN0YXR1c1wiPicgKyBib3RTdGF0dXNDZWxsKGJvdCkgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtY2hldnJvblwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPidcbiAgICAgICAgICAgICsgJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIHN0eWxlPVwidHJhbnNmb3JtOnJvdGF0ZSgnICsgKGV4cGFuZGVkID8gJzE4MCcgOiAnMCcpICsgJ2RlZylcIj48cGF0aCBkPVwiTTMuNSA2TDggMTAuNSAxMi41IDZcIi8+PC9zdmc+J1xuICAgICAgICAgICAgKyAnPC9zcGFuPjwvZGl2PicgKyBib2R5ICsgJzwvZGl2Pic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYm90U3RhdHVzQ2VsbChib3QpIHtcbiAgICAgICAgaWYgKGJvdC5lbmFibGVkID09PSBmYWxzZSkge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIm1oLWRvdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzRGlzYWJsZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICdvaycpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1kb3QgaXMtb2tcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c09rJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmIChib3Quc3RhdHVzID09PSAndG9rZW5faW52YWxpZCcpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c1Rva2VuSW52YWxpZCcpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYm90LnN0YXR1cyA9PT0gJ2NhX2Vycm9yJykge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cInVpIHJlZCBsYWJlbFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzQ2FFcnJvcicpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYm90LnN0YXR1cyA9PT0gJ2Vycm9yJykge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cInVpIHllbGxvdyBsYWJlbFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzQ2hlY2tGYWlsZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIm1oLWRvdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzTmV3JykpICsgJzwvc3Bhbj4nO1xuICAgIH1cblxuICAgIC8vIFRoZSBNQVggQVBJIGlzIHNpZ25lZCBieSB0aGUg0JzQuNC90YbQuNGE0YDRiyByb290IENBOiBhIHRydXN0IGZhaWx1cmUgaXMgYSBjb25maWd1cmF0aW9uIHByb2JsZW0sIG5vdCBhXG4gICAgLy8gdG9rZW4gcHJvYmxlbSwgc28gaXQgZ2V0cyBpdHMgb3duIGV4cGxhbmF0aW9uIGFuZCBwb2ludHMgdG8gdGhlIHNldHRpbmdzIGZpZWxkLlxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdFRsc1dhcm5pbmcoYm90KSB7XG4gICAgICAgIGlmIChib3Quc3RhdHVzICE9PSAnY2FfZXJyb3InICYmICFpc01heFRsc0NvZGUoYm90Lmxhc3RfZXJyb3JfY29kZSkpIHtcbiAgICAgICAgICAgIHJldHVybiAnJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJ1aSB3YXJuaW5nIG1lc3NhZ2VcIiByb2xlPVwibm90ZVwiPidcbiAgICAgICAgICAgICsgJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjxjaXJjbGUgY3g9XCI4XCIgY3k9XCI4XCIgcj1cIjYuMjVcIi8+PHBhdGggZD1cIk04IDQuNXY0TTggMTFoLjAxXCIvPjwvc3ZnPidcbiAgICAgICAgICAgICsgJzxkaXY+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTdGF0dXNDYUVycm9yJykpICsgJy4gJ1xuICAgICAgICAgICAgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2FFcnJvckhpbnQnKSkgKyAnPC9kaXY+PC9kaXY+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjaGF0S2luZExhYmVsKGtpbmQpIHtcbiAgICAgICAgaWYgKGtpbmQgPT09ICdwcml2YXRlJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFR5cGVQcml2YXRlJyk7IH1cbiAgICAgICAgaWYgKGtpbmQgPT09ICdjaGFubmVsJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFR5cGVDaGFubmVsJyk7IH1cbiAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRUeXBlR3JvdXAnKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJCb3RDaGF0cyhib3QpIHtcbiAgICAgICAgdmFyIGNoYXRzID0gYm90LmNoYXRzIHx8IFtdO1xuICAgICAgICBpZiAoY2hhdHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJtaC1ib3Qtbm9jaGF0cyBtaC1tdXRlZFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Tm9DaGF0c1RpdGxlJykpICsgJzwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGh0bWwgPSAnPGRpdiBjbGFzcz1cIm1oLWNoYXQtbGlzdFwiPic7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hhdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGh0bWwgKz0gcmVuZGVyQ2hhdFJvdyhib3QsIGNoYXRzW2ldKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gaHRtbCArICc8L2Rpdj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckNoYXRSb3coYm90LCBjaGF0KSB7XG4gICAgICAgIHZhciBnb25lID0gY2hhdC5zdGF0ZSA9PT0gJ2dvbmUnO1xuICAgICAgICB2YXIgc3RhdGVDZWxsO1xuICAgICAgICBpZiAoZ29uZSkge1xuICAgICAgICAgICAgc3RhdGVDZWxsID0gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCIgdGl0bGU9XCInICsgZXNjKGNoYXQuZ29uZV9yZWFzb24pICsgJ1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFN0YXR1c0dvbmUnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH0gZWxzZSBpZiAoY2hhdC5sYXN0X2RlbGl2ZXJ5ICYmIGNoYXQubGFzdF9kZWxpdmVyeS5zdGF0dXMgPT09ICdmYWlsZWQnKSB7XG4gICAgICAgICAgICBzdGF0ZUNlbGwgPSAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRTdGF0dXNFcnJvcicpKSArICc8L3NwYW4+JztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHN0YXRlQ2VsbCA9ICc8c3BhbiBjbGFzcz1cIm1oLWRvdCBpcy1va1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFN0YXR1c09rJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnPGRpdiBjbGFzcz1cIm1oLWNoYXQtcm93XCIgZGF0YS1jaGF0LWlkPVwiJyArIGNoYXQuaWQgKyAnXCI+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1jaGF0LXRpdGxlXCI+PHNwYW4gY2xhc3M9XCJtaC10cnVuY2F0ZVwiPicgKyBlc2MoY2hhdC50aXRsZSB8fCBjaGF0LmNoYXRfaWQpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1ldGFcIj4gwrcgJyArIGVzYyhjaGF0S2luZExhYmVsKGNoYXQuY2hhdF9raW5kKSkgKyAnPC9zcGFuPjwvc3Bhbj4nXG4gICAgICAgICAgICArIGVtcGxveWVlU2VsZWN0KGNoYXQpXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWNoYXQtc3RhdGVcIj4nICsgc3RhdGVDZWxsICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICArICc8bGFiZWwgY2xhc3M9XCJ1aSB0b2dnbGUgY2hlY2tib3gnICsgKGNoYXQuZW5hYmxlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAoZ29uZSA/ICcgZGlzYWJsZWQnIDogJycpICsgJ1wiIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdEVuYWJsZUNoYXQnKSkgKyAnXCI+J1xuICAgICAgICAgICAgKyAnPGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGNsYXNzPVwiaGlkZGVuIG1oLWNoYXQtdG9nZ2xlXCInICsgKGNoYXQuZW5hYmxlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAoZ29uZSA/ICcgZGlzYWJsZWQnIDogJycpICsgJz4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXRyYWNrXCI+PC9zcGFuPjwvbGFiZWw+J1xuICAgICAgICAgICAgKyAnPC9kaXY+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBlbXBsb3llZVNlbGVjdChjaGF0KSB7XG4gICAgICAgIHZhciBvcHRpb25zID0gJzxvcHRpb24gdmFsdWU9XCIwXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Tm9FbXBsb3llZScpKSArICc8L29wdGlvbj4nO1xuICAgICAgICB2YXIgZm91bmQgPSBmYWxzZTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5lbXBsb3llZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBlbXBsb3llZSA9IHN0YXRlLmVtcGxveWVlc1tpXTtcbiAgICAgICAgICAgIHZhciBzZWxlY3RlZCA9IE51bWJlcihlbXBsb3llZS5pZCkgPT09IE51bWJlcihjaGF0LmxpbmtlZF91c2VyX2lkKTtcbiAgICAgICAgICAgIGlmIChzZWxlY3RlZCkgeyBmb3VuZCA9IHRydWU7IH1cbiAgICAgICAgICAgIG9wdGlvbnMgKz0gJzxvcHRpb24gdmFsdWU9XCInICsgZW1wbG95ZWUuaWQgKyAnXCInICsgKHNlbGVjdGVkID8gJyBzZWxlY3RlZCcgOiAnJykgKyAnPicgKyBlc2MoZW1wbG95ZWUubGFiZWwpICsgJzwvb3B0aW9uPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFmb3VuZCAmJiBOdW1iZXIoY2hhdC5saW5rZWRfdXNlcl9pZCkgPiAwKSB7XG4gICAgICAgICAgICBvcHRpb25zICs9ICc8b3B0aW9uIHZhbHVlPVwiJyArIGNoYXQubGlua2VkX3VzZXJfaWQgKyAnXCIgc2VsZWN0ZWQ+IycgKyBjaGF0LmxpbmtlZF91c2VyX2lkICsgJzwvb3B0aW9uPic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICc8c2VsZWN0IGNsYXNzPVwibWgtZW1wbG95ZWUtc2VsZWN0XCIgYXJpYS1sYWJlbD1cIicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdEVtcGxveWVlJykpICsgJ1wiPicgKyBvcHRpb25zICsgJzwvc2VsZWN0Pic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyQm90QWN0aW9ucyhib3QpIHtcbiAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwibWgtYm90LWFjdGlvbnNcIj4nXG4gICAgICAgICAgICArICc8YSBocmVmPVwiI1wiIGRhdGEtYWN0aW9uPVwiY29ubmVjdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90QWN0aW9uc0Nvbm5lY3QnKSkgKyAnPC9hPidcbiAgICAgICAgICAgICsgJzxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJ0ZXN0XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RBY3Rpb25zVGVzdCcpKSArICc8L2E+J1xuICAgICAgICAgICAgKyAnPGEgaHJlZj1cIiNcIiBkYXRhLWFjdGlvbj1cImVkaXRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdEFjdGlvbnNFZGl0JykpICsgJzwvYT4nXG4gICAgICAgICAgICArICc8L2Rpdj4nO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gYm90czogZGVsZWdhdGVkIGFjdGlvbnMgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gYmluZEJvdHNDb250YWluZXIoKSB7XG4gICAgICAgIHZhciAkd3JhcCA9ICQoJyNtaC1ib3RzJyk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJ0b2dnbGVcIl0nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgaWQgPSBTdHJpbmcoJCh0aGlzKS5jbG9zZXN0KCcubWgtYm90LXJvdycpLmRhdGEoJ2JvdC1pZCcpKTtcbiAgICAgICAgICAgIHN0YXRlLmV4cGFuZGVkQm90c1tpZF0gPSBzdGF0ZS5leHBhbmRlZEJvdHNbaWRdICE9PSB0cnVlO1xuICAgICAgICAgICAgcmVuZGVyQm90cygpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2tleWRvd24nLCAnW2RhdGEtYWN0aW9uPVwidG9nZ2xlXCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBpZiAoZXZlbnQua2V5ID09PSAnRW50ZXInIHx8IGV2ZW50LmtleSA9PT0gJyAnKSB7XG4gICAgICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgICAgICAkKHRoaXMpLnRyaWdnZXIoJ2NsaWNrJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiYWRkLWJvdFwiXScsIGZ1bmN0aW9uICgpIHsgb3BlbkJvdE1vZGFsKCdhZGQnLCBudWxsLCAkKHRoaXMpLmRhdGEoJ2NoYW5uZWwnKSk7IH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiY29ubmVjdFwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIG9wZW5DaGF0TW9kYWwoYm90QnlJZCgkKHRoaXMpLmNsb3Nlc3QoJy5taC1ib3Qtcm93JykuZGF0YSgnYm90LWlkJykpKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJ0ZXN0XCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgb3BlblRlc3RNb2RhbChib3RCeUlkKCQodGhpcykuY2xvc2VzdCgnLm1oLWJvdC1yb3cnKS5kYXRhKCdib3QtaWQnKSksIG51bGwpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImVkaXRcIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBvcGVuQm90TW9kYWwoJ2VkaXQnLCBib3RCeUlkKCQodGhpcykuY2xvc2VzdCgnLm1oLWJvdC1yb3cnKS5kYXRhKCdib3QtaWQnKSkpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NoYW5nZScsICcubWgtY2hhdC10b2dnbGUnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgYm90SWQgPSAkKHRoaXMpLmNsb3Nlc3QoJy5taC1ib3Qtcm93JykuZGF0YSgnYm90LWlkJyk7XG4gICAgICAgICAgICB2YXIgY2hhdElkID0gJCh0aGlzKS5jbG9zZXN0KCcubWgtY2hhdC1yb3cnKS5kYXRhKCdjaGF0LWlkJyk7XG4gICAgICAgICAgICB2YXIgZW5hYmxlZCA9ICQodGhpcykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICAgICAgcGF0Y2hCb3QoYm90SWQsIHsgY2hhdHM6IFt7IGlkOiBOdW1iZXIoY2hhdElkKSwgZW5hYmxlZDogZW5hYmxlZCB9XSB9LCBudWxsLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVGYWlsZWQnKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjaGFuZ2UnLCAnLm1oLWVtcGxveWVlLXNlbGVjdCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBib3RJZCA9ICQodGhpcykuY2xvc2VzdCgnLm1oLWJvdC1yb3cnKS5kYXRhKCdib3QtaWQnKTtcbiAgICAgICAgICAgIHZhciBjaGF0SWQgPSAkKHRoaXMpLmNsb3Nlc3QoJy5taC1jaGF0LXJvdycpLmRhdGEoJ2NoYXQtaWQnKTtcbiAgICAgICAgICAgIHBhdGNoQm90KGJvdElkLCB7IGNoYXRzOiBbeyBpZDogTnVtYmVyKGNoYXRJZCksIGxpbmtlZF91c2VyX2lkOiBOdW1iZXIoJCh0aGlzKS52YWwoKSkgfV0gfSwgbnVsbCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25TYXZlRmFpbGVkJykpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHBhdGNoQm90KGJvdElkLCBwYXlsb2FkLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICBhcGlQYXRjaCgnL2JvdHMvJyArIGJvdElkLCBwYXlsb2FkLCBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgICAgICByZW5kZXJCb3RzKCk7XG4gICAgICAgICAgICBpZiAob25TdWNjZXNzKSB7IG9uU3VjY2Vzcyhib3QpOyB9XG4gICAgICAgIH0sIG9uRmFpbHVyZSB8fCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgc2hvd1RvYXN0KGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBlbXBsb3llZXMgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gbG9hZEVtcGxveWVlcyhkb25lKSB7XG4gICAgICAgIGlmIChzdGF0ZS5lbXBsb3llZXNMb2FkZWQpIHtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb3JlR2V0KCcvZXh0ZW5zaW9ucycsIHsgbGltaXQ6IDUwMCB9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgdmFyIGl0ZW1zID0gZGF0YS5pdGVtcyB8fCBbXTtcbiAgICAgICAgICAgIHZhciBzZWVuID0ge307XG4gICAgICAgICAgICB2YXIgbGlzdCA9IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIHZhciBpdGVtID0gaXRlbXNbaV07XG4gICAgICAgICAgICAgICAgdmFyIHVzZXJJZCA9IE51bWJlcihpdGVtLnVzZXJpZCk7XG4gICAgICAgICAgICAgICAgaWYgKCF1c2VySWQgfHwgc2Vlblt1c2VySWRdKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzZWVuW3VzZXJJZF0gPSB0cnVlO1xuICAgICAgICAgICAgICAgIHZhciBuYW1lID0gaXRlbS5jYWxsZXJpZCB8fCBpdGVtLm51bWJlciB8fCAoJyMnICsgdXNlcklkKTtcbiAgICAgICAgICAgICAgICB2YXIgbnVtYmVyID0gaXRlbS5udW1iZXIgPyBTdHJpbmcoaXRlbS5udW1iZXIpIDogJyc7XG4gICAgICAgICAgICAgICAgdmFyIGxhYmVsID0gKG51bWJlciAhPT0gJycgJiYgU3RyaW5nKG5hbWUpLmluZGV4T2YobnVtYmVyKSA9PT0gLTEpID8gbmFtZSArICcgKCcgKyBudW1iZXIgKyAnKScgOiBuYW1lO1xuICAgICAgICAgICAgICAgIGxpc3QucHVzaCh7IGlkOiB1c2VySWQsIGxhYmVsOiBsYWJlbCB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGxpc3Quc29ydChmdW5jdGlvbiAoYSwgYikgeyByZXR1cm4gYS5sYWJlbC5sb2NhbGVDb21wYXJlKGIubGFiZWwpOyB9KTtcbiAgICAgICAgICAgIHN0YXRlLmVtcGxveWVlcyA9IGxpc3Q7XG4gICAgICAgICAgICBzdGF0ZS5lbXBsb3llZXNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc3RhdGUuZW1wbG95ZWVzRmFpbGVkID0gZmFsc2U7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLmVtcGxveWVlc0xvYWRlZCA9IGZhbHNlO1xuICAgICAgICAgICAgc3RhdGUuZW1wbG95ZWVzRmFpbGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBib3QgbW9kYWwgLS0tLS0tLS0tLVxuXG4gICAgLy8gQ2hhbm5lbHMgd2l0aCBhIGJhY2tlbmQgYWRhcHRlciAoYm90aCBoYXZlIG9uZSBzaW5jZSBzdGFnZSAzYi8zYykuIFRoZSBjaGVja3MgYmVsb3cgc3RheSBhcyBhXG4gICAgLy8gZ3VhcmQ6IGEgY2hhbm5lbCB3aXRob3V0IGFuIGFkYXB0ZXIgb24gdGhlIHNlcnZlciBtdXN0IG5vdCBiZSBzYXZlZCBmcm9tIGEgc3RhbGUgcGFnZS5cbiAgICB2YXIgU0FWQUJMRV9DSEFOTkVMUyA9IFsndGVsZWdyYW0nLCAnbWF4J107XG5cbiAgICBmdW5jdGlvbiBvcGVuQm90TW9kYWwobW9kZSwgYm90LCBjaGFubmVsKSB7XG4gICAgICAgIHN0YXRlLmJvdE1vZGFsID0ge1xuICAgICAgICAgICAgbW9kZTogbW9kZSxcbiAgICAgICAgICAgIGJvdDogYm90LFxuICAgICAgICAgICAgY2hhbm5lbDogbW9kZSA9PT0gJ2VkaXQnICYmIGJvdCA/IChib3QuY2hhbm5lbCB8fCAndGVsZWdyYW0nKSA6IChjaGFubmVsID09PSAnbWF4JyA/ICdtYXgnIDogJ3RlbGVncmFtJyksXG4gICAgICAgICAgICBkcmFmdElkOiAwLFxuICAgICAgICAgICAgc2F2ZWQ6IGZhbHNlLFxuICAgICAgICAgICAgdG9rZW5DaGFuZ2VkOiBmYWxzZSxcbiAgICAgICAgICAgIGJ1c3k6IGZhbHNlXG4gICAgICAgIH07XG4gICAgICAgICQoJyNtaC1ib3QtY2hlY2stbWVzc2FnZScpLmVtcHR5KCk7XG4gICAgICAgICQoJyNtaC1ib3QtdGl0bGUtZmllbGQnKS5yZW1vdmVDbGFzcygnZXJyb3InKTtcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbi1yb3cnKS5yZW1vdmVDbGFzcygnZXJyb3InKTtcbiAgICAgICAgJCgnI21oLWJvdC1tb2RhbC10aXRsZScpLnRleHQobW9kZSA9PT0gJ2VkaXQnID8gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdEVkaXRUaXRsZScsIHsgdGl0bGU6IGJvdC50aXRsZSB9KSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdEFkZFRpdGxlJykpO1xuICAgICAgICAkKCcjbWgtYm90LXRpdGxlJykudmFsKGJvdCA/IGJvdC50aXRsZSA6ICcnKTtcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbicpLnZhbCgnJyk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4tbmV3JykudmFsKCcnKTtcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbi1uZXctcm93JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1ib3QtZGVsZXRlJykuYXR0cignaGlkZGVuJywgbW9kZSA9PT0gJ2VkaXQnID8gbnVsbCA6IHRydWUpO1xuICAgICAgICAkKCcjbWgtYm90LXNhdmUnKS50ZXh0KG1vZGUgPT09ICdlZGl0JyA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFNhdmUnKSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFNhdmVBbmRDb25uZWN0JykpO1xuICAgICAgICBpZiAobW9kZSA9PT0gJ2VkaXQnKSB7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRva2VuLXJvdycpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1oaW50LXJvdycpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1oaW50JykudGV4dCgn4oCi4oCi4oCi4oCiJyArIChib3QudG9rZW5faGludCB8fCAnJykpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1yb3cnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4taGludC1yb3cnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgfVxuICAgICAgICBzeW5jQm90Q2hhbm5lbCgpO1xuICAgICAgICAkKCcjbWgtYm90LW1vZGFsJykubW9kYWwoeyBjbG9zYWJsZTogZmFsc2UgfSkubW9kYWwoJ3Nob3cnKTtcbiAgICAgICAgJCgnI21oLWJvdC10aXRsZScpLnRyaWdnZXIoJ2ZvY3VzJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3luY0JvdENoYW5uZWwoKSB7XG4gICAgICAgIHZhciBtb2RhbCA9IHN0YXRlLmJvdE1vZGFsO1xuICAgICAgICBpZiAoIW1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAkKCcjbWgtYm90LW1vZGFsIC5taC1jaGFubmVsLWNhcmQnKS5lYWNoKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBjaGFubmVsID0gU3RyaW5nKCQodGhpcykuZGF0YSgnY2hhbm5lbCcpKTtcbiAgICAgICAgICAgIHZhciBzZWxlY3RlZCA9IGNoYW5uZWwgPT09IG1vZGFsLmNoYW5uZWw7XG4gICAgICAgICAgICB2YXIgbG9ja2VkID0gbW9kYWwubW9kZSA9PT0gJ2VkaXQnICYmICFzZWxlY3RlZDtcbiAgICAgICAgICAgICQodGhpcykudG9nZ2xlQ2xhc3MoJ2lzLXNlbGVjdGVkJywgc2VsZWN0ZWQpLnRvZ2dsZUNsYXNzKCdpcy1kaXNhYmxlZCcsIGxvY2tlZClcbiAgICAgICAgICAgICAgICAuYXR0cignYXJpYS1kaXNhYmxlZCcsIGxvY2tlZCA/ICd0cnVlJyA6IG51bGwpO1xuICAgICAgICAgICAgJCh0aGlzKS5maW5kKCdpbnB1dCcpLnByb3AoJ2NoZWNrZWQnLCBzZWxlY3RlZCkucHJvcCgnZGlzYWJsZWQnLCBsb2NrZWQpO1xuICAgICAgICB9KTtcbiAgICAgICAgdmFyIHNhdmFibGUgPSBTQVZBQkxFX0NIQU5ORUxTLmluZGV4T2YobW9kYWwuY2hhbm5lbCkgPj0gMDtcbiAgICAgICAgJCgnI21oLWJvdC1zYXZlLCAjbWgtYm90LWNoZWNrJykucHJvcCgnZGlzYWJsZWQnLCAhc2F2YWJsZSkudG9nZ2xlQ2xhc3MoJ2Rpc2FibGVkJywgIXNhdmFibGUpO1xuICAgICAgICAvLyBhIE1BWCB0b2tlbiBjb21lcyBmcm9tIGJ1c2luZXNzLm1heC5ydSBhZnRlciBtb2RlcmF0aW9uOyBUZWxlZ3JhbSBuZWVkcyBubyBleHBsYW5hdGlvblxuICAgICAgICB2YXIgbWF4SGVscCA9IG1vZGFsLmNoYW5uZWwgPT09ICdtYXgnO1xuICAgICAgICAkKCcjbWgtYm90LXRva2VuLWhlbHAnKS50ZXh0KG1heEhlbHAgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RUb2tlbkhlbHBNYXgnKSA6ICcnKTtcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbi1oZWxwLXJvdycpLmF0dHIoJ2hpZGRlbicsIG1heEhlbHAgPyBudWxsIDogdHJ1ZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNNYXhUbHNDb2RlKGNvZGUpIHtcbiAgICAgICAgcmV0dXJuIFN0cmluZyhjb2RlIHx8ICcnKS5pbmRleE9mKCdtYXgudGxzLicpID09PSAwO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHRsc0Vycm9yVGV4dCgpIHtcbiAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c0NhRXJyb3InKSArICcuICcgKyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDYUVycm9ySGludCcpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJvdEZvcm1WYWx1ZXMoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0aXRsZTogU3RyaW5nKCQoJyNtaC1ib3QtdGl0bGUnKS52YWwoKSB8fCAnJykudHJpbSgpLFxuICAgICAgICAgICAgdG9rZW46IFN0cmluZygkKCcjbWgtYm90LXRva2VuJykudmFsKCkgfHwgJycpLnRyaW0oKSxcbiAgICAgICAgICAgIHRva2VuTmV3OiBTdHJpbmcoJCgnI21oLWJvdC10b2tlbi1uZXcnKS52YWwoKSB8fCAnJykudHJpbSgpXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2hvd0JvdE1lc3NhZ2Uoa2luZCwgdGV4dCkge1xuICAgICAgICB2YXIgY2xzID0ga2luZCA9PT0gJ29rJyA/ICd1aSBwb3NpdGl2ZSBtZXNzYWdlJyA6IChraW5kID09PSAnd2FybicgPyAndWkgd2FybmluZyBtZXNzYWdlJyA6ICd1aSBuZWdhdGl2ZSBtZXNzYWdlJyk7XG4gICAgICAgIHZhciBpY29uID0ga2luZCA9PT0gJ29rJ1xuICAgICAgICAgICAgPyAnPGNpcmNsZSBjeD1cIjhcIiBjeT1cIjhcIiByPVwiNi4yNVwiLz48cGF0aCBkPVwiTTUuNSA4LjJsMS44IDEuOCAzLjMtMy42XCIvPidcbiAgICAgICAgICAgIDogJzxjaXJjbGUgY3g9XCI4XCIgY3k9XCI4XCIgcj1cIjYuMjVcIi8+PHBhdGggZD1cIk02IDZsNCA0TTEwIDZsLTQgNFwiLz4nO1xuICAgICAgICAkKCcjbWgtYm90LWNoZWNrLW1lc3NhZ2UnKS5odG1sKCc8ZGl2IGNsYXNzPVwiJyArIGNscyArICdcIiByb2xlPVwic3RhdHVzXCI+J1xuICAgICAgICAgICAgKyAnPHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+JyArIGljb24gKyAnPC9zdmc+J1xuICAgICAgICAgICAgKyAnPGRpdj4nICsgZXNjKHRleHQpICsgJzwvZGl2PjwvZGl2PicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJvdENoZWNrTWVzc2FnZShib3QpIHtcbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICdvaycpIHtcbiAgICAgICAgICAgIHJldHVybiB7IGtpbmQ6ICdvaycsIHRleHQ6IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkT2snLCB7XG4gICAgICAgICAgICAgICAgdXNlcm5hbWU6IGJvdC5ib3RfdXNlcm5hbWUgfHwgYm90LmJvdF9leHRlcm5hbF9pZCxcbiAgICAgICAgICAgICAgICBuYW1lOiBib3QuYm90X3VzZXJuYW1lID8gJ0AnICsgYm90LmJvdF91c2VybmFtZSA6IGJvdC50aXRsZVxuICAgICAgICAgICAgfSkgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYm90Lmxhc3RfZXJyb3JfY29kZSA9PT0gJ290aGVyX2JvdCcpIHtcbiAgICAgICAgICAgIHJldHVybiB7IGtpbmQ6ICd3YXJuJywgdGV4dDogdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrZWRPdGhlcicsIHtcbiAgICAgICAgICAgICAgICB1c2VybmFtZTogYm90LmJvdF91c2VybmFtZSB8fCAnJyxcbiAgICAgICAgICAgICAgICBib3Q6IGJvdC50aXRsZVxuICAgICAgICAgICAgfSkgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYm90LnN0YXR1cyA9PT0gJ3Rva2VuX2ludmFsaWQnKSB7XG4gICAgICAgICAgICByZXR1cm4geyBraW5kOiAnZXJyJywgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZDQwMScpIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICdjYV9lcnJvcicgfHwgaXNNYXhUbHNDb2RlKGJvdC5sYXN0X2Vycm9yX2NvZGUpKSB7XG4gICAgICAgICAgICByZXR1cm4geyBraW5kOiAnZXJyJywgdGV4dDogdGxzRXJyb3JUZXh0KCkgfTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geyBraW5kOiAnd2FybicsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrTmV0d29yaycpICsgKGJvdC5sYXN0X2Vycm9yX2NvZGUgPyAnICgnICsgYm90Lmxhc3RfZXJyb3JfY29kZSArICcpJyA6ICcnKSB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNoZWNrQm90Rm9ybSgpIHtcbiAgICAgICAgaWYgKCFzdGF0ZS5ib3RNb2RhbCB8fCBTQVZBQkxFX0NIQU5ORUxTLmluZGV4T2Yoc3RhdGUuYm90TW9kYWwuY2hhbm5lbCkgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHZhbHVlcyA9IGJvdEZvcm1WYWx1ZXMoKTtcbiAgICAgICAgaWYgKHZhbHVlcy50aXRsZSA9PT0gJycpIHtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdGl0bGUtZmllbGQnKS5hZGRDbGFzcygnZXJyb3InKTtcbiAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RUaXRsZVJlcXVpcmVkJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC1ib3QtdGl0bGUtZmllbGQnKS5yZW1vdmVDbGFzcygnZXJyb3InKTtcbiAgICAgICAgdmFyIG1vZGUgPSBzdGF0ZS5ib3RNb2RhbC5tb2RlO1xuICAgICAgICB2YXIgcGF5bG9hZDtcbiAgICAgICAgdmFyIGRvbmUgPSBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICBzdGF0ZS5ib3RNb2RhbC5ib3QgPSBib3Q7XG4gICAgICAgICAgICBzdGF0ZS5ib3RNb2RhbC5kcmFmdElkID0gYm90LmlkO1xuICAgICAgICAgICAgcmVwbGFjZUJvdChib3QpO1xuICAgICAgICAgICAgdmFyIG1lc3NhZ2UgPSBib3RDaGVja01lc3NhZ2UoYm90KTtcbiAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKG1lc3NhZ2Uua2luZCwgbWVzc2FnZS50ZXh0KTtcbiAgICAgICAgfTtcbiAgICAgICAgdmFyIGZhaWx1cmUgPSBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICBpZiAoZXJyLmZpZWxkID09PSAndG9rZW4nKSB7XG4gICAgICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1yb3cnKS5hZGRDbGFzcygnZXJyb3InKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCBmYWlsdXJlVGV4dChlcnIpKTtcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKG1vZGUgPT09ICdhZGQnKSB7XG4gICAgICAgICAgICBwYXlsb2FkID0geyBjaGFubmVsOiBzdGF0ZS5ib3RNb2RhbC5jaGFubmVsLCB0aXRsZTogdmFsdWVzLnRpdGxlLCB0b2tlbjogdmFsdWVzLnRva2VuIH07XG4gICAgICAgICAgICBpZiAoc3RhdGUuYm90TW9kYWwuZHJhZnRJZCA+IDApIHtcbiAgICAgICAgICAgICAgICBhcGlQYXRjaCgnL2JvdHMvJyArIHN0YXRlLmJvdE1vZGFsLmRyYWZ0SWQsIHsgdGl0bGU6IHZhbHVlcy50aXRsZSwgdG9rZW46IHZhbHVlcy50b2tlbiB9LCBkb25lLCBmYWlsdXJlKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgYXBpUG9zdCgnL2JvdHMnLCBwYXlsb2FkLCBkb25lLCBmYWlsdXJlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAodmFsdWVzLnRva2VuTmV3ICE9PSAnJykge1xuICAgICAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIHN0YXRlLmJvdE1vZGFsLmJvdC5pZCArICc6Y2hlY2tUb2tlbicsIHsgdG9rZW46IHZhbHVlcy50b2tlbk5ldyB9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgICAgIGlmIChkYXRhLm9rKSB7XG4gICAgICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdvaycsIHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkT2snLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICB1c2VybmFtZTogZGF0YS51c2VybmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IGRhdGEuZGlzcGxheV9uYW1lXG4gICAgICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGRhdGEuZXJyb3JfY29kZSA9PT0gJ290aGVyX2JvdCcpIHtcbiAgICAgICAgICAgICAgICAgICAgc2hvd0JvdE1lc3NhZ2UoJ3dhcm4nLCB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZE90aGVyJywge1xuICAgICAgICAgICAgICAgICAgICAgICAgdXNlcm5hbWU6IGRhdGEudXNlcm5hbWUgfHwgJycsXG4gICAgICAgICAgICAgICAgICAgICAgICBib3Q6IHN0YXRlLmJvdE1vZGFsLmJvdC50aXRsZVxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChkYXRhLmVycm9yX2NvZGUgPT09ICd0ZWxlZ3JhbS40MDEudW5hdXRob3JpemVkJyB8fCBkYXRhLmVycm9yX2NvZGUgPT09ICdtYXguNDAxLnVuYXV0aG9yaXplZCcpIHtcbiAgICAgICAgICAgICAgICAgICAgc2hvd0JvdE1lc3NhZ2UoJ2VycicsIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrZWQ0MDEnKSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChpc01heFRsc0NvZGUoZGF0YS5lcnJvcl9jb2RlKSkge1xuICAgICAgICAgICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgdGxzRXJyb3JUZXh0KCkpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCd3YXJuJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tOZXR3b3JrJykgKyAnICgnICsgZGF0YS5lcnJvcl9jb2RlICsgJyknKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCBmYWlsdXJlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhcGlQb3N0KCcvYm90cy8nICsgc3RhdGUuYm90TW9kYWwuYm90LmlkICsgJzpjaGVja1Rva2VuJywge30sIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgIGlmIChkYXRhLm9rKSB7XG4gICAgICAgICAgICAgICAgc2hvd0JvdE1lc3NhZ2UoJ29rJywgdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrZWRPaycsIHtcbiAgICAgICAgICAgICAgICAgICAgdXNlcm5hbWU6IGRhdGEudXNlcm5hbWUsXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGRhdGEuZGlzcGxheV9uYW1lXG4gICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChpc01heFRsc0NvZGUoZGF0YS5lcnJvcl9jb2RlKSkge1xuICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCB0bHNFcnJvclRleHQoKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkNDAxJykpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LCBmYWlsdXJlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlQm90Rm9ybSgpIHtcbiAgICAgICAgaWYgKCFzdGF0ZS5ib3RNb2RhbCB8fCBTQVZBQkxFX0NIQU5ORUxTLmluZGV4T2Yoc3RhdGUuYm90TW9kYWwuY2hhbm5lbCkgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHZhbHVlcyA9IGJvdEZvcm1WYWx1ZXMoKTtcbiAgICAgICAgaWYgKHZhbHVlcy50aXRsZSA9PT0gJycpIHtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdGl0bGUtZmllbGQnKS5hZGRDbGFzcygnZXJyb3InKTtcbiAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RUaXRsZVJlcXVpcmVkJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBtb2RlID0gc3RhdGUuYm90TW9kYWwubW9kZTtcbiAgICAgICAgdmFyIGZpbmlzaCA9IGZ1bmN0aW9uIChib3QpIHtcbiAgICAgICAgICAgIHN0YXRlLmJvdE1vZGFsLnNhdmVkID0gdHJ1ZTtcbiAgICAgICAgICAgIHJlcGxhY2VCb3QoYm90KTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtbW9kYWwnKS5tb2RhbCgnaGlkZScpO1xuICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICBpZiAobW9kZSA9PT0gJ2FkZCcpIHtcbiAgICAgICAgICAgICAgICBvcGVuQ2hhdE1vZGFsKGJvdCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25TYXZlZCcpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgdmFyIGZhaWx1cmUgPSBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICBpZiAoZXJyLmZpZWxkID09PSAndG9rZW4nKSB7XG4gICAgICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1yb3cnKS5hZGRDbGFzcygnZXJyb3InKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCBmYWlsdXJlVGV4dChlcnIpKTtcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKG1vZGUgPT09ICdhZGQnKSB7XG4gICAgICAgICAgICB2YXIgY3JlYXRlID0gZnVuY3Rpb24gKGlkKSB7XG4gICAgICAgICAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIGlkICsgJzpkaXNjb3ZlckNoYXRzJywge30sIGZ1bmN0aW9uIChib3QpIHtcbiAgICAgICAgICAgICAgICAgICAgZmluaXNoKGJvdCk7XG4gICAgICAgICAgICAgICAgfSwgZmFpbHVyZSk7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgaWYgKHN0YXRlLmJvdE1vZGFsLmRyYWZ0SWQgPiAwKSB7XG4gICAgICAgICAgICAgICAgYXBpUGF0Y2goJy9ib3RzLycgKyBzdGF0ZS5ib3RNb2RhbC5kcmFmdElkLCB7IHRpdGxlOiB2YWx1ZXMudGl0bGUsIHRva2VuOiB2YWx1ZXMudG9rZW4gfSwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgICAgICAgICAgICAgIGNyZWF0ZShib3QuaWQpO1xuICAgICAgICAgICAgICAgIH0sIGZhaWx1cmUpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBhcGlQb3N0KCcvYm90cycsIHsgY2hhbm5lbDogc3RhdGUuYm90TW9kYWwuY2hhbm5lbCwgdGl0bGU6IHZhbHVlcy50aXRsZSwgdG9rZW46IHZhbHVlcy50b2tlbiB9LCBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICAgICAgICAgIHJlcGxhY2VCb3QoYm90KTtcbiAgICAgICAgICAgICAgICAgICAgY3JlYXRlKGJvdC5pZCk7XG4gICAgICAgICAgICAgICAgfSwgZmFpbHVyZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHBheWxvYWQgPSB7IHRpdGxlOiB2YWx1ZXMudGl0bGUgfTtcbiAgICAgICAgaWYgKHZhbHVlcy50b2tlbk5ldyAhPT0gJycpIHtcbiAgICAgICAgICAgIHBheWxvYWQudG9rZW4gPSB2YWx1ZXMudG9rZW5OZXc7XG4gICAgICAgIH1cbiAgICAgICAgYXBpUGF0Y2goJy9ib3RzLycgKyBzdGF0ZS5ib3RNb2RhbC5ib3QuaWQsIHBheWxvYWQsIGZpbmlzaCwgZmFpbHVyZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2FuY2VsQm90TW9kYWwoKSB7XG4gICAgICAgIHZhciBtb2RhbCA9IHN0YXRlLmJvdE1vZGFsO1xuICAgICAgICBzdGF0ZS5ib3RNb2RhbCA9IG51bGw7XG4gICAgICAgICQoJyNtaC1ib3QtbW9kYWwnKS5tb2RhbCgnaGlkZScpO1xuICAgICAgICBpZiAobW9kYWwgJiYgbW9kYWwuZHJhZnRJZCA+IDAgJiYgIW1vZGFsLnNhdmVkKSB7XG4gICAgICAgICAgICAvLyB0aGUgXCLQn9GA0L7QstC10YDQuNGC0YxcIiBidXR0b24gY3JlYXRlZCB0aGUgZHJhZnQ6IGNhbmNlbGxpbmcgbXVzdCBub3QgbGVhdmUgaXQgYmVoaW5kXG4gICAgICAgICAgICBhcGlEZWxldGUoJy9ib3RzLycgKyBtb2RhbC5kcmFmdElkLCBmdW5jdGlvbiAoKSB7IGxvYWRCb3RzKHRydWUpOyB9LCBmdW5jdGlvbiAoKSB7IGxvYWRCb3RzKHRydWUpOyB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY29uZmlybURlbGV0ZUJvdCgpIHtcbiAgICAgICAgdmFyIGJvdCA9IHN0YXRlLmJvdE1vZGFsLmJvdDtcbiAgICAgICAgaWYgKCFib3QpIHsgcmV0dXJuOyB9XG4gICAgICAgICQoJyNtaC1jb25maXJtLXRleHQnKS50ZXh0KHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3REZWxldGVDb25maXJtJywgeyB0aXRsZTogYm90LnRpdGxlLCBjb3VudDogKGJvdC5jaGF0cyB8fCBbXSkubGVuZ3RoIH0pKTtcbiAgICAgICAgJCgnI21oLWNvbmZpcm0tbW9kYWwnKS5tb2RhbCh7IGNsb3NhYmxlOiB0cnVlIH0pLm1vZGFsKCdzaG93Jyk7XG4gICAgICAgICQoJyNtaC1jb25maXJtLW9rJykub2ZmKCdjbGljaycpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgICAgIGFwaURlbGV0ZSgnL2JvdHMvJyArIGJvdC5pZCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHN0YXRlLmJvdE1vZGFsLnNhdmVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBzdGF0ZS5ib3RNb2RhbC5kcmFmdElkID0gMDtcbiAgICAgICAgICAgICAgICAkKCcjbWgtYm90LW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uRGVsZXRlZCcpKTtcbiAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QoZmFpbHVyZVRleHQoZXJyKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBkaXNjb3ZlcnkgbW9kYWwgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gb3BlbkNoYXRNb2RhbChib3QpIHtcbiAgICAgICAgaWYgKCFib3QpIHsgcmV0dXJuOyB9XG4gICAgICAgIHN0YXRlLmNoYXRNb2RhbCA9IHsgYm90SWQ6IGJvdC5pZCwgYm90OiBib3QsIHRpbWVyOiBudWxsLCBzZWxlY3RlZDoge30gfTtcbiAgICAgICAgJCgnI21oLWNoYXQtbW9kYWwtdGl0bGUnKS50ZXh0KHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdFRpdGxlJywgeyB0aXRsZTogYm90LnRpdGxlIH0pKTtcbiAgICAgICAgdmFyIGlzTWF4ID0gYm90LmNoYW5uZWwgPT09ICdtYXgnO1xuICAgICAgICAkKCcjbWgtY2hhdC1zdGVwcycpLnRleHQodGYoaXNNYXggPyAnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RTdGVwc01heCcgOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RTdGVwcycsIHtcbiAgICAgICAgICAgIGJvdDogYm90LmJvdF91c2VybmFtZSA/ICdAJyArIGJvdC5ib3RfdXNlcm5hbWUgOiBib3QudGl0bGVcbiAgICAgICAgfSkpO1xuICAgICAgICAkKCcjbWgtY2hhdC1mb3VuZCcpLmVtcHR5KCk7XG4gICAgICAgICQoJyNtaC1jaGF0LWVycm9yJykuZW1wdHkoKTtcbiAgICAgICAgJCgnI21oLWNoYXQtZW1wdHknKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgJCgnI21oLWNoYXQtYWdhaW4nKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgJCgnI21oLWNoYXQtc3RvcCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAkKCcjbWgtY2hhdC1zYXZlJykuYXR0cignZGlzYWJsZWQnLCB0cnVlKTtcbiAgICAgICAgJCgnI21oLWNoYXQtc3RhdHVzLXRleHQnKS50ZXh0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0U2VhcmNoaW5nJykpO1xuICAgICAgICAkKCcjbWgtY2hhdC1jb3VudGRvd24nKS50ZXh0KCcnKTtcbiAgICAgICAgJCgnI21oLWNoYXQtcHJvZ3Jlc3MgLmJhcicpLmNzcygnd2lkdGgnLCAnMCUnKTtcbiAgICAgICAgJCgnI21oLWNoYXQtbW9kYWwnKS5tb2RhbCh7IGNsb3NhYmxlOiBmYWxzZSB9KS5tb2RhbCgnc2hvdycpO1xuICAgICAgICBzdGFydERpc2NvdmVyeShib3QuaWQsIGZhbHNlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzdGFydERpc2NvdmVyeShib3RJZCwgcmVzdGFydCkge1xuICAgICAgICBhcGlQb3N0KCcvYm90cy8nICsgYm90SWQgKyAnOmRpc2NvdmVyQ2hhdHMnLCB7IHJlc3RhcnQ6IHJlc3RhcnQgPT09IHRydWUgfSwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgaWYgKCFzdGF0ZS5jaGF0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICBzdGF0ZS5jaGF0TW9kYWwuc2VsZWN0ZWQgPSB7fTtcbiAgICAgICAgICAgIHVwZGF0ZUNoYXRNb2RhbChib3QpO1xuICAgICAgICAgICAgc2NoZWR1bGVDaGF0UG9sbCgpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICBzaG93Q2hhdEVycm9yKGZhaWx1cmVUZXh0KGVycikpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzY2hlZHVsZUNoYXRQb2xsKCkge1xuICAgICAgICBzdG9wQ2hhdFBvbGwoKTtcbiAgICAgICAgc3RhdGUuY2hhdE1vZGFsLnRpbWVyID0gc2V0SW50ZXJ2YWwoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCFzdGF0ZS5jaGF0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICBhcGlHZXQoJy9ib3RzLycgKyBzdGF0ZS5jaGF0TW9kYWwuYm90SWQsIHt9LCBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS5jaGF0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICAgICAgdXBkYXRlQ2hhdE1vZGFsKGJvdCk7XG4gICAgICAgICAgICAgICAgaWYgKCFib3QuZGlzY292ZXJ5LmFjdGl2ZSkge1xuICAgICAgICAgICAgICAgICAgICBzdG9wQ2hhdFBvbGwoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoKSB7IC8qIGtlZXAgdGhlIGxhc3Qgc3RhdGUgKi8gfSk7XG4gICAgICAgIH0sIDIwMDApO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHN0b3BDaGF0UG9sbCgpIHtcbiAgICAgICAgaWYgKHN0YXRlLmNoYXRNb2RhbCAmJiBzdGF0ZS5jaGF0TW9kYWwudGltZXIgIT09IG51bGwpIHtcbiAgICAgICAgICAgIGNsZWFySW50ZXJ2YWwoc3RhdGUuY2hhdE1vZGFsLnRpbWVyKTtcbiAgICAgICAgICAgIHN0YXRlLmNoYXRNb2RhbC50aW1lciA9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiB1cGRhdGVDaGF0TW9kYWwoYm90KSB7XG4gICAgICAgIGlmICghc3RhdGUuY2hhdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICBzdGF0ZS5jaGF0TW9kYWwuYm90ID0gYm90O1xuICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgIHZhciBkaXNjb3ZlcnkgPSBib3QuZGlzY292ZXJ5IHx8IHsgYWN0aXZlOiBmYWxzZSwgc3RhdHVzOiAnaWRsZScsIGZvdW5kOiBbXSB9O1xuICAgICAgICB2YXIgZm91bmQgPSBkaXNjb3ZlcnkuZm91bmQgfHwgW107XG4gICAgICAgIHZhciBzZWxlY3RlZENvdW50ID0gMDtcbiAgICAgICAgdmFyIGh0bWwgPSAnJztcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmb3VuZC5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGl0ZW0gPSBmb3VuZFtpXTtcbiAgICAgICAgICAgIHZhciBpbkJvdCA9IGZpbmRDaGF0QnlFeHRlcm5hbChib3QsIGl0ZW0uY2hhdF9pZCk7XG4gICAgICAgICAgICBpZiAoIWl0ZW0uYWxyZWFkeV9jb25uZWN0ZWQgJiYgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkW2l0ZW0uY2hhdF9pZF0gIT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkW2l0ZW0uY2hhdF9pZF0gPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFyIGNoZWNrZWQgPSAhaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCAmJiBzdGF0ZS5jaGF0TW9kYWwuc2VsZWN0ZWRbaXRlbS5jaGF0X2lkXSA9PT0gdHJ1ZTtcbiAgICAgICAgICAgIGlmIChjaGVja2VkKSB7IHNlbGVjdGVkQ291bnQrKzsgfVxuICAgICAgICAgICAgaHRtbCArPSAnPGxhYmVsIGNsYXNzPVwibWgtZm91bmQtcm93JyArIChpdGVtLmFscmVhZHlfY29ubmVjdGVkID8gJyBpcy1jb25uZWN0ZWQnIDogJycpICsgJ1wiIGRhdGEtY2hhdC1yb3c9XCInICsgKGluQm90ID8gaW5Cb3QuaWQgOiAwKSArICdcIiBkYXRhLWNoYXQta2V5PVwiJyArIGVzYyhpdGVtLmNoYXRfaWQpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cInVpIGNoZWNrYm94JyArIChjaGVja2VkID8gJyBjaGVja2VkJyA6ICcnKSArIChpdGVtLmFscmVhZHlfY29ubmVjdGVkID8gJyBkaXNhYmxlZCcgOiAnJykgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjbGFzcz1cImhpZGRlbiBtaC1mb3VuZC1jaGVja1wiJyArIChjaGVja2VkID8gJyBjaGVja2VkJyA6ICcnKSArIChpdGVtLmFscmVhZHlfY29ubmVjdGVkID8gJyBkaXNhYmxlZCcgOiAnJykgKyAnPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWJveFwiPjwvc3Bhbj48L3NwYW4+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtZm91bmQtdGl0bGVcIj48YiBjbGFzcz1cIm1oLXRydW5jYXRlXCI+JyArIGVzYyhpdGVtLnRpdGxlIHx8IGl0ZW0uY2hhdF9pZCkgKyAnPC9iPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1ldGFcIj4nICsgZXNjKGNoYXRLaW5kTGFiZWwoaXRlbS5jaGF0X2tpbmQpKSArICc8L3NwYW4+PC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cInVpICcgKyAoaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCA/ICdsYWJlbCcgOiAnYmx1ZSBsYWJlbCcpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArIGVzYyhpdGVtLmFscmVhZHlfY29ubmVjdGVkID8gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RFeGlzdHMnKSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0TmV3JykpICsgJzwvc3Bhbj48L2xhYmVsPic7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLWNoYXQtZm91bmQnKS5odG1sKGh0bWwpO1xuICAgICAgICAkKCcjbWgtY2hhdC1zYXZlJykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RTYXZlJywgeyBjb3VudDogc2VsZWN0ZWRDb3VudCB9KSk7XG4gICAgICAgICQoJyNtaC1jaGF0LXNhdmUnKS5hdHRyKCdkaXNhYmxlZCcsIHNlbGVjdGVkQ291bnQgPT09IDAgPyB0cnVlIDogbnVsbCk7XG5cbiAgICAgICAgdmFyIHN0YXR1c1RleHQgPSAnJztcbiAgICAgICAgdmFyIGNvdW50ZG93biA9ICcnO1xuICAgICAgICB2YXIgcHJvZ3Jlc3MgPSAwO1xuICAgICAgICBpZiAoZGlzY292ZXJ5LmFjdGl2ZSkge1xuICAgICAgICAgICAgaWYgKGZvdW5kLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNUZXh0ID0gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0Rm91bmQnLCB7IGNvdW50OiBmb3VuZC5sZW5ndGggfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHN0YXR1c1RleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdFNlYXJjaGluZycpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY291bnRkb3duID0gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0UmVtYWluaW5nJywgeyB0aW1lOiBmbXRDb3VudGRvd24oZGlzY292ZXJ5LnJlbWFpbmluZ19zZWMpIH0pO1xuICAgICAgICAgICAgcHJvZ3Jlc3MgPSBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIE1hdGgucm91bmQoKDMwMCAtIGRpc2NvdmVyeS5yZW1haW5pbmdfc2VjKSAvIDMwMCAqIDEwMCkpKTtcbiAgICAgICAgICAgICQoJyNtaC1jaGF0LWVtcHR5JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICAgICAkKCcjbWgtY2hhdC1lcnJvcicpLmVtcHR5KCk7XG4gICAgICAgICAgICAkKCcjbWgtY2hhdC1hZ2FpbicpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLWNoYXQtc3RvcCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgJCgnI21oLWNoYXQtc3RvcCcpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLWNoYXQtYWdhaW4nKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgIGlmIChkaXNjb3Zlcnkuc3RhdHVzID09PSAnZXJyb3InKSB7XG4gICAgICAgICAgICAgICAgdmFyIGNvZGUgPSBTdHJpbmcoZGlzY292ZXJ5Lmxhc3RfZXJyb3JfY29kZSB8fCAnJyk7XG4gICAgICAgICAgICAgICAgdmFyIHRleHQ7XG4gICAgICAgICAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MDkud2ViaG9va19zZXQnKSB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdEVycm9yV2ViaG9vaycpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoY29kZSA9PT0gJ21heC40MDUud2ViaG9va19zZXQnKSB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdEVycm9yV2ViaG9va01heCcpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoaXNNYXhUbHNDb2RlKGNvZGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQgPSB0bHNFcnJvclRleHQoKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNvZGUgPT09ICdtYXguNDAxLnVuYXV0aG9yaXplZCcgfHwgY29kZSA9PT0gJ3RlbGVncmFtLjQwMS51bmF1dGhvcml6ZWQnKSB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkNDAxJyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGV4dCA9IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0RXJyb3InKSArICcgKCcgKyBjb2RlICsgJyknO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzaG93Q2hhdEVycm9yKHRleHQpO1xuICAgICAgICAgICAgICAgIHN0YXR1c1RleHQgPSAnJztcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZGlzY292ZXJ5LnN0YXR1cyA9PT0gJ2VtcHR5Jykge1xuICAgICAgICAgICAgICAgIHN0YXR1c1RleHQgPSAnJztcbiAgICAgICAgICAgICAgICAkKCcjbWgtY2hhdC1lbXB0eScpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChmb3VuZC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgc3RhdHVzVGV4dCA9IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdFRpbWVvdXQnLCB7IGNvdW50OiBmb3VuZC5sZW5ndGggfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHN0YXR1c1RleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdE5vU2Vzc2lvbicpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY291bnRkb3duID0gJyc7XG4gICAgICAgICAgICBwcm9ncmVzcyA9IDEwMDtcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtY2hhdC1zdGF0dXMtdGV4dCcpLnRleHQoc3RhdHVzVGV4dCk7XG4gICAgICAgICQoJyNtaC1jaGF0LWNvdW50ZG93bicpLnRleHQoY291bnRkb3duKTtcbiAgICAgICAgJCgnI21oLWNoYXQtcHJvZ3Jlc3MgLmJhcicpLmNzcygnd2lkdGgnLCBwcm9ncmVzcyArICclJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZmluZENoYXRCeUV4dGVybmFsKGJvdCwgY2hhdElkKSB7XG4gICAgICAgIHZhciBjaGF0cyA9IGJvdC5jaGF0cyB8fCBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGF0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKFN0cmluZyhjaGF0c1tpXS5jaGF0X2lkKSA9PT0gU3RyaW5nKGNoYXRJZCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gY2hhdHNbaV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2hvd0NoYXRFcnJvcih0ZXh0KSB7XG4gICAgICAgICQoJyNtaC1jaGF0LWVycm9yJykuaHRtbCgnPGRpdiBjbGFzcz1cInVpIG5lZ2F0aXZlIG1lc3NhZ2VcIiByb2xlPVwiYWxlcnRcIj4nXG4gICAgICAgICAgICArICc8c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBhcmlhLWhpZGRlbj1cInRydWVcIj48Y2lyY2xlIGN4PVwiOFwiIGN5PVwiOFwiIHI9XCI2LjI1XCIvPjxwYXRoIGQ9XCJNNiA2bDQgNE0xMCA2bC00IDRcIi8+PC9zdmc+J1xuICAgICAgICAgICAgKyAnPGRpdj4nICsgZXNjKHRleHQpICsgJzwvZGl2PjwvZGl2PicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJpbmRDaGF0Rm91bmQoKSB7XG4gICAgICAgICQoJyNtaC1jaGF0LWZvdW5kJykub24oJ2NoYW5nZScsICcubWgtZm91bmQtY2hlY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoIXN0YXRlLmNoYXRNb2RhbCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHZhciBrZXkgPSBTdHJpbmcoJCh0aGlzKS5jbG9zZXN0KCcubWgtZm91bmQtcm93JykuZGF0YSgnY2hhdC1rZXknKSk7XG4gICAgICAgICAgICBzdGF0ZS5jaGF0TW9kYWwuc2VsZWN0ZWRba2V5XSA9ICQodGhpcykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICAgICAgdXBkYXRlQ2hhdE1vZGFsKHN0YXRlLmNoYXRNb2RhbC5ib3QpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlU2VsZWN0ZWRDaGF0cygpIHtcbiAgICAgICAgaWYgKCFzdGF0ZS5jaGF0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgIHZhciBib3QgPSBzdGF0ZS5jaGF0TW9kYWwuYm90O1xuICAgICAgICB2YXIgcGF0Y2hlcyA9IFtdO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IChib3QuZGlzY292ZXJ5LmZvdW5kIHx8IFtdKS5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGl0ZW0gPSBib3QuZGlzY292ZXJ5LmZvdW5kW2ldO1xuICAgICAgICAgICAgaWYgKGl0ZW0uYWxyZWFkeV9jb25uZWN0ZWQgfHwgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkW2l0ZW0uY2hhdF9pZF0gIT09IHRydWUpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBjaGF0ID0gZmluZENoYXRCeUV4dGVybmFsKGJvdCwgaXRlbS5jaGF0X2lkKTtcbiAgICAgICAgICAgIGlmIChjaGF0KSB7XG4gICAgICAgICAgICAgICAgcGF0Y2hlcy5wdXNoKHsgaWQ6IGNoYXQuaWQsIGVuYWJsZWQ6IHRydWUsIGNoYXRfa2luZDogaXRlbS5jaGF0X2tpbmQsIHRpdGxlOiBpdGVtLnRpdGxlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChwYXRjaGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGFwaVBhdGNoKCcvYm90cy8nICsgYm90LmlkLCB7IGNoYXRzOiBwYXRjaGVzIH0sIGZ1bmN0aW9uIChzYXZlZCkge1xuICAgICAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIGJvdC5pZCArICc6ZGlzY292ZXJDaGF0cycsIHsgc3RvcDogdHJ1ZSB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgY2xvc2VDaGF0TW9kYWwoKTtcbiAgICAgICAgICAgICAgICByZXBsYWNlQm90KHNhdmVkKTtcbiAgICAgICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZWQnKSk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgY2xvc2VDaGF0TW9kYWwoKTtcbiAgICAgICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZWQnKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgc2hvd0NoYXRFcnJvcihmYWlsdXJlVGV4dChlcnIpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2xvc2VDaGF0TW9kYWwoKSB7XG4gICAgICAgIHN0b3BDaGF0UG9sbCgpO1xuICAgICAgICBzdGF0ZS5jaGF0TW9kYWwgPSBudWxsO1xuICAgICAgICAkKCcjbWgtY2hhdC1tb2RhbCcpLm1vZGFsKCdoaWRlJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3RvcERpc2NvdmVyeUFuZENsb3NlKCkge1xuICAgICAgICB2YXIgYm90ID0gc3RhdGUuY2hhdE1vZGFsID8gc3RhdGUuY2hhdE1vZGFsLmJvdCA6IG51bGw7XG4gICAgICAgIGlmIChib3QpIHtcbiAgICAgICAgICAgIGFwaVBvc3QoJy9ib3RzLycgKyBib3QuaWQgKyAnOmRpc2NvdmVyQ2hhdHMnLCB7IHN0b3A6IHRydWUgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGNsb3NlQ2hhdE1vZGFsKCk7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgY2xvc2VDaGF0TW9kYWwoKTtcbiAgICAgICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2xvc2VDaGF0TW9kYWwoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gdGVzdCBtb2RhbCAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBvcGVuVGVzdE1vZGFsKGJvdCwgY2hhdElkcykge1xuICAgICAgICBpZiAoIWJvdCkgeyByZXR1cm47IH1cbiAgICAgICAgc3RhdGUudGVzdE1vZGFsID0geyBib3RJZDogYm90LmlkLCBib3Q6IGJvdCwgZXZlbnRJZDogMCwgY2hhdElkczogY2hhdElkcywgdGltZXI6IG51bGwsIHRyaWVzOiAwIH07XG4gICAgICAgICQoJyNtaC10ZXN0LWxpc3QnKS5odG1sKCc8ZGl2IGNsYXNzPVwibWgtbXV0ZWRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3RSdW5uaW5nJykpICsgJzwvZGl2PicpO1xuICAgICAgICAkKCcjbWgtdGVzdC1zdW1tYXJ5JykudGV4dCgnJyk7XG4gICAgICAgICQoJyNtaC10ZXN0LW1vZGFsJykubW9kYWwoeyBjbG9zYWJsZTogdHJ1ZSwgb25IaWRlOiBmdW5jdGlvbiAoKSB7IHN0b3BUZXN0UG9sbCgpOyB9IH0pLm1vZGFsKCdzaG93Jyk7XG4gICAgICAgIHZhciBwYXlsb2FkID0gY2hhdElkcyA9PT0gbnVsbCA/IHt9IDogeyBjaGF0X2lkczogY2hhdElkcyB9O1xuICAgICAgICBhcGlQb3N0KCcvYm90cy8nICsgYm90LmlkICsgJzpzZW5kVGVzdCcsIHBheWxvYWQsIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICBpZiAoIXN0YXRlLnRlc3RNb2RhbCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHN0YXRlLnRlc3RNb2RhbC5ldmVudElkID0gZGF0YS5ldmVudF9pZDtcbiAgICAgICAgICAgIHN0YXRlLnRlc3RNb2RhbC5ib3QgPSBkYXRhLmJvdDtcbiAgICAgICAgICAgIHJlcGxhY2VCb3QoZGF0YS5ib3QpO1xuICAgICAgICAgICAgcmVuZGVyVGVzdChkYXRhLmJvdCk7XG4gICAgICAgICAgICBzY2hlZHVsZVRlc3RQb2xsKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICQoJyNtaC10ZXN0LWxpc3QnKS5odG1sKCc8ZGl2IGNsYXNzPVwidWkgbmVnYXRpdmUgbWVzc2FnZVwiPjxkaXY+JyArIGVzYyhmYWlsdXJlVGV4dChlcnIpKSArICc8L2Rpdj48L2Rpdj4nKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2NoZWR1bGVUZXN0UG9sbCgpIHtcbiAgICAgICAgc3RvcFRlc3RQb2xsKCk7XG4gICAgICAgIHN0YXRlLnRlc3RNb2RhbC50aW1lciA9IHNldEludGVydmFsKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICghc3RhdGUudGVzdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgc3RhdGUudGVzdE1vZGFsLnRyaWVzKys7XG4gICAgICAgICAgICBhcGlHZXQoJy9ib3RzLycgKyBzdGF0ZS50ZXN0TW9kYWwuYm90SWQsIHt9LCBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS50ZXN0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICAgICAgc3RhdGUudGVzdE1vZGFsLmJvdCA9IGJvdDtcbiAgICAgICAgICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgICAgICAgICAgcmVuZGVyVGVzdChib3QpO1xuICAgICAgICAgICAgICAgIGlmICghdGVzdFBlbmRpbmcoYm90KSB8fCBzdGF0ZS50ZXN0TW9kYWwudHJpZXMgPiAyMCkge1xuICAgICAgICAgICAgICAgICAgICBzdG9wVGVzdFBvbGwoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgaWYgKHN0YXRlLnRlc3RNb2RhbCAmJiBzdGF0ZS50ZXN0TW9kYWwudHJpZXMgPiAzKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0b3BUZXN0UG9sbCgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9LCAyMDAwKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzdG9wVGVzdFBvbGwoKSB7XG4gICAgICAgIGlmIChzdGF0ZS50ZXN0TW9kYWwgJiYgc3RhdGUudGVzdE1vZGFsLnRpbWVyICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjbGVhckludGVydmFsKHN0YXRlLnRlc3RNb2RhbC50aW1lcik7XG4gICAgICAgICAgICBzdGF0ZS50ZXN0TW9kYWwudGltZXIgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdGVzdERlbGl2ZXJpZXMoYm90KSB7XG4gICAgICAgIHZhciBldmVudElkID0gc3RhdGUudGVzdE1vZGFsID8gc3RhdGUudGVzdE1vZGFsLmV2ZW50SWQgOiAwO1xuICAgICAgICB2YXIgcmVzdWx0ID0gW107XG4gICAgICAgIHZhciBjaGF0cyA9IGJvdC5jaGF0cyB8fCBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGF0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGRlbGl2ZXJ5ID0gY2hhdHNbaV0ubGFzdF9kZWxpdmVyeTtcbiAgICAgICAgICAgIGlmIChkZWxpdmVyeSAmJiBOdW1iZXIoZGVsaXZlcnkuZXZlbnRfaWQpID09PSBOdW1iZXIoZXZlbnRJZCkpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQucHVzaCh7IGNoYXQ6IGNoYXRzW2ldLCBkZWxpdmVyeTogZGVsaXZlcnkgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB0ZXN0UGVuZGluZyhib3QpIHtcbiAgICAgICAgdmFyIGxpc3QgPSB0ZXN0RGVsaXZlcmllcyhib3QpO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBzdGF0dXMgPSBsaXN0W2ldLmRlbGl2ZXJ5LnN0YXR1cztcbiAgICAgICAgICAgIGlmIChzdGF0dXMgPT09ICdwZW5kaW5nJyB8fCBzdGF0dXMgPT09ICdzZW5kaW5nJykge1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZWxpdmVyeVN0YXR1c0xhYmVsKGRlbGl2ZXJ5KSB7XG4gICAgICAgIGlmIChkZWxpdmVyeS5zdGF0dXMgPT09ICdzZW50JykgeyByZXR1cm4geyBjbHM6ICdpcy1vaycsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3REZWxpdmVyZWQnKSB9OyB9XG4gICAgICAgIGlmIChkZWxpdmVyeS5zdGF0dXMgPT09ICdwZW5kaW5nJyB8fCBkZWxpdmVyeS5zdGF0dXMgPT09ICdzZW5kaW5nJykgeyByZXR1cm4geyBjbHM6ICcnLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0UXVldWVkJykgfTsgfVxuICAgICAgICByZXR1cm4geyBjbHM6ICdpcy1lcnInLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0RXJyb3InKSB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlbGl2ZXJ5RXJyb3JUZXh0KGNvZGUpIHtcbiAgICAgICAgaWYgKGlzTWF4VGxzQ29kZShjb2RlKSkgeyByZXR1cm4gdGxzRXJyb3JUZXh0KCk7IH1cbiAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MDEudW5hdXRob3JpemVkJyB8fCBjb2RlID09PSAnbWF4LjQwMS51bmF1dGhvcml6ZWQnKSB7IHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkNDAxJyk7IH1cbiAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MDMua2lja2VkJyB8fCBjb2RlID09PSAndGVsZWdyYW0uNDAzLmJsb2NrZWQnIHx8IGNvZGUgPT09ICd0ZWxlZ3JhbS40MDAuY2hhdF9ub3RfZm91bmQnXG4gICAgICAgICAgICB8fCBjb2RlID09PSAnbWF4LjQwMy5jaGF0X2RlbmllZCcgfHwgY29kZSA9PT0gJ21heC40MDQubm90X2ZvdW5kJyB8fCBjb2RlID09PSAnbWF4LjQwNC51bmtub3duJykge1xuICAgICAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRTdGF0dXNHb25lJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MjkucmF0ZV9saW1pdCcgfHwgY29kZSA9PT0gJ21heC40MjkucmF0ZV9saW1pdCcpIHsgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRFcnJvclJhdGVMaW1pdCcpOyB9XG4gICAgICAgIGlmIChjb2RlID09PSAnc3RhbGUnKSB7IHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0RXJyb3JTdGFsZScpOyB9XG4gICAgICAgIHJldHVybiBjb2RlO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlclRlc3QoYm90KSB7XG4gICAgICAgIHZhciBsaXN0ID0gdGVzdERlbGl2ZXJpZXMoYm90KTtcbiAgICAgICAgdmFyIGNvdW50cyA9IHsgc2VudDogMCwgcGVuZGluZzogMCwgZmFpbGVkOiAwIH07XG4gICAgICAgIHZhciBodG1sID0gJyc7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGNoYXQgPSBsaXN0W2ldLmNoYXQ7XG4gICAgICAgICAgICB2YXIgZGVsaXZlcnkgPSBsaXN0W2ldLmRlbGl2ZXJ5O1xuICAgICAgICAgICAgdmFyIGxhYmVsID0gZGVsaXZlcnlTdGF0dXNMYWJlbChkZWxpdmVyeSk7XG4gICAgICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAnc2VudCcpIHsgY291bnRzLnNlbnQrKzsgfVxuICAgICAgICAgICAgZWxzZSBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAncGVuZGluZycgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnc2VuZGluZycpIHsgY291bnRzLnBlbmRpbmcrKzsgfVxuICAgICAgICAgICAgZWxzZSB7IGNvdW50cy5mYWlsZWQrKzsgfVxuICAgICAgICAgICAgdmFyIHJldHJ5ID0gKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2ZhaWxlZCcgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnZHJvcHBlZCcpXG4gICAgICAgICAgICAgICAgPyAnPGJ1dHRvbiBjbGFzcz1cInVpIGJhc2ljIGJ1dHRvbiBtaC10ZXN0LXJldHJ5XCIgdHlwZT1cImJ1dHRvblwiIGRhdGEtY2hhdC1pZD1cIicgKyBjaGF0LmlkICsgJ1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdFJldHJ5JykpICsgJzwvYnV0dG9uPidcbiAgICAgICAgICAgICAgICA6ICcnO1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIm1oLXRlc3Qtcm93XCI+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyICcgKyAoYm90LmNoYW5uZWwgPT09ICdtYXgnID8gJ21heCcgOiAndGcnKSArICcgc1wiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPicgKyAoYm90LmNoYW5uZWwgPT09ICdtYXgnID8gJ01BWCcgOiAnVEcnKSArICc8L3NwYW4+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC10ZXN0LXRpdGxlXCI+PGRpdiBjbGFzcz1cIm1oLXRydW5jYXRlXCI+JyArIGVzYyhjaGF0LnRpdGxlIHx8IGNoYXQuY2hhdF9pZCkgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgKGRlbGl2ZXJ5Lmxhc3RfZXJyb3JfY29kZSA/ICc8ZGl2IGNsYXNzPVwibWgtbWV0YSBtaC1lcnJvci10ZXh0XCI+JyArIGVzYyhkZWxpdmVyeUVycm9yVGV4dChkZWxpdmVyeS5sYXN0X2Vycm9yX2NvZGUpKSArICc8L2Rpdj4nIDogJycpXG4gICAgICAgICAgICAgICAgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtdGVzdC1zdGF0ZSAnICsgbGFiZWwuY2xzICsgJ1wiPicgKyBlc2MobGFiZWwudGV4dCkgKyAnPC9zcGFuPicgKyByZXRyeSArICc8L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmIChodG1sID09PSAnJykge1xuICAgICAgICAgICAgaHRtbCA9ICc8ZGl2IGNsYXNzPVwibWgtbXV0ZWRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3RSdW5uaW5nJykpICsgJzwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLXRlc3QtbGlzdCcpLmh0bWwoaHRtbCk7XG4gICAgICAgICQoJyNtaC10ZXN0LXN1bW1hcnknKS50ZXh0KHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0U3VtbWFyeScsIHtcbiAgICAgICAgICAgIG9rOiBjb3VudHMuc2VudCxcbiAgICAgICAgICAgIGZhaWxlZDogY291bnRzLmZhaWxlZCxcbiAgICAgICAgICAgIHBlbmRpbmc6IGNvdW50cy5wZW5kaW5nXG4gICAgICAgIH0pKTtcbiAgICAgICAgJCgnI21oLXRlc3QtbGlzdCAubWgtdGVzdC1yZXRyeScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBjaGF0SWQgPSBOdW1iZXIoJCh0aGlzKS5kYXRhKCdjaGF0LWlkJykpO1xuICAgICAgICAgICAgb3BlblRlc3RNb2RhbChzdGF0ZS50ZXN0TW9kYWwgPyBzdGF0ZS50ZXN0TW9kYWwuYm90IDogYm90LCBbY2hhdElkXSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gZ2VuZXJhbCBzZXR0aW5ncyAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBsb2FkR2VuZXJhbFNldHRpbmdzKCkge1xuICAgICAgICBhcGlHZXQoJy9zZXR0aW5ncycsIHt9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgc3RhdGUucmV0ZW50aW9uID0gZGF0YS5ldmVudHNfcmV0ZW50aW9uX2RheXM7XG4gICAgICAgICAgICBzdGF0ZS5zZXR0aW5ncyA9IGRhdGE7XG4gICAgICAgICAgICAkKCcjbWgtcmV0ZW50aW9uLWlucHV0JykudmFsKGRhdGEuZXZlbnRzX3JldGVudGlvbl9kYXlzKTtcbiAgICAgICAgICAgICQoJyNtaC1wdWJsaWMtdXJsLWlucHV0JykudmFsKGRhdGEucGJ4X3B1YmxpY191cmwgfHwgJycpO1xuICAgICAgICAgICAgJCgnI21oLXByb3h5LWlucHV0JykudmFsKGRhdGEucHJveHlfdXJsIHx8ICcnKTtcbiAgICAgICAgICAgICQoJyNtaC1tYXgtY2EtaW5wdXQnKS52YWwoZGF0YS5tYXhfY2FfYnVuZGxlX3BhdGggfHwgJycpO1xuICAgICAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtbWF4LWNhLWZpZWxkJyk7XG4gICAgICAgICAgICAkKCcjbWgtbWFzay1kZWZhdWx0JykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCBkYXRhLm1hc2tfcGhvbmVfZGVmYXVsdCA9PT0gdHJ1ZSk7XG4gICAgICAgICAgICAkKCcjbWgtbWFzay1kZWZhdWx0IGlucHV0JykucHJvcCgnY2hlY2tlZCcsIGRhdGEubWFza19waG9uZV9kZWZhdWx0ID09PSB0cnVlKTtcbiAgICAgICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLXB1YmxpYy11cmwtZmllbGQnKTtcbiAgICAgICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLXByb3h5LWZpZWxkJyk7XG4gICAgICAgICAgICBjbGVhclJldGVudGlvbkVycm9yKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICBtYXJrUmV0ZW50aW9uRXJyb3IodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vbkxvYWRFcnJvcicsIHtcbiAgICAgICAgICAgICAgICB3aGF0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Mb2FkV2hhdFNldHRpbmdzJyksXG4gICAgICAgICAgICAgICAgY29kZTogZmFpbHVyZS5zdGF0dXMgPiAwID8gZmFpbHVyZS5zdGF0dXMgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25UaW1lb3V0JylcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZVNldHRpbmcocGF5bG9hZCwgZmllbGRTZWxlY3RvciwgcmV2ZXJ0KSB7XG4gICAgICAgIGFwaVBhdGNoKCcvc2V0dGluZ3MnLCBwYXlsb2FkLCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgc3RhdGUuc2V0dGluZ3MgPSBkYXRhO1xuICAgICAgICAgICAgaWYgKGZpZWxkU2VsZWN0b3IpIHsgY2xlYXJGaWVsZEVycm9yKGZpZWxkU2VsZWN0b3IpOyB9XG4gICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZWQnKSk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICBpZiAoZmllbGRTZWxlY3Rvcikge1xuICAgICAgICAgICAgICAgIG1hcmtGaWVsZEVycm9yKGZpZWxkU2VsZWN0b3IsIGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXZlcnQpIHsgcmV2ZXJ0KCk7IH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZVB1YmxpY1VybCgpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gU3RyaW5nKCQoJyNtaC1wdWJsaWMtdXJsLWlucHV0JykudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgdmFyIHByZXZpb3VzID0gc3RhdGUuc2V0dGluZ3MgPyBzdGF0ZS5zZXR0aW5ncy5wYnhfcHVibGljX3VybCA6ICcnO1xuICAgICAgICBpZiAodmFsdWUgPT09ICcnKSB7XG4gICAgICAgICAgICBzYXZlU2V0dGluZyh7IHBieF9wdWJsaWNfdXJsOiAnJyB9LCAnI21oLXB1YmxpYy11cmwtZmllbGQnKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIS9eaHR0cHM/OlxcL1xcL1xcUyskL2kudGVzdCh2YWx1ZSkpIHtcbiAgICAgICAgICAgIG1hcmtGaWVsZEVycm9yKCcjbWgtcHVibGljLXVybC1maWVsZCcsIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NldHRpbmdzUHVibGljVXJsSW52YWxpZCcpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBzYXZlU2V0dGluZyh7IHBieF9wdWJsaWNfdXJsOiB2YWx1ZSB9LCAnI21oLXB1YmxpYy11cmwtZmllbGQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtcHVibGljLXVybC1pbnB1dCcpLnZhbChwcmV2aW91cyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVQcm94eSgpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gU3RyaW5nKCQoJyNtaC1wcm94eS1pbnB1dCcpLnZhbCgpIHx8ICcnKS50cmltKCk7XG4gICAgICAgIHZhciBwcmV2aW91cyA9IHN0YXRlLnNldHRpbmdzID8gc3RhdGUuc2V0dGluZ3MucHJveHlfdXJsIDogJyc7XG4gICAgICAgIGlmICh2YWx1ZSAhPT0gJycgJiYgIS9eKChodHRwcz98c29ja3M1aD8pOlxcL1xcLyk/W0EtWmEtejAtOS5cXC1dKzpcXGR7MSw1fSQvLnRlc3QodmFsdWUpKSB7XG4gICAgICAgICAgICBtYXJrRmllbGRFcnJvcignI21oLXByb3h5LWZpZWxkJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU2V0dGluZ3NQcm94eUludmFsaWQnKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgc2F2ZVNldHRpbmcoeyBwcm94eV91cmw6IHZhbHVlIH0sICcjbWgtcHJveHktZmllbGQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtcHJveHktaW5wdXQnKS52YWwocHJldmlvdXMpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlTWF4Q2FCdW5kbGUoKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IFN0cmluZygkKCcjbWgtbWF4LWNhLWlucHV0JykudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgdmFyIHByZXZpb3VzID0gc3RhdGUuc2V0dGluZ3MgPyBzdGF0ZS5zZXR0aW5ncy5tYXhfY2FfYnVuZGxlX3BhdGggOiAnJztcbiAgICAgICAgaWYgKHZhbHVlICE9PSAnJyAmJiB2YWx1ZS5jaGFyQXQoMCkgIT09ICcvJykge1xuICAgICAgICAgICAgbWFya0ZpZWxkRXJyb3IoJyNtaC1tYXgtY2EtZmllbGQnLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9TZXR0aW5nc0NhUGF0aEludmFsaWQnKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgc2F2ZVNldHRpbmcoeyBtYXhfY2FfYnVuZGxlX3BhdGg6IHZhbHVlIH0sICcjbWgtbWF4LWNhLWZpZWxkJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLW1heC1jYS1pbnB1dCcpLnZhbChwcmV2aW91cyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVNYXNrRGVmYXVsdCgpIHtcbiAgICAgICAgdmFyIGNoZWNrZWQgPSAkKCcjbWgtbWFzay1kZWZhdWx0IGlucHV0JykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICBzYXZlU2V0dGluZyh7IG1hc2tfcGhvbmVfZGVmYXVsdDogY2hlY2tlZCB9LCBudWxsLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtbWFzay1kZWZhdWx0IGlucHV0JykucHJvcCgnY2hlY2tlZCcsICFjaGVja2VkKTtcbiAgICAgICAgICAgICQoJyNtaC1tYXNrLWRlZmF1bHQnKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsICFjaGVja2VkKTtcbiAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25TYXZlRmFpbGVkJykpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmbXRDb3VudGRvd24oc2Vjb25kcykge1xuICAgICAgICB2YXIgdG90YWwgPSBNYXRoLm1heCgwLCBwYXJzZUludChzZWNvbmRzLCAxMCkgfHwgMCk7XG4gICAgICAgIHJldHVybiBNYXRoLmZsb29yKHRvdGFsIC8gNjApICsgJzonICsgcGFkKHRvdGFsICUgNjApO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gbm90aWZpY2F0aW9uczogcnVsZXMgQVBJICYgbGlzdCAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBsb2FkUnVsZXMoc2lsZW50KSB7XG4gICAgICAgIGlmICghc2lsZW50KSB7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlc0xvYWRlZCA9IGZhbHNlO1xuICAgICAgICAgICAgcmVuZGVyUnVsZXNTa2VsZXRvbigpO1xuICAgICAgICB9XG4gICAgICAgIGFwaUdldCgnL3J1bGVzJywgeyBsaW1pdDogMjAwIH0sIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlcyA9IGRhdGEuaXRlbXMgfHwgW107XG4gICAgICAgICAgICBzdGF0ZS5ydWxlc0xvYWRlZCA9IHRydWU7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlc0Vycm9yID0gbnVsbDtcbiAgICAgICAgICAgIHJlbmRlclJ1bGVzKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlc0xvYWRlZCA9IHRydWU7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlc0Vycm9yID0gZmFpbHVyZTtcbiAgICAgICAgICAgIHJlbmRlclJ1bGVzKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlclJ1bGVzU2tlbGV0b24oKSB7XG4gICAgICAgIHZhciByb3cgPSAnPGRpdiBjbGFzcz1cIm1oLW5vdGlmLXJvd1wiPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6MzZweDtoZWlnaHQ6MjBweDtib3JkZXItcmFkaXVzOjEwcHhcIj48L3NwYW4+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1za2VsXCIgc3R5bGU9XCJ3aWR0aDo0MCVcIj48L3NwYW4+PHNwYW4+PC9zcGFuPjxzcGFuPjwvc3Bhbj48L2Rpdj4nO1xuICAgICAgICAkKCcjbWgtcnVsZXMtbGlzdCcpLmh0bWwocm93ICsgcm93KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzb3VyY2VGb3JSdWxlKHJ1bGUpIHtcbiAgICAgICAgaWYgKHJ1bGUuc291cmNlX2lkKSB7XG4gICAgICAgICAgICB2YXIgYnlJZCA9IHNvdXJjZUJ5SWQocnVsZS5zb3VyY2VfaWQpO1xuICAgICAgICAgICAgaWYgKGJ5SWQpIHsgcmV0dXJuIGJ5SWQ7IH1cbiAgICAgICAgfVxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLnNvdXJjZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciB0eXBlcyA9IHN0YXRlLnNvdXJjZXNbaV0uZXZlbnRfdHlwZXMgfHwgW107XG4gICAgICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IHR5cGVzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICAgICAgaWYgKHJ1bGUuZXZlbnRfdHlwZXMgJiYgcnVsZS5ldmVudF90eXBlcy5pbmRleE9mKHR5cGVzW2pdLnR5cGUpID49IDApIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHN0YXRlLnNvdXJjZXNbaV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNldFJ1bGVBZGRWaXNpYmxlKHZpc2libGUpIHtcbiAgICAgICAgJCgnI21oLXJ1bGUtYWRkJykuYXR0cignaGlkZGVuJywgdmlzaWJsZSA/IG51bGwgOiB0cnVlKTtcbiAgICB9XG5cbiAgICAvLyBEZXNpZ24gdjMsIMKr0KPQstC10LTQvtC80LvQtdC90LjRj8K7OiBubyBib3Qg4oaSIHBpY2sgYSBtZXNzZW5nZXI7IGJvdCBidXQgbm8gbm90aWZpY2F0aW9ucyDihpIgb25lIHByaW1hcnkgYnV0dG9uO1xuICAgIC8vIG90aGVyd2lzZSB0aGUgbGlzdCBncm91cGVkINCX0LLQvtC90LrQuCDihpIg0JjQmCDQodGD0L/QtdGA0LLQsNC50LfQtdGAIOKGkiDQk9C+0LvQvtGB0L7QstC+0Lkg0LDQs9C10L3RgiDihpIg0KHQstGP0LfRjCDQuCDQkNCi0KEgKGhlYWRpbmdzIG9ubHkgZm9yIDIrIGdyb3VwcykuXG4gICAgZnVuY3Rpb24gcmVuZGVyUnVsZXMoKSB7XG4gICAgICAgIHZhciAkbGlzdCA9ICQoJyNtaC1ydWxlcy1saXN0Jyk7XG4gICAgICAgIGlmICghc3RhdGUucnVsZXNMb2FkZWQgfHwgIXN0YXRlLmJvdHNMb2FkZWQpIHtcbiAgICAgICAgICAgIHNldFJ1bGVBZGRWaXNpYmxlKGZhbHNlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc3RhdGUucnVsZXNFcnJvciAhPT0gbnVsbCAmJiBzdGF0ZS5ydWxlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHNldFJ1bGVBZGRWaXNpYmxlKGZhbHNlKTtcbiAgICAgICAgICAgICRsaXN0Lmh0bWwoJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlXCIgcm9sZT1cImFsZXJ0XCI+JyArIElDT05fRVJST1JcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtZ3Jvd1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZXNMb2FkRmFpbGVkJykpICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uIG1oLW9uLW1lc3NhZ2VcIiB0eXBlPVwiYnV0dG9uXCIgaWQ9XCJtaC1ydWxlcy1yZXRyeVwiPidcbiAgICAgICAgICAgICAgICArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25SZXRyeScpKSArICc8L2J1dHRvbj48L2Rpdj4nKTtcbiAgICAgICAgICAgICQoJyNtaC1ydWxlcy1yZXRyeScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHsgbG9hZFJ1bGVzKCk7IH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmIChzdGF0ZS5ib3RzLmxlbmd0aCA9PT0gMCAmJiBzdGF0ZS5ydWxlcy5sZW5ndGggPT09IDAgJiYgc3RhdGUuYm90c0Vycm9yID09PSBudWxsKSB7XG4gICAgICAgICAgICBzZXRSdWxlQWRkVmlzaWJsZShmYWxzZSk7XG4gICAgICAgICAgICAkbGlzdC5odG1sKCc8ZGl2IGNsYXNzPVwibWgtb25ib2FyZFwiIHJvbGU9XCJzdGF0dXNcIj4nXG4gICAgICAgICAgICAgICAgKyAnPGgzIGNsYXNzPVwidWkgaGVhZGVyIG1oLXBhZ2UtdGl0bGVcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX09uYm9hcmRUaXRsZScpKSArICc8L2gzPidcbiAgICAgICAgICAgICAgICArIG1lc3NlbmdlclRpbGVzKCkgKyAnPC9kaXY+Jyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN0YXRlLnJ1bGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgc2V0UnVsZUFkZFZpc2libGUoZmFsc2UpO1xuICAgICAgICAgICAgJGxpc3QuaHRtbCgnPGRpdiBjbGFzcz1cIm1oLWVtcHR5IG1oLWVtcHR5LWJveFwiIHJvbGU9XCJzdGF0dXNcIj4nXG4gICAgICAgICAgICAgICAgKyAnPGgzIGNsYXNzPVwidWkgaGVhZGVyIG1oLXBhZ2UtdGl0bGVcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVzRW1wdHlUaXRsZScpKSArICc8L2gzPidcbiAgICAgICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgcHJpbWFyeSBidXR0b25cIiB0eXBlPVwiYnV0dG9uXCIgZGF0YS1hY3Rpb249XCJhZGRcIj4nICsgSUNPTl9QTFVTXG4gICAgICAgICAgICAgICAgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZXNBZGQnKSkgKyAnPC9idXR0b24+PC9kaXY+Jyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgc2V0UnVsZUFkZFZpc2libGUodHJ1ZSk7XG4gICAgICAgIHZhciBncm91cHMgPSB7fTtcbiAgICAgICAgc3RhdGUucnVsZXMuZm9yRWFjaChmdW5jdGlvbiAocnVsZSkge1xuICAgICAgICAgICAgdmFyIGdyb3VwID0gcnVsZS5ncm91cCB8fCAncGJ4JztcbiAgICAgICAgICAgIGlmIChHUk9VUF9PUkRFUi5pbmRleE9mKGdyb3VwKSA8IDApIHsgZ3JvdXAgPSAncGJ4JzsgfVxuICAgICAgICAgICAgKGdyb3Vwc1tncm91cF0gPSBncm91cHNbZ3JvdXBdIHx8IFtdKS5wdXNoKHJ1bGUpO1xuICAgICAgICB9KTtcbiAgICAgICAgdmFyIG9yZGVyID0gR1JPVVBfT1JERVIuZmlsdGVyKGZ1bmN0aW9uIChncm91cCkgeyByZXR1cm4gQm9vbGVhbihncm91cHNbZ3JvdXBdKTsgfSk7XG4gICAgICAgIHZhciBodG1sID0gJyc7XG4gICAgICAgIGlmIChzdGF0ZS5ydWxlc0Vycm9yICE9PSBudWxsKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwidWkgbmVnYXRpdmUgbWVzc2FnZVwiIHJvbGU9XCJhbGVydFwiPicgKyBJQ09OX0VSUk9SXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLWdyb3dcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVzTG9hZEZhaWxlZCcpKSArICc8L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAnPGJ1dHRvbiBjbGFzcz1cInVpIGJhc2ljIGJ1dHRvbiBtaC1vbi1tZXNzYWdlXCIgdHlwZT1cImJ1dHRvblwiIGlkPVwibWgtcnVsZXMtcmV0cnktaW5saW5lXCI+J1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblJldHJ5JykpICsgJzwvYnV0dG9uPjwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHNob3dIZWFkaW5ncyA9IG9yZGVyLmxlbmd0aCA+IDE7XG4gICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJtaC1ub3RpZi1saXN0JyArIChzaG93SGVhZGluZ3MgPyAnJyA6ICcgaXMtZmxhdCcpICsgJ1wiIHJvbGU9XCJsaXN0XCI+JztcbiAgICAgICAgb3JkZXIuZm9yRWFjaChmdW5jdGlvbiAoZ3JvdXApIHtcbiAgICAgICAgICAgIGlmIChzaG93SGVhZGluZ3MpIHtcbiAgICAgICAgICAgICAgICBodG1sICs9ICc8aDMgY2xhc3M9XCJtaC1ncm91cC10aXRsZVwiPicgKyBlc2Moc291cmNlR3JvdXBOYW1lKGdyb3VwKSkgKyAnPC9oMz4nO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZ3JvdXBzW2dyb3VwXS5mb3JFYWNoKGZ1bmN0aW9uIChydWxlKSB7XG4gICAgICAgICAgICAgICAgaHRtbCArPSByZW5kZXJSdWxlUm93KHJ1bGUpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkbGlzdC5odG1sKGh0bWwgKyAnPC9kaXY+Jyk7XG4gICAgICAgICQoJyNtaC1ydWxlcy1yZXRyeS1pbmxpbmUnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IGxvYWRSdWxlcygpOyB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBydWxlQ2hhbm5lbChydWxlKSB7XG4gICAgICAgIHZhciBjaGF0cyA9IHJ1bGUuY2hhdHMgfHwgW107XG4gICAgICAgIGlmIChjaGF0cy5sZW5ndGggPiAwICYmIGNoYXRzWzBdLmNoYW5uZWwpIHtcbiAgICAgICAgICAgIHJldHVybiBjaGF0c1swXS5jaGFubmVsO1xuICAgICAgICB9XG4gICAgICAgIHZhciBib3QgPSBjaGF0cy5sZW5ndGggPiAwID8gYm90QnlJZChjaGF0c1swXS5ib3RfaWQpIDogKHN0YXRlLmJvdHNbMF0gfHwgbnVsbCk7XG4gICAgICAgIHJldHVybiBib3QgJiYgYm90LmNoYW5uZWwgPT09ICdtYXgnID8gJ21heCcgOiAndGVsZWdyYW0nO1xuICAgIH1cblxuICAgIC8vIENvbG91ciBvbmx5IGZvciBhIHByb2JsZW06IHVuYXZhaWxhYmxlIHNvdXJjZSwgcmVqZWN0ZWQgdG9rZW4sIGRlbGV0ZWQgYm90IG9yIGNoYXQuXG4gICAgZnVuY3Rpb24gcnVsZVByb2JsZW1MYWJlbChydWxlKSB7XG4gICAgICAgIHZhciBzb3VyY2UgPSBzb3VyY2VCeUlkKHJ1bGUuc291cmNlX2lkKTtcbiAgICAgICAgaWYgKHNvdXJjZSAmJiBzb3VyY2UuYXZhaWxhYmlsaXR5ICYmIHNvdXJjZS5hdmFpbGFiaWxpdHkgIT09ICdhdmFpbGFibGUnKSB7XG4gICAgICAgICAgICB2YXIgbGFiZWxzID0ge1xuICAgICAgICAgICAgICAgIG1vZHVsZV9kaXNhYmxlZDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU291cmNlU3RhdGVNb2RvZmYnKSxcbiAgICAgICAgICAgICAgICBtb2R1bGVfbWlzc2luZzogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU291cmNlU3RhdGVOb2luc3QnKSxcbiAgICAgICAgICAgICAgICBhcGlfZm9yYmlkZGVuOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Ob3RpZlNvdXJjZU5vQWNjZXNzJyksXG4gICAgICAgICAgICAgICAgYXBpX2luY29tcGF0aWJsZTogc291cmNlU3RhdGVUZXh0KHNvdXJjZSksXG4gICAgICAgICAgICAgICAgZGlzYWJsZWQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NvdXJjZVN0YXRlT2ZmJyksXG4gICAgICAgICAgICAgICAgZXJyb3I6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NvdXJjZVN0YXRlRXJyJylcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBpZiAobGFiZWxzW3NvdXJjZS5hdmFpbGFiaWxpdHldKSB7XG4gICAgICAgICAgICAgICAgdmFyIGNscyA9IChzb3VyY2UuYXZhaWxhYmlsaXR5ID09PSAnbW9kdWxlX2Rpc2FibGVkJyB8fCBzb3VyY2UuYXZhaWxhYmlsaXR5ID09PSAnZGlzYWJsZWQnIHx8IHNvdXJjZS5hdmFpbGFiaWxpdHkgPT09ICdhcGlfaW5jb21wYXRpYmxlJykgPyAndWkgeWVsbG93IGxhYmVsJyA6ICd1aSByZWQgbGFiZWwnO1xuICAgICAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCInICsgY2xzICsgJ1wiPicgKyBlc2MobGFiZWxzW3NvdXJjZS5hdmFpbGFiaWxpdHldKSArICc8L3NwYW4+JztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB2YXIgY2hhdHMgPSBydWxlLmNoYXRzIHx8IFtdO1xuICAgICAgICBpZiAoKHJ1bGUuY2hhdF9pZHMgfHwgW10pLmxlbmd0aCA+IGNoYXRzLmxlbmd0aCkge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cInVpIHJlZCBsYWJlbFwiPicgKyBJQ09OX0VSUk9SICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5Qm90RGVsZXRlZCcpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNoYXRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgYm90ID0gYm90QnlJZChjaGF0c1tpXS5ib3RfaWQpO1xuICAgICAgICAgICAgaWYgKGJvdCAmJiBib3QuZW5hYmxlZCAhPT0gZmFsc2UgJiYgYm90LnN0YXR1cyA9PT0gJ3Rva2VuX2ludmFsaWQnKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cInVpIHJlZCBsYWJlbFwiPicgKyBJQ09OX0VSUk9SICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c1Rva2VuSW52YWxpZCcpKSArICc8L3NwYW4+JztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoY2hhdHMubGVuZ3RoID4gMCAmJiBjaGF0cy5ldmVyeShmdW5jdGlvbiAoY2hhdCkgeyByZXR1cm4gY2hhdC5zdGF0ZSA9PT0gJ2dvbmUnOyB9KSkge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cInVpIHJlZCBsYWJlbFwiPicgKyBJQ09OX0VSUk9SICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRTdGF0dXNHb25lJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlclJ1bGVSb3cocnVsZSkge1xuICAgICAgICB2YXIgcHJvYmxlbSA9IHJ1bGVQcm9ibGVtTGFiZWwocnVsZSk7XG4gICAgICAgIHZhciBydWxlRmlyc3QgPSBzdGF0ZS5ydWxlcy5sZW5ndGggPiAwICYmIE51bWJlcihzdGF0ZS5ydWxlc1swXS5pZCkgPT09IE51bWJlcihydWxlLmlkKTtcbiAgICAgICAgdmFyIHJ1bGVMYXN0ID0gc3RhdGUucnVsZXMubGVuZ3RoID4gMFxuICAgICAgICAgICAgJiYgTnVtYmVyKHN0YXRlLnJ1bGVzW3N0YXRlLnJ1bGVzLmxlbmd0aCAtIDFdLmlkKSA9PT0gTnVtYmVyKHJ1bGUuaWQpO1xuICAgICAgICB2YXIgcmlnaHQgPSAnJztcbiAgICAgICAgaWYgKHByb2JsZW0gIT09IG51bGwpIHtcbiAgICAgICAgICAgIHJpZ2h0ID0gcHJvYmxlbTtcbiAgICAgICAgfSBlbHNlIGlmIChydWxlLmVuYWJsZWQgJiYgcnVsZS5sYXN0X2V2ZW50X2F0KSB7XG4gICAgICAgICAgICByaWdodCA9ICc8c3BhbiBjbGFzcz1cIm1oLW11dGVkXCI+JyArIGZtdENlbGxUaW1lKHJ1bGUubGFzdF9ldmVudF9hdCkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGNoYW5uZWwgPSBydWxlQ2hhbm5lbChydWxlKTtcblxuICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJtaC1ub3RpZi1yb3cnICsgKHJ1bGUuZW5hYmxlZCA/ICcnIDogJyBpcy1vZmYnKSArICdcIiByb2xlPVwibGlzdGl0ZW1cIiBkYXRhLXJ1bGUtaWQ9XCInICsgcnVsZS5pZCArICdcIj4nXG4gICAgICAgICAgICArICc8bGFiZWwgY2xhc3M9XCJ1aSB0b2dnbGUgY2hlY2tib3gnICsgKHJ1bGUuZW5hYmxlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAnXCIgYXJpYS1sYWJlbD1cIicgKyBlc2MocnVsZS50aXRsZSkgKyAnXCI+J1xuICAgICAgICAgICAgKyAnPGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGNsYXNzPVwiaGlkZGVuIG1oLXJ1bGUtdG9nZ2xlXCInICsgKHJ1bGUuZW5hYmxlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAnPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtdHJhY2tcIj48L3NwYW4+PC9sYWJlbD4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW5vdGlmLW1haW5cIj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1lc3NlbmdlciBzICcgKyAoY2hhbm5lbCA9PT0gJ21heCcgPyAnbWF4JyA6ICd0ZycpICsgJ1wiIHJvbGU9XCJpbWdcIiBhcmlhLWxhYmVsPVwiJyArIChjaGFubmVsID09PSAnbWF4JyA/ICdNQVgnIDogJ1RlbGVncmFtJykgKyAnXCI+J1xuICAgICAgICAgICAgKyAoY2hhbm5lbCA9PT0gJ21heCcgPyAnTUFYJyA6ICdURycpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICArICc8YSBocmVmPVwiI1wiIGNsYXNzPVwibWgtbm90aWYtdGl0bGUgbWgtdHJ1bmNhdGVcIiBkYXRhLWFjdGlvbj1cImVkaXRcIj4nICsgZXNjKHJ1bGUudGl0bGUpICsgJzwvYT48L3NwYW4+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1ub3RpZi1zdGF0dXNcIj4nICsgcmlnaHQgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ydWxlLW1lbnUtd3JhcFwiPidcbiAgICAgICAgICAgICsgJzxidXR0b24gY2xhc3M9XCJ1aSB0ZXh0IGJ1dHRvbiBtaC1ydWxlLW1lbnUtYnRuXCIgdHlwZT1cImJ1dHRvblwiIGRhdGEtYWN0aW9uPVwibWVudVwiIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVNZW51TW9yZScpKSArICdcIiBhcmlhLWV4cGFuZGVkPVwiZmFsc2VcIj4nXG4gICAgICAgICAgICArICc8c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBhcmlhLWhpZGRlbj1cInRydWVcIj48cGF0aCBkPVwiTTMuNSA4aC4wMU04IDhoLjAxTTEyLjUgOGguMDFcIiBzdHJva2Utd2lkdGg9XCIyLjRcIi8+PC9zdmc+PC9idXR0b24+J1xuICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLXJ1bGUtbWVudVwiIGhpZGRlbj4nXG4gICAgICAgICAgICArICc8YSBocmVmPVwiI1wiIGRhdGEtYWN0aW9uPVwiZWRpdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZU1lbnVFZGl0JykpICsgJzwvYT4nXG4gICAgICAgICAgICArIChydWxlRmlyc3QgPyAnJyA6ICc8YSBocmVmPVwiI1wiIGRhdGEtYWN0aW9uPVwidXBcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVNZW51VXAnKSkgKyAnPC9hPicpXG4gICAgICAgICAgICArIChydWxlTGFzdCA/ICcnIDogJzxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJkb3duXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlTWVudURvd24nKSkgKyAnPC9hPicpXG4gICAgICAgICAgICArICc8YSBocmVmPVwiI1wiIGRhdGEtYWN0aW9uPVwiZGVsZXRlXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlTWVudURlbGV0ZScpKSArICc8L2E+J1xuICAgICAgICAgICAgKyAnPC9kaXY+PC9kaXY+PC9kaXY+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBiaW5kUnVsZXNDb250YWluZXIoKSB7XG4gICAgICAgIHZhciAkd3JhcCA9ICQoJyNtaC1ydWxlcy1saXN0Jyk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJhZGRcIl0nLCBmdW5jdGlvbiAoKSB7IG9wZW5SdWxlV2l6YXJkKG51bGwpOyB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImFkZC1ib3RcIl0nLCBmdW5jdGlvbiAoKSB7IG9wZW5Cb3RNb2RhbCgnYWRkJywgbnVsbCwgJCh0aGlzKS5kYXRhKCdjaGFubmVsJykpOyB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImVkaXRcIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBvcGVuUnVsZVdpemFyZChydWxlQnlJZCgkKHRoaXMpLmNsb3Nlc3QoJy5taC1ub3RpZi1yb3cnKS5kYXRhKCdydWxlLWlkJykpKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJtZW51XCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICAgIHZhciAkbWVudSA9ICQodGhpcykuc2libGluZ3MoJy5taC1ydWxlLW1lbnUnKTtcbiAgICAgICAgICAgICQoJy5taC1ydWxlLW1lbnUnKS5ub3QoJG1lbnUpLnByb3AoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJG1lbnUucHJvcCgnaGlkZGVuJywgISRtZW51LnByb3AoJ2hpZGRlbicpKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJkZWxldGVcIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBjb25maXJtRGVsZXRlUnVsZShydWxlQnlJZCgkKHRoaXMpLmNsb3Nlc3QoJy5taC1ub3RpZi1yb3cnKS5kYXRhKCdydWxlLWlkJykpKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJ1cFwiXSwgW2RhdGEtYWN0aW9uPVwiZG93blwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIG1vdmVSdWxlKFxuICAgICAgICAgICAgICAgICQodGhpcykuY2xvc2VzdCgnLm1oLW5vdGlmLXJvdycpLmRhdGEoJ3J1bGUtaWQnKSxcbiAgICAgICAgICAgICAgICAkKHRoaXMpLmRhdGEoJ2FjdGlvbicpID09PSAndXAnID8gLTEgOiAxXG4gICAgICAgICAgICApO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NoYW5nZScsICcubWgtcnVsZS10b2dnbGUnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgaWQgPSAkKHRoaXMpLmNsb3Nlc3QoJy5taC1ub3RpZi1yb3cnKS5kYXRhKCdydWxlLWlkJyk7XG4gICAgICAgICAgICB2YXIgZW5hYmxlZCA9ICQodGhpcykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICAgICAgYXBpUGF0Y2goJy9ydWxlcy8nICsgaWQsIHsgZW5hYmxlZDogZW5hYmxlZCB9LCBmdW5jdGlvbiAocnVsZSkge1xuICAgICAgICAgICAgICAgIHJlcGxhY2VSdWxlKHJ1bGUpO1xuICAgICAgICAgICAgICAgIHJlbmRlclJ1bGVzKCk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgICAgIGxvYWRSdWxlcyh0cnVlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QoZmFpbHVyZVRleHQoZmFpbHVyZSkpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKGRvY3VtZW50KS5vbignY2xpY2snLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGlmICgkKGV2ZW50LnRhcmdldCkuY2xvc2VzdCgnLm1oLXJ1bGUtbWVudS13cmFwJykubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgJCgnLm1oLXJ1bGUtbWVudScpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBsb2FkUHJvdmlkZXJzKGRvbmUpIHtcbiAgICAgICAgaWYgKHN0YXRlLnByb3ZpZGVyc0xvYWRlZCkge1xuICAgICAgICAgICAgZG9uZSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvcmVHZXQoJy9wcm92aWRlcnMnLCB7IGxpbWl0OiAyMDAgfSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHZhciBpdGVtcyA9IGRhdGEuaXRlbXMgfHwgW107XG4gICAgICAgICAgICB2YXIgbGlzdCA9IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIHZhciBwcm92aWRlciA9IGl0ZW1zW2ldO1xuICAgICAgICAgICAgICAgIHZhciBpZCA9IFN0cmluZyhwcm92aWRlci5pZCAhPT0gdW5kZWZpbmVkID8gcHJvdmlkZXIuaWQgOiAocHJvdmlkZXIucHJvdmlkZXJfaWQgfHwgJycpKTtcbiAgICAgICAgICAgICAgICBpZiAoaWQgPT09ICcnKSB7IGNvbnRpbnVlOyB9XG4gICAgICAgICAgICAgICAgdmFyIGxhYmVsID0gcHJvdmlkZXIuZGVzY3JpcHRpb24gfHwgcHJvdmlkZXIudXNlcm5hbWUgfHwgKCcjJyArIGlkKTtcbiAgICAgICAgICAgICAgICBsaXN0LnB1c2goeyBpZDogaWQsIGxhYmVsOiBsYWJlbCB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHN0YXRlLnByb3ZpZGVycyA9IGxpc3Q7XG4gICAgICAgICAgICBzdGF0ZS5wcm92aWRlcnNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5wcm92aWRlcnNMb2FkZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbW92ZVJ1bGUoaWQsIGRlbHRhKSB7XG4gICAgICAgIHZhciBpZHMgPSBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5ydWxlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWRzLnB1c2goTnVtYmVyKHN0YXRlLnJ1bGVzW2ldLmlkKSk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGluZGV4ID0gaWRzLmluZGV4T2YoTnVtYmVyKGlkKSk7XG4gICAgICAgIHZhciB0YXJnZXQgPSBpbmRleCArIGRlbHRhO1xuICAgICAgICBpZiAoaW5kZXggPCAwIHx8IHRhcmdldCA8IDAgfHwgdGFyZ2V0ID49IGlkcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB2YXIgc3dhcCA9IGlkc1tpbmRleF07XG4gICAgICAgIGlkc1tpbmRleF0gPSBpZHNbdGFyZ2V0XTtcbiAgICAgICAgaWRzW3RhcmdldF0gPSBzd2FwO1xuICAgICAgICBhcGlQb3N0KCcvcnVsZXM6Y2hhbmdlUHJpb3JpdHknLCB7IG9yZGVyOiBpZHMgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgbG9hZFJ1bGVzKHRydWUpO1xuICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVPcmRlclNhdmVkJykpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgc2hvd1RvYXN0KGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcnVsZUJ5SWQoaWQpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5ydWxlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKE51bWJlcihzdGF0ZS5ydWxlc1tpXS5pZCkgPT09IE51bWJlcihpZCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc3RhdGUucnVsZXNbaV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVwbGFjZVJ1bGUocnVsZSkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLnJ1bGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAoTnVtYmVyKHN0YXRlLnJ1bGVzW2ldLmlkKSA9PT0gTnVtYmVyKHJ1bGUuaWQpKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUucnVsZXNbaV0gPSBydWxlO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBzdGF0ZS5ydWxlcy5wdXNoKHJ1bGUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNvbmZpcm1EZWxldGVSdWxlKHJ1bGUpIHtcbiAgICAgICAgaWYgKCFydWxlKSB7IHJldHVybjsgfVxuICAgICAgICAkKCcjbWgtY29uZmlybS10ZXh0JykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZURlbGV0ZUNvbmZpcm0nLCB7IHRpdGxlOiBydWxlLnRpdGxlIH0pKTtcbiAgICAgICAgJCgnI21oLWNvbmZpcm0tbW9kYWwnKS5tb2RhbCh7IGNsb3NhYmxlOiB0cnVlIH0pLm1vZGFsKCdzaG93Jyk7XG4gICAgICAgICQoJyNtaC1jb25maXJtLW9rJykub2ZmKCdjbGljaycpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgICAgIGFwaURlbGV0ZSgnL3J1bGVzLycgKyBydWxlLmlkLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgbG9hZFJ1bGVzKHRydWUpO1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25EZWxldGVkJykpO1xuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QoZmFpbHVyZVRleHQoZmFpbHVyZSkpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gbm90aWZpY2F0aW9uczogd2l6YXJkIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGVtcHR5RmlsdGVycygpIHtcbiAgICAgICAgcmV0dXJuIHsgdXNlcl9pZHM6IFtdLCBkaXJlY3Rpb25zOiBbXSwgcHJvdmlkZXJzOiBbXSwgcXVhbGl0eV9zY29yZTogbnVsbCwgcmVhc29uczogbnVsbCB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG5vcm1hbGl6ZVJldHJhY3Qob3B0aW9ucykge1xuICAgICAgICB2YXIgY29uZmlnID0gb3B0aW9ucyAmJiBvcHRpb25zLnJldHJhY3Rfb25fY2FsbGJhY2sgJiYgdHlwZW9mIG9wdGlvbnMucmV0cmFjdF9vbl9jYWxsYmFjayA9PT0gJ29iamVjdCdcbiAgICAgICAgICAgID8gb3B0aW9ucy5yZXRyYWN0X29uX2NhbGxiYWNrXG4gICAgICAgICAgICA6IHt9O1xuICAgICAgICB2YXIgd2luZG93ID0gTnVtYmVyKGNvbmZpZy53aW5kb3dfbWluKTtcbiAgICAgICAgaWYgKCF3aW5kb3cgfHwgd2luZG93IDwgNSB8fCB3aW5kb3cgPiAxMjApIHtcbiAgICAgICAgICAgIHdpbmRvdyA9IDIwO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBlbmFibGVkOiBjb25maWcuZW5hYmxlZCA9PT0gdHJ1ZSxcbiAgICAgICAgICAgIHdpbmRvd19taW46IHdpbmRvdyxcbiAgICAgICAgICAgIGNvdW50X2luY29taW5nX2Fuc3dlcmVkOiBjb25maWcuY291bnRfaW5jb21pbmdfYW5zd2VyZWQgIT09IGZhbHNlXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbm9ybWFsaXplRmlsdGVycyhmaWx0ZXJzKSB7XG4gICAgICAgIHZhciByZXN1bHQgPSBlbXB0eUZpbHRlcnMoKTtcbiAgICAgICAgaWYgKCFmaWx0ZXJzIHx8IHR5cGVvZiBmaWx0ZXJzICE9PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaWx0ZXJzLnVzZXJfaWRzKSkge1xuICAgICAgICAgICAgcmVzdWx0LnVzZXJfaWRzID0gZmlsdGVycy51c2VyX2lkcy5tYXAoTnVtYmVyKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaWx0ZXJzLmRpcmVjdGlvbnMpKSB7XG4gICAgICAgICAgICByZXN1bHQuZGlyZWN0aW9ucyA9IGZpbHRlcnMuZGlyZWN0aW9ucy5zbGljZSgpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZpbHRlcnMucHJvdmlkZXJzKSkge1xuICAgICAgICAgICAgcmVzdWx0LnByb3ZpZGVycyA9IGZpbHRlcnMucHJvdmlkZXJzLm1hcChTdHJpbmcpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZpbHRlcnMucmVhc29ucykpIHtcbiAgICAgICAgICAgIHJlc3VsdC5yZWFzb25zID0gZmlsdGVycy5yZWFzb25zLm1hcChTdHJpbmcpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChmaWx0ZXJzLnF1YWxpdHlfc2NvcmUgJiYgdHlwZW9mIGZpbHRlcnMucXVhbGl0eV9zY29yZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHJlc3VsdC5xdWFsaXR5X3Njb3JlID0ge307XG4gICAgICAgICAgICBpZiAoZmlsdGVycy5xdWFsaXR5X3Njb3JlLm1pbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0LnF1YWxpdHlfc2NvcmUubWluID0gTnVtYmVyKGZpbHRlcnMucXVhbGl0eV9zY29yZS5taW4pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGZpbHRlcnMucXVhbGl0eV9zY29yZS5tYXggIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHJlc3VsdC5xdWFsaXR5X3Njb3JlLm1heCA9IE51bWJlcihmaWx0ZXJzLnF1YWxpdHlfc2NvcmUubWF4KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIC8vIEF1ZGlvIGF0dGFjaG1lbnQgbW9kZSBvZiBhIHJ1bGUgKFBsYW4vMDUpLiBUaGUgc3RhZ2UtMiBib29sZWFuIGlzIG5vdCBhIG1vZGUgYW5kIHJlYWRzIGFzIFwibm9uZVwiLlxuICAgIGZ1bmN0aW9uIG5vcm1hbGl6ZUF0dGFjaG1lbnRzKG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gb3B0aW9ucyA/IG9wdGlvbnMuYXR0YWNobWVudHMgOiBudWxsO1xuICAgICAgICByZXR1cm4gdmFsdWUgPT09ICdmcmFnbWVudHMnIHx8IHZhbHVlID09PSAncmVjb3JkaW5nJyA/IHZhbHVlIDogJ25vbmUnO1xuICAgIH1cblxuICAgIC8vIE1vZGVzIG9mZmVyZWQgZm9yIHRoZSBzZWxlY3RlZCBldmVudCB0eXBlczogb25seSBldmVudHMgdGhhdCBjYW4gY2FycnkgYXVkaW8uXG4gICAgZnVuY3Rpb24gd2l6YXJkQXR0YWNobWVudE1vZGVzKHR5cGVzKSB7XG4gICAgICAgIGlmICh0eXBlcy5pbmRleE9mKCdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJykgPj0gMCkgeyByZXR1cm4gWydub25lJywgJ2ZyYWdtZW50cycsICdyZWNvcmRpbmcnXTsgfVxuICAgICAgICBpZiAodHlwZXMuaW5kZXhPZignY29yZS52b2ljZW1haWwnKSA+PSAwKSB7IHJldHVybiBbJ25vbmUnLCAncmVjb3JkaW5nJ107IH1cbiAgICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGVuc3VyZVdpemFyZERhdGEoKSB7XG4gICAgICAgIGxvYWRFbXBsb3llZXMoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHN0YXRlLnJ1bGVXaXphcmQgJiYgc3RhdGUucnVsZVdpemFyZC5zdGVwID09PSAyKSB7IHJlbmRlcldpemFyZENvbmRpdGlvbnMoKTsgfVxuICAgICAgICB9KTtcbiAgICAgICAgbG9hZFByb3ZpZGVycyhmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoc3RhdGUucnVsZVdpemFyZCAmJiBzdGF0ZS5ydWxlV2l6YXJkLnN0ZXAgPT09IDIpIHsgcmVuZGVyV2l6YXJkQ29uZGl0aW9ucygpOyB9XG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoIXN0YXRlLmJvdHNMb2FkZWQpIHtcbiAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gb3BlblJ1bGVXaXphcmQocnVsZSkge1xuICAgICAgICBlbnN1cmVXaXphcmREYXRhKCk7XG4gICAgICAgIHZhciBzb3VyY2UgPSBydWxlID8gc291cmNlRm9yUnVsZShydWxlKSA6IG51bGw7XG4gICAgICAgIHZhciBydWxlVHlwZXMgPSBydWxlID8gKHJ1bGUuZXZlbnRfdHlwZXMgfHwgW10pLnNsaWNlKCkgOiBbXTtcbiAgICAgICAgc3RhdGUucnVsZVdpemFyZCA9IHtcbiAgICAgICAgICAgIHN0ZXA6IHJ1bGUgPyBmaXJzdFN0ZXBBZnRlclNjZW5hcmlvKChydWxlLmV2ZW50X3R5cGVzIHx8IFtdKS5zbGljZSgpKSA6IDEsXG4gICAgICAgICAgICBlZGl0SWQ6IHJ1bGUgPyBOdW1iZXIocnVsZS5pZCkgOiAwLFxuICAgICAgICAgICAgc291cmNlSWQ6IHNvdXJjZSA/IHNvdXJjZS5pZCA6ICcnLFxuICAgICAgICAgICAgZXZlbnRUeXBlczogcnVsZVR5cGVzLFxuICAgICAgICAgICAgdGl0bGU6IHJ1bGUgPyBydWxlLnRpdGxlIDogJycsXG4gICAgICAgICAgICBmaWx0ZXJzOiBub3JtYWxpemVGaWx0ZXJzKHJ1bGUgPyBydWxlLmZpbHRlcnMgOiBudWxsKSxcbiAgICAgICAgICAgIHJlY292ZXI6IHJ1bGUgPyB3aXphcmRIYXNSZWNvdmVyeShydWxlVHlwZXMpIDogdHJ1ZSxcbiAgICAgICAgICAgIG1pblNldmVyaXR5OiBydWxlICYmIHJ1bGUubWluX3NldmVyaXR5ID09PSAnY3JpdGljYWwnID8gJ2NyaXRpY2FsJyA6ICd3YXJuaW5nJyxcbiAgICAgICAgICAgIHRhcmdldE1vZGU6IHJ1bGUgPyBydWxlLnRhcmdldF9tb2RlIDogJ2VtcGxveWVlX29yX3JlY2lwaWVudHMnLFxuICAgICAgICAgICAgY2hhdElkczogcnVsZVxuICAgICAgICAgICAgICAgID8gKHJ1bGUuY2hhdF9pZHMgfHwgW10pLm1hcChOdW1iZXIpLmZpbHRlcihmdW5jdGlvbiAoaWQpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIChydWxlLmNoYXRzIHx8IFtdKS5zb21lKGZ1bmN0aW9uIChjaGF0KSB7IHJldHVybiBOdW1iZXIoY2hhdC5pZCkgPT09IGlkOyB9KTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIDogW10sXG4gICAgICAgICAgICBtYXNrOiBydWxlID8gISEocnVsZS5vcHRpb25zICYmIHJ1bGUub3B0aW9ucy5tYXNrX3Bob25lID09PSB0cnVlKVxuICAgICAgICAgICAgICAgIDogISEoc3RhdGUuc2V0dGluZ3MgJiYgc3RhdGUuc2V0dGluZ3MubWFza19waG9uZV9kZWZhdWx0ID09PSB0cnVlKSxcbiAgICAgICAgICAgIHJldHJhY3Q6IG5vcm1hbGl6ZVJldHJhY3QocnVsZSA/IHJ1bGUub3B0aW9ucyA6IG51bGwpLFxuICAgICAgICAgICAgYXR0YWNobWVudHM6IG5vcm1hbGl6ZUF0dGFjaG1lbnRzKHJ1bGUgPyBydWxlLm9wdGlvbnMgOiBudWxsKSxcbiAgICAgICAgICAgIGJvdElkOiBydWxlICYmIHJ1bGUuY2hhdHMgJiYgcnVsZS5jaGF0cy5sZW5ndGggPiAwID8gTnVtYmVyKHJ1bGUuY2hhdHNbMF0uYm90X2lkKSA6IDAsXG4gICAgICAgICAgICBlcnJvcjogJydcbiAgICAgICAgfTtcbiAgICAgICAgdmFyIG9wZW5lZCA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmIChydWxlICYmIHdpemFyZFN1cHBvcnRzUmVhc29ucyhvcGVuZWQuZXZlbnRUeXBlcykgJiYgb3BlbmVkLmZpbHRlcnMucmVhc29ucyA9PT0gbnVsbCkge1xuICAgICAgICAgICAgb3BlbmVkLmZpbHRlcnMucmVhc29ucyA9IGNsb3VkQWlSZWFzb25zKHRydWUpOyAvLyBubyBmaWx0ZXIgPSBldmVyeSByZWFzb24sIGluY2x1ZGluZyBhIG1hbnVhbCBwYXVzZVxuICAgICAgICB9XG4gICAgICAgICQoJyNtaC1ydWxlcy12aWV3JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC13aXphcmQnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgJCgnI21lc3Nlbmdlci1odWItcm9vdCcpLmFkZENsYXNzKCdtaC13aXphcmQtb3BlbicpO1xuICAgICAgICBjbGVhcldpemFyZEVycm9yKCk7XG4gICAgICAgIHJlbmRlcldpemFyZCgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNsb3NlUnVsZVdpemFyZCgpIHtcbiAgICAgICAgJCgnI21oLXdpemFyZC1wcmV2aWV3LCAjbWgtd2l6YXJkLXByZXZpZXctdGFyZ2V0JykuZW1wdHkoKTtcbiAgICAgICAgc3RhdGUucnVsZVdpemFyZCA9IG51bGw7XG4gICAgICAgICQoJyNtaC13aXphcmQnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgJCgnI21oLXJ1bGVzLXZpZXcnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgJCgnI21lc3Nlbmdlci1odWItcm9vdCcpLnJlbW92ZUNsYXNzKCdtaC13aXphcmQtb3BlbicpO1xuICAgICAgICByZW5kZXJSdWxlcygpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHdpemFyZFNjZW5hcmlvKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIHJldHVybiB3ICYmIHcuc291cmNlSWQgPyBzb3VyY2VCeUlkKHcuc291cmNlSWQpIDogbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRTdXBwb3J0c0VtcGxveWVlcyh0eXBlcykge1xuICAgICAgICB2YXIgY2FsbFR5cGVzID0gWydjb3JlLm1pc3NlZF9jYWxsJywgJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0eXBlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKGNhbGxUeXBlcy5pbmRleE9mKHR5cGVzW2ldKSA+PSAwKSB7IHJldHVybiB0cnVlOyB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHdpemFyZFN1cHBvcnRzRGlyZWN0aW9ucyh0eXBlcykge1xuICAgICAgICByZXR1cm4gdHlwZXMuaW5kZXhPZignY29yZS5taXNzZWRfY2FsbCcpID49IDAgfHwgdHlwZXMuaW5kZXhPZignYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCcpID49IDA7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2l6YXJkU3VwcG9ydHNQcm92aWRlcnModHlwZXMpIHtcbiAgICAgICAgcmV0dXJuIHR5cGVzLmluZGV4T2YoJ2NvcmUucHJvdmlkZXJfZG93bicpID49IDAgfHwgdHlwZXMuaW5kZXhPZignY29yZS5wcm92aWRlcl91cCcpID49IDA7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2l6YXJkSGFzUmVjb3ZlcnkodHlwZXMpIHtcbiAgICAgICAgcmV0dXJuIE9iamVjdC5rZXlzKFNUQVRVU19QQUlSUykuc29tZShmdW5jdGlvbiAocHJvYmxlbSkgeyByZXR1cm4gdHlwZXMuaW5kZXhPZihTVEFUVVNfUEFJUlNbcHJvYmxlbV0pID49IDA7IH0pO1xuICAgIH1cblxuICAgIC8vIEEgbW9kdWxlIHN0YXR1cyBzY2VuYXJpbyAocHJvYmxlbSBhbmQvb3IgaXRzIHJlY292ZXJ5KTogc3RlcCAyIG9mZmVycyDCq9Ch0L7QvtCx0YnQsNGC0Ywg0L4g0LLQvtGB0YHRgtCw0L3QvtCy0LvQtdC90LjQuMK7LlxuICAgIGZ1bmN0aW9uIHdpemFyZEhhc1N0YXR1cyh0eXBlcykge1xuICAgICAgICByZXR1cm4gd2l6YXJkSGFzUmVjb3ZlcnkodHlwZXMpIHx8IE9iamVjdC5rZXlzKFNUQVRVU19QQUlSUykuc29tZShmdW5jdGlvbiAocHJvYmxlbSkgeyByZXR1cm4gdHlwZXMuaW5kZXhPZihwcm9ibGVtKSA+PSAwOyB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRTdXBwb3J0c1JlYXNvbnModHlwZXMpIHtcbiAgICAgICAgcmV0dXJuIHR5cGVzLmluZGV4T2YoJ2Nsb3VkX2FpLnBhdXNlZCcpID49IDAgfHwgdHlwZXMuaW5kZXhPZignY2xvdWRfYWkucmVzdW1lZCcpID49IDA7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2l6YXJkU3VwcG9ydHNTZXZlcml0eSh0eXBlcykge1xuICAgICAgICByZXR1cm4gdHlwZXMuaW5kZXhPZignY2xvdWRfc3R0LmluY2lkZW50JykgPj0gMDtcbiAgICB9XG5cbiAgICAvLyBBZGRzIG9yIHJlbW92ZXMgdGhlIHJlY292ZXJ5IHR5cGUgb2YgZXZlcnkgcHJvYmxlbSB0eXBlIGluIHRoZSBsaXN0LlxuICAgIGZ1bmN0aW9uIHdpemFyZFdpdGhSZWNvdmVyeSh0eXBlcywgb24pIHtcbiAgICAgICAgdmFyIHJlY292ZXJpZXMgPSBPYmplY3Qua2V5cyhTVEFUVVNfUEFJUlMpLm1hcChmdW5jdGlvbiAocHJvYmxlbSkgeyByZXR1cm4gU1RBVFVTX1BBSVJTW3Byb2JsZW1dOyB9KTtcbiAgICAgICAgdmFyIHJlc3VsdCA9IHR5cGVzLmZpbHRlcihmdW5jdGlvbiAodHlwZSkgeyByZXR1cm4gcmVjb3Zlcmllcy5pbmRleE9mKHR5cGUpIDwgMDsgfSk7XG4gICAgICAgIGlmIChvbikge1xuICAgICAgICAgICAgcmVzdWx0LnNsaWNlKCkuZm9yRWFjaChmdW5jdGlvbiAodHlwZSkge1xuICAgICAgICAgICAgICAgIGlmIChTVEFUVVNfUEFJUlNbdHlwZV0gJiYgcmVzdWx0LmluZGV4T2YoU1RBVFVTX1BBSVJTW3R5cGVdKSA8IDApIHsgcmVzdWx0LnB1c2goU1RBVFVTX1BBSVJTW3R5cGVdKTsgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICAvLyBTdGVwIDIgZXhpc3RzIG9ubHkgZm9yIHNjZW5hcmlvcyB3aXRoIGNvbmRpdGlvbnM7IHRoZSBvdGhlcnMgZ28gc3RyYWlnaHQgdG8gwqvQmtGD0LTQsCDQvtGC0L/RgNCw0LLQuNGC0YzCuy5cbiAgICBmdW5jdGlvbiB3aXphcmRIYXNDb25kaXRpb25zKHR5cGVzKSB7XG4gICAgICAgIHJldHVybiB3aXphcmRTdXBwb3J0c0VtcGxveWVlcyh0eXBlcykgfHwgd2l6YXJkU3VwcG9ydHNEaXJlY3Rpb25zKHR5cGVzKSB8fCB3aXphcmRTdXBwb3J0c1Byb3ZpZGVycyh0eXBlcylcbiAgICAgICAgICAgIHx8IHdpemFyZEhhc1N0YXR1cyh0eXBlcylcbiAgICAgICAgICAgIHx8IHR5cGVzLmluZGV4T2YoJ2NvcmUubWlzc2VkX2NhbGwnKSA+PSAwIHx8IHR5cGVzLmluZGV4T2YoJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnKSA+PSAwO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZpcnN0U3RlcEFmdGVyU2NlbmFyaW8odHlwZXMpIHtcbiAgICAgICAgcmV0dXJuIHdpemFyZEhhc0NvbmRpdGlvbnModHlwZXMpID8gMiA6IDM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyV2l6YXJkKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgJCgnI21oLXdpemFyZC1zdGVwLTEnKS5hdHRyKCdoaWRkZW4nLCB3LnN0ZXAgIT09IDEpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXN0ZXAtMicpLmF0dHIoJ2hpZGRlbicsIHcuc3RlcCAhPT0gMik7XG4gICAgICAgICQoJyNtaC13aXphcmQtc3RlcC0zJykuYXR0cignaGlkZGVuJywgdy5zdGVwICE9PSAzKTtcbiAgICAgICAgJCgnI21oLXdpemFyZCcpLmF0dHIoJ2RhdGEtc3RlcCcsIFN0cmluZyh3LnN0ZXApKTtcbiAgICAgICAgdmFyIHNjZW5hcmlvID0gd2l6YXJkU2NlbmFyaW8oKTtcbiAgICAgICAgdmFyIHRpdGxlO1xuICAgICAgICBpZiAody5zdGVwID09PSAxKSB7XG4gICAgICAgICAgICB0aXRsZSA9IHcuZWRpdElkID4gMCA/IHcudGl0bGUgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRUaXRsZScpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGl0bGUgPSB3LmVkaXRJZCA+IDAgPyB3LnRpdGxlIDogKHNjZW5hcmlvID8gc2NlbmFyaW8ubmFtZSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFRpdGxlJykpO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC13aXphcmQtdGl0bGUnKS50ZXh0KHRpdGxlKTtcbiAgICAgICAgLy8gb25lIGJhc2ljIGJ1dHRvbiBvbiB0aGUgbGVmdDogwqvQntGC0LzQtdC90LDCuyBvbiB0aGUgZmlyc3Qgc3RlcCwgwqvQndCw0LfQsNC0wrsgYWZ0ZXIgaXRcbiAgICAgICAgdmFyIGNhbkdvQmFjayA9IHcuc3RlcCA+IDEgJiYgISh3LmVkaXRJZCA+IDAgJiYgdy5zdGVwID09PSBmaXJzdFN0ZXBBZnRlclNjZW5hcmlvKHcuZXZlbnRUeXBlcykgJiYgdy5zb3VyY2VJZCA9PT0gJycpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXByZXYnKS50ZXh0KHcuc3RlcCA9PT0gMSA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZENhbmNlbCcpIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkQmFja0J1dHRvbicpKVxuICAgICAgICAgICAgLmRhdGEoJ21vZGUnLCBjYW5Hb0JhY2sgPyAnYmFjaycgOiAnY2FuY2VsJyk7XG4gICAgICAgIHZhciBpc0xhc3QgPSB3LnN0ZXAgPT09IDM7XG4gICAgICAgICQoJyNtaC13aXphcmQtbmV4dCcpLnRleHQoaXNMYXN0XG4gICAgICAgICAgICA/ICh3LmVkaXRJZCA+IDAgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRTYXZlJykgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRDcmVhdGUnKSlcbiAgICAgICAgICAgIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkTmV4dCcpKTtcbiAgICAgICAgaWYgKHcuc3RlcCA9PT0gMSkgeyByZW5kZXJXaXphcmRTY2VuYXJpb3MoKTsgfVxuICAgICAgICBpZiAody5zdGVwID09PSAyKSB7IHJlbmRlcldpemFyZENvbmRpdGlvbnMoKTsgfVxuICAgICAgICBpZiAody5zdGVwID09PSAzKSB7IHJlbmRlcldpemFyZFJlY2lwaWVudHMoKTsgfVxuICAgICAgICB1cGRhdGVXaXphcmROZXh0KCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdXBkYXRlV2l6YXJkTmV4dCgpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgIHZhciBkaXNhYmxlZCA9IHcuc3RlcCA9PT0gMSAmJiB3LnNvdXJjZUlkID09PSAnJztcbiAgICAgICAgaWYgKHcuc3RlcCA9PT0gMykge1xuICAgICAgICAgICAgZGlzYWJsZWQgPSBhY3RpdmVXaXphcmRCb3QoKSA9PT0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtd2l6YXJkLW5leHQnKS5wcm9wKCdkaXNhYmxlZCcsIGRpc2FibGVkKS50b2dnbGVDbGFzcygnZGlzYWJsZWQnLCBkaXNhYmxlZCk7XG4gICAgfVxuXG4gICAgLy8gT25lIGljb24gcGVyIHNjZW5hcmlvIChkZXNpZ24gdjMsIHN0ZXAgMSkuXG4gICAgdmFyIFNDRU5BUklPX0lDT05TID0ge1xuICAgICAgICBwaG9uZTogJzxwYXRoIGQ9XCJNNC41IDIuNWgybDEgMy0xLjUgMWE4IDggMCAwIDAgMy41IDMuNWwxLTEuNSAzIDF2MmExLjUgMS41IDAgMCAxLTEuNSAxLjVBMTAuNSAxMC41IDAgMCAxIDMgNGExLjUgMS41IDAgMCAxIDEuNS0xLjV6XCIvPicsXG4gICAgICAgIG1pYzogJzxyZWN0IHg9XCI2XCIgeT1cIjJcIiB3aWR0aD1cIjRcIiBoZWlnaHQ9XCI3LjVcIiByeD1cIjJcIi8+PHBhdGggZD1cIk0zLjUgOGE0LjUgNC41IDAgMCAwIDkgME04IDEyLjVWMTRcIi8+JyxcbiAgICAgICAgc3BhcmtsZTogJzxwYXRoIGQ9XCJNOCAydjNNOCAxMXYzTTIgOGgzTTExIDhoM00zLjggMy44bDIgMk0xMC4yIDEwLjJsMiAyTTMuOCAxMi4ybDItMk0xMC4yIDUuOGwyLTJcIi8+JyxcbiAgICAgICAgcm9ib3Q6ICc8cmVjdCB4PVwiM1wiIHk9XCI1XCIgd2lkdGg9XCIxMFwiIGhlaWdodD1cIjhcIiByeD1cIjJcIi8+PHBhdGggZD1cIk04IDIuNVY1TTYgOWguMDFNMTAgOWguMDFcIi8+JyxcbiAgICAgICAgc2VydmVyOiAnPHJlY3QgeD1cIjIuNVwiIHk9XCIzXCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjRcIiByeD1cIjFcIi8+PHJlY3QgeD1cIjIuNVwiIHk9XCI5XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjRcIiByeD1cIjFcIi8+PHBhdGggZD1cIk01IDVoLjAxTTUgMTFoLjAxXCIvPicsXG4gICAgICAgIHdhcm5pbmc6ICc8cGF0aCBkPVwiTTggMi41bDYgMTAuNUgyelwiLz48cGF0aCBkPVwiTTggNi41djNNOCAxMS4ydi4xXCIvPicsXG4gICAgICAgIGJvbHQ6ICc8cGF0aCBkPVwiTTkgMS41TDMuNSA5SDhsLTEgNS41TDEyLjUgN0g4elwiLz4nXG4gICAgfTtcbiAgICB2YXIgU0NFTkFSSU9fSUNPTl9CWV9TT1VSQ0UgPSB7XG4gICAgICAgICdjb3JlLm1pc3NlZF9jYWxsJzogJ3Bob25lJyxcbiAgICAgICAgJ2NvcmUudm9pY2VtYWlsJzogJ21pYycsXG4gICAgICAgICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJzogJ3NwYXJrbGUnLFxuICAgICAgICAnYWlfc3VwZXJ2aXNvci53b3JrZXJzJzogJ3JvYm90JyxcbiAgICAgICAgJ2xvY2FsX3N0dC53b3JrZXJzJzogJ21pYycsXG4gICAgICAgICdsb2NhbF9zdHQuYmFja2xvZyc6ICdtaWMnLFxuICAgICAgICAnY2xvdWRfc3R0LmluY2lkZW50cyc6ICdtaWMnLFxuICAgICAgICAnY2xvdWRfc3R0LnBhdXNlZCc6ICdtaWMnLFxuICAgICAgICAnY2xvdWRfYWkucGF1c2VkJzogJ3NwYXJrbGUnLFxuICAgICAgICAndm9pY2VfYWdlbnQuY2FsbGJhY2tzJzogJ3Bob25lJyxcbiAgICAgICAgJ3ZvaWNlX2FnZW50LnJ1bnRpbWUnOiAncm9ib3QnLFxuICAgICAgICAnY29yZS5wcm92aWRlcl9zdGF0dXMnOiAnc2VydmVyJyxcbiAgICAgICAgJ2NvcmUuYWR2aWNlJzogJ3dhcm5pbmcnLFxuICAgICAgICAnY29yZS5wYnhfc3RhcnRlZCc6ICdib2x0J1xuICAgIH07XG5cbiAgICBmdW5jdGlvbiBzY2VuYXJpb0ljb24oc291cmNlSWQpIHtcbiAgICAgICAgdmFyIHBhdGhzID0gU0NFTkFSSU9fSUNPTlNbU0NFTkFSSU9fSUNPTl9CWV9TT1VSQ0Vbc291cmNlSWRdIHx8ICd3YXJuaW5nJ107XG4gICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1zY2VuYXJpby1pY29uXCI+PHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+JyArIHBhdGhzICsgJzwvc3ZnPjwvc3Bhbj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlcldpemFyZFNjZW5hcmlvcygpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICB2YXIgZ3JvdXBzID0gR1JPVVBfT1JERVIuZmlsdGVyKGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgcmV0dXJuIHN0YXRlLnNvdXJjZXMuc29tZShmdW5jdGlvbiAoc291cmNlKSB7IHJldHVybiBzb3VyY2UuZ3JvdXAgPT09IGdyb3VwOyB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIHZhciBodG1sID0gJyc7XG4gICAgICAgIGdyb3Vwcy5mb3JFYWNoKGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgdmFyIHNvdXJjZXMgPSBzdGF0ZS5zb3VyY2VzLmZpbHRlcihmdW5jdGlvbiAoc291cmNlKSB7IHJldHVybiBzb3VyY2UuZ3JvdXAgPT09IGdyb3VwOyB9KTtcbiAgICAgICAgICAgIGlmIChncm91cHMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgICAgIGh0bWwgKz0gJzxoMyBjbGFzcz1cIm1oLWdyb3VwLXRpdGxlXCI+JyArIGVzYyhzb3VyY2VHcm91cE5hbWUoZ3JvdXApKSArICc8L2gzPic7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwibWgtc2NlbmFyaW8tZ3JpZFwiPic7XG4gICAgICAgICAgICBzb3VyY2VzLmZvckVhY2goZnVuY3Rpb24gKHNvdXJjZSkge1xuICAgICAgICAgICAgICAgIHZhciBkaXNhYmxlZCA9IFsnbW9kdWxlX21pc3NpbmcnLCAnbW9kdWxlX2Rpc2FibGVkJywgJ2FwaV9mb3JiaWRkZW4nLCAnYXBpX2luY29tcGF0aWJsZScsICdlcnJvcicsICdkaXNhYmxlZCddXG4gICAgICAgICAgICAgICAgICAgIC5pbmRleE9mKHNvdXJjZS5hdmFpbGFiaWxpdHkpID49IDA7XG4gICAgICAgICAgICAgICAgdmFyIHNlbGVjdGVkID0gdy5zb3VyY2VJZCA9PT0gc291cmNlLmlkO1xuICAgICAgICAgICAgICAgIC8vIFVuYXZhaWxhYmxlIHNjZW5hcmlvOiBvbmx5IHRoZSByZWFzb24sIG5vIGFjdGlvbiAodXNlciBkZWNpc2lvbiBRMTQpLlxuICAgICAgICAgICAgICAgIGh0bWwgKz0gJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwibWgtc2NlbmFyaW8nICsgKGRpc2FibGVkID8gJyBpcy1kaXNhYmxlZCcgOiAnJykgKyAoc2VsZWN0ZWQgPyAnIGlzLXNlbGVjdGVkJyA6ICcnKVxuICAgICAgICAgICAgICAgICAgICArICdcIiBkYXRhLXNvdXJjZS1pZD1cIicgKyBlc2Moc291cmNlLmlkKSArICdcIiBhcmlhLXByZXNzZWQ9XCInICsgKHNlbGVjdGVkID8gJ3RydWUnIDogJ2ZhbHNlJykgKyAnXCInXG4gICAgICAgICAgICAgICAgICAgICsgKGRpc2FibGVkID8gJyBkaXNhYmxlZCBhcmlhLWRpc2FibGVkPVwidHJ1ZVwiJyA6ICcnKSArICc+J1xuICAgICAgICAgICAgICAgICAgICArIHNjZW5hcmlvSWNvbihzb3VyY2UuaWQpXG4gICAgICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtc2NlbmFyaW8tdGV4dFwiPjxiPicgKyBlc2Moc291cmNlLm5hbWUpICsgJzwvYj4nXG4gICAgICAgICAgICAgICAgICAgICsgKGRpc2FibGVkID8gJzxzcGFuIGNsYXNzPVwibWgtbWV0YVwiPicgKyBlc2Moc291cmNlU3RhdGVUZXh0KHNvdXJjZSkpICsgJzwvc3Bhbj4nIDogJycpXG4gICAgICAgICAgICAgICAgICAgICsgJzwvc3Bhbj48L2J1dHRvbj4nO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBodG1sICs9ICc8L2Rpdj4nO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1zY2VuYXJpb3MnKS5odG1sKGh0bWwpO1xuICAgIH1cblxuICAgIC8vIC0tLS0gc3RlcCAyOiBjb25kaXRpb25zIChubyBoaW50czsgYW4gZW1wdHkgY2hvaWNlIG1lYW5zIMKr0LLRgdC1wrspIC0tLS1cblxuICAgIGZ1bmN0aW9uIHJlbmRlcldpemFyZENvbmRpdGlvbnMoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICB2YXIgaHRtbCA9ICcnO1xuICAgICAgICBpZiAod2l6YXJkU3VwcG9ydHNFbXBsb3llZXMody5ldmVudFR5cGVzKSkge1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImZpZWxkJyArIChzdGF0ZS5lbXBsb3llZXNGYWlsZWQgPyAnIGVycm9yJyA6ICcnKSArICdcIiBpZD1cIm1oLWNvbmQtZW1wbG95ZWVzLWZpZWxkXCI+J1xuICAgICAgICAgICAgICAgICsgJzxsYWJlbD4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZEVtcGxveWVlcycpKSArICc8L2xhYmVsPidcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwidWkgbXVsdGlwbGUgc2VhcmNoIHNlbGVjdGlvbiBkcm9wZG93biBtaC1jb25kLWRyb3Bkb3duXCIgaWQ9XCJtaC1jb25kLWVtcGxveWVlc1wiIHRhYmluZGV4PVwiMFwiPidcbiAgICAgICAgICAgICAgICArICc8aW5wdXQgdHlwZT1cImhpZGRlblwiPjxzcGFuIGNsYXNzPVwiZGVmYXVsdCB0ZXh0XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9GaWx0ZXJBbGwnKSkgKyAnPC9zcGFuPjxkaXYgY2xhc3M9XCJtZW51XCI+PC9kaXY+PC9kaXY+J1xuICAgICAgICAgICAgICAgICsgKHN0YXRlLmVtcGxveWVlc0ZhaWxlZFxuICAgICAgICAgICAgICAgICAgICA/ICc8c3BhbiBjbGFzcz1cIm1oLWhlbHBcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZExpc3RGYWlsZWQnKSlcbiAgICAgICAgICAgICAgICAgICAgICAgICsgJyA8YSBocmVmPVwiI1wiIGRhdGEtYWN0aW9uPVwicmV0cnktZW1wbG95ZWVzXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25SZXRyeScpKSArICc8L2E+PC9zcGFuPidcbiAgICAgICAgICAgICAgICAgICAgOiAnJylcbiAgICAgICAgICAgICAgICArICc8L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3aXphcmRTdXBwb3J0c0RpcmVjdGlvbnMody5ldmVudFR5cGVzKSkge1xuICAgICAgICAgICAgdmFyIGRpcmVjdGlvbnMgPSBbXG4gICAgICAgICAgICAgICAgWydpbmNvbWluZycsICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmREaXJlY3Rpb25JbmNvbWluZyddLFxuICAgICAgICAgICAgICAgIFsnb3V0Z29pbmcnLCAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkRGlyZWN0aW9uT3V0Z29pbmcnXSxcbiAgICAgICAgICAgICAgICBbJ2ludGVybmFsJywgJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZERpcmVjdGlvbkludGVybmFsJ11cbiAgICAgICAgICAgIF07XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZmllbGRcIj48bGFiZWw+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmREaXJlY3Rpb25zJykpICsgJzwvbGFiZWw+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1zZWdcIiByb2xlPVwiZ3JvdXBcIiBhcmlhLWxhYmVsPVwiJyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmREaXJlY3Rpb25zJykpICsgJ1wiPic7XG4gICAgICAgICAgICBkaXJlY3Rpb25zLmZvckVhY2goZnVuY3Rpb24gKHBhaXIpIHtcbiAgICAgICAgICAgICAgICB2YXIgcHJlc3NlZCA9IHcuZmlsdGVycy5kaXJlY3Rpb25zLmluZGV4T2YocGFpclswXSkgPj0gMDtcbiAgICAgICAgICAgICAgICBodG1sICs9ICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBkYXRhLWRpcmVjdGlvbj1cIicgKyBwYWlyWzBdICsgJ1wiIGFyaWEtcHJlc3NlZD1cIicgKyAocHJlc3NlZCA/ICd0cnVlJyA6ICdmYWxzZScpICsgJ1wiPidcbiAgICAgICAgICAgICAgICAgICAgKyBlc2ModChwYWlyWzFdKSkgKyAnPC9idXR0b24+JztcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgaHRtbCArPSAnPC9kaXY+PC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAod2l6YXJkU3VwcG9ydHNQcm92aWRlcnMody5ldmVudFR5cGVzKSkge1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImZpZWxkXCI+PGxhYmVsPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUHJvdmlkZXJzJykpICsgJzwvbGFiZWw+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJ1aSBtdWx0aXBsZSBzZWFyY2ggc2VsZWN0aW9uIGRyb3Bkb3duIG1oLWNvbmQtZHJvcGRvd25cIiBpZD1cIm1oLWNvbmQtcHJvdmlkZXJzXCIgdGFiaW5kZXg9XCIwXCI+J1xuICAgICAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiaGlkZGVuXCI+PHNwYW4gY2xhc3M9XCJkZWZhdWx0IHRleHRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0ZpbHRlckFsbCcpKSArICc8L3NwYW4+PGRpdiBjbGFzcz1cIm1lbnVcIj48L2Rpdj48L2Rpdj48L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3LmV2ZW50VHlwZXMuaW5kZXhPZignYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCcpID49IDApIHtcbiAgICAgICAgICAgIHZhciByYW5nZSA9IHcuZmlsdGVycy5xdWFsaXR5X3Njb3JlIHx8IHt9O1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImZpZWxkXCI+PGxhYmVsPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUXVhbGl0eScpKSArICc8L2xhYmVsPidcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtaW5saW5lLWlucHV0c1wiPidcbiAgICAgICAgICAgICAgICArICc8c3Bhbj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFF1YWxpdHlGcm9tJykpICsgJzwvc3Bhbj48aW5wdXQgdHlwZT1cIm51bWJlclwiIG1pbj1cIjBcIiBtYXg9XCIxMDBcIiBjbGFzcz1cIm1oLXF1YWxpdHktbWluIG1oLWlucHV0LXhzXCIgdmFsdWU9XCInICsgKHJhbmdlLm1pbiAhPT0gdW5kZWZpbmVkID8gcmFuZ2UubWluIDogJycpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8c3Bhbj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFF1YWxpdHlUbycpKSArICc8L3NwYW4+PGlucHV0IHR5cGU9XCJudW1iZXJcIiBtaW49XCIwXCIgbWF4PVwiMTAwXCIgY2xhc3M9XCJtaC1xdWFsaXR5LW1heCBtaC1pbnB1dC14c1wiIHZhbHVlPVwiJyArIChyYW5nZS5tYXggIT09IHVuZGVmaW5lZCA/IHJhbmdlLm1heCA6ICcnKSArICdcIj4nXG4gICAgICAgICAgICAgICAgKyAnPC9kaXY+PC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAod2l6YXJkU3VwcG9ydHNTZXZlcml0eSh3LmV2ZW50VHlwZXMpKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZmllbGRcIj48bGFiZWw+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRTZXZlcml0eScpKSArICc8L2xhYmVsPidcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtc2VnXCIgcm9sZT1cImdyb3VwXCIgYXJpYS1sYWJlbD1cIicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkU2V2ZXJpdHknKSkgKyAnXCI+JztcbiAgICAgICAgICAgIFtbJ3dhcm5pbmcnLCAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkU2V2ZXJpdHlXYXJuaW5nJ10sIFsnY3JpdGljYWwnLCAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkU2V2ZXJpdHlDcml0aWNhbCddXS5mb3JFYWNoKGZ1bmN0aW9uIChwYWlyKSB7XG4gICAgICAgICAgICAgICAgaHRtbCArPSAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgZGF0YS1zZXZlcml0eT1cIicgKyBwYWlyWzBdICsgJ1wiIGFyaWEtcHJlc3NlZD1cIicgKyAody5taW5TZXZlcml0eSA9PT0gcGFpclswXSA/ICd0cnVlJyA6ICdmYWxzZScpICsgJ1wiPidcbiAgICAgICAgICAgICAgICAgICAgKyBlc2ModChwYWlyWzFdKSkgKyAnPC9idXR0b24+JztcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgaHRtbCArPSAnPC9kaXY+PC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAod2l6YXJkU3VwcG9ydHNSZWFzb25zKHcuZXZlbnRUeXBlcykpIHtcbiAgICAgICAgICAgIHZhciBjaG9zZW4gPSB3LmZpbHRlcnMucmVhc29ucyB8fCBbXTtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJmaWVsZFwiIGlkPVwibWgtY29uZC1yZWFzb25zXCI+PGxhYmVsPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUmVhc29ucycpKSArICc8L2xhYmVsPic7XG4gICAgICAgICAgICBDTE9VRF9BSV9SRUFTT05fR1JPVVBTLmZvckVhY2goZnVuY3Rpb24gKGdyb3VwKSB7XG4gICAgICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIm1oLXJlYXNvbi1ncm91cFwiPjxkaXYgY2xhc3M9XCJtaC1yZWFzb24tdGl0bGVcIj4nICsgZXNjKHQoZ3JvdXBbMF0pKSArICc8L2Rpdj4nO1xuICAgICAgICAgICAgICAgIGdyb3VwWzFdLmZvckVhY2goZnVuY3Rpb24gKHJlYXNvbikge1xuICAgICAgICAgICAgICAgICAgICBodG1sICs9ICc8bGFiZWwgY2xhc3M9XCJtaC1yZWFzb24tY2hlY2tcIj48aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgZGF0YS1yZWFzb249XCInICsgcmVhc29uICsgJ1wiJ1xuICAgICAgICAgICAgICAgICAgICAgICAgKyAoY2hvc2VuLmluZGV4T2YocmVhc29uKSA+PSAwID8gJyBjaGVja2VkJyA6ICcnKSArICc+J1xuICAgICAgICAgICAgICAgICAgICAgICAgKyAnPHNwYW4+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl8nICsgU1RBVFVTX1BBVVNFX0tFWVNbcmVhc29uXSkpICsgJzwvc3Bhbj48L2xhYmVsPic7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgaHRtbCArPSAnPC9kaXY+JztcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgaHRtbCArPSAnPC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAod2l6YXJkSGFzU3RhdHVzKHcuZXZlbnRUeXBlcykpIHtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJtaC1zd2l0Y2gtcm93IG1oLXJlY292ZXItcm93XCI+J1xuICAgICAgICAgICAgICAgICsgJzxsYWJlbCBjbGFzcz1cInVpIHRvZ2dsZSBjaGVja2JveCcgKyAody5yZWNvdmVyID8gJyBjaGVja2VkJyA6ICcnKSArICdcIiBpZD1cIm1oLXJlY292ZXItZW5hYmxlZFwiPidcbiAgICAgICAgICAgICAgICArICc8aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgY2xhc3M9XCJoaWRkZW5cIicgKyAody5yZWNvdmVyID8gJyBjaGVja2VkJyA6ICcnKSArICcgYXJpYS1sYWJlbD1cIicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUmVjb3ZlcnknKSkgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtdHJhY2tcIj48L3NwYW4+PC9sYWJlbD4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRSZWNvdmVyeScpKSArICc8L3NwYW4+PC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAody5ldmVudFR5cGVzLmluZGV4T2YoJ2NvcmUubWlzc2VkX2NhbGwnKSA+PSAwKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwibWgtc3dpdGNoLXJvdyBtaC1yZXRyYWN0LXJvd1wiPidcbiAgICAgICAgICAgICAgICArICc8bGFiZWwgY2xhc3M9XCJ1aSB0b2dnbGUgY2hlY2tib3gnICsgKHcucmV0cmFjdC5lbmFibGVkID8gJyBjaGVja2VkJyA6ICcnKSArICdcIiBpZD1cIm1oLXJldHJhY3QtZW5hYmxlZFwiPidcbiAgICAgICAgICAgICAgICArICc8aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgY2xhc3M9XCJoaWRkZW5cIicgKyAody5yZXRyYWN0LmVuYWJsZWQgPyAnIGNoZWNrZWQnIDogJycpICsgJyBhcmlhLWxhYmVsPVwiJyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SZXRyYWN0RW5hYmxlZCcpKSArICdcIj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC10cmFja1wiPjwvc3Bhbj48L2xhYmVsPidcbiAgICAgICAgICAgICAgICArICc8c3Bhbj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1JldHJhY3RFbmFibGVkJykpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1pbmxpbmUtaW5wdXRzXCIgaWQ9XCJtaC1yZXRyYWN0LW9wdGlvbnNcIicgKyAody5yZXRyYWN0LmVuYWJsZWQgPyAnJyA6ICcgaGlkZGVuJykgKyAnPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW11dGVkXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SZXRyYWN0V2luZG93QmVmb3JlJykpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICAgICAgKyAnPGlucHV0IHR5cGU9XCJudW1iZXJcIiBtaW49XCI1XCIgbWF4PVwiMTIwXCIgaWQ9XCJtaC1yZXRyYWN0LXdpbmRvd1wiIGNsYXNzPVwibWgtaW5wdXQteHNcIiB2YWx1ZT1cIicgKyB3LnJldHJhY3Qud2luZG93X21pbiArICdcIiBhcmlhLWxhYmVsPVwiJyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SZXRyYWN0TWludXRlcycpKSArICdcIj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tdXRlZFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUmV0cmFjdE1pbnV0ZXMnKSkgKyAnPC9zcGFuPjwvc3Bhbj4nXG4gICAgICAgICAgICAgICAgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgKHdpemFyZElzTWF4KClcbiAgICAgICAgICAgICAgICAgICAgPyAnPGRpdiBjbGFzcz1cImZpZWxkXCIgaWQ9XCJtaC1yZXRyYWN0LW1heC1oaW50XCInICsgKHcucmV0cmFjdC5lbmFibGVkID8gJycgOiAnIGhpZGRlbicpICsgJz4nXG4gICAgICAgICAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWhlbHBcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1JldHJhY3RNYXhIaW50JykpICsgJzwvc3Bhbj48L2Rpdj4nXG4gICAgICAgICAgICAgICAgICAgIDogJycpO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC13aXphcmQtY29uZGl0aW9ucycpLmh0bWwoaHRtbCk7XG4gICAgICAgIGluaXRDb25kaXRpb25Ecm9wZG93bnMoKTtcbiAgICAgICAgYmluZFdpemFyZENvbmRpdGlvbnMoKTtcbiAgICAgICAgcmVuZGVyV2l6YXJkUHJldmlldygpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGluaXRDb25kaXRpb25Ecm9wZG93bnMoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgdmFyICRlbXBsb3llZXMgPSAkKCcjbWgtY29uZC1lbXBsb3llZXMnKTtcbiAgICAgICAgaWYgKCRlbXBsb3llZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdmFyIHNlbGVjdGVkVXNlcnMgPSB3LmZpbHRlcnMudXNlcl9pZHMubWFwKFN0cmluZyk7XG4gICAgICAgICAgICAkZW1wbG95ZWVzLmRyb3Bkb3duKHtcbiAgICAgICAgICAgICAgICB2YWx1ZXM6IHN0YXRlLmVtcGxveWVlcy5tYXAoZnVuY3Rpb24gKGVtcGxveWVlKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7IG5hbWU6IGVtcGxveWVlLmxhYmVsLCB2YWx1ZTogU3RyaW5nKGVtcGxveWVlLmlkKSwgc2VsZWN0ZWQ6IHNlbGVjdGVkVXNlcnMuaW5kZXhPZihTdHJpbmcoZW1wbG95ZWUuaWQpKSA+PSAwIH07XG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgcGxhY2Vob2xkZXI6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0ZpbHRlckFsbCcpLFxuICAgICAgICAgICAgICAgIGZ1bGxUZXh0U2VhcmNoOiB0cnVlLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IHsgbm9SZXN1bHRzOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9GaWx0ZXJOb3RoaW5nRm91bmQnKSB9LFxuICAgICAgICAgICAgICAgIG9uQ2hhbmdlOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS5ydWxlV2l6YXJkKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLmZpbHRlcnMudXNlcl9pZHMgPSBTdHJpbmcodmFsdWUgfHwgJycpLnNwbGl0KCcsJykuZmlsdGVyKEJvb2xlYW4pLm1hcChOdW1iZXIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHZhciAkcHJvdmlkZXJzID0gJCgnI21oLWNvbmQtcHJvdmlkZXJzJyk7XG4gICAgICAgIGlmICgkcHJvdmlkZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHZhciBzZWxlY3RlZFByb3ZpZGVycyA9IHcuZmlsdGVycy5wcm92aWRlcnMubWFwKFN0cmluZyk7XG4gICAgICAgICAgICAkcHJvdmlkZXJzLmRyb3Bkb3duKHtcbiAgICAgICAgICAgICAgICB2YWx1ZXM6IHN0YXRlLnByb3ZpZGVycy5tYXAoZnVuY3Rpb24gKHByb3ZpZGVyKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7IG5hbWU6IHByb3ZpZGVyLmxhYmVsLCB2YWx1ZTogU3RyaW5nKHByb3ZpZGVyLmlkKSwgc2VsZWN0ZWQ6IHNlbGVjdGVkUHJvdmlkZXJzLmluZGV4T2YoU3RyaW5nKHByb3ZpZGVyLmlkKSkgPj0gMCB9O1xuICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9GaWx0ZXJBbGwnKSxcbiAgICAgICAgICAgICAgICBmdWxsVGV4dFNlYXJjaDogdHJ1ZSxcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiB7IG5vUmVzdWx0czogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRmlsdGVyTm90aGluZ0ZvdW5kJykgfSxcbiAgICAgICAgICAgICAgICBvbkNoYW5nZTogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghc3RhdGUucnVsZVdpemFyZCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgICAgICAgICAgc3RhdGUucnVsZVdpemFyZC5maWx0ZXJzLnByb3ZpZGVycyA9IFN0cmluZyh2YWx1ZSB8fCAnJykuc3BsaXQoJywnKS5maWx0ZXIoQm9vbGVhbik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBiaW5kV2l6YXJkQ29uZGl0aW9ucygpIHtcbiAgICAgICAgdmFyICRmb3JtID0gJCgnI21oLXdpemFyZC1jb25kaXRpb25zJyk7XG4gICAgICAgICRmb3JtLm9mZignLndpemFyZCcpO1xuICAgICAgICAkZm9ybS5vbignY2xpY2sud2l6YXJkJywgJy5taC1zZWcgYnV0dG9uW2RhdGEtc2V2ZXJpdHldJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdy5taW5TZXZlcml0eSA9IFN0cmluZygkKHRoaXMpLmRhdGEoJ3NldmVyaXR5JykpID09PSAnY3JpdGljYWwnID8gJ2NyaXRpY2FsJyA6ICd3YXJuaW5nJztcbiAgICAgICAgICAgICQodGhpcykuY2xvc2VzdCgnLm1oLXNlZycpLmZpbmQoJ2J1dHRvbicpLmF0dHIoJ2FyaWEtcHJlc3NlZCcsICdmYWxzZScpO1xuICAgICAgICAgICAgJCh0aGlzKS5hdHRyKCdhcmlhLXByZXNzZWQnLCAndHJ1ZScpO1xuICAgICAgICAgICAgcmVuZGVyV2l6YXJkUHJldmlldygpO1xuICAgICAgICB9KTtcbiAgICAgICAgJGZvcm0ub24oJ2NoYW5nZS53aXphcmQnLCAnI21oLXJlY292ZXItZW5hYmxlZCBpbnB1dCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHcucmVjb3ZlciA9ICQodGhpcykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICAgICAgJCgnI21oLXJlY292ZXItZW5hYmxlZCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgdy5yZWNvdmVyKTtcbiAgICAgICAgICAgIHcuZXZlbnRUeXBlcyA9IHdpemFyZFdpdGhSZWNvdmVyeSh3LmV2ZW50VHlwZXMsIHcucmVjb3Zlcik7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkZm9ybS5vbignY2hhbmdlLndpemFyZCcsICcjbWgtY29uZC1yZWFzb25zIGlucHV0W2RhdGEtcmVhc29uXScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHcuZmlsdGVycy5yZWFzb25zID0gJGZvcm0uZmluZCgnI21oLWNvbmQtcmVhc29ucyBpbnB1dFtkYXRhLXJlYXNvbl06Y2hlY2tlZCcpLm1hcChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFN0cmluZygkKHRoaXMpLmRhdGEoJ3JlYXNvbicpKTtcbiAgICAgICAgICAgIH0pLmdldCgpO1xuICAgICAgICAgICAgcmVuZGVyV2l6YXJkUHJldmlldygpO1xuICAgICAgICB9KTtcbiAgICAgICAgJGZvcm0ub24oJ2NsaWNrLndpemFyZCcsICcubWgtc2VnIGJ1dHRvbltkYXRhLWRpcmVjdGlvbl0nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIgdmFsdWUgPSBTdHJpbmcoJCh0aGlzKS5kYXRhKCdkaXJlY3Rpb24nKSk7XG4gICAgICAgICAgICB2YXIgaW5kZXggPSB3LmZpbHRlcnMuZGlyZWN0aW9ucy5pbmRleE9mKHZhbHVlKTtcbiAgICAgICAgICAgIGlmIChpbmRleCA+PSAwKSB7XG4gICAgICAgICAgICAgICAgdy5maWx0ZXJzLmRpcmVjdGlvbnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdy5maWx0ZXJzLmRpcmVjdGlvbnMucHVzaCh2YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAkKHRoaXMpLmF0dHIoJ2FyaWEtcHJlc3NlZCcsIGluZGV4ID49IDAgPyAnZmFsc2UnIDogJ3RydWUnKTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZFByZXZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICRmb3JtLm9uKCdjbGljay53aXphcmQnLCAnW2RhdGEtYWN0aW9uPVwicmV0cnktZW1wbG95ZWVzXCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgc3RhdGUuZW1wbG95ZWVzRmFpbGVkID0gZmFsc2U7XG4gICAgICAgICAgICBsb2FkRW1wbG95ZWVzKGZ1bmN0aW9uICgpIHsgcmVuZGVyV2l6YXJkQ29uZGl0aW9ucygpOyB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgICRmb3JtLm9uKCdjaGFuZ2Uud2l6YXJkJywgJyNtaC1yZXRyYWN0LWVuYWJsZWQgaW5wdXQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB3LnJldHJhY3QuZW5hYmxlZCA9ICQodGhpcykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICAgICAgJCgnI21oLXJldHJhY3QtZW5hYmxlZCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgdy5yZXRyYWN0LmVuYWJsZWQpO1xuICAgICAgICAgICAgJCgnI21oLXJldHJhY3Qtb3B0aW9ucycpLnByb3AoJ2hpZGRlbicsICF3LnJldHJhY3QuZW5hYmxlZCk7XG4gICAgICAgICAgICAkKCcjbWgtcmV0cmFjdC1tYXgtaGludCcpLnByb3AoJ2hpZGRlbicsICF3LnJldHJhY3QuZW5hYmxlZCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkZm9ybS5vbignaW5wdXQud2l6YXJkIGNoYW5nZS53aXphcmQnLCAnI21oLXJldHJhY3Qtd2luZG93JywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdmFyIHZhbHVlID0gTnVtYmVyKCQodGhpcykudmFsKCkpO1xuICAgICAgICAgICAgdy5yZXRyYWN0LndpbmRvd19taW4gPSB2YWx1ZSA+PSA1ICYmIHZhbHVlIDw9IDEyMCA/IHZhbHVlIDogMjA7XG4gICAgICAgIH0pO1xuICAgICAgICAkZm9ybS5vbignaW5wdXQud2l6YXJkJywgJy5taC1xdWFsaXR5LW1pbiwgLm1oLXF1YWxpdHktbWF4JywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdmFyIG1pbiA9ICRmb3JtLmZpbmQoJy5taC1xdWFsaXR5LW1pbicpLnZhbCgpO1xuICAgICAgICAgICAgdmFyIG1heCA9ICRmb3JtLmZpbmQoJy5taC1xdWFsaXR5LW1heCcpLnZhbCgpO1xuICAgICAgICAgICAgdmFyIHJhbmdlID0ge307XG4gICAgICAgICAgICBpZiAoU3RyaW5nKG1pbikudHJpbSgpICE9PSAnJykgeyByYW5nZS5taW4gPSBOdW1iZXIobWluKTsgfVxuICAgICAgICAgICAgaWYgKFN0cmluZyhtYXgpLnRyaW0oKSAhPT0gJycpIHsgcmFuZ2UubWF4ID0gTnVtYmVyKG1heCk7IH1cbiAgICAgICAgICAgIHcuZmlsdGVycy5xdWFsaXR5X3Njb3JlID0gT2JqZWN0LmtleXMocmFuZ2UpLmxlbmd0aCA+IDAgPyByYW5nZSA6IG51bGw7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0gc3RlcCAzOiB3aGVyZSB0byBzZW5kIC0tLS1cblxuICAgIGZ1bmN0aW9uIGFjdGl2ZVdpemFyZEJvdCgpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuIG51bGw7IH1cbiAgICAgICAgdmFyIGJvdHMgPSBzdGF0ZS5ib3RzLmZpbHRlcihmdW5jdGlvbiAoYm90KSB7IHJldHVybiBib3QuZW5hYmxlZCAhPT0gZmFsc2U7IH0pO1xuICAgICAgICBpZiAody5ib3RJZCA+IDApIHtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYm90cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIGlmIChOdW1iZXIoYm90c1tpXS5pZCkgPT09IE51bWJlcih3LmJvdElkKSkgeyByZXR1cm4gYm90c1tpXTsgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBib3RzLmxlbmd0aCA+IDAgPyBib3RzWzBdIDogbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJXaXphcmRSZWNpcGllbnRzKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIHZhciBzdXBwb3J0c0VtcGxveWVlcyA9IHdpemFyZFN1cHBvcnRzRW1wbG95ZWVzKHcuZXZlbnRUeXBlcyk7XG4gICAgICAgIHZhciBib3RzID0gc3RhdGUuYm90cy5maWx0ZXIoZnVuY3Rpb24gKGJvdCkgeyByZXR1cm4gYm90LmVuYWJsZWQgIT09IGZhbHNlOyB9KTtcbiAgICAgICAgdmFyIGFjdGl2ZSA9IGFjdGl2ZVdpemFyZEJvdCgpO1xuICAgICAgICBpZiAoYWN0aXZlICE9PSBudWxsICYmIE51bWJlcih3LmJvdElkKSAhPT0gTnVtYmVyKGFjdGl2ZS5pZCkpIHtcbiAgICAgICAgICAgIHcuYm90SWQgPSBOdW1iZXIoYWN0aXZlLmlkKTsgLy8gYSBzaW5nbGUgYm90IGlzIHNlbGVjdGVkIGJ5IGl0c2VsZlxuICAgICAgICB9XG4gICAgICAgIHZhciBib3RIdG1sID0gJyc7XG4gICAgICAgIGJvdHMuZm9yRWFjaChmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICB2YXIgc2VsZWN0ZWQgPSBhY3RpdmUgIT09IG51bGwgJiYgTnVtYmVyKGFjdGl2ZS5pZCkgPT09IE51bWJlcihib3QuaWQpO1xuICAgICAgICAgICAgdmFyIGNoYW5uZWwgPSBib3QuY2hhbm5lbCA9PT0gJ21heCcgPyAnbWF4JyA6ICd0Zyc7XG4gICAgICAgICAgICBib3RIdG1sICs9ICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cIm1oLXNjZW5hcmlvIG1oLWJvdC1jaG9pY2UnICsgKHNlbGVjdGVkID8gJyBpcy1zZWxlY3RlZCcgOiAnJylcbiAgICAgICAgICAgICAgICArICdcIiBkYXRhLWJvdC1pZD1cIicgKyBib3QuaWQgKyAnXCIgYXJpYS1wcmVzc2VkPVwiJyArIChzZWxlY3RlZCA/ICd0cnVlJyA6ICdmYWxzZScpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1lc3NlbmdlciAnICsgY2hhbm5lbCArICdcIiBhcmlhLWhpZGRlbj1cInRydWVcIj4nICsgKGNoYW5uZWwgPT09ICdtYXgnID8gJ01BWCcgOiAnVEcnKSArICc8L3NwYW4+J1xuICAgICAgICAgICAgICAgICsgJzxiIGNsYXNzPVwibWgtdHJ1bmNhdGVcIj4nICsgZXNjKGJvdC50aXRsZSkgKyAnPC9iPjwvYnV0dG9uPic7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLWJvdHMnKS5odG1sKGJvdEh0bWwpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLWJvdHMtZmllbGQnKS5hdHRyKCdoaWRkZW4nLCBib3RzLmxlbmd0aCA+IDAgPyBudWxsIDogdHJ1ZSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtbm8tYm90cycpLmF0dHIoJ2hpZGRlbicsIGJvdHMubGVuZ3RoID4gMCA/IHRydWUgOiBudWxsKTtcbiAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQnKS5hdHRyKCdoaWRkZW4nLCBib3RzLmxlbmd0aCA+IDAgPyBudWxsIDogdHJ1ZSk7XG5cbiAgICAgICAgaWYgKCFzdXBwb3J0c0VtcGxveWVlcykge1xuICAgICAgICAgICAgdy50YXJnZXRNb2RlID0gJ3JlY2lwaWVudHMnO1xuICAgICAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQgW3ZhbHVlPVwiZW1wbG95ZWVcIl0sICNtaC13aXphcmQtdGFyZ2V0IFt2YWx1ZT1cImVtcGxveWVlX29yX3JlY2lwaWVudHNcIl0nKVxuICAgICAgICAgICAgICAgIC5jbG9zZXN0KCdsYWJlbCcpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQgW3ZhbHVlPVwiZW1wbG95ZWVcIl0sICNtaC13aXphcmQtdGFyZ2V0IFt2YWx1ZT1cImVtcGxveWVlX29yX3JlY2lwaWVudHNcIl0nKVxuICAgICAgICAgICAgICAgIC5jbG9zZXN0KCdsYWJlbCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC13aXphcmQtdGFyZ2V0IGlucHV0W25hbWU9XCJtaC10YXJnZXRcIl0nKS5lYWNoKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBjaGVja2VkID0gJCh0aGlzKS52YWwoKSA9PT0gdy50YXJnZXRNb2RlO1xuICAgICAgICAgICAgJCh0aGlzKS5wcm9wKCdjaGVja2VkJywgY2hlY2tlZCkuY2xvc2VzdCgnbGFiZWwnKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsIGNoZWNrZWQpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmVuZGVyV2l6YXJkQ2hhdHMoKTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1tYXNrJykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCB3Lm1hc2spO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLW1hc2sgaW5wdXQnKS5wcm9wKCdjaGVja2VkJywgdy5tYXNrKTtcbiAgICAgICAgcmVuZGVyV2l6YXJkQXR0YWNobWVudHMoKTtcbiAgICAgICAgYmluZFdpemFyZFJlY2lwaWVudHMoKTtcbiAgICAgICAgLy8gYSBzY2VuYXJpbyB3aXRob3V0IGNvbmRpdGlvbnMgZ29lcyAxIC0+IDM6IHN0ZXAgMyBtdXN0IHJlbmRlciBpdHMgb3duIHByZXZpZXdcbiAgICAgICAgcmVuZGVyV2l6YXJkUHJldmlldygpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlcldpemFyZEF0dGFjaG1lbnRzKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIHZhciBtb2RlcyA9IHdpemFyZEF0dGFjaG1lbnRNb2Rlcyh3LmV2ZW50VHlwZXMpO1xuICAgICAgICB2YXIgJGZpZWxkID0gJCgnI21oLXdpemFyZC1hdHRhY2htZW50cycpO1xuICAgICAgICBpZiAobW9kZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB3LmF0dGFjaG1lbnRzID0gJ25vbmUnO1xuICAgICAgICAgICAgJGZpZWxkLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2Rlcy5pbmRleE9mKHcuYXR0YWNobWVudHMpIDwgMCkgeyB3LmF0dGFjaG1lbnRzID0gJ25vbmUnOyB9XG4gICAgICAgICRmaWVsZC5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgLy8gYSB2b2ljZW1haWwgaXMgb25lIGZpbGU6IHRoZSB3aG9sZS1jb252ZXJzYXRpb24gd29yZGluZyBiZWNvbWVzIHBsYWluIFwiUmVjb3JkaW5nXCJcbiAgICAgICAgdmFyIHZvaWNlbWFpbE9ubHkgPSB3LmV2ZW50VHlwZXMuaW5kZXhPZignYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCcpIDwgMDtcbiAgICAgICAgJCgnI21oLXdpemFyZC1hdHRhY2gtcmVjb3JkaW5nLXRleHQnKS50ZXh0KHQodm9pY2VtYWlsT25seVxuICAgICAgICAgICAgPyAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkQXR0YWNoVm9pY2VtYWlsJ1xuICAgICAgICAgICAgOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkQXR0YWNoUmVjb3JkaW5nJykpO1xuICAgICAgICAkZmllbGQuZmluZCgnbGFiZWxbZGF0YS1tb2RlXScpLmVhY2goZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG1vZGUgPSBTdHJpbmcoJCh0aGlzKS5kYXRhKCdtb2RlJykpO1xuICAgICAgICAgICAgdmFyIGNoZWNrZWQgPSBtb2RlID09PSB3LmF0dGFjaG1lbnRzO1xuICAgICAgICAgICAgJCh0aGlzKS5hdHRyKCdoaWRkZW4nLCBtb2Rlcy5pbmRleE9mKG1vZGUpID49IDAgPyBudWxsIDogdHJ1ZSlcbiAgICAgICAgICAgICAgICAudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCBjaGVja2VkKS5maW5kKCdpbnB1dCcpLnByb3AoJ2NoZWNrZWQnLCBjaGVja2VkKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtYXR0YWNoLWhpbnQnKS5hdHRyKCdoaWRkZW4nLCB3LmF0dGFjaG1lbnRzID09PSAnbm9uZScgPyB0cnVlIDogbnVsbCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyV2l6YXJkQ2hhdHMoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgdmFyIGJvdCA9IGFjdGl2ZVdpemFyZEJvdCgpO1xuICAgICAgICB2YXIgY2hhdHMgPSBib3QgPyAoYm90LmNoYXRzIHx8IFtdKS5maWx0ZXIoZnVuY3Rpb24gKGNoYXQpIHtcbiAgICAgICAgICAgIHJldHVybiBjaGF0LnN0YXRlID09PSAnYWN0aXZlJyAmJiBjaGF0LmVuYWJsZWQgPT09IHRydWU7XG4gICAgICAgIH0pIDogW107XG4gICAgICAgIHZhciBpZHMgPSBjaGF0cy5tYXAoZnVuY3Rpb24gKGNoYXQpIHsgcmV0dXJuIE51bWJlcihjaGF0LmlkKTsgfSk7XG4gICAgICAgIHcuY2hhdElkcyA9IHcuY2hhdElkcy5maWx0ZXIoZnVuY3Rpb24gKGlkKSB7IHJldHVybiBpZHMuaW5kZXhPZihpZCkgPj0gMDsgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtY2hhdHMtZmllbGQnKS5hdHRyKCdoaWRkZW4nLCB3LnRhcmdldE1vZGUgPT09ICdlbXBsb3llZScgPyB0cnVlIDogbnVsbCk7XG4gICAgICAgIHZhciAkZHJvcGRvd24gPSAkKCcjbWgtd2l6YXJkLWNoYXRzJyk7XG4gICAgICAgICRkcm9wZG93bi5kcm9wZG93bignZGVzdHJveScpO1xuICAgICAgICAkZHJvcGRvd24uZmluZCgnYS51aS5sYWJlbCcpLnJlbW92ZSgpO1xuICAgICAgICAkZHJvcGRvd24uZHJvcGRvd24oe1xuICAgICAgICAgICAgdmFsdWVzOiBjaGF0cy5tYXAoZnVuY3Rpb24gKGNoYXQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiBlc2MoY2hhdC50aXRsZSB8fCBjaGF0LmNoYXRfaWQpICsgJyA8c3BhbiBjbGFzcz1cIm1oLW1ldGFcIj7CtyAnICsgZXNjKGNoYXRLaW5kTGFiZWwoY2hhdC5jaGF0X2tpbmQpKSArICc8L3NwYW4+JyxcbiAgICAgICAgICAgICAgICAgICAgdGV4dDogZXNjKGNoYXQudGl0bGUgfHwgY2hhdC5jaGF0X2lkKSxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IFN0cmluZyhjaGF0LmlkKSxcbiAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWQ6IHcuY2hhdElkcy5pbmRleE9mKE51bWJlcihjaGF0LmlkKSkgPj0gMFxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBjaGF0cy5sZW5ndGggPiAwID8gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkQ2hhdHNUaXRsZScpIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkTm9DaGF0cycpLFxuICAgICAgICAgICAgbWVzc2FnZTogeyBub1Jlc3VsdHM6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZE5vQ2hhdHMnKSB9LFxuICAgICAgICAgICAgb25DaGFuZ2U6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgIGlmICghc3RhdGUucnVsZVdpemFyZCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLmNoYXRJZHMgPSBTdHJpbmcodmFsdWUgfHwgJycpLnNwbGl0KCcsJykuZmlsdGVyKEJvb2xlYW4pLm1hcChOdW1iZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBiaW5kV2l6YXJkUmVjaXBpZW50cygpIHtcbiAgICAgICAgdmFyICRzdGVwID0gJCgnI21oLXdpemFyZC1zdGVwLTMnKTtcbiAgICAgICAgJHN0ZXAub2ZmKCcud2l6YXJkJyk7XG4gICAgICAgICRzdGVwLm9uKCdjbGljay53aXphcmQnLCAnLm1oLWJvdC1jaG9pY2UnLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLmJvdElkID0gTnVtYmVyKCQodGhpcykuZGF0YSgnYm90LWlkJykpO1xuICAgICAgICAgICAgc3RhdGUucnVsZVdpemFyZC5jaGF0SWRzID0gW107XG4gICAgICAgICAgICByZW5kZXJXaXphcmRSZWNpcGllbnRzKCk7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgICAgICB1cGRhdGVXaXphcmROZXh0KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkc3RlcC5vbignY2hhbmdlLndpemFyZCcsICdpbnB1dFtuYW1lPVwibWgtdGFyZ2V0XCJdJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc3RhdGUucnVsZVdpemFyZC50YXJnZXRNb2RlID0gU3RyaW5nKCQodGhpcykudmFsKCkpO1xuICAgICAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQgaW5wdXRbbmFtZT1cIm1oLXRhcmdldFwiXScpLmVhY2goZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICQodGhpcykuY2xvc2VzdCgnbGFiZWwnKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsICQodGhpcykucHJvcCgnY2hlY2tlZCcpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgJCgnI21oLXdpemFyZC1jaGF0cy1maWVsZCcpLmF0dHIoJ2hpZGRlbicsIHN0YXRlLnJ1bGVXaXphcmQudGFyZ2V0TW9kZSA9PT0gJ2VtcGxveWVlJyA/IHRydWUgOiBudWxsKTtcbiAgICAgICAgfSk7XG4gICAgICAgICRzdGVwLm9uKCdjaGFuZ2Uud2l6YXJkJywgJ2lucHV0W25hbWU9XCJtaC1hdHRhY2htZW50c1wiXScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLnJ1bGVXaXphcmQuYXR0YWNobWVudHMgPSBTdHJpbmcoJCh0aGlzKS52YWwoKSk7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRBdHRhY2htZW50cygpO1xuICAgICAgICAgICAgcmVuZGVyV2l6YXJkUHJldmlldygpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHN0ZXAub24oJ2NoYW5nZS53aXphcmQnLCAnI21oLXdpemFyZC1tYXNrIGlucHV0JywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc3RhdGUucnVsZVdpemFyZC5tYXNrID0gJCh0aGlzKS5wcm9wKCdjaGVja2VkJyk7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLW1hc2snKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsIHN0YXRlLnJ1bGVXaXphcmQubWFzayk7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0gcHJldmlldyAoc3RlcCAyLCByaWdodCBjb2x1bW4pIC0tLS1cblxuICAgIC8qKiBBIHJ1bGUgdGFyZ2V0cyBvbmUgYm90LCBzbyBpdHMgY2hhbm5lbCBpcyB0aGUgY2hhbm5lbCBvZiB0aGUgYWN0aXZlIHdpemFyZCBib3QuICovXG4gICAgZnVuY3Rpb24gd2l6YXJkSXNNYXgoKSB7XG4gICAgICAgIHZhciBib3QgPSBhY3RpdmVXaXphcmRCb3QoKTtcbiAgICAgICAgcmV0dXJuICEhYm90ICYmIGJvdC5jaGFubmVsID09PSAnbWF4JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRQcmV2aWV3Q2FsbFR5cGUodHlwZXMpIHtcbiAgICAgICAgdmFyIG9yZGVyID0gW1xuICAgICAgICAgICAgJ2NvcmUubWlzc2VkX2NhbGwnLCAnY29yZS52b2ljZW1haWwnLCAnYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCcsXG4gICAgICAgICAgICAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb2ZmbGluZScsICdhaV9zdXBlcnZpc29yLndvcmtlcl9vbmxpbmUnLFxuICAgICAgICAgICAgJ2xvY2FsX3N0dC53b3JrZXJfb2ZmbGluZScsICdsb2NhbF9zdHQud29ya2VyX29ubGluZScsICdsb2NhbF9zdHQuYmFja2xvZ19ub193b3JrZXJzJywgJ2xvY2FsX3N0dC5iYWNrbG9nX3Jlc29sdmVkJyxcbiAgICAgICAgICAgICdjbG91ZF9zdHQuaW5jaWRlbnQnLCAnY2xvdWRfc3R0LmluY2lkZW50X3Jlc29sdmVkJywgJ2Nsb3VkX3N0dC5wYXVzZWQnLCAnY2xvdWRfc3R0LnJlc3VtZWQnLFxuICAgICAgICAgICAgJ2Nsb3VkX2FpLnBhdXNlZCcsICdjbG91ZF9haS5yZXN1bWVkJyxcbiAgICAgICAgICAgICd2b2ljZV9hZ2VudC5jYWxsYmFja19yZXF1ZXN0JywgJ3ZvaWNlX2FnZW50LnJ1bnRpbWVfZG93bicsICd2b2ljZV9hZ2VudC5ydW50aW1lX3VwJyxcbiAgICAgICAgICAgICdjb3JlLnByb3ZpZGVyX2Rvd24nLCAnY29yZS5wcm92aWRlcl91cCcsICdjb3JlLmFkdmljZScsICdjb3JlLnBieF9zdGFydGVkJ1xuICAgICAgICBdO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG9yZGVyLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAodHlwZXMuaW5kZXhPZihvcmRlcltpXSkgPj0gMCkgeyByZXR1cm4gb3JkZXJbaV07IH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJyc7XG4gICAgfVxuXG4gICAgLy8gU2FtcGxlIGRhdGEgb2YgdGhlIHByZXZpZXcgYnViYmxlcyBmb3IgdGhlIG1vZHVsZSBzdGF0dXMgZXZlbnRzOyBuZXZlciByZWFsIHZhbHVlcy5cbiAgICB2YXIgU1RBVFVTX1BSRVZJRVdfU0FNUExFUyA9IHtcbiAgICAgICAgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29mZmxpbmUnOiB7IGNvZGU6ICd3b3JrZXJfb2ZmbGluZScsIHJlZjogJ3NhbXBsZScsIGNvdW50ZXJzOiB7IHdvcmtlcnNfb25saW5lOiAxLCB3b3JrZXJzX3RvdGFsOiAyIH0gfSxcbiAgICAgICAgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29ubGluZSc6IHsgY29kZTogJ3dvcmtlcl9vZmZsaW5lJywgcmVmOiAnc2FtcGxlJywgY291bnRlcnM6IHsgd29ya2Vyc19vbmxpbmU6IDIsIHdvcmtlcnNfdG90YWw6IDIgfSB9LFxuICAgICAgICAnbG9jYWxfc3R0Lndvcmtlcl9vZmZsaW5lJzogeyBjb2RlOiAnd29ya2VyX29mZmxpbmUnLCByZWY6ICdzYW1wbGUnLCBjb3VudGVyczogeyB3b3JrZXJzX29ubGluZTogMiwgd29ya2Vyc190b3RhbDogMyB9IH0sXG4gICAgICAgICdsb2NhbF9zdHQud29ya2VyX29ubGluZSc6IHsgY29kZTogJ3dvcmtlcl9vZmZsaW5lJywgcmVmOiAnc2FtcGxlJywgY291bnRlcnM6IHsgd29ya2Vyc19vbmxpbmU6IDMsIHdvcmtlcnNfdG90YWw6IDMgfSB9LFxuICAgICAgICAnbG9jYWxfc3R0LmJhY2tsb2dfbm9fd29ya2Vycyc6IHsgY29kZTogJ2JhY2tsb2dfbm9fd29ya2VycycsIHJlZjogJ3F1ZXVlJywgY291bnRlcnM6IHsgd29ya2Vyc19vbmxpbmU6IDAsIHdvcmtlcnNfdG90YWw6IDMsIGpvYnNfd2FpdGluZzogMTIgfSB9LFxuICAgICAgICAnbG9jYWxfc3R0LmJhY2tsb2dfcmVzb2x2ZWQnOiB7IGNvZGU6ICdiYWNrbG9nX25vX3dvcmtlcnMnLCByZWY6ICdxdWV1ZScsIGNvdW50ZXJzOiB7IHdvcmtlcnNfb25saW5lOiAzLCB3b3JrZXJzX3RvdGFsOiAzLCBqb2JzX3dhaXRpbmc6IDAgfSB9LFxuICAgICAgICAnY2xvdWRfc3R0LmluY2lkZW50JzogeyBjb2RlOiAnaW5jaWRlbnRfb3BlbicsIHJlZjogJ3NhbXBsZScsIGNvdW50ZXJzOiB7IGluY2lkZW50c19vcGVuOiAxIH0gfSxcbiAgICAgICAgJ2Nsb3VkX3N0dC5pbmNpZGVudF9yZXNvbHZlZCc6IHsgY29kZTogJ2luY2lkZW50X29wZW4nLCByZWY6ICdzYW1wbGUnLCBjb3VudGVyczogeyBpbmNpZGVudHNfb3BlbjogMCB9IH0sXG4gICAgICAgICdjbG91ZF9zdHQucGF1c2VkJzogeyBjb2RlOiAncHJvY2Vzc2luZ19wYXVzZWQnLCByZWY6ICdtYWludGVuYW5jZScsIGNvdW50ZXJzOiB7fSB9LFxuICAgICAgICAnY2xvdWRfc3R0LnJlc3VtZWQnOiB7IGNvZGU6ICdwcm9jZXNzaW5nX3BhdXNlZCcsIHJlZjogJ21haW50ZW5hbmNlJywgY291bnRlcnM6IHt9IH0sXG4gICAgICAgICdjbG91ZF9haS5wYXVzZWQnOiB7IGNvZGU6ICdwcm9jZXNzaW5nX3BhdXNlZCcsIHJlZjogJ2luc3VmZmljaWVudF9mdW5kcycsIGNvdW50ZXJzOiB7IGpvYnNfd2FpdGluZzogMTIgfSB9LFxuICAgICAgICAnY2xvdWRfYWkucmVzdW1lZCc6IHsgY29kZTogJ3Byb2Nlc3NpbmdfcGF1c2VkJywgcmVmOiAnaW5zdWZmaWNpZW50X2Z1bmRzJywgY291bnRlcnM6IHsgam9ic193YWl0aW5nOiAwIH0gfVxuICAgIH07XG5cbiAgICBmdW5jdGlvbiByZW5kZXJXaXphcmRQcmV2aWV3KCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgdmFyIHR5cGUgPSB3aXphcmRQcmV2aWV3Q2FsbFR5cGUody5ldmVudFR5cGVzKTtcbiAgICAgICAgaWYgKHR5cGUgPT09ICcnKSB7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLXByZXZpZXcsICNtaC13aXphcmQtcHJldmlldy10YXJnZXQnKS5lbXB0eSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBodG1sID0gd2l6YXJkUHJldmlld0J1YmJsZSh0eXBlLCB3KTtcbiAgICAgICAgLy8gdGhlIHJlY292ZXJ5IHN3aXRjaCBpcyBwYXJ0IG9mIHRoZSBwcmV2aWV3OiBhIHNlY29uZCBidWJibGUgc2hvd3Mgd2hhdCB0aGUgcmVjb3ZlcnkgbG9va3MgbGlrZVxuICAgICAgICB2YXIgcmVjb3ZlcnkgPSBTVEFUVVNfUEFJUlNbdHlwZV07XG4gICAgICAgIGlmIChyZWNvdmVyeSAmJiB3LmV2ZW50VHlwZXMuaW5kZXhPZihyZWNvdmVyeSkgPj0gMCkge1xuICAgICAgICAgICAgaHRtbCArPSB3aXphcmRQcmV2aWV3QnViYmxlKHJlY292ZXJ5LCB3KTtcbiAgICAgICAgfVxuICAgICAgICAvLyB0aGUgbWVzc2VuZ2VyIGlzIHBhcnQgb2YgdGhlIHByZXZpZXcsIHNvIHRoZSBhc2lkZSBzYXlzIHdoaWNoIGJ1YmJsZSBpdCBzaG93c1xuICAgICAgICAvLyAodGhlIGRlc2lnbiBoYXMgbm8gdmlzaWJsZSBjYXB0aW9uIGFib3ZlIHRoZSBidWJibGUpXG4gICAgICAgICQoJy5taC13aXphcmQtcHJldmlldycpLmF0dHIoJ2FyaWEtbGFiZWwnLFxuICAgICAgICAgICAgdCh3aXphcmRJc01heCgpID8gJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFByZXZpZXdDaGFubmVsTWF4JyA6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRQcmV2aWV3VGl0bGUnKSk7XG4gICAgICAgIC8vIHN0ZXAgMiBzaG93cyB0aGUgY29uZGl0aW9ucyBwcmV2aWV3LCBzdGVwIDMgdGhlIHNhbWUgcHJldmlldyBmb3IgdGhlIGNob3NlbiBib3RcbiAgICAgICAgJCgnI21oLXdpemFyZC1wcmV2aWV3LCAjbWgtd2l6YXJkLXByZXZpZXctdGFyZ2V0JykuaHRtbChodG1sKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRQcmV2aWV3QnViYmxlKHR5cGUsIHcpIHtcbiAgICAgICAgdmFyIG5hbWVzID0gZXZlbnRUeXBlTmFtZXMoKTtcbiAgICAgICAgdmFyIHRpdGxlID0gbmFtZXNbdHlwZV0gfHwgdHlwZTtcbiAgICAgICAgaWYgKHR5cGUgPT09ICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJykge1xuICAgICAgICAgICAgdGl0bGUgKz0gJyDCtyAnICsgdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VRdWFsaXR5U2NvcmUnLCB7IHNjb3JlOiA0OCB9KTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcGhvbmUgPSB3Lm1hc2sgPyAnKzcgOTY4ICoqKi0qKi00NCcgOiAnKzcgOTY4IDk2OC05NC00NCc7XG4gICAgICAgIHZhciBsaW5lcyA9IFtdO1xuICAgICAgICB2YXIgbm90ZXMgPSBbXTtcbiAgICAgICAgdmFyIGJ1dHRvbiA9IGZhbHNlO1xuICAgICAgICB2YXIgZGlyZWN0aW9uID0gdy5maWx0ZXJzLmRpcmVjdGlvbnMubGVuZ3RoID09PSAxID8gdy5maWx0ZXJzLmRpcmVjdGlvbnNbMF0gOiAnaW5jb21pbmcnO1xuICAgICAgICBzd2l0Y2ggKHR5cGUpIHtcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUubWlzc2VkX2NhbGwnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goJzxiPicgKyBlc2MocGhvbmUpICsgJzwvYj4g4oaSINCY0LLQsNC90L7QsiDQmC4gKDIzMyknKTtcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYygnMDIuMTAuMjAyNiAxNTo0MSDCtyAnICsgdCh7XG4gICAgICAgICAgICAgICAgICAgIGluY29taW5nOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZURpcmVjdGlvbkluY29taW5nJyxcbiAgICAgICAgICAgICAgICAgICAgb3V0Z29pbmc6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlRGlyZWN0aW9uT3V0Z29pbmcnLFxuICAgICAgICAgICAgICAgICAgICBpbnRlcm5hbDogJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VEaXJlY3Rpb25JbnRlcm5hbCdcbiAgICAgICAgICAgICAgICB9W2RpcmVjdGlvbl0pKSk7XG4gICAgICAgICAgICAgICAgYnV0dG9uID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUudm9pY2VtYWlsJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlVm9pY2VtYWlsSGludCcpKSk7XG4gICAgICAgICAgICAgICAgYnV0dG9uID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKCfQn9C10YLRgNC+0LLQsCDQkC4gKDI0MSkg4oaQICcgKyAody5tYXNrID8gJys3IDkxNiAqKiotKiotMTcnIDogJys3IDkxNiAyMDQtNTUtMTcnKSArICcgwrcgNjo0MicpKTtcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYyh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZVJlYXNvbnMnLCB7IHJlYXNvbnM6ICfQmtC70LjQtdC90YLRgyDQvdC1INC/0L7QvNC+0LPQu9C4OyDQv9C+0LLRgtC+0YDQvdGL0Lkg0LfQstC+0L3QvtC6JyB9KSkpO1xuICAgICAgICAgICAgICAgIG5vdGVzLnB1c2goJ9Ca0LvQuNC10L3RgtGDINC90LUg0L/QvtC80L7Qs9C70Lg6INC00LLQsNC20LTRiyDQvtGC0L/RgNCw0LLQuNC70Lgg0L3QsCDRgdCw0LnRgiwg0YDQtdGI0LXQvdC40Y8g0L3QtSDQv9GA0LXQtNC70L7QttC40LvQuC4nKTtcbiAgICAgICAgICAgICAgICBidXR0b24gPSB0cnVlO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAndm9pY2VfYWdlbnQuY2FsbGJhY2tfcmVxdWVzdCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2MoJ9Cf0ZHRgtGAIMK3ICcgKyBwaG9uZSkpO1xuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlVG9waWMnLCB7IHRvcGljOiAn0JLQvtC30LLRgNCw0YInIH0pKSk7XG4gICAgICAgICAgICAgICAgYnV0dG9uID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUucHJvdmlkZXJfZG93bic6XG4gICAgICAgICAgICBjYXNlICdjb3JlLnByb3ZpZGVyX3VwJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYygnU0lQIMKr0JzQtdCz0LDRhNC+0L3CuyDCtyAxMC4wLjAuMScpKTtcbiAgICAgICAgICAgICAgICBub3Rlcy5wdXNoKCdyZWdpc3RlcmVkIOKGkiB1bnJlZ2lzdGVyZWQnKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29mZmxpbmUnOlxuICAgICAgICAgICAgY2FzZSAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb25saW5lJzpcbiAgICAgICAgICAgIGNhc2UgJ2xvY2FsX3N0dC53b3JrZXJfb2ZmbGluZSc6XG4gICAgICAgICAgICBjYXNlICdsb2NhbF9zdHQud29ya2VyX29ubGluZSc6XG4gICAgICAgICAgICBjYXNlICdsb2NhbF9zdHQuYmFja2xvZ19ub193b3JrZXJzJzpcbiAgICAgICAgICAgIGNhc2UgJ2xvY2FsX3N0dC5iYWNrbG9nX3Jlc29sdmVkJzpcbiAgICAgICAgICAgIGNhc2UgJ2Nsb3VkX3N0dC5pbmNpZGVudCc6XG4gICAgICAgICAgICBjYXNlICdjbG91ZF9zdHQuaW5jaWRlbnRfcmVzb2x2ZWQnOlxuICAgICAgICAgICAgY2FzZSAnY2xvdWRfc3R0LnBhdXNlZCc6XG4gICAgICAgICAgICBjYXNlICdjbG91ZF9zdHQucmVzdW1lZCc6XG4gICAgICAgICAgICBjYXNlICdjbG91ZF9haS5wYXVzZWQnOlxuICAgICAgICAgICAgY2FzZSAnY2xvdWRfYWkucmVzdW1lZCc6XG4gICAgICAgICAgICAgICAgdmFyIHNhbXBsZSA9IFNUQVRVU19QUkVWSUVXX1NBTVBMRVNbdHlwZV07XG4gICAgICAgICAgICAgICAgaWYgKHdpemFyZFN1cHBvcnRzUmVhc29ucyhbdHlwZV0pICYmIHcuZmlsdGVycy5yZWFzb25zICYmIHcuZmlsdGVycy5yZWFzb25zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gdGhlIHNhbXBsZSBzaG93cyB0aGUgZmlyc3Qgc2VsZWN0ZWQgcGF1c2UgcmVhc29uLCBzbyB0aGUgY2hvaWNlIGlzIHZpc2libGVcbiAgICAgICAgICAgICAgICAgICAgc2FtcGxlID0gJC5leHRlbmQoe30sIHNhbXBsZSwgeyByZWY6IHcuZmlsdGVycy5yZWFzb25zWzBdIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB2YXIgc2NlbmFyaW9Tb3VyY2UgPSBzb3VyY2VCeUlkKHcuc291cmNlSWQpO1xuICAgICAgICAgICAgICAgIGlmIChzY2VuYXJpb1NvdXJjZSAmJiBzY2VuYXJpb1NvdXJjZS5tb2R1bGVfbmFtZSkge1xuICAgICAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYyhzY2VuYXJpb1NvdXJjZS5tb2R1bGVfbmFtZSkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYyhzdGF0dXNQaHJhc2UodHlwZSwgc2FtcGxlKSkpO1xuICAgICAgICAgICAgICAgIHN0YXR1c0NvdW50ZXJOb3RlcyhzYW1wbGUpLmZvckVhY2goZnVuY3Rpb24gKG5vdGUpIHsgbm90ZXMucHVzaChub3RlKTsgfSk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICd2b2ljZV9hZ2VudC5ydW50aW1lX2Rvd24nOlxuICAgICAgICAgICAgY2FzZSAndm9pY2VfYWdlbnQucnVudGltZV91cCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaCgnY29ubmVjdGlvbiByZWZ1c2VkJyk7XG4gICAgICAgICAgICAgICAgbm90ZXMucHVzaCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZUxhdGVuY3knLCB7IG1zOiAxMjAwIH0pKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUuYWR2aWNlJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYygn0KHQstC+0LHQvtC00L3QviA4ICUg0L3QsCDRgNCw0LfQtNC10LvQtSAvc3RvcmFnZScpKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUucGJ4X3N0YXJ0ZWQnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goJzAyLjEwLjIwMjYgMDM6MTAnKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICB2YXIgaXNNYXggPSB3aXphcmRJc01heCgpO1xuICAgICAgICB2YXIgaHRtbCA9ICc8ZGl2IGNsYXNzPVwibWgtcHJldmlldy1tc2cnICsgKGlzTWF4ID8gJyBpcy1tYXgnIDogJycpICsgJ1wiPjxkaXY+JyArIGVzYyhpY29uRm9yVHlwZSh0eXBlKSkgKyAnIDxiPicgKyBlc2ModGl0bGUpICsgJzwvYj48L2Rpdj4nO1xuICAgICAgICBsaW5lcy5mb3JFYWNoKGZ1bmN0aW9uIChsaW5lKSB7IGh0bWwgKz0gJzxkaXY+JyArIGxpbmUgKyAnPC9kaXY+JzsgfSk7XG4gICAgICAgIG5vdGVzLmZvckVhY2goZnVuY3Rpb24gKG5vdGUpIHsgaHRtbCArPSAnPGRpdj48aT4nICsgZXNjKG5vdGUpICsgJzwvaT48L2Rpdj4nOyB9KTtcbiAgICAgICAgaHRtbCArPSAnPHNwYW4gY2xhc3M9XCJtaC1wcmV2aWV3LXRpbWVcIj4xNTo0MTwvc3Bhbj48L2Rpdj4nO1xuICAgICAgICBodG1sICs9IHdpemFyZFByZXZpZXdBdWRpbyh0eXBlLCB3LmF0dGFjaG1lbnRzLCBpc01heCk7XG4gICAgICAgIGlmIChidXR0b24pIHtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJtaC1wcmV2aWV3LWJ1dHRvbicgKyAoaXNNYXggPyAnIGlzLW1heCcgOiAnJykgKyAnXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRQcmV2aWV3QnV0dG9uJykpICsgJyDihpc8L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBodG1sO1xuICAgIH1cblxuICAgIC8vIEF1ZGlvIGJ1YmJsZXMgZm9sbG93IHRoZSB0ZXh0IChQbGFuLzAzKTogZnJhZ21lbnRzID0gb25lIGJ1YmJsZSBwZXIgZnJhZ21lbnQsIG90aGVyd2lzZSB0aGUgd2hvbGUgZmlsZS5cbiAgICAvLyBUaGUgbnVtYmVycyBhcmUgc2FtcGxlIHZhbHVlcyBvZiB0aGUgcHJldmlldywgbmV2ZXIgcmVhbCBkYXRhLlxuICAgIGZ1bmN0aW9uIHdpemFyZFByZXZpZXdBdWRpbyh0eXBlLCBtb2RlLCBpc01heCkge1xuICAgICAgICBpZiAobW9kZSA9PT0gJ25vbmUnIHx8IHdpemFyZEF0dGFjaG1lbnRNb2RlcyhbdHlwZV0pLmluZGV4T2YobW9kZSkgPCAwKSB7IHJldHVybiAnJzsgfVxuICAgICAgICB2YXIgaXRlbXMgPSBbXTtcbiAgICAgICAgaWYgKG1vZGUgPT09ICdmcmFnbWVudHMnKSB7XG4gICAgICAgICAgICB2YXIgc2FtcGxlID0gWycwOjEyJywgJzA6MTgnXTtcbiAgICAgICAgICAgIHNhbXBsZS5mb3JFYWNoKGZ1bmN0aW9uIChkdXJhdGlvbiwgaW5kZXgpIHtcbiAgICAgICAgICAgICAgICBpdGVtcy5wdXNoKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QcmV2aWV3QXVkaW9GcmFnbWVudCcsIHsgbjogaW5kZXggKyAxLCB0b3RhbDogc2FtcGxlLmxlbmd0aCwgZHVyYXRpb246IGR1cmF0aW9uIH0pKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaXRlbXMucHVzaCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfUHJldmlld0F1ZGlvUmVjb3JkaW5nJywgeyBkdXJhdGlvbjogdHlwZSA9PT0gJ2NvcmUudm9pY2VtYWlsJyA/ICcwOjMyJyA6ICc2OjQyJyB9KSk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGh0bWwgPSAnJztcbiAgICAgICAgaXRlbXMuZm9yRWFjaChmdW5jdGlvbiAoY2FwdGlvbikge1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIm1oLXByZXZpZXctbXNnIG1oLXByZXZpZXctYXVkaW8nICsgKGlzTWF4ID8gJyBpcy1tYXgnIDogJycpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtcHJldmlldy1hdWRpby1yb3dcIj48c3BhbiBjbGFzcz1cIm1oLXByZXZpZXctcGxheVwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjwvc3Bhbj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1wcmV2aWV3LXdhdmVcIiBhcmlhLWhpZGRlbj1cInRydWVcIj48L3NwYW4+PC9kaXY+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1tZXRhXCI+JyArIGVzYyhjYXB0aW9uKSArICc8L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1wcmV2aWV3LXRpbWVcIj4xNTo0MTwvc3Bhbj48L2Rpdj4nO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIGh0bWw7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaWNvbkZvclR5cGUodHlwZSkge1xuICAgICAgICBpZiAodHlwZSA9PT0gJ2NvcmUubWlzc2VkX2NhbGwnIHx8IHR5cGUgPT09ICd2b2ljZV9hZ2VudC5jYWxsYmFja19yZXF1ZXN0JykgeyByZXR1cm4gJ/Cfk54nOyB9XG4gICAgICAgIGlmICh0eXBlID09PSAnY29yZS52b2ljZW1haWwnKSB7IHJldHVybiAn8J+OmSc7IH1cbiAgICAgICAgaWYgKHR5cGUgPT09ICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJyB8fCB0eXBlID09PSAnY29yZS5wcm92aWRlcl9kb3duJyB8fCB0eXBlID09PSAndm9pY2VfYWdlbnQucnVudGltZV9kb3duJykgeyByZXR1cm4gJ+KaoO+4jyc7IH1cbiAgICAgICAgaWYgKFNUQVRVU19SRUNPVkVSWV9LRVlTW3R5cGVdIHx8IHR5cGUgPT09ICdjb3JlLnByb3ZpZGVyX3VwJyB8fCB0eXBlID09PSAndm9pY2VfYWdlbnQucnVudGltZV91cCcpIHsgcmV0dXJuICfinIUnOyB9XG4gICAgICAgIGlmICh0eXBlID09PSAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb2ZmbGluZScgfHwgdHlwZSA9PT0gJ2xvY2FsX3N0dC53b3JrZXJfb2ZmbGluZScpIHsgcmV0dXJuICfwn5SMJzsgfVxuICAgICAgICBpZiAodHlwZSA9PT0gJ2NvcmUucGJ4X3N0YXJ0ZWQnKSB7IHJldHVybiAn8J+UhCc7IH1cbiAgICAgICAgcmV0dXJuICfimqDvuI8nO1xuICAgIH1cblxuICAgIC8vIC0tLS0gbmF2aWdhdGlvbiBhbmQgc2F2ZSAtLS0tXG5cbiAgICBmdW5jdGlvbiB3aXphcmROZXh0KCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgaWYgKHcuc3RlcCA9PT0gMSkge1xuICAgICAgICAgICAgaWYgKCF3LnNvdXJjZUlkKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdy5zdGVwID0gZmlyc3RTdGVwQWZ0ZXJTY2VuYXJpbyh3LmV2ZW50VHlwZXMpO1xuICAgICAgICAgICAgcmVuZGVyV2l6YXJkKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHcuc3RlcCA9PT0gMikge1xuICAgICAgICAgICAgaWYgKHdpemFyZFN1cHBvcnRzUmVhc29ucyh3LmV2ZW50VHlwZXMpICYmICghdy5maWx0ZXJzLnJlYXNvbnMgfHwgdy5maWx0ZXJzLnJlYXNvbnMubGVuZ3RoID09PSAwKSkge1xuICAgICAgICAgICAgICAgIHNob3dXaXphcmRFcnJvcih0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRSZWFzb25zUmVxdWlyZWQnKSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdy5zdGVwID0gMztcbiAgICAgICAgICAgIHJlbmRlcldpemFyZCgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHNhdmVSdWxlKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2l6YXJkUHJldigpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgIGlmICgkKCcjbWgtd2l6YXJkLXByZXYnKS5kYXRhKCdtb2RlJykgIT09ICdiYWNrJykge1xuICAgICAgICAgICAgY2xvc2VSdWxlV2l6YXJkKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHcuc3RlcCA9PT0gMyAmJiB3aXphcmRIYXNDb25kaXRpb25zKHcuZXZlbnRUeXBlcykpIHtcbiAgICAgICAgICAgIHcuc3RlcCA9IDI7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB3LnN0ZXAgPSAxO1xuICAgICAgICB9XG4gICAgICAgIGNsZWFyV2l6YXJkRXJyb3IoKTtcbiAgICAgICAgcmVuZGVyV2l6YXJkKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcHJ1bmVGaWx0ZXJzKGZpbHRlcnMpIHtcbiAgICAgICAgdmFyIHJlc3VsdCA9IHt9O1xuICAgICAgICBpZiAoZmlsdGVycy51c2VyX2lkcy5sZW5ndGggPiAwKSB7IHJlc3VsdC51c2VyX2lkcyA9IGZpbHRlcnMudXNlcl9pZHM7IH1cbiAgICAgICAgaWYgKGZpbHRlcnMuZGlyZWN0aW9ucy5sZW5ndGggPiAwKSB7IHJlc3VsdC5kaXJlY3Rpb25zID0gZmlsdGVycy5kaXJlY3Rpb25zOyB9XG4gICAgICAgIGlmIChmaWx0ZXJzLnByb3ZpZGVycy5sZW5ndGggPiAwKSB7IHJlc3VsdC5wcm92aWRlcnMgPSBmaWx0ZXJzLnByb3ZpZGVyczsgfVxuICAgICAgICAvLyBldmVyeSByZWFzb24gc2VsZWN0ZWQgPSBubyBmaWx0ZXIgKGEgbWFudWFsIHBhdXNlIGluY2x1ZGVkKTsgYSBzdWJzZXQgaXMgc3RvcmVkIGFzIGNob3NlblxuICAgICAgICBpZiAoZmlsdGVycy5yZWFzb25zICYmIGZpbHRlcnMucmVhc29ucy5sZW5ndGggPiAwICYmIGZpbHRlcnMucmVhc29ucy5sZW5ndGggPCBjbG91ZEFpUmVhc29ucyh0cnVlKS5sZW5ndGgpIHtcbiAgICAgICAgICAgIHJlc3VsdC5yZWFzb25zID0gZmlsdGVycy5yZWFzb25zO1xuICAgICAgICB9XG4gICAgICAgIGlmIChmaWx0ZXJzLnF1YWxpdHlfc2NvcmUgIT09IG51bGwgJiYgT2JqZWN0LmtleXMoZmlsdGVycy5xdWFsaXR5X3Njb3JlKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICByZXN1bHQucXVhbGl0eV9zY29yZSA9IGZpbHRlcnMucXVhbGl0eV9zY29yZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVSdWxlKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgdmFyIHNjZW5hcmlvID0gd2l6YXJkU2NlbmFyaW8oKTtcbiAgICAgICAgLy8gdGhlIHdpemFyZCBoYXMgbm8gbmFtZSBmaWVsZCAoZGVzaWduIHYzKTogYSBuZXcgbm90aWZpY2F0aW9uIGlzIG5hbWVkIGFmdGVyIGl0cyBzY2VuYXJpb1xuICAgICAgICB2YXIgdGl0bGUgPSBTdHJpbmcody50aXRsZSB8fCAnJykudHJpbSgpIHx8IChzY2VuYXJpbyA/IHNjZW5hcmlvLm5hbWUgOiAnJyk7XG4gICAgICAgIGlmICh0aXRsZSA9PT0gJycpIHtcbiAgICAgICAgICAgIHNob3dXaXphcmRFcnJvcih0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRUaXRsZVJlcXVpcmVkJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3LnRhcmdldE1vZGUgIT09ICdlbXBsb3llZScgJiYgdy5jaGF0SWRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgc2hvd1dpemFyZEVycm9yKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZE5lZWRDaGF0cycpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB2YXIgb3B0aW9ucyA9IHsgbWFza19waG9uZTogdy5tYXNrIH07XG4gICAgICAgIGlmICh3LmV2ZW50VHlwZXMuaW5kZXhPZignY29yZS5taXNzZWRfY2FsbCcpID49IDApIHtcbiAgICAgICAgICAgIG9wdGlvbnMucmV0cmFjdF9vbl9jYWxsYmFjayA9IHtcbiAgICAgICAgICAgICAgICBlbmFibGVkOiB3LnJldHJhY3QuZW5hYmxlZCA9PT0gdHJ1ZSxcbiAgICAgICAgICAgICAgICB3aW5kb3dfbWluOiB3LnJldHJhY3Qud2luZG93X21pbiA+PSA1ICYmIHcucmV0cmFjdC53aW5kb3dfbWluIDw9IDEyMCA/IHcucmV0cmFjdC53aW5kb3dfbWluIDogMjAsXG4gICAgICAgICAgICAgICAgY291bnRfaW5jb21pbmdfYW5zd2VyZWQ6IHcucmV0cmFjdC5jb3VudF9pbmNvbWluZ19hbnN3ZXJlZCAhPT0gZmFsc2VcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHdpemFyZEF0dGFjaG1lbnRNb2Rlcyh3LmV2ZW50VHlwZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIG9wdGlvbnMuYXR0YWNobWVudHMgPSB3LmF0dGFjaG1lbnRzO1xuICAgICAgICB9XG4gICAgICAgIHZhciBwYXlsb2FkID0ge1xuICAgICAgICAgICAgdGl0bGU6IHRpdGxlLFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGV2ZW50X3R5cGVzOiB3LmV2ZW50VHlwZXMsXG4gICAgICAgICAgICBtaW5fc2V2ZXJpdHk6IHdpemFyZFN1cHBvcnRzU2V2ZXJpdHkody5ldmVudFR5cGVzKSA/IHcubWluU2V2ZXJpdHkgOiAnaW5mbycsXG4gICAgICAgICAgICBmaWx0ZXJzOiBwcnVuZUZpbHRlcnMod2l6YXJkU3VwcG9ydHNSZWFzb25zKHcuZXZlbnRUeXBlcykgPyB3LmZpbHRlcnMgOiAkLmV4dGVuZCh7fSwgdy5maWx0ZXJzLCB7IHJlYXNvbnM6IG51bGwgfSkpLFxuICAgICAgICAgICAgdGFyZ2V0X21vZGU6IHcudGFyZ2V0TW9kZSxcbiAgICAgICAgICAgIGNoYXRfaWRzOiB3LmNoYXRJZHMsXG4gICAgICAgICAgICBvcHRpb25zOiBvcHRpb25zXG4gICAgICAgIH07XG4gICAgICAgIHZhciBkb25lID0gZnVuY3Rpb24gKHJ1bGUpIHtcbiAgICAgICAgICAgIGNsb3NlUnVsZVdpemFyZCgpO1xuICAgICAgICAgICAgcmVwbGFjZVJ1bGUocnVsZSk7XG4gICAgICAgICAgICBsb2FkUnVsZXModHJ1ZSk7XG4gICAgICAgICAgICBzaG93VG9hc3QodCh3LmVkaXRJZCA+IDAgPyAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkU2F2ZWQnIDogJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZENyZWF0ZWQnKSk7XG4gICAgICAgIH07XG4gICAgICAgIHZhciBmYWlsdXJlID0gZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgc2hvd1dpemFyZEVycm9yKGZhaWx1cmVUZXh0KGVycikpO1xuICAgICAgICB9O1xuICAgICAgICBpZiAody5lZGl0SWQgPiAwKSB7XG4gICAgICAgICAgICBhcGlQYXRjaCgnL3J1bGVzLycgKyB3LmVkaXRJZCwgcGF5bG9hZCwgZG9uZSwgZmFpbHVyZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBhcGlQb3N0KCcvcnVsZXMnLCBwYXlsb2FkLCBkb25lLCBmYWlsdXJlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNob3dXaXphcmRFcnJvcih0ZXh0KSB7XG4gICAgICAgICQoJyNtaC13aXphcmQgLm1oLXdpemFyZC1lcnJvci1zbG90JykuaHRtbCgnPGRpdiBjbGFzcz1cInVpIG5lZ2F0aXZlIG1lc3NhZ2VcIiByb2xlPVwiYWxlcnRcIj4nICsgSUNPTl9FUlJPUlxuICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLWdyb3dcIj4nICsgZXNjKHRleHQpICsgJzwvZGl2PjwvZGl2PicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNsZWFyV2l6YXJkRXJyb3IoKSB7XG4gICAgICAgICQoJyNtaC13aXphcmQgLm1oLXdpemFyZC1lcnJvci1zbG90JykuZW1wdHkoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBiaW5kV2l6YXJkQ29udHJvbHMoKSB7XG4gICAgICAgICQoJyNtaC1ydWxlLWFkZCcpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHsgb3BlblJ1bGVXaXphcmQobnVsbCk7IH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLWJhY2snKS5vbignY2xpY2snLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBjbG9zZVJ1bGVXaXphcmQoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtbmV4dCcpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICgkKHRoaXMpLnByb3AoJ2Rpc2FibGVkJykpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICBjbGVhcldpemFyZEVycm9yKCk7XG4gICAgICAgICAgICB3aXphcmROZXh0KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXByZXYnKS5vbignY2xpY2snLCB3aXphcmRQcmV2KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1vcGVuLXNldHRpbmdzJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgY2xvc2VSdWxlV2l6YXJkKCk7XG4gICAgICAgICAgICAkKCcjbWgtdGFicyAuaXRlbVtkYXRhLXRhYj1cInNldHRpbmdzXCJdJykudHJpZ2dlcignY2xpY2snKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtc2NlbmFyaW9zJykub24oJ2NsaWNrJywgJy5taC1zY2VuYXJpbycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBzb3VyY2UgPSBzb3VyY2VCeUlkKCQodGhpcykuZGF0YSgnc291cmNlLWlkJykpO1xuICAgICAgICAgICAgaWYgKCFzb3VyY2UgfHwgJCh0aGlzKS5oYXNDbGFzcygnaXMtZGlzYWJsZWQnKSkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgICAgIGlmICh3LnNvdXJjZUlkICE9PSBzb3VyY2UuaWQpIHtcbiAgICAgICAgICAgICAgICB3LnNvdXJjZUlkID0gc291cmNlLmlkO1xuICAgICAgICAgICAgICAgIHcuZXZlbnRUeXBlcyA9IChzb3VyY2UuZXZlbnRfdHlwZXMgfHwgW10pLm1hcChmdW5jdGlvbiAodHlwZSkgeyByZXR1cm4gdHlwZS50eXBlOyB9KTtcbiAgICAgICAgICAgICAgICBpZiAody5lZGl0SWQgPT09IDApIHsgdy50aXRsZSA9IHNvdXJjZS5uYW1lOyB9XG4gICAgICAgICAgICAgICAgdy5maWx0ZXJzID0gZW1wdHlGaWx0ZXJzKCk7XG4gICAgICAgICAgICAgICAgdy5yZWNvdmVyID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB3Lm1pblNldmVyaXR5ID0gJ3dhcm5pbmcnO1xuICAgICAgICAgICAgICAgIGlmICh3aXphcmRTdXBwb3J0c1JlYXNvbnMody5ldmVudFR5cGVzKSkge1xuICAgICAgICAgICAgICAgICAgICB3LmZpbHRlcnMucmVhc29ucyA9IGNsb3VkQWlSZWFzb25zKGZhbHNlKTsgLy8gbmV3IHJ1bGU6IGV2ZXJ5dGhpbmcgZXhjZXB0IGEgbWFudWFsIHBhdXNlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVuZGVyV2l6YXJkU2NlbmFyaW9zKCk7XG4gICAgICAgICAgICB1cGRhdGVXaXphcmROZXh0KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXNjZW5hcmlvcycpLm9uKCdkYmxjbGljaycsICcubWgtc2NlbmFyaW86bm90KC5pcy1kaXNhYmxlZCknLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB3aXphcmROZXh0KCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gdGFicyAmIGF1dG9yZWZyZXNoIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGluaXRUYWJzKCkge1xuICAgICAgICAkKCcjbWgtdGFicyAuaXRlbScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciB0YWIgPSAkKHRoaXMpLmRhdGEoJ3RhYicpO1xuICAgICAgICAgICAgJCgnI21oLXRhYnMgLml0ZW0nKS5yZW1vdmVDbGFzcygnYWN0aXZlJyk7XG4gICAgICAgICAgICAkKHRoaXMpLmFkZENsYXNzKCdhY3RpdmUnKTtcbiAgICAgICAgICAgICQoJyNtZXNzZW5nZXItaHViLXJvb3QgLm1oLXRhYi1wYW5lJykucmVtb3ZlQ2xhc3MoJ2FjdGl2ZScpO1xuICAgICAgICAgICAgJCgnI21lc3Nlbmdlci1odWItcm9vdCAubWgtdGFiLXBhbmVbZGF0YS10YWI9XCInICsgdGFiICsgJ1wiXScpLmFkZENsYXNzKCdhY3RpdmUnKTtcbiAgICAgICAgICAgICQoJyNtZXNzZW5nZXItaHViLXJvb3QnKS5hdHRyKCdkYXRhLWFjdGl2ZS10YWInLCB0YWIpO1xuICAgICAgICAgICAgaWYgKHRhYiA9PT0gJ25vdGlmaWNhdGlvbnMnKSB7XG4gICAgICAgICAgICAgICAgbG9hZFJ1bGVzKHRydWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRhYiA9PT0gJ3NldHRpbmdzJykge1xuICAgICAgICAgICAgICAgIGxvYWRHZW5lcmFsU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgICBsb2FkRW1wbG95ZWVzKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgbG9hZEJvdHMoKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gam91cm5hbFZpc2libGUoKSB7XG4gICAgICAgIHJldHVybiAkKCcjbWVzc2VuZ2VyLWh1Yi1yb290IC5taC10YWItcGFuZVtkYXRhLXRhYj1cImpvdXJuYWxcIl0nKS5oYXNDbGFzcygnYWN0aXZlJylcbiAgICAgICAgICAgICYmIGRvY3VtZW50LnZpc2liaWxpdHlTdGF0ZSA9PT0gJ3Zpc2libGUnO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG5vdGlmaWNhdGlvbnNWaXNpYmxlKCkge1xuICAgICAgICByZXR1cm4gJCgnI21lc3Nlbmdlci1odWItcm9vdCAubWgtdGFiLXBhbmVbZGF0YS10YWI9XCJub3RpZmljYXRpb25zXCJdJykuaGFzQ2xhc3MoJ2FjdGl2ZScpXG4gICAgICAgICAgICAmJiBkb2N1bWVudC52aXNpYmlsaXR5U3RhdGUgPT09ICd2aXNpYmxlJztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzY2hlZHVsZVJlZnJlc2goKSB7XG4gICAgICAgIHNldEludGVydmFsKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChqb3VybmFsVmlzaWJsZSgpKSB7XG4gICAgICAgICAgICAgICAgbG9hZCh7IHJlZnJlc2g6IHRydWUgfSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG5vdGlmaWNhdGlvbnNWaXNpYmxlKCkgJiYgc3RhdGUucnVsZVdpemFyZCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIGxvYWRSdWxlcyh0cnVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkb2N1bWVudC52aXNpYmlsaXR5U3RhdGUgPT09ICd2aXNpYmxlJykge1xuICAgICAgICAgICAgICAgIGxvYWRKb3VybmFsQmFkZ2UoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSwgUkVGUkVTSF9TRUMgKiAxMDAwKTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGluaXQgLS0tLS0tLS0tLVxuXG4gICAgJChkb2N1bWVudCkucmVhZHkoZnVuY3Rpb24gKCkge1xuICAgICAgICByb290ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ21lc3Nlbmdlci1odWItcm9vdCcpO1xuICAgICAgICBpZiAoIXJvb3QpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpbml0VGFicygpO1xuICAgICAgICBidWlsZFBlcmlvZE1lbnUoKTtcbiAgICAgICAgcmVuZGVyU2tlbGV0b24oKTtcblxuICAgICAgICAvLyBvdXIgY2hlY2tib3hlcyBhcmUgcGxhaW4gbGFiZWxzIGFyb3VuZCBoaWRkZW4gaW5wdXRzOiBrZWVwIHRoZSB2aXN1YWwgc3RhdGUgaW4gc3luY1xuICAgICAgICAkKGRvY3VtZW50KS5vbignY2hhbmdlJywgJy5tb2R1bGUtbWVzc2VuZ2VyLWh1YiAudWkuY2hlY2tib3ggaW5wdXQsIC5taC1tb2RhbCAudWkuY2hlY2tib3ggaW5wdXQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgJGlucHV0ID0gJCh0aGlzKTtcbiAgICAgICAgICAgIGlmICgkaW5wdXQuYXR0cigndHlwZScpID09PSAncmFkaW8nKSB7XG4gICAgICAgICAgICAgICAgJCgnaW5wdXRbbmFtZT1cIicgKyAkaW5wdXQuYXR0cignbmFtZScpICsgJ1wiXScpLmVhY2goZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICAkKHRoaXMpLmNsb3Nlc3QoJy51aS5jaGVja2JveCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgdGhpcy5jaGVja2VkKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgJGlucHV0LmNsb3Nlc3QoJy51aS5jaGVja2JveCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgdGhpcy5jaGVja2VkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgJCgnI21oLWpvdXJuYWwtcmVzZXQtZmlsdGVycycpLm9uKCdjbGljaycsIHJlc2V0RmlsdGVycyk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXByb2JlcyBpbnB1dCcpLm9uKCdjaGFuZ2UnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5zaG93UHJvYmVzID0gJCh0aGlzKS5wcm9wKCdjaGVja2VkJyk7XG4gICAgICAgICAgICByZW5kZXJKb3VybmFsKCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1iYW5uZXInKS5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiYmFubmVyLWZpeFwiXScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBib3QgPSBib3RCeUlkKCQodGhpcykuZGF0YSgnYm90LWlkJykpO1xuICAgICAgICAgICAgaWYgKGJvdCkge1xuICAgICAgICAgICAgICAgIG9wZW5Cb3RNb2RhbCgnZWRpdCcsIGJvdCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG9wZW5Cb3RNb2RhbCgnYWRkJywgbnVsbCwgJ3RlbGVncmFtJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1yZXRyeScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHsgbG9hZCgpOyB9KTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtcHJldicpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5vZmZzZXQgPj0gUEFHRV9MSU1JVCkge1xuICAgICAgICAgICAgICAgIHN0YXRlLm9mZnNldCAtPSBQQUdFX0xJTUlUO1xuICAgICAgICAgICAgICAgIGxvYWQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLW5leHQnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoc3RhdGUub2Zmc2V0ICsgc3RhdGUubGFzdEl0ZW1zLmxlbmd0aCA8IHN0YXRlLnRvdGFsKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUub2Zmc2V0ICs9IFBBR0VfTElNSVQ7XG4gICAgICAgICAgICAgICAgbG9hZCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXJldGVudGlvbi1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBzYXZlUmV0ZW50aW9uKTtcbiAgICAgICAgJCgnI21oLXB1YmxpYy11cmwtaW5wdXQnKS5vbignY2hhbmdlJywgc2F2ZVB1YmxpY1VybCk7XG4gICAgICAgICQoJyNtaC1wcm94eS1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBzYXZlUHJveHkpO1xuICAgICAgICAkKCcjbWgtbWF4LWNhLWlucHV0Jykub24oJ2NoYW5nZScsIHNhdmVNYXhDYUJ1bmRsZSk7XG4gICAgICAgICQoJyNtaC1tYXNrLWRlZmF1bHQgaW5wdXQnKS5vbignY2hhbmdlJywgc2F2ZU1hc2tEZWZhdWx0KTtcblxuICAgICAgICBiaW5kQm90c0NvbnRhaW5lcigpO1xuICAgICAgICBiaW5kQ2hhdEZvdW5kKCk7XG4gICAgICAgIGJpbmRSdWxlc0NvbnRhaW5lcigpO1xuICAgICAgICBiaW5kV2l6YXJkQ29udHJvbHMoKTtcbiAgICAgICAgJCgnI21oLWJvdC1hZGQnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IG9wZW5Cb3RNb2RhbCgnYWRkJywgbnVsbCwgJ3RlbGVncmFtJyk7IH0pO1xuICAgICAgICAkKCcjbWgtYm90LWNoZWNrLCAjbWgtYm90LWNoZWNrLXN0b3JlZCwgI21oLWJvdC1jaGVjay1uZXcnKS5vbignY2xpY2snLCBjaGVja0JvdEZvcm0pO1xuICAgICAgICAkKCcjbWgtYm90LXRva2VuLXJlcGxhY2UnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRva2VuLW5ldy1yb3cnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4tbmV3JykudHJpZ2dlcignZm9jdXMnKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4tY2FuY2VsJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1uZXcnKS52YWwoJycpO1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1uZXctcm93JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtYm90LXNhdmUnKS5vbignY2xpY2snLCBzYXZlQm90Rm9ybSk7XG4gICAgICAgICQoJyNtaC1ib3QtbW9kYWwnKS5vbignY2xpY2snLCAnLm1oLWNoYW5uZWwtY2FyZCcsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIGlmICghc3RhdGUuYm90TW9kYWwgfHwgJCh0aGlzKS5oYXNDbGFzcygnaXMtZGlzYWJsZWQnKSkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHN0YXRlLmJvdE1vZGFsLmNoYW5uZWwgPSBTdHJpbmcoJCh0aGlzKS5kYXRhKCdjaGFubmVsJykpO1xuICAgICAgICAgICAgJCgnI21oLWJvdC1jaGVjay1tZXNzYWdlJykuZW1wdHkoKTtcbiAgICAgICAgICAgIHN5bmNCb3RDaGFubmVsKCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtYm90LWRlbGV0ZScpLm9uKCdjbGljaycsIGNvbmZpcm1EZWxldGVCb3QpO1xuICAgICAgICAkKCcjbWgtYm90LW1vZGFsIFtkYXRhLWFjdGlvbj1cImNhbmNlbFwiXScpLm9uKCdjbGljaycsIGNhbmNlbEJvdE1vZGFsKTtcbiAgICAgICAgJCgnI21oLWNoYXQtc3RvcCcpLm9uKCdjbGljaycsIHN0b3BEaXNjb3ZlcnlBbmRDbG9zZSk7XG4gICAgICAgICQoJyNtaC1jaGF0LWFnYWluJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHN0YXRlLmNoYXRNb2RhbCkge1xuICAgICAgICAgICAgICAgIHN0YXJ0RGlzY292ZXJ5KHN0YXRlLmNoYXRNb2RhbC5ib3RJZCwgdHJ1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtY2hhdC1zYXZlJykub24oJ2NsaWNrJywgc2F2ZVNlbGVjdGVkQ2hhdHMpO1xuICAgICAgICAkKCcjbWgtY2hhdC1tb2RhbCBbZGF0YS1hY3Rpb249XCJjYW5jZWxcIl0nKS5vbignY2xpY2snLCBzdG9wRGlzY292ZXJ5QW5kQ2xvc2UpO1xuICAgICAgICAkKCcjbWgtdGVzdC1tb2RhbCBbZGF0YS1hY3Rpb249XCJjYW5jZWxcIl0nKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdG9wVGVzdFBvbGwoKTtcbiAgICAgICAgICAgICQoJyNtaC10ZXN0LW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsIFtkYXRhLWFjdGlvbj1cImNhbmNlbFwiXScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbG9hZENhdGFsb2coZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgYnVpbGRUeXBlTWVudSgpO1xuICAgICAgICAgICAgbG9hZEVtcGxveWVlcyhmdW5jdGlvbiAoKSB7fSk7XG4gICAgICAgICAgICBsb2FkUHJvdmlkZXJzKGZ1bmN0aW9uICgpIHt9KTtcbiAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICAgICAgbG9hZFJ1bGVzKCk7XG4gICAgICAgICAgICBsb2FkKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBzY2hlZHVsZVJlZnJlc2goKTtcbiAgICB9KTtcbn0oKSk7XG4iXSwibWFwcGluZ3MiOiI7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNDLGFBQVk7RUFDVCxZQUFZOztFQUVaLElBQUksUUFBUSxHQUFHLHNDQUFzQztFQUNyRCxJQUFJLFVBQVUsR0FBRyxFQUFFO0VBQ25CLElBQUksV0FBVyxHQUFHLEVBQUU7RUFDcEIsSUFBSSxXQUFXLEdBQUcsQ0FBQyxPQUFPLEVBQUUsZUFBZSxFQUFFLFdBQVcsRUFBRSxhQUFhLEVBQUUsS0FBSyxDQUFDO0VBRS9FLElBQUksVUFBVSxHQUFHLCtIQUErSDtFQUNoSixJQUFJLFlBQVksR0FBRyxpR0FBaUc7RUFDcEgsSUFBSSxTQUFTLEdBQUcsMkZBQTJGO0VBRTNHLElBQUksSUFBSSxHQUFHLElBQUk7RUFDZixJQUFJLEtBQUssR0FBRztJQUNSLE9B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
