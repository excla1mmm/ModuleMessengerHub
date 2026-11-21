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
  var GROUP_ORDER = ['calls', 'ai_supervisor', 'voice_agent', 'pbx'];
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
      voice_agent: 'module_messenger_hub_GroupVoiceAgent',
      pbx: 'module_messenger_hub_GroupPbx'
    }[group] || group;
    return t(key);
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
        return subject.worker && subject.worker.name || facts.summary || '';
      default:
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
    return '<tr class="mh-event-row' + (expanded ? ' active' : '') + '" data-id="' + item.id + '" aria-expanded="' + (expanded ? 'true' : 'false') + '">' + '<td class="mh-chevron-cell">' + ICON_CHEVRON + '</td>' + '<td class="mh-cell-time">' + fmtCellTime(item.occurred_at) + '</td>' + '<td><div class="mh-event-cell"><span class="mh-truncate" title="' + esc(eventName) + '">' + esc(eventName) + '</span>' + probe + '</div></td>' + '<td class="mh-truncate mh-muted" title="' + esc(brief) + '">' + esc(brief) + '</td>' + '<td>' + deliveryCell(item) + '</td>' + '</tr>';
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
      html += '<dt class="mh-truncate">' + esc(recipientTitle(delivery)) + '</dt>' + '<dd' + (status.bad ? ' class="mh-error-text"' : '') + '>' + esc(status.text) + '</dd>';
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
    return code;
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
        var disabled = ['module_missing', 'module_disabled', 'api_forbidden', 'error', 'disabled'].indexOf(source.availability) >= 0;
        var selected = w.sourceId === source.id;
        // Unavailable scenario: only the reason, no action (user decision Q14).
        html += '<button type="button" class="mh-scenario' + (disabled ? ' is-disabled' : '') + (selected ? ' is-selected' : '') + '" data-source-id="' + esc(source.id) + '" aria-pressed="' + (selected ? 'true' : 'false') + '"' + (disabled ? ' disabled aria-disabled="true"' : '') + '>' + scenarioIcon(source.id) + '<span class="mh-scenario-text"><b>' + esc(source.name) + '</b>' + (disabled ? '<span class="mh-meta">' + esc(source.availability_name) + '</span>' : '') + '</span></button>';
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
    bindWizardRecipients();
    // a scenario without conditions goes 1 -> 3: step 3 must render its own preview
    renderWizardPreview();
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
    var order = ['core.missed_call', 'core.voicemail', 'ai_supervisor.attention_call', 'ai_supervisor.worker_offline', 'ai_supervisor.worker_online', 'voice_agent.callback_request', 'voice_agent.runtime_down', 'voice_agent.runtime_up', 'core.provider_down', 'core.provider_up', 'core.advice', 'core.pbx_started'];
    for (var i = 0; i < order.length; i++) {
      if (types.indexOf(order[i]) >= 0) {
        return order[i];
      }
    }
    return '';
  }
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
        lines.push('stt-1');
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
    if (button) {
      html += '<div class="mh-preview-button' + (isMax ? ' is-max' : '') + '">' + esc(t('module_messenger_hub_WizardPreviewButton')) + ' ↗</div>';
    }
    // the messenger is part of the preview, so the aside says which bubble it shows
    // (the design has no visible caption above the bubble)
    $('.mh-wizard-preview').attr('aria-label', t(isMax ? 'module_messenger_hub_WizardPreviewChannelMax' : 'module_messenger_hub_WizardPreviewTitle'));
    // step 2 shows the conditions preview, step 3 the same preview for the chosen bot
    $('#mh-wizard-preview, #mh-wizard-preview-target').html(html);
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
    if (type === 'core.provider_up' || type === 'voice_agent.runtime_up' || type === 'ai_supervisor.worker_online') {
      return '✅';
    }
    if (type === 'ai_supervisor.worker_offline') {
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

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWgtbmV3My5qcyIsIm5hbWVzIjpbIkFQSV9CQVNFIiwiUEFHRV9MSU1JVCIsIlJFRlJFU0hfU0VDIiwiR1JPVVBfT1JERVIiLCJJQ09OX0VSUk9SIiwiSUNPTl9DSEVWUk9OIiwiSUNPTl9QTFVTIiwicm9vdCIsInN0YXRlIiwic291cmNlcyIsInBlcmlvZCIsImV2ZW50VHlwZSIsIm9mZnNldCIsInRvdGFsIiwiaGFzTG9hZGVkIiwibGFzdEl0ZW1zIiwiY2FsbGJhY2tzIiwiZXhwYW5kZWRJZCIsImxvYWRTZXEiLCJyZXRlbnRpb24iLCJzZXR0aW5ncyIsImJvdHMiLCJib3RzTG9hZGVkIiwiYm90c0Vycm9yIiwiZXhwYW5kZWRCb3RzIiwiZW1wbG95ZWVzIiwiZW1wbG95ZWVzTG9hZGVkIiwiZW1wbG95ZWVzRmFpbGVkIiwic2hvd1Byb2JlcyIsImJvdE1vZGFsIiwiY2hhdE1vZGFsIiwidGVzdE1vZGFsIiwicnVsZXMiLCJydWxlc0xvYWRlZCIsInJ1bGVzRXJyb3IiLCJwcm92aWRlcnMiLCJwcm92aWRlcnNMb2FkZWQiLCJydWxlV2l6YXJkIiwidCIsImtleSIsImdsb2JhbFRyYW5zbGF0ZSIsInRmIiwicGFyYW1zIiwidGV4dCIsIk9iamVjdCIsImtleXMiLCJmb3JFYWNoIiwibmFtZSIsInNwbGl0Iiwiam9pbiIsIlN0cmluZyIsInBhZCIsInZhbHVlIiwiZm10VGltZSIsInRzIiwiZCIsIkRhdGUiLCJnZXRIb3VycyIsImdldE1pbnV0ZXMiLCJmbXREYXRlIiwiZ2V0RGF0ZSIsImdldE1vbnRoIiwiZ2V0RnVsbFllYXIiLCJmbXREYXRlVGltZSIsImlzVG9kYXkiLCJub3ciLCJ0b0RhdGVTdHJpbmciLCJpc1llc3RlcmRheSIsInllc3RlcmRheSIsImZtdENlbGxUaW1lIiwiZGF5IiwiZXNjIiwiJCIsInVuZGVmaW5lZCIsImh0bWwiLCJzdGFydE9mVG9kYXkiLCJzZXRIb3VycyIsIk1hdGgiLCJmbG9vciIsImdldFRpbWUiLCJwZXJpb2RCb3VuZHMiLCJ0b2RheVN0YXJ0IiwiZnJvbSIsInRvIiwiYXBpR2V0IiwicGF0aCIsIm9uU3VjY2VzcyIsIm9uRmFpbHVyZSIsImFqYXgiLCJ1cmwiLCJDb25maWciLCJwYnhVcmwiLCJtZXRob2QiLCJkYXRhIiwiY2FjaGUiLCJkb25lIiwicmVzcG9uc2UiLCJyZXN1bHQiLCJub3JtYWxpemVGYWlsdXJlIiwiZmFpbCIsInhociIsInN0YXR1cyIsImFwaVBhdGNoIiwicGF5bG9hZCIsIkpTT04iLCJzdHJpbmdpZnkiLCJjb250ZW50VHlwZSIsImRhdGFUeXBlIiwiZXJyb3IiLCJtZXNzYWdlcyIsImxvYWRDYXRhbG9nIiwiaXRlbXMiLCJzb3VyY2VCeUlkIiwiaWQiLCJpIiwibGVuZ3RoIiwiZXZlbnRUeXBlTmFtZXMiLCJuYW1lcyIsInNvdXJjZSIsImV2ZW50X3R5cGVzIiwidHlwZSIsImJ1aWxkVHlwZU1lbnUiLCJncm91cCIsImluR3JvdXAiLCJwdXNoIiwic291cmNlR3JvdXBOYW1lIiwiaXRlbSIsImRyb3Bkb3duIiwidmFsdWVzIiwibWVudVRvVmFsdWVzIiwicGxhY2Vob2xkZXIiLCJvbkNoYW5nZSIsInJlbG9hZCIsIm1hcCIsImNhbGxzIiwiYWlfc3VwZXJ2aXNvciIsInZvaWNlX2FnZW50IiwicGJ4IiwiYnVpbGRQZXJpb2RNZW51Iiwic2VsZWN0ZWQiLCJyZXNldEZpbHRlcnMiLCJmaWx0ZXJzQWN0aXZlIiwibG9hZCIsIm9wdGlvbnMiLCJzZXEiLCJib3VuZHMiLCJpc1JlZnJlc2giLCJyZWZyZXNoIiwibGltaXQiLCJldmVudF90eXBlIiwiZGF0ZV9mcm9tIiwiZGF0ZV90byIsInNldEpvdXJuYWxCdXN5IiwicGFnaW5hdGlvbiIsInJlbmRlckpvdXJuYWwiLCJmYWlsdXJlIiwicmVuZGVyTG9hZEVycm9yIiwibG9hZEpvdXJuYWxCYWRnZSIsImJ1c3kiLCIkdGFibGUiLCJhdHRyIiwidG9nZ2xlQ2xhc3MiLCJCb29sZWFuIiwicmVuZGVyU2tlbGV0b24iLCJlbXB0eSIsImpvdXJuYWxUYWJsZUhlYWQiLCJyb3dzIiwiaXNQcm9iZSIsInByb2JlIiwiY2FsbGJhY2tJbmRleCIsImluZGV4IiwiY2FsbCIsInN1YmplY3QiLCJtaXNzZWRfbGlua2VkaWQiLCJvY2N1cnJlZF9hdCIsImNhbGxiYWNrVGltZSIsImxpbmtlZGlkIiwicmVzb2x2ZWQiLCJkZWxpdmVyaWVzIiwiZGVsaXZlcnkiLCJyZXNvbHZlZF9hdCIsInZpc2libGVKb3VybmFsSXRlbXMiLCJmaWx0ZXIiLCJoaWRlSm91cm5hbFN0YXRlcyIsInJlbmRlckpvdXJuYWxCYW5uZXIiLCJyZW1vdmVBdHRyIiwicmVuZGVyUGFnZXIiLCJyZW5kZXJSb3ciLCJyZW5kZXJEZXRhaWxSb3ciLCJvbiIsInRvZ2dsZVJvdyIsIm9mZiIsImV2ZW50Iiwic3RvcFByb3BhZ2F0aW9uIiwiZXZlbnRJZCIsIiRidXR0b24iLCJwcm9wIiwiYXBpUG9zdCIsInNob3dUb2FzdCIsImNvdW50IiwicmV0cmllZCIsImZhaWx1cmVUZXh0IiwiaGludCIsIndoYXQiLCJjb2RlIiwiYm90UHJvYmxlbSIsImJvdCIsImVuYWJsZWQiLCJib3RfdXNlcm5hbWUiLCJ0aXRsZSIsImJvdElkIiwiTnVtYmVyIiwiaiIsImsiLCJib3RfZGVsZXRlZCIsImlzRmFpbGVkRGVsaXZlcnkiLCJwcm9ibGVtIiwiaXNVbmRlbGl2ZXJlZCIsInNvbWUiLCJicmllZkZvciIsImZhY3RzIiwic2hvcnRFbXBsb3llZSIsImNsaWVudCIsImNsaWVudF9udW1iZXIiLCJzY29yZXMiLCJxdWFsaXR5Iiwic2NvcmUiLCJzdW1tYXJ5IiwicHJvdmlkZXIiLCJ1c2VybmFtZSIsImhvc3QiLCJhZHZpY2VUZXh0IiwiYWR2aWNlIiwidGVzdFN5c3RlbSIsInN5c3RlbSIsImJvdF90aXRsZSIsIndvcmtlciIsImVtcGxveWVlIiwidHJpbSIsInBhcnRzIiwiY2hhckF0IiwibnVtYmVyIiwiZnVsbEVtcGxveWVlIiwidHBsIiwibWVzc2FnZV90cGwiLCJyZXBsYWNlIiwiZXZlbnROYW1lIiwiYnJpZWYiLCJleHBhbmRlZCIsImRlbGl2ZXJ5Q2VsbCIsImRldGFpbEZpZWxkcyIsImZpZWxkcyIsImNhbGxiYWNrIiwiZm10Q2VsbFRleHQiLCJyZWFzb25zIiwicGFpciIsInJldHJ5YWJsZSIsImRlbGl2ZXJ5U3RhdHVzVGV4dCIsInJlY2lwaWVudFRpdGxlIiwiYmFkIiwiY2hhdF9kZWxldGVkIiwiY2hhdF90aXRsZSIsImV4dGVybmFsX2NoYXRfaWQiLCJkZWxpdmVyeUNvdW50cyIsImNvdW50cyIsInNlbnQiLCJmYWlsZWQiLCJwZW5kaW5nIiwiYyIsInJlYXNvbiIsImRlbGl2ZXJ5UmVhc29uIiwibmV4dF9hdHRlbXB0X2F0IiwidGltZSIsImxhc3RfZXJyb3JfY29kZSIsIiRwYWdlciIsIm1hcmtGaWVsZEVycm9yIiwiZmllbGRTZWxlY3RvciIsIm1lc3NhZ2UiLCJhZGRDbGFzcyIsImZpbmQiLCJjbGVhckZpZWxkRXJyb3IiLCJyZW1vdmVDbGFzcyIsIm1hcmtSZXRlbnRpb25FcnJvciIsImNsZWFyUmV0ZW50aW9uRXJyb3IiLCJzYXZlUmV0ZW50aW9uIiwicmF3IiwidmFsIiwiZGF5cyIsInRlc3QiLCJwYXJzZUludCIsImV2ZW50c19yZXRlbnRpb25fZGF5cyIsImV4aXN0aW5nIiwiZG9jdW1lbnQiLCJxdWVyeVNlbGVjdG9yQWxsIiwicGFyZW50Tm9kZSIsInJlbW92ZUNoaWxkIiwidG9hc3QiLCJjcmVhdGVFbGVtZW50IiwiY2xhc3NOYW1lIiwic2V0QXR0cmlidXRlIiwidGV4dENvbnRlbnQiLCJib2R5IiwiYXBwZW5kQ2hpbGQiLCJzZXRUaW1lb3V0IiwiYXBpU2VuZCIsInJlc3BvbnNlSlNPTiIsImFwaURlbGV0ZSIsImNvcmVHZXQiLCJmaWVsZCIsImJvdEJ5SWQiLCJyZXBsYWNlQm90IiwibG9hZEJvdHMiLCJzaWxlbnQiLCJyZW5kZXJCb3RzU2tlbGV0b24iLCJyZW5kZXJCb3RzIiwicmVuZGVyUnVsZXMiLCJjYXJkIiwibWVzc2VuZ2VyVGlsZXMiLCIkd3JhcCIsInJlbmRlckJvdENhcmQiLCJyZW5kZXJCb3RUbHNXYXJuaW5nIiwicmVuZGVyQm90Q2hhdHMiLCJyZW5kZXJCb3RBY3Rpb25zIiwiY2hhdENvdW50IiwiY2hhdHMiLCJtZXRhIiwiY2hhbm5lbCIsImJvdFN0YXR1c0NlbGwiLCJpc01heFRsc0NvZGUiLCJjaGF0S2luZExhYmVsIiwia2luZCIsInJlbmRlckNoYXRSb3ciLCJjaGF0IiwiZ29uZSIsInN0YXRlQ2VsbCIsImdvbmVfcmVhc29uIiwibGFzdF9kZWxpdmVyeSIsImNoYXRfaWQiLCJjaGF0X2tpbmQiLCJlbXBsb3llZVNlbGVjdCIsImZvdW5kIiwibGlua2VkX3VzZXJfaWQiLCJsYWJlbCIsImJpbmRCb3RzQ29udGFpbmVyIiwiY2xvc2VzdCIsInByZXZlbnREZWZhdWx0IiwidHJpZ2dlciIsIm9wZW5Cb3RNb2RhbCIsIm9wZW5DaGF0TW9kYWwiLCJvcGVuVGVzdE1vZGFsIiwiY2hhdElkIiwicGF0Y2hCb3QiLCJsb2FkRW1wbG95ZWVzIiwic2VlbiIsImxpc3QiLCJ1c2VySWQiLCJ1c2VyaWQiLCJjYWxsZXJpZCIsImluZGV4T2YiLCJzb3J0IiwiYSIsImIiLCJsb2NhbGVDb21wYXJlIiwiU0FWQUJMRV9DSEFOTkVMUyIsIm1vZGUiLCJkcmFmdElkIiwic2F2ZWQiLCJ0b2tlbkNoYW5nZWQiLCJ0b2tlbl9oaW50Iiwic3luY0JvdENoYW5uZWwiLCJtb2RhbCIsImNsb3NhYmxlIiwiZWFjaCIsImxvY2tlZCIsInNhdmFibGUiLCJtYXhIZWxwIiwidGxzRXJyb3JUZXh0IiwiYm90Rm9ybVZhbHVlcyIsInRva2VuIiwidG9rZW5OZXciLCJzaG93Qm90TWVzc2FnZSIsImNscyIsImljb24iLCJib3RDaGVja01lc3NhZ2UiLCJib3RfZXh0ZXJuYWxfaWQiLCJjaGVja0JvdEZvcm0iLCJlcnIiLCJvayIsImRpc3BsYXlfbmFtZSIsImVycm9yX2NvZGUiLCJzYXZlQm90Rm9ybSIsImZpbmlzaCIsImNyZWF0ZSIsImNhbmNlbEJvdE1vZGFsIiwiY29uZmlybURlbGV0ZUJvdCIsInRpbWVyIiwiaXNNYXgiLCJjc3MiLCJzdGFydERpc2NvdmVyeSIsInJlc3RhcnQiLCJ1cGRhdGVDaGF0TW9kYWwiLCJzY2hlZHVsZUNoYXRQb2xsIiwic2hvd0NoYXRFcnJvciIsInN0b3BDaGF0UG9sbCIsInNldEludGVydmFsIiwiZGlzY292ZXJ5IiwiYWN0aXZlIiwiY2xlYXJJbnRlcnZhbCIsInNlbGVjdGVkQ291bnQiLCJpbkJvdCIsImZpbmRDaGF0QnlFeHRlcm5hbCIsImFscmVhZHlfY29ubmVjdGVkIiwiY2hlY2tlZCIsInN0YXR1c1RleHQiLCJjb3VudGRvd24iLCJwcm9ncmVzcyIsImZtdENvdW50ZG93biIsInJlbWFpbmluZ19zZWMiLCJtYXgiLCJtaW4iLCJyb3VuZCIsImJpbmRDaGF0Rm91bmQiLCJzYXZlU2VsZWN0ZWRDaGF0cyIsInBhdGNoZXMiLCJzdG9wIiwiY2xvc2VDaGF0TW9kYWwiLCJzdG9wRGlzY292ZXJ5QW5kQ2xvc2UiLCJjaGF0SWRzIiwidHJpZXMiLCJvbkhpZGUiLCJzdG9wVGVzdFBvbGwiLCJjaGF0X2lkcyIsImV2ZW50X2lkIiwicmVuZGVyVGVzdCIsInNjaGVkdWxlVGVzdFBvbGwiLCJ0ZXN0UGVuZGluZyIsInRlc3REZWxpdmVyaWVzIiwiZGVsaXZlcnlTdGF0dXNMYWJlbCIsImRlbGl2ZXJ5RXJyb3JUZXh0IiwicmV0cnkiLCJsb2FkR2VuZXJhbFNldHRpbmdzIiwicGJ4X3B1YmxpY191cmwiLCJwcm94eV91cmwiLCJtYXhfY2FfYnVuZGxlX3BhdGgiLCJtYXNrX3Bob25lX2RlZmF1bHQiLCJzYXZlU2V0dGluZyIsInJldmVydCIsInNhdmVQdWJsaWNVcmwiLCJwcmV2aW91cyIsInNhdmVQcm94eSIsInNhdmVNYXhDYUJ1bmRsZSIsInNhdmVNYXNrRGVmYXVsdCIsInNlY29uZHMiLCJsb2FkUnVsZXMiLCJyZW5kZXJSdWxlc1NrZWxldG9uIiwicm93Iiwic291cmNlRm9yUnVsZSIsInJ1bGUiLCJzb3VyY2VfaWQiLCJieUlkIiwidHlwZXMiLCJzZXRSdWxlQWRkVmlzaWJsZSIsInZpc2libGUiLCIkbGlzdCIsImdyb3VwcyIsIm9yZGVyIiwic2hvd0hlYWRpbmdzIiwicmVuZGVyUnVsZVJvdyIsInJ1bGVDaGFubmVsIiwiYm90X2lkIiwicnVsZVByb2JsZW1MYWJlbCIsImF2YWlsYWJpbGl0eSIsImxhYmVscyIsIm1vZHVsZV9kaXNhYmxlZCIsIm1vZHVsZV9taXNzaW5nIiwiYXBpX2ZvcmJpZGRlbiIsImRpc2FibGVkIiwiZXZlcnkiLCJydWxlRmlyc3QiLCJydWxlTGFzdCIsInJpZ2h0IiwibGFzdF9ldmVudF9hdCIsImJpbmRSdWxlc0NvbnRhaW5lciIsIm9wZW5SdWxlV2l6YXJkIiwicnVsZUJ5SWQiLCIkbWVudSIsInNpYmxpbmdzIiwibm90IiwiY29uZmlybURlbGV0ZVJ1bGUiLCJtb3ZlUnVsZSIsInJlcGxhY2VSdWxlIiwidGFyZ2V0IiwibG9hZFByb3ZpZGVycyIsInByb3ZpZGVyX2lkIiwiZGVzY3JpcHRpb24iLCJkZWx0YSIsImlkcyIsInN3YXAiLCJlbXB0eUZpbHRlcnMiLCJ1c2VyX2lkcyIsImRpcmVjdGlvbnMiLCJxdWFsaXR5X3Njb3JlIiwibm9ybWFsaXplUmV0cmFjdCIsImNvbmZpZyIsInJldHJhY3Rfb25fY2FsbGJhY2siLCJfdHlwZW9mIiwid2luZG93Iiwid2luZG93X21pbiIsImNvdW50X2luY29taW5nX2Fuc3dlcmVkIiwibm9ybWFsaXplRmlsdGVycyIsImZpbHRlcnMiLCJBcnJheSIsImlzQXJyYXkiLCJzbGljZSIsImVuc3VyZVdpemFyZERhdGEiLCJzdGVwIiwicmVuZGVyV2l6YXJkQ29uZGl0aW9ucyIsImZpcnN0U3RlcEFmdGVyU2NlbmFyaW8iLCJlZGl0SWQiLCJzb3VyY2VJZCIsImV2ZW50VHlwZXMiLCJ0YXJnZXRNb2RlIiwidGFyZ2V0X21vZGUiLCJtYXNrIiwibWFza19waG9uZSIsInJldHJhY3QiLCJjbGVhcldpemFyZEVycm9yIiwicmVuZGVyV2l6YXJkIiwiY2xvc2VSdWxlV2l6YXJkIiwid2l6YXJkU2NlbmFyaW8iLCJ3Iiwid2l6YXJkU3VwcG9ydHNFbXBsb3llZXMiLCJjYWxsVHlwZXMiLCJ3aXphcmRTdXBwb3J0c0RpcmVjdGlvbnMiLCJ3aXphcmRTdXBwb3J0c1Byb3ZpZGVycyIsIndpemFyZEhhc0NvbmRpdGlvbnMiLCJzY2VuYXJpbyIsImNhbkdvQmFjayIsImlzTGFzdCIsInJlbmRlcldpemFyZFNjZW5hcmlvcyIsInJlbmRlcldpemFyZFJlY2lwaWVudHMiLCJ1cGRhdGVXaXphcmROZXh0IiwiYWN0aXZlV2l6YXJkQm90IiwiU0NFTkFSSU9fSUNPTlMiLCJwaG9uZSIsIm1pYyIsInNwYXJrbGUiLCJyb2JvdCIsInNlcnZlciIsIndhcm5pbmciLCJib2x0IiwiU0NFTkFSSU9fSUNPTl9CWV9TT1VSQ0UiLCJzY2VuYXJpb0ljb24iLCJwYXRocyIsImF2YWlsYWJpbGl0eV9uYW1lIiwicHJlc3NlZCIsInJhbmdlIiwid2l6YXJkSXNNYXgiLCJpbml0Q29uZGl0aW9uRHJvcGRvd25zIiwiYmluZFdpemFyZENvbmRpdGlvbnMiLCJyZW5kZXJXaXphcmRQcmV2aWV3IiwiJGVtcGxveWVlcyIsInNlbGVjdGVkVXNlcnMiLCJmdWxsVGV4dFNlYXJjaCIsIm5vUmVzdWx0cyIsIiRwcm92aWRlcnMiLCJzZWxlY3RlZFByb3ZpZGVycyIsIiRmb3JtIiwic3BsaWNlIiwic3VwcG9ydHNFbXBsb3llZXMiLCJib3RIdG1sIiwicmVuZGVyV2l6YXJkQ2hhdHMiLCJiaW5kV2l6YXJkUmVjaXBpZW50cyIsIiRkcm9wZG93biIsInJlbW92ZSIsIiRzdGVwIiwid2l6YXJkUHJldmlld0NhbGxUeXBlIiwibGluZXMiLCJub3RlcyIsImJ1dHRvbiIsImRpcmVjdGlvbiIsImluY29taW5nIiwib3V0Z29pbmciLCJpbnRlcm5hbCIsInRvcGljIiwibXMiLCJpY29uRm9yVHlwZSIsImxpbmUiLCJub3RlIiwid2l6YXJkTmV4dCIsInNhdmVSdWxlIiwid2l6YXJkUHJldiIsInBydW5lRmlsdGVycyIsInNob3dXaXphcmRFcnJvciIsIm1pbl9zZXZlcml0eSIsImJpbmRXaXphcmRDb250cm9scyIsImhhc0NsYXNzIiwiaW5pdFRhYnMiLCJ0YWIiLCJqb3VybmFsVmlzaWJsZSIsInZpc2liaWxpdHlTdGF0ZSIsIm5vdGlmaWNhdGlvbnNWaXNpYmxlIiwic2NoZWR1bGVSZWZyZXNoIiwicmVhZHkiLCJnZXRFbGVtZW50QnlJZCIsIiRpbnB1dCJdLCJzb3VyY2VzIjpbInNyYy9tb2R1bGUtbWVzc2VuZ2VyLWh1Yi1pbmRleC5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKiBNb2R1bGVNZXNzZW5nZXJIdWIgYWRtaW4gcGFnZTogbm90aWZpY2F0aW9ucywgd2l6YXJkLCBqb3VybmFsIGFuZCBzZXR0aW5ncyAoZGVzaWduIHYzLCBkb2NzL2Rlc2lnbi9Nb2R1bGVNZXNzZW5nZXJIdWItdjMuaHRtbCkuXG4gKiBEYXRhIGNvbWVzIG9ubHkgZnJvbSB0aGUgbW9kdWxlIFJFU1QgcmVzb3VyY2VzIChzZXR0aW5ncywgZXZlbnRzLCBib3RzLCBydWxlcykgYW5kIENvcmUgdjMgbGlzdHMuIE5vIGV4dGVybmFsIENETnMuXG4gKiBXcml0dGVuIGluIHBsYWluIEVTNSAodGFyZ2V0cyBDaHJvbWUgNTAgLyBGaXJlZm94IDQ1IC8gSUUxMSBhZnRlciB0aGUgQmFiZWwgcGFzcykuXG4gKi9cbihmdW5jdGlvbiAoKSB7XG4gICAgJ3VzZSBzdHJpY3QnO1xuXG4gICAgdmFyIEFQSV9CQVNFID0gJy9wYnhjb3JlL2FwaS92My9tb2R1bGUtbWVzc2VuZ2VyLWh1Yic7XG4gICAgdmFyIFBBR0VfTElNSVQgPSA1MDtcbiAgICB2YXIgUkVGUkVTSF9TRUMgPSAzMDtcbiAgICB2YXIgR1JPVVBfT1JERVIgPSBbJ2NhbGxzJywgJ2FpX3N1cGVydmlzb3InLCAndm9pY2VfYWdlbnQnLCAncGJ4J107XG5cbiAgICB2YXIgSUNPTl9FUlJPUiA9ICc8c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBhcmlhLWhpZGRlbj1cInRydWVcIj48Y2lyY2xlIGN4PVwiOFwiIGN5PVwiOFwiIHI9XCI2LjI1XCIvPjxwYXRoIGQ9XCJNNiA2bDQgNE0xMCA2bC00IDRcIi8+PC9zdmc+JztcbiAgICB2YXIgSUNPTl9DSEVWUk9OID0gJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjxwYXRoIGQ9XCJNNiAzLjVMMTAuNSA4IDYgMTIuNVwiLz48L3N2Zz4nO1xuICAgIHZhciBJQ09OX1BMVVMgPSAnPHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+PHBhdGggZD1cIk04IDN2MTBNMyA4aDEwXCIvPjwvc3ZnPic7XG5cbiAgICB2YXIgcm9vdCA9IG51bGw7XG4gICAgdmFyIHN0YXRlID0ge1xuICAgICAgICBzb3VyY2VzOiBbXSxcbiAgICAgICAgcGVyaW9kOiAndG9kYXknLFxuICAgICAgICBldmVudFR5cGU6ICcnLFxuICAgICAgICBvZmZzZXQ6IDAsXG4gICAgICAgIHRvdGFsOiAwLFxuICAgICAgICBoYXNMb2FkZWQ6IGZhbHNlLFxuICAgICAgICBsYXN0SXRlbXM6IFtdLFxuICAgICAgICBjYWxsYmFja3M6IHt9LFxuICAgICAgICBleHBhbmRlZElkOiBudWxsLFxuICAgICAgICBsb2FkU2VxOiAwLFxuICAgICAgICByZXRlbnRpb246IDMwLFxuICAgICAgICBzZXR0aW5nczogbnVsbCxcbiAgICAgICAgYm90czogW10sXG4gICAgICAgIGJvdHNMb2FkZWQ6IGZhbHNlLFxuICAgICAgICBib3RzRXJyb3I6IG51bGwsXG4gICAgICAgIGV4cGFuZGVkQm90czoge30sXG4gICAgICAgIGVtcGxveWVlczogW10sXG4gICAgICAgIGVtcGxveWVlc0xvYWRlZDogZmFsc2UsXG4gICAgICAgIGVtcGxveWVlc0ZhaWxlZDogZmFsc2UsXG4gICAgICAgIHNob3dQcm9iZXM6IGZhbHNlLFxuICAgICAgICBib3RNb2RhbDogbnVsbCxcbiAgICAgICAgY2hhdE1vZGFsOiBudWxsLFxuICAgICAgICB0ZXN0TW9kYWw6IG51bGwsXG4gICAgICAgIHJ1bGVzOiBbXSxcbiAgICAgICAgcnVsZXNMb2FkZWQ6IGZhbHNlLFxuICAgICAgICBydWxlc0Vycm9yOiBudWxsLFxuICAgICAgICBwcm92aWRlcnM6IFtdLFxuICAgICAgICBwcm92aWRlcnNMb2FkZWQ6IGZhbHNlLFxuICAgICAgICBydWxlV2l6YXJkOiBudWxsXG4gICAgfTtcblxuICAgIC8vIC0tLS0tLS0tLS0gaTE4biAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiB0KGtleSkge1xuICAgICAgICBpZiAodHlwZW9mIGdsb2JhbFRyYW5zbGF0ZSAhPT0gJ3VuZGVmaW5lZCcgJiYgZ2xvYmFsVHJhbnNsYXRlW2tleV0pIHtcbiAgICAgICAgICAgIHJldHVybiBnbG9iYWxUcmFuc2xhdGVba2V5XTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ga2V5O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHRmKGtleSwgcGFyYW1zKSB7XG4gICAgICAgIHZhciB0ZXh0ID0gdChrZXkpO1xuICAgICAgICBPYmplY3Qua2V5cyhwYXJhbXMgfHwge30pLmZvckVhY2goZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIHRleHQgPSB0ZXh0LnNwbGl0KCd7JyArIG5hbWUgKyAnfScpLmpvaW4oU3RyaW5nKHBhcmFtc1tuYW1lXSkpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHRleHQ7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBzbWFsbCBoZWxwZXJzIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIHBhZCh2YWx1ZSkge1xuICAgICAgICByZXR1cm4gdmFsdWUgPCAxMCA/ICcwJyArIHZhbHVlIDogU3RyaW5nKHZhbHVlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmbXRUaW1lKHRzKSB7XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgcmV0dXJuIHBhZChkLmdldEhvdXJzKCkpICsgJzonICsgcGFkKGQuZ2V0TWludXRlcygpKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmbXREYXRlKHRzKSB7XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgcmV0dXJuIHBhZChkLmdldERhdGUoKSkgKyAnLicgKyBwYWQoZC5nZXRNb250aCgpICsgMSkgKyAnLicgKyBkLmdldEZ1bGxZZWFyKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZm10RGF0ZVRpbWUodHMpIHtcbiAgICAgICAgcmV0dXJuIGZtdERhdGUodHMpICsgJyAnICsgZm10VGltZSh0cyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNUb2RheSh0cykge1xuICAgICAgICB2YXIgZCA9IG5ldyBEYXRlKHRzICogMTAwMCk7XG4gICAgICAgIHZhciBub3cgPSBuZXcgRGF0ZSgpO1xuICAgICAgICByZXR1cm4gZC50b0RhdGVTdHJpbmcoKSA9PT0gbm93LnRvRGF0ZVN0cmluZygpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGlzWWVzdGVyZGF5KHRzKSB7XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgdmFyIHllc3RlcmRheSA9IG5ldyBEYXRlKERhdGUubm93KCkgLSA4NjQwMDAwMCk7XG4gICAgICAgIHJldHVybiBkLnRvRGF0ZVN0cmluZygpID09PSB5ZXN0ZXJkYXkudG9EYXRlU3RyaW5nKCk7XG4gICAgfVxuXG4gICAgLy8gT25lIGxpbmUgaW4gYSA0OCBweCByb3c6IFx1MDBhYjE4OjM0XHUwMGJiLCBcdTAwYWJcdTA0MzJcdTA0NDdcdTA0MzVcdTA0NDBcdTA0MzAgMTg6MzRcdTAwYmIsIFx1MDBhYjEyLjEwIDE4OjM0XHUwMGJiLlxuICAgIGZ1bmN0aW9uIGZtdENlbGxUaW1lKHRzKSB7XG4gICAgICAgIGlmIChpc1RvZGF5KHRzKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZtdFRpbWUodHMpO1xuICAgICAgICB9XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgdmFyIGRheSA9IGlzWWVzdGVyZGF5KHRzKSA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1RpbWVZZXN0ZXJkYXknKSA6IHBhZChkLmdldERhdGUoKSkgKyAnLicgKyBwYWQoZC5nZXRNb250aCgpICsgMSk7XG4gICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1tdXRlZFwiPicgKyBlc2MoZGF5KSArICc8L3NwYW4+ICcgKyBmbXRUaW1lKHRzKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBlc2ModmFsdWUpIHtcbiAgICAgICAgcmV0dXJuICQoJzxkaXYvPicpLnRleHQoU3RyaW5nKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgPyAnJyA6IHZhbHVlKSkuaHRtbCgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHN0YXJ0T2ZUb2RheSgpIHtcbiAgICAgICAgdmFyIGQgPSBuZXcgRGF0ZSgpO1xuICAgICAgICBkLnNldEhvdXJzKDAsIDAsIDAsIDApO1xuICAgICAgICByZXR1cm4gTWF0aC5mbG9vcihkLmdldFRpbWUoKSAvIDEwMDApO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHBlcmlvZEJvdW5kcygpIHtcbiAgICAgICAgdmFyIG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xuICAgICAgICB2YXIgdG9kYXlTdGFydCA9IHN0YXJ0T2ZUb2RheSgpO1xuICAgICAgICBzd2l0Y2ggKHN0YXRlLnBlcmlvZCkge1xuICAgICAgICAgICAgY2FzZSAndG9kYXknOiByZXR1cm4geyBmcm9tOiB0b2RheVN0YXJ0LCB0bzogbm93IH07XG4gICAgICAgICAgICBjYXNlICd5ZXN0ZXJkYXknOiByZXR1cm4geyBmcm9tOiB0b2RheVN0YXJ0IC0gODY0MDAsIHRvOiB0b2RheVN0YXJ0IC0gMSB9O1xuICAgICAgICAgICAgY2FzZSAnN2RheXMnOiByZXR1cm4geyBmcm9tOiB0b2RheVN0YXJ0IC0gNiAqIDg2NDAwLCB0bzogbm93IH07XG4gICAgICAgICAgICBjYXNlICczMGRheXMnOiByZXR1cm4geyBmcm9tOiB0b2RheVN0YXJ0IC0gMjkgKiA4NjQwMCwgdG86IG5vdyB9O1xuICAgICAgICAgICAgZGVmYXVsdDogcmV0dXJuIHsgZnJvbTogMCwgdG86IDAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gQVBJIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGFwaUdldChwYXRoLCBwYXJhbXMsIG9uU3VjY2Vzcywgb25GYWlsdXJlKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IENvbmZpZy5wYnhVcmwgKyBBUElfQkFTRSArIHBhdGgsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YTogcGFyYW1zIHx8IHt9LFxuICAgICAgICAgICAgY2FjaGU6IGZhbHNlXG4gICAgICAgIH0pLmRvbmUoZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2UucmVzdWx0ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgb25TdWNjZXNzKHJlc3BvbnNlLmRhdGEpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBvbkZhaWx1cmUobm9ybWFsaXplRmFpbHVyZShyZXNwb25zZSwgMjAwKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLmZhaWwoZnVuY3Rpb24gKHhocikge1xuICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUobnVsbCwgeGhyLnN0YXR1cykpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBhcGlQYXRjaChwYXRoLCBwYXlsb2FkLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBDb25maWcucGJ4VXJsICsgQVBJX0JBU0UgKyBwYXRoLFxuICAgICAgICAgICAgbWV0aG9kOiAnUEFUQ0gnLFxuICAgICAgICAgICAgZGF0YTogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXG4gICAgICAgICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJ1xuICAgICAgICB9KS5kb25lKGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlICYmIHJlc3BvbnNlLnJlc3VsdCA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgIG9uU3VjY2VzcyhyZXNwb25zZS5kYXRhKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUocmVzcG9uc2UsIDIwMCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KS5mYWlsKGZ1bmN0aW9uICh4aHIpIHtcbiAgICAgICAgICAgIG9uRmFpbHVyZShub3JtYWxpemVGYWlsdXJlKG51bGwsIHhoci5zdGF0dXMpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbm9ybWFsaXplRmFpbHVyZShyZXNwb25zZSwgc3RhdHVzKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXM6IHN0YXR1cyxcbiAgICAgICAgICAgIGVycm9yOiAocmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YSAmJiByZXNwb25zZS5kYXRhLmVycm9yKSB8fCAnaHR0cF8nICsgc3RhdHVzLFxuICAgICAgICAgICAgbWVzc2FnZXM6IChyZXNwb25zZSAmJiByZXNwb25zZS5tZXNzYWdlcyAmJiByZXNwb25zZS5tZXNzYWdlcy5lcnJvcikgfHwgW11cbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIHNvdXJjZSBjYXRhbG9nIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGxvYWRDYXRhbG9nKGRvbmUpIHtcbiAgICAgICAgYXBpR2V0KCcvc2V0dGluZ3M6Z2V0U291cmNlcycsIHt9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgc3RhdGUuc291cmNlcyA9IGRhdGEuaXRlbXMgfHwgW107XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLnNvdXJjZXMgPSBbXTtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc291cmNlQnlJZChpZCkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLnNvdXJjZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5zb3VyY2VzW2ldLmlkID09PSBpZCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzdGF0ZS5zb3VyY2VzW2ldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGV2ZW50VHlwZU5hbWVzKCkge1xuICAgICAgICB2YXIgbmFtZXMgPSB7fTtcbiAgICAgICAgc3RhdGUuc291cmNlcy5mb3JFYWNoKGZ1bmN0aW9uIChzb3VyY2UpIHtcbiAgICAgICAgICAgIChzb3VyY2UuZXZlbnRfdHlwZXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24gKHR5cGUpIHtcbiAgICAgICAgICAgICAgICBuYW1lc1t0eXBlLnR5cGVdID0gdHlwZS5uYW1lO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gbmFtZXM7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiBmaWx0ZXJzIChkZXNpZ24gdjM6IHBlcmlvZCBhbmQgZXZlbnQgb25seSkgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gYnVpbGRUeXBlTWVudSgpIHtcbiAgICAgICAgdmFyIG5hbWVzID0gZXZlbnRUeXBlTmFtZXMoKTtcbiAgICAgICAgdmFyIGl0ZW1zID0gW107XG4gICAgICAgIEdST1VQX09SREVSLmZvckVhY2goZnVuY3Rpb24gKGdyb3VwKSB7XG4gICAgICAgICAgICB2YXIgaW5Hcm91cCA9IFtdO1xuICAgICAgICAgICAgc3RhdGUuc291cmNlcy5mb3JFYWNoKGZ1bmN0aW9uIChzb3VyY2UpIHtcbiAgICAgICAgICAgICAgICBpZiAoc291cmNlLmdyb3VwICE9PSBncm91cCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIChzb3VyY2UuZXZlbnRfdHlwZXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24gKHR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgaW5Hcm91cC5wdXNoKHsgdmFsdWU6IHR5cGUudHlwZSwgdGV4dDogbmFtZXNbdHlwZS50eXBlXSB8fCB0eXBlLnR5cGUgfSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGlmIChpbkdyb3VwLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBpdGVtcy5wdXNoKHsgZ3JvdXA6IHNvdXJjZUdyb3VwTmFtZShncm91cCkgfSk7XG4gICAgICAgICAgICAgICAgaW5Hcm91cC5mb3JFYWNoKGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgICAgICAgICAgICAgIGl0ZW1zLnB1c2goaXRlbSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1maWx0ZXJzIC5taC1maWx0ZXItdHlwZScpLmRyb3Bkb3duKHtcbiAgICAgICAgICAgIHZhbHVlczogbWVudVRvVmFsdWVzKGl0ZW1zKSxcbiAgICAgICAgICAgIHBsYWNlaG9sZGVyOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9GaWx0ZXJBbGxUeXBlcycpLFxuICAgICAgICAgICAgb25DaGFuZ2U6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgIHN0YXRlLmV2ZW50VHlwZSA9IFN0cmluZyh2YWx1ZSB8fCAnJyk7XG4gICAgICAgICAgICAgICAgcmVsb2FkKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1lbnVUb1ZhbHVlcyhpdGVtcykge1xuICAgICAgICByZXR1cm4gaXRlbXMubWFwKGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgICAgICBpZiAoaXRlbS5ncm91cCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB7IHR5cGU6ICdoZWFkZXInLCBuYW1lOiBpdGVtLmdyb3VwIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4geyBuYW1lOiBpdGVtLnRleHQsIHZhbHVlOiBpdGVtLnZhbHVlIH07XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNvdXJjZUdyb3VwTmFtZShncm91cCkge1xuICAgICAgICB2YXIga2V5ID0ge1xuICAgICAgICAgICAgY2FsbHM6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Hcm91cENhbGxzJyxcbiAgICAgICAgICAgIGFpX3N1cGVydmlzb3I6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Hcm91cEFpU3VwZXJ2aXNvcicsXG4gICAgICAgICAgICB2b2ljZV9hZ2VudDogJ21vZHVsZV9tZXNzZW5nZXJfaHViX0dyb3VwVm9pY2VBZ2VudCcsXG4gICAgICAgICAgICBwYng6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Hcm91cFBieCdcbiAgICAgICAgfVtncm91cF0gfHwgZ3JvdXA7XG4gICAgICAgIHJldHVybiB0KGtleSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYnVpbGRQZXJpb2RNZW51KCkge1xuICAgICAgICAkKCcjbWgtam91cm5hbC1maWx0ZXJzIC5taC1maWx0ZXItcGVyaW9kJykuZHJvcGRvd24oe1xuICAgICAgICAgICAgdmFsdWVzOiBbXG4gICAgICAgICAgICAgICAgeyBuYW1lOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QZXJpb2RUb2RheScpLCB2YWx1ZTogJ3RvZGF5Jywgc2VsZWN0ZWQ6IHRydWUgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1BlcmlvZFllc3RlcmRheScpLCB2YWx1ZTogJ3llc3RlcmRheScgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1BlcmlvZDdEYXlzJyksIHZhbHVlOiAnN2RheXMnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QZXJpb2QzMERheXMnKSwgdmFsdWU6ICczMGRheXMnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QZXJpb2RBbGwnKSwgdmFsdWU6ICdhbGwnIH1cbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBvbkNoYW5nZTogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUucGVyaW9kID0gU3RyaW5nKHZhbHVlIHx8ICdhbGwnKTtcbiAgICAgICAgICAgICAgICByZWxvYWQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVzZXRGaWx0ZXJzKCkge1xuICAgICAgICBzdGF0ZS5ldmVudFR5cGUgPSAnJztcbiAgICAgICAgc3RhdGUucGVyaW9kID0gJ3RvZGF5JztcbiAgICAgICAgc3RhdGUub2Zmc2V0ID0gMDtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtZmlsdGVycyAubWgtZmlsdGVyLXR5cGUnKS5kcm9wZG93bignY2xlYXInKTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtZmlsdGVycyAubWgtZmlsdGVyLXBlcmlvZCcpLmRyb3Bkb3duKCdzZXQgc2VsZWN0ZWQnLCAndG9kYXknKTtcbiAgICAgICAgcmVsb2FkKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZmlsdGVyc0FjdGl2ZSgpIHtcbiAgICAgICAgLy8gdGhlIGRlZmF1bHQgcGVyaW9kIChcdTAwYWJcdTA0MjFcdTA0MzVcdTA0MzNcdTA0M2VcdTA0MzRcdTA0M2RcdTA0NGZcdTAwYmIpIGlzIG5vdCBhIGZpbHRlcjogYW4gZW1wdHkgbG9nIHNob3dzIFx1MDBhYlx1MDQyMVx1MDQzZVx1MDQzMVx1MDQ0Ylx1MDQ0Mlx1MDQzOFx1MDQzOSBcdTA0M2RcdTA0MzVcdTA0NDJcdTAwYmJcbiAgICAgICAgcmV0dXJuIHN0YXRlLmV2ZW50VHlwZSAhPT0gJycgfHwgc3RhdGUucGVyaW9kICE9PSAndG9kYXknO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gam91cm5hbDogbG9hZGluZyAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiByZWxvYWQoKSB7XG4gICAgICAgIHN0YXRlLm9mZnNldCA9IDA7XG4gICAgICAgIGxvYWQoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBsb2FkKG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIHNlcSA9ICsrc3RhdGUubG9hZFNlcTtcbiAgICAgICAgdmFyIGJvdW5kcyA9IHBlcmlvZEJvdW5kcygpO1xuICAgICAgICB2YXIgaXNSZWZyZXNoID0gb3B0aW9ucyAmJiBvcHRpb25zLnJlZnJlc2ggPT09IHRydWU7XG4gICAgICAgIHZhciBwYXJhbXMgPSB7XG4gICAgICAgICAgICBsaW1pdDogUEFHRV9MSU1JVCxcbiAgICAgICAgICAgIG9mZnNldDogc3RhdGUub2Zmc2V0XG4gICAgICAgIH07XG4gICAgICAgIGlmIChzdGF0ZS5ldmVudFR5cGUgIT09ICcnKSB7IHBhcmFtcy5ldmVudF90eXBlID0gc3RhdGUuZXZlbnRUeXBlOyB9XG4gICAgICAgIGlmIChib3VuZHMuZnJvbSA+IDApIHsgcGFyYW1zLmRhdGVfZnJvbSA9IGJvdW5kcy5mcm9tOyB9XG4gICAgICAgIGlmIChib3VuZHMudG8gPiAwKSB7IHBhcmFtcy5kYXRlX3RvID0gYm91bmRzLnRvOyB9XG5cbiAgICAgICAgc2V0Sm91cm5hbEJ1c3kodHJ1ZSwgaXNSZWZyZXNoKTtcbiAgICAgICAgYXBpR2V0KCcvZXZlbnRzJywgcGFyYW1zLCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgaWYgKHNlcSAhPT0gc3RhdGUubG9hZFNlcSkge1xuICAgICAgICAgICAgICAgIHJldHVybjsgLy8gYSBuZXdlciByZXF1ZXN0IGFscmVhZHkgYW5zd2VyZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHN0YXRlLnRvdGFsID0gZGF0YS5wYWdpbmF0aW9uID8gZGF0YS5wYWdpbmF0aW9uLnRvdGFsIDogMDtcbiAgICAgICAgICAgIHN0YXRlLmxhc3RJdGVtcyA9IGRhdGEuaXRlbXMgfHwgW107XG4gICAgICAgICAgICBzdGF0ZS5oYXNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc2V0Sm91cm5hbEJ1c3koZmFsc2UsIGlzUmVmcmVzaCk7XG4gICAgICAgICAgICByZW5kZXJKb3VybmFsKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICBpZiAoc2VxICE9PSBzdGF0ZS5sb2FkU2VxKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc2V0Sm91cm5hbEJ1c3koZmFsc2UsIGlzUmVmcmVzaCk7XG4gICAgICAgICAgICByZW5kZXJMb2FkRXJyb3IoZmFpbHVyZSk7XG4gICAgICAgIH0pO1xuICAgICAgICBsb2FkSm91cm5hbEJhZGdlKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2V0Sm91cm5hbEJ1c3koYnVzeSwgaXNSZWZyZXNoKSB7XG4gICAgICAgIHZhciAkdGFibGUgPSAkKCcjbWgtam91cm5hbC10YWJsZSB0YWJsZScpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmF0dHIoJ2FyaWEtYnVzeScsIGJ1c3kgPyAndHJ1ZScgOiAnZmFsc2UnKTtcbiAgICAgICAgJHRhYmxlLnRvZ2dsZUNsYXNzKCdpcy1yZWZyZXNoaW5nJywgQm9vbGVhbihidXN5ICYmIGlzUmVmcmVzaCkpO1xuICAgICAgICBpZiAoIWlzUmVmcmVzaCkge1xuICAgICAgICAgICAgaWYgKGJ1c3kpIHtcbiAgICAgICAgICAgICAgICByZW5kZXJTa2VsZXRvbigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtZXJyb3InKS5lbXB0eSgpO1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtZXJyb3ItcGxhY2Vob2xkZXInKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGpvdXJuYWxUYWJsZUhlYWQoKSB7XG4gICAgICAgIHJldHVybiAnPGNvbGdyb3VwPjxjb2wgc3R5bGU9XCJ3aWR0aDozNnB4XCI+PGNvbCBzdHlsZT1cIndpZHRoOjEwNHB4XCI+PGNvbCBzdHlsZT1cIndpZHRoOjI0MHB4XCI+PGNvbD48Y29sIHN0eWxlPVwid2lkdGg6MTYwcHhcIj48L2NvbGdyb3VwPidcbiAgICAgICAgICAgICsgJzx0aGVhZD48dHI+PHRoPjwvdGg+J1xuICAgICAgICAgICAgKyAnPHRoPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29sdW1uVGltZScpKSArICc8L3RoPidcbiAgICAgICAgICAgICsgJzx0aD4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbHVtbkV2ZW50JykpICsgJzwvdGg+J1xuICAgICAgICAgICAgKyAnPHRoPjwvdGg+J1xuICAgICAgICAgICAgKyAnPHRoPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29sdW1uRGVsaXZlcnknKSkgKyAnPC90aD4nXG4gICAgICAgICAgICArICc8L3RyPjwvdGhlYWQ+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJTa2VsZXRvbigpIHtcbiAgICAgICAgdmFyIHJvd3MgPSAnJztcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCAzOyBpKyspIHtcbiAgICAgICAgICAgIHJvd3MgKz0gJzx0ciBjbGFzcz1cIm1oLXNrZWwtcm93XCI+PHRkPjwvdGQ+PHRkPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6MzZweFwiPjwvc3Bhbj48L3RkPidcbiAgICAgICAgICAgICAgICArICc8dGQ+PHNwYW4gY2xhc3M9XCJtaC1za2VsXCIgc3R5bGU9XCJ3aWR0aDoxNjBweFwiPjwvc3Bhbj48L3RkPidcbiAgICAgICAgICAgICAgICArICc8dGQ+PHNwYW4gY2xhc3M9XCJtaC1za2VsXCIgc3R5bGU9XCJ3aWR0aDo3MCVcIj48L3NwYW4+PC90ZD4nXG4gICAgICAgICAgICAgICAgKyAnPHRkPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6OTZweDtoZWlnaHQ6MjBweDtib3JkZXItcmFkaXVzOjVweFwiPjwvc3Bhbj48L3RkPjwvdHI+JztcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmh0bWwoJzxkaXYgY2xhc3M9XCJtaC10YWJsZS13cmFwXCI+PHRhYmxlIGNsYXNzPVwidWkgdGFibGUgbWgtam91cm5hbC10YWJsZVwiIGFyaWEtYnVzeT1cInRydWVcIj4nXG4gICAgICAgICAgICArIGpvdXJuYWxUYWJsZUhlYWQoKSArICc8dGJvZHk+JyArIHJvd3MgKyAnPC90Ym9keT48L3RhYmxlPjwvZGl2PicpO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gam91cm5hbDogZGlzcGxheSBydWxlcyAocHJvYmVzIGhpZGRlbiwgY2FsbGJhY2tzIGZvbGRlZCBpbnRvIHRoZSBtaXNzZWQgY2FsbCkgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gaXNQcm9iZShpdGVtKSB7XG4gICAgICAgIHJldHVybiBCb29sZWFuKGl0ZW0gJiYgaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5wcm9iZSA9PT0gdHJ1ZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2FsbGJhY2tJbmRleChpdGVtcykge1xuICAgICAgICB2YXIgaW5kZXggPSB7fTtcbiAgICAgICAgKGl0ZW1zIHx8IFtdKS5mb3JFYWNoKGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgICAgICBpZiAoaXRlbS5ldmVudF90eXBlICE9PSAnY29yZS5taXNzZWRfY2FsbF9yZXNvbHZlZCcpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgY2FsbCA9IChpdGVtLnBheWxvYWQgJiYgaXRlbS5wYXlsb2FkLnN1YmplY3QgJiYgaXRlbS5wYXlsb2FkLnN1YmplY3QuY2FsbCkgfHwge307XG4gICAgICAgICAgICBpZiAoY2FsbC5taXNzZWRfbGlua2VkaWQgJiYgIWluZGV4W2NhbGwubWlzc2VkX2xpbmtlZGlkXSkge1xuICAgICAgICAgICAgICAgIGluZGV4W2NhbGwubWlzc2VkX2xpbmtlZGlkXSA9IGl0ZW0ub2NjdXJyZWRfYXQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gaW5kZXg7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2FsbGJhY2tUaW1lKGl0ZW0pIHtcbiAgICAgICAgdmFyIGNhbGwgPSAoaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5zdWJqZWN0ICYmIGl0ZW0ucGF5bG9hZC5zdWJqZWN0LmNhbGwpIHx8IHt9O1xuICAgICAgICBpZiAoY2FsbC5saW5rZWRpZCAmJiBzdGF0ZS5jYWxsYmFja3NbY2FsbC5saW5rZWRpZF0pIHtcbiAgICAgICAgICAgIHJldHVybiBzdGF0ZS5jYWxsYmFja3NbY2FsbC5saW5rZWRpZF07XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHJlc29sdmVkID0gMDtcbiAgICAgICAgKGl0ZW0uZGVsaXZlcmllcyB8fCBbXSkuZm9yRWFjaChmdW5jdGlvbiAoZGVsaXZlcnkpIHtcbiAgICAgICAgICAgIGlmIChkZWxpdmVyeS5yZXNvbHZlZF9hdCAmJiAocmVzb2x2ZWQgPT09IDAgfHwgZGVsaXZlcnkucmVzb2x2ZWRfYXQgPCByZXNvbHZlZCkpIHtcbiAgICAgICAgICAgICAgICByZXNvbHZlZCA9IGRlbGl2ZXJ5LnJlc29sdmVkX2F0O1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHJlc29sdmVkO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHZpc2libGVKb3VybmFsSXRlbXMoKSB7XG4gICAgICAgIHN0YXRlLmNhbGxiYWNrcyA9IGNhbGxiYWNrSW5kZXgoc3RhdGUubGFzdEl0ZW1zKTtcbiAgICAgICAgcmV0dXJuIHN0YXRlLmxhc3RJdGVtcy5maWx0ZXIoZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgICAgIGlmIChpdGVtLmV2ZW50X3R5cGUgPT09ICdjb3JlLm1pc3NlZF9jYWxsX3Jlc29sdmVkJykge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBzdGF0ZS5zaG93UHJvYmVzIHx8ICFpc1Byb2JlKGl0ZW0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJKb3VybmFsKCkge1xuICAgICAgICBoaWRlSm91cm5hbFN0YXRlcygpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvcicpLmVtcHR5KCk7XG4gICAgICAgIHJlbmRlckpvdXJuYWxCYW5uZXIoKTtcbiAgICAgICAgdmFyIGl0ZW1zID0gdmlzaWJsZUpvdXJuYWxJdGVtcygpO1xuXG4gICAgICAgIGlmIChpdGVtcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIGlmIChmaWx0ZXJzQWN0aXZlKCkpIHtcbiAgICAgICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lbXB0eS1maWx0ZXJlZCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lbXB0eScpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtdGFibGUnKS5lbXB0eSgpO1xuICAgICAgICAgICAgcmVuZGVyUGFnZXIoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBuYW1lcyA9IGV2ZW50VHlwZU5hbWVzKCk7XG4gICAgICAgIGlmICghbmFtZXNbJ2h1Yi50ZXN0J10pIHtcbiAgICAgICAgICAgIG5hbWVzWydodWIudGVzdCddID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRXZlbnRUeXBlVGVzdCcpO1xuICAgICAgICB9XG4gICAgICAgIHZhciByb3dzID0gJyc7XG4gICAgICAgIGl0ZW1zLmZvckVhY2goZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgICAgIHJvd3MgKz0gcmVuZGVyUm93KGl0ZW0sIG5hbWVzW2l0ZW0uZXZlbnRfdHlwZV0gfHwgaXRlbS5ldmVudF90eXBlKTtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5leHBhbmRlZElkID09PSBpdGVtLmlkKSB7XG4gICAgICAgICAgICAgICAgcm93cyArPSByZW5kZXJEZXRhaWxSb3coaXRlbSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmh0bWwoJzxkaXYgY2xhc3M9XCJtaC10YWJsZS13cmFwXCI+PHRhYmxlIGNsYXNzPVwidWkgc2VsZWN0YWJsZSB0YWJsZSBtaC1qb3VybmFsLXRhYmxlXCI+J1xuICAgICAgICAgICAgKyBqb3VybmFsVGFibGVIZWFkKCkgKyAnPHRib2R5PicgKyByb3dzICsgJzwvdGJvZHk+PC90YWJsZT48L2Rpdj4nKTtcblxuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZSB0Ym9keSB0ci5taC1ldmVudC1yb3cnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB0b2dnbGVSb3coJCh0aGlzKS5kYXRhKCdpZCcpKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXRhYmxlJykub2ZmKCdjbGljay5yZXRyeScpLm9uKCdjbGljay5yZXRyeScsICdbZGF0YS1hY3Rpb249XCJyZXRyeS1ldmVudFwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgICB2YXIgZXZlbnRJZCA9ICQodGhpcykuZGF0YSgnZXZlbnQtaWQnKTtcbiAgICAgICAgICAgIHZhciAkYnV0dG9uID0gJCh0aGlzKS5wcm9wKCdkaXNhYmxlZCcsIHRydWUpO1xuICAgICAgICAgICAgYXBpUG9zdCgnL2V2ZW50cy8nICsgZXZlbnRJZCArICc6cmV0cnknLCB7fSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5UmV0cmllZCcsIHsgY291bnQ6IGRhdGEucmV0cmllZCB8fCAwIH0pKTtcbiAgICAgICAgICAgICAgICBsb2FkKCk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgICAgICRidXR0b24ucHJvcCgnZGlzYWJsZWQnLCBmYWxzZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICByZW5kZXJQYWdlcigpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGhpZGVKb3VybmFsU3RhdGVzKCkge1xuICAgICAgICAkKCcjbWgtam91cm5hbC1lbXB0eScpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1lbXB0eS1maWx0ZXJlZCcpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvci1wbGFjZWhvbGRlcicpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckxvYWRFcnJvcihmYWlsdXJlKSB7XG4gICAgICAgIHZhciBoaW50ID0gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vbkxvYWRFcnJvcicsIHtcbiAgICAgICAgICAgIHdoYXQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0xvYWRXaGF0RXZlbnRzJyksXG4gICAgICAgICAgICBjb2RlOiBmYWlsdXJlLnN0YXR1cyA+IDAgPyBmYWlsdXJlLnN0YXR1cyA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblRpbWVvdXQnKVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKHN0YXRlLmhhc0xvYWRlZCAmJiBzdGF0ZS5sYXN0SXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgLy8gZGF0YSBpcyBhbHJlYWR5IG9uIHRoZSBzY3JlZW46IGtlZXAgdGhlIHRhYmxlLCBzaG93IGEgYmFubmVyIGFib3ZlIGl0XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvcicpLmh0bWwoXG4gICAgICAgICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlXCIgcm9sZT1cImFsZXJ0XCI+JyArIElDT05fRVJST1JcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtZ3Jvd1wiPicgKyBlc2MoaGludCkgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgJzxidXR0b24gY2xhc3M9XCJ1aSBiYXNpYyBidXR0b24gbWgtb24tbWVzc2FnZVwiIHR5cGU9XCJidXR0b25cIiBpZD1cIm1oLWpvdXJuYWwtcmV0cnktaW5saW5lXCI+J1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblJldHJ5JykpICsgJzwvYnV0dG9uPjwvZGl2PidcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1yZXRyeS1pbmxpbmUnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IGxvYWQoKTsgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmVtcHR5KCk7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1wYWdlcicpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtZXJyb3ItcGxhY2Vob2xkZXItaGludCcpLnRleHQoaGludCk7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvci1wbGFjZWhvbGRlcicpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiBwcm9ibGVtIGJhbm5lciBhbmQgdGhlIHVuZGVsaXZlcmVkIGNvdW50ZXIgb24gdGhlIHRhYiAtLS0tLS0tLS0tXG5cbiAgICAvLyBPbmUgcmVkIGxpbmUgYWJvdmUgdGhlIHRhYmxlIGluc3RlYWQgb2YgXHUwMGFiXHUwNDExXHUwNDNlXHUwNDQyIFx1MDQ0M1x1MDQzNFx1MDQzMFx1MDQzYlx1MDQ1MVx1MDQzZFx1MDBiYiBpbiBldmVyeSByb3cgKGRlc2lnbiB2MywgXHUwMGFiXHUwNDE2XHUwNDQzXHUwNDQwXHUwNDNkXHUwNDMwXHUwNDNiXHUwMGJiKS5cbiAgICBmdW5jdGlvbiBib3RQcm9ibGVtKCkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLmJvdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBib3QgPSBzdGF0ZS5ib3RzW2ldO1xuICAgICAgICAgICAgaWYgKGJvdC5lbmFibGVkICE9PSBmYWxzZSAmJiBib3Quc3RhdHVzID09PSAndG9rZW5faW52YWxpZCcpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0OiB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQmFubmVyVG9rZW5JbnZhbGlkJywge1xuICAgICAgICAgICAgICAgICAgICAgICAgYm90OiBib3QuYm90X3VzZXJuYW1lID8gJ0AnICsgYm90LmJvdF91c2VybmFtZSA6ICdcdTAwYWInICsgYm90LnRpdGxlICsgJ1x1MDBiYidcbiAgICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgICAgIGJvdElkOiBOdW1iZXIoYm90LmlkKVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gYSBkZWxldGVkIGJvdCBpcyBvbmx5IHZpc2libGUgdGhyb3VnaCBpdHMgZmFpbGVkIGRlbGl2ZXJpZXMgKHRoZSBib3Qgcm93IGlzIGdvbmUpXG4gICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgc3RhdGUubGFzdEl0ZW1zLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICB2YXIgZGVsaXZlcmllcyA9IHN0YXRlLmxhc3RJdGVtc1tqXS5kZWxpdmVyaWVzIHx8IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgayA9IDA7IGsgPCBkZWxpdmVyaWVzLmxlbmd0aDsgaysrKSB7XG4gICAgICAgICAgICAgICAgaWYgKGRlbGl2ZXJpZXNba10uYm90X2RlbGV0ZWQgJiYgaXNGYWlsZWREZWxpdmVyeShkZWxpdmVyaWVzW2tdKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4geyB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9CYW5uZXJCb3REZWxldGVkJyksIGJvdElkOiAwIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckpvdXJuYWxCYW5uZXIoKSB7XG4gICAgICAgIHZhciBwcm9ibGVtID0gc3RhdGUuYm90c0xvYWRlZCA/IGJvdFByb2JsZW0oKSA6IG51bGw7XG4gICAgICAgIGlmIChwcm9ibGVtID09PSBudWxsKSB7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1iYW5uZXInKS5lbXB0eSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC1qb3VybmFsLWJhbm5lcicpLmh0bWwoJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlIG1oLWJhbm5lclwiIHJvbGU9XCJhbGVydFwiPicgKyBJQ09OX0VSUk9SXG4gICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtZ3Jvd1wiPicgKyBlc2MocHJvYmxlbS50ZXh0KSArICc8L2Rpdj4nXG4gICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uIG1oLW9uLW1lc3NhZ2VcIiB0eXBlPVwiYnV0dG9uXCIgZGF0YS1hY3Rpb249XCJiYW5uZXItZml4XCIgZGF0YS1ib3QtaWQ9XCInICsgcHJvYmxlbS5ib3RJZCArICdcIj4nXG4gICAgICAgICAgICArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9CYW5uZXJDb25uZWN0JykpICsgJzwvYnV0dG9uPjwvZGl2PicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGlzRmFpbGVkRGVsaXZlcnkoZGVsaXZlcnkpIHtcbiAgICAgICAgcmV0dXJuIGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2ZhaWxlZCcgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnZHJvcHBlZCc7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNVbmRlbGl2ZXJlZChpdGVtKSB7XG4gICAgICAgIHJldHVybiAoaXRlbS5kZWxpdmVyaWVzIHx8IFtdKS5zb21lKGlzRmFpbGVkRGVsaXZlcnkpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGxvYWRKb3VybmFsQmFkZ2UoKSB7XG4gICAgICAgIGFwaUdldCgnL2V2ZW50cycsIHsgZGF0ZV9mcm9tOiBzdGFydE9mVG9kYXkoKSwgbGltaXQ6IDIwMCB9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgdmFyIGNvdW50ID0gKGRhdGEuaXRlbXMgfHwgW10pLmZpbHRlcihmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICAgICAgICAgIHJldHVybiAhaXNQcm9iZShpdGVtKSAmJiBpc1VuZGVsaXZlcmVkKGl0ZW0pO1xuICAgICAgICAgICAgfSkubGVuZ3RoO1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtYmFkZ2UnKS50ZXh0KGNvdW50ID4gOTkgPyAnOTkrJyA6IFN0cmluZyhjb3VudCkpXG4gICAgICAgICAgICAgICAgLmF0dHIoJ2FyaWEtbGFiZWwnLCB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfSm91cm5hbEJhZGdlTGFiZWwnLCB7IGNvdW50OiBjb3VudCB9KSlcbiAgICAgICAgICAgICAgICAuYXR0cignaGlkZGVuJywgY291bnQgPiAwID8gbnVsbCA6IHRydWUpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoKSB7fSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiByb3dzIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGJyaWVmRm9yKGl0ZW0pIHtcbiAgICAgICAgdmFyIHN1YmplY3QgPSBpdGVtLnBheWxvYWQgJiYgaXRlbS5wYXlsb2FkLnN1YmplY3QgPyBpdGVtLnBheWxvYWQuc3ViamVjdCA6IHt9O1xuICAgICAgICB2YXIgZmFjdHMgPSBpdGVtLnBheWxvYWQgJiYgaXRlbS5wYXlsb2FkLmZhY3RzID8gaXRlbS5wYXlsb2FkLmZhY3RzIDoge307XG4gICAgICAgIHN3aXRjaCAoaXRlbS5ldmVudF90eXBlKSB7XG4gICAgICAgICAgICBjYXNlICdjb3JlLm1pc3NlZF9jYWxsJzpcbiAgICAgICAgICAgIGNhc2UgJ3ZvaWNlX2FnZW50LmNhbGxiYWNrX3JlcXVlc3QnOlxuICAgICAgICAgICAgICAgIHZhciBlbXBsb3llZXMgPSAoc3ViamVjdC5lbXBsb3llZXMgfHwgW10pLm1hcChzaG9ydEVtcGxveWVlKS5qb2luKCcsICcpO1xuICAgICAgICAgICAgICAgIHZhciBjbGllbnQgPSBzdWJqZWN0LmNsaWVudF9udW1iZXIgfHwgJyc7XG4gICAgICAgICAgICAgICAgaWYgKGNsaWVudCAhPT0gJycgJiYgZW1wbG95ZWVzICE9PSAnJykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gY2xpZW50ICsgJyBcdTIxOTIgJyArIGVtcGxveWVlcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNsaWVudCAhPT0gJycgPyBjbGllbnQgOiBlbXBsb3llZXM7XG4gICAgICAgICAgICBjYXNlICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJzpcbiAgICAgICAgICAgICAgICBpZiAoZmFjdHMuc2NvcmVzICYmIGZhY3RzLnNjb3Jlcy5xdWFsaXR5ICE9PSBudWxsICYmIGZhY3RzLnNjb3Jlcy5xdWFsaXR5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9CcmllZlNjb3JlJywgeyBzY29yZTogZmFjdHMuc2NvcmVzLnF1YWxpdHkgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBmYWN0cy5zdW1tYXJ5IHx8IHN1YmplY3QuY2xpZW50X251bWJlciB8fCAnJztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUucHJvdmlkZXJfZG93bic6XG4gICAgICAgICAgICBjYXNlICdjb3JlLnByb3ZpZGVyX3VwJzpcbiAgICAgICAgICAgICAgICB2YXIgcHJvdmlkZXIgPSBzdWJqZWN0LnByb3ZpZGVyIHx8IHt9O1xuICAgICAgICAgICAgICAgIHJldHVybiBwcm92aWRlci51c2VybmFtZSA/ICdTSVAgXHUwMGFiJyArIHByb3ZpZGVyLnVzZXJuYW1lICsgJ1x1MDBiYicgOiAocHJvdmlkZXIuaG9zdCB8fCBwcm92aWRlci5pZCB8fCAnJyk7XG4gICAgICAgICAgICBjYXNlICdjb3JlLmFkdmljZSc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhY3RzLnN1bW1hcnkgfHwgYWR2aWNlVGV4dChzdWJqZWN0LmFkdmljZSB8fCB7fSk7XG4gICAgICAgICAgICBjYXNlICdodWIudGVzdCc6XG4gICAgICAgICAgICAgICAgdmFyIHRlc3RTeXN0ZW0gPSBzdWJqZWN0LnN5c3RlbSB8fCB7fTtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGVzdFN5c3RlbS5ib3RfdGl0bGUgfHwgJyc7XG4gICAgICAgICAgICBjYXNlICdhaV9zdXBlcnZpc29yLndvcmtlcl9vZmZsaW5lJzpcbiAgICAgICAgICAgIGNhc2UgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29ubGluZSc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIChzdWJqZWN0LndvcmtlciAmJiBzdWJqZWN0Lndvcmtlci5uYW1lKSB8fCBmYWN0cy5zdW1tYXJ5IHx8ICcnO1xuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFjdHMuc3VtbWFyeSB8fCAnJztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFx1MDBhYlx1MDQxZlx1MDQzZVx1MDQ0MFx1MDQ0Mlx1MDQzZFx1MDQzZVx1MDQzMiBcdTA0MTBcdTA0M2JcdTA0MzVcdTA0M2FcdTA0NDFcdTA0MzVcdTA0MzlcdTAwYmIgKDIwNCkgXHUyMTkyIFx1MDBhYlx1MDQxZlx1MDQzZVx1MDQ0MFx1MDQ0Mlx1MDQzZFx1MDQzZVx1MDQzMiBcdTA0MTAuICgyMDQpXHUwMGJiLCBhcyBpbiB0aGUgam91cm5hbCBtb2NrdXBcbiAgICBmdW5jdGlvbiBzaG9ydEVtcGxveWVlKGVtcGxveWVlKSB7XG4gICAgICAgIHZhciBuYW1lID0gU3RyaW5nKGVtcGxveWVlLm5hbWUgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgdmFyIHBhcnRzID0gbmFtZS5zcGxpdCgvXFxzKy8pO1xuICAgICAgICBpZiAocGFydHMubGVuZ3RoID49IDIgJiYgcGFydHNbMV0gIT09ICcnKSB7XG4gICAgICAgICAgICBuYW1lID0gcGFydHNbMF0gKyAnICcgKyBwYXJ0c1sxXS5jaGFyQXQoMCkgKyAnLic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG5hbWUgPT09ICcnKSB7XG4gICAgICAgICAgICByZXR1cm4gU3RyaW5nKGVtcGxveWVlLm51bWJlciB8fCAnJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGVtcGxveWVlLm51bWJlciA/IG5hbWUgKyAnICgnICsgZW1wbG95ZWUubnVtYmVyICsgJyknIDogbmFtZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmdWxsRW1wbG95ZWUoZW1wbG95ZWUpIHtcbiAgICAgICAgcmV0dXJuIGVtcGxveWVlLm5hbWUgPyBlbXBsb3llZS5uYW1lICsgKGVtcGxveWVlLm51bWJlciA/ICcgKCcgKyBlbXBsb3llZS5udW1iZXIgKyAnKScgOiAnJykgOiBTdHJpbmcoZW1wbG95ZWUubnVtYmVyIHx8ICcnKTtcbiAgICB9XG5cbiAgICAvLyBDb3JlIGFkdmljZSB0ZXh0OiB0aGUgYWRtaW4gY2FiaW5ldCBhbHJlYWR5IGhhcyB0aGUgQ29yZSBjYXRhbG9nIGluIGdsb2JhbFRyYW5zbGF0ZVxuICAgIC8vICh0ZW1wbGF0ZXMgbGlrZSBcIlx1MjAyNiA8YSBocmVmPScldXJsJSc+JXZlciU8L2E+XCIpOyBzdWJzdGl0dXRlIHBhcmFtcyBhbmQgZHJvcCB0aGUgbWFya3VwIGFzIHBsYWluIHRleHQuXG4gICAgZnVuY3Rpb24gYWR2aWNlVGV4dChhZHZpY2UpIHtcbiAgICAgICAgdmFyIHRwbCA9IChhZHZpY2UgJiYgYWR2aWNlLm1lc3NhZ2VfdHBsKSB8fCAnJztcbiAgICAgICAgdmFyIHRleHQgPSB0KHRwbCk7XG4gICAgICAgIGlmICh0cGwgPT09ICcnIHx8IHRleHQgPT09IHRwbCkge1xuICAgICAgICAgICAgcmV0dXJuIHRwbDtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcGFyYW1zID0gKGFkdmljZSAmJiBhZHZpY2UucGFyYW1zKSB8fCB7fTtcbiAgICAgICAgT2JqZWN0LmtleXMocGFyYW1zKS5mb3JFYWNoKGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICB0ZXh0ID0gdGV4dC5zcGxpdCgnJScgKyBuYW1lICsgJyUnKS5qb2luKFN0cmluZyhwYXJhbXNbbmFtZV0pKTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIE5ldmVyIHBhcnNlIGFzIEhUTUwgKHBhcmFtcyBtYXkgY2FycnkgdXNlci1lbnRlcmVkIG5hbWVzKTogc3RyaXAgdGFncyBhcyB0ZXh0LCBvdXRwdXQgaXMgZXNjYXBlZCBsYXRlci5cbiAgICAgICAgcmV0dXJuIHRleHQucmVwbGFjZSgvPFtePl0qPi9nLCAnJylcbiAgICAgICAgICAgIC5yZXBsYWNlKC8mbmJzcDsvZywgJyAnKS5yZXBsYWNlKC8mcXVvdDsvZywgJ1wiJykucmVwbGFjZSgvJiMwMzk7fCYjMzk7L2csIFwiJ1wiKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZsdDsvZywgJzwnKS5yZXBsYWNlKC8mZ3Q7L2csICc+JykucmVwbGFjZSgvJmFtcDsvZywgJyYnKVxuICAgICAgICAgICAgLnJlcGxhY2UoL1xccysvZywgJyAnKS50cmltKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyUm93KGl0ZW0sIGV2ZW50TmFtZSkge1xuICAgICAgICB2YXIgcHJvYmUgPSBpc1Byb2JlKGl0ZW0pID8gJzxzcGFuIGNsYXNzPVwibWgtcHJvYmVcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Byb2JlVGFnJykpICsgJzwvc3Bhbj4nIDogJyc7XG4gICAgICAgIHZhciBicmllZiA9IGJyaWVmRm9yKGl0ZW0pO1xuICAgICAgICB2YXIgZXhwYW5kZWQgPSBzdGF0ZS5leHBhbmRlZElkID09PSBpdGVtLmlkO1xuICAgICAgICByZXR1cm4gJzx0ciBjbGFzcz1cIm1oLWV2ZW50LXJvdycgKyAoZXhwYW5kZWQgPyAnIGFjdGl2ZScgOiAnJykgKyAnXCIgZGF0YS1pZD1cIicgKyBpdGVtLmlkICsgJ1wiIGFyaWEtZXhwYW5kZWQ9XCInICsgKGV4cGFuZGVkID8gJ3RydWUnIDogJ2ZhbHNlJykgKyAnXCI+J1xuICAgICAgICAgICAgKyAnPHRkIGNsYXNzPVwibWgtY2hldnJvbi1jZWxsXCI+JyArIElDT05fQ0hFVlJPTiArICc8L3RkPidcbiAgICAgICAgICAgICsgJzx0ZCBjbGFzcz1cIm1oLWNlbGwtdGltZVwiPicgKyBmbXRDZWxsVGltZShpdGVtLm9jY3VycmVkX2F0KSArICc8L3RkPidcbiAgICAgICAgICAgICsgJzx0ZD48ZGl2IGNsYXNzPVwibWgtZXZlbnQtY2VsbFwiPjxzcGFuIGNsYXNzPVwibWgtdHJ1bmNhdGVcIiB0aXRsZT1cIicgKyBlc2MoZXZlbnROYW1lKSArICdcIj4nICsgZXNjKGV2ZW50TmFtZSkgKyAnPC9zcGFuPicgKyBwcm9iZSArICc8L2Rpdj48L3RkPidcbiAgICAgICAgICAgICsgJzx0ZCBjbGFzcz1cIm1oLXRydW5jYXRlIG1oLW11dGVkXCIgdGl0bGU9XCInICsgZXNjKGJyaWVmKSArICdcIj4nICsgZXNjKGJyaWVmKSArICc8L3RkPidcbiAgICAgICAgICAgICsgJzx0ZD4nICsgZGVsaXZlcnlDZWxsKGl0ZW0pICsgJzwvdGQ+J1xuICAgICAgICAgICAgKyAnPC90cj4nO1xuICAgIH1cblxuICAgIC8vIDNcdTIwMTM0IGh1bWFuIGZpZWxkczsgdGVjaG5pY2FsIG9uZXMgKGV2ZW50IHR5cGUsIGNhbGwgSUQsIHNvdXJjZSkgc3RheSBvdXQgb2YgdGhlIGludGVyZmFjZS5cbiAgICBmdW5jdGlvbiBkZXRhaWxGaWVsZHMoaXRlbSkge1xuICAgICAgICB2YXIgc3ViamVjdCA9IGl0ZW0ucGF5bG9hZCAmJiBpdGVtLnBheWxvYWQuc3ViamVjdCA/IGl0ZW0ucGF5bG9hZC5zdWJqZWN0IDoge307XG4gICAgICAgIHZhciBmYWN0cyA9IGl0ZW0ucGF5bG9hZCAmJiBpdGVtLnBheWxvYWQuZmFjdHMgPyBpdGVtLnBheWxvYWQuZmFjdHMgOiB7fTtcbiAgICAgICAgdmFyIGZpZWxkcyA9IFtdO1xuICAgICAgICB2YXIgZW1wbG95ZWVzID0gKHN1YmplY3QuZW1wbG95ZWVzIHx8IFtdKS5tYXAoZnVsbEVtcGxveWVlKS5qb2luKCcsICcpO1xuICAgICAgICBpZiAoZW1wbG95ZWVzICE9PSAnJykgeyBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsRW1wbG95ZWUnKSwgZW1wbG95ZWVzXSk7IH1cbiAgICAgICAgaWYgKHN1YmplY3QuY2xpZW50X251bWJlcikgeyBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsQ2xpZW50JyksIHN1YmplY3QuY2xpZW50X251bWJlcl0pOyB9XG4gICAgICAgIGlmIChpdGVtLmV2ZW50X3R5cGUgPT09ICdjb3JlLm1pc3NlZF9jYWxsJykge1xuICAgICAgICAgICAgdmFyIGNhbGxiYWNrID0gY2FsbGJhY2tUaW1lKGl0ZW0pO1xuICAgICAgICAgICAgaWYgKGNhbGxiYWNrID4gMCkge1xuICAgICAgICAgICAgICAgIGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxDYWxsZWRCYWNrJyksIGZtdENlbGxUZXh0KGNhbGxiYWNrKV0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHZhciBwcm92aWRlciA9IHN1YmplY3QucHJvdmlkZXIgfHwge307XG4gICAgICAgIGlmIChwcm92aWRlci51c2VybmFtZSB8fCBwcm92aWRlci5ob3N0KSB7XG4gICAgICAgICAgICBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsUHJvdmlkZXInKSwgKHByb3ZpZGVyLnVzZXJuYW1lIHx8ICcnKSArIChwcm92aWRlci5ob3N0ID8gJyBcdTAwYjcgJyArIHByb3ZpZGVyLmhvc3QgOiAnJyldKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc3ViamVjdC5hZHZpY2UgJiYgc3ViamVjdC5hZHZpY2UubWVzc2FnZV90cGwgJiYgIWZhY3RzLnN1bW1hcnkpIHtcbiAgICAgICAgICAgIGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxTdW1tYXJ5JyksIGFkdmljZVRleHQoc3ViamVjdC5hZHZpY2UpXSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGZhY3RzLnNjb3JlcyAmJiBmYWN0cy5zY29yZXMucXVhbGl0eSAhPT0gbnVsbCAmJiBmYWN0cy5zY29yZXMucXVhbGl0eSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsU2NvcmUnKSwgZmFjdHMuc2NvcmVzLnF1YWxpdHldKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZmFjdHMuc3VtbWFyeSkgeyBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsU3VtbWFyeScpLCBmYWN0cy5zdW1tYXJ5XSk7IH1cbiAgICAgICAgaWYgKChmYWN0cy5yZWFzb25zIHx8IFtdKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsUmVhc29ucycpLCBmYWN0cy5yZWFzb25zLmpvaW4oJzsgJyldKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmllbGRzO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZtdENlbGxUZXh0KHRzKSB7XG4gICAgICAgIGlmIChpc1RvZGF5KHRzKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZtdFRpbWUodHMpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmbXREYXRlKHRzKSArICcgJyArIGZtdFRpbWUodHMpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckRldGFpbFJvdyhpdGVtKSB7XG4gICAgICAgIHZhciBodG1sID0gJzxkbCBjbGFzcz1cIm1oLWZpZWxkc1wiPic7XG4gICAgICAgIGRldGFpbEZpZWxkcyhpdGVtKS5mb3JFYWNoKGZ1bmN0aW9uIChwYWlyKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZHQ+JyArIGVzYyhwYWlyWzBdKSArICc8L2R0PjxkZD4nICsgZXNjKHBhaXJbMV0pICsgJzwvZGQ+JztcbiAgICAgICAgfSk7XG4gICAgICAgIHZhciByZXRyeWFibGUgPSBmYWxzZTtcbiAgICAgICAgKGl0ZW0uZGVsaXZlcmllcyB8fCBbXSkuZm9yRWFjaChmdW5jdGlvbiAoZGVsaXZlcnkpIHtcbiAgICAgICAgICAgIHZhciBzdGF0dXMgPSBkZWxpdmVyeVN0YXR1c1RleHQoZGVsaXZlcnkpO1xuICAgICAgICAgICAgaHRtbCArPSAnPGR0IGNsYXNzPVwibWgtdHJ1bmNhdGVcIj4nICsgZXNjKHJlY2lwaWVudFRpdGxlKGRlbGl2ZXJ5KSkgKyAnPC9kdD4nXG4gICAgICAgICAgICAgICAgKyAnPGRkJyArIChzdGF0dXMuYmFkID8gJyBjbGFzcz1cIm1oLWVycm9yLXRleHRcIicgOiAnJykgKyAnPicgKyBlc2Moc3RhdHVzLnRleHQpICsgJzwvZGQ+JztcbiAgICAgICAgICAgIGlmIChkZWxpdmVyeS5zdGF0dXMgPT09ICdmYWlsZWQnICYmICFkZWxpdmVyeS5ib3RfZGVsZXRlZCAmJiAhZGVsaXZlcnkuY2hhdF9kZWxldGVkKSB7XG4gICAgICAgICAgICAgICAgcmV0cnlhYmxlID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGh0bWwgKz0gJzwvZGw+JztcbiAgICAgICAgaWYgKHJldHJ5YWJsZSkge1xuICAgICAgICAgICAgaHRtbCArPSAnPGJ1dHRvbiBjbGFzcz1cInVpIGJhc2ljIGJ1dHRvblwiIHR5cGU9XCJidXR0b25cIiBkYXRhLWFjdGlvbj1cInJldHJ5LWV2ZW50XCIgZGF0YS1ldmVudC1pZD1cIicgKyBpdGVtLmlkICsgJ1wiPidcbiAgICAgICAgICAgICAgICArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeVJldHJ5JykpICsgJzwvYnV0dG9uPic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICc8dHIgY2xhc3M9XCJtaC1kZXRhaWxcIiBkYXRhLWRldGFpbC1mb3I9XCInICsgaXRlbS5pZCArICdcIj48dGQgY29sc3Bhbj1cIjVcIj48ZGl2IGNsYXNzPVwibWgtZGV0YWlsLWJvZHlcIj4nICsgaHRtbCArICc8L2Rpdj48L3RkPjwvdHI+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZWNpcGllbnRUaXRsZShkZWxpdmVyeSkge1xuICAgICAgICBpZiAoZGVsaXZlcnkuY2hhdF90aXRsZSkge1xuICAgICAgICAgICAgcmV0dXJuIGRlbGl2ZXJ5LmNoYXRfdGl0bGU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRlbGl2ZXJ5LmNoYXRfZGVsZXRlZCkge1xuICAgICAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5Q2hhdERlbGV0ZWQnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZGVsaXZlcnkuZXh0ZXJuYWxfY2hhdF9pZCB8fCAnXHUyMDE0JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZWxpdmVyeUNvdW50cyhpdGVtKSB7XG4gICAgICAgIHZhciBjb3VudHMgPSB7IHRvdGFsOiAwLCBzZW50OiAwLCBmYWlsZWQ6IDAsIHBlbmRpbmc6IDAsIHJlc29sdmVkOiAwIH07XG4gICAgICAgIChpdGVtLmRlbGl2ZXJpZXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24gKGRlbGl2ZXJ5KSB7XG4gICAgICAgICAgICBjb3VudHMudG90YWwrKztcbiAgICAgICAgICAgIGlmIChpc0ZhaWxlZERlbGl2ZXJ5KGRlbGl2ZXJ5KSkgeyBjb3VudHMuZmFpbGVkKys7IH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3BlbmRpbmcnIHx8IGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3NlbmRpbmcnKSB7IGNvdW50cy5wZW5kaW5nKys7IH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2NhbmNlbGxlZCcpIHsgY291bnRzLnJlc29sdmVkKys7IH1cbiAgICAgICAgICAgIGVsc2UgeyBjb3VudHMuc2VudCsrOyB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gY291bnRzO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlbGl2ZXJ5Q2VsbChpdGVtKSB7XG4gICAgICAgIHZhciBjID0gZGVsaXZlcnlDb3VudHMoaXRlbSk7XG4gICAgICAgIGlmIChjLnRvdGFsID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwibWgtbXV0ZWRcIj5cdTIwMTQ8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYy5mYWlsZWQgPiAwKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCI+JyArIElDT05fRVJST1IgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlOb3REZWxpdmVyZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMucGVuZGluZyA+IDApIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1kb3RcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3RRdWV1ZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMuc2VudCA9PT0gMCAmJiBjLnJlc29sdmVkID4gMCkge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIm1oLWRvdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlDYWxsZWRCYWNrJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1kb3QgaXMtb2tcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3REZWxpdmVyZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgfVxuXG4gICAgLy8gT25lIGxpbmUgcGVyIHJlY2lwaWVudDogc3RhdHVzIFx1MjAxNCByZWFzb24uXG4gICAgZnVuY3Rpb24gZGVsaXZlcnlTdGF0dXNUZXh0KGRlbGl2ZXJ5KSB7XG4gICAgICAgIGlmIChpc0ZhaWxlZERlbGl2ZXJ5KGRlbGl2ZXJ5KSkge1xuICAgICAgICAgICAgdmFyIHJlYXNvbiA9IGRlbGl2ZXJ5UmVhc29uKGRlbGl2ZXJ5KTtcbiAgICAgICAgICAgIHJldHVybiB7IGJhZDogdHJ1ZSwgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlOb3REZWxpdmVyZWQnKSArIChyZWFzb24gIT09ICcnID8gJyBcdTAwYjcgJyArIHJlYXNvbiA6ICcnKSB9O1xuICAgICAgICB9XG4gICAgICAgIGlmIChkZWxpdmVyeS5zdGF0dXMgPT09ICdwZW5kaW5nJyB8fCBkZWxpdmVyeS5zdGF0dXMgPT09ICdzZW5kaW5nJykge1xuICAgICAgICAgICAgcmV0dXJuIHsgYmFkOiBmYWxzZSwgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdFF1ZXVlZCcpICsgKGRlbGl2ZXJ5Lm5leHRfYXR0ZW1wdF9hdCA+IDBcbiAgICAgICAgICAgICAgICA/ICcgXHUwMGI3ICcgKyB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlOZXh0JywgeyB0aW1lOiBmbXRDZWxsVGV4dChkZWxpdmVyeS5uZXh0X2F0dGVtcHRfYXQpIH0pXG4gICAgICAgICAgICAgICAgOiAnJykgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAnY2FuY2VsbGVkJykge1xuICAgICAgICAgICAgcmV0dXJuIHsgYmFkOiBmYWxzZSwgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlTdGF0dXNDYW5jZWxsZWQnKSB9O1xuICAgICAgICB9XG4gICAgICAgIGlmIChkZWxpdmVyeS5zdGF0dXMgPT09ICdyZXRyYWN0ZWQnKSB7XG4gICAgICAgICAgICByZXR1cm4geyBiYWQ6IGZhbHNlLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeVN0YXR1c1JldHJhY3RlZCcpIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3JldHJhY3RfZmFpbGVkJykge1xuICAgICAgICAgICAgcmV0dXJuIHsgYmFkOiB0cnVlLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeVN0YXR1c1JldHJhY3RGYWlsZWQnKSB9O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7IGJhZDogZmFsc2UsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3REZWxpdmVyZWQnKSB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlbGl2ZXJ5UmVhc29uKGRlbGl2ZXJ5KSB7XG4gICAgICAgIGlmIChkZWxpdmVyeS5ib3RfZGVsZXRlZCkgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlCb3REZWxldGVkJyk7IH1cbiAgICAgICAgaWYgKGRlbGl2ZXJ5LmNoYXRfZGVsZXRlZCkgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlDaGF0RGVsZXRlZCcpOyB9XG4gICAgICAgIHZhciBjb2RlID0gZGVsaXZlcnkubGFzdF9lcnJvcl9jb2RlIHx8ICcnO1xuICAgICAgICBpZiAoY29kZSA9PT0gJ3RlbGVncmFtLjQwMS51bmF1dGhvcml6ZWQnKSB7IHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTdGF0dXNUb2tlbkludmFsaWQnKTsgfVxuICAgICAgICBpZiAoY29kZSA9PT0gJ3RlbGVncmFtLjQwMy5raWNrZWQnIHx8IGNvZGUgPT09ICd0ZWxlZ3JhbS40MDMuYmxvY2tlZCcgfHwgY29kZSA9PT0gJ3RlbGVncmFtLjQwMC5jaGF0X25vdF9mb3VuZCdcbiAgICAgICAgICAgIHx8IGNvZGUgPT09ICdtYXguNDAzLmNoYXRfZGVuaWVkJyB8fCBjb2RlID09PSAnbWF4LjQwNC5ub3RfZm91bmQnIHx8IGNvZGUgPT09ICdtYXguNDA0LnVua25vd24nKSB7XG4gICAgICAgICAgICByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFN0YXR1c0dvbmUnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gY29kZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB0b2dnbGVSb3coaWQpIHtcbiAgICAgICAgc3RhdGUuZXhwYW5kZWRJZCA9IHN0YXRlLmV4cGFuZGVkSWQgPT09IGlkID8gbnVsbCA6IGlkO1xuICAgICAgICByZW5kZXJKb3VybmFsKCk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiBwYWdlciAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiByZW5kZXJQYWdlcigpIHtcbiAgICAgICAgdmFyICRwYWdlciA9ICQoJyNtaC1qb3VybmFsLXBhZ2VyJyk7XG4gICAgICAgIGlmIChzdGF0ZS5sYXN0SXRlbXMubGVuZ3RoID09PSAwIHx8IHN0YXRlLnRvdGFsIDw9IFBBR0VfTElNSVQpIHtcbiAgICAgICAgICAgICRwYWdlci5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAkcGFnZXIucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXBhZ2UtaW5mbycpLnRleHQodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0V2ZW50c1BhZ2UnLCB7XG4gICAgICAgICAgICBmcm9tOiBzdGF0ZS5vZmZzZXQgKyAxLFxuICAgICAgICAgICAgdG86IHN0YXRlLm9mZnNldCArIHN0YXRlLmxhc3RJdGVtcy5sZW5ndGgsXG4gICAgICAgICAgICB0b3RhbDogc3RhdGUudG90YWxcbiAgICAgICAgfSkpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1wcmV2JykuYXR0cignZGlzYWJsZWQnLCBzdGF0ZS5vZmZzZXQgPD0gMCk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLW5leHQnKS5hdHRyKCdkaXNhYmxlZCcsIHN0YXRlLm9mZnNldCArIHN0YXRlLmxhc3RJdGVtcy5sZW5ndGggPj0gc3RhdGUudG90YWwpO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gc2V0dGluZ3MgdGFiIC0tLS0tLS0tLS1cblxuICAgIC8vIEZpZWxkcyBjYXJyeSBubyBoaW50cyAoZGVzaWduIHYzKTsgdGhlIGhlbHAgbGluZSB1bmRlciBhIGZpZWxkIGlzIHVzZWQgb25seSBmb3IgaXRzIGVycm9yLlxuICAgIGZ1bmN0aW9uIG1hcmtGaWVsZEVycm9yKGZpZWxkU2VsZWN0b3IsIG1lc3NhZ2UpIHtcbiAgICAgICAgJChmaWVsZFNlbGVjdG9yKS5hZGRDbGFzcygnZXJyb3InKS5maW5kKCcubWgtaGVscCcpLnRleHQobWVzc2FnZSB8fCAnJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2xlYXJGaWVsZEVycm9yKGZpZWxkU2VsZWN0b3IpIHtcbiAgICAgICAgJChmaWVsZFNlbGVjdG9yKS5yZW1vdmVDbGFzcygnZXJyb3InKS5maW5kKCcubWgtaGVscCcpLnRleHQoJycpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1hcmtSZXRlbnRpb25FcnJvcihtZXNzYWdlKSB7XG4gICAgICAgIG1hcmtGaWVsZEVycm9yKCcjbWgtcmV0ZW50aW9uLWZpZWxkJywgbWVzc2FnZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2xlYXJSZXRlbnRpb25FcnJvcigpIHtcbiAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtcmV0ZW50aW9uLWZpZWxkJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZVJldGVudGlvbigpIHtcbiAgICAgICAgdmFyIHJhdyA9IFN0cmluZygkKCcjbWgtcmV0ZW50aW9uLWlucHV0JykudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgdmFyIGRheXMgPSAvXlxcZCskLy50ZXN0KHJhdykgPyBwYXJzZUludChyYXcsIDEwKSA6IC0xO1xuICAgICAgICBpZiAoZGF5cyA8IDEgfHwgZGF5cyA+IDM2NSkge1xuICAgICAgICAgICAgbWFya1JldGVudGlvbkVycm9yKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9TZXR0aW5nc1JldGVudGlvbkVycm9yJywge30pKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjbGVhclJldGVudGlvbkVycm9yKCk7XG4gICAgICAgIGFwaVBhdGNoKCcvc2V0dGluZ3MnLCB7IGV2ZW50c19yZXRlbnRpb25fZGF5czogZGF5cyB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5yZXRlbnRpb24gPSBkYXlzO1xuICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVkJykpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBtYXJrUmV0ZW50aW9uRXJyb3IodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vbkxvYWRFcnJvcicsIHtcbiAgICAgICAgICAgICAgICB3aGF0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Mb2FkV2hhdFNldHRpbmdzJyksXG4gICAgICAgICAgICAgICAgY29kZTogJ2h0dHBfZXJyb3InXG4gICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAkKCcjbWgtcmV0ZW50aW9uLWlucHV0JykudmFsKHN0YXRlLnJldGVudGlvbik7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNob3dUb2FzdChtZXNzYWdlKSB7XG4gICAgICAgIC8vIHRoZSBhZG1pbiBjYWJpbmV0J3MgRm9tYW50aWMgYnVpbGQgaGFzIG5vIHRvYXN0IG1vZHVsZSBcdTIwMTQgYSB0aW55IHBpbGwgb2Ygb3VyIG93biAoNCBzKVxuICAgICAgICB2YXIgZXhpc3RpbmcgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcubWgtdG9hc3QnKTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBleGlzdGluZy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgZXhpc3RpbmdbaV0ucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChleGlzdGluZ1tpXSk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHRvYXN0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgICAgIHRvYXN0LmNsYXNzTmFtZSA9ICdtaC10b2FzdCc7XG4gICAgICAgIHRvYXN0LnNldEF0dHJpYnV0ZSgncm9sZScsICdzdGF0dXMnKTtcbiAgICAgICAgdG9hc3QudGV4dENvbnRlbnQgPSBtZXNzYWdlO1xuICAgICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKHRvYXN0KTtcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAodG9hc3QucGFyZW50Tm9kZSkge1xuICAgICAgICAgICAgICAgIHRvYXN0LnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQodG9hc3QpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LCA0MDAwKTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGJvdHM6IEFQSSAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBhcGlTZW5kKG1ldGhvZCwgcGF0aCwgcGF5bG9hZCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpIHtcbiAgICAgICAgdmFyIG9wdGlvbnMgPSB7XG4gICAgICAgICAgICB1cmw6IENvbmZpZy5wYnhVcmwgKyBBUElfQkFTRSArIHBhdGgsXG4gICAgICAgICAgICBtZXRob2Q6IG1ldGhvZCxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgICAgICBjYWNoZTogZmFsc2VcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKHBheWxvYWQgIT09IG51bGwgJiYgcGF5bG9hZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvcHRpb25zLmRhdGEgPSBKU09OLnN0cmluZ2lmeShwYXlsb2FkKTtcbiAgICAgICAgICAgIG9wdGlvbnMuY29udGVudFR5cGUgPSAnYXBwbGljYXRpb24vanNvbic7XG4gICAgICAgIH1cbiAgICAgICAgJC5hamF4KG9wdGlvbnMpLmRvbmUoZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2UucmVzdWx0ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgb25TdWNjZXNzKHJlc3BvbnNlLmRhdGEpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBvbkZhaWx1cmUobm9ybWFsaXplRmFpbHVyZShyZXNwb25zZSwgMjAwKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLmZhaWwoZnVuY3Rpb24gKHhocikge1xuICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUoeGhyLnJlc3BvbnNlSlNPTiB8fCBudWxsLCB4aHIuc3RhdHVzKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGFwaVBvc3QocGF0aCwgcGF5bG9hZCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpIHtcbiAgICAgICAgYXBpU2VuZCgnUE9TVCcsIHBhdGgsIHBheWxvYWQgfHwge30sIG9uU3VjY2Vzcywgb25GYWlsdXJlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBhcGlEZWxldGUocGF0aCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpIHtcbiAgICAgICAgYXBpU2VuZCgnREVMRVRFJywgcGF0aCwgbnVsbCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNvcmVHZXQocGF0aCwgcGFyYW1zLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBDb25maWcucGJ4VXJsICsgJy9wYnhjb3JlL2FwaS92MycgKyBwYXRoLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGRhdGE6IHBhcmFtcyB8fCB7fSxcbiAgICAgICAgICAgIGNhY2hlOiBmYWxzZVxuICAgICAgICB9KS5kb25lKGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlICYmIHJlc3BvbnNlLnJlc3VsdCA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgIG9uU3VjY2VzcyhyZXNwb25zZS5kYXRhKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUocmVzcG9uc2UsIDIwMCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KS5mYWlsKGZ1bmN0aW9uICh4aHIpIHtcbiAgICAgICAgICAgIG9uRmFpbHVyZShub3JtYWxpemVGYWlsdXJlKHhoci5yZXNwb25zZUpTT04gfHwgbnVsbCwgeGhyLnN0YXR1cykpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmYWlsdXJlVGV4dChmYWlsdXJlKSB7XG4gICAgICAgIGlmIChmYWlsdXJlICYmIGZhaWx1cmUuZmllbGQpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWlsdXJlLm1lc3NhZ2VzLmxlbmd0aCA+IDAgPyBmYWlsdXJlLm1lc3NhZ2VzWzBdIDogZmFpbHVyZS5lcnJvcjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gKGZhaWx1cmUgJiYgZmFpbHVyZS5lcnJvcikgPyBmYWlsdXJlLmVycm9yIDogJ2h0dHBfZXJyb3InO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gYm90czogc3RhdGUgJiByZW5kZXJpbmcgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gYm90QnlJZChpZCkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLmJvdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIoc3RhdGUuYm90c1tpXS5pZCkgPT09IE51bWJlcihpZCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc3RhdGUuYm90c1tpXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZXBsYWNlQm90KGJvdCkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLmJvdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIoc3RhdGUuYm90c1tpXS5pZCkgPT09IE51bWJlcihib3QuaWQpKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUuYm90c1tpXSA9IGJvdDtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgc3RhdGUuYm90cy5wdXNoKGJvdCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbG9hZEJvdHMoc2lsZW50KSB7XG4gICAgICAgIGlmICghc2lsZW50KSB7XG4gICAgICAgICAgICBzdGF0ZS5ib3RzTG9hZGVkID0gZmFsc2U7XG4gICAgICAgICAgICByZW5kZXJCb3RzU2tlbGV0b24oKTtcbiAgICAgICAgfVxuICAgICAgICBhcGlHZXQoJy9ib3RzJywgeyBsaW1pdDogMjAwIH0sIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICBzdGF0ZS5ib3RzID0gZGF0YS5pdGVtcyB8fCBbXTtcbiAgICAgICAgICAgIHN0YXRlLmJvdHNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc3RhdGUuYm90c0Vycm9yID0gbnVsbDtcbiAgICAgICAgICAgIHJlbmRlckJvdHMoKTtcbiAgICAgICAgICAgIHJlbmRlclJ1bGVzKCk7XG4gICAgICAgICAgICByZW5kZXJKb3VybmFsQmFubmVyKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICBzdGF0ZS5ib3RzTG9hZGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIHN0YXRlLmJvdHNFcnJvciA9IGZhaWx1cmU7XG4gICAgICAgICAgICByZW5kZXJCb3RzKCk7XG4gICAgICAgICAgICByZW5kZXJSdWxlcygpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJCb3RzU2tlbGV0b24oKSB7XG4gICAgICAgIHZhciBjYXJkID0gJzxkaXYgY2xhc3M9XCJtaC1ib3QtY2FyZCBtaC1ib3Qtc2tlbGV0b25cIj48c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjMycHg7aGVpZ2h0OjMycHg7Ym9yZGVyLXJhZGl1czo4cHhcIj48L3NwYW4+J1xuICAgICAgICAgICAgKyAnPGRpdiBzdHlsZT1cImZsZXg6MTtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDo2cHhcIj48c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjUwJVwiPjwvc3Bhbj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjMwJTtoZWlnaHQ6OHB4XCI+PC9zcGFuPjwvZGl2PjwvZGl2Pic7XG4gICAgICAgICQoJyNtaC1ib3RzJykuaHRtbChjYXJkICsgY2FyZCk7XG4gICAgfVxuXG4gICAgLy8gVGVsZWdyYW0gLyBNQVggdGlsZXM6IHRoZSBmaXJzdC1ydW4gc2NyZWVuIGFuZCBcdTAwYWJcdTA0MWRcdTA0MzBcdTA0NDFcdTA0NDJcdTA0NDBcdTA0M2VcdTA0MzlcdTA0M2FcdTA0MzhcdTAwYmIgd2l0aG91dCBib3RzIChkZXNpZ24gdjMpLlxuICAgIGZ1bmN0aW9uIG1lc3NlbmdlclRpbGVzKCkge1xuICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJtaC1tZXNzZW5nZXItdGlsZXNcIj4nXG4gICAgICAgICAgICArICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cIm1oLXNjZW5hcmlvIG1oLXRpbGVcIiBkYXRhLWFjdGlvbj1cImFkZC1ib3RcIiBkYXRhLWNoYW5uZWw9XCJ0ZWxlZ3JhbVwiPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyIHRnXCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+VEc8L3NwYW4+PGI+VGVsZWdyYW08L2I+PC9idXR0b24+J1xuICAgICAgICAgICAgKyAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJtaC1zY2VuYXJpbyBtaC10aWxlXCIgZGF0YS1hY3Rpb249XCJhZGQtYm90XCIgZGF0YS1jaGFubmVsPVwibWF4XCI+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tZXNzZW5nZXIgbWF4XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+TUFYPC9zcGFuPjxiPk1BWDwvYj48L2J1dHRvbj4nXG4gICAgICAgICAgICArICc8L2Rpdj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdHMoKSB7XG4gICAgICAgIHZhciAkd3JhcCA9ICQoJyNtaC1ib3RzJyk7XG4gICAgICAgIGlmIChzdGF0ZS5ib3RzRXJyb3IgIT09IG51bGwgJiYgc3RhdGUuYm90cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtYWRkJykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICAgICAkd3JhcC5odG1sKCc8ZGl2IGNsYXNzPVwidWkgbmVnYXRpdmUgbWVzc2FnZVwiIHJvbGU9XCJhbGVydFwiPicgKyBJQ09OX0VSUk9SXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLWdyb3dcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdHNMb2FkRmFpbGVkJykpICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uIG1oLW9uLW1lc3NhZ2VcIiB0eXBlPVwiYnV0dG9uXCIgaWQ9XCJtaC1ib3RzLXJldHJ5XCI+J1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblJldHJ5JykpICsgJzwvYnV0dG9uPjwvZGl2PicpO1xuICAgICAgICAgICAgJCgnI21oLWJvdHMtcmV0cnknKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IGxvYWRCb3RzKCk7IH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghc3RhdGUuYm90c0xvYWRlZCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC1ib3QtYWRkJykuYXR0cignaGlkZGVuJywgc3RhdGUuYm90cy5sZW5ndGggPiAwID8gbnVsbCA6IHRydWUpO1xuICAgICAgICBpZiAoc3RhdGUuYm90cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICR3cmFwLmh0bWwobWVzc2VuZ2VyVGlsZXMoKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGh0bWwgPSAnPGRpdiBjbGFzcz1cIm1oLWJvdC1saXN0XCI+JztcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5ib3RzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBodG1sICs9IHJlbmRlckJvdENhcmQoc3RhdGUuYm90c1tpXSk7XG4gICAgICAgIH1cbiAgICAgICAgJHdyYXAuaHRtbChodG1sICsgJzwvZGl2PicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdENhcmQoYm90KSB7XG4gICAgICAgIHZhciBleHBhbmRlZCA9IHN0YXRlLmV4cGFuZGVkQm90c1tib3QuaWRdID09PSB0cnVlO1xuICAgICAgICB2YXIgYm9keSA9ICcnO1xuICAgICAgICBpZiAoZXhwYW5kZWQpIHtcbiAgICAgICAgICAgIGJvZHkgPSAnPGRpdiBjbGFzcz1cIm1oLWJvdC1ib2R5XCI+JyArIHJlbmRlckJvdFRsc1dhcm5pbmcoYm90KSArIHJlbmRlckJvdENoYXRzKGJvdCkgKyByZW5kZXJCb3RBY3Rpb25zKGJvdCkgKyAnPC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICB2YXIgY2hhdENvdW50ID0gKGJvdC5jaGF0cyB8fCBbXSkubGVuZ3RoO1xuICAgICAgICB2YXIgbWV0YSA9IFtdO1xuICAgICAgICBpZiAoYm90LmJvdF91c2VybmFtZSkgeyBtZXRhLnB1c2goJ0AnICsgYm90LmJvdF91c2VybmFtZSk7IH1cbiAgICAgICAgbWV0YS5wdXNoKGNoYXRDb3VudCA+IDAgPyB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hhdHNDb3VudCcsIHsgY291bnQ6IGNoYXRDb3VudCB9KSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoYXRzTm9uZScpKTtcbiAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwibWgtYm90LXJvdycgKyAoZXhwYW5kZWQgPyAnIGlzLW9wZW4nIDogJycpICsgJ1wiIGRhdGEtYm90LWlkPVwiJyArIGJvdC5pZCArICdcIj4nXG4gICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtYm90LWhlYWRcIiBkYXRhLWFjdGlvbj1cInRvZ2dsZVwiIHJvbGU9XCJidXR0b25cIiB0YWJpbmRleD1cIjBcIiBhcmlhLWV4cGFuZGVkPVwiJyArIChleHBhbmRlZCA/ICd0cnVlJyA6ICdmYWxzZScpICsgJ1wiPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyICcgKyAoYm90LmNoYW5uZWwgPT09ICdtYXgnID8gJ21heCcgOiAndGcnKSArICdcIiBhcmlhLWhpZGRlbj1cInRydWVcIj4nICsgKGJvdC5jaGFubmVsID09PSAnbWF4JyA/ICdNQVgnIDogJ1RHJykgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ib3QtdGl0bGVzXCI+PGIgY2xhc3M9XCJtaC10cnVuY2F0ZVwiPicgKyBlc2MoYm90LnRpdGxlKSArICc8L2I+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tZXRhIG1oLXRydW5jYXRlXCI+JyArIGVzYyhtZXRhLmpvaW4oJyBcdTAwYjcgJykpICsgJzwvc3Bhbj48L2Rpdj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWJvdC1zdGF0dXNcIj4nICsgYm90U3RhdHVzQ2VsbChib3QpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWNoZXZyb25cIiBhcmlhLWhpZGRlbj1cInRydWVcIj4nXG4gICAgICAgICAgICArICc8c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBzdHlsZT1cInRyYW5zZm9ybTpyb3RhdGUoJyArIChleHBhbmRlZCA/ICcxODAnIDogJzAnKSArICdkZWcpXCI+PHBhdGggZD1cIk0zLjUgNkw4IDEwLjUgMTIuNSA2XCIvPjwvc3ZnPidcbiAgICAgICAgICAgICsgJzwvc3Bhbj48L2Rpdj4nICsgYm9keSArICc8L2Rpdj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJvdFN0YXR1c0NlbGwoYm90KSB7XG4gICAgICAgIGlmIChib3QuZW5hYmxlZCA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1kb3RcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c0Rpc2FibGVkJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmIChib3Quc3RhdHVzID09PSAnb2snKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwibWgtZG90IGlzLW9rXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTdGF0dXNPaycpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYm90LnN0YXR1cyA9PT0gJ3Rva2VuX2ludmFsaWQnKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTdGF0dXNUb2tlbkludmFsaWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICdjYV9lcnJvcicpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c0NhRXJyb3InKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICdlcnJvcicpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSB5ZWxsb3cgbGFiZWxcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c0NoZWNrRmFpbGVkJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1kb3RcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c05ldycpKSArICc8L3NwYW4+JztcbiAgICB9XG5cbiAgICAvLyBUaGUgTUFYIEFQSSBpcyBzaWduZWQgYnkgdGhlIFx1MDQxY1x1MDQzOFx1MDQzZFx1MDQ0Nlx1MDQzOFx1MDQ0NFx1MDQ0MFx1MDQ0YiByb290IENBOiBhIHRydXN0IGZhaWx1cmUgaXMgYSBjb25maWd1cmF0aW9uIHByb2JsZW0sIG5vdCBhXG4gICAgLy8gdG9rZW4gcHJvYmxlbSwgc28gaXQgZ2V0cyBpdHMgb3duIGV4cGxhbmF0aW9uIGFuZCBwb2ludHMgdG8gdGhlIHNldHRpbmdzIGZpZWxkLlxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdFRsc1dhcm5pbmcoYm90KSB7XG4gICAgICAgIGlmIChib3Quc3RhdHVzICE9PSAnY2FfZXJyb3InICYmICFpc01heFRsc0NvZGUoYm90Lmxhc3RfZXJyb3JfY29kZSkpIHtcbiAgICAgICAgICAgIHJldHVybiAnJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJ1aSB3YXJuaW5nIG1lc3NhZ2VcIiByb2xlPVwibm90ZVwiPidcbiAgICAgICAgICAgICsgJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjxjaXJjbGUgY3g9XCI4XCIgY3k9XCI4XCIgcj1cIjYuMjVcIi8+PHBhdGggZD1cIk04IDQuNXY0TTggMTFoLjAxXCIvPjwvc3ZnPidcbiAgICAgICAgICAgICsgJzxkaXY+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTdGF0dXNDYUVycm9yJykpICsgJy4gJ1xuICAgICAgICAgICAgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2FFcnJvckhpbnQnKSkgKyAnPC9kaXY+PC9kaXY+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjaGF0S2luZExhYmVsKGtpbmQpIHtcbiAgICAgICAgaWYgKGtpbmQgPT09ICdwcml2YXRlJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFR5cGVQcml2YXRlJyk7IH1cbiAgICAgICAgaWYgKGtpbmQgPT09ICdjaGFubmVsJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFR5cGVDaGFubmVsJyk7IH1cbiAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRUeXBlR3JvdXAnKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJCb3RDaGF0cyhib3QpIHtcbiAgICAgICAgdmFyIGNoYXRzID0gYm90LmNoYXRzIHx8IFtdO1xuICAgICAgICBpZiAoY2hhdHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJtaC1ib3Qtbm9jaGF0cyBtaC1tdXRlZFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Tm9DaGF0c1RpdGxlJykpICsgJzwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGh0bWwgPSAnPGRpdiBjbGFzcz1cIm1oLWNoYXQtbGlzdFwiPic7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hhdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGh0bWwgKz0gcmVuZGVyQ2hhdFJvdyhib3QsIGNoYXRzW2ldKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gaHRtbCArICc8L2Rpdj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckNoYXRSb3coYm90LCBjaGF0KSB7XG4gICAgICAgIHZhciBnb25lID0gY2hhdC5zdGF0ZSA9PT0gJ2dvbmUnO1xuICAgICAgICB2YXIgc3RhdGVDZWxsO1xuICAgICAgICBpZiAoZ29uZSkge1xuICAgICAgICAgICAgc3RhdGVDZWxsID0gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCIgdGl0bGU9XCInICsgZXNjKGNoYXQuZ29uZV9yZWFzb24pICsgJ1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFN0YXR1c0dvbmUnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH0gZWxzZSBpZiAoY2hhdC5sYXN0X2RlbGl2ZXJ5ICYmIGNoYXQubGFzdF9kZWxpdmVyeS5zdGF0dXMgPT09ICdmYWlsZWQnKSB7XG4gICAgICAgICAgICBzdGF0ZUNlbGwgPSAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRTdGF0dXNFcnJvcicpKSArICc8L3NwYW4+JztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHN0YXRlQ2VsbCA9ICc8c3BhbiBjbGFzcz1cIm1oLWRvdCBpcy1va1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFN0YXR1c09rJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnPGRpdiBjbGFzcz1cIm1oLWNoYXQtcm93XCIgZGF0YS1jaGF0LWlkPVwiJyArIGNoYXQuaWQgKyAnXCI+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1jaGF0LXRpdGxlXCI+PHNwYW4gY2xhc3M9XCJtaC10cnVuY2F0ZVwiPicgKyBlc2MoY2hhdC50aXRsZSB8fCBjaGF0LmNoYXRfaWQpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1ldGFcIj4gXHUwMGI3ICcgKyBlc2MoY2hhdEtpbmRMYWJlbChjaGF0LmNoYXRfa2luZCkpICsgJzwvc3Bhbj48L3NwYW4+J1xuICAgICAgICAgICAgKyBlbXBsb3llZVNlbGVjdChjaGF0KVxuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1jaGF0LXN0YXRlXCI+JyArIHN0YXRlQ2VsbCArICc8L3NwYW4+J1xuICAgICAgICAgICAgKyAnPGxhYmVsIGNsYXNzPVwidWkgdG9nZ2xlIGNoZWNrYm94JyArIChjaGF0LmVuYWJsZWQgPyAnIGNoZWNrZWQnIDogJycpICsgKGdvbmUgPyAnIGRpc2FibGVkJyA6ICcnKSArICdcIiBhcmlhLWxhYmVsPVwiJyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RFbmFibGVDaGF0JykpICsgJ1wiPidcbiAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjbGFzcz1cImhpZGRlbiBtaC1jaGF0LXRvZ2dsZVwiJyArIChjaGF0LmVuYWJsZWQgPyAnIGNoZWNrZWQnIDogJycpICsgKGdvbmUgPyAnIGRpc2FibGVkJyA6ICcnKSArICc+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC10cmFja1wiPjwvc3Bhbj48L2xhYmVsPidcbiAgICAgICAgICAgICsgJzwvZGl2Pic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZW1wbG95ZWVTZWxlY3QoY2hhdCkge1xuICAgICAgICB2YXIgb3B0aW9ucyA9ICc8b3B0aW9uIHZhbHVlPVwiMFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdE5vRW1wbG95ZWUnKSkgKyAnPC9vcHRpb24+JztcbiAgICAgICAgdmFyIGZvdW5kID0gZmFsc2U7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUuZW1wbG95ZWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgZW1wbG95ZWUgPSBzdGF0ZS5lbXBsb3llZXNbaV07XG4gICAgICAgICAgICB2YXIgc2VsZWN0ZWQgPSBOdW1iZXIoZW1wbG95ZWUuaWQpID09PSBOdW1iZXIoY2hhdC5saW5rZWRfdXNlcl9pZCk7XG4gICAgICAgICAgICBpZiAoc2VsZWN0ZWQpIHsgZm91bmQgPSB0cnVlOyB9XG4gICAgICAgICAgICBvcHRpb25zICs9ICc8b3B0aW9uIHZhbHVlPVwiJyArIGVtcGxveWVlLmlkICsgJ1wiJyArIChzZWxlY3RlZCA/ICcgc2VsZWN0ZWQnIDogJycpICsgJz4nICsgZXNjKGVtcGxveWVlLmxhYmVsKSArICc8L29wdGlvbj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmICghZm91bmQgJiYgTnVtYmVyKGNoYXQubGlua2VkX3VzZXJfaWQpID4gMCkge1xuICAgICAgICAgICAgb3B0aW9ucyArPSAnPG9wdGlvbiB2YWx1ZT1cIicgKyBjaGF0LmxpbmtlZF91c2VyX2lkICsgJ1wiIHNlbGVjdGVkPiMnICsgY2hhdC5saW5rZWRfdXNlcl9pZCArICc8L29wdGlvbj4nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnPHNlbGVjdCBjbGFzcz1cIm1oLWVtcGxveWVlLXNlbGVjdFwiIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRFbXBsb3llZScpKSArICdcIj4nICsgb3B0aW9ucyArICc8L3NlbGVjdD4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdEFjdGlvbnMoYm90KSB7XG4gICAgICAgIHJldHVybiAnPGRpdiBjbGFzcz1cIm1oLWJvdC1hY3Rpb25zXCI+J1xuICAgICAgICAgICAgKyAnPGEgaHJlZj1cIiNcIiBkYXRhLWFjdGlvbj1cImNvbm5lY3RcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdEFjdGlvbnNDb25uZWN0JykpICsgJzwvYT4nXG4gICAgICAgICAgICArICc8YSBocmVmPVwiI1wiIGRhdGEtYWN0aW9uPVwidGVzdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90QWN0aW9uc1Rlc3QnKSkgKyAnPC9hPidcbiAgICAgICAgICAgICsgJzxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJlZGl0XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RBY3Rpb25zRWRpdCcpKSArICc8L2E+J1xuICAgICAgICAgICAgKyAnPC9kaXY+JztcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGJvdHM6IGRlbGVnYXRlZCBhY3Rpb25zIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGJpbmRCb3RzQ29udGFpbmVyKCkge1xuICAgICAgICB2YXIgJHdyYXAgPSAkKCcjbWgtYm90cycpO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwidG9nZ2xlXCJdJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGlkID0gU3RyaW5nKCQodGhpcykuY2xvc2VzdCgnLm1oLWJvdC1yb3cnKS5kYXRhKCdib3QtaWQnKSk7XG4gICAgICAgICAgICBzdGF0ZS5leHBhbmRlZEJvdHNbaWRdID0gc3RhdGUuZXhwYW5kZWRCb3RzW2lkXSAhPT0gdHJ1ZTtcbiAgICAgICAgICAgIHJlbmRlckJvdHMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdrZXlkb3duJywgJ1tkYXRhLWFjdGlvbj1cInRvZ2dsZVwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgaWYgKGV2ZW50LmtleSA9PT0gJ0VudGVyJyB8fCBldmVudC5rZXkgPT09ICcgJykge1xuICAgICAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICAgICAgJCh0aGlzKS50cmlnZ2VyKCdjbGljaycpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImFkZC1ib3RcIl0nLCBmdW5jdGlvbiAoKSB7IG9wZW5Cb3RNb2RhbCgnYWRkJywgbnVsbCwgJCh0aGlzKS5kYXRhKCdjaGFubmVsJykpOyB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImNvbm5lY3RcIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBvcGVuQ2hhdE1vZGFsKGJvdEJ5SWQoJCh0aGlzKS5jbG9zZXN0KCcubWgtYm90LXJvdycpLmRhdGEoJ2JvdC1pZCcpKSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwidGVzdFwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIG9wZW5UZXN0TW9kYWwoYm90QnlJZCgkKHRoaXMpLmNsb3Nlc3QoJy5taC1ib3Qtcm93JykuZGF0YSgnYm90LWlkJykpLCBudWxsKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJlZGl0XCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgb3BlbkJvdE1vZGFsKCdlZGl0JywgYm90QnlJZCgkKHRoaXMpLmNsb3Nlc3QoJy5taC1ib3Qtcm93JykuZGF0YSgnYm90LWlkJykpKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjaGFuZ2UnLCAnLm1oLWNoYXQtdG9nZ2xlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGJvdElkID0gJCh0aGlzKS5jbG9zZXN0KCcubWgtYm90LXJvdycpLmRhdGEoJ2JvdC1pZCcpO1xuICAgICAgICAgICAgdmFyIGNoYXRJZCA9ICQodGhpcykuY2xvc2VzdCgnLm1oLWNoYXQtcm93JykuZGF0YSgnY2hhdC1pZCcpO1xuICAgICAgICAgICAgdmFyIGVuYWJsZWQgPSAkKHRoaXMpLnByb3AoJ2NoZWNrZWQnKTtcbiAgICAgICAgICAgIHBhdGNoQm90KGJvdElkLCB7IGNoYXRzOiBbeyBpZDogTnVtYmVyKGNoYXRJZCksIGVuYWJsZWQ6IGVuYWJsZWQgfV0gfSwgbnVsbCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25TYXZlRmFpbGVkJykpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2hhbmdlJywgJy5taC1lbXBsb3llZS1zZWxlY3QnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgYm90SWQgPSAkKHRoaXMpLmNsb3Nlc3QoJy5taC1ib3Qtcm93JykuZGF0YSgnYm90LWlkJyk7XG4gICAgICAgICAgICB2YXIgY2hhdElkID0gJCh0aGlzKS5jbG9zZXN0KCcubWgtY2hhdC1yb3cnKS5kYXRhKCdjaGF0LWlkJyk7XG4gICAgICAgICAgICBwYXRjaEJvdChib3RJZCwgeyBjaGF0czogW3sgaWQ6IE51bWJlcihjaGF0SWQpLCBsaW5rZWRfdXNlcl9pZDogTnVtYmVyKCQodGhpcykudmFsKCkpIH1dIH0sIG51bGwsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZUZhaWxlZCcpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBwYXRjaEJvdChib3RJZCwgcGF5bG9hZCwgb25TdWNjZXNzLCBvbkZhaWx1cmUpIHtcbiAgICAgICAgYXBpUGF0Y2goJy9ib3RzLycgKyBib3RJZCwgcGF5bG9hZCwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgcmVwbGFjZUJvdChib3QpO1xuICAgICAgICAgICAgcmVuZGVyQm90cygpO1xuICAgICAgICAgICAgaWYgKG9uU3VjY2VzcykgeyBvblN1Y2Nlc3MoYm90KTsgfVxuICAgICAgICB9LCBvbkZhaWx1cmUgfHwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgIHNob3dUb2FzdChmYWlsdXJlVGV4dChmYWlsdXJlKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gZW1wbG95ZWVzIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGxvYWRFbXBsb3llZXMoZG9uZSkge1xuICAgICAgICBpZiAoc3RhdGUuZW1wbG95ZWVzTG9hZGVkKSB7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29yZUdldCgnL2V4dGVuc2lvbnMnLCB7IGxpbWl0OiA1MDAgfSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHZhciBpdGVtcyA9IGRhdGEuaXRlbXMgfHwgW107XG4gICAgICAgICAgICB2YXIgc2VlbiA9IHt9O1xuICAgICAgICAgICAgdmFyIGxpc3QgPSBbXTtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaXRlbXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICB2YXIgaXRlbSA9IGl0ZW1zW2ldO1xuICAgICAgICAgICAgICAgIHZhciB1c2VySWQgPSBOdW1iZXIoaXRlbS51c2VyaWQpO1xuICAgICAgICAgICAgICAgIGlmICghdXNlcklkIHx8IHNlZW5bdXNlcklkXSkge1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgc2Vlblt1c2VySWRdID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICB2YXIgbmFtZSA9IGl0ZW0uY2FsbGVyaWQgfHwgaXRlbS5udW1iZXIgfHwgKCcjJyArIHVzZXJJZCk7XG4gICAgICAgICAgICAgICAgdmFyIG51bWJlciA9IGl0ZW0ubnVtYmVyID8gU3RyaW5nKGl0ZW0ubnVtYmVyKSA6ICcnO1xuICAgICAgICAgICAgICAgIHZhciBsYWJlbCA9IChudW1iZXIgIT09ICcnICYmIFN0cmluZyhuYW1lKS5pbmRleE9mKG51bWJlcikgPT09IC0xKSA/IG5hbWUgKyAnICgnICsgbnVtYmVyICsgJyknIDogbmFtZTtcbiAgICAgICAgICAgICAgICBsaXN0LnB1c2goeyBpZDogdXNlcklkLCBsYWJlbDogbGFiZWwgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBsaXN0LnNvcnQoZnVuY3Rpb24gKGEsIGIpIHsgcmV0dXJuIGEubGFiZWwubG9jYWxlQ29tcGFyZShiLmxhYmVsKTsgfSk7XG4gICAgICAgICAgICBzdGF0ZS5lbXBsb3llZXMgPSBsaXN0O1xuICAgICAgICAgICAgc3RhdGUuZW1wbG95ZWVzTG9hZGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIHN0YXRlLmVtcGxveWVlc0ZhaWxlZCA9IGZhbHNlO1xuICAgICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5lbXBsb3llZXNMb2FkZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIHN0YXRlLmVtcGxveWVlc0ZhaWxlZCA9IHRydWU7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gYm90IG1vZGFsIC0tLS0tLS0tLS1cblxuICAgIC8vIENoYW5uZWxzIHdpdGggYSBiYWNrZW5kIGFkYXB0ZXIgKGJvdGggaGF2ZSBvbmUgc2luY2Ugc3RhZ2UgM2IvM2MpLiBUaGUgY2hlY2tzIGJlbG93IHN0YXkgYXMgYVxuICAgIC8vIGd1YXJkOiBhIGNoYW5uZWwgd2l0aG91dCBhbiBhZGFwdGVyIG9uIHRoZSBzZXJ2ZXIgbXVzdCBub3QgYmUgc2F2ZWQgZnJvbSBhIHN0YWxlIHBhZ2UuXG4gICAgdmFyIFNBVkFCTEVfQ0hBTk5FTFMgPSBbJ3RlbGVncmFtJywgJ21heCddO1xuXG4gICAgZnVuY3Rpb24gb3BlbkJvdE1vZGFsKG1vZGUsIGJvdCwgY2hhbm5lbCkge1xuICAgICAgICBzdGF0ZS5ib3RNb2RhbCA9IHtcbiAgICAgICAgICAgIG1vZGU6IG1vZGUsXG4gICAgICAgICAgICBib3Q6IGJvdCxcbiAgICAgICAgICAgIGNoYW5uZWw6IG1vZGUgPT09ICdlZGl0JyAmJiBib3QgPyAoYm90LmNoYW5uZWwgfHwgJ3RlbGVncmFtJykgOiAoY2hhbm5lbCA9PT0gJ21heCcgPyAnbWF4JyA6ICd0ZWxlZ3JhbScpLFxuICAgICAgICAgICAgZHJhZnRJZDogMCxcbiAgICAgICAgICAgIHNhdmVkOiBmYWxzZSxcbiAgICAgICAgICAgIHRva2VuQ2hhbmdlZDogZmFsc2UsXG4gICAgICAgICAgICBidXN5OiBmYWxzZVxuICAgICAgICB9O1xuICAgICAgICAkKCcjbWgtYm90LWNoZWNrLW1lc3NhZ2UnKS5lbXB0eSgpO1xuICAgICAgICAkKCcjbWgtYm90LXRpdGxlLWZpZWxkJykucmVtb3ZlQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4tcm93JykucmVtb3ZlQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICQoJyNtaC1ib3QtbW9kYWwtdGl0bGUnKS50ZXh0KG1vZGUgPT09ICdlZGl0JyA/IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RFZGl0VGl0bGUnLCB7IHRpdGxlOiBib3QudGl0bGUgfSkgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RBZGRUaXRsZScpKTtcbiAgICAgICAgJCgnI21oLWJvdC10aXRsZScpLnZhbChib3QgPyBib3QudGl0bGUgOiAnJyk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4nKS52YWwoJycpO1xuICAgICAgICAkKCcjbWgtYm90LXRva2VuLW5ldycpLnZhbCgnJyk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4tbmV3LXJvdycpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAkKCcjbWgtYm90LWRlbGV0ZScpLmF0dHIoJ2hpZGRlbicsIG1vZGUgPT09ICdlZGl0JyA/IG51bGwgOiB0cnVlKTtcbiAgICAgICAgJCgnI21oLWJvdC1zYXZlJykudGV4dChtb2RlID09PSAnZWRpdCcgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTYXZlJykgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTYXZlQW5kQ29ubmVjdCcpKTtcbiAgICAgICAgaWYgKG1vZGUgPT09ICdlZGl0Jykge1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1yb3cnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4taGludC1yb3cnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4taGludCcpLnRleHQoJ1x1MjAyMlx1MjAyMlx1MjAyMlx1MjAyMicgKyAoYm90LnRva2VuX2hpbnQgfHwgJycpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4tcm93JykucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRva2VuLWhpbnQtcm93JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgIH1cbiAgICAgICAgc3luY0JvdENoYW5uZWwoKTtcbiAgICAgICAgJCgnI21oLWJvdC1tb2RhbCcpLm1vZGFsKHsgY2xvc2FibGU6IGZhbHNlIH0pLm1vZGFsKCdzaG93Jyk7XG4gICAgICAgICQoJyNtaC1ib3QtdGl0bGUnKS50cmlnZ2VyKCdmb2N1cycpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHN5bmNCb3RDaGFubmVsKCkge1xuICAgICAgICB2YXIgbW9kYWwgPSBzdGF0ZS5ib3RNb2RhbDtcbiAgICAgICAgaWYgKCFtb2RhbCkgeyByZXR1cm47IH1cbiAgICAgICAgJCgnI21oLWJvdC1tb2RhbCAubWgtY2hhbm5lbC1jYXJkJykuZWFjaChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgY2hhbm5lbCA9IFN0cmluZygkKHRoaXMpLmRhdGEoJ2NoYW5uZWwnKSk7XG4gICAgICAgICAgICB2YXIgc2VsZWN0ZWQgPSBjaGFubmVsID09PSBtb2RhbC5jaGFubmVsO1xuICAgICAgICAgICAgdmFyIGxvY2tlZCA9IG1vZGFsLm1vZGUgPT09ICdlZGl0JyAmJiAhc2VsZWN0ZWQ7XG4gICAgICAgICAgICAkKHRoaXMpLnRvZ2dsZUNsYXNzKCdpcy1zZWxlY3RlZCcsIHNlbGVjdGVkKS50b2dnbGVDbGFzcygnaXMtZGlzYWJsZWQnLCBsb2NrZWQpXG4gICAgICAgICAgICAgICAgLmF0dHIoJ2FyaWEtZGlzYWJsZWQnLCBsb2NrZWQgPyAndHJ1ZScgOiBudWxsKTtcbiAgICAgICAgICAgICQodGhpcykuZmluZCgnaW5wdXQnKS5wcm9wKCdjaGVja2VkJywgc2VsZWN0ZWQpLnByb3AoJ2Rpc2FibGVkJywgbG9ja2VkKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHZhciBzYXZhYmxlID0gU0FWQUJMRV9DSEFOTkVMUy5pbmRleE9mKG1vZGFsLmNoYW5uZWwpID49IDA7XG4gICAgICAgICQoJyNtaC1ib3Qtc2F2ZSwgI21oLWJvdC1jaGVjaycpLnByb3AoJ2Rpc2FibGVkJywgIXNhdmFibGUpLnRvZ2dsZUNsYXNzKCdkaXNhYmxlZCcsICFzYXZhYmxlKTtcbiAgICAgICAgLy8gYSBNQVggdG9rZW4gY29tZXMgZnJvbSBidXNpbmVzcy5tYXgucnUgYWZ0ZXIgbW9kZXJhdGlvbjsgVGVsZWdyYW0gbmVlZHMgbm8gZXhwbGFuYXRpb25cbiAgICAgICAgdmFyIG1heEhlbHAgPSBtb2RhbC5jaGFubmVsID09PSAnbWF4JztcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbi1oZWxwJykudGV4dChtYXhIZWxwID8gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90VG9rZW5IZWxwTWF4JykgOiAnJyk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4taGVscC1yb3cnKS5hdHRyKCdoaWRkZW4nLCBtYXhIZWxwID8gbnVsbCA6IHRydWUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGlzTWF4VGxzQ29kZShjb2RlKSB7XG4gICAgICAgIHJldHVybiBTdHJpbmcoY29kZSB8fCAnJykuaW5kZXhPZignbWF4LnRscy4nKSA9PT0gMDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB0bHNFcnJvclRleHQoKSB7XG4gICAgICAgIHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTdGF0dXNDYUVycm9yJykgKyAnLiAnICsgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2FFcnJvckhpbnQnKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBib3RGb3JtVmFsdWVzKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdGl0bGU6IFN0cmluZygkKCcjbWgtYm90LXRpdGxlJykudmFsKCkgfHwgJycpLnRyaW0oKSxcbiAgICAgICAgICAgIHRva2VuOiBTdHJpbmcoJCgnI21oLWJvdC10b2tlbicpLnZhbCgpIHx8ICcnKS50cmltKCksXG4gICAgICAgICAgICB0b2tlbk5ldzogU3RyaW5nKCQoJyNtaC1ib3QtdG9rZW4tbmV3JykudmFsKCkgfHwgJycpLnRyaW0oKVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNob3dCb3RNZXNzYWdlKGtpbmQsIHRleHQpIHtcbiAgICAgICAgdmFyIGNscyA9IGtpbmQgPT09ICdvaycgPyAndWkgcG9zaXRpdmUgbWVzc2FnZScgOiAoa2luZCA9PT0gJ3dhcm4nID8gJ3VpIHdhcm5pbmcgbWVzc2FnZScgOiAndWkgbmVnYXRpdmUgbWVzc2FnZScpO1xuICAgICAgICB2YXIgaWNvbiA9IGtpbmQgPT09ICdvaydcbiAgICAgICAgICAgID8gJzxjaXJjbGUgY3g9XCI4XCIgY3k9XCI4XCIgcj1cIjYuMjVcIi8+PHBhdGggZD1cIk01LjUgOC4ybDEuOCAxLjggMy4zLTMuNlwiLz4nXG4gICAgICAgICAgICA6ICc8Y2lyY2xlIGN4PVwiOFwiIGN5PVwiOFwiIHI9XCI2LjI1XCIvPjxwYXRoIGQ9XCJNNiA2bDQgNE0xMCA2bC00IDRcIi8+JztcbiAgICAgICAgJCgnI21oLWJvdC1jaGVjay1tZXNzYWdlJykuaHRtbCgnPGRpdiBjbGFzcz1cIicgKyBjbHMgKyAnXCIgcm9sZT1cInN0YXR1c1wiPidcbiAgICAgICAgICAgICsgJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPicgKyBpY29uICsgJzwvc3ZnPidcbiAgICAgICAgICAgICsgJzxkaXY+JyArIGVzYyh0ZXh0KSArICc8L2Rpdj48L2Rpdj4nKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBib3RDaGVja01lc3NhZ2UoYm90KSB7XG4gICAgICAgIGlmIChib3Quc3RhdHVzID09PSAnb2snKSB7XG4gICAgICAgICAgICByZXR1cm4geyBraW5kOiAnb2snLCB0ZXh0OiB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZE9rJywge1xuICAgICAgICAgICAgICAgIHVzZXJuYW1lOiBib3QuYm90X3VzZXJuYW1lIHx8IGJvdC5ib3RfZXh0ZXJuYWxfaWQsXG4gICAgICAgICAgICAgICAgbmFtZTogYm90LmJvdF91c2VybmFtZSA/ICdAJyArIGJvdC5ib3RfdXNlcm5hbWUgOiBib3QudGl0bGVcbiAgICAgICAgICAgIH0pIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5sYXN0X2Vycm9yX2NvZGUgPT09ICdvdGhlcl9ib3QnKSB7XG4gICAgICAgICAgICByZXR1cm4geyBraW5kOiAnd2FybicsIHRleHQ6IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkT3RoZXInLCB7XG4gICAgICAgICAgICAgICAgdXNlcm5hbWU6IGJvdC5ib3RfdXNlcm5hbWUgfHwgJycsXG4gICAgICAgICAgICAgICAgYm90OiBib3QudGl0bGVcbiAgICAgICAgICAgIH0pIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICd0b2tlbl9pbnZhbGlkJykge1xuICAgICAgICAgICAgcmV0dXJuIHsga2luZDogJ2VycicsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrZWQ0MDEnKSB9O1xuICAgICAgICB9XG4gICAgICAgIGlmIChib3Quc3RhdHVzID09PSAnY2FfZXJyb3InIHx8IGlzTWF4VGxzQ29kZShib3QubGFzdF9lcnJvcl9jb2RlKSkge1xuICAgICAgICAgICAgcmV0dXJuIHsga2luZDogJ2VycicsIHRleHQ6IHRsc0Vycm9yVGV4dCgpIH07XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHsga2luZDogJ3dhcm4nLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja05ldHdvcmsnKSArIChib3QubGFzdF9lcnJvcl9jb2RlID8gJyAoJyArIGJvdC5sYXN0X2Vycm9yX2NvZGUgKyAnKScgOiAnJykgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjaGVja0JvdEZvcm0oKSB7XG4gICAgICAgIGlmICghc3RhdGUuYm90TW9kYWwgfHwgU0FWQUJMRV9DSEFOTkVMUy5pbmRleE9mKHN0YXRlLmJvdE1vZGFsLmNoYW5uZWwpIDwgMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciB2YWx1ZXMgPSBib3RGb3JtVmFsdWVzKCk7XG4gICAgICAgIGlmICh2YWx1ZXMudGl0bGUgPT09ICcnKSB7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRpdGxlLWZpZWxkJykuYWRkQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90VGl0bGVSZXF1aXJlZCcpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtYm90LXRpdGxlLWZpZWxkJykucmVtb3ZlQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgIHZhciBtb2RlID0gc3RhdGUuYm90TW9kYWwubW9kZTtcbiAgICAgICAgdmFyIHBheWxvYWQ7XG4gICAgICAgIHZhciBkb25lID0gZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgc3RhdGUuYm90TW9kYWwuYm90ID0gYm90O1xuICAgICAgICAgICAgc3RhdGUuYm90TW9kYWwuZHJhZnRJZCA9IGJvdC5pZDtcbiAgICAgICAgICAgIHJlcGxhY2VCb3QoYm90KTtcbiAgICAgICAgICAgIHZhciBtZXNzYWdlID0gYm90Q2hlY2tNZXNzYWdlKGJvdCk7XG4gICAgICAgICAgICBzaG93Qm90TWVzc2FnZShtZXNzYWdlLmtpbmQsIG1lc3NhZ2UudGV4dCk7XG4gICAgICAgIH07XG4gICAgICAgIHZhciBmYWlsdXJlID0gZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgaWYgKGVyci5maWVsZCA9PT0gJ3Rva2VuJykge1xuICAgICAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4tcm93JykuYWRkQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgZmFpbHVyZVRleHQoZXJyKSk7XG4gICAgICAgIH07XG4gICAgICAgIGlmIChtb2RlID09PSAnYWRkJykge1xuICAgICAgICAgICAgcGF5bG9hZCA9IHsgY2hhbm5lbDogc3RhdGUuYm90TW9kYWwuY2hhbm5lbCwgdGl0bGU6IHZhbHVlcy50aXRsZSwgdG9rZW46IHZhbHVlcy50b2tlbiB9O1xuICAgICAgICAgICAgaWYgKHN0YXRlLmJvdE1vZGFsLmRyYWZ0SWQgPiAwKSB7XG4gICAgICAgICAgICAgICAgYXBpUGF0Y2goJy9ib3RzLycgKyBzdGF0ZS5ib3RNb2RhbC5kcmFmdElkLCB7IHRpdGxlOiB2YWx1ZXMudGl0bGUsIHRva2VuOiB2YWx1ZXMudG9rZW4gfSwgZG9uZSwgZmFpbHVyZSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGFwaVBvc3QoJy9ib3RzJywgcGF5bG9hZCwgZG9uZSwgZmFpbHVyZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHZhbHVlcy50b2tlbk5ldyAhPT0gJycpIHtcbiAgICAgICAgICAgIGFwaVBvc3QoJy9ib3RzLycgKyBzdGF0ZS5ib3RNb2RhbC5ib3QuaWQgKyAnOmNoZWNrVG9rZW4nLCB7IHRva2VuOiB2YWx1ZXMudG9rZW5OZXcgfSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgICAgICBpZiAoZGF0YS5vaykge1xuICAgICAgICAgICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnb2snLCB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZE9rJywge1xuICAgICAgICAgICAgICAgICAgICAgICAgdXNlcm5hbWU6IGRhdGEudXNlcm5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBkYXRhLmRpc3BsYXlfbmFtZVxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChkYXRhLmVycm9yX2NvZGUgPT09ICdvdGhlcl9ib3QnKSB7XG4gICAgICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCd3YXJuJywgdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrZWRPdGhlcicsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHVzZXJuYW1lOiBkYXRhLnVzZXJuYW1lIHx8ICcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgYm90OiBzdGF0ZS5ib3RNb2RhbC5ib3QudGl0bGVcbiAgICAgICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoZGF0YS5lcnJvcl9jb2RlID09PSAndGVsZWdyYW0uNDAxLnVuYXV0aG9yaXplZCcgfHwgZGF0YS5lcnJvcl9jb2RlID09PSAnbWF4LjQwMS51bmF1dGhvcml6ZWQnKSB7XG4gICAgICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkNDAxJykpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoaXNNYXhUbHNDb2RlKGRhdGEuZXJyb3JfY29kZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgc2hvd0JvdE1lc3NhZ2UoJ2VycicsIHRsc0Vycm9yVGV4dCgpKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnd2FybicsIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrTmV0d29yaycpICsgJyAoJyArIGRhdGEuZXJyb3JfY29kZSArICcpJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgZmFpbHVyZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIHN0YXRlLmJvdE1vZGFsLmJvdC5pZCArICc6Y2hlY2tUb2tlbicsIHt9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICBpZiAoZGF0YS5vaykge1xuICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdvaycsIHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkT2snLCB7XG4gICAgICAgICAgICAgICAgICAgIHVzZXJuYW1lOiBkYXRhLnVzZXJuYW1lLFxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBkYXRhLmRpc3BsYXlfbmFtZVxuICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoaXNNYXhUbHNDb2RlKGRhdGEuZXJyb3JfY29kZSkpIHtcbiAgICAgICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgdGxzRXJyb3JUZXh0KCkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZDQwMScpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSwgZmFpbHVyZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZUJvdEZvcm0oKSB7XG4gICAgICAgIGlmICghc3RhdGUuYm90TW9kYWwgfHwgU0FWQUJMRV9DSEFOTkVMUy5pbmRleE9mKHN0YXRlLmJvdE1vZGFsLmNoYW5uZWwpIDwgMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciB2YWx1ZXMgPSBib3RGb3JtVmFsdWVzKCk7XG4gICAgICAgIGlmICh2YWx1ZXMudGl0bGUgPT09ICcnKSB7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRpdGxlLWZpZWxkJykuYWRkQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90VGl0bGVSZXF1aXJlZCcpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB2YXIgbW9kZSA9IHN0YXRlLmJvdE1vZGFsLm1vZGU7XG4gICAgICAgIHZhciBmaW5pc2ggPSBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICBzdGF0ZS5ib3RNb2RhbC5zYXZlZCA9IHRydWU7XG4gICAgICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgICAgICAkKCcjbWgtYm90LW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICAgICAgaWYgKG1vZGUgPT09ICdhZGQnKSB7XG4gICAgICAgICAgICAgICAgb3BlbkNoYXRNb2RhbChib3QpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZWQnKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIHZhciBmYWlsdXJlID0gZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgaWYgKGVyci5maWVsZCA9PT0gJ3Rva2VuJykge1xuICAgICAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4tcm93JykuYWRkQ2xhc3MoJ2Vycm9yJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgZmFpbHVyZVRleHQoZXJyKSk7XG4gICAgICAgIH07XG4gICAgICAgIGlmIChtb2RlID09PSAnYWRkJykge1xuICAgICAgICAgICAgdmFyIGNyZWF0ZSA9IGZ1bmN0aW9uIChpZCkge1xuICAgICAgICAgICAgICAgIGFwaVBvc3QoJy9ib3RzLycgKyBpZCArICc6ZGlzY292ZXJDaGF0cycsIHt9LCBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICAgICAgICAgIGZpbmlzaChib3QpO1xuICAgICAgICAgICAgICAgIH0sIGZhaWx1cmUpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5ib3RNb2RhbC5kcmFmdElkID4gMCkge1xuICAgICAgICAgICAgICAgIGFwaVBhdGNoKCcvYm90cy8nICsgc3RhdGUuYm90TW9kYWwuZHJhZnRJZCwgeyB0aXRsZTogdmFsdWVzLnRpdGxlLCB0b2tlbjogdmFsdWVzLnRva2VuIH0sIGZ1bmN0aW9uIChib3QpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVwbGFjZUJvdChib3QpO1xuICAgICAgICAgICAgICAgICAgICBjcmVhdGUoYm90LmlkKTtcbiAgICAgICAgICAgICAgICB9LCBmYWlsdXJlKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgYXBpUG9zdCgnL2JvdHMnLCB7IGNoYW5uZWw6IHN0YXRlLmJvdE1vZGFsLmNoYW5uZWwsIHRpdGxlOiB2YWx1ZXMudGl0bGUsIHRva2VuOiB2YWx1ZXMudG9rZW4gfSwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgICAgICAgICAgICAgIGNyZWF0ZShib3QuaWQpO1xuICAgICAgICAgICAgICAgIH0sIGZhaWx1cmUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBwYXlsb2FkID0geyB0aXRsZTogdmFsdWVzLnRpdGxlIH07XG4gICAgICAgIGlmICh2YWx1ZXMudG9rZW5OZXcgIT09ICcnKSB7XG4gICAgICAgICAgICBwYXlsb2FkLnRva2VuID0gdmFsdWVzLnRva2VuTmV3O1xuICAgICAgICB9XG4gICAgICAgIGFwaVBhdGNoKCcvYm90cy8nICsgc3RhdGUuYm90TW9kYWwuYm90LmlkLCBwYXlsb2FkLCBmaW5pc2gsIGZhaWx1cmUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNhbmNlbEJvdE1vZGFsKCkge1xuICAgICAgICB2YXIgbW9kYWwgPSBzdGF0ZS5ib3RNb2RhbDtcbiAgICAgICAgc3RhdGUuYm90TW9kYWwgPSBudWxsO1xuICAgICAgICAkKCcjbWgtYm90LW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgaWYgKG1vZGFsICYmIG1vZGFsLmRyYWZ0SWQgPiAwICYmICFtb2RhbC5zYXZlZCkge1xuICAgICAgICAgICAgLy8gdGhlIFwiXHUwNDFmXHUwNDQwXHUwNDNlXHUwNDMyXHUwNDM1XHUwNDQwXHUwNDM4XHUwNDQyXHUwNDRjXCIgYnV0dG9uIGNyZWF0ZWQgdGhlIGRyYWZ0OiBjYW5jZWxsaW5nIG11c3Qgbm90IGxlYXZlIGl0IGJlaGluZFxuICAgICAgICAgICAgYXBpRGVsZXRlKCcvYm90cy8nICsgbW9kYWwuZHJhZnRJZCwgZnVuY3Rpb24gKCkgeyBsb2FkQm90cyh0cnVlKTsgfSwgZnVuY3Rpb24gKCkgeyBsb2FkQm90cyh0cnVlKTsgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNvbmZpcm1EZWxldGVCb3QoKSB7XG4gICAgICAgIHZhciBib3QgPSBzdGF0ZS5ib3RNb2RhbC5ib3Q7XG4gICAgICAgIGlmICghYm90KSB7IHJldHVybjsgfVxuICAgICAgICAkKCcjbWgtY29uZmlybS10ZXh0JykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90RGVsZXRlQ29uZmlybScsIHsgdGl0bGU6IGJvdC50aXRsZSwgY291bnQ6IChib3QuY2hhdHMgfHwgW10pLmxlbmd0aCB9KSk7XG4gICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsJykubW9kYWwoeyBjbG9zYWJsZTogdHJ1ZSB9KS5tb2RhbCgnc2hvdycpO1xuICAgICAgICAkKCcjbWgtY29uZmlybS1vaycpLm9mZignY2xpY2snKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtY29uZmlybS1tb2RhbCcpLm1vZGFsKCdoaWRlJyk7XG4gICAgICAgICAgICBhcGlEZWxldGUoJy9ib3RzLycgKyBib3QuaWQsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5ib3RNb2RhbC5zYXZlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgc3RhdGUuYm90TW9kYWwuZHJhZnRJZCA9IDA7XG4gICAgICAgICAgICAgICAgJCgnI21oLWJvdC1tb2RhbCcpLm1vZGFsKCdoaWRlJyk7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vbkRlbGV0ZWQnKSk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KGZhaWx1cmVUZXh0KGVycikpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gZGlzY292ZXJ5IG1vZGFsIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIG9wZW5DaGF0TW9kYWwoYm90KSB7XG4gICAgICAgIGlmICghYm90KSB7IHJldHVybjsgfVxuICAgICAgICBzdGF0ZS5jaGF0TW9kYWwgPSB7IGJvdElkOiBib3QuaWQsIGJvdDogYm90LCB0aW1lcjogbnVsbCwgc2VsZWN0ZWQ6IHt9IH07XG4gICAgICAgICQoJyNtaC1jaGF0LW1vZGFsLXRpdGxlJykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RUaXRsZScsIHsgdGl0bGU6IGJvdC50aXRsZSB9KSk7XG4gICAgICAgIHZhciBpc01heCA9IGJvdC5jaGFubmVsID09PSAnbWF4JztcbiAgICAgICAgJCgnI21oLWNoYXQtc3RlcHMnKS50ZXh0KHRmKGlzTWF4ID8gJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0U3RlcHNNYXgnIDogJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0U3RlcHMnLCB7XG4gICAgICAgICAgICBib3Q6IGJvdC5ib3RfdXNlcm5hbWUgPyAnQCcgKyBib3QuYm90X3VzZXJuYW1lIDogYm90LnRpdGxlXG4gICAgICAgIH0pKTtcbiAgICAgICAgJCgnI21oLWNoYXQtZm91bmQnKS5lbXB0eSgpO1xuICAgICAgICAkKCcjbWgtY2hhdC1lcnJvcicpLmVtcHR5KCk7XG4gICAgICAgICQoJyNtaC1jaGF0LWVtcHR5JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1jaGF0LWFnYWluJykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1jaGF0LXN0b3AnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgJCgnI21oLWNoYXQtc2F2ZScpLmF0dHIoJ2Rpc2FibGVkJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1jaGF0LXN0YXR1cy10ZXh0JykudGV4dCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdFNlYXJjaGluZycpKTtcbiAgICAgICAgJCgnI21oLWNoYXQtY291bnRkb3duJykudGV4dCgnJyk7XG4gICAgICAgICQoJyNtaC1jaGF0LXByb2dyZXNzIC5iYXInKS5jc3MoJ3dpZHRoJywgJzAlJyk7XG4gICAgICAgICQoJyNtaC1jaGF0LW1vZGFsJykubW9kYWwoeyBjbG9zYWJsZTogZmFsc2UgfSkubW9kYWwoJ3Nob3cnKTtcbiAgICAgICAgc3RhcnREaXNjb3ZlcnkoYm90LmlkLCBmYWxzZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3RhcnREaXNjb3ZlcnkoYm90SWQsIHJlc3RhcnQpIHtcbiAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIGJvdElkICsgJzpkaXNjb3ZlckNoYXRzJywgeyByZXN0YXJ0OiByZXN0YXJ0ID09PSB0cnVlIH0sIGZ1bmN0aW9uIChib3QpIHtcbiAgICAgICAgICAgIGlmICghc3RhdGUuY2hhdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkID0ge307XG4gICAgICAgICAgICB1cGRhdGVDaGF0TW9kYWwoYm90KTtcbiAgICAgICAgICAgIHNjaGVkdWxlQ2hhdFBvbGwoKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgc2hvd0NoYXRFcnJvcihmYWlsdXJlVGV4dChlcnIpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2NoZWR1bGVDaGF0UG9sbCgpIHtcbiAgICAgICAgc3RvcENoYXRQb2xsKCk7XG4gICAgICAgIHN0YXRlLmNoYXRNb2RhbC50aW1lciA9IHNldEludGVydmFsKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICghc3RhdGUuY2hhdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgYXBpR2V0KCcvYm90cy8nICsgc3RhdGUuY2hhdE1vZGFsLmJvdElkLCB7fSwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgICAgIGlmICghc3RhdGUuY2hhdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICAgIHVwZGF0ZUNoYXRNb2RhbChib3QpO1xuICAgICAgICAgICAgICAgIGlmICghYm90LmRpc2NvdmVyeS5hY3RpdmUpIHtcbiAgICAgICAgICAgICAgICAgICAgc3RvcENoYXRQb2xsKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKCkgeyAvKiBrZWVwIHRoZSBsYXN0IHN0YXRlICovIH0pO1xuICAgICAgICB9LCAyMDAwKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzdG9wQ2hhdFBvbGwoKSB7XG4gICAgICAgIGlmIChzdGF0ZS5jaGF0TW9kYWwgJiYgc3RhdGUuY2hhdE1vZGFsLnRpbWVyICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjbGVhckludGVydmFsKHN0YXRlLmNoYXRNb2RhbC50aW1lcik7XG4gICAgICAgICAgICBzdGF0ZS5jaGF0TW9kYWwudGltZXIgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdXBkYXRlQ2hhdE1vZGFsKGJvdCkge1xuICAgICAgICBpZiAoIXN0YXRlLmNoYXRNb2RhbCkgeyByZXR1cm47IH1cbiAgICAgICAgc3RhdGUuY2hhdE1vZGFsLmJvdCA9IGJvdDtcbiAgICAgICAgcmVwbGFjZUJvdChib3QpO1xuICAgICAgICB2YXIgZGlzY292ZXJ5ID0gYm90LmRpc2NvdmVyeSB8fCB7IGFjdGl2ZTogZmFsc2UsIHN0YXR1czogJ2lkbGUnLCBmb3VuZDogW10gfTtcbiAgICAgICAgdmFyIGZvdW5kID0gZGlzY292ZXJ5LmZvdW5kIHx8IFtdO1xuICAgICAgICB2YXIgc2VsZWN0ZWRDb3VudCA9IDA7XG4gICAgICAgIHZhciBodG1sID0gJyc7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZm91bmQubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBpdGVtID0gZm91bmRbaV07XG4gICAgICAgICAgICB2YXIgaW5Cb3QgPSBmaW5kQ2hhdEJ5RXh0ZXJuYWwoYm90LCBpdGVtLmNoYXRfaWQpO1xuICAgICAgICAgICAgaWYgKCFpdGVtLmFscmVhZHlfY29ubmVjdGVkICYmIHN0YXRlLmNoYXRNb2RhbC5zZWxlY3RlZFtpdGVtLmNoYXRfaWRdICE9PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIHN0YXRlLmNoYXRNb2RhbC5zZWxlY3RlZFtpdGVtLmNoYXRfaWRdID0gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBjaGVja2VkID0gIWl0ZW0uYWxyZWFkeV9jb25uZWN0ZWQgJiYgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkW2l0ZW0uY2hhdF9pZF0gPT09IHRydWU7XG4gICAgICAgICAgICBpZiAoY2hlY2tlZCkgeyBzZWxlY3RlZENvdW50Kys7IH1cbiAgICAgICAgICAgIGh0bWwgKz0gJzxsYWJlbCBjbGFzcz1cIm1oLWZvdW5kLXJvdycgKyAoaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCA/ICcgaXMtY29ubmVjdGVkJyA6ICcnKSArICdcIiBkYXRhLWNoYXQtcm93PVwiJyArIChpbkJvdCA/IGluQm90LmlkIDogMCkgKyAnXCIgZGF0YS1jaGF0LWtleT1cIicgKyBlc2MoaXRlbS5jaGF0X2lkKSArICdcIj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJ1aSBjaGVja2JveCcgKyAoY2hlY2tlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAoaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCA/ICcgZGlzYWJsZWQnIDogJycpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgY2xhc3M9XCJoaWRkZW4gbWgtZm91bmQtY2hlY2tcIicgKyAoY2hlY2tlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAoaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCA/ICcgZGlzYWJsZWQnIDogJycpICsgJz4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1ib3hcIj48L3NwYW4+PC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWZvdW5kLXRpdGxlXCI+PGIgY2xhc3M9XCJtaC10cnVuY2F0ZVwiPicgKyBlc2MoaXRlbS50aXRsZSB8fCBpdGVtLmNoYXRfaWQpICsgJzwvYj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tZXRhXCI+JyArIGVzYyhjaGF0S2luZExhYmVsKGl0ZW0uY2hhdF9raW5kKSkgKyAnPC9zcGFuPjwvc3Bhbj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJ1aSAnICsgKGl0ZW0uYWxyZWFkeV9jb25uZWN0ZWQgPyAnbGFiZWwnIDogJ2JsdWUgbGFiZWwnKSArICdcIj4nXG4gICAgICAgICAgICAgICAgKyBlc2MoaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0RXhpc3RzJykgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdE5ldycpKSArICc8L3NwYW4+PC9sYWJlbD4nO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC1jaGF0LWZvdW5kJykuaHRtbChodG1sKTtcbiAgICAgICAgJCgnI21oLWNoYXQtc2F2ZScpLnRleHQodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0U2F2ZScsIHsgY291bnQ6IHNlbGVjdGVkQ291bnQgfSkpO1xuICAgICAgICAkKCcjbWgtY2hhdC1zYXZlJykuYXR0cignZGlzYWJsZWQnLCBzZWxlY3RlZENvdW50ID09PSAwID8gdHJ1ZSA6IG51bGwpO1xuXG4gICAgICAgIHZhciBzdGF0dXNUZXh0ID0gJyc7XG4gICAgICAgIHZhciBjb3VudGRvd24gPSAnJztcbiAgICAgICAgdmFyIHByb2dyZXNzID0gMDtcbiAgICAgICAgaWYgKGRpc2NvdmVyeS5hY3RpdmUpIHtcbiAgICAgICAgICAgIGlmIChmb3VuZC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgc3RhdHVzVGV4dCA9IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdEZvdW5kJywgeyBjb3VudDogZm91bmQubGVuZ3RoIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNUZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RTZWFyY2hpbmcnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvdW50ZG93biA9IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdFJlbWFpbmluZycsIHsgdGltZTogZm10Q291bnRkb3duKGRpc2NvdmVyeS5yZW1haW5pbmdfc2VjKSB9KTtcbiAgICAgICAgICAgIHByb2dyZXNzID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBNYXRoLnJvdW5kKCgzMDAgLSBkaXNjb3ZlcnkucmVtYWluaW5nX3NlYykgLyAzMDAgKiAxMDApKSk7XG4gICAgICAgICAgICAkKCcjbWgtY2hhdC1lbXB0eScpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLWNoYXQtZXJyb3InKS5lbXB0eSgpO1xuICAgICAgICAgICAgJCgnI21oLWNoYXQtYWdhaW4nKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgICQoJyNtaC1jaGF0LXN0b3AnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICQoJyNtaC1jaGF0LXN0b3AnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgICQoJyNtaC1jaGF0LWFnYWluJykucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgICAgICBpZiAoZGlzY292ZXJ5LnN0YXR1cyA9PT0gJ2Vycm9yJykge1xuICAgICAgICAgICAgICAgIHZhciBjb2RlID0gU3RyaW5nKGRpc2NvdmVyeS5sYXN0X2Vycm9yX2NvZGUgfHwgJycpO1xuICAgICAgICAgICAgICAgIHZhciB0ZXh0O1xuICAgICAgICAgICAgICAgIGlmIChjb2RlID09PSAndGVsZWdyYW0uNDA5LndlYmhvb2tfc2V0Jykge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RFcnJvcldlYmhvb2snKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNvZGUgPT09ICdtYXguNDA1LndlYmhvb2tfc2V0Jykge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RFcnJvcldlYmhvb2tNYXgnKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGlzTWF4VGxzQ29kZShjb2RlKSkge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0ID0gdGxzRXJyb3JUZXh0KCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChjb2RlID09PSAnbWF4LjQwMS51bmF1dGhvcml6ZWQnIHx8IGNvZGUgPT09ICd0ZWxlZ3JhbS40MDEudW5hdXRob3JpemVkJykge1xuICAgICAgICAgICAgICAgICAgICB0ZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZDQwMScpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdEVycm9yJykgKyAnICgnICsgY29kZSArICcpJztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgc2hvd0NoYXRFcnJvcih0ZXh0KTtcbiAgICAgICAgICAgICAgICBzdGF0dXNUZXh0ID0gJyc7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGRpc2NvdmVyeS5zdGF0dXMgPT09ICdlbXB0eScpIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNUZXh0ID0gJyc7XG4gICAgICAgICAgICAgICAgJCgnI21oLWNoYXQtZW1wdHknKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZm91bmQubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIHN0YXR1c1RleHQgPSB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RUaW1lb3V0JywgeyBjb3VudDogZm91bmQubGVuZ3RoIH0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNUZXh0ID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3ROb1Nlc3Npb24nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvdW50ZG93biA9ICcnO1xuICAgICAgICAgICAgcHJvZ3Jlc3MgPSAxMDA7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLWNoYXQtc3RhdHVzLXRleHQnKS50ZXh0KHN0YXR1c1RleHQpO1xuICAgICAgICAkKCcjbWgtY2hhdC1jb3VudGRvd24nKS50ZXh0KGNvdW50ZG93bik7XG4gICAgICAgICQoJyNtaC1jaGF0LXByb2dyZXNzIC5iYXInKS5jc3MoJ3dpZHRoJywgcHJvZ3Jlc3MgKyAnJScpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZpbmRDaGF0QnlFeHRlcm5hbChib3QsIGNoYXRJZCkge1xuICAgICAgICB2YXIgY2hhdHMgPSBib3QuY2hhdHMgfHwgW107XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hhdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChTdHJpbmcoY2hhdHNbaV0uY2hhdF9pZCkgPT09IFN0cmluZyhjaGF0SWQpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNoYXRzW2ldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNob3dDaGF0RXJyb3IodGV4dCkge1xuICAgICAgICAkKCcjbWgtY2hhdC1lcnJvcicpLmh0bWwoJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlXCIgcm9sZT1cImFsZXJ0XCI+J1xuICAgICAgICAgICAgKyAnPHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+PGNpcmNsZSBjeD1cIjhcIiBjeT1cIjhcIiByPVwiNi4yNVwiLz48cGF0aCBkPVwiTTYgNmw0IDRNMTAgNmwtNCA0XCIvPjwvc3ZnPidcbiAgICAgICAgICAgICsgJzxkaXY+JyArIGVzYyh0ZXh0KSArICc8L2Rpdj48L2Rpdj4nKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBiaW5kQ2hhdEZvdW5kKCkge1xuICAgICAgICAkKCcjbWgtY2hhdC1mb3VuZCcpLm9uKCdjaGFuZ2UnLCAnLm1oLWZvdW5kLWNoZWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCFzdGF0ZS5jaGF0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIga2V5ID0gU3RyaW5nKCQodGhpcykuY2xvc2VzdCgnLm1oLWZvdW5kLXJvdycpLmRhdGEoJ2NoYXQta2V5JykpO1xuICAgICAgICAgICAgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkW2tleV0gPSAkKHRoaXMpLnByb3AoJ2NoZWNrZWQnKTtcbiAgICAgICAgICAgIHVwZGF0ZUNoYXRNb2RhbChzdGF0ZS5jaGF0TW9kYWwuYm90KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZVNlbGVjdGVkQ2hhdHMoKSB7XG4gICAgICAgIGlmICghc3RhdGUuY2hhdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICB2YXIgYm90ID0gc3RhdGUuY2hhdE1vZGFsLmJvdDtcbiAgICAgICAgdmFyIHBhdGNoZXMgPSBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCAoYm90LmRpc2NvdmVyeS5mb3VuZCB8fCBbXSkubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBpdGVtID0gYm90LmRpc2NvdmVyeS5mb3VuZFtpXTtcbiAgICAgICAgICAgIGlmIChpdGVtLmFscmVhZHlfY29ubmVjdGVkIHx8IHN0YXRlLmNoYXRNb2RhbC5zZWxlY3RlZFtpdGVtLmNoYXRfaWRdICE9PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgY2hhdCA9IGZpbmRDaGF0QnlFeHRlcm5hbChib3QsIGl0ZW0uY2hhdF9pZCk7XG4gICAgICAgICAgICBpZiAoY2hhdCkge1xuICAgICAgICAgICAgICAgIHBhdGNoZXMucHVzaCh7IGlkOiBjaGF0LmlkLCBlbmFibGVkOiB0cnVlLCBjaGF0X2tpbmQ6IGl0ZW0uY2hhdF9raW5kLCB0aXRsZTogaXRlbS50aXRsZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAocGF0Y2hlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhcGlQYXRjaCgnL2JvdHMvJyArIGJvdC5pZCwgeyBjaGF0czogcGF0Y2hlcyB9LCBmdW5jdGlvbiAoc2F2ZWQpIHtcbiAgICAgICAgICAgIGFwaVBvc3QoJy9ib3RzLycgKyBib3QuaWQgKyAnOmRpc2NvdmVyQ2hhdHMnLCB7IHN0b3A6IHRydWUgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGNsb3NlQ2hhdE1vZGFsKCk7XG4gICAgICAgICAgICAgICAgcmVwbGFjZUJvdChzYXZlZCk7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVkJykpO1xuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGNsb3NlQ2hhdE1vZGFsKCk7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVkJykpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgIHNob3dDaGF0RXJyb3IoZmFpbHVyZVRleHQoZXJyKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNsb3NlQ2hhdE1vZGFsKCkge1xuICAgICAgICBzdG9wQ2hhdFBvbGwoKTtcbiAgICAgICAgc3RhdGUuY2hhdE1vZGFsID0gbnVsbDtcbiAgICAgICAgJCgnI21oLWNoYXQtbW9kYWwnKS5tb2RhbCgnaGlkZScpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHN0b3BEaXNjb3ZlcnlBbmRDbG9zZSgpIHtcbiAgICAgICAgdmFyIGJvdCA9IHN0YXRlLmNoYXRNb2RhbCA/IHN0YXRlLmNoYXRNb2RhbC5ib3QgOiBudWxsO1xuICAgICAgICBpZiAoYm90KSB7XG4gICAgICAgICAgICBhcGlQb3N0KCcvYm90cy8nICsgYm90LmlkICsgJzpkaXNjb3ZlckNoYXRzJywgeyBzdG9wOiB0cnVlIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBjbG9zZUNoYXRNb2RhbCgpO1xuICAgICAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGNsb3NlQ2hhdE1vZGFsKCk7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNsb3NlQ2hhdE1vZGFsKCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIHRlc3QgbW9kYWwgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gb3BlblRlc3RNb2RhbChib3QsIGNoYXRJZHMpIHtcbiAgICAgICAgaWYgKCFib3QpIHsgcmV0dXJuOyB9XG4gICAgICAgIHN0YXRlLnRlc3RNb2RhbCA9IHsgYm90SWQ6IGJvdC5pZCwgYm90OiBib3QsIGV2ZW50SWQ6IDAsIGNoYXRJZHM6IGNoYXRJZHMsIHRpbWVyOiBudWxsLCB0cmllczogMCB9O1xuICAgICAgICAkKCcjbWgtdGVzdC1saXN0JykuaHRtbCgnPGRpdiBjbGFzcz1cIm1oLW11dGVkXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0UnVubmluZycpKSArICc8L2Rpdj4nKTtcbiAgICAgICAgJCgnI21oLXRlc3Qtc3VtbWFyeScpLnRleHQoJycpO1xuICAgICAgICAkKCcjbWgtdGVzdC1tb2RhbCcpLm1vZGFsKHsgY2xvc2FibGU6IHRydWUsIG9uSGlkZTogZnVuY3Rpb24gKCkgeyBzdG9wVGVzdFBvbGwoKTsgfSB9KS5tb2RhbCgnc2hvdycpO1xuICAgICAgICB2YXIgcGF5bG9hZCA9IGNoYXRJZHMgPT09IG51bGwgPyB7fSA6IHsgY2hhdF9pZHM6IGNoYXRJZHMgfTtcbiAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIGJvdC5pZCArICc6c2VuZFRlc3QnLCBwYXlsb2FkLCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgaWYgKCFzdGF0ZS50ZXN0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICBzdGF0ZS50ZXN0TW9kYWwuZXZlbnRJZCA9IGRhdGEuZXZlbnRfaWQ7XG4gICAgICAgICAgICBzdGF0ZS50ZXN0TW9kYWwuYm90ID0gZGF0YS5ib3Q7XG4gICAgICAgICAgICByZXBsYWNlQm90KGRhdGEuYm90KTtcbiAgICAgICAgICAgIHJlbmRlclRlc3QoZGF0YS5ib3QpO1xuICAgICAgICAgICAgc2NoZWR1bGVUZXN0UG9sbCgpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAkKCcjbWgtdGVzdC1saXN0JykuaHRtbCgnPGRpdiBjbGFzcz1cInVpIG5lZ2F0aXZlIG1lc3NhZ2VcIj48ZGl2PicgKyBlc2MoZmFpbHVyZVRleHQoZXJyKSkgKyAnPC9kaXY+PC9kaXY+Jyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNjaGVkdWxlVGVzdFBvbGwoKSB7XG4gICAgICAgIHN0b3BUZXN0UG9sbCgpO1xuICAgICAgICBzdGF0ZS50ZXN0TW9kYWwudGltZXIgPSBzZXRJbnRlcnZhbChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoIXN0YXRlLnRlc3RNb2RhbCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHN0YXRlLnRlc3RNb2RhbC50cmllcysrO1xuICAgICAgICAgICAgYXBpR2V0KCcvYm90cy8nICsgc3RhdGUudGVzdE1vZGFsLmJvdElkLCB7fSwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgICAgIGlmICghc3RhdGUudGVzdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICAgIHN0YXRlLnRlc3RNb2RhbC5ib3QgPSBib3Q7XG4gICAgICAgICAgICAgICAgcmVwbGFjZUJvdChib3QpO1xuICAgICAgICAgICAgICAgIHJlbmRlclRlc3QoYm90KTtcbiAgICAgICAgICAgICAgICBpZiAoIXRlc3RQZW5kaW5nKGJvdCkgfHwgc3RhdGUudGVzdE1vZGFsLnRyaWVzID4gMjApIHtcbiAgICAgICAgICAgICAgICAgICAgc3RvcFRlc3RQb2xsKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGlmIChzdGF0ZS50ZXN0TW9kYWwgJiYgc3RhdGUudGVzdE1vZGFsLnRyaWVzID4gMykge1xuICAgICAgICAgICAgICAgICAgICBzdG9wVGVzdFBvbGwoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSwgMjAwMCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3RvcFRlc3RQb2xsKCkge1xuICAgICAgICBpZiAoc3RhdGUudGVzdE1vZGFsICYmIHN0YXRlLnRlc3RNb2RhbC50aW1lciAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xlYXJJbnRlcnZhbChzdGF0ZS50ZXN0TW9kYWwudGltZXIpO1xuICAgICAgICAgICAgc3RhdGUudGVzdE1vZGFsLnRpbWVyID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIHRlc3REZWxpdmVyaWVzKGJvdCkge1xuICAgICAgICB2YXIgZXZlbnRJZCA9IHN0YXRlLnRlc3RNb2RhbCA/IHN0YXRlLnRlc3RNb2RhbC5ldmVudElkIDogMDtcbiAgICAgICAgdmFyIHJlc3VsdCA9IFtdO1xuICAgICAgICB2YXIgY2hhdHMgPSBib3QuY2hhdHMgfHwgW107XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hhdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBkZWxpdmVyeSA9IGNoYXRzW2ldLmxhc3RfZGVsaXZlcnk7XG4gICAgICAgICAgICBpZiAoZGVsaXZlcnkgJiYgTnVtYmVyKGRlbGl2ZXJ5LmV2ZW50X2lkKSA9PT0gTnVtYmVyKGV2ZW50SWQpKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0LnB1c2goeyBjaGF0OiBjaGF0c1tpXSwgZGVsaXZlcnk6IGRlbGl2ZXJ5IH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdGVzdFBlbmRpbmcoYm90KSB7XG4gICAgICAgIHZhciBsaXN0ID0gdGVzdERlbGl2ZXJpZXMoYm90KTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgc3RhdHVzID0gbGlzdFtpXS5kZWxpdmVyeS5zdGF0dXM7XG4gICAgICAgICAgICBpZiAoc3RhdHVzID09PSAncGVuZGluZycgfHwgc3RhdHVzID09PSAnc2VuZGluZycpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZGVsaXZlcnlTdGF0dXNMYWJlbChkZWxpdmVyeSkge1xuICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAnc2VudCcpIHsgcmV0dXJuIHsgY2xzOiAnaXMtb2snLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0RGVsaXZlcmVkJykgfTsgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAncGVuZGluZycgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnc2VuZGluZycpIHsgcmV0dXJuIHsgY2xzOiAnJywgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdFF1ZXVlZCcpIH07IH1cbiAgICAgICAgcmV0dXJuIHsgY2xzOiAnaXMtZXJyJywgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdEVycm9yJykgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZWxpdmVyeUVycm9yVGV4dChjb2RlKSB7XG4gICAgICAgIGlmIChpc01heFRsc0NvZGUoY29kZSkpIHsgcmV0dXJuIHRsc0Vycm9yVGV4dCgpOyB9XG4gICAgICAgIGlmIChjb2RlID09PSAndGVsZWdyYW0uNDAxLnVuYXV0aG9yaXplZCcgfHwgY29kZSA9PT0gJ21heC40MDEudW5hdXRob3JpemVkJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZDQwMScpOyB9XG4gICAgICAgIGlmIChjb2RlID09PSAndGVsZWdyYW0uNDAzLmtpY2tlZCcgfHwgY29kZSA9PT0gJ3RlbGVncmFtLjQwMy5ibG9ja2VkJyB8fCBjb2RlID09PSAndGVsZWdyYW0uNDAwLmNoYXRfbm90X2ZvdW5kJ1xuICAgICAgICAgICAgfHwgY29kZSA9PT0gJ21heC40MDMuY2hhdF9kZW5pZWQnIHx8IGNvZGUgPT09ICdtYXguNDA0Lm5vdF9mb3VuZCcgfHwgY29kZSA9PT0gJ21heC40MDQudW5rbm93bicpIHtcbiAgICAgICAgICAgIHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0U3RhdHVzR29uZScpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjb2RlID09PSAndGVsZWdyYW0uNDI5LnJhdGVfbGltaXQnIHx8IGNvZGUgPT09ICdtYXguNDI5LnJhdGVfbGltaXQnKSB7IHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0RXJyb3JSYXRlTGltaXQnKTsgfVxuICAgICAgICBpZiAoY29kZSA9PT0gJ3N0YWxlJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdEVycm9yU3RhbGUnKTsgfVxuICAgICAgICByZXR1cm4gY29kZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJUZXN0KGJvdCkge1xuICAgICAgICB2YXIgbGlzdCA9IHRlc3REZWxpdmVyaWVzKGJvdCk7XG4gICAgICAgIHZhciBjb3VudHMgPSB7IHNlbnQ6IDAsIHBlbmRpbmc6IDAsIGZhaWxlZDogMCB9O1xuICAgICAgICB2YXIgaHRtbCA9ICcnO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBjaGF0ID0gbGlzdFtpXS5jaGF0O1xuICAgICAgICAgICAgdmFyIGRlbGl2ZXJ5ID0gbGlzdFtpXS5kZWxpdmVyeTtcbiAgICAgICAgICAgIHZhciBsYWJlbCA9IGRlbGl2ZXJ5U3RhdHVzTGFiZWwoZGVsaXZlcnkpO1xuICAgICAgICAgICAgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3NlbnQnKSB7IGNvdW50cy5zZW50Kys7IH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3BlbmRpbmcnIHx8IGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3NlbmRpbmcnKSB7IGNvdW50cy5wZW5kaW5nKys7IH1cbiAgICAgICAgICAgIGVsc2UgeyBjb3VudHMuZmFpbGVkKys7IH1cbiAgICAgICAgICAgIHZhciByZXRyeSA9IChkZWxpdmVyeS5zdGF0dXMgPT09ICdmYWlsZWQnIHx8IGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2Ryb3BwZWQnKVxuICAgICAgICAgICAgICAgID8gJzxidXR0b24gY2xhc3M9XCJ1aSBiYXNpYyBidXR0b24gbWgtdGVzdC1yZXRyeVwiIHR5cGU9XCJidXR0b25cIiBkYXRhLWNoYXQtaWQ9XCInICsgY2hhdC5pZCArICdcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3RSZXRyeScpKSArICc8L2J1dHRvbj4nXG4gICAgICAgICAgICAgICAgOiAnJztcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJtaC10ZXN0LXJvd1wiPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1lc3NlbmdlciAnICsgKGJvdC5jaGFubmVsID09PSAnbWF4JyA/ICdtYXgnIDogJ3RnJykgKyAnIHNcIiBhcmlhLWhpZGRlbj1cInRydWVcIj4nICsgKGJvdC5jaGFubmVsID09PSAnbWF4JyA/ICdNQVgnIDogJ1RHJykgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtdGVzdC10aXRsZVwiPjxkaXYgY2xhc3M9XCJtaC10cnVuY2F0ZVwiPicgKyBlc2MoY2hhdC50aXRsZSB8fCBjaGF0LmNoYXRfaWQpICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArIChkZWxpdmVyeS5sYXN0X2Vycm9yX2NvZGUgPyAnPGRpdiBjbGFzcz1cIm1oLW1ldGEgbWgtZXJyb3ItdGV4dFwiPicgKyBlc2MoZGVsaXZlcnlFcnJvclRleHQoZGVsaXZlcnkubGFzdF9lcnJvcl9jb2RlKSkgKyAnPC9kaXY+JyA6ICcnKVxuICAgICAgICAgICAgICAgICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXRlc3Qtc3RhdGUgJyArIGxhYmVsLmNscyArICdcIj4nICsgZXNjKGxhYmVsLnRleHQpICsgJzwvc3Bhbj4nICsgcmV0cnkgKyAnPC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoaHRtbCA9PT0gJycpIHtcbiAgICAgICAgICAgIGh0bWwgPSAnPGRpdiBjbGFzcz1cIm1oLW11dGVkXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0UnVubmluZycpKSArICc8L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC10ZXN0LWxpc3QnKS5odG1sKGh0bWwpO1xuICAgICAgICAkKCcjbWgtdGVzdC1zdW1tYXJ5JykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdFN1bW1hcnknLCB7XG4gICAgICAgICAgICBvazogY291bnRzLnNlbnQsXG4gICAgICAgICAgICBmYWlsZWQ6IGNvdW50cy5mYWlsZWQsXG4gICAgICAgICAgICBwZW5kaW5nOiBjb3VudHMucGVuZGluZ1xuICAgICAgICB9KSk7XG4gICAgICAgICQoJyNtaC10ZXN0LWxpc3QgLm1oLXRlc3QtcmV0cnknKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgY2hhdElkID0gTnVtYmVyKCQodGhpcykuZGF0YSgnY2hhdC1pZCcpKTtcbiAgICAgICAgICAgIG9wZW5UZXN0TW9kYWwoc3RhdGUudGVzdE1vZGFsID8gc3RhdGUudGVzdE1vZGFsLmJvdCA6IGJvdCwgW2NoYXRJZF0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGdlbmVyYWwgc2V0dGluZ3MgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gbG9hZEdlbmVyYWxTZXR0aW5ncygpIHtcbiAgICAgICAgYXBpR2V0KCcvc2V0dGluZ3MnLCB7fSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHN0YXRlLnJldGVudGlvbiA9IGRhdGEuZXZlbnRzX3JldGVudGlvbl9kYXlzO1xuICAgICAgICAgICAgc3RhdGUuc2V0dGluZ3MgPSBkYXRhO1xuICAgICAgICAgICAgJCgnI21oLXJldGVudGlvbi1pbnB1dCcpLnZhbChkYXRhLmV2ZW50c19yZXRlbnRpb25fZGF5cyk7XG4gICAgICAgICAgICAkKCcjbWgtcHVibGljLXVybC1pbnB1dCcpLnZhbChkYXRhLnBieF9wdWJsaWNfdXJsIHx8ICcnKTtcbiAgICAgICAgICAgICQoJyNtaC1wcm94eS1pbnB1dCcpLnZhbChkYXRhLnByb3h5X3VybCB8fCAnJyk7XG4gICAgICAgICAgICAkKCcjbWgtbWF4LWNhLWlucHV0JykudmFsKGRhdGEubWF4X2NhX2J1bmRsZV9wYXRoIHx8ICcnKTtcbiAgICAgICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLW1heC1jYS1maWVsZCcpO1xuICAgICAgICAgICAgJCgnI21oLW1hc2stZGVmYXVsdCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgZGF0YS5tYXNrX3Bob25lX2RlZmF1bHQgPT09IHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLW1hc2stZGVmYXVsdCBpbnB1dCcpLnByb3AoJ2NoZWNrZWQnLCBkYXRhLm1hc2tfcGhvbmVfZGVmYXVsdCA9PT0gdHJ1ZSk7XG4gICAgICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC1wdWJsaWMtdXJsLWZpZWxkJyk7XG4gICAgICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC1wcm94eS1maWVsZCcpO1xuICAgICAgICAgICAgY2xlYXJSZXRlbnRpb25FcnJvcigpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgbWFya1JldGVudGlvbkVycm9yKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25Mb2FkRXJyb3InLCB7XG4gICAgICAgICAgICAgICAgd2hhdDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfTG9hZFdoYXRTZXR0aW5ncycpLFxuICAgICAgICAgICAgICAgIGNvZGU6IGZhaWx1cmUuc3RhdHVzID4gMCA/IGZhaWx1cmUuc3RhdHVzIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uVGltZW91dCcpXG4gICAgICAgICAgICB9KSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVTZXR0aW5nKHBheWxvYWQsIGZpZWxkU2VsZWN0b3IsIHJldmVydCkge1xuICAgICAgICBhcGlQYXRjaCgnL3NldHRpbmdzJywgcGF5bG9hZCwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHN0YXRlLnNldHRpbmdzID0gZGF0YTtcbiAgICAgICAgICAgIGlmIChmaWVsZFNlbGVjdG9yKSB7IGNsZWFyRmllbGRFcnJvcihmaWVsZFNlbGVjdG9yKTsgfVxuICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVkJykpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgaWYgKGZpZWxkU2VsZWN0b3IpIHtcbiAgICAgICAgICAgICAgICBtYXJrRmllbGRFcnJvcihmaWVsZFNlbGVjdG9yLCBmYWlsdXJlVGV4dChmYWlsdXJlKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocmV2ZXJ0KSB7IHJldmVydCgpOyB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVQdWJsaWNVcmwoKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IFN0cmluZygkKCcjbWgtcHVibGljLXVybC1pbnB1dCcpLnZhbCgpIHx8ICcnKS50cmltKCk7XG4gICAgICAgIHZhciBwcmV2aW91cyA9IHN0YXRlLnNldHRpbmdzID8gc3RhdGUuc2V0dGluZ3MucGJ4X3B1YmxpY191cmwgOiAnJztcbiAgICAgICAgaWYgKHZhbHVlID09PSAnJykge1xuICAgICAgICAgICAgc2F2ZVNldHRpbmcoeyBwYnhfcHVibGljX3VybDogJycgfSwgJyNtaC1wdWJsaWMtdXJsLWZpZWxkJyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCEvXmh0dHBzPzpcXC9cXC9cXFMrJC9pLnRlc3QodmFsdWUpKSB7XG4gICAgICAgICAgICBtYXJrRmllbGRFcnJvcignI21oLXB1YmxpYy11cmwtZmllbGQnLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9TZXR0aW5nc1B1YmxpY1VybEludmFsaWQnKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgc2F2ZVNldHRpbmcoeyBwYnhfcHVibGljX3VybDogdmFsdWUgfSwgJyNtaC1wdWJsaWMtdXJsLWZpZWxkJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLXB1YmxpYy11cmwtaW5wdXQnKS52YWwocHJldmlvdXMpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlUHJveHkoKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IFN0cmluZygkKCcjbWgtcHJveHktaW5wdXQnKS52YWwoKSB8fCAnJykudHJpbSgpO1xuICAgICAgICB2YXIgcHJldmlvdXMgPSBzdGF0ZS5zZXR0aW5ncyA/IHN0YXRlLnNldHRpbmdzLnByb3h5X3VybCA6ICcnO1xuICAgICAgICBpZiAodmFsdWUgIT09ICcnICYmICEvXigoaHR0cHM/fHNvY2tzNWg/KTpcXC9cXC8pP1tBLVphLXowLTkuXFwtXSs6XFxkezEsNX0kLy50ZXN0KHZhbHVlKSkge1xuICAgICAgICAgICAgbWFya0ZpZWxkRXJyb3IoJyNtaC1wcm94eS1maWVsZCcsIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NldHRpbmdzUHJveHlJbnZhbGlkJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHNhdmVTZXR0aW5nKHsgcHJveHlfdXJsOiB2YWx1ZSB9LCAnI21oLXByb3h5LWZpZWxkJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLXByb3h5LWlucHV0JykudmFsKHByZXZpb3VzKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZU1heENhQnVuZGxlKCkge1xuICAgICAgICB2YXIgdmFsdWUgPSBTdHJpbmcoJCgnI21oLW1heC1jYS1pbnB1dCcpLnZhbCgpIHx8ICcnKS50cmltKCk7XG4gICAgICAgIHZhciBwcmV2aW91cyA9IHN0YXRlLnNldHRpbmdzID8gc3RhdGUuc2V0dGluZ3MubWF4X2NhX2J1bmRsZV9wYXRoIDogJyc7XG4gICAgICAgIGlmICh2YWx1ZSAhPT0gJycgJiYgdmFsdWUuY2hhckF0KDApICE9PSAnLycpIHtcbiAgICAgICAgICAgIG1hcmtGaWVsZEVycm9yKCcjbWgtbWF4LWNhLWZpZWxkJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU2V0dGluZ3NDYVBhdGhJbnZhbGlkJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHNhdmVTZXR0aW5nKHsgbWF4X2NhX2J1bmRsZV9wYXRoOiB2YWx1ZSB9LCAnI21oLW1heC1jYS1maWVsZCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1tYXgtY2EtaW5wdXQnKS52YWwocHJldmlvdXMpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlTWFza0RlZmF1bHQoKSB7XG4gICAgICAgIHZhciBjaGVja2VkID0gJCgnI21oLW1hc2stZGVmYXVsdCBpbnB1dCcpLnByb3AoJ2NoZWNrZWQnKTtcbiAgICAgICAgc2F2ZVNldHRpbmcoeyBtYXNrX3Bob25lX2RlZmF1bHQ6IGNoZWNrZWQgfSwgbnVsbCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLW1hc2stZGVmYXVsdCBpbnB1dCcpLnByb3AoJ2NoZWNrZWQnLCAhY2hlY2tlZCk7XG4gICAgICAgICAgICAkKCcjbWgtbWFzay1kZWZhdWx0JykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCAhY2hlY2tlZCk7XG4gICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZUZhaWxlZCcpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZm10Q291bnRkb3duKHNlY29uZHMpIHtcbiAgICAgICAgdmFyIHRvdGFsID0gTWF0aC5tYXgoMCwgcGFyc2VJbnQoc2Vjb25kcywgMTApIHx8IDApO1xuICAgICAgICByZXR1cm4gTWF0aC5mbG9vcih0b3RhbCAvIDYwKSArICc6JyArIHBhZCh0b3RhbCAlIDYwKTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIG5vdGlmaWNhdGlvbnM6IHJ1bGVzIEFQSSAmIGxpc3QgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gbG9hZFJ1bGVzKHNpbGVudCkge1xuICAgICAgICBpZiAoIXNpbGVudCkge1xuICAgICAgICAgICAgc3RhdGUucnVsZXNMb2FkZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIHJlbmRlclJ1bGVzU2tlbGV0b24oKTtcbiAgICAgICAgfVxuICAgICAgICBhcGlHZXQoJy9ydWxlcycsIHsgbGltaXQ6IDIwMCB9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgc3RhdGUucnVsZXMgPSBkYXRhLml0ZW1zIHx8IFtdO1xuICAgICAgICAgICAgc3RhdGUucnVsZXNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc3RhdGUucnVsZXNFcnJvciA9IG51bGw7XG4gICAgICAgICAgICByZW5kZXJSdWxlcygpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgc3RhdGUucnVsZXNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc3RhdGUucnVsZXNFcnJvciA9IGZhaWx1cmU7XG4gICAgICAgICAgICByZW5kZXJSdWxlcygpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJSdWxlc1NrZWxldG9uKCkge1xuICAgICAgICB2YXIgcm93ID0gJzxkaXYgY2xhc3M9XCJtaC1ub3RpZi1yb3dcIj48c3BhbiBjbGFzcz1cIm1oLXNrZWxcIiBzdHlsZT1cIndpZHRoOjM2cHg7aGVpZ2h0OjIwcHg7Ym9yZGVyLXJhZGl1czoxMHB4XCI+PC9zcGFuPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6NDAlXCI+PC9zcGFuPjxzcGFuPjwvc3Bhbj48c3Bhbj48L3NwYW4+PC9kaXY+JztcbiAgICAgICAgJCgnI21oLXJ1bGVzLWxpc3QnKS5odG1sKHJvdyArIHJvdyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc291cmNlRm9yUnVsZShydWxlKSB7XG4gICAgICAgIGlmIChydWxlLnNvdXJjZV9pZCkge1xuICAgICAgICAgICAgdmFyIGJ5SWQgPSBzb3VyY2VCeUlkKHJ1bGUuc291cmNlX2lkKTtcbiAgICAgICAgICAgIGlmIChieUlkKSB7IHJldHVybiBieUlkOyB9XG4gICAgICAgIH1cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5zb3VyY2VzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgdHlwZXMgPSBzdGF0ZS5zb3VyY2VzW2ldLmV2ZW50X3R5cGVzIHx8IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCB0eXBlcy5sZW5ndGg7IGorKykge1xuICAgICAgICAgICAgICAgIGlmIChydWxlLmV2ZW50X3R5cGVzICYmIHJ1bGUuZXZlbnRfdHlwZXMuaW5kZXhPZih0eXBlc1tqXS50eXBlKSA+PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBzdGF0ZS5zb3VyY2VzW2ldO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzZXRSdWxlQWRkVmlzaWJsZSh2aXNpYmxlKSB7XG4gICAgICAgICQoJyNtaC1ydWxlLWFkZCcpLmF0dHIoJ2hpZGRlbicsIHZpc2libGUgPyBudWxsIDogdHJ1ZSk7XG4gICAgfVxuXG4gICAgLy8gRGVzaWduIHYzLCBcdTAwYWJcdTA0MjNcdTA0MzJcdTA0MzVcdTA0MzRcdTA0M2VcdTA0M2NcdTA0M2JcdTA0MzVcdTA0M2RcdTA0MzhcdTA0NGZcdTAwYmI6IG5vIGJvdCBcdTIxOTIgcGljayBhIG1lc3NlbmdlcjsgYm90IGJ1dCBubyBub3RpZmljYXRpb25zIFx1MjE5MiBvbmUgcHJpbWFyeSBidXR0b247XG4gICAgLy8gb3RoZXJ3aXNlIHRoZSBsaXN0IGdyb3VwZWQgXHUwNDE3XHUwNDMyXHUwNDNlXHUwNDNkXHUwNDNhXHUwNDM4IFx1MjE5MiBcdTA0MThcdTA0MTggXHUwNDIxXHUwNDQzXHUwNDNmXHUwNDM1XHUwNDQwXHUwNDMyXHUwNDMwXHUwNDM5XHUwNDM3XHUwNDM1XHUwNDQwIFx1MjE5MiBcdTA0MTNcdTA0M2VcdTA0M2JcdTA0M2VcdTA0NDFcdTA0M2VcdTA0MzJcdTA0M2VcdTA0MzkgXHUwNDMwXHUwNDMzXHUwNDM1XHUwNDNkXHUwNDQyIFx1MjE5MiBcdTA0MjFcdTA0MzJcdTA0NGZcdTA0MzdcdTA0NGMgXHUwNDM4IFx1MDQxMFx1MDQyMlx1MDQyMSAoaGVhZGluZ3Mgb25seSBmb3IgMisgZ3JvdXBzKS5cbiAgICBmdW5jdGlvbiByZW5kZXJSdWxlcygpIHtcbiAgICAgICAgdmFyICRsaXN0ID0gJCgnI21oLXJ1bGVzLWxpc3QnKTtcbiAgICAgICAgaWYgKCFzdGF0ZS5ydWxlc0xvYWRlZCB8fCAhc3RhdGUuYm90c0xvYWRlZCkge1xuICAgICAgICAgICAgc2V0UnVsZUFkZFZpc2libGUoZmFsc2UpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmIChzdGF0ZS5ydWxlc0Vycm9yICE9PSBudWxsICYmIHN0YXRlLnJ1bGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgc2V0UnVsZUFkZFZpc2libGUoZmFsc2UpO1xuICAgICAgICAgICAgJGxpc3QuaHRtbCgnPGRpdiBjbGFzcz1cInVpIG5lZ2F0aXZlIG1lc3NhZ2VcIiByb2xlPVwiYWxlcnRcIj4nICsgSUNPTl9FUlJPUlxuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ncm93XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlc0xvYWRGYWlsZWQnKSkgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgJzxidXR0b24gY2xhc3M9XCJ1aSBiYXNpYyBidXR0b24gbWgtb24tbWVzc2FnZVwiIHR5cGU9XCJidXR0b25cIiBpZD1cIm1oLXJ1bGVzLXJldHJ5XCI+J1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblJldHJ5JykpICsgJzwvYnV0dG9uPjwvZGl2PicpO1xuICAgICAgICAgICAgJCgnI21oLXJ1bGVzLXJldHJ5Jykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkgeyBsb2FkUnVsZXMoKTsgfSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN0YXRlLmJvdHMubGVuZ3RoID09PSAwICYmIHN0YXRlLnJ1bGVzLmxlbmd0aCA9PT0gMCAmJiBzdGF0ZS5ib3RzRXJyb3IgPT09IG51bGwpIHtcbiAgICAgICAgICAgIHNldFJ1bGVBZGRWaXNpYmxlKGZhbHNlKTtcbiAgICAgICAgICAgICRsaXN0Lmh0bWwoJzxkaXYgY2xhc3M9XCJtaC1vbmJvYXJkXCIgcm9sZT1cInN0YXR1c1wiPidcbiAgICAgICAgICAgICAgICArICc8aDMgY2xhc3M9XCJ1aSBoZWFkZXIgbWgtcGFnZS10aXRsZVwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfT25ib2FyZFRpdGxlJykpICsgJzwvaDM+J1xuICAgICAgICAgICAgICAgICsgbWVzc2VuZ2VyVGlsZXMoKSArICc8L2Rpdj4nKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc3RhdGUucnVsZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBzZXRSdWxlQWRkVmlzaWJsZShmYWxzZSk7XG4gICAgICAgICAgICAkbGlzdC5odG1sKCc8ZGl2IGNsYXNzPVwibWgtZW1wdHkgbWgtZW1wdHktYm94XCIgcm9sZT1cInN0YXR1c1wiPidcbiAgICAgICAgICAgICAgICArICc8aDMgY2xhc3M9XCJ1aSBoZWFkZXIgbWgtcGFnZS10aXRsZVwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZXNFbXB0eVRpdGxlJykpICsgJzwvaDM+J1xuICAgICAgICAgICAgICAgICsgJzxidXR0b24gY2xhc3M9XCJ1aSBwcmltYXJ5IGJ1dHRvblwiIHR5cGU9XCJidXR0b25cIiBkYXRhLWFjdGlvbj1cImFkZFwiPicgKyBJQ09OX1BMVVNcbiAgICAgICAgICAgICAgICArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlc0FkZCcpKSArICc8L2J1dHRvbj48L2Rpdj4nKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBzZXRSdWxlQWRkVmlzaWJsZSh0cnVlKTtcbiAgICAgICAgdmFyIGdyb3VwcyA9IHt9O1xuICAgICAgICBzdGF0ZS5ydWxlcy5mb3JFYWNoKGZ1bmN0aW9uIChydWxlKSB7XG4gICAgICAgICAgICB2YXIgZ3JvdXAgPSBydWxlLmdyb3VwIHx8ICdwYngnO1xuICAgICAgICAgICAgaWYgKEdST1VQX09SREVSLmluZGV4T2YoZ3JvdXApIDwgMCkgeyBncm91cCA9ICdwYngnOyB9XG4gICAgICAgICAgICAoZ3JvdXBzW2dyb3VwXSA9IGdyb3Vwc1tncm91cF0gfHwgW10pLnB1c2gocnVsZSk7XG4gICAgICAgIH0pO1xuICAgICAgICB2YXIgb3JkZXIgPSBHUk9VUF9PUkRFUi5maWx0ZXIoZnVuY3Rpb24gKGdyb3VwKSB7IHJldHVybiBCb29sZWFuKGdyb3Vwc1tncm91cF0pOyB9KTtcbiAgICAgICAgdmFyIGh0bWwgPSAnJztcbiAgICAgICAgaWYgKHN0YXRlLnJ1bGVzRXJyb3IgIT09IG51bGwpIHtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlXCIgcm9sZT1cImFsZXJ0XCI+JyArIElDT05fRVJST1JcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtZ3Jvd1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZXNMb2FkRmFpbGVkJykpICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uIG1oLW9uLW1lc3NhZ2VcIiB0eXBlPVwiYnV0dG9uXCIgaWQ9XCJtaC1ydWxlcy1yZXRyeS1pbmxpbmVcIj4nXG4gICAgICAgICAgICAgICAgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uUmV0cnknKSkgKyAnPC9idXR0b24+PC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICB2YXIgc2hvd0hlYWRpbmdzID0gb3JkZXIubGVuZ3RoID4gMTtcbiAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIm1oLW5vdGlmLWxpc3QnICsgKHNob3dIZWFkaW5ncyA/ICcnIDogJyBpcy1mbGF0JykgKyAnXCIgcm9sZT1cImxpc3RcIj4nO1xuICAgICAgICBvcmRlci5mb3JFYWNoKGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgaWYgKHNob3dIZWFkaW5ncykge1xuICAgICAgICAgICAgICAgIGh0bWwgKz0gJzxoMyBjbGFzcz1cIm1oLWdyb3VwLXRpdGxlXCI+JyArIGVzYyhzb3VyY2VHcm91cE5hbWUoZ3JvdXApKSArICc8L2gzPic7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBncm91cHNbZ3JvdXBdLmZvckVhY2goZnVuY3Rpb24gKHJ1bGUpIHtcbiAgICAgICAgICAgICAgICBodG1sICs9IHJlbmRlclJ1bGVSb3cocnVsZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgICRsaXN0Lmh0bWwoaHRtbCArICc8L2Rpdj4nKTtcbiAgICAgICAgJCgnI21oLXJ1bGVzLXJldHJ5LWlubGluZScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHsgbG9hZFJ1bGVzKCk7IH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJ1bGVDaGFubmVsKHJ1bGUpIHtcbiAgICAgICAgdmFyIGNoYXRzID0gcnVsZS5jaGF0cyB8fCBbXTtcbiAgICAgICAgaWYgKGNoYXRzLmxlbmd0aCA+IDAgJiYgY2hhdHNbMF0uY2hhbm5lbCkge1xuICAgICAgICAgICAgcmV0dXJuIGNoYXRzWzBdLmNoYW5uZWw7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGJvdCA9IGNoYXRzLmxlbmd0aCA+IDAgPyBib3RCeUlkKGNoYXRzWzBdLmJvdF9pZCkgOiAoc3RhdGUuYm90c1swXSB8fCBudWxsKTtcbiAgICAgICAgcmV0dXJuIGJvdCAmJiBib3QuY2hhbm5lbCA9PT0gJ21heCcgPyAnbWF4JyA6ICd0ZWxlZ3JhbSc7XG4gICAgfVxuXG4gICAgLy8gQ29sb3VyIG9ubHkgZm9yIGEgcHJvYmxlbTogdW5hdmFpbGFibGUgc291cmNlLCByZWplY3RlZCB0b2tlbiwgZGVsZXRlZCBib3Qgb3IgY2hhdC5cbiAgICBmdW5jdGlvbiBydWxlUHJvYmxlbUxhYmVsKHJ1bGUpIHtcbiAgICAgICAgdmFyIHNvdXJjZSA9IHNvdXJjZUJ5SWQocnVsZS5zb3VyY2VfaWQpO1xuICAgICAgICBpZiAoc291cmNlICYmIHNvdXJjZS5hdmFpbGFiaWxpdHkgJiYgc291cmNlLmF2YWlsYWJpbGl0eSAhPT0gJ2F2YWlsYWJsZScpIHtcbiAgICAgICAgICAgIHZhciBsYWJlbHMgPSB7XG4gICAgICAgICAgICAgICAgbW9kdWxlX2Rpc2FibGVkOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Tb3VyY2VTdGF0ZU1vZG9mZicpLFxuICAgICAgICAgICAgICAgIG1vZHVsZV9taXNzaW5nOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Tb3VyY2VTdGF0ZU5vaW5zdCcpLFxuICAgICAgICAgICAgICAgIGFwaV9mb3JiaWRkZW46IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX05vdGlmU291cmNlTm9BY2Nlc3MnKSxcbiAgICAgICAgICAgICAgICBkaXNhYmxlZDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU291cmNlU3RhdGVPZmYnKSxcbiAgICAgICAgICAgICAgICBlcnJvcjogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU291cmNlU3RhdGVFcnInKVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGlmIChsYWJlbHNbc291cmNlLmF2YWlsYWJpbGl0eV0pIHtcbiAgICAgICAgICAgICAgICB2YXIgY2xzID0gKHNvdXJjZS5hdmFpbGFiaWxpdHkgPT09ICdtb2R1bGVfZGlzYWJsZWQnIHx8IHNvdXJjZS5hdmFpbGFiaWxpdHkgPT09ICdkaXNhYmxlZCcpID8gJ3VpIHllbGxvdyBsYWJlbCcgOiAndWkgcmVkIGxhYmVsJztcbiAgICAgICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwiJyArIGNscyArICdcIj4nICsgZXNjKGxhYmVsc1tzb3VyY2UuYXZhaWxhYmlsaXR5XSkgKyAnPC9zcGFuPic7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGNoYXRzID0gcnVsZS5jaGF0cyB8fCBbXTtcbiAgICAgICAgaWYgKChydWxlLmNoYXRfaWRzIHx8IFtdKS5sZW5ndGggPiBjaGF0cy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgSUNPTl9FUlJPUiArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeUJvdERlbGV0ZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGF0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGJvdCA9IGJvdEJ5SWQoY2hhdHNbaV0uYm90X2lkKTtcbiAgICAgICAgICAgIGlmIChib3QgJiYgYm90LmVuYWJsZWQgIT09IGZhbHNlICYmIGJvdC5zdGF0dXMgPT09ICd0b2tlbl9pbnZhbGlkJykge1xuICAgICAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgSUNPTl9FUlJPUiArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTdGF0dXNUb2tlbkludmFsaWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoYXRzLmxlbmd0aCA+IDAgJiYgY2hhdHMuZXZlcnkoZnVuY3Rpb24gKGNoYXQpIHsgcmV0dXJuIGNoYXQuc3RhdGUgPT09ICdnb25lJzsgfSkpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgSUNPTl9FUlJPUiArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0U3RhdHVzR29uZScpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJSdWxlUm93KHJ1bGUpIHtcbiAgICAgICAgdmFyIHByb2JsZW0gPSBydWxlUHJvYmxlbUxhYmVsKHJ1bGUpO1xuICAgICAgICB2YXIgcnVsZUZpcnN0ID0gc3RhdGUucnVsZXMubGVuZ3RoID4gMCAmJiBOdW1iZXIoc3RhdGUucnVsZXNbMF0uaWQpID09PSBOdW1iZXIocnVsZS5pZCk7XG4gICAgICAgIHZhciBydWxlTGFzdCA9IHN0YXRlLnJ1bGVzLmxlbmd0aCA+IDBcbiAgICAgICAgICAgICYmIE51bWJlcihzdGF0ZS5ydWxlc1tzdGF0ZS5ydWxlcy5sZW5ndGggLSAxXS5pZCkgPT09IE51bWJlcihydWxlLmlkKTtcbiAgICAgICAgdmFyIHJpZ2h0ID0gJyc7XG4gICAgICAgIGlmIChwcm9ibGVtICE9PSBudWxsKSB7XG4gICAgICAgICAgICByaWdodCA9IHByb2JsZW07XG4gICAgICAgIH0gZWxzZSBpZiAocnVsZS5lbmFibGVkICYmIHJ1bGUubGFzdF9ldmVudF9hdCkge1xuICAgICAgICAgICAgcmlnaHQgPSAnPHNwYW4gY2xhc3M9XCJtaC1tdXRlZFwiPicgKyBmbXRDZWxsVGltZShydWxlLmxhc3RfZXZlbnRfYXQpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIHZhciBjaGFubmVsID0gcnVsZUNoYW5uZWwocnVsZSk7XG5cbiAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwibWgtbm90aWYtcm93JyArIChydWxlLmVuYWJsZWQgPyAnJyA6ICcgaXMtb2ZmJykgKyAnXCIgcm9sZT1cImxpc3RpdGVtXCIgZGF0YS1ydWxlLWlkPVwiJyArIHJ1bGUuaWQgKyAnXCI+J1xuICAgICAgICAgICAgKyAnPGxhYmVsIGNsYXNzPVwidWkgdG9nZ2xlIGNoZWNrYm94JyArIChydWxlLmVuYWJsZWQgPyAnIGNoZWNrZWQnIDogJycpICsgJ1wiIGFyaWEtbGFiZWw9XCInICsgZXNjKHJ1bGUudGl0bGUpICsgJ1wiPidcbiAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjbGFzcz1cImhpZGRlbiBtaC1ydWxlLXRvZ2dsZVwiJyArIChydWxlLmVuYWJsZWQgPyAnIGNoZWNrZWQnIDogJycpICsgJz4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXRyYWNrXCI+PC9zcGFuPjwvbGFiZWw+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1ub3RpZi1tYWluXCI+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tZXNzZW5nZXIgcyAnICsgKGNoYW5uZWwgPT09ICdtYXgnID8gJ21heCcgOiAndGcnKSArICdcIiByb2xlPVwiaW1nXCIgYXJpYS1sYWJlbD1cIicgKyAoY2hhbm5lbCA9PT0gJ21heCcgPyAnTUFYJyA6ICdUZWxlZ3JhbScpICsgJ1wiPidcbiAgICAgICAgICAgICsgKGNoYW5uZWwgPT09ICdtYXgnID8gJ01BWCcgOiAnVEcnKSArICc8L3NwYW4+J1xuICAgICAgICAgICAgKyAnPGEgaHJlZj1cIiNcIiBjbGFzcz1cIm1oLW5vdGlmLXRpdGxlIG1oLXRydW5jYXRlXCIgZGF0YS1hY3Rpb249XCJlZGl0XCI+JyArIGVzYyhydWxlLnRpdGxlKSArICc8L2E+PC9zcGFuPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbm90aWYtc3RhdHVzXCI+JyArIHJpZ2h0ICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtcnVsZS1tZW51LXdyYXBcIj4nXG4gICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgdGV4dCBidXR0b24gbWgtcnVsZS1tZW51LWJ0blwiIHR5cGU9XCJidXR0b25cIiBkYXRhLWFjdGlvbj1cIm1lbnVcIiBhcmlhLWxhYmVsPVwiJyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlTWVudU1vcmUnKSkgKyAnXCIgYXJpYS1leHBhbmRlZD1cImZhbHNlXCI+J1xuICAgICAgICAgICAgKyAnPHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+PHBhdGggZD1cIk0zLjUgOGguMDFNOCA4aC4wMU0xMi41IDhoLjAxXCIgc3Ryb2tlLXdpZHRoPVwiMi40XCIvPjwvc3ZnPjwvYnV0dG9uPidcbiAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ydWxlLW1lbnVcIiBoaWRkZW4+J1xuICAgICAgICAgICAgKyAnPGEgaHJlZj1cIiNcIiBkYXRhLWFjdGlvbj1cImVkaXRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVNZW51RWRpdCcpKSArICc8L2E+J1xuICAgICAgICAgICAgKyAocnVsZUZpcnN0ID8gJycgOiAnPGEgaHJlZj1cIiNcIiBkYXRhLWFjdGlvbj1cInVwXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlTWVudVVwJykpICsgJzwvYT4nKVxuICAgICAgICAgICAgKyAocnVsZUxhc3QgPyAnJyA6ICc8YSBocmVmPVwiI1wiIGRhdGEtYWN0aW9uPVwiZG93blwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZU1lbnVEb3duJykpICsgJzwvYT4nKVxuICAgICAgICAgICAgKyAnPGEgaHJlZj1cIiNcIiBkYXRhLWFjdGlvbj1cImRlbGV0ZVwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZU1lbnVEZWxldGUnKSkgKyAnPC9hPidcbiAgICAgICAgICAgICsgJzwvZGl2PjwvZGl2PjwvZGl2Pic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYmluZFJ1bGVzQ29udGFpbmVyKCkge1xuICAgICAgICB2YXIgJHdyYXAgPSAkKCcjbWgtcnVsZXMtbGlzdCcpO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiYWRkXCJdJywgZnVuY3Rpb24gKCkgeyBvcGVuUnVsZVdpemFyZChudWxsKTsgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJhZGQtYm90XCJdJywgZnVuY3Rpb24gKCkgeyBvcGVuQm90TW9kYWwoJ2FkZCcsIG51bGwsICQodGhpcykuZGF0YSgnY2hhbm5lbCcpKTsgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJlZGl0XCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgb3BlblJ1bGVXaXphcmQocnVsZUJ5SWQoJCh0aGlzKS5jbG9zZXN0KCcubWgtbm90aWYtcm93JykuZGF0YSgncnVsZS1pZCcpKSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwibWVudVwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgICB2YXIgJG1lbnUgPSAkKHRoaXMpLnNpYmxpbmdzKCcubWgtcnVsZS1tZW51Jyk7XG4gICAgICAgICAgICAkKCcubWgtcnVsZS1tZW51Jykubm90KCRtZW51KS5wcm9wKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgICRtZW51LnByb3AoJ2hpZGRlbicsICEkbWVudS5wcm9wKCdoaWRkZW4nKSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiZGVsZXRlXCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgY29uZmlybURlbGV0ZVJ1bGUocnVsZUJ5SWQoJCh0aGlzKS5jbG9zZXN0KCcubWgtbm90aWYtcm93JykuZGF0YSgncnVsZS1pZCcpKSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwidXBcIl0sIFtkYXRhLWFjdGlvbj1cImRvd25cIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBtb3ZlUnVsZShcbiAgICAgICAgICAgICAgICAkKHRoaXMpLmNsb3Nlc3QoJy5taC1ub3RpZi1yb3cnKS5kYXRhKCdydWxlLWlkJyksXG4gICAgICAgICAgICAgICAgJCh0aGlzKS5kYXRhKCdhY3Rpb24nKSA9PT0gJ3VwJyA/IC0xIDogMVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjaGFuZ2UnLCAnLm1oLXJ1bGUtdG9nZ2xlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGlkID0gJCh0aGlzKS5jbG9zZXN0KCcubWgtbm90aWYtcm93JykuZGF0YSgncnVsZS1pZCcpO1xuICAgICAgICAgICAgdmFyIGVuYWJsZWQgPSAkKHRoaXMpLnByb3AoJ2NoZWNrZWQnKTtcbiAgICAgICAgICAgIGFwaVBhdGNoKCcvcnVsZXMvJyArIGlkLCB7IGVuYWJsZWQ6IGVuYWJsZWQgfSwgZnVuY3Rpb24gKHJ1bGUpIHtcbiAgICAgICAgICAgICAgICByZXBsYWNlUnVsZShydWxlKTtcbiAgICAgICAgICAgICAgICByZW5kZXJSdWxlcygpO1xuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgICAgICBsb2FkUnVsZXModHJ1ZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgJChkb2N1bWVudCkub24oJ2NsaWNrJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBpZiAoJChldmVudC50YXJnZXQpLmNsb3Nlc3QoJy5taC1ydWxlLW1lbnUtd3JhcCcpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgICQoJy5taC1ydWxlLW1lbnUnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbG9hZFByb3ZpZGVycyhkb25lKSB7XG4gICAgICAgIGlmIChzdGF0ZS5wcm92aWRlcnNMb2FkZWQpIHtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb3JlR2V0KCcvcHJvdmlkZXJzJywgeyBsaW1pdDogMjAwIH0sIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICB2YXIgaXRlbXMgPSBkYXRhLml0ZW1zIHx8IFtdO1xuICAgICAgICAgICAgdmFyIGxpc3QgPSBbXTtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaXRlbXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICB2YXIgcHJvdmlkZXIgPSBpdGVtc1tpXTtcbiAgICAgICAgICAgICAgICB2YXIgaWQgPSBTdHJpbmcocHJvdmlkZXIuaWQgIT09IHVuZGVmaW5lZCA/IHByb3ZpZGVyLmlkIDogKHByb3ZpZGVyLnByb3ZpZGVyX2lkIHx8ICcnKSk7XG4gICAgICAgICAgICAgICAgaWYgKGlkID09PSAnJykgeyBjb250aW51ZTsgfVxuICAgICAgICAgICAgICAgIHZhciBsYWJlbCA9IHByb3ZpZGVyLmRlc2NyaXB0aW9uIHx8IHByb3ZpZGVyLnVzZXJuYW1lIHx8ICgnIycgKyBpZCk7XG4gICAgICAgICAgICAgICAgbGlzdC5wdXNoKHsgaWQ6IGlkLCBsYWJlbDogbGFiZWwgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzdGF0ZS5wcm92aWRlcnMgPSBsaXN0O1xuICAgICAgICAgICAgc3RhdGUucHJvdmlkZXJzTG9hZGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc3RhdGUucHJvdmlkZXJzTG9hZGVkID0gZmFsc2U7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1vdmVSdWxlKGlkLCBkZWx0YSkge1xuICAgICAgICB2YXIgaWRzID0gW107XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUucnVsZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlkcy5wdXNoKE51bWJlcihzdGF0ZS5ydWxlc1tpXS5pZCkpO1xuICAgICAgICB9XG4gICAgICAgIHZhciBpbmRleCA9IGlkcy5pbmRleE9mKE51bWJlcihpZCkpO1xuICAgICAgICB2YXIgdGFyZ2V0ID0gaW5kZXggKyBkZWx0YTtcbiAgICAgICAgaWYgKGluZGV4IDwgMCB8fCB0YXJnZXQgPCAwIHx8IHRhcmdldCA+PSBpZHMubGVuZ3RoKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHN3YXAgPSBpZHNbaW5kZXhdO1xuICAgICAgICBpZHNbaW5kZXhdID0gaWRzW3RhcmdldF07XG4gICAgICAgIGlkc1t0YXJnZXRdID0gc3dhcDtcbiAgICAgICAgYXBpUG9zdCgnL3J1bGVzOmNoYW5nZVByaW9yaXR5JywgeyBvcmRlcjogaWRzIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGxvYWRSdWxlcyh0cnVlKTtcbiAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlT3JkZXJTYXZlZCcpKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgIHNob3dUb2FzdChmYWlsdXJlVGV4dChmYWlsdXJlKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJ1bGVCeUlkKGlkKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUucnVsZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIoc3RhdGUucnVsZXNbaV0uaWQpID09PSBOdW1iZXIoaWQpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHN0YXRlLnJ1bGVzW2ldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlcGxhY2VSdWxlKHJ1bGUpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5ydWxlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKE51bWJlcihzdGF0ZS5ydWxlc1tpXS5pZCkgPT09IE51bWJlcihydWxlLmlkKSkge1xuICAgICAgICAgICAgICAgIHN0YXRlLnJ1bGVzW2ldID0gcnVsZTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgc3RhdGUucnVsZXMucHVzaChydWxlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjb25maXJtRGVsZXRlUnVsZShydWxlKSB7XG4gICAgICAgIGlmICghcnVsZSkgeyByZXR1cm47IH1cbiAgICAgICAgJCgnI21oLWNvbmZpcm0tdGV4dCcpLnRleHQodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVEZWxldGVDb25maXJtJywgeyB0aXRsZTogcnVsZS50aXRsZSB9KSk7XG4gICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsJykubW9kYWwoeyBjbG9zYWJsZTogdHJ1ZSB9KS5tb2RhbCgnc2hvdycpO1xuICAgICAgICAkKCcjbWgtY29uZmlybS1vaycpLm9mZignY2xpY2snKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtY29uZmlybS1tb2RhbCcpLm1vZGFsKCdoaWRlJyk7XG4gICAgICAgICAgICBhcGlEZWxldGUoJy9ydWxlcy8nICsgcnVsZS5pZCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGxvYWRSdWxlcyh0cnVlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uRGVsZXRlZCcpKTtcbiAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIG5vdGlmaWNhdGlvbnM6IHdpemFyZCAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBlbXB0eUZpbHRlcnMoKSB7XG4gICAgICAgIHJldHVybiB7IHVzZXJfaWRzOiBbXSwgZGlyZWN0aW9uczogW10sIHByb3ZpZGVyczogW10sIHF1YWxpdHlfc2NvcmU6IG51bGwgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBub3JtYWxpemVSZXRyYWN0KG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIGNvbmZpZyA9IG9wdGlvbnMgJiYgb3B0aW9ucy5yZXRyYWN0X29uX2NhbGxiYWNrICYmIHR5cGVvZiBvcHRpb25zLnJldHJhY3Rfb25fY2FsbGJhY2sgPT09ICdvYmplY3QnXG4gICAgICAgICAgICA/IG9wdGlvbnMucmV0cmFjdF9vbl9jYWxsYmFja1xuICAgICAgICAgICAgOiB7fTtcbiAgICAgICAgdmFyIHdpbmRvdyA9IE51bWJlcihjb25maWcud2luZG93X21pbik7XG4gICAgICAgIGlmICghd2luZG93IHx8IHdpbmRvdyA8IDUgfHwgd2luZG93ID4gMTIwKSB7XG4gICAgICAgICAgICB3aW5kb3cgPSAyMDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZW5hYmxlZDogY29uZmlnLmVuYWJsZWQgPT09IHRydWUsXG4gICAgICAgICAgICB3aW5kb3dfbWluOiB3aW5kb3csXG4gICAgICAgICAgICBjb3VudF9pbmNvbWluZ19hbnN3ZXJlZDogY29uZmlnLmNvdW50X2luY29taW5nX2Fuc3dlcmVkICE9PSBmYWxzZVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG5vcm1hbGl6ZUZpbHRlcnMoZmlsdGVycykge1xuICAgICAgICB2YXIgcmVzdWx0ID0gZW1wdHlGaWx0ZXJzKCk7XG4gICAgICAgIGlmICghZmlsdGVycyB8fCB0eXBlb2YgZmlsdGVycyAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZmlsdGVycy51c2VyX2lkcykpIHtcbiAgICAgICAgICAgIHJlc3VsdC51c2VyX2lkcyA9IGZpbHRlcnMudXNlcl9pZHMubWFwKE51bWJlcik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZmlsdGVycy5kaXJlY3Rpb25zKSkge1xuICAgICAgICAgICAgcmVzdWx0LmRpcmVjdGlvbnMgPSBmaWx0ZXJzLmRpcmVjdGlvbnMuc2xpY2UoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaWx0ZXJzLnByb3ZpZGVycykpIHtcbiAgICAgICAgICAgIHJlc3VsdC5wcm92aWRlcnMgPSBmaWx0ZXJzLnByb3ZpZGVycy5tYXAoU3RyaW5nKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZmlsdGVycy5xdWFsaXR5X3Njb3JlICYmIHR5cGVvZiBmaWx0ZXJzLnF1YWxpdHlfc2NvcmUgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICByZXN1bHQucXVhbGl0eV9zY29yZSA9IHt9O1xuICAgICAgICAgICAgaWYgKGZpbHRlcnMucXVhbGl0eV9zY29yZS5taW4gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHJlc3VsdC5xdWFsaXR5X3Njb3JlLm1pbiA9IE51bWJlcihmaWx0ZXJzLnF1YWxpdHlfc2NvcmUubWluKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChmaWx0ZXJzLnF1YWxpdHlfc2NvcmUubWF4ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQucXVhbGl0eV9zY29yZS5tYXggPSBOdW1iZXIoZmlsdGVycy5xdWFsaXR5X3Njb3JlLm1heCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBlbnN1cmVXaXphcmREYXRhKCkge1xuICAgICAgICBsb2FkRW1wbG95ZWVzKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5ydWxlV2l6YXJkICYmIHN0YXRlLnJ1bGVXaXphcmQuc3RlcCA9PT0gMikgeyByZW5kZXJXaXphcmRDb25kaXRpb25zKCk7IH1cbiAgICAgICAgfSk7XG4gICAgICAgIGxvYWRQcm92aWRlcnMoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHN0YXRlLnJ1bGVXaXphcmQgJiYgc3RhdGUucnVsZVdpemFyZC5zdGVwID09PSAyKSB7IHJlbmRlcldpemFyZENvbmRpdGlvbnMoKTsgfVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKCFzdGF0ZS5ib3RzTG9hZGVkKSB7XG4gICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIG9wZW5SdWxlV2l6YXJkKHJ1bGUpIHtcbiAgICAgICAgZW5zdXJlV2l6YXJkRGF0YSgpO1xuICAgICAgICB2YXIgc291cmNlID0gcnVsZSA/IHNvdXJjZUZvclJ1bGUocnVsZSkgOiBudWxsO1xuICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkID0ge1xuICAgICAgICAgICAgc3RlcDogcnVsZSA/IGZpcnN0U3RlcEFmdGVyU2NlbmFyaW8oKHJ1bGUuZXZlbnRfdHlwZXMgfHwgW10pLnNsaWNlKCkpIDogMSxcbiAgICAgICAgICAgIGVkaXRJZDogcnVsZSA/IE51bWJlcihydWxlLmlkKSA6IDAsXG4gICAgICAgICAgICBzb3VyY2VJZDogc291cmNlID8gc291cmNlLmlkIDogJycsXG4gICAgICAgICAgICBldmVudFR5cGVzOiBydWxlID8gKHJ1bGUuZXZlbnRfdHlwZXMgfHwgW10pLnNsaWNlKCkgOiBbXSxcbiAgICAgICAgICAgIHRpdGxlOiBydWxlID8gcnVsZS50aXRsZSA6ICcnLFxuICAgICAgICAgICAgZmlsdGVyczogbm9ybWFsaXplRmlsdGVycyhydWxlID8gcnVsZS5maWx0ZXJzIDogbnVsbCksXG4gICAgICAgICAgICB0YXJnZXRNb2RlOiBydWxlID8gcnVsZS50YXJnZXRfbW9kZSA6ICdlbXBsb3llZV9vcl9yZWNpcGllbnRzJyxcbiAgICAgICAgICAgIGNoYXRJZHM6IHJ1bGVcbiAgICAgICAgICAgICAgICA/IChydWxlLmNoYXRfaWRzIHx8IFtdKS5tYXAoTnVtYmVyKS5maWx0ZXIoZnVuY3Rpb24gKGlkKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAocnVsZS5jaGF0cyB8fCBbXSkuc29tZShmdW5jdGlvbiAoY2hhdCkgeyByZXR1cm4gTnVtYmVyKGNoYXQuaWQpID09PSBpZDsgfSk7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICA6IFtdLFxuICAgICAgICAgICAgbWFzazogcnVsZSA/ICEhKHJ1bGUub3B0aW9ucyAmJiBydWxlLm9wdGlvbnMubWFza19waG9uZSA9PT0gdHJ1ZSlcbiAgICAgICAgICAgICAgICA6ICEhKHN0YXRlLnNldHRpbmdzICYmIHN0YXRlLnNldHRpbmdzLm1hc2tfcGhvbmVfZGVmYXVsdCA9PT0gdHJ1ZSksXG4gICAgICAgICAgICByZXRyYWN0OiBub3JtYWxpemVSZXRyYWN0KHJ1bGUgPyBydWxlLm9wdGlvbnMgOiBudWxsKSxcbiAgICAgICAgICAgIGJvdElkOiBydWxlICYmIHJ1bGUuY2hhdHMgJiYgcnVsZS5jaGF0cy5sZW5ndGggPiAwID8gTnVtYmVyKHJ1bGUuY2hhdHNbMF0uYm90X2lkKSA6IDAsXG4gICAgICAgICAgICBlcnJvcjogJydcbiAgICAgICAgfTtcbiAgICAgICAgJCgnI21oLXJ1bGVzLXZpZXcnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgJCgnI21oLXdpemFyZCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAkKCcjbWVzc2VuZ2VyLWh1Yi1yb290JykuYWRkQ2xhc3MoJ21oLXdpemFyZC1vcGVuJyk7XG4gICAgICAgIGNsZWFyV2l6YXJkRXJyb3IoKTtcbiAgICAgICAgcmVuZGVyV2l6YXJkKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2xvc2VSdWxlV2l6YXJkKCkge1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXByZXZpZXcsICNtaC13aXphcmQtcHJldmlldy10YXJnZXQnKS5lbXB0eSgpO1xuICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkID0gbnVsbDtcbiAgICAgICAgJCgnI21oLXdpemFyZCcpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAkKCcjbWgtcnVsZXMtdmlldycpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAkKCcjbWVzc2VuZ2VyLWh1Yi1yb290JykucmVtb3ZlQ2xhc3MoJ21oLXdpemFyZC1vcGVuJyk7XG4gICAgICAgIHJlbmRlclJ1bGVzKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2l6YXJkU2NlbmFyaW8oKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgcmV0dXJuIHcgJiYgdy5zb3VyY2VJZCA/IHNvdXJjZUJ5SWQody5zb3VyY2VJZCkgOiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHdpemFyZFN1cHBvcnRzRW1wbG95ZWVzKHR5cGVzKSB7XG4gICAgICAgIHZhciBjYWxsVHlwZXMgPSBbJ2NvcmUubWlzc2VkX2NhbGwnLCAnYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCddO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHR5cGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAoY2FsbFR5cGVzLmluZGV4T2YodHlwZXNbaV0pID49IDApIHsgcmV0dXJuIHRydWU7IH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2l6YXJkU3VwcG9ydHNEaXJlY3Rpb25zKHR5cGVzKSB7XG4gICAgICAgIHJldHVybiB0eXBlcy5pbmRleE9mKCdjb3JlLm1pc3NlZF9jYWxsJykgPj0gMCB8fCB0eXBlcy5pbmRleE9mKCdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJykgPj0gMDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRTdXBwb3J0c1Byb3ZpZGVycyh0eXBlcykge1xuICAgICAgICByZXR1cm4gdHlwZXMuaW5kZXhPZignY29yZS5wcm92aWRlcl9kb3duJykgPj0gMCB8fCB0eXBlcy5pbmRleE9mKCdjb3JlLnByb3ZpZGVyX3VwJykgPj0gMDtcbiAgICB9XG5cbiAgICAvLyBTdGVwIDIgZXhpc3RzIG9ubHkgZm9yIHNjZW5hcmlvcyB3aXRoIGNvbmRpdGlvbnM7IHRoZSBvdGhlcnMgZ28gc3RyYWlnaHQgdG8gXHUwMGFiXHUwNDFhXHUwNDQzXHUwNDM0XHUwNDMwIFx1MDQzZVx1MDQ0Mlx1MDQzZlx1MDQ0MFx1MDQzMFx1MDQzMlx1MDQzOFx1MDQ0Mlx1MDQ0Y1x1MDBiYi5cbiAgICBmdW5jdGlvbiB3aXphcmRIYXNDb25kaXRpb25zKHR5cGVzKSB7XG4gICAgICAgIHJldHVybiB3aXphcmRTdXBwb3J0c0VtcGxveWVlcyh0eXBlcykgfHwgd2l6YXJkU3VwcG9ydHNEaXJlY3Rpb25zKHR5cGVzKSB8fCB3aXphcmRTdXBwb3J0c1Byb3ZpZGVycyh0eXBlcylcbiAgICAgICAgICAgIHx8IHR5cGVzLmluZGV4T2YoJ2NvcmUubWlzc2VkX2NhbGwnKSA+PSAwIHx8IHR5cGVzLmluZGV4T2YoJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnKSA+PSAwO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZpcnN0U3RlcEFmdGVyU2NlbmFyaW8odHlwZXMpIHtcbiAgICAgICAgcmV0dXJuIHdpemFyZEhhc0NvbmRpdGlvbnModHlwZXMpID8gMiA6IDM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyV2l6YXJkKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgJCgnI21oLXdpemFyZC1zdGVwLTEnKS5hdHRyKCdoaWRkZW4nLCB3LnN0ZXAgIT09IDEpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXN0ZXAtMicpLmF0dHIoJ2hpZGRlbicsIHcuc3RlcCAhPT0gMik7XG4gICAgICAgICQoJyNtaC13aXphcmQtc3RlcC0zJykuYXR0cignaGlkZGVuJywgdy5zdGVwICE9PSAzKTtcbiAgICAgICAgJCgnI21oLXdpemFyZCcpLmF0dHIoJ2RhdGEtc3RlcCcsIFN0cmluZyh3LnN0ZXApKTtcbiAgICAgICAgdmFyIHNjZW5hcmlvID0gd2l6YXJkU2NlbmFyaW8oKTtcbiAgICAgICAgdmFyIHRpdGxlO1xuICAgICAgICBpZiAody5zdGVwID09PSAxKSB7XG4gICAgICAgICAgICB0aXRsZSA9IHcuZWRpdElkID4gMCA/IHcudGl0bGUgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRUaXRsZScpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGl0bGUgPSB3LmVkaXRJZCA+IDAgPyB3LnRpdGxlIDogKHNjZW5hcmlvID8gc2NlbmFyaW8ubmFtZSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFRpdGxlJykpO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC13aXphcmQtdGl0bGUnKS50ZXh0KHRpdGxlKTtcbiAgICAgICAgLy8gb25lIGJhc2ljIGJ1dHRvbiBvbiB0aGUgbGVmdDogXHUwMGFiXHUwNDFlXHUwNDQyXHUwNDNjXHUwNDM1XHUwNDNkXHUwNDMwXHUwMGJiIG9uIHRoZSBmaXJzdCBzdGVwLCBcdTAwYWJcdTA0MWRcdTA0MzBcdTA0MzdcdTA0MzBcdTA0MzRcdTAwYmIgYWZ0ZXIgaXRcbiAgICAgICAgdmFyIGNhbkdvQmFjayA9IHcuc3RlcCA+IDEgJiYgISh3LmVkaXRJZCA+IDAgJiYgdy5zdGVwID09PSBmaXJzdFN0ZXBBZnRlclNjZW5hcmlvKHcuZXZlbnRUeXBlcykgJiYgdy5zb3VyY2VJZCA9PT0gJycpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXByZXYnKS50ZXh0KHcuc3RlcCA9PT0gMSA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZENhbmNlbCcpIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkQmFja0J1dHRvbicpKVxuICAgICAgICAgICAgLmRhdGEoJ21vZGUnLCBjYW5Hb0JhY2sgPyAnYmFjaycgOiAnY2FuY2VsJyk7XG4gICAgICAgIHZhciBpc0xhc3QgPSB3LnN0ZXAgPT09IDM7XG4gICAgICAgICQoJyNtaC13aXphcmQtbmV4dCcpLnRleHQoaXNMYXN0XG4gICAgICAgICAgICA/ICh3LmVkaXRJZCA+IDAgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRTYXZlJykgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRDcmVhdGUnKSlcbiAgICAgICAgICAgIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkTmV4dCcpKTtcbiAgICAgICAgaWYgKHcuc3RlcCA9PT0gMSkgeyByZW5kZXJXaXphcmRTY2VuYXJpb3MoKTsgfVxuICAgICAgICBpZiAody5zdGVwID09PSAyKSB7IHJlbmRlcldpemFyZENvbmRpdGlvbnMoKTsgfVxuICAgICAgICBpZiAody5zdGVwID09PSAzKSB7IHJlbmRlcldpemFyZFJlY2lwaWVudHMoKTsgfVxuICAgICAgICB1cGRhdGVXaXphcmROZXh0KCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdXBkYXRlV2l6YXJkTmV4dCgpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgIHZhciBkaXNhYmxlZCA9IHcuc3RlcCA9PT0gMSAmJiB3LnNvdXJjZUlkID09PSAnJztcbiAgICAgICAgaWYgKHcuc3RlcCA9PT0gMykge1xuICAgICAgICAgICAgZGlzYWJsZWQgPSBhY3RpdmVXaXphcmRCb3QoKSA9PT0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtd2l6YXJkLW5leHQnKS5wcm9wKCdkaXNhYmxlZCcsIGRpc2FibGVkKS50b2dnbGVDbGFzcygnZGlzYWJsZWQnLCBkaXNhYmxlZCk7XG4gICAgfVxuXG4gICAgLy8gT25lIGljb24gcGVyIHNjZW5hcmlvIChkZXNpZ24gdjMsIHN0ZXAgMSkuXG4gICAgdmFyIFNDRU5BUklPX0lDT05TID0ge1xuICAgICAgICBwaG9uZTogJzxwYXRoIGQ9XCJNNC41IDIuNWgybDEgMy0xLjUgMWE4IDggMCAwIDAgMy41IDMuNWwxLTEuNSAzIDF2MmExLjUgMS41IDAgMCAxLTEuNSAxLjVBMTAuNSAxMC41IDAgMCAxIDMgNGExLjUgMS41IDAgMCAxIDEuNS0xLjV6XCIvPicsXG4gICAgICAgIG1pYzogJzxyZWN0IHg9XCI2XCIgeT1cIjJcIiB3aWR0aD1cIjRcIiBoZWlnaHQ9XCI3LjVcIiByeD1cIjJcIi8+PHBhdGggZD1cIk0zLjUgOGE0LjUgNC41IDAgMCAwIDkgME04IDEyLjVWMTRcIi8+JyxcbiAgICAgICAgc3BhcmtsZTogJzxwYXRoIGQ9XCJNOCAydjNNOCAxMXYzTTIgOGgzTTExIDhoM00zLjggMy44bDIgMk0xMC4yIDEwLjJsMiAyTTMuOCAxMi4ybDItMk0xMC4yIDUuOGwyLTJcIi8+JyxcbiAgICAgICAgcm9ib3Q6ICc8cmVjdCB4PVwiM1wiIHk9XCI1XCIgd2lkdGg9XCIxMFwiIGhlaWdodD1cIjhcIiByeD1cIjJcIi8+PHBhdGggZD1cIk04IDIuNVY1TTYgOWguMDFNMTAgOWguMDFcIi8+JyxcbiAgICAgICAgc2VydmVyOiAnPHJlY3QgeD1cIjIuNVwiIHk9XCIzXCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjRcIiByeD1cIjFcIi8+PHJlY3QgeD1cIjIuNVwiIHk9XCI5XCIgd2lkdGg9XCIxMVwiIGhlaWdodD1cIjRcIiByeD1cIjFcIi8+PHBhdGggZD1cIk01IDVoLjAxTTUgMTFoLjAxXCIvPicsXG4gICAgICAgIHdhcm5pbmc6ICc8cGF0aCBkPVwiTTggMi41bDYgMTAuNUgyelwiLz48cGF0aCBkPVwiTTggNi41djNNOCAxMS4ydi4xXCIvPicsXG4gICAgICAgIGJvbHQ6ICc8cGF0aCBkPVwiTTkgMS41TDMuNSA5SDhsLTEgNS41TDEyLjUgN0g4elwiLz4nXG4gICAgfTtcbiAgICB2YXIgU0NFTkFSSU9fSUNPTl9CWV9TT1VSQ0UgPSB7XG4gICAgICAgICdjb3JlLm1pc3NlZF9jYWxsJzogJ3Bob25lJyxcbiAgICAgICAgJ2NvcmUudm9pY2VtYWlsJzogJ21pYycsXG4gICAgICAgICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJzogJ3NwYXJrbGUnLFxuICAgICAgICAnYWlfc3VwZXJ2aXNvci53b3JrZXJzJzogJ3JvYm90JyxcbiAgICAgICAgJ3ZvaWNlX2FnZW50LmNhbGxiYWNrcyc6ICdwaG9uZScsXG4gICAgICAgICd2b2ljZV9hZ2VudC5ydW50aW1lJzogJ3JvYm90JyxcbiAgICAgICAgJ2NvcmUucHJvdmlkZXJfc3RhdHVzJzogJ3NlcnZlcicsXG4gICAgICAgICdjb3JlLmFkdmljZSc6ICd3YXJuaW5nJyxcbiAgICAgICAgJ2NvcmUucGJ4X3N0YXJ0ZWQnOiAnYm9sdCdcbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gc2NlbmFyaW9JY29uKHNvdXJjZUlkKSB7XG4gICAgICAgIHZhciBwYXRocyA9IFNDRU5BUklPX0lDT05TW1NDRU5BUklPX0lDT05fQllfU09VUkNFW3NvdXJjZUlkXSB8fCAnd2FybmluZyddO1xuICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwibWgtc2NlbmFyaW8taWNvblwiPjxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPicgKyBwYXRocyArICc8L3N2Zz48L3NwYW4+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJXaXphcmRTY2VuYXJpb3MoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgdmFyIGdyb3VwcyA9IEdST1VQX09SREVSLmZpbHRlcihmdW5jdGlvbiAoZ3JvdXApIHtcbiAgICAgICAgICAgIHJldHVybiBzdGF0ZS5zb3VyY2VzLnNvbWUoZnVuY3Rpb24gKHNvdXJjZSkgeyByZXR1cm4gc291cmNlLmdyb3VwID09PSBncm91cDsgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICB2YXIgaHRtbCA9ICcnO1xuICAgICAgICBncm91cHMuZm9yRWFjaChmdW5jdGlvbiAoZ3JvdXApIHtcbiAgICAgICAgICAgIHZhciBzb3VyY2VzID0gc3RhdGUuc291cmNlcy5maWx0ZXIoZnVuY3Rpb24gKHNvdXJjZSkgeyByZXR1cm4gc291cmNlLmdyb3VwID09PSBncm91cDsgfSk7XG4gICAgICAgICAgICBpZiAoZ3JvdXBzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgICAgICBodG1sICs9ICc8aDMgY2xhc3M9XCJtaC1ncm91cC10aXRsZVwiPicgKyBlc2Moc291cmNlR3JvdXBOYW1lKGdyb3VwKSkgKyAnPC9oMz4nO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIm1oLXNjZW5hcmlvLWdyaWRcIj4nO1xuICAgICAgICAgICAgc291cmNlcy5mb3JFYWNoKGZ1bmN0aW9uIChzb3VyY2UpIHtcbiAgICAgICAgICAgICAgICB2YXIgZGlzYWJsZWQgPSBbJ21vZHVsZV9taXNzaW5nJywgJ21vZHVsZV9kaXNhYmxlZCcsICdhcGlfZm9yYmlkZGVuJywgJ2Vycm9yJywgJ2Rpc2FibGVkJ11cbiAgICAgICAgICAgICAgICAgICAgLmluZGV4T2Yoc291cmNlLmF2YWlsYWJpbGl0eSkgPj0gMDtcbiAgICAgICAgICAgICAgICB2YXIgc2VsZWN0ZWQgPSB3LnNvdXJjZUlkID09PSBzb3VyY2UuaWQ7XG4gICAgICAgICAgICAgICAgLy8gVW5hdmFpbGFibGUgc2NlbmFyaW86IG9ubHkgdGhlIHJlYXNvbiwgbm8gYWN0aW9uICh1c2VyIGRlY2lzaW9uIFExNCkuXG4gICAgICAgICAgICAgICAgaHRtbCArPSAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJtaC1zY2VuYXJpbycgKyAoZGlzYWJsZWQgPyAnIGlzLWRpc2FibGVkJyA6ICcnKSArIChzZWxlY3RlZCA/ICcgaXMtc2VsZWN0ZWQnIDogJycpXG4gICAgICAgICAgICAgICAgICAgICsgJ1wiIGRhdGEtc291cmNlLWlkPVwiJyArIGVzYyhzb3VyY2UuaWQpICsgJ1wiIGFyaWEtcHJlc3NlZD1cIicgKyAoc2VsZWN0ZWQgPyAndHJ1ZScgOiAnZmFsc2UnKSArICdcIidcbiAgICAgICAgICAgICAgICAgICAgKyAoZGlzYWJsZWQgPyAnIGRpc2FibGVkIGFyaWEtZGlzYWJsZWQ9XCJ0cnVlXCInIDogJycpICsgJz4nXG4gICAgICAgICAgICAgICAgICAgICsgc2NlbmFyaW9JY29uKHNvdXJjZS5pZClcbiAgICAgICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1zY2VuYXJpby10ZXh0XCI+PGI+JyArIGVzYyhzb3VyY2UubmFtZSkgKyAnPC9iPidcbiAgICAgICAgICAgICAgICAgICAgKyAoZGlzYWJsZWQgPyAnPHNwYW4gY2xhc3M9XCJtaC1tZXRhXCI+JyArIGVzYyhzb3VyY2UuYXZhaWxhYmlsaXR5X25hbWUpICsgJzwvc3Bhbj4nIDogJycpXG4gICAgICAgICAgICAgICAgICAgICsgJzwvc3Bhbj48L2J1dHRvbj4nO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBodG1sICs9ICc8L2Rpdj4nO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1zY2VuYXJpb3MnKS5odG1sKGh0bWwpO1xuICAgIH1cblxuICAgIC8vIC0tLS0gc3RlcCAyOiBjb25kaXRpb25zIChubyBoaW50czsgYW4gZW1wdHkgY2hvaWNlIG1lYW5zIFx1MDBhYlx1MDQzMlx1MDQ0MVx1MDQzNVx1MDBiYikgLS0tLVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyV2l6YXJkQ29uZGl0aW9ucygpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgIHZhciBodG1sID0gJyc7XG4gICAgICAgIGlmICh3aXphcmRTdXBwb3J0c0VtcGxveWVlcyh3LmV2ZW50VHlwZXMpKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZmllbGQnICsgKHN0YXRlLmVtcGxveWVlc0ZhaWxlZCA/ICcgZXJyb3InIDogJycpICsgJ1wiIGlkPVwibWgtY29uZC1lbXBsb3llZXMtZmllbGRcIj4nXG4gICAgICAgICAgICAgICAgKyAnPGxhYmVsPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkRW1wbG95ZWVzJykpICsgJzwvbGFiZWw+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJ1aSBtdWx0aXBsZSBzZWFyY2ggc2VsZWN0aW9uIGRyb3Bkb3duIG1oLWNvbmQtZHJvcGRvd25cIiBpZD1cIm1oLWNvbmQtZW1wbG95ZWVzXCIgdGFiaW5kZXg9XCIwXCI+J1xuICAgICAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiaGlkZGVuXCI+PHNwYW4gY2xhc3M9XCJkZWZhdWx0IHRleHRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0ZpbHRlckFsbCcpKSArICc8L3NwYW4+PGRpdiBjbGFzcz1cIm1lbnVcIj48L2Rpdj48L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAoc3RhdGUuZW1wbG95ZWVzRmFpbGVkXG4gICAgICAgICAgICAgICAgICAgID8gJzxzcGFuIGNsYXNzPVwibWgtaGVscFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkTGlzdEZhaWxlZCcpKVxuICAgICAgICAgICAgICAgICAgICAgICAgKyAnIDxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJyZXRyeS1lbXBsb3llZXNcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblJldHJ5JykpICsgJzwvYT48L3NwYW4+J1xuICAgICAgICAgICAgICAgICAgICA6ICcnKVxuICAgICAgICAgICAgICAgICsgJzwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHdpemFyZFN1cHBvcnRzRGlyZWN0aW9ucyh3LmV2ZW50VHlwZXMpKSB7XG4gICAgICAgICAgICB2YXIgZGlyZWN0aW9ucyA9IFtcbiAgICAgICAgICAgICAgICBbJ2luY29taW5nJywgJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZERpcmVjdGlvbkluY29taW5nJ10sXG4gICAgICAgICAgICAgICAgWydvdXRnb2luZycsICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmREaXJlY3Rpb25PdXRnb2luZyddLFxuICAgICAgICAgICAgICAgIFsnaW50ZXJuYWwnLCAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkRGlyZWN0aW9uSW50ZXJuYWwnXVxuICAgICAgICAgICAgXTtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJmaWVsZFwiPjxsYWJlbD4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZERpcmVjdGlvbnMnKSkgKyAnPC9sYWJlbD4nXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLXNlZ1wiIHJvbGU9XCJncm91cFwiIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZERpcmVjdGlvbnMnKSkgKyAnXCI+JztcbiAgICAgICAgICAgIGRpcmVjdGlvbnMuZm9yRWFjaChmdW5jdGlvbiAocGFpcikge1xuICAgICAgICAgICAgICAgIHZhciBwcmVzc2VkID0gdy5maWx0ZXJzLmRpcmVjdGlvbnMuaW5kZXhPZihwYWlyWzBdKSA+PSAwO1xuICAgICAgICAgICAgICAgIGh0bWwgKz0gJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGRhdGEtZGlyZWN0aW9uPVwiJyArIHBhaXJbMF0gKyAnXCIgYXJpYS1wcmVzc2VkPVwiJyArIChwcmVzc2VkID8gJ3RydWUnIDogJ2ZhbHNlJykgKyAnXCI+J1xuICAgICAgICAgICAgICAgICAgICArIGVzYyh0KHBhaXJbMV0pKSArICc8L2J1dHRvbj4nO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBodG1sICs9ICc8L2Rpdj48L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3aXphcmRTdXBwb3J0c1Byb3ZpZGVycyh3LmV2ZW50VHlwZXMpKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZmllbGRcIj48bGFiZWw+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRQcm92aWRlcnMnKSkgKyAnPC9sYWJlbD4nXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cInVpIG11bHRpcGxlIHNlYXJjaCBzZWxlY3Rpb24gZHJvcGRvd24gbWgtY29uZC1kcm9wZG93blwiIGlkPVwibWgtY29uZC1wcm92aWRlcnNcIiB0YWJpbmRleD1cIjBcIj4nXG4gICAgICAgICAgICAgICAgKyAnPGlucHV0IHR5cGU9XCJoaWRkZW5cIj48c3BhbiBjbGFzcz1cImRlZmF1bHQgdGV4dFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRmlsdGVyQWxsJykpICsgJzwvc3Bhbj48ZGl2IGNsYXNzPVwibWVudVwiPjwvZGl2PjwvZGl2PjwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHcuZXZlbnRUeXBlcy5pbmRleE9mKCdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJykgPj0gMCkge1xuICAgICAgICAgICAgdmFyIHJhbmdlID0gdy5maWx0ZXJzLnF1YWxpdHlfc2NvcmUgfHwge307XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZmllbGRcIj48bGFiZWw+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRRdWFsaXR5JykpICsgJzwvbGFiZWw+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1pbmxpbmUtaW5wdXRzXCI+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUXVhbGl0eUZyb20nKSkgKyAnPC9zcGFuPjxpbnB1dCB0eXBlPVwibnVtYmVyXCIgbWluPVwiMFwiIG1heD1cIjEwMFwiIGNsYXNzPVwibWgtcXVhbGl0eS1taW4gbWgtaW5wdXQteHNcIiB2YWx1ZT1cIicgKyAocmFuZ2UubWluICE9PSB1bmRlZmluZWQgPyByYW5nZS5taW4gOiAnJykgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUXVhbGl0eVRvJykpICsgJzwvc3Bhbj48aW5wdXQgdHlwZT1cIm51bWJlclwiIG1pbj1cIjBcIiBtYXg9XCIxMDBcIiBjbGFzcz1cIm1oLXF1YWxpdHktbWF4IG1oLWlucHV0LXhzXCIgdmFsdWU9XCInICsgKHJhbmdlLm1heCAhPT0gdW5kZWZpbmVkID8gcmFuZ2UubWF4IDogJycpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8L2Rpdj48L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3LmV2ZW50VHlwZXMuaW5kZXhPZignY29yZS5taXNzZWRfY2FsbCcpID49IDApIHtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJtaC1zd2l0Y2gtcm93IG1oLXJldHJhY3Qtcm93XCI+J1xuICAgICAgICAgICAgICAgICsgJzxsYWJlbCBjbGFzcz1cInVpIHRvZ2dsZSBjaGVja2JveCcgKyAody5yZXRyYWN0LmVuYWJsZWQgPyAnIGNoZWNrZWQnIDogJycpICsgJ1wiIGlkPVwibWgtcmV0cmFjdC1lbmFibGVkXCI+J1xuICAgICAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjbGFzcz1cImhpZGRlblwiJyArICh3LnJldHJhY3QuZW5hYmxlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAnIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1JldHJhY3RFbmFibGVkJykpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXRyYWNrXCI+PC9zcGFuPjwvbGFiZWw+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUmV0cmFjdEVuYWJsZWQnKSkgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWlubGluZS1pbnB1dHNcIiBpZD1cIm1oLXJldHJhY3Qtb3B0aW9uc1wiJyArICh3LnJldHJhY3QuZW5hYmxlZCA/ICcnIDogJyBoaWRkZW4nKSArICc+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbXV0ZWRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1JldHJhY3RXaW5kb3dCZWZvcmUnKSkgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8aW5wdXQgdHlwZT1cIm51bWJlclwiIG1pbj1cIjVcIiBtYXg9XCIxMjBcIiBpZD1cIm1oLXJldHJhY3Qtd2luZG93XCIgY2xhc3M9XCJtaC1pbnB1dC14c1wiIHZhbHVlPVwiJyArIHcucmV0cmFjdC53aW5kb3dfbWluICsgJ1wiIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1JldHJhY3RNaW51dGVzJykpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW11dGVkXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SZXRyYWN0TWludXRlcycpKSArICc8L3NwYW4+PC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAod2l6YXJkSXNNYXgoKVxuICAgICAgICAgICAgICAgICAgICA/ICc8ZGl2IGNsYXNzPVwiZmllbGRcIiBpZD1cIm1oLXJldHJhY3QtbWF4LWhpbnRcIicgKyAody5yZXRyYWN0LmVuYWJsZWQgPyAnJyA6ICcgaGlkZGVuJykgKyAnPidcbiAgICAgICAgICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtaGVscFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUmV0cmFjdE1heEhpbnQnKSkgKyAnPC9zcGFuPjwvZGl2PidcbiAgICAgICAgICAgICAgICAgICAgOiAnJyk7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLXdpemFyZC1jb25kaXRpb25zJykuaHRtbChodG1sKTtcbiAgICAgICAgaW5pdENvbmRpdGlvbkRyb3Bkb3ducygpO1xuICAgICAgICBiaW5kV2l6YXJkQ29uZGl0aW9ucygpO1xuICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaW5pdENvbmRpdGlvbkRyb3Bkb3ducygpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICB2YXIgJGVtcGxveWVlcyA9ICQoJyNtaC1jb25kLWVtcGxveWVlcycpO1xuICAgICAgICBpZiAoJGVtcGxveWVlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB2YXIgc2VsZWN0ZWRVc2VycyA9IHcuZmlsdGVycy51c2VyX2lkcy5tYXAoU3RyaW5nKTtcbiAgICAgICAgICAgICRlbXBsb3llZXMuZHJvcGRvd24oe1xuICAgICAgICAgICAgICAgIHZhbHVlczogc3RhdGUuZW1wbG95ZWVzLm1hcChmdW5jdGlvbiAoZW1wbG95ZWUpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgbmFtZTogZW1wbG95ZWUubGFiZWwsIHZhbHVlOiBTdHJpbmcoZW1wbG95ZWUuaWQpLCBzZWxlY3RlZDogc2VsZWN0ZWRVc2Vycy5pbmRleE9mKFN0cmluZyhlbXBsb3llZS5pZCkpID49IDAgfTtcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcjogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRmlsdGVyQWxsJyksXG4gICAgICAgICAgICAgICAgZnVsbFRleHRTZWFyY2g6IHRydWUsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogeyBub1Jlc3VsdHM6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0ZpbHRlck5vdGhpbmdGb3VuZCcpIH0sXG4gICAgICAgICAgICAgICAgb25DaGFuZ2U6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXN0YXRlLnJ1bGVXaXphcmQpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLnJ1bGVXaXphcmQuZmlsdGVycy51c2VyX2lkcyA9IFN0cmluZyh2YWx1ZSB8fCAnJykuc3BsaXQoJywnKS5maWx0ZXIoQm9vbGVhbikubWFwKE51bWJlcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyICRwcm92aWRlcnMgPSAkKCcjbWgtY29uZC1wcm92aWRlcnMnKTtcbiAgICAgICAgaWYgKCRwcm92aWRlcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdmFyIHNlbGVjdGVkUHJvdmlkZXJzID0gdy5maWx0ZXJzLnByb3ZpZGVycy5tYXAoU3RyaW5nKTtcbiAgICAgICAgICAgICRwcm92aWRlcnMuZHJvcGRvd24oe1xuICAgICAgICAgICAgICAgIHZhbHVlczogc3RhdGUucHJvdmlkZXJzLm1hcChmdW5jdGlvbiAocHJvdmlkZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgbmFtZTogcHJvdmlkZXIubGFiZWwsIHZhbHVlOiBTdHJpbmcocHJvdmlkZXIuaWQpLCBzZWxlY3RlZDogc2VsZWN0ZWRQcm92aWRlcnMuaW5kZXhPZihTdHJpbmcocHJvdmlkZXIuaWQpKSA+PSAwIH07XG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgcGxhY2Vob2xkZXI6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0ZpbHRlckFsbCcpLFxuICAgICAgICAgICAgICAgIGZ1bGxUZXh0U2VhcmNoOiB0cnVlLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IHsgbm9SZXN1bHRzOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9GaWx0ZXJOb3RoaW5nRm91bmQnKSB9LFxuICAgICAgICAgICAgICAgIG9uQ2hhbmdlOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS5ydWxlV2l6YXJkKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLmZpbHRlcnMucHJvdmlkZXJzID0gU3RyaW5nKHZhbHVlIHx8ICcnKS5zcGxpdCgnLCcpLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJpbmRXaXphcmRDb25kaXRpb25zKCkge1xuICAgICAgICB2YXIgJGZvcm0gPSAkKCcjbWgtd2l6YXJkLWNvbmRpdGlvbnMnKTtcbiAgICAgICAgJGZvcm0ub2ZmKCcud2l6YXJkJyk7XG4gICAgICAgICRmb3JtLm9uKCdjbGljay53aXphcmQnLCAnLm1oLXNlZyBidXR0b24nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIgdmFsdWUgPSBTdHJpbmcoJCh0aGlzKS5kYXRhKCdkaXJlY3Rpb24nKSk7XG4gICAgICAgICAgICB2YXIgaW5kZXggPSB3LmZpbHRlcnMuZGlyZWN0aW9ucy5pbmRleE9mKHZhbHVlKTtcbiAgICAgICAgICAgIGlmIChpbmRleCA+PSAwKSB7XG4gICAgICAgICAgICAgICAgdy5maWx0ZXJzLmRpcmVjdGlvbnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdy5maWx0ZXJzLmRpcmVjdGlvbnMucHVzaCh2YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAkKHRoaXMpLmF0dHIoJ2FyaWEtcHJlc3NlZCcsIGluZGV4ID49IDAgPyAnZmFsc2UnIDogJ3RydWUnKTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZFByZXZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICRmb3JtLm9uKCdjbGljay53aXphcmQnLCAnW2RhdGEtYWN0aW9uPVwicmV0cnktZW1wbG95ZWVzXCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgc3RhdGUuZW1wbG95ZWVzRmFpbGVkID0gZmFsc2U7XG4gICAgICAgICAgICBsb2FkRW1wbG95ZWVzKGZ1bmN0aW9uICgpIHsgcmVuZGVyV2l6YXJkQ29uZGl0aW9ucygpOyB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgICRmb3JtLm9uKCdjaGFuZ2Uud2l6YXJkJywgJyNtaC1yZXRyYWN0LWVuYWJsZWQgaW5wdXQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB3LnJldHJhY3QuZW5hYmxlZCA9ICQodGhpcykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICAgICAgJCgnI21oLXJldHJhY3QtZW5hYmxlZCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgdy5yZXRyYWN0LmVuYWJsZWQpO1xuICAgICAgICAgICAgJCgnI21oLXJldHJhY3Qtb3B0aW9ucycpLnByb3AoJ2hpZGRlbicsICF3LnJldHJhY3QuZW5hYmxlZCk7XG4gICAgICAgICAgICAkKCcjbWgtcmV0cmFjdC1tYXgtaGludCcpLnByb3AoJ2hpZGRlbicsICF3LnJldHJhY3QuZW5hYmxlZCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkZm9ybS5vbignaW5wdXQud2l6YXJkIGNoYW5nZS53aXphcmQnLCAnI21oLXJldHJhY3Qtd2luZG93JywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdmFyIHZhbHVlID0gTnVtYmVyKCQodGhpcykudmFsKCkpO1xuICAgICAgICAgICAgdy5yZXRyYWN0LndpbmRvd19taW4gPSB2YWx1ZSA+PSA1ICYmIHZhbHVlIDw9IDEyMCA/IHZhbHVlIDogMjA7XG4gICAgICAgIH0pO1xuICAgICAgICAkZm9ybS5vbignaW5wdXQud2l6YXJkJywgJy5taC1xdWFsaXR5LW1pbiwgLm1oLXF1YWxpdHktbWF4JywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdmFyIG1pbiA9ICRmb3JtLmZpbmQoJy5taC1xdWFsaXR5LW1pbicpLnZhbCgpO1xuICAgICAgICAgICAgdmFyIG1heCA9ICRmb3JtLmZpbmQoJy5taC1xdWFsaXR5LW1heCcpLnZhbCgpO1xuICAgICAgICAgICAgdmFyIHJhbmdlID0ge307XG4gICAgICAgICAgICBpZiAoU3RyaW5nKG1pbikudHJpbSgpICE9PSAnJykgeyByYW5nZS5taW4gPSBOdW1iZXIobWluKTsgfVxuICAgICAgICAgICAgaWYgKFN0cmluZyhtYXgpLnRyaW0oKSAhPT0gJycpIHsgcmFuZ2UubWF4ID0gTnVtYmVyKG1heCk7IH1cbiAgICAgICAgICAgIHcuZmlsdGVycy5xdWFsaXR5X3Njb3JlID0gT2JqZWN0LmtleXMocmFuZ2UpLmxlbmd0aCA+IDAgPyByYW5nZSA6IG51bGw7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0gc3RlcCAzOiB3aGVyZSB0byBzZW5kIC0tLS1cblxuICAgIGZ1bmN0aW9uIGFjdGl2ZVdpemFyZEJvdCgpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuIG51bGw7IH1cbiAgICAgICAgdmFyIGJvdHMgPSBzdGF0ZS5ib3RzLmZpbHRlcihmdW5jdGlvbiAoYm90KSB7IHJldHVybiBib3QuZW5hYmxlZCAhPT0gZmFsc2U7IH0pO1xuICAgICAgICBpZiAody5ib3RJZCA+IDApIHtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYm90cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIGlmIChOdW1iZXIoYm90c1tpXS5pZCkgPT09IE51bWJlcih3LmJvdElkKSkgeyByZXR1cm4gYm90c1tpXTsgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBib3RzLmxlbmd0aCA+IDAgPyBib3RzWzBdIDogbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJXaXphcmRSZWNpcGllbnRzKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIHZhciBzdXBwb3J0c0VtcGxveWVlcyA9IHdpemFyZFN1cHBvcnRzRW1wbG95ZWVzKHcuZXZlbnRUeXBlcyk7XG4gICAgICAgIHZhciBib3RzID0gc3RhdGUuYm90cy5maWx0ZXIoZnVuY3Rpb24gKGJvdCkgeyByZXR1cm4gYm90LmVuYWJsZWQgIT09IGZhbHNlOyB9KTtcbiAgICAgICAgdmFyIGFjdGl2ZSA9IGFjdGl2ZVdpemFyZEJvdCgpO1xuICAgICAgICBpZiAoYWN0aXZlICE9PSBudWxsICYmIE51bWJlcih3LmJvdElkKSAhPT0gTnVtYmVyKGFjdGl2ZS5pZCkpIHtcbiAgICAgICAgICAgIHcuYm90SWQgPSBOdW1iZXIoYWN0aXZlLmlkKTsgLy8gYSBzaW5nbGUgYm90IGlzIHNlbGVjdGVkIGJ5IGl0c2VsZlxuICAgICAgICB9XG4gICAgICAgIHZhciBib3RIdG1sID0gJyc7XG4gICAgICAgIGJvdHMuZm9yRWFjaChmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICB2YXIgc2VsZWN0ZWQgPSBhY3RpdmUgIT09IG51bGwgJiYgTnVtYmVyKGFjdGl2ZS5pZCkgPT09IE51bWJlcihib3QuaWQpO1xuICAgICAgICAgICAgdmFyIGNoYW5uZWwgPSBib3QuY2hhbm5lbCA9PT0gJ21heCcgPyAnbWF4JyA6ICd0Zyc7XG4gICAgICAgICAgICBib3RIdG1sICs9ICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cIm1oLXNjZW5hcmlvIG1oLWJvdC1jaG9pY2UnICsgKHNlbGVjdGVkID8gJyBpcy1zZWxlY3RlZCcgOiAnJylcbiAgICAgICAgICAgICAgICArICdcIiBkYXRhLWJvdC1pZD1cIicgKyBib3QuaWQgKyAnXCIgYXJpYS1wcmVzc2VkPVwiJyArIChzZWxlY3RlZCA/ICd0cnVlJyA6ICdmYWxzZScpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1lc3NlbmdlciAnICsgY2hhbm5lbCArICdcIiBhcmlhLWhpZGRlbj1cInRydWVcIj4nICsgKGNoYW5uZWwgPT09ICdtYXgnID8gJ01BWCcgOiAnVEcnKSArICc8L3NwYW4+J1xuICAgICAgICAgICAgICAgICsgJzxiIGNsYXNzPVwibWgtdHJ1bmNhdGVcIj4nICsgZXNjKGJvdC50aXRsZSkgKyAnPC9iPjwvYnV0dG9uPic7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLWJvdHMnKS5odG1sKGJvdEh0bWwpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLWJvdHMtZmllbGQnKS5hdHRyKCdoaWRkZW4nLCBib3RzLmxlbmd0aCA+IDAgPyBudWxsIDogdHJ1ZSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtbm8tYm90cycpLmF0dHIoJ2hpZGRlbicsIGJvdHMubGVuZ3RoID4gMCA/IHRydWUgOiBudWxsKTtcbiAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQnKS5hdHRyKCdoaWRkZW4nLCBib3RzLmxlbmd0aCA+IDAgPyBudWxsIDogdHJ1ZSk7XG5cbiAgICAgICAgaWYgKCFzdXBwb3J0c0VtcGxveWVlcykge1xuICAgICAgICAgICAgdy50YXJnZXRNb2RlID0gJ3JlY2lwaWVudHMnO1xuICAgICAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQgW3ZhbHVlPVwiZW1wbG95ZWVcIl0sICNtaC13aXphcmQtdGFyZ2V0IFt2YWx1ZT1cImVtcGxveWVlX29yX3JlY2lwaWVudHNcIl0nKVxuICAgICAgICAgICAgICAgIC5jbG9zZXN0KCdsYWJlbCcpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQgW3ZhbHVlPVwiZW1wbG95ZWVcIl0sICNtaC13aXphcmQtdGFyZ2V0IFt2YWx1ZT1cImVtcGxveWVlX29yX3JlY2lwaWVudHNcIl0nKVxuICAgICAgICAgICAgICAgIC5jbG9zZXN0KCdsYWJlbCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC13aXphcmQtdGFyZ2V0IGlucHV0W25hbWU9XCJtaC10YXJnZXRcIl0nKS5lYWNoKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBjaGVja2VkID0gJCh0aGlzKS52YWwoKSA9PT0gdy50YXJnZXRNb2RlO1xuICAgICAgICAgICAgJCh0aGlzKS5wcm9wKCdjaGVja2VkJywgY2hlY2tlZCkuY2xvc2VzdCgnbGFiZWwnKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsIGNoZWNrZWQpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmVuZGVyV2l6YXJkQ2hhdHMoKTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1tYXNrJykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCB3Lm1hc2spO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLW1hc2sgaW5wdXQnKS5wcm9wKCdjaGVja2VkJywgdy5tYXNrKTtcbiAgICAgICAgYmluZFdpemFyZFJlY2lwaWVudHMoKTtcbiAgICAgICAgLy8gYSBzY2VuYXJpbyB3aXRob3V0IGNvbmRpdGlvbnMgZ29lcyAxIC0+IDM6IHN0ZXAgMyBtdXN0IHJlbmRlciBpdHMgb3duIHByZXZpZXdcbiAgICAgICAgcmVuZGVyV2l6YXJkUHJldmlldygpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlcldpemFyZENoYXRzKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIHZhciBib3QgPSBhY3RpdmVXaXphcmRCb3QoKTtcbiAgICAgICAgdmFyIGNoYXRzID0gYm90ID8gKGJvdC5jaGF0cyB8fCBbXSkuZmlsdGVyKGZ1bmN0aW9uIChjaGF0KSB7XG4gICAgICAgICAgICByZXR1cm4gY2hhdC5zdGF0ZSA9PT0gJ2FjdGl2ZScgJiYgY2hhdC5lbmFibGVkID09PSB0cnVlO1xuICAgICAgICB9KSA6IFtdO1xuICAgICAgICB2YXIgaWRzID0gY2hhdHMubWFwKGZ1bmN0aW9uIChjaGF0KSB7IHJldHVybiBOdW1iZXIoY2hhdC5pZCk7IH0pO1xuICAgICAgICB3LmNoYXRJZHMgPSB3LmNoYXRJZHMuZmlsdGVyKGZ1bmN0aW9uIChpZCkgeyByZXR1cm4gaWRzLmluZGV4T2YoaWQpID49IDA7IH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLWNoYXRzLWZpZWxkJykuYXR0cignaGlkZGVuJywgdy50YXJnZXRNb2RlID09PSAnZW1wbG95ZWUnID8gdHJ1ZSA6IG51bGwpO1xuICAgICAgICB2YXIgJGRyb3Bkb3duID0gJCgnI21oLXdpemFyZC1jaGF0cycpO1xuICAgICAgICAkZHJvcGRvd24uZHJvcGRvd24oJ2Rlc3Ryb3knKTtcbiAgICAgICAgJGRyb3Bkb3duLmZpbmQoJ2EudWkubGFiZWwnKS5yZW1vdmUoKTtcbiAgICAgICAgJGRyb3Bkb3duLmRyb3Bkb3duKHtcbiAgICAgICAgICAgIHZhbHVlczogY2hhdHMubWFwKGZ1bmN0aW9uIChjaGF0KSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogZXNjKGNoYXQudGl0bGUgfHwgY2hhdC5jaGF0X2lkKSArICcgPHNwYW4gY2xhc3M9XCJtaC1tZXRhXCI+XHUwMGI3ICcgKyBlc2MoY2hhdEtpbmRMYWJlbChjaGF0LmNoYXRfa2luZCkpICsgJzwvc3Bhbj4nLFxuICAgICAgICAgICAgICAgICAgICB0ZXh0OiBlc2MoY2hhdC50aXRsZSB8fCBjaGF0LmNoYXRfaWQpLFxuICAgICAgICAgICAgICAgICAgICB2YWx1ZTogU3RyaW5nKGNoYXQuaWQpLFxuICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZDogdy5jaGF0SWRzLmluZGV4T2YoTnVtYmVyKGNoYXQuaWQpKSA+PSAwXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgcGxhY2Vob2xkZXI6IGNoYXRzLmxlbmd0aCA+IDAgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRDaGF0c1RpdGxlJykgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmROb0NoYXRzJyksXG4gICAgICAgICAgICBtZXNzYWdlOiB7IG5vUmVzdWx0czogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkTm9DaGF0cycpIH0sXG4gICAgICAgICAgICBvbkNoYW5nZTogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS5ydWxlV2l6YXJkKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICAgIHN0YXRlLnJ1bGVXaXphcmQuY2hhdElkcyA9IFN0cmluZyh2YWx1ZSB8fCAnJykuc3BsaXQoJywnKS5maWx0ZXIoQm9vbGVhbikubWFwKE51bWJlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJpbmRXaXphcmRSZWNpcGllbnRzKCkge1xuICAgICAgICB2YXIgJHN0ZXAgPSAkKCcjbWgtd2l6YXJkLXN0ZXAtMycpO1xuICAgICAgICAkc3RlcC5vZmYoJy53aXphcmQnKTtcbiAgICAgICAgJHN0ZXAub24oJ2NsaWNrLndpemFyZCcsICcubWgtYm90LWNob2ljZScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIHN0YXRlLnJ1bGVXaXphcmQuYm90SWQgPSBOdW1iZXIoJCh0aGlzKS5kYXRhKCdib3QtaWQnKSk7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLmNoYXRJZHMgPSBbXTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZFJlY2lwaWVudHMoKTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZFByZXZpZXcoKTtcbiAgICAgICAgICAgIHVwZGF0ZVdpemFyZE5leHQoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICRzdGVwLm9uKCdjaGFuZ2Uud2l6YXJkJywgJ2lucHV0W25hbWU9XCJtaC10YXJnZXRcIl0nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLnRhcmdldE1vZGUgPSBTdHJpbmcoJCh0aGlzKS52YWwoKSk7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLXRhcmdldCBpbnB1dFtuYW1lPVwibWgtdGFyZ2V0XCJdJykuZWFjaChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgJCh0aGlzKS5jbG9zZXN0KCdsYWJlbCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgJCh0aGlzKS5wcm9wKCdjaGVja2VkJykpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLWNoYXRzLWZpZWxkJykuYXR0cignaGlkZGVuJywgc3RhdGUucnVsZVdpemFyZC50YXJnZXRNb2RlID09PSAnZW1wbG95ZWUnID8gdHJ1ZSA6IG51bGwpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHN0ZXAub24oJ2NoYW5nZS53aXphcmQnLCAnI21oLXdpemFyZC1tYXNrIGlucHV0JywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc3RhdGUucnVsZVdpemFyZC5tYXNrID0gJCh0aGlzKS5wcm9wKCdjaGVja2VkJyk7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLW1hc2snKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsIHN0YXRlLnJ1bGVXaXphcmQubWFzayk7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0gcHJldmlldyAoc3RlcCAyLCByaWdodCBjb2x1bW4pIC0tLS1cblxuICAgIC8qKiBBIHJ1bGUgdGFyZ2V0cyBvbmUgYm90LCBzbyBpdHMgY2hhbm5lbCBpcyB0aGUgY2hhbm5lbCBvZiB0aGUgYWN0aXZlIHdpemFyZCBib3QuICovXG4gICAgZnVuY3Rpb24gd2l6YXJkSXNNYXgoKSB7XG4gICAgICAgIHZhciBib3QgPSBhY3RpdmVXaXphcmRCb3QoKTtcbiAgICAgICAgcmV0dXJuICEhYm90ICYmIGJvdC5jaGFubmVsID09PSAnbWF4JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRQcmV2aWV3Q2FsbFR5cGUodHlwZXMpIHtcbiAgICAgICAgdmFyIG9yZGVyID0gW1xuICAgICAgICAgICAgJ2NvcmUubWlzc2VkX2NhbGwnLCAnY29yZS52b2ljZW1haWwnLCAnYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCcsXG4gICAgICAgICAgICAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb2ZmbGluZScsICdhaV9zdXBlcnZpc29yLndvcmtlcl9vbmxpbmUnLFxuICAgICAgICAgICAgJ3ZvaWNlX2FnZW50LmNhbGxiYWNrX3JlcXVlc3QnLCAndm9pY2VfYWdlbnQucnVudGltZV9kb3duJywgJ3ZvaWNlX2FnZW50LnJ1bnRpbWVfdXAnLFxuICAgICAgICAgICAgJ2NvcmUucHJvdmlkZXJfZG93bicsICdjb3JlLnByb3ZpZGVyX3VwJywgJ2NvcmUuYWR2aWNlJywgJ2NvcmUucGJ4X3N0YXJ0ZWQnXG4gICAgICAgIF07XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgb3JkZXIubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmICh0eXBlcy5pbmRleE9mKG9yZGVyW2ldKSA+PSAwKSB7IHJldHVybiBvcmRlcltpXTsgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJXaXphcmRQcmV2aWV3KCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgdmFyIHR5cGUgPSB3aXphcmRQcmV2aWV3Q2FsbFR5cGUody5ldmVudFR5cGVzKTtcbiAgICAgICAgaWYgKHR5cGUgPT09ICcnKSB7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLXByZXZpZXcsICNtaC13aXphcmQtcHJldmlldy10YXJnZXQnKS5lbXB0eSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBuYW1lcyA9IGV2ZW50VHlwZU5hbWVzKCk7XG4gICAgICAgIHZhciB0aXRsZSA9IG5hbWVzW3R5cGVdIHx8IHR5cGU7XG4gICAgICAgIGlmICh0eXBlID09PSAnYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCcpIHtcbiAgICAgICAgICAgIHRpdGxlICs9ICcgXHUwMGI3ICcgKyB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZVF1YWxpdHlTY29yZScsIHsgc2NvcmU6IDQ4IH0pO1xuICAgICAgICB9XG4gICAgICAgIHZhciBwaG9uZSA9IHcubWFzayA/ICcrNyA5NjggKioqLSoqLTQ0JyA6ICcrNyA5NjggOTY4LTk0LTQ0JztcbiAgICAgICAgdmFyIGxpbmVzID0gW107XG4gICAgICAgIHZhciBub3RlcyA9IFtdO1xuICAgICAgICB2YXIgYnV0dG9uID0gZmFsc2U7XG4gICAgICAgIHZhciBkaXJlY3Rpb24gPSB3LmZpbHRlcnMuZGlyZWN0aW9ucy5sZW5ndGggPT09IDEgPyB3LmZpbHRlcnMuZGlyZWN0aW9uc1swXSA6ICdpbmNvbWluZyc7XG4gICAgICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgICAgICAgY2FzZSAnY29yZS5taXNzZWRfY2FsbCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaCgnPGI+JyArIGVzYyhwaG9uZSkgKyAnPC9iPiBcdTIxOTIgXHUwNDE4XHUwNDMyXHUwNDMwXHUwNDNkXHUwNDNlXHUwNDMyIFx1MDQxOC4gKDIzMyknKTtcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYygnMDIuMTAuMjAyNiAxNTo0MSBcdTAwYjcgJyArIHQoe1xuICAgICAgICAgICAgICAgICAgICBpbmNvbWluZzogJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VEaXJlY3Rpb25JbmNvbWluZycsXG4gICAgICAgICAgICAgICAgICAgIG91dGdvaW5nOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZURpcmVjdGlvbk91dGdvaW5nJyxcbiAgICAgICAgICAgICAgICAgICAgaW50ZXJuYWw6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlRGlyZWN0aW9uSW50ZXJuYWwnXG4gICAgICAgICAgICAgICAgfVtkaXJlY3Rpb25dKSkpO1xuICAgICAgICAgICAgICAgIGJ1dHRvbiA9IHRydWU7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdjb3JlLnZvaWNlbWFpbCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZVZvaWNlbWFpbEhpbnQnKSkpO1xuICAgICAgICAgICAgICAgIGJ1dHRvbiA9IHRydWU7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYygnXHUwNDFmXHUwNDM1XHUwNDQyXHUwNDQwXHUwNDNlXHUwNDMyXHUwNDMwIFx1MDQxMC4gKDI0MSkgXHUyMTkwICcgKyAody5tYXNrID8gJys3IDkxNiAqKiotKiotMTcnIDogJys3IDkxNiAyMDQtNTUtMTcnKSArICcgXHUwMGI3IDY6NDInKSk7XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2ModGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VSZWFzb25zJywgeyByZWFzb25zOiAnXHUwNDFhXHUwNDNiXHUwNDM4XHUwNDM1XHUwNDNkXHUwNDQyXHUwNDQzIFx1MDQzZFx1MDQzNSBcdTA0M2ZcdTA0M2VcdTA0M2NcdTA0M2VcdTA0MzNcdTA0M2JcdTA0Mzg7IFx1MDQzZlx1MDQzZVx1MDQzMlx1MDQ0Mlx1MDQzZVx1MDQ0MFx1MDQzZFx1MDQ0Ylx1MDQzOSBcdTA0MzdcdTA0MzJcdTA0M2VcdTA0M2RcdTA0M2VcdTA0M2EnIH0pKSk7XG4gICAgICAgICAgICAgICAgbm90ZXMucHVzaCgnXHUwNDFhXHUwNDNiXHUwNDM4XHUwNDM1XHUwNDNkXHUwNDQyXHUwNDQzIFx1MDQzZFx1MDQzNSBcdTA0M2ZcdTA0M2VcdTA0M2NcdTA0M2VcdTA0MzNcdTA0M2JcdTA0Mzg6IFx1MDQzNFx1MDQzMlx1MDQzMFx1MDQzNlx1MDQzNFx1MDQ0YiBcdTA0M2VcdTA0NDJcdTA0M2ZcdTA0NDBcdTA0MzBcdTA0MzJcdTA0MzhcdTA0M2JcdTA0MzggXHUwNDNkXHUwNDMwIFx1MDQ0MVx1MDQzMFx1MDQzOVx1MDQ0MiwgXHUwNDQwXHUwNDM1XHUwNDQ4XHUwNDM1XHUwNDNkXHUwNDM4XHUwNDRmIFx1MDQzZFx1MDQzNSBcdTA0M2ZcdTA0NDBcdTA0MzVcdTA0MzRcdTA0M2JcdTA0M2VcdTA0MzZcdTA0MzhcdTA0M2JcdTA0MzguJyk7XG4gICAgICAgICAgICAgICAgYnV0dG9uID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ3ZvaWNlX2FnZW50LmNhbGxiYWNrX3JlcXVlc3QnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKCdcdTA0MWZcdTA0NTFcdTA0NDJcdTA0NDAgXHUwMGI3ICcgKyBwaG9uZSkpO1xuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlVG9waWMnLCB7IHRvcGljOiAnXHUwNDEyXHUwNDNlXHUwNDM3XHUwNDMyXHUwNDQwXHUwNDMwXHUwNDQyJyB9KSkpO1xuICAgICAgICAgICAgICAgIGJ1dHRvbiA9IHRydWU7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdjb3JlLnByb3ZpZGVyX2Rvd24nOlxuICAgICAgICAgICAgY2FzZSAnY29yZS5wcm92aWRlcl91cCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2MoJ1NJUCBcdTAwYWJcdTA0MWNcdTA0MzVcdTA0MzNcdTA0MzBcdTA0NDRcdTA0M2VcdTA0M2RcdTAwYmIgXHUwMGI3IDEwLjAuMC4xJykpO1xuICAgICAgICAgICAgICAgIG5vdGVzLnB1c2goJ3JlZ2lzdGVyZWQgXHUyMTkyIHVucmVnaXN0ZXJlZCcpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb2ZmbGluZSc6XG4gICAgICAgICAgICBjYXNlICdhaV9zdXBlcnZpc29yLndvcmtlcl9vbmxpbmUnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goJ3N0dC0xJyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICd2b2ljZV9hZ2VudC5ydW50aW1lX2Rvd24nOlxuICAgICAgICAgICAgY2FzZSAndm9pY2VfYWdlbnQucnVudGltZV91cCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaCgnY29ubmVjdGlvbiByZWZ1c2VkJyk7XG4gICAgICAgICAgICAgICAgbm90ZXMucHVzaCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZUxhdGVuY3knLCB7IG1zOiAxMjAwIH0pKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUuYWR2aWNlJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYygnXHUwNDIxXHUwNDMyXHUwNDNlXHUwNDMxXHUwNDNlXHUwNDM0XHUwNDNkXHUwNDNlIDggJSBcdTA0M2RcdTA0MzAgXHUwNDQwXHUwNDMwXHUwNDM3XHUwNDM0XHUwNDM1XHUwNDNiXHUwNDM1IC9zdG9yYWdlJykpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnY29yZS5wYnhfc3RhcnRlZCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaCgnMDIuMTAuMjAyNiAwMzoxMCcpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIHZhciBpc01heCA9IHdpemFyZElzTWF4KCk7XG4gICAgICAgIHZhciBodG1sID0gJzxkaXYgY2xhc3M9XCJtaC1wcmV2aWV3LW1zZycgKyAoaXNNYXggPyAnIGlzLW1heCcgOiAnJykgKyAnXCI+PGRpdj4nICsgZXNjKGljb25Gb3JUeXBlKHR5cGUpKSArICcgPGI+JyArIGVzYyh0aXRsZSkgKyAnPC9iPjwvZGl2Pic7XG4gICAgICAgIGxpbmVzLmZvckVhY2goZnVuY3Rpb24gKGxpbmUpIHsgaHRtbCArPSAnPGRpdj4nICsgbGluZSArICc8L2Rpdj4nOyB9KTtcbiAgICAgICAgbm90ZXMuZm9yRWFjaChmdW5jdGlvbiAobm90ZSkgeyBodG1sICs9ICc8ZGl2PjxpPicgKyBlc2Mobm90ZSkgKyAnPC9pPjwvZGl2Pic7IH0pO1xuICAgICAgICBodG1sICs9ICc8c3BhbiBjbGFzcz1cIm1oLXByZXZpZXctdGltZVwiPjE1OjQxPC9zcGFuPjwvZGl2Pic7XG4gICAgICAgIGlmIChidXR0b24pIHtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJtaC1wcmV2aWV3LWJ1dHRvbicgKyAoaXNNYXggPyAnIGlzLW1heCcgOiAnJykgKyAnXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRQcmV2aWV3QnV0dG9uJykpICsgJyBcdTIxOTc8L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIC8vIHRoZSBtZXNzZW5nZXIgaXMgcGFydCBvZiB0aGUgcHJldmlldywgc28gdGhlIGFzaWRlIHNheXMgd2hpY2ggYnViYmxlIGl0IHNob3dzXG4gICAgICAgIC8vICh0aGUgZGVzaWduIGhhcyBubyB2aXNpYmxlIGNhcHRpb24gYWJvdmUgdGhlIGJ1YmJsZSlcbiAgICAgICAgJCgnLm1oLXdpemFyZC1wcmV2aWV3JykuYXR0cignYXJpYS1sYWJlbCcsXG4gICAgICAgICAgICB0KGlzTWF4ID8gJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFByZXZpZXdDaGFubmVsTWF4JyA6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRQcmV2aWV3VGl0bGUnKSk7XG4gICAgICAgIC8vIHN0ZXAgMiBzaG93cyB0aGUgY29uZGl0aW9ucyBwcmV2aWV3LCBzdGVwIDMgdGhlIHNhbWUgcHJldmlldyBmb3IgdGhlIGNob3NlbiBib3RcbiAgICAgICAgJCgnI21oLXdpemFyZC1wcmV2aWV3LCAjbWgtd2l6YXJkLXByZXZpZXctdGFyZ2V0JykuaHRtbChodG1sKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBpY29uRm9yVHlwZSh0eXBlKSB7XG4gICAgICAgIGlmICh0eXBlID09PSAnY29yZS5taXNzZWRfY2FsbCcgfHwgdHlwZSA9PT0gJ3ZvaWNlX2FnZW50LmNhbGxiYWNrX3JlcXVlc3QnKSB7IHJldHVybiAnXHVkODNkXHVkY2RlJzsgfVxuICAgICAgICBpZiAodHlwZSA9PT0gJ2NvcmUudm9pY2VtYWlsJykgeyByZXR1cm4gJ1x1ZDgzY1x1ZGY5OSc7IH1cbiAgICAgICAgaWYgKHR5cGUgPT09ICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJyB8fCB0eXBlID09PSAnY29yZS5wcm92aWRlcl9kb3duJyB8fCB0eXBlID09PSAndm9pY2VfYWdlbnQucnVudGltZV9kb3duJykgeyByZXR1cm4gJ1x1MjZhMFx1ZmUwZic7IH1cbiAgICAgICAgaWYgKHR5cGUgPT09ICdjb3JlLnByb3ZpZGVyX3VwJyB8fCB0eXBlID09PSAndm9pY2VfYWdlbnQucnVudGltZV91cCcgfHwgdHlwZSA9PT0gJ2FpX3N1cGVydmlzb3Iud29ya2VyX29ubGluZScpIHsgcmV0dXJuICdcdTI3MDUnOyB9XG4gICAgICAgIGlmICh0eXBlID09PSAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb2ZmbGluZScpIHsgcmV0dXJuICdcdWQ4M2RcdWRkMGMnOyB9XG4gICAgICAgIGlmICh0eXBlID09PSAnY29yZS5wYnhfc3RhcnRlZCcpIHsgcmV0dXJuICdcdWQ4M2RcdWRkMDQnOyB9XG4gICAgICAgIHJldHVybiAnXHUyNmEwXHVmZTBmJztcbiAgICB9XG5cbiAgICAvLyAtLS0tIG5hdmlnYXRpb24gYW5kIHNhdmUgLS0tLVxuXG4gICAgZnVuY3Rpb24gd2l6YXJkTmV4dCgpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgIGlmICh3LnN0ZXAgPT09IDEpIHtcbiAgICAgICAgICAgIGlmICghdy5zb3VyY2VJZCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHcuc3RlcCA9IGZpcnN0U3RlcEFmdGVyU2NlbmFyaW8ody5ldmVudFR5cGVzKTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZCgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3LnN0ZXAgPT09IDIpIHtcbiAgICAgICAgICAgIHcuc3RlcCA9IDM7XG4gICAgICAgICAgICByZW5kZXJXaXphcmQoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBzYXZlUnVsZSgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHdpemFyZFByZXYoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICBpZiAoJCgnI21oLXdpemFyZC1wcmV2JykuZGF0YSgnbW9kZScpICE9PSAnYmFjaycpIHtcbiAgICAgICAgICAgIGNsb3NlUnVsZVdpemFyZCgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3LnN0ZXAgPT09IDMgJiYgd2l6YXJkSGFzQ29uZGl0aW9ucyh3LmV2ZW50VHlwZXMpKSB7XG4gICAgICAgICAgICB3LnN0ZXAgPSAyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdy5zdGVwID0gMTtcbiAgICAgICAgfVxuICAgICAgICBjbGVhcldpemFyZEVycm9yKCk7XG4gICAgICAgIHJlbmRlcldpemFyZCgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHBydW5lRmlsdGVycyhmaWx0ZXJzKSB7XG4gICAgICAgIHZhciByZXN1bHQgPSB7fTtcbiAgICAgICAgaWYgKGZpbHRlcnMudXNlcl9pZHMubGVuZ3RoID4gMCkgeyByZXN1bHQudXNlcl9pZHMgPSBmaWx0ZXJzLnVzZXJfaWRzOyB9XG4gICAgICAgIGlmIChmaWx0ZXJzLmRpcmVjdGlvbnMubGVuZ3RoID4gMCkgeyByZXN1bHQuZGlyZWN0aW9ucyA9IGZpbHRlcnMuZGlyZWN0aW9uczsgfVxuICAgICAgICBpZiAoZmlsdGVycy5wcm92aWRlcnMubGVuZ3RoID4gMCkgeyByZXN1bHQucHJvdmlkZXJzID0gZmlsdGVycy5wcm92aWRlcnM7IH1cbiAgICAgICAgaWYgKGZpbHRlcnMucXVhbGl0eV9zY29yZSAhPT0gbnVsbCAmJiBPYmplY3Qua2V5cyhmaWx0ZXJzLnF1YWxpdHlfc2NvcmUpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHJlc3VsdC5xdWFsaXR5X3Njb3JlID0gZmlsdGVycy5xdWFsaXR5X3Njb3JlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZVJ1bGUoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICB2YXIgc2NlbmFyaW8gPSB3aXphcmRTY2VuYXJpbygpO1xuICAgICAgICAvLyB0aGUgd2l6YXJkIGhhcyBubyBuYW1lIGZpZWxkIChkZXNpZ24gdjMpOiBhIG5ldyBub3RpZmljYXRpb24gaXMgbmFtZWQgYWZ0ZXIgaXRzIHNjZW5hcmlvXG4gICAgICAgIHZhciB0aXRsZSA9IFN0cmluZyh3LnRpdGxlIHx8ICcnKS50cmltKCkgfHwgKHNjZW5hcmlvID8gc2NlbmFyaW8ubmFtZSA6ICcnKTtcbiAgICAgICAgaWYgKHRpdGxlID09PSAnJykge1xuICAgICAgICAgICAgc2hvd1dpemFyZEVycm9yKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFRpdGxlUmVxdWlyZWQnKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHcudGFyZ2V0TW9kZSAhPT0gJ2VtcGxveWVlJyAmJiB3LmNoYXRJZHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBzaG93V2l6YXJkRXJyb3IodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkTmVlZENoYXRzJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBvcHRpb25zID0geyBtYXNrX3Bob25lOiB3Lm1hc2sgfTtcbiAgICAgICAgaWYgKHcuZXZlbnRUeXBlcy5pbmRleE9mKCdjb3JlLm1pc3NlZF9jYWxsJykgPj0gMCkge1xuICAgICAgICAgICAgb3B0aW9ucy5yZXRyYWN0X29uX2NhbGxiYWNrID0ge1xuICAgICAgICAgICAgICAgIGVuYWJsZWQ6IHcucmV0cmFjdC5lbmFibGVkID09PSB0cnVlLFxuICAgICAgICAgICAgICAgIHdpbmRvd19taW46IHcucmV0cmFjdC53aW5kb3dfbWluID49IDUgJiYgdy5yZXRyYWN0LndpbmRvd19taW4gPD0gMTIwID8gdy5yZXRyYWN0LndpbmRvd19taW4gOiAyMCxcbiAgICAgICAgICAgICAgICBjb3VudF9pbmNvbWluZ19hbnN3ZXJlZDogdy5yZXRyYWN0LmNvdW50X2luY29taW5nX2Fuc3dlcmVkICE9PSBmYWxzZVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcGF5bG9hZCA9IHtcbiAgICAgICAgICAgIHRpdGxlOiB0aXRsZSxcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBldmVudF90eXBlczogdy5ldmVudFR5cGVzLFxuICAgICAgICAgICAgbWluX3NldmVyaXR5OiAnaW5mbycsXG4gICAgICAgICAgICBmaWx0ZXJzOiBwcnVuZUZpbHRlcnMody5maWx0ZXJzKSxcbiAgICAgICAgICAgIHRhcmdldF9tb2RlOiB3LnRhcmdldE1vZGUsXG4gICAgICAgICAgICBjaGF0X2lkczogdy5jaGF0SWRzLFxuICAgICAgICAgICAgb3B0aW9uczogb3B0aW9uc1xuICAgICAgICB9O1xuICAgICAgICB2YXIgZG9uZSA9IGZ1bmN0aW9uIChydWxlKSB7XG4gICAgICAgICAgICBjbG9zZVJ1bGVXaXphcmQoKTtcbiAgICAgICAgICAgIHJlcGxhY2VSdWxlKHJ1bGUpO1xuICAgICAgICAgICAgbG9hZFJ1bGVzKHRydWUpO1xuICAgICAgICAgICAgc2hvd1RvYXN0KHQody5lZGl0SWQgPiAwID8gJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFNhdmVkJyA6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRDcmVhdGVkJykpO1xuICAgICAgICB9O1xuICAgICAgICB2YXIgZmFpbHVyZSA9IGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgIHNob3dXaXphcmRFcnJvcihmYWlsdXJlVGV4dChlcnIpKTtcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKHcuZWRpdElkID4gMCkge1xuICAgICAgICAgICAgYXBpUGF0Y2goJy9ydWxlcy8nICsgdy5lZGl0SWQsIHBheWxvYWQsIGRvbmUsIGZhaWx1cmUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYXBpUG9zdCgnL3J1bGVzJywgcGF5bG9hZCwgZG9uZSwgZmFpbHVyZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzaG93V2l6YXJkRXJyb3IodGV4dCkge1xuICAgICAgICAkKCcjbWgtd2l6YXJkIC5taC13aXphcmQtZXJyb3Itc2xvdCcpLmh0bWwoJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlXCIgcm9sZT1cImFsZXJ0XCI+JyArIElDT05fRVJST1JcbiAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ncm93XCI+JyArIGVzYyh0ZXh0KSArICc8L2Rpdj48L2Rpdj4nKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjbGVhcldpemFyZEVycm9yKCkge1xuICAgICAgICAkKCcjbWgtd2l6YXJkIC5taC13aXphcmQtZXJyb3Itc2xvdCcpLmVtcHR5KCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYmluZFdpemFyZENvbnRyb2xzKCkge1xuICAgICAgICAkKCcjbWgtcnVsZS1hZGQnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IG9wZW5SdWxlV2l6YXJkKG51bGwpOyB9KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1iYWNrJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgY2xvc2VSdWxlV2l6YXJkKCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLW5leHQnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoJCh0aGlzKS5wcm9wKCdkaXNhYmxlZCcpKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgY2xlYXJXaXphcmRFcnJvcigpO1xuICAgICAgICAgICAgd2l6YXJkTmV4dCgpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1wcmV2Jykub24oJ2NsaWNrJywgd2l6YXJkUHJldik7XG4gICAgICAgICQoJyNtaC13aXphcmQtb3Blbi1zZXR0aW5ncycpLm9uKCdjbGljaycsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIGNsb3NlUnVsZVdpemFyZCgpO1xuICAgICAgICAgICAgJCgnI21oLXRhYnMgLml0ZW1bZGF0YS10YWI9XCJzZXR0aW5nc1wiXScpLnRyaWdnZXIoJ2NsaWNrJyk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXNjZW5hcmlvcycpLm9uKCdjbGljaycsICcubWgtc2NlbmFyaW8nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgc291cmNlID0gc291cmNlQnlJZCgkKHRoaXMpLmRhdGEoJ3NvdXJjZS1pZCcpKTtcbiAgICAgICAgICAgIGlmICghc291cmNlIHx8ICQodGhpcykuaGFzQ2xhc3MoJ2lzLWRpc2FibGVkJykpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgICAgICBpZiAody5zb3VyY2VJZCAhPT0gc291cmNlLmlkKSB7XG4gICAgICAgICAgICAgICAgdy5zb3VyY2VJZCA9IHNvdXJjZS5pZDtcbiAgICAgICAgICAgICAgICB3LmV2ZW50VHlwZXMgPSAoc291cmNlLmV2ZW50X3R5cGVzIHx8IFtdKS5tYXAoZnVuY3Rpb24gKHR5cGUpIHsgcmV0dXJuIHR5cGUudHlwZTsgfSk7XG4gICAgICAgICAgICAgICAgaWYgKHcuZWRpdElkID09PSAwKSB7IHcudGl0bGUgPSBzb3VyY2UubmFtZTsgfVxuICAgICAgICAgICAgICAgIHcuZmlsdGVycyA9IGVtcHR5RmlsdGVycygpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVuZGVyV2l6YXJkU2NlbmFyaW9zKCk7XG4gICAgICAgICAgICB1cGRhdGVXaXphcmROZXh0KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXNjZW5hcmlvcycpLm9uKCdkYmxjbGljaycsICcubWgtc2NlbmFyaW86bm90KC5pcy1kaXNhYmxlZCknLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB3aXphcmROZXh0KCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gdGFicyAmIGF1dG9yZWZyZXNoIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGluaXRUYWJzKCkge1xuICAgICAgICAkKCcjbWgtdGFicyAuaXRlbScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciB0YWIgPSAkKHRoaXMpLmRhdGEoJ3RhYicpO1xuICAgICAgICAgICAgJCgnI21oLXRhYnMgLml0ZW0nKS5yZW1vdmVDbGFzcygnYWN0aXZlJyk7XG4gICAgICAgICAgICAkKHRoaXMpLmFkZENsYXNzKCdhY3RpdmUnKTtcbiAgICAgICAgICAgICQoJyNtZXNzZW5nZXItaHViLXJvb3QgLm1oLXRhYi1wYW5lJykucmVtb3ZlQ2xhc3MoJ2FjdGl2ZScpO1xuICAgICAgICAgICAgJCgnI21lc3Nlbmdlci1odWItcm9vdCAubWgtdGFiLXBhbmVbZGF0YS10YWI9XCInICsgdGFiICsgJ1wiXScpLmFkZENsYXNzKCdhY3RpdmUnKTtcbiAgICAgICAgICAgICQoJyNtZXNzZW5nZXItaHViLXJvb3QnKS5hdHRyKCdkYXRhLWFjdGl2ZS10YWInLCB0YWIpO1xuICAgICAgICAgICAgaWYgKHRhYiA9PT0gJ25vdGlmaWNhdGlvbnMnKSB7XG4gICAgICAgICAgICAgICAgbG9hZFJ1bGVzKHRydWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRhYiA9PT0gJ3NldHRpbmdzJykge1xuICAgICAgICAgICAgICAgIGxvYWRHZW5lcmFsU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgICBsb2FkRW1wbG95ZWVzKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgbG9hZEJvdHMoKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gam91cm5hbFZpc2libGUoKSB7XG4gICAgICAgIHJldHVybiAkKCcjbWVzc2VuZ2VyLWh1Yi1yb290IC5taC10YWItcGFuZVtkYXRhLXRhYj1cImpvdXJuYWxcIl0nKS5oYXNDbGFzcygnYWN0aXZlJylcbiAgICAgICAgICAgICYmIGRvY3VtZW50LnZpc2liaWxpdHlTdGF0ZSA9PT0gJ3Zpc2libGUnO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG5vdGlmaWNhdGlvbnNWaXNpYmxlKCkge1xuICAgICAgICByZXR1cm4gJCgnI21lc3Nlbmdlci1odWItcm9vdCAubWgtdGFiLXBhbmVbZGF0YS10YWI9XCJub3RpZmljYXRpb25zXCJdJykuaGFzQ2xhc3MoJ2FjdGl2ZScpXG4gICAgICAgICAgICAmJiBkb2N1bWVudC52aXNpYmlsaXR5U3RhdGUgPT09ICd2aXNpYmxlJztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzY2hlZHVsZVJlZnJlc2goKSB7XG4gICAgICAgIHNldEludGVydmFsKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChqb3VybmFsVmlzaWJsZSgpKSB7XG4gICAgICAgICAgICAgICAgbG9hZCh7IHJlZnJlc2g6IHRydWUgfSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG5vdGlmaWNhdGlvbnNWaXNpYmxlKCkgJiYgc3RhdGUucnVsZVdpemFyZCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIGxvYWRSdWxlcyh0cnVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkb2N1bWVudC52aXNpYmlsaXR5U3RhdGUgPT09ICd2aXNpYmxlJykge1xuICAgICAgICAgICAgICAgIGxvYWRKb3VybmFsQmFkZ2UoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSwgUkVGUkVTSF9TRUMgKiAxMDAwKTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGluaXQgLS0tLS0tLS0tLVxuXG4gICAgJChkb2N1bWVudCkucmVhZHkoZnVuY3Rpb24gKCkge1xuICAgICAgICByb290ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ21lc3Nlbmdlci1odWItcm9vdCcpO1xuICAgICAgICBpZiAoIXJvb3QpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpbml0VGFicygpO1xuICAgICAgICBidWlsZFBlcmlvZE1lbnUoKTtcbiAgICAgICAgcmVuZGVyU2tlbGV0b24oKTtcblxuICAgICAgICAvLyBvdXIgY2hlY2tib3hlcyBhcmUgcGxhaW4gbGFiZWxzIGFyb3VuZCBoaWRkZW4gaW5wdXRzOiBrZWVwIHRoZSB2aXN1YWwgc3RhdGUgaW4gc3luY1xuICAgICAgICAkKGRvY3VtZW50KS5vbignY2hhbmdlJywgJy5tb2R1bGUtbWVzc2VuZ2VyLWh1YiAudWkuY2hlY2tib3ggaW5wdXQsIC5taC1tb2RhbCAudWkuY2hlY2tib3ggaW5wdXQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgJGlucHV0ID0gJCh0aGlzKTtcbiAgICAgICAgICAgIGlmICgkaW5wdXQuYXR0cigndHlwZScpID09PSAncmFkaW8nKSB7XG4gICAgICAgICAgICAgICAgJCgnaW5wdXRbbmFtZT1cIicgKyAkaW5wdXQuYXR0cignbmFtZScpICsgJ1wiXScpLmVhY2goZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICAkKHRoaXMpLmNsb3Nlc3QoJy51aS5jaGVja2JveCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgdGhpcy5jaGVja2VkKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgJGlucHV0LmNsb3Nlc3QoJy51aS5jaGVja2JveCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgdGhpcy5jaGVja2VkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgJCgnI21oLWpvdXJuYWwtcmVzZXQtZmlsdGVycycpLm9uKCdjbGljaycsIHJlc2V0RmlsdGVycyk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXByb2JlcyBpbnB1dCcpLm9uKCdjaGFuZ2UnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5zaG93UHJvYmVzID0gJCh0aGlzKS5wcm9wKCdjaGVja2VkJyk7XG4gICAgICAgICAgICByZW5kZXJKb3VybmFsKCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1iYW5uZXInKS5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiYmFubmVyLWZpeFwiXScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBib3QgPSBib3RCeUlkKCQodGhpcykuZGF0YSgnYm90LWlkJykpO1xuICAgICAgICAgICAgaWYgKGJvdCkge1xuICAgICAgICAgICAgICAgIG9wZW5Cb3RNb2RhbCgnZWRpdCcsIGJvdCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG9wZW5Cb3RNb2RhbCgnYWRkJywgbnVsbCwgJ3RlbGVncmFtJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1yZXRyeScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHsgbG9hZCgpOyB9KTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtcHJldicpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5vZmZzZXQgPj0gUEFHRV9MSU1JVCkge1xuICAgICAgICAgICAgICAgIHN0YXRlLm9mZnNldCAtPSBQQUdFX0xJTUlUO1xuICAgICAgICAgICAgICAgIGxvYWQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLW5leHQnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoc3RhdGUub2Zmc2V0ICsgc3RhdGUubGFzdEl0ZW1zLmxlbmd0aCA8IHN0YXRlLnRvdGFsKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUub2Zmc2V0ICs9IFBBR0VfTElNSVQ7XG4gICAgICAgICAgICAgICAgbG9hZCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXJldGVudGlvbi1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBzYXZlUmV0ZW50aW9uKTtcbiAgICAgICAgJCgnI21oLXB1YmxpYy11cmwtaW5wdXQnKS5vbignY2hhbmdlJywgc2F2ZVB1YmxpY1VybCk7XG4gICAgICAgICQoJyNtaC1wcm94eS1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBzYXZlUHJveHkpO1xuICAgICAgICAkKCcjbWgtbWF4LWNhLWlucHV0Jykub24oJ2NoYW5nZScsIHNhdmVNYXhDYUJ1bmRsZSk7XG4gICAgICAgICQoJyNtaC1tYXNrLWRlZmF1bHQgaW5wdXQnKS5vbignY2hhbmdlJywgc2F2ZU1hc2tEZWZhdWx0KTtcblxuICAgICAgICBiaW5kQm90c0NvbnRhaW5lcigpO1xuICAgICAgICBiaW5kQ2hhdEZvdW5kKCk7XG4gICAgICAgIGJpbmRSdWxlc0NvbnRhaW5lcigpO1xuICAgICAgICBiaW5kV2l6YXJkQ29udHJvbHMoKTtcbiAgICAgICAgJCgnI21oLWJvdC1hZGQnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IG9wZW5Cb3RNb2RhbCgnYWRkJywgbnVsbCwgJ3RlbGVncmFtJyk7IH0pO1xuICAgICAgICAkKCcjbWgtYm90LWNoZWNrLCAjbWgtYm90LWNoZWNrLXN0b3JlZCwgI21oLWJvdC1jaGVjay1uZXcnKS5vbignY2xpY2snLCBjaGVja0JvdEZvcm0pO1xuICAgICAgICAkKCcjbWgtYm90LXRva2VuLXJlcGxhY2UnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRva2VuLW5ldy1yb3cnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4tbmV3JykudHJpZ2dlcignZm9jdXMnKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4tY2FuY2VsJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1uZXcnKS52YWwoJycpO1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1uZXctcm93JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtYm90LXNhdmUnKS5vbignY2xpY2snLCBzYXZlQm90Rm9ybSk7XG4gICAgICAgICQoJyNtaC1ib3QtbW9kYWwnKS5vbignY2xpY2snLCAnLm1oLWNoYW5uZWwtY2FyZCcsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIGlmICghc3RhdGUuYm90TW9kYWwgfHwgJCh0aGlzKS5oYXNDbGFzcygnaXMtZGlzYWJsZWQnKSkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHN0YXRlLmJvdE1vZGFsLmNoYW5uZWwgPSBTdHJpbmcoJCh0aGlzKS5kYXRhKCdjaGFubmVsJykpO1xuICAgICAgICAgICAgJCgnI21oLWJvdC1jaGVjay1tZXNzYWdlJykuZW1wdHkoKTtcbiAgICAgICAgICAgIHN5bmNCb3RDaGFubmVsKCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtYm90LWRlbGV0ZScpLm9uKCdjbGljaycsIGNvbmZpcm1EZWxldGVCb3QpO1xuICAgICAgICAkKCcjbWgtYm90LW1vZGFsIFtkYXRhLWFjdGlvbj1cImNhbmNlbFwiXScpLm9uKCdjbGljaycsIGNhbmNlbEJvdE1vZGFsKTtcbiAgICAgICAgJCgnI21oLWNoYXQtc3RvcCcpLm9uKCdjbGljaycsIHN0b3BEaXNjb3ZlcnlBbmRDbG9zZSk7XG4gICAgICAgICQoJyNtaC1jaGF0LWFnYWluJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHN0YXRlLmNoYXRNb2RhbCkge1xuICAgICAgICAgICAgICAgIHN0YXJ0RGlzY292ZXJ5KHN0YXRlLmNoYXRNb2RhbC5ib3RJZCwgdHJ1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtY2hhdC1zYXZlJykub24oJ2NsaWNrJywgc2F2ZVNlbGVjdGVkQ2hhdHMpO1xuICAgICAgICAkKCcjbWgtY2hhdC1tb2RhbCBbZGF0YS1hY3Rpb249XCJjYW5jZWxcIl0nKS5vbignY2xpY2snLCBzdG9wRGlzY292ZXJ5QW5kQ2xvc2UpO1xuICAgICAgICAkKCcjbWgtdGVzdC1tb2RhbCBbZGF0YS1hY3Rpb249XCJjYW5jZWxcIl0nKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdG9wVGVzdFBvbGwoKTtcbiAgICAgICAgICAgICQoJyNtaC10ZXN0LW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsIFtkYXRhLWFjdGlvbj1cImNhbmNlbFwiXScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbG9hZENhdGFsb2coZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgYnVpbGRUeXBlTWVudSgpO1xuICAgICAgICAgICAgbG9hZEVtcGxveWVlcyhmdW5jdGlvbiAoKSB7fSk7XG4gICAgICAgICAgICBsb2FkUHJvdmlkZXJzKGZ1bmN0aW9uICgpIHt9KTtcbiAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICAgICAgbG9hZFJ1bGVzKCk7XG4gICAgICAgICAgICBsb2FkKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBzY2hlZHVsZVJlZnJlc2goKTtcbiAgICB9KTtcbn0oKSk7XG4iXSwibWFwcGluZ3MiOiI7OztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0MsYUFBWTtFQUNULFlBQVk7O0VBRVosSUFBSUEsUUFBUSxHQUFHLHNDQUFzQztFQUNyRCxJQUFJQyxVQUFVLEdBQUcsRUFBRTtFQUNuQixJQUFJQyxXQUFXLEdBQUcsRUFBRTtFQUNwQixJQUFJQyxXQUFXLEdBQUcsQ0FBQyxPQUFPLEVBQUUsZUFBZSxFQUFFLGFBQWEsRUFBRSxLQUFLLENBQUM7RUFFbEUsSUFBSUMsVUFB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