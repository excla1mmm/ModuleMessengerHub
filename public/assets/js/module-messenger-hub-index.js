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
        var cls = source.availability === 'module_disabled' || source.availability === 'disabled' ? 'ui yellow label' : 'ui red label';
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
      quality_score: null
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
    state.ruleWizard = {
      step: rule ? firstStepAfterScenario((rule.event_types || []).slice()) : 1,
      editId: rule ? Number(rule.id) : 0,
      sourceId: source ? source.id : '',
      eventTypes: rule ? (rule.event_types || []).slice() : [],
      title: rule ? rule.title : '',
      filters: normalizeFilters(rule ? rule.filters : null),
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

  // Step 2 exists only for scenarios with conditions; the others go straight to «Куда отправить».
  function wizardHasConditions(types) {
    return wizardSupportsEmployees(types) || wizardSupportsDirections(types) || wizardSupportsProviders(types) || types.indexOf('core.missed_call') >= 0 || types.indexOf('ai_supervisor.attention_call') >= 0;
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
    'local_stt.status': 'mic',
    'cloud_stt.status': 'mic',
    'cloud_ai.status': 'sparkle',
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
    $form.on('click.wizard', '.mh-seg button', function () {
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
    // the messenger is part of the preview, so the aside says which bubble it shows
    // (the design has no visible caption above the bubble)
    $('.mh-wizard-preview').attr('aria-label', t(isMax ? 'module_messenger_hub_WizardPreviewChannelMax' : 'module_messenger_hub_WizardPreviewTitle'));
    // step 2 shows the conditions preview, step 3 the same preview for the chosen bot
    $('#mh-wizard-preview, #mh-wizard-preview-target').html(html);
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
      min_severity: 'info',
      filters: pruneFilters(w.filters),
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

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sInNvdXJjZXMiOlsibmV3LmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qIE1vZHVsZU1lc3Nlbmdlckh1YiBhZG1pbiBwYWdlOiBub3RpZmljYXRpb25zLCB3aXphcmQsIGpvdXJuYWwgYW5kIHNldHRpbmdzIChkZXNpZ24gdjMsIGRvY3MvZGVzaWduL01vZHVsZU1lc3Nlbmdlckh1Yi12My5odG1sKS5cbiAqIERhdGEgY29tZXMgb25seSBmcm9tIHRoZSBtb2R1bGUgUkVTVCByZXNvdXJjZXMgKHNldHRpbmdzLCBldmVudHMsIGJvdHMsIHJ1bGVzKSBhbmQgQ29yZSB2MyBsaXN0cy4gTm8gZXh0ZXJuYWwgQ0ROcy5cbiAqIFdyaXR0ZW4gaW4gcGxhaW4gRVM1ICh0YXJnZXRzIENocm9tZSA1MCAvIEZpcmVmb3ggNDUgLyBJRTExIGFmdGVyIHRoZSBCYWJlbCBwYXNzKS5cbiAqL1xuKGZ1bmN0aW9uICgpIHtcbiAgICAndXNlIHN0cmljdCc7XG5cbiAgICB2YXIgQVBJX0JBU0UgPSAnL3BieGNvcmUvYXBpL3YzL21vZHVsZS1tZXNzZW5nZXItaHViJztcbiAgICB2YXIgUEFHRV9MSU1JVCA9IDUwO1xuICAgIHZhciBSRUZSRVNIX1NFQyA9IDMwO1xuICAgIHZhciBHUk9VUF9PUkRFUiA9IFsnY2FsbHMnLCAnYWlfc3VwZXJ2aXNvcicsICdzcGVlY2hfYWknLCAndm9pY2VfYWdlbnQnLCAncGJ4J107XG5cbiAgICB2YXIgSUNPTl9FUlJPUiA9ICc8c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBhcmlhLWhpZGRlbj1cInRydWVcIj48Y2lyY2xlIGN4PVwiOFwiIGN5PVwiOFwiIHI9XCI2LjI1XCIvPjxwYXRoIGQ9XCJNNiA2bDQgNE0xMCA2bC00IDRcIi8+PC9zdmc+JztcbiAgICB2YXIgSUNPTl9DSEVWUk9OID0gJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjxwYXRoIGQ9XCJNNiAzLjVMMTAuNSA4IDYgMTIuNVwiLz48L3N2Zz4nO1xuICAgIHZhciBJQ09OX1BMVVMgPSAnPHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+PHBhdGggZD1cIk04IDN2MTBNMyA4aDEwXCIvPjwvc3ZnPic7XG5cbiAgICB2YXIgcm9vdCA9IG51bGw7XG4gICAgdmFyIHN0YXRlID0ge1xuICAgICAgICBzb3VyY2VzOiBbXSxcbiAgICAgICAgcGVyaW9kOiAndG9kYXknLFxuICAgICAgICBldmVudFR5cGU6ICcnLFxuICAgICAgICBvZmZzZXQ6IDAsXG4gICAgICAgIHRvdGFsOiAwLFxuICAgICAgICBoYXNMb2FkZWQ6IGZhbHNlLFxuICAgICAgICBsYXN0SXRlbXM6IFtdLFxuICAgICAgICBjYWxsYmFja3M6IHt9LFxuICAgICAgICBleHBhbmRlZElkOiBudWxsLFxuICAgICAgICBsb2FkU2VxOiAwLFxuICAgICAgICByZXRlbnRpb246IDMwLFxuICAgICAgICBzZXR0aW5nczogbnVsbCxcbiAgICAgICAgYm90czogW10sXG4gICAgICAgIGJvdHNMb2FkZWQ6IGZhbHNlLFxuICAgICAgICBib3RzRXJyb3I6IG51bGwsXG4gICAgICAgIGV4cGFuZGVkQm90czoge30sXG4gICAgICAgIGVtcGxveWVlczogW10sXG4gICAgICAgIGVtcGxveWVlc0xvYWRlZDogZmFsc2UsXG4gICAgICAgIGVtcGxveWVlc0ZhaWxlZDogZmFsc2UsXG4gICAgICAgIHNob3dQcm9iZXM6IGZhbHNlLFxuICAgICAgICBib3RNb2RhbDogbnVsbCxcbiAgICAgICAgY2hhdE1vZGFsOiBudWxsLFxuICAgICAgICB0ZXN0TW9kYWw6IG51bGwsXG4gICAgICAgIHJ1bGVzOiBbXSxcbiAgICAgICAgcnVsZXNMb2FkZWQ6IGZhbHNlLFxuICAgICAgICBydWxlc0Vycm9yOiBudWxsLFxuICAgICAgICBwcm92aWRlcnM6IFtdLFxuICAgICAgICBwcm92aWRlcnNMb2FkZWQ6IGZhbHNlLFxuICAgICAgICBydWxlV2l6YXJkOiBudWxsXG4gICAgfTtcblxuICAgIC8vIC0tLS0tLS0tLS0gaTE4biAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiB0KGtleSkge1xuICAgICAgICBpZiAodHlwZW9mIGdsb2JhbFRyYW5zbGF0ZSAhPT0gJ3VuZGVmaW5lZCcgJiYgZ2xvYmFsVHJhbnNsYXRlW2tleV0pIHtcbiAgICAgICAgICAgIHJldHVybiBnbG9iYWxUcmFuc2xhdGVba2V5XTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ga2V5O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHRmKGtleSwgcGFyYW1zKSB7XG4gICAgICAgIHZhciB0ZXh0ID0gdChrZXkpO1xuICAgICAgICBPYmplY3Qua2V5cyhwYXJhbXMgfHwge30pLmZvckVhY2goZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIHRleHQgPSB0ZXh0LnNwbGl0KCd7JyArIG5hbWUgKyAnfScpLmpvaW4oU3RyaW5nKHBhcmFtc1tuYW1lXSkpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHRleHQ7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBzbWFsbCBoZWxwZXJzIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIHBhZCh2YWx1ZSkge1xuICAgICAgICByZXR1cm4gdmFsdWUgPCAxMCA/ICcwJyArIHZhbHVlIDogU3RyaW5nKHZhbHVlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmbXRUaW1lKHRzKSB7XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgcmV0dXJuIHBhZChkLmdldEhvdXJzKCkpICsgJzonICsgcGFkKGQuZ2V0TWludXRlcygpKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmbXREYXRlKHRzKSB7XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgcmV0dXJuIHBhZChkLmdldERhdGUoKSkgKyAnLicgKyBwYWQoZC5nZXRNb250aCgpICsgMSkgKyAnLicgKyBkLmdldEZ1bGxZZWFyKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZm10RGF0ZVRpbWUodHMpIHtcbiAgICAgICAgcmV0dXJuIGZtdERhdGUodHMpICsgJyAnICsgZm10VGltZSh0cyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNUb2RheSh0cykge1xuICAgICAgICB2YXIgZCA9IG5ldyBEYXRlKHRzICogMTAwMCk7XG4gICAgICAgIHZhciBub3cgPSBuZXcgRGF0ZSgpO1xuICAgICAgICByZXR1cm4gZC50b0RhdGVTdHJpbmcoKSA9PT0gbm93LnRvRGF0ZVN0cmluZygpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGlzWWVzdGVyZGF5KHRzKSB7XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgdmFyIHllc3RlcmRheSA9IG5ldyBEYXRlKERhdGUubm93KCkgLSA4NjQwMDAwMCk7XG4gICAgICAgIHJldHVybiBkLnRvRGF0ZVN0cmluZygpID09PSB5ZXN0ZXJkYXkudG9EYXRlU3RyaW5nKCk7XG4gICAgfVxuXG4gICAgLy8gT25lIGxpbmUgaW4gYSA0OCBweCByb3c6IMKrMTg6MzTCuywgwqvQstGH0LXRgNCwIDE4OjM0wrssIMKrMTIuMTAgMTg6MzTCuy5cbiAgICBmdW5jdGlvbiBmbXRDZWxsVGltZSh0cykge1xuICAgICAgICBpZiAoaXNUb2RheSh0cykpIHtcbiAgICAgICAgICAgIHJldHVybiBmbXRUaW1lKHRzKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgZCA9IG5ldyBEYXRlKHRzICogMTAwMCk7XG4gICAgICAgIHZhciBkYXkgPSBpc1llc3RlcmRheSh0cykgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UaW1lWWVzdGVyZGF5JykgOiBwYWQoZC5nZXREYXRlKCkpICsgJy4nICsgcGFkKGQuZ2V0TW9udGgoKSArIDEpO1xuICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwibWgtbXV0ZWRcIj4nICsgZXNjKGRheSkgKyAnPC9zcGFuPiAnICsgZm10VGltZSh0cyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZXNjKHZhbHVlKSB7XG4gICAgICAgIHJldHVybiAkKCc8ZGl2Lz4nKS50ZXh0KFN0cmluZyh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkID8gJycgOiB2YWx1ZSkpLmh0bWwoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzdGFydE9mVG9kYXkoKSB7XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUoKTtcbiAgICAgICAgZC5zZXRIb3VycygwLCAwLCAwLCAwKTtcbiAgICAgICAgcmV0dXJuIE1hdGguZmxvb3IoZC5nZXRUaW1lKCkgLyAxMDAwKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBwZXJpb2RCb3VuZHMoKSB7XG4gICAgICAgIHZhciBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcbiAgICAgICAgdmFyIHRvZGF5U3RhcnQgPSBzdGFydE9mVG9kYXkoKTtcbiAgICAgICAgc3dpdGNoIChzdGF0ZS5wZXJpb2QpIHtcbiAgICAgICAgICAgIGNhc2UgJ3RvZGF5JzogcmV0dXJuIHsgZnJvbTogdG9kYXlTdGFydCwgdG86IG5vdyB9O1xuICAgICAgICAgICAgY2FzZSAneWVzdGVyZGF5JzogcmV0dXJuIHsgZnJvbTogdG9kYXlTdGFydCAtIDg2NDAwLCB0bzogdG9kYXlTdGFydCAtIDEgfTtcbiAgICAgICAgICAgIGNhc2UgJzdkYXlzJzogcmV0dXJuIHsgZnJvbTogdG9kYXlTdGFydCAtIDYgKiA4NjQwMCwgdG86IG5vdyB9O1xuICAgICAgICAgICAgY2FzZSAnMzBkYXlzJzogcmV0dXJuIHsgZnJvbTogdG9kYXlTdGFydCAtIDI5ICogODY0MDAsIHRvOiBub3cgfTtcbiAgICAgICAgICAgIGRlZmF1bHQ6IHJldHVybiB7IGZyb206IDAsIHRvOiAwIH07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIEFQSSAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBhcGlHZXQocGF0aCwgcGFyYW1zLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBDb25maWcucGJ4VXJsICsgQVBJX0JBU0UgKyBwYXRoLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGRhdGE6IHBhcmFtcyB8fCB7fSxcbiAgICAgICAgICAgIGNhY2hlOiBmYWxzZVxuICAgICAgICB9KS5kb25lKGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlICYmIHJlc3BvbnNlLnJlc3VsdCA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgIG9uU3VjY2VzcyhyZXNwb25zZS5kYXRhKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUocmVzcG9uc2UsIDIwMCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KS5mYWlsKGZ1bmN0aW9uICh4aHIpIHtcbiAgICAgICAgICAgIG9uRmFpbHVyZShub3JtYWxpemVGYWlsdXJlKG51bGwsIHhoci5zdGF0dXMpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYXBpUGF0Y2gocGF0aCwgcGF5bG9hZCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpIHtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogQ29uZmlnLnBieFVybCArIEFQSV9CQVNFICsgcGF0aCxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BBVENIJyxcbiAgICAgICAgICAgIGRhdGE6IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxuICAgICAgICAgICAgY29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbidcbiAgICAgICAgfSkuZG9uZShmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgICAgICAgIGlmIChyZXNwb25zZSAmJiByZXNwb25zZS5yZXN1bHQgPT09IHRydWUpIHtcbiAgICAgICAgICAgICAgICBvblN1Y2Nlc3MocmVzcG9uc2UuZGF0YSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG9uRmFpbHVyZShub3JtYWxpemVGYWlsdXJlKHJlc3BvbnNlLCAyMDApKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkuZmFpbChmdW5jdGlvbiAoeGhyKSB7XG4gICAgICAgICAgICBvbkZhaWx1cmUobm9ybWFsaXplRmFpbHVyZShudWxsLCB4aHIuc3RhdHVzKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG5vcm1hbGl6ZUZhaWx1cmUocmVzcG9uc2UsIHN0YXR1cykge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzOiBzdGF0dXMsXG4gICAgICAgICAgICBlcnJvcjogKHJlc3BvbnNlICYmIHJlc3BvbnNlLmRhdGEgJiYgcmVzcG9uc2UuZGF0YS5lcnJvcikgfHwgJ2h0dHBfJyArIHN0YXR1cyxcbiAgICAgICAgICAgIG1lc3NhZ2VzOiAocmVzcG9uc2UgJiYgcmVzcG9uc2UubWVzc2FnZXMgJiYgcmVzcG9uc2UubWVzc2FnZXMuZXJyb3IpIHx8IFtdXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBzb3VyY2UgY2F0YWxvZyAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBsb2FkQ2F0YWxvZyhkb25lKSB7XG4gICAgICAgIGFwaUdldCgnL3NldHRpbmdzOmdldFNvdXJjZXMnLCB7fSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHN0YXRlLnNvdXJjZXMgPSBkYXRhLml0ZW1zIHx8IFtdO1xuICAgICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5zb3VyY2VzID0gW107XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNvdXJjZUJ5SWQoaWQpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5zb3VyY2VzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAoc3RhdGUuc291cmNlc1tpXS5pZCA9PT0gaWQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc3RhdGUuc291cmNlc1tpXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBldmVudFR5cGVOYW1lcygpIHtcbiAgICAgICAgdmFyIG5hbWVzID0ge307XG4gICAgICAgIHN0YXRlLnNvdXJjZXMuZm9yRWFjaChmdW5jdGlvbiAoc291cmNlKSB7XG4gICAgICAgICAgICAoc291cmNlLmV2ZW50X3R5cGVzIHx8IFtdKS5mb3JFYWNoKGZ1bmN0aW9uICh0eXBlKSB7XG4gICAgICAgICAgICAgICAgbmFtZXNbdHlwZS50eXBlXSA9IHR5cGUubmFtZTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIG5hbWVzO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gam91cm5hbDogZmlsdGVycyAoZGVzaWduIHYzOiBwZXJpb2QgYW5kIGV2ZW50IG9ubHkpIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGJ1aWxkVHlwZU1lbnUoKSB7XG4gICAgICAgIHZhciBuYW1lcyA9IGV2ZW50VHlwZU5hbWVzKCk7XG4gICAgICAgIHZhciBpdGVtcyA9IFtdO1xuICAgICAgICBHUk9VUF9PUkRFUi5mb3JFYWNoKGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgdmFyIGluR3JvdXAgPSBbXTtcbiAgICAgICAgICAgIHN0YXRlLnNvdXJjZXMuZm9yRWFjaChmdW5jdGlvbiAoc291cmNlKSB7XG4gICAgICAgICAgICAgICAgaWYgKHNvdXJjZS5ncm91cCAhPT0gZ3JvdXApIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAoc291cmNlLmV2ZW50X3R5cGVzIHx8IFtdKS5mb3JFYWNoKGZ1bmN0aW9uICh0eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgIGluR3JvdXAucHVzaCh7IHZhbHVlOiB0eXBlLnR5cGUsIHRleHQ6IG5hbWVzW3R5cGUudHlwZV0gfHwgdHlwZS50eXBlIH0pO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBpZiAoaW5Hcm91cC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgaXRlbXMucHVzaCh7IGdyb3VwOiBzb3VyY2VHcm91cE5hbWUoZ3JvdXApIH0pO1xuICAgICAgICAgICAgICAgIGluR3JvdXAuZm9yRWFjaChmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICAgICAgICAgICAgICBpdGVtcy5wdXNoKGl0ZW0pO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtZmlsdGVycyAubWgtZmlsdGVyLXR5cGUnKS5kcm9wZG93bih7XG4gICAgICAgICAgICB2YWx1ZXM6IG1lbnVUb1ZhbHVlcyhpdGVtcyksXG4gICAgICAgICAgICBwbGFjZWhvbGRlcjogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRmlsdGVyQWxsVHlwZXMnKSxcbiAgICAgICAgICAgIG9uQ2hhbmdlOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5ldmVudFR5cGUgPSBTdHJpbmcodmFsdWUgfHwgJycpO1xuICAgICAgICAgICAgICAgIHJlbG9hZCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBtZW51VG9WYWx1ZXMoaXRlbXMpIHtcbiAgICAgICAgcmV0dXJuIGl0ZW1zLm1hcChmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICAgICAgaWYgKGl0ZW0uZ3JvdXApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4geyB0eXBlOiAnaGVhZGVyJywgbmFtZTogaXRlbS5ncm91cCB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHsgbmFtZTogaXRlbS50ZXh0LCB2YWx1ZTogaXRlbS52YWx1ZSB9O1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzb3VyY2VHcm91cE5hbWUoZ3JvdXApIHtcbiAgICAgICAgdmFyIGtleSA9IHtcbiAgICAgICAgICAgIGNhbGxzOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfR3JvdXBDYWxscycsXG4gICAgICAgICAgICBhaV9zdXBlcnZpc29yOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfR3JvdXBBaVN1cGVydmlzb3InLFxuICAgICAgICAgICAgc3BlZWNoX2FpOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfR3JvdXBTcGVlY2hBaScsXG4gICAgICAgICAgICB2b2ljZV9hZ2VudDogJ21vZHVsZV9tZXNzZW5nZXJfaHViX0dyb3VwVm9pY2VBZ2VudCcsXG4gICAgICAgICAgICBwYng6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Hcm91cFBieCdcbiAgICAgICAgfVtncm91cF0gfHwgZ3JvdXA7XG4gICAgICAgIHJldHVybiB0KGtleSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBtb2R1bGUgc3RhdHVzIGV2ZW50cyAoc3RhZ2UgM2IpOiBodW1hbiB3b3JkcyBmb3IgKGNvZGUsIHJlZiksIHJhdyBjb2RlcyBvbmx5IGluIGEgdG9vbHRpcCAtLS0tLS0tLS0tXG5cbiAgICB2YXIgU1RBVFVTX1JFQ09WRVJZX0tFWVMgPSB7XG4gICAgICAgICdsb2NhbF9zdHQud29ya2VyX29ubGluZSc6ICdNZXNzYWdlU3RhdHVzV29ya2VyT25saW5lJyxcbiAgICAgICAgJ2xvY2FsX3N0dC5iYWNrbG9nX3Jlc29sdmVkJzogJ01lc3NhZ2VTdGF0dXNCYWNrbG9nUmVzb2x2ZWQnLFxuICAgICAgICAnY2xvdWRfc3R0LmluY2lkZW50X3Jlc29sdmVkJzogJ01lc3NhZ2VTdGF0dXNJbmNpZGVudFJlc29sdmVkJyxcbiAgICAgICAgJ2Nsb3VkX3N0dC5yZXN1bWVkJzogJ01lc3NhZ2VTdGF0dXNSZXN1bWVkJyxcbiAgICAgICAgJ2Nsb3VkX2FpLnJlc3VtZWQnOiAnTWVzc2FnZVN0YXR1c0Nsb3VkQWlSZXN1bWVkJyxcbiAgICAgICAgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29ubGluZSc6ICdNZXNzYWdlU3RhdHVzV29ya2VyT25saW5lJ1xuICAgIH07XG4gICAgdmFyIFNUQVRVU19DT0RFX0tFWVMgPSB7XG4gICAgICAgIHdvcmtlcl9vZmZsaW5lOiAnTWVzc2FnZVN0YXR1c1dvcmtlck9mZmxpbmUnLFxuICAgICAgICBiYWNrbG9nX25vX3dvcmtlcnM6ICdNZXNzYWdlU3RhdHVzQmFja2xvZycsXG4gICAgICAgIGluY2lkZW50X29wZW46ICdNZXNzYWdlU3RhdHVzSW5jaWRlbnQnXG4gICAgfTtcbiAgICB2YXIgU1RBVFVTX1BBVVNFX0tFWVMgPSB7XG4gICAgICAgIHVzZXI6ICdNZXNzYWdlU3RhdHVzUGF1c2VkVXNlcicsXG4gICAgICAgIG1haW50ZW5hbmNlOiAnTWVzc2FnZVN0YXR1c1BhdXNlZE1haW50ZW5hbmNlJyxcbiAgICAgICAgbWFudWFsOiAnTWVzc2FnZVN0YXR1c0Nsb3VkQWlNYW51YWwnLFxuICAgICAgICBsaWNlbnNlX21pc3Npbmc6ICdNZXNzYWdlU3RhdHVzQ2xvdWRBaUxpY2Vuc2UnLFxuICAgICAgICBhdXRoX2ludmFsaWQ6ICdNZXNzYWdlU3RhdHVzQ2xvdWRBaUF1dGgnLFxuICAgICAgICBtb2RlbF91bmF2YWlsYWJsZTogJ01lc3NhZ2VTdGF0dXNDbG91ZEFpTW9kZWwnLFxuICAgICAgICBkYWlseV9saW1pdF9yZWFjaGVkOiAnTWVzc2FnZVN0YXR1c0Nsb3VkQWlEYWlseUxpbWl0JyxcbiAgICAgICAgc291cmNlX3VuYXZhaWxhYmxlOiAnTWVzc2FnZVN0YXR1c0Nsb3VkQWlTb3VyY2VVbmF2YWlsYWJsZScsXG4gICAgICAgIGluc3VmZmljaWVudF9mdW5kczogJ01lc3NhZ2VTdGF0dXNDbG91ZEFpSW5zdWZmaWNpZW50RnVuZHMnLFxuICAgICAgICBsb3dfYmFsYW5jZTogJ01lc3NhZ2VTdGF0dXNDbG91ZEFpTG93QmFsYW5jZSdcbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gbW9kdWxlU3RhdHVzT2YoaXRlbSkge1xuICAgICAgICB2YXIgc3ViamVjdCA9IGl0ZW0gJiYgaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5zdWJqZWN0ID8gaXRlbS5wYXlsb2FkLnN1YmplY3QgOiB7fTtcbiAgICAgICAgcmV0dXJuIHN1YmplY3QubW9kdWxlX3N0YXR1cyAmJiB0eXBlb2Ygc3ViamVjdC5tb2R1bGVfc3RhdHVzID09PSAnb2JqZWN0JyA/IHN1YmplY3QubW9kdWxlX3N0YXR1cyA6IG51bGw7XG4gICAgfVxuXG4gICAgLyoqIE9uZSBzZW50ZW5jZSBmb3IgYW4gZXZlbnQgdHlwZSArIChjb2RlLCByZWYpOyBhbiB1bmtub3duIHBhaXIgZ2V0cyBhIG5ldXRyYWwgbGluZSwgbmV2ZXIgdGhlIHJhdyBjb2RlLiAqL1xuICAgIGZ1bmN0aW9uIHN0YXR1c1BocmFzZShldmVudFR5cGUsIHN0YXR1cykge1xuICAgICAgICB2YXIgY29kZSA9IFN0cmluZygoc3RhdHVzICYmIHN0YXR1cy5jb2RlKSB8fCAnJyk7XG4gICAgICAgIHZhciByZWYgPSBTdHJpbmcoKHN0YXR1cyAmJiBzdGF0dXMucmVmKSB8fCAnJyk7XG4gICAgICAgIHZhciBrZXkgPSBTVEFUVVNfUkVDT1ZFUllfS0VZU1tldmVudFR5cGVdXG4gICAgICAgICAgICB8fCAoY29kZSA9PT0gJ3Byb2Nlc3NpbmdfcGF1c2VkJyA/IFNUQVRVU19QQVVTRV9LRVlTW3JlZl0gOiBudWxsKVxuICAgICAgICAgICAgfHwgU1RBVFVTX0NPREVfS0VZU1tjb2RlXVxuICAgICAgICAgICAgfHwgJ01lc3NhZ2VTdGF0dXNVbmtub3duJztcbiAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViXycgKyBrZXkpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHN0YXR1c0NvdW50ZXJOb3RlcyhzdGF0dXMpIHtcbiAgICAgICAgdmFyIGNvdW50ZXJzID0gc3RhdHVzICYmIHN0YXR1cy5jb3VudGVycyA/IHN0YXR1cy5jb3VudGVycyA6IHt9O1xuICAgICAgICB2YXIgbm90ZXMgPSBbXTtcbiAgICAgICAgaWYgKHR5cGVvZiBjb3VudGVycy53b3JrZXJzX29ubGluZSA9PT0gJ251bWJlcicgJiYgdHlwZW9mIGNvdW50ZXJzLndvcmtlcnNfdG90YWwgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICBub3Rlcy5wdXNoKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlU3RhdHVzV29ya2Vyc0NvdW50ZXJzJywgeyBvbmxpbmU6IGNvdW50ZXJzLndvcmtlcnNfb25saW5lLCB0b3RhbDogY291bnRlcnMud29ya2Vyc190b3RhbCB9KSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHR5cGVvZiBjb3VudGVycy5qb2JzX3dhaXRpbmcgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICBub3Rlcy5wdXNoKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlU3RhdHVzSm9ic1dhaXRpbmcnLCB7IGNvdW50OiBjb3VudGVycy5qb2JzX3dhaXRpbmcgfSkpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0eXBlb2YgY291bnRlcnMuaW5jaWRlbnRzX29wZW4gPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICBub3Rlcy5wdXNoKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlU3RhdHVzSW5jaWRlbnRzT3BlbicsIHsgY291bnQ6IGNvdW50ZXJzLmluY2lkZW50c19vcGVuIH0pKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbm90ZXM7XG4gICAgfVxuXG4gICAgLyoqIFRlY2huaWNhbCB0b29sdGlwOiB0aGUgcmF3IGNvZGUgYW5kIHJlZmVyZW5jZSBvZiB0aGUgbW9kdWxlIHN0YXR1cywgbmV2ZXIgdGhlIG1haW4gdGV4dC4gKi9cbiAgICBmdW5jdGlvbiBzdGF0dXNSYXdDb2RlKGl0ZW0pIHtcbiAgICAgICAgdmFyIHN0YXR1cyA9IG1vZHVsZVN0YXR1c09mKGl0ZW0pO1xuICAgICAgICBpZiAoIXN0YXR1cyB8fCAhc3RhdHVzLmNvZGUpIHtcbiAgICAgICAgICAgIHJldHVybiAnJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gU3RyaW5nKHN0YXR1cy5jb2RlKSArIChzdGF0dXMucmVmID8gJzonICsgc3RhdHVzLnJlZiA6ICcnKTtcbiAgICB9XG5cbiAgICAvKiogSW5mb3JtYXRpb25hbCBzdGF0ZSBvZiBhIHNvdXJjZSB3aG9zZSBtb2R1bGUgY2Fubm90IGJlIHJlYWQgKG5vIGFjdGlvbiBidXR0b25zLCBkZWNpc2lvbiBRMTQpLiAqL1xuICAgIGZ1bmN0aW9uIHNvdXJjZVN0YXRlVGV4dChzb3VyY2UpIHtcbiAgICAgICAgc3dpdGNoIChzb3VyY2UuYXZhaWxhYmlsaXR5KSB7XG4gICAgICAgICAgICBjYXNlICdtb2R1bGVfbWlzc2luZyc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NvdXJjZVN0YXRlTm9pbnN0Jyk7XG4gICAgICAgICAgICBjYXNlICdtb2R1bGVfZGlzYWJsZWQnOlxuICAgICAgICAgICAgICAgIHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Tb3VyY2VTdGF0ZU1vZG9mZicpO1xuICAgICAgICAgICAgY2FzZSAnYXBpX2ZvcmJpZGRlbic6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX05vdGlmU291cmNlTm9BY2Nlc3MnKTtcbiAgICAgICAgICAgIGNhc2UgJ2FwaV9pbmNvbXBhdGlibGUnOlxuICAgICAgICAgICAgICAgIHJldHVybiBzb3VyY2UudXBkYXRlX3RvXG4gICAgICAgICAgICAgICAgICAgID8gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NvdXJjZVN0YXRlT3V0ZGF0ZWRUbycsIHsgdmVyc2lvbjogc291cmNlLnVwZGF0ZV90byB9KVxuICAgICAgICAgICAgICAgICAgICA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NvdXJjZVN0YXRlT3V0ZGF0ZWRBbnknKTtcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHNvdXJjZS5hdmFpbGFiaWxpdHlfbmFtZSB8fCAnJztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJ1aWxkUGVyaW9kTWVudSgpIHtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtZmlsdGVycyAubWgtZmlsdGVyLXBlcmlvZCcpLmRyb3Bkb3duKHtcbiAgICAgICAgICAgIHZhbHVlczogW1xuICAgICAgICAgICAgICAgIHsgbmFtZTogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUGVyaW9kVG9kYXknKSwgdmFsdWU6ICd0b2RheScsIHNlbGVjdGVkOiB0cnVlIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QZXJpb2RZZXN0ZXJkYXknKSwgdmFsdWU6ICd5ZXN0ZXJkYXknIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QZXJpb2Q3RGF5cycpLCB2YWx1ZTogJzdkYXlzJyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUGVyaW9kMzBEYXlzJyksIHZhbHVlOiAnMzBkYXlzJyB9LFxuICAgICAgICAgICAgICAgIHsgbmFtZTogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUGVyaW9kQWxsJyksIHZhbHVlOiAnYWxsJyB9XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgb25DaGFuZ2U6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgIHN0YXRlLnBlcmlvZCA9IFN0cmluZyh2YWx1ZSB8fCAnYWxsJyk7XG4gICAgICAgICAgICAgICAgcmVsb2FkKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlc2V0RmlsdGVycygpIHtcbiAgICAgICAgc3RhdGUuZXZlbnRUeXBlID0gJyc7XG4gICAgICAgIHN0YXRlLnBlcmlvZCA9ICd0b2RheSc7XG4gICAgICAgIHN0YXRlLm9mZnNldCA9IDA7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLWZpbHRlcnMgLm1oLWZpbHRlci10eXBlJykuZHJvcGRvd24oJ2NsZWFyJyk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLWZpbHRlcnMgLm1oLWZpbHRlci1wZXJpb2QnKS5kcm9wZG93bignc2V0IHNlbGVjdGVkJywgJ3RvZGF5Jyk7XG4gICAgICAgIHJlbG9hZCgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZpbHRlcnNBY3RpdmUoKSB7XG4gICAgICAgIC8vIHRoZSBkZWZhdWx0IHBlcmlvZCAowqvQodC10LPQvtC00L3Rj8K7KSBpcyBub3QgYSBmaWx0ZXI6IGFuIGVtcHR5IGxvZyBzaG93cyDCq9Ch0L7QsdGL0YLQuNC5INC90LXRgsK7XG4gICAgICAgIHJldHVybiBzdGF0ZS5ldmVudFR5cGUgIT09ICcnIHx8IHN0YXRlLnBlcmlvZCAhPT0gJ3RvZGF5JztcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGpvdXJuYWw6IGxvYWRpbmcgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gcmVsb2FkKCkge1xuICAgICAgICBzdGF0ZS5vZmZzZXQgPSAwO1xuICAgICAgICBsb2FkKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbG9hZChvcHRpb25zKSB7XG4gICAgICAgIHZhciBzZXEgPSArK3N0YXRlLmxvYWRTZXE7XG4gICAgICAgIHZhciBib3VuZHMgPSBwZXJpb2RCb3VuZHMoKTtcbiAgICAgICAgdmFyIGlzUmVmcmVzaCA9IG9wdGlvbnMgJiYgb3B0aW9ucy5yZWZyZXNoID09PSB0cnVlO1xuICAgICAgICB2YXIgcGFyYW1zID0ge1xuICAgICAgICAgICAgbGltaXQ6IFBBR0VfTElNSVQsXG4gICAgICAgICAgICBvZmZzZXQ6IHN0YXRlLm9mZnNldFxuICAgICAgICB9O1xuICAgICAgICBpZiAoc3RhdGUuZXZlbnRUeXBlICE9PSAnJykgeyBwYXJhbXMuZXZlbnRfdHlwZSA9IHN0YXRlLmV2ZW50VHlwZTsgfVxuICAgICAgICBpZiAoYm91bmRzLmZyb20gPiAwKSB7IHBhcmFtcy5kYXRlX2Zyb20gPSBib3VuZHMuZnJvbTsgfVxuICAgICAgICBpZiAoYm91bmRzLnRvID4gMCkgeyBwYXJhbXMuZGF0ZV90byA9IGJvdW5kcy50bzsgfVxuXG4gICAgICAgIHNldEpvdXJuYWxCdXN5KHRydWUsIGlzUmVmcmVzaCk7XG4gICAgICAgIGFwaUdldCgnL2V2ZW50cycsIHBhcmFtcywgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIGlmIChzZXEgIT09IHN0YXRlLmxvYWRTZXEpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47IC8vIGEgbmV3ZXIgcmVxdWVzdCBhbHJlYWR5IGFuc3dlcmVkXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzdGF0ZS50b3RhbCA9IGRhdGEucGFnaW5hdGlvbiA/IGRhdGEucGFnaW5hdGlvbi50b3RhbCA6IDA7XG4gICAgICAgICAgICBzdGF0ZS5sYXN0SXRlbXMgPSBkYXRhLml0ZW1zIHx8IFtdO1xuICAgICAgICAgICAgc3RhdGUuaGFzTG9hZGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIHNldEpvdXJuYWxCdXN5KGZhbHNlLCBpc1JlZnJlc2gpO1xuICAgICAgICAgICAgcmVuZGVySm91cm5hbCgpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgaWYgKHNlcSAhPT0gc3RhdGUubG9hZFNlcSkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNldEpvdXJuYWxCdXN5KGZhbHNlLCBpc1JlZnJlc2gpO1xuICAgICAgICAgICAgcmVuZGVyTG9hZEVycm9yKGZhaWx1cmUpO1xuICAgICAgICB9KTtcbiAgICAgICAgbG9hZEpvdXJuYWxCYWRnZSgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNldEpvdXJuYWxCdXN5KGJ1c3ksIGlzUmVmcmVzaCkge1xuICAgICAgICB2YXIgJHRhYmxlID0gJCgnI21oLWpvdXJuYWwtdGFibGUgdGFibGUnKTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtdGFibGUnKS5hdHRyKCdhcmlhLWJ1c3knLCBidXN5ID8gJ3RydWUnIDogJ2ZhbHNlJyk7XG4gICAgICAgICR0YWJsZS50b2dnbGVDbGFzcygnaXMtcmVmcmVzaGluZycsIEJvb2xlYW4oYnVzeSAmJiBpc1JlZnJlc2gpKTtcbiAgICAgICAgaWYgKCFpc1JlZnJlc2gpIHtcbiAgICAgICAgICAgIGlmIChidXN5KSB7XG4gICAgICAgICAgICAgICAgcmVuZGVyU2tlbGV0b24oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICQoJyNtaC1qb3VybmFsLWVycm9yJykuZW1wdHkoKTtcbiAgICAgICAgICAgICQoJyNtaC1qb3VybmFsLWVycm9yLXBsYWNlaG9sZGVyJykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBqb3VybmFsVGFibGVIZWFkKCkge1xuICAgICAgICByZXR1cm4gJzxjb2xncm91cD48Y29sIHN0eWxlPVwid2lkdGg6MzZweFwiPjxjb2wgc3R5bGU9XCJ3aWR0aDoxMDRweFwiPjxjb2wgc3R5bGU9XCJ3aWR0aDoyNDBweFwiPjxjb2w+PGNvbCBzdHlsZT1cIndpZHRoOjE2MHB4XCI+PC9jb2xncm91cD4nXG4gICAgICAgICAgICArICc8dGhlYWQ+PHRyPjx0aD48L3RoPidcbiAgICAgICAgICAgICsgJzx0aD4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbHVtblRpbWUnKSkgKyAnPC90aD4nXG4gICAgICAgICAgICArICc8dGg+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db2x1bW5FdmVudCcpKSArICc8L3RoPidcbiAgICAgICAgICAgICsgJzx0aD48L3RoPidcbiAgICAgICAgICAgICsgJzx0aD4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbHVtbkRlbGl2ZXJ5JykpICsgJzwvdGg+J1xuICAgICAgICAgICAgKyAnPC90cj48L3RoZWFkPic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyU2tlbGV0b24oKSB7XG4gICAgICAgIHZhciByb3dzID0gJyc7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgMzsgaSsrKSB7XG4gICAgICAgICAgICByb3dzICs9ICc8dHIgY2xhc3M9XCJtaC1za2VsLXJvd1wiPjx0ZD48L3RkPjx0ZD48c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjM2cHhcIj48L3NwYW4+PC90ZD4nXG4gICAgICAgICAgICAgICAgKyAnPHRkPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6MTYwcHhcIj48L3NwYW4+PC90ZD4nXG4gICAgICAgICAgICAgICAgKyAnPHRkPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6NzAlXCI+PC9zcGFuPjwvdGQ+J1xuICAgICAgICAgICAgICAgICsgJzx0ZD48c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjk2cHg7aGVpZ2h0OjIwcHg7Ym9yZGVyLXJhZGl1czo1cHhcIj48L3NwYW4+PC90ZD48L3RyPic7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLWpvdXJuYWwtdGFibGUnKS5odG1sKCc8ZGl2IGNsYXNzPVwibWgtdGFibGUtd3JhcFwiPjx0YWJsZSBjbGFzcz1cInVpIHRhYmxlIG1oLWpvdXJuYWwtdGFibGVcIiBhcmlhLWJ1c3k9XCJ0cnVlXCI+J1xuICAgICAgICAgICAgKyBqb3VybmFsVGFibGVIZWFkKCkgKyAnPHRib2R5PicgKyByb3dzICsgJzwvdGJvZHk+PC90YWJsZT48L2Rpdj4nKTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGpvdXJuYWw6IGRpc3BsYXkgcnVsZXMgKHByb2JlcyBoaWRkZW4sIGNhbGxiYWNrcyBmb2xkZWQgaW50byB0aGUgbWlzc2VkIGNhbGwpIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGlzUHJvYmUoaXRlbSkge1xuICAgICAgICByZXR1cm4gQm9vbGVhbihpdGVtICYmIGl0ZW0ucGF5bG9hZCAmJiBpdGVtLnBheWxvYWQucHJvYmUgPT09IHRydWUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNhbGxiYWNrSW5kZXgoaXRlbXMpIHtcbiAgICAgICAgdmFyIGluZGV4ID0ge307XG4gICAgICAgIChpdGVtcyB8fCBbXSkuZm9yRWFjaChmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICAgICAgaWYgKGl0ZW0uZXZlbnRfdHlwZSAhPT0gJ2NvcmUubWlzc2VkX2NhbGxfcmVzb2x2ZWQnKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFyIGNhbGwgPSAoaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5zdWJqZWN0ICYmIGl0ZW0ucGF5bG9hZC5zdWJqZWN0LmNhbGwpIHx8IHt9O1xuICAgICAgICAgICAgaWYgKGNhbGwubWlzc2VkX2xpbmtlZGlkICYmICFpbmRleFtjYWxsLm1pc3NlZF9saW5rZWRpZF0pIHtcbiAgICAgICAgICAgICAgICBpbmRleFtjYWxsLm1pc3NlZF9saW5rZWRpZF0gPSBpdGVtLm9jY3VycmVkX2F0O1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIGluZGV4O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNhbGxiYWNrVGltZShpdGVtKSB7XG4gICAgICAgIHZhciBjYWxsID0gKGl0ZW0ucGF5bG9hZCAmJiBpdGVtLnBheWxvYWQuc3ViamVjdCAmJiBpdGVtLnBheWxvYWQuc3ViamVjdC5jYWxsKSB8fCB7fTtcbiAgICAgICAgaWYgKGNhbGwubGlua2VkaWQgJiYgc3RhdGUuY2FsbGJhY2tzW2NhbGwubGlua2VkaWRdKSB7XG4gICAgICAgICAgICByZXR1cm4gc3RhdGUuY2FsbGJhY2tzW2NhbGwubGlua2VkaWRdO1xuICAgICAgICB9XG4gICAgICAgIHZhciByZXNvbHZlZCA9IDA7XG4gICAgICAgIChpdGVtLmRlbGl2ZXJpZXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24gKGRlbGl2ZXJ5KSB7XG4gICAgICAgICAgICBpZiAoZGVsaXZlcnkucmVzb2x2ZWRfYXQgJiYgKHJlc29sdmVkID09PSAwIHx8IGRlbGl2ZXJ5LnJlc29sdmVkX2F0IDwgcmVzb2x2ZWQpKSB7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZWQgPSBkZWxpdmVyeS5yZXNvbHZlZF9hdDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiByZXNvbHZlZDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB2aXNpYmxlSm91cm5hbEl0ZW1zKCkge1xuICAgICAgICBzdGF0ZS5jYWxsYmFja3MgPSBjYWxsYmFja0luZGV4KHN0YXRlLmxhc3RJdGVtcyk7XG4gICAgICAgIHJldHVybiBzdGF0ZS5sYXN0SXRlbXMuZmlsdGVyKGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgICAgICBpZiAoaXRlbS5ldmVudF90eXBlID09PSAnY29yZS5taXNzZWRfY2FsbF9yZXNvbHZlZCcpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gc3RhdGUuc2hvd1Byb2JlcyB8fCAhaXNQcm9iZShpdGVtKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVySm91cm5hbCgpIHtcbiAgICAgICAgaGlkZUpvdXJuYWxTdGF0ZXMoKTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtZXJyb3InKS5lbXB0eSgpO1xuICAgICAgICByZW5kZXJKb3VybmFsQmFubmVyKCk7XG4gICAgICAgIHZhciBpdGVtcyA9IHZpc2libGVKb3VybmFsSXRlbXMoKTtcblxuICAgICAgICBpZiAoaXRlbXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBpZiAoZmlsdGVyc0FjdGl2ZSgpKSB7XG4gICAgICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtZW1wdHktZmlsdGVyZWQnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtZW1wdHknKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICQoJyNtaC1qb3VybmFsLXRhYmxlJykuZW1wdHkoKTtcbiAgICAgICAgICAgIHJlbmRlclBhZ2VyKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgbmFtZXMgPSBldmVudFR5cGVOYW1lcygpO1xuICAgICAgICBpZiAoIW5hbWVzWydodWIudGVzdCddKSB7XG4gICAgICAgICAgICBuYW1lc1snaHViLnRlc3QnXSA9IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0V2ZW50VHlwZVRlc3QnKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcm93cyA9ICcnO1xuICAgICAgICBpdGVtcy5mb3JFYWNoKGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgICAgICByb3dzICs9IHJlbmRlclJvdyhpdGVtLCBuYW1lc1tpdGVtLmV2ZW50X3R5cGVdIHx8IGl0ZW0uZXZlbnRfdHlwZSk7XG4gICAgICAgICAgICBpZiAoc3RhdGUuZXhwYW5kZWRJZCA9PT0gaXRlbS5pZCkge1xuICAgICAgICAgICAgICAgIHJvd3MgKz0gcmVuZGVyRGV0YWlsUm93KGl0ZW0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtdGFibGUnKS5odG1sKCc8ZGl2IGNsYXNzPVwibWgtdGFibGUtd3JhcFwiPjx0YWJsZSBjbGFzcz1cInVpIHNlbGVjdGFibGUgdGFibGUgbWgtam91cm5hbC10YWJsZVwiPidcbiAgICAgICAgICAgICsgam91cm5hbFRhYmxlSGVhZCgpICsgJzx0Ym9keT4nICsgcm93cyArICc8L3Rib2R5PjwvdGFibGU+PC9kaXY+Jyk7XG5cbiAgICAgICAgJCgnI21oLWpvdXJuYWwtdGFibGUgdGJvZHkgdHIubWgtZXZlbnQtcm93Jykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdG9nZ2xlUm93KCQodGhpcykuZGF0YSgnaWQnKSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLm9mZignY2xpY2sucmV0cnknKS5vbignY2xpY2sucmV0cnknLCAnW2RhdGEtYWN0aW9uPVwicmV0cnktZXZlbnRcIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgdmFyIGV2ZW50SWQgPSAkKHRoaXMpLmRhdGEoJ2V2ZW50LWlkJyk7XG4gICAgICAgICAgICB2YXIgJGJ1dHRvbiA9ICQodGhpcykucHJvcCgnZGlzYWJsZWQnLCB0cnVlKTtcbiAgICAgICAgICAgIGFwaVBvc3QoJy9ldmVudHMvJyArIGV2ZW50SWQgKyAnOnJldHJ5Jywge30sIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeVJldHJpZWQnLCB7IGNvdW50OiBkYXRhLnJldHJpZWQgfHwgMCB9KSk7XG4gICAgICAgICAgICAgICAgbG9hZCgpO1xuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgICAgICAkYnV0dG9uLnByb3AoJ2Rpc2FibGVkJywgZmFsc2UpO1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdChmYWlsdXJlVGV4dChmYWlsdXJlKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmVuZGVyUGFnZXIoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBoaWRlSm91cm5hbFN0YXRlcygpIHtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtZW1wdHknKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtZW1wdHktZmlsdGVyZWQnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtZXJyb3ItcGxhY2Vob2xkZXInKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJMb2FkRXJyb3IoZmFpbHVyZSkge1xuICAgICAgICB2YXIgaGludCA9IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25Mb2FkRXJyb3InLCB7XG4gICAgICAgICAgICB3aGF0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Mb2FkV2hhdEV2ZW50cycpLFxuICAgICAgICAgICAgY29kZTogZmFpbHVyZS5zdGF0dXMgPiAwID8gZmFpbHVyZS5zdGF0dXMgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25UaW1lb3V0JylcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChzdGF0ZS5oYXNMb2FkZWQgJiYgc3RhdGUubGFzdEl0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIC8vIGRhdGEgaXMgYWxyZWFkeSBvbiB0aGUgc2NyZWVuOiBrZWVwIHRoZSB0YWJsZSwgc2hvdyBhIGJhbm5lciBhYm92ZSBpdFxuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtZXJyb3InKS5odG1sKFxuICAgICAgICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWkgbmVnYXRpdmUgbWVzc2FnZVwiIHJvbGU9XCJhbGVydFwiPicgKyBJQ09OX0VSUk9SXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLWdyb3dcIj4nICsgZXNjKGhpbnQpICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uIG1oLW9uLW1lc3NhZ2VcIiB0eXBlPVwiYnV0dG9uXCIgaWQ9XCJtaC1qb3VybmFsLXJldHJ5LWlubGluZVwiPidcbiAgICAgICAgICAgICAgICArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25SZXRyeScpKSArICc8L2J1dHRvbj48L2Rpdj4nXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtcmV0cnktaW5saW5lJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkgeyBsb2FkKCk7IH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtdGFibGUnKS5lbXB0eSgpO1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtcGFnZXInKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgICQoJyNtaC1qb3VybmFsLWVycm9yLXBsYWNlaG9sZGVyLWhpbnQnKS50ZXh0KGhpbnQpO1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtZXJyb3ItcGxhY2Vob2xkZXInKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gam91cm5hbDogcHJvYmxlbSBiYW5uZXIgYW5kIHRoZSB1bmRlbGl2ZXJlZCBjb3VudGVyIG9uIHRoZSB0YWIgLS0tLS0tLS0tLVxuXG4gICAgLy8gT25lIHJlZCBsaW5lIGFib3ZlIHRoZSB0YWJsZSBpbnN0ZWFkIG9mIMKr0JHQvtGCINGD0LTQsNC70ZHQvcK7IGluIGV2ZXJ5IHJvdyAoZGVzaWduIHYzLCDCq9CW0YPRgNC90LDQu8K7KS5cbiAgICBmdW5jdGlvbiBib3RQcm9ibGVtKCkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLmJvdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBib3QgPSBzdGF0ZS5ib3RzW2ldO1xuICAgICAgICAgICAgaWYgKGJvdC5lbmFibGVkICE9PSBmYWxzZSAmJiBib3Quc3RhdHVzID09PSAndG9rZW5faW52YWxpZCcpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0OiB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQmFubmVyVG9rZW5JbnZhbGlkJywge1xuICAgICAgICAgICAgICAgICAgICAgICAgYm90OiBib3QuYm90X3VzZXJuYW1lID8gJ0AnICsgYm90LmJvdF91c2VybmFtZSA6ICfCqycgKyBib3QudGl0bGUgKyAnwrsnXG4gICAgICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgICAgICBib3RJZDogTnVtYmVyKGJvdC5pZClcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIGEgZGVsZXRlZCBib3QgaXMgb25seSB2aXNpYmxlIHRocm91Z2ggaXRzIGZhaWxlZCBkZWxpdmVyaWVzICh0aGUgYm90IHJvdyBpcyBnb25lKVxuICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IHN0YXRlLmxhc3RJdGVtcy5sZW5ndGg7IGorKykge1xuICAgICAgICAgICAgdmFyIGRlbGl2ZXJpZXMgPSBzdGF0ZS5sYXN0SXRlbXNbal0uZGVsaXZlcmllcyB8fCBbXTtcbiAgICAgICAgICAgIGZvciAodmFyIGsgPSAwOyBrIDwgZGVsaXZlcmllcy5sZW5ndGg7IGsrKykge1xuICAgICAgICAgICAgICAgIGlmIChkZWxpdmVyaWVzW2tdLmJvdF9kZWxldGVkICYmIGlzRmFpbGVkRGVsaXZlcnkoZGVsaXZlcmllc1trXSkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQmFubmVyQm90RGVsZXRlZCcpLCBib3RJZDogMCB9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJKb3VybmFsQmFubmVyKCkge1xuICAgICAgICB2YXIgcHJvYmxlbSA9IHN0YXRlLmJvdHNMb2FkZWQgPyBib3RQcm9ibGVtKCkgOiBudWxsO1xuICAgICAgICBpZiAocHJvYmxlbSA9PT0gbnVsbCkge1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtYmFubmVyJykuZW1wdHkoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtam91cm5hbC1iYW5uZXInKS5odG1sKCc8ZGl2IGNsYXNzPVwidWkgbmVnYXRpdmUgbWVzc2FnZSBtaC1iYW5uZXJcIiByb2xlPVwiYWxlcnRcIj4nICsgSUNPTl9FUlJPUlxuICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLWdyb3dcIj4nICsgZXNjKHByb2JsZW0udGV4dCkgKyAnPC9kaXY+J1xuICAgICAgICAgICAgKyAnPGJ1dHRvbiBjbGFzcz1cInVpIGJhc2ljIGJ1dHRvbiBtaC1vbi1tZXNzYWdlXCIgdHlwZT1cImJ1dHRvblwiIGRhdGEtYWN0aW9uPVwiYmFubmVyLWZpeFwiIGRhdGEtYm90LWlkPVwiJyArIHByb2JsZW0uYm90SWQgKyAnXCI+J1xuICAgICAgICAgICAgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQmFubmVyQ29ubmVjdCcpKSArICc8L2J1dHRvbj48L2Rpdj4nKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBpc0ZhaWxlZERlbGl2ZXJ5KGRlbGl2ZXJ5KSB7XG4gICAgICAgIHJldHVybiBkZWxpdmVyeS5zdGF0dXMgPT09ICdmYWlsZWQnIHx8IGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2Ryb3BwZWQnO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGlzVW5kZWxpdmVyZWQoaXRlbSkge1xuICAgICAgICByZXR1cm4gKGl0ZW0uZGVsaXZlcmllcyB8fCBbXSkuc29tZShpc0ZhaWxlZERlbGl2ZXJ5KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBsb2FkSm91cm5hbEJhZGdlKCkge1xuICAgICAgICBhcGlHZXQoJy9ldmVudHMnLCB7IGRhdGVfZnJvbTogc3RhcnRPZlRvZGF5KCksIGxpbWl0OiAyMDAgfSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHZhciBjb3VudCA9IChkYXRhLml0ZW1zIHx8IFtdKS5maWx0ZXIoZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gIWlzUHJvYmUoaXRlbSkgJiYgaXNVbmRlbGl2ZXJlZChpdGVtKTtcbiAgICAgICAgICAgIH0pLmxlbmd0aDtcbiAgICAgICAgICAgICQoJyNtaC1qb3VybmFsLWJhZGdlJykudGV4dChjb3VudCA+IDk5ID8gJzk5KycgOiBTdHJpbmcoY291bnQpKVxuICAgICAgICAgICAgICAgIC5hdHRyKCdhcmlhLWxhYmVsJywgdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0pvdXJuYWxCYWRnZUxhYmVsJywgeyBjb3VudDogY291bnQgfSkpXG4gICAgICAgICAgICAgICAgLmF0dHIoJ2hpZGRlbicsIGNvdW50ID4gMCA/IG51bGwgOiB0cnVlKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKCkge30pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gam91cm5hbDogcm93cyAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBicmllZkZvcihpdGVtKSB7XG4gICAgICAgIHZhciBzdWJqZWN0ID0gaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5zdWJqZWN0ID8gaXRlbS5wYXlsb2FkLnN1YmplY3QgOiB7fTtcbiAgICAgICAgdmFyIGZhY3RzID0gaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5mYWN0cyA/IGl0ZW0ucGF5bG9hZC5mYWN0cyA6IHt9O1xuICAgICAgICBzd2l0Y2ggKGl0ZW0uZXZlbnRfdHlwZSkge1xuICAgICAgICAgICAgY2FzZSAnY29yZS5taXNzZWRfY2FsbCc6XG4gICAgICAgICAgICBjYXNlICd2b2ljZV9hZ2VudC5jYWxsYmFja19yZXF1ZXN0JzpcbiAgICAgICAgICAgICAgICB2YXIgZW1wbG95ZWVzID0gKHN1YmplY3QuZW1wbG95ZWVzIHx8IFtdKS5tYXAoc2hvcnRFbXBsb3llZSkuam9pbignLCAnKTtcbiAgICAgICAgICAgICAgICB2YXIgY2xpZW50ID0gc3ViamVjdC5jbGllbnRfbnVtYmVyIHx8ICcnO1xuICAgICAgICAgICAgICAgIGlmIChjbGllbnQgIT09ICcnICYmIGVtcGxveWVlcyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGNsaWVudCArICcg4oaSICcgKyBlbXBsb3llZXM7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBjbGllbnQgIT09ICcnID8gY2xpZW50IDogZW1wbG95ZWVzO1xuICAgICAgICAgICAgY2FzZSAnYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCc6XG4gICAgICAgICAgICAgICAgaWYgKGZhY3RzLnNjb3JlcyAmJiBmYWN0cy5zY29yZXMucXVhbGl0eSAhPT0gbnVsbCAmJiBmYWN0cy5zY29yZXMucXVhbGl0eSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQnJpZWZTY29yZScsIHsgc2NvcmU6IGZhY3RzLnNjb3Jlcy5xdWFsaXR5IH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gZmFjdHMuc3VtbWFyeSB8fCBzdWJqZWN0LmNsaWVudF9udW1iZXIgfHwgJyc7XG4gICAgICAgICAgICBjYXNlICdjb3JlLnByb3ZpZGVyX2Rvd24nOlxuICAgICAgICAgICAgY2FzZSAnY29yZS5wcm92aWRlcl91cCc6XG4gICAgICAgICAgICAgICAgdmFyIHByb3ZpZGVyID0gc3ViamVjdC5wcm92aWRlciB8fCB7fTtcbiAgICAgICAgICAgICAgICByZXR1cm4gcHJvdmlkZXIudXNlcm5hbWUgPyAnU0lQIMKrJyArIHByb3ZpZGVyLnVzZXJuYW1lICsgJ8K7JyA6IChwcm92aWRlci5ob3N0IHx8IHByb3ZpZGVyLmlkIHx8ICcnKTtcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUuYWR2aWNlJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFjdHMuc3VtbWFyeSB8fCBhZHZpY2VUZXh0KHN1YmplY3QuYWR2aWNlIHx8IHt9KTtcbiAgICAgICAgICAgIGNhc2UgJ2h1Yi50ZXN0JzpcbiAgICAgICAgICAgICAgICB2YXIgdGVzdFN5c3RlbSA9IHN1YmplY3Quc3lzdGVtIHx8IHt9O1xuICAgICAgICAgICAgICAgIHJldHVybiB0ZXN0U3lzdGVtLmJvdF90aXRsZSB8fCAnJztcbiAgICAgICAgICAgIGNhc2UgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29mZmxpbmUnOlxuICAgICAgICAgICAgY2FzZSAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb25saW5lJzpcbiAgICAgICAgICAgICAgICBpZiAoc3ViamVjdC5tb2R1bGVfc3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBzdGF0dXNQaHJhc2UoaXRlbS5ldmVudF90eXBlLCBzdWJqZWN0Lm1vZHVsZV9zdGF0dXMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gKHN1YmplY3Qud29ya2VyICYmIHN1YmplY3Qud29ya2VyLm5hbWUpIHx8IGZhY3RzLnN1bW1hcnkgfHwgJyc7XG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIGlmIChzdWJqZWN0Lm1vZHVsZV9zdGF0dXMpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHN0YXR1c1BocmFzZShpdGVtLmV2ZW50X3R5cGUsIHN1YmplY3QubW9kdWxlX3N0YXR1cyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBmYWN0cy5zdW1tYXJ5IHx8ICcnO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gwqvQn9C+0YDRgtC90L7QsiDQkNC70LXQutGB0LXQucK7ICgyMDQpIOKGkiDCq9Cf0L7RgNGC0L3QvtCyINCQLiAoMjA0KcK7LCBhcyBpbiB0aGUgam91cm5hbCBtb2NrdXBcbiAgICBmdW5jdGlvbiBzaG9ydEVtcGxveWVlKGVtcGxveWVlKSB7XG4gICAgICAgIHZhciBuYW1lID0gU3RyaW5nKGVtcGxveWVlLm5hbWUgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgdmFyIHBhcnRzID0gbmFtZS5zcGxpdCgvXFxzKy8pO1xuICAgICAgICBpZiAocGFydHMubGVuZ3RoID49IDIgJiYgcGFydHNbMV0gIT09ICcnKSB7XG4gICAgICAgICAgICBuYW1lID0gcGFydHNbMF0gKyAnICcgKyBwYXJ0c1sxXS5jaGFyQXQoMCkgKyAnLic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG5hbWUgPT09ICcnKSB7XG4gICAgICAgICAgICByZXR1cm4gU3RyaW5nKGVtcGxveWVlLm51bWJlciB8fCAnJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGVtcGxveWVlLm51bWJlciA/IG5hbWUgKyAnICgnICsgZW1wbG95ZWUubnVtYmVyICsgJyknIDogbmFtZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmdWxsRW1wbG95ZWUoZW1wbG95ZWUpIHtcbiAgICAgICAgcmV0dXJuIGVtcGxveWVlLm5hbWUgPyBlbXBsb3llZS5uYW1lICsgKGVtcGxveWVlLm51bWJlciA/ICcgKCcgKyBlbXBsb3llZS5udW1iZXIgKyAnKScgOiAnJykgOiBTdHJpbmcoZW1wbG95ZWUubnVtYmVyIHx8ICcnKTtcbiAgICB9XG5cbiAgICAvLyBDb3JlIGFkdmljZSB0ZXh0OiB0aGUgYWRtaW4gY2FiaW5ldCBhbHJlYWR5IGhhcyB0aGUgQ29yZSBjYXRhbG9nIGluIGdsb2JhbFRyYW5zbGF0ZVxuICAgIC8vICh0ZW1wbGF0ZXMgbGlrZSBcIuKApiA8YSBocmVmPScldXJsJSc+JXZlciU8L2E+XCIpOyBzdWJzdGl0dXRlIHBhcmFtcyBhbmQgZHJvcCB0aGUgbWFya3VwIGFzIHBsYWluIHRleHQuXG4gICAgZnVuY3Rpb24gYWR2aWNlVGV4dChhZHZpY2UpIHtcbiAgICAgICAgdmFyIHRwbCA9IChhZHZpY2UgJiYgYWR2aWNlLm1lc3NhZ2VfdHBsKSB8fCAnJztcbiAgICAgICAgdmFyIHRleHQgPSB0KHRwbCk7XG4gICAgICAgIGlmICh0cGwgPT09ICcnIHx8IHRleHQgPT09IHRwbCkge1xuICAgICAgICAgICAgcmV0dXJuIHRwbDtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcGFyYW1zID0gKGFkdmljZSAmJiBhZHZpY2UucGFyYW1zKSB8fCB7fTtcbiAgICAgICAgT2JqZWN0LmtleXMocGFyYW1zKS5mb3JFYWNoKGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICB0ZXh0ID0gdGV4dC5zcGxpdCgnJScgKyBuYW1lICsgJyUnKS5qb2luKFN0cmluZyhwYXJhbXNbbmFtZV0pKTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIE5ldmVyIHBhcnNlIGFzIEhUTUwgKHBhcmFtcyBtYXkgY2FycnkgdXNlci1lbnRlcmVkIG5hbWVzKTogc3RyaXAgdGFncyBhcyB0ZXh0LCBvdXRwdXQgaXMgZXNjYXBlZCBsYXRlci5cbiAgICAgICAgcmV0dXJuIHRleHQucmVwbGFjZSgvPFtePl0qPi9nLCAnJylcbiAgICAgICAgICAgIC5yZXBsYWNlKC8mbmJzcDsvZywgJyAnKS5yZXBsYWNlKC8mcXVvdDsvZywgJ1wiJykucmVwbGFjZSgvJiMwMzk7fCYjMzk7L2csIFwiJ1wiKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZsdDsvZywgJzwnKS5yZXBsYWNlKC8mZ3Q7L2csICc+JykucmVwbGFjZSgvJmFtcDsvZywgJyYnKVxuICAgICAgICAgICAgLnJlcGxhY2UoL1xccysvZywgJyAnKS50cmltKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyUm93KGl0ZW0sIGV2ZW50TmFtZSkge1xuICAgICAgICB2YXIgcHJvYmUgPSBpc1Byb2JlKGl0ZW0pID8gJzxzcGFuIGNsYXNzPVwibWgtcHJvYmVcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Byb2JlVGFnJykpICsgJzwvc3Bhbj4nIDogJyc7XG4gICAgICAgIHZhciBicmllZiA9IGJyaWVmRm9yKGl0ZW0pO1xuICAgICAgICB2YXIgZXhwYW5kZWQgPSBzdGF0ZS5leHBhbmRlZElkID09PSBpdGVtLmlkO1xuICAgICAgICByZXR1cm4gJzx0ciBjbGFzcz1cIm1oLWV2ZW50LXJvdycgKyAoZXhwYW5kZWQgPyAnIGFjdGl2ZScgOiAnJykgKyAnXCIgZGF0YS1pZD1cIicgKyBpdGVtLmlkICsgJ1wiIGFyaWEtZXhwYW5kZWQ9XCInICsgKGV4cGFuZGVkID8gJ3RydWUnIDogJ2ZhbHNlJykgKyAnXCI+J1xuICAgICAgICAgICAgKyAnPHRkIGNsYXNzPVwibWgtY2hldnJvbi1jZWxsXCI+JyArIElDT05fQ0hFVlJPTiArICc8L3RkPidcbiAgICAgICAgICAgICsgJzx0ZCBjbGFzcz1cIm1oLWNlbGwtdGltZVwiPicgKyBmbXRDZWxsVGltZShpdGVtLm9jY3VycmVkX2F0KSArICc8L3RkPidcbiAgICAgICAgICAgICsgJzx0ZD48ZGl2IGNsYXNzPVwibWgtZXZlbnQtY2VsbFwiPjxzcGFuIGNsYXNzPVwibWgtdHJ1bmNhdGVcIiB0aXRsZT1cIicgKyBlc2MoZXZlbnROYW1lKSArICdcIj4nICsgZXNjKGV2ZW50TmFtZSkgKyAnPC9zcGFuPicgKyBwcm9iZSArICc8L2Rpdj48L3RkPidcbiAgICAgICAgICAgICsgJzx0ZCBjbGFzcz1cIm1oLXRydW5jYXRlIG1oLW11dGVkXCIgdGl0bGU9XCInICsgZXNjKHN0YXR1c1Jhd0NvZGUoaXRlbSkgIT09ICcnID8gYnJpZWYgKyAnICgnICsgc3RhdHVzUmF3Q29kZShpdGVtKSArICcpJyA6IGJyaWVmKSArICdcIj4nICsgZXNjKGJyaWVmKSArICc8L3RkPidcbiAgICAgICAgICAgICsgJzx0ZD4nICsgZGVsaXZlcnlDZWxsKGl0ZW0pICsgJzwvdGQ+J1xuICAgICAgICAgICAgKyAnPC90cj4nO1xuICAgIH1cblxuICAgIC8vIDPigJM0IGh1bWFuIGZpZWxkczsgdGVjaG5pY2FsIG9uZXMgKGV2ZW50IHR5cGUsIGNhbGwgSUQsIHNvdXJjZSkgc3RheSBvdXQgb2YgdGhlIGludGVyZmFjZS5cbiAgICBmdW5jdGlvbiBkZXRhaWxGaWVsZHMoaXRlbSkge1xuICAgICAgICB2YXIgc3ViamVjdCA9IGl0ZW0ucGF5bG9hZCAmJiBpdGVtLnBheWxvYWQuc3ViamVjdCA/IGl0ZW0ucGF5bG9hZC5zdWJqZWN0IDoge307XG4gICAgICAgIHZhciBmYWN0cyA9IGl0ZW0ucGF5bG9hZCAmJiBpdGVtLnBheWxvYWQuZmFjdHMgPyBpdGVtLnBheWxvYWQuZmFjdHMgOiB7fTtcbiAgICAgICAgdmFyIGZpZWxkcyA9IFtdO1xuICAgICAgICB2YXIgZW1wbG95ZWVzID0gKHN1YmplY3QuZW1wbG95ZWVzIHx8IFtdKS5tYXAoZnVsbEVtcGxveWVlKS5qb2luKCcsICcpO1xuICAgICAgICBpZiAoZW1wbG95ZWVzICE9PSAnJykgeyBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsRW1wbG95ZWUnKSwgZW1wbG95ZWVzXSk7IH1cbiAgICAgICAgaWYgKHN1YmplY3QuY2xpZW50X251bWJlcikgeyBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsQ2xpZW50JyksIHN1YmplY3QuY2xpZW50X251bWJlcl0pOyB9XG4gICAgICAgIGlmIChpdGVtLmV2ZW50X3R5cGUgPT09ICdjb3JlLm1pc3NlZF9jYWxsJykge1xuICAgICAgICAgICAgdmFyIGNhbGxiYWNrID0gY2FsbGJhY2tUaW1lKGl0ZW0pO1xuICAgICAgICAgICAgaWYgKGNhbGxiYWNrID4gMCkge1xuICAgICAgICAgICAgICAgIGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxDYWxsZWRCYWNrJyksIGZtdENlbGxUZXh0KGNhbGxiYWNrKV0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHZhciBwcm92aWRlciA9IHN1YmplY3QucHJvdmlkZXIgfHwge307XG4gICAgICAgIGlmIChwcm92aWRlci51c2VybmFtZSB8fCBwcm92aWRlci5ob3N0KSB7XG4gICAgICAgICAgICBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsUHJvdmlkZXInKSwgKHByb3ZpZGVyLnVzZXJuYW1lIHx8ICcnKSArIChwcm92aWRlci5ob3N0ID8gJyDCtyAnICsgcHJvdmlkZXIuaG9zdCA6ICcnKV0pO1xuICAgICAgICB9XG4gICAgICAgIGlmIChzdWJqZWN0LmFkdmljZSAmJiBzdWJqZWN0LmFkdmljZS5tZXNzYWdlX3RwbCAmJiAhZmFjdHMuc3VtbWFyeSkge1xuICAgICAgICAgICAgZmllbGRzLnB1c2goW3QoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RldGFpbFN1bW1hcnknKSwgYWR2aWNlVGV4dChzdWJqZWN0LmFkdmljZSldKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZmFjdHMuc2NvcmVzICYmIGZhY3RzLnNjb3Jlcy5xdWFsaXR5ICE9PSBudWxsICYmIGZhY3RzLnNjb3Jlcy5xdWFsaXR5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxTY29yZScpLCBmYWN0cy5zY29yZXMucXVhbGl0eV0pO1xuICAgICAgICB9XG4gICAgICAgIGlmIChmYWN0cy5zdW1tYXJ5KSB7IGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxTdW1tYXJ5JyksIGZhY3RzLnN1bW1hcnldKTsgfVxuICAgICAgICBpZiAoc3ViamVjdC5tb2R1bGVfc3RhdHVzKSB7XG4gICAgICAgICAgICBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsU3VtbWFyeScpLFxuICAgICAgICAgICAgICAgIFtzdGF0dXNQaHJhc2UoaXRlbS5ldmVudF90eXBlLCBzdWJqZWN0Lm1vZHVsZV9zdGF0dXMpXS5jb25jYXQoc3RhdHVzQ291bnRlck5vdGVzKHN1YmplY3QubW9kdWxlX3N0YXR1cykpLmpvaW4oJy4gJyldKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoKGZhY3RzLnJlYXNvbnMgfHwgW10pLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxSZWFzb25zJyksIGZhY3RzLnJlYXNvbnMuam9pbignOyAnKV0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmaWVsZHM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZm10Q2VsbFRleHQodHMpIHtcbiAgICAgICAgaWYgKGlzVG9kYXkodHMpKSB7XG4gICAgICAgICAgICByZXR1cm4gZm10VGltZSh0cyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZtdERhdGUodHMpICsgJyAnICsgZm10VGltZSh0cyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyRGV0YWlsUm93KGl0ZW0pIHtcbiAgICAgICAgdmFyIGh0bWwgPSAnPGRsIGNsYXNzPVwibWgtZmllbGRzXCI+JztcbiAgICAgICAgZGV0YWlsRmllbGRzKGl0ZW0pLmZvckVhY2goZnVuY3Rpb24gKHBhaXIpIHtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkdD4nICsgZXNjKHBhaXJbMF0pICsgJzwvZHQ+PGRkPicgKyBlc2MocGFpclsxXSkgKyAnPC9kZD4nO1xuICAgICAgICB9KTtcbiAgICAgICAgdmFyIHJldHJ5YWJsZSA9IGZhbHNlO1xuICAgICAgICAoaXRlbS5kZWxpdmVyaWVzIHx8IFtdKS5mb3JFYWNoKGZ1bmN0aW9uIChkZWxpdmVyeSkge1xuICAgICAgICAgICAgdmFyIHN0YXR1cyA9IGRlbGl2ZXJ5U3RhdHVzVGV4dChkZWxpdmVyeSk7XG4gICAgICAgICAgICB2YXIgYXVkaW8gPSBhdHRhY2htZW50TGluZShkZWxpdmVyeSk7XG4gICAgICAgICAgICB2YXIgcmF3Q29kZSA9IGRlbGl2ZXJ5Lmxhc3RfZXJyb3JfY29kZSB8fCAnJztcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkdCBjbGFzcz1cIm1oLXRydW5jYXRlXCI+JyArIGVzYyhyZWNpcGllbnRUaXRsZShkZWxpdmVyeSkpICsgJzwvZHQ+J1xuICAgICAgICAgICAgICAgICsgJzxkZCcgKyAoc3RhdHVzLmJhZCA/ICcgY2xhc3M9XCJtaC1lcnJvci10ZXh0XCInIDogJycpICsgKHJhd0NvZGUgIT09ICcnID8gJyB0aXRsZT1cIicgKyBlc2MocmF3Q29kZSkucmVwbGFjZSgvXCIvZywgJyZxdW90OycpICsgJ1wiJyA6ICcnKSArICc+J1xuICAgICAgICAgICAgICAgICsgZXNjKHN0YXR1cy50ZXh0KVxuICAgICAgICAgICAgICAgICsgKGF1ZGlvID8gJzxkaXYgY2xhc3M9XCJtaC1tZXRhJyArIChhdWRpby5iYWQgPyAnIG1oLWVycm9yLXRleHQnIDogJycpICsgJ1wiJ1xuICAgICAgICAgICAgICAgICAgICArIChhdWRpby5jb2RlICE9PSAnJyA/ICcgdGl0bGU9XCInICsgZXNjKGF1ZGlvLmNvZGUpLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKSArICdcIicgOiAnJykgKyAnPicgKyBlc2MoYXVkaW8udGV4dCkgKyAnPC9kaXY+JyA6ICcnKVxuICAgICAgICAgICAgICAgICsgJzwvZGQ+JztcbiAgICAgICAgICAgIGlmIChkZWxpdmVyeS5zdGF0dXMgPT09ICdmYWlsZWQnICYmICFkZWxpdmVyeS5ib3RfZGVsZXRlZCAmJiAhZGVsaXZlcnkuY2hhdF9kZWxldGVkKSB7XG4gICAgICAgICAgICAgICAgcmV0cnlhYmxlID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGh0bWwgKz0gJzwvZGw+JztcbiAgICAgICAgaWYgKHJldHJ5YWJsZSkge1xuICAgICAgICAgICAgaHRtbCArPSAnPGJ1dHRvbiBjbGFzcz1cInVpIGJhc2ljIGJ1dHRvblwiIHR5cGU9XCJidXR0b25cIiBkYXRhLWFjdGlvbj1cInJldHJ5LWV2ZW50XCIgZGF0YS1ldmVudC1pZD1cIicgKyBpdGVtLmlkICsgJ1wiPidcbiAgICAgICAgICAgICAgICArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeVJldHJ5JykpICsgJzwvYnV0dG9uPic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICc8dHIgY2xhc3M9XCJtaC1kZXRhaWxcIiBkYXRhLWRldGFpbC1mb3I9XCInICsgaXRlbS5pZCArICdcIj48dGQgY29sc3Bhbj1cIjVcIj48ZGl2IGNsYXNzPVwibWgtZGV0YWlsLWJvZHlcIj4nICsgaHRtbCArICc8L2Rpdj48L3RkPjwvdHI+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZWNpcGllbnRUaXRsZShkZWxpdmVyeSkge1xuICAgICAgICBpZiAoZGVsaXZlcnkuY2hhdF90aXRsZSkge1xuICAgICAgICAgICAgcmV0dXJuIGRlbGl2ZXJ5LmNoYXRfdGl0bGU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRlbGl2ZXJ5LmNoYXRfZGVsZXRlZCkge1xuICAgICAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5Q2hhdERlbGV0ZWQnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZGVsaXZlcnkuZXh0ZXJuYWxfY2hhdF9pZCB8fCAn4oCUJztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZWxpdmVyeUNvdW50cyhpdGVtKSB7XG4gICAgICAgIHZhciBjb3VudHMgPSB7IHRvdGFsOiAwLCBzZW50OiAwLCBmYWlsZWQ6IDAsIHBlbmRpbmc6IDAsIHJlc29sdmVkOiAwIH07XG4gICAgICAgIChpdGVtLmRlbGl2ZXJpZXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24gKGRlbGl2ZXJ5KSB7XG4gICAgICAgICAgICBjb3VudHMudG90YWwrKztcbiAgICAgICAgICAgIGlmIChpc0ZhaWxlZERlbGl2ZXJ5KGRlbGl2ZXJ5KSkgeyBjb3VudHMuZmFpbGVkKys7IH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3BlbmRpbmcnIHx8IGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3NlbmRpbmcnKSB7IGNvdW50cy5wZW5kaW5nKys7IH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2NhbmNlbGxlZCcpIHsgY291bnRzLnJlc29sdmVkKys7IH1cbiAgICAgICAgICAgIGVsc2UgeyBjb3VudHMuc2VudCsrOyB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gY291bnRzO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlbGl2ZXJ5Q2VsbChpdGVtKSB7XG4gICAgICAgIHZhciBjID0gZGVsaXZlcnlDb3VudHMoaXRlbSk7XG4gICAgICAgIGlmIChjLnRvdGFsID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwibWgtbXV0ZWRcIj7igJQ8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYy5mYWlsZWQgPiAwKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCI+JyArIElDT05fRVJST1IgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlOb3REZWxpdmVyZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMucGVuZGluZyA+IDApIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1kb3RcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3RRdWV1ZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMuc2VudCA9PT0gMCAmJiBjLnJlc29sdmVkID4gMCkge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIm1oLWRvdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlDYWxsZWRCYWNrJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1kb3QgaXMtb2tcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3REZWxpdmVyZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgfVxuXG4gICAgLy8gT25lIGxpbmUgcGVyIHJlY2lwaWVudDogc3RhdHVzIOKAlCByZWFzb24uXG4gICAgZnVuY3Rpb24gZGVsaXZlcnlTdGF0dXNUZXh0KGRlbGl2ZXJ5KSB7XG4gICAgICAgIGlmIChpc0ZhaWxlZERlbGl2ZXJ5KGRlbGl2ZXJ5KSkge1xuICAgICAgICAgICAgdmFyIHJlYXNvbiA9IGRlbGl2ZXJ5UmVhc29uKGRlbGl2ZXJ5KTtcbiAgICAgICAgICAgIHJldHVybiB7IGJhZDogdHJ1ZSwgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlOb3REZWxpdmVyZWQnKSArIChyZWFzb24gIT09ICcnID8gJyDCtyAnICsgcmVhc29uIDogJycpIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3BlbmRpbmcnIHx8IGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3NlbmRpbmcnKSB7XG4gICAgICAgICAgICByZXR1cm4geyBiYWQ6IGZhbHNlLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0UXVldWVkJykgKyAoZGVsaXZlcnkubmV4dF9hdHRlbXB0X2F0ID4gMFxuICAgICAgICAgICAgICAgID8gJyDCtyAnICsgdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5TmV4dCcsIHsgdGltZTogZm10Q2VsbFRleHQoZGVsaXZlcnkubmV4dF9hdHRlbXB0X2F0KSB9KVxuICAgICAgICAgICAgICAgIDogJycpIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2NhbmNlbGxlZCcpIHtcbiAgICAgICAgICAgIHJldHVybiB7IGJhZDogZmFsc2UsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5U3RhdHVzQ2FuY2VsbGVkJykgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAncmV0cmFjdGVkJykge1xuICAgICAgICAgICAgcmV0dXJuIHsgYmFkOiBmYWxzZSwgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlTdGF0dXNSZXRyYWN0ZWQnKSB9O1xuICAgICAgICB9XG4gICAgICAgIGlmIChkZWxpdmVyeS5zdGF0dXMgPT09ICdyZXRyYWN0X2ZhaWxlZCcpIHtcbiAgICAgICAgICAgIHJldHVybiB7IGJhZDogdHJ1ZSwgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlTdGF0dXNSZXRyYWN0RmFpbGVkJykgfTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geyBiYWQ6IGZhbHNlLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0RGVsaXZlcmVkJykgfTtcbiAgICB9XG5cbiAgICAvLyBOb3JtYWxpc2VkIGRlbGl2ZXJ5L2F0dGFjaG1lbnQgY29kZXMgLT4gcmVhZGFibGUgdGV4dC4gVGhlIHJhdyBjb2RlIHN0YXlzIGF2YWlsYWJsZSBpbiBhIHRvb2x0aXAgb25seS5cbiAgICB2YXIgQ09ERV9URVhUX0tFWVMgPSB7XG4gICAgICAgICdhdHRhY2htZW50LmNvbnZlcnRlcl9taXNzaW5nJzogJ1JlYXNvbk5vQ29udmVydGVyJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQuY29udmVyc2lvbl9mYWlsZWQnOiAnUmVhc29uQ29udmVydCcsXG4gICAgICAgICdhdHRhY2htZW50LmNvbnZlcnNpb25fdGltZW91dCc6ICdSZWFzb25Db252ZXJ0JyxcbiAgICAgICAgJ2F0dGFjaG1lbnQucHJlcGFyZV9mYWlsZWQnOiAnUmVhc29uQ29udmVydCcsXG4gICAgICAgICdhdHRhY2htZW50LmNhY2hlX3VuYXZhaWxhYmxlJzogJ1JlYXNvbkNvbnZlcnQnLFxuICAgICAgICAnYXR0YWNobWVudC5idXN5JzogJ1JlYXNvbkNvbnZlcnQnLFxuICAgICAgICAnYXR0YWNobWVudC50b29fYmlnJzogJ1JlYXNvblRvb0JpZycsXG4gICAgICAgICdhdHRhY2htZW50LmR1cmF0aW9uX3Rvb19sb25nJzogJ1JlYXNvblRvb0JpZycsXG4gICAgICAgICdhdHRhY2htZW50LnNvdXJjZV9taXNzaW5nJzogJ1JlYXNvbk5vUmVjb3JkaW5nJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQucGF0aF9taXNzaW5nJzogJ1JlYXNvbk5vUmVjb3JkaW5nJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQucGF0aF9yZWplY3RlZCc6ICdSZWFzb25GaWxlVW5hdmFpbGFibGUnLFxuICAgICAgICAnYXR0YWNobWVudC51bmF2YWlsYWJsZSc6ICdSZWFzb25GaWxlVW5hdmFpbGFibGUnLFxuICAgICAgICAndGVsZWdyYW0uZmlsZV91bmF2YWlsYWJsZSc6ICdSZWFzb25GaWxlVW5hdmFpbGFibGUnLFxuICAgICAgICAnYXR0YWNobWVudC5xdW90ZXNfbWlzc2luZyc6ICdSZWFzb25Ob1F1b3RlcycsXG4gICAgICAgICdhdHRhY2htZW50LnVuY2VydGFpbic6ICdSZWFzb25VbmNlcnRhaW4nLFxuICAgICAgICAnZGVsaXZlcnkudW5jZXJ0YWluJzogJ1JlYXNvblVuY2VydGFpbicsXG4gICAgICAgICdhdHRhY2htZW50LnJldHJ5X2V4aGF1c3RlZCc6ICdSZWFzb25SZXRyaWVzJyxcbiAgICAgICAgJ2RlbGl2ZXJ5LmluY29tcGxldGUnOiAnUmVhc29uUmV0cmllcycsXG4gICAgICAgICdhdHRhY2htZW50LnJlamVjdGVkJzogJ1JlYXNvblJlamVjdGVkJyxcbiAgICAgICAgJ2h0dHAuYmFkX3JlcXVlc3QnOiAnUmVhc29uUmVqZWN0ZWQnLFxuICAgICAgICAnYXR0YWNobWVudC5ub3QucmVhZHknOiAnUmVhc29uTm90UmVhZHknLFxuICAgICAgICAnbWF4LmF0dGFjaG1lbnQubm90X3JlYWR5JzogJ1JlYXNvbk5vdFJlYWR5JyxcbiAgICAgICAgJ2F0dGFjaG1lbnQuY2FuY2VsbGVkJzogJ1JlYXNvbkNhbmNlbGxlZCcsXG4gICAgICAgICdodHRwLmNvbm5lY3RfZmFpbGVkJzogJ1JlYXNvbk5vQ29ubmVjdGlvbicsXG4gICAgICAgICdodHRwLnRpbWVvdXQnOiAnUmVhc29uTm9Db25uZWN0aW9uJyxcbiAgICAgICAgJ2h0dHAudW5hdmFpbGFibGUnOiAnUmVhc29uTm9Db25uZWN0aW9uJyxcbiAgICAgICAgJ2h0dHAudGxzJzogJ1JlYXNvbk5vQ29ubmVjdGlvbidcbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gY29kZVRleHQoY29kZSkge1xuICAgICAgICB2YXIga2V5ID0gQ09ERV9URVhUX0tFWVNbY29kZV07XG4gICAgICAgIHJldHVybiBrZXkgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl8nICsga2V5KSA6IGNvZGU7XG4gICAgfVxuXG4gICAgLy8gXCJSZWNvcmRpbmc6IHNlbnQgLyByZXBsYWNlZCBieSBhIG5vdGUgLyBza2lwcGVkIMK3IHJlYXNvblwiOyBudWxsIHdoZW4gdGhlIGRlbGl2ZXJ5IGNhcnJpZXMgbm8gYXVkaW8uXG4gICAgZnVuY3Rpb24gYXR0YWNobWVudExpbmUoZGVsaXZlcnkpIHtcbiAgICAgICAgdmFyIGEgPSBkZWxpdmVyeS5hdHRhY2htZW50O1xuICAgICAgICBpZiAoIWEgfHwgIWEuc3RhdGUgfHwgYS5zdGF0ZSA9PT0gJ25vbmUnKSB7IHJldHVybiBudWxsOyB9XG4gICAgICAgIHZhciB0ZXh0O1xuICAgICAgICB2YXIgYmFkID0gZmFsc2U7XG4gICAgICAgIHZhciB0b3RhbCA9IE51bWJlcihhLnBhcnRzKSB8fCAwO1xuICAgICAgICBpZiAoYS5zdGF0ZSA9PT0gJ3BlbmRpbmcnKSB7XG4gICAgICAgICAgICB0ZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQXR0YWNoUXVldWVkJyk7XG4gICAgICAgIH0gZWxzZSBpZiAoYS5zdGF0ZSA9PT0gJ3NlbnQnKSB7XG4gICAgICAgICAgICB0ZXh0ID0gdG90YWwgPiAxXG4gICAgICAgICAgICAgICAgPyB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQXR0YWNoUGFydGlhbCcsIHsgc2VudDogYS5zZW50LCB0b3RhbDogdG90YWwgfSlcbiAgICAgICAgICAgICAgICA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0F0dGFjaFNlbnQnKTtcbiAgICAgICAgfSBlbHNlIGlmIChhLnN0YXRlID09PSAncGFydGlhbCcpIHtcbiAgICAgICAgICAgIHRleHQgPSB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQXR0YWNoUGFydGlhbCcsIHsgc2VudDogYS5zZW50LCB0b3RhbDogdG90YWwgfSk7XG4gICAgICAgIH0gZWxzZSBpZiAoYS5zdGF0ZSA9PT0gJ3NraXBwZWQnKSB7XG4gICAgICAgICAgICAvLyB0aGUgZmFsbGJhY2sgbm90ZSBpbiB0aGUgdGV4dCB0ZWxscyB3aGVyZSB0aGUgcmVjb3JkaW5nIGNhbiBiZSBmb3VuZFxuICAgICAgICAgICAgdGV4dCA9IGEubm90ZSA9PT0gJ3NlbnQnID8gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQXR0YWNoUmVwbGFjZWQnKSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0F0dGFjaFNraXBwZWQnKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hGYWlsZWQnKTtcbiAgICAgICAgICAgIGJhZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGEuY29kZSAmJiBhLnN0YXRlICE9PSAncGVuZGluZycgJiYgYS5zdGF0ZSAhPT0gJ3NlbnQnKSB7XG4gICAgICAgICAgICB0ZXh0ICs9ICcgwrcgJyArIGNvZGVUZXh0KGEuY29kZSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHsgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQXR0YWNoTGFiZWwnKSArICc6ICcgKyB0ZXh0LCBjb2RlOiBhLmNvZGUgfHwgJycsIGJhZDogYmFkIH07XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZGVsaXZlcnlSZWFzb24oZGVsaXZlcnkpIHtcbiAgICAgICAgaWYgKGRlbGl2ZXJ5LmJvdF9kZWxldGVkKSB7IHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeUJvdERlbGV0ZWQnKTsgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuY2hhdF9kZWxldGVkKSB7IHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeUNoYXREZWxldGVkJyk7IH1cbiAgICAgICAgdmFyIGNvZGUgPSBkZWxpdmVyeS5sYXN0X2Vycm9yX2NvZGUgfHwgJyc7XG4gICAgICAgIGlmIChjb2RlID09PSAndGVsZWdyYW0uNDAxLnVuYXV0aG9yaXplZCcpIHsgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c1Rva2VuSW52YWxpZCcpOyB9XG4gICAgICAgIGlmIChjb2RlID09PSAndGVsZWdyYW0uNDAzLmtpY2tlZCcgfHwgY29kZSA9PT0gJ3RlbGVncmFtLjQwMy5ibG9ja2VkJyB8fCBjb2RlID09PSAndGVsZWdyYW0uNDAwLmNoYXRfbm90X2ZvdW5kJ1xuICAgICAgICAgICAgfHwgY29kZSA9PT0gJ21heC40MDMuY2hhdF9kZW5pZWQnIHx8IGNvZGUgPT09ICdtYXguNDA0Lm5vdF9mb3VuZCcgfHwgY29kZSA9PT0gJ21heC40MDQudW5rbm93bicpIHtcbiAgICAgICAgICAgIHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0U3RhdHVzR29uZScpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBjb2RlVGV4dChjb2RlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB0b2dnbGVSb3coaWQpIHtcbiAgICAgICAgc3RhdGUuZXhwYW5kZWRJZCA9IHN0YXRlLmV4cGFuZGVkSWQgPT09IGlkID8gbnVsbCA6IGlkO1xuICAgICAgICByZW5kZXJKb3VybmFsKCk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiBwYWdlciAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiByZW5kZXJQYWdlcigpIHtcbiAgICAgICAgdmFyICRwYWdlciA9ICQoJyNtaC1qb3VybmFsLXBhZ2VyJyk7XG4gICAgICAgIGlmIChzdGF0ZS5sYXN0SXRlbXMubGVuZ3RoID09PSAwIHx8IHN0YXRlLnRvdGFsIDw9IFBBR0VfTElNSVQpIHtcbiAgICAgICAgICAgICRwYWdlci5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAkcGFnZXIucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXBhZ2UtaW5mbycpLnRleHQodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0V2ZW50c1BhZ2UnLCB7XG4gICAgICAgICAgICBmcm9tOiBzdGF0ZS5vZmZzZXQgKyAxLFxuICAgICAgICAgICAgdG86IHN0YXRlLm9mZnNldCArIHN0YXRlLmxhc3RJdGVtcy5sZW5ndGgsXG4gICAgICAgICAgICB0b3RhbDogc3RhdGUudG90YWxcbiAgICAgICAgfSkpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1wcmV2JykuYXR0cignZGlzYWJsZWQnLCBzdGF0ZS5vZmZzZXQgPD0gMCk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLW5leHQnKS5hdHRyKCdkaXNhYmxlZCcsIHN0YXRlLm9mZnNldCArIHN0YXRlLmxhc3RJdGVtcy5sZW5ndGggPj0gc3RhdGUudG90YWwpO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gc2V0dGluZ3MgdGFiIC0tLS0tLS0tLS1cblxuICAgIC8vIEZpZWxkcyBjYXJyeSBubyBoaW50cyAoZGVzaWduIHYzKTsgdGhlIGhlbHAgbGluZSB1bmRlciBhIGZpZWxkIGlzIHVzZWQgb25seSBmb3IgaXRzIGVycm9yLlxuICAgIGZ1bmN0aW9uIG1hcmtGaWVsZEVycm9yKGZpZWxkU2VsZWN0b3IsIG1lc3NhZ2UpIHtcbiAgICAgICAgJChmaWVsZFNlbGVjdG9yKS5hZGRDbGFzcygnZXJyb3InKS5maW5kKCcubWgtaGVscCcpLnRleHQobWVzc2FnZSB8fCAnJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2xlYXJGaWVsZEVycm9yKGZpZWxkU2VsZWN0b3IpIHtcbiAgICAgICAgJChmaWVsZFNlbGVjdG9yKS5yZW1vdmVDbGFzcygnZXJyb3InKS5maW5kKCcubWgtaGVscCcpLnRleHQoJycpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1hcmtSZXRlbnRpb25FcnJvcihtZXNzYWdlKSB7XG4gICAgICAgIG1hcmtGaWVsZEVycm9yKCcjbWgtcmV0ZW50aW9uLWZpZWxkJywgbWVzc2FnZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2xlYXJSZXRlbnRpb25FcnJvcigpIHtcbiAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtcmV0ZW50aW9uLWZpZWxkJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZVJldGVudGlvbigpIHtcbiAgICAgICAgdmFyIHJhdyA9IFN0cmluZygkKCcjbWgtcmV0ZW50aW9uLWlucHV0JykudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgdmFyIGRheXMgPSAvXlxcZCskLy50ZXN0KHJhdykgPyBwYXJzZUludChyYXcsIDEwKSA6IC0xO1xuICAgICAgICBpZiAoZGF5cyA8IDEgfHwgZGF5cyA+IDM2NSkge1xuICAgICAgICAgICAgbWFya1JldGVudGlvbkVycm9yKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9TZXR0aW5nc1JldGVudGlvbkVycm9yJywge30pKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjbGVhclJldGVudGlvbkVycm9yKCk7XG4gICAgICAgIGFwaVBhdGNoKCcvc2V0dGluZ3MnLCB7IGV2ZW50c19yZXRlbnRpb25fZGF5czogZGF5cyB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5yZXRlbnRpb24gPSBkYXlzO1xuICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVkJykpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBtYXJrUmV0ZW50aW9uRXJyb3IodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vbkxvYWRFcnJvcicsIHtcbiAgICAgICAgICAgICAgICB3aGF0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Mb2FkV2hhdFNldHRpbmdzJyksXG4gICAgICAgICAgICAgICAgY29kZTogJ2h0dHBfZXJyb3InXG4gICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAkKCcjbWgtcmV0ZW50aW9uLWlucHV0JykudmFsKHN0YXRlLnJldGVudGlvbik7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNob3dUb2FzdChtZXNzYWdlKSB7XG4gICAgICAgIC8vIHRoZSBhZG1pbiBjYWJpbmV0J3MgRm9tYW50aWMgYnVpbGQgaGFzIG5vIHRvYXN0IG1vZHVsZSDigJQgYSB0aW55IHBpbGwgb2Ygb3VyIG93biAoNCBzKVxuICAgICAgICB2YXIgZXhpc3RpbmcgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcubWgtdG9hc3QnKTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBleGlzdGluZy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgZXhpc3RpbmdbaV0ucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChleGlzdGluZ1tpXSk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHRvYXN0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgICAgIHRvYXN0LmNsYXNzTmFtZSA9ICdtaC10b2FzdCc7XG4gICAgICAgIHRvYXN0LnNldEF0dHJpYnV0ZSgncm9sZScsICdzdGF0dXMnKTtcbiAgICAgICAgdG9hc3QudGV4dENvbnRlbnQgPSBtZXNzYWdlO1xuICAgICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKHRvYXN0KTtcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAodG9hc3QucGFyZW50Tm9kZSkge1xuICAgICAgICAgICAgICAgIHRvYXN0LnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQodG9hc3QpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LCA0MDAwKTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGJvdHM6IEFQSSAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBhcGlTZW5kKG1ldGhvZCwgcGF0aCwgcGF5bG9hZCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpIHtcbiAgICAgICAgdmFyIG9wdGlvbnMgPSB7XG4gICAgICAgICAgICB1cmw6IENvbmZpZy5wYnhVcmwgKyBBUElfQkFTRSArIHBhdGgsXG4gICAgICAgICAgICBtZXRob2Q6IG1ldGhvZCxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgICAgICBjYWNoZTogZmFsc2VcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKHBheWxvYWQgIT09IG51bGwgJiYgcGF5bG9hZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvcHRpb25zLmRhdGEgPSBKU09OLnN0cmluZ2lmeShwYXlsb2FkKTtcbiAgICAgICAgICAgIG9wdGlvbnMuY29udGVudFR5cGUgPSAnYXBwbGljYXRpb24vanNvbic7XG4gICAgICAgIH1cbiAgICAgICAgJC5hamF4KG9wdGlvbnMpLmRvbmUoZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2UucmVzdWx0ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgb25TdWNjZXNzKHJlc3BvbnNlLmRhdGEpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBvbkZhaWx1cmUobm9ybWFsaXplRmFpbHVyZShyZXNwb25zZSwgMjAwKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLmZhaWwoZnVuY3Rpb24gKHhocikge1xuICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUoeGhyLnJlc3BvbnNlSlNPTiB8fCBudWxsLCB4aHIuc3RhdHVzKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGFwaVBvc3QocGF0aCwgcGF5bG9hZCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpIHtcbiAgICAgICAgYXBpU2VuZCgnUE9TVCcsIHBhdGgsIHBheWxvYWQgfHwge30sIG9uU3VjY2Vzcywgb25GYWlsdXJlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBhcGlEZWxldGUocGF0aCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpIHtcbiAgICAgICAgYXBpU2VuZCgnREVMRVRFJywgcGF0aCwgbnVsbCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNvcmVHZXQocGF0aCwgcGFyYW1zLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBDb25maWcucGJ4VXJsICsgJy9wYnhjb3JlL2FwaS92MycgKyBwYXRoLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGRhdGE6IHBhcmFtcyB8fCB7fSxcbiAgICAgICAgICAgIGNhY2hlOiBmYWxzZVxuICAgICAgICB9KS5kb25lKGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlICYmIHJlc3BvbnNlLnJlc3VsdCA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgIG9uU3VjY2VzcyhyZXNwb25zZS5kYXRhKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUocmVzcG9uc2UsIDIwMCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KS5mYWlsKGZ1bmN0aW9uICh4aHIpIHtcbiAgICAgICAgICAgIG9uRmFpbHVyZShub3JtYWxpemVGYWlsdXJlKHhoci5yZXNwb25zZUpTT04gfHwgbnVsbCwgeGhyLnN0YXR1cykpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmYWlsdXJlVGV4dChmYWlsdXJlKSB7XG4gICAgICAgIGlmIChmYWlsdXJlICYmIGZhaWx1cmUuZmllbGQpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWlsdXJlLm1lc3NhZ2VzLmxlbmd0aCA+IDAgPyBmYWlsdXJlLm1lc3NhZ2VzWzBdIDogZmFpbHVyZS5lcnJvcjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gKGZhaWx1cmUgJiYgZmFpbHVyZS5lcnJvcikgPyBmYWlsdXJlLmVycm9yIDogJ2h0dHBfZXJyb3InO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gYm90czogc3RhdGUgJiByZW5kZXJpbmcgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gYm90QnlJZChpZCkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLmJvdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIoc3RhdGUuYm90c1tpXS5pZCkgPT09IE51bWJlcihpZCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc3RhdGUuYm90c1tpXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZXBsYWNlQm90KGJvdCkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLmJvdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIoc3RhdGUuYm90c1tpXS5pZCkgPT09IE51bWJlcihib3QuaWQpKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUuYm90c1tpXSA9IGJvdDtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgc3RhdGUuYm90cy5wdXNoKGJvdCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbG9hZEJvdHMoc2lsZW50KSB7XG4gICAgICAgIGlmICghc2lsZW50KSB7XG4gICAgICAgICAgICBzdGF0ZS5ib3RzTG9hZGVkID0gZmFsc2U7XG4gICAgICAgICAgICByZW5kZXJCb3RzU2tlbGV0b24oKTtcbiAgICAgICAgfVxuICAgICAgICBhcGlHZXQoJy9ib3RzJywgeyBsaW1pdDogMjAwIH0sIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICBzdGF0ZS5ib3RzID0gZGF0YS5pdGVtcyB8fCBbXTtcbiAgICAgICAgICAgIHN0YXRlLmJvdHNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc3RhdGUuYm90c0Vycm9yID0gbnVsbDtcbiAgICAgICAgICAgIHJlbmRlckJvdHMoKTtcbiAgICAgICAgICAgIHJlbmRlclJ1bGVzKCk7XG4gICAgICAgICAgICByZW5kZXJKb3VybmFsQmFubmVyKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICBzdGF0ZS5ib3RzTG9hZGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIHN0YXRlLmJvdHNFcnJvciA9IGZhaWx1cmU7XG4gICAgICAgICAgICByZW5kZXJCb3RzKCk7XG4gICAgICAgICAgICByZW5kZXJSdWxlcygpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJCb3RzU2tlbGV0b24oKSB7XG4gICAgICAgIHZhciBjYXJkID0gJzxkaXYgY2xhc3M9XCJtaC1ib3QtY2FyZCBtaC1ib3Qtc2tlbGV0b25cIj48c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjMycHg7aGVpZ2h0OjMycHg7Ym9yZGVyLXJhZGl1czo4cHhcIj48L3NwYW4+J1xuICAgICAgICAgICAgKyAnPGRpdiBzdHlsZT1cImZsZXg6MTtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDo2cHhcIj48c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjUwJVwiPjwvc3Bhbj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjMwJTtoZWlnaHQ6OHB4XCI+PC9zcGFuPjwvZGl2PjwvZGl2Pic7XG4gICAgICAgICQoJyNtaC1ib3RzJykuaHRtbChjYXJkICsgY2FyZCk7XG4gICAgfVxuXG4gICAgLy8gVGVsZWdyYW0gLyBNQVggdGlsZXM6IHRoZSBmaXJzdC1ydW4gc2NyZWVuIGFuZCDCq9Cd0LDRgdGC0YDQvtC50LrQuMK7IHdpdGhvdXQgYm90cyAoZGVzaWduIHYzKS5cbiAgICBmdW5jdGlvbiBtZXNzZW5nZXJUaWxlcygpIHtcbiAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwibWgtbWVzc2VuZ2VyLXRpbGVzXCI+J1xuICAgICAgICAgICAgKyAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJtaC1zY2VuYXJpbyBtaC10aWxlXCIgZGF0YS1hY3Rpb249XCJhZGQtYm90XCIgZGF0YS1jaGFubmVsPVwidGVsZWdyYW1cIj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1lc3NlbmdlciB0Z1wiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPlRHPC9zcGFuPjxiPlRlbGVncmFtPC9iPjwvYnV0dG9uPidcbiAgICAgICAgICAgICsgJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwibWgtc2NlbmFyaW8gbWgtdGlsZVwiIGRhdGEtYWN0aW9uPVwiYWRkLWJvdFwiIGRhdGEtY2hhbm5lbD1cIm1heFwiPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyIG1heFwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPk1BWDwvc3Bhbj48Yj5NQVg8L2I+PC9idXR0b24+J1xuICAgICAgICAgICAgKyAnPC9kaXY+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJCb3RzKCkge1xuICAgICAgICB2YXIgJHdyYXAgPSAkKCcjbWgtYm90cycpO1xuICAgICAgICBpZiAoc3RhdGUuYm90c0Vycm9yICE9PSBudWxsICYmIHN0YXRlLmJvdHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAkKCcjbWgtYm90LWFkZCcpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJHdyYXAuaHRtbCgnPGRpdiBjbGFzcz1cInVpIG5lZ2F0aXZlIG1lc3NhZ2VcIiByb2xlPVwiYWxlcnRcIj4nICsgSUNPTl9FUlJPUlxuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ncm93XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RzTG9hZEZhaWxlZCcpKSArICc8L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAnPGJ1dHRvbiBjbGFzcz1cInVpIGJhc2ljIGJ1dHRvbiBtaC1vbi1tZXNzYWdlXCIgdHlwZT1cImJ1dHRvblwiIGlkPVwibWgtYm90cy1yZXRyeVwiPidcbiAgICAgICAgICAgICAgICArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25SZXRyeScpKSArICc8L2J1dHRvbj48L2Rpdj4nKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3RzLXJldHJ5Jykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkgeyBsb2FkQm90cygpOyB9KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXN0YXRlLmJvdHNMb2FkZWQpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtYm90LWFkZCcpLmF0dHIoJ2hpZGRlbicsIHN0YXRlLmJvdHMubGVuZ3RoID4gMCA/IG51bGwgOiB0cnVlKTtcbiAgICAgICAgaWYgKHN0YXRlLmJvdHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAkd3JhcC5odG1sKG1lc3NlbmdlclRpbGVzKCkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBodG1sID0gJzxkaXYgY2xhc3M9XCJtaC1ib3QtbGlzdFwiPic7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUuYm90cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaHRtbCArPSByZW5kZXJCb3RDYXJkKHN0YXRlLmJvdHNbaV0pO1xuICAgICAgICB9XG4gICAgICAgICR3cmFwLmh0bWwoaHRtbCArICc8L2Rpdj4nKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJCb3RDYXJkKGJvdCkge1xuICAgICAgICB2YXIgZXhwYW5kZWQgPSBzdGF0ZS5leHBhbmRlZEJvdHNbYm90LmlkXSA9PT0gdHJ1ZTtcbiAgICAgICAgdmFyIGJvZHkgPSAnJztcbiAgICAgICAgaWYgKGV4cGFuZGVkKSB7XG4gICAgICAgICAgICBib2R5ID0gJzxkaXYgY2xhc3M9XCJtaC1ib3QtYm9keVwiPicgKyByZW5kZXJCb3RUbHNXYXJuaW5nKGJvdCkgKyByZW5kZXJCb3RDaGF0cyhib3QpICsgcmVuZGVyQm90QWN0aW9ucyhib3QpICsgJzwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGNoYXRDb3VudCA9IChib3QuY2hhdHMgfHwgW10pLmxlbmd0aDtcbiAgICAgICAgdmFyIG1ldGEgPSBbXTtcbiAgICAgICAgaWYgKGJvdC5ib3RfdXNlcm5hbWUpIHsgbWV0YS5wdXNoKCdAJyArIGJvdC5ib3RfdXNlcm5hbWUpOyB9XG4gICAgICAgIG1ldGEucHVzaChjaGF0Q291bnQgPiAwID8gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoYXRzQ291bnQnLCB7IGNvdW50OiBjaGF0Q291bnQgfSkgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGF0c05vbmUnKSk7XG4gICAgICAgIHJldHVybiAnPGRpdiBjbGFzcz1cIm1oLWJvdC1yb3cnICsgKGV4cGFuZGVkID8gJyBpcy1vcGVuJyA6ICcnKSArICdcIiBkYXRhLWJvdC1pZD1cIicgKyBib3QuaWQgKyAnXCI+J1xuICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLWJvdC1oZWFkXCIgZGF0YS1hY3Rpb249XCJ0b2dnbGVcIiByb2xlPVwiYnV0dG9uXCIgdGFiaW5kZXg9XCIwXCIgYXJpYS1leHBhbmRlZD1cIicgKyAoZXhwYW5kZWQgPyAndHJ1ZScgOiAnZmFsc2UnKSArICdcIj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1lc3NlbmdlciAnICsgKGJvdC5jaGFubmVsID09PSAnbWF4JyA/ICdtYXgnIDogJ3RnJykgKyAnXCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+JyArIChib3QuY2hhbm5lbCA9PT0gJ21heCcgPyAnTUFYJyA6ICdURycpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtYm90LXRpdGxlc1wiPjxiIGNsYXNzPVwibWgtdHJ1bmNhdGVcIj4nICsgZXNjKGJvdC50aXRsZSkgKyAnPC9iPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWV0YSBtaC10cnVuY2F0ZVwiPicgKyBlc2MobWV0YS5qb2luKCcgwrcgJykpICsgJzwvc3Bhbj48L2Rpdj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWJvdC1zdGF0dXNcIj4nICsgYm90U3RhdHVzQ2VsbChib3QpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWNoZXZyb25cIiBhcmlhLWhpZGRlbj1cInRydWVcIj4nXG4gICAgICAgICAgICArICc8c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBzdHlsZT1cInRyYW5zZm9ybTpyb3RhdGUoJyArIChleHBhbmRlZCA/ICcxODAnIDogJzAnKSArICdkZWcpXCI+PHBhdGggZD1cIk0zLjUgNkw4IDEwLjUgMTIuNSA2XCIvPjwvc3ZnPidcbiAgICAgICAgICAgICsgJzwvc3Bhbj48L2Rpdj4nICsgYm9keSArICc8L2Rpdj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJvdFN0YXR1c0NlbGwoYm90KSB7XG4gICAgICAgIGlmIChib3QuZW5hYmxlZCA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1kb3RcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c0Rpc2FibGVkJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmIChib3Quc3RhdHVzID09PSAnb2snKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwibWgtZG90IGlzLW9rXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTdGF0dXNPaycpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYm90LnN0YXR1cyA9PT0gJ3Rva2VuX2ludmFsaWQnKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTdGF0dXNUb2tlbkludmFsaWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICdjYV9lcnJvcicpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c0NhRXJyb3InKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICdlcnJvcicpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSB5ZWxsb3cgbGFiZWxcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c0NoZWNrRmFpbGVkJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1kb3RcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c05ldycpKSArICc8L3NwYW4+JztcbiAgICB9XG5cbiAgICAvLyBUaGUgTUFYIEFQSSBpcyBzaWduZWQgYnkgdGhlINCc0LjQvdGG0LjRhNGA0Ysgcm9vdCBDQTogYSB0cnVzdCBmYWlsdXJlIGlzIGEgY29uZmlndXJhdGlvbiBwcm9ibGVtLCBub3QgYVxuICAgIC8vIHRva2VuIHByb2JsZW0sIHNvIGl0IGdldHMgaXRzIG93biBleHBsYW5hdGlvbiBhbmQgcG9pbnRzIHRvIHRoZSBzZXR0aW5ncyBmaWVsZC5cbiAgICBmdW5jdGlvbiByZW5kZXJCb3RUbHNXYXJuaW5nKGJvdCkge1xuICAgICAgICBpZiAoYm90LnN0YXR1cyAhPT0gJ2NhX2Vycm9yJyAmJiAhaXNNYXhUbHNDb2RlKGJvdC5sYXN0X2Vycm9yX2NvZGUpKSB7XG4gICAgICAgICAgICByZXR1cm4gJyc7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwidWkgd2FybmluZyBtZXNzYWdlXCIgcm9sZT1cIm5vdGVcIj4nXG4gICAgICAgICAgICArICc8c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBhcmlhLWhpZGRlbj1cInRydWVcIj48Y2lyY2xlIGN4PVwiOFwiIGN5PVwiOFwiIHI9XCI2LjI1XCIvPjxwYXRoIGQ9XCJNOCA0LjV2NE04IDExaC4wMVwiLz48L3N2Zz4nXG4gICAgICAgICAgICArICc8ZGl2PicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzQ2FFcnJvcicpKSArICcuICdcbiAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENhRXJyb3JIaW50JykpICsgJzwvZGl2PjwvZGl2Pic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2hhdEtpbmRMYWJlbChraW5kKSB7XG4gICAgICAgIGlmIChraW5kID09PSAncHJpdmF0ZScpIHsgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRUeXBlUHJpdmF0ZScpOyB9XG4gICAgICAgIGlmIChraW5kID09PSAnY2hhbm5lbCcpIHsgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRUeXBlQ2hhbm5lbCcpOyB9XG4gICAgICAgIHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0VHlwZUdyb3VwJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyQm90Q2hhdHMoYm90KSB7XG4gICAgICAgIHZhciBjaGF0cyA9IGJvdC5jaGF0cyB8fCBbXTtcbiAgICAgICAgaWYgKGNoYXRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwibWgtYm90LW5vY2hhdHMgbWgtbXV0ZWRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdE5vQ2hhdHNUaXRsZScpKSArICc8L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIHZhciBodG1sID0gJzxkaXYgY2xhc3M9XCJtaC1jaGF0LWxpc3RcIj4nO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNoYXRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBodG1sICs9IHJlbmRlckNoYXRSb3coYm90LCBjaGF0c1tpXSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGh0bWwgKyAnPC9kaXY+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJDaGF0Um93KGJvdCwgY2hhdCkge1xuICAgICAgICB2YXIgZ29uZSA9IGNoYXQuc3RhdGUgPT09ICdnb25lJztcbiAgICAgICAgdmFyIHN0YXRlQ2VsbDtcbiAgICAgICAgaWYgKGdvbmUpIHtcbiAgICAgICAgICAgIHN0YXRlQ2VsbCA9ICc8c3BhbiBjbGFzcz1cInVpIHJlZCBsYWJlbFwiIHRpdGxlPVwiJyArIGVzYyhjaGF0LmdvbmVfcmVhc29uKSArICdcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRTdGF0dXNHb25lJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9IGVsc2UgaWYgKGNoYXQubGFzdF9kZWxpdmVyeSAmJiBjaGF0Lmxhc3RfZGVsaXZlcnkuc3RhdHVzID09PSAnZmFpbGVkJykge1xuICAgICAgICAgICAgc3RhdGVDZWxsID0gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0U3RhdHVzRXJyb3InKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBzdGF0ZUNlbGwgPSAnPHNwYW4gY2xhc3M9XCJtaC1kb3QgaXMtb2tcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRTdGF0dXNPaycpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJtaC1jaGF0LXJvd1wiIGRhdGEtY2hhdC1pZD1cIicgKyBjaGF0LmlkICsgJ1wiPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtY2hhdC10aXRsZVwiPjxzcGFuIGNsYXNzPVwibWgtdHJ1bmNhdGVcIj4nICsgZXNjKGNoYXQudGl0bGUgfHwgY2hhdC5jaGF0X2lkKSArICc8L3NwYW4+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tZXRhXCI+IMK3ICcgKyBlc2MoY2hhdEtpbmRMYWJlbChjaGF0LmNoYXRfa2luZCkpICsgJzwvc3Bhbj48L3NwYW4+J1xuICAgICAgICAgICAgKyBlbXBsb3llZVNlbGVjdChjaGF0KVxuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1jaGF0LXN0YXRlXCI+JyArIHN0YXRlQ2VsbCArICc8L3NwYW4+J1xuICAgICAgICAgICAgKyAnPGxhYmVsIGNsYXNzPVwidWkgdG9nZ2xlIGNoZWNrYm94JyArIChjaGF0LmVuYWJsZWQgPyAnIGNoZWNrZWQnIDogJycpICsgKGdvbmUgPyAnIGRpc2FibGVkJyA6ICcnKSArICdcIiBhcmlhLWxhYmVsPVwiJyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RFbmFibGVDaGF0JykpICsgJ1wiPidcbiAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjbGFzcz1cImhpZGRlbiBtaC1jaGF0LXRvZ2dsZVwiJyArIChjaGF0LmVuYWJsZWQgPyAnIGNoZWNrZWQnIDogJycpICsgKGdvbmUgPyAnIGRpc2FibGVkJyA6ICcnKSArICc+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC10cmFja1wiPjwvc3Bhbj48L2xhYmVsPidcbiAgICAgICAgICAgICsgJzwvZGl2Pic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZW1wbG95ZWVTZWxlY3QoY2hhdCkge1xuICAgICAgICB2YXIgb3B0aW9ucyA9ICc8b3B0aW9uIHZhbHVlPVwiMFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdE5vRW1wbG95ZWUnKSkgKyAnPC9vcHRpb24+JztcbiAgICAgICAgdmFyIGZvdW5kID0gZmFsc2U7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUuZW1wbG95ZWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgZW1wbG95ZWUgPSBzdGF0ZS5lbXBsb3llZXNbaV07XG4gICAgICAgICAgICB2YXIgc2VsZWN0ZWQgPSBOdW1iZXIoZW1wbG95ZWUuaWQpID09PSBOdW1iZXIoY2hhdC5saW5rZWRfdXNlcl9pZCk7XG4gICAgICAgICAgICBpZiAoc2VsZWN0ZWQpIHsgZm91bmQgPSB0cnVlOyB9XG4gICAgICAgICAgICBvcHRpb25zICs9ICc8b3B0aW9uIHZhbHVlPVwiJyArIGVtcGxveWVlLmlkICsgJ1wiJyArIChzZWxlY3RlZCA/ICcgc2VsZWN0ZWQnIDogJycpICsgJz4nICsgZXNjKGVtcGxveWVlLmxhYmVsKSArICc8L29wdGlvbj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmICghZm91bmQgJiYgTnVtYmVyKGNoYXQubGlua2VkX3VzZXJfaWQpID4gMCkge1xuICAgICAgICAgICAgb3B0aW9ucyArPSAnPG9wdGlvbiB2YWx1ZT1cIicgKyBjaGF0LmxpbmtlZF91c2VyX2lkICsgJ1wiIHNlbGVjdGVkPiMnICsgY2hhdC5saW5rZWRfdXNlcl9pZCArICc8L29wdGlvbj4nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnPHNlbGVjdCBjbGFzcz1cIm1oLWVtcGxveWVlLXNlbGVjdFwiIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRFbXBsb3llZScpKSArICdcIj4nICsgb3B0aW9ucyArICc8L3NlbGVjdD4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdEFjdGlvbnMoYm90KSB7XG4gICAgICAgIHJldHVybiAnPGRpdiBjbGFzcz1cIm1oLWJvdC1hY3Rpb25zXCI+J1xuICAgICAgICAgICAgKyAnPGEgaHJlZj1cIiNcIiBkYXRhLWFjdGlvbj1cImNvbm5lY3RcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdEFjdGlvbnNDb25uZWN0JykpICsgJzwvYT4nXG4gICAgICAgICAgICArICc8YSBocmVmPVwiI1wiIGRhdGEtYWN0aW9uPVwidGVzdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90QWN0aW9uc1Rlc3QnKSkgKyAnPC9hPidcbiAgICAgICAgICAgICsgJzxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJlZGl0XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RBY3Rpb25zRWRpdCcpKSArICc8L2E+J1xuICAgICAgICAgICAgKyAnPC9kaXY+JztcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGJvdHM6IGRlbGVnYXRlZCBhY3Rpb25zIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGJpbmRCb3RzQ29udGFpbmVyKCkge1xuICAgICAgICB2YXIgJHdyYXAgPSAkKCcjbWgtYm90cycpO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwidG9nZ2xlXCJdJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGlkID0gU3RyaW5nKCQodGhpcykuY2xvc2VzdCgnLm1oLWJvdC1yb3cnKS5kYXRhKCdib3QtaWQnKSk7XG4gICAgICAgICAgICBzdGF0ZS5leHBhbmRlZEJvdHNbaWRdID0gc3RhdGUuZXhwYW5kZWRCb3RzW2lkXSAhPT0gdHJ1ZTtcbiAgICAgICAgICAgIHJlbmRlckJvdHMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdrZXlkb3duJywgJ1tkYXRhLWFjdGlvbj1cInRvZ2dsZVwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgaWYgKGV2ZW50LmtleSA9PT0gJ0VudGVyJyB8fCBldmVudC5rZXkgPT09ICcgJykge1xuICAgICAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICAgICAgJCh0aGlzKS50cmlnZ2VyKCdjbGljaycpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImFkZC1ib3RcIl0nLCBmdW5jdGlvbiAoKSB7IG9wZW5Cb3RNb2RhbCgnYWRkJywgbnVsbCwgJCh0aGlzKS5kYXRhKCdjaGFubmVsJykpOyB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImNvbm5lY3RcIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBvcGVuQ2hhdE1vZGFsKGJvdEJ5SWQoJCh0aGlzKS5jbG9zZXN0KCcubWgtYm90LXJvdycpLmRhdGEoJ2JvdC1pZCcpKSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwidGVzdFwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIG9wZW5UZXN0TW9kYWwoYm90QnlJZCgkKHRoaXMpLmNsb3Nlc3QoJy5taC1ib3Qtcm93JykuZGF0YSgnYm90LWlkJykpLCBudWxsKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJlZGl0XCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgb3BlbkJvdE1vZGFsKCdlZGl0JywgYm90QnlJZCgkKHRoaXMpLmNsb3Nlc3QoJy5taC1ib3Qtcm93JykuZGF0YSgnYm90LWlkJykpKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjaGFuZ2UnLCAnLm1oLWNoYXQtdG9nZ2xlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGJvdElkID0gJCh0aGlzKS5jbG9zZXN0KCcubWgtYm90LXJvdycpLmRhdGEoJ2JvdC1pZCcpO1xuICAgICAgICAgICAgdmFyIGNoYXRJZCA9ICQodGhpcykuY2xvc2VzdCgnLm1oLWNoYXQtcm93JykuZGF0YSgnY2hhdC1pZCcpO1xuICAgICAgICAgICAgdmFyIGVuYWJsZWQgPSAkKHRoaXMpLnByb3AoJ2NoZWNrZWQnKTtcbiAgICAgICAgICAgIHBhdGNoQm90KGJvdElkLCB7IGNoYXRzOiBbeyBpZDogTnVtYmVyKGNoYXRJZCksIGVuYWJsZWQ6IGVuYWJsZWQgfV0gfSwgbnVsbCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25TYXZlRmFpbGVkJykpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2hhbmdlJywgJy5taC1lbXBsb3llZS1zZWxlY3QnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgYm90SWQgPSAkKHRoaXMpLmNsb3Nlc3QoJy5taC1ib3Qtcm93JykuZGF0YSgnYm90LWlkJyk7XG4gICAgICAgICAgICB2YXIgY2hhdElkID0gJCh0aGlzKS5jbG9zZXN0KCcubWgtY2hhdC1yb3cnKS5kYXRhKCdjaGF0LWlkJyk7XG4gICAgICAgICAgICBwYXRjaEJvdChib3RJZCwgeyBjaGF0czogW3sgaWQ6IE51bWJlcihjaGF0SWQpLCBsaW5rZWRfdXNlcl9pZDogTnVtYmVyKCQodGhpcykudmFsKCkpIH1dIH0sIG51bGwsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZUZhaWxlZCcpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBwYXRjaEJvdChib3RJZCwgcGF5bG9hZCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpIHtcbiAgICAgICAgYXBpUGF0Y2goJy9ib3RzLycgKyBib3RJZCwgcGF5bG9hZCwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgcmVwbGFjZUJvdChib3QpO1xuICAgICAgICAgICAgcmVuZGVyQm90cygpO1xuICAgICAgICAgICAgaWYgKG9uU3VjY2VzcykgeyBvblN1Y2Nlc3MoYm90KTsgfVxuICAgICAgICB9LCBvbkZhaWx1cmUgfHwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgIHNob3dUb2FzdChmYWlsdXJlVGV4dChmYWlsdXJlKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gZW1wbG95ZWVzIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGxvYWRFbXBsb3llZXMoZG9uZSkge1xuICAgICAgICBpZiAoc3RhdGUuZW1wbG95ZWVzTG9hZGVkKSB7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29yZUdldCgnL2V4dGVuc2lvbnMnLCB7IGxpbWl0OiA1MDAgfSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHZhciBpdGVtcyA9IGRhdGEuaXRlbXMgfHwgW107XG4gICAgICAgICAgICB2YXIgc2VlbiA9IHt9O1xuICAgICAgICAgICAgdmFyIGxpc3QgPSBbXTtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaXRlbXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICB2YXIgaXRlbSA9IGl0ZW1zW2ldO1xuICAgICAgICAgICAgICAgIHZhciB1c2VySWQgPSBOdW1iZXIoaXRlbS51c2VyaWQpO1xuICAgICAgICAgICAgICAgIGlmICghdXNlcklkIHx8IHNlZW5bdXNlcklkXSkge1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgc2Vlblt1c2VySWRdID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB2YXIgbmFtZSA9IGl0ZW0uY2FsbGVyaWQgfHwgaXRlbS5udW1iZXIgfHwgKCcjJyArIHVzZXJJZCk7XG4gICAgICAgICAgICAgICAgdmFyIG51bWJlciA9IGl0ZW0ubnVtYmVyID8gU3RyaW5nKGl0ZW0ubnVtYmVyKSA6ICcnO1xuICAgICAgICAgICAgICAgIHZhciBsYWJlbCA9IChudW1iZXIgIT09ICcnICYmIFN0cmluZyhuYW1lKS5pbmRleE9mKG51bWJlcikgPT09IC0xKSA/IG5hbWUgKyAnICgnICsgbnVtYmVyICsgJyknIDogbmFtZTtcbiAgICAgICAgICAgICAgICBsaXN0LnB1c2goeyBpZDogdXNlcklkLCBsYWJlbDogbGFiZWwgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBsaXN0LnNvcnQoZnVuY3Rpb24gKGEsIGIpIHsgcmV0dXJuIGEubGFiZWwubG9jYWxlQ29tcGFyZShiLmxhYmVsKTsgfSk7XG4gICAgICAgICAgICBzdGF0ZS5lbXBsb3llZXMgPSBsaXN0O1xuICAgICAgICAgICAgc3RhdGUuZW1wbG95ZWVzTG9hZGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIHN0YXRlLmVtcGxveWVlc0ZhaWxlZCA9IGZhbHNlO1xuICAgICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5lbXBsb3llZXNMb2FkZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIHN0YXRlLmVtcGxveWVlc0ZhaWxlZCA9IHRydWU7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gYm90IG1vZGFsIC0tLS0tLS0tLS1cblxuICAgIC8vIENoYW5uZWxzIHdpdGggYSBiYWNrZW5kIGFkYXB0ZXIgKGJvdGggaGF2ZSBvbmUgc2luY2Ugc3RhZ2UgM2IvM2MpLiBUaGUgY2hlY2tzIGJlbG93IHN0YXkgYXMgYVxuICAgIC8vIGd1YXJkOiBhIGNoYW5uZWwgd2l0aG91dCBhbiBhZGFwdGVyIG9uIHRoZSBzZXJ2ZXIgbXVzdCBub3QgYmUgc2F2ZWQgZnJvbSBhIHN0YWxlIHBhZ2UuXG4gICAgdmFyIFNBVkFCTEVfQ0hBTk5FTFMgPSBbJ3RlbGVncmFtJywgJ21heCddO1xuXG4gICAgZnVuY3Rpb24gb3BlbkJvdE1vZGFsKG1vZGUsIGJvdCwgY2hhbm5lbCkge1xuICAgICAgICBzdGF0ZS5ib3RNb2RhbCA9IHtcbiAgICAgICAgICAgIG1vZGU6IG1vZGUsXG4gICAgICAgICAgICBib3Q6IGJvdCxcbiAgICAgICAgICAgIGNoYW5uZWw6IG1vZGUgPT09ICdlZGl0JyAmJiBib3QgPyAoYm90LmNoYW5uZWwgfHwgJ3RlbGVncmFtJykgOiAoY2hhbm5lbCA9PT0gJ21heCcgPyAnbWF4JyA6ICd0ZWxlZ3JhbScpLFxuICAgICAgICAgICAgZHJhZnRJZDogMCxcbiAgICAgICAgICAgIHNhdmVkOiBmYWxzZSxcbiAgICAgICAgICAgIHRva2VuQ2hhbmdlZDogZmFsc2UsXG4gICAgICAgICAgICBidXN5OiBmYWxzZVxuICAgICAgICB9O1xuICAgICAgICAkKCcjbWgtYm90LWNoZWNrLW1lc3NhZ2UnKS5lbXB0eSgpO1xuICAgICAgICAkKCcjbWgtYm90LXRpdGxlLWZpZWxkJykucmVtb3ZlQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4tcm93JykucmVtb3ZlQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICQoJyNtaC1ib3QtbW9kYWwtdGl0bGUnKS50ZXh0KG1vZGUgPT09ICdlZGl0JyA/IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RFZGl0VGl0bGUnLCB7IHRpdGxlOiBib3QudGl0bGUgfSkgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RBZGRUaXRsZScpKTtcbiAgICAgICAgJCgnI21oLWJvdC10aXRsZScpLnZhbChib3QgPyBib3QudGl0bGUgOiAnJyk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4nKS52YWwoJycpO1xuICAgICAgICAkKCcjbWgtYm90LXRva2VuLW5ldycpLnZhbCgnJyk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4tbmV3LXJvdycpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAkKCcjbWgtYm90LWRlbGV0ZScpLmF0dHIoJ2hpZGRlbicsIG1vZGUgPT09ICdlZGl0JyA/IG51bGwgOiB0cnVlKTtcbiAgICAgICAgJCgnI21oLWJvdC1zYXZlJykudGV4dChtb2RlID09PSAnZWRpdCcgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTYXZlJykgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTYXZlQW5kQ29ubmVjdCcpKTtcbiAgICAgICAgaWYgKG1vZGUgPT09ICdlZGl0Jykge1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1yb3cnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4taGludC1yb3cnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4taGludCcpLnRleHQoJ+KAouKAouKAouKAoicgKyAoYm90LnRva2VuX2hpbnQgfHwgJycpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4tcm93JykucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRva2VuLWhpbnQtcm93JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgIH1cbiAgICAgICAgc3luY0JvdENoYW5uZWwoKTtcbiAgICAgICAgJCgnI21oLWJvdC1tb2RhbCcpLm1vZGFsKHsgY2xvc2FibGU6IGZhbHNlIH0pLm1vZGFsKCdzaG93Jyk7XG4gICAgICAgICQoJyNtaC1ib3QtdGl0bGUnKS50cmlnZ2VyKCdmb2N1cycpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHN5bmNCb3RDaGFubmVsKCkge1xuICAgICAgICB2YXIgbW9kYWwgPSBzdGF0ZS5ib3RNb2RhbDtcbiAgICAgICAgaWYgKCFtb2RhbCkgeyByZXR1cm47IH1cbiAgICAgICAgJCgnI21oLWJvdC1tb2RhbCAubWgtY2hhbm5lbC1jYXJkJykuZWFjaChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgY2hhbm5lbCA9IFN0cmluZygkKHRoaXMpLmRhdGEoJ2NoYW5uZWwnKSk7XG4gICAgICAgICAgICB2YXIgc2VsZWN0ZWQgPSBjaGFubmVsID09PSBtb2RhbC5jaGFubmVsO1xuICAgICAgICAgICAgdmFyIGxvY2tlZCA9IG1vZGFsLm1vZGUgPT09ICdlZGl0JyAmJiAhc2VsZWN0ZWQ7XG4gICAgICAgICAgICAkKHRoaXMpLnRvZ2dsZUNsYXNzKCdpcy1zZWxlY3RlZCcsIHNlbGVjdGVkKS50b2dnbGVDbGFzcygnaXMtZGlzYWJsZWQnLCBsb2NrZWQpXG4gICAgICAgICAgICAgICAgLmF0dHIoJ2FyaWEtZGlzYWJsZWQnLCBsb2NrZWQgPyAndHJ1ZScgOiBudWxsKTtcbiAgICAgICAgICAgICQodGhpcykuZmluZCgnaW5wdXQnKS5wcm9wKCdjaGVja2VkJywgc2VsZWN0ZWQpLnByb3AoJ2Rpc2FibGVkJywgbG9ja2VkKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHZhciBzYXZhYmxlID0gU0FWQUJMRV9DSEFOTkVMUy5pbmRleE9mKG1vZGFsLmNoYW5uZWwpID49IDA7XG4gICAgICAgICQoJyNtaC1ib3Qtc2F2ZSwgI21oLWJvdC1jaGVjaycpLnByb3AoJ2Rpc2FibGVkJywgIXNhdmFibGUpLnRvZ2dsZUNsYXNzKCdkaXNhYmxlZCcsICFzYXZhYmxlKTtcbiAgICAgICAgLy8gYSBNQVggdG9rZW4gY29tZXMgZnJvbSBidXNpbmVzcy5tYXgucnUgYWZ0ZXIgbW9kZXJhdGlvbjsgVGVsZWdyYW0gbmVlZHMgbm8gZXhwbGFuYXRpb25cbiAgICAgICAgdmFyIG1heEhlbHAgPSBtb2RhbC5jaGFubmVsID09PSAnbWF4JztcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbi1oZWxwJykudGV4dChtYXhIZWxwID8gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90VG9rZW5IZWxwTWF4JykgOiAnJyk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4taGVscC1yb3cnKS5hdHRyKCdoaWRkZW4nLCBtYXhIZWxwID8gbnVsbCA6IHRydWUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGlzTWF4VGxzQ29kZShjb2RlKSB7XG4gICAgICAgIHJldHVybiBTdHJpbmcoY29kZSB8fCAnJykuaW5kZXhPZignbWF4LnRscy4nKSA9PT0gMDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB0bHNFcnJvclRleHQoKSB7XG4gICAgICAgIHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTdGF0dXNDYUVycm9yJykgKyAnLiAnICsgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2FFcnJvckhpbnQnKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBib3RGb3JtVmFsdWVzKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdGl0bGU6IFN0cmluZygkKCcjbWgtYm90LXRpdGxlJykudmFsKCkgfHwgJycpLnRyaW0oKSxcbiAgICAgICAgICAgIHRva2VuOiBTdHJpbmcoJCgnI21oLWJvdC10b2tlbicpLnZhbCgpIHx8ICcnKS50cmltKCksXG4gICAgICAgICAgICB0b2tlbk5ldzogU3RyaW5nKCQoJyNtaC1ib3QtdG9rZW4tbmV3JykudmFsKCkgfHwgJycpLnRyaW0oKVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNob3dCb3RNZXNzYWdlKGtpbmQsIHRleHQpIHtcbiAgICAgICAgdmFyIGNscyA9IGtpbmQgPT09ICdvaycgPyAndWkgcG9zaXRpdmUgbWVzc2FnZScgOiAoa2luZCA9PT0gJ3dhcm4nID8gJ3VpIHdhcm5pbmcgbWVzc2FnZScgOiAndWkgbmVnYXRpdmUgbWVzc2FnZScpO1xuICAgICAgICB2YXIgaWNvbiA9IGtpbmQgPT09ICdvaydcbiAgICAgICAgICAgID8gJzxjaXJjbGUgY3g9XCI4XCIgY3k9XCI4XCIgcj1cIjYuMjVcIi8+PHBhdGggZD1cIk01LjUgOC4ybDEuOCAxLjggMy4zLTMuNlwiLz4nXG4gICAgICAgICAgICA6ICc8Y2lyY2xlIGN4PVwiOFwiIGN5PVwiOFwiIHI9XCI2LjI1XCIvPjxwYXRoIGQ9XCJNNiA2bDQgNE0xMCA2bC00IDRcIi8+JztcbiAgICAgICAgJCgnI21oLWJvdC1jaGVjay1tZXNzYWdlJykuaHRtbCgnPGRpdiBjbGFzcz1cIicgKyBjbHMgKyAnXCIgcm9sZT1cInN0YXR1c1wiPidcbiAgICAgICAgICAgICsgJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPicgKyBpY29uICsgJzwvc3ZnPidcbiAgICAgICAgICAgICsgJzxkaXY+JyArIGVzYyh0ZXh0KSArICc8L2Rpdj48L2Rpdj4nKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBib3RDaGVja01lc3NhZ2UoYm90KSB7XG4gICAgICAgIGlmIChib3Quc3RhdHVzID09PSAnb2snKSB7XG4gICAgICAgICAgICByZXR1cm4geyBraW5kOiAnb2snLCB0ZXh0OiB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZE9rJywge1xuICAgICAgICAgICAgICAgIHVzZXJuYW1lOiBib3QuYm90X3VzZXJuYW1lIHx8IGJvdC5ib3RfZXh0ZXJuYWxfaWQsXG4gICAgICAgICAgICAgICAgbmFtZTogYm90LmJvdF91c2VybmFtZSA/ICdAJyArIGJvdC5ib3RfdXNlcm5hbWUgOiBib3QudGl0bGVcbiAgICAgICAgICAgIH0pIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5sYXN0X2Vycm9yX2NvZGUgPT09ICdvdGhlcl9ib3QnKSB7XG4gICAgICAgICAgICByZXR1cm4geyBraW5kOiAnd2FybicsIHRleHQ6IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkT3RoZXInLCB7XG4gICAgICAgICAgICAgICAgdXNlcm5hbWU6IGJvdC5ib3RfdXNlcm5hbWUgfHwgJycsXG4gICAgICAgICAgICAgICAgYm90OiBib3QudGl0bGVcbiAgICAgICAgICAgIH0pIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICd0b2tlbl9pbnZhbGlkJykge1xuICAgICAgICAgICAgcmV0dXJuIHsga2luZDogJ2VycicsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrZWQ0MDEnKSB9O1xuICAgICAgICB9XG4gICAgICAgIGlmIChib3Quc3RhdHVzID09PSAnY2FfZXJyb3InIHx8IGlzTWF4VGxzQ29kZShib3QubGFzdF9lcnJvcl9jb2RlKSkge1xuICAgICAgICAgICAgcmV0dXJuIHsga2luZDogJ2VycicsIHRleHQ6IHRsc0Vycm9yVGV4dCgpIH07XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHsga2luZDogJ3dhcm4nLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja05ldHdvcmsnKSArIChib3QubGFzdF9lcnJvcl9jb2RlID8gJyAoJyArIGJvdC5sYXN0X2Vycm9yX2NvZGUgKyAnKScgOiAnJykgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjaGVja0JvdEZvcm0oKSB7XG4gICAgICAgIGlmICghc3RhdGUuYm90TW9kYWwgfHwgU0FWQUJMRV9DSEFOTkVMUy5pbmRleE9mKHN0YXRlLmJvdE1vZGFsLmNoYW5uZWwpIDwgMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciB2YWx1ZXMgPSBib3RGb3JtVmFsdWVzKCk7XG4gICAgICAgIGlmICh2YWx1ZXMudGl0bGUgPT09ICcnKSB7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRpdGxlLWZpZWxkJykuYWRkQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90VGl0bGVSZXF1aXJlZCcpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtYm90LXRpdGxlLWZpZWxkJykucmVtb3ZlQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgIHZhciBtb2RlID0gc3RhdGUuYm90TW9kYWwubW9kZTtcbiAgICAgICAgdmFyIHBheWxvYWQ7XG4gICAgICAgIHZhciBkb25lID0gZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgc3RhdGUuYm90TW9kYWwuYm90ID0gYm90O1xuICAgICAgICAgICAgc3RhdGUuYm90TW9kYWwuZHJhZnRJZCA9IGJvdC5pZDtcbiAgICAgICAgICAgIHJlcGxhY2VCb3QoYm90KTtcbiAgICAgICAgICAgIHZhciBtZXNzYWdlID0gYm90Q2hlY2tNZXNzYWdlKGJvdCk7XG4gICAgICAgICAgICBzaG93Qm90TWVzc2FnZShtZXNzYWdlLmtpbmQsIG1lc3NhZ2UudGV4dCk7XG4gICAgICAgIH07XG4gICAgICAgIHZhciBmYWlsdXJlID0gZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgaWYgKGVyci5maWVsZCA9PT0gJ3Rva2VuJykge1xuICAgICAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4tcm93JykuYWRkQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgZmFpbHVyZVRleHQoZXJyKSk7XG4gICAgICAgIH07XG4gICAgICAgIGlmIChtb2RlID09PSAnYWRkJykge1xuICAgICAgICAgICAgcGF5bG9hZCA9IHsgY2hhbm5lbDogc3RhdGUuYm90TW9kYWwuY2hhbm5lbCwgdGl0bGU6IHZhbHVlcy50aXRsZSwgdG9rZW46IHZhbHVlcy50b2tlbiB9O1xuICAgICAgICAgICAgaWYgKHN0YXRlLmJvdE1vZGFsLmRyYWZ0SWQgPiAwKSB7XG4gICAgICAgICAgICAgICAgYXBpUGF0Y2goJy9ib3RzLycgKyBzdGF0ZS5ib3RNb2RhbC5kcmFmdElkLCB7IHRpdGxlOiB2YWx1ZXMudGl0bGUsIHRva2VuOiB2YWx1ZXMudG9rZW4gfSwgZG9uZSwgZmFpbHVyZSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGFwaVBvc3QoJy9ib3RzJywgcGF5bG9hZCwgZG9uZSwgZmFpbHVyZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHZhbHVlcy50b2tlbk5ldyAhPT0gJycpIHtcbiAgICAgICAgICAgIGFwaVBvc3QoJy9ib3RzLycgKyBzdGF0ZS5ib3RNb2RhbC5ib3QuaWQgKyAnOmNoZWNrVG9rZW4nLCB7IHRva2VuOiB2YWx1ZXMudG9rZW5OZXcgfSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgICAgICBpZiAoZGF0YS5vaykge1xuICAgICAgICAgICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnb2snLCB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZE9rJywge1xuICAgICAgICAgICAgICAgICAgICAgICAgdXNlcm5hbWU6IGRhdGEudXNlcm5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBkYXRhLmRpc3BsYXlfbmFtZVxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChkYXRhLmVycm9yX2NvZGUgPT09ICdvdGhlcl9ib3QnKSB7XG4gICAgICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCd3YXJuJywgdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrZWRPdGhlcicsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHVzZXJuYW1lOiBkYXRhLnVzZXJuYW1lIHx8ICcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgYm90OiBzdGF0ZS5ib3RNb2RhbC5ib3QudGl0bGVcbiAgICAgICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoZGF0YS5lcnJvcl9jb2RlID09PSAndGVsZWdyYW0uNDAxLnVuYXV0aG9yaXplZCcgfHwgZGF0YS5lcnJvcl9jb2RlID09PSAnbWF4LjQwMS51bmF1dGhvcml6ZWQnKSB7XG4gICAgICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkNDAxJykpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoaXNNYXhUbHNDb2RlKGRhdGEuZXJyb3JfY29kZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgc2hvd0JvdE1lc3NhZ2UoJ2VycicsIHRsc0Vycm9yVGV4dCgpKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnd2FybicsIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrTmV0d29yaycpICsgJyAoJyArIGRhdGEuZXJyb3JfY29kZSArICcpJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgZmFpbHVyZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIHN0YXRlLmJvdE1vZGFsLmJvdC5pZCArICc6Y2hlY2tUb2tlbicsIHt9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICBpZiAoZGF0YS5vaykge1xuICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdvaycsIHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkT2snLCB7XG4gICAgICAgICAgICAgICAgICAgIHVzZXJuYW1lOiBkYXRhLnVzZXJuYW1lLFxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBkYXRhLmRpc3BsYXlfbmFtZVxuICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoaXNNYXhUbHNDb2RlKGRhdGEuZXJyb3JfY29kZSkpIHtcbiAgICAgICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgdGxzRXJyb3JUZXh0KCkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZDQwMScpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSwgZmFpbHVyZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZUJvdEZvcm0oKSB7XG4gICAgICAgIGlmICghc3RhdGUuYm90TW9kYWwgfHwgU0FWQUJMRV9DSEFOTkVMUy5pbmRleE9mKHN0YXRlLmJvdE1vZGFsLmNoYW5uZWwpIDwgMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciB2YWx1ZXMgPSBib3RGb3JtVmFsdWVzKCk7XG4gICAgICAgIGlmICh2YWx1ZXMudGl0bGUgPT09ICcnKSB7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRpdGxlLWZpZWxkJykuYWRkQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90VGl0bGVSZXF1aXJlZCcpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB2YXIgbW9kZSA9IHN0YXRlLmJvdE1vZGFsLm1vZGU7XG4gICAgICAgIHZhciBmaW5pc2ggPSBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICBzdGF0ZS5ib3RNb2RhbC5zYXZlZCA9IHRydWU7XG4gICAgICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgICAgICAkKCcjbWgtYm90LW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICAgICAgaWYgKG1vZGUgPT09ICdhZGQnKSB7XG4gICAgICAgICAgICAgICAgb3BlbkNoYXRNb2RhbChib3QpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZWQnKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIHZhciBmYWlsdXJlID0gZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgaWYgKGVyci5maWVsZCA9PT0gJ3Rva2VuJykge1xuICAgICAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4tcm93JykuYWRkQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgZmFpbHVyZVRleHQoZXJyKSk7XG4gICAgICAgIH07XG4gICAgICAgIGlmIChtb2RlID09PSAnYWRkJykge1xuICAgICAgICAgICAgdmFyIGNyZWF0ZSA9IGZ1bmN0aW9uIChpZCkge1xuICAgICAgICAgICAgICAgIGFwaVBvc3QoJy9ib3RzLycgKyBpZCArICc6ZGlzY292ZXJDaGF0cycsIHt9LCBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICAgICAgICAgIGZpbmlzaChib3QpO1xuICAgICAgICAgICAgICAgIH0sIGZhaWx1cmUpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5ib3RNb2RhbC5kcmFmdElkID4gMCkge1xuICAgICAgICAgICAgICAgIGFwaVBhdGNoKCcvYm90cy8nICsgc3RhdGUuYm90TW9kYWwuZHJhZnRJZCwgeyB0aXRsZTogdmFsdWVzLnRpdGxlLCB0b2tlbjogdmFsdWVzLnRva2VuIH0sIGZ1bmN0aW9uIChib3QpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVwbGFjZUJvdChib3QpO1xuICAgICAgICAgICAgICAgICAgICBjcmVhdGUoYm90LmlkKTtcbiAgICAgICAgICAgICAgICB9LCBmYWlsdXJlKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgYXBpUG9zdCgnL2JvdHMnLCB7IGNoYW5uZWw6IHN0YXRlLmJvdE1vZGFsLmNoYW5uZWwsIHRpdGxlOiB2YWx1ZXMudGl0bGUsIHRva2VuOiB2YWx1ZXMudG9rZW4gfSwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgICAgICAgICAgICAgIGNyZWF0ZShib3QuaWQpO1xuICAgICAgICAgICAgICAgIH0sIGZhaWx1cmUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBwYXlsb2FkID0geyB0aXRsZTogdmFsdWVzLnRpdGxlIH07XG4gICAgICAgIGlmICh2YWx1ZXMudG9rZW5OZXcgIT09ICcnKSB7XG4gICAgICAgICAgICBwYXlsb2FkLnRva2VuID0gdmFsdWVzLnRva2VuTmV3O1xuICAgICAgICB9XG4gICAgICAgIGFwaVBhdGNoKCcvYm90cy8nICsgc3RhdGUuYm90TW9kYWwuYm90LmlkLCBwYXlsb2FkLCBmaW5pc2gsIGZhaWx1cmUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNhbmNlbEJvdE1vZGFsKCkge1xuICAgICAgICB2YXIgbW9kYWwgPSBzdGF0ZS5ib3RNb2RhbDtcbiAgICAgICAgc3RhdGUuYm90TW9kYWwgPSBudWxsO1xuICAgICAgICAkKCcjbWgtYm90LW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgaWYgKG1vZGFsICYmIG1vZGFsLmRyYWZ0SWQgPiAwICYmICFtb2RhbC5zYXZlZCkge1xuICAgICAgICAgICAgLy8gdGhlIFwi0J/RgNC+0LLQtdGA0LjRgtGMXCIgYnV0dG9uIGNyZWF0ZWQgdGhlIGRyYWZ0OiBjYW5jZWxsaW5nIG11c3Qgbm90IGxlYXZlIGl0IGJlaGluZFxuICAgICAgICAgICAgYXBpRGVsZXRlKCcvYm90cy8nICsgbW9kYWwuZHJhZnRJZCwgZnVuY3Rpb24gKCkgeyBsb2FkQm90cyh0cnVlKTsgfSwgZnVuY3Rpb24gKCkgeyBsb2FkQm90cyh0cnVlKTsgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNvbmZpcm1EZWxldGVCb3QoKSB7XG4gICAgICAgIHZhciBib3QgPSBzdGF0ZS5ib3RNb2RhbC5ib3Q7XG4gICAgICAgIGlmICghYm90KSB7IHJldHVybjsgfVxuICAgICAgICAkKCcjbWgtY29uZmlybS10ZXh0JykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90RGVsZXRlQ29uZmlybScsIHsgdGl0bGU6IGJvdC50aXRsZSwgY291bnQ6IChib3QuY2hhdHMgfHwgW10pLmxlbmd0aCB9KSk7XG4gICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsJykubW9kYWwoeyBjbG9zYWJsZTogdHJ1ZSB9KS5tb2RhbCgnc2hvdycpO1xuICAgICAgICAkKCcjbWgtY29uZmlybS1vaycpLm9mZignY2xpY2snKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtY29uZmlybS1tb2RhbCcpLm1vZGFsKCdoaWRlJyk7XG4gICAgICAgICAgICBhcGlEZWxldGUoJy9ib3RzLycgKyBib3QuaWQsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5ib3RNb2RhbC5zYXZlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgc3RhdGUuYm90TW9kYWwuZHJhZnRJZCA9IDA7XG4gICAgICAgICAgICAgICAgJCgnI21oLWJvdC1tb2RhbCcpLm1vZGFsKCdoaWRlJyk7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vbkRlbGV0ZWQnKSk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KGZhaWx1cmVUZXh0KGVycikpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gZGlzY292ZXJ5IG1vZGFsIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIG9wZW5DaGF0TW9kYWwoYm90KSB7XG4gICAgICAgIGlmICghYm90KSB7IHJldHVybjsgfVxuICAgICAgICBzdGF0ZS5jaGF0TW9kYWwgPSB7IGJvdElkOiBib3QuaWQsIGJvdDogYm90LCB0aW1lcjogbnVsbCwgc2VsZWN0ZWQ6IHt9IH07XG4gICAgICAgICQoJyNtaC1jaGF0LW1vZGFsLXRpdGxlJykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RUaXRsZScsIHsgdGl0bGU6IGJvdC50aXRsZSB9KSk7XG4gICAgICAgIHZhciBpc01heCA9IGJvdC5jaGFubmVsID09PSAnbWF4JztcbiAgICAgICAgJCgnI21oLWNoYXQtc3RlcHMnKS50ZXh0KHRmKGlzTWF4ID8gJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0U3RlcHNNYXgnIDogJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0U3RlcHMnLCB7XG4gICAgICAgICAgICBib3Q6IGJvdC5ib3RfdXNlcm5hbWUgPyAnQCcgKyBib3QuYm90X3VzZXJuYW1lIDogYm90LnRpdGxlXG4gICAgICAgIH0pKTtcbiAgICAgICAgJCgnI21oLWNoYXQtZm91bmQnKS5lbXB0eSgpO1xuICAgICAgICAkKCcjbWgtY2hhdC1lcnJvcicpLmVtcHR5KCk7XG4gICAgICAgICQoJyNtaC1jaGF0LWVtcHR5JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1jaGF0LWFnYWluJykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1jaGF0LXN0b3AnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgJCgnI21oLWNoYXQtc2F2ZScpLmF0dHIoJ2Rpc2FibGVkJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1jaGF0LXN0YXR1cy10ZXh0JykudGV4dCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdFNlYXJjaGluZycpKTtcbiAgICAgICAgJCgnI21oLWNoYXQtY291bnRkb3duJykudGV4dCgnJyk7XG4gICAgICAgICQoJyNtaC1jaGF0LXByb2dyZXNzIC5iYXInKS5jc3MoJ3dpZHRoJywgJzAlJyk7XG4gICAgICAgICQoJyNtaC1jaGF0LW1vZGFsJykubW9kYWwoeyBjbG9zYWJsZTogZmFsc2UgfSkubW9kYWwoJ3Nob3cnKTtcbiAgICAgICAgc3RhcnREaXNjb3ZlcnkoYm90LmlkLCBmYWxzZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3RhcnREaXNjb3ZlcnkoYm90SWQsIHJlc3RhcnQpIHtcbiAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIGJvdElkICsgJzpkaXNjb3ZlckNoYXRzJywgeyByZXN0YXJ0OiByZXN0YXJ0ID09PSB0cnVlIH0sIGZ1bmN0aW9uIChib3QpIHtcbiAgICAgICAgICAgIGlmICghc3RhdGUuY2hhdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkID0ge307XG4gICAgICAgICAgICB1cGRhdGVDaGF0TW9kYWwoYm90KTtcbiAgICAgICAgICAgIHNjaGVkdWxlQ2hhdFBvbGwoKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgc2hvd0NoYXRFcnJvcihmYWlsdXJlVGV4dChlcnIpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2NoZWR1bGVDaGF0UG9sbCgpIHtcbiAgICAgICAgc3RvcENoYXRQb2xsKCk7XG4gICAgICAgIHN0YXRlLmNoYXRNb2RhbC50aW1lciA9IHNldEludGVydmFsKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICghc3RhdGUuY2hhdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgYXBpR2V0KCcvYm90cy8nICsgc3RhdGUuY2hhdE1vZGFsLmJvdElkLCB7fSwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgICAgIGlmICghc3RhdGUuY2hhdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICAgIHVwZGF0ZUNoYXRNb2RhbChib3QpO1xuICAgICAgICAgICAgICAgIGlmICghYm90LmRpc2NvdmVyeS5hY3RpdmUpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RvcENoYXRQb2xsKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKCkgeyAvKiBrZWVwIHRoZSBsYXN0IHN0YXRlICovIH0pO1xuICAgICAgICB9LCAyMDAwKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzdG9wQ2hhdFBvbGwoKSB7XG4gICAgICAgIGlmIChzdGF0ZS5jaGF0TW9kYWwgJiYgc3RhdGUuY2hhdE1vZGFsLnRpbWVyICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjbGVhckludGVydmFsKHN0YXRlLmNoYXRNb2RhbC50aW1lcik7XG4gICAgICAgICAgICBzdGF0ZS5jaGF0TW9kYWwudGltZXIgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdXBkYXRlQ2hhdE1vZGFsKGJvdCkge1xuICAgICAgICBpZiAoIXN0YXRlLmNoYXRNb2RhbCkgeyByZXR1cm47IH1cbiAgICAgICAgc3RhdGUuY2hhdE1vZGFsLmJvdCA9IGJvdDtcbiAgICAgICAgcmVwbGFjZUJvdChib3QpO1xuICAgICAgICB2YXIgZGlzY292ZXJ5ID0gYm90LmRpc2NvdmVyeSB8fCB7IGFjdGl2ZTogZmFsc2UsIHN0YXR1czogJ2lkbGUnLCBmb3VuZDogW10gfTtcbiAgICAgICAgdmFyIGZvdW5kID0gZGlzY292ZXJ5LmZvdW5kIHx8IFtdO1xuICAgICAgICB2YXIgc2VsZWN0ZWRDb3VudCA9IDA7XG4gICAgICAgIHZhciBodG1sID0gJyc7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZm91bmQubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBpdGVtID0gZm91bmRbaV07XG4gICAgICAgICAgICB2YXIgaW5Cb3QgPSBmaW5kQ2hhdEJ5RXh0ZXJuYWwoYm90LCBpdGVtLmNoYXRfaWQpO1xuICAgICAgICAgICAgaWYgKCFpdGVtLmFscmVhZHlfY29ubmVjdGVkICYmIHN0YXRlLmNoYXRNb2RhbC5zZWxlY3RlZFtpdGVtLmNoYXRfaWRdICE9PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIHN0YXRlLmNoYXRNb2RhbC5zZWxlY3RlZFtpdGVtLmNoYXRfaWRdID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBjaGVja2VkID0gIWl0ZW0uYWxyZWFkeV9jb25uZWN0ZWQgJiYgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkW2l0ZW0uY2hhdF9pZF0gPT09IHRydWU7XG4gICAgICAgICAgICBpZiAoY2hlY2tlZCkgeyBzZWxlY3RlZENvdW50Kys7IH1cbiAgICAgICAgICAgIGh0bWwgKz0gJzxsYWJlbCBjbGFzcz1cIm1oLWZvdW5kLXJvdycgKyAoaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCA/ICcgaXMtY29ubmVjdGVkJyA6ICcnKSArICdcIiBkYXRhLWNoYXQtcm93PVwiJyArIChpbkJvdCA/IGluQm90LmlkIDogMCkgKyAnXCIgZGF0YS1jaGF0LWtleT1cIicgKyBlc2MoaXRlbS5jaGF0X2lkKSArICdcIj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJ1aSBjaGVja2JveCcgKyAoY2hlY2tlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAoaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCA/ICcgZGlzYWJsZWQnIDogJycpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgY2xhc3M9XCJoaWRkZW4gbWgtZm91bmQtY2hlY2tcIicgKyAoY2hlY2tlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAoaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCA/ICcgZGlzYWJsZWQnIDogJycpICsgJz4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1ib3hcIj48L3NwYW4+PC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWZvdW5kLXRpdGxlXCI+PGIgY2xhc3M9XCJtaC10cnVuY2F0ZVwiPicgKyBlc2MoaXRlbS50aXRsZSB8fCBpdGVtLmNoYXRfaWQpICsgJzwvYj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tZXRhXCI+JyArIGVzYyhjaGF0S2luZExhYmVsKGl0ZW0uY2hhdF9raW5kKSkgKyAnPC9zcGFuPjwvc3Bhbj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJ1aSAnICsgKGl0ZW0uYWxyZWFkeV9jb25uZWN0ZWQgPyAnbGFiZWwnIDogJ2JsdWUgbGFiZWwnKSArICdcIj4nXG4gICAgICAgICAgICAgICAgKyBlc2MoaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0RXhpc3RzJykgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdE5ldycpKSArICc8L3NwYW4+PC9sYWJlbD4nO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC1jaGF0LWZvdW5kJykuaHRtbChodG1sKTtcbiAgICAgICAgJCgnI21oLWNoYXQtc2F2ZScpLnRleHQodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0U2F2ZScsIHsgY291bnQ6IHNlbGVjdGVkQ291bnQgfSkpO1xuICAgICAgICAkKCcjbWgtY2hhdC1zYXZlJykuYXR0cignZGlzYWJsZWQnLCBzZWxlY3RlZENvdW50ID09PSAwID8gdHJ1ZSA6IG51bGwpO1xuXG4gICAgICAgIHZhciBzdGF0dXNUZXh0ID0gJyc7XG4gICAgICAgIHZhciBjb3VudGRvd24gPSAnJztcbiAgICAgICAgdmFyIHByb2dyZXNzID0gMDtcbiAgICAgICAgaWYgKGRpc2NvdmVyeS5hY3RpdmUpIHtcbiAgICAgICAgICAgIGlmIChmb3VuZC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgc3RhdHVzVGV4dCA9IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdEZvdW5kJywgeyBjb3VudDogZm91bmQubGVuZ3RoIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNUZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RTZWFyY2hpbmcnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvdW50ZG93biA9IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdFJlbWFpbmluZycsIHsgdGltZTogZm10Q291bnRkb3duKGRpc2NvdmVyeS5yZW1haW5pbmdfc2VjKSB9KTtcbiAgICAgICAgICAgIHByb2dyZXNzID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBNYXRoLnJvdW5kKCgzMDAgLSBkaXNjb3ZlcnkucmVtYWluaW5nX3NlYykgLyAzMDAgKiAxMDApKSk7XG4gICAgICAgICAgICAkKCcjbWgtY2hhdC1lbXB0eScpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLWNoYXQtZXJyb3InKS5lbXB0eSgpO1xuICAgICAgICAgICAgJCgnI21oLWNoYXQtYWdhaW4nKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgICQoJyNtaC1jaGF0LXN0b3AnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICQoJyNtaC1jaGF0LXN0b3AnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgICQoJyNtaC1jaGF0LWFnYWluJykucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgICAgICBpZiAoZGlzY292ZXJ5LnN0YXR1cyA9PT0gJ2Vycm9yJykge1xuICAgICAgICAgICAgICAgIHZhciBjb2RlID0gU3RyaW5nKGRpc2NvdmVyeS5sYXN0X2Vycm9yX2NvZGUgfHwgJycpO1xuICAgICAgICAgICAgICAgIHZhciB0ZXh0O1xuICAgICAgICAgICAgICAgIGlmIChjb2RlID09PSAndGVsZWdyYW0uNDA5LndlYmhvb2tfc2V0Jykge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RFcnJvcldlYmhvb2snKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNvZGUgPT09ICdtYXguNDA1LndlYmhvb2tfc2V0Jykge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RFcnJvcldlYmhvb2tNYXgnKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGlzTWF4VGxzQ29kZShjb2RlKSkge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0ID0gdGxzRXJyb3JUZXh0KCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChjb2RlID09PSAnbWF4LjQwMS51bmF1dGhvcml6ZWQnIHx8IGNvZGUgPT09ICd0ZWxlZ3JhbS40MDEudW5hdXRob3JpemVkJykge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZDQwMScpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdEVycm9yJykgKyAnICgnICsgY29kZSArICcpJztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgc2hvd0NoYXRFcnJvcih0ZXh0KTtcbiAgICAgICAgICAgICAgICBzdGF0dXNUZXh0ID0gJyc7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGRpc2NvdmVyeS5zdGF0dXMgPT09ICdlbXB0eScpIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNUZXh0ID0gJyc7XG4gICAgICAgICAgICAgICAgJCgnI21oLWNoYXQtZW1wdHknKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZm91bmQubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIHN0YXR1c1RleHQgPSB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RUaW1lb3V0JywgeyBjb3VudDogZm91bmQubGVuZ3RoIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNUZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3ROb1Nlc3Npb24nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvdW50ZG93biA9ICcnO1xuICAgICAgICAgICAgcHJvZ3Jlc3MgPSAxMDA7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLWNoYXQtc3RhdHVzLXRleHQnKS50ZXh0KHN0YXR1c1RleHQpO1xuICAgICAgICAkKCcjbWgtY2hhdC1jb3VudGRvd24nKS50ZXh0KGNvdW50ZG93bik7XG4gICAgICAgICQoJyNtaC1jaGF0LXByb2dyZXNzIC5iYXInKS5jc3MoJ3dpZHRoJywgcHJvZ3Jlc3MgKyAnJScpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZpbmRDaGF0QnlFeHRlcm5hbChib3QsIGNoYXRJZCkge1xuICAgICAgICB2YXIgY2hhdHMgPSBib3QuY2hhdHMgfHwgW107XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hhdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChTdHJpbmcoY2hhdHNbaV0uY2hhdF9pZCkgPT09IFN0cmluZyhjaGF0SWQpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNoYXRzW2ldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNob3dDaGF0RXJyb3IodGV4dCkge1xuICAgICAgICAkKCcjbWgtY2hhdC1lcnJvcicpLmh0bWwoJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlXCIgcm9sZT1cImFsZXJ0XCI+J1xuICAgICAgICAgICAgKyAnPHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+PGNpcmNsZSBjeD1cIjhcIiBjeT1cIjhcIiByPVwiNi4yNVwiLz48cGF0aCBkPVwiTTYgNmw0IDRNMTAgNmwtNCA0XCIvPjwvc3ZnPidcbiAgICAgICAgICAgICsgJzxkaXY+JyArIGVzYyh0ZXh0KSArICc8L2Rpdj48L2Rpdj4nKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBiaW5kQ2hhdEZvdW5kKCkge1xuICAgICAgICAkKCcjbWgtY2hhdC1mb3VuZCcpLm9uKCdjaGFuZ2UnLCAnLm1oLWZvdW5kLWNoZWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCFzdGF0ZS5jaGF0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIga2V5ID0gU3RyaW5nKCQodGhpcykuY2xvc2VzdCgnLm1oLWZvdW5kLXJvdycpLmRhdGEoJ2NoYXQta2V5JykpO1xuICAgICAgICAgICAgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkW2tleV0gPSAkKHRoaXMpLnByb3AoJ2NoZWNrZWQnKTtcbiAgICAgICAgICAgIHVwZGF0ZUNoYXRNb2RhbChzdGF0ZS5jaGF0TW9kYWwuYm90KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZVNlbGVjdGVkQ2hhdHMoKSB7XG4gICAgICAgIGlmICghc3RhdGUuY2hhdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICB2YXIgYm90ID0gc3RhdGUuY2hhdE1vZGFsLmJvdDtcbiAgICAgICAgdmFyIHBhdGNoZXMgPSBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCAoYm90LmRpc2NvdmVyeS5mb3VuZCB8fCBbXSkubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBpdGVtID0gYm90LmRpc2NvdmVyeS5mb3VuZFtpXTtcbiAgICAgICAgICAgIGlmIChpdGVtLmFscmVhZHlfY29ubmVjdGVkIHx8IHN0YXRlLmNoYXRNb2RhbC5zZWxlY3RlZFtpdGVtLmNoYXRfaWRdICE9PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgY2hhdCA9IGZpbmRDaGF0QnlFeHRlcm5hbChib3QsIGl0ZW0uY2hhdF9pZCk7XG4gICAgICAgICAgICBpZiAoY2hhdCkge1xuICAgICAgICAgICAgICAgIHBhdGNoZXMucHVzaCh7IGlkOiBjaGF0LmlkLCBlbmFibGVkOiB0cnVlLCBjaGF0X2tpbmQ6IGl0ZW0uY2hhdF9raW5kLCB0aXRsZTogaXRlbS50aXRsZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAocGF0Y2hlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhcGlQYXRjaCgnL2JvdHMvJyArIGJvdC5pZCwgeyBjaGF0czogcGF0Y2hlcyB9LCBmdW5jdGlvbiAoc2F2ZWQpIHtcbiAgICAgICAgICAgIGFwaVBvc3QoJy9ib3RzLycgKyBib3QuaWQgKyAnOmRpc2NvdmVyQ2hhdHMnLCB7IHN0b3A6IHRydWUgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGNsb3NlQ2hhdE1vZGFsKCk7XG4gICAgICAgICAgICAgICAgcmVwbGFjZUJvdChzYXZlZCk7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVkJykpO1xuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGNsb3NlQ2hhdE1vZGFsKCk7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVkJykpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgIHNob3dDaGF0RXJyb3IoZmFpbHVyZVRleHQoZXJyKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNsb3NlQ2hhdE1vZGFsKCkge1xuICAgICAgICBzdG9wQ2hhdFBvbGwoKTtcbiAgICAgICAgc3RhdGUuY2hhdE1vZGFsID0gbnVsbDtcbiAgICAgICAgJCgnI21oLWNoYXQtbW9kYWwnKS5tb2RhbCgnaGlkZScpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHN0b3BEaXNjb3ZlcnlBbmRDbG9zZSgpIHtcbiAgICAgICAgdmFyIGJvdCA9IHN0YXRlLmNoYXRNb2RhbCA/IHN0YXRlLmNoYXRNb2RhbC5ib3QgOiBudWxsO1xuICAgICAgICBpZiAoYm90KSB7XG4gICAgICAgICAgICBhcGlQb3N0KCcvYm90cy8nICsgYm90LmlkICsgJzpkaXNjb3ZlckNoYXRzJywgeyBzdG9wOiB0cnVlIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBjbG9zZUNoYXRNb2RhbCgpO1xuICAgICAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGNsb3NlQ2hhdE1vZGFsKCk7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNsb3NlQ2hhdE1vZGFsKCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIHRlc3QgbW9kYWwgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gb3BlblRlc3RNb2RhbChib3QsIGNoYXRJZHMpIHtcbiAgICAgICAgaWYgKCFib3QpIHsgcmV0dXJuOyB9XG4gICAgICAgIHN0YXRlLnRlc3RNb2RhbCA9IHsgYm90SWQ6IGJvdC5pZCwgYm90OiBib3QsIGV2ZW50SWQ6IDAsIGNoYXRJZHM6IGNoYXRJZHMsIHRpbWVyOiBudWxsLCB0cmllczogMCB9O1xuICAgICAgICAkKCcjbWgtdGVzdC1saXN0JykuaHRtbCgnPGRpdiBjbGFzcz1cIm1oLW11dGVkXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0UnVubmluZycpKSArICc8L2Rpdj4nKTtcbiAgICAgICAgJCgnI21oLXRlc3Qtc3VtbWFyeScpLnRleHQoJycpO1xuICAgICAgICAkKCcjbWgtdGVzdC1tb2RhbCcpLm1vZGFsKHsgY2xvc2FibGU6IHRydWUsIG9uSGlkZTogZnVuY3Rpb24gKCkgeyBzdG9wVGVzdFBvbGwoKTsgfSB9KS5tb2RhbCgnc2hvdycpO1xuICAgICAgICB2YXIgcGF5bG9hZCA9IGNoYXRJZHMgPT09IG51bGwgPyB7fSA6IHsgY2hhdF9pZHM6IGNoYXRJZHMgfTtcbiAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIGJvdC5pZCArICc6c2VuZFRlc3QnLCBwYXlsb2FkLCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgaWYgKCFzdGF0ZS50ZXN0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICBzdGF0ZS50ZXN0TW9kYWwuZXZlbnRJZCA9IGRhdGEuZXZlbnRfaWQ7XG4gICAgICAgICAgICBzdGF0ZS50ZXN0TW9kYWwuYm90ID0gZGF0YS5ib3Q7XG4gICAgICAgICAgICByZXBsYWNlQm90KGRhdGEuYm90KTtcbiAgICAgICAgICAgIHJlbmRlclRlc3QoZGF0YS5ib3QpO1xuICAgICAgICAgICAgc2NoZWR1bGVUZXN0UG9sbCgpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAkKCcjbWgtdGVzdC1saXN0JykuaHRtbCgnPGRpdiBjbGFzcz1cInVpIG5lZ2F0aXZlIG1lc3NhZ2VcIj48ZGl2PicgKyBlc2MoZmFpbHVyZVRleHQoZXJyKSkgKyAnPC9kaXY+PC9kaXY+Jyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNjaGVkdWxlVGVzdFBvbGwoKSB7XG4gICAgICAgIHN0b3BUZXN0UG9sbCgpO1xuICAgICAgICBzdGF0ZS50ZXN0TW9kYWwudGltZXIgPSBzZXRJbnRlcnZhbChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoIXN0YXRlLnRlc3RNb2RhbCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHN0YXRlLnRlc3RNb2RhbC50cmllcysrO1xuICAgICAgICAgICAgYXBpR2V0KCcvYm90cy8nICsgc3RhdGUudGVzdE1vZGFsLmJvdElkLCB7fSwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgICAgIGlmICghc3RhdGUudGVzdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICAgIHN0YXRlLnRlc3RNb2RhbC5ib3QgPSBib3Q7XG4gICAgICAgICAgICAgICAgcmVwbGFjZUJvdChib3QpO1xuICAgICAgICAgICAgICAgIHJlbmRlclRlc3QoYm90KTtcbiAgICAgICAgICAgICAgICBpZiAoIXRlc3RQZW5kaW5nKGJvdCkgfHwgc3RhdGUudGVzdE1vZGFsLnRyaWVzID4gMjApIHtcbiAgICAgICAgICAgICAgICAgICAgc3RvcFRlc3RQb2xsKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGlmIChzdGF0ZS50ZXN0TW9kYWwgJiYgc3RhdGUudGVzdE1vZGFsLnRyaWVzID4gMykge1xuICAgICAgICAgICAgICAgICAgICBzdG9wVGVzdFBvbGwoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSwgMjAwMCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3RvcFRlc3RQb2xsKCkge1xuICAgICAgICBpZiAoc3RhdGUudGVzdE1vZGFsICYmIHN0YXRlLnRlc3RNb2RhbC50aW1lciAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xlYXJJbnRlcnZhbChzdGF0ZS50ZXN0TW9kYWwudGltZXIpO1xuICAgICAgICAgICAgc3RhdGUudGVzdE1vZGFsLnRpbWVyID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIHRlc3REZWxpdmVyaWVzKGJvdCkge1xuICAgICAgICB2YXIgZXZlbnRJZCA9IHN0YXRlLnRlc3RNb2RhbCA/IHN0YXRlLnRlc3RNb2RhbC5ldmVudElkIDogMDtcbiAgICAgICAgdmFyIHJlc3VsdCA9IFtdO1xuICAgICAgICB2YXIgY2hhdHMgPSBib3QuY2hhdHMgfHwgW107XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hhdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBkZWxpdmVyeSA9IGNoYXRzW2ldLmxhc3RfZGVsaXZlcnk7XG4gICAgICAgICAgICBpZiAoZGVsaXZlcnkgJiYgTnVtYmVyKGRlbGl2ZXJ5LmV2ZW50X2lkKSA9PT0gTnVtYmVyKGV2ZW50SWQpKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0LnB1c2goeyBjaGF0OiBjaGF0c1tpXSwgZGVsaXZlcnk6IGRlbGl2ZXJ5IH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdGVzdFBlbmRpbmcoYm90KSB7XG4gICAgICAgIHZhciBsaXN0ID0gdGVzdERlbGl2ZXJpZXMoYm90KTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgc3RhdHVzID0gbGlzdFtpXS5kZWxpdmVyeS5zdGF0dXM7XG4gICAgICAgICAgICBpZiAoc3RhdHVzID09PSAncGVuZGluZycgfHwgc3RhdHVzID09PSAnc2VuZGluZycpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZGVsaXZlcnlTdGF0dXNMYWJlbChkZWxpdmVyeSkge1xuICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAnc2VudCcpIHsgcmV0dXJuIHsgY2xzOiAnaXMtb2snLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0RGVsaXZlcmVkJykgfTsgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAncGVuZGluZycgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnc2VuZGluZycpIHsgcmV0dXJuIHsgY2xzOiAnJywgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdFF1ZXVlZCcpIH07IH1cbiAgICAgICAgcmV0dXJuIHsgY2xzOiAnaXMtZXJyJywgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdEVycm9yJykgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZWxpdmVyeUVycm9yVGV4dChjb2RlKSB7XG4gICAgICAgIGlmIChpc01heFRsc0NvZGUoY29kZSkpIHsgcmV0dXJuIHRsc0Vycm9yVGV4dCgpOyB9XG4gICAgICAgIGlmIChjb2RlID09PSAndGVsZWdyYW0uNDAxLnVuYXV0aG9yaXplZCcgfHwgY29kZSA9PT0gJ21heC40MDEudW5hdXRob3JpemVkJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZDQwMScpOyB9XG4gICAgICAgIGlmIChjb2RlID09PSAndGVsZWdyYW0uNDAzLmtpY2tlZCcgfHwgY29kZSA9PT0gJ3RlbGVncmFtLjQwMy5ibG9ja2VkJyB8fCBjb2RlID09PSAndGVsZWdyYW0uNDAwLmNoYXRfbm90X2ZvdW5kJ1xuICAgICAgICAgICAgfHwgY29kZSA9PT0gJ21heC40MDMuY2hhdF9kZW5pZWQnIHx8IGNvZGUgPT09ICdtYXguNDA0Lm5vdF9mb3VuZCcgfHwgY29kZSA9PT0gJ21heC40MDQudW5rbm93bicpIHtcbiAgICAgICAgICAgIHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0U3RhdHVzR29uZScpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjb2RlID09PSAndGVsZWdyYW0uNDI5LnJhdGVfbGltaXQnIHx8IGNvZGUgPT09ICdtYXguNDI5LnJhdGVfbGltaXQnKSB7IHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0RXJyb3JSYXRlTGltaXQnKTsgfVxuICAgICAgICBpZiAoY29kZSA9PT0gJ3N0YWxlJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdEVycm9yU3RhbGUnKTsgfVxuICAgICAgICByZXR1cm4gY29kZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJUZXN0KGJvdCkge1xuICAgICAgICB2YXIgbGlzdCA9IHRlc3REZWxpdmVyaWVzKGJvdCk7XG4gICAgICAgIHZhciBjb3VudHMgPSB7IHNlbnQ6IDAsIHBlbmRpbmc6IDAsIGZhaWxlZDogMCB9O1xuICAgICAgICB2YXIgaHRtbCA9ICcnO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBjaGF0ID0gbGlzdFtpXS5jaGF0O1xuICAgICAgICAgICAgdmFyIGRlbGl2ZXJ5ID0gbGlzdFtpXS5kZWxpdmVyeTtcbiAgICAgICAgICAgIHZhciBsYWJlbCA9IGRlbGl2ZXJ5U3RhdHVzTGFiZWwoZGVsaXZlcnkpO1xuICAgICAgICAgICAgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3NlbnQnKSB7IGNvdW50cy5zZW50Kys7IH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3BlbmRpbmcnIHx8IGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3NlbmRpbmcnKSB7IGNvdW50cy5wZW5kaW5nKys7IH1cbiAgICAgICAgICAgIGVsc2UgeyBjb3VudHMuZmFpbGVkKys7IH1cbiAgICAgICAgICAgIHZhciByZXRyeSA9IChkZWxpdmVyeS5zdGF0dXMgPT09ICdmYWlsZWQnIHx8IGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2Ryb3BwZWQnKVxuICAgICAgICAgICAgICAgID8gJzxidXR0b24gY2xhc3M9XCJ1aSBiYXNpYyBidXR0b24gbWgtdGVzdC1yZXRyeVwiIHR5cGU9XCJidXR0b25cIiBkYXRhLWNoYXQtaWQ9XCInICsgY2hhdC5pZCArICdcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3RSZXRyeScpKSArICc8L2J1dHRvbj4nXG4gICAgICAgICAgICAgICAgOiAnJztcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJtaC10ZXN0LXJvd1wiPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1lc3NlbmdlciAnICsgKGJvdC5jaGFubmVsID09PSAnbWF4JyA/ICdtYXgnIDogJ3RnJykgKyAnIHNcIiBhcmlhLWhpZGRlbj1cInRydWVcIj4nICsgKGJvdC5jaGFubmVsID09PSAnbWF4JyA/ICdNQVgnIDogJ1RHJykgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtdGVzdC10aXRsZVwiPjxkaXYgY2xhc3M9XCJtaC10cnVuY2F0ZVwiPicgKyBlc2MoY2hhdC50aXRsZSB8fCBjaGF0LmNoYXRfaWQpICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArIChkZWxpdmVyeS5sYXN0X2Vycm9yX2NvZGUgPyAnPGRpdiBjbGFzcz1cIm1oLW1ldGEgbWgtZXJyb3ItdGV4dFwiPicgKyBlc2MoZGVsaXZlcnlFcnJvclRleHQoZGVsaXZlcnkubGFzdF9lcnJvcl9jb2RlKSkgKyAnPC9kaXY+JyA6ICcnKVxuICAgICAgICAgICAgICAgICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXRlc3Qtc3RhdGUgJyArIGxhYmVsLmNscyArICdcIj4nICsgZXNjKGxhYmVsLnRleHQpICsgJzwvc3Bhbj4nICsgcmV0cnkgKyAnPC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoaHRtbCA9PT0gJycpIHtcbiAgICAgICAgICAgIGh0bWwgPSAnPGRpdiBjbGFzcz1cIm1oLW11dGVkXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0UnVubmluZycpKSArICc8L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC10ZXN0LWxpc3QnKS5odG1sKGh0bWwpO1xuICAgICAgICAkKCcjbWgtdGVzdC1zdW1tYXJ5JykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdFN1bW1hcnknLCB7XG4gICAgICAgICAgICBvazogY291bnRzLnNlbnQsXG4gICAgICAgICAgICBmYWlsZWQ6IGNvdW50cy5mYWlsZWQsXG4gICAgICAgICAgICBwZW5kaW5nOiBjb3VudHMucGVuZGluZ1xuICAgICAgICB9KSk7XG4gICAgICAgICQoJyNtaC10ZXN0LWxpc3QgLm1oLXRlc3QtcmV0cnknKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgY2hhdElkID0gTnVtYmVyKCQodGhpcykuZGF0YSgnY2hhdC1pZCcpKTtcbiAgICAgICAgICAgIG9wZW5UZXN0TW9kYWwoc3RhdGUudGVzdE1vZGFsID8gc3RhdGUudGVzdE1vZGFsLmJvdCA6IGJvdCwgW2NoYXRJZF0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGdlbmVyYWwgc2V0dGluZ3MgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gbG9hZEdlbmVyYWxTZXR0aW5ncygpIHtcbiAgICAgICAgYXBpR2V0KCcvc2V0dGluZ3MnLCB7fSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHN0YXRlLnJldGVudGlvbiA9IGRhdGEuZXZlbnRzX3JldGVudGlvbl9kYXlzO1xuICAgICAgICAgICAgc3RhdGUuc2V0dGluZ3MgPSBkYXRhO1xuICAgICAgICAgICAgJCgnI21oLXJldGVudGlvbi1pbnB1dCcpLnZhbChkYXRhLmV2ZW50c19yZXRlbnRpb25fZGF5cyk7XG4gICAgICAgICAgICAkKCcjbWgtcHVibGljLXVybC1pbnB1dCcpLnZhbChkYXRhLnBieF9wdWJsaWNfdXJsIHx8ICcnKTtcbiAgICAgICAgICAgICQoJyNtaC1wcm94eS1pbnB1dCcpLnZhbChkYXRhLnByb3h5X3VybCB8fCAnJyk7XG4gICAgICAgICAgICAkKCcjbWgtbWF4LWNhLWlucHV0JykudmFsKGRhdGEubWF4X2NhX2J1bmRsZV9wYXRoIHx8ICcnKTtcbiAgICAgICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLW1heC1jYS1maWVsZCcpO1xuICAgICAgICAgICAgJCgnI21oLW1hc2stZGVmYXVsdCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgZGF0YS5tYXNrX3Bob25lX2RlZmF1bHQgPT09IHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLW1hc2stZGVmYXVsdCBpbnB1dCcpLnByb3AoJ2NoZWNrZWQnLCBkYXRhLm1hc2tfcGhvbmVfZGVmYXVsdCA9PT0gdHJ1ZSk7XG4gICAgICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC1wdWJsaWMtdXJsLWZpZWxkJyk7XG4gICAgICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC1wcm94eS1maWVsZCcpO1xuICAgICAgICAgICAgY2xlYXJSZXRlbnRpb25FcnJvcigpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgbWFya1JldGVudGlvbkVycm9yKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25Mb2FkRXJyb3InLCB7XG4gICAgICAgICAgICAgICAgd2hhdDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfTG9hZFdoYXRTZXR0aW5ncycpLFxuICAgICAgICAgICAgICAgIGNvZGU6IGZhaWx1cmUuc3RhdHVzID4gMCA/IGZhaWx1cmUuc3RhdHVzIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uVGltZW91dCcpXG4gICAgICAgICAgICB9KSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVTZXR0aW5nKHBheWxvYWQsIGZpZWxkU2VsZWN0b3IsIHJldmVydCkge1xuICAgICAgICBhcGlQYXRjaCgnL3NldHRpbmdzJywgcGF5bG9hZCwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHN0YXRlLnNldHRpbmdzID0gZGF0YTtcbiAgICAgICAgICAgIGlmIChmaWVsZFNlbGVjdG9yKSB7IGNsZWFyRmllbGRFcnJvcihmaWVsZFNlbGVjdG9yKTsgfVxuICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVkJykpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgaWYgKGZpZWxkU2VsZWN0b3IpIHtcbiAgICAgICAgICAgICAgICBtYXJrRmllbGRFcnJvcihmaWVsZFNlbGVjdG9yLCBmYWlsdXJlVGV4dChmYWlsdXJlKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocmV2ZXJ0KSB7IHJldmVydCgpOyB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVQdWJsaWNVcmwoKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IFN0cmluZygkKCcjbWgtcHVibGljLXVybC1pbnB1dCcpLnZhbCgpIHx8ICcnKS50cmltKCk7XG4gICAgICAgIHZhciBwcmV2aW91cyA9IHN0YXRlLnNldHRpbmdzID8gc3RhdGUuc2V0dGluZ3MucGJ4X3B1YmxpY191cmwgOiAnJztcbiAgICAgICAgaWYgKHZhbHVlID09PSAnJykge1xuICAgICAgICAgICAgc2F2ZVNldHRpbmcoeyBwYnhfcHVibGljX3VybDogJycgfSwgJyNtaC1wdWJsaWMtdXJsLWZpZWxkJyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCEvXmh0dHBzPzpcXC9cXC9cXFMrJC9pLnRlc3QodmFsdWUpKSB7XG4gICAgICAgICAgICBtYXJrRmllbGRFcnJvcignI21oLXB1YmxpYy11cmwtZmllbGQnLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9TZXR0aW5nc1B1YmxpY1VybEludmFsaWQnKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgc2F2ZVNldHRpbmcoeyBwYnhfcHVibGljX3VybDogdmFsdWUgfSwgJyNtaC1wdWJsaWMtdXJsLWZpZWxkJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLXB1YmxpYy11cmwtaW5wdXQnKS52YWwocHJldmlvdXMpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlUHJveHkoKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IFN0cmluZygkKCcjbWgtcHJveHktaW5wdXQnKS52YWwoKSB8fCAnJykudHJpbSgpO1xuICAgICAgICB2YXIgcHJldmlvdXMgPSBzdGF0ZS5zZXR0aW5ncyA/IHN0YXRlLnNldHRpbmdzLnByb3h5X3VybCA6ICcnO1xuICAgICAgICBpZiAodmFsdWUgIT09ICcnICYmICEvXigoaHR0cHM/fHNvY2tzNWg/KTpcXC9cXC8pP1tBLVphLXowLTkuXFwtXSs6XFxkezEsNX0kLy50ZXN0KHZhbHVlKSkge1xuICAgICAgICAgICAgbWFya0ZpZWxkRXJyb3IoJyNtaC1wcm94eS1maWVsZCcsIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NldHRpbmdzUHJveHlJbnZhbGlkJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHNhdmVTZXR0aW5nKHsgcHJveHlfdXJsOiB2YWx1ZSB9LCAnI21oLXByb3h5LWZpZWxkJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLXByb3h5LWlucHV0JykudmFsKHByZXZpb3VzKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZU1heENhQnVuZGxlKCkge1xuICAgICAgICB2YXIgdmFsdWUgPSBTdHJpbmcoJCgnI21oLW1heC1jYS1pbnB1dCcpLnZhbCgpIHx8ICcnKS50cmltKCk7XG4gICAgICAgIHZhciBwcmV2aW91cyA9IHN0YXRlLnNldHRpbmdzID8gc3RhdGUuc2V0dGluZ3MubWF4X2NhX2J1bmRsZV9wYXRoIDogJyc7XG4gICAgICAgIGlmICh2YWx1ZSAhPT0gJycgJiYgdmFsdWUuY2hhckF0KDApICE9PSAnLycpIHtcbiAgICAgICAgICAgIG1hcmtGaWVsZEVycm9yKCcjbWgtbWF4LWNhLWZpZWxkJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU2V0dGluZ3NDYVBhdGhJbnZhbGlkJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHNhdmVTZXR0aW5nKHsgbWF4X2NhX2J1bmRsZV9wYXRoOiB2YWx1ZSB9LCAnI21oLW1heC1jYS1maWVsZCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1tYXgtY2EtaW5wdXQnKS52YWwocHJldmlvdXMpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlTWFza0RlZmF1bHQoKSB7XG4gICAgICAgIHZhciBjaGVja2VkID0gJCgnI21oLW1hc2stZGVmYXVsdCBpbnB1dCcpLnByb3AoJ2NoZWNrZWQnKTtcbiAgICAgICAgc2F2ZVNldHRpbmcoeyBtYXNrX3Bob25lX2RlZmF1bHQ6IGNoZWNrZWQgfSwgbnVsbCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLW1hc2stZGVmYXVsdCBpbnB1dCcpLnByb3AoJ2NoZWNrZWQnLCAhY2hlY2tlZCk7XG4gICAgICAgICAgICAkKCcjbWgtbWFzay1kZWZhdWx0JykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCAhY2hlY2tlZCk7XG4gICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZUZhaWxlZCcpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZm10Q291bnRkb3duKHNlY29uZHMpIHtcbiAgICAgICAgdmFyIHRvdGFsID0gTWF0aC5tYXgoMCwgcGFyc2VJbnQoc2Vjb25kcywgMTApIHx8IDApO1xuICAgICAgICByZXR1cm4gTWF0aC5mbG9vcih0b3RhbCAvIDYwKSArICc6JyArIHBhZCh0b3RhbCAlIDYwKTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIG5vdGlmaWNhdGlvbnM6IHJ1bGVzIEFQSSAmIGxpc3QgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gbG9hZFJ1bGVzKHNpbGVudCkge1xuICAgICAgICBpZiAoIXNpbGVudCkge1xuICAgICAgICAgICAgc3RhdGUucnVsZXNMb2FkZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIHJlbmRlclJ1bGVzU2tlbGV0b24oKTtcbiAgICAgICAgfVxuICAgICAgICBhcGlHZXQoJy9ydWxlcycsIHsgbGltaXQ6IDIwMCB9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgc3RhdGUucnVsZXMgPSBkYXRhLml0ZW1zIHx8IFtdO1xuICAgICAgICAgICAgc3RhdGUucnVsZXNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc3RhdGUucnVsZXNFcnJvciA9IG51bGw7XG4gICAgICAgICAgICByZW5kZXJSdWxlcygpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgc3RhdGUucnVsZXNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc3RhdGUucnVsZXNFcnJvciA9IGZhaWx1cmU7XG4gICAgICAgICAgICByZW5kZXJSdWxlcygpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJSdWxlc1NrZWxldG9uKCkge1xuICAgICAgICB2YXIgcm93ID0gJzxkaXYgY2xhc3M9XCJtaC1ub3RpZi1yb3dcIj48c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjM2cHg7aGVpZ2h0OjIwcHg7Ym9yZGVyLXJhZGl1czoxMHB4XCI+PC9zcGFuPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6NDAlXCI+PC9zcGFuPjxzcGFuPjwvc3Bhbj48c3Bhbj48L3NwYW4+PC9kaXY+JztcbiAgICAgICAgJCgnI21oLXJ1bGVzLWxpc3QnKS5odG1sKHJvdyArIHJvdyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc291cmNlRm9yUnVsZShydWxlKSB7XG4gICAgICAgIGlmIChydWxlLnNvdXJjZV9pZCkge1xuICAgICAgICAgICAgdmFyIGJ5SWQgPSBzb3VyY2VCeUlkKHJ1bGUuc291cmNlX2lkKTtcbiAgICAgICAgICAgIGlmIChieUlkKSB7IHJldHVybiBieUlkOyB9XG4gICAgICAgIH1cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5zb3VyY2VzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgdHlwZXMgPSBzdGF0ZS5zb3VyY2VzW2ldLmV2ZW50X3R5cGVzIHx8IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCB0eXBlcy5sZW5ndGg7IGorKykge1xuICAgICAgICAgICAgICAgIGlmIChydWxlLmV2ZW50X3R5cGVzICYmIHJ1bGUuZXZlbnRfdHlwZXMuaW5kZXhPZih0eXBlc1tqXS50eXBlKSA+PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBzdGF0ZS5zb3VyY2VzW2ldO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzZXRSdWxlQWRkVmlzaWJsZSh2aXNpYmxlKSB7XG4gICAgICAgICQoJyNtaC1ydWxlLWFkZCcpLmF0dHIoJ2hpZGRlbicsIHZpc2libGUgPyBudWxsIDogdHJ1ZSk7XG4gICAgfVxuXG4gICAgLy8gRGVzaWduIHYzLCDCq9Cj0LLQtdC00L7QvNC70LXQvdC40Y/Cuzogbm8gYm90IOKGkiBwaWNrIGEgbWVzc2VuZ2VyOyBib3QgYnV0IG5vIG5vdGlmaWNhdGlvbnMg4oaSIG9uZSBwcmltYXJ5IGJ1dHRvbjtcbiAgICAvLyBvdGhlcndpc2UgdGhlIGxpc3QgZ3JvdXBlZCDQl9Cy0L7QvdC60Lgg4oaSINCY0Jgg0KHRg9C/0LXRgNCy0LDQudC30LXRgCDihpIg0JPQvtC70L7RgdC+0LLQvtC5INCw0LPQtdC90YIg4oaSINCh0LLRj9C30Ywg0Lgg0JDQotChIChoZWFkaW5ncyBvbmx5IGZvciAyKyBncm91cHMpLlxuICAgIGZ1bmN0aW9uIHJlbmRlclJ1bGVzKCkge1xuICAgICAgICB2YXIgJGxpc3QgPSAkKCcjbWgtcnVsZXMtbGlzdCcpO1xuICAgICAgICBpZiAoIXN0YXRlLnJ1bGVzTG9hZGVkIHx8ICFzdGF0ZS5ib3RzTG9hZGVkKSB7XG4gICAgICAgICAgICBzZXRSdWxlQWRkVmlzaWJsZShmYWxzZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN0YXRlLnJ1bGVzRXJyb3IgIT09IG51bGwgJiYgc3RhdGUucnVsZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBzZXRSdWxlQWRkVmlzaWJsZShmYWxzZSk7XG4gICAgICAgICAgICAkbGlzdC5odG1sKCc8ZGl2IGNsYXNzPVwidWkgbmVnYXRpdmUgbWVzc2FnZVwiIHJvbGU9XCJhbGVydFwiPicgKyBJQ09OX0VSUk9SXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLWdyb3dcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVzTG9hZEZhaWxlZCcpKSArICc8L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAnPGJ1dHRvbiBjbGFzcz1cInVpIGJhc2ljIGJ1dHRvbiBtaC1vbi1tZXNzYWdlXCIgdHlwZT1cImJ1dHRvblwiIGlkPVwibWgtcnVsZXMtcmV0cnlcIj4nXG4gICAgICAgICAgICAgICAgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uUmV0cnknKSkgKyAnPC9idXR0b24+PC9kaXY+Jyk7XG4gICAgICAgICAgICAkKCcjbWgtcnVsZXMtcmV0cnknKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IGxvYWRSdWxlcygpOyB9KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc3RhdGUuYm90cy5sZW5ndGggPT09IDAgJiYgc3RhdGUucnVsZXMubGVuZ3RoID09PSAwICYmIHN0YXRlLmJvdHNFcnJvciA9PT0gbnVsbCkge1xuICAgICAgICAgICAgc2V0UnVsZUFkZFZpc2libGUoZmFsc2UpO1xuICAgICAgICAgICAgJGxpc3QuaHRtbCgnPGRpdiBjbGFzcz1cIm1oLW9uYm9hcmRcIiByb2xlPVwic3RhdHVzXCI+J1xuICAgICAgICAgICAgICAgICsgJzxoMyBjbGFzcz1cInVpIGhlYWRlciBtaC1wYWdlLXRpdGxlXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9PbmJvYXJkVGl0bGUnKSkgKyAnPC9oMz4nXG4gICAgICAgICAgICAgICAgKyBtZXNzZW5nZXJUaWxlcygpICsgJzwvZGl2PicpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmIChzdGF0ZS5ydWxlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHNldFJ1bGVBZGRWaXNpYmxlKGZhbHNlKTtcbiAgICAgICAgICAgICRsaXN0Lmh0bWwoJzxkaXYgY2xhc3M9XCJtaC1lbXB0eSBtaC1lbXB0eS1ib3hcIiByb2xlPVwic3RhdHVzXCI+J1xuICAgICAgICAgICAgICAgICsgJzxoMyBjbGFzcz1cInVpIGhlYWRlciBtaC1wYWdlLXRpdGxlXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlc0VtcHR5VGl0bGUnKSkgKyAnPC9oMz4nXG4gICAgICAgICAgICAgICAgKyAnPGJ1dHRvbiBjbGFzcz1cInVpIHByaW1hcnkgYnV0dG9uXCIgdHlwZT1cImJ1dHRvblwiIGRhdGEtYWN0aW9uPVwiYWRkXCI+JyArIElDT05fUExVU1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVzQWRkJykpICsgJzwvYnV0dG9uPjwvZGl2PicpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHNldFJ1bGVBZGRWaXNpYmxlKHRydWUpO1xuICAgICAgICB2YXIgZ3JvdXBzID0ge307XG4gICAgICAgIHN0YXRlLnJ1bGVzLmZvckVhY2goZnVuY3Rpb24gKHJ1bGUpIHtcbiAgICAgICAgICAgIHZhciBncm91cCA9IHJ1bGUuZ3JvdXAgfHwgJ3BieCc7XG4gICAgICAgICAgICBpZiAoR1JPVVBfT1JERVIuaW5kZXhPZihncm91cCkgPCAwKSB7IGdyb3VwID0gJ3BieCc7IH1cbiAgICAgICAgICAgIChncm91cHNbZ3JvdXBdID0gZ3JvdXBzW2dyb3VwXSB8fCBbXSkucHVzaChydWxlKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHZhciBvcmRlciA9IEdST1VQX09SREVSLmZpbHRlcihmdW5jdGlvbiAoZ3JvdXApIHsgcmV0dXJuIEJvb2xlYW4oZ3JvdXBzW2dyb3VwXSk7IH0pO1xuICAgICAgICB2YXIgaHRtbCA9ICcnO1xuICAgICAgICBpZiAoc3RhdGUucnVsZXNFcnJvciAhPT0gbnVsbCkge1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cInVpIG5lZ2F0aXZlIG1lc3NhZ2VcIiByb2xlPVwiYWxlcnRcIj4nICsgSUNPTl9FUlJPUlxuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ncm93XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlc0xvYWRGYWlsZWQnKSkgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgJzxidXR0b24gY2xhc3M9XCJ1aSBiYXNpYyBidXR0b24gbWgtb24tbWVzc2FnZVwiIHR5cGU9XCJidXR0b25cIiBpZD1cIm1oLXJ1bGVzLXJldHJ5LWlubGluZVwiPidcbiAgICAgICAgICAgICAgICArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25SZXRyeScpKSArICc8L2J1dHRvbj48L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIHZhciBzaG93SGVhZGluZ3MgPSBvcmRlci5sZW5ndGggPiAxO1xuICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwibWgtbm90aWYtbGlzdCcgKyAoc2hvd0hlYWRpbmdzID8gJycgOiAnIGlzLWZsYXQnKSArICdcIiByb2xlPVwibGlzdFwiPic7XG4gICAgICAgIG9yZGVyLmZvckVhY2goZnVuY3Rpb24gKGdyb3VwKSB7XG4gICAgICAgICAgICBpZiAoc2hvd0hlYWRpbmdzKSB7XG4gICAgICAgICAgICAgICAgaHRtbCArPSAnPGgzIGNsYXNzPVwibWgtZ3JvdXAtdGl0bGVcIj4nICsgZXNjKHNvdXJjZUdyb3VwTmFtZShncm91cCkpICsgJzwvaDM+JztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGdyb3Vwc1tncm91cF0uZm9yRWFjaChmdW5jdGlvbiAocnVsZSkge1xuICAgICAgICAgICAgICAgIGh0bWwgKz0gcmVuZGVyUnVsZVJvdyhydWxlKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgJGxpc3QuaHRtbChodG1sICsgJzwvZGl2PicpO1xuICAgICAgICAkKCcjbWgtcnVsZXMtcmV0cnktaW5saW5lJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkgeyBsb2FkUnVsZXMoKTsgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcnVsZUNoYW5uZWwocnVsZSkge1xuICAgICAgICB2YXIgY2hhdHMgPSBydWxlLmNoYXRzIHx8IFtdO1xuICAgICAgICBpZiAoY2hhdHMubGVuZ3RoID4gMCAmJiBjaGF0c1swXS5jaGFubmVsKSB7XG4gICAgICAgICAgICByZXR1cm4gY2hhdHNbMF0uY2hhbm5lbDtcbiAgICAgICAgfVxuICAgICAgICB2YXIgYm90ID0gY2hhdHMubGVuZ3RoID4gMCA/IGJvdEJ5SWQoY2hhdHNbMF0uYm90X2lkKSA6IChzdGF0ZS5ib3RzWzBdIHx8IG51bGwpO1xuICAgICAgICByZXR1cm4gYm90ICYmIGJvdC5jaGFubmVsID09PSAnbWF4JyA/ICdtYXgnIDogJ3RlbGVncmFtJztcbiAgICB9XG5cbiAgICAvLyBDb2xvdXIgb25seSBmb3IgYSBwcm9ibGVtOiB1bmF2YWlsYWJsZSBzb3VyY2UsIHJlamVjdGVkIHRva2VuLCBkZWxldGVkIGJvdCBvciBjaGF0LlxuICAgIGZ1bmN0aW9uIHJ1bGVQcm9ibGVtTGFiZWwocnVsZSkge1xuICAgICAgICB2YXIgc291cmNlID0gc291cmNlQnlJZChydWxlLnNvdXJjZV9pZCk7XG4gICAgICAgIGlmIChzb3VyY2UgJiYgc291cmNlLmF2YWlsYWJpbGl0eSAmJiBzb3VyY2UuYXZhaWxhYmlsaXR5ICE9PSAnYXZhaWxhYmxlJykge1xuICAgICAgICAgICAgdmFyIGxhYmVscyA9IHtcbiAgICAgICAgICAgICAgICBtb2R1bGVfZGlzYWJsZWQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NvdXJjZVN0YXRlTW9kb2ZmJyksXG4gICAgICAgICAgICAgICAgbW9kdWxlX21pc3Npbmc6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NvdXJjZVN0YXRlTm9pbnN0JyksXG4gICAgICAgICAgICAgICAgYXBpX2ZvcmJpZGRlbjogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfTm90aWZTb3VyY2VOb0FjY2VzcycpLFxuICAgICAgICAgICAgICAgIGFwaV9pbmNvbXBhdGlibGU6IHNvdXJjZVN0YXRlVGV4dChzb3VyY2UpLFxuICAgICAgICAgICAgICAgIGRpc2FibGVkOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Tb3VyY2VTdGF0ZU9mZicpLFxuICAgICAgICAgICAgICAgIGVycm9yOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Tb3VyY2VTdGF0ZUVycicpXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgaWYgKGxhYmVsc1tzb3VyY2UuYXZhaWxhYmlsaXR5XSkge1xuICAgICAgICAgICAgICAgIHZhciBjbHMgPSAoc291cmNlLmF2YWlsYWJpbGl0eSA9PT0gJ21vZHVsZV9kaXNhYmxlZCcgfHwgc291cmNlLmF2YWlsYWJpbGl0eSA9PT0gJ2Rpc2FibGVkJykgPyAndWkgeWVsbG93IGxhYmVsJyA6ICd1aSByZWQgbGFiZWwnO1xuICAgICAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCInICsgY2xzICsgJ1wiPicgKyBlc2MobGFiZWxzW3NvdXJjZS5hdmFpbGFiaWxpdHldKSArICc8L3NwYW4+JztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB2YXIgY2hhdHMgPSBydWxlLmNoYXRzIHx8IFtdO1xuICAgICAgICBpZiAoKHJ1bGUuY2hhdF9pZHMgfHwgW10pLmxlbmd0aCA+IGNoYXRzLmxlbmd0aCkge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cInVpIHJlZCBsYWJlbFwiPicgKyBJQ09OX0VSUk9SICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5Qm90RGVsZXRlZCcpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNoYXRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgYm90ID0gYm90QnlJZChjaGF0c1tpXS5ib3RfaWQpO1xuICAgICAgICAgICAgaWYgKGJvdCAmJiBib3QuZW5hYmxlZCAhPT0gZmFsc2UgJiYgYm90LnN0YXR1cyA9PT0gJ3Rva2VuX2ludmFsaWQnKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cInVpIHJlZCBsYWJlbFwiPicgKyBJQ09OX0VSUk9SICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c1Rva2VuSW52YWxpZCcpKSArICc8L3NwYW4+JztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoY2hhdHMubGVuZ3RoID4gMCAmJiBjaGF0cy5ldmVyeShmdW5jdGlvbiAoY2hhdCkgeyByZXR1cm4gY2hhdC5zdGF0ZSA9PT0gJ2dvbmUnOyB9KSkge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cInVpIHJlZCBsYWJlbFwiPicgKyBJQ09OX0VSUk9SICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRTdGF0dXNHb25lJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlclJ1bGVSb3cocnVsZSkge1xuICAgICAgICB2YXIgcHJvYmxlbSA9IHJ1bGVQcm9ibGVtTGFiZWwocnVsZSk7XG4gICAgICAgIHZhciBydWxlRmlyc3QgPSBzdGF0ZS5ydWxlcy5sZW5ndGggPiAwICYmIE51bWJlcihzdGF0ZS5ydWxlc1swXS5pZCkgPT09IE51bWJlcihydWxlLmlkKTtcbiAgICAgICAgdmFyIHJ1bGVMYXN0ID0gc3RhdGUucnVsZXMubGVuZ3RoID4gMFxuICAgICAgICAgICAgJiYgTnVtYmVyKHN0YXRlLnJ1bGVzW3N0YXRlLnJ1bGVzLmxlbmd0aCAtIDFdLmlkKSA9PT0gTnVtYmVyKHJ1bGUuaWQpO1xuICAgICAgICB2YXIgcmlnaHQgPSAnJztcbiAgICAgICAgaWYgKHByb2JsZW0gIT09IG51bGwpIHtcbiAgICAgICAgICAgIHJpZ2h0ID0gcHJvYmxlbTtcbiAgICAgICAgfSBlbHNlIGlmIChydWxlLmVuYWJsZWQgJiYgcnVsZS5sYXN0X2V2ZW50X2F0KSB7XG4gICAgICAgICAgICByaWdodCA9ICc8c3BhbiBjbGFzcz1cIm1oLW11dGVkXCI+JyArIGZtdENlbGxUaW1lKHJ1bGUubGFzdF9ldmVudF9hdCkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGNoYW5uZWwgPSBydWxlQ2hhbm5lbChydWxlKTtcblxuICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJtaC1ub3RpZi1yb3cnICsgKHJ1bGUuZW5hYmxlZCA/ICcnIDogJyBpcy1vZmYnKSArICdcIiByb2xlPVwibGlzdGl0ZW1cIiBkYXRhLXJ1bGUtaWQ9XCInICsgcnVsZS5pZCArICdcIj4nXG4gICAgICAgICAgICArICc8bGFiZWwgY2xhc3M9XCJ1aSB0b2dnbGUgY2hlY2tib3gnICsgKHJ1bGUuZW5hYmxlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAnXCIgYXJpYS1sYWJlbD1cIicgKyBlc2MocnVsZS50aXRsZSkgKyAnXCI+J1xuICAgICAgICAgICAgKyAnPGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGNsYXNzPVwiaGlkZGVuIG1oLXJ1bGUtdG9nZ2xlXCInICsgKHJ1bGUuZW5hYmxlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAnPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtdHJhY2tcIj48L3NwYW4+PC9sYWJlbD4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW5vdGlmLW1haW5cIj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1lc3NlbmdlciBzICcgKyAoY2hhbm5lbCA9PT0gJ21heCcgPyAnbWF4JyA6ICd0ZycpICsgJ1wiIHJvbGU9XCJpbWdcIiBhcmlhLWxhYmVsPVwiJyArIChjaGFubmVsID09PSAnbWF4JyA/ICdNQVgnIDogJ1RlbGVncmFtJykgKyAnXCI+J1xuICAgICAgICAgICAgKyAoY2hhbm5lbCA9PT0gJ21heCcgPyAnTUFYJyA6ICdURycpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICArICc8YSBocmVmPVwiI1wiIGNsYXNzPVwibWgtbm90aWYtdGl0bGUgbWgtdHJ1bmNhdGVcIiBkYXRhLWFjdGlvbj1cImVkaXRcIj4nICsgZXNjKHJ1bGUudGl0bGUpICsgJzwvYT48L3NwYW4+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1ub3RpZi1zdGF0dXNcIj4nICsgcmlnaHQgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ydWxlLW1lbnUtd3JhcFwiPidcbiAgICAgICAgICAgICsgJzxidXR0b24gY2xhc3M9XCJ1aSB0ZXh0IGJ1dHRvbiBtaC1ydWxlLW1lbnUtYnRuXCIgdHlwZT1cImJ1dHRvblwiIGRhdGEtYWN0aW9uPVwibWVudVwiIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVNZW51TW9yZScpKSArICdcIiBhcmlhLWV4cGFuZGVkPVwiZmFsc2VcIj4nXG4gICAgICAgICAgICArICc8c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBhcmlhLWhpZGRlbj1cInRydWVcIj48cGF0aCBkPVwiTTMuNSA4aC4wMU04IDhoLjAxTTEyLjUgOGguMDFcIiBzdHJva2Utd2lkdGg9XCIyLjRcIi8+PC9zdmc+PC9idXR0b24+J1xuICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLXJ1bGUtbWVudVwiIGhpZGRlbj4nXG4gICAgICAgICAgICArICc8YSBocmVmPVwiI1wiIGRhdGEtYWN0aW9uPVwiZWRpdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZU1lbnVFZGl0JykpICsgJzwvYT4nXG4gICAgICAgICAgICArIChydWxlRmlyc3QgPyAnJyA6ICc8YSBocmVmPVwiI1wiIGRhdGEtYWN0aW9uPVwidXBcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVNZW51VXAnKSkgKyAnPC9hPicpXG4gICAgICAgICAgICArIChydWxlTGFzdCA/ICcnIDogJzxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJkb3duXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlTWVudURvd24nKSkgKyAnPC9hPicpXG4gICAgICAgICAgICArICc8YSBocmVmPVwiI1wiIGRhdGEtYWN0aW9uPVwiZGVsZXRlXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlTWVudURlbGV0ZScpKSArICc8L2E+J1xuICAgICAgICAgICAgKyAnPC9kaXY+PC9kaXY+PC9kaXY+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBiaW5kUnVsZXNDb250YWluZXIoKSB7XG4gICAgICAgIHZhciAkd3JhcCA9ICQoJyNtaC1ydWxlcy1saXN0Jyk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJhZGRcIl0nLCBmdW5jdGlvbiAoKSB7IG9wZW5SdWxlV2l6YXJkKG51bGwpOyB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImFkZC1ib3RcIl0nLCBmdW5jdGlvbiAoKSB7IG9wZW5Cb3RNb2RhbCgnYWRkJywgbnVsbCwgJCh0aGlzKS5kYXRhKCdjaGFubmVsJykpOyB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImVkaXRcIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBvcGVuUnVsZVdpemFyZChydWxlQnlJZCgkKHRoaXMpLmNsb3Nlc3QoJy5taC1ub3RpZi1yb3cnKS5kYXRhKCdydWxlLWlkJykpKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJtZW51XCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICAgIHZhciAkbWVudSA9ICQodGhpcykuc2libGluZ3MoJy5taC1ydWxlLW1lbnUnKTtcbiAgICAgICAgICAgICQoJy5taC1ydWxlLW1lbnUnKS5ub3QoJG1lbnUpLnByb3AoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJG1lbnUucHJvcCgnaGlkZGVuJywgISRtZW51LnByb3AoJ2hpZGRlbicpKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJkZWxldGVcIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBjb25maXJtRGVsZXRlUnVsZShydWxlQnlJZCgkKHRoaXMpLmNsb3Nlc3QoJy5taC1ub3RpZi1yb3cnKS5kYXRhKCdydWxlLWlkJykpKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJ1cFwiXSwgW2RhdGEtYWN0aW9uPVwiZG93blwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIG1vdmVSdWxlKFxuICAgICAgICAgICAgICAgICQodGhpcykuY2xvc2VzdCgnLm1oLW5vdGlmLXJvdycpLmRhdGEoJ3J1bGUtaWQnKSxcbiAgICAgICAgICAgICAgICAkKHRoaXMpLmRhdGEoJ2FjdGlvbicpID09PSAndXAnID8gLTEgOiAxXG4gICAgICAgICAgICApO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NoYW5nZScsICcubWgtcnVsZS10b2dnbGUnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgaWQgPSAkKHRoaXMpLmNsb3Nlc3QoJy5taC1ub3RpZi1yb3cnKS5kYXRhKCdydWxlLWlkJyk7XG4gICAgICAgICAgICB2YXIgZW5hYmxlZCA9ICQodGhpcykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICAgICAgYXBpUGF0Y2goJy9ydWxlcy8nICsgaWQsIHsgZW5hYmxlZDogZW5hYmxlZCB9LCBmdW5jdGlvbiAocnVsZSkge1xuICAgICAgICAgICAgICAgIHJlcGxhY2VSdWxlKHJ1bGUpO1xuICAgICAgICAgICAgICAgIHJlbmRlclJ1bGVzKCk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgICAgIGxvYWRSdWxlcyh0cnVlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QoZmFpbHVyZVRleHQoZmFpbHVyZSkpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKGRvY3VtZW50KS5vbignY2xpY2snLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGlmICgkKGV2ZW50LnRhcmdldCkuY2xvc2VzdCgnLm1oLXJ1bGUtbWVudS13cmFwJykubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgJCgnLm1oLXJ1bGUtbWVudScpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBsb2FkUHJvdmlkZXJzKGRvbmUpIHtcbiAgICAgICAgaWYgKHN0YXRlLnByb3ZpZGVyc0xvYWRlZCkge1xuICAgICAgICAgICAgZG9uZSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvcmVHZXQoJy9wcm92aWRlcnMnLCB7IGxpbWl0OiAyMDAgfSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHZhciBpdGVtcyA9IGRhdGEuaXRlbXMgfHwgW107XG4gICAgICAgICAgICB2YXIgbGlzdCA9IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIHZhciBwcm92aWRlciA9IGl0ZW1zW2ldO1xuICAgICAgICAgICAgICAgIHZhciBpZCA9IFN0cmluZyhwcm92aWRlci5pZCAhPT0gdW5kZWZpbmVkID8gcHJvdmlkZXIuaWQgOiAocHJvdmlkZXIucHJvdmlkZXJfaWQgfHwgJycpKTtcbiAgICAgICAgICAgICAgICBpZiAoaWQgPT09ICcnKSB7IGNvbnRpbnVlOyB9XG4gICAgICAgICAgICAgICAgdmFyIGxhYmVsID0gcHJvdmlkZXIuZGVzY3JpcHRpb24gfHwgcHJvdmlkZXIudXNlcm5hbWUgfHwgKCcjJyArIGlkKTtcbiAgICAgICAgICAgICAgICBsaXN0LnB1c2goeyBpZDogaWQsIGxhYmVsOiBsYWJlbCB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHN0YXRlLnByb3ZpZGVycyA9IGxpc3Q7XG4gICAgICAgICAgICBzdGF0ZS5wcm92aWRlcnNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5wcm92aWRlcnNMb2FkZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbW92ZVJ1bGUoaWQsIGRlbHRhKSB7XG4gICAgICAgIHZhciBpZHMgPSBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5ydWxlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWRzLnB1c2goTnVtYmVyKHN0YXRlLnJ1bGVzW2ldLmlkKSk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGluZGV4ID0gaWRzLmluZGV4T2YoTnVtYmVyKGlkKSk7XG4gICAgICAgIHZhciB0YXJnZXQgPSBpbmRleCArIGRlbHRhO1xuICAgICAgICBpZiAoaW5kZXggPCAwIHx8IHRhcmdldCA8IDAgfHwgdGFyZ2V0ID49IGlkcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB2YXIgc3dhcCA9IGlkc1tpbmRleF07XG4gICAgICAgIGlkc1tpbmRleF0gPSBpZHNbdGFyZ2V0XTtcbiAgICAgICAgaWRzW3RhcmdldF0gPSBzd2FwO1xuICAgICAgICBhcGlQb3N0KCcvcnVsZXM6Y2hhbmdlUHJpb3JpdHknLCB7IG9yZGVyOiBpZHMgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgbG9hZFJ1bGVzKHRydWUpO1xuICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVPcmRlclNhdmVkJykpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgc2hvd1RvYXN0KGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcnVsZUJ5SWQoaWQpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5ydWxlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKE51bWJlcihzdGF0ZS5ydWxlc1tpXS5pZCkgPT09IE51bWJlcihpZCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc3RhdGUucnVsZXNbaV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVwbGFjZVJ1bGUocnVsZSkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLnJ1bGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAoTnVtYmVyKHN0YXRlLnJ1bGVzW2ldLmlkKSA9PT0gTnVtYmVyKHJ1bGUuaWQpKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUucnVsZXNbaV0gPSBydWxlO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBzdGF0ZS5ydWxlcy5wdXNoKHJ1bGUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNvbmZpcm1EZWxldGVSdWxlKHJ1bGUpIHtcbiAgICAgICAgaWYgKCFydWxlKSB7IHJldHVybjsgfVxuICAgICAgICAkKCcjbWgtY29uZmlybS10ZXh0JykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZURlbGV0ZUNvbmZpcm0nLCB7IHRpdGxlOiBydWxlLnRpdGxlIH0pKTtcbiAgICAgICAgJCgnI21oLWNvbmZpcm0tbW9kYWwnKS5tb2RhbCh7IGNsb3NhYmxlOiB0cnVlIH0pLm1vZGFsKCdzaG93Jyk7XG4gICAgICAgICQoJyNtaC1jb25maXJtLW9rJykub2ZmKCdjbGljaycpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgICAgIGFwaURlbGV0ZSgnL3J1bGVzLycgKyBydWxlLmlkLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgbG9hZFJ1bGVzKHRydWUpO1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25EZWxldGVkJykpO1xuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QoZmFpbHVyZVRleHQoZmFpbHVyZSkpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gbm90aWZpY2F0aW9uczogd2l6YXJkIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGVtcHR5RmlsdGVycygpIHtcbiAgICAgICAgcmV0dXJuIHsgdXNlcl9pZHM6IFtdLCBkaXJlY3Rpb25zOiBbXSwgcHJvdmlkZXJzOiBbXSwgcXVhbGl0eV9zY29yZTogbnVsbCB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG5vcm1hbGl6ZVJldHJhY3Qob3B0aW9ucykge1xuICAgICAgICB2YXIgY29uZmlnID0gb3B0aW9ucyAmJiBvcHRpb25zLnJldHJhY3Rfb25fY2FsbGJhY2sgJiYgdHlwZW9mIG9wdGlvbnMucmV0cmFjdF9vbl9jYWxsYmFjayA9PT0gJ29iamVjdCdcbiAgICAgICAgICAgID8gb3B0aW9ucy5yZXRyYWN0X29uX2NhbGxiYWNrXG4gICAgICAgICAgICA6IHt9O1xuICAgICAgICB2YXIgd2luZG93ID0gTnVtYmVyKGNvbmZpZy53aW5kb3dfbWluKTtcbiAgICAgICAgaWYgKCF3aW5kb3cgfHwgd2luZG93IDwgNSB8fCB3aW5kb3cgPiAxMjApIHtcbiAgICAgICAgICAgIHdpbmRvdyA9IDIwO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBlbmFibGVkOiBjb25maWcuZW5hYmxlZCA9PT0gdHJ1ZSxcbiAgICAgICAgICAgIHdpbmRvd19taW46IHdpbmRvdyxcbiAgICAgICAgICAgIGNvdW50X2luY29taW5nX2Fuc3dlcmVkOiBjb25maWcuY291bnRfaW5jb21pbmdfYW5zd2VyZWQgIT09IGZhbHNlXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbm9ybWFsaXplRmlsdGVycyhmaWx0ZXJzKSB7XG4gICAgICAgIHZhciByZXN1bHQgPSBlbXB0eUZpbHRlcnMoKTtcbiAgICAgICAgaWYgKCFmaWx0ZXJzIHx8IHR5cGVvZiBmaWx0ZXJzICE9PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaWx0ZXJzLnVzZXJfaWRzKSkge1xuICAgICAgICAgICAgcmVzdWx0LnVzZXJfaWRzID0gZmlsdGVycy51c2VyX2lkcy5tYXAoTnVtYmVyKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaWx0ZXJzLmRpcmVjdGlvbnMpKSB7XG4gICAgICAgICAgICByZXN1bHQuZGlyZWN0aW9ucyA9IGZpbHRlcnMuZGlyZWN0aW9ucy5zbGljZSgpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZpbHRlcnMucHJvdmlkZXJzKSkge1xuICAgICAgICAgICAgcmVzdWx0LnByb3ZpZGVycyA9IGZpbHRlcnMucHJvdmlkZXJzLm1hcChTdHJpbmcpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChmaWx0ZXJzLnF1YWxpdHlfc2NvcmUgJiYgdHlwZW9mIGZpbHRlcnMucXVhbGl0eV9zY29yZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHJlc3VsdC5xdWFsaXR5X3Njb3JlID0ge307XG4gICAgICAgICAgICBpZiAoZmlsdGVycy5xdWFsaXR5X3Njb3JlLm1pbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0LnF1YWxpdHlfc2NvcmUubWluID0gTnVtYmVyKGZpbHRlcnMucXVhbGl0eV9zY29yZS5taW4pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGZpbHRlcnMucXVhbGl0eV9zY29yZS5tYXggIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHJlc3VsdC5xdWFsaXR5X3Njb3JlLm1heCA9IE51bWJlcihmaWx0ZXJzLnF1YWxpdHlfc2NvcmUubWF4KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIC8vIEF1ZGlvIGF0dGFjaG1lbnQgbW9kZSBvZiBhIHJ1bGUgKFBsYW4vMDUpLiBUaGUgc3RhZ2UtMiBib29sZWFuIGlzIG5vdCBhIG1vZGUgYW5kIHJlYWRzIGFzIFwibm9uZVwiLlxuICAgIGZ1bmN0aW9uIG5vcm1hbGl6ZUF0dGFjaG1lbnRzKG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gb3B0aW9ucyA/IG9wdGlvbnMuYXR0YWNobWVudHMgOiBudWxsO1xuICAgICAgICByZXR1cm4gdmFsdWUgPT09ICdmcmFnbWVudHMnIHx8IHZhbHVlID09PSAncmVjb3JkaW5nJyA/IHZhbHVlIDogJ25vbmUnO1xuICAgIH1cblxuICAgIC8vIE1vZGVzIG9mZmVyZWQgZm9yIHRoZSBzZWxlY3RlZCBldmVudCB0eXBlczogb25seSBldmVudHMgdGhhdCBjYW4gY2FycnkgYXVkaW8uXG4gICAgZnVuY3Rpb24gd2l6YXJkQXR0YWNobWVudE1vZGVzKHR5cGVzKSB7XG4gICAgICAgIGlmICh0eXBlcy5pbmRleE9mKCdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJykgPj0gMCkgeyByZXR1cm4gWydub25lJywgJ2ZyYWdtZW50cycsICdyZWNvcmRpbmcnXTsgfVxuICAgICAgICBpZiAodHlwZXMuaW5kZXhPZignY29yZS52b2ljZW1haWwnKSA+PSAwKSB7IHJldHVybiBbJ25vbmUnLCAncmVjb3JkaW5nJ107IH1cbiAgICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGVuc3VyZVdpemFyZERhdGEoKSB7XG4gICAgICAgIGxvYWRFbXBsb3llZXMoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHN0YXRlLnJ1bGVXaXphcmQgJiYgc3RhdGUucnVsZVdpemFyZC5zdGVwID09PSAyKSB7IHJlbmRlcldpemFyZENvbmRpdGlvbnMoKTsgfVxuICAgICAgICB9KTtcbiAgICAgICAgbG9hZFByb3ZpZGVycyhmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoc3RhdGUucnVsZVdpemFyZCAmJiBzdGF0ZS5ydWxlV2l6YXJkLnN0ZXAgPT09IDIpIHsgcmVuZGVyV2l6YXJkQ29uZGl0aW9ucygpOyB9XG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoIXN0YXRlLmJvdHNMb2FkZWQpIHtcbiAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gb3BlblJ1bGVXaXphcmQocnVsZSkge1xuICAgICAgICBlbnN1cmVXaXphcmREYXRhKCk7XG4gICAgICAgIHZhciBzb3VyY2UgPSBydWxlID8gc291cmNlRm9yUnVsZShydWxlKSA6IG51bGw7XG4gICAgICAgIHN0YXRlLnJ1bGVXaXphcmQgPSB7XG4gICAgICAgICAgICBzdGVwOiBydWxlID8gZmlyc3RTdGVwQWZ0ZXJTY2VuYXJpbygocnVsZS5ldmVudF90eXBlcyB8fCBbXSkuc2xpY2UoKSkgOiAxLFxuICAgICAgICAgICAgZWRpdElkOiBydWxlID8gTnVtYmVyKHJ1bGUuaWQpIDogMCxcbiAgICAgICAgICAgIHNvdXJjZUlkOiBzb3VyY2UgPyBzb3VyY2UuaWQgOiAnJyxcbiAgICAgICAgICAgIGV2ZW50VHlwZXM6IHJ1bGUgPyAocnVsZS5ldmVudF90eXBlcyB8fCBbXSkuc2xpY2UoKSA6IFtdLFxuICAgICAgICAgICAgdGl0bGU6IHJ1bGUgPyBydWxlLnRpdGxlIDogJycsXG4gICAgICAgICAgICBmaWx0ZXJzOiBub3JtYWxpemVGaWx0ZXJzKHJ1bGUgPyBydWxlLmZpbHRlcnMgOiBudWxsKSxcbiAgICAgICAgICAgIHRhcmdldE1vZGU6IHJ1bGUgPyBydWxlLnRhcmdldF9tb2RlIDogJ2VtcGxveWVlX29yX3JlY2lwaWVudHMnLFxuICAgICAgICAgICAgY2hhdElkczogcnVsZVxuICAgICAgICAgICAgICAgID8gKHJ1bGUuY2hhdF9pZHMgfHwgW10pLm1hcChOdW1iZXIpLmZpbHRlcihmdW5jdGlvbiAoaWQpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIChydWxlLmNoYXRzIHx8IFtdKS5zb21lKGZ1bmN0aW9uIChjaGF0KSB7IHJldHVybiBOdW1iZXIoY2hhdC5pZCkgPT09IGlkOyB9KTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIDogW10sXG4gICAgICAgICAgICBtYXNrOiBydWxlID8gISEocnVsZS5vcHRpb25zICYmIHJ1bGUub3B0aW9ucy5tYXNrX3Bob25lID09PSB0cnVlKVxuICAgICAgICAgICAgICAgIDogISEoc3RhdGUuc2V0dGluZ3MgJiYgc3RhdGUuc2V0dGluZ3MubWFza19waG9uZV9kZWZhdWx0ID09PSB0cnVlKSxcbiAgICAgICAgICAgIHJldHJhY3Q6IG5vcm1hbGl6ZVJldHJhY3QocnVsZSA/IHJ1bGUub3B0aW9ucyA6IG51bGwpLFxuICAgICAgICAgICAgYXR0YWNobWVudHM6IG5vcm1hbGl6ZUF0dGFjaG1lbnRzKHJ1bGUgPyBydWxlLm9wdGlvbnMgOiBudWxsKSxcbiAgICAgICAgICAgIGJvdElkOiBydWxlICYmIHJ1bGUuY2hhdHMgJiYgcnVsZS5jaGF0cy5sZW5ndGggPiAwID8gTnVtYmVyKHJ1bGUuY2hhdHNbMF0uYm90X2lkKSA6IDAsXG4gICAgICAgICAgICBlcnJvcjogJydcbiAgICAgICAgfTtcbiAgICAgICAgJCgnI21oLXJ1bGVzLXZpZXcnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgJCgnI21oLXdpemFyZCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAkKCcjbWVzc2VuZ2VyLWh1Yi1yb290JykuYWRkQ2xhc3MoJ21oLXdpemFyZC1vcGVuJyk7XG4gICAgICAgIGNsZWFyV2l6YXJkRXJyb3IoKTtcbiAgICAgICAgcmVuZGVyV2l6YXJkKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2xvc2VSdWxlV2l6YXJkKCkge1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXByZXZpZXcsICNtaC13aXphcmQtcHJldmlldy10YXJnZXQnKS5lbXB0eSgpO1xuICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkID0gbnVsbDtcbiAgICAgICAgJCgnI21oLXdpemFyZCcpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAkKCcjbWgtcnVsZXMtdmlldycpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAkKCcjbWVzc2VuZ2VyLWh1Yi1yb290JykucmVtb3ZlQ2xhc3MoJ21oLXdpemFyZC1vcGVuJyk7XG4gICAgICAgIHJlbmRlclJ1bGVzKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2l6YXJkU2NlbmFyaW8oKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgcmV0dXJuIHcgJiYgdy5zb3VyY2VJZCA/IHNvdXJjZUJ5SWQody5zb3VyY2VJZCkgOiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHdpemFyZFN1cHBvcnRzRW1wbG95ZWVzKHR5cGVzKSB7XG4gICAgICAgIHZhciBjYWxsVHlwZXMgPSBbJ2NvcmUubWlzc2VkX2NhbGwnLCAnYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCddO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHR5cGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAoY2FsbFR5cGVzLmluZGV4T2YodHlwZXNbaV0pID49IDApIHsgcmV0dXJuIHRydWU7IH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2l6YXJkU3VwcG9ydHNEaXJlY3Rpb25zKHR5cGVzKSB7XG4gICAgICAgIHJldHVybiB0eXBlcy5pbmRleE9mKCdjb3JlLm1pc3NlZF9jYWxsJykgPj0gMCB8fCB0eXBlcy5pbmRleE9mKCdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJykgPj0gMDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRTdXBwb3J0c1Byb3ZpZGVycyh0eXBlcykge1xuICAgICAgICByZXR1cm4gdHlwZXMuaW5kZXhPZignY29yZS5wcm92aWRlcl9kb3duJykgPj0gMCB8fCB0eXBlcy5pbmRleE9mKCdjb3JlLnByb3ZpZGVyX3VwJykgPj0gMDtcbiAgICB9XG5cbiAgICAvLyBTdGVwIDIgZXhpc3RzIG9ubHkgZm9yIHNjZW5hcmlvcyB3aXRoIGNvbmRpdGlvbnM7IHRoZSBvdGhlcnMgZ28gc3RyYWlnaHQgdG8gwqvQmtGD0LTQsCDQvtGC0L/RgNCw0LLQuNGC0YzCuy5cbiAgICBmdW5jdGlvbiB3aXphcmRIYXNDb25kaXRpb25zKHR5cGVzKSB7XG4gICAgICAgIHJldHVybiB3aXphcmRTdXBwb3J0c0VtcGxveWVlcyh0eXBlcykgfHwgd2l6YXJkU3VwcG9ydHNEaXJlY3Rpb25zKHR5cGVzKSB8fCB3aXphcmRTdXBwb3J0c1Byb3ZpZGVycyh0eXBlcylcbiAgICAgICAgICAgIHx8IHR5cGVzLmluZGV4T2YoJ2NvcmUubWlzc2VkX2NhbGwnKSA+PSAwIHx8IHR5cGVzLmluZGV4T2YoJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnKSA+PSAwO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZpcnN0U3RlcEFmdGVyU2NlbmFyaW8odHlwZXMpIHtcbiAgICAgICAgcmV0dXJuIHdpemFyZEhhc0NvbmRpdGlvbnModHlwZXMpID8gMiA6IDM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyV2l6YXJkKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgJCgnI21oLXdpemFyZC1zdGVwLTEnKS5hdHRyKCdoaWRkZW4nLCB3LnN0ZXAgIT09IDEpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXN0ZXAtMicpLmF0dHIoJ2hpZGRlbicsIHcuc3RlcCAhPT0gMik7XG4gICAgICAgICQoJyNtaC13aXphcmQtc3RlcC0zJykuYXR0cignaGlkZGVuJywgdy5zdGVwICE9PSAzKTtcbiAgICAgICAgJCgnI21oLXdpemFyZCcpLmF0dHIoJ2RhdGEtc3RlcCcsIFN0cmluZyh3LnN0ZXApKTtcbiAgICAgICAgdmFyIHNjZW5hcmlvID0gd2l6YXJkU2NlbmFyaW8oKTtcbiAgICAgICAgdmFyIHRpdGxlO1xuICAgICAgICBpZiAody5zdGVwID09PSAxKSB7XG4gICAgICAgICAgICB0aXRsZSA9IHcuZWRpdElkID4gMCA/IHcudGl0bGUgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRUaXRsZScpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGl0bGUgPSB3LmVkaXRJZCA+IDAgPyB3LnRpdGxlIDogKHNjZW5hcmlvID8gc2NlbmFyaW8ubmFtZSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFRpdGxlJykpO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC13aXphcmQtdGl0bGUnKS50ZXh0KHRpdGxlKTtcbiAgICAgICAgLy8gb25lIGJhc2ljIGJ1dHRvbiBvbiB0aGUgbGVmdDogwqvQntGC0LzQtdC90LDCuyBvbiB0aGUgZmlyc3Qgc3RlcCwgwqvQndCw0LfQsNC0wrsgYWZ0ZXIgaXRcbiAgICAgICAgdmFyIGNhbkdvQmFjayA9IHcuc3RlcCA+IDEgJiYgISh3LmVkaXRJZCA+IDAgJiYgdy5zdGVwID09PSBmaXJzdFN0ZXBBZnRlclNjZW5hcmlvKHcuZXZlbnRUeXBlcykgJiYgdy5zb3VyY2VJZCA9PT0gJycpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXByZXYnKS50ZXh0KHcuc3RlcCA9PT0gMSA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZENhbmNlbCcpIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkQmFja0J1dHRvbicpKVxuICAgICAgICAgICAgLmRhdGEoJ21vZGUnLCBjYW5Hb0JhY2sgPyAnYmFjaycgOiAnY2FuY2VsJyk7XG4gICAgICAgIHZhciBpc0xhc3QgPSB3LnN0ZXAgPT09IDM7XG4gICAgICAgICQoJyNtaC13aXphcmQtbmV4dCcpLnRleHQoaXNMYXN0XG4gICAgICAgICAgICA/ICh3LmVkaXRJZCA+IDAgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRTYXZlJykgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRDcmVhdGUnKSlcbiAgICAgICAgICAgIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkTmV4dCcpKTtcbiAgICAgICAgaWYgKHcuc3RlcCA9PT0gMSkgeyByZW5kZXJXaXphcmRTY2VuYXJpb3MoKTsgfVxuICAgICAgICBpZiAody5zdGVwID09PSAyKSB7IHJlbmRlcldpemFyZENvbmRpdGlvbnMoKTsgfVxuICAgICAgICBpZiAody5zdGVwID09PSAzKSB7IHJlbmRlcldpemFyZFJlY2lwaWVudHMoKTsgfVxuICAgICAgICB1cGRhdGVXaXphcmROZXh0KCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdXBkYXRlV2l6YXJkTmV4dCgpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgIHZhciBkaXNhYmxlZCA9IHcuc3RlcCA9PT0gMSAmJiB3LnNvdXJjZUlkID09PSAnJztcbiAgICAgICAgaWYgKHcuc3RlcCA9PT0gMykge1xuICAgICAgICAgICAgZGlzYWJsZWQgPSBhY3RpdmVXaXphcmRCb3QoKSA9PT0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtd2l6YXJkLW5leHQnKS5wcm9wKCdkaXNhYmxlZCcsIGRpc2FibGVkKS50b2dnbGVDbGFzcygnZGlzYWJsZWQnLCBkaXNhYmxlZCk7XG4gICAgfVxuXG4gICAgLy8gT25lIGljb24gcGVyIHNjZW5hcmlvIChkZXNpZ24gdjMsIHN0ZXAgMSkuXG4gICAgdmFyIFNDRU5BUklPX0lDT05TID0ge1xuICAgICAgICBwaG9uZTogJzxwYXRoIGQ9XCJNNC41IDIuNWgybDEgMy0xLjUgMWE4IDggMCAwIDAgMy41IDMuNWwxLTEuNSAzIDF2MmExLjUgMS41IDAgMCAxLTEuNSAxLjVBMTAuNSAxMC41IDAgMCAxIDMgNGExLjUgMS41IDAgMCAxIDEuNS0xLjV6XCIvPicsXG4gICAgICAgIG1pYzogJzxyZWN0IHg9XCI2XCIgeT1cIjJcIiB3aWR0aD1cIjRcIiBoZWlnaHQ9XCI3LjVcIiByeD1cIjJcIi8+PHBhdGggZD1cIk0zLjUgOGE0LjUgNC41IDAgMCAwIDkgME04IDEyLjVWMTRcIi8+JyxcbiAgICAgICAgc3BhcmtsZTogJzxwYXRoIGQ9XCJNOCAydjNNOCAxMXYzTTIgOGgzTTExIDhoM00zLjggMy44bDIgMk0xMC4yIDEwLjJsMiAyTTMuOCAxMi4ybDItMk0xMC4yIDUuOGwyLTJcIi8+JyxcbiAgICAgICAgcm9ib3Q6ICc8cmVjdCB4PVwiM1wiIHk9XCI1XCIgd2lkdGg9XCIxMFwiIGhlaWdodD1cIjhcIiByeD1cIjJcIi8+PHBhdGggZD1cIk04IDIuNVY1TTYgOWguMDFNMTAgOWguMDFcIi8+JyxcbiAgICAgICAgc2VydmVyOiAnPHJlY3QgeD1cIjIuNVwiIHk9XCIzXCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjRcIiByeD1cIjFcIi8+PHJlY3QgeD1cIjIuNVwiIHk9XCI5XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjRcIiByeD1cIjFcIi8+PHBhdGggZD1cIk01IDVoLjAxTTUgMTFoLjAxXCIvPicsXG4gICAgICAgIHdhcm5pbmc6ICc8cGF0aCBkPVwiTTggMi41bDYgMTAuNUgyelwiLz48cGF0aCBkPVwiTTggNi41djNNOCAxMS4ydi4xXCIvPicsXG4gICAgICAgIGJvbHQ6ICc8cGF0aCBkPVwiTTkgMS41TDMuNSA5SDhsLTEgNS41TDEyLjUgN0g4elwiLz4nXG4gICAgfTtcbiAgICB2YXIgU0NFTkFSSU9fSUNPTl9CWV9TT1VSQ0UgPSB7XG4gICAgICAgICdjb3JlLm1pc3NlZF9jYWxsJzogJ3Bob25lJyxcbiAgICAgICAgJ2NvcmUudm9pY2VtYWlsJzogJ21pYycsXG4gICAgICAgICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJzogJ3NwYXJrbGUnLFxuICAgICAgICAnYWlfc3VwZXJ2aXNvci53b3JrZXJzJzogJ3JvYm90JyxcbiAgICAgICAgJ2xvY2FsX3N0dC5zdGF0dXMnOiAnbWljJyxcbiAgICAgICAgJ2Nsb3VkX3N0dC5zdGF0dXMnOiAnbWljJyxcbiAgICAgICAgJ2Nsb3VkX2FpLnN0YXR1cyc6ICdzcGFya2xlJyxcbiAgICAgICAgJ3ZvaWNlX2FnZW50LmNhbGxiYWNrcyc6ICdwaG9uZScsXG4gICAgICAgICd2b2ljZV9hZ2VudC5ydW50aW1lJzogJ3JvYm90JyxcbiAgICAgICAgJ2NvcmUucHJvdmlkZXJfc3RhdHVzJzogJ3NlcnZlcicsXG4gICAgICAgICdjb3JlLmFkdmljZSc6ICd3YXJuaW5nJyxcbiAgICAgICAgJ2NvcmUucGJ4X3N0YXJ0ZWQnOiAnYm9sdCdcbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gc2NlbmFyaW9JY29uKHNvdXJjZUlkKSB7XG4gICAgICAgIHZhciBwYXRocyA9IFNDRU5BUklPX0lDT05TW1NDRU5BUklPX0lDT05fQllfU09VUkNFW3NvdXJjZUlkXSB8fCAnd2FybmluZyddO1xuICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwibWgtc2NlbmFyaW8taWNvblwiPjxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPicgKyBwYXRocyArICc8L3N2Zz48L3NwYW4+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJXaXphcmRTY2VuYXJpb3MoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgdmFyIGdyb3VwcyA9IEdST1VQX09SREVSLmZpbHRlcihmdW5jdGlvbiAoZ3JvdXApIHtcbiAgICAgICAgICAgIHJldHVybiBzdGF0ZS5zb3VyY2VzLnNvbWUoZnVuY3Rpb24gKHNvdXJjZSkgeyByZXR1cm4gc291cmNlLmdyb3VwID09PSBncm91cDsgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICB2YXIgaHRtbCA9ICcnO1xuICAgICAgICBncm91cHMuZm9yRWFjaChmdW5jdGlvbiAoZ3JvdXApIHtcbiAgICAgICAgICAgIHZhciBzb3VyY2VzID0gc3RhdGUuc291cmNlcy5maWx0ZXIoZnVuY3Rpb24gKHNvdXJjZSkgeyByZXR1cm4gc291cmNlLmdyb3VwID09PSBncm91cDsgfSk7XG4gICAgICAgICAgICBpZiAoZ3JvdXBzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgICAgICBodG1sICs9ICc8aDMgY2xhc3M9XCJtaC1ncm91cC10aXRsZVwiPicgKyBlc2Moc291cmNlR3JvdXBOYW1lKGdyb3VwKSkgKyAnPC9oMz4nO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIm1oLXNjZW5hcmlvLWdyaWRcIj4nO1xuICAgICAgICAgICAgc291cmNlcy5mb3JFYWNoKGZ1bmN0aW9uIChzb3VyY2UpIHtcbiAgICAgICAgICAgICAgICB2YXIgZGlzYWJsZWQgPSBbJ21vZHVsZV9taXNzaW5nJywgJ21vZHVsZV9kaXNhYmxlZCcsICdhcGlfZm9yYmlkZGVuJywgJ2FwaV9pbmNvbXBhdGlibGUnLCAnZXJyb3InLCAnZGlzYWJsZWQnXVxuICAgICAgICAgICAgICAgICAgICAuaW5kZXhPZihzb3VyY2UuYXZhaWxhYmlsaXR5KSA+PSAwO1xuICAgICAgICAgICAgICAgIHZhciBzZWxlY3RlZCA9IHcuc291cmNlSWQgPT09IHNvdXJjZS5pZDtcbiAgICAgICAgICAgICAgICAvLyBVbmF2YWlsYWJsZSBzY2VuYXJpbzogb25seSB0aGUgcmVhc29uLCBubyBhY3Rpb24gKHVzZXIgZGVjaXNpb24gUTE0KS5cbiAgICAgICAgICAgICAgICBodG1sICs9ICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cIm1oLXNjZW5hcmlvJyArIChkaXNhYmxlZCA/ICcgaXMtZGlzYWJsZWQnIDogJycpICsgKHNlbGVjdGVkID8gJyBpcy1zZWxlY3RlZCcgOiAnJylcbiAgICAgICAgICAgICAgICAgICAgKyAnXCIgZGF0YS1zb3VyY2UtaWQ9XCInICsgZXNjKHNvdXJjZS5pZCkgKyAnXCIgYXJpYS1wcmVzc2VkPVwiJyArIChzZWxlY3RlZCA/ICd0cnVlJyA6ICdmYWxzZScpICsgJ1wiJ1xuICAgICAgICAgICAgICAgICAgICArIChkaXNhYmxlZCA/ICcgZGlzYWJsZWQgYXJpYS1kaXNhYmxlZD1cInRydWVcIicgOiAnJykgKyAnPidcbiAgICAgICAgICAgICAgICAgICAgKyBzY2VuYXJpb0ljb24oc291cmNlLmlkKVxuICAgICAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXNjZW5hcmlvLXRleHRcIj48Yj4nICsgZXNjKHNvdXJjZS5uYW1lKSArICc8L2I+J1xuICAgICAgICAgICAgICAgICAgICArIChkaXNhYmxlZCA/ICc8c3BhbiBjbGFzcz1cIm1oLW1ldGFcIj4nICsgZXNjKHNvdXJjZVN0YXRlVGV4dChzb3VyY2UpKSArICc8L3NwYW4+JyA6ICcnKVxuICAgICAgICAgICAgICAgICAgICArICc8L3NwYW4+PC9idXR0b24+JztcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgaHRtbCArPSAnPC9kaXY+JztcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtc2NlbmFyaW9zJykuaHRtbChodG1sKTtcbiAgICB9XG5cbiAgICAvLyAtLS0tIHN0ZXAgMjogY29uZGl0aW9ucyAobm8gaGludHM7IGFuIGVtcHR5IGNob2ljZSBtZWFucyDCq9Cy0YHQtcK7KSAtLS0tXG5cbiAgICBmdW5jdGlvbiByZW5kZXJXaXphcmRDb25kaXRpb25zKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgdmFyIGh0bWwgPSAnJztcbiAgICAgICAgaWYgKHdpemFyZFN1cHBvcnRzRW1wbG95ZWVzKHcuZXZlbnRUeXBlcykpIHtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJmaWVsZCcgKyAoc3RhdGUuZW1wbG95ZWVzRmFpbGVkID8gJyBlcnJvcicgOiAnJykgKyAnXCIgaWQ9XCJtaC1jb25kLWVtcGxveWVlcy1maWVsZFwiPidcbiAgICAgICAgICAgICAgICArICc8bGFiZWw+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRFbXBsb3llZXMnKSkgKyAnPC9sYWJlbD4nXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cInVpIG11bHRpcGxlIHNlYXJjaCBzZWxlY3Rpb24gZHJvcGRvd24gbWgtY29uZC1kcm9wZG93blwiIGlkPVwibWgtY29uZC1lbXBsb3llZXNcIiB0YWJpbmRleD1cIjBcIj4nXG4gICAgICAgICAgICAgICAgKyAnPGlucHV0IHR5cGU9XCJoaWRkZW5cIj48c3BhbiBjbGFzcz1cImRlZmF1bHQgdGV4dFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRmlsdGVyQWxsJykpICsgJzwvc3Bhbj48ZGl2IGNsYXNzPVwibWVudVwiPjwvZGl2PjwvZGl2PidcbiAgICAgICAgICAgICAgICArIChzdGF0ZS5lbXBsb3llZXNGYWlsZWRcbiAgICAgICAgICAgICAgICAgICAgPyAnPHNwYW4gY2xhc3M9XCJtaC1oZWxwXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRMaXN0RmFpbGVkJykpXG4gICAgICAgICAgICAgICAgICAgICAgICArICcgPGEgaHJlZj1cIiNcIiBkYXRhLWFjdGlvbj1cInJldHJ5LWVtcGxveWVlc1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uUmV0cnknKSkgKyAnPC9hPjwvc3Bhbj4nXG4gICAgICAgICAgICAgICAgICAgIDogJycpXG4gICAgICAgICAgICAgICAgKyAnPC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAod2l6YXJkU3VwcG9ydHNEaXJlY3Rpb25zKHcuZXZlbnRUeXBlcykpIHtcbiAgICAgICAgICAgIHZhciBkaXJlY3Rpb25zID0gW1xuICAgICAgICAgICAgICAgIFsnaW5jb21pbmcnLCAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkRGlyZWN0aW9uSW5jb21pbmcnXSxcbiAgICAgICAgICAgICAgICBbJ291dGdvaW5nJywgJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZERpcmVjdGlvbk91dGdvaW5nJ10sXG4gICAgICAgICAgICAgICAgWydpbnRlcm5hbCcsICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmREaXJlY3Rpb25JbnRlcm5hbCddXG4gICAgICAgICAgICBdO1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cImZpZWxkXCI+PGxhYmVsPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkRGlyZWN0aW9ucycpKSArICc8L2xhYmVsPidcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtc2VnXCIgcm9sZT1cImdyb3VwXCIgYXJpYS1sYWJlbD1cIicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkRGlyZWN0aW9ucycpKSArICdcIj4nO1xuICAgICAgICAgICAgZGlyZWN0aW9ucy5mb3JFYWNoKGZ1bmN0aW9uIChwYWlyKSB7XG4gICAgICAgICAgICAgICAgdmFyIHByZXNzZWQgPSB3LmZpbHRlcnMuZGlyZWN0aW9ucy5pbmRleE9mKHBhaXJbMF0pID49IDA7XG4gICAgICAgICAgICAgICAgaHRtbCArPSAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgZGF0YS1kaXJlY3Rpb249XCInICsgcGFpclswXSArICdcIiBhcmlhLXByZXNzZWQ9XCInICsgKHByZXNzZWQgPyAndHJ1ZScgOiAnZmFsc2UnKSArICdcIj4nXG4gICAgICAgICAgICAgICAgICAgICsgZXNjKHQocGFpclsxXSkpICsgJzwvYnV0dG9uPic7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGh0bWwgKz0gJzwvZGl2PjwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHdpemFyZFN1cHBvcnRzUHJvdmlkZXJzKHcuZXZlbnRUeXBlcykpIHtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJmaWVsZFwiPjxsYWJlbD4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFByb3ZpZGVycycpKSArICc8L2xhYmVsPidcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwidWkgbXVsdGlwbGUgc2VhcmNoIHNlbGVjdGlvbiBkcm9wZG93biBtaC1jb25kLWRyb3Bkb3duXCIgaWQ9XCJtaC1jb25kLXByb3ZpZGVyc1wiIHRhYmluZGV4PVwiMFwiPidcbiAgICAgICAgICAgICAgICArICc8aW5wdXQgdHlwZT1cImhpZGRlblwiPjxzcGFuIGNsYXNzPVwiZGVmYXVsdCB0ZXh0XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9GaWx0ZXJBbGwnKSkgKyAnPC9zcGFuPjxkaXYgY2xhc3M9XCJtZW51XCI+PC9kaXY+PC9kaXY+PC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAody5ldmVudFR5cGVzLmluZGV4T2YoJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnKSA+PSAwKSB7XG4gICAgICAgICAgICB2YXIgcmFuZ2UgPSB3LmZpbHRlcnMucXVhbGl0eV9zY29yZSB8fCB7fTtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJmaWVsZFwiPjxsYWJlbD4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFF1YWxpdHknKSkgKyAnPC9sYWJlbD4nXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLWlubGluZS1pbnB1dHNcIj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRRdWFsaXR5RnJvbScpKSArICc8L3NwYW4+PGlucHV0IHR5cGU9XCJudW1iZXJcIiBtaW49XCIwXCIgbWF4PVwiMTAwXCIgY2xhc3M9XCJtaC1xdWFsaXR5LW1pbiBtaC1pbnB1dC14c1wiIHZhbHVlPVwiJyArIChyYW5nZS5taW4gIT09IHVuZGVmaW5lZCA/IHJhbmdlLm1pbiA6ICcnKSArICdcIj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRRdWFsaXR5VG8nKSkgKyAnPC9zcGFuPjxpbnB1dCB0eXBlPVwibnVtYmVyXCIgbWluPVwiMFwiIG1heD1cIjEwMFwiIGNsYXNzPVwibWgtcXVhbGl0eS1tYXggbWgtaW5wdXQteHNcIiB2YWx1ZT1cIicgKyAocmFuZ2UubWF4ICE9PSB1bmRlZmluZWQgPyByYW5nZS5tYXggOiAnJykgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgJzwvZGl2PjwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHcuZXZlbnRUeXBlcy5pbmRleE9mKCdjb3JlLm1pc3NlZF9jYWxsJykgPj0gMCkge1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIm1oLXN3aXRjaC1yb3cgbWgtcmV0cmFjdC1yb3dcIj4nXG4gICAgICAgICAgICAgICAgKyAnPGxhYmVsIGNsYXNzPVwidWkgdG9nZ2xlIGNoZWNrYm94JyArICh3LnJldHJhY3QuZW5hYmxlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAnXCIgaWQ9XCJtaC1yZXRyYWN0LWVuYWJsZWRcIj4nXG4gICAgICAgICAgICAgICAgKyAnPGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGNsYXNzPVwiaGlkZGVuXCInICsgKHcucmV0cmFjdC5lbmFibGVkID8gJyBjaGVja2VkJyA6ICcnKSArICcgYXJpYS1sYWJlbD1cIicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUmV0cmFjdEVuYWJsZWQnKSkgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtdHJhY2tcIj48L3NwYW4+PC9sYWJlbD4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SZXRyYWN0RW5hYmxlZCcpKSArICc8L3NwYW4+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtaW5saW5lLWlucHV0c1wiIGlkPVwibWgtcmV0cmFjdC1vcHRpb25zXCInICsgKHcucmV0cmFjdC5lbmFibGVkID8gJycgOiAnIGhpZGRlbicpICsgJz4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tdXRlZFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUmV0cmFjdFdpbmRvd0JlZm9yZScpKSArICc8L3NwYW4+J1xuICAgICAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwibnVtYmVyXCIgbWluPVwiNVwiIG1heD1cIjEyMFwiIGlkPVwibWgtcmV0cmFjdC13aW5kb3dcIiBjbGFzcz1cIm1oLWlucHV0LXhzXCIgdmFsdWU9XCInICsgdy5yZXRyYWN0LndpbmRvd19taW4gKyAnXCIgYXJpYS1sYWJlbD1cIicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUmV0cmFjdE1pbnV0ZXMnKSkgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbXV0ZWRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1JldHJhY3RNaW51dGVzJykpICsgJzwvc3Bhbj48L3NwYW4+J1xuICAgICAgICAgICAgICAgICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArICh3aXphcmRJc01heCgpXG4gICAgICAgICAgICAgICAgICAgID8gJzxkaXYgY2xhc3M9XCJmaWVsZFwiIGlkPVwibWgtcmV0cmFjdC1tYXgtaGludFwiJyArICh3LnJldHJhY3QuZW5hYmxlZCA/ICcnIDogJyBoaWRkZW4nKSArICc+J1xuICAgICAgICAgICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1oZWxwXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SZXRyYWN0TWF4SGludCcpKSArICc8L3NwYW4+PC9kaXY+J1xuICAgICAgICAgICAgICAgICAgICA6ICcnKTtcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtd2l6YXJkLWNvbmRpdGlvbnMnKS5odG1sKGh0bWwpO1xuICAgICAgICBpbml0Q29uZGl0aW9uRHJvcGRvd25zKCk7XG4gICAgICAgIGJpbmRXaXphcmRDb25kaXRpb25zKCk7XG4gICAgICAgIHJlbmRlcldpemFyZFByZXZpZXcoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBpbml0Q29uZGl0aW9uRHJvcGRvd25zKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIHZhciAkZW1wbG95ZWVzID0gJCgnI21oLWNvbmQtZW1wbG95ZWVzJyk7XG4gICAgICAgIGlmICgkZW1wbG95ZWVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHZhciBzZWxlY3RlZFVzZXJzID0gdy5maWx0ZXJzLnVzZXJfaWRzLm1hcChTdHJpbmcpO1xuICAgICAgICAgICAgJGVtcGxveWVlcy5kcm9wZG93bih7XG4gICAgICAgICAgICAgICAgdmFsdWVzOiBzdGF0ZS5lbXBsb3llZXMubWFwKGZ1bmN0aW9uIChlbXBsb3llZSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4geyBuYW1lOiBlbXBsb3llZS5sYWJlbCwgdmFsdWU6IFN0cmluZyhlbXBsb3llZS5pZCksIHNlbGVjdGVkOiBzZWxlY3RlZFVzZXJzLmluZGV4T2YoU3RyaW5nKGVtcGxveWVlLmlkKSkgPj0gMCB9O1xuICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9GaWx0ZXJBbGwnKSxcbiAgICAgICAgICAgICAgICBmdWxsVGV4dFNlYXJjaDogdHJ1ZSxcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiB7IG5vUmVzdWx0czogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRmlsdGVyTm90aGluZ0ZvdW5kJykgfSxcbiAgICAgICAgICAgICAgICBvbkNoYW5nZTogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghc3RhdGUucnVsZVdpemFyZCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgICAgICAgICAgc3RhdGUucnVsZVdpemFyZC5maWx0ZXJzLnVzZXJfaWRzID0gU3RyaW5nKHZhbHVlIHx8ICcnKS5zcGxpdCgnLCcpLmZpbHRlcihCb29sZWFuKS5tYXAoTnVtYmVyKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgJHByb3ZpZGVycyA9ICQoJyNtaC1jb25kLXByb3ZpZGVycycpO1xuICAgICAgICBpZiAoJHByb3ZpZGVycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB2YXIgc2VsZWN0ZWRQcm92aWRlcnMgPSB3LmZpbHRlcnMucHJvdmlkZXJzLm1hcChTdHJpbmcpO1xuICAgICAgICAgICAgJHByb3ZpZGVycy5kcm9wZG93bih7XG4gICAgICAgICAgICAgICAgdmFsdWVzOiBzdGF0ZS5wcm92aWRlcnMubWFwKGZ1bmN0aW9uIChwcm92aWRlcikge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4geyBuYW1lOiBwcm92aWRlci5sYWJlbCwgdmFsdWU6IFN0cmluZyhwcm92aWRlci5pZCksIHNlbGVjdGVkOiBzZWxlY3RlZFByb3ZpZGVycy5pbmRleE9mKFN0cmluZyhwcm92aWRlci5pZCkpID49IDAgfTtcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcjogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRmlsdGVyQWxsJyksXG4gICAgICAgICAgICAgICAgZnVsbFRleHRTZWFyY2g6IHRydWUsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogeyBub1Jlc3VsdHM6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0ZpbHRlck5vdGhpbmdGb3VuZCcpIH0sXG4gICAgICAgICAgICAgICAgb25DaGFuZ2U6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXN0YXRlLnJ1bGVXaXphcmQpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLnJ1bGVXaXphcmQuZmlsdGVycy5wcm92aWRlcnMgPSBTdHJpbmcodmFsdWUgfHwgJycpLnNwbGl0KCcsJykuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYmluZFdpemFyZENvbmRpdGlvbnMoKSB7XG4gICAgICAgIHZhciAkZm9ybSA9ICQoJyNtaC13aXphcmQtY29uZGl0aW9ucycpO1xuICAgICAgICAkZm9ybS5vZmYoJy53aXphcmQnKTtcbiAgICAgICAgJGZvcm0ub24oJ2NsaWNrLndpemFyZCcsICcubWgtc2VnIGJ1dHRvbicsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHZhciB2YWx1ZSA9IFN0cmluZygkKHRoaXMpLmRhdGEoJ2RpcmVjdGlvbicpKTtcbiAgICAgICAgICAgIHZhciBpbmRleCA9IHcuZmlsdGVycy5kaXJlY3Rpb25zLmluZGV4T2YodmFsdWUpO1xuICAgICAgICAgICAgaWYgKGluZGV4ID49IDApIHtcbiAgICAgICAgICAgICAgICB3LmZpbHRlcnMuZGlyZWN0aW9ucy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB3LmZpbHRlcnMuZGlyZWN0aW9ucy5wdXNoKHZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICQodGhpcykuYXR0cignYXJpYS1wcmVzc2VkJywgaW5kZXggPj0gMCA/ICdmYWxzZScgOiAndHJ1ZScpO1xuICAgICAgICAgICAgcmVuZGVyV2l6YXJkUHJldmlldygpO1xuICAgICAgICB9KTtcbiAgICAgICAgJGZvcm0ub24oJ2NsaWNrLndpemFyZCcsICdbZGF0YS1hY3Rpb249XCJyZXRyeS1lbXBsb3llZXNcIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBzdGF0ZS5lbXBsb3llZXNGYWlsZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIGxvYWRFbXBsb3llZXMoZnVuY3Rpb24gKCkgeyByZW5kZXJXaXphcmRDb25kaXRpb25zKCk7IH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgJGZvcm0ub24oJ2NoYW5nZS53aXphcmQnLCAnI21oLXJldHJhY3QtZW5hYmxlZCBpbnB1dCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHcucmV0cmFjdC5lbmFibGVkID0gJCh0aGlzKS5wcm9wKCdjaGVja2VkJyk7XG4gICAgICAgICAgICAkKCcjbWgtcmV0cmFjdC1lbmFibGVkJykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCB3LnJldHJhY3QuZW5hYmxlZCk7XG4gICAgICAgICAgICAkKCcjbWgtcmV0cmFjdC1vcHRpb25zJykucHJvcCgnaGlkZGVuJywgIXcucmV0cmFjdC5lbmFibGVkKTtcbiAgICAgICAgICAgICQoJyNtaC1yZXRyYWN0LW1heC1oaW50JykucHJvcCgnaGlkZGVuJywgIXcucmV0cmFjdC5lbmFibGVkKTtcbiAgICAgICAgfSk7XG4gICAgICAgICRmb3JtLm9uKCdpbnB1dC53aXphcmQgY2hhbmdlLndpemFyZCcsICcjbWgtcmV0cmFjdC13aW5kb3cnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIgdmFsdWUgPSBOdW1iZXIoJCh0aGlzKS52YWwoKSk7XG4gICAgICAgICAgICB3LnJldHJhY3Qud2luZG93X21pbiA9IHZhbHVlID49IDUgJiYgdmFsdWUgPD0gMTIwID8gdmFsdWUgOiAyMDtcbiAgICAgICAgfSk7XG4gICAgICAgICRmb3JtLm9uKCdpbnB1dC53aXphcmQnLCAnLm1oLXF1YWxpdHktbWluLCAubWgtcXVhbGl0eS1tYXgnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIgbWluID0gJGZvcm0uZmluZCgnLm1oLXF1YWxpdHktbWluJykudmFsKCk7XG4gICAgICAgICAgICB2YXIgbWF4ID0gJGZvcm0uZmluZCgnLm1oLXF1YWxpdHktbWF4JykudmFsKCk7XG4gICAgICAgICAgICB2YXIgcmFuZ2UgPSB7fTtcbiAgICAgICAgICAgIGlmIChTdHJpbmcobWluKS50cmltKCkgIT09ICcnKSB7IHJhbmdlLm1pbiA9IE51bWJlcihtaW4pOyB9XG4gICAgICAgICAgICBpZiAoU3RyaW5nKG1heCkudHJpbSgpICE9PSAnJykgeyByYW5nZS5tYXggPSBOdW1iZXIobWF4KTsgfVxuICAgICAgICAgICAgdy5maWx0ZXJzLnF1YWxpdHlfc2NvcmUgPSBPYmplY3Qua2V5cyhyYW5nZSkubGVuZ3RoID4gMCA/IHJhbmdlIDogbnVsbDtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZFByZXZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLSBzdGVwIDM6IHdoZXJlIHRvIHNlbmQgLS0tLVxuXG4gICAgZnVuY3Rpb24gYWN0aXZlV2l6YXJkQm90KCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm4gbnVsbDsgfVxuICAgICAgICB2YXIgYm90cyA9IHN0YXRlLmJvdHMuZmlsdGVyKGZ1bmN0aW9uIChib3QpIHsgcmV0dXJuIGJvdC5lbmFibGVkICE9PSBmYWxzZTsgfSk7XG4gICAgICAgIGlmICh3LmJvdElkID4gMCkge1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBib3RzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgaWYgKE51bWJlcihib3RzW2ldLmlkKSA9PT0gTnVtYmVyKHcuYm90SWQpKSB7IHJldHVybiBib3RzW2ldOyB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGJvdHMubGVuZ3RoID4gMCA/IGJvdHNbMF0gOiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlcldpemFyZFJlY2lwaWVudHMoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgdmFyIHN1cHBvcnRzRW1wbG95ZWVzID0gd2l6YXJkU3VwcG9ydHNFbXBsb3llZXMody5ldmVudFR5cGVzKTtcbiAgICAgICAgdmFyIGJvdHMgPSBzdGF0ZS5ib3RzLmZpbHRlcihmdW5jdGlvbiAoYm90KSB7IHJldHVybiBib3QuZW5hYmxlZCAhPT0gZmFsc2U7IH0pO1xuICAgICAgICB2YXIgYWN0aXZlID0gYWN0aXZlV2l6YXJkQm90KCk7XG4gICAgICAgIGlmIChhY3RpdmUgIT09IG51bGwgJiYgTnVtYmVyKHcuYm90SWQpICE9PSBOdW1iZXIoYWN0aXZlLmlkKSkge1xuICAgICAgICAgICAgdy5ib3RJZCA9IE51bWJlcihhY3RpdmUuaWQpOyAvLyBhIHNpbmdsZSBib3QgaXMgc2VsZWN0ZWQgYnkgaXRzZWxmXG4gICAgICAgIH1cbiAgICAgICAgdmFyIGJvdEh0bWwgPSAnJztcbiAgICAgICAgYm90cy5mb3JFYWNoKGZ1bmN0aW9uIChib3QpIHtcbiAgICAgICAgICAgIHZhciBzZWxlY3RlZCA9IGFjdGl2ZSAhPT0gbnVsbCAmJiBOdW1iZXIoYWN0aXZlLmlkKSA9PT0gTnVtYmVyKGJvdC5pZCk7XG4gICAgICAgICAgICB2YXIgY2hhbm5lbCA9IGJvdC5jaGFubmVsID09PSAnbWF4JyA/ICdtYXgnIDogJ3RnJztcbiAgICAgICAgICAgIGJvdEh0bWwgKz0gJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGNsYXNzPVwibWgtc2NlbmFyaW8gbWgtYm90LWNob2ljZScgKyAoc2VsZWN0ZWQgPyAnIGlzLXNlbGVjdGVkJyA6ICcnKVxuICAgICAgICAgICAgICAgICsgJ1wiIGRhdGEtYm90LWlkPVwiJyArIGJvdC5pZCArICdcIiBhcmlhLXByZXNzZWQ9XCInICsgKHNlbGVjdGVkID8gJ3RydWUnIDogJ2ZhbHNlJykgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyICcgKyBjaGFubmVsICsgJ1wiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPicgKyAoY2hhbm5lbCA9PT0gJ21heCcgPyAnTUFYJyA6ICdURycpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICAgICAgKyAnPGIgY2xhc3M9XCJtaC10cnVuY2F0ZVwiPicgKyBlc2MoYm90LnRpdGxlKSArICc8L2I+PC9idXR0b24+JztcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtYm90cycpLmh0bWwoYm90SHRtbCk7XG4gICAgICAgICQoJyNtaC13aXphcmQtYm90cy1maWVsZCcpLmF0dHIoJ2hpZGRlbicsIGJvdHMubGVuZ3RoID4gMCA/IG51bGwgOiB0cnVlKTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1uby1ib3RzJykuYXR0cignaGlkZGVuJywgYm90cy5sZW5ndGggPiAwID8gdHJ1ZSA6IG51bGwpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXRhcmdldCcpLmF0dHIoJ2hpZGRlbicsIGJvdHMubGVuZ3RoID4gMCA/IG51bGwgOiB0cnVlKTtcblxuICAgICAgICBpZiAoIXN1cHBvcnRzRW1wbG95ZWVzKSB7XG4gICAgICAgICAgICB3LnRhcmdldE1vZGUgPSAncmVjaXBpZW50cyc7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLXRhcmdldCBbdmFsdWU9XCJlbXBsb3llZVwiXSwgI21oLXdpemFyZC10YXJnZXQgW3ZhbHVlPVwiZW1wbG95ZWVfb3JfcmVjaXBpZW50c1wiXScpXG4gICAgICAgICAgICAgICAgLmNsb3Nlc3QoJ2xhYmVsJykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLXRhcmdldCBbdmFsdWU9XCJlbXBsb3llZVwiXSwgI21oLXdpemFyZC10YXJnZXQgW3ZhbHVlPVwiZW1wbG95ZWVfb3JfcmVjaXBpZW50c1wiXScpXG4gICAgICAgICAgICAgICAgLmNsb3Nlc3QoJ2xhYmVsJykucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQgaW5wdXRbbmFtZT1cIm1oLXRhcmdldFwiXScpLmVhY2goZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGNoZWNrZWQgPSAkKHRoaXMpLnZhbCgpID09PSB3LnRhcmdldE1vZGU7XG4gICAgICAgICAgICAkKHRoaXMpLnByb3AoJ2NoZWNrZWQnLCBjaGVja2VkKS5jbG9zZXN0KCdsYWJlbCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgY2hlY2tlZCk7XG4gICAgICAgIH0pO1xuICAgICAgICByZW5kZXJXaXphcmRDaGF0cygpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLW1hc2snKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsIHcubWFzayk7XG4gICAgICAgICQoJyNtaC13aXphcmQtbWFzayBpbnB1dCcpLnByb3AoJ2NoZWNrZWQnLCB3Lm1hc2spO1xuICAgICAgICByZW5kZXJXaXphcmRBdHRhY2htZW50cygpO1xuICAgICAgICBiaW5kV2l6YXJkUmVjaXBpZW50cygpO1xuICAgICAgICAvLyBhIHNjZW5hcmlvIHdpdGhvdXQgY29uZGl0aW9ucyBnb2VzIDEgLT4gMzogc3RlcCAzIG11c3QgcmVuZGVyIGl0cyBvd24gcHJldmlld1xuICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyV2l6YXJkQXR0YWNobWVudHMoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgdmFyIG1vZGVzID0gd2l6YXJkQXR0YWNobWVudE1vZGVzKHcuZXZlbnRUeXBlcyk7XG4gICAgICAgIHZhciAkZmllbGQgPSAkKCcjbWgtd2l6YXJkLWF0dGFjaG1lbnRzJyk7XG4gICAgICAgIGlmIChtb2Rlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHcuYXR0YWNobWVudHMgPSAnbm9uZSc7XG4gICAgICAgICAgICAkZmllbGQuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1vZGVzLmluZGV4T2Yody5hdHRhY2htZW50cykgPCAwKSB7IHcuYXR0YWNobWVudHMgPSAnbm9uZSc7IH1cbiAgICAgICAgJGZpZWxkLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAvLyBhIHZvaWNlbWFpbCBpcyBvbmUgZmlsZTogdGhlIHdob2xlLWNvbnZlcnNhdGlvbiB3b3JkaW5nIGJlY29tZXMgcGxhaW4gXCJSZWNvcmRpbmdcIlxuICAgICAgICB2YXIgdm9pY2VtYWlsT25seSA9IHcuZXZlbnRUeXBlcy5pbmRleE9mKCdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJykgPCAwO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLWF0dGFjaC1yZWNvcmRpbmctdGV4dCcpLnRleHQodCh2b2ljZW1haWxPbmx5XG4gICAgICAgICAgICA/ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRBdHRhY2hWb2ljZW1haWwnXG4gICAgICAgICAgICA6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRBdHRhY2hSZWNvcmRpbmcnKSk7XG4gICAgICAgICRmaWVsZC5maW5kKCdsYWJlbFtkYXRhLW1vZGVdJykuZWFjaChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgbW9kZSA9IFN0cmluZygkKHRoaXMpLmRhdGEoJ21vZGUnKSk7XG4gICAgICAgICAgICB2YXIgY2hlY2tlZCA9IG1vZGUgPT09IHcuYXR0YWNobWVudHM7XG4gICAgICAgICAgICAkKHRoaXMpLmF0dHIoJ2hpZGRlbicsIG1vZGVzLmluZGV4T2YobW9kZSkgPj0gMCA/IG51bGwgOiB0cnVlKVxuICAgICAgICAgICAgICAgIC50b2dnbGVDbGFzcygnY2hlY2tlZCcsIGNoZWNrZWQpLmZpbmQoJ2lucHV0JykucHJvcCgnY2hlY2tlZCcsIGNoZWNrZWQpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1hdHRhY2gtaGludCcpLmF0dHIoJ2hpZGRlbicsIHcuYXR0YWNobWVudHMgPT09ICdub25lJyA/IHRydWUgOiBudWxsKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJXaXphcmRDaGF0cygpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICB2YXIgYm90ID0gYWN0aXZlV2l6YXJkQm90KCk7XG4gICAgICAgIHZhciBjaGF0cyA9IGJvdCA/IChib3QuY2hhdHMgfHwgW10pLmZpbHRlcihmdW5jdGlvbiAoY2hhdCkge1xuICAgICAgICAgICAgcmV0dXJuIGNoYXQuc3RhdGUgPT09ICdhY3RpdmUnICYmIGNoYXQuZW5hYmxlZCA9PT0gdHJ1ZTtcbiAgICAgICAgfSkgOiBbXTtcbiAgICAgICAgdmFyIGlkcyA9IGNoYXRzLm1hcChmdW5jdGlvbiAoY2hhdCkgeyByZXR1cm4gTnVtYmVyKGNoYXQuaWQpOyB9KTtcbiAgICAgICAgdy5jaGF0SWRzID0gdy5jaGF0SWRzLmZpbHRlcihmdW5jdGlvbiAoaWQpIHsgcmV0dXJuIGlkcy5pbmRleE9mKGlkKSA+PSAwOyB9KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1jaGF0cy1maWVsZCcpLmF0dHIoJ2hpZGRlbicsIHcudGFyZ2V0TW9kZSA9PT0gJ2VtcGxveWVlJyA/IHRydWUgOiBudWxsKTtcbiAgICAgICAgdmFyICRkcm9wZG93biA9ICQoJyNtaC13aXphcmQtY2hhdHMnKTtcbiAgICAgICAgJGRyb3Bkb3duLmRyb3Bkb3duKCdkZXN0cm95Jyk7XG4gICAgICAgICRkcm9wZG93bi5maW5kKCdhLnVpLmxhYmVsJykucmVtb3ZlKCk7XG4gICAgICAgICRkcm9wZG93bi5kcm9wZG93bih7XG4gICAgICAgICAgICB2YWx1ZXM6IGNoYXRzLm1hcChmdW5jdGlvbiAoY2hhdCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGVzYyhjaGF0LnRpdGxlIHx8IGNoYXQuY2hhdF9pZCkgKyAnIDxzcGFuIGNsYXNzPVwibWgtbWV0YVwiPsK3ICcgKyBlc2MoY2hhdEtpbmRMYWJlbChjaGF0LmNoYXRfa2luZCkpICsgJzwvc3Bhbj4nLFxuICAgICAgICAgICAgICAgICAgICB0ZXh0OiBlc2MoY2hhdC50aXRsZSB8fCBjaGF0LmNoYXRfaWQpLFxuICAgICAgICAgICAgICAgICAgICB2YWx1ZTogU3RyaW5nKGNoYXQuaWQpLFxuICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZDogdy5jaGF0SWRzLmluZGV4T2YoTnVtYmVyKGNoYXQuaWQpKSA+PSAwXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgcGxhY2Vob2xkZXI6IGNoYXRzLmxlbmd0aCA+IDAgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRDaGF0c1RpdGxlJykgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmROb0NoYXRzJyksXG4gICAgICAgICAgICBtZXNzYWdlOiB7IG5vUmVzdWx0czogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkTm9DaGF0cycpIH0sXG4gICAgICAgICAgICBvbkNoYW5nZTogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS5ydWxlV2l6YXJkKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICAgIHN0YXRlLnJ1bGVXaXphcmQuY2hhdElkcyA9IFN0cmluZyh2YWx1ZSB8fCAnJykuc3BsaXQoJywnKS5maWx0ZXIoQm9vbGVhbikubWFwKE51bWJlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJpbmRXaXphcmRSZWNpcGllbnRzKCkge1xuICAgICAgICB2YXIgJHN0ZXAgPSAkKCcjbWgtd2l6YXJkLXN0ZXAtMycpO1xuICAgICAgICAkc3RlcC5vZmYoJy53aXphcmQnKTtcbiAgICAgICAgJHN0ZXAub24oJ2NsaWNrLndpemFyZCcsICcubWgtYm90LWNob2ljZScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIHN0YXRlLnJ1bGVXaXphcmQuYm90SWQgPSBOdW1iZXIoJCh0aGlzKS5kYXRhKCdib3QtaWQnKSk7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLmNoYXRJZHMgPSBbXTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZFJlY2lwaWVudHMoKTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZFByZXZpZXcoKTtcbiAgICAgICAgICAgIHVwZGF0ZVdpemFyZE5leHQoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICRzdGVwLm9uKCdjaGFuZ2Uud2l6YXJkJywgJ2lucHV0W25hbWU9XCJtaC10YXJnZXRcIl0nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLnRhcmdldE1vZGUgPSBTdHJpbmcoJCh0aGlzKS52YWwoKSk7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLXRhcmdldCBpbnB1dFtuYW1lPVwibWgtdGFyZ2V0XCJdJykuZWFjaChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgJCh0aGlzKS5jbG9zZXN0KCdsYWJlbCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgJCh0aGlzKS5wcm9wKCdjaGVja2VkJykpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLWNoYXRzLWZpZWxkJykuYXR0cignaGlkZGVuJywgc3RhdGUucnVsZVdpemFyZC50YXJnZXRNb2RlID09PSAnZW1wbG95ZWUnID8gdHJ1ZSA6IG51bGwpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHN0ZXAub24oJ2NoYW5nZS53aXphcmQnLCAnaW5wdXRbbmFtZT1cIm1oLWF0dGFjaG1lbnRzXCJdJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc3RhdGUucnVsZVdpemFyZC5hdHRhY2htZW50cyA9IFN0cmluZygkKHRoaXMpLnZhbCgpKTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZEF0dGFjaG1lbnRzKCk7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkc3RlcC5vbignY2hhbmdlLndpemFyZCcsICcjbWgtd2l6YXJkLW1hc2sgaW5wdXQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLm1hc2sgPSAkKHRoaXMpLnByb3AoJ2NoZWNrZWQnKTtcbiAgICAgICAgICAgICQoJyNtaC13aXphcmQtbWFzaycpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgc3RhdGUucnVsZVdpemFyZC5tYXNrKTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZFByZXZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLSBwcmV2aWV3IChzdGVwIDIsIHJpZ2h0IGNvbHVtbikgLS0tLVxuXG4gICAgLyoqIEEgcnVsZSB0YXJnZXRzIG9uZSBib3QsIHNvIGl0cyBjaGFubmVsIGlzIHRoZSBjaGFubmVsIG9mIHRoZSBhY3RpdmUgd2l6YXJkIGJvdC4gKi9cbiAgICBmdW5jdGlvbiB3aXphcmRJc01heCgpIHtcbiAgICAgICAgdmFyIGJvdCA9IGFjdGl2ZVdpemFyZEJvdCgpO1xuICAgICAgICByZXR1cm4gISFib3QgJiYgYm90LmNoYW5uZWwgPT09ICdtYXgnO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHdpemFyZFByZXZpZXdDYWxsVHlwZSh0eXBlcykge1xuICAgICAgICB2YXIgb3JkZXIgPSBbXG4gICAgICAgICAgICAnY29yZS5taXNzZWRfY2FsbCcsICdjb3JlLnZvaWNlbWFpbCcsICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJyxcbiAgICAgICAgICAgICdhaV9zdXBlcnZpc29yLndvcmtlcl9vZmZsaW5lJywgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29ubGluZScsXG4gICAgICAgICAgICAnbG9jYWxfc3R0Lndvcmtlcl9vZmZsaW5lJywgJ2xvY2FsX3N0dC53b3JrZXJfb25saW5lJywgJ2xvY2FsX3N0dC5iYWNrbG9nX25vX3dvcmtlcnMnLCAnbG9jYWxfc3R0LmJhY2tsb2dfcmVzb2x2ZWQnLFxuICAgICAgICAgICAgJ2Nsb3VkX3N0dC5pbmNpZGVudCcsICdjbG91ZF9zdHQuaW5jaWRlbnRfcmVzb2x2ZWQnLCAnY2xvdWRfc3R0LnBhdXNlZCcsICdjbG91ZF9zdHQucmVzdW1lZCcsXG4gICAgICAgICAgICAnY2xvdWRfYWkucGF1c2VkJywgJ2Nsb3VkX2FpLnJlc3VtZWQnLFxuICAgICAgICAgICAgJ3ZvaWNlX2FnZW50LmNhbGxiYWNrX3JlcXVlc3QnLCAndm9pY2VfYWdlbnQucnVudGltZV9kb3duJywgJ3ZvaWNlX2FnZW50LnJ1bnRpbWVfdXAnLFxuICAgICAgICAgICAgJ2NvcmUucHJvdmlkZXJfZG93bicsICdjb3JlLnByb3ZpZGVyX3VwJywgJ2NvcmUuYWR2aWNlJywgJ2NvcmUucGJ4X3N0YXJ0ZWQnXG4gICAgICAgIF07XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgb3JkZXIubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmICh0eXBlcy5pbmRleE9mKG9yZGVyW2ldKSA+PSAwKSB7IHJldHVybiBvcmRlcltpXTsgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICAvLyBTYW1wbGUgZGF0YSBvZiB0aGUgcHJldmlldyBidWJibGVzIGZvciB0aGUgbW9kdWxlIHN0YXR1cyBldmVudHM7IG5ldmVyIHJlYWwgdmFsdWVzLlxuICAgIHZhciBTVEFUVVNfUFJFVklFV19TQU1QTEVTID0ge1xuICAgICAgICAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb2ZmbGluZSc6IHsgY29kZTogJ3dvcmtlcl9vZmZsaW5lJywgcmVmOiAnc2FtcGxlJywgY291bnRlcnM6IHsgd29ya2Vyc19vbmxpbmU6IDEsIHdvcmtlcnNfdG90YWw6IDIgfSB9LFxuICAgICAgICAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb25saW5lJzogeyBjb2RlOiAnd29ya2VyX29mZmxpbmUnLCByZWY6ICdzYW1wbGUnLCBjb3VudGVyczogeyB3b3JrZXJzX29ubGluZTogMiwgd29ya2Vyc190b3RhbDogMiB9IH0sXG4gICAgICAgICdsb2NhbF9zdHQud29ya2VyX29mZmxpbmUnOiB7IGNvZGU6ICd3b3JrZXJfb2ZmbGluZScsIHJlZjogJ3NhbXBsZScsIGNvdW50ZXJzOiB7IHdvcmtlcnNfb25saW5lOiAyLCB3b3JrZXJzX3RvdGFsOiAzIH0gfSxcbiAgICAgICAgJ2xvY2FsX3N0dC53b3JrZXJfb25saW5lJzogeyBjb2RlOiAnd29ya2VyX29mZmxpbmUnLCByZWY6ICdzYW1wbGUnLCBjb3VudGVyczogeyB3b3JrZXJzX29ubGluZTogMywgd29ya2Vyc190b3RhbDogMyB9IH0sXG4gICAgICAgICdsb2NhbF9zdHQuYmFja2xvZ19ub193b3JrZXJzJzogeyBjb2RlOiAnYmFja2xvZ19ub193b3JrZXJzJywgcmVmOiAncXVldWUnLCBjb3VudGVyczogeyB3b3JrZXJzX29ubGluZTogMCwgd29ya2Vyc190b3RhbDogMywgam9ic193YWl0aW5nOiAxMiB9IH0sXG4gICAgICAgICdsb2NhbF9zdHQuYmFja2xvZ19yZXNvbHZlZCc6IHsgY29kZTogJ2JhY2tsb2dfbm9fd29ya2VycycsIHJlZjogJ3F1ZXVlJywgY291bnRlcnM6IHsgd29ya2Vyc19vbmxpbmU6IDMsIHdvcmtlcnNfdG90YWw6IDMsIGpvYnNfd2FpdGluZzogMCB9IH0sXG4gICAgICAgICdjbG91ZF9zdHQuaW5jaWRlbnQnOiB7IGNvZGU6ICdpbmNpZGVudF9vcGVuJywgcmVmOiAnc2FtcGxlJywgY291bnRlcnM6IHsgaW5jaWRlbnRzX29wZW46IDEgfSB9LFxuICAgICAgICAnY2xvdWRfc3R0LmluY2lkZW50X3Jlc29sdmVkJzogeyBjb2RlOiAnaW5jaWRlbnRfb3BlbicsIHJlZjogJ3NhbXBsZScsIGNvdW50ZXJzOiB7IGluY2lkZW50c19vcGVuOiAwIH0gfSxcbiAgICAgICAgJ2Nsb3VkX3N0dC5wYXVzZWQnOiB7IGNvZGU6ICdwcm9jZXNzaW5nX3BhdXNlZCcsIHJlZjogJ21haW50ZW5hbmNlJywgY291bnRlcnM6IHt9IH0sXG4gICAgICAgICdjbG91ZF9zdHQucmVzdW1lZCc6IHsgY29kZTogJ3Byb2Nlc3NpbmdfcGF1c2VkJywgcmVmOiAnbWFpbnRlbmFuY2UnLCBjb3VudGVyczoge30gfSxcbiAgICAgICAgJ2Nsb3VkX2FpLnBhdXNlZCc6IHsgY29kZTogJ3Byb2Nlc3NpbmdfcGF1c2VkJywgcmVmOiAnaW5zdWZmaWNpZW50X2Z1bmRzJywgY291bnRlcnM6IHsgam9ic193YWl0aW5nOiAxMiB9IH0sXG4gICAgICAgICdjbG91ZF9haS5yZXN1bWVkJzogeyBjb2RlOiAncHJvY2Vzc2luZ19wYXVzZWQnLCByZWY6ICdpbnN1ZmZpY2llbnRfZnVuZHMnLCBjb3VudGVyczogeyBqb2JzX3dhaXRpbmc6IDAgfSB9XG4gICAgfTtcblxuICAgIGZ1bmN0aW9uIHJlbmRlcldpemFyZFByZXZpZXcoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICB2YXIgdHlwZSA9IHdpemFyZFByZXZpZXdDYWxsVHlwZSh3LmV2ZW50VHlwZXMpO1xuICAgICAgICBpZiAodHlwZSA9PT0gJycpIHtcbiAgICAgICAgICAgICQoJyNtaC13aXphcmQtcHJldmlldywgI21oLXdpemFyZC1wcmV2aWV3LXRhcmdldCcpLmVtcHR5KCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIG5hbWVzID0gZXZlbnRUeXBlTmFtZXMoKTtcbiAgICAgICAgdmFyIHRpdGxlID0gbmFtZXNbdHlwZV0gfHwgdHlwZTtcbiAgICAgICAgaWYgKHR5cGUgPT09ICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJykge1xuICAgICAgICAgICAgdGl0bGUgKz0gJyDCtyAnICsgdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VRdWFsaXR5U2NvcmUnLCB7IHNjb3JlOiA0OCB9KTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcGhvbmUgPSB3Lm1hc2sgPyAnKzcgOTY4ICoqKi0qKi00NCcgOiAnKzcgOTY4IDk2OC05NC00NCc7XG4gICAgICAgIHZhciBsaW5lcyA9IFtdO1xuICAgICAgICB2YXIgbm90ZXMgPSBbXTtcbiAgICAgICAgdmFyIGJ1dHRvbiA9IGZhbHNlO1xuICAgICAgICB2YXIgZGlyZWN0aW9uID0gdy5maWx0ZXJzLmRpcmVjdGlvbnMubGVuZ3RoID09PSAxID8gdy5maWx0ZXJzLmRpcmVjdGlvbnNbMF0gOiAnaW5jb21pbmcnO1xuICAgICAgICBzd2l0Y2ggKHR5cGUpIHtcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUubWlzc2VkX2NhbGwnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goJzxiPicgKyBlc2MocGhvbmUpICsgJzwvYj4g4oaSINCY0LLQsNC90L7QsiDQmC4gKDIzMyknKTtcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYygnMDIuMTAuMjAyNiAxNTo0MSDCtyAnICsgdCh7XG4gICAgICAgICAgICAgICAgICAgIGluY29taW5nOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZURpcmVjdGlvbkluY29taW5nJyxcbiAgICAgICAgICAgICAgICAgICAgb3V0Z29pbmc6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlRGlyZWN0aW9uT3V0Z29pbmcnLFxuICAgICAgICAgICAgICAgICAgICBpbnRlcm5hbDogJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VEaXJlY3Rpb25JbnRlcm5hbCdcbiAgICAgICAgICAgICAgICB9W2RpcmVjdGlvbl0pKSk7XG4gICAgICAgICAgICAgICAgYnV0dG9uID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUudm9pY2VtYWlsJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlVm9pY2VtYWlsSGludCcpKSk7XG4gICAgICAgICAgICAgICAgYnV0dG9uID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKCfQn9C10YLRgNC+0LLQsCDQkC4gKDI0MSkg4oaQICcgKyAody5tYXNrID8gJys3IDkxNiAqKiotKiotMTcnIDogJys3IDkxNiAyMDQtNTUtMTcnKSArICcgwrcgNjo0MicpKTtcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYyh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZVJlYXNvbnMnLCB7IHJlYXNvbnM6ICfQmtC70LjQtdC90YLRgyDQvdC1INC/0L7QvNC+0LPQu9C4OyDQv9C+0LLRgtC+0YDQvdGL0Lkg0LfQstC+0L3QvtC6JyB9KSkpO1xuICAgICAgICAgICAgICAgIG5vdGVzLnB1c2goJ9Ca0LvQuNC10L3RgtGDINC90LUg0L/QvtC80L7Qs9C70Lg6INC00LLQsNC20LTRiyDQvtGC0L/RgNCw0LLQuNC70Lgg0L3QsCDRgdCw0LnRgiwg0YDQtdGI0LXQvdC40Y8g0L3QtSDQv9GA0LXQtNC70L7QttC40LvQuC4nKTtcbiAgICAgICAgICAgICAgICBidXR0b24gPSB0cnVlO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAndm9pY2VfYWdlbnQuY2FsbGJhY2tfcmVxdWVzdCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2MoJ9Cf0ZHRgtGAIMK3ICcgKyBwaG9uZSkpO1xuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlVG9waWMnLCB7IHRvcGljOiAn0JLQvtC30LLRgNCw0YInIH0pKSk7XG4gICAgICAgICAgICAgICAgYnV0dG9uID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUucHJvdmlkZXJfZG93bic6XG4gICAgICAgICAgICBjYXNlICdjb3JlLnByb3ZpZGVyX3VwJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYygnU0lQIMKr0JzQtdCz0LDRhNC+0L3CuyDCtyAxMC4wLjAuMScpKTtcbiAgICAgICAgICAgICAgICBub3Rlcy5wdXNoKCdyZWdpc3RlcmVkIOKGkiB1bnJlZ2lzdGVyZWQnKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29mZmxpbmUnOlxuICAgICAgICAgICAgY2FzZSAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb25saW5lJzpcbiAgICAgICAgICAgIGNhc2UgJ2xvY2FsX3N0dC53b3JrZXJfb2ZmbGluZSc6XG4gICAgICAgICAgICBjYXNlICdsb2NhbF9zdHQud29ya2VyX29ubGluZSc6XG4gICAgICAgICAgICBjYXNlICdsb2NhbF9zdHQuYmFja2xvZ19ub193b3JrZXJzJzpcbiAgICAgICAgICAgIGNhc2UgJ2xvY2FsX3N0dC5iYWNrbG9nX3Jlc29sdmVkJzpcbiAgICAgICAgICAgIGNhc2UgJ2Nsb3VkX3N0dC5pbmNpZGVudCc6XG4gICAgICAgICAgICBjYXNlICdjbG91ZF9zdHQuaW5jaWRlbnRfcmVzb2x2ZWQnOlxuICAgICAgICAgICAgY2FzZSAnY2xvdWRfc3R0LnBhdXNlZCc6XG4gICAgICAgICAgICBjYXNlICdjbG91ZF9zdHQucmVzdW1lZCc6XG4gICAgICAgICAgICBjYXNlICdjbG91ZF9haS5wYXVzZWQnOlxuICAgICAgICAgICAgY2FzZSAnY2xvdWRfYWkucmVzdW1lZCc6XG4gICAgICAgICAgICAgICAgdmFyIHNhbXBsZSA9IFNUQVRVU19QUkVWSUVXX1NBTVBMRVNbdHlwZV07XG4gICAgICAgICAgICAgICAgdmFyIHNjZW5hcmlvU291cmNlID0gc291cmNlQnlJZCh3LnNvdXJjZUlkKTtcbiAgICAgICAgICAgICAgICBpZiAoc2NlbmFyaW9Tb3VyY2UgJiYgc2NlbmFyaW9Tb3VyY2UubW9kdWxlX25hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2Moc2NlbmFyaW9Tb3VyY2UubW9kdWxlX25hbWUpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2Moc3RhdHVzUGhyYXNlKHR5cGUsIHNhbXBsZSkpKTtcbiAgICAgICAgICAgICAgICBzdGF0dXNDb3VudGVyTm90ZXMoc2FtcGxlKS5mb3JFYWNoKGZ1bmN0aW9uIChub3RlKSB7IG5vdGVzLnB1c2gobm90ZSk7IH0pO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAndm9pY2VfYWdlbnQucnVudGltZV9kb3duJzpcbiAgICAgICAgICAgIGNhc2UgJ3ZvaWNlX2FnZW50LnJ1bnRpbWVfdXAnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goJ2Nvbm5lY3Rpb24gcmVmdXNlZCcpO1xuICAgICAgICAgICAgICAgIG5vdGVzLnB1c2godGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VMYXRlbmN5JywgeyBtczogMTIwMCB9KSk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdjb3JlLmFkdmljZSc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2MoJ9Ch0LLQvtCx0L7QtNC90L4gOCAlINC90LAg0YDQsNC30LTQtdC70LUgL3N0b3JhZ2UnKSk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdjb3JlLnBieF9zdGFydGVkJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKCcwMi4xMC4yMDI2IDAzOjEwJyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGlzTWF4ID0gd2l6YXJkSXNNYXgoKTtcbiAgICAgICAgdmFyIGh0bWwgPSAnPGRpdiBjbGFzcz1cIm1oLXByZXZpZXctbXNnJyArIChpc01heCA/ICcgaXMtbWF4JyA6ICcnKSArICdcIj48ZGl2PicgKyBlc2MoaWNvbkZvclR5cGUodHlwZSkpICsgJyA8Yj4nICsgZXNjKHRpdGxlKSArICc8L2I+PC9kaXY+JztcbiAgICAgICAgbGluZXMuZm9yRWFjaChmdW5jdGlvbiAobGluZSkgeyBodG1sICs9ICc8ZGl2PicgKyBsaW5lICsgJzwvZGl2Pic7IH0pO1xuICAgICAgICBub3Rlcy5mb3JFYWNoKGZ1bmN0aW9uIChub3RlKSB7IGh0bWwgKz0gJzxkaXY+PGk+JyArIGVzYyhub3RlKSArICc8L2k+PC9kaXY+JzsgfSk7XG4gICAgICAgIGh0bWwgKz0gJzxzcGFuIGNsYXNzPVwibWgtcHJldmlldy10aW1lXCI+MTU6NDE8L3NwYW4+PC9kaXY+JztcbiAgICAgICAgaHRtbCArPSB3aXphcmRQcmV2aWV3QXVkaW8odHlwZSwgdy5hdHRhY2htZW50cywgaXNNYXgpO1xuICAgICAgICBpZiAoYnV0dG9uKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwibWgtcHJldmlldy1idXR0b24nICsgKGlzTWF4ID8gJyBpcy1tYXgnIDogJycpICsgJ1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUHJldmlld0J1dHRvbicpKSArICcg4oaXPC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICAvLyB0aGUgbWVzc2VuZ2VyIGlzIHBhcnQgb2YgdGhlIHByZXZpZXcsIHNvIHRoZSBhc2lkZSBzYXlzIHdoaWNoIGJ1YmJsZSBpdCBzaG93c1xuICAgICAgICAvLyAodGhlIGRlc2lnbiBoYXMgbm8gdmlzaWJsZSBjYXB0aW9uIGFib3ZlIHRoZSBidWJibGUpXG4gICAgICAgICQoJy5taC13aXphcmQtcHJldmlldycpLmF0dHIoJ2FyaWEtbGFiZWwnLFxuICAgICAgICAgICAgdChpc01heCA/ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRQcmV2aWV3Q2hhbm5lbE1heCcgOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUHJldmlld1RpdGxlJykpO1xuICAgICAgICAvLyBzdGVwIDIgc2hvd3MgdGhlIGNvbmRpdGlvbnMgcHJldmlldywgc3RlcCAzIHRoZSBzYW1lIHByZXZpZXcgZm9yIHRoZSBjaG9zZW4gYm90XG4gICAgICAgICQoJyNtaC13aXphcmQtcHJldmlldywgI21oLXdpemFyZC1wcmV2aWV3LXRhcmdldCcpLmh0bWwoaHRtbCk7XG4gICAgfVxuXG4gICAgLy8gQXVkaW8gYnViYmxlcyBmb2xsb3cgdGhlIHRleHQgKFBsYW4vMDMpOiBmcmFnbWVudHMgPSBvbmUgYnViYmxlIHBlciBmcmFnbWVudCwgb3RoZXJ3aXNlIHRoZSB3aG9sZSBmaWxlLlxuICAgIC8vIFRoZSBudW1iZXJzIGFyZSBzYW1wbGUgdmFsdWVzIG9mIHRoZSBwcmV2aWV3LCBuZXZlciByZWFsIGRhdGEuXG4gICAgZnVuY3Rpb24gd2l6YXJkUHJldmlld0F1ZGlvKHR5cGUsIG1vZGUsIGlzTWF4KSB7XG4gICAgICAgIGlmIChtb2RlID09PSAnbm9uZScgfHwgd2l6YXJkQXR0YWNobWVudE1vZGVzKFt0eXBlXSkuaW5kZXhPZihtb2RlKSA8IDApIHsgcmV0dXJuICcnOyB9XG4gICAgICAgIHZhciBpdGVtcyA9IFtdO1xuICAgICAgICBpZiAobW9kZSA9PT0gJ2ZyYWdtZW50cycpIHtcbiAgICAgICAgICAgIHZhciBzYW1wbGUgPSBbJzA6MTInLCAnMDoxOCddO1xuICAgICAgICAgICAgc2FtcGxlLmZvckVhY2goZnVuY3Rpb24gKGR1cmF0aW9uLCBpbmRleCkge1xuICAgICAgICAgICAgICAgIGl0ZW1zLnB1c2godGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1ByZXZpZXdBdWRpb0ZyYWdtZW50JywgeyBuOiBpbmRleCArIDEsIHRvdGFsOiBzYW1wbGUubGVuZ3RoLCBkdXJhdGlvbjogZHVyYXRpb24gfSkpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpdGVtcy5wdXNoKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QcmV2aWV3QXVkaW9SZWNvcmRpbmcnLCB7IGR1cmF0aW9uOiB0eXBlID09PSAnY29yZS52b2ljZW1haWwnID8gJzA6MzInIDogJzY6NDInIH0pKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgaHRtbCA9ICcnO1xuICAgICAgICBpdGVtcy5mb3JFYWNoKGZ1bmN0aW9uIChjYXB0aW9uKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwibWgtcHJldmlldy1tc2cgbWgtcHJldmlldy1hdWRpbycgKyAoaXNNYXggPyAnIGlzLW1heCcgOiAnJykgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1wcmV2aWV3LWF1ZGlvLXJvd1wiPjxzcGFuIGNsYXNzPVwibWgtcHJldmlldy1wbGF5XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+PC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXByZXZpZXctd2F2ZVwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjwvc3Bhbj48L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLW1ldGFcIj4nICsgZXNjKGNhcHRpb24pICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXByZXZpZXctdGltZVwiPjE1OjQxPC9zcGFuPjwvZGl2Pic7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gaHRtbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBpY29uRm9yVHlwZSh0eXBlKSB7XG4gICAgICAgIGlmICh0eXBlID09PSAnY29yZS5taXNzZWRfY2FsbCcgfHwgdHlwZSA9PT0gJ3ZvaWNlX2FnZW50LmNhbGxiYWNrX3JlcXVlc3QnKSB7IHJldHVybiAn8J+Tnic7IH1cbiAgICAgICAgaWYgKHR5cGUgPT09ICdjb3JlLnZvaWNlbWFpbCcpIHsgcmV0dXJuICfwn46ZJzsgfVxuICAgICAgICBpZiAodHlwZSA9PT0gJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnIHx8IHR5cGUgPT09ICdjb3JlLnByb3ZpZGVyX2Rvd24nIHx8IHR5cGUgPT09ICd2b2ljZV9hZ2VudC5ydW50aW1lX2Rvd24nKSB7IHJldHVybiAn4pqg77iPJzsgfVxuICAgICAgICBpZiAoU1RBVFVTX1JFQ09WRVJZX0tFWVNbdHlwZV0gfHwgdHlwZSA9PT0gJ2NvcmUucHJvdmlkZXJfdXAnIHx8IHR5cGUgPT09ICd2b2ljZV9hZ2VudC5ydW50aW1lX3VwJykgeyByZXR1cm4gJ+KchSc7IH1cbiAgICAgICAgaWYgKHR5cGUgPT09ICdhaV9zdXBlcnZpc29yLndvcmtlcl9vZmZsaW5lJyB8fCB0eXBlID09PSAnbG9jYWxfc3R0Lndvcmtlcl9vZmZsaW5lJykgeyByZXR1cm4gJ/CflIwnOyB9XG4gICAgICAgIGlmICh0eXBlID09PSAnY29yZS5wYnhfc3RhcnRlZCcpIHsgcmV0dXJuICfwn5SEJzsgfVxuICAgICAgICByZXR1cm4gJ+KaoO+4jyc7XG4gICAgfVxuXG4gICAgLy8gLS0tLSBuYXZpZ2F0aW9uIGFuZCBzYXZlIC0tLS1cblxuICAgIGZ1bmN0aW9uIHdpemFyZE5leHQoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICBpZiAody5zdGVwID09PSAxKSB7XG4gICAgICAgICAgICBpZiAoIXcuc291cmNlSWQpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB3LnN0ZXAgPSBmaXJzdFN0ZXBBZnRlclNjZW5hcmlvKHcuZXZlbnRUeXBlcyk7XG4gICAgICAgICAgICByZW5kZXJXaXphcmQoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAody5zdGVwID09PSAyKSB7XG4gICAgICAgICAgICB3LnN0ZXAgPSAzO1xuICAgICAgICAgICAgcmVuZGVyV2l6YXJkKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgc2F2ZVJ1bGUoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRQcmV2KCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgaWYgKCQoJyNtaC13aXphcmQtcHJldicpLmRhdGEoJ21vZGUnKSAhPT0gJ2JhY2snKSB7XG4gICAgICAgICAgICBjbG9zZVJ1bGVXaXphcmQoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAody5zdGVwID09PSAzICYmIHdpemFyZEhhc0NvbmRpdGlvbnMody5ldmVudFR5cGVzKSkge1xuICAgICAgICAgICAgdy5zdGVwID0gMjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHcuc3RlcCA9IDE7XG4gICAgICAgIH1cbiAgICAgICAgY2xlYXJXaXphcmRFcnJvcigpO1xuICAgICAgICByZW5kZXJXaXphcmQoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBwcnVuZUZpbHRlcnMoZmlsdGVycykge1xuICAgICAgICB2YXIgcmVzdWx0ID0ge307XG4gICAgICAgIGlmIChmaWx0ZXJzLnVzZXJfaWRzLmxlbmd0aCA+IDApIHsgcmVzdWx0LnVzZXJfaWRzID0gZmlsdGVycy51c2VyX2lkczsgfVxuICAgICAgICBpZiAoZmlsdGVycy5kaXJlY3Rpb25zLmxlbmd0aCA+IDApIHsgcmVzdWx0LmRpcmVjdGlvbnMgPSBmaWx0ZXJzLmRpcmVjdGlvbnM7IH1cbiAgICAgICAgaWYgKGZpbHRlcnMucHJvdmlkZXJzLmxlbmd0aCA+IDApIHsgcmVzdWx0LnByb3ZpZGVycyA9IGZpbHRlcnMucHJvdmlkZXJzOyB9XG4gICAgICAgIGlmIChmaWx0ZXJzLnF1YWxpdHlfc2NvcmUgIT09IG51bGwgJiYgT2JqZWN0LmtleXMoZmlsdGVycy5xdWFsaXR5X3Njb3JlKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICByZXN1bHQucXVhbGl0eV9zY29yZSA9IGZpbHRlcnMucXVhbGl0eV9zY29yZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVSdWxlKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgdmFyIHNjZW5hcmlvID0gd2l6YXJkU2NlbmFyaW8oKTtcbiAgICAgICAgLy8gdGhlIHdpemFyZCBoYXMgbm8gbmFtZSBmaWVsZCAoZGVzaWduIHYzKTogYSBuZXcgbm90aWZpY2F0aW9uIGlzIG5hbWVkIGFmdGVyIGl0cyBzY2VuYXJpb1xuICAgICAgICB2YXIgdGl0bGUgPSBTdHJpbmcody50aXRsZSB8fCAnJykudHJpbSgpIHx8IChzY2VuYXJpbyA/IHNjZW5hcmlvLm5hbWUgOiAnJyk7XG4gICAgICAgIGlmICh0aXRsZSA9PT0gJycpIHtcbiAgICAgICAgICAgIHNob3dXaXphcmRFcnJvcih0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRUaXRsZVJlcXVpcmVkJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3LnRhcmdldE1vZGUgIT09ICdlbXBsb3llZScgJiYgdy5jaGF0SWRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgc2hvd1dpemFyZEVycm9yKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZE5lZWRDaGF0cycpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB2YXIgb3B0aW9ucyA9IHsgbWFza19waG9uZTogdy5tYXNrIH07XG4gICAgICAgIGlmICh3LmV2ZW50VHlwZXMuaW5kZXhPZignY29yZS5taXNzZWRfY2FsbCcpID49IDApIHtcbiAgICAgICAgICAgIG9wdGlvbnMucmV0cmFjdF9vbl9jYWxsYmFjayA9IHtcbiAgICAgICAgICAgICAgICBlbmFibGVkOiB3LnJldHJhY3QuZW5hYmxlZCA9PT0gdHJ1ZSxcbiAgICAgICAgICAgICAgICB3aW5kb3dfbWluOiB3LnJldHJhY3Qud2luZG93X21pbiA+PSA1ICYmIHcucmV0cmFjdC53aW5kb3dfbWluIDw9IDEyMCA/IHcucmV0cmFjdC53aW5kb3dfbWluIDogMjAsXG4gICAgICAgICAgICAgICAgY291bnRfaW5jb21pbmdfYW5zd2VyZWQ6IHcucmV0cmFjdC5jb3VudF9pbmNvbWluZ19hbnN3ZXJlZCAhPT0gZmFsc2VcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHdpemFyZEF0dGFjaG1lbnRNb2Rlcyh3LmV2ZW50VHlwZXMpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIG9wdGlvbnMuYXR0YWNobWVudHMgPSB3LmF0dGFjaG1lbnRzO1xuICAgICAgICB9XG4gICAgICAgIHZhciBwYXlsb2FkID0ge1xuICAgICAgICAgICAgdGl0bGU6IHRpdGxlLFxuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGV2ZW50X3R5cGVzOiB3LmV2ZW50VHlwZXMsXG4gICAgICAgICAgICBtaW5fc2V2ZXJpdHk6ICdpbmZvJyxcbiAgICAgICAgICAgIGZpbHRlcnM6IHBydW5lRmlsdGVycyh3LmZpbHRlcnMpLFxuICAgICAgICAgICAgdGFyZ2V0X21vZGU6IHcudGFyZ2V0TW9kZSxcbiAgICAgICAgICAgIGNoYXRfaWRzOiB3LmNoYXRJZHMsXG4gICAgICAgICAgICBvcHRpb25zOiBvcHRpb25zXG4gICAgICAgIH07XG4gICAgICAgIHZhciBkb25lID0gZnVuY3Rpb24gKHJ1bGUpIHtcbiAgICAgICAgICAgIGNsb3NlUnVsZVdpemFyZCgpO1xuICAgICAgICAgICAgcmVwbGFjZVJ1bGUocnVsZSk7XG4gICAgICAgICAgICBsb2FkUnVsZXModHJ1ZSk7XG4gICAgICAgICAgICBzaG93VG9hc3QodCh3LmVkaXRJZCA+IDAgPyAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkU2F2ZWQnIDogJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZENyZWF0ZWQnKSk7XG4gICAgICAgIH07XG4gICAgICAgIHZhciBmYWlsdXJlID0gZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgc2hvd1dpemFyZEVycm9yKGZhaWx1cmVUZXh0KGVycikpO1xuICAgICAgICB9O1xuICAgICAgICBpZiAody5lZGl0SWQgPiAwKSB7XG4gICAgICAgICAgICBhcGlQYXRjaCgnL3J1bGVzLycgKyB3LmVkaXRJZCwgcGF5bG9hZCwgZG9uZSwgZmFpbHVyZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBhcGlQb3N0KCcvcnVsZXMnLCBwYXlsb2FkLCBkb25lLCBmYWlsdXJlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNob3dXaXphcmRFcnJvcih0ZXh0KSB7XG4gICAgICAgICQoJyNtaC13aXphcmQgLm1oLXdpemFyZC1lcnJvci1zbG90JykuaHRtbCgnPGRpdiBjbGFzcz1cInVpIG5lZ2F0aXZlIG1lc3NhZ2VcIiByb2xlPVwiYWxlcnRcIj4nICsgSUNPTl9FUlJPUlxuICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLWdyb3dcIj4nICsgZXNjKHRleHQpICsgJzwvZGl2PjwvZGl2PicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNsZWFyV2l6YXJkRXJyb3IoKSB7XG4gICAgICAgICQoJyNtaC13aXphcmQgLm1oLXdpemFyZC1lcnJvci1zbG90JykuZW1wdHkoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBiaW5kV2l6YXJkQ29udHJvbHMoKSB7XG4gICAgICAgICQoJyNtaC1ydWxlLWFkZCcpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHsgb3BlblJ1bGVXaXphcmQobnVsbCk7IH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLWJhY2snKS5vbignY2xpY2snLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBjbG9zZVJ1bGVXaXphcmQoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtbmV4dCcpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICgkKHRoaXMpLnByb3AoJ2Rpc2FibGVkJykpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICBjbGVhcldpemFyZEVycm9yKCk7XG4gICAgICAgICAgICB3aXphcmROZXh0KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXByZXYnKS5vbignY2xpY2snLCB3aXphcmRQcmV2KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1vcGVuLXNldHRpbmdzJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgY2xvc2VSdWxlV2l6YXJkKCk7XG4gICAgICAgICAgICAkKCcjbWgtdGFicyAuaXRlbVtkYXRhLXRhYj1cInNldHRpbmdzXCJdJykudHJpZ2dlcignY2xpY2snKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtc2NlbmFyaW9zJykub24oJ2NsaWNrJywgJy5taC1zY2VuYXJpbycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBzb3VyY2UgPSBzb3VyY2VCeUlkKCQodGhpcykuZGF0YSgnc291cmNlLWlkJykpO1xuICAgICAgICAgICAgaWYgKCFzb3VyY2UgfHwgJCh0aGlzKS5oYXNDbGFzcygnaXMtZGlzYWJsZWQnKSkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgICAgIGlmICh3LnNvdXJjZUlkICE9PSBzb3VyY2UuaWQpIHtcbiAgICAgICAgICAgICAgICB3LnNvdXJjZUlkID0gc291cmNlLmlkO1xuICAgICAgICAgICAgICAgIHcuZXZlbnRUeXBlcyA9IChzb3VyY2UuZXZlbnRfdHlwZXMgfHwgW10pLm1hcChmdW5jdGlvbiAodHlwZSkgeyByZXR1cm4gdHlwZS50eXBlOyB9KTtcbiAgICAgICAgICAgICAgICBpZiAody5lZGl0SWQgPT09IDApIHsgdy50aXRsZSA9IHNvdXJjZS5uYW1lOyB9XG4gICAgICAgICAgICAgICAgdy5maWx0ZXJzID0gZW1wdHlGaWx0ZXJzKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZW5kZXJXaXphcmRTY2VuYXJpb3MoKTtcbiAgICAgICAgICAgIHVwZGF0ZVdpemFyZE5leHQoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtc2NlbmFyaW9zJykub24oJ2RibGNsaWNrJywgJy5taC1zY2VuYXJpbzpub3QoLmlzLWRpc2FibGVkKScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHdpemFyZE5leHQoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSB0YWJzICYgYXV0b3JlZnJlc2ggLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gaW5pdFRhYnMoKSB7XG4gICAgICAgICQoJyNtaC10YWJzIC5pdGVtJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHRhYiA9ICQodGhpcykuZGF0YSgndGFiJyk7XG4gICAgICAgICAgICAkKCcjbWgtdGFicyAuaXRlbScpLnJlbW92ZUNsYXNzKCdhY3RpdmUnKTtcbiAgICAgICAgICAgICQodGhpcykuYWRkQ2xhc3MoJ2FjdGl2ZScpO1xuICAgICAgICAgICAgJCgnI21lc3Nlbmdlci1odWItcm9vdCAubWgtdGFiLXBhbmUnKS5yZW1vdmVDbGFzcygnYWN0aXZlJyk7XG4gICAgICAgICAgICAkKCcjbWVzc2VuZ2VyLWh1Yi1yb290IC5taC10YWItcGFuZVtkYXRhLXRhYj1cIicgKyB0YWIgKyAnXCJdJykuYWRkQ2xhc3MoJ2FjdGl2ZScpO1xuICAgICAgICAgICAgJCgnI21lc3Nlbmdlci1odWItcm9vdCcpLmF0dHIoJ2RhdGEtYWN0aXZlLXRhYicsIHRhYik7XG4gICAgICAgICAgICBpZiAodGFiID09PSAnbm90aWZpY2F0aW9ucycpIHtcbiAgICAgICAgICAgICAgICBsb2FkUnVsZXModHJ1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodGFiID09PSAnc2V0dGluZ3MnKSB7XG4gICAgICAgICAgICAgICAgbG9hZEdlbmVyYWxTZXR0aW5ncygpO1xuICAgICAgICAgICAgICAgIGxvYWRFbXBsb3llZXMoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICBsb2FkQm90cygpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBqb3VybmFsVmlzaWJsZSgpIHtcbiAgICAgICAgcmV0dXJuICQoJyNtZXNzZW5nZXItaHViLXJvb3QgLm1oLXRhYi1wYW5lW2RhdGEtdGFiPVwiam91cm5hbFwiXScpLmhhc0NsYXNzKCdhY3RpdmUnKVxuICAgICAgICAgICAgJiYgZG9jdW1lbnQudmlzaWJpbGl0eVN0YXRlID09PSAndmlzaWJsZSc7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbm90aWZpY2F0aW9uc1Zpc2libGUoKSB7XG4gICAgICAgIHJldHVybiAkKCcjbWVzc2VuZ2VyLWh1Yi1yb290IC5taC10YWItcGFuZVtkYXRhLXRhYj1cIm5vdGlmaWNhdGlvbnNcIl0nKS5oYXNDbGFzcygnYWN0aXZlJylcbiAgICAgICAgICAgICYmIGRvY3VtZW50LnZpc2liaWxpdHlTdGF0ZSA9PT0gJ3Zpc2libGUnO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNjaGVkdWxlUmVmcmVzaCgpIHtcbiAgICAgICAgc2V0SW50ZXJ2YWwoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKGpvdXJuYWxWaXNpYmxlKCkpIHtcbiAgICAgICAgICAgICAgICBsb2FkKHsgcmVmcmVzaDogdHJ1ZSB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobm90aWZpY2F0aW9uc1Zpc2libGUoKSAmJiBzdGF0ZS5ydWxlV2l6YXJkID09PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgbG9hZFJ1bGVzKHRydWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGRvY3VtZW50LnZpc2liaWxpdHlTdGF0ZSA9PT0gJ3Zpc2libGUnKSB7XG4gICAgICAgICAgICAgICAgbG9hZEpvdXJuYWxCYWRnZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LCBSRUZSRVNIX1NFQyAqIDEwMDApO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gaW5pdCAtLS0tLS0tLS0tXG5cbiAgICAkKGRvY3VtZW50KS5yZWFkeShmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJvb3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbWVzc2VuZ2VyLWh1Yi1yb290Jyk7XG4gICAgICAgIGlmICghcm9vdCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGluaXRUYWJzKCk7XG4gICAgICAgIGJ1aWxkUGVyaW9kTWVudSgpO1xuICAgICAgICByZW5kZXJTa2VsZXRvbigpO1xuXG4gICAgICAgIC8vIG91ciBjaGVja2JveGVzIGFyZSBwbGFpbiBsYWJlbHMgYXJvdW5kIGhpZGRlbiBpbnB1dHM6IGtlZXAgdGhlIHZpc3VhbCBzdGF0ZSBpbiBzeW5jXG4gICAgICAgICQoZG9jdW1lbnQpLm9uKCdjaGFuZ2UnLCAnLm1vZHVsZS1tZXNzZW5nZXItaHViIC51aS5jaGVja2JveCBpbnB1dCwgLm1oLW1vZGFsIC51aS5jaGVja2JveCBpbnB1dCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciAkaW5wdXQgPSAkKHRoaXMpO1xuICAgICAgICAgICAgaWYgKCRpbnB1dC5hdHRyKCd0eXBlJykgPT09ICdyYWRpbycpIHtcbiAgICAgICAgICAgICAgICAkKCdpbnB1dFtuYW1lPVwiJyArICRpbnB1dC5hdHRyKCduYW1lJykgKyAnXCJdJykuZWFjaChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgICQodGhpcykuY2xvc2VzdCgnLnVpLmNoZWNrYm94JykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCB0aGlzLmNoZWNrZWQpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAkaW5wdXQuY2xvc2VzdCgnLnVpLmNoZWNrYm94JykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCB0aGlzLmNoZWNrZWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAkKCcjbWgtam91cm5hbC1yZXNldC1maWx0ZXJzJykub24oJ2NsaWNrJywgcmVzZXRGaWx0ZXJzKTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtcHJvYmVzIGlucHV0Jykub24oJ2NoYW5nZScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLnNob3dQcm9iZXMgPSAkKHRoaXMpLnByb3AoJ2NoZWNrZWQnKTtcbiAgICAgICAgICAgIHJlbmRlckpvdXJuYWwoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLWJhbm5lcicpLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJiYW5uZXItZml4XCJdJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGJvdCA9IGJvdEJ5SWQoJCh0aGlzKS5kYXRhKCdib3QtaWQnKSk7XG4gICAgICAgICAgICBpZiAoYm90KSB7XG4gICAgICAgICAgICAgICAgb3BlbkJvdE1vZGFsKCdlZGl0JywgYm90KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgb3BlbkJvdE1vZGFsKCdhZGQnLCBudWxsLCAndGVsZWdyYW0nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXJldHJ5Jykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkgeyBsb2FkKCk7IH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1wcmV2Jykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHN0YXRlLm9mZnNldCA+PSBQQUdFX0xJTUlUKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUub2Zmc2V0IC09IFBBR0VfTElNSVQ7XG4gICAgICAgICAgICAgICAgbG9hZCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtbmV4dCcpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5vZmZzZXQgKyBzdGF0ZS5sYXN0SXRlbXMubGVuZ3RoIDwgc3RhdGUudG90YWwpIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5vZmZzZXQgKz0gUEFHRV9MSU1JVDtcbiAgICAgICAgICAgICAgICBsb2FkKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtcmV0ZW50aW9uLWlucHV0Jykub24oJ2NoYW5nZScsIHNhdmVSZXRlbnRpb24pO1xuICAgICAgICAkKCcjbWgtcHVibGljLXVybC1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBzYXZlUHVibGljVXJsKTtcbiAgICAgICAgJCgnI21oLXByb3h5LWlucHV0Jykub24oJ2NoYW5nZScsIHNhdmVQcm94eSk7XG4gICAgICAgICQoJyNtaC1tYXgtY2EtaW5wdXQnKS5vbignY2hhbmdlJywgc2F2ZU1heENhQnVuZGxlKTtcbiAgICAgICAgJCgnI21oLW1hc2stZGVmYXVsdCBpbnB1dCcpLm9uKCdjaGFuZ2UnLCBzYXZlTWFza0RlZmF1bHQpO1xuXG4gICAgICAgIGJpbmRCb3RzQ29udGFpbmVyKCk7XG4gICAgICAgIGJpbmRDaGF0Rm91bmQoKTtcbiAgICAgICAgYmluZFJ1bGVzQ29udGFpbmVyKCk7XG4gICAgICAgIGJpbmRXaXphcmRDb250cm9scygpO1xuICAgICAgICAkKCcjbWgtYm90LWFkZCcpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHsgb3BlbkJvdE1vZGFsKCdhZGQnLCBudWxsLCAndGVsZWdyYW0nKTsgfSk7XG4gICAgICAgICQoJyNtaC1ib3QtY2hlY2ssICNtaC1ib3QtY2hlY2stc3RvcmVkLCAjbWgtYm90LWNoZWNrLW5ldycpLm9uKCdjbGljaycsIGNoZWNrQm90Rm9ybSk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4tcmVwbGFjZScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4tbmV3LXJvdycpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1uZXcnKS50cmlnZ2VyKCdmb2N1cycpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbi1jYW5jZWwnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRva2VuLW5ldycpLnZhbCgnJyk7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRva2VuLW5ldy1yb3cnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1ib3Qtc2F2ZScpLm9uKCdjbGljaycsIHNhdmVCb3RGb3JtKTtcbiAgICAgICAgJCgnI21oLWJvdC1tb2RhbCcpLm9uKCdjbGljaycsICcubWgtY2hhbm5lbC1jYXJkJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgaWYgKCFzdGF0ZS5ib3RNb2RhbCB8fCAkKHRoaXMpLmhhc0NsYXNzKCdpcy1kaXNhYmxlZCcpKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgc3RhdGUuYm90TW9kYWwuY2hhbm5lbCA9IFN0cmluZygkKHRoaXMpLmRhdGEoJ2NoYW5uZWwnKSk7XG4gICAgICAgICAgICAkKCcjbWgtYm90LWNoZWNrLW1lc3NhZ2UnKS5lbXB0eSgpO1xuICAgICAgICAgICAgc3luY0JvdENoYW5uZWwoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1ib3QtZGVsZXRlJykub24oJ2NsaWNrJywgY29uZmlybURlbGV0ZUJvdCk7XG4gICAgICAgICQoJyNtaC1ib3QtbW9kYWwgW2RhdGEtYWN0aW9uPVwiY2FuY2VsXCJdJykub24oJ2NsaWNrJywgY2FuY2VsQm90TW9kYWwpO1xuICAgICAgICAkKCcjbWgtY2hhdC1zdG9wJykub24oJ2NsaWNrJywgc3RvcERpc2NvdmVyeUFuZENsb3NlKTtcbiAgICAgICAgJCgnI21oLWNoYXQtYWdhaW4nKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoc3RhdGUuY2hhdE1vZGFsKSB7XG4gICAgICAgICAgICAgICAgc3RhcnREaXNjb3Zlcnkoc3RhdGUuY2hhdE1vZGFsLmJvdElkLCB0cnVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1jaGF0LXNhdmUnKS5vbignY2xpY2snLCBzYXZlU2VsZWN0ZWRDaGF0cyk7XG4gICAgICAgICQoJyNtaC1jaGF0LW1vZGFsIFtkYXRhLWFjdGlvbj1cImNhbmNlbFwiXScpLm9uKCdjbGljaycsIHN0b3BEaXNjb3ZlcnlBbmRDbG9zZSk7XG4gICAgICAgICQoJyNtaC10ZXN0LW1vZGFsIFtkYXRhLWFjdGlvbj1cImNhbmNlbFwiXScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0b3BUZXN0UG9sbCgpO1xuICAgICAgICAgICAgJCgnI21oLXRlc3QtbW9kYWwnKS5tb2RhbCgnaGlkZScpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLWNvbmZpcm0tbW9kYWwgW2RhdGEtYWN0aW9uPVwiY2FuY2VsXCJdJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLWNvbmZpcm0tbW9kYWwnKS5tb2RhbCgnaGlkZScpO1xuICAgICAgICB9KTtcblxuICAgICAgICBsb2FkQ2F0YWxvZyhmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBidWlsZFR5cGVNZW51KCk7XG4gICAgICAgICAgICBsb2FkRW1wbG95ZWVzKGZ1bmN0aW9uICgpIHt9KTtcbiAgICAgICAgICAgIGxvYWRQcm92aWRlcnMoZnVuY3Rpb24gKCkge30pO1xuICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICBsb2FkUnVsZXMoKTtcbiAgICAgICAgICAgIGxvYWQoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHNjaGVkdWxlUmVmcmVzaCgpO1xuICAgIH0pO1xufSgpKTtcbiJdLCJtYXBwaW5ncyI6IjtBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0MsYUFBWTtFQUNULFlBQVk7O0VBRVosSUFBSSxRQUFRLEdBQUcsc0NBQXNDO0VBQ3JELElBQUksVUFBVSxHQUFHLEVBQUU7RUFDbkIsSUFBSSxXQUFXLEdBQUcsRUFBRTtFQUNwQixJQUFJLFdBQVcsR0FBRyxDQUFDLE9BQU8sRUFBRSxlQUFlLEVBQUUsV0FBVyxFQUFFLGFBQWEsRUFBRSxLQUFLLENBQUM7RUFFL0UsSUFBSSxVQUFVLEdBQUcsK0hBQStIO0VBQ2hKLElBQUksWUFBWSxHQUFHLGlHQUFpRztFQUNwSCxJQUFJLFNBQVMsR0FBRywyRkFBMkY7RUFFM0csSUFBSSxJQUFJLEdBQUcsSUFBSTtFQUNmLElBQUksS0FBSyxHQUFHO0lBQ1IsT0FBTyxFQUFFLEVBQUU7SUFDWCxNQUFNLEVBQUUsT0FBTztJQUNmLFNBQVMsRUFBRSxFQUFFO0lBQ2IsTUFBTSxFQUFFLENBQUM7SUFDVCxLQUFLLEVBQUUsQ0FBQztJQUNSLFNBQVMsRUFBRSxLQUFLO0lBQ2hCLFNBQVMsRUFBRSxFQUFFO0lBQ2IsU0FBUyxFQUFFLENBQUMsQ0FBQztJQUNiLFVBQVUsRUFBRSxJQUFJO0lBQ2hCLE9BQU8sRUFBRSxDQUFDO0lBQ1YsU0FBUyxFQUFFLEVBQUU7SUFDYixRQUFRLEVBQUUsSUFBSTtJQUNkLElBQUksRUFBRSxFQUFFO0lBQ1IsVUFBVSxFQUFFLEtBQUs7SUFDakIsU0FBUyxFQUFFLElBQUk7SUFDZixZQUFZLEVBQUUsQ0FBQyxDQUFDO0lBQ2hCLFNBQVMsRUFBRSxFQUFFO0lBQ2IsZUFBZSxFQUFFLEtBQUs7SUFDdEIsZUFBZSxFQUFFLEtBQUs7SUFDdEIsVUFBVSxFQUFFLEtBQUs7SUFDakIsUUFBUSxFQUFFLElBQUk7SUFDZCxTQUFTLEVBQUUsSUFBSTtJQUNmLFNBQVMsRUFBRSxJQUFJO0lBQ2YsS0FBSyxFQUFFLEVBQUU7SUFDVCxXQUFXLEVBQUUsS0FBSztJQUNsQixVQUFVLEVBQUUsSUFBSTtJQUNoQixTQUFTLEVBQUUsRUFBRTtJQUNiLGVBQWUsRUFBRSxLQUFLO0lBQ3RCLFVBQVUsRUFBRTtFQUNoQixDQUFDOztFQUVEOztFQUVBLFNBQVMsQ0FBQyxDQUFDLEdBQUcsRUFBRTtJQUNaLElBQUksT0FBTyxlQUFlLEtBQUssV0FBVyxJQUFJLGVBQWUsQ0FBQyxHQUFHLENBQUMsRUFBRTtNQUNoRSxPQUFPLGVBQWUsQ0FBQyxHQUFHLENBQUM7SUFDL0I7SUFDQSxPQUFPLEdBQUc7RUFDZDtFQUVBLFNBQVMsRUFBRSxDQUFDLEdBQUcsRUFBRSxNQUFNLEVBQUU7SUFDckIsSUFBSSxJQUFJLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQztJQUNqQixNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxVQUFVLElBQUksRUFBRTtNQUM5QyxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEdBQUcsSUFBSSxHQUFHLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDbEUsQ0FBQyxDQUFDO0lBQ0YsT0FBTyxJQUFJO0VBQ2Y7O0VBRUE7O0VBRUEsU0FBUyxHQUFHLENBQUMsS0FBSyxFQUFFO0lBQ2hCLE9BQU8sS0FBSyxHQUFHLEVBQUUsR0FBRyxHQUFHLEdBQUcsS0FBSyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUM7RUFDbkQ7RUFFQSxTQUFTLE9BQU8sQ0FBQyxFQUFFLEVBQUU7SUFDakIsSUFBSSxDQUFDLEdBQUcsSUFBSSxJQUFJLENBQUMsRUFBRSxHQUFHLElBQUksQ0FBQztJQUMzQixPQUFPLEdBQUcsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7RUFDeEQ7RUFFQSxTQUFTLE9BQU8sQ0FBQyxFQUFFLEVBQUU7SUFDakIsSUFBSSxDQUFDLEdBQUcsSUFBSSxJQUFJLENBQUMsRUFBRSxHQUFHLElBQUksQ0FBQztJQUMzQixPQUFPLEdBQUcsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQztFQUNqRjtFQUVBLFNBQVMsV0FBVyxDQUFDLEVBQUUsRUFBRTtJQUNyQixPQUFPLE9BQU8sQ0FBQyxFQUFFLENBQUMsR0FBRyxHQUFHLEdBQUcsT0FBTyxDQUFDLEVBQUUsQ0FBQztFQUMxQztFQUVBLFNBQVMsT0FBTyxDQUFDLEVBQUUsRUFBRTtJQUNqQixJQUFJLENBQUMsR0FBRyxJQUFJLElBQUksQ0FBQyxFQUFFLEdBQUcsSUFBSSxDQUFDO0lBQzNCLElBQUksR0FBRyxHQUFHLElBQUksSUFBSSxDQUFDLENBQUM7SUFDcEIsT0FBTyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsS0FBSyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUM7RUFDbEQ7RUFFQSxTQUFTLFdBQVcsQ0FBQyxFQUFFLEVBQUU7SUFDckIsSUFBSSxDQUFDLEdBQUcsSUFBSSxJQUFJLENBQUMsRUFBRSxHQUFHLElBQUksQ0FBQztJQUMzQixJQUFJLFNBQVMsR0FBRyxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxRQUFRLENBQUM7SUFDL0MsT0FBTyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsS0FBSyxTQUFTLENBQUMsWUFBWSxDQUFDLENBQUM7RUFDeEQ7O0VBRUE7RUFDQSxTQUFTLFdBQVcsQ0FBQyxFQUFFLEVBQUU7SUFDckIsSUFBSSxPQUFPLENBQUMsRUFBRSxDQUFDLEVBQUU7TUFDYixPQUFPLE9BQU8sQ0FBQyxFQUFFLENBQUM7SUFDdEI7SUFDQSxJQUFJLENBQUMsR0FBRyxJQUFJLElBQUksQ0FBQyxFQUFFLEdBQUcsSUFBSSxDQUFDO0lBQzNCLElBQUksR0FBRyxHQUFHLFdBQVcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsb0NBQW9DLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNwSCxPQUFPLHlCQUF5QixHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsR0FBRyxVQUFVLEdBQUcsT0FBTyxDQUFDLEVBQUUsQ0FBQztFQUMxRTtFQUVBLFNBQVMsR0FBRyxDQUFDLEtBQUssRUFBRTtJQUNoQixPQUFPLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssS0FBSyxJQUFJLElBQUksS0FBSyxLQUFLLFNBQVMsR0FBRyxFQUFFLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztFQUM5RjtFQUVBLFNBQVMsWUFBWSxHQUFHO0lBQ3BCLElBQUksQ0FBQyxHQUFHLElBQUksSUFBSSxDQUFDLENBQUM7SUFDbEIsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDdEIsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQztFQUN6QztFQUVBLFNBQVMsWUFBWSxHQUFHO0lBQ3BCLElBQUksR0FBRyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDO0lBQ3ZDLElBQUksVUFBVSxHQUFHLFlBQVksQ0FBQyxDQUFDO0lBQy9CLFFBQVEsS0FBSyxDQUFDLE1BQU07TUFDaEIsS0FBSyxPQUFPO1FBQUUsT0FBTztVQUFFLElBQUksRUFBRSxVQUFVO1VBQUUsRUFBRSxFQUFFO1FBQUksQ0FBQztNQUNsRCxLQUFLLFdBQVc7UUFBRSxPQUFPO1VBQUUsSUFBSSxFQUFFLFVBQVUsR0FBRyxLQUFLO1VBQUUsRUFBRSxFQUFFLFVBQVUsR0FBRztRQUFFLENBQUM7TUFDekUsS0FBSyxPQUFPO1FBQUUsT0FBTztVQUFFLElBQUksRUFBRSxVQUFVLEdBQUcsQ0FBQyxHQUFHLEtBQUs7VUFBRSxFQUFFLEVBQUU7UUFBSSxDQUFDO01BQzlELEtBQUssUUFBUTtRQUFFLE9BQU87VUFBRSxJQUFJLEVBQUUsVUFBVSxHQUFHLEVBQUUsR0FBRyxLQUFLO1VBQUUsRUFBRSxFQUFFO1FBQUksQ0FBQztNQUNoRTtRQUFTLE9BQU87VUFBRSxJQUFJLEVBQUUsQ0FBQztVQUFFLEVBQUUsRUFBRTtRQUFFLENBQUM7SUFDdEM7RUFDSjs7RUFFQTs7RUFFQSxTQUFTLE1BQU0sQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUU7SUFDaEQsQ0FBQyxDQUFDLElBQUksQ0FBQztNQUNILEdBQUcsRUFBRSxNQUFNLENBQUMsTUFBTSxHQUFHLFFBQVEsR0FBRyxJQUFJO01BQ3BDLE1BQU0sRUFBRSxLQUFLO01BQ2IsSUFBSSxFQUFFLE1BQU0sSUFBSSxDQUFDLENBQUM7TUFDbEIsS0FBSyxFQUFFO0lBQ1gsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsUUFBUSxFQUFFO01BQ3hCLElBQUksUUFBUSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssSUFBSSxFQUFFO1FBQ3RDLFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDO01BQzVCLENBQUMsTUFBTTtRQUNILFNBQVMsQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQUM7TUFDOUM7SUFDSixDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxHQUFHLEVBQUU7TUFDbkIsU0FBUyxDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDakQsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLFFBQVEsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUU7SUFDbkQsQ0FBQyxDQUFDLElBQUksQ0FBQztNQUNILEdBQUcsRUFBRSxNQUFNLENBQUMsTUFBTSxHQUFHLFFBQVEsR0FBRyxJQUFJO01BQ3BDLE1BQU0sRUFBRSxPQUFPO01BQ2YsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDO01BQzdCLFdBQVcsRUFBRSxrQkFBa0I7TUFDL0IsUUFBUSxFQUFFO0lBQ2QsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsUUFBUSxFQUFFO01BQ3hCLElBQUksUUFBUSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssSUFBSSxFQUFFO1FBQ3RDLFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDO01BQzVCLENBQUMsTUFBTTtRQUNILFNBQVMsQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQUM7TUFDOUM7SUFDSixDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxHQUFHLEVBQUU7TUFDbkIsU0FBUyxDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDakQsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLGdCQUFnQixDQUFDLFFBQVEsRUFBRSxNQUFNLEVBQUU7SUFDeEMsT0FBTztNQUNILE1BQU0sRUFBRSxNQUFNO01BQ2QsS0FBSyxFQUFHLFFBQVEsSUFBSSxRQUFRLENBQUMsSUFBSSxJQUFJLFFBQVEsQ0FBQyxJQUFJLENBQUMsS0FBSyxJQUFLLE9BQU8sR0FBRyxNQUFNO01BQzdFLFFBQVEsRUFBRyxRQUFRLElBQUksUUFBUSxDQUFDLFFBQVEsSUFBSSxRQUFRLENBQUMsUUFBUSxDQUFDLEtBQUssSUFBSztJQUM1RSxDQUFDO0VBQ0w7O0VBRUE7O0VBRUEsU0FBUyxXQUFXLENBQUMsSUFBSSxFQUFFO0lBQ3ZCLE1BQU0sQ0FBQyxzQkFBc0IsRUFBRSxDQUFDLENBQUMsRUFBRSxVQUFVLElBQUksRUFBRTtNQUMvQyxLQUFLLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQyxLQUFLLElBQUksRUFBRTtNQUNoQyxJQUFJLENBQUMsQ0FBQztJQUNWLENBQUMsRUFBRSxZQUFZO01BQ1gsS0FBSyxDQUFDLE9BQU8sR0FBRyxFQUFFO01BQ2xCLElBQUksQ0FBQyxDQUFDO0lBQ1YsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLFVBQVUsQ0FBQyxFQUFFLEVBQUU7SUFDcEIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO01BQzNDLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLEtBQUssRUFBRSxFQUFFO1FBQzVCLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7TUFDM0I7SUFDSjtJQUNBLE9BQU8sSUFBSTtFQUNmO0VBRUEsU0FBUyxjQUFjLEdBQUc7SUFDdEIsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDO0lBQ2QsS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsVUFBVSxNQUFNLEVBQUU7TUFDcEMsQ0FBQyxNQUFNLENBQUMsV0FBVyxJQUFJLEVBQUUsRUFBRSxPQUFPLENBQUMsVUFBVSxJQUFJLEVBQUU7UUFDL0MsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsSUFBSTtNQUNoQyxDQUFDLENBQUM7SUFDTixDQUFDLENBQUM7SUFDRixPQUFPLEtBQUs7RUFDaEI7O0VBRUE7O0VBRUEsU0FBUyxhQUFhLEdBQUc7SUFDckIsSUFBSSxLQUFLLEdBQUcsY0FBYyxDQUFDLENBQUM7SUFDNUIsSUFBSSxLQUFLLEdBQUcsRUFBRTtJQUNkLFdBQVcsQ0FBQyxPQUFPLENBQUMsVUFBVSxLQUFLLEVBQUU7TUFDakMsSUFBSSxPQUFPLEdBQUcsRUFBRTtNQUNoQixLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxVQUFVLE1BQU0sRUFBRTtRQUNwQyxJQUFJLE1BQU0sQ0FBQyxLQUFLLEtBQUssS0FBSyxFQUFFO1VBQ3hCO1FBQ0o7UUFDQSxDQUFDLE1BQU0sQ0FBQyxXQUFXLElBQUksRUFBRSxFQUFFLE9BQU8sQ0FBQyxVQUFVLElBQUksRUFBRTtVQUMvQyxPQUFPLENBQUMsSUFBSSxDQUFDO1lBQUUsS0FBSyxFQUFFLElBQUksQ0FBQyxJQUFJO1lBQUUsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSSxDQUFDO1VBQUssQ0FBQyxDQUFDO1FBQzNFLENBQUMsQ0FBQztNQUNOLENBQUMsQ0FBQztNQUNGLElBQUksT0FBTyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7UUFDcEIsS0FBSyxDQUFDLElBQUksQ0FBQztVQUFFLEtBQUssRUFBRSxlQUFlLENBQUMsS0FBSztRQUFFLENBQUMsQ0FBQztRQUM3QyxPQUFPLENBQUMsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFO1VBQzVCLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO1FBQ3BCLENBQUMsQ0FBQztNQUNOO0lBQ0osQ0FBQyxDQUFDO0lBQ0YsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLENBQUMsUUFBUSxDQUFDO01BQzlDLE1BQU0sRUFBRSxZQUFZLENBQUMsS0FBSyxDQUFDO01BQzNCLFdBQVcsRUFBRSxDQUFDLENBQUMscUNBQXFDLENBQUM7TUFDckQsUUFBUSxFQUFFLFNBQVYsUUFBUSxDQUFZLEtBQUssRUFBRTtRQUN2QixLQUFLLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDO1FBQ3JDLE1BQU0sQ0FBQyxDQUFDO01BQ1o7SUFDSixDQUFDLENBQUM7RUFDTjtFQUVBLFNBQVMsWUFBWSxDQUFDLEtBQUssRUFBRTtJQUN6QixPQUFPLEtBQUssQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLEVBQUU7TUFDN0IsSUFBSSxJQUFJLENBQUMsS0FBSyxFQUFFO1FBQ1osT0FBTztVQUFFLElBQUksRUFBRSxRQUFRO1VBQUUsSUFBSSxFQUFFLElBQUksQ0FBQztRQUFNLENBQUM7TUFDL0M7TUFDQSxPQUFPO1FBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJO1FBQUUsS0FBSyxFQUFFLElBQUksQ0FBQztNQUFNLENBQUM7SUFDakQsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLGVBQWUsQ0FBQyxLQUFLLEVBQUU7SUFDNUIsSUFBSSxHQUFHLEdBQUc7TUFDTixLQUFLLEVBQUUsaUNBQWlDO01BQ3hDLGFBQWEsRUFBRSx3Q0FBd0M7TUFDdkQsU0FBUyxFQUFFLG9DQUFvQztNQUMvQyxXQUFXLEVBQUUsc0NBQXNDO01BQ25ELEdBQUcsRUFBRTtJQUNULENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxLQUFLO0lBQ2pCLE9BQU8sQ0FBQyxDQUFDLEdBQUcsQ0FBQztFQUNqQjs7RUFFQTs7RUFFQSxJQUFJLG9CQUFvQixHQUFHO0lBQ3ZCLHlCQUF5QixFQUFFLDJCQUEyQjtJQUN0RCw0QkFBNEIsRUFBRSw4QkFBOEI7SUFDNUQsNkJBQTZCLEVBQUUsK0JBQStCO0lBQzlELG1CQUFtQixFQUFFLHNCQUFzQjtJQUMzQyxrQkFBa0IsRUFBRSw2QkFBNkI7SUFDakQsNkJBQTZCLEVBQUU7RUFDbkMsQ0FBQztFQUNELElBQUksZ0JBQWdCLEdBQUc7SUFDbkIsY0FBYyxFQUFFLDRCQUE0QjtJQUM1QyxrQkFBa0IsRUFBRSxzQkFBc0I7SUFDMUMsYUFBYSxFQUFFO0VBQ25CLENBQUM7RUFDRCxJQUFJLGlCQUFpQixHQUFHO0lBQ3BCLElBQUksRUFBRSx5QkFBeUI7SUFDL0IsV0FBVyxFQUFFLGdDQUFnQztJQUM3QyxNQUFNLEVBQUUsNEJBQTRCO0lBQ3BDLGVBQWUsRUFBRSw2QkFBNkI7SUFDOUMsWUFBWSxFQUFFLDBCQUEwQjtJQUN4QyxpQkFBaUIsRUFBRSwyQkFBMkI7SUFDOUMsbUJBQW1CLEVBQUUsZ0NBQWdDO0lBQ3JELGtCQUFrQixFQUFFLHVDQUF1QztJQUMzRCxrQkFBa0IsRUFBRSx1Q0FBdUM7SUFDM0QsV0FBVyxFQUFFO0VBQ2pCLENBQUM7RUFFRCxTQUFTLGNBQWMsQ0FBQyxJQUFJLEVBQUU7SUFDMUIsSUFBSSxPQUFPLEdBQUcsSUFBSSxJQUFJLElBQUksQ0FBQyxPQUFPLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEdBQUcsQ0FBQyxDQUFDO0lBQ3RGLE9BQU8sT0FBTyxDQUFDLGFBQWEsSUFBSSxRQUFPLE9BQU8sQ0FBQyxhQUFhLE1BQUssUUFBUSxHQUFHLE9BQU8sQ0FBQyxhQUFhLEdBQUcsSUFBSTtFQUM1Rzs7RUFFQTtFQUNBLFNBQVMsWUFBWSxDQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUU7SUFDckMsSUFBSSxJQUFJLEdBQUcsTUFBTSxDQUFFLE1BQU0sSUFBSSxNQUFNLENBQUMsSUFBSSxJQUFLLEVBQUUsQ0FBQztJQUNoRCxJQUFJLEdBQUcsR0FBRyxNQUFNLENBQUUsTUFBTSxJQUFJLE1BQU0sQ0FBQyxHQUFHLElBQUssRUFBRSxDQUFDO0lBQzlDLElBQUksR0FBRyxHQUFHLG9CQUFvQixDQUFDLFNBQVMsQ0FBQyxLQUNqQyxJQUFJLEtBQUssbUJBQW1CLEdBQUcsaUJBQWlCLENBQUMsR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFDLElBQzlELGdCQUFnQixDQUFDLElBQUksQ0FBQyxJQUN0QixzQkFBc0I7SUFDN0IsT0FBTyxDQUFDLENBQUMsdUJBQXVCLEdBQUcsR0FBRyxDQUFDO0VBQzNDO0VBRUEsU0FBUyxrQkFBa0IsQ0FBQyxNQUFNLEVBQUU7SUFDaEMsSUFBSSxRQUFRLEdBQUcsTUFBTSxJQUFJLE1BQU0sQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLFFBQVEsR0FBRyxDQUFDLENBQUM7SUFDL0QsSUFBSSxLQUFLLEdBQUcsRUFBRTtJQUNkLElBQUksT0FBTyxRQUFRLENBQUMsY0FBYyxLQUFLLFFBQVEsSUFBSSxPQUFPLFFBQVEsQ0FBQyxhQUFhLEtBQUssUUFBUSxFQUFFO01BQzNGLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLG1EQUFtRCxFQUFFO1FBQUUsTUFBTSxFQUFFLFFBQVEsQ0FBQyxjQUFjO1FBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBQztNQUFjLENBQUMsQ0FBQyxDQUFDO0lBQzNJO0lBQ0EsSUFBSSxPQUFPLFFBQVEsQ0FBQyxZQUFZLEtBQUssUUFBUSxFQUFFO01BQzNDLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLCtDQUErQyxFQUFFO1FBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBQztNQUFhLENBQUMsQ0FBQyxDQUFDO0lBQ3JHO0lBQ0EsSUFBSSxPQUFPLFFBQVEsQ0FBQyxjQUFjLEtBQUssUUFBUSxFQUFFO01BQzdDLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLGlEQUFpRCxFQUFFO1FBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBQztNQUFlLENBQUMsQ0FBQyxDQUFDO0lBQ3pHO0lBQ0EsT0FBTyxLQUFLO0VBQ2hCOztFQUVBO0VBQ0EsU0FBUyxhQUFhLENBQUMsSUFBSSxFQUFFO0lBQ3pCLElBQUksTUFBTSxHQUFHLGNBQWMsQ0FBQyxJQUFJLENBQUM7SUFDakMsSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUU7TUFDekIsT0FBTyxFQUFFO0lBQ2I7SUFDQSxPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksTUFBTSxDQUFDLEdBQUcsR0FBRyxHQUFHLEdBQUcsTUFBTSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUM7RUFDckU7O0VBRUE7RUFDQSxTQUFTLGVBQWUsQ0FBQyxNQUFNLEVBQUU7SUFDN0IsUUFBUSxNQUFNLENBQUMsWUFBWTtNQUN2QixLQUFLLGdCQUFnQjtRQUNqQixPQUFPLENBQUMsQ0FBQyx3Q0FBd0MsQ0FBQztNQUN0RCxLQUFLLGlCQUFpQjtRQUNsQixPQUFPLENBQUMsQ0FBQyx3Q0FBd0MsQ0FBQztNQUN0RCxLQUFLLGVBQWU7UUFDaEIsT0FBTyxDQUFDLENBQUMsMENBQTBDLENBQUM7TUFDeEQsS0FBSyxrQkFBa0I7UUFDbkIsT0FBTyxNQUFNLENBQUMsU0FBUyxHQUNqQixFQUFFLENBQUMsNENBQTRDLEVBQUU7VUFBRSxPQUFPLEVBQUUsTUFBTSxDQUFDO1FBQVUsQ0FBQyxDQUFDLEdBQy9FLENBQUMsQ0FBQyw2Q0FBNkMsQ0FBQztNQUMxRDtRQUNJLE9BQU8sTUFBTSxDQUFDLGlCQUFpQixJQUFJLEVBQUU7SUFDN0M7RUFDSjtFQUVBLFNBQVMsZUFBZSxHQUFHO0lBQ3ZCLENBQUMsQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQztNQUNoRCxNQUFNLEVBQUUsQ0FDSjtRQUFFLElBQUksRUFBRSxDQUFDLENBQUMsa0NBQWtDLENBQUM7UUFBRSxLQUFLLEVBQUUsT0FBTztRQUFFLFFBQVEsRUFBRTtNQUFLLENBQUMsRUFDL0U7UUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLHNDQUFzQyxDQUFDO1FBQUUsS0FBSyxFQUFFO01BQVksQ0FBQyxFQUN2RTtRQUFFLElBQUksRUFBRSxDQUFDLENBQUMsa0NBQWtDLENBQUM7UUFBRSxLQUFLLEVBQUU7TUFBUSxDQUFDLEVBQy9EO1FBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxtQ0FBbUMsQ0FBQztRQUFFLEtBQUssRUFBRTtNQUFTLENBQUMsRUFDakU7UUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLGdDQUFnQyxDQUFDO1FBQUUsS0FBSyxFQUFFO01BQU0sQ0FBQyxDQUM5RDtNQUNELFFBQVEsRUFBRSxTQUFWLFFBQVEsQ0FBWSxLQUFLLEVBQUU7UUFDdkIsS0FBSyxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUMsS0FBSyxJQUFJLEtBQUssQ0FBQztRQUNyQyxNQUFNLENBQUMsQ0FBQztNQUNaO0lBQ0osQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLFlBQVksR0FBRztJQUNwQixLQUFLLENBQUMsU0FBUyxHQUFHLEVBQUU7SUFDcEIsS0FBSyxDQUFDLE1BQU0sR0FBRyxPQUFPO0lBQ3RCLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQztJQUNoQixDQUFDLENBQUMscUNBQXFDLENBQUMsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDO0lBQzFELENBQUMsQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxjQUFjLEVBQUUsT0FBTyxDQUFDO0lBQzVFLE1BQU0sQ0FBQyxDQUFDO0VBQ1o7RUFFQSxTQUFTLGFBQWEsR0FBRztJQUNyQjtJQUNBLE9BQU8sS0FBSyxDQUFDLFNBQVMsS0FBSyxFQUFFLElBQUksS0FBSyxDQUFDLE1BQU0sS0FBSyxPQUFPO0VBQzdEOztFQUVBOztFQUVBLFNBQVMsTUFBTSxHQUFHO0lBQ2QsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDO0lBQ2hCLElBQUksQ0FBQyxDQUFDO0VBQ1Y7RUFFQSxTQUFTLElBQUksQ0FBQyxPQUFPLEVBQUU7SUFDbkIsSUFBSSxHQUFHLEdBQUcsRUFBRSxLQUFLLENBQUMsT0FBTztJQUN6QixJQUFJLE1BQU0sR0FBRyxZQUFZLENBQUMsQ0FBQztJQUMzQixJQUFJLFNBQVMsR0FBRyxPQUFPLElBQUksT0FBTyxDQUFDLE9BQU8sS0FBSyxJQUFJO0lBQ25ELElBQUksTUFBTSxHQUFHO01BQ1QsS0FBSyxFQUFFLFVBQVU7TUFDakIsTUFBTSxFQUFFLEtBQUssQ0FBQztJQUNsQixDQUFDO0lBQ0QsSUFBSSxLQUFLLENBQUMsU0FBUyxLQUFLLEVBQUUsRUFBRTtNQUFFLE1BQU0sQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFDLFNBQVM7SUFBRTtJQUNuRSxJQUFJLE1BQU0sQ0FBQyxJQUFJLEdBQUcsQ0FBQyxFQUFFO01BQUUsTUFBTSxDQUFDLFNBQVMsR0FBRyxNQUFNLENBQUMsSUFBSTtJQUFFO0lBQ3ZELElBQUksTUFBTSxDQUFDLEVBQUUsR0FBRyxDQUFDLEVBQUU7TUFBRSxNQUFNLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxFQUFFO0lBQUU7SUFFakQsY0FBYyxDQUFDLElBQUksRUFBRSxTQUFTLENBQUM7SUFDL0IsTUFBTSxDQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsVUFBVSxJQUFJLEVBQUU7TUFDdEMsSUFBSSxHQUFHLEtBQUssS0FBSyxDQUFDLE9BQU8sRUFBRTtRQUN2QixPQUFPLENBQUM7TUFDWjtNQUNBLEtBQUssQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLEtBQUssR0FBRyxDQUFDO01BQ3pELEtBQUssQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLEtBQUssSUFBSSxFQUFFO01BQ2xDLEtBQUssQ0FBQyxTQUFTLEdBQUcsSUFBSTtNQUN0QixjQUFjLENBQUMsS0FBSyxFQUFFLFNBQVMsQ0FBQztNQUNoQyxhQUFhLENBQUMsQ0FBQztJQUNuQixDQUFDLEVBQUUsVUFBVSxPQUFPLEVBQUU7TUFDbEIsSUFBSSxHQUFHLEtBQUssS0FBSyxDQUFDLE9BQU8sRUFBRTtRQUN2QjtNQUNKO01BQ0EsY0FBYyxDQUFDLEtBQUssRUFBRSxTQUFTLENBQUM7TUFDaEMsZUFBZSxDQUFDLE9BQU8sQ0FBQztJQUM1QixDQUFDLENBQUM7SUFDRixnQkFBZ0IsQ0FBQyxDQUFDO0VBQ3RCO0VBRUEsU0FBUyxjQUFjLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBRTtJQUNyQyxJQUFJLE1BQU0sR0FBRyxDQUFDLENBQUMseUJBQXlCLENBQUM7SUFDekMsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxJQUFJLEdBQUcsTUFBTSxHQUFHLE9BQU8sQ0FBQztJQUNqRSxNQUFNLENBQUMsV0FBVyxDQUFDLGVBQWUsRUFBRSxPQUFPLENBQUMsSUFBSSxJQUFJLFNBQVMsQ0FBQyxDQUFDO0lBQy9ELElBQUksQ0FBQyxTQUFTLEVBQUU7TUFDWixJQUFJLElBQUksRUFBRTtRQUNOLGNBQWMsQ0FBQyxDQUFDO01BQ3BCO01BQ0EsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7TUFDOUIsQ0FBQyxDQUFDLCtCQUErQixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUM7SUFDM0Q7RUFDSjtFQUVBLFNBQVMsZ0JBQWdCLEdBQUc7SUFDeEIsT0FBTywrSEFBK0gsR0FDaEksc0JBQXNCLEdBQ3RCLE1BQU0sR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLGlDQUFpQyxDQUFDLENBQUMsR0FBRyxPQUFPLEdBQzVELE1BQU0sR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDLENBQUMsR0FBRyxPQUFPLEdBQzdELFdBQVcsR0FDWCxNQUFNLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDLEdBQUcsT0FBTyxHQUNoRSxlQUFlO0VBQ3pCO0VBRUEsU0FBUyxjQUFjLEdBQUc7SUFDdEIsSUFBSSxJQUFJLEdBQUcsRUFBRTtJQUNiLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUU7TUFDeEIsSUFBSSxJQUFJLDRGQUE0RixHQUM5Riw0REFBNEQsR0FDNUQsMERBQTBELEdBQzFELDhGQUE4RjtJQUN4RztJQUNBLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLElBQUksQ0FBQyx1RkFBdUYsR0FDN0csZ0JBQWdCLENBQUMsQ0FBQyxHQUFHLFNBQVMsR0FBRyxJQUFJLEdBQUcsd0JBQXdCLENBQUM7RUFDM0U7O0VBRUE7O0VBRUEsU0FBUyxPQUFPLENBQUMsSUFBSSxFQUFFO0lBQ25CLE9BQU8sT0FBTyxDQUFDLElBQUksSUFBSSxJQUFJLENBQUMsT0FBTyxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxLQUFLLElBQUksQ0FBQztFQUN2RTtFQUVBLFNBQVMsYUFBYSxDQUFDLEtBQUssRUFBRTtJQUMxQixJQUFJLEtBQUssR0FBRyxDQUFDLENBQUM7SUFDZCxDQUFDLEtBQUssSUFBSSxFQUFFLEVBQUUsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFO01BQ2xDLElBQUksSUFBSSxDQUFDLFVBQVUsS0FBSywyQkFBMkIsRUFBRTtRQUNqRDtNQUNKO01BQ0EsSUFBSSxJQUFJLEdBQUksSUFBSSxDQUFDLE9BQU8sSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLElBQUssQ0FBQyxDQUFDO01BQ3BGLElBQUksSUFBSSxDQUFDLGVBQWUsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLEVBQUU7UUFDdEQsS0FBSyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxJQUFJLENBQUMsV0FBVztNQUNsRDtJQUNKLENBQUMsQ0FBQztJQUNGLE9BQU8sS0FBSztFQUNoQjtFQUVBLFNBQVMsWUFBWSxDQUFDLElBQUksRUFBRTtJQUN4QixJQUFJLElBQUksR0FBSSxJQUFJLENBQUMsT0FBTyxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLElBQUksSUFBSyxDQUFDLENBQUM7SUFDcEYsSUFBSSxJQUFJLENBQUMsUUFBUSxJQUFJLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFO01BQ2pELE9BQU8sS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDO0lBQ3pDO0lBQ0EsSUFBSSxRQUFRLEdBQUcsQ0FBQztJQUNoQixDQUFDLElBQUksQ0FBQyxVQUFVLElBQUksRUFBRSxFQUFFLE9BQU8sQ0FBQyxVQUFVLFFBQVEsRUFBRTtNQUNoRCxJQUFJLFFBQVEsQ0FBQyxXQUFXLEtBQUssUUFBUSxLQUFLLENBQUMsSUFBSSxRQUFRLENBQUMsV0FBVyxHQUFHLFFBQVEsQ0FBQyxFQUFFO1FBQzdFLFFBQVEsR0FBRyxRQUFRLENBQUMsV0FBVztNQUNuQztJQUNKLENBQUMsQ0FBQztJQUNGLE9BQU8sUUFBUTtFQUNuQjtFQUVBLFNBQVMsbUJBQW1CLEdBQUc7SUFDM0IsS0FBSyxDQUFDLFNBQVMsR0FBRyxhQUFhLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQztJQUNoRCxPQUFPLEtBQUssQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLFVBQVUsSUFBSSxFQUFFO01BQzFDLElBQUksSUFBSSxDQUFDLFVBQVUsS0FBSywyQkFBMkIsRUFBRTtRQUNqRCxPQUFPLEtBQUs7TUFDaEI7TUFDQSxPQUFPLEtBQUssQ0FBQyxVQUFVLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDO0lBQzdDLENBQUMsQ0FBQztFQUNOO0VBRUEsU0FBUyxhQUFhLEdBQUc7SUFDckIsaUJBQWlCLENBQUMsQ0FBQztJQUNuQixDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUM5QixtQkFBbUIsQ0FBQyxDQUFDO0lBQ3JCLElBQUksS0FBSyxHQUFHLG1CQUFtQixDQUFDLENBQUM7SUFFakMsSUFBSSxLQUFLLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtNQUNwQixJQUFJLGFBQWEsQ0FBQyxDQUFDLEVBQUU7UUFDakIsQ0FBQyxDQUFDLDRCQUE0QixDQUFDLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQztNQUN4RCxDQUFDLE1BQU07UUFDSCxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO01BQy9DO01BQ0EsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7TUFDOUIsV0FBVyxDQUFDLENBQUM7TUFDYjtJQUNKO0lBRUEsSUFBSSxLQUFLLEdBQUcsY0FBYyxDQUFDLENBQUM7SUFDNUIsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsRUFBRTtNQUNwQixLQUFLLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLG9DQUFvQyxDQUFDO0lBQy9EO0lBQ0EsSUFBSSxJQUFJLEdBQUcsRUFBRTtJQUNiLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxJQUFJLEVBQUU7TUFDMUIsSUFBSSxJQUFJLFNBQVMsQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxJQUFJLENBQUMsVUFBVSxDQUFDO01BQ2xFLElBQUksS0FBSyxDQUFDLFVBQVUsS0FBSyxJQUFJLENBQUMsRUFBRSxFQUFFO1FBQzlCLElBQUksSUFBSSxlQUFlLENBQUMsSUFBSSxDQUFDO01BQ2pDO0lBQ0osQ0FBQyxDQUFDO0lBQ0YsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsSUFBSSxDQUFDLGlGQUFpRixHQUN2RyxnQkFBZ0IsQ0FBQyxDQUFDLEdBQUcsU0FBUyxHQUFHLElBQUksR0FBRyx3QkFBd0IsQ0FBQztJQUV2RSxDQUFDLENBQUMseUNBQXlDLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVk7TUFDakUsU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDakMsQ0FBQyxDQUFDO0lBQ0YsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxhQUFhLEVBQUUsNkJBQTZCLEVBQUUsVUFBVSxLQUFLLEVBQUU7TUFDeEcsS0FBSyxDQUFDLGVBQWUsQ0FBQyxDQUFDO01BQ3ZCLElBQUksT0FBTyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDO01BQ3RDLElBQUksT0FBTyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLElBQUksQ0FBQztNQUM1QyxPQUFPLENBQUMsVUFBVSxHQUFHLE9BQU8sR0FBRyxRQUFRLEVBQUUsQ0FBQyxDQUFDLEVBQUUsVUFBVSxJQUFJLEVBQUU7UUFDekQsU0FBUyxDQUFDLEVBQUUsQ0FBQyxzQ0FBc0MsRUFBRTtVQUFFLEtBQUssRUFBRSxJQUFJLENBQUMsT0FBTyxJQUFJO1FBQUUsQ0FBQyxDQUFDLENBQUM7UUFDbkYsSUFBSSxDQUFDLENBQUM7TUFDVixDQUFDLEVBQUUsVUFBVSxPQUFPLEVBQUU7UUFDbEIsT0FBTyxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDO1FBQy9CLFNBQVMsQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDLENBQUM7TUFDbkMsQ0FBQyxDQUFDO0lBQ04sQ0FBQyxDQUFDO0lBRUYsV0FBVyxDQUFDLENBQUM7RUFDakI7RUFFQSxTQUFTLGlCQUFpQixHQUFHO0lBQ3pCLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO0lBQzNDLENBQUMsQ0FBQyw0QkFBNEIsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO0lBQ3BELENBQUMsQ0FBQywrQkFBK0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO0VBQzNEO0VBRUEsU0FBUyxlQUFlLENBQUMsT0FBTyxFQUFFO0lBQzlCLElBQUksSUFBSSxHQUFHLEVBQUUsQ0FBQyxzQ0FBc0MsRUFBRTtNQUNsRCxJQUFJLEVBQUUsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDO01BQzlDLElBQUksRUFBRSxPQUFPLENBQUMsTUFBTSxHQUFHLENBQUMsR0FBRyxPQUFPLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxvQ0FBb0M7SUFDdEYsQ0FBQyxDQUFDO0lBQ0YsSUFBSSxLQUFLLENBQUMsU0FBUyxJQUFJLEtBQUssQ0FBQyxTQUFTLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtNQUMvQztNQUNBLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLElBQUksQ0FDdkIsZ0RBQWdELEdBQUcsVUFBVSxHQUMzRCx1QkFBdUIsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsUUFBUSxHQUM5QywyRkFBMkYsR0FDM0YsR0FBRyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDLEdBQUcsaUJBQ25ELENBQUM7TUFDRCxDQUFDLENBQUMsMEJBQTBCLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVk7UUFBRSxJQUFJLENBQUMsQ0FBQztNQUFFLENBQUMsQ0FBQztJQUN0RSxDQUFDLE1BQU07TUFDSCxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztNQUM5QixDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQztNQUMzQyxDQUFDLENBQUMsb0NBQW9DLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO01BQ2xELENBQUMsQ0FBQywrQkFBK0IsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUM7SUFDM0Q7RUFDSjs7RUFFQTs7RUFFQTtFQUNBLFNBQVMsVUFBVSxHQUFHO0lBQ2xCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtNQUN4QyxJQUFJLEdBQUcsR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztNQUN2QixJQUFJLEdBQUcsQ0FBQyxPQUFPLEtBQUssS0FBSyxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssZUFBZSxFQUFFO1FBQ3pELE9BQU87VUFDSCxJQUFJLEVBQUUsRUFBRSxDQUFDLHlDQUF5QyxFQUFFO1lBQ2hELEdBQUcsRUFBRSxHQUFHLENBQUMsWUFBWSxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsWUFBWSxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsS0FBSyxHQUFHO1VBQ3ZFLENBQUMsQ0FBQztVQUNGLEtBQUssRUFBRSxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUU7UUFDeEIsQ0FBQztNQUNMO0lBQ0o7SUFDQTtJQUNBLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtNQUM3QyxJQUFJLFVBQVUsR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsSUFBSSxFQUFFO01BQ3BELEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxVQUFVLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO1FBQ3hDLElBQUksVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsSUFBSSxnQkFBZ0IsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRTtVQUM5RCxPQUFPO1lBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyx1Q0FBdUMsQ0FBQztZQUFFLEtBQUssRUFBRTtVQUFFLENBQUM7UUFDekU7TUFDSjtJQUNKO0lBQ0EsT0FBTyxJQUFJO0VBQ2Y7RUFFQSxTQUFTLG1CQUFtQixHQUFHO0lBQzNCLElBQUksT0FBTyxHQUFHLEtBQUssQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFDLENBQUMsR0FBRyxJQUFJO0lBQ3BELElBQUksT0FBTyxLQUFLLElBQUksRUFBRTtNQUNsQixDQUFDLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztNQUMvQjtJQUNKO0lBQ0EsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLENBQUMsSUFBSSxDQUFDLDBEQUEwRCxHQUFHLFVBQVUsR0FDOUYsdUJBQXVCLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsR0FBRyxRQUFRLEdBQ3RELG9HQUFvRyxHQUFHLE9BQU8sQ0FBQyxLQUFLLEdBQUcsSUFBSSxHQUMzSCxHQUFHLENBQUMsQ0FBQyxDQUFDLG9DQUFvQyxDQUFDLENBQUMsR0FBRyxpQkFBaUIsQ0FBQztFQUMzRTtFQUVBLFNBQVMsZ0JBQWdCLENBQUMsUUFBUSxFQUFFO0lBQ2hDLE9BQU8sUUFBUSxDQUFDLE1BQU0sS0FBSyxRQUFRLElBQUksUUFBUSxDQUFDLE1BQU0sS0FBSyxTQUFTO0VBQ3hFO0VBRUEsU0FBUyxhQUFhLENBQUMsSUFBSSxFQUFFO0lBQ3pCLE9BQU8sQ0FBQyxJQUFJLENBQUMsVUFBVSxJQUFJLEVBQUUsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLENBQUM7RUFDekQ7RUFFQSxTQUFTLGdCQUFnQixHQUFHO0lBQ3hCLE1BQU0sQ0FBQyxTQUFTLEVBQUU7TUFBRSxTQUFTLEVBQUUsWUFBWSxDQUFDLENBQUM7TUFBRSxLQUFLLEVBQUU7SUFBSSxDQUFDLEVBQUUsVUFBVSxJQUFJLEVBQUU7TUFDekUsSUFBSSxLQUFLLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxJQUFJLEVBQUUsRUFBRSxNQUFNLENBQUMsVUFBVSxJQUFJLEVBQUU7UUFDbEQsT0FBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxhQUFhLENBQUMsSUFBSSxDQUFDO01BQ2hELENBQUMsQ0FBQyxDQUFDLE1BQU07TUFDVCxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxHQUFHLEVBQUUsR0FBRyxLQUFLLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQzFELElBQUksQ0FBQyxZQUFZLEVBQUUsRUFBRSxDQUFDLHdDQUF3QyxFQUFFO1FBQUUsS0FBSyxFQUFFO01BQU0sQ0FBQyxDQUFDLENBQUMsQ0FDbEYsSUFBSSxDQUFDLFFBQVEsRUFBRSxLQUFLLEdBQUcsQ0FBQyxHQUFHLElBQUksR0FBRyxJQUFJLENBQUM7SUFDaEQsQ0FBQyxFQUFFLFlBQVksQ0FBQyxDQUFDLENBQUM7RUFDdEI7O0VBRUE7O0VBRUEsU0FBUyxRQUFRLENBQUMsSUFBSSxFQUFFO0lBQ3BCLElBQUksT0FBTyxHQUFHLElBQUksQ0FBQyxPQUFPLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEdBQUcsQ0FBQyxDQUFDO0lBQzlFLElBQUksS0FBSyxHQUFHLElBQUksQ0FBQyxPQUFPLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFDO0lBQ3hFLFFBQVEsSUFBSSxDQUFDLFVBQVU7TUFDbkIsS0FBSyxrQkFBa0I7TUFDdkIsS0FBSyw4QkFBOEI7UUFDL0IsSUFBSSxTQUFTLEdBQUcsQ0FBQyxPQUFPLENBQUMsU0FBUyxJQUFJLEVBQUUsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztRQUN2RSxJQUFJLE1BQU0sR0FBRyxPQUFPLENBQUMsYUFBYSxJQUFJLEVBQUU7UUFDeEMsSUFBSSxNQUFNLEtBQUssRUFBRSxJQUFJLFNBQVMsS0FBSyxFQUFFLEVBQUU7VUFDbkMsT0FBTyxNQUFNLEdBQUcsS0FBSyxHQUFHLFNBQVM7UUFDckM7UUFDQSxPQUFPLE1BQU0sS0FBSyxFQUFFLEdBQUcsTUFBTSxHQUFHLFNBQVM7TUFDN0MsS0FBSyw4QkFBOEI7UUFDL0IsSUFBSSxLQUFLLENBQUMsTUFBTSxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsT0FBTyxLQUFLLElBQUksSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLE9BQU8sS0FBSyxTQUFTLEVBQUU7VUFDckYsT0FBTyxFQUFFLENBQUMsaUNBQWlDLEVBQUU7WUFBRSxLQUFLLEVBQUUsS0FBSyxDQUFDLE1BQU0sQ0FBQztVQUFRLENBQUMsQ0FBQztRQUNqRjtRQUNBLE9BQU8sS0FBSyxDQUFDLE9BQU8sSUFBSSxPQUFPLENBQUMsYUFBYSxJQUFJLEVBQUU7TUFDdkQsS0FBSyxvQkFBb0I7TUFDekIsS0FBSyxrQkFBa0I7UUFDbkIsSUFBSSxRQUFRLEdBQUcsT0FBTyxDQUFDLFFBQVEsSUFBSSxDQUFDLENBQUM7UUFDckMsT0FBTyxRQUFRLENBQUMsUUFBUSxHQUFHLE9BQU8sR0FBRyxRQUFRLENBQUMsUUFBUSxHQUFHLEdBQUcsR0FBSSxRQUFRLENBQUMsSUFBSSxJQUFJLFFBQVEsQ0FBQyxFQUFFLElBQUksRUFBRztNQUN2RyxLQUFLLGFBQWE7UUFDZCxPQUFPLEtBQUssQ0FBQyxPQUFPLElBQUksVUFBVSxDQUFDLE9BQU8sQ0FBQyxNQUFNLElBQUksQ0FBQyxDQUFDLENBQUM7TUFDNUQsS0FBSyxVQUFVO1FBQ1gsSUFBSSxVQUFVLEdBQUcsT0FBTyxDQUFDLE1BQU0sSUFBSSxDQUFDLENBQUM7UUFDckMsT0FBTyxVQUFVLENBQUMsU0FBUyxJQUFJLEVBQUU7TUFDckMsS0FBSyw4QkFBOEI7TUFDbkMsS0FBSyw2QkFBNkI7UUFDOUIsSUFBSSxPQUFPLENBQUMsYUFBYSxFQUFFO1VBQ3ZCLE9BQU8sWUFBWSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsT0FBTyxDQUFDLGFBQWEsQ0FBQztRQUMvRDtRQUNBLE9BQVEsT0FBTyxDQUFDLE1BQU0sSUFBSSxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksSUFBSyxLQUFLLENBQUMsT0FBTyxJQUFJLEVBQUU7TUFDekU7UUFDSSxJQUFJLE9BQU8sQ0FBQyxhQUFhLEVBQUU7VUFDdkIsT0FBTyxZQUFZLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxPQUFPLENBQUMsYUFBYSxDQUFDO1FBQy9EO1FBQ0EsT0FBTyxLQUFLLENBQUMsT0FBTyxJQUFJLEVBQUU7SUFDbEM7RUFDSjs7RUFFQTtFQUNBLFNBQVMsYUFBYSxDQUFDLFFBQVEsRUFBRTtJQUM3QixJQUFJLElBQUksR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM3QyxJQUFJLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQztJQUM3QixJQUFJLEtBQUssQ0FBQyxNQUFNLElBQUksQ0FBQyxJQUFJLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUU7TUFDdEMsSUFBSSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsR0FBRyxHQUFHLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsR0FBRyxHQUFHO0lBQ3BEO0lBQ0EsSUFBSSxJQUFJLEtBQUssRUFBRSxFQUFFO01BQ2IsT0FBTyxNQUFNLENBQUMsUUFBUSxDQUFDLE1BQU0sSUFBSSxFQUFFLENBQUM7SUFDeEM7SUFDQSxPQUFPLFFBQVEsQ0FBQyxNQUFNLEdBQUcsSUFBSSxHQUFHLElBQUksR0FBRyxRQUFRLENBQUMsTUFBTSxHQUFHLEdBQUcsR0FBRyxJQUFJO0VBQ3ZFO0VBRUEsU0FBUyxZQUFZLENBQUMsUUFBUSxFQUFFO0lBQzVCLE9BQU8sUUFBUSxDQUFDLElBQUksR0FBRyxRQUFRLENBQUMsSUFBSSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEdBQUcsSUFBSSxHQUFHLFFBQVEsQ0FBQyxNQUFNLEdBQUcsR0FBRyxHQUFHLEVBQUUsQ0FBQyxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQztFQUNoSTs7RUFFQTtFQUNBO0VBQ0EsU0FBUyxVQUFVLENBQUMsTUFBTSxFQUFFO0lBQ3hCLElBQUksR0FBRyxHQUFJLE1BQU0sSUFBSSxNQUFNLENBQUMsV0FBVyxJQUFLLEVBQUU7SUFDOUMsSUFBSSxJQUFJLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQztJQUNqQixJQUFJLEdBQUcsS0FBSyxFQUFFLElBQUksSUFBSSxLQUFLLEdBQUcsRUFBRTtNQUM1QixPQUFPLEdBQUc7SUFDZDtJQUNBLElBQUksTUFBTSxHQUFJLE1BQU0sSUFBSSxNQUFNLENBQUMsTUFBTSxJQUFLLENBQUMsQ0FBQztJQUM1QyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxVQUFVLElBQUksRUFBRTtNQUN4QyxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEdBQUcsSUFBSSxHQUFHLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDbEUsQ0FBQyxDQUFDO0lBQ0Y7SUFDQSxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxDQUM5QixPQUFPLENBQUMsU0FBUyxFQUFFLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLGVBQWUsRUFBRSxHQUFHLENBQUMsQ0FDN0UsT0FBTyxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQ2xFLE9BQU8sQ0FBQyxNQUFNLEVBQUUsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7RUFDcEM7RUFFQSxTQUFTLFNBQVMsQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFO0lBQ2hDLElBQUksS0FBSyxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsR0FBRyx5QkFBeUIsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLCtCQUErQixDQUFDLENBQUMsR0FBRyxTQUFTLEdBQUcsRUFBRTtJQUNoSCxJQUFJLEtBQUssR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDO0lBQzFCLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQyxVQUFVLEtBQUssSUFBSSxDQUFDLEVBQUU7SUFDM0MsT0FBTyx5QkFBeUIsSUFBSSxRQUFRLEdBQUcsU0FBUyxHQUFHLEVBQUUsQ0FBQyxHQUFHLGFBQWEsR0FBRyxJQUFJLENBQUMsRUFBRSxHQUFHLG1CQUFtQixJQUFJLFFBQVEsR0FBRyxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsSUFBSSxHQUMvSSw4QkFBOEIsR0FBRyxZQUFZLEdBQUcsT0FBTyxHQUN2RCwyQkFBMkIsR0FBRyxXQUFXLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxHQUFHLE9BQU8sR0FDckUsa0VBQWtFLEdBQUcsR0FBRyxDQUFDLFNBQVMsQ0FBQyxHQUFHLElBQUksR0FBRyxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsU0FBUyxHQUFHLEtBQUssR0FBRyxhQUFhLEdBQy9JLDBDQUEwQyxHQUFHLEdBQUcsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxHQUFHLEtBQUssR0FBRyxJQUFJLEdBQUcsYUFBYSxDQUFDLElBQUksQ0FBQyxHQUFHLEdBQUcsR0FBRyxLQUFLLENBQUMsR0FBRyxJQUFJLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLE9BQU8sR0FDN0osTUFBTSxHQUFHLFlBQVksQ0FBQyxJQUFJLENBQUMsR0FBRyxPQUFPLEdBQ3JDLE9BQU87RUFDakI7O0VBRUE7RUFDQSxTQUFTLFlBQVksQ0FBQyxJQUFJLEVBQUU7SUFDeEIsSUFBSSxPQUFPLEdBQUcsSUFBSSxDQUFDLE9BQU8sSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sR0FBRyxDQUFDLENBQUM7SUFDOUUsSUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDLE9BQU8sSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssR0FBRyxDQUFDLENBQUM7SUFDeEUsSUFBSSxNQUFNLEdBQUcsRUFBRTtJQUNmLElBQUksU0FBUyxHQUFHLENBQUMsT0FBTyxDQUFDLFNBQVMsSUFBSSxFQUFFLEVBQUUsR0FBRyxDQUFDLFlBQVksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7SUFDdEUsSUFBSSxTQUFTLEtBQUssRUFBRSxFQUFFO01BQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQyxFQUFFLFNBQVMsQ0FBQyxDQUFDO0lBQUU7SUFDNUYsSUFBSSxPQUFPLENBQUMsYUFBYSxFQUFFO01BQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxtQ0FBbUMsQ0FBQyxFQUFFLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUFFO0lBQzNHLElBQUksSUFBSSxDQUFDLFVBQVUsS0FBSyxrQkFBa0IsRUFBRTtNQUN4QyxJQUFJLFFBQVEsR0FBRyxZQUFZLENBQUMsSUFBSSxDQUFDO01BQ2pDLElBQUksUUFBUSxHQUFHLENBQUMsRUFBRTtRQUNkLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsdUNBQXVDLENBQUMsRUFBRSxXQUFXLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztNQUNwRjtJQUNKO0lBQ0EsSUFBSSxRQUFRLEdBQUcsT0FBTyxDQUFDLFFBQVEsSUFBSSxDQUFDLENBQUM7SUFDckMsSUFBSSxRQUFRLENBQUMsUUFBUSxJQUFJLFFBQVEsQ0FBQyxJQUFJLEVBQUU7TUFDcEMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLFFBQVEsSUFBSSxFQUFFLEtBQUssUUFBUSxDQUFDLElBQUksR0FBRyxLQUFLLEdBQUcsUUFBUSxDQUFDLElBQUksR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDO0lBQ3JJO0lBQ0EsSUFBSSxPQUFPLENBQUMsTUFBTSxJQUFJLE9BQU8sQ0FBQyxNQUFNLENBQUMsV0FBVyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRTtNQUNoRSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLG9DQUFvQyxDQUFDLEVBQUUsVUFBVSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO0lBQ3RGO0lBQ0EsSUFBSSxLQUFLLENBQUMsTUFBTSxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsT0FBTyxLQUFLLElBQUksSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLE9BQU8sS0FBSyxTQUFTLEVBQUU7TUFDckYsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxFQUFFLEtBQUssQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDOUU7SUFDQSxJQUFJLEtBQUssQ0FBQyxPQUFPLEVBQUU7TUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLG9DQUFvQyxDQUFDLEVBQUUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQUU7SUFDNUYsSUFBSSxPQUFPLENBQUMsYUFBYSxFQUFFO01BQ3ZCLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsb0NBQW9DLENBQUMsRUFDaEQsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxPQUFPLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsa0JBQWtCLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDN0g7SUFDQSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sSUFBSSxFQUFFLEVBQUUsTUFBTSxHQUFHLENBQUMsRUFBRTtNQUNsQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLG9DQUFvQyxDQUFDLEVBQUUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztJQUNwRjtJQUNBLE9BQU8sTUFBTTtFQUNqQjtFQUVBLFNBQVMsV0FBVyxDQUFDLEVBQUUsRUFBRTtJQUNyQixJQUFJLE9BQU8sQ0FBQyxFQUFFLENBQUMsRUFBRTtNQUNiLE9BQU8sT0FBTyxDQUFDLEVBQUUsQ0FBQztJQUN0QjtJQUNBLE9BQU8sT0FBTyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEdBQUcsR0FBRyxPQUFPLENBQUMsRUFBRSxDQUFDO0VBQzFDO0VBRUEsU0FBUyxlQUFlLENBQUMsSUFBSSxFQUFFO0lBQzNCLElBQUksSUFBSSxHQUFHLHdCQUF3QjtJQUNuQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFO01BQ3ZDLElBQUksSUFBSSxNQUFNLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLFdBQVcsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsT0FBTztJQUN4RSxDQUFDLENBQUM7SUFDRixJQUFJLFNBQVMsR0FBRyxLQUFLO0lBQ3JCLENBQUMsSUFBSSxDQUFDLFVBQVUsSUFBSSxFQUFFLEVBQUUsT0FBTyxDQUFDLFVBQVUsUUFBUSxFQUFFO01BQ2hELElBQUksTUFBTSxHQUFHLGtCQUFrQixDQUFDLFFBQVEsQ0FBQztNQUN6QyxJQUFJLEtBQUssR0FBRyxjQUFjLENBQUMsUUFBUSxDQUFDO01BQ3BDLElBQUksT0FBTyxHQUFHLFFBQVEsQ0FBQyxlQUFlLElBQUksRUFBRTtNQUM1QyxJQUFJLElBQUksMEJBQTBCLEdBQUcsR0FBRyxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxHQUFHLE9BQU8sR0FDdEUsS0FBSyxJQUFJLE1BQU0sQ0FBQyxHQUFHLEdBQUcsd0JBQXdCLEdBQUcsRUFBRSxDQUFDLElBQUksT0FBTyxLQUFLLEVBQUUsR0FBRyxVQUFVLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsR0FBRyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEdBQUcsR0FDNUksR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFDZixLQUFLLEdBQUcscUJBQXFCLElBQUksS0FBSyxDQUFDLEdBQUcsR0FBRyxnQkFBZ0IsR0FBRyxFQUFFLENBQUMsR0FBRyxHQUFHLElBQ3JFLEtBQUssQ0FBQyxJQUFJLEtBQUssRUFBRSxHQUFHLFVBQVUsR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsR0FBRyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLFFBQVEsR0FBRyxFQUFFLENBQUMsR0FDbEksT0FBTztNQUNiLElBQUksUUFBUSxDQUFDLE1BQU0sS0FBSyxRQUFRLElBQUksQ0FBQyxRQUFRLENBQUMsV0FBVyxJQUFJLENBQUMsUUFBUSxDQUFDLFlBQVksRUFBRTtRQUNqRixTQUFTLEdBQUcsSUFBSTtNQUNwQjtJQUNKLENBQUMsQ0FBQztJQUNGLElBQUksSUFBSSxPQUFPO0lBQ2YsSUFBSSxTQUFTLEVBQUU7TUFDWCxJQUFJLElBQUkseUZBQXlGLEdBQUcsSUFBSSxDQUFDLEVBQUUsR0FBRyxJQUFJLEdBQzVHLEdBQUcsQ0FBQyxDQUFDLENBQUMsb0NBQW9DLENBQUMsQ0FBQyxHQUFHLFdBQVc7SUFDcEU7SUFDQSxPQUFPLHlDQUF5QyxHQUFHLElBQUksQ0FBQyxFQUFFLEdBQUcsZ0RBQWdELEdBQUcsSUFBSSxHQUFHLGtCQUFrQjtFQUM3STtFQUVBLFNBQVMsY0FBYyxDQUFDLFFBQVEsRUFBRTtJQUM5QixJQUFJLFFBQVEsQ0FBQyxVQUFVLEVBQUU7TUFDckIsT0FBTyxRQUFRLENBQUMsVUFBVTtJQUM5QjtJQUNBLElBQUksUUFBUSxDQUFDLFlBQVksRUFBRTtNQUN2QixPQUFPLENBQUMsQ0FBQywwQ0FBMEMsQ0FBQztJQUN4RDtJQUNBLE9BQU8sUUFBUSxDQUFDLGdCQUFnQixJQUFJLEdBQUc7RUFDM0M7RUFFQSxTQUFTLGNBQWMsQ0FBQyxJQUFJLEVBQUU7SUFDMUIsSUFBSSxNQUFNLEdBQUc7TUFBRSxLQUFLLEVBQUUsQ0FBQztNQUFFLElBQUksRUFBRSxDQUFDO01BQUUsTUFBTSxFQUFFLENBQUM7TUFBRSxPQUFPLEVBQUUsQ0FBQztNQUFFLFFBQVEsRUFBRTtJQUFFLENBQUM7SUFDdEUsQ0FBQyxJQUFJLENBQUMsVUFBVSxJQUFJLEVBQUUsRUFBRSxPQUFPLENBQUMsVUFBVSxRQUFRLEVBQUU7TUFDaEQsTUFBTSxDQUFDLEtBQUssRUFBRTtNQUNkLElBQUksZ0JBQWdCLENBQUMsUUFBUSxDQUFDLEVBQUU7UUFBRSxNQUFNLENBQUMsTUFBTSxFQUFFO01BQUUsQ0FBQyxNQUMvQyxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssU0FBUyxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssU0FBUyxFQUFFO1FBQUUsTUFBTSxDQUFDLE9BQU8sRUFBRTtNQUFFLENBQUMsTUFDekYsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLFdBQVcsRUFBRTtRQUFFLE1BQU0sQ0FBQyxRQUFRLEVBQUU7TUFBRSxDQUFDLE1BQzNEO1FBQUUsTUFBTSxDQUFDLElBQUksRUFBRTtNQUFFO0lBQzFCLENBQUMsQ0FBQztJQUNGLE9BQU8sTUFBTTtFQUNqQjtFQUVBLFNBQVMsWUFBWSxDQUFDLElBQUksRUFBRTtJQUN4QixJQUFJLENBQUMsR0FBRyxjQUFjLENBQUMsSUFBSSxDQUFDO0lBQzVCLElBQUksQ0FBQyxDQUFDLEtBQUssS0FBSyxDQUFDLEVBQUU7TUFDZixPQUFPLGlDQUFpQztJQUM1QztJQUNBLElBQUksQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7TUFDZCxPQUFPLDZCQUE2QixHQUFHLFVBQVUsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLDJDQUEyQyxDQUFDLENBQUMsR0FBRyxTQUFTO0lBQ3ZIO0lBQ0EsSUFBSSxDQUFDLENBQUMsT0FBTyxHQUFHLENBQUMsRUFBRTtNQUNmLE9BQU8sdUJBQXVCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDLEdBQUcsU0FBUztJQUMxRjtJQUNBLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLFFBQVEsR0FBRyxDQUFDLEVBQUU7TUFDaEMsT0FBTyx1QkFBdUIsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHlDQUF5QyxDQUFDLENBQUMsR0FBRyxTQUFTO0lBQ2xHO0lBQ0EsT0FBTyw2QkFBNkIsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLG9DQUFvQyxDQUFDLENBQUMsR0FBRyxTQUFTO0VBQ25HOztFQUVBO0VBQ0EsU0FBUyxrQkFBa0IsQ0FBQyxRQUFRLEVBQUU7SUFDbEMsSUFBSSxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsRUFBRTtNQUM1QixJQUFJLE1BQU0sR0FBRyxjQUFjLENBQUMsUUFBUSxDQUFDO01BQ3JDLE9BQU87UUFBRSxHQUFHLEVBQUUsSUFBSTtRQUFFLElBQUksRUFBRSxDQUFDLENBQUMsMkNBQTJDLENBQUMsSUFBSSxNQUFNLEtBQUssRUFBRSxHQUFHLEtBQUssR0FBRyxNQUFNLEdBQUcsRUFBRTtNQUFFLENBQUM7SUFDdEg7SUFDQSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssU0FBUyxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssU0FBUyxFQUFFO01BQ2hFLE9BQU87UUFBRSxHQUFHLEVBQUUsS0FBSztRQUFFLElBQUksRUFBRSxDQUFDLENBQUMsaUNBQWlDLENBQUMsSUFBSSxRQUFRLENBQUMsZUFBZSxHQUFHLENBQUMsR0FDekYsS0FBSyxHQUFHLEVBQUUsQ0FBQyxtQ0FBbUMsRUFBRTtVQUFFLElBQUksRUFBRSxXQUFXLENBQUMsUUFBUSxDQUFDLGVBQWU7UUFBRSxDQUFDLENBQUMsR0FDaEcsRUFBRTtNQUFFLENBQUM7SUFDZjtJQUNBLElBQUksUUFBUSxDQUFDLE1BQU0sS0FBSyxXQUFXLEVBQUU7TUFDakMsT0FBTztRQUFFLEdBQUcsRUFBRSxLQUFLO1FBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyw4Q0FBOEM7TUFBRSxDQUFDO0lBQ2xGO0lBQ0EsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLFdBQVcsRUFBRTtNQUNqQyxPQUFPO1FBQUUsR0FBRyxFQUFFLEtBQUs7UUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLDhDQUE4QztNQUFFLENBQUM7SUFDbEY7SUFDQSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssZ0JBQWdCLEVBQUU7TUFDdEMsT0FBTztRQUFFLEdBQUcsRUFBRSxJQUFJO1FBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxrREFBa0Q7TUFBRSxDQUFDO0lBQ3JGO0lBQ0EsT0FBTztNQUFFLEdBQUcsRUFBRSxLQUFLO01BQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxvQ0FBb0M7SUFBRSxDQUFDO0VBQ3hFOztFQUVBO0VBQ0EsSUFBSSxjQUFjLEdBQUc7SUFDakIsOEJBQThCLEVBQUUsbUJBQW1CO0lBQ25ELDhCQUE4QixFQUFFLGVBQWU7SUFDL0MsK0JBQStCLEVBQUUsZUFBZTtJQUNoRCwyQkFBMkIsRUFBRSxlQUFlO0lBQzVDLDhCQUE4QixFQUFFLGVBQWU7SUFDL0MsaUJBQWlCLEVBQUUsZUFBZTtJQUNsQyxvQkFBb0IsRUFBRSxjQUFjO0lBQ3BDLDhCQUE4QixFQUFFLGNBQWM7SUFDOUMsMkJBQTJCLEVBQUUsbUJBQW1CO0lBQ2hELHlCQUF5QixFQUFFLG1CQUFtQjtJQUM5QywwQkFBMEIsRUFBRSx1QkFBdUI7SUFDbkQsd0JBQXdCLEVBQUUsdUJBQXVCO0lBQ2pELDJCQUEyQixFQUFFLHVCQUF1QjtJQUNwRCwyQkFBMkIsRUFBRSxnQkFBZ0I7SUFDN0Msc0JBQXNCLEVBQUUsaUJBQWlCO0lBQ3pDLG9CQUFvQixFQUFFLGlCQUFpQjtJQUN2Qyw0QkFBNEIsRUFBRSxlQUFlO0lBQzdDLHFCQUFxQixFQUFFLGVBQWU7SUFDdEMscUJBQXFCLEVBQUUsZ0JBQWdCO0lBQ3ZDLGtCQUFrQixFQUFFLGdCQUFnQjtJQUNwQyxzQkFBc0IsRUFBRSxnQkFBZ0I7SUFDeEMsMEJBQTBCLEVBQUUsZ0JBQWdCO0lBQzVDLHNCQUFzQixFQUFFLGlCQUFpQjtJQUN6QyxxQkFBcUIsRUFBRSxvQkFBb0I7SUFDM0MsY0FBYyxFQUFFLG9CQUFvQjtJQUNwQyxrQkFBa0IsRUFBRSxvQkFBb0I7SUFDeEMsVUFBVSxFQUFFO0VBQ2hCLENBQUM7RUFFRCxTQUFTLFFBQVEsQ0FBQyxJQUFJLEVBQUU7SUFDcEIsSUFBSSxHQUFHLEdBQUcsY0FBYyxDQUFDLElBQUksQ0FBQztJQUM5QixPQUFPLEdBQUcsR0FBRyxDQUFDLENBQUMsdUJBQXVCLEdBQUcsR0FBRyxDQUFDLEdBQUcsSUFBSTtFQUN4RDs7RUFFQTtFQUNBLFNBQVMsY0FBYyxDQUFDLFFBQVEsRUFBRTtJQUM5QixJQUFJLENBQUMsR0FBRyxRQUFRLENBQUMsVUFBVTtJQUMzQixJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssSUFBSSxDQUFDLENBQUMsS0FBSyxLQUFLLE1BQU0sRUFBRTtNQUFFLE9BQU8sSUFBSTtJQUFFO0lBQ3pELElBQUksSUFBSTtJQUNSLElBQUksR0FBRyxHQUFHLEtBQUs7SUFDZixJQUFJLEtBQUssR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUM7SUFDaEMsSUFBSSxDQUFDLENBQUMsS0FBSyxLQUFLLFNBQVMsRUFBRTtNQUN2QixJQUFJLEdBQUcsQ0FBQyxDQUFDLG1DQUFtQyxDQUFDO0lBQ2pELENBQUMsTUFBTSxJQUFJLENBQUMsQ0FBQyxLQUFLLEtBQUssTUFBTSxFQUFFO01BQzNCLElBQUksR0FBRyxLQUFLLEdBQUcsQ0FBQyxHQUNWLEVBQUUsQ0FBQyxvQ0FBb0MsRUFBRTtRQUFFLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSTtRQUFFLEtBQUssRUFBRTtNQUFNLENBQUMsQ0FBQyxHQUN4RSxDQUFDLENBQUMsaUNBQWlDLENBQUM7SUFDOUMsQ0FBQyxNQUFNLElBQUksQ0FBQyxDQUFDLEtBQUssS0FBSyxTQUFTLEVBQUU7TUFDOUIsSUFBSSxHQUFHLEVBQUUsQ0FBQyxvQ0FBb0MsRUFBRTtRQUFFLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSTtRQUFFLEtBQUssRUFBRTtNQUFNLENBQUMsQ0FBQztJQUNuRixDQUFDLE1BQU0sSUFBSSxDQUFDLENBQUMsS0FBSyxLQUFLLFNBQVMsRUFBRTtNQUM5QjtNQUNBLElBQUksR0FBRyxDQUFDLENBQUMsSUFBSSxLQUFLLE1BQU0sR0FBRyxDQUFDLENBQUMscUNBQXFDLENBQUMsR0FBRyxDQUFDLENBQUMsb0NBQW9DLENBQUM7SUFDakgsQ0FBQyxNQUFNO01BQ0gsSUFBSSxHQUFHLENBQUMsQ0FBQyxtQ0FBbUMsQ0FBQztNQUM3QyxHQUFHLEdBQUcsSUFBSTtJQUNkO0lBQ0EsSUFBSSxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxLQUFLLEtBQUssU0FBUyxJQUFJLENBQUMsQ0FBQyxLQUFLLEtBQUssTUFBTSxFQUFFO01BQ3ZELElBQUksSUFBSSxLQUFLLEdBQUcsUUFBUSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7SUFDcEM7SUFDQSxPQUFPO01BQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxHQUFHLElBQUksR0FBRyxJQUFJO01BQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLElBQUksRUFBRTtNQUFFLEdBQUcsRUFBRTtJQUFJLENBQUM7RUFDdEc7RUFFQSxTQUFTLGNBQWMsQ0FBQyxRQUFRLEVBQUU7SUFDOUIsSUFBSSxRQUFRLENBQUMsV0FBVyxFQUFFO01BQUUsT0FBTyxDQUFDLENBQUMseUNBQXlDLENBQUM7SUFBRTtJQUNqRixJQUFJLFFBQVEsQ0FBQyxZQUFZLEVBQUU7TUFBRSxPQUFPLENBQUMsQ0FBQywwQ0FBMEMsQ0FBQztJQUFFO0lBQ25GLElBQUksSUFBSSxHQUFHLFFBQVEsQ0FBQyxlQUFlLElBQUksRUFBRTtJQUN6QyxJQUFJLElBQUksS0FBSywyQkFBMkIsRUFBRTtNQUFFLE9BQU8sQ0FBQyxDQUFDLDRDQUE0QyxDQUFDO0lBQUU7SUFDcEcsSUFBSSxJQUFJLEtBQUsscUJBQXFCLElBQUksSUFBSSxLQUFLLHNCQUFzQixJQUFJLElBQUksS0FBSyw2QkFBNkIsSUFDeEcsSUFBSSxLQUFLLHFCQUFxQixJQUFJLElBQUksS0FBSyxtQkFBbUIsSUFBSSxJQUFJLEtBQUssaUJBQWlCLEVBQUU7TUFDakcsT0FBTyxDQUFDLENBQUMscUNBQXFDLENBQUM7SUFDbkQ7SUFDQSxPQUFPLFFBQVEsQ0FBQyxJQUFJLENBQUM7RUFDekI7RUFFQSxTQUFTLFNBQVMsQ0FBQyxFQUFFLEVBQUU7SUFDbkIsS0FBSyxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUMsVUFBVSxLQUFLLEVBQUUsR0FBRyxJQUFJLEdBQUcsRUFBRTtJQUN0RCxhQUFhLENBQUMsQ0FBQztFQUNuQjs7RUFFQTs7RUFFQSxTQUFTLFdBQVcsR0FBRztJQUNuQixJQUFJLE1BQU0sR0FBRyxDQUFDLENBQUMsbUJBQW1CLENBQUM7SUFDbkMsSUFBSSxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQU0sS0FBSyxDQUFDLElBQUksS0FBSyxDQUFDLEtBQUssSUFBSSxVQUFVLEVBQUU7TUFDM0QsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO01BQzNCO0lBQ0o7SUFDQSxNQUFNLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQztJQUMzQixDQUFDLENBQUMsdUJBQXVCLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLGlDQUFpQyxFQUFFO01BQ2xFLElBQUksRUFBRSxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUM7TUFDdEIsRUFBRSxFQUFFLEtBQUssQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxNQUFNO01BQ3pDLEtBQUssRUFBRSxLQUFLLENBQUM7SUFDakIsQ0FBQyxDQUFDLENBQUM7SUFDSCxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLEtBQUssQ0FBQyxNQUFNLElBQUksQ0FBQyxDQUFDO0lBQ3pELENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDLE1BQU0sR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQU0sSUFBSSxLQUFLLENBQUMsS0FBSyxDQUFDO0VBQ2hHOztFQUVBOztFQUVBO0VBQ0EsU0FBUyxjQUFjLENBQUMsYUFBYSxFQUFFLE9BQU8sRUFBRTtJQUM1QyxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxJQUFJLEVBQUUsQ0FBQztFQUMzRTtFQUVBLFNBQVMsZUFBZSxDQUFDLGFBQWEsRUFBRTtJQUNwQyxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO0VBQ25FO0VBRUEsU0FBUyxrQkFBa0IsQ0FBQyxPQUFPLEVBQUU7SUFDakMsY0FBYyxDQUFDLHFCQUFxQixFQUFFLE9BQU8sQ0FBQztFQUNsRDtFQUVBLFNBQVMsbUJBQW1CLEdBQUc7SUFDM0IsZUFBZSxDQUFDLHFCQUFxQixDQUFDO0VBQzFDO0VBRUEsU0FBUyxhQUFhLEdBQUc7SUFDckIsSUFBSSxHQUFHLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDN0QsSUFBSSxJQUFJLEdBQUcsT0FBTyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxRQUFRLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNyRCxJQUFJLElBQUksR0FBRyxDQUFDLElBQUksSUFBSSxHQUFHLEdBQUcsRUFBRTtNQUN4QixrQkFBa0IsQ0FBQyxFQUFFLENBQUMsNkNBQTZDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztNQUN6RTtJQUNKO0lBQ0EsbUJBQW1CLENBQUMsQ0FBQztJQUNyQixRQUFRLENBQUMsV0FBVyxFQUFFO01BQUUscUJBQXFCLEVBQUU7SUFBSyxDQUFDLEVBQUUsWUFBWTtNQUMvRCxLQUFLLENBQUMsU0FBUyxHQUFHLElBQUk7TUFDdEIsU0FBUyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO0lBQ3BELENBQUMsRUFBRSxZQUFZO01BQ1gsa0JBQWtCLENBQUMsRUFBRSxDQUFDLHNDQUFzQyxFQUFFO1FBQzFELElBQUksRUFBRSxDQUFDLENBQUMsdUNBQXVDLENBQUM7UUFDaEQsSUFBSSxFQUFFO01BQ1YsQ0FBQyxDQUFDLENBQUM7TUFDSCxDQUFDLENBQUMscUJBQXFCLENBQUMsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQztJQUNqRCxDQUFDLENBQUM7RUFDTjtFQUVBLFNBQVMsU0FBUyxDQUFDLE9BQU8sRUFBRTtJQUN4QjtJQUNBLElBQUksUUFBUSxHQUFHLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxXQUFXLENBQUM7SUFDckQsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLFFBQVEsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7TUFDdEMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ25EO0lBQ0EsSUFBSSxLQUFLLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7SUFDekMsS0FBSyxDQUFDLFNBQVMsR0FBRyxVQUFVO0lBQzVCLEtBQUssQ0FBQyxZQUFZLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQztJQUNwQyxLQUFLLENBQUMsV0FBVyxHQUFHLE9BQU87SUFDM0IsUUFBUSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDO0lBQ2hDLFVBQVUsQ0FBQyxZQUFZO01BQ25CLElBQUksS0FBSyxDQUFDLFVBQVUsRUFBRTtRQUNsQixLQUFLLENBQUMsVUFBVSxDQUFDLFdBQVcsQ0FBQyxLQUFLLENBQUM7TUFDdkM7SUFDSixDQUFDLEVBQUUsSUFBSSxDQUFDO0VBQ1o7O0VBRUE7O0VBRUEsU0FBUyxPQUFPLENBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRTtJQUMxRCxJQUFJLE9BQU8sR0FBRztNQUNWLEdBQUcsRUFBRSxNQUFNLENBQUMsTUFBTSxHQUFHLFFBQVEsR0FBRyxJQUFJO01BQ3BDLE1BQU0sRUFBRSxNQUFNO01BQ2QsUUFBUSxFQUFFLE1BQU07TUFDaEIsS0FBSyxFQUFFO0lBQ1gsQ0FBQztJQUNELElBQUksT0FBTyxLQUFLLElBQUksSUFBSSxPQUFPLEtBQUssU0FBUyxFQUFFO01BQzNDLE9BQU8sQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUM7TUFDdEMsT0FBTyxDQUFDLFdBQVcsR0FBRyxrQkFBa0I7SUFDNUM7SUFDQSxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLFFBQVEsRUFBRTtNQUNyQyxJQUFJLFFBQVEsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLElBQUksRUFBRTtRQUN0QyxTQUFTLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQztNQUM1QixDQUFDLE1BQU07UUFDSCxTQUFTLENBQUMsZ0JBQWdCLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO01BQzlDO0lBQ0osQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsR0FBRyxFQUFFO01BQ25CLFNBQVMsQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsWUFBWSxJQUFJLElBQUksRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDckUsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLE9BQU8sQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUU7SUFDbEQsT0FBTyxDQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUUsT0FBTyxJQUFJLENBQUMsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLENBQUM7RUFDOUQ7RUFFQSxTQUFTLFNBQVMsQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRTtJQUMzQyxPQUFPLENBQUMsUUFBUSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLFNBQVMsQ0FBQztFQUN2RDtFQUVBLFNBQVMsT0FBTyxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRTtJQUNqRCxDQUFDLENBQUMsSUFBSSxDQUFDO01BQ0gsR0FBRyxFQUFFLE1BQU0sQ0FBQyxNQUFNLEdBQUcsaUJBQWlCLEdBQUcsSUFBSTtNQUM3QyxNQUFNLEVBQUUsS0FBSztNQUNiLElBQUksRUFBRSxNQUFNLElBQUksQ0FBQyxDQUFDO01BQ2xCLEtBQUssRUFBRTtJQUNYLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLFFBQVEsRUFBRTtNQUN4QixJQUFJLFFBQVEsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLElBQUksRUFBRTtRQUN0QyxTQUFTLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQztNQUM1QixDQUFDLE1BQU07UUFDSCxTQUFTLENBQUMsZ0JBQWdCLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO01BQzlDO0lBQ0osQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsR0FBRyxFQUFFO01BQ25CLFNBQVMsQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsWUFBWSxJQUFJLElBQUksRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDckUsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLFdBQVcsQ0FBQyxPQUFPLEVBQUU7SUFDMUIsSUFBSSxPQUFPLElBQUksT0FBTyxDQUFDLEtBQUssRUFBRTtNQUMxQixPQUFPLE9BQU8sQ0FBQyxRQUFRLENBQUMsTUFBTSxHQUFHLENBQUMsR0FBRyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxLQUFLO0lBQzVFO0lBQ0EsT0FBUSxPQUFPLElBQUksT0FBTyxDQUFDLEtBQUssR0FBSSxPQUFPLENBQUMsS0FBSyxHQUFHLFlBQVk7RUFDcEU7O0VBRUE7O0VBRUEsU0FBUyxPQUFPLENBQUMsRUFBRSxFQUFFO0lBQ2pCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtNQUN4QyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLLE1BQU0sQ0FBQyxFQUFFLENBQUMsRUFBRTtRQUN6QyxPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO01BQ3hCO0lBQ0o7SUFDQSxPQUFPLElBQUk7RUFDZjtFQUVBLFNBQVMsVUFBVSxDQUFDLEdBQUcsRUFBRTtJQUNyQixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7TUFDeEMsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsS0FBSyxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFO1FBQzdDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRztRQUNuQjtNQUNKO0lBQ0o7SUFDQSxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUM7RUFDeEI7RUFFQSxTQUFTLFFBQVEsQ0FBQyxNQUFNLEVBQUU7SUFDdEIsSUFBSSxDQUFDLE1BQU0sRUFBRTtNQUNULEtBQUssQ0FBQyxVQUFVLEdBQUcsS0FBSztNQUN4QixrQkFBa0IsQ0FBQyxDQUFDO0lBQ3hCO0lBQ0EsTUFBTSxDQUFDLE9BQU8sRUFBRTtNQUFFLEtBQUssRUFBRTtJQUFJLENBQUMsRUFBRSxVQUFVLElBQUksRUFBRTtNQUM1QyxLQUFLLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLElBQUksRUFBRTtNQUM3QixLQUFLLENBQUMsVUFBVSxHQUFHLElBQUk7TUFDdkIsS0FBSyxDQUFDLFNBQVMsR0FBRyxJQUFJO01BQ3RCLFVBQVUsQ0FBQyxDQUFDO01BQ1osV0FBVyxDQUFDLENBQUM7TUFDYixtQkFBbUIsQ0FBQyxDQUFDO0lBQ3pCLENBQUMsRUFBRSxVQUFVLE9BQU8sRUFBRTtNQUNsQixLQUFLLENBQUMsVUFBVSxHQUFHLElBQUk7TUFDdkIsS0FBSyxDQUFDLFNBQVMsR0FBRyxPQUFPO01BQ3pCLFVBQVUsQ0FBQyxDQUFDO01BQ1osV0FBVyxDQUFDLENBQUM7SUFDakIsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLGtCQUFrQixHQUFHO0lBQzFCLElBQUksSUFBSSxHQUFHLHlIQUF5SCxHQUM5SCxnSEFBZ0gsR0FDaEgsd0VBQXdFO0lBQzlFLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQztFQUNuQzs7RUFFQTtFQUNBLFNBQVMsY0FBYyxHQUFHO0lBQ3RCLE9BQU8sa0NBQWtDLEdBQ25DLGtHQUFrRyxHQUNsRyxvRkFBb0YsR0FDcEYsNkZBQTZGLEdBQzdGLGlGQUFpRixHQUNqRixRQUFRO0VBQ2xCO0VBRUEsU0FBUyxVQUFVLEdBQUc7SUFDbEIsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDLFVBQVUsQ0FBQztJQUN6QixJQUFJLEtBQUssQ0FBQyxTQUFTLEtBQUssSUFBSSxJQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtNQUNyRCxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUM7TUFDckMsS0FBSyxDQUFDLElBQUksQ0FBQyxnREFBZ0QsR0FBRyxVQUFVLEdBQ2xFLHVCQUF1QixHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMscUNBQXFDLENBQUMsQ0FBQyxHQUFHLFFBQVEsR0FDbEYsaUZBQWlGLEdBQ2pGLEdBQUcsQ0FBQyxDQUFDLENBQUMsa0NBQWtDLENBQUMsQ0FBQyxHQUFHLGlCQUFpQixDQUFDO01BQ3JFLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsWUFBWTtRQUFFLFFBQVEsQ0FBQyxDQUFDO01BQUUsQ0FBQyxDQUFDO01BQzVEO0lBQ0o7SUFDQSxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRTtNQUNuQjtJQUNKO0lBQ0EsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxHQUFHLElBQUksR0FBRyxJQUFJLENBQUM7SUFDcEUsSUFBSSxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUU7TUFDekIsS0FBSyxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDO01BQzVCO0lBQ0o7SUFDQSxJQUFJLElBQUksR0FBRywyQkFBMkI7SUFDdEMsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO01BQ3hDLElBQUksSUFBSSxhQUFhLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN4QztJQUNBLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxHQUFHLFFBQVEsQ0FBQztFQUMvQjtFQUVBLFNBQVMsYUFBYSxDQUFDLEdBQUcsRUFBRTtJQUN4QixJQUFJLFFBQVEsR0FBRyxLQUFLLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsS0FBSyxJQUFJO0lBQ2xELElBQUksSUFBSSxHQUFHLEVBQUU7SUFDYixJQUFJLFFBQVEsRUFBRTtNQUNWLElBQUksR0FBRywyQkFBMkIsR0FBRyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsR0FBRyxjQUFjLENBQUMsR0FBRyxDQUFDLEdBQUcsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLEdBQUcsUUFBUTtJQUMxSDtJQUNBLElBQUksU0FBUyxHQUFHLENBQUMsR0FBRyxDQUFDLEtBQUssSUFBSSxFQUFFLEVBQUUsTUFBTTtJQUN4QyxJQUFJLElBQUksR0FBRyxFQUFFO0lBQ2IsSUFBSSxHQUFHLENBQUMsWUFBWSxFQUFFO01BQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDLFlBQVksQ0FBQztJQUFFO0lBQzNELElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUMsb0NBQW9DLEVBQUU7TUFBRSxLQUFLLEVBQUU7SUFBVSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsbUNBQW1DLENBQUMsQ0FBQztJQUNsSSxPQUFPLHdCQUF3QixJQUFJLFFBQVEsR0FBRyxVQUFVLEdBQUcsRUFBRSxDQUFDLEdBQUcsaUJBQWlCLEdBQUcsR0FBRyxDQUFDLEVBQUUsR0FBRyxJQUFJLEdBQzVGLDBGQUEwRixJQUFJLFFBQVEsR0FBRyxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsSUFBSSxHQUNqSSw0QkFBNEIsSUFBSSxHQUFHLENBQUMsT0FBTyxLQUFLLEtBQUssR0FBRyxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsdUJBQXVCLElBQUksR0FBRyxDQUFDLE9BQU8sS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLFNBQVMsR0FDcEosb0RBQW9ELEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxNQUFNLEdBQzlFLG9DQUFvQyxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsZUFBZSxHQUM5RSw4QkFBOEIsR0FBRyxhQUFhLENBQUMsR0FBRyxDQUFDLEdBQUcsU0FBUyxHQUMvRCw4Q0FBOEMsR0FDOUMsZ0VBQWdFLElBQUksUUFBUSxHQUFHLEtBQUssR0FBRyxHQUFHLENBQUMsR0FBRyw4Q0FBOEMsR0FDNUksZUFBZSxHQUFHLElBQUksR0FBRyxRQUFRO0VBQzNDO0VBRUEsU0FBUyxhQUFhLENBQUMsR0FBRyxFQUFFO0lBQ3hCLElBQUksR0FBRyxDQUFDLE9BQU8sS0FBSyxLQUFLLEVBQUU7TUFDdkIsT0FBTyx1QkFBdUIsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHdDQUF3QyxDQUFDLENBQUMsR0FBRyxTQUFTO0lBQ2pHO0lBQ0EsSUFBSSxHQUFHLENBQUMsTUFBTSxLQUFLLElBQUksRUFBRTtNQUNyQixPQUFPLDZCQUE2QixHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsa0NBQWtDLENBQUMsQ0FBQyxHQUFHLFNBQVM7SUFDakc7SUFDQSxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssZUFBZSxFQUFFO01BQ2hDLE9BQU8sNkJBQTZCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyw0Q0FBNEMsQ0FBQyxDQUFDLEdBQUcsU0FBUztJQUMzRztJQUNBLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxVQUFVLEVBQUU7TUFDM0IsT0FBTyw2QkFBNkIsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLENBQUMsR0FBRyxTQUFTO0lBQ3RHO0lBQ0EsSUFBSSxHQUFHLENBQUMsTUFBTSxLQUFLLE9BQU8sRUFBRTtNQUN4QixPQUFPLGdDQUFnQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsMkNBQTJDLENBQUMsQ0FBQyxHQUFHLFNBQVM7SUFDN0c7SUFDQSxPQUFPLHVCQUF1QixHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsbUNBQW1DLENBQUMsQ0FBQyxHQUFHLFNBQVM7RUFDNUY7O0VBRUE7RUFDQTtFQUNBLFNBQVMsbUJBQW1CLENBQUMsR0FBRyxFQUFFO0lBQzlCLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxVQUFVLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxFQUFFO01BQ2pFLE9BQU8sRUFBRTtJQUNiO0lBQ0EsT0FBTyw4Q0FBOEMsR0FDL0MsOEhBQThILEdBQzlILE9BQU8sR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLENBQUMsR0FBRyxJQUFJLEdBQ2hFLEdBQUcsQ0FBQyxDQUFDLENBQUMscUNBQXFDLENBQUMsQ0FBQyxHQUFHLGNBQWM7RUFDeEU7RUFFQSxTQUFTLGFBQWEsQ0FBQyxJQUFJLEVBQUU7SUFDekIsSUFBSSxJQUFJLEtBQUssU0FBUyxFQUFFO01BQUUsT0FBTyxDQUFDLENBQUMsc0NBQXNDLENBQUM7SUFBRTtJQUM1RSxJQUFJLElBQUksS0FBSyxTQUFTLEVBQUU7TUFBRSxPQUFPLENBQUMsQ0FBQyxzQ0FBc0MsQ0FBQztJQUFFO0lBQzVFLE9BQU8sQ0FBQyxDQUFDLG9DQUFvQyxDQUFDO0VBQ2xEO0VBRUEsU0FBUyxjQUFjLENBQUMsR0FBRyxFQUFFO0lBQ3pCLElBQUksS0FBSyxHQUFHLEdBQUcsQ0FBQyxLQUFLLElBQUksRUFBRTtJQUMzQixJQUFJLEtBQUssQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO01BQ3BCLE9BQU8sdUNBQXVDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDLEdBQUcsUUFBUTtJQUM5RztJQUNBLElBQUksSUFBSSxHQUFHLDRCQUE0QjtJQUN2QyxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtNQUNuQyxJQUFJLElBQUksYUFBYSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDeEM7SUFDQSxPQUFPLElBQUksR0FBRyxRQUFRO0VBQzFCO0VBRUEsU0FBUyxhQUFhLENBQUMsR0FBRyxFQUFFLElBQUksRUFBRTtJQUM5QixJQUFJLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxLQUFLLE1BQU07SUFDaEMsSUFBSSxTQUFTO0lBQ2IsSUFBSSxJQUFJLEVBQUU7TUFDTixTQUFTLEdBQUcsb0NBQW9DLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxJQUFJLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDLEdBQUcsU0FBUztJQUMvSSxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsYUFBYSxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsTUFBTSxLQUFLLFFBQVEsRUFBRTtNQUNyRSxTQUFTLEdBQUcsNkJBQTZCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDLEdBQUcsU0FBUztJQUMxRyxDQUFDLE1BQU07TUFDSCxTQUFTLEdBQUcsNkJBQTZCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFDLEdBQUcsU0FBUztJQUN2RztJQUNBLE9BQU8seUNBQXlDLEdBQUcsSUFBSSxDQUFDLEVBQUUsR0FBRyxJQUFJLEdBQzNELHdEQUF3RCxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxTQUFTLEdBQ3RHLDJCQUEyQixHQUFHLEdBQUcsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEdBQUcsZ0JBQWdCLEdBQ25GLGNBQWMsQ0FBQyxJQUFJLENBQUMsR0FDcEIsOEJBQThCLEdBQUcsU0FBUyxHQUFHLFNBQVMsR0FDdEQsa0NBQWtDLElBQUksSUFBSSxDQUFDLE9BQU8sR0FBRyxVQUFVLEdBQUcsRUFBRSxDQUFDLElBQUksSUFBSSxHQUFHLFdBQVcsR0FBRyxFQUFFLENBQUMsR0FBRyxnQkFBZ0IsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLG9DQUFvQyxDQUFDLENBQUMsR0FBRyxJQUFJLEdBQzFLLHNEQUFzRCxJQUFJLElBQUksQ0FBQyxPQUFPLEdBQUcsVUFBVSxHQUFHLEVBQUUsQ0FBQyxJQUFJLElBQUksR0FBRyxXQUFXLEdBQUcsRUFBRSxDQUFDLEdBQUcsR0FBRyxHQUMzSCx3Q0FBd0MsR0FDeEMsUUFBUTtFQUNsQjtFQUVBLFNBQVMsY0FBYyxDQUFDLElBQUksRUFBRTtJQUMxQixJQUFJLE9BQU8sR0FBRyxvQkFBb0IsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLENBQUMsR0FBRyxXQUFXO0lBQ2hHLElBQUksS0FBSyxHQUFHLEtBQUs7SUFDakIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO01BQzdDLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDO01BQ2pDLElBQUksUUFBUSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLEtBQUssTUFBTSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUM7TUFDbEUsSUFBSSxRQUFRLEVBQUU7UUFBRSxLQUFLLEdBQUcsSUFBSTtNQUFFO01BQzlCLE9BQU8sSUFBSSxpQkFBaUIsR0FBRyxRQUFRLENBQUMsRUFBRSxHQUFHLEdBQUcsSUFBSSxRQUFRLEdBQUcsV0FBVyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxHQUFHLFdBQVc7SUFDOUg7SUFDQSxJQUFJLENBQUMsS0FBSyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxFQUFFO01BQzNDLE9BQU8sSUFBSSxpQkFBaUIsR0FBRyxJQUFJLENBQUMsY0FBYyxHQUFHLGNBQWMsR0FBRyxJQUFJLENBQUMsY0FBYyxHQUFHLFdBQVc7SUFDM0c7SUFDQSxPQUFPLGlEQUFpRCxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsbUNBQW1DLENBQUMsQ0FBQyxHQUFHLElBQUksR0FBRyxPQUFPLEdBQUcsV0FBVztFQUN6STtFQUVBLFNBQVMsZ0JBQWdCLENBQUMsR0FBRyxFQUFFO0lBQzNCLE9BQU8sOEJBQThCLEdBQy9CLG9DQUFvQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsd0NBQXdDLENBQUMsQ0FBQyxHQUFHLE1BQU0sR0FDaEcsaUNBQWlDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDLEdBQUcsTUFBTSxHQUMxRixpQ0FBaUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLENBQUMsR0FBRyxNQUFNLEdBQzFGLFFBQVE7RUFDbEI7O0VBRUE7O0VBRUEsU0FBUyxpQkFBaUIsR0FBRztJQUN6QixJQUFJLEtBQUssR0FBRyxDQUFDLENBQUMsVUFBVSxDQUFDO0lBQ3pCLEtBQUssQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLHdCQUF3QixFQUFFLFlBQVk7TUFDcEQsSUFBSSxFQUFFLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO01BQzlELEtBQUssQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUMsS0FBSyxJQUFJO01BQ3hELFVBQVUsQ0FBQyxDQUFDO0lBQ2hCLENBQUMsQ0FBQztJQUNGLEtBQUssQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLHdCQUF3QixFQUFFLFVBQVUsS0FBSyxFQUFFO01BQzNELElBQUksS0FBSyxDQUFDLEdBQUcsS0FBSyxPQUFPLElBQUksS0FBSyxDQUFDLEdBQUcsS0FBSyxHQUFHLEVBQUU7UUFDNUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBQ3RCLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDO01BQzVCO0lBQ0osQ0FBQyxDQUFDO0lBQ0YsS0FBSyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUseUJBQXlCLEVBQUUsWUFBWTtNQUFFLFlBQVksQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7SUFBRSxDQUFDLENBQUM7SUFDakgsS0FBSyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUseUJBQXlCLEVBQUUsVUFBVSxLQUFLLEVBQUU7TUFDMUQsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDO01BQ3RCLGFBQWEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztJQUN6RSxDQUFDLENBQUM7SUFDRixLQUFLLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSxVQUFVLEtBQUssRUFBRTtNQUN2RCxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUM7TUFDdEIsYUFBYSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQztJQUMvRSxDQUFDLENBQUM7SUFDRixLQUFLLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSxVQUFVLEtBQUssRUFBRTtNQUN2RCxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUM7TUFDdEIsWUFBWSxDQUFDLE1BQU0sRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztJQUNoRixDQUFDLENBQUM7SUFDRixLQUFLLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxpQkFBaUIsRUFBRSxZQUFZO01BQzlDLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQztNQUN6RCxJQUFJLE1BQU0sR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7TUFDNUQsSUFBSSxPQUFPLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7TUFDckMsUUFBUSxDQUFDLEtBQUssRUFBRTtRQUFFLEtBQUssRUFBRSxDQUFDO1VBQUUsRUFBRSxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUM7VUFBRSxPQUFPLEVBQUU7UUFBUSxDQUFDO01BQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxZQUFZO1FBQ3JGLFFBQVEsQ0FBQyxJQUFJLENBQUM7UUFDZCxTQUFTLENBQUMsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7TUFDekQsQ0FBQyxDQUFDO0lBQ04sQ0FBQyxDQUFDO0lBQ0YsS0FBSyxDQUFDLEVBQUUsQ0FBQyxRQUFRLEVBQUUscUJBQXFCLEVBQUUsWUFBWTtNQUNsRCxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUM7TUFDekQsSUFBSSxNQUFNLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO01BQzVELFFBQVEsQ0FBQyxLQUFLLEVBQUU7UUFBRSxLQUFLLEVBQUUsQ0FBQztVQUFFLEVBQUUsRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDO1VBQUUsY0FBYyxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7UUFBRSxDQUFDO01BQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxZQUFZO1FBQzFHLFFBQVEsQ0FBQyxJQUFJLENBQUM7UUFDZCxTQUFTLENBQUMsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7TUFDekQsQ0FBQyxDQUFDO0lBQ04sQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLFFBQVEsQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUU7SUFDcEQsUUFBUSxDQUFDLFFBQVEsR0FBRyxLQUFLLEVBQUUsT0FBTyxFQUFFLFVBQVUsR0FBRyxFQUFFO01BQy9DLFVBQVUsQ0FBQyxHQUFHLENBQUM7TUFDZixVQUFVLENBQUMsQ0FBQztNQUNaLElBQUksU0FBUyxFQUFFO1FBQUUsU0FBUyxDQUFDLEdBQUcsQ0FBQztNQUFFO0lBQ3JDLENBQUMsRUFBRSxTQUFTLElBQUksVUFBVSxPQUFPLEVBQUU7TUFDL0IsU0FBUyxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNuQyxDQUFDLENBQUM7RUFDTjs7RUFFQTs7RUFFQSxTQUFTLGFBQWEsQ0FBQyxJQUFJLEVBQUU7SUFDekIsSUFBSSxLQUFLLENBQUMsZUFBZSxFQUFFO01BQ3ZCLElBQUksQ0FBQyxDQUFDO01BQ047SUFDSjtJQUNBLE9BQU8sQ0FBQyxhQUFhLEVBQUU7TUFBRSxLQUFLLEVBQUU7SUFBSSxDQUFDLEVBQUUsVUFBVSxJQUFJLEVBQUU7TUFDbkQsSUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssSUFBSSxFQUFFO01BQzVCLElBQUksSUFBSSxHQUFHLENBQUMsQ0FBQztNQUNiLElBQUksSUFBSSxHQUFHLEVBQUU7TUFDYixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtRQUNuQyxJQUFJLElBQUksR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDO1FBQ25CLElBQUksTUFBTSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDO1FBQ2hDLElBQUksQ0FBQyxNQUFNLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFO1VBQ3pCO1FBQ0o7UUFDQSxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsSUFBSTtRQUNuQixJQUFJLElBQUksR0FBRyxJQUFJLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQyxNQUFNLElBQUssR0FBRyxHQUFHLE1BQU87UUFDekQsSUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEVBQUU7UUFDbkQsSUFBSSxLQUFLLEdBQUksTUFBTSxLQUFLLEVBQUUsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFJLElBQUksR0FBRyxJQUFJLEdBQUcsTUFBTSxHQUFHLEdBQUcsR0FBRyxJQUFJO1FBQ3RHLElBQUksQ0FBQyxJQUFJLENBQUM7VUFBRSxFQUFFLEVBQUUsTUFBTTtVQUFFLEtBQUssRUFBRTtRQUFNLENBQUMsQ0FBQztNQUMzQztNQUNBLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQyxFQUFFO1FBQUUsT0FBTyxDQUFDLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDO01BQUUsQ0FBQyxDQUFDO01BQ3JFLEtBQUssQ0FBQyxTQUFTLEdBQUcsSUFBSTtNQUN0QixLQUFLLENBQUMsZUFBZSxHQUFHLElBQUk7TUFDNUIsS0FBSyxDQUFDLGVBQWUsR0FBRyxLQUFLO01BQzdCLElBQUksQ0FBQyxDQUFDO0lBQ1YsQ0FBQyxFQUFFLFlBQVk7TUFDWCxLQUFLLENBQUMsZUFBZSxHQUFHLEtBQUs7TUFDN0IsS0FBSyxDQUFDLGVBQWUsR0FBRyxJQUFJO01BQzVCLElBQUksQ0FBQyxDQUFDO0lBQ1YsQ0FBQyxDQUFDO0VBQ047O0VBRUE7O0VBRUE7RUFDQTtFQUNBLElBQUksZ0JBQWdCLEdBQUcsQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDO0VBRTFDLFNBQVMsWUFBWSxDQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsT0FBTyxFQUFFO0lBQ3RDLEtBQUssQ0FBQyxRQUFRLEdBQUc7TUFDYixJQUFJLEVBQUUsSUFBSTtNQUNWLEdBQUcsRUFBRSxHQUFHO01BQ1IsT0FBTyxFQUFFLElBQUksS0FBSyxNQUFNLElBQUksR0FBRyxHQUFJLEdBQUcsQ0FBQyxPQUFPLElBQUksVUFBVSxHQUFLLE9BQU8sS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHLFVBQVc7TUFDeEcsT0FBTyxFQUFFLENBQUM7TUFDVixLQUFLLEVBQUUsS0FBSztNQUNaLFlBQVksRUFBRSxLQUFLO01BQ25CLElBQUksRUFBRTtJQUNWLENBQUM7SUFDRCxDQUFDLENBQUMsdUJBQXVCLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUNsQyxDQUFDLENBQUMscUJBQXFCLENBQUMsQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDO0lBQzdDLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUM7SUFDM0MsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksS0FBSyxNQUFNLEdBQUcsRUFBRSxDQUFDLG1DQUFtQyxFQUFFO01BQUUsS0FBSyxFQUFFLEdBQUcsQ0FBQztJQUFNLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO0lBQ3RKLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQyxLQUFLLEdBQUcsRUFBRSxDQUFDO0lBQzVDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO0lBQzFCLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7SUFDOUIsQ0FBQyxDQUFDLHVCQUF1QixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUM7SUFDL0MsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLEtBQUssTUFBTSxHQUFHLElBQUksR0FBRyxJQUFJLENBQUM7SUFDakUsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLEtBQUssTUFBTSxHQUFHLENBQUMsQ0FBQyw4QkFBOEIsQ0FBQyxHQUFHLENBQUMsQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFDO0lBQ3pILElBQUksSUFBSSxLQUFLLE1BQU0sRUFBRTtNQUNqQixDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQztNQUMzQyxDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO01BQ2hELENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLElBQUksR0FBRyxDQUFDLFVBQVUsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUNqRSxDQUFDLE1BQU07TUFDSCxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO01BQzNDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO0lBQ3BEO0lBQ0EsY0FBYyxDQUFDLENBQUM7SUFDaEIsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLEtBQUssQ0FBQztNQUFFLFFBQVEsRUFBRTtJQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUM7SUFDM0QsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUM7RUFDdkM7RUFFQSxTQUFTLGNBQWMsR0FBRztJQUN0QixJQUFJLEtBQUssR0FBRyxLQUFLLENBQUMsUUFBUTtJQUMxQixJQUFJLENBQUMsS0FBSyxFQUFFO01BQUU7SUFBUTtJQUN0QixDQUFDLENBQUMsZ0NBQWdDLENBQUMsQ0FBQyxJQUFJLENBQUMsWUFBWTtNQUNqRCxJQUFJLE9BQU8sR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztNQUM3QyxJQUFJLFFBQVEsR0FBRyxPQUFPLEtBQUssS0FBSyxDQUFDLE9BQU87TUFDeEMsSUFBSSxNQUFNLEdBQUcsS0FBSyxDQUFDLElBQUksS0FBSyxNQUFNLElBQUksQ0FBQyxRQUFRO01BQy9DLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxXQUFXLENBQUMsYUFBYSxFQUFFLFFBQVEsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDLENBQzFFLElBQUksQ0FBQyxlQUFlLEVBQUUsTUFBTSxHQUFHLE1BQU0sR0FBRyxJQUFJLENBQUM7TUFDbEQsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFFBQVEsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDO0lBQzVFLENBQUMsQ0FBQztJQUNGLElBQUksT0FBTyxHQUFHLGdCQUFnQixDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQztJQUMxRCxDQUFDLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsT0FBTyxDQUFDLENBQUMsV0FBVyxDQUFDLFVBQVUsRUFBRSxDQUFDLE9BQU8sQ0FBQztJQUM3RjtJQUNBLElBQUksT0FBTyxHQUFHLEtBQUssQ0FBQyxPQUFPLEtBQUssS0FBSztJQUNyQyxDQUFDLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxHQUFHLENBQUMsQ0FBQyxzQ0FBc0MsQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUN0RixDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLE9BQU8sR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFDO0VBQ3JFO0VBRUEsU0FBUyxZQUFZLENBQUMsSUFBSSxFQUFFO0lBQ3hCLE9BQU8sTUFBTSxDQUFDLElBQUksSUFBSSxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQztFQUN2RDtFQUVBLFNBQVMsWUFBWSxHQUFHO0lBQ3BCLE9BQU8sQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQztFQUN2RztFQUVBLFNBQVMsYUFBYSxHQUFHO0lBQ3JCLE9BQU87TUFDSCxLQUFLLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO01BQ3BELEtBQUssRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7TUFDcEQsUUFBUSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQztJQUM5RCxDQUFDO0VBQ0w7RUFFQSxTQUFTLGNBQWMsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFO0lBQ2hDLElBQUksR0FBRyxHQUFHLElBQUksS0FBSyxJQUFJLEdBQUcscUJBQXFCLEdBQUksSUFBSSxLQUFLLE1BQU0sR0FBRyxvQkFBb0IsR0FBRyxxQkFBc0I7SUFDbEgsSUFBSSxJQUFJLEdBQUcsSUFBSSxLQUFLLElBQUksR0FDbEIsc0VBQXNFLEdBQ3RFLGdFQUFnRTtJQUN0RSxDQUFDLENBQUMsdUJBQXVCLENBQUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxHQUFHLEdBQUcsR0FBRyxrQkFBa0IsR0FDbkUsMkRBQTJELEdBQUcsSUFBSSxHQUFHLFFBQVEsR0FDN0UsT0FBTyxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsR0FBRyxjQUFjLENBQUM7RUFDL0M7RUFFQSxTQUFTLGVBQWUsQ0FBQyxHQUFHLEVBQUU7SUFDMUIsSUFBSSxHQUFHLENBQUMsTUFBTSxLQUFLLElBQUksRUFBRTtNQUNyQixPQUFPO1FBQUUsSUFBSSxFQUFFLElBQUk7UUFBRSxJQUFJLEVBQUUsRUFBRSxDQUFDLG1DQUFtQyxFQUFFO1VBQy9ELFFBQVEsRUFBRSxHQUFHLENBQUMsWUFBWSxJQUFJLEdBQUcsQ0FBQyxlQUFlO1VBQ2pELElBQUksRUFBRSxHQUFHLENBQUMsWUFBWSxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsWUFBWSxHQUFHLEdBQUcsQ0FBQztRQUMxRCxDQUFDO01BQUUsQ0FBQztJQUNSO0lBQ0EsSUFBSSxHQUFHLENBQUMsZUFBZSxLQUFLLFdBQVcsRUFBRTtNQUNyQyxPQUFPO1FBQUUsSUFBSSxFQUFFLE1BQU07UUFBRSxJQUFJLEVBQUUsRUFBRSxDQUFDLHNDQUFzQyxFQUFFO1VBQ3BFLFFBQVEsRUFBRSxHQUFHLENBQUMsWUFBWSxJQUFJLEVBQUU7VUFDaEMsR0FBRyxFQUFFLEdBQUcsQ0FBQztRQUNiLENBQUM7TUFBRSxDQUFDO0lBQ1I7SUFDQSxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssZUFBZSxFQUFFO01BQ2hDLE9BQU87UUFBRSxJQUFJLEVBQUUsS0FBSztRQUFFLElBQUksRUFBRSxDQUFDLENBQUMsb0NBQW9DO01BQUUsQ0FBQztJQUN6RTtJQUNBLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxVQUFVLElBQUksWUFBWSxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsRUFBRTtNQUNoRSxPQUFPO1FBQUUsSUFBSSxFQUFFLEtBQUs7UUFBRSxJQUFJLEVBQUUsWUFBWSxDQUFDO01BQUUsQ0FBQztJQUNoRDtJQUNBLE9BQU87TUFBRSxJQUFJLEVBQUUsTUFBTTtNQUFFLElBQUksRUFBRSxDQUFDLENBQUMsc0NBQXNDLENBQUMsSUFBSSxHQUFHLENBQUMsZUFBZSxHQUFHLElBQUksR0FBRyxHQUFHLENBQUMsZUFBZSxHQUFHLEdBQUcsR0FBRyxFQUFFO0lBQUUsQ0FBQztFQUM1STtFQUVBLFNBQVMsWUFBWSxHQUFHO0lBQ3BCLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUSxJQUFJLGdCQUFnQixDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRTtNQUN6RTtJQUNKO0lBQ0EsSUFBSSxNQUFNLEdBQUcsYUFBYSxDQUFDLENBQUM7SUFDNUIsSUFBSSxNQUFNLENBQUMsS0FBSyxLQUFLLEVBQUUsRUFBRTtNQUNyQixDQUFDLENBQUMscUJBQXFCLENBQUMsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDO01BQzFDLGNBQWMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7TUFDakU7SUFDSjtJQUNBLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUM7SUFDN0MsSUFBSSxJQUFJLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJO0lBQzlCLElBQUksT0FBTztJQUNYLElBQUksSUFBSSxHQUFHLFNBQVAsSUFBSSxDQUFhLEdBQUcsRUFBRTtNQUN0QixLQUFLLENBQUMsUUFBUSxDQUFDLEdBQUcsR0FBRyxHQUFHO01BQ3hCLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxHQUFHLEdBQUcsQ0FBQyxFQUFFO01BQy9CLFVBQVUsQ0FBQyxHQUFHLENBQUM7TUFDZixJQUFJLE9BQU8sR0FBRyxlQUFlLENBQUMsR0FBRyxDQUFDO01BQ2xDLGNBQWMsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxJQUFJLENBQUM7SUFDOUMsQ0FBQztJQUNELElBQUksT0FBTyxHQUFHLFNBQVYsT0FBTyxDQUFhLEdBQUcsRUFBRTtNQUN6QixJQUFJLEdBQUcsQ0FBQyxLQUFLLEtBQUssT0FBTyxFQUFFO1FBQ3ZCLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUM7TUFDNUM7TUFDQSxjQUFjLENBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUMzQyxDQUFDO0lBQ0QsSUFBSSxJQUFJLEtBQUssS0FBSyxFQUFFO01BQ2hCLE9BQU8sR0FBRztRQUFFLE9BQU8sRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLE9BQU87UUFBRSxLQUFLLEVBQUUsTUFBTSxDQUFDLEtBQUs7UUFBRSxLQUFLLEVBQUUsTUFBTSxDQUFDO01BQU0sQ0FBQztNQUN2RixJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxHQUFHLENBQUMsRUFBRTtRQUM1QixRQUFRLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFO1VBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQyxLQUFLO1VBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQztRQUFNLENBQUMsRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDO01BQzVHLENBQUMsTUFBTTtRQUNILE9BQU8sQ0FBQyxPQUFPLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxPQUFPLENBQUM7TUFDNUM7TUFDQTtJQUNKO0lBQ0EsSUFBSSxNQUFNLENBQUMsUUFBUSxLQUFLLEVBQUUsRUFBRTtNQUN4QixPQUFPLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsR0FBRyxhQUFhLEVBQUU7UUFBRSxLQUFLLEVBQUUsTUFBTSxDQUFDO01BQVMsQ0FBQyxFQUFFLFVBQVUsSUFBSSxFQUFFO1FBQ2xHLElBQUksSUFBSSxDQUFDLEVBQUUsRUFBRTtVQUNULGNBQWMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLG1DQUFtQyxFQUFFO1lBQ3pELFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUTtZQUN2QixJQUFJLEVBQUUsSUFBSSxDQUFDO1VBQ2YsQ0FBQyxDQUFDLENBQUM7UUFDUCxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsVUFBVSxLQUFLLFdBQVcsRUFBRTtVQUN4QyxjQUFjLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxzQ0FBc0MsRUFBRTtZQUM5RCxRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVEsSUFBSSxFQUFFO1lBQzdCLEdBQUcsRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQztVQUM1QixDQUFDLENBQUMsQ0FBQztRQUNQLENBQUMsTUFBTSxJQUFJLElBQUksQ0FBQyxVQUFVLEtBQUssMkJBQTJCLElBQUksSUFBSSxDQUFDLFVBQVUsS0FBSyxzQkFBc0IsRUFBRTtVQUN0RyxjQUFjLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFDO1FBQ2xFLENBQUMsTUFBTSxJQUFJLFlBQVksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUU7VUFDdEMsY0FBYyxDQUFDLEtBQUssRUFBRSxZQUFZLENBQUMsQ0FBQyxDQUFDO1FBQ3pDLENBQUMsTUFBTTtVQUNILGNBQWMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLHNDQUFzQyxDQUFDLEdBQUcsSUFBSSxHQUFHLElBQUksQ0FBQyxVQUFVLEdBQUcsR0FBRyxDQUFDO1FBQ3BHO01BQ0osQ0FBQyxFQUFFLE9BQU8sQ0FBQztNQUNYO0lBQ0o7SUFDQSxPQUFPLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsR0FBRyxhQUFhLEVBQUUsQ0FBQyxDQUFDLEVBQUUsVUFBVSxJQUFJLEVBQUU7TUFDMUUsUUFBUSxDQUFDLElBQUksQ0FBQztNQUNkLElBQUksSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUNULGNBQWMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLG1DQUFtQyxFQUFFO1VBQ3pELFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUTtVQUN2QixJQUFJLEVBQUUsSUFBSSxDQUFDO1FBQ2YsQ0FBQyxDQUFDLENBQUM7TUFDUCxDQUFDLE1BQU0sSUFBSSxZQUFZLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxFQUFFO1FBQ3RDLGNBQWMsQ0FBQyxLQUFLLEVBQUUsWUFBWSxDQUFDLENBQUMsQ0FBQztNQUN6QyxDQUFDLE1BQU07UUFDSCxjQUFjLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFDO01BQ2xFO0lBQ0osQ0FBQyxFQUFFLE9BQU8sQ0FBQztFQUNmO0VBRUEsU0FBUyxXQUFXLEdBQUc7SUFDbkIsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLElBQUksZ0JBQWdCLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFO01BQ3pFO0lBQ0o7SUFDQSxJQUFJLE1BQU0sR0FBRyxhQUFhLENBQUMsQ0FBQztJQUM1QixJQUFJLE1BQU0sQ0FBQyxLQUFLLEtBQUssRUFBRSxFQUFFO01BQ3JCLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUM7TUFDMUMsY0FBYyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsdUNBQXVDLENBQUMsQ0FBQztNQUNqRTtJQUNKO0lBQ0EsSUFBSSxJQUFJLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJO0lBQzlCLElBQUksTUFBTSxHQUFHLFNBQVQsTUFBTSxDQUFhLEdBQUcsRUFBRTtNQUN4QixLQUFLLENBQUMsUUFBUSxDQUFDLEtBQUssR0FBRyxJQUFJO01BQzNCLFVBQVUsQ0FBQyxHQUFHLENBQUM7TUFDZixDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztNQUNoQyxRQUFRLENBQUMsSUFBSSxDQUFDO01BQ2QsSUFBSSxJQUFJLEtBQUssS0FBSyxFQUFFO1FBQ2hCLGFBQWEsQ0FBQyxHQUFHLENBQUM7TUFDdEIsQ0FBQyxNQUFNO1FBQ0gsU0FBUyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO01BQ3BEO0lBQ0osQ0FBQztJQUNELElBQUksT0FBTyxHQUFHLFNBQVYsT0FBTyxDQUFhLEdBQUcsRUFBRTtNQUN6QixJQUFJLEdBQUcsQ0FBQyxLQUFLLEtBQUssT0FBTyxFQUFFO1FBQ3ZCLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUM7TUFDNUM7TUFDQSxjQUFjLENBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUMzQyxDQUFDO0lBQ0QsSUFBSSxJQUFJLEtBQUssS0FBSyxFQUFFO01BQ2hCLElBQUksTUFBTSxHQUFHLFNBQVQsTUFBTSxDQUFhLEVBQUUsRUFBRTtRQUN2QixPQUFPLENBQUMsUUFBUSxHQUFHLEVBQUUsR0FBRyxnQkFBZ0IsRUFBRSxDQUFDLENBQUMsRUFBRSxVQUFVLEdBQUcsRUFBRTtVQUN6RCxNQUFNLENBQUMsR0FBRyxDQUFDO1FBQ2YsQ0FBQyxFQUFFLE9BQU8sQ0FBQztNQUNmLENBQUM7TUFDRCxJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxHQUFHLENBQUMsRUFBRTtRQUM1QixRQUFRLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFO1VBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQyxLQUFLO1VBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQztRQUFNLENBQUMsRUFBRSxVQUFVLEdBQUcsRUFBRTtVQUNyRyxVQUFVLENBQUMsR0FBRyxDQUFDO1VBQ2YsTUFBTSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDbEIsQ0FBQyxFQUFFLE9BQU8sQ0FBQztNQUNmLENBQUMsTUFBTTtRQUNILE9BQU8sQ0FBQyxPQUFPLEVBQUU7VUFBRSxPQUFPLEVBQUUsS0FBSyxDQUFDLFFBQVEsQ0FBQyxPQUFPO1VBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQyxLQUFLO1VBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQztRQUFNLENBQUMsRUFBRSxVQUFVLEdBQUcsRUFBRTtVQUMzRyxVQUFVLENBQUMsR0FBRyxDQUFDO1VBQ2YsTUFBTSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDbEIsQ0FBQyxFQUFFLE9BQU8sQ0FBQztNQUNmO01BQ0E7SUFDSjtJQUNBLElBQUksT0FBTyxHQUFHO01BQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQztJQUFNLENBQUM7SUFDckMsSUFBSSxNQUFNLENBQUMsUUFBUSxLQUFLLEVBQUUsRUFBRTtNQUN4QixPQUFPLENBQUMsS0FBSyxHQUFHLE1BQU0sQ0FBQyxRQUFRO0lBQ25DO0lBQ0EsUUFBUSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUM7RUFDeEU7RUFFQSxTQUFTLGNBQWMsR0FBRztJQUN0QixJQUFJLEtBQUssR0FBRyxLQUFLLENBQUMsUUFBUTtJQUMxQixLQUFLLENBQUMsUUFBUSxHQUFHLElBQUk7SUFDckIsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUM7SUFDaEMsSUFBSSxLQUFLLElBQUksS0FBSyxDQUFDLE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFO01BQzVDO01BQ0EsU0FBUyxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUMsT0FBTyxFQUFFLFlBQVk7UUFBRSxRQUFRLENBQUMsSUFBSSxDQUFDO01BQUUsQ0FBQyxFQUFFLFlBQVk7UUFBRSxRQUFRLENBQUMsSUFBSSxDQUFDO01BQUUsQ0FBQyxDQUFDO0lBQ3pHLENBQUMsTUFBTTtNQUNILFFBQVEsQ0FBQyxJQUFJLENBQUM7SUFDbEI7RUFDSjtFQUVBLFNBQVMsZ0JBQWdCLEdBQUc7SUFDeEIsSUFBSSxHQUFHLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQyxHQUFHO0lBQzVCLElBQUksQ0FBQyxHQUFHLEVBQUU7TUFBRTtJQUFRO0lBQ3BCLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsdUNBQXVDLEVBQUU7TUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDLEtBQUs7TUFBRSxLQUFLLEVBQUUsQ0FBQyxHQUFHLENBQUMsS0FBSyxJQUFJLEVBQUUsRUFBRTtJQUFPLENBQUMsQ0FBQyxDQUFDO0lBQzlILENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLEtBQUssQ0FBQztNQUFFLFFBQVEsRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUM7SUFDOUQsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsWUFBWTtNQUNyRCxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDO01BQ3BDLFNBQVMsQ0FBQyxRQUFRLEdBQUcsR0FBRyxDQUFDLEVBQUUsRUFBRSxZQUFZO1FBQ3JDLEtBQUssQ0FBQyxRQUFRLENBQUMsS0FBSyxHQUFHLElBQUk7UUFDM0IsS0FBSyxDQUFDLFFBQVEsQ0FBQyxPQUFPLEdBQUcsQ0FBQztRQUMxQixDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztRQUNoQyxRQUFRLENBQUMsSUFBSSxDQUFDO1FBQ2QsU0FBUyxDQUFDLENBQUMsQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFDO01BQ3RELENBQUMsRUFBRSxVQUFVLEdBQUcsRUFBRTtRQUNkLFNBQVMsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUM7TUFDL0IsQ0FBQyxDQUFDO0lBQ04sQ0FBQyxDQUFDO0VBQ047O0VBRUE7O0VBRUEsU0FBUyxhQUFhLENBQUMsR0FBRyxFQUFFO0lBQ3hCLElBQUksQ0FBQyxHQUFHLEVBQUU7TUFBRTtJQUFRO0lBQ3BCLEtBQUssQ0FBQyxTQUFTLEdBQUc7TUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUU7TUFBRSxHQUFHLEVBQUUsR0FBRztNQUFFLEtBQUssRUFBRSxJQUFJO01BQUUsUUFBUSxFQUFFLENBQUM7SUFBRSxDQUFDO0lBQ3hFLENBQUMsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsdUNBQXVDLEVBQUU7TUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDO0lBQU0sQ0FBQyxDQUFDLENBQUM7SUFDakcsSUFBSSxLQUFLLEdBQUcsR0FBRyxDQUFDLE9BQU8sS0FBSyxLQUFLO0lBQ2pDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsS0FBSyxHQUFHLDBDQUEwQyxHQUFHLHVDQUF1QyxFQUFFO01BQ3RILEdBQUcsRUFBRSxHQUFHLENBQUMsWUFBWSxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsWUFBWSxHQUFHLEdBQUcsQ0FBQztJQUN6RCxDQUFDLENBQUMsQ0FBQztJQUNILENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQzNCLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQzNCLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO0lBQ3hDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO0lBQ3hDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO0lBQ3ZDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLElBQUksQ0FBQztJQUN6QyxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLDJDQUEyQyxDQUFDLENBQUM7SUFDOUUsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztJQUNoQyxDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQztJQUM5QyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxLQUFLLENBQUM7TUFBRSxRQUFRLEVBQUU7SUFBTSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDO0lBQzVELGNBQWMsQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLEtBQUssQ0FBQztFQUNqQztFQUVBLFNBQVMsY0FBYyxDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUU7SUFDcEMsT0FBTyxDQUFDLFFBQVEsR0FBRyxLQUFLLEdBQUcsZ0JBQWdCLEVBQUU7TUFBRSxPQUFPLEVBQUUsT0FBTyxLQUFLO0lBQUssQ0FBQyxFQUFFLFVBQVUsR0FBRyxFQUFFO01BQ3ZGLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxFQUFFO1FBQUU7TUFBUTtNQUNoQyxLQUFLLENBQUMsU0FBUyxDQUFDLFFBQVEsR0FBRyxDQUFDLENBQUM7TUFDN0IsZUFBZSxDQUFDLEdBQUcsQ0FBQztNQUNwQixnQkFBZ0IsQ0FBQyxDQUFDO0lBQ3RCLENBQUMsRUFBRSxVQUFVLEdBQUcsRUFBRTtNQUNkLGFBQWEsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDbkMsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLGdCQUFnQixHQUFHO0lBQ3hCLFlBQVksQ0FBQyxDQUFDO0lBQ2QsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEdBQUcsV0FBVyxDQUFDLFlBQVk7TUFDNUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUU7UUFBRTtNQUFRO01BQ2hDLE1BQU0sQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDLEVBQUUsVUFBVSxHQUFHLEVBQUU7UUFDeEQsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUU7VUFBRTtRQUFRO1FBQ2hDLGVBQWUsQ0FBQyxHQUFHLENBQUM7UUFDcEIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFO1VBQ3ZCLFlBQVksQ0FBQyxDQUFDO1FBQ2xCO01BQ0osQ0FBQyxFQUFFLFlBQVksQ0FBRSwwQkFBMkIsQ0FBQztJQUNqRCxDQUFDLEVBQUUsSUFBSSxDQUFDO0VBQ1o7RUFFQSxTQUFTLFlBQVksR0FBRztJQUNwQixJQUFJLEtBQUssQ0FBQyxTQUFTLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEtBQUssSUFBSSxFQUFFO01BQ25ELGFBQWEsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQztNQUNwQyxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssR0FBRyxJQUFJO0lBQ2hDO0VBQ0o7RUFFQSxTQUFTLGVBQWUsQ0FBQyxHQUFHLEVBQUU7SUFDMUIsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUU7TUFBRTtJQUFRO0lBQ2hDLEtBQUssQ0FBQyxTQUFTLENBQUMsR0FBRyxHQUFHLEdBQUc7SUFDekIsVUFBVSxDQUFDLEdBQUcsQ0FBQztJQUNmLElBQUksU0FBUyxHQUFHLEdBQUcsQ0FBQyxTQUFTLElBQUk7TUFBRSxNQUFNLEVBQUUsS0FBSztNQUFFLE1BQU0sRUFBRSxNQUFNO01BQUUsS0FBSyxFQUFFO0lBQUcsQ0FBQztJQUM3RSxJQUFJLEtBQUssR0FBRyxTQUFTLENBQUMsS0FBSyxJQUFJLEVBQUU7SUFDakMsSUFBSSxhQUFhLEdBQUcsQ0FBQztJQUNyQixJQUFJLElBQUksR0FBRyxFQUFFO0lBQ2IsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7TUFDbkMsSUFBSSxJQUFJLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQztNQUNuQixJQUFJLEtBQUssR0FBRyxrQkFBa0IsQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQztNQUNqRCxJQUFJLENBQUMsSUFBSSxDQUFDLGlCQUFpQixJQUFJLEtBQUssQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxLQUFLLEVBQUU7UUFDN0UsS0FBSyxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLElBQUk7TUFDakQ7TUFDQSxJQUFJLE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsSUFBSSxLQUFLLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssSUFBSTtNQUN4RixJQUFJLE9BQU8sRUFBRTtRQUFFLGFBQWEsRUFBRTtNQUFFO01BQ2hDLElBQUksSUFBSSw0QkFBNEIsSUFBSSxJQUFJLENBQUMsaUJBQWlCLEdBQUcsZUFBZSxHQUFHLEVBQUUsQ0FBQyxHQUFHLG1CQUFtQixJQUFJLEtBQUssR0FBRyxLQUFLLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLG1CQUFtQixHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsSUFBSSxHQUNoTCwwQkFBMEIsSUFBSSxPQUFPLEdBQUcsVUFBVSxHQUFHLEVBQUUsQ0FBQyxJQUFJLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxXQUFXLEdBQUcsRUFBRSxDQUFDLEdBQUcsSUFBSSxHQUM3RyxzREFBc0QsSUFBSSxPQUFPLEdBQUcsVUFBVSxHQUFHLEVBQUUsQ0FBQyxJQUFJLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxXQUFXLEdBQUcsRUFBRSxDQUFDLEdBQUcsR0FBRyxHQUN4SSxxQ0FBcUMsR0FDckMsc0RBQXNELEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLE1BQU0sR0FDakcsd0JBQXdCLEdBQUcsR0FBRyxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsR0FBRyxnQkFBZ0IsR0FDaEYsa0JBQWtCLElBQUksSUFBSSxDQUFDLGlCQUFpQixHQUFHLE9BQU8sR0FBRyxZQUFZLENBQUMsR0FBRyxJQUFJLEdBQzdFLEdBQUcsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsQ0FBQyxDQUFDLHdDQUF3QyxDQUFDLEdBQUcsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLENBQUMsR0FBRyxpQkFBaUI7SUFDbEo7SUFDQSxDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO0lBQzlCLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLHNDQUFzQyxFQUFFO01BQUUsS0FBSyxFQUFFO0lBQWMsQ0FBQyxDQUFDLENBQUM7SUFDN0YsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsYUFBYSxLQUFLLENBQUMsR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFDO0lBRXRFLElBQUksVUFBVSxHQUFHLEVBQUU7SUFDbkIsSUFBSSxTQUFTLEdBQUcsRUFBRTtJQUNsQixJQUFJLFFBQVEsR0FBRyxDQUFDO0lBQ2hCLElBQUksU0FBUyxDQUFDLE1BQU0sRUFBRTtNQUNsQixJQUFJLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1FBQ2xCLFVBQVUsR0FBRyxFQUFFLENBQUMsdUNBQXVDLEVBQUU7VUFBRSxLQUFLLEVBQUUsS0FBSyxDQUFDO1FBQU8sQ0FBQyxDQUFDO01BQ3JGLENBQUMsTUFBTTtRQUNILFVBQVUsR0FBRyxDQUFDLENBQUMsMkNBQTJDLENBQUM7TUFDL0Q7TUFDQSxTQUFTLEdBQUcsRUFBRSxDQUFDLDJDQUEyQyxFQUFFO1FBQUUsSUFBSSxFQUFFLFlBQVksQ0FBQyxTQUFTLENBQUMsYUFBYTtNQUFFLENBQUMsQ0FBQztNQUM1RyxRQUFRLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsR0FBRyxTQUFTLENBQUMsYUFBYSxJQUFJLEdBQUcsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDO01BQzlGLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO01BQ3hDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO01BQzNCLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO01BQ3hDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO0lBQzNDLENBQUMsTUFBTTtNQUNILENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQztNQUN2QyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO01BQ3hDLElBQUksU0FBUyxDQUFDLE1BQU0sS0FBSyxPQUFPLEVBQUU7UUFDOUIsSUFBSSxJQUFJLEdBQUcsTUFBTSxDQUFDLFNBQVMsQ0FBQyxlQUFlLElBQUksRUFBRSxDQUFDO1FBQ2xELElBQUksSUFBSTtRQUNSLElBQUksSUFBSSxLQUFLLDBCQUEwQixFQUFFO1VBQ3JDLElBQUksR0FBRyxDQUFDLENBQUMsOENBQThDLENBQUM7UUFDNUQsQ0FBQyxNQUFNLElBQUksSUFBSSxLQUFLLHFCQUFxQixFQUFFO1VBQ3ZDLElBQUksR0FBRyxDQUFDLENBQUMsaURBQWlELENBQUM7UUFDL0QsQ0FBQyxNQUFNLElBQUksWUFBWSxDQUFDLElBQUksQ0FBQyxFQUFFO1VBQzNCLElBQUksR0FBRyxZQUFZLENBQUMsQ0FBQztRQUN6QixDQUFDLE1BQU0sSUFBSSxJQUFJLEtBQUssc0JBQXNCLElBQUksSUFBSSxLQUFLLDJCQUEyQixFQUFFO1VBQ2hGLElBQUksR0FBRyxDQUFDLENBQUMsb0NBQW9DLENBQUM7UUFDbEQsQ0FBQyxNQUFNO1VBQ0gsSUFBSSxHQUFHLENBQUMsQ0FBQyx1Q0FBdUMsQ0FBQyxHQUFHLElBQUksR0FBRyxJQUFJLEdBQUcsR0FBRztRQUN6RTtRQUNBLGFBQWEsQ0FBQyxJQUFJLENBQUM7UUFDbkIsVUFBVSxHQUFHLEVBQUU7TUFDbkIsQ0FBQyxNQUFNLElBQUksU0FBUyxDQUFDLE1BQU0sS0FBSyxPQUFPLEVBQUU7UUFDckMsVUFBVSxHQUFHLEVBQUU7UUFDZixDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO01BQzVDLENBQUMsTUFBTSxJQUFJLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1FBQ3pCLFVBQVUsR0FBRyxFQUFFLENBQUMseUNBQXlDLEVBQUU7VUFBRSxLQUFLLEVBQUUsS0FBSyxDQUFDO1FBQU8sQ0FBQyxDQUFDO01BQ3ZGLENBQUMsTUFBTTtRQUNILFVBQVUsR0FBRyxDQUFDLENBQUMsMkNBQTJDLENBQUM7TUFDL0Q7TUFDQSxTQUFTLEdBQUcsRUFBRTtNQUNkLFFBQVEsR0FBRyxHQUFHO0lBQ2xCO0lBQ0EsQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQztJQUMxQyxDQUFDLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO0lBQ3ZDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsUUFBUSxHQUFHLEdBQUcsQ0FBQztFQUM1RDtFQUVBLFNBQVMsa0JBQWtCLENBQUMsR0FBRyxFQUFFLE1BQU0sRUFBRTtJQUNyQyxJQUFJLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxJQUFJLEVBQUU7SUFDM0IsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7TUFDbkMsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRTtRQUM3QyxPQUFPLEtBQUssQ0FBQyxDQUFDLENBQUM7TUFDbkI7SUFDSjtJQUNBLE9BQU8sSUFBSTtFQUNmO0VBRUEsU0FBUyxhQUFhLENBQUMsSUFBSSxFQUFFO0lBQ3pCLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxnREFBZ0QsR0FDbkUsK0hBQStILEdBQy9ILE9BQU8sR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsY0FBYyxDQUFDO0VBQy9DO0VBRUEsU0FBUyxhQUFhLEdBQUc7SUFDckIsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxpQkFBaUIsRUFBRSxZQUFZO01BQzVELElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxFQUFFO1FBQUU7TUFBUTtNQUNoQyxJQUFJLEdBQUcsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7TUFDbkUsS0FBSyxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7TUFDdkQsZUFBZSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDO0lBQ3hDLENBQUMsQ0FBQztFQUNOO0VBRUEsU0FBUyxpQkFBaUIsR0FBRztJQUN6QixJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRTtNQUFFO0lBQVE7SUFDaEMsSUFBSSxHQUFHLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxHQUFHO0lBQzdCLElBQUksT0FBTyxHQUFHLEVBQUU7SUFDaEIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxLQUFLLElBQUksRUFBRSxFQUFFLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtNQUN6RCxJQUFJLElBQUksR0FBRyxHQUFHLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7TUFDakMsSUFBSSxJQUFJLENBQUMsaUJBQWlCLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLElBQUksRUFBRTtRQUMzRTtNQUNKO01BQ0EsSUFBSSxJQUFJLEdBQUcsa0JBQWtCLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUM7TUFDaEQsSUFBSSxJQUFJLEVBQUU7UUFDTixPQUFPLENBQUMsSUFBSSxDQUFDO1VBQUUsRUFBRSxFQUFFLElBQUksQ0FBQyxFQUFFO1VBQUUsT0FBTyxFQUFFLElBQUk7VUFBRSxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVM7VUFBRSxLQUFLLEVBQUUsSUFBSSxDQUFDO1FBQU0sQ0FBQyxDQUFDO01BQzlGO0lBQ0o7SUFDQSxJQUFJLE9BQU8sQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO01BQ3RCO0lBQ0o7SUFDQSxRQUFRLENBQUMsUUFBUSxHQUFHLEdBQUcsQ0FBQyxFQUFFLEVBQUU7TUFBRSxLQUFLLEVBQUU7SUFBUSxDQUFDLEVBQUUsVUFBVSxLQUFLLEVBQUU7TUFDN0QsT0FBTyxDQUFDLFFBQVEsR0FBRyxHQUFHLENBQUMsRUFBRSxHQUFHLGdCQUFnQixFQUFFO1FBQUUsSUFBSSxFQUFFO01BQUssQ0FBQyxFQUFFLFlBQVk7UUFDdEUsY0FBYyxDQUFDLENBQUM7UUFDaEIsVUFBVSxDQUFDLEtBQUssQ0FBQztRQUNqQixRQUFRLENBQUMsSUFBSSxDQUFDO1FBQ2QsU0FBUyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO01BQ3BELENBQUMsRUFBRSxZQUFZO1FBQ1gsY0FBYyxDQUFDLENBQUM7UUFDaEIsUUFBUSxDQUFDLElBQUksQ0FBQztRQUNkLFNBQVMsQ0FBQyxDQUFDLENBQUMsa0NBQWtDLENBQUMsQ0FBQztNQUNwRCxDQUFDLENBQUM7SUFDTixDQUFDLEVBQUUsVUFBVSxHQUFHLEVBQUU7TUFDZCxhQUFhLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ25DLENBQUMsQ0FBQztFQUNOO0VBRUEsU0FBUyxjQUFjLEdBQUc7SUFDdEIsWUFBWSxDQUFDLENBQUM7SUFDZCxLQUFLLENBQUMsU0FBUyxHQUFHLElBQUk7SUFDdEIsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztFQUNyQztFQUVBLFNBQVMscUJBQXFCLEdBQUc7SUFDN0IsSUFBSSxHQUFHLEdBQUcsS0FBSyxDQUFDLFNBQVMsR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDLEdBQUcsR0FBRyxJQUFJO0lBQ3RELElBQUksR0FBRyxFQUFFO01BQ0wsT0FBTyxDQUFDLFFBQVEsR0FBRyxHQUFHLENBQUMsRUFBRSxHQUFHLGdCQUFnQixFQUFFO1FBQUUsSUFBSSxFQUFFO01BQUssQ0FBQyxFQUFFLFlBQVk7UUFDdEUsY0FBYyxDQUFDLENBQUM7UUFDaEIsUUFBUSxDQUFDLElBQUksQ0FBQztNQUNsQixDQUFDLEVBQUUsWUFBWTtRQUNYLGNBQWMsQ0FBQyxDQUFDO1FBQ2hCLFFBQVEsQ0FBQyxJQUFJLENBQUM7TUFDbEIsQ0FBQyxDQUFDO0lBQ04sQ0FBQyxNQUFNO01BQ0gsY0FBYyxDQUFDLENBQUM7SUFDcEI7RUFDSjs7RUFFQTs7RUFFQSxTQUFTLGFBQWEsQ0FBQyxHQUFHLEVBQUUsT0FBTyxFQUFFO0lBQ2pDLElBQUksQ0FBQyxHQUFHLEVBQUU7TUFBRTtJQUFRO0lBQ3BCLEtBQUssQ0FBQyxTQUFTLEdBQUc7TUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUU7TUFBRSxHQUFHLEVBQUUsR0FBRztNQUFFLE9BQU8sRUFBRSxDQUFDO01BQUUsT0FBTyxFQUFFLE9BQU87TUFBRSxLQUFLLEVBQUUsSUFBSTtNQUFFLEtBQUssRUFBRTtJQUFFLENBQUM7SUFDbEcsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLElBQUksQ0FBQyx3QkFBd0IsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDLENBQUMsR0FBRyxRQUFRLENBQUM7SUFDekcsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztJQUM5QixDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxLQUFLLENBQUM7TUFBRSxRQUFRLEVBQUUsSUFBSTtNQUFFLE1BQU0sRUFBRSxTQUFSLE1BQU0sR0FBYztRQUFFLFlBQVksQ0FBQyxDQUFDO01BQUU7SUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDO0lBQ3BHLElBQUksT0FBTyxHQUFHLE9BQU8sS0FBSyxJQUFJLEdBQUcsQ0FBQyxDQUFDLEdBQUc7TUFBRSxRQUFRLEVBQUU7SUFBUSxDQUFDO0lBQzNELE9BQU8sQ0FBQyxRQUFRLEdBQUcsR0FBRyxDQUFDLEVBQUUsR0FBRyxXQUFXLEVBQUUsT0FBTyxFQUFFLFVBQVUsSUFBSSxFQUFFO01BQzlELElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxFQUFFO1FBQUU7TUFBUTtNQUNoQyxLQUFLLENBQUMsU0FBUyxDQUFDLE9BQU8sR0FBRyxJQUFJLENBQUMsUUFBUTtNQUN2QyxLQUFLLENBQUMsU0FBUyxDQUFDLEdBQUcsR0FBRyxJQUFJLENBQUMsR0FBRztNQUM5QixVQUFVLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQztNQUNwQixVQUFVLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQztNQUNwQixnQkFBZ0IsQ0FBQyxDQUFDO0lBQ3RCLENBQUMsRUFBRSxVQUFVLEdBQUcsRUFBRTtNQUNkLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsd0NBQXdDLEdBQUcsR0FBRyxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLGNBQWMsQ0FBQztJQUM5RyxDQUFDLENBQUM7RUFDTjtFQUVBLFNBQVMsZ0JBQWdCLEdBQUc7SUFDeEIsWUFBWSxDQUFDLENBQUM7SUFDZCxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssR0FBRyxXQUFXLENBQUMsWUFBWTtNQUM1QyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRTtRQUFFO01BQVE7TUFDaEMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUU7TUFDdkIsTUFBTSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsRUFBRSxVQUFVLEdBQUcsRUFBRTtRQUN4RCxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRTtVQUFFO1FBQVE7UUFDaEMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxHQUFHLEdBQUcsR0FBRztRQUN6QixVQUFVLENBQUMsR0FBRyxDQUFDO1FBQ2YsVUFBVSxDQUFDLEdBQUcsQ0FBQztRQUNmLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEdBQUcsRUFBRSxFQUFFO1VBQ2pELFlBQVksQ0FBQyxDQUFDO1FBQ2xCO01BQ0osQ0FBQyxFQUFFLFlBQVk7UUFDWCxJQUFJLEtBQUssQ0FBQyxTQUFTLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxFQUFFO1VBQzlDLFlBQVksQ0FBQyxDQUFDO1FBQ2xCO01BQ0osQ0FBQyxDQUFDO0lBQ04sQ0FBQyxFQUFFLElBQUksQ0FBQztFQUNaO0VBRUEsU0FBUyxZQUFZLEdBQUc7SUFDcEIsSUFBSSxLQUFLLENBQUMsU0FBUyxJQUFJLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxLQUFLLElBQUksRUFBRTtNQUNuRCxhQUFhLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUM7TUFDcEMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEdBQUcsSUFBSTtJQUNoQztFQUNKO0VBRUEsU0FBUyxjQUFjLENBQUMsR0FBRyxFQUFFO0lBQ3pCLElBQUksT0FBTyxHQUFHLEtBQUssQ0FBQyxTQUFTLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxPQUFPLEdBQUcsQ0FBQztJQUMzRCxJQUFJLE1BQU0sR0FBRyxFQUFFO0lBQ2YsSUFBSSxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssSUFBSSxFQUFFO0lBQzNCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO01BQ25DLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhO01BQ3JDLElBQUksUUFBUSxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLEtBQUssTUFBTSxDQUFDLE9BQU8sQ0FBQyxFQUFFO1FBQzNELE1BQU0sQ0FBQyxJQUFJLENBQUM7VUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQztVQUFFLFFBQVEsRUFBRTtRQUFTLENBQUMsQ0FBQztNQUN2RDtJQUNKO0lBQ0EsT0FBTyxNQUFNO0VBQ2pCO0VBRUEsU0FBUyxXQUFXLENBQUMsR0FBRyxFQUFFO0lBQ3RCLElBQUksSUFBSSxHQUFHLGNBQWMsQ0FBQyxHQUFHLENBQUM7SUFDOUIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7TUFDbEMsSUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxNQUFNO01BQ3BDLElBQUksTUFBTSxLQUFLLFNBQVMsSUFBSSxNQUFNLEtBQUssU0FBUyxFQUFFO1FBQzlDLE9BQU8sSUFBSTtNQUNmO0lBQ0o7SUFDQSxPQUFPLEtBQUs7RUFDaEI7RUFFQSxTQUFTLG1CQUFtQixDQUFDLFFBQVEsRUFBRTtJQUNuQyxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssTUFBTSxFQUFFO01BQUUsT0FBTztRQUFFLEdBQUcsRUFBRSxPQUFPO1FBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxvQ0FBb0M7TUFBRSxDQUFDO0lBQUU7SUFDMUcsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLFNBQVMsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLFNBQVMsRUFBRTtNQUFFLE9BQU87UUFBRSxHQUFHLEVBQUUsRUFBRTtRQUFFLElBQUksRUFBRSxDQUFDLENBQUMsaUNBQWlDO01BQUUsQ0FBQztJQUFFO0lBQ3RJLE9BQU87TUFBRSxHQUFHLEVBQUUsUUFBUTtNQUFFLElBQUksRUFBRSxDQUFDLENBQUMsZ0NBQWdDO0lBQUUsQ0FBQztFQUN2RTtFQUVBLFNBQVMsaUJBQWlCLENBQUMsSUFBSSxFQUFFO0lBQzdCLElBQUksWUFBWSxDQUFDLElBQUksQ0FBQyxFQUFFO01BQUUsT0FBTyxZQUFZLENBQUMsQ0FBQztJQUFFO0lBQ2pELElBQUksSUFBSSxLQUFLLDJCQUEyQixJQUFJLElBQUksS0FBSyxzQkFBc0IsRUFBRTtNQUFFLE9BQU8sQ0FBQyxDQUFDLG9DQUFvQyxDQUFDO0lBQUU7SUFDL0gsSUFBSSxJQUFJLEtBQUsscUJBQXFCLElBQUksSUFBSSxLQUFLLHNCQUFzQixJQUFJLElBQUksS0FBSyw2QkFBNkIsSUFDeEcsSUFBSSxLQUFLLHFCQUFxQixJQUFJLElBQUksS0FBSyxtQkFBbUIsSUFBSSxJQUFJLEtBQUssaUJBQWlCLEVBQUU7TUFDakcsT0FBTyxDQUFDLENBQUMscUNBQXFDLENBQUM7SUFDbkQ7SUFDQSxJQUFJLElBQUksS0FBSyx5QkFBeUIsSUFBSSxJQUFJLEtBQUssb0JBQW9CLEVBQUU7TUFBRSxPQUFPLENBQUMsQ0FBQyx5Q0FBeUMsQ0FBQztJQUFFO0lBQ2hJLElBQUksSUFBSSxLQUFLLE9BQU8sRUFBRTtNQUFFLE9BQU8sQ0FBQyxDQUFDLHFDQUFxQyxDQUFDO0lBQUU7SUFDekUsT0FBTyxJQUFJO0VBQ2Y7RUFFQSxTQUFTLFVBQVUsQ0FBQyxHQUFHLEVBQUU7SUFDckIsSUFBSSxJQUFJLEdBQUcsY0FBYyxDQUFDLEdBQUcsQ0FBQztJQUM5QixJQUFJLE1BQU0sR0FBRztNQUFFLElBQUksRUFBRSxDQUFDO01BQUUsT0FBTyxFQUFFLENBQUM7TUFBRSxNQUFNLEVBQUU7SUFBRSxDQUFDO0lBQy9DLElBQUksSUFBSSxHQUFHLEVBQUU7SUFDYixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtNQUNsQyxJQUFJLElBQUksR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSTtNQUN2QixJQUFJLFFBQVEsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUTtNQUMvQixJQUFJLEtBQUssR0FBRyxtQkFBbUIsQ0FBQyxRQUFRLENBQUM7TUFDekMsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLE1BQU0sRUFBRTtRQUFFLE1BQU0sQ0FBQyxJQUFJLEVBQUU7TUFBRSxDQUFDLE1BQzdDLElBQUksUUFBUSxDQUFDLE1BQU0sS0FBSyxTQUFTLElBQUksUUFBUSxDQUFDLE1BQU0sS0FBSyxTQUFTLEVBQUU7UUFBRSxNQUFNLENBQUMsT0FBTyxFQUFFO01BQUUsQ0FBQyxNQUN6RjtRQUFFLE1BQU0sQ0FBQyxNQUFNLEVBQUU7TUFBRTtNQUN4QixJQUFJLEtBQUssR0FBSSxRQUFRLENBQUMsTUFBTSxLQUFLLFFBQVEsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLFNBQVMsR0FDcEUsNEVBQTRFLEdBQUcsSUFBSSxDQUFDLEVBQUUsR0FBRyxJQUFJLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDLEdBQUcsV0FBVyxHQUN0SixFQUFFO01BQ1IsSUFBSSxJQUFJLDJCQUEyQixHQUM3Qiw0QkFBNEIsSUFBSSxHQUFHLENBQUMsT0FBTyxLQUFLLEtBQUssR0FBRyxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcseUJBQXlCLElBQUksR0FBRyxDQUFDLE9BQU8sS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLFNBQVMsR0FDdEosc0RBQXNELEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLFFBQVEsSUFDbEcsUUFBUSxDQUFDLGVBQWUsR0FBRyxxQ0FBcUMsR0FBRyxHQUFHLENBQUMsaUJBQWlCLENBQUMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxDQUFDLEdBQUcsUUFBUSxHQUFHLEVBQUUsQ0FBQyxHQUNySSxRQUFRLEdBQ1IsNkJBQTZCLEdBQUcsS0FBSyxDQUFDLEdBQUcsR0FBRyxJQUFJLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxTQUFTLEdBQUcsS0FBSyxHQUFHLFFBQVE7SUFDM0c7SUFDQSxJQUFJLElBQUksS0FBSyxFQUFFLEVBQUU7TUFDYixJQUFJLEdBQUcsd0JBQXdCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDLEdBQUcsUUFBUTtJQUMzRjtJQUNBLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO0lBQzdCLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsa0NBQWtDLEVBQUU7TUFDOUQsRUFBRSxFQUFFLE1BQU0sQ0FBQyxJQUFJO01BQ2YsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNO01BQ3JCLE9BQU8sRUFBRSxNQUFNLENBQUM7SUFDcEIsQ0FBQyxDQUFDLENBQUM7SUFDSCxDQUFDLENBQUMsOEJBQThCLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVk7TUFDdEQsSUFBSSxNQUFNLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7TUFDNUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxTQUFTLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxHQUFHLEdBQUcsR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDeEUsQ0FBQyxDQUFDO0VBQ047O0VBRUE7O0VBRUEsU0FBUyxtQkFBbUIsR0FBRztJQUMzQixNQUFNLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQyxFQUFFLFVBQVUsSUFBSSxFQUFFO01BQ3BDLEtBQUssQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLHFCQUFxQjtNQUM1QyxLQUFLLENBQUMsUUFBUSxHQUFHLElBQUk7TUFDckIsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQztNQUN4RCxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLGNBQWMsSUFBSSxFQUFFLENBQUM7TUFDeEQsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxTQUFTLElBQUksRUFBRSxDQUFDO01BQzlDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLElBQUksRUFBRSxDQUFDO01BQ3hELGVBQWUsQ0FBQyxrQkFBa0IsQ0FBQztNQUNuQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxrQkFBa0IsS0FBSyxJQUFJLENBQUM7TUFDOUUsQ0FBQyxDQUFDLHdCQUF3QixDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsa0JBQWtCLEtBQUssSUFBSSxDQUFDO01BQzdFLGVBQWUsQ0FBQyxzQkFBc0IsQ0FBQztNQUN2QyxlQUFlLENBQUMsaUJBQWlCLENBQUM7TUFDbEMsbUJBQW1CLENBQUMsQ0FBQztJQUN6QixDQUFDLEVBQUUsVUFBVSxPQUFPLEVBQUU7TUFDbEIsa0JBQWtCLENBQUMsRUFBRSxDQUFDLHNDQUFzQyxFQUFFO1FBQzFELElBQUksRUFBRSxDQUFDLENBQUMsdUNBQXVDLENBQUM7UUFDaEQsSUFBSSxFQUFFLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLG9DQUFvQztNQUN0RixDQUFDLENBQUMsQ0FBQztJQUNQLENBQUMsQ0FBQztFQUNOO0VBRUEsU0FBUyxXQUFXLENBQUMsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLEVBQUU7SUFDakQsUUFBUSxDQUFDLFdBQVcsRUFBRSxPQUFPLEVBQUUsVUFBVSxJQUFJLEVBQUU7TUFDM0MsS0FBSyxDQUFDLFFBQVEsR0FBRyxJQUFJO01BQ3JCLElBQUksYUFBYSxFQUFFO1FBQUUsZUFBZSxDQUFDLGFBQWEsQ0FBQztNQUFFO01BQ3JELFNBQVMsQ0FBQyxDQUFDLENBQUMsa0NBQWtDLENBQUMsQ0FBQztJQUNwRCxDQUFDLEVBQUUsVUFBVSxPQUFPLEVBQUU7TUFDbEIsSUFBSSxhQUFhLEVBQUU7UUFDZixjQUFjLENBQUMsYUFBYSxFQUFFLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztNQUN2RDtNQUNBLElBQUksTUFBTSxFQUFFO1FBQUUsTUFBTSxDQUFDLENBQUM7TUFBRTtJQUM1QixDQUFDLENBQUM7RUFDTjtFQUVBLFNBQVMsYUFBYSxHQUFHO0lBQ3JCLElBQUksS0FBSyxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2hFLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQyxjQUFjLEdBQUcsRUFBRTtJQUNsRSxJQUFJLEtBQUssS0FBSyxFQUFFLEVBQUU7TUFDZCxXQUFXLENBQUM7UUFBRSxjQUFjLEVBQUU7TUFBRyxDQUFDLEVBQUUsc0JBQXNCLENBQUM7TUFDM0Q7SUFDSjtJQUNBLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUU7TUFDbEMsY0FBYyxDQUFDLHNCQUFzQixFQUFFLENBQUMsQ0FBQywrQ0FBK0MsQ0FBQyxDQUFDO01BQzFGO0lBQ0o7SUFDQSxXQUFXLENBQUM7TUFBRSxjQUFjLEVBQUU7SUFBTSxDQUFDLEVBQUUsc0JBQXNCLEVBQUUsWUFBWTtNQUN2RSxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDO0lBQzNDLENBQUMsQ0FBQztFQUNOO0VBRUEsU0FBUyxTQUFTLEdBQUc7SUFDakIsSUFBSSxLQUFLLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDM0QsSUFBSSxRQUFRLEdBQUcsS0FBSyxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDLFNBQVMsR0FBRyxFQUFFO0lBQzdELElBQUksS0FBSyxLQUFLLEVBQUUsSUFBSSxDQUFDLG9EQUFvRCxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRTtNQUNuRixjQUFjLENBQUMsaUJBQWlCLEVBQUUsQ0FBQyxDQUFDLDJDQUEyQyxDQUFDLENBQUM7TUFDakY7SUFDSjtJQUNBLFdBQVcsQ0FBQztNQUFFLFNBQVMsRUFBRTtJQUFNLENBQUMsRUFBRSxpQkFBaUIsRUFBRSxZQUFZO01BQzdELENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUM7SUFDdEMsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLGVBQWUsR0FBRztJQUN2QixJQUFJLEtBQUssR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM1RCxJQUFJLFFBQVEsR0FBRyxLQUFLLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUMsa0JBQWtCLEdBQUcsRUFBRTtJQUN0RSxJQUFJLEtBQUssS0FBSyxFQUFFLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsS0FBSyxHQUFHLEVBQUU7TUFDekMsY0FBYyxDQUFDLGtCQUFrQixFQUFFLENBQUMsQ0FBQyw0Q0FBNEMsQ0FBQyxDQUFDO01BQ25GO0lBQ0o7SUFDQSxXQUFXLENBQUM7TUFBRSxrQkFBa0IsRUFBRTtJQUFNLENBQUMsRUFBRSxrQkFBa0IsRUFBRSxZQUFZO01BQ3ZFLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUM7SUFDdkMsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLGVBQWUsR0FBRztJQUN2QixJQUFJLE9BQU8sR0FBRyxDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO0lBQ3pELFdBQVcsQ0FBQztNQUFFLGtCQUFrQixFQUFFO0lBQVEsQ0FBQyxFQUFFLElBQUksRUFBRSxZQUFZO01BQzNELENBQUMsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxPQUFPLENBQUM7TUFDckQsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsV0FBVyxDQUFDLFNBQVMsRUFBRSxDQUFDLE9BQU8sQ0FBQztNQUN0RCxTQUFTLENBQUMsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7SUFDekQsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLFlBQVksQ0FBQyxPQUFPLEVBQUU7SUFDM0IsSUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsUUFBUSxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDbkQsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssR0FBRyxFQUFFLENBQUMsR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDLEtBQUssR0FBRyxFQUFFLENBQUM7RUFDekQ7O0VBRUE7O0VBRUEsU0FBUyxTQUFTLENBQUMsTUFBTSxFQUFFO0lBQ3ZCLElBQUksQ0FBQyxNQUFNLEVBQUU7TUFDVCxLQUFLLENBQUMsV0FBVyxHQUFHLEtBQUs7TUFDekIsbUJBQW1CLENBQUMsQ0FBQztJQUN6QjtJQUNBLE1BQU0sQ0FBQyxRQUFRLEVBQUU7TUFBRSxLQUFLLEVBQUU7SUFBSSxDQUFDLEVBQUUsVUFBVSxJQUFJLEVBQUU7TUFDN0MsS0FBSyxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxJQUFJLEVBQUU7TUFDOUIsS0FBSyxDQUFDLFdBQVcsR0FBRyxJQUFJO01BQ3hCLEtBQUssQ0FBQyxVQUFVLEdBQUcsSUFBSTtNQUN2QixXQUFXLENBQUMsQ0FBQztJQUNqQixDQUFDLEVBQUUsVUFBVSxPQUFPLEVBQUU7TUFDbEIsS0FBSyxDQUFDLFdBQVcsR0FBRyxJQUFJO01BQ3hCLEtBQUssQ0FBQyxVQUFVLEdBQUcsT0FBTztNQUMxQixXQUFXLENBQUMsQ0FBQztJQUNqQixDQUFDLENBQUM7RUFDTjtFQUVBLFNBQVMsbUJBQW1CLEdBQUc7SUFDM0IsSUFBSSxHQUFHLEdBQUcsMkdBQTJHLEdBQy9HLGlGQUFpRjtJQUN2RixDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQztFQUN2QztFQUVBLFNBQVMsYUFBYSxDQUFDLElBQUksRUFBRTtJQUN6QixJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUU7TUFDaEIsSUFBSSxJQUFJLEdBQUcsVUFBVSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7TUFDckMsSUFBSSxJQUFJLEVBQUU7UUFBRSxPQUFPLElBQUk7TUFBRTtJQUM3QjtJQUNBLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtNQUMzQyxJQUFJLEtBQUssR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsSUFBSSxFQUFFO01BQzlDLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO1FBQ25DLElBQUksSUFBSSxDQUFDLFdBQVcsSUFBSSxJQUFJLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFO1VBQ2xFLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7UUFDM0I7TUFDSjtJQUNKO0lBQ0EsT0FBTyxJQUFJO0VBQ2Y7RUFFQSxTQUFTLGlCQUFpQixDQUFDLE9BQU8sRUFBRTtJQUNoQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxPQUFPLEdBQUcsSUFBSSxHQUFHLElBQUksQ0FBQztFQUMzRDs7RUFFQTtFQUNBO0VBQ0EsU0FBUyxXQUFXLEdBQUc7SUFDbkIsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDLGdCQUFnQixDQUFDO0lBQy9CLElBQUksQ0FBQyxLQUFLLENBQUMsV0FBVyxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRTtNQUN6QyxpQkFBaUIsQ0FBQyxLQUFLLENBQUM7TUFDeEI7SUFDSjtJQUNBLElBQUksS0FBSyxDQUFDLFVBQVUsS0FBSyxJQUFJLElBQUksS0FBSyxDQUFDLEtBQUssQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO01BQ3ZELGlCQUFpQixDQUFDLEtBQUssQ0FBQztNQUN4QixLQUFLLENBQUMsSUFBSSxDQUFDLGdEQUFnRCxHQUFHLFVBQVUsR0FDbEUsdUJBQXVCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDLEdBQUcsUUFBUSxHQUNuRixrRkFBa0YsR0FDbEYsR0FBRyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDLEdBQUcsaUJBQWlCLENBQUM7TUFDckUsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxZQUFZO1FBQUUsU0FBUyxDQUFDLENBQUM7TUFBRSxDQUFDLENBQUM7TUFDOUQ7SUFDSjtJQUNBLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLEtBQUssQ0FBQyxJQUFJLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxLQUFLLENBQUMsSUFBSSxLQUFLLENBQUMsU0FBUyxLQUFLLElBQUksRUFBRTtNQUNqRixpQkFBaUIsQ0FBQyxLQUFLLENBQUM7TUFDeEIsS0FBSyxDQUFDLElBQUksQ0FBQyx3Q0FBd0MsR0FDN0Msc0NBQXNDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFDLEdBQUcsT0FBTyxHQUM5RixjQUFjLENBQUMsQ0FBQyxHQUFHLFFBQVEsQ0FBQztNQUNsQztJQUNKO0lBQ0EsSUFBSSxLQUFLLENBQUMsS0FBSyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUU7TUFDMUIsaUJBQWlCLENBQUMsS0FBSyxDQUFDO01BQ3hCLEtBQUssQ0FBQyxJQUFJLENBQUMsbURBQW1ELEdBQ3hELHNDQUFzQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsc0NBQXNDLENBQUMsQ0FBQyxHQUFHLE9BQU8sR0FDakcsb0VBQW9FLEdBQUcsU0FBUyxHQUNoRixHQUFHLENBQUMsQ0FBQyxDQUFDLCtCQUErQixDQUFDLENBQUMsR0FBRyxpQkFBaUIsQ0FBQztNQUNsRTtJQUNKO0lBQ0EsaUJBQWlCLENBQUMsSUFBSSxDQUFDO0lBQ3ZCLElBQUksTUFBTSxHQUFHLENBQUMsQ0FBQztJQUNmLEtBQUssQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFO01BQ2hDLElBQUksS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLElBQUksS0FBSztNQUMvQixJQUFJLFdBQVcsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxFQUFFO1FBQUUsS0FBSyxHQUFHLEtBQUs7TUFBRTtNQUNyRCxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUM7SUFDcEQsQ0FBQyxDQUFDO0lBQ0YsSUFBSSxLQUFLLEdBQUcsV0FBVyxDQUFDLE1BQU0sQ0FBQyxVQUFVLEtBQUssRUFBRTtNQUFFLE9BQU8sT0FBTyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUFFLENBQUMsQ0FBQztJQUNuRixJQUFJLElBQUksR0FBRyxFQUFFO0lBQ2IsSUFBSSxLQUFLLENBQUMsVUFBVSxLQUFLLElBQUksRUFBRTtNQUMzQixJQUFJLElBQUksZ0RBQWdELEdBQUcsVUFBVSxHQUMvRCx1QkFBdUIsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHNDQUFzQyxDQUFDLENBQUMsR0FBRyxRQUFRLEdBQ25GLHlGQUF5RixHQUN6RixHQUFHLENBQUMsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDLENBQUMsR0FBRyxpQkFBaUI7SUFDeEU7SUFDQSxJQUFJLFlBQVksR0FBRyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUM7SUFDbkMsSUFBSSxJQUFJLDJCQUEyQixJQUFJLFlBQVksR0FBRyxFQUFFLEdBQUcsVUFBVSxDQUFDLEdBQUcsZ0JBQWdCO0lBQ3pGLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxLQUFLLEVBQUU7TUFDM0IsSUFBSSxZQUFZLEVBQUU7UUFDZCxJQUFJLElBQUksNkJBQTZCLEdBQUcsR0FBRyxDQUFDLGVBQWUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFHLE9BQU87TUFDakY7TUFDQSxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFO1FBQ2xDLElBQUksSUFBSSxhQUFhLENBQUMsSUFBSSxDQUFDO01BQy9CLENBQUMsQ0FBQztJQUNOLENBQUMsQ0FBQztJQUNGLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxHQUFHLFFBQVEsQ0FBQztJQUMzQixDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVk7TUFBRSxTQUFTLENBQUMsQ0FBQztJQUFFLENBQUMsQ0FBQztFQUN6RTtFQUVBLFNBQVMsV0FBVyxDQUFDLElBQUksRUFBRTtJQUN2QixJQUFJLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxJQUFJLEVBQUU7SUFDNUIsSUFBSSxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxFQUFFO01BQ3RDLE9BQU8sS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU87SUFDM0I7SUFDQSxJQUFJLEdBQUcsR0FBRyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSztJQUMvRSxPQUFPLEdBQUcsSUFBSSxHQUFHLENBQUMsT0FBTyxLQUFLLEtBQUssR0FBRyxLQUFLLEdBQUcsVUFBVTtFQUM1RDs7RUFFQTtFQUNBLFNBQVMsZ0JBQWdCLENBQUMsSUFBSSxFQUFFO0lBQzVCLElBQUksTUFBTSxHQUFHLFVBQVUsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO0lBQ3ZDLElBQUksTUFBTSxJQUFJLE1BQU0sQ0FBQyxZQUFZLElBQUksTUFBTSxDQUFDLFlBQVksS0FBSyxXQUFXLEVBQUU7TUFDdEUsSUFBSSxNQUFNLEdBQUc7UUFDVCxlQUFlLEVBQUUsQ0FBQyxDQUFDLHdDQUF3QyxDQUFDO1FBQzVELGNBQWMsRUFBRSxDQUFDLENBQUMsd0NBQXdDLENBQUM7UUFDM0QsYUFBYSxFQUFFLENBQUMsQ0FBQywwQ0FBMEMsQ0FBQztRQUM1RCxnQkFBZ0IsRUFBRSxlQUFlLENBQUMsTUFBTSxDQUFDO1FBQ3pDLFFBQVEsRUFBRSxDQUFDLENBQUMscUNBQXFDLENBQUM7UUFDbEQsS0FBSyxFQUFFLENBQUMsQ0FBQyxxQ0FBcUM7TUFDbEQsQ0FBQztNQUNELElBQUksTUFBTSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsRUFBRTtRQUM3QixJQUFJLEdBQUcsR0FBSSxNQUFNLENBQUMsWUFBWSxLQUFLLGlCQUFpQixJQUFJLE1BQU0sQ0FBQyxZQUFZLEtBQUssVUFBVSxHQUFJLGlCQUFpQixHQUFHLGNBQWM7UUFDaEksT0FBTyxlQUFlLEdBQUcsR0FBRyxHQUFHLElBQUksR0FBRyxHQUFHLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQyxHQUFHLFNBQVM7TUFDdEY7SUFDSjtJQUNBLElBQUksS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLElBQUksRUFBRTtJQUM1QixJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsSUFBSSxFQUFFLEVBQUUsTUFBTSxHQUFHLEtBQUssQ0FBQyxNQUFNLEVBQUU7TUFDN0MsT0FBTyw2QkFBNkIsR0FBRyxVQUFVLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyx5Q0FBeUMsQ0FBQyxDQUFDLEdBQUcsU0FBUztJQUNySDtJQUNBLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO01BQ25DLElBQUksR0FBRyxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDO01BQ2xDLElBQUksR0FBRyxJQUFJLEdBQUcsQ0FBQyxPQUFPLEtBQUssS0FBSyxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssZUFBZSxFQUFFO1FBQ2hFLE9BQU8sNkJBQTZCLEdBQUcsVUFBVSxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsNENBQTRDLENBQUMsQ0FBQyxHQUFHLFNBQVM7TUFDeEg7SUFDSjtJQUNBLElBQUksS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksS0FBSyxDQUFDLEtBQUssQ0FBQyxVQUFVLElBQUksRUFBRTtNQUFFLE9BQU8sSUFBSSxDQUFDLEtBQUssS0FBSyxNQUFNO0lBQUUsQ0FBQyxDQUFDLEVBQUU7TUFDcEYsT0FBTyw2QkFBNkIsR0FBRyxVQUFVLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDLEdBQUcsU0FBUztJQUNqSDtJQUNBLE9BQU8sSUFBSTtFQUNmO0VBRUEsU0FBUyxhQUFhLENBQUMsSUFBSSxFQUFFO0lBQ3pCLElBQUksT0FBTyxHQUFHLGdCQUFnQixDQUFDLElBQUksQ0FBQztJQUNwQyxJQUFJLFNBQVMsR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7SUFDdkYsSUFBSSxRQUFRLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUM5QixNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsS0FBSyxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztJQUN6RSxJQUFJLEtBQUssR0FBRyxFQUFFO0lBQ2QsSUFBSSxPQUFPLEtBQUssSUFBSSxFQUFFO01BQ2xCLEtBQUssR0FBRyxPQUFPO0lBQ25CLENBQUMsTUFBTSxJQUFJLElBQUksQ0FBQyxPQUFPLElBQUksSUFBSSxDQUFDLGFBQWEsRUFBRTtNQUMzQyxLQUFLLEdBQUcseUJBQXlCLEdBQUcsV0FBVyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxTQUFTO0lBQ25GO0lBQ0EsSUFBSSxPQUFPLEdBQUcsV0FBVyxDQUFDLElBQUksQ0FBQztJQUUvQixPQUFPLDBCQUEwQixJQUFJLElBQUksQ0FBQyxPQUFPLEdBQUcsRUFBRSxHQUFHLFNBQVMsQ0FBQyxHQUFHLGtDQUFrQyxHQUFHLElBQUksQ0FBQyxFQUFFLEdBQUcsSUFBSSxHQUNuSCxrQ0FBa0MsSUFBSSxJQUFJLENBQUMsT0FBTyxHQUFHLFVBQVUsR0FBRyxFQUFFLENBQUMsR0FBRyxnQkFBZ0IsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLElBQUksR0FDakgsc0RBQXNELElBQUksSUFBSSxDQUFDLE9BQU8sR0FBRyxVQUFVLEdBQUcsRUFBRSxDQUFDLEdBQUcsR0FBRyxHQUMvRix3Q0FBd0MsR0FDeEMsOEJBQThCLEdBQzlCLDhCQUE4QixJQUFJLE9BQU8sS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLDJCQUEyQixJQUFJLE9BQU8sS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHLFVBQVUsQ0FBQyxHQUFHLElBQUksSUFDbEosT0FBTyxLQUFLLEtBQUssR0FBRyxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsU0FBUyxHQUM5QyxvRUFBb0UsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLGFBQWEsR0FDdEcsZ0NBQWdDLEdBQUcsS0FBSyxHQUFHLFNBQVMsR0FDcEQsaUNBQWlDLEdBQ2pDLCtGQUErRixHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsbUNBQW1DLENBQUMsQ0FBQyxHQUFHLDBCQUEwQixHQUMxSyxzSUFBc0ksR0FDdEksbUNBQW1DLEdBQ25DLGlDQUFpQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsbUNBQW1DLENBQUMsQ0FBQyxHQUFHLE1BQU0sSUFDdkYsU0FBUyxHQUFHLEVBQUUsR0FBRywrQkFBK0IsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLGlDQUFpQyxDQUFDLENBQUMsR0FBRyxNQUFNLENBQUMsSUFDdEcsUUFBUSxHQUFHLEVBQUUsR0FBRyxpQ0FBaUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLG1DQUFtQyxDQUFDLENBQUMsR0FBRyxNQUFNLENBQUMsR0FDMUcsbUNBQW1DLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDLEdBQUcsTUFBTSxHQUM1RixvQkFBb0I7RUFDOUI7RUFFQSxTQUFTLGtCQUFrQixHQUFHO0lBQzFCLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQztJQUMvQixLQUFLLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxxQkFBcUIsRUFBRSxZQUFZO01BQUUsY0FBYyxDQUFDLElBQUksQ0FBQztJQUFFLENBQUMsQ0FBQztJQUMvRSxLQUFLLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSx5QkFBeUIsRUFBRSxZQUFZO01BQUUsWUFBWSxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUFFLENBQUMsQ0FBQztJQUNqSCxLQUFLLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSxVQUFVLEtBQUssRUFBRTtNQUN2RCxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUM7TUFDdEIsY0FBYyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLGVBQWUsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDO0lBQzlFLENBQUMsQ0FBQztJQUNGLEtBQUssQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLHNCQUFzQixFQUFFLFVBQVUsS0FBSyxFQUFFO01BQ3ZELEtBQUssQ0FBQyxlQUFlLENBQUMsQ0FBQztNQUN2QixJQUFJLEtBQUssR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsUUFBUSxDQUFDLGVBQWUsQ0FBQztNQUM3QyxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO01BQ2xELEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUMvQyxDQUFDLENBQUM7SUFDRixLQUFLLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSxVQUFVLEtBQUssRUFBRTtNQUN6RCxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUM7TUFDdEIsaUJBQWlCLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsZUFBZSxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUM7SUFDakYsQ0FBQyxDQUFDO0lBQ0YsS0FBSyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsMENBQTBDLEVBQUUsVUFBVSxLQUFLLEVBQUU7TUFDM0UsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDO01BQ3RCLFFBQVEsQ0FDSixDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLGVBQWUsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsRUFDaEQsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsS0FBSyxJQUFJLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FDM0MsQ0FBQztJQUNMLENBQUMsQ0FBQztJQUNGLEtBQUssQ0FBQyxFQUFFLENBQUMsUUFBUSxFQUFFLGlCQUFpQixFQUFFLFlBQVk7TUFDOUMsSUFBSSxFQUFFLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO01BQ3pELElBQUksT0FBTyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO01BQ3JDLFFBQVEsQ0FBQyxTQUFTLEdBQUcsRUFBRSxFQUFFO1FBQUUsT0FBTyxFQUFFO01BQVEsQ0FBQyxFQUFFLFVBQVUsSUFBSSxFQUFFO1FBQzNELFdBQVcsQ0FBQyxJQUFJLENBQUM7UUFDakIsV0FBVyxDQUFDLENBQUM7TUFDakIsQ0FBQyxFQUFFLFVBQVUsT0FBTyxFQUFFO1FBQ2xCLFNBQVMsQ0FBQyxJQUFJLENBQUM7UUFDZixTQUFTLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDO01BQ25DLENBQUMsQ0FBQztJQUNOLENBQUMsQ0FBQztJQUNGLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFVBQVUsS0FBSyxFQUFFO01BQ3JDLElBQUksQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxPQUFPLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO1FBQzVELENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQztNQUMzQztJQUNKLENBQUMsQ0FBQztFQUNOO0VBRUEsU0FBUyxhQUFhLENBQUMsSUFBSSxFQUFFO0lBQ3pCLElBQUksS0FBSyxDQUFDLGVBQWUsRUFBRTtNQUN2QixJQUFJLENBQUMsQ0FBQztNQUNOO0lBQ0o7SUFDQSxPQUFPLENBQUMsWUFBWSxFQUFFO01BQUUsS0FBSyxFQUFFO0lBQUksQ0FBQyxFQUFFLFVBQVUsSUFBSSxFQUFFO01BQ2xELElBQUksS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLElBQUksRUFBRTtNQUM1QixJQUFJLElBQUksR0FBRyxFQUFFO01BQ2IsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7UUFDbkMsSUFBSSxRQUFRLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQztRQUN2QixJQUFJLEVBQUUsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLEVBQUUsS0FBSyxTQUFTLEdBQUcsUUFBUSxDQUFDLEVBQUUsR0FBSSxRQUFRLENBQUMsV0FBVyxJQUFJLEVBQUcsQ0FBQztRQUN2RixJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUU7VUFBRTtRQUFVO1FBQzNCLElBQUksS0FBSyxHQUFHLFFBQVEsQ0FBQyxXQUFXLElBQUksUUFBUSxDQUFDLFFBQVEsSUFBSyxHQUFHLEdBQUcsRUFBRztRQUNuRSxJQUFJLENBQUMsSUFBSSxDQUFDO1VBQUUsRUFBRSxFQUFFLEVBQUU7VUFBRSxLQUFLLEVBQUU7UUFBTSxDQUFDLENBQUM7TUFDdkM7TUFDQSxLQUFLLENBQUMsU0FBUyxHQUFHLElBQUk7TUFDdEIsS0FBSyxDQUFDLGVBQWUsR0FBRyxJQUFJO01BQzVCLElBQUksQ0FBQyxDQUFDO0lBQ1YsQ0FBQyxFQUFFLFlBQVk7TUFDWCxLQUFLLENBQUMsZUFBZSxHQUFHLEtBQUs7TUFDN0IsSUFBSSxDQUFDLENBQUM7SUFDVixDQUFDLENBQUM7RUFDTjtFQUVBLFNBQVMsUUFBUSxDQUFDLEVBQUUsRUFBRSxLQUFLLEVBQUU7SUFDekIsSUFBSSxHQUFHLEdBQUcsRUFBRTtJQUNaLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtNQUN6QyxHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ3ZDO0lBQ0EsSUFBSSxLQUFLLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDbkMsSUFBSSxNQUFNLEdBQUcsS0FBSyxHQUFHLEtBQUs7SUFDMUIsSUFBSSxLQUFLLEdBQUcsQ0FBQyxJQUFJLE1BQU0sR0FBRyxDQUFDLElBQUksTUFBTSxJQUFJLEdBQUcsQ0FBQyxNQUFNLEVBQUU7TUFDakQ7SUFDSjtJQUNBLElBQUksSUFBSSxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUM7SUFDckIsR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLEdBQUcsQ0FBQyxNQUFNLENBQUM7SUFDeEIsR0FBRyxDQUFDLE1BQU0sQ0FBQyxHQUFHLElBQUk7SUFDbEIsT0FBTyxDQUFDLHVCQUF1QixFQUFFO01BQUUsS0FBSyxFQUFFO0lBQUksQ0FBQyxFQUFFLFlBQVk7TUFDekQsU0FBUyxDQUFDLElBQUksQ0FBQztNQUNmLFNBQVMsQ0FBQyxDQUFDLENBQUMscUNBQXFDLENBQUMsQ0FBQztJQUN2RCxDQUFDLEVBQUUsVUFBVSxPQUFPLEVBQUU7TUFDbEIsU0FBUyxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNuQyxDQUFDLENBQUM7RUFDTjtFQUVBLFNBQVMsUUFBUSxDQUFDLEVBQUUsRUFBRTtJQUNsQixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7TUFDekMsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsS0FBSyxNQUFNLENBQUMsRUFBRSxDQUFDLEVBQUU7UUFDMUMsT0FBTyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztNQUN6QjtJQUNKO0lBQ0EsT0FBTyxJQUFJO0VBQ2Y7RUFFQSxTQUFTLFdBQVcsQ0FBQyxJQUFJLEVBQUU7SUFDdkIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO01BQ3pDLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsRUFBRTtRQUMvQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUk7UUFDckI7TUFDSjtJQUNKO0lBQ0EsS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO0VBQzFCO0VBRUEsU0FBUyxpQkFBaUIsQ0FBQyxJQUFJLEVBQUU7SUFDN0IsSUFBSSxDQUFDLElBQUksRUFBRTtNQUFFO0lBQVE7SUFDckIsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyx3Q0FBd0MsRUFBRTtNQUFFLEtBQUssRUFBRSxJQUFJLENBQUM7SUFBTSxDQUFDLENBQUMsQ0FBQztJQUMvRixDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxLQUFLLENBQUM7TUFBRSxRQUFRLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDO0lBQzlELENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVk7TUFDckQsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztNQUNwQyxTQUFTLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxFQUFFLEVBQUUsWUFBWTtRQUN2QyxTQUFTLENBQUMsSUFBSSxDQUFDO1FBQ2YsU0FBUyxDQUFDLENBQUMsQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFDO01BQ3RELENBQUMsRUFBRSxVQUFVLE9BQU8sRUFBRTtRQUNsQixTQUFTLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDO01BQ25DLENBQUMsQ0FBQztJQUNOLENBQUMsQ0FBQztFQUNOOztFQUVBOztFQUVBLFNBQVMsWUFBWSxHQUFHO0lBQ3BCLE9BQU87TUFBRSxRQUFRLEVBQUUsRUFBRTtNQUFFLFVBQVUsRUFBRSxFQUFFO01BQUUsU0FBUyxFQUFFLEVBQUU7TUFBRSxhQUFhLEVBQUU7SUFBSyxDQUFDO0VBQy9FO0VBRUEsU0FBUyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUU7SUFDL0IsSUFBSSxNQUFNLEdBQUcsT0FBTyxJQUFJLE9BQU8sQ0FBQyxtQkFBbUIsSUFBSSxRQUFPLE9BQU8sQ0FBQyxtQkFBbUIsTUFBSyxRQUFRLEdBQ2hHLE9BQU8sQ0FBQyxtQkFBbUIsR0FDM0IsQ0FBQyxDQUFDO0lBQ1IsSUFBSSxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUM7SUFDdEMsSUFBSSxDQUFDLE1BQU0sSUFBSSxNQUFNLEdBQUcsQ0FBQyxJQUFJLE1BQU0sR0FBRyxHQUFHLEVBQUU7TUFDdkMsTUFBTSxHQUFHLEVBQUU7SUFDZjtJQUNBLE9BQU87TUFDSCxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sS0FBSyxJQUFJO01BQ2hDLFVBQVUsRUFBRSxNQUFNO01BQ2xCLHVCQUF1QixFQUFFLE1BQU0sQ0FBQyx1QkFBdUIsS0FBSztJQUNoRSxDQUFDO0VBQ0w7RUFFQSxTQUFTLGdCQUFnQixDQUFDLE9BQU8sRUFBRTtJQUMvQixJQUFJLE1BQU0sR0FBRyxZQUFZLENBQUMsQ0FBQztJQUMzQixJQUFJLENBQUMsT0FBTyxJQUFJLFFBQU8sT0FBTyxNQUFLLFFBQVEsRUFBRTtNQUN6QyxPQUFPLE1BQU07SUFDakI7SUFDQSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxFQUFFO01BQ2pDLE1BQU0sQ0FBQyxRQUFRLEdBQUcsT0FBTyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDO0lBQ2xEO0lBQ0EsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsRUFBRTtNQUNuQyxNQUFNLENBQUMsVUFBVSxHQUFHLE9BQU8sQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDbEQ7SUFDQSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxFQUFFO01BQ2xDLE1BQU0sQ0FBQyxTQUFTLEdBQUcsT0FBTyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDO0lBQ3BEO0lBQ0EsSUFBSSxPQUFPLENBQUMsYUFBYSxJQUFJLFFBQU8sT0FBTyxDQUFDLGFBQWEsTUFBSyxRQUFRLEVBQUU7TUFDcEUsTUFBTSxDQUFDLGFBQWEsR0FBRyxDQUFDLENBQUM7TUFDekIsSUFBSSxPQUFPLENBQUMsYUFBYSxDQUFDLEdBQUcsS0FBSyxTQUFTLEVBQUU7UUFDekMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxHQUFHLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDO01BQ2hFO01BQ0EsSUFBSSxPQUFPLENBQUMsYUFBYSxDQUFDLEdBQUcsS0FBSyxTQUFTLEVBQUU7UUFDekMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxHQUFHLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDO01BQ2hFO0lBQ0o7SUFDQSxPQUFPLE1BQU07RUFDakI7O0VBRUE7RUFDQSxTQUFTLG9CQUFvQixDQUFDLE9BQU8sRUFBRTtJQUNuQyxJQUFJLEtBQUssR0FBRyxPQUFPLEdBQUcsT0FBTyxDQUFDLFdBQVcsR0FBRyxJQUFJO0lBQ2hELE9BQU8sS0FBSyxLQUFLLFdBQVcsSUFBSSxLQUFLLEtBQUssV0FBVyxHQUFHLEtBQUssR0FBRyxNQUFNO0VBQzFFOztFQUVBO0VBQ0EsU0FBUyxxQkFBcUIsQ0FBQyxLQUFLLEVBQUU7SUFDbEMsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLDhCQUE4QixDQUFDLElBQUksQ0FBQyxFQUFFO01BQUUsT0FBTyxDQUFDLE1BQU0sRUFBRSxXQUFXLEVBQUUsV0FBVyxDQUFDO0lBQUU7SUFDckcsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxFQUFFO01BQUUsT0FBTyxDQUFDLE1BQU0sRUFBRSxXQUFXLENBQUM7SUFBRTtJQUMxRSxPQUFPLEVBQUU7RUFDYjtFQUVBLFNBQVMsZ0JBQWdCLEdBQUc7SUFDeEIsYUFBYSxDQUFDLFlBQVk7TUFDdEIsSUFBSSxLQUFLLENBQUMsVUFBVSxJQUFJLEtBQUssQ0FBQyxVQUFVLENBQUMsSUFBSSxLQUFLLENBQUMsRUFBRTtRQUFFLHNCQUFzQixDQUFDLENBQUM7TUFBRTtJQUNyRixDQUFDLENBQUM7SUFDRixhQUFhLENBQUMsWUFBWTtNQUN0QixJQUFJLEtBQUssQ0FBQyxVQUFVLElBQUksS0FBSyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEtBQUssQ0FBQyxFQUFFO1FBQUUsc0JBQXNCLENBQUMsQ0FBQztNQUFFO0lBQ3JGLENBQUMsQ0FBQztJQUNGLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxFQUFFO01BQ25CLFFBQVEsQ0FBQyxJQUFJLENBQUM7SUFDbEI7RUFDSjtFQUVBLFNBQVMsY0FBYyxDQUFDLElBQUksRUFBRTtJQUMxQixnQkFBZ0IsQ0FBQyxDQUFDO0lBQ2xCLElBQUksTUFBTSxHQUFHLElBQUksR0FBRyxhQUFhLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSTtJQUM5QyxLQUFLLENBQUMsVUFBVSxHQUFHO01BQ2YsSUFBSSxFQUFFLElBQUksR0FBRyxzQkFBc0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLElBQUksRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDO01BQ3pFLE1BQU0sRUFBRSxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDO01BQ2xDLFFBQVEsRUFBRSxNQUFNLEdBQUcsTUFBTSxDQUFDLEVBQUUsR0FBRyxFQUFFO01BQ2pDLFVBQVUsRUFBRSxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsV0FBVyxJQUFJLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQyxHQUFHLEVBQUU7TUFDeEQsS0FBSyxFQUFFLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxHQUFHLEVBQUU7TUFDN0IsT0FBTyxFQUFFLGdCQUFnQixDQUFDLElBQUksR0FBRyxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQztNQUNyRCxVQUFVLEVBQUUsSUFBSSxHQUFHLElBQUksQ0FBQyxXQUFXLEdBQUcsd0JBQXdCO01BQzlELE9BQU8sRUFBRSxJQUFJLEdBQ1AsQ0FBQyxJQUFJLENBQUMsUUFBUSxJQUFJLEVBQUUsRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsTUFBTSxDQUFDLFVBQVUsRUFBRSxFQUFFO1FBQ3JELE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxJQUFJLEVBQUUsRUFBRSxJQUFJLENBQUMsVUFBVSxJQUFJLEVBQUU7VUFBRSxPQUFPLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEtBQUssRUFBRTtRQUFFLENBQUMsQ0FBQztNQUN0RixDQUFDLENBQUMsR0FDQSxFQUFFO01BQ1IsSUFBSSxFQUFFLElBQUksR0FBRyxDQUFDLEVBQUUsSUFBSSxDQUFDLE9BQU8sSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLFVBQVUsS0FBSyxJQUFJLENBQUMsR0FDM0QsQ0FBQyxFQUFFLEtBQUssQ0FBQyxRQUFRLElBQUksS0FBSyxDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsS0FBSyxJQUFJLENBQUM7TUFDdEUsT0FBTyxFQUFFLGdCQUFnQixDQUFDLElBQUksR0FBRyxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQztNQUNyRCxXQUFXLEVBQUUsb0JBQW9CLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFDO01BQzdELEtBQUssRUFBRSxJQUFJLElBQUksSUFBSSxDQUFDLEtBQUssSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQztNQUNyRixLQUFLLEVBQUU7SUFDWCxDQUFDO0lBQ0QsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUM7SUFDeEMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUM7SUFDcEMsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsUUFBUSxDQUFDLGdCQUFnQixDQUFDO0lBQ25ELGdCQUFnQixDQUFDLENBQUM7SUFDbEIsWUFBWSxDQUFDLENBQUM7RUFDbEI7RUFFQSxTQUFTLGVBQWUsR0FBRztJQUN2QixDQUFDLENBQUMsK0NBQStDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUMxRCxLQUFLLENBQUMsVUFBVSxHQUFHLElBQUk7SUFDdkIsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO0lBQ3BDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUM7SUFDeEMsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsV0FBVyxDQUFDLGdCQUFnQixDQUFDO0lBQ3RELFdBQVcsQ0FBQyxDQUFDO0VBQ2pCO0VBRUEsU0FBUyxjQUFjLEdBQUc7SUFDdEIsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDLFVBQVU7SUFDeEIsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLFFBQVEsR0FBRyxVQUFVLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxHQUFHLElBQUk7RUFDMUQ7RUFFQSxTQUFTLHVCQUF1QixDQUFDLEtBQUssRUFBRTtJQUNwQyxJQUFJLFNBQVMsR0FBRyxDQUFDLGtCQUFrQixFQUFFLDhCQUE4QixDQUFDO0lBQ3BFLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO01BQ25DLElBQUksU0FBUyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUU7UUFBRSxPQUFPLElBQUk7TUFBRTtJQUN6RDtJQUNBLE9BQU8sS0FBSztFQUNoQjtFQUVBLFNBQVMsd0JBQXdCLENBQUMsS0FBSyxFQUFFO0lBQ3JDLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLDhCQUE4QixDQUFDLElBQUksQ0FBQztFQUN2RztFQUVBLFNBQVMsdUJBQXVCLENBQUMsS0FBSyxFQUFFO0lBQ3BDLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQztFQUM3Rjs7RUFFQTtFQUNBLFNBQVMsbUJBQW1CLENBQUMsS0FBSyxFQUFFO0lBQ2hDLE9BQU8sdUJBQXVCLENBQUMsS0FBSyxDQUFDLElBQUksd0JBQXdCLENBQUMsS0FBSyxDQUFDLElBQUksdUJBQXVCLENBQUMsS0FBSyxDQUFDLElBQ25HLEtBQUssQ0FBQyxPQUFPLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyw4QkFBOEIsQ0FBQyxJQUFJLENBQUM7RUFDdkc7RUFFQSxTQUFTLHNCQUFzQixDQUFDLEtBQUssRUFBRTtJQUNuQyxPQUFPLG1CQUFtQixDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDO0VBQzdDO0VBRUEsU0FBUyxZQUFZLEdBQUc7SUFDcEIsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDLFVBQVU7SUFDeEIsSUFBSSxDQUFDLENBQUMsRUFBRTtNQUFFO0lBQVE7SUFDbEIsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsQ0FBQztJQUNuRCxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxDQUFDO0lBQ25ELENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLENBQUM7SUFDbkQsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNqRCxJQUFJLFFBQVEsR0FBRyxjQUFjLENBQUMsQ0FBQztJQUMvQixJQUFJLEtBQUs7SUFDVCxJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxFQUFFO01BQ2QsS0FBSyxHQUFHLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDO0lBQzFFLENBQUMsTUFBTTtNQUNILEtBQUssR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxHQUFJLFFBQVEsR0FBRyxRQUFRLENBQUMsSUFBSSxHQUFHLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBRTtJQUN2RztJQUNBLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUM7SUFDakM7SUFDQSxJQUFJLFNBQVMsR0FBRyxDQUFDLENBQUMsSUFBSSxHQUFHLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssc0JBQXNCLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxRQUFRLEtBQUssRUFBRSxDQUFDO0lBQ3JILENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsbUNBQW1DLENBQUMsR0FBRyxDQUFDLENBQUMsdUNBQXVDLENBQUMsQ0FBQyxDQUN4SCxJQUFJLENBQUMsTUFBTSxFQUFFLFNBQVMsR0FBRyxNQUFNLEdBQUcsUUFBUSxDQUFDO0lBQ2hELElBQUksTUFBTSxHQUFHLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQztJQUN6QixDQUFDLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxHQUN6QixDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsaUNBQWlDLENBQUMsR0FBRyxDQUFDLENBQUMsbUNBQW1DLENBQUMsR0FDN0YsQ0FBQyxDQUFDLGlDQUFpQyxDQUFDLENBQUM7SUFDM0MsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsRUFBRTtNQUFFLHFCQUFxQixDQUFDLENBQUM7SUFBRTtJQUM3QyxJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxFQUFFO01BQUUsc0JBQXNCLENBQUMsQ0FBQztJQUFFO0lBQzlDLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLEVBQUU7TUFBRSxzQkFBc0IsQ0FBQyxDQUFDO0lBQUU7SUFDOUMsZ0JBQWdCLENBQUMsQ0FBQztFQUN0QjtFQUVBLFNBQVMsZ0JBQWdCLEdBQUc7SUFDeEIsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDLFVBQVU7SUFDeEIsSUFBSSxDQUFDLENBQUMsRUFBRTtNQUFFO0lBQVE7SUFDbEIsSUFBSSxRQUFRLEdBQUcsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLFFBQVEsS0FBSyxFQUFFO0lBQ2hELElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLEVBQUU7TUFDZCxRQUFRLEdBQUcsZUFBZSxDQUFDLENBQUMsS0FBSyxJQUFJO0lBQ3pDO0lBQ0EsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQyxXQUFXLENBQUMsVUFBVSxFQUFFLFFBQVEsQ0FBQztFQUNyRjs7RUFFQTtFQUNBLElBQUksY0FBYyxHQUFHO0lBQ2pCLEtBQUssRUFBRSxpSUFBaUk7SUFDeEksR0FBRyxFQUFFLGlHQUFpRztJQUN0RyxPQUFPLEVBQUUsNEZBQTRGO0lBQ3JHLEtBQUssRUFBRSx1RkFBdUY7SUFDOUYsTUFBTSxFQUFFLG1JQUFtSTtJQUMzSSxPQUFPLEVBQUUsNERBQTREO0lBQ3JFLElBQUksRUFBRTtFQUNWLENBQUM7RUFDRCxJQUFJLHVCQUF1QixHQUFHO0lBQzFCLGtCQUFrQixFQUFFLE9BQU87SUFDM0IsZ0JBQWdCLEVBQUUsS0FBSztJQUN2Qiw4QkFBOEIsRUFBRSxTQUFTO0lBQ3pDLHVCQUF1QixFQUFFLE9BQU87SUFDaEMsa0JBQWtCLEVBQUUsS0FBSztJQUN6QixrQkFBa0IsRUFBRSxLQUFLO0lBQ3pCLGlCQUFpQixFQUFFLFNBQVM7SUFDNUIsdUJBQXVCLEVBQUUsT0FBTztJQUNoQyxxQkFBcUIsRUFBRSxPQUFPO0lBQzlCLHNCQUFzQixFQUFFLFFBQVE7SUFDaEMsYUFBYSxFQUFFLFNBQVM7SUFDeEIsa0JBQWtCLEVBQUU7RUFDeEIsQ0FBQztFQUVELFNBQVMsWUFBWSxDQUFDLFFBQVEsRUFBRTtJQUM1QixJQUFJLEtBQUssR0FBRyxjQUFjLENBQUMsdUJBQXVCLENBQUMsUUFBUSxDQUFDLElBQUksU0FBUyxDQUFDO0lBQzFFLE9BQU8sMEZBQTBGLEdBQUcsS0FBSyxHQUFHLGVBQWU7RUFDL0g7RUFFQSxTQUFTLHFCQUFxQixHQUFHO0lBQzdCLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxVQUFVO0lBQ3hCLElBQUksTUFBTSxHQUFHLFdBQVcsQ0FBQyxNQUFNLENBQUMsVUFBVSxLQUFLLEVBQUU7TUFDN0MsT0FBTyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxVQUFVLE1BQU0sRUFBRTtRQUFFLE9BQU8sTUFBTSxDQUFDLEtBQUssS0FBSyxLQUFLO01BQUUsQ0FBQyxDQUFDO0lBQ25GLENBQUMsQ0FBQztJQUNGLElBQUksSUFBSSxHQUFHLEVBQUU7SUFDYixNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsS0FBSyxFQUFFO01BQzVCLElBQUksT0FBTyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLFVBQVUsTUFBTSxFQUFFO1FBQUUsT0FBTyxNQUFNLENBQUMsS0FBSyxLQUFLLEtBQUs7TUFBRSxDQUFDLENBQUM7TUFDeEYsSUFBSSxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtRQUNuQixJQUFJLElBQUksNkJBQTZCLEdBQUcsR0FBRyxDQUFDLGVBQWUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFHLE9BQU87TUFDakY7TUFDQSxJQUFJLElBQUksZ0NBQWdDO01BQ3hDLE9BQU8sQ0FBQyxPQUFPLENBQUMsVUFBVSxNQUFNLEVBQUU7UUFDOUIsSUFBSSxRQUFRLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxpQkFBaUIsRUFBRSxlQUFlLEVBQUUsa0JBQWtCLEVBQUUsT0FBTyxFQUFFLFVBQVUsQ0FBQyxDQUN6RyxPQUFPLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUM7UUFDdEMsSUFBSSxRQUFRLEdBQUcsQ0FBQyxDQUFDLFFBQVEsS0FBSyxNQUFNLENBQUMsRUFBRTtRQUN2QztRQUNBLElBQUksSUFBSSwwQ0FBMEMsSUFBSSxRQUFRLEdBQUcsY0FBYyxHQUFHLEVBQUUsQ0FBQyxJQUFJLFFBQVEsR0FBRyxjQUFjLEdBQUcsRUFBRSxDQUFDLEdBQ2xILG9CQUFvQixHQUFHLEdBQUcsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLEdBQUcsa0JBQWtCLElBQUksUUFBUSxHQUFHLE1BQU0sR0FBRyxPQUFPLENBQUMsR0FBRyxHQUFHLElBQy9GLFFBQVEsR0FBRyxnQ0FBZ0MsR0FBRyxFQUFFLENBQUMsR0FBRyxHQUFHLEdBQ3hELFlBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLEdBQ3ZCLG9DQUFvQyxHQUFHLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsTUFBTSxJQUMvRCxRQUFRLEdBQUcsd0JBQXdCLEdBQUcsR0FBRyxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLFNBQVMsR0FBRyxFQUFFLENBQUMsR0FDckYsa0JBQWtCO01BQzVCLENBQUMsQ0FBQztNQUNGLElBQUksSUFBSSxRQUFRO0lBQ3BCLENBQUMsQ0FBQztJQUNGLENBQUMsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7RUFDeEM7O0VBRUE7O0VBRUEsU0FBUyxzQkFBc0IsR0FBRztJQUM5QixJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsVUFBVTtJQUN4QixJQUFJLENBQUMsQ0FBQyxFQUFFO01BQUU7SUFBUTtJQUNsQixJQUFJLElBQUksR0FBRyxFQUFFO0lBQ2IsSUFBSSx1QkFBdUIsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLEVBQUU7TUFDdkMsSUFBSSxJQUFJLG1CQUFtQixJQUFJLEtBQUssQ0FBQyxlQUFlLEdBQUcsUUFBUSxHQUFHLEVBQUUsQ0FBQyxHQUFHLGlDQUFpQyxHQUNuRyxTQUFTLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDLEdBQUcsVUFBVSxHQUN2RSwwR0FBMEcsR0FDMUcsa0RBQWtELEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDLEdBQUcsdUNBQXVDLElBQ3RJLEtBQUssQ0FBQyxlQUFlLEdBQ2xCLHdCQUF3QixHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsdUNBQXVDLENBQUMsQ0FBQyxHQUN0RSw2Q0FBNkMsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDLENBQUMsR0FBRyxhQUFhLEdBQzlHLEVBQUUsQ0FBQyxHQUNQLFFBQVE7SUFDbEI7SUFDQSxJQUFJLHdCQUF3QixDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsRUFBRTtNQUN4QyxJQUFJLFVBQVUsR0FBRyxDQUNiLENBQUMsVUFBVSxFQUFFLDhDQUE4QyxDQUFDLEVBQzVELENBQUMsVUFBVSxFQUFFLDhDQUE4QyxDQUFDLEVBQzVELENBQUMsVUFBVSxFQUFFLDhDQUE4QyxDQUFDLENBQy9EO01BQ0QsSUFBSSxJQUFJLDRCQUE0QixHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsdUNBQXVDLENBQUMsQ0FBQyxHQUFHLFVBQVUsR0FDN0YsK0NBQStDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFDLEdBQUcsSUFBSTtNQUM5RyxVQUFVLENBQUMsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFO1FBQy9CLElBQUksT0FBTyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO1FBQ3hELElBQUksSUFBSSx3Q0FBd0MsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsa0JBQWtCLElBQUksT0FBTyxHQUFHLE1BQU0sR0FBRyxPQUFPLENBQUMsR0FBRyxJQUFJLEdBQy9HLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxXQUFXO01BQ3ZDLENBQUMsQ0FBQztNQUNGLElBQUksSUFBSSxjQUFjO0lBQzFCO0lBQ0EsSUFBSSx1QkFBdUIsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLEVBQUU7TUFDdkMsSUFBSSxJQUFJLDRCQUE0QixHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsc0NBQXNDLENBQUMsQ0FBQyxHQUFHLFVBQVUsR0FDNUYsMEdBQTBHLEdBQzFHLGtEQUFrRCxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsZ0NBQWdDLENBQUMsQ0FBQyxHQUFHLDZDQUE2QztJQUN2SjtJQUNBLElBQUksQ0FBQyxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsOEJBQThCLENBQUMsSUFBSSxDQUFDLEVBQUU7TUFDM0QsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxhQUFhLElBQUksQ0FBQyxDQUFDO01BQ3pDLElBQUksSUFBSSw0QkFBNEIsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLG9DQUFvQyxDQUFDLENBQUMsR0FBRyxVQUFVLEdBQzFGLGdDQUFnQyxHQUNoQyxRQUFRLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFDLEdBQUcsMEZBQTBGLElBQUksS0FBSyxDQUFDLEdBQUcsS0FBSyxTQUFTLEdBQUcsS0FBSyxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsR0FBRyxJQUFJLEdBQzVNLFFBQVEsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHNDQUFzQyxDQUFDLENBQUMsR0FBRywwRkFBMEYsSUFBSSxLQUFLLENBQUMsR0FBRyxLQUFLLFNBQVMsR0FBRyxLQUFLLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxHQUFHLElBQUksR0FDMU0sY0FBYztJQUN4QjtJQUNBLElBQUksQ0FBQyxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLEVBQUU7TUFDL0MsSUFBSSxJQUFJLDRDQUE0QyxHQUM5QyxrQ0FBa0MsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sR0FBRyxVQUFVLEdBQUcsRUFBRSxDQUFDLEdBQUcsNEJBQTRCLEdBQ3pHLHVDQUF1QyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxHQUFHLFVBQVUsR0FBRyxFQUFFLENBQUMsR0FBRyxlQUFlLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDLEdBQUcsSUFBSSxHQUN4Six3Q0FBd0MsR0FDeEMsUUFBUSxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMscUNBQXFDLENBQUMsQ0FBQyxHQUFHLFNBQVMsR0FDcEUsd0RBQXdELElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEdBQUcsRUFBRSxHQUFHLFNBQVMsQ0FBQyxHQUFHLEdBQUcsR0FDckcseUJBQXlCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQywwQ0FBMEMsQ0FBQyxDQUFDLEdBQUcsU0FBUyxHQUMxRiwyRkFBMkYsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsR0FBRyxnQkFBZ0IsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLENBQUMsR0FBRyxJQUFJLEdBQzVMLHlCQUF5QixHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMscUNBQXFDLENBQUMsQ0FBQyxHQUFHLGdCQUFnQixHQUM1RixRQUFRLElBQ1AsV0FBVyxDQUFDLENBQUMsR0FDViw2Q0FBNkMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sR0FBRyxFQUFFLEdBQUcsU0FBUyxDQUFDLEdBQUcsR0FBRyxHQUN0Rix3QkFBd0IsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLENBQUMsR0FBRyxlQUFlLEdBQzlGLEVBQUUsQ0FBQztJQUNqQjtJQUNBLENBQUMsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7SUFDckMsc0JBQXNCLENBQUMsQ0FBQztJQUN4QixvQkFBb0IsQ0FBQyxDQUFDO0lBQ3RCLG1CQUFtQixDQUFDLENBQUM7RUFDekI7RUFFQSxTQUFTLHNCQUFzQixHQUFHO0lBQzlCLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxVQUFVO0lBQ3hCLElBQUksVUFBVSxHQUFHLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQztJQUN4QyxJQUFJLFVBQVUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO01BQ3ZCLElBQUksYUFBYSxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUM7TUFDbEQsVUFBVSxDQUFDLFFBQVEsQ0FBQztRQUNoQixNQUFNLEVBQUUsS0FBSyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsVUFBVSxRQUFRLEVBQUU7VUFDNUMsT0FBTztZQUFFLElBQUksRUFBRSxRQUFRLENBQUMsS0FBSztZQUFFLEtBQUssRUFBRSxNQUFNLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQztZQUFFLFFBQVEsRUFBRSxhQUFhLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSTtVQUFFLENBQUM7UUFDMUgsQ0FBQyxDQUFDO1FBQ0YsV0FBVyxFQUFFLENBQUMsQ0FBQyxnQ0FBZ0MsQ0FBQztRQUNoRCxjQUFjLEVBQUUsSUFBSTtRQUNwQixPQUFPLEVBQUU7VUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDLHlDQUF5QztRQUFFLENBQUM7UUFDcEUsUUFBUSxFQUFFLFNBQVYsUUFBUSxDQUFZLEtBQUssRUFBRTtVQUN2QixJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRTtZQUFFO1VBQVE7VUFDakMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsUUFBUSxHQUFHLE1BQU0sQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDO1FBQ2xHO01BQ0osQ0FBQyxDQUFDO0lBQ047SUFDQSxJQUFJLFVBQVUsR0FBRyxDQUFDLENBQUMsb0JBQW9CLENBQUM7SUFDeEMsSUFBSSxVQUFVLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtNQUN2QixJQUFJLGlCQUFpQixHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUM7TUFDdkQsVUFBVSxDQUFDLFFBQVEsQ0FBQztRQUNoQixNQUFNLEVBQUUsS0FBSyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsVUFBVSxRQUFRLEVBQUU7VUFDNUMsT0FBTztZQUFFLElBQUksRUFBRSxRQUFRLENBQUMsS0FBSztZQUFFLEtBQUssRUFBRSxNQUFNLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQztZQUFFLFFBQVEsRUFBRSxpQkFBaUIsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJO1VBQUUsQ0FBQztRQUM5SCxDQUFDLENBQUM7UUFDRixXQUFXLEVBQUUsQ0FBQyxDQUFDLGdDQUFnQyxDQUFDO1FBQ2hELGNBQWMsRUFBRSxJQUFJO1FBQ3BCLE9BQU8sRUFBRTtVQUFFLFNBQVMsRUFBRSxDQUFDLENBQUMseUNBQXlDO1FBQUUsQ0FBQztRQUNwRSxRQUFRLEVBQUUsU0FBVixRQUFRLENBQVksS0FBSyxFQUFFO1VBQ3ZCLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxFQUFFO1lBQUU7VUFBUTtVQUNqQyxLQUFLLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxTQUFTLEdBQUcsTUFBTSxDQUFDLEtBQUssSUFBSSxFQUFFLENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQztRQUN2RjtNQUNKLENBQUMsQ0FBQztJQUNOO0VBQ0o7RUFFQSxTQUFTLG9CQUFvQixHQUFHO0lBQzVCLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQyx1QkFBdUIsQ0FBQztJQUN0QyxLQUFLLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQztJQUNwQixLQUFLLENBQUMsRUFBRSxDQUFDLGNBQWMsRUFBRSxnQkFBZ0IsRUFBRSxZQUFZO01BQ25ELElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxVQUFVO01BQ3hCLElBQUksQ0FBQyxDQUFDLEVBQUU7UUFBRTtNQUFRO01BQ2xCLElBQUksS0FBSyxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDO01BQzdDLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUM7TUFDL0MsSUFBSSxLQUFLLElBQUksQ0FBQyxFQUFFO1FBQ1osQ0FBQyxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUM7TUFDekMsQ0FBQyxNQUFNO1FBQ0gsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQztNQUNwQztNQUNBLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFLEtBQUssSUFBSSxDQUFDLEdBQUcsT0FBTyxHQUFHLE1BQU0sQ0FBQztNQUMzRCxtQkFBbUIsQ0FBQyxDQUFDO0lBQ3pCLENBQUMsQ0FBQztJQUNGLEtBQUssQ0FBQyxFQUFFLENBQUMsY0FBYyxFQUFFLGlDQUFpQyxFQUFFLFVBQVUsS0FBSyxFQUFFO01BQ3pFLEtBQUssQ0FBQyxjQUFjLENBQUMsQ0FBQztNQUN0QixLQUFLLENBQUMsZUFBZSxHQUFHLEtBQUs7TUFDN0IsYUFBYSxDQUFDLFlBQVk7UUFBRSxzQkFBc0IsQ0FBQyxDQUFDO01BQUUsQ0FBQyxDQUFDO0lBQzVELENBQUMsQ0FBQztJQUNGLEtBQUssQ0FBQyxFQUFFLENBQUMsZUFBZSxFQUFFLDJCQUEyQixFQUFFLFlBQVk7TUFDL0QsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDLFVBQVU7TUFDeEIsSUFBSSxDQUFDLENBQUMsRUFBRTtRQUFFO01BQVE7TUFDbEIsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7TUFDM0MsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsV0FBVyxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQztNQUNsRSxDQUFDLENBQUMscUJBQXFCLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUM7TUFDM0QsQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDO0lBQ2hFLENBQUMsQ0FBQztJQUNGLEtBQUssQ0FBQyxFQUFFLENBQUMsNEJBQTRCLEVBQUUsb0JBQW9CLEVBQUUsWUFBWTtNQUNyRSxJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsVUFBVTtNQUN4QixJQUFJLENBQUMsQ0FBQyxFQUFFO1FBQUU7TUFBUTtNQUNsQixJQUFJLEtBQUssR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7TUFDakMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxVQUFVLEdBQUcsS0FBSyxJQUFJLENBQUMsSUFBSSxLQUFLLElBQUksR0FBRyxHQUFHLEtBQUssR0FBRyxFQUFFO0lBQ2xFLENBQUMsQ0FBQztJQUNGLEtBQUssQ0FBQyxFQUFFLENBQUMsY0FBYyxFQUFFLGtDQUFrQyxFQUFFLFlBQVk7TUFDckUsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDLFVBQVU7TUFDeEIsSUFBSSxDQUFDLENBQUMsRUFBRTtRQUFFO01BQVE7TUFDbEIsSUFBSSxHQUFHLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO01BQzdDLElBQUksR0FBRyxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztNQUM3QyxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUM7TUFDZCxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtRQUFFLEtBQUssQ0FBQyxHQUFHLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQztNQUFFO01BQzFELElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFO1FBQUUsS0FBSyxDQUFDLEdBQUcsR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDO01BQUU7TUFDMUQsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxhQUFhLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxHQUFHLEtBQUssR0FBRyxJQUFJO01BQ3RFLG1CQUFtQixDQUFDLENBQUM7SUFDekIsQ0FBQyxDQUFDO0VBQ047O0VBRUE7O0VBRUEsU0FBUyxlQUFlLEdBQUc7SUFDdkIsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDLFVBQVU7SUFDeEIsSUFBSSxDQUFDLENBQUMsRUFBRTtNQUFFLE9BQU8sSUFBSTtJQUFFO0lBQ3ZCLElBQUksSUFBSSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFVBQVUsR0FBRyxFQUFFO01BQUUsT0FBTyxHQUFHLENBQUMsT0FBTyxLQUFLLEtBQUs7SUFBRSxDQUFDLENBQUM7SUFDOUUsSUFBSSxDQUFDLENBQUMsS0FBSyxHQUFHLENBQUMsRUFBRTtNQUNiLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO1FBQ2xDLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsS0FBSyxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxFQUFFO1VBQUUsT0FBTyxJQUFJLENBQUMsQ0FBQyxDQUFDO1FBQUU7TUFDbEU7SUFDSjtJQUNBLE9BQU8sSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUk7RUFDM0M7RUFFQSxTQUFTLHNCQUFzQixHQUFHO0lBQzlCLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxVQUFVO0lBQ3hCLElBQUksaUJBQWlCLEdBQUcsdUJBQXVCLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQztJQUM3RCxJQUFJLElBQUksR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVLEdBQUcsRUFBRTtNQUFFLE9BQU8sR0FBRyxDQUFDLE9BQU8sS0FBSyxLQUFLO0lBQUUsQ0FBQyxDQUFDO0lBQzlFLElBQUksTUFBTSxHQUFHLGVBQWUsQ0FBQyxDQUFDO0lBQzlCLElBQUksTUFBTSxLQUFLLElBQUksSUFBSSxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLEVBQUU7TUFDMUQsQ0FBQyxDQUFDLEtBQUssR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDakM7SUFDQSxJQUFJLE9BQU8sR0FBRyxFQUFFO0lBQ2hCLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxHQUFHLEVBQUU7TUFDeEIsSUFBSSxRQUFRLEdBQUcsTUFBTSxLQUFLLElBQUksSUFBSSxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxLQUFLLE1BQU0sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO01BQ3RFLElBQUksT0FBTyxHQUFHLEdBQUcsQ0FBQyxPQUFPLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRyxJQUFJO01BQ2xELE9BQU8sSUFBSSx3REFBd0QsSUFBSSxRQUFRLEdBQUcsY0FBYyxHQUFHLEVBQUUsQ0FBQyxHQUNoRyxpQkFBaUIsR0FBRyxHQUFHLENBQUMsRUFBRSxHQUFHLGtCQUFrQixJQUFJLFFBQVEsR0FBRyxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsSUFBSSxHQUN0Riw0QkFBNEIsR0FBRyxPQUFPLEdBQUcsdUJBQXVCLElBQUksT0FBTyxLQUFLLEtBQUssR0FBRyxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsU0FBUyxHQUNqSCx5QkFBeUIsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLGVBQWU7SUFDdEUsQ0FBQyxDQUFDO0lBQ0YsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQztJQUNsQyxDQUFDLENBQUMsdUJBQXVCLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxHQUFHLElBQUksR0FBRyxJQUFJLENBQUM7SUFDeEUsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFDO0lBQ3JFLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLEdBQUcsSUFBSSxHQUFHLElBQUksQ0FBQztJQUVwRSxJQUFJLENBQUMsaUJBQWlCLEVBQUU7TUFDcEIsQ0FBQyxDQUFDLFVBQVUsR0FBRyxZQUFZO01BQzNCLENBQUMsQ0FBQywwRkFBMEYsQ0FBQyxDQUN4RixPQUFPLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUM7SUFDOUMsQ0FBQyxNQUFNO01BQ0gsQ0FBQyxDQUFDLDBGQUEwRixDQUFDLENBQ3hGLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO0lBQzlDO0lBQ0EsQ0FBQyxDQUFDLDJDQUEyQyxDQUFDLENBQUMsSUFBSSxDQUFDLFlBQVk7TUFDNUQsSUFBSSxPQUFPLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLFVBQVU7TUFDNUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsT0FBTyxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLFdBQVcsQ0FBQyxTQUFTLEVBQUUsT0FBTyxDQUFDO0lBQ3JGLENBQUMsQ0FBQztJQUNGLGlCQUFpQixDQUFDLENBQUM7SUFDbkIsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsV0FBVyxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDO0lBQ25ELENBQUMsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQztJQUNsRCx1QkFBdUIsQ0FBQyxDQUFDO0lBQ3pCLG9CQUFvQixDQUFDLENBQUM7SUFDdEI7SUFDQSxtQkFBbUIsQ0FBQyxDQUFDO0VBQ3pCO0VBRUEsU0FBUyx1QkFBdUIsR0FBRztJQUMvQixJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsVUFBVTtJQUN4QixJQUFJLEtBQUssR0FBRyxxQkFBcUIsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDO0lBQy9DLElBQUksTUFBTSxHQUFHLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQztJQUN4QyxJQUFJLEtBQUssQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO01BQ3BCLENBQUMsQ0FBQyxXQUFXLEdBQUcsTUFBTTtNQUN0QixNQUFNLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUM7TUFDM0I7SUFDSjtJQUNBLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxFQUFFO01BQUUsQ0FBQyxDQUFDLFdBQVcsR0FBRyxNQUFNO0lBQUU7SUFDaEUsTUFBTSxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUM7SUFDM0I7SUFDQSxJQUFJLGFBQWEsR0FBRyxDQUFDLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyw4QkFBOEIsQ0FBQyxHQUFHLENBQUM7SUFDNUUsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxhQUFhLEdBQ3BELDRDQUE0QyxHQUM1Qyw0Q0FBNEMsQ0FBQyxDQUFDO0lBQ3BELE1BQU0sQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxJQUFJLENBQUMsWUFBWTtNQUM3QyxJQUFJLElBQUksR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztNQUN2QyxJQUFJLE9BQU8sR0FBRyxJQUFJLEtBQUssQ0FBQyxDQUFDLFdBQVc7TUFDcEMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxHQUFHLElBQUksQ0FBQyxDQUN6RCxXQUFXLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQztJQUMvRSxDQUFDLENBQUM7SUFDRixDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxXQUFXLEtBQUssTUFBTSxHQUFHLElBQUksR0FBRyxJQUFJLENBQUM7RUFDdEY7RUFFQSxTQUFTLGlCQUFpQixHQUFHO0lBQ3pCLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxVQUFVO0lBQ3hCLElBQUksR0FBRyxHQUFHLGVBQWUsQ0FBQyxDQUFDO0lBQzNCLElBQUksS0FBSyxHQUFHLEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQyxLQUFLLElBQUksRUFBRSxFQUFFLE1BQU0sQ0FBQyxVQUFVLElBQUksRUFBRTtNQUN2RCxPQUFPLElBQUksQ0FBQyxLQUFLLEtBQUssUUFBUSxJQUFJLElBQUksQ0FBQyxPQUFPLEtBQUssSUFBSTtJQUMzRCxDQUFDLENBQUMsR0FBRyxFQUFFO0lBQ1AsSUFBSSxHQUFHLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBQyxVQUFVLElBQUksRUFBRTtNQUFFLE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7SUFBRSxDQUFDLENBQUM7SUFDaEUsQ0FBQyxDQUFDLE9BQU8sR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxVQUFVLEVBQUUsRUFBRTtNQUFFLE9BQU8sR0FBRyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDO0lBQUUsQ0FBQyxDQUFDO0lBQzVFLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDLFVBQVUsS0FBSyxVQUFVLEdBQUcsSUFBSSxHQUFHLElBQUksQ0FBQztJQUNyRixJQUFJLFNBQVMsR0FBRyxDQUFDLENBQUMsa0JBQWtCLENBQUM7SUFDckMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUM7SUFDN0IsU0FBUyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNyQyxTQUFTLENBQUMsUUFBUSxDQUFDO01BQ2YsTUFBTSxFQUFFLEtBQUssQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLEVBQUU7UUFDOUIsT0FBTztVQUNILElBQUksRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsMkJBQTJCLEdBQUcsR0FBRyxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsR0FBRyxTQUFTO1VBQ3BILElBQUksRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDO1VBQ3JDLEtBQUssRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztVQUN0QixRQUFRLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJO1FBQ3BELENBQUM7TUFDTCxDQUFDLENBQUM7TUFDRixXQUFXLEVBQUUsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLEdBQUcsQ0FBQyxDQUFDLG9DQUFvQyxDQUFDO01BQ3BILE9BQU8sRUFBRTtRQUFFLFNBQVMsRUFBRSxDQUFDLENBQUMsb0NBQW9DO01BQUUsQ0FBQztNQUMvRCxRQUFRLEVBQUUsU0FBVixRQUFRLENBQVksS0FBSyxFQUFFO1FBQ3ZCLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxFQUFFO1VBQUU7UUFBUTtRQUNqQyxLQUFLLENBQUMsVUFBVSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQztNQUN6RjtJQUNKLENBQUMsQ0FBQztFQUNOO0VBRUEsU0FBUyxvQkFBb0IsR0FBRztJQUM1QixJQUFJLEtBQUssR0FBRyxDQUFDLENBQUMsbUJBQW1CLENBQUM7SUFDbEMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUM7SUFDcEIsS0FBSyxDQUFDLEVBQUUsQ0FBQyxjQUFjLEVBQUUsZ0JBQWdCLEVBQUUsVUFBVSxLQUFLLEVBQUU7TUFDeEQsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDO01BQ3RCLEtBQUssQ0FBQyxVQUFVLENBQUMsS0FBSyxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO01BQ3ZELEtBQUssQ0FBQyxVQUFVLENBQUMsT0FBTyxHQUFHLEVBQUU7TUFDN0Isc0JBQXNCLENBQUMsQ0FBQztNQUN4QixtQkFBbUIsQ0FBQyxDQUFDO01BQ3JCLGdCQUFnQixDQUFDLENBQUM7SUFDdEIsQ0FBQyxDQUFDO0lBQ0YsS0FBSyxDQUFDLEVBQUUsQ0FBQyxlQUFlLEVBQUUseUJBQXlCLEVBQUUsWUFBWTtNQUM3RCxLQUFLLENBQUMsVUFBVSxDQUFDLFVBQVUsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7TUFDbkQsQ0FBQyxDQUFDLDJDQUEyQyxDQUFDLENBQUMsSUFBSSxDQUFDLFlBQVk7UUFDNUQsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7TUFDNUUsQ0FBQyxDQUFDO01BQ0YsQ0FBQyxDQUFDLHdCQUF3QixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxLQUFLLENBQUMsVUFBVSxDQUFDLFVBQVUsS0FBSyxVQUFVLEdBQUcsSUFBSSxHQUFHLElBQUksQ0FBQztJQUN4RyxDQUFDLENBQUM7SUFDRixLQUFLLENBQUMsRUFBRSxDQUFDLGVBQWUsRUFBRSw4QkFBOEIsRUFBRSxZQUFZO01BQ2xFLEtBQUssQ0FBQyxVQUFVLENBQUMsV0FBVyxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztNQUNwRCx1QkFBdUIsQ0FBQyxDQUFDO01BQ3pCLG1CQUFtQixDQUFDLENBQUM7SUFDekIsQ0FBQyxDQUFDO0lBQ0YsS0FBSyxDQUFDLEVBQUUsQ0FBQyxlQUFlLEVBQUUsdUJBQXVCLEVBQUUsWUFBWTtNQUMzRCxLQUFLLENBQUMsVUFBVSxDQUFDLElBQUksR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQztNQUMvQyxDQUFDLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFFLEtBQUssQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDO01BQ2xFLG1CQUFtQixDQUFDLENBQUM7SUFDekIsQ0FBQyxDQUFDO0VBQ047O0VBRUE7O0VBRUE7RUFDQSxTQUFTLFdBQVcsR0FBRztJQUNuQixJQUFJLEdBQUcsR0FBRyxlQUFlLENBQUMsQ0FBQztJQUMzQixPQUFPLENBQUMsQ0FBQyxHQUFHLElBQUksR0FBRyxDQUFDLE9BQU8sS0FBSyxLQUFLO0VBQ3pDO0VBRUEsU0FBUyxxQkFBcUIsQ0FBQyxLQUFLLEVBQUU7SUFDbEMsSUFBSSxLQUFLLEdBQUcsQ0FDUixrQkFBa0IsRUFBRSxnQkFBZ0IsRUFBRSw4QkFBOEIsRUFDcEUsOEJBQThCLEVBQUUsNkJBQTZCLEVBQzdELDBCQUEwQixFQUFFLHlCQUF5QixFQUFFLDhCQUE4QixFQUFFLDRCQUE0QixFQUNuSCxvQkFBb0IsRUFBRSw2QkFBNkIsRUFBRSxrQkFBa0IsRUFBRSxtQkFBbUIsRUFDNUYsaUJBQWlCLEVBQUUsa0JBQWtCLEVBQ3JDLDhCQUE4QixFQUFFLDBCQUEwQixFQUFFLHdCQUF3QixFQUNwRixvQkFBb0IsRUFBRSxrQkFBa0IsRUFBRSxhQUFhLEVBQUUsa0JBQWtCLENBQzlFO0lBQ0QsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7TUFDbkMsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRTtRQUFFLE9BQU8sS0FBSyxDQUFDLENBQUMsQ0FBQztNQUFFO0lBQ3pEO0lBQ0EsT0FBTyxFQUFFO0VBQ2I7O0VBRUE7RUFDQSxJQUFJLHNCQUFzQixHQUFHO0lBQ3pCLDhCQUE4QixFQUFFO01BQUUsSUFBSSxFQUFFLGdCQUFnQjtNQUFFLEdBQUcsRUFBRSxRQUFRO01BQUUsUUFBUSxFQUFFO1FBQUUsY0FBYyxFQUFFLENBQUM7UUFBRSxhQUFhLEVBQUU7TUFBRTtJQUFFLENBQUM7SUFDNUgsNkJBQTZCLEVBQUU7TUFBRSxJQUFJLEVBQUUsZ0JBQWdCO01BQUUsR0FBRyxFQUFFLFFBQVE7TUFBRSxRQUFRLEVBQUU7UUFBRSxjQUFjLEVBQUUsQ0FBQztRQUFFLGFBQWEsRUFBRTtNQUFFO0lBQUUsQ0FBQztJQUMzSCwwQkFBMEIsRUFBRTtNQUFFLElBQUksRUFBRSxnQkFBZ0I7TUFBRSxHQUFHLEVBQUUsUUFBUTtNQUFFLFFBQVEsRUFBRTtRQUFFLGNBQWMsRUFBRSxDQUFDO1FBQUUsYUFBYSxFQUFFO01BQUU7SUFBRSxDQUFDO0lBQ3hILHlCQUF5QixFQUFFO01BQUUsSUFBSSxFQUFFLGdCQUFnQjtNQUFFLEdBQUcsRUFBRSxRQUFRO01BQUUsUUFBUSxFQUFFO1FBQUUsY0FBYyxFQUFFLENBQUM7UUFBRSxhQUFhLEVBQUU7TUFBRTtJQUFFLENBQUM7SUFDdkgsOEJBQThCLEVBQUU7TUFBRSxJQUFJLEVBQUUsb0JBQW9CO01BQUUsR0FBRyxFQUFFLE9BQU87TUFBRSxRQUFRLEVBQUU7UUFBRSxjQUFjLEVBQUUsQ0FBQztRQUFFLGFBQWEsRUFBRSxDQUFDO1FBQUUsWUFBWSxFQUFFO01BQUc7SUFBRSxDQUFDO0lBQ2pKLDRCQUE0QixFQUFFO01BQUUsSUFBSSxFQUFFLG9CQUFvQjtNQUFFLEdBQUcsRUFBRSxPQUFPO01BQUUsUUFBUSxFQUFFO1FBQUUsY0FBYyxFQUFFLENBQUM7UUFBRSxhQUFhLEVBQUUsQ0FBQztRQUFFLFlBQVksRUFBRTtNQUFFO0lBQUUsQ0FBQztJQUM5SSxvQkFBb0IsRUFBRTtNQUFFLElBQUksRUFBRSxlQUFlO01BQUUsR0FBRyxFQUFFLFFBQVE7TUFBRSxRQUFRLEVBQUU7UUFBRSxjQUFjLEVBQUU7TUFBRTtJQUFFLENBQUM7SUFDL0YsNkJBQTZCLEVBQUU7TUFBRSxJQUFJLEVBQUUsZUFBZTtNQUFFLEdBQUcsRUFBRSxRQUFRO01BQUUsUUFBUSxFQUFFO1FBQUUsY0FBYyxFQUFFO01BQUU7SUFBRSxDQUFDO0lBQ3hHLGtCQUFrQixFQUFFO01BQUUsSUFBSSxFQUFFLG1CQUFtQjtNQUFFLEdBQUcsRUFBRSxhQUFhO01BQUUsUUFBUSxFQUFFLENBQUM7SUFBRSxDQUFDO0lBQ25GLG1CQUFtQixFQUFFO01BQUUsSUFBSSxFQUFFLG1CQUFtQjtNQUFFLEdBQUcsRUFBRSxhQUFhO01BQUUsUUFBUSxFQUFFLENBQUM7SUFBRSxDQUFDO0lBQ3BGLGlCQUFpQixFQUFFO01BQUUsSUFBSSxFQUFFLG1CQUFtQjtNQUFFLEdBQUcsRUFBRSxvQkFBb0I7TUFBRSxRQUFRLEVBQUU7UUFBRSxZQUFZLEVBQUU7TUFBRztJQUFFLENBQUM7SUFDM0csa0JBQWtCLEVBQUU7TUFBRSxJQUFJLEVBQUUsbUJBQW1CO01BQUUsR0FBRyxFQUFFLG9CQUFvQjtNQUFFLFFBQVEsRUFBRTtRQUFFLFlBQVksRUFBRTtNQUFFO0lBQUU7RUFDOUcsQ0FBQztFQUVELFNBQVMsbUJBQW1CLEdBQUc7SUFDM0IsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDLFVBQVU7SUFDeEIsSUFBSSxDQUFDLENBQUMsRUFBRTtNQUFFO0lBQVE7SUFDbEIsSUFBSSxJQUFJLEdBQUcscUJBQXFCLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQztJQUM5QyxJQUFJLElBQUksS0FBSyxFQUFFLEVBQUU7TUFDYixDQUFDLENBQUMsK0NBQStDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztNQUMxRDtJQUNKO0lBQ0EsSUFBSSxLQUFLLEdBQUcsY0FBYyxDQUFDLENBQUM7SUFDNUIsSUFBSSxLQUFLLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLElBQUk7SUFDL0IsSUFBSSxJQUFJLEtBQUssOEJBQThCLEVBQUU7TUFDekMsS0FBSyxJQUFJLEtBQUssR0FBRyxFQUFFLENBQUMsMENBQTBDLEVBQUU7UUFBRSxLQUFLLEVBQUU7TUFBRyxDQUFDLENBQUM7SUFDbEY7SUFDQSxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUMsSUFBSSxHQUFHLGtCQUFrQixHQUFHLGtCQUFrQjtJQUM1RCxJQUFJLEtBQUssR0FBRyxFQUFFO0lBQ2QsSUFBSSxLQUFLLEdBQUcsRUFBRTtJQUNkLElBQUksTUFBTSxHQUFHLEtBQUs7SUFDbEIsSUFBSSxTQUFTLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsTUFBTSxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsR0FBRyxVQUFVO0lBQ3hGLFFBQVEsSUFBSTtNQUNSLEtBQUssa0JBQWtCO1FBQ25CLEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSyxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyx3QkFBd0IsQ0FBQztRQUN6RCxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxxQkFBcUIsR0FBRyxDQUFDLENBQUM7VUFDckMsUUFBUSxFQUFFLCtDQUErQztVQUN6RCxRQUFRLEVBQUUsK0NBQStDO1VBQ3pELFFBQVEsRUFBRTtRQUNkLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDZixNQUFNLEdBQUcsSUFBSTtRQUNiO01BQ0osS0FBSyxnQkFBZ0I7UUFDakIsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLDJDQUEyQyxDQUFDLENBQUMsQ0FBQztRQUMvRCxNQUFNLEdBQUcsSUFBSTtRQUNiO01BQ0osS0FBSyw4QkFBOEI7UUFDL0IsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMscUJBQXFCLElBQUksQ0FBQyxDQUFDLElBQUksR0FBRyxrQkFBa0IsR0FBRyxrQkFBa0IsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxDQUFDO1FBQ3ZHLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxxQ0FBcUMsRUFBRTtVQUFFLE9BQU8sRUFBRTtRQUF1QyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQy9HLEtBQUssQ0FBQyxJQUFJLENBQUMsc0VBQXNFLENBQUM7UUFDbEYsTUFBTSxHQUFHLElBQUk7UUFDYjtNQUNKLEtBQUssOEJBQThCO1FBQy9CLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsR0FBRyxLQUFLLENBQUMsQ0FBQztRQUNsQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsbUNBQW1DLEVBQUU7VUFBRSxLQUFLLEVBQUU7UUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQzlFLE1BQU0sR0FBRyxJQUFJO1FBQ2I7TUFDSixLQUFLLG9CQUFvQjtNQUN6QixLQUFLLGtCQUFrQjtRQUNuQixLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQywwQkFBMEIsQ0FBQyxDQUFDO1FBQzNDLEtBQUssQ0FBQyxJQUFJLENBQUMsMkJBQTJCLENBQUM7UUFDdkM7TUFDSixLQUFLLDhCQUE4QjtNQUNuQyxLQUFLLDZCQUE2QjtNQUNsQyxLQUFLLDBCQUEwQjtNQUMvQixLQUFLLHlCQUF5QjtNQUM5QixLQUFLLDhCQUE4QjtNQUNuQyxLQUFLLDRCQUE0QjtNQUNqQyxLQUFLLG9CQUFvQjtNQUN6QixLQUFLLDZCQUE2QjtNQUNsQyxLQUFLLGtCQUFrQjtNQUN2QixLQUFLLG1CQUFtQjtNQUN4QixLQUFLLGlCQUFpQjtNQUN0QixLQUFLLGtCQUFrQjtRQUNuQixJQUFJLE1BQU0sR0FBRyxzQkFBc0IsQ0FBQyxJQUFJLENBQUM7UUFDekMsSUFBSSxjQUFjLEdBQUcsVUFBVSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUM7UUFDM0MsSUFBSSxjQUFjLElBQUksY0FBYyxDQUFDLFdBQVcsRUFBRTtVQUM5QyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsV0FBVyxDQUFDLENBQUM7UUFDL0M7UUFDQSxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUM7UUFDM0Msa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFO1VBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7UUFBRSxDQUFDLENBQUM7UUFDekU7TUFDSixLQUFLLDBCQUEwQjtNQUMvQixLQUFLLHdCQUF3QjtRQUN6QixLQUFLLENBQUMsSUFBSSxDQUFDLG9CQUFvQixDQUFDO1FBQ2hDLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLHFDQUFxQyxFQUFFO1VBQUUsRUFBRSxFQUFFO1FBQUssQ0FBQyxDQUFDLENBQUM7UUFDbkU7TUFDSixLQUFLLGFBQWE7UUFDZCxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO1FBQ25EO01BQ0osS0FBSyxrQkFBa0I7UUFDbkIsS0FBSyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQztRQUM5QjtJQUNSO0lBQ0EsSUFBSSxLQUFLLEdBQUcsV0FBVyxDQUFDLENBQUM7SUFDekIsSUFBSSxJQUFJLEdBQUcsNEJBQTRCLElBQUksS0FBSyxHQUFHLFNBQVMsR0FBRyxFQUFFLENBQUMsR0FBRyxTQUFTLEdBQUcsR0FBRyxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLE1BQU0sR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsWUFBWTtJQUM1SSxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFO01BQUUsSUFBSSxJQUFJLE9BQU8sR0FBRyxJQUFJLEdBQUcsUUFBUTtJQUFFLENBQUMsQ0FBQztJQUNyRSxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFO01BQUUsSUFBSSxJQUFJLFVBQVUsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsWUFBWTtJQUFFLENBQUMsQ0FBQztJQUNqRixJQUFJLElBQUksa0RBQWtEO0lBQzFELElBQUksSUFBSSxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLFdBQVcsRUFBRSxLQUFLLENBQUM7SUFDdEQsSUFBSSxNQUFNLEVBQUU7TUFDUixJQUFJLElBQUksK0JBQStCLElBQUksS0FBSyxHQUFHLFNBQVMsR0FBRyxFQUFFLENBQUMsR0FBRyxJQUFJLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQywwQ0FBMEMsQ0FBQyxDQUFDLEdBQUcsVUFBVTtJQUMvSTtJQUNBO0lBQ0E7SUFDQSxDQUFDLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxJQUFJLENBQUMsWUFBWSxFQUNyQyxDQUFDLENBQUMsS0FBSyxHQUFHLDhDQUE4QyxHQUFHLHlDQUF5QyxDQUFDLENBQUM7SUFDMUc7SUFDQSxDQUFDLENBQUMsK0NBQStDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO0VBQ2pFOztFQUVBO0VBQ0E7RUFDQSxTQUFTLGtCQUFrQixDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFO0lBQzNDLElBQUksSUFBSSxLQUFLLE1BQU0sSUFBSSxxQkFBcUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRTtNQUFFLE9BQU8sRUFBRTtJQUFFO0lBQ3JGLElBQUksS0FBSyxHQUFHLEVBQUU7SUFDZCxJQUFJLElBQUksS0FBSyxXQUFXLEVBQUU7TUFDdEIsSUFBSSxNQUFNLEdBQUcsQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDO01BQzdCLE1BQU0sQ0FBQyxPQUFPLENBQUMsVUFBVSxRQUFRLEVBQUUsS0FBSyxFQUFFO1FBQ3RDLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLDJDQUEyQyxFQUFFO1VBQUUsQ0FBQyxFQUFFLEtBQUssR0FBRyxDQUFDO1VBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQyxNQUFNO1VBQUUsUUFBUSxFQUFFO1FBQVMsQ0FBQyxDQUFDLENBQUM7TUFDM0gsQ0FBQyxDQUFDO0lBQ04sQ0FBQyxNQUFNO01BQ0gsS0FBSyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsNENBQTRDLEVBQUU7UUFBRSxRQUFRLEVBQUUsSUFBSSxLQUFLLGdCQUFnQixHQUFHLE1BQU0sR0FBRztNQUFPLENBQUMsQ0FBQyxDQUFDO0lBQzNIO0lBQ0EsSUFBSSxJQUFJLEdBQUcsRUFBRTtJQUNiLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxPQUFPLEVBQUU7TUFDN0IsSUFBSSxJQUFJLDZDQUE2QyxJQUFJLEtBQUssR0FBRyxTQUFTLEdBQUcsRUFBRSxDQUFDLEdBQUcsSUFBSSxHQUNqRiw0RkFBNEYsR0FDNUYsZ0VBQWdFLEdBQ2hFLHVCQUF1QixHQUFHLEdBQUcsQ0FBQyxPQUFPLENBQUMsR0FBRyxRQUFRLEdBQ2pELGtEQUFrRDtJQUM1RCxDQUFDLENBQUM7SUFDRixPQUFPLElBQUk7RUFDZjtFQUVBLFNBQVMsV0FBVyxDQUFDLElBQUksRUFBRTtJQUN2QixJQUFJLElBQUksS0FBSyxrQkFBa0IsSUFBSSxJQUFJLEtBQUssOEJBQThCLEVBQUU7TUFBRSxPQUFPLElBQUk7SUFBRTtJQUMzRixJQUFJLElBQUksS0FBSyxnQkFBZ0IsRUFBRTtNQUFFLE9BQU8sSUFBSTtJQUFFO0lBQzlDLElBQUksSUFBSSxLQUFLLDhCQUE4QixJQUFJLElBQUksS0FBSyxvQkFBb0IsSUFBSSxJQUFJLEtBQUssMEJBQTBCLEVBQUU7TUFBRSxPQUFPLElBQUk7SUFBRTtJQUNwSSxJQUFJLG9CQUFvQixDQUFDLElBQUksQ0FBQyxJQUFJLElBQUksS0FBSyxrQkFBa0IsSUFBSSxJQUFJLEtBQUssd0JBQXdCLEVBQUU7TUFBRSxPQUFPLEdBQUc7SUFBRTtJQUNsSCxJQUFJLElBQUksS0FBSyw4QkFBOEIsSUFBSSxJQUFJLEtBQUssMEJBQTBCLEVBQUU7TUFBRSxPQUFPLElBQUk7SUFBRTtJQUNuRyxJQUFJLElBQUksS0FBSyxrQkFBa0IsRUFBRTtNQUFFLE9BQU8sSUFBSTtJQUFFO0lBQ2hELE9BQU8sSUFBSTtFQUNmOztFQUVBOztFQUVBLFNBQVMsVUFBVSxHQUFHO0lBQ2xCLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxVQUFVO0lBQ3hCLElBQUksQ0FBQyxDQUFDLEVBQUU7TUFBRTtJQUFRO0lBQ2xCLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLEVBQUU7TUFDZCxJQUFJLENBQUMsQ0FBQyxDQUFDLFFBQVEsRUFBRTtRQUFFO01BQVE7TUFDM0IsQ0FBQyxDQUFDLElBQUksR0FBRyxzQkFBc0IsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDO01BQzdDLFlBQVksQ0FBQyxDQUFDO01BQ2Q7SUFDSjtJQUNBLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLEVBQUU7TUFDZCxDQUFDLENBQUMsSUFBSSxHQUFHLENBQUM7TUFDVixZQUFZLENBQUMsQ0FBQztNQUNkO0lBQ0o7SUFDQSxRQUFRLENBQUMsQ0FBQztFQUNkO0VBRUEsU0FBUyxVQUFVLEdBQUc7SUFDbEIsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDLFVBQVU7SUFDeEIsSUFBSSxDQUFDLENBQUMsRUFBRTtNQUFFO0lBQVE7SUFDbEIsSUFBSSxDQUFDLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssTUFBTSxFQUFFO01BQzlDLGVBQWUsQ0FBQyxDQUFDO01BQ2pCO0lBQ0o7SUFDQSxJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxJQUFJLG1CQUFtQixDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsRUFBRTtNQUNuRCxDQUFDLENBQUMsSUFBSSxHQUFHLENBQUM7SUFDZCxDQUFDLE1BQU07TUFDSCxDQUFDLENBQUMsSUFBSSxHQUFHLENBQUM7SUFDZDtJQUNBLGdCQUFnQixDQUFDLENBQUM7SUFDbEIsWUFBWSxDQUFDLENBQUM7RUFDbEI7RUFFQSxTQUFTLFlBQVksQ0FBQyxPQUFPLEVBQUU7SUFDM0IsSUFBSSxNQUFNLEdBQUcsQ0FBQyxDQUFDO0lBQ2YsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7TUFBRSxNQUFNLENBQUMsUUFBUSxHQUFHLE9BQU8sQ0FBQyxRQUFRO0lBQUU7SUFDdkUsSUFBSSxPQUFPLENBQUMsVUFBVSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7TUFBRSxNQUFNLENBQUMsVUFBVSxHQUFHLE9BQU8sQ0FBQyxVQUFVO0lBQUU7SUFDN0UsSUFBSSxPQUFPLENBQUMsU0FBUyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7TUFBRSxNQUFNLENBQUMsU0FBUyxHQUFHLE9BQU8sQ0FBQyxTQUFTO0lBQUU7SUFDMUUsSUFBSSxPQUFPLENBQUMsYUFBYSxLQUFLLElBQUksSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO01BQ2pGLE1BQU0sQ0FBQyxhQUFhLEdBQUcsT0FBTyxDQUFDLGFBQWE7SUFDaEQ7SUFDQSxPQUFPLE1BQU07RUFDakI7RUFFQSxTQUFTLFFBQVEsR0FBRztJQUNoQixJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsVUFBVTtJQUN4QixJQUFJLENBQUMsQ0FBQyxFQUFFO01BQUU7SUFBUTtJQUNsQixJQUFJLFFBQVEsR0FBRyxjQUFjLENBQUMsQ0FBQztJQUMvQjtJQUNBLElBQUksS0FBSyxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssUUFBUSxHQUFHLFFBQVEsQ0FBQyxJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQzNFLElBQUksS0FBSyxLQUFLLEVBQUUsRUFBRTtNQUNkLGVBQWUsQ0FBQyxDQUFDLENBQUMsMENBQTBDLENBQUMsQ0FBQztNQUM5RDtJQUNKO0lBQ0EsSUFBSSxDQUFDLENBQUMsVUFBVSxLQUFLLFVBQVUsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUU7TUFDdkQsZUFBZSxDQUFDLENBQUMsQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDO01BQzFEO0lBQ0o7SUFDQSxJQUFJLE9BQU8sR0FBRztNQUFFLFVBQVUsRUFBRSxDQUFDLENBQUM7SUFBSyxDQUFDO0lBQ3BDLElBQUksQ0FBQyxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLEVBQUU7TUFDL0MsT0FBTyxDQUFDLG1CQUFtQixHQUFHO1FBQzFCLE9BQU8sRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sS0FBSyxJQUFJO1FBQ25DLFVBQVUsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxVQUFVLElBQUksR0FBRyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsVUFBVSxHQUFHLEVBQUU7UUFDaEcsdUJBQXVCLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyx1QkFBdUIsS0FBSztNQUNuRSxDQUFDO0lBQ0w7SUFDQSxJQUFJLHFCQUFxQixDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO01BQ2hELE9BQU8sQ0FBQyxXQUFXLEdBQUcsQ0FBQyxDQUFDLFdBQVc7SUFDdkM7SUFDQSxJQUFJLE9BQU8sR0FBRztNQUNWLEtBQUssRUFBRSxLQUFLO01BQ1osT0FBTyxFQUFFLElBQUk7TUFDYixXQUFXLEVBQUUsQ0FBQyxDQUFDLFVBQVU7TUFDekIsWUFBWSxFQUFFLE1BQU07TUFDcEIsT0FBTyxFQUFFLFlBQVksQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDO01BQ2hDLFdBQVcsRUFBRSxDQUFDLENBQUMsVUFBVTtNQUN6QixRQUFRLEVBQUUsQ0FBQyxDQUFDLE9BQU87TUFDbkIsT0FBTyxFQUFFO0lBQ2IsQ0FBQztJQUNELElBQUksSUFBSSxHQUFHLFNBQVAsSUFBSSxDQUFhLElBQUksRUFBRTtNQUN2QixlQUFlLENBQUMsQ0FBQztNQUNqQixXQUFXLENBQUMsSUFBSSxDQUFDO01BQ2pCLFNBQVMsQ0FBQyxJQUFJLENBQUM7TUFDZixTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxHQUFHLGtDQUFrQyxHQUFHLG9DQUFvQyxDQUFDLENBQUM7SUFDMUcsQ0FBQztJQUNELElBQUksT0FBTyxHQUFHLFNBQVYsT0FBTyxDQUFhLEdBQUcsRUFBRTtNQUN6QixlQUFlLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3JDLENBQUM7SUFDRCxJQUFJLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO01BQ2QsUUFBUSxDQUFDLFNBQVMsR0FBRyxDQUFDLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDO0lBQzFELENBQUMsTUFBTTtNQUNILE9BQU8sQ0FBQyxRQUFRLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxPQUFPLENBQUM7SUFDN0M7RUFDSjtFQUVBLFNBQVMsZUFBZSxDQUFDLElBQUksRUFBRTtJQUMzQixDQUFDLENBQUMsa0NBQWtDLENBQUMsQ0FBQyxJQUFJLENBQUMsZ0RBQWdELEdBQUcsVUFBVSxHQUNsRyx1QkFBdUIsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsY0FBYyxDQUFDO0VBQy9EO0VBRUEsU0FBUyxnQkFBZ0IsR0FBRztJQUN4QixDQUFDLENBQUMsa0NBQWtDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztFQUNqRDtFQUVBLFNBQVMsa0JBQWtCLEdBQUc7SUFDMUIsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsWUFBWTtNQUFFLGNBQWMsQ0FBQyxJQUFJLENBQUM7SUFBRSxDQUFDLENBQUM7SUFDcEUsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxVQUFVLEtBQUssRUFBRTtNQUM5QyxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUM7TUFDdEIsZUFBZSxDQUFDLENBQUM7SUFDckIsQ0FBQyxDQUFDO0lBQ0YsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxZQUFZO01BQ3pDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsRUFBRTtRQUFFO01BQVE7TUFDeEMsZ0JBQWdCLENBQUMsQ0FBQztNQUNsQixVQUFVLENBQUMsQ0FBQztJQUNoQixDQUFDLENBQUM7SUFDRixDQUFDLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFVBQVUsQ0FBQztJQUM1QyxDQUFDLENBQUMsMEJBQTBCLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFVBQVUsS0FBSyxFQUFFO01BQ3ZELEtBQUssQ0FBQyxjQUFjLENBQUMsQ0FBQztNQUN0QixlQUFlLENBQUMsQ0FBQztNQUNqQixDQUFDLENBQUMscUNBQXFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDO0lBQzdELENBQUMsQ0FBQztJQUNGLENBQUMsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsY0FBYyxFQUFFLFlBQVk7TUFDOUQsSUFBSSxNQUFNLEdBQUcsVUFBVSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUM7TUFDbEQsSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxFQUFFO1FBQUU7TUFBUTtNQUMxRCxJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsVUFBVTtNQUN4QixJQUFJLENBQUMsQ0FBQyxRQUFRLEtBQUssTUFBTSxDQUFDLEVBQUUsRUFBRTtRQUMxQixDQUFDLENBQUMsUUFBUSxHQUFHLE1BQU0sQ0FBQyxFQUFFO1FBQ3RCLENBQUMsQ0FBQyxVQUFVLEdBQUcsQ0FBQyxNQUFNLENBQUMsV0FBVyxJQUFJLEVBQUUsRUFBRSxHQUFHLENBQUMsVUFBVSxJQUFJLEVBQUU7VUFBRSxPQUFPLElBQUksQ0FBQyxJQUFJO1FBQUUsQ0FBQyxDQUFDO1FBQ3BGLElBQUksQ0FBQyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUU7VUFBRSxDQUFDLENBQUMsS0FBSyxHQUFHLE1BQU0sQ0FBQyxJQUFJO1FBQUU7UUFDN0MsQ0FBQyxDQUFDLE9BQU8sR0FBRyxZQUFZLENBQUMsQ0FBQztNQUM5QjtNQUNBLHFCQUFxQixDQUFDLENBQUM7TUFDdkIsZ0JBQWdCLENBQUMsQ0FBQztJQUN0QixDQUFDLENBQUM7SUFDRixDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxFQUFFLENBQUMsVUFBVSxFQUFFLGdDQUFnQyxFQUFFLFlBQVk7TUFDbkYsVUFBVSxDQUFDLENBQUM7SUFDaEIsQ0FBQyxDQUFDO0VBQ047O0VBRUE7O0VBRUEsU0FBUyxRQUFRLEdBQUc7SUFDaEIsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxZQUFZO01BQ3hDLElBQUksR0FBRyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDO01BQzdCLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUM7TUFDekMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUM7TUFDMUIsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQztNQUMzRCxDQUFDLENBQUMsNkNBQTZDLEdBQUcsR0FBRyxHQUFHLElBQUksQ0FBQyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUM7TUFDaEYsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLEdBQUcsQ0FBQztNQUNyRCxJQUFJLEdBQUcsS0FBSyxlQUFlLEVBQUU7UUFDekIsU0FBUyxDQUFDLElBQUksQ0FBQztNQUNuQjtNQUNBLElBQUksR0FBRyxLQUFLLFVBQVUsRUFBRTtRQUNwQixtQkFBbUIsQ0FBQyxDQUFDO1FBQ3JCLGFBQWEsQ0FBQyxZQUFZO1VBQ3RCLFFBQVEsQ0FBQyxDQUFDO1FBQ2QsQ0FBQyxDQUFDO01BQ047SUFDSixDQUFDLENBQUM7RUFDTjtFQUVBLFNBQVMsY0FBYyxHQUFHO0lBQ3RCLE9BQU8sQ0FBQyxDQUFDLHNEQUFzRCxDQUFDLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxJQUM1RSxRQUFRLENBQUMsZUFBZSxLQUFLLFNBQVM7RUFDakQ7RUFFQSxTQUFTLG9CQUFvQixHQUFHO0lBQzVCLE9BQU8sQ0FBQyxDQUFDLDREQUE0RCxDQUFDLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxJQUNsRixRQUFRLENBQUMsZUFBZSxLQUFLLFNBQVM7RUFDakQ7RUFFQSxTQUFTLGVBQWUsR0FBRztJQUN2QixXQUFXLENBQUMsWUFBWTtNQUNwQixJQUFJLGNBQWMsQ0FBQyxDQUFDLEVBQUU7UUFDbEIsSUFBSSxDQUFDO1VBQUUsT0FBTyxFQUFFO1FBQUssQ0FBQyxDQUFDO1FBQ3ZCO01BQ0o7TUFDQSxJQUFJLG9CQUFvQixDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsVUFBVSxLQUFLLElBQUksRUFBRTtRQUNyRCxTQUFTLENBQUMsSUFBSSxDQUFDO01BQ25CO01BQ0EsSUFBSSxRQUFRLENBQUMsZUFBZSxLQUFLLFNBQVMsRUFBRTtRQUN4QyxnQkFBZ0IsQ0FBQyxDQUFDO01BQ3RCO0lBQ0osQ0FBQyxFQUFFLFdBQVcsR0FBRyxJQUFJLENBQUM7RUFDMUI7O0VBRUE7O0VBRUEsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEtBQUssQ0FBQyxZQUFZO0lBQzFCLElBQUksR0FBRyxRQUFRLENBQUMsY0FBYyxDQUFDLG9CQUFvQixDQUFDO0lBQ3BELElBQUksQ0FBQyxJQUFJLEVBQUU7TUFDUDtJQUNKO0lBQ0EsUUFBUSxDQUFDLENBQUM7SUFDVixlQUFlLENBQUMsQ0FBQztJQUNqQixjQUFjLENBQUMsQ0FBQzs7SUFFaEI7SUFDQSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSx3RUFBd0UsRUFBRSxZQUFZO01BQzNHLElBQUksTUFBTSxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUM7TUFDcEIsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLE9BQU8sRUFBRTtRQUNqQyxDQUFDLENBQUMsY0FBYyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFlBQVk7VUFDNUQsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUM7UUFDeEUsQ0FBQyxDQUFDO01BQ04sQ0FBQyxNQUFNO1FBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUM7TUFDdkU7SUFDSixDQUFDLENBQUM7SUFFRixDQUFDLENBQUMsMkJBQTJCLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVksQ0FBQztJQUN4RCxDQUFDLENBQUMsMEJBQTBCLENBQUMsQ0FBQyxFQUFFLENBQUMsUUFBUSxFQUFFLFlBQVk7TUFDbkQsS0FBSyxDQUFDLFVBQVUsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQztNQUMxQyxhQUFhLENBQUMsQ0FBQztJQUNuQixDQUFDLENBQUM7SUFDRixDQUFDLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLDRCQUE0QixFQUFFLFlBQVk7TUFDMUUsSUFBSSxHQUFHLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7TUFDekMsSUFBSSxHQUFHLEVBQUU7UUFDTCxZQUFZLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQztNQUM3QixDQUFDLE1BQU07UUFDSCxZQUFZLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxVQUFVLENBQUM7TUFDekM7SUFDSixDQUFDLENBQUM7SUFDRixDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVk7TUFBRSxJQUFJLENBQUMsQ0FBQztJQUFFLENBQUMsQ0FBQztJQUMzRCxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVk7TUFDMUMsSUFBSSxLQUFLLENBQUMsTUFBTSxJQUFJLFVBQVUsRUFBRTtRQUM1QixLQUFLLENBQUMsTUFBTSxJQUFJLFVBQVU7UUFDMUIsSUFBSSxDQUFDLENBQUM7TUFDVjtJQUNKLENBQUMsQ0FBQztJQUNGLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsWUFBWTtNQUMxQyxJQUFJLEtBQUssQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDLEtBQUssRUFBRTtRQUNyRCxLQUFLLENBQUMsTUFBTSxJQUFJLFVBQVU7UUFDMUIsSUFBSSxDQUFDLENBQUM7TUFDVjtJQUNKLENBQUMsQ0FBQztJQUNGLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxRQUFRLEVBQUUsYUFBYSxDQUFDO0lBQ3BELENBQUMsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxRQUFRLEVBQUUsYUFBYSxDQUFDO0lBQ3JELENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxRQUFRLEVBQUUsU0FBUyxDQUFDO0lBQzVDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxRQUFRLEVBQUUsZUFBZSxDQUFDO0lBQ25ELENBQUMsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxRQUFRLEVBQUUsZUFBZSxDQUFDO0lBRXpELGlCQUFpQixDQUFDLENBQUM7SUFDbkIsYUFBYSxDQUFDLENBQUM7SUFDZixrQkFBa0IsQ0FBQyxDQUFDO0lBQ3BCLGtCQUFrQixDQUFDLENBQUM7SUFDcEIsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsWUFBWTtNQUFFLFlBQVksQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLFVBQVUsQ0FBQztJQUFFLENBQUMsQ0FBQztJQUNwRixDQUFDLENBQUMsd0RBQXdELENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVksQ0FBQztJQUNyRixDQUFDLENBQUMsdUJBQXVCLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVk7TUFDL0MsQ0FBQyxDQUFDLHVCQUF1QixDQUFDLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQztNQUMvQyxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDO0lBQzNDLENBQUMsQ0FBQztJQUNGLENBQUMsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsWUFBWTtNQUM5QyxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO01BQzlCLENBQUMsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO0lBQ25ELENBQUMsQ0FBQztJQUNGLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFdBQVcsQ0FBQztJQUMxQyxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxrQkFBa0IsRUFBRSxVQUFVLEtBQUssRUFBRTtNQUNoRSxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUM7TUFDdEIsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsRUFBRTtRQUFFO01BQVE7TUFDbEUsS0FBSyxDQUFDLFFBQVEsQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7TUFDeEQsQ0FBQyxDQUFDLHVCQUF1QixDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7TUFDbEMsY0FBYyxDQUFDLENBQUM7SUFDcEIsQ0FBQyxDQUFDO0lBQ0YsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxnQkFBZ0IsQ0FBQztJQUNqRCxDQUFDLENBQUMsc0NBQXNDLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLGNBQWMsQ0FBQztJQUNyRSxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxxQkFBcUIsQ0FBQztJQUNyRCxDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVk7TUFDeEMsSUFBSSxLQUFLLENBQUMsU0FBUyxFQUFFO1FBQ2pCLGNBQWMsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxJQUFJLENBQUM7TUFDL0M7SUFDSixDQUFDLENBQUM7SUFDRixDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxpQkFBaUIsQ0FBQztJQUNqRCxDQUFDLENBQUMsdUNBQXVDLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLHFCQUFxQixDQUFDO0lBQzdFLENBQUMsQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsWUFBWTtNQUMvRCxZQUFZLENBQUMsQ0FBQztNQUNkLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUM7SUFDckMsQ0FBQyxDQUFDO0lBQ0YsQ0FBQyxDQUFDLDBDQUEwQyxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxZQUFZO01BQ2xFLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUM7SUFDeEMsQ0FBQyxDQUFDO0lBRUYsV0FBVyxDQUFDLFlBQVk7TUFDcEIsYUFBYSxDQUFDLENBQUM7TUFDZixhQUFhLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQztNQUM3QixhQUFhLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQztNQUM3QixRQUFRLENBQUMsSUFBSSxDQUFDO01BQ2QsU0FBUyxDQUFDLENBQUM7TUFDWCxJQUFJLENBQUMsQ0FBQztJQUNWLENBQUMsQ0FBQztJQUNGLGVBQWUsQ0FBQyxDQUFDO0VBQ3JCLENBQUMsQ0FBQztBQUNOLENBQUMsRUFBQyxDQUFDIiwiaWdub3JlTGlzdCI6W119
