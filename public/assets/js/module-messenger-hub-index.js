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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6W10sInNvdXJjZXMiOlsibmV3LmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qIE1vZHVsZU1lc3Nlbmdlckh1YiBhZG1pbiBwYWdlOiBub3RpZmljYXRpb25zLCB3aXphcmQsIGpvdXJuYWwgYW5kIHNldHRpbmdzIChkZXNpZ24gdjMsIGRvY3MvZGVzaWduL01vZHVsZU1lc3Nlbmdlckh1Yi12My5odG1sKS5cbiAqIERhdGEgY29tZXMgb25seSBmcm9tIHRoZSBtb2R1bGUgUkVTVCByZXNvdXJjZXMgKHNldHRpbmdzLCBldmVudHMsIGJvdHMsIHJ1bGVzKSBhbmQgQ29yZSB2MyBsaXN0cy4gTm8gZXh0ZXJuYWwgQ0ROcy5cbiAqIFdyaXR0ZW4gaW4gcGxhaW4gRVM1ICh0YXJnZXRzIENocm9tZSA1MCAvIEZpcmVmb3ggNDUgLyBJRTExIGFmdGVyIHRoZSBCYWJlbCBwYXNzKS5cbiAqL1xuKGZ1bmN0aW9uICgpIHtcbiAgICAndXNlIHN0cmljdCc7XG5cbiAgICB2YXIgQVBJX0JBU0UgPSAnL3BieGNvcmUvYXBpL3YzL21vZHVsZS1tZXNzZW5nZXItaHViJztcbiAgICB2YXIgUEFHRV9MSU1JVCA9IDUwO1xuICAgIHZhciBSRUZSRVNIX1NFQyA9IDMwO1xuICAgIHZhciBHUk9VUF9PUkRFUiA9IFsnY2FsbHMnLCAnYWlfc3VwZXJ2aXNvcicsICd2b2ljZV9hZ2VudCcsICdwYngnXTtcblxuICAgIHZhciBJQ09OX0VSUk9SID0gJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjxjaXJjbGUgY3g9XCI4XCIgY3k9XCI4XCIgcj1cIjYuMjVcIi8+PHBhdGggZD1cIk02IDZsNCA0TTEwIDZsLTQgNFwiLz48L3N2Zz4nO1xuICAgIHZhciBJQ09OX0NIRVZST04gPSAnPHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+PHBhdGggZD1cIk02IDMuNUwxMC41IDggNiAxMi41XCIvPjwvc3ZnPic7XG4gICAgdmFyIElDT05fUExVUyA9ICc8c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBhcmlhLWhpZGRlbj1cInRydWVcIj48cGF0aCBkPVwiTTggM3YxME0zIDhoMTBcIi8+PC9zdmc+JztcblxuICAgIHZhciByb290ID0gbnVsbDtcbiAgICB2YXIgc3RhdGUgPSB7XG4gICAgICAgIHNvdXJjZXM6IFtdLFxuICAgICAgICBwZXJpb2Q6ICd0b2RheScsXG4gICAgICAgIGV2ZW50VHlwZTogJycsXG4gICAgICAgIG9mZnNldDogMCxcbiAgICAgICAgdG90YWw6IDAsXG4gICAgICAgIGhhc0xvYWRlZDogZmFsc2UsXG4gICAgICAgIGxhc3RJdGVtczogW10sXG4gICAgICAgIGNhbGxiYWNrczoge30sXG4gICAgICAgIGV4cGFuZGVkSWQ6IG51bGwsXG4gICAgICAgIGxvYWRTZXE6IDAsXG4gICAgICAgIHJldGVudGlvbjogMzAsXG4gICAgICAgIHNldHRpbmdzOiBudWxsLFxuICAgICAgICBib3RzOiBbXSxcbiAgICAgICAgYm90c0xvYWRlZDogZmFsc2UsXG4gICAgICAgIGJvdHNFcnJvcjogbnVsbCxcbiAgICAgICAgZXhwYW5kZWRCb3RzOiB7fSxcbiAgICAgICAgZW1wbG95ZWVzOiBbXSxcbiAgICAgICAgZW1wbG95ZWVzTG9hZGVkOiBmYWxzZSxcbiAgICAgICAgZW1wbG95ZWVzRmFpbGVkOiBmYWxzZSxcbiAgICAgICAgc2hvd1Byb2JlczogZmFsc2UsXG4gICAgICAgIGJvdE1vZGFsOiBudWxsLFxuICAgICAgICBjaGF0TW9kYWw6IG51bGwsXG4gICAgICAgIHRlc3RNb2RhbDogbnVsbCxcbiAgICAgICAgcnVsZXM6IFtdLFxuICAgICAgICBydWxlc0xvYWRlZDogZmFsc2UsXG4gICAgICAgIHJ1bGVzRXJyb3I6IG51bGwsXG4gICAgICAgIHByb3ZpZGVyczogW10sXG4gICAgICAgIHByb3ZpZGVyc0xvYWRlZDogZmFsc2UsXG4gICAgICAgIHJ1bGVXaXphcmQ6IG51bGxcbiAgICB9O1xuXG4gICAgLy8gLS0tLS0tLS0tLSBpMThuIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIHQoa2V5KSB7XG4gICAgICAgIGlmICh0eXBlb2YgZ2xvYmFsVHJhbnNsYXRlICE9PSAndW5kZWZpbmVkJyAmJiBnbG9iYWxUcmFuc2xhdGVba2V5XSkge1xuICAgICAgICAgICAgcmV0dXJuIGdsb2JhbFRyYW5zbGF0ZVtrZXldO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBrZXk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdGYoa2V5LCBwYXJhbXMpIHtcbiAgICAgICAgdmFyIHRleHQgPSB0KGtleSk7XG4gICAgICAgIE9iamVjdC5rZXlzKHBhcmFtcyB8fCB7fSkuZm9yRWFjaChmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgdGV4dCA9IHRleHQuc3BsaXQoJ3snICsgbmFtZSArICd9Jykuam9pbihTdHJpbmcocGFyYW1zW25hbWVdKSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdGV4dDtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIHNtYWxsIGhlbHBlcnMgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gcGFkKHZhbHVlKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZSA8IDEwID8gJzAnICsgdmFsdWUgOiBTdHJpbmcodmFsdWUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZtdFRpbWUodHMpIHtcbiAgICAgICAgdmFyIGQgPSBuZXcgRGF0ZSh0cyAqIDEwMDApO1xuICAgICAgICByZXR1cm4gcGFkKGQuZ2V0SG91cnMoKSkgKyAnOicgKyBwYWQoZC5nZXRNaW51dGVzKCkpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZtdERhdGUodHMpIHtcbiAgICAgICAgdmFyIGQgPSBuZXcgRGF0ZSh0cyAqIDEwMDApO1xuICAgICAgICByZXR1cm4gcGFkKGQuZ2V0RGF0ZSgpKSArICcuJyArIHBhZChkLmdldE1vbnRoKCkgKyAxKSArICcuJyArIGQuZ2V0RnVsbFllYXIoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmbXREYXRlVGltZSh0cykge1xuICAgICAgICByZXR1cm4gZm10RGF0ZSh0cykgKyAnICcgKyBmbXRUaW1lKHRzKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBpc1RvZGF5KHRzKSB7XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgdmFyIG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgICAgIHJldHVybiBkLnRvRGF0ZVN0cmluZygpID09PSBub3cudG9EYXRlU3RyaW5nKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNZZXN0ZXJkYXkodHMpIHtcbiAgICAgICAgdmFyIGQgPSBuZXcgRGF0ZSh0cyAqIDEwMDApO1xuICAgICAgICB2YXIgeWVzdGVyZGF5ID0gbmV3IERhdGUoRGF0ZS5ub3coKSAtIDg2NDAwMDAwKTtcbiAgICAgICAgcmV0dXJuIGQudG9EYXRlU3RyaW5nKCkgPT09IHllc3RlcmRheS50b0RhdGVTdHJpbmcoKTtcbiAgICB9XG5cbiAgICAvLyBPbmUgbGluZSBpbiBhIDQ4IHB4IHJvdzogwqsxODozNMK7LCDCq9Cy0YfQtdGA0LAgMTg6MzTCuywgwqsxMi4xMCAxODozNMK7LlxuICAgIGZ1bmN0aW9uIGZtdENlbGxUaW1lKHRzKSB7XG4gICAgICAgIGlmIChpc1RvZGF5KHRzKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZtdFRpbWUodHMpO1xuICAgICAgICB9XG4gICAgICAgIHZhciBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgdmFyIGRheSA9IGlzWWVzdGVyZGF5KHRzKSA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1RpbWVZZXN0ZXJkYXknKSA6IHBhZChkLmdldERhdGUoKSkgKyAnLicgKyBwYWQoZC5nZXRNb250aCgpICsgMSk7XG4gICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1tdXRlZFwiPicgKyBlc2MoZGF5KSArICc8L3NwYW4+ICcgKyBmbXRUaW1lKHRzKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBlc2ModmFsdWUpIHtcbiAgICAgICAgcmV0dXJuICQoJzxkaXYvPicpLnRleHQoU3RyaW5nKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgPyAnJyA6IHZhbHVlKSkuaHRtbCgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHN0YXJ0T2ZUb2RheSgpIHtcbiAgICAgICAgdmFyIGQgPSBuZXcgRGF0ZSgpO1xuICAgICAgICBkLnNldEhvdXJzKDAsIDAsIDAsIDApO1xuICAgICAgICByZXR1cm4gTWF0aC5mbG9vcihkLmdldFRpbWUoKSAvIDEwMDApO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHBlcmlvZEJvdW5kcygpIHtcbiAgICAgICAgdmFyIG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xuICAgICAgICB2YXIgdG9kYXlTdGFydCA9IHN0YXJ0T2ZUb2RheSgpO1xuICAgICAgICBzd2l0Y2ggKHN0YXRlLnBlcmlvZCkge1xuICAgICAgICAgICAgY2FzZSAndG9kYXknOiByZXR1cm4geyBmcm9tOiB0b2RheVN0YXJ0LCB0bzogbm93IH07XG4gICAgICAgICAgICBjYXNlICd5ZXN0ZXJkYXknOiByZXR1cm4geyBmcm9tOiB0b2RheVN0YXJ0IC0gODY0MDAsIHRvOiB0b2RheVN0YXJ0IC0gMSB9O1xuICAgICAgICAgICAgY2FzZSAnN2RheXMnOiByZXR1cm4geyBmcm9tOiB0b2RheVN0YXJ0IC0gNiAqIDg2NDAwLCB0bzogbm93IH07XG4gICAgICAgICAgICBjYXNlICczMGRheXMnOiByZXR1cm4geyBmcm9tOiB0b2RheVN0YXJ0IC0gMjkgKiA4NjQwMCwgdG86IG5vdyB9O1xuICAgICAgICAgICAgZGVmYXVsdDogcmV0dXJuIHsgZnJvbTogMCwgdG86IDAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gQVBJIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGFwaUdldChwYXRoLCBwYXJhbXMsIG9uU3VjY2Vzcywgb25GYWlsdXJlKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IENvbmZpZy5wYnhVcmwgKyBBUElfQkFTRSArIHBhdGgsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YTogcGFyYW1zIHx8IHt9LFxuICAgICAgICAgICAgY2FjaGU6IGZhbHNlXG4gICAgICAgIH0pLmRvbmUoZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2UucmVzdWx0ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgb25TdWNjZXNzKHJlc3BvbnNlLmRhdGEpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBvbkZhaWx1cmUobm9ybWFsaXplRmFpbHVyZShyZXNwb25zZSwgMjAwKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLmZhaWwoZnVuY3Rpb24gKHhocikge1xuICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUobnVsbCwgeGhyLnN0YXR1cykpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBhcGlQYXRjaChwYXRoLCBwYXlsb2FkLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBDb25maWcucGJ4VXJsICsgQVBJX0JBU0UgKyBwYXRoLFxuICAgICAgICAgICAgbWV0aG9kOiAnUEFUQ0gnLFxuICAgICAgICAgICAgZGF0YTogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXG4gICAgICAgICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJ1xuICAgICAgICB9KS5kb25lKGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlICYmIHJlc3BvbnNlLnJlc3VsdCA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgIG9uU3VjY2VzcyhyZXNwb25zZS5kYXRhKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUocmVzcG9uc2UsIDIwMCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KS5mYWlsKGZ1bmN0aW9uICh4aHIpIHtcbiAgICAgICAgICAgIG9uRmFpbHVyZShub3JtYWxpemVGYWlsdXJlKG51bGwsIHhoci5zdGF0dXMpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbm9ybWFsaXplRmFpbHVyZShyZXNwb25zZSwgc3RhdHVzKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXM6IHN0YXR1cyxcbiAgICAgICAgICAgIGVycm9yOiAocmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YSAmJiByZXNwb25zZS5kYXRhLmVycm9yKSB8fCAnaHR0cF8nICsgc3RhdHVzLFxuICAgICAgICAgICAgbWVzc2FnZXM6IChyZXNwb25zZSAmJiByZXNwb25zZS5tZXNzYWdlcyAmJiByZXNwb25zZS5tZXNzYWdlcy5lcnJvcikgfHwgW11cbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIHNvdXJjZSBjYXRhbG9nIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGxvYWRDYXRhbG9nKGRvbmUpIHtcbiAgICAgICAgYXBpR2V0KCcvc2V0dGluZ3M6Z2V0U291cmNlcycsIHt9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgc3RhdGUuc291cmNlcyA9IGRhdGEuaXRlbXMgfHwgW107XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLnNvdXJjZXMgPSBbXTtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc291cmNlQnlJZChpZCkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLnNvdXJjZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5zb3VyY2VzW2ldLmlkID09PSBpZCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzdGF0ZS5zb3VyY2VzW2ldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGV2ZW50VHlwZU5hbWVzKCkge1xuICAgICAgICB2YXIgbmFtZXMgPSB7fTtcbiAgICAgICAgc3RhdGUuc291cmNlcy5mb3JFYWNoKGZ1bmN0aW9uIChzb3VyY2UpIHtcbiAgICAgICAgICAgIChzb3VyY2UuZXZlbnRfdHlwZXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24gKHR5cGUpIHtcbiAgICAgICAgICAgICAgICBuYW1lc1t0eXBlLnR5cGVdID0gdHlwZS5uYW1lO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gbmFtZXM7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiBmaWx0ZXJzIChkZXNpZ24gdjM6IHBlcmlvZCBhbmQgZXZlbnQgb25seSkgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gYnVpbGRUeXBlTWVudSgpIHtcbiAgICAgICAgdmFyIG5hbWVzID0gZXZlbnRUeXBlTmFtZXMoKTtcbiAgICAgICAgdmFyIGl0ZW1zID0gW107XG4gICAgICAgIEdST1VQX09SREVSLmZvckVhY2goZnVuY3Rpb24gKGdyb3VwKSB7XG4gICAgICAgICAgICB2YXIgaW5Hcm91cCA9IFtdO1xuICAgICAgICAgICAgc3RhdGUuc291cmNlcy5mb3JFYWNoKGZ1bmN0aW9uIChzb3VyY2UpIHtcbiAgICAgICAgICAgICAgICBpZiAoc291cmNlLmdyb3VwICE9PSBncm91cCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIChzb3VyY2UuZXZlbnRfdHlwZXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24gKHR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgaW5Hcm91cC5wdXNoKHsgdmFsdWU6IHR5cGUudHlwZSwgdGV4dDogbmFtZXNbdHlwZS50eXBlXSB8fCB0eXBlLnR5cGUgfSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGlmIChpbkdyb3VwLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBpdGVtcy5wdXNoKHsgZ3JvdXA6IHNvdXJjZUdyb3VwTmFtZShncm91cCkgfSk7XG4gICAgICAgICAgICAgICAgaW5Hcm91cC5mb3JFYWNoKGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgICAgICAgICAgICAgIGl0ZW1zLnB1c2goaXRlbSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1maWx0ZXJzIC5taC1maWx0ZXItdHlwZScpLmRyb3Bkb3duKHtcbiAgICAgICAgICAgIHZhbHVlczogbWVudVRvVmFsdWVzKGl0ZW1zKSxcbiAgICAgICAgICAgIHBsYWNlaG9sZGVyOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9GaWx0ZXJBbGxUeXBlcycpLFxuICAgICAgICAgICAgb25DaGFuZ2U6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgIHN0YXRlLmV2ZW50VHlwZSA9IFN0cmluZyh2YWx1ZSB8fCAnJyk7XG4gICAgICAgICAgICAgICAgcmVsb2FkKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1lbnVUb1ZhbHVlcyhpdGVtcykge1xuICAgICAgICByZXR1cm4gaXRlbXMubWFwKGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgICAgICBpZiAoaXRlbS5ncm91cCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB7IHR5cGU6ICdoZWFkZXInLCBuYW1lOiBpdGVtLmdyb3VwIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4geyBuYW1lOiBpdGVtLnRleHQsIHZhbHVlOiBpdGVtLnZhbHVlIH07XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNvdXJjZUdyb3VwTmFtZShncm91cCkge1xuICAgICAgICB2YXIga2V5ID0ge1xuICAgICAgICAgICAgY2FsbHM6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Hcm91cENhbGxzJyxcbiAgICAgICAgICAgIGFpX3N1cGVydmlzb3I6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Hcm91cEFpU3VwZXJ2aXNvcicsXG4gICAgICAgICAgICB2b2ljZV9hZ2VudDogJ21vZHVsZV9tZXNzZW5nZXJfaHViX0dyb3VwVm9pY2VBZ2VudCcsXG4gICAgICAgICAgICBwYng6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Hcm91cFBieCdcbiAgICAgICAgfVtncm91cF0gfHwgZ3JvdXA7XG4gICAgICAgIHJldHVybiB0KGtleSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYnVpbGRQZXJpb2RNZW51KCkge1xuICAgICAgICAkKCcjbWgtam91cm5hbC1maWx0ZXJzIC5taC1maWx0ZXItcGVyaW9kJykuZHJvcGRvd24oe1xuICAgICAgICAgICAgdmFsdWVzOiBbXG4gICAgICAgICAgICAgICAgeyBuYW1lOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QZXJpb2RUb2RheScpLCB2YWx1ZTogJ3RvZGF5Jywgc2VsZWN0ZWQ6IHRydWUgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1BlcmlvZFllc3RlcmRheScpLCB2YWx1ZTogJ3llc3RlcmRheScgfSxcbiAgICAgICAgICAgICAgICB7IG5hbWU6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1BlcmlvZDdEYXlzJyksIHZhbHVlOiAnN2RheXMnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QZXJpb2QzMERheXMnKSwgdmFsdWU6ICczMGRheXMnIH0sXG4gICAgICAgICAgICAgICAgeyBuYW1lOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QZXJpb2RBbGwnKSwgdmFsdWU6ICdhbGwnIH1cbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBvbkNoYW5nZTogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUucGVyaW9kID0gU3RyaW5nKHZhbHVlIHx8ICdhbGwnKTtcbiAgICAgICAgICAgICAgICByZWxvYWQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVzZXRGaWx0ZXJzKCkge1xuICAgICAgICBzdGF0ZS5ldmVudFR5cGUgPSAnJztcbiAgICAgICAgc3RhdGUucGVyaW9kID0gJ3RvZGF5JztcbiAgICAgICAgc3RhdGUub2Zmc2V0ID0gMDtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtZmlsdGVycyAubWgtZmlsdGVyLXR5cGUnKS5kcm9wZG93bignY2xlYXInKTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtZmlsdGVycyAubWgtZmlsdGVyLXBlcmlvZCcpLmRyb3Bkb3duKCdzZXQgc2VsZWN0ZWQnLCAndG9kYXknKTtcbiAgICAgICAgcmVsb2FkKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZmlsdGVyc0FjdGl2ZSgpIHtcbiAgICAgICAgLy8gdGhlIGRlZmF1bHQgcGVyaW9kICjCq9Ch0LXQs9C+0LTQvdGPwrspIGlzIG5vdCBhIGZpbHRlcjogYW4gZW1wdHkgbG9nIHNob3dzIMKr0KHQvtCx0YvRgtC40Lkg0L3QtdGCwrtcbiAgICAgICAgcmV0dXJuIHN0YXRlLmV2ZW50VHlwZSAhPT0gJycgfHwgc3RhdGUucGVyaW9kICE9PSAndG9kYXknO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gam91cm5hbDogbG9hZGluZyAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiByZWxvYWQoKSB7XG4gICAgICAgIHN0YXRlLm9mZnNldCA9IDA7XG4gICAgICAgIGxvYWQoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBsb2FkKG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIHNlcSA9ICsrc3RhdGUubG9hZFNlcTtcbiAgICAgICAgdmFyIGJvdW5kcyA9IHBlcmlvZEJvdW5kcygpO1xuICAgICAgICB2YXIgaXNSZWZyZXNoID0gb3B0aW9ucyAmJiBvcHRpb25zLnJlZnJlc2ggPT09IHRydWU7XG4gICAgICAgIHZhciBwYXJhbXMgPSB7XG4gICAgICAgICAgICBsaW1pdDogUEFHRV9MSU1JVCxcbiAgICAgICAgICAgIG9mZnNldDogc3RhdGUub2Zmc2V0XG4gICAgICAgIH07XG4gICAgICAgIGlmIChzdGF0ZS5ldmVudFR5cGUgIT09ICcnKSB7IHBhcmFtcy5ldmVudF90eXBlID0gc3RhdGUuZXZlbnRUeXBlOyB9XG4gICAgICAgIGlmIChib3VuZHMuZnJvbSA+IDApIHsgcGFyYW1zLmRhdGVfZnJvbSA9IGJvdW5kcy5mcm9tOyB9XG4gICAgICAgIGlmIChib3VuZHMudG8gPiAwKSB7IHBhcmFtcy5kYXRlX3RvID0gYm91bmRzLnRvOyB9XG5cbiAgICAgICAgc2V0Sm91cm5hbEJ1c3kodHJ1ZSwgaXNSZWZyZXNoKTtcbiAgICAgICAgYXBpR2V0KCcvZXZlbnRzJywgcGFyYW1zLCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgaWYgKHNlcSAhPT0gc3RhdGUubG9hZFNlcSkge1xuICAgICAgICAgICAgICAgIHJldHVybjsgLy8gYSBuZXdlciByZXF1ZXN0IGFscmVhZHkgYW5zd2VyZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHN0YXRlLnRvdGFsID0gZGF0YS5wYWdpbmF0aW9uID8gZGF0YS5wYWdpbmF0aW9uLnRvdGFsIDogMDtcbiAgICAgICAgICAgIHN0YXRlLmxhc3RJdGVtcyA9IGRhdGEuaXRlbXMgfHwgW107XG4gICAgICAgICAgICBzdGF0ZS5oYXNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc2V0Sm91cm5hbEJ1c3koZmFsc2UsIGlzUmVmcmVzaCk7XG4gICAgICAgICAgICByZW5kZXJKb3VybmFsKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICBpZiAoc2VxICE9PSBzdGF0ZS5sb2FkU2VxKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc2V0Sm91cm5hbEJ1c3koZmFsc2UsIGlzUmVmcmVzaCk7XG4gICAgICAgICAgICByZW5kZXJMb2FkRXJyb3IoZmFpbHVyZSk7XG4gICAgICAgIH0pO1xuICAgICAgICBsb2FkSm91cm5hbEJhZGdlKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2V0Sm91cm5hbEJ1c3koYnVzeSwgaXNSZWZyZXNoKSB7XG4gICAgICAgIHZhciAkdGFibGUgPSAkKCcjbWgtam91cm5hbC10YWJsZSB0YWJsZScpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmF0dHIoJ2FyaWEtYnVzeScsIGJ1c3kgPyAndHJ1ZScgOiAnZmFsc2UnKTtcbiAgICAgICAgJHRhYmxlLnRvZ2dsZUNsYXNzKCdpcy1yZWZyZXNoaW5nJywgQm9vbGVhbihidXN5ICYmIGlzUmVmcmVzaCkpO1xuICAgICAgICBpZiAoIWlzUmVmcmVzaCkge1xuICAgICAgICAgICAgaWYgKGJ1c3kpIHtcbiAgICAgICAgICAgICAgICByZW5kZXJTa2VsZXRvbigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtZXJyb3InKS5lbXB0eSgpO1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtZXJyb3ItcGxhY2Vob2xkZXInKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGpvdXJuYWxUYWJsZUhlYWQoKSB7XG4gICAgICAgIHJldHVybiAnPGNvbGdyb3VwPjxjb2wgc3R5bGU9XCJ3aWR0aDozNnB4XCI+PGNvbCBzdHlsZT1cIndpZHRoOjEwNHB4XCI+PGNvbCBzdHlsZT1cIndpZHRoOjI0MHB4XCI+PGNvbD48Y29sIHN0eWxlPVwid2lkdGg6MTYwcHhcIj48L2NvbGdyb3VwPidcbiAgICAgICAgICAgICsgJzx0aGVhZD48dHI+PHRoPjwvdGg+J1xuICAgICAgICAgICAgKyAnPHRoPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29sdW1uVGltZScpKSArICc8L3RoPidcbiAgICAgICAgICAgICsgJzx0aD4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbHVtbkV2ZW50JykpICsgJzwvdGg+J1xuICAgICAgICAgICAgKyAnPHRoPjwvdGg+J1xuICAgICAgICAgICAgKyAnPHRoPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29sdW1uRGVsaXZlcnknKSkgKyAnPC90aD4nXG4gICAgICAgICAgICArICc8L3RyPjwvdGhlYWQ+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJTa2VsZXRvbigpIHtcbiAgICAgICAgdmFyIHJvd3MgPSAnJztcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCAzOyBpKyspIHtcbiAgICAgICAgICAgIHJvd3MgKz0gJzx0ciBjbGFzcz1cIm1oLXNrZWwtcm93XCI+PHRkPjwvdGQ+PHRkPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6MzZweFwiPjwvc3Bhbj48L3RkPidcbiAgICAgICAgICAgICAgICArICc8dGQ+PHNwYW4gY2xhc3M9XCJtaC1za2VsXCIgc3R5bGU9XCJ3aWR0aDoxNjBweFwiPjwvc3Bhbj48L3RkPidcbiAgICAgICAgICAgICAgICArICc8dGQ+PHNwYW4gY2xhc3M9XCJtaC1za2VsXCIgc3R5bGU9XCJ3aWR0aDo3MCVcIj48L3NwYW4+PC90ZD4nXG4gICAgICAgICAgICAgICAgKyAnPHRkPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6OTZweDtoZWlnaHQ6MjBweDtib3JkZXItcmFkaXVzOjVweFwiPjwvc3Bhbj48L3RkPjwvdHI+JztcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmh0bWwoJzxkaXYgY2xhc3M9XCJtaC10YWJsZS13cmFwXCI+PHRhYmxlIGNsYXNzPVwidWkgdGFibGUgbWgtam91cm5hbC10YWJsZVwiIGFyaWEtYnVzeT1cInRydWVcIj4nXG4gICAgICAgICAgICArIGpvdXJuYWxUYWJsZUhlYWQoKSArICc8dGJvZHk+JyArIHJvd3MgKyAnPC90Ym9keT48L3RhYmxlPjwvZGl2PicpO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gam91cm5hbDogZGlzcGxheSBydWxlcyAocHJvYmVzIGhpZGRlbiwgY2FsbGJhY2tzIGZvbGRlZCBpbnRvIHRoZSBtaXNzZWQgY2FsbCkgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gaXNQcm9iZShpdGVtKSB7XG4gICAgICAgIHJldHVybiBCb29sZWFuKGl0ZW0gJiYgaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5wcm9iZSA9PT0gdHJ1ZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2FsbGJhY2tJbmRleChpdGVtcykge1xuICAgICAgICB2YXIgaW5kZXggPSB7fTtcbiAgICAgICAgKGl0ZW1zIHx8IFtdKS5mb3JFYWNoKGZ1bmN0aW9uIChpdGVtKSB7XG4gICAgICAgICAgICBpZiAoaXRlbS5ldmVudF90eXBlICE9PSAnY29yZS5taXNzZWRfY2FsbF9yZXNvbHZlZCcpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgY2FsbCA9IChpdGVtLnBheWxvYWQgJiYgaXRlbS5wYXlsb2FkLnN1YmplY3QgJiYgaXRlbS5wYXlsb2FkLnN1YmplY3QuY2FsbCkgfHwge307XG4gICAgICAgICAgICBpZiAoY2FsbC5taXNzZWRfbGlua2VkaWQgJiYgIWluZGV4W2NhbGwubWlzc2VkX2xpbmtlZGlkXSkge1xuICAgICAgICAgICAgICAgIGluZGV4W2NhbGwubWlzc2VkX2xpbmtlZGlkXSA9IGl0ZW0ub2NjdXJyZWRfYXQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gaW5kZXg7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2FsbGJhY2tUaW1lKGl0ZW0pIHtcbiAgICAgICAgdmFyIGNhbGwgPSAoaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5zdWJqZWN0ICYmIGl0ZW0ucGF5bG9hZC5zdWJqZWN0LmNhbGwpIHx8IHt9O1xuICAgICAgICBpZiAoY2FsbC5saW5rZWRpZCAmJiBzdGF0ZS5jYWxsYmFja3NbY2FsbC5saW5rZWRpZF0pIHtcbiAgICAgICAgICAgIHJldHVybiBzdGF0ZS5jYWxsYmFja3NbY2FsbC5saW5rZWRpZF07XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHJlc29sdmVkID0gMDtcbiAgICAgICAgKGl0ZW0uZGVsaXZlcmllcyB8fCBbXSkuZm9yRWFjaChmdW5jdGlvbiAoZGVsaXZlcnkpIHtcbiAgICAgICAgICAgIGlmIChkZWxpdmVyeS5yZXNvbHZlZF9hdCAmJiAocmVzb2x2ZWQgPT09IDAgfHwgZGVsaXZlcnkucmVzb2x2ZWRfYXQgPCByZXNvbHZlZCkpIHtcbiAgICAgICAgICAgICAgICByZXNvbHZlZCA9IGRlbGl2ZXJ5LnJlc29sdmVkX2F0O1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHJlc29sdmVkO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHZpc2libGVKb3VybmFsSXRlbXMoKSB7XG4gICAgICAgIHN0YXRlLmNhbGxiYWNrcyA9IGNhbGxiYWNrSW5kZXgoc3RhdGUubGFzdEl0ZW1zKTtcbiAgICAgICAgcmV0dXJuIHN0YXRlLmxhc3RJdGVtcy5maWx0ZXIoZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgICAgIGlmIChpdGVtLmV2ZW50X3R5cGUgPT09ICdjb3JlLm1pc3NlZF9jYWxsX3Jlc29sdmVkJykge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBzdGF0ZS5zaG93UHJvYmVzIHx8ICFpc1Byb2JlKGl0ZW0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJKb3VybmFsKCkge1xuICAgICAgICBoaWRlSm91cm5hbFN0YXRlcygpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvcicpLmVtcHR5KCk7XG4gICAgICAgIHJlbmRlckpvdXJuYWxCYW5uZXIoKTtcbiAgICAgICAgdmFyIGl0ZW1zID0gdmlzaWJsZUpvdXJuYWxJdGVtcygpO1xuXG4gICAgICAgIGlmIChpdGVtcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIGlmIChmaWx0ZXJzQWN0aXZlKCkpIHtcbiAgICAgICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lbXB0eS1maWx0ZXJlZCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lbXB0eScpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtdGFibGUnKS5lbXB0eSgpO1xuICAgICAgICAgICAgcmVuZGVyUGFnZXIoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBuYW1lcyA9IGV2ZW50VHlwZU5hbWVzKCk7XG4gICAgICAgIGlmICghbmFtZXNbJ2h1Yi50ZXN0J10pIHtcbiAgICAgICAgICAgIG5hbWVzWydodWIudGVzdCddID0gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRXZlbnRUeXBlVGVzdCcpO1xuICAgICAgICB9XG4gICAgICAgIHZhciByb3dzID0gJyc7XG4gICAgICAgIGl0ZW1zLmZvckVhY2goZnVuY3Rpb24gKGl0ZW0pIHtcbiAgICAgICAgICAgIHJvd3MgKz0gcmVuZGVyUm93KGl0ZW0sIG5hbWVzW2l0ZW0uZXZlbnRfdHlwZV0gfHwgaXRlbS5ldmVudF90eXBlKTtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5leHBhbmRlZElkID09PSBpdGVtLmlkKSB7XG4gICAgICAgICAgICAgICAgcm93cyArPSByZW5kZXJEZXRhaWxSb3coaXRlbSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmh0bWwoJzxkaXYgY2xhc3M9XCJtaC10YWJsZS13cmFwXCI+PHRhYmxlIGNsYXNzPVwidWkgc2VsZWN0YWJsZSB0YWJsZSBtaC1qb3VybmFsLXRhYmxlXCI+J1xuICAgICAgICAgICAgKyBqb3VybmFsVGFibGVIZWFkKCkgKyAnPHRib2R5PicgKyByb3dzICsgJzwvdGJvZHk+PC90YWJsZT48L2Rpdj4nKTtcblxuICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZSB0Ym9keSB0ci5taC1ldmVudC1yb3cnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB0b2dnbGVSb3coJCh0aGlzKS5kYXRhKCdpZCcpKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXRhYmxlJykub2ZmKCdjbGljay5yZXRyeScpLm9uKCdjbGljay5yZXRyeScsICdbZGF0YS1hY3Rpb249XCJyZXRyeS1ldmVudFwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgICB2YXIgZXZlbnRJZCA9ICQodGhpcykuZGF0YSgnZXZlbnQtaWQnKTtcbiAgICAgICAgICAgIHZhciAkYnV0dG9uID0gJCh0aGlzKS5wcm9wKCdkaXNhYmxlZCcsIHRydWUpO1xuICAgICAgICAgICAgYXBpUG9zdCgnL2V2ZW50cy8nICsgZXZlbnRJZCArICc6cmV0cnknLCB7fSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5UmV0cmllZCcsIHsgY291bnQ6IGRhdGEucmV0cmllZCB8fCAwIH0pKTtcbiAgICAgICAgICAgICAgICBsb2FkKCk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgICAgICRidXR0b24ucHJvcCgnZGlzYWJsZWQnLCBmYWxzZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICByZW5kZXJQYWdlcigpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGhpZGVKb3VybmFsU3RhdGVzKCkge1xuICAgICAgICAkKCcjbWgtam91cm5hbC1lbXB0eScpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1lbXB0eS1maWx0ZXJlZCcpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvci1wbGFjZWhvbGRlcicpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckxvYWRFcnJvcihmYWlsdXJlKSB7XG4gICAgICAgIHZhciBoaW50ID0gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vbkxvYWRFcnJvcicsIHtcbiAgICAgICAgICAgIHdoYXQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0xvYWRXaGF0RXZlbnRzJyksXG4gICAgICAgICAgICBjb2RlOiBmYWlsdXJlLnN0YXR1cyA+IDAgPyBmYWlsdXJlLnN0YXR1cyA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblRpbWVvdXQnKVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKHN0YXRlLmhhc0xvYWRlZCAmJiBzdGF0ZS5sYXN0SXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgLy8gZGF0YSBpcyBhbHJlYWR5IG9uIHRoZSBzY3JlZW46IGtlZXAgdGhlIHRhYmxlLCBzaG93IGEgYmFubmVyIGFib3ZlIGl0XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvcicpLmh0bWwoXG4gICAgICAgICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlXCIgcm9sZT1cImFsZXJ0XCI+JyArIElDT05fRVJST1JcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtZ3Jvd1wiPicgKyBlc2MoaGludCkgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgJzxidXR0b24gY2xhc3M9XCJ1aSBiYXNpYyBidXR0b24gbWgtb24tbWVzc2FnZVwiIHR5cGU9XCJidXR0b25cIiBpZD1cIm1oLWpvdXJuYWwtcmV0cnktaW5saW5lXCI+J1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblJldHJ5JykpICsgJzwvYnV0dG9uPjwvZGl2PidcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1yZXRyeS1pbmxpbmUnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IGxvYWQoKTsgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC10YWJsZScpLmVtcHR5KCk7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1wYWdlcicpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtZXJyb3ItcGxhY2Vob2xkZXItaGludCcpLnRleHQoaGludCk7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1lcnJvci1wbGFjZWhvbGRlcicpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiBwcm9ibGVtIGJhbm5lciBhbmQgdGhlIHVuZGVsaXZlcmVkIGNvdW50ZXIgb24gdGhlIHRhYiAtLS0tLS0tLS0tXG5cbiAgICAvLyBPbmUgcmVkIGxpbmUgYWJvdmUgdGhlIHRhYmxlIGluc3RlYWQgb2YgwqvQkdC+0YIg0YPQtNCw0LvRkdC9wrsgaW4gZXZlcnkgcm93IChkZXNpZ24gdjMsIMKr0JbRg9GA0L3QsNC7wrspLlxuICAgIGZ1bmN0aW9uIGJvdFByb2JsZW0oKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUuYm90cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGJvdCA9IHN0YXRlLmJvdHNbaV07XG4gICAgICAgICAgICBpZiAoYm90LmVuYWJsZWQgIT09IGZhbHNlICYmIGJvdC5zdGF0dXMgPT09ICd0b2tlbl9pbnZhbGlkJykge1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQ6IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9CYW5uZXJUb2tlbkludmFsaWQnLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICBib3Q6IGJvdC5ib3RfdXNlcm5hbWUgPyAnQCcgKyBib3QuYm90X3VzZXJuYW1lIDogJ8KrJyArIGJvdC50aXRsZSArICfCuydcbiAgICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgICAgIGJvdElkOiBOdW1iZXIoYm90LmlkKVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gYSBkZWxldGVkIGJvdCBpcyBvbmx5IHZpc2libGUgdGhyb3VnaCBpdHMgZmFpbGVkIGRlbGl2ZXJpZXMgKHRoZSBib3Qgcm93IGlzIGdvbmUpXG4gICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgc3RhdGUubGFzdEl0ZW1zLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICB2YXIgZGVsaXZlcmllcyA9IHN0YXRlLmxhc3RJdGVtc1tqXS5kZWxpdmVyaWVzIHx8IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgayA9IDA7IGsgPCBkZWxpdmVyaWVzLmxlbmd0aDsgaysrKSB7XG4gICAgICAgICAgICAgICAgaWYgKGRlbGl2ZXJpZXNba10uYm90X2RlbGV0ZWQgJiYgaXNGYWlsZWREZWxpdmVyeShkZWxpdmVyaWVzW2tdKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4geyB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9CYW5uZXJCb3REZWxldGVkJyksIGJvdElkOiAwIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckpvdXJuYWxCYW5uZXIoKSB7XG4gICAgICAgIHZhciBwcm9ibGVtID0gc3RhdGUuYm90c0xvYWRlZCA/IGJvdFByb2JsZW0oKSA6IG51bGw7XG4gICAgICAgIGlmIChwcm9ibGVtID09PSBudWxsKSB7XG4gICAgICAgICAgICAkKCcjbWgtam91cm5hbC1iYW5uZXInKS5lbXB0eSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC1qb3VybmFsLWJhbm5lcicpLmh0bWwoJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlIG1oLWJhbm5lclwiIHJvbGU9XCJhbGVydFwiPicgKyBJQ09OX0VSUk9SXG4gICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtZ3Jvd1wiPicgKyBlc2MocHJvYmxlbS50ZXh0KSArICc8L2Rpdj4nXG4gICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uIG1oLW9uLW1lc3NhZ2VcIiB0eXBlPVwiYnV0dG9uXCIgZGF0YS1hY3Rpb249XCJiYW5uZXItZml4XCIgZGF0YS1ib3QtaWQ9XCInICsgcHJvYmxlbS5ib3RJZCArICdcIj4nXG4gICAgICAgICAgICArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9CYW5uZXJDb25uZWN0JykpICsgJzwvYnV0dG9uPjwvZGl2PicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGlzRmFpbGVkRGVsaXZlcnkoZGVsaXZlcnkpIHtcbiAgICAgICAgcmV0dXJuIGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2ZhaWxlZCcgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnZHJvcHBlZCc7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNVbmRlbGl2ZXJlZChpdGVtKSB7XG4gICAgICAgIHJldHVybiAoaXRlbS5kZWxpdmVyaWVzIHx8IFtdKS5zb21lKGlzRmFpbGVkRGVsaXZlcnkpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGxvYWRKb3VybmFsQmFkZ2UoKSB7XG4gICAgICAgIGFwaUdldCgnL2V2ZW50cycsIHsgZGF0ZV9mcm9tOiBzdGFydE9mVG9kYXkoKSwgbGltaXQ6IDIwMCB9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgdmFyIGNvdW50ID0gKGRhdGEuaXRlbXMgfHwgW10pLmZpbHRlcihmdW5jdGlvbiAoaXRlbSkge1xuICAgICAgICAgICAgICAgIHJldHVybiAhaXNQcm9iZShpdGVtKSAmJiBpc1VuZGVsaXZlcmVkKGl0ZW0pO1xuICAgICAgICAgICAgfSkubGVuZ3RoO1xuICAgICAgICAgICAgJCgnI21oLWpvdXJuYWwtYmFkZ2UnKS50ZXh0KGNvdW50ID4gOTkgPyAnOTkrJyA6IFN0cmluZyhjb3VudCkpXG4gICAgICAgICAgICAgICAgLmF0dHIoJ2FyaWEtbGFiZWwnLCB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfSm91cm5hbEJhZGdlTGFiZWwnLCB7IGNvdW50OiBjb3VudCB9KSlcbiAgICAgICAgICAgICAgICAuYXR0cignaGlkZGVuJywgY291bnQgPiAwID8gbnVsbCA6IHRydWUpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoKSB7fSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBqb3VybmFsOiByb3dzIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGJyaWVmRm9yKGl0ZW0pIHtcbiAgICAgICAgdmFyIHN1YmplY3QgPSBpdGVtLnBheWxvYWQgJiYgaXRlbS5wYXlsb2FkLnN1YmplY3QgPyBpdGVtLnBheWxvYWQuc3ViamVjdCA6IHt9O1xuICAgICAgICB2YXIgZmFjdHMgPSBpdGVtLnBheWxvYWQgJiYgaXRlbS5wYXlsb2FkLmZhY3RzID8gaXRlbS5wYXlsb2FkLmZhY3RzIDoge307XG4gICAgICAgIHN3aXRjaCAoaXRlbS5ldmVudF90eXBlKSB7XG4gICAgICAgICAgICBjYXNlICdjb3JlLm1pc3NlZF9jYWxsJzpcbiAgICAgICAgICAgIGNhc2UgJ3ZvaWNlX2FnZW50LmNhbGxiYWNrX3JlcXVlc3QnOlxuICAgICAgICAgICAgICAgIHZhciBlbXBsb3llZXMgPSAoc3ViamVjdC5lbXBsb3llZXMgfHwgW10pLm1hcChzaG9ydEVtcGxveWVlKS5qb2luKCcsICcpO1xuICAgICAgICAgICAgICAgIHZhciBjbGllbnQgPSBzdWJqZWN0LmNsaWVudF9udW1iZXIgfHwgJyc7XG4gICAgICAgICAgICAgICAgaWYgKGNsaWVudCAhPT0gJycgJiYgZW1wbG95ZWVzICE9PSAnJykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gY2xpZW50ICsgJyDihpIgJyArIGVtcGxveWVlcztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNsaWVudCAhPT0gJycgPyBjbGllbnQgOiBlbXBsb3llZXM7XG4gICAgICAgICAgICBjYXNlICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJzpcbiAgICAgICAgICAgICAgICBpZiAoZmFjdHMuc2NvcmVzICYmIGZhY3RzLnNjb3Jlcy5xdWFsaXR5ICE9PSBudWxsICYmIGZhY3RzLnNjb3Jlcy5xdWFsaXR5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9CcmllZlNjb3JlJywgeyBzY29yZTogZmFjdHMuc2NvcmVzLnF1YWxpdHkgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBmYWN0cy5zdW1tYXJ5IHx8IHN1YmplY3QuY2xpZW50X251bWJlciB8fCAnJztcbiAgICAgICAgICAgIGNhc2UgJ2NvcmUucHJvdmlkZXJfZG93bic6XG4gICAgICAgICAgICBjYXNlICdjb3JlLnByb3ZpZGVyX3VwJzpcbiAgICAgICAgICAgICAgICB2YXIgcHJvdmlkZXIgPSBzdWJqZWN0LnByb3ZpZGVyIHx8IHt9O1xuICAgICAgICAgICAgICAgIHJldHVybiBwcm92aWRlci51c2VybmFtZSA/ICdTSVAgwqsnICsgcHJvdmlkZXIudXNlcm5hbWUgKyAnwrsnIDogKHByb3ZpZGVyLmhvc3QgfHwgcHJvdmlkZXIuaWQgfHwgJycpO1xuICAgICAgICAgICAgY2FzZSAnY29yZS5hZHZpY2UnOlxuICAgICAgICAgICAgICAgIHJldHVybiBmYWN0cy5zdW1tYXJ5IHx8IGFkdmljZVRleHQoc3ViamVjdC5hZHZpY2UgfHwge30pO1xuICAgICAgICAgICAgY2FzZSAnaHViLnRlc3QnOlxuICAgICAgICAgICAgICAgIHZhciB0ZXN0U3lzdGVtID0gc3ViamVjdC5zeXN0ZW0gfHwge307XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRlc3RTeXN0ZW0uYm90X3RpdGxlIHx8ICcnO1xuICAgICAgICAgICAgY2FzZSAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb2ZmbGluZSc6XG4gICAgICAgICAgICBjYXNlICdhaV9zdXBlcnZpc29yLndvcmtlcl9vbmxpbmUnOlxuICAgICAgICAgICAgICAgIHJldHVybiAoc3ViamVjdC53b3JrZXIgJiYgc3ViamVjdC53b3JrZXIubmFtZSkgfHwgZmFjdHMuc3VtbWFyeSB8fCAnJztcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhY3RzLnN1bW1hcnkgfHwgJyc7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyDCq9Cf0L7RgNGC0L3QvtCyINCQ0LvQtdC60YHQtdC5wrsgKDIwNCkg4oaSIMKr0J/QvtGA0YLQvdC+0LIg0JAuICgyMDQpwrssIGFzIGluIHRoZSBqb3VybmFsIG1vY2t1cFxuICAgIGZ1bmN0aW9uIHNob3J0RW1wbG95ZWUoZW1wbG95ZWUpIHtcbiAgICAgICAgdmFyIG5hbWUgPSBTdHJpbmcoZW1wbG95ZWUubmFtZSB8fCAnJykudHJpbSgpO1xuICAgICAgICB2YXIgcGFydHMgPSBuYW1lLnNwbGl0KC9cXHMrLyk7XG4gICAgICAgIGlmIChwYXJ0cy5sZW5ndGggPj0gMiAmJiBwYXJ0c1sxXSAhPT0gJycpIHtcbiAgICAgICAgICAgIG5hbWUgPSBwYXJ0c1swXSArICcgJyArIHBhcnRzWzFdLmNoYXJBdCgwKSArICcuJztcbiAgICAgICAgfVxuICAgICAgICBpZiAobmFtZSA9PT0gJycpIHtcbiAgICAgICAgICAgIHJldHVybiBTdHJpbmcoZW1wbG95ZWUubnVtYmVyIHx8ICcnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZW1wbG95ZWUubnVtYmVyID8gbmFtZSArICcgKCcgKyBlbXBsb3llZS5udW1iZXIgKyAnKScgOiBuYW1lO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZ1bGxFbXBsb3llZShlbXBsb3llZSkge1xuICAgICAgICByZXR1cm4gZW1wbG95ZWUubmFtZSA/IGVtcGxveWVlLm5hbWUgKyAoZW1wbG95ZWUubnVtYmVyID8gJyAoJyArIGVtcGxveWVlLm51bWJlciArICcpJyA6ICcnKSA6IFN0cmluZyhlbXBsb3llZS5udW1iZXIgfHwgJycpO1xuICAgIH1cblxuICAgIC8vIENvcmUgYWR2aWNlIHRleHQ6IHRoZSBhZG1pbiBjYWJpbmV0IGFscmVhZHkgaGFzIHRoZSBDb3JlIGNhdGFsb2cgaW4gZ2xvYmFsVHJhbnNsYXRlXG4gICAgLy8gKHRlbXBsYXRlcyBsaWtlIFwi4oCmIDxhIGhyZWY9JyV1cmwlJz4ldmVyJTwvYT5cIik7IHN1YnN0aXR1dGUgcGFyYW1zIGFuZCBkcm9wIHRoZSBtYXJrdXAgYXMgcGxhaW4gdGV4dC5cbiAgICBmdW5jdGlvbiBhZHZpY2VUZXh0KGFkdmljZSkge1xuICAgICAgICB2YXIgdHBsID0gKGFkdmljZSAmJiBhZHZpY2UubWVzc2FnZV90cGwpIHx8ICcnO1xuICAgICAgICB2YXIgdGV4dCA9IHQodHBsKTtcbiAgICAgICAgaWYgKHRwbCA9PT0gJycgfHwgdGV4dCA9PT0gdHBsKSB7XG4gICAgICAgICAgICByZXR1cm4gdHBsO1xuICAgICAgICB9XG4gICAgICAgIHZhciBwYXJhbXMgPSAoYWR2aWNlICYmIGFkdmljZS5wYXJhbXMpIHx8IHt9O1xuICAgICAgICBPYmplY3Qua2V5cyhwYXJhbXMpLmZvckVhY2goZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgICAgIHRleHQgPSB0ZXh0LnNwbGl0KCclJyArIG5hbWUgKyAnJScpLmpvaW4oU3RyaW5nKHBhcmFtc1tuYW1lXSkpO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gTmV2ZXIgcGFyc2UgYXMgSFRNTCAocGFyYW1zIG1heSBjYXJyeSB1c2VyLWVudGVyZWQgbmFtZXMpOiBzdHJpcCB0YWdzIGFzIHRleHQsIG91dHB1dCBpcyBlc2NhcGVkIGxhdGVyLlxuICAgICAgICByZXR1cm4gdGV4dC5yZXBsYWNlKC88W14+XSo+L2csICcnKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZuYnNwOy9nLCAnICcpLnJlcGxhY2UoLyZxdW90Oy9nLCAnXCInKS5yZXBsYWNlKC8mIzAzOTt8JiMzOTsvZywgXCInXCIpXG4gICAgICAgICAgICAucmVwbGFjZSgvJmx0Oy9nLCAnPCcpLnJlcGxhY2UoLyZndDsvZywgJz4nKS5yZXBsYWNlKC8mYW1wOy9nLCAnJicpXG4gICAgICAgICAgICAucmVwbGFjZSgvXFxzKy9nLCAnICcpLnRyaW0oKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJSb3coaXRlbSwgZXZlbnROYW1lKSB7XG4gICAgICAgIHZhciBwcm9iZSA9IGlzUHJvYmUoaXRlbSkgPyAnPHNwYW4gY2xhc3M9XCJtaC1wcm9iZVwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUHJvYmVUYWcnKSkgKyAnPC9zcGFuPicgOiAnJztcbiAgICAgICAgdmFyIGJyaWVmID0gYnJpZWZGb3IoaXRlbSk7XG4gICAgICAgIHZhciBleHBhbmRlZCA9IHN0YXRlLmV4cGFuZGVkSWQgPT09IGl0ZW0uaWQ7XG4gICAgICAgIHJldHVybiAnPHRyIGNsYXNzPVwibWgtZXZlbnQtcm93JyArIChleHBhbmRlZCA/ICcgYWN0aXZlJyA6ICcnKSArICdcIiBkYXRhLWlkPVwiJyArIGl0ZW0uaWQgKyAnXCIgYXJpYS1leHBhbmRlZD1cIicgKyAoZXhwYW5kZWQgPyAndHJ1ZScgOiAnZmFsc2UnKSArICdcIj4nXG4gICAgICAgICAgICArICc8dGQgY2xhc3M9XCJtaC1jaGV2cm9uLWNlbGxcIj4nICsgSUNPTl9DSEVWUk9OICsgJzwvdGQ+J1xuICAgICAgICAgICAgKyAnPHRkIGNsYXNzPVwibWgtY2VsbC10aW1lXCI+JyArIGZtdENlbGxUaW1lKGl0ZW0ub2NjdXJyZWRfYXQpICsgJzwvdGQ+J1xuICAgICAgICAgICAgKyAnPHRkPjxkaXYgY2xhc3M9XCJtaC1ldmVudC1jZWxsXCI+PHNwYW4gY2xhc3M9XCJtaC10cnVuY2F0ZVwiIHRpdGxlPVwiJyArIGVzYyhldmVudE5hbWUpICsgJ1wiPicgKyBlc2MoZXZlbnROYW1lKSArICc8L3NwYW4+JyArIHByb2JlICsgJzwvZGl2PjwvdGQ+J1xuICAgICAgICAgICAgKyAnPHRkIGNsYXNzPVwibWgtdHJ1bmNhdGUgbWgtbXV0ZWRcIiB0aXRsZT1cIicgKyBlc2MoYnJpZWYpICsgJ1wiPicgKyBlc2MoYnJpZWYpICsgJzwvdGQ+J1xuICAgICAgICAgICAgKyAnPHRkPicgKyBkZWxpdmVyeUNlbGwoaXRlbSkgKyAnPC90ZD4nXG4gICAgICAgICAgICArICc8L3RyPic7XG4gICAgfVxuXG4gICAgLy8gM+KAkzQgaHVtYW4gZmllbGRzOyB0ZWNobmljYWwgb25lcyAoZXZlbnQgdHlwZSwgY2FsbCBJRCwgc291cmNlKSBzdGF5IG91dCBvZiB0aGUgaW50ZXJmYWNlLlxuICAgIGZ1bmN0aW9uIGRldGFpbEZpZWxkcyhpdGVtKSB7XG4gICAgICAgIHZhciBzdWJqZWN0ID0gaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5zdWJqZWN0ID8gaXRlbS5wYXlsb2FkLnN1YmplY3QgOiB7fTtcbiAgICAgICAgdmFyIGZhY3RzID0gaXRlbS5wYXlsb2FkICYmIGl0ZW0ucGF5bG9hZC5mYWN0cyA/IGl0ZW0ucGF5bG9hZC5mYWN0cyA6IHt9O1xuICAgICAgICB2YXIgZmllbGRzID0gW107XG4gICAgICAgIHZhciBlbXBsb3llZXMgPSAoc3ViamVjdC5lbXBsb3llZXMgfHwgW10pLm1hcChmdWxsRW1wbG95ZWUpLmpvaW4oJywgJyk7XG4gICAgICAgIGlmIChlbXBsb3llZXMgIT09ICcnKSB7IGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxFbXBsb3llZScpLCBlbXBsb3llZXNdKTsgfVxuICAgICAgICBpZiAoc3ViamVjdC5jbGllbnRfbnVtYmVyKSB7IGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxDbGllbnQnKSwgc3ViamVjdC5jbGllbnRfbnVtYmVyXSk7IH1cbiAgICAgICAgaWYgKGl0ZW0uZXZlbnRfdHlwZSA9PT0gJ2NvcmUubWlzc2VkX2NhbGwnKSB7XG4gICAgICAgICAgICB2YXIgY2FsbGJhY2sgPSBjYWxsYmFja1RpbWUoaXRlbSk7XG4gICAgICAgICAgICBpZiAoY2FsbGJhY2sgPiAwKSB7XG4gICAgICAgICAgICAgICAgZmllbGRzLnB1c2goW3QoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RldGFpbENhbGxlZEJhY2snKSwgZm10Q2VsbFRleHQoY2FsbGJhY2spXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHByb3ZpZGVyID0gc3ViamVjdC5wcm92aWRlciB8fCB7fTtcbiAgICAgICAgaWYgKHByb3ZpZGVyLnVzZXJuYW1lIHx8IHByb3ZpZGVyLmhvc3QpIHtcbiAgICAgICAgICAgIGZpZWxkcy5wdXNoKFt0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZXRhaWxQcm92aWRlcicpLCAocHJvdmlkZXIudXNlcm5hbWUgfHwgJycpICsgKHByb3ZpZGVyLmhvc3QgPyAnIMK3ICcgKyBwcm92aWRlci5ob3N0IDogJycpXSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN1YmplY3QuYWR2aWNlICYmIHN1YmplY3QuYWR2aWNlLm1lc3NhZ2VfdHBsICYmICFmYWN0cy5zdW1tYXJ5KSB7XG4gICAgICAgICAgICBmaWVsZHMucHVzaChbdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGV0YWlsU3VtbWFyeScpLCBhZHZpY2VUZXh0KHN1YmplY3QuYWR2aWNlKV0pO1xuICAgICAgICB9XG4gICAgICAgIGlmIChmYWN0cy5zY29yZXMgJiYgZmFjdHMuc2NvcmVzLnF1YWxpdHkgIT09IG51bGwgJiYgZmFjdHMuc2NvcmVzLnF1YWxpdHkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZmllbGRzLnB1c2goW3QoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RldGFpbFNjb3JlJyksIGZhY3RzLnNjb3Jlcy5xdWFsaXR5XSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGZhY3RzLnN1bW1hcnkpIHsgZmllbGRzLnB1c2goW3QoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RldGFpbFN1bW1hcnknKSwgZmFjdHMuc3VtbWFyeV0pOyB9XG4gICAgICAgIGlmICgoZmFjdHMucmVhc29ucyB8fCBbXSkubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgZmllbGRzLnB1c2goW3QoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RldGFpbFJlYXNvbnMnKSwgZmFjdHMucmVhc29ucy5qb2luKCc7ICcpXSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZpZWxkcztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmbXRDZWxsVGV4dCh0cykge1xuICAgICAgICBpZiAoaXNUb2RheSh0cykpIHtcbiAgICAgICAgICAgIHJldHVybiBmbXRUaW1lKHRzKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZm10RGF0ZSh0cykgKyAnICcgKyBmbXRUaW1lKHRzKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJEZXRhaWxSb3coaXRlbSkge1xuICAgICAgICB2YXIgaHRtbCA9ICc8ZGwgY2xhc3M9XCJtaC1maWVsZHNcIj4nO1xuICAgICAgICBkZXRhaWxGaWVsZHMoaXRlbSkuZm9yRWFjaChmdW5jdGlvbiAocGFpcikge1xuICAgICAgICAgICAgaHRtbCArPSAnPGR0PicgKyBlc2MocGFpclswXSkgKyAnPC9kdD48ZGQ+JyArIGVzYyhwYWlyWzFdKSArICc8L2RkPic7XG4gICAgICAgIH0pO1xuICAgICAgICB2YXIgcmV0cnlhYmxlID0gZmFsc2U7XG4gICAgICAgIChpdGVtLmRlbGl2ZXJpZXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24gKGRlbGl2ZXJ5KSB7XG4gICAgICAgICAgICB2YXIgc3RhdHVzID0gZGVsaXZlcnlTdGF0dXNUZXh0KGRlbGl2ZXJ5KTtcbiAgICAgICAgICAgIHZhciBhdWRpbyA9IGF0dGFjaG1lbnRMaW5lKGRlbGl2ZXJ5KTtcbiAgICAgICAgICAgIHZhciByYXdDb2RlID0gZGVsaXZlcnkubGFzdF9lcnJvcl9jb2RlIHx8ICcnO1xuICAgICAgICAgICAgaHRtbCArPSAnPGR0IGNsYXNzPVwibWgtdHJ1bmNhdGVcIj4nICsgZXNjKHJlY2lwaWVudFRpdGxlKGRlbGl2ZXJ5KSkgKyAnPC9kdD4nXG4gICAgICAgICAgICAgICAgKyAnPGRkJyArIChzdGF0dXMuYmFkID8gJyBjbGFzcz1cIm1oLWVycm9yLXRleHRcIicgOiAnJykgKyAocmF3Q29kZSAhPT0gJycgPyAnIHRpdGxlPVwiJyArIGVzYyhyYXdDb2RlKS5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7JykgKyAnXCInIDogJycpICsgJz4nXG4gICAgICAgICAgICAgICAgKyBlc2Moc3RhdHVzLnRleHQpXG4gICAgICAgICAgICAgICAgKyAoYXVkaW8gPyAnPGRpdiBjbGFzcz1cIm1oLW1ldGEnICsgKGF1ZGlvLmJhZCA/ICcgbWgtZXJyb3ItdGV4dCcgOiAnJykgKyAnXCInXG4gICAgICAgICAgICAgICAgICAgICsgKGF1ZGlvLmNvZGUgIT09ICcnID8gJyB0aXRsZT1cIicgKyBlc2MoYXVkaW8uY29kZSkucmVwbGFjZSgvXCIvZywgJyZxdW90OycpICsgJ1wiJyA6ICcnKSArICc+JyArIGVzYyhhdWRpby50ZXh0KSArICc8L2Rpdj4nIDogJycpXG4gICAgICAgICAgICAgICAgKyAnPC9kZD4nO1xuICAgICAgICAgICAgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2ZhaWxlZCcgJiYgIWRlbGl2ZXJ5LmJvdF9kZWxldGVkICYmICFkZWxpdmVyeS5jaGF0X2RlbGV0ZWQpIHtcbiAgICAgICAgICAgICAgICByZXRyeWFibGUgPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgaHRtbCArPSAnPC9kbD4nO1xuICAgICAgICBpZiAocmV0cnlhYmxlKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8YnV0dG9uIGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uXCIgdHlwZT1cImJ1dHRvblwiIGRhdGEtYWN0aW9uPVwicmV0cnktZXZlbnRcIiBkYXRhLWV2ZW50LWlkPVwiJyArIGl0ZW0uaWQgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5UmV0cnknKSkgKyAnPC9idXR0b24+JztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJzx0ciBjbGFzcz1cIm1oLWRldGFpbFwiIGRhdGEtZGV0YWlsLWZvcj1cIicgKyBpdGVtLmlkICsgJ1wiPjx0ZCBjb2xzcGFuPVwiNVwiPjxkaXYgY2xhc3M9XCJtaC1kZXRhaWwtYm9keVwiPicgKyBodG1sICsgJzwvZGl2PjwvdGQ+PC90cj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlY2lwaWVudFRpdGxlKGRlbGl2ZXJ5KSB7XG4gICAgICAgIGlmIChkZWxpdmVyeS5jaGF0X3RpdGxlKSB7XG4gICAgICAgICAgICByZXR1cm4gZGVsaXZlcnkuY2hhdF90aXRsZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuY2hhdF9kZWxldGVkKSB7XG4gICAgICAgICAgICByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlDaGF0RGVsZXRlZCcpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBkZWxpdmVyeS5leHRlcm5hbF9jaGF0X2lkIHx8ICfigJQnO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlbGl2ZXJ5Q291bnRzKGl0ZW0pIHtcbiAgICAgICAgdmFyIGNvdW50cyA9IHsgdG90YWw6IDAsIHNlbnQ6IDAsIGZhaWxlZDogMCwgcGVuZGluZzogMCwgcmVzb2x2ZWQ6IDAgfTtcbiAgICAgICAgKGl0ZW0uZGVsaXZlcmllcyB8fCBbXSkuZm9yRWFjaChmdW5jdGlvbiAoZGVsaXZlcnkpIHtcbiAgICAgICAgICAgIGNvdW50cy50b3RhbCsrO1xuICAgICAgICAgICAgaWYgKGlzRmFpbGVkRGVsaXZlcnkoZGVsaXZlcnkpKSB7IGNvdW50cy5mYWlsZWQrKzsgfVxuICAgICAgICAgICAgZWxzZSBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAncGVuZGluZycgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnc2VuZGluZycpIHsgY291bnRzLnBlbmRpbmcrKzsgfVxuICAgICAgICAgICAgZWxzZSBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAnY2FuY2VsbGVkJykgeyBjb3VudHMucmVzb2x2ZWQrKzsgfVxuICAgICAgICAgICAgZWxzZSB7IGNvdW50cy5zZW50Kys7IH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBjb3VudHM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZGVsaXZlcnlDZWxsKGl0ZW0pIHtcbiAgICAgICAgdmFyIGMgPSBkZWxpdmVyeUNvdW50cyhpdGVtKTtcbiAgICAgICAgaWYgKGMudG90YWwgPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1tdXRlZFwiPuKAlDwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjLmZhaWxlZCA+IDApIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgSUNPTl9FUlJPUiArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeU5vdERlbGl2ZXJlZCcpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYy5wZW5kaW5nID4gMCkge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIm1oLWRvdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdFF1ZXVlZCcpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYy5zZW50ID09PSAwICYmIGMucmVzb2x2ZWQgPiAwKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwibWgtZG90XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeUNhbGxlZEJhY2snKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIm1oLWRvdCBpcy1va1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdERlbGl2ZXJlZCcpKSArICc8L3NwYW4+JztcbiAgICB9XG5cbiAgICAvLyBPbmUgbGluZSBwZXIgcmVjaXBpZW50OiBzdGF0dXMg4oCUIHJlYXNvbi5cbiAgICBmdW5jdGlvbiBkZWxpdmVyeVN0YXR1c1RleHQoZGVsaXZlcnkpIHtcbiAgICAgICAgaWYgKGlzRmFpbGVkRGVsaXZlcnkoZGVsaXZlcnkpKSB7XG4gICAgICAgICAgICB2YXIgcmVhc29uID0gZGVsaXZlcnlSZWFzb24oZGVsaXZlcnkpO1xuICAgICAgICAgICAgcmV0dXJuIHsgYmFkOiB0cnVlLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeU5vdERlbGl2ZXJlZCcpICsgKHJlYXNvbiAhPT0gJycgPyAnIMK3ICcgKyByZWFzb24gOiAnJykgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAncGVuZGluZycgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnc2VuZGluZycpIHtcbiAgICAgICAgICAgIHJldHVybiB7IGJhZDogZmFsc2UsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3RRdWV1ZWQnKSArIChkZWxpdmVyeS5uZXh0X2F0dGVtcHRfYXQgPiAwXG4gICAgICAgICAgICAgICAgPyAnIMK3ICcgKyB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlOZXh0JywgeyB0aW1lOiBmbXRDZWxsVGV4dChkZWxpdmVyeS5uZXh0X2F0dGVtcHRfYXQpIH0pXG4gICAgICAgICAgICAgICAgOiAnJykgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAnY2FuY2VsbGVkJykge1xuICAgICAgICAgICAgcmV0dXJuIHsgYmFkOiBmYWxzZSwgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlTdGF0dXNDYW5jZWxsZWQnKSB9O1xuICAgICAgICB9XG4gICAgICAgIGlmIChkZWxpdmVyeS5zdGF0dXMgPT09ICdyZXRyYWN0ZWQnKSB7XG4gICAgICAgICAgICByZXR1cm4geyBiYWQ6IGZhbHNlLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeVN0YXR1c1JldHJhY3RlZCcpIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ3JldHJhY3RfZmFpbGVkJykge1xuICAgICAgICAgICAgcmV0dXJuIHsgYmFkOiB0cnVlLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9EZWxpdmVyeVN0YXR1c1JldHJhY3RGYWlsZWQnKSB9O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7IGJhZDogZmFsc2UsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3REZWxpdmVyZWQnKSB9O1xuICAgIH1cblxuICAgIC8vIE5vcm1hbGlzZWQgZGVsaXZlcnkvYXR0YWNobWVudCBjb2RlcyAtPiByZWFkYWJsZSB0ZXh0LiBUaGUgcmF3IGNvZGUgc3RheXMgYXZhaWxhYmxlIGluIGEgdG9vbHRpcCBvbmx5LlxuICAgIHZhciBDT0RFX1RFWFRfS0VZUyA9IHtcbiAgICAgICAgJ2F0dGFjaG1lbnQuY29udmVydGVyX21pc3NpbmcnOiAnUmVhc29uTm9Db252ZXJ0ZXInLFxuICAgICAgICAnYXR0YWNobWVudC5jb252ZXJzaW9uX2ZhaWxlZCc6ICdSZWFzb25Db252ZXJ0JyxcbiAgICAgICAgJ2F0dGFjaG1lbnQuY29udmVyc2lvbl90aW1lb3V0JzogJ1JlYXNvbkNvbnZlcnQnLFxuICAgICAgICAnYXR0YWNobWVudC5wcmVwYXJlX2ZhaWxlZCc6ICdSZWFzb25Db252ZXJ0JyxcbiAgICAgICAgJ2F0dGFjaG1lbnQuY2FjaGVfdW5hdmFpbGFibGUnOiAnUmVhc29uQ29udmVydCcsXG4gICAgICAgICdhdHRhY2htZW50LmJ1c3knOiAnUmVhc29uQ29udmVydCcsXG4gICAgICAgICdhdHRhY2htZW50LnRvb19iaWcnOiAnUmVhc29uVG9vQmlnJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQuZHVyYXRpb25fdG9vX2xvbmcnOiAnUmVhc29uVG9vQmlnJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQuc291cmNlX21pc3NpbmcnOiAnUmVhc29uTm9SZWNvcmRpbmcnLFxuICAgICAgICAnYXR0YWNobWVudC5wYXRoX21pc3NpbmcnOiAnUmVhc29uTm9SZWNvcmRpbmcnLFxuICAgICAgICAnYXR0YWNobWVudC5wYXRoX3JlamVjdGVkJzogJ1JlYXNvbkZpbGVVbmF2YWlsYWJsZScsXG4gICAgICAgICdhdHRhY2htZW50LnVuYXZhaWxhYmxlJzogJ1JlYXNvbkZpbGVVbmF2YWlsYWJsZScsXG4gICAgICAgICd0ZWxlZ3JhbS5maWxlX3VuYXZhaWxhYmxlJzogJ1JlYXNvbkZpbGVVbmF2YWlsYWJsZScsXG4gICAgICAgICdhdHRhY2htZW50LnF1b3Rlc19taXNzaW5nJzogJ1JlYXNvbk5vUXVvdGVzJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQudW5jZXJ0YWluJzogJ1JlYXNvblVuY2VydGFpbicsXG4gICAgICAgICdkZWxpdmVyeS51bmNlcnRhaW4nOiAnUmVhc29uVW5jZXJ0YWluJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQucmV0cnlfZXhoYXVzdGVkJzogJ1JlYXNvblJldHJpZXMnLFxuICAgICAgICAnZGVsaXZlcnkuaW5jb21wbGV0ZSc6ICdSZWFzb25SZXRyaWVzJyxcbiAgICAgICAgJ2F0dGFjaG1lbnQucmVqZWN0ZWQnOiAnUmVhc29uUmVqZWN0ZWQnLFxuICAgICAgICAnaHR0cC5iYWRfcmVxdWVzdCc6ICdSZWFzb25SZWplY3RlZCcsXG4gICAgICAgICdhdHRhY2htZW50Lm5vdC5yZWFkeSc6ICdSZWFzb25Ob3RSZWFkeScsXG4gICAgICAgICdtYXguYXR0YWNobWVudC5ub3RfcmVhZHknOiAnUmVhc29uTm90UmVhZHknLFxuICAgICAgICAnYXR0YWNobWVudC5jYW5jZWxsZWQnOiAnUmVhc29uQ2FuY2VsbGVkJyxcbiAgICAgICAgJ2h0dHAuY29ubmVjdF9mYWlsZWQnOiAnUmVhc29uTm9Db25uZWN0aW9uJyxcbiAgICAgICAgJ2h0dHAudGltZW91dCc6ICdSZWFzb25Ob0Nvbm5lY3Rpb24nLFxuICAgICAgICAnaHR0cC51bmF2YWlsYWJsZSc6ICdSZWFzb25Ob0Nvbm5lY3Rpb24nLFxuICAgICAgICAnaHR0cC50bHMnOiAnUmVhc29uTm9Db25uZWN0aW9uJ1xuICAgIH07XG5cbiAgICBmdW5jdGlvbiBjb2RlVGV4dChjb2RlKSB7XG4gICAgICAgIHZhciBrZXkgPSBDT0RFX1RFWFRfS0VZU1tjb2RlXTtcbiAgICAgICAgcmV0dXJuIGtleSA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViXycgKyBrZXkpIDogY29kZTtcbiAgICB9XG5cbiAgICAvLyBcIlJlY29yZGluZzogc2VudCAvIHJlcGxhY2VkIGJ5IGEgbm90ZSAvIHNraXBwZWQgwrcgcmVhc29uXCI7IG51bGwgd2hlbiB0aGUgZGVsaXZlcnkgY2FycmllcyBubyBhdWRpby5cbiAgICBmdW5jdGlvbiBhdHRhY2htZW50TGluZShkZWxpdmVyeSkge1xuICAgICAgICB2YXIgYSA9IGRlbGl2ZXJ5LmF0dGFjaG1lbnQ7XG4gICAgICAgIGlmICghYSB8fCAhYS5zdGF0ZSB8fCBhLnN0YXRlID09PSAnbm9uZScpIHsgcmV0dXJuIG51bGw7IH1cbiAgICAgICAgdmFyIHRleHQ7XG4gICAgICAgIHZhciBiYWQgPSBmYWxzZTtcbiAgICAgICAgdmFyIHRvdGFsID0gTnVtYmVyKGEucGFydHMpIHx8IDA7XG4gICAgICAgIGlmIChhLnN0YXRlID09PSAncGVuZGluZycpIHtcbiAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hRdWV1ZWQnKTtcbiAgICAgICAgfSBlbHNlIGlmIChhLnN0YXRlID09PSAnc2VudCcpIHtcbiAgICAgICAgICAgIHRleHQgPSB0b3RhbCA+IDFcbiAgICAgICAgICAgICAgICA/IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hQYXJ0aWFsJywgeyBzZW50OiBhLnNlbnQsIHRvdGFsOiB0b3RhbCB9KVxuICAgICAgICAgICAgICAgIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQXR0YWNoU2VudCcpO1xuICAgICAgICB9IGVsc2UgaWYgKGEuc3RhdGUgPT09ICdwYXJ0aWFsJykge1xuICAgICAgICAgICAgdGV4dCA9IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hQYXJ0aWFsJywgeyBzZW50OiBhLnNlbnQsIHRvdGFsOiB0b3RhbCB9KTtcbiAgICAgICAgfSBlbHNlIGlmIChhLnN0YXRlID09PSAnc2tpcHBlZCcpIHtcbiAgICAgICAgICAgIC8vIHRoZSBmYWxsYmFjayBub3RlIGluIHRoZSB0ZXh0IHRlbGxzIHdoZXJlIHRoZSByZWNvcmRpbmcgY2FuIGJlIGZvdW5kXG4gICAgICAgICAgICB0ZXh0ID0gYS5ub3RlID09PSAnc2VudCcgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hSZXBsYWNlZCcpIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQXR0YWNoU2tpcHBlZCcpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGV4dCA9IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0F0dGFjaEZhaWxlZCcpO1xuICAgICAgICAgICAgYmFkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYS5jb2RlICYmIGEuc3RhdGUgIT09ICdwZW5kaW5nJyAmJiBhLnN0YXRlICE9PSAnc2VudCcpIHtcbiAgICAgICAgICAgIHRleHQgKz0gJyDCtyAnICsgY29kZVRleHQoYS5jb2RlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geyB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9BdHRhY2hMYWJlbCcpICsgJzogJyArIHRleHQsIGNvZGU6IGEuY29kZSB8fCAnJywgYmFkOiBiYWQgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZWxpdmVyeVJlYXNvbihkZWxpdmVyeSkge1xuICAgICAgICBpZiAoZGVsaXZlcnkuYm90X2RlbGV0ZWQpIHsgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5Qm90RGVsZXRlZCcpOyB9XG4gICAgICAgIGlmIChkZWxpdmVyeS5jaGF0X2RlbGV0ZWQpIHsgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0RlbGl2ZXJ5Q2hhdERlbGV0ZWQnKTsgfVxuICAgICAgICB2YXIgY29kZSA9IGRlbGl2ZXJ5Lmxhc3RfZXJyb3JfY29kZSB8fCAnJztcbiAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MDEudW5hdXRob3JpemVkJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzVG9rZW5JbnZhbGlkJyk7IH1cbiAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MDMua2lja2VkJyB8fCBjb2RlID09PSAndGVsZWdyYW0uNDAzLmJsb2NrZWQnIHx8IGNvZGUgPT09ICd0ZWxlZ3JhbS40MDAuY2hhdF9ub3RfZm91bmQnXG4gICAgICAgICAgICB8fCBjb2RlID09PSAnbWF4LjQwMy5jaGF0X2RlbmllZCcgfHwgY29kZSA9PT0gJ21heC40MDQubm90X2ZvdW5kJyB8fCBjb2RlID09PSAnbWF4LjQwNC51bmtub3duJykge1xuICAgICAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRTdGF0dXNHb25lJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGNvZGVUZXh0KGNvZGUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHRvZ2dsZVJvdyhpZCkge1xuICAgICAgICBzdGF0ZS5leHBhbmRlZElkID0gc3RhdGUuZXhwYW5kZWRJZCA9PT0gaWQgPyBudWxsIDogaWQ7XG4gICAgICAgIHJlbmRlckpvdXJuYWwoKTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGpvdXJuYWw6IHBhZ2VyIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIHJlbmRlclBhZ2VyKCkge1xuICAgICAgICB2YXIgJHBhZ2VyID0gJCgnI21oLWpvdXJuYWwtcGFnZXInKTtcbiAgICAgICAgaWYgKHN0YXRlLmxhc3RJdGVtcy5sZW5ndGggPT09IDAgfHwgc3RhdGUudG90YWwgPD0gUEFHRV9MSU1JVCkge1xuICAgICAgICAgICAgJHBhZ2VyLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICRwYWdlci5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtcGFnZS1pbmZvJykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfRXZlbnRzUGFnZScsIHtcbiAgICAgICAgICAgIGZyb206IHN0YXRlLm9mZnNldCArIDEsXG4gICAgICAgICAgICB0bzogc3RhdGUub2Zmc2V0ICsgc3RhdGUubGFzdEl0ZW1zLmxlbmd0aCxcbiAgICAgICAgICAgIHRvdGFsOiBzdGF0ZS50b3RhbFxuICAgICAgICB9KSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXByZXYnKS5hdHRyKCdkaXNhYmxlZCcsIHN0YXRlLm9mZnNldCA8PSAwKTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtbmV4dCcpLmF0dHIoJ2Rpc2FibGVkJywgc3RhdGUub2Zmc2V0ICsgc3RhdGUubGFzdEl0ZW1zLmxlbmd0aCA+PSBzdGF0ZS50b3RhbCk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBzZXR0aW5ncyB0YWIgLS0tLS0tLS0tLVxuXG4gICAgLy8gRmllbGRzIGNhcnJ5IG5vIGhpbnRzIChkZXNpZ24gdjMpOyB0aGUgaGVscCBsaW5lIHVuZGVyIGEgZmllbGQgaXMgdXNlZCBvbmx5IGZvciBpdHMgZXJyb3IuXG4gICAgZnVuY3Rpb24gbWFya0ZpZWxkRXJyb3IoZmllbGRTZWxlY3RvciwgbWVzc2FnZSkge1xuICAgICAgICAkKGZpZWxkU2VsZWN0b3IpLmFkZENsYXNzKCdlcnJvcicpLmZpbmQoJy5taC1oZWxwJykudGV4dChtZXNzYWdlIHx8ICcnKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjbGVhckZpZWxkRXJyb3IoZmllbGRTZWxlY3Rvcikge1xuICAgICAgICAkKGZpZWxkU2VsZWN0b3IpLnJlbW92ZUNsYXNzKCdlcnJvcicpLmZpbmQoJy5taC1oZWxwJykudGV4dCgnJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbWFya1JldGVudGlvbkVycm9yKG1lc3NhZ2UpIHtcbiAgICAgICAgbWFya0ZpZWxkRXJyb3IoJyNtaC1yZXRlbnRpb24tZmllbGQnLCBtZXNzYWdlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjbGVhclJldGVudGlvbkVycm9yKCkge1xuICAgICAgICBjbGVhckZpZWxkRXJyb3IoJyNtaC1yZXRlbnRpb24tZmllbGQnKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlUmV0ZW50aW9uKCkge1xuICAgICAgICB2YXIgcmF3ID0gU3RyaW5nKCQoJyNtaC1yZXRlbnRpb24taW5wdXQnKS52YWwoKSB8fCAnJykudHJpbSgpO1xuICAgICAgICB2YXIgZGF5cyA9IC9eXFxkKyQvLnRlc3QocmF3KSA/IHBhcnNlSW50KHJhdywgMTApIDogLTE7XG4gICAgICAgIGlmIChkYXlzIDwgMSB8fCBkYXlzID4gMzY1KSB7XG4gICAgICAgICAgICBtYXJrUmV0ZW50aW9uRXJyb3IodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NldHRpbmdzUmV0ZW50aW9uRXJyb3InLCB7fSkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNsZWFyUmV0ZW50aW9uRXJyb3IoKTtcbiAgICAgICAgYXBpUGF0Y2goJy9zZXR0aW5ncycsIHsgZXZlbnRzX3JldGVudGlvbl9kYXlzOiBkYXlzIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLnJldGVudGlvbiA9IGRheXM7XG4gICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZWQnKSk7XG4gICAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIG1hcmtSZXRlbnRpb25FcnJvcih0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uTG9hZEVycm9yJywge1xuICAgICAgICAgICAgICAgIHdoYXQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0xvYWRXaGF0U2V0dGluZ3MnKSxcbiAgICAgICAgICAgICAgICBjb2RlOiAnaHR0cF9lcnJvcidcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICQoJyNtaC1yZXRlbnRpb24taW5wdXQnKS52YWwoc3RhdGUucmV0ZW50aW9uKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2hvd1RvYXN0KG1lc3NhZ2UpIHtcbiAgICAgICAgLy8gdGhlIGFkbWluIGNhYmluZXQncyBGb21hbnRpYyBidWlsZCBoYXMgbm8gdG9hc3QgbW9kdWxlIOKAlCBhIHRpbnkgcGlsbCBvZiBvdXIgb3duICg0IHMpXG4gICAgICAgIHZhciBleGlzdGluZyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJy5taC10b2FzdCcpO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGV4aXN0aW5nLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBleGlzdGluZ1tpXS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGV4aXN0aW5nW2ldKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgdG9hc3QgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICAgICAgdG9hc3QuY2xhc3NOYW1lID0gJ21oLXRvYXN0JztcbiAgICAgICAgdG9hc3Quc2V0QXR0cmlidXRlKCdyb2xlJywgJ3N0YXR1cycpO1xuICAgICAgICB0b2FzdC50ZXh0Q29udGVudCA9IG1lc3NhZ2U7XG4gICAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQodG9hc3QpO1xuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICh0b2FzdC5wYXJlbnROb2RlKSB7XG4gICAgICAgICAgICAgICAgdG9hc3QucGFyZW50Tm9kZS5yZW1vdmVDaGlsZCh0b2FzdCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sIDQwMDApO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gYm90czogQVBJIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGFwaVNlbmQobWV0aG9kLCBwYXRoLCBwYXlsb2FkLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICB2YXIgb3B0aW9ucyA9IHtcbiAgICAgICAgICAgIHVybDogQ29uZmlnLnBieFVybCArIEFQSV9CQVNFICsgcGF0aCxcbiAgICAgICAgICAgIG1ldGhvZDogbWV0aG9kLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgIGNhY2hlOiBmYWxzZVxuICAgICAgICB9O1xuICAgICAgICBpZiAocGF5bG9hZCAhPT0gbnVsbCAmJiBwYXlsb2FkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIG9wdGlvbnMuZGF0YSA9IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpO1xuICAgICAgICAgICAgb3B0aW9ucy5jb250ZW50VHlwZSA9ICdhcHBsaWNhdGlvbi9qc29uJztcbiAgICAgICAgfVxuICAgICAgICAkLmFqYXgob3B0aW9ucykuZG9uZShmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgICAgICAgIGlmIChyZXNwb25zZSAmJiByZXNwb25zZS5yZXN1bHQgPT09IHRydWUpIHtcbiAgICAgICAgICAgICAgICBvblN1Y2Nlc3MocmVzcG9uc2UuZGF0YSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG9uRmFpbHVyZShub3JtYWxpemVGYWlsdXJlKHJlc3BvbnNlLCAyMDApKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkuZmFpbChmdW5jdGlvbiAoeGhyKSB7XG4gICAgICAgICAgICBvbkZhaWx1cmUobm9ybWFsaXplRmFpbHVyZSh4aHIucmVzcG9uc2VKU09OIHx8IG51bGwsIHhoci5zdGF0dXMpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYXBpUG9zdChwYXRoLCBwYXlsb2FkLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICBhcGlTZW5kKCdQT1NUJywgcGF0aCwgcGF5bG9hZCB8fCB7fSwgb25TdWNjZXNzLCBvbkZhaWx1cmUpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGFwaURlbGV0ZShwYXRoLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICBhcGlTZW5kKCdERUxFVEUnLCBwYXRoLCBudWxsLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY29yZUdldChwYXRoLCBwYXJhbXMsIG9uU3VjY2Vzcywgb25GYWlsdXJlKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IENvbmZpZy5wYnhVcmwgKyAnL3BieGNvcmUvYXBpL3YzJyArIHBhdGgsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YTogcGFyYW1zIHx8IHt9LFxuICAgICAgICAgICAgY2FjaGU6IGZhbHNlXG4gICAgICAgIH0pLmRvbmUoZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2UucmVzdWx0ID09PSB0cnVlKSB7XG4gICAgICAgICAgICAgICAgb25TdWNjZXNzKHJlc3BvbnNlLmRhdGEpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBvbkZhaWx1cmUobm9ybWFsaXplRmFpbHVyZShyZXNwb25zZSwgMjAwKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLmZhaWwoZnVuY3Rpb24gKHhocikge1xuICAgICAgICAgICAgb25GYWlsdXJlKG5vcm1hbGl6ZUZhaWx1cmUoeGhyLnJlc3BvbnNlSlNPTiB8fCBudWxsLCB4aHIuc3RhdHVzKSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZhaWx1cmVUZXh0KGZhaWx1cmUpIHtcbiAgICAgICAgaWYgKGZhaWx1cmUgJiYgZmFpbHVyZS5maWVsZCkge1xuICAgICAgICAgICAgcmV0dXJuIGZhaWx1cmUubWVzc2FnZXMubGVuZ3RoID4gMCA/IGZhaWx1cmUubWVzc2FnZXNbMF0gOiBmYWlsdXJlLmVycm9yO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAoZmFpbHVyZSAmJiBmYWlsdXJlLmVycm9yKSA/IGZhaWx1cmUuZXJyb3IgOiAnaHR0cF9lcnJvcic7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBib3RzOiBzdGF0ZSAmIHJlbmRlcmluZyAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBib3RCeUlkKGlkKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUuYm90cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKE51bWJlcihzdGF0ZS5ib3RzW2ldLmlkKSA9PT0gTnVtYmVyKGlkKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzdGF0ZS5ib3RzW2ldO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlcGxhY2VCb3QoYm90KSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUuYm90cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKE51bWJlcihzdGF0ZS5ib3RzW2ldLmlkKSA9PT0gTnVtYmVyKGJvdC5pZCkpIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5ib3RzW2ldID0gYm90O1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBzdGF0ZS5ib3RzLnB1c2goYm90KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBsb2FkQm90cyhzaWxlbnQpIHtcbiAgICAgICAgaWYgKCFzaWxlbnQpIHtcbiAgICAgICAgICAgIHN0YXRlLmJvdHNMb2FkZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIHJlbmRlckJvdHNTa2VsZXRvbigpO1xuICAgICAgICB9XG4gICAgICAgIGFwaUdldCgnL2JvdHMnLCB7IGxpbWl0OiAyMDAgfSwgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICAgIHN0YXRlLmJvdHMgPSBkYXRhLml0ZW1zIHx8IFtdO1xuICAgICAgICAgICAgc3RhdGUuYm90c0xvYWRlZCA9IHRydWU7XG4gICAgICAgICAgICBzdGF0ZS5ib3RzRXJyb3IgPSBudWxsO1xuICAgICAgICAgICAgcmVuZGVyQm90cygpO1xuICAgICAgICAgICAgcmVuZGVyUnVsZXMoKTtcbiAgICAgICAgICAgIHJlbmRlckpvdXJuYWxCYW5uZXIoKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGZhaWx1cmUpIHtcbiAgICAgICAgICAgIHN0YXRlLmJvdHNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc3RhdGUuYm90c0Vycm9yID0gZmFpbHVyZTtcbiAgICAgICAgICAgIHJlbmRlckJvdHMoKTtcbiAgICAgICAgICAgIHJlbmRlclJ1bGVzKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdHNTa2VsZXRvbigpIHtcbiAgICAgICAgdmFyIGNhcmQgPSAnPGRpdiBjbGFzcz1cIm1oLWJvdC1jYXJkIG1oLWJvdC1za2VsZXRvblwiPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6MzJweDtoZWlnaHQ6MzJweDtib3JkZXItcmFkaXVzOjhweFwiPjwvc3Bhbj4nXG4gICAgICAgICAgICArICc8ZGl2IHN0eWxlPVwiZmxleDoxO2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjZweFwiPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6NTAlXCI+PC9zcGFuPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6MzAlO2hlaWdodDo4cHhcIj48L3NwYW4+PC9kaXY+PC9kaXY+JztcbiAgICAgICAgJCgnI21oLWJvdHMnKS5odG1sKGNhcmQgKyBjYXJkKTtcbiAgICB9XG5cbiAgICAvLyBUZWxlZ3JhbSAvIE1BWCB0aWxlczogdGhlIGZpcnN0LXJ1biBzY3JlZW4gYW5kIMKr0J3QsNGB0YLRgNC+0LnQutC4wrsgd2l0aG91dCBib3RzIChkZXNpZ24gdjMpLlxuICAgIGZ1bmN0aW9uIG1lc3NlbmdlclRpbGVzKCkge1xuICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJtaC1tZXNzZW5nZXItdGlsZXNcIj4nXG4gICAgICAgICAgICArICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cIm1oLXNjZW5hcmlvIG1oLXRpbGVcIiBkYXRhLWFjdGlvbj1cImFkZC1ib3RcIiBkYXRhLWNoYW5uZWw9XCJ0ZWxlZ3JhbVwiPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyIHRnXCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+VEc8L3NwYW4+PGI+VGVsZWdyYW08L2I+PC9idXR0b24+J1xuICAgICAgICAgICAgKyAnPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgY2xhc3M9XCJtaC1zY2VuYXJpbyBtaC10aWxlXCIgZGF0YS1hY3Rpb249XCJhZGQtYm90XCIgZGF0YS1jaGFubmVsPVwibWF4XCI+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tZXNzZW5nZXIgbWF4XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+TUFYPC9zcGFuPjxiPk1BWDwvYj48L2J1dHRvbj4nXG4gICAgICAgICAgICArICc8L2Rpdj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdHMoKSB7XG4gICAgICAgIHZhciAkd3JhcCA9ICQoJyNtaC1ib3RzJyk7XG4gICAgICAgIGlmIChzdGF0ZS5ib3RzRXJyb3IgIT09IG51bGwgJiYgc3RhdGUuYm90cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtYWRkJykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICAgICAkd3JhcC5odG1sKCc8ZGl2IGNsYXNzPVwidWkgbmVnYXRpdmUgbWVzc2FnZVwiIHJvbGU9XCJhbGVydFwiPicgKyBJQ09OX0VSUk9SXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLWdyb3dcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdHNMb2FkRmFpbGVkJykpICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uIG1oLW9uLW1lc3NhZ2VcIiB0eXBlPVwiYnV0dG9uXCIgaWQ9XCJtaC1ib3RzLXJldHJ5XCI+J1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblJldHJ5JykpICsgJzwvYnV0dG9uPjwvZGl2PicpO1xuICAgICAgICAgICAgJCgnI21oLWJvdHMtcmV0cnknKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IGxvYWRCb3RzKCk7IH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghc3RhdGUuYm90c0xvYWRlZCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC1ib3QtYWRkJykuYXR0cignaGlkZGVuJywgc3RhdGUuYm90cy5sZW5ndGggPiAwID8gbnVsbCA6IHRydWUpO1xuICAgICAgICBpZiAoc3RhdGUuYm90cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICR3cmFwLmh0bWwobWVzc2VuZ2VyVGlsZXMoKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGh0bWwgPSAnPGRpdiBjbGFzcz1cIm1oLWJvdC1saXN0XCI+JztcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5ib3RzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBodG1sICs9IHJlbmRlckJvdENhcmQoc3RhdGUuYm90c1tpXSk7XG4gICAgICAgIH1cbiAgICAgICAgJHdyYXAuaHRtbChodG1sICsgJzwvZGl2PicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdENhcmQoYm90KSB7XG4gICAgICAgIHZhciBleHBhbmRlZCA9IHN0YXRlLmV4cGFuZGVkQm90c1tib3QuaWRdID09PSB0cnVlO1xuICAgICAgICB2YXIgYm9keSA9ICcnO1xuICAgICAgICBpZiAoZXhwYW5kZWQpIHtcbiAgICAgICAgICAgIGJvZHkgPSAnPGRpdiBjbGFzcz1cIm1oLWJvdC1ib2R5XCI+JyArIHJlbmRlckJvdFRsc1dhcm5pbmcoYm90KSArIHJlbmRlckJvdENoYXRzKGJvdCkgKyByZW5kZXJCb3RBY3Rpb25zKGJvdCkgKyAnPC9kaXY+JztcbiAgICAgICAgfVxuICAgICAgICB2YXIgY2hhdENvdW50ID0gKGJvdC5jaGF0cyB8fCBbXSkubGVuZ3RoO1xuICAgICAgICB2YXIgbWV0YSA9IFtdO1xuICAgICAgICBpZiAoYm90LmJvdF91c2VybmFtZSkgeyBtZXRhLnB1c2goJ0AnICsgYm90LmJvdF91c2VybmFtZSk7IH1cbiAgICAgICAgbWV0YS5wdXNoKGNoYXRDb3VudCA+IDAgPyB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hhdHNDb3VudCcsIHsgY291bnQ6IGNoYXRDb3VudCB9KSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoYXRzTm9uZScpKTtcbiAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwibWgtYm90LXJvdycgKyAoZXhwYW5kZWQgPyAnIGlzLW9wZW4nIDogJycpICsgJ1wiIGRhdGEtYm90LWlkPVwiJyArIGJvdC5pZCArICdcIj4nXG4gICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtYm90LWhlYWRcIiBkYXRhLWFjdGlvbj1cInRvZ2dsZVwiIHJvbGU9XCJidXR0b25cIiB0YWJpbmRleD1cIjBcIiBhcmlhLWV4cGFuZGVkPVwiJyArIChleHBhbmRlZCA/ICd0cnVlJyA6ICdmYWxzZScpICsgJ1wiPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyICcgKyAoYm90LmNoYW5uZWwgPT09ICdtYXgnID8gJ21heCcgOiAndGcnKSArICdcIiBhcmlhLWhpZGRlbj1cInRydWVcIj4nICsgKGJvdC5jaGFubmVsID09PSAnbWF4JyA/ICdNQVgnIDogJ1RHJykgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ib3QtdGl0bGVzXCI+PGIgY2xhc3M9XCJtaC10cnVuY2F0ZVwiPicgKyBlc2MoYm90LnRpdGxlKSArICc8L2I+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1tZXRhIG1oLXRydW5jYXRlXCI+JyArIGVzYyhtZXRhLmpvaW4oJyDCtyAnKSkgKyAnPC9zcGFuPjwvZGl2PidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtYm90LXN0YXR1c1wiPicgKyBib3RTdGF0dXNDZWxsKGJvdCkgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtY2hldnJvblwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPidcbiAgICAgICAgICAgICsgJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIHN0eWxlPVwidHJhbnNmb3JtOnJvdGF0ZSgnICsgKGV4cGFuZGVkID8gJzE4MCcgOiAnMCcpICsgJ2RlZylcIj48cGF0aCBkPVwiTTMuNSA2TDggMTAuNSAxMi41IDZcIi8+PC9zdmc+J1xuICAgICAgICAgICAgKyAnPC9zcGFuPjwvZGl2PicgKyBib2R5ICsgJzwvZGl2Pic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYm90U3RhdHVzQ2VsbChib3QpIHtcbiAgICAgICAgaWYgKGJvdC5lbmFibGVkID09PSBmYWxzZSkge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIm1oLWRvdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzRGlzYWJsZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICdvaycpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1kb3QgaXMtb2tcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c09rJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmIChib3Quc3RhdHVzID09PSAndG9rZW5faW52YWxpZCcpIHtcbiAgICAgICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c1Rva2VuSW52YWxpZCcpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYm90LnN0YXR1cyA9PT0gJ2NhX2Vycm9yJykge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cInVpIHJlZCBsYWJlbFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzQ2FFcnJvcicpKSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICBpZiAoYm90LnN0YXR1cyA9PT0gJ2Vycm9yJykge1xuICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cInVpIHllbGxvdyBsYWJlbFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzQ2hlY2tGYWlsZWQnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIm1oLWRvdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzTmV3JykpICsgJzwvc3Bhbj4nO1xuICAgIH1cblxuICAgIC8vIFRoZSBNQVggQVBJIGlzIHNpZ25lZCBieSB0aGUg0JzQuNC90YbQuNGE0YDRiyByb290IENBOiBhIHRydXN0IGZhaWx1cmUgaXMgYSBjb25maWd1cmF0aW9uIHByb2JsZW0sIG5vdCBhXG4gICAgLy8gdG9rZW4gcHJvYmxlbSwgc28gaXQgZ2V0cyBpdHMgb3duIGV4cGxhbmF0aW9uIGFuZCBwb2ludHMgdG8gdGhlIHNldHRpbmdzIGZpZWxkLlxuICAgIGZ1bmN0aW9uIHJlbmRlckJvdFRsc1dhcm5pbmcoYm90KSB7XG4gICAgICAgIGlmIChib3Quc3RhdHVzICE9PSAnY2FfZXJyb3InICYmICFpc01heFRsc0NvZGUoYm90Lmxhc3RfZXJyb3JfY29kZSkpIHtcbiAgICAgICAgICAgIHJldHVybiAnJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJ1aSB3YXJuaW5nIG1lc3NhZ2VcIiByb2xlPVwibm90ZVwiPidcbiAgICAgICAgICAgICsgJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjxjaXJjbGUgY3g9XCI4XCIgY3k9XCI4XCIgcj1cIjYuMjVcIi8+PHBhdGggZD1cIk04IDQuNXY0TTggMTFoLjAxXCIvPjwvc3ZnPidcbiAgICAgICAgICAgICsgJzxkaXY+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RTdGF0dXNDYUVycm9yJykpICsgJy4gJ1xuICAgICAgICAgICAgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2FFcnJvckhpbnQnKSkgKyAnPC9kaXY+PC9kaXY+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjaGF0S2luZExhYmVsKGtpbmQpIHtcbiAgICAgICAgaWYgKGtpbmQgPT09ICdwcml2YXRlJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFR5cGVQcml2YXRlJyk7IH1cbiAgICAgICAgaWYgKGtpbmQgPT09ICdjaGFubmVsJykgeyByZXR1cm4gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFR5cGVDaGFubmVsJyk7IH1cbiAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRUeXBlR3JvdXAnKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJCb3RDaGF0cyhib3QpIHtcbiAgICAgICAgdmFyIGNoYXRzID0gYm90LmNoYXRzIHx8IFtdO1xuICAgICAgICBpZiAoY2hhdHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxkaXYgY2xhc3M9XCJtaC1ib3Qtbm9jaGF0cyBtaC1tdXRlZFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Tm9DaGF0c1RpdGxlJykpICsgJzwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGh0bWwgPSAnPGRpdiBjbGFzcz1cIm1oLWNoYXQtbGlzdFwiPic7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hhdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGh0bWwgKz0gcmVuZGVyQ2hhdFJvdyhib3QsIGNoYXRzW2ldKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gaHRtbCArICc8L2Rpdj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlckNoYXRSb3coYm90LCBjaGF0KSB7XG4gICAgICAgIHZhciBnb25lID0gY2hhdC5zdGF0ZSA9PT0gJ2dvbmUnO1xuICAgICAgICB2YXIgc3RhdGVDZWxsO1xuICAgICAgICBpZiAoZ29uZSkge1xuICAgICAgICAgICAgc3RhdGVDZWxsID0gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCIgdGl0bGU9XCInICsgZXNjKGNoYXQuZ29uZV9yZWFzb24pICsgJ1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFN0YXR1c0dvbmUnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH0gZWxzZSBpZiAoY2hhdC5sYXN0X2RlbGl2ZXJ5ICYmIGNoYXQubGFzdF9kZWxpdmVyeS5zdGF0dXMgPT09ICdmYWlsZWQnKSB7XG4gICAgICAgICAgICBzdGF0ZUNlbGwgPSAnPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRTdGF0dXNFcnJvcicpKSArICc8L3NwYW4+JztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHN0YXRlQ2VsbCA9ICc8c3BhbiBjbGFzcz1cIm1oLWRvdCBpcy1va1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFN0YXR1c09rJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnPGRpdiBjbGFzcz1cIm1oLWNoYXQtcm93XCIgZGF0YS1jaGF0LWlkPVwiJyArIGNoYXQuaWQgKyAnXCI+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1jaGF0LXRpdGxlXCI+PHNwYW4gY2xhc3M9XCJtaC10cnVuY2F0ZVwiPicgKyBlc2MoY2hhdC50aXRsZSB8fCBjaGF0LmNoYXRfaWQpICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1ldGFcIj4gwrcgJyArIGVzYyhjaGF0S2luZExhYmVsKGNoYXQuY2hhdF9raW5kKSkgKyAnPC9zcGFuPjwvc3Bhbj4nXG4gICAgICAgICAgICArIGVtcGxveWVlU2VsZWN0KGNoYXQpXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWNoYXQtc3RhdGVcIj4nICsgc3RhdGVDZWxsICsgJzwvc3Bhbj4nXG4gICAgICAgICAgICArICc8bGFiZWwgY2xhc3M9XCJ1aSB0b2dnbGUgY2hlY2tib3gnICsgKGNoYXQuZW5hYmxlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAoZ29uZSA/ICcgZGlzYWJsZWQnIDogJycpICsgJ1wiIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdEVuYWJsZUNoYXQnKSkgKyAnXCI+J1xuICAgICAgICAgICAgKyAnPGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGNsYXNzPVwiaGlkZGVuIG1oLWNoYXQtdG9nZ2xlXCInICsgKGNoYXQuZW5hYmxlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAoZ29uZSA/ICcgZGlzYWJsZWQnIDogJycpICsgJz4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXRyYWNrXCI+PC9zcGFuPjwvbGFiZWw+J1xuICAgICAgICAgICAgKyAnPC9kaXY+JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBlbXBsb3llZVNlbGVjdChjaGF0KSB7XG4gICAgICAgIHZhciBvcHRpb25zID0gJzxvcHRpb24gdmFsdWU9XCIwXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Tm9FbXBsb3llZScpKSArICc8L29wdGlvbj4nO1xuICAgICAgICB2YXIgZm91bmQgPSBmYWxzZTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdGF0ZS5lbXBsb3llZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBlbXBsb3llZSA9IHN0YXRlLmVtcGxveWVlc1tpXTtcbiAgICAgICAgICAgIHZhciBzZWxlY3RlZCA9IE51bWJlcihlbXBsb3llZS5pZCkgPT09IE51bWJlcihjaGF0LmxpbmtlZF91c2VyX2lkKTtcbiAgICAgICAgICAgIGlmIChzZWxlY3RlZCkgeyBmb3VuZCA9IHRydWU7IH1cbiAgICAgICAgICAgIG9wdGlvbnMgKz0gJzxvcHRpb24gdmFsdWU9XCInICsgZW1wbG95ZWUuaWQgKyAnXCInICsgKHNlbGVjdGVkID8gJyBzZWxlY3RlZCcgOiAnJykgKyAnPicgKyBlc2MoZW1wbG95ZWUubGFiZWwpICsgJzwvb3B0aW9uPic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFmb3VuZCAmJiBOdW1iZXIoY2hhdC5saW5rZWRfdXNlcl9pZCkgPiAwKSB7XG4gICAgICAgICAgICBvcHRpb25zICs9ICc8b3B0aW9uIHZhbHVlPVwiJyArIGNoYXQubGlua2VkX3VzZXJfaWQgKyAnXCIgc2VsZWN0ZWQ+IycgKyBjaGF0LmxpbmtlZF91c2VyX2lkICsgJzwvb3B0aW9uPic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICc8c2VsZWN0IGNsYXNzPVwibWgtZW1wbG95ZWUtc2VsZWN0XCIgYXJpYS1sYWJlbD1cIicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdEVtcGxveWVlJykpICsgJ1wiPicgKyBvcHRpb25zICsgJzwvc2VsZWN0Pic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyQm90QWN0aW9ucyhib3QpIHtcbiAgICAgICAgcmV0dXJuICc8ZGl2IGNsYXNzPVwibWgtYm90LWFjdGlvbnNcIj4nXG4gICAgICAgICAgICArICc8YSBocmVmPVwiI1wiIGRhdGEtYWN0aW9uPVwiY29ubmVjdFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90QWN0aW9uc0Nvbm5lY3QnKSkgKyAnPC9hPidcbiAgICAgICAgICAgICsgJzxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJ0ZXN0XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RBY3Rpb25zVGVzdCcpKSArICc8L2E+J1xuICAgICAgICAgICAgKyAnPGEgaHJlZj1cIiNcIiBkYXRhLWFjdGlvbj1cImVkaXRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdEFjdGlvbnNFZGl0JykpICsgJzwvYT4nXG4gICAgICAgICAgICArICc8L2Rpdj4nO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gYm90czogZGVsZWdhdGVkIGFjdGlvbnMgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gYmluZEJvdHNDb250YWluZXIoKSB7XG4gICAgICAgIHZhciAkd3JhcCA9ICQoJyNtaC1ib3RzJyk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJ0b2dnbGVcIl0nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgaWQgPSBTdHJpbmcoJCh0aGlzKS5jbG9zZXN0KCcubWgtYm90LXJvdycpLmRhdGEoJ2JvdC1pZCcpKTtcbiAgICAgICAgICAgIHN0YXRlLmV4cGFuZGVkQm90c1tpZF0gPSBzdGF0ZS5leHBhbmRlZEJvdHNbaWRdICE9PSB0cnVlO1xuICAgICAgICAgICAgcmVuZGVyQm90cygpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2tleWRvd24nLCAnW2RhdGEtYWN0aW9uPVwidG9nZ2xlXCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBpZiAoZXZlbnQua2V5ID09PSAnRW50ZXInIHx8IGV2ZW50LmtleSA9PT0gJyAnKSB7XG4gICAgICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgICAgICAkKHRoaXMpLnRyaWdnZXIoJ2NsaWNrJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiYWRkLWJvdFwiXScsIGZ1bmN0aW9uICgpIHsgb3BlbkJvdE1vZGFsKCdhZGQnLCBudWxsLCAkKHRoaXMpLmRhdGEoJ2NoYW5uZWwnKSk7IH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiY29ubmVjdFwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIG9wZW5DaGF0TW9kYWwoYm90QnlJZCgkKHRoaXMpLmNsb3Nlc3QoJy5taC1ib3Qtcm93JykuZGF0YSgnYm90LWlkJykpKTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjbGljaycsICdbZGF0YS1hY3Rpb249XCJ0ZXN0XCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgb3BlblRlc3RNb2RhbChib3RCeUlkKCQodGhpcykuY2xvc2VzdCgnLm1oLWJvdC1yb3cnKS5kYXRhKCdib3QtaWQnKSksIG51bGwpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImVkaXRcIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBvcGVuQm90TW9kYWwoJ2VkaXQnLCBib3RCeUlkKCQodGhpcykuY2xvc2VzdCgnLm1oLWJvdC1yb3cnKS5kYXRhKCdib3QtaWQnKSkpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NoYW5nZScsICcubWgtY2hhdC10b2dnbGUnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgYm90SWQgPSAkKHRoaXMpLmNsb3Nlc3QoJy5taC1ib3Qtcm93JykuZGF0YSgnYm90LWlkJyk7XG4gICAgICAgICAgICB2YXIgY2hhdElkID0gJCh0aGlzKS5jbG9zZXN0KCcubWgtY2hhdC1yb3cnKS5kYXRhKCdjaGF0LWlkJyk7XG4gICAgICAgICAgICB2YXIgZW5hYmxlZCA9ICQodGhpcykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICAgICAgcGF0Y2hCb3QoYm90SWQsIHsgY2hhdHM6IFt7IGlkOiBOdW1iZXIoY2hhdElkKSwgZW5hYmxlZDogZW5hYmxlZCB9XSB9LCBudWxsLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblNhdmVGYWlsZWQnKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgICR3cmFwLm9uKCdjaGFuZ2UnLCAnLm1oLWVtcGxveWVlLXNlbGVjdCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBib3RJZCA9ICQodGhpcykuY2xvc2VzdCgnLm1oLWJvdC1yb3cnKS5kYXRhKCdib3QtaWQnKTtcbiAgICAgICAgICAgIHZhciBjaGF0SWQgPSAkKHRoaXMpLmNsb3Nlc3QoJy5taC1jaGF0LXJvdycpLmRhdGEoJ2NoYXQtaWQnKTtcbiAgICAgICAgICAgIHBhdGNoQm90KGJvdElkLCB7IGNoYXRzOiBbeyBpZDogTnVtYmVyKGNoYXRJZCksIGxpbmtlZF91c2VyX2lkOiBOdW1iZXIoJCh0aGlzKS52YWwoKSkgfV0gfSwgbnVsbCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25TYXZlRmFpbGVkJykpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHBhdGNoQm90KGJvdElkLCBwYXlsb2FkLCBvblN1Y2Nlc3MsIG9uRmFpbHVyZSkge1xuICAgICAgICBhcGlQYXRjaCgnL2JvdHMvJyArIGJvdElkLCBwYXlsb2FkLCBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgICAgICByZW5kZXJCb3RzKCk7XG4gICAgICAgICAgICBpZiAob25TdWNjZXNzKSB7IG9uU3VjY2Vzcyhib3QpOyB9XG4gICAgICAgIH0sIG9uRmFpbHVyZSB8fCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgc2hvd1RvYXN0KGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBlbXBsb3llZXMgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gbG9hZEVtcGxveWVlcyhkb25lKSB7XG4gICAgICAgIGlmIChzdGF0ZS5lbXBsb3llZXNMb2FkZWQpIHtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb3JlR2V0KCcvZXh0ZW5zaW9ucycsIHsgbGltaXQ6IDUwMCB9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgdmFyIGl0ZW1zID0gZGF0YS5pdGVtcyB8fCBbXTtcbiAgICAgICAgICAgIHZhciBzZWVuID0ge307XG4gICAgICAgICAgICB2YXIgbGlzdCA9IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBpdGVtcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIHZhciBpdGVtID0gaXRlbXNbaV07XG4gICAgICAgICAgICAgICAgdmFyIHVzZXJJZCA9IE51bWJlcihpdGVtLnVzZXJpZCk7XG4gICAgICAgICAgICAgICAgaWYgKCF1c2VySWQgfHwgc2Vlblt1c2VySWRdKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzZWVuW3VzZXJJZF0gPSB0cnVlO1xuICAgICAgICAgICAgICAgIHZhciBuYW1lID0gaXRlbS5jYWxsZXJpZCB8fCBpdGVtLm51bWJlciB8fCAoJyMnICsgdXNlcklkKTtcbiAgICAgICAgICAgICAgICB2YXIgbnVtYmVyID0gaXRlbS5udW1iZXIgPyBTdHJpbmcoaXRlbS5udW1iZXIpIDogJyc7XG4gICAgICAgICAgICAgICAgdmFyIGxhYmVsID0gKG51bWJlciAhPT0gJycgJiYgU3RyaW5nKG5hbWUpLmluZGV4T2YobnVtYmVyKSA9PT0gLTEpID8gbmFtZSArICcgKCcgKyBudW1iZXIgKyAnKScgOiBuYW1lO1xuICAgICAgICAgICAgICAgIGxpc3QucHVzaCh7IGlkOiB1c2VySWQsIGxhYmVsOiBsYWJlbCB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGxpc3Quc29ydChmdW5jdGlvbiAoYSwgYikgeyByZXR1cm4gYS5sYWJlbC5sb2NhbGVDb21wYXJlKGIubGFiZWwpOyB9KTtcbiAgICAgICAgICAgIHN0YXRlLmVtcGxveWVlcyA9IGxpc3Q7XG4gICAgICAgICAgICBzdGF0ZS5lbXBsb3llZXNMb2FkZWQgPSB0cnVlO1xuICAgICAgICAgICAgc3RhdGUuZW1wbG95ZWVzRmFpbGVkID0gZmFsc2U7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLmVtcGxveWVlc0xvYWRlZCA9IGZhbHNlO1xuICAgICAgICAgICAgc3RhdGUuZW1wbG95ZWVzRmFpbGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBib3QgbW9kYWwgLS0tLS0tLS0tLVxuXG4gICAgLy8gQ2hhbm5lbHMgd2l0aCBhIGJhY2tlbmQgYWRhcHRlciAoYm90aCBoYXZlIG9uZSBzaW5jZSBzdGFnZSAzYi8zYykuIFRoZSBjaGVja3MgYmVsb3cgc3RheSBhcyBhXG4gICAgLy8gZ3VhcmQ6IGEgY2hhbm5lbCB3aXRob3V0IGFuIGFkYXB0ZXIgb24gdGhlIHNlcnZlciBtdXN0IG5vdCBiZSBzYXZlZCBmcm9tIGEgc3RhbGUgcGFnZS5cbiAgICB2YXIgU0FWQUJMRV9DSEFOTkVMUyA9IFsndGVsZWdyYW0nLCAnbWF4J107XG5cbiAgICBmdW5jdGlvbiBvcGVuQm90TW9kYWwobW9kZSwgYm90LCBjaGFubmVsKSB7XG4gICAgICAgIHN0YXRlLmJvdE1vZGFsID0ge1xuICAgICAgICAgICAgbW9kZTogbW9kZSxcbiAgICAgICAgICAgIGJvdDogYm90LFxuICAgICAgICAgICAgY2hhbm5lbDogbW9kZSA9PT0gJ2VkaXQnICYmIGJvdCA/IChib3QuY2hhbm5lbCB8fCAndGVsZWdyYW0nKSA6IChjaGFubmVsID09PSAnbWF4JyA/ICdtYXgnIDogJ3RlbGVncmFtJyksXG4gICAgICAgICAgICBkcmFmdElkOiAwLFxuICAgICAgICAgICAgc2F2ZWQ6IGZhbHNlLFxuICAgICAgICAgICAgdG9rZW5DaGFuZ2VkOiBmYWxzZSxcbiAgICAgICAgICAgIGJ1c3k6IGZhbHNlXG4gICAgICAgIH07XG4gICAgICAgICQoJyNtaC1ib3QtY2hlY2stbWVzc2FnZScpLmVtcHR5KCk7XG4gICAgICAgICQoJyNtaC1ib3QtdGl0bGUtZmllbGQnKS5yZW1vdmVDbGFzcygnZXJyb3InKTtcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbi1yb3cnKS5yZW1vdmVDbGFzcygnZXJyb3InKTtcbiAgICAgICAgJCgnI21oLWJvdC1tb2RhbC10aXRsZScpLnRleHQobW9kZSA9PT0gJ2VkaXQnID8gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdEVkaXRUaXRsZScsIHsgdGl0bGU6IGJvdC50aXRsZSB9KSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdEFkZFRpdGxlJykpO1xuICAgICAgICAkKCcjbWgtYm90LXRpdGxlJykudmFsKGJvdCA/IGJvdC50aXRsZSA6ICcnKTtcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbicpLnZhbCgnJyk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4tbmV3JykudmFsKCcnKTtcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbi1uZXctcm93JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1ib3QtZGVsZXRlJykuYXR0cignaGlkZGVuJywgbW9kZSA9PT0gJ2VkaXQnID8gbnVsbCA6IHRydWUpO1xuICAgICAgICAkKCcjbWgtYm90LXNhdmUnKS50ZXh0KG1vZGUgPT09ICdlZGl0JyA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFNhdmUnKSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFNhdmVBbmRDb25uZWN0JykpO1xuICAgICAgICBpZiAobW9kZSA9PT0gJ2VkaXQnKSB7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRva2VuLXJvdycpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1oaW50LXJvdycpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1oaW50JykudGV4dCgn4oCi4oCi4oCi4oCiJyArIChib3QudG9rZW5faGludCB8fCAnJykpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1yb3cnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4taGludC1yb3cnKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgfVxuICAgICAgICBzeW5jQm90Q2hhbm5lbCgpO1xuICAgICAgICAkKCcjbWgtYm90LW1vZGFsJykubW9kYWwoeyBjbG9zYWJsZTogZmFsc2UgfSkubW9kYWwoJ3Nob3cnKTtcbiAgICAgICAgJCgnI21oLWJvdC10aXRsZScpLnRyaWdnZXIoJ2ZvY3VzJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3luY0JvdENoYW5uZWwoKSB7XG4gICAgICAgIHZhciBtb2RhbCA9IHN0YXRlLmJvdE1vZGFsO1xuICAgICAgICBpZiAoIW1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAkKCcjbWgtYm90LW1vZGFsIC5taC1jaGFubmVsLWNhcmQnKS5lYWNoKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBjaGFubmVsID0gU3RyaW5nKCQodGhpcykuZGF0YSgnY2hhbm5lbCcpKTtcbiAgICAgICAgICAgIHZhciBzZWxlY3RlZCA9IGNoYW5uZWwgPT09IG1vZGFsLmNoYW5uZWw7XG4gICAgICAgICAgICB2YXIgbG9ja2VkID0gbW9kYWwubW9kZSA9PT0gJ2VkaXQnICYmICFzZWxlY3RlZDtcbiAgICAgICAgICAgICQodGhpcykudG9nZ2xlQ2xhc3MoJ2lzLXNlbGVjdGVkJywgc2VsZWN0ZWQpLnRvZ2dsZUNsYXNzKCdpcy1kaXNhYmxlZCcsIGxvY2tlZClcbiAgICAgICAgICAgICAgICAuYXR0cignYXJpYS1kaXNhYmxlZCcsIGxvY2tlZCA/ICd0cnVlJyA6IG51bGwpO1xuICAgICAgICAgICAgJCh0aGlzKS5maW5kKCdpbnB1dCcpLnByb3AoJ2NoZWNrZWQnLCBzZWxlY3RlZCkucHJvcCgnZGlzYWJsZWQnLCBsb2NrZWQpO1xuICAgICAgICB9KTtcbiAgICAgICAgdmFyIHNhdmFibGUgPSBTQVZBQkxFX0NIQU5ORUxTLmluZGV4T2YobW9kYWwuY2hhbm5lbCkgPj0gMDtcbiAgICAgICAgJCgnI21oLWJvdC1zYXZlLCAjbWgtYm90LWNoZWNrJykucHJvcCgnZGlzYWJsZWQnLCAhc2F2YWJsZSkudG9nZ2xlQ2xhc3MoJ2Rpc2FibGVkJywgIXNhdmFibGUpO1xuICAgICAgICAvLyBhIE1BWCB0b2tlbiBjb21lcyBmcm9tIGJ1c2luZXNzLm1heC5ydSBhZnRlciBtb2RlcmF0aW9uOyBUZWxlZ3JhbSBuZWVkcyBubyBleHBsYW5hdGlvblxuICAgICAgICB2YXIgbWF4SGVscCA9IG1vZGFsLmNoYW5uZWwgPT09ICdtYXgnO1xuICAgICAgICAkKCcjbWgtYm90LXRva2VuLWhlbHAnKS50ZXh0KG1heEhlbHAgPyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RUb2tlbkhlbHBNYXgnKSA6ICcnKTtcbiAgICAgICAgJCgnI21oLWJvdC10b2tlbi1oZWxwLXJvdycpLmF0dHIoJ2hpZGRlbicsIG1heEhlbHAgPyBudWxsIDogdHJ1ZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNNYXhUbHNDb2RlKGNvZGUpIHtcbiAgICAgICAgcmV0dXJuIFN0cmluZyhjb2RlIHx8ICcnKS5pbmRleE9mKCdtYXgudGxzLicpID09PSAwO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHRsc0Vycm9yVGV4dCgpIHtcbiAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdFN0YXR1c0NhRXJyb3InKSArICcuICcgKyB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDYUVycm9ySGludCcpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJvdEZvcm1WYWx1ZXMoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0aXRsZTogU3RyaW5nKCQoJyNtaC1ib3QtdGl0bGUnKS52YWwoKSB8fCAnJykudHJpbSgpLFxuICAgICAgICAgICAgdG9rZW46IFN0cmluZygkKCcjbWgtYm90LXRva2VuJykudmFsKCkgfHwgJycpLnRyaW0oKSxcbiAgICAgICAgICAgIHRva2VuTmV3OiBTdHJpbmcoJCgnI21oLWJvdC10b2tlbi1uZXcnKS52YWwoKSB8fCAnJykudHJpbSgpXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2hvd0JvdE1lc3NhZ2Uoa2luZCwgdGV4dCkge1xuICAgICAgICB2YXIgY2xzID0ga2luZCA9PT0gJ29rJyA/ICd1aSBwb3NpdGl2ZSBtZXNzYWdlJyA6IChraW5kID09PSAnd2FybicgPyAndWkgd2FybmluZyBtZXNzYWdlJyA6ICd1aSBuZWdhdGl2ZSBtZXNzYWdlJyk7XG4gICAgICAgIHZhciBpY29uID0ga2luZCA9PT0gJ29rJ1xuICAgICAgICAgICAgPyAnPGNpcmNsZSBjeD1cIjhcIiBjeT1cIjhcIiByPVwiNi4yNVwiLz48cGF0aCBkPVwiTTUuNSA4LjJsMS44IDEuOCAzLjMtMy42XCIvPidcbiAgICAgICAgICAgIDogJzxjaXJjbGUgY3g9XCI4XCIgY3k9XCI4XCIgcj1cIjYuMjVcIi8+PHBhdGggZD1cIk02IDZsNCA0TTEwIDZsLTQgNFwiLz4nO1xuICAgICAgICAkKCcjbWgtYm90LWNoZWNrLW1lc3NhZ2UnKS5odG1sKCc8ZGl2IGNsYXNzPVwiJyArIGNscyArICdcIiByb2xlPVwic3RhdHVzXCI+J1xuICAgICAgICAgICAgKyAnPHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+JyArIGljb24gKyAnPC9zdmc+J1xuICAgICAgICAgICAgKyAnPGRpdj4nICsgZXNjKHRleHQpICsgJzwvZGl2PjwvZGl2PicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJvdENoZWNrTWVzc2FnZShib3QpIHtcbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICdvaycpIHtcbiAgICAgICAgICAgIHJldHVybiB7IGtpbmQ6ICdvaycsIHRleHQ6IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkT2snLCB7XG4gICAgICAgICAgICAgICAgdXNlcm5hbWU6IGJvdC5ib3RfdXNlcm5hbWUgfHwgYm90LmJvdF9leHRlcm5hbF9pZCxcbiAgICAgICAgICAgICAgICBuYW1lOiBib3QuYm90X3VzZXJuYW1lID8gJ0AnICsgYm90LmJvdF91c2VybmFtZSA6IGJvdC50aXRsZVxuICAgICAgICAgICAgfSkgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYm90Lmxhc3RfZXJyb3JfY29kZSA9PT0gJ290aGVyX2JvdCcpIHtcbiAgICAgICAgICAgIHJldHVybiB7IGtpbmQ6ICd3YXJuJywgdGV4dDogdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrZWRPdGhlcicsIHtcbiAgICAgICAgICAgICAgICB1c2VybmFtZTogYm90LmJvdF91c2VybmFtZSB8fCAnJyxcbiAgICAgICAgICAgICAgICBib3Q6IGJvdC50aXRsZVxuICAgICAgICAgICAgfSkgfTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYm90LnN0YXR1cyA9PT0gJ3Rva2VuX2ludmFsaWQnKSB7XG4gICAgICAgICAgICByZXR1cm4geyBraW5kOiAnZXJyJywgdGV4dDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZDQwMScpIH07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGJvdC5zdGF0dXMgPT09ICdjYV9lcnJvcicgfHwgaXNNYXhUbHNDb2RlKGJvdC5sYXN0X2Vycm9yX2NvZGUpKSB7XG4gICAgICAgICAgICByZXR1cm4geyBraW5kOiAnZXJyJywgdGV4dDogdGxzRXJyb3JUZXh0KCkgfTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4geyBraW5kOiAnd2FybicsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrTmV0d29yaycpICsgKGJvdC5sYXN0X2Vycm9yX2NvZGUgPyAnICgnICsgYm90Lmxhc3RfZXJyb3JfY29kZSArICcpJyA6ICcnKSB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNoZWNrQm90Rm9ybSgpIHtcbiAgICAgICAgaWYgKCFzdGF0ZS5ib3RNb2RhbCB8fCBTQVZBQkxFX0NIQU5ORUxTLmluZGV4T2Yoc3RhdGUuYm90TW9kYWwuY2hhbm5lbCkgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHZhbHVlcyA9IGJvdEZvcm1WYWx1ZXMoKTtcbiAgICAgICAgaWYgKHZhbHVlcy50aXRsZSA9PT0gJycpIHtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdGl0bGUtZmllbGQnKS5hZGRDbGFzcygnZXJyb3InKTtcbiAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RUaXRsZVJlcXVpcmVkJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC1ib3QtdGl0bGUtZmllbGQnKS5yZW1vdmVDbGFzcygnZXJyb3InKTtcbiAgICAgICAgdmFyIG1vZGUgPSBzdGF0ZS5ib3RNb2RhbC5tb2RlO1xuICAgICAgICB2YXIgcGF5bG9hZDtcbiAgICAgICAgdmFyIGRvbmUgPSBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICBzdGF0ZS5ib3RNb2RhbC5ib3QgPSBib3Q7XG4gICAgICAgICAgICBzdGF0ZS5ib3RNb2RhbC5kcmFmdElkID0gYm90LmlkO1xuICAgICAgICAgICAgcmVwbGFjZUJvdChib3QpO1xuICAgICAgICAgICAgdmFyIG1lc3NhZ2UgPSBib3RDaGVja01lc3NhZ2UoYm90KTtcbiAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKG1lc3NhZ2Uua2luZCwgbWVzc2FnZS50ZXh0KTtcbiAgICAgICAgfTtcbiAgICAgICAgdmFyIGZhaWx1cmUgPSBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICBpZiAoZXJyLmZpZWxkID09PSAndG9rZW4nKSB7XG4gICAgICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1yb3cnKS5hZGRDbGFzcygnZXJyb3InKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCBmYWlsdXJlVGV4dChlcnIpKTtcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKG1vZGUgPT09ICdhZGQnKSB7XG4gICAgICAgICAgICBwYXlsb2FkID0geyBjaGFubmVsOiBzdGF0ZS5ib3RNb2RhbC5jaGFubmVsLCB0aXRsZTogdmFsdWVzLnRpdGxlLCB0b2tlbjogdmFsdWVzLnRva2VuIH07XG4gICAgICAgICAgICBpZiAoc3RhdGUuYm90TW9kYWwuZHJhZnRJZCA+IDApIHtcbiAgICAgICAgICAgICAgICBhcGlQYXRjaCgnL2JvdHMvJyArIHN0YXRlLmJvdE1vZGFsLmRyYWZ0SWQsIHsgdGl0bGU6IHZhbHVlcy50aXRsZSwgdG9rZW46IHZhbHVlcy50b2tlbiB9LCBkb25lLCBmYWlsdXJlKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgYXBpUG9zdCgnL2JvdHMnLCBwYXlsb2FkLCBkb25lLCBmYWlsdXJlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAodmFsdWVzLnRva2VuTmV3ICE9PSAnJykge1xuICAgICAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIHN0YXRlLmJvdE1vZGFsLmJvdC5pZCArICc6Y2hlY2tUb2tlbicsIHsgdG9rZW46IHZhbHVlcy50b2tlbk5ldyB9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgICAgIGlmIChkYXRhLm9rKSB7XG4gICAgICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdvaycsIHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkT2snLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICB1c2VybmFtZTogZGF0YS51c2VybmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IGRhdGEuZGlzcGxheV9uYW1lXG4gICAgICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGRhdGEuZXJyb3JfY29kZSA9PT0gJ290aGVyX2JvdCcpIHtcbiAgICAgICAgICAgICAgICAgICAgc2hvd0JvdE1lc3NhZ2UoJ3dhcm4nLCB0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tlZE90aGVyJywge1xuICAgICAgICAgICAgICAgICAgICAgICAgdXNlcm5hbWU6IGRhdGEudXNlcm5hbWUgfHwgJycsXG4gICAgICAgICAgICAgICAgICAgICAgICBib3Q6IHN0YXRlLmJvdE1vZGFsLmJvdC50aXRsZVxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChkYXRhLmVycm9yX2NvZGUgPT09ICd0ZWxlZ3JhbS40MDEudW5hdXRob3JpemVkJyB8fCBkYXRhLmVycm9yX2NvZGUgPT09ICdtYXguNDAxLnVuYXV0aG9yaXplZCcpIHtcbiAgICAgICAgICAgICAgICAgICAgc2hvd0JvdE1lc3NhZ2UoJ2VycicsIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrZWQ0MDEnKSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChpc01heFRsc0NvZGUoZGF0YS5lcnJvcl9jb2RlKSkge1xuICAgICAgICAgICAgICAgICAgICBzaG93Qm90TWVzc2FnZSgnZXJyJywgdGxzRXJyb3JUZXh0KCkpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCd3YXJuJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90Q2hlY2tOZXR3b3JrJykgKyAnICgnICsgZGF0YS5lcnJvcl9jb2RlICsgJyknKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCBmYWlsdXJlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBhcGlQb3N0KCcvYm90cy8nICsgc3RhdGUuYm90TW9kYWwuYm90LmlkICsgJzpjaGVja1Rva2VuJywge30sIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgIGlmIChkYXRhLm9rKSB7XG4gICAgICAgICAgICAgICAgc2hvd0JvdE1lc3NhZ2UoJ29rJywgdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0JvdENoZWNrZWRPaycsIHtcbiAgICAgICAgICAgICAgICAgICAgdXNlcm5hbWU6IGRhdGEudXNlcm5hbWUsXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGRhdGEuZGlzcGxheV9uYW1lXG4gICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChpc01heFRsc0NvZGUoZGF0YS5lcnJvcl9jb2RlKSkge1xuICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCB0bHNFcnJvclRleHQoKSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkNDAxJykpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LCBmYWlsdXJlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlQm90Rm9ybSgpIHtcbiAgICAgICAgaWYgKCFzdGF0ZS5ib3RNb2RhbCB8fCBTQVZBQkxFX0NIQU5ORUxTLmluZGV4T2Yoc3RhdGUuYm90TW9kYWwuY2hhbm5lbCkgPCAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHZhbHVlcyA9IGJvdEZvcm1WYWx1ZXMoKTtcbiAgICAgICAgaWYgKHZhbHVlcy50aXRsZSA9PT0gJycpIHtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdGl0bGUtZmllbGQnKS5hZGRDbGFzcygnZXJyb3InKTtcbiAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RUaXRsZVJlcXVpcmVkJykpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBtb2RlID0gc3RhdGUuYm90TW9kYWwubW9kZTtcbiAgICAgICAgdmFyIGZpbmlzaCA9IGZ1bmN0aW9uIChib3QpIHtcbiAgICAgICAgICAgIHN0YXRlLmJvdE1vZGFsLnNhdmVkID0gdHJ1ZTtcbiAgICAgICAgICAgIHJlcGxhY2VCb3QoYm90KTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtbW9kYWwnKS5tb2RhbCgnaGlkZScpO1xuICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICBpZiAobW9kZSA9PT0gJ2FkZCcpIHtcbiAgICAgICAgICAgICAgICBvcGVuQ2hhdE1vZGFsKGJvdCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25TYXZlZCcpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgdmFyIGZhaWx1cmUgPSBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICBpZiAoZXJyLmZpZWxkID09PSAndG9rZW4nKSB7XG4gICAgICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1yb3cnKS5hZGRDbGFzcygnZXJyb3InKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNob3dCb3RNZXNzYWdlKCdlcnInLCBmYWlsdXJlVGV4dChlcnIpKTtcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKG1vZGUgPT09ICdhZGQnKSB7XG4gICAgICAgICAgICB2YXIgY3JlYXRlID0gZnVuY3Rpb24gKGlkKSB7XG4gICAgICAgICAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIGlkICsgJzpkaXNjb3ZlckNoYXRzJywge30sIGZ1bmN0aW9uIChib3QpIHtcbiAgICAgICAgICAgICAgICAgICAgZmluaXNoKGJvdCk7XG4gICAgICAgICAgICAgICAgfSwgZmFpbHVyZSk7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgaWYgKHN0YXRlLmJvdE1vZGFsLmRyYWZ0SWQgPiAwKSB7XG4gICAgICAgICAgICAgICAgYXBpUGF0Y2goJy9ib3RzLycgKyBzdGF0ZS5ib3RNb2RhbC5kcmFmdElkLCB7IHRpdGxlOiB2YWx1ZXMudGl0bGUsIHRva2VuOiB2YWx1ZXMudG9rZW4gfSwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgICAgICAgICAgICAgIGNyZWF0ZShib3QuaWQpO1xuICAgICAgICAgICAgICAgIH0sIGZhaWx1cmUpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBhcGlQb3N0KCcvYm90cycsIHsgY2hhbm5lbDogc3RhdGUuYm90TW9kYWwuY2hhbm5lbCwgdGl0bGU6IHZhbHVlcy50aXRsZSwgdG9rZW46IHZhbHVlcy50b2tlbiB9LCBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICAgICAgICAgIHJlcGxhY2VCb3QoYm90KTtcbiAgICAgICAgICAgICAgICAgICAgY3JlYXRlKGJvdC5pZCk7XG4gICAgICAgICAgICAgICAgfSwgZmFpbHVyZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHBheWxvYWQgPSB7IHRpdGxlOiB2YWx1ZXMudGl0bGUgfTtcbiAgICAgICAgaWYgKHZhbHVlcy50b2tlbk5ldyAhPT0gJycpIHtcbiAgICAgICAgICAgIHBheWxvYWQudG9rZW4gPSB2YWx1ZXMudG9rZW5OZXc7XG4gICAgICAgIH1cbiAgICAgICAgYXBpUGF0Y2goJy9ib3RzLycgKyBzdGF0ZS5ib3RNb2RhbC5ib3QuaWQsIHBheWxvYWQsIGZpbmlzaCwgZmFpbHVyZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2FuY2VsQm90TW9kYWwoKSB7XG4gICAgICAgIHZhciBtb2RhbCA9IHN0YXRlLmJvdE1vZGFsO1xuICAgICAgICBzdGF0ZS5ib3RNb2RhbCA9IG51bGw7XG4gICAgICAgICQoJyNtaC1ib3QtbW9kYWwnKS5tb2RhbCgnaGlkZScpO1xuICAgICAgICBpZiAobW9kYWwgJiYgbW9kYWwuZHJhZnRJZCA+IDAgJiYgIW1vZGFsLnNhdmVkKSB7XG4gICAgICAgICAgICAvLyB0aGUgXCLQn9GA0L7QstC10YDQuNGC0YxcIiBidXR0b24gY3JlYXRlZCB0aGUgZHJhZnQ6IGNhbmNlbGxpbmcgbXVzdCBub3QgbGVhdmUgaXQgYmVoaW5kXG4gICAgICAgICAgICBhcGlEZWxldGUoJy9ib3RzLycgKyBtb2RhbC5kcmFmdElkLCBmdW5jdGlvbiAoKSB7IGxvYWRCb3RzKHRydWUpOyB9LCBmdW5jdGlvbiAoKSB7IGxvYWRCb3RzKHRydWUpOyB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY29uZmlybURlbGV0ZUJvdCgpIHtcbiAgICAgICAgdmFyIGJvdCA9IHN0YXRlLmJvdE1vZGFsLmJvdDtcbiAgICAgICAgaWYgKCFib3QpIHsgcmV0dXJuOyB9XG4gICAgICAgICQoJyNtaC1jb25maXJtLXRleHQnKS50ZXh0KHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3REZWxldGVDb25maXJtJywgeyB0aXRsZTogYm90LnRpdGxlLCBjb3VudDogKGJvdC5jaGF0cyB8fCBbXSkubGVuZ3RoIH0pKTtcbiAgICAgICAgJCgnI21oLWNvbmZpcm0tbW9kYWwnKS5tb2RhbCh7IGNsb3NhYmxlOiB0cnVlIH0pLm1vZGFsKCdzaG93Jyk7XG4gICAgICAgICQoJyNtaC1jb25maXJtLW9rJykub2ZmKCdjbGljaycpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgICAgIGFwaURlbGV0ZSgnL2JvdHMvJyArIGJvdC5pZCwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHN0YXRlLmJvdE1vZGFsLnNhdmVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBzdGF0ZS5ib3RNb2RhbC5kcmFmdElkID0gMDtcbiAgICAgICAgICAgICAgICAkKCcjbWgtYm90LW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uRGVsZXRlZCcpKTtcbiAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QoZmFpbHVyZVRleHQoZXJyKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBkaXNjb3ZlcnkgbW9kYWwgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gb3BlbkNoYXRNb2RhbChib3QpIHtcbiAgICAgICAgaWYgKCFib3QpIHsgcmV0dXJuOyB9XG4gICAgICAgIHN0YXRlLmNoYXRNb2RhbCA9IHsgYm90SWQ6IGJvdC5pZCwgYm90OiBib3QsIHRpbWVyOiBudWxsLCBzZWxlY3RlZDoge30gfTtcbiAgICAgICAgJCgnI21oLWNoYXQtbW9kYWwtdGl0bGUnKS50ZXh0KHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdFRpdGxlJywgeyB0aXRsZTogYm90LnRpdGxlIH0pKTtcbiAgICAgICAgdmFyIGlzTWF4ID0gYm90LmNoYW5uZWwgPT09ICdtYXgnO1xuICAgICAgICAkKCcjbWgtY2hhdC1zdGVwcycpLnRleHQodGYoaXNNYXggPyAnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RTdGVwc01heCcgOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RTdGVwcycsIHtcbiAgICAgICAgICAgIGJvdDogYm90LmJvdF91c2VybmFtZSA/ICdAJyArIGJvdC5ib3RfdXNlcm5hbWUgOiBib3QudGl0bGVcbiAgICAgICAgfSkpO1xuICAgICAgICAkKCcjbWgtY2hhdC1mb3VuZCcpLmVtcHR5KCk7XG4gICAgICAgICQoJyNtaC1jaGF0LWVycm9yJykuZW1wdHkoKTtcbiAgICAgICAgJCgnI21oLWNoYXQtZW1wdHknKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgJCgnI21oLWNoYXQtYWdhaW4nKS5hdHRyKCdoaWRkZW4nLCB0cnVlKTtcbiAgICAgICAgJCgnI21oLWNoYXQtc3RvcCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAkKCcjbWgtY2hhdC1zYXZlJykuYXR0cignZGlzYWJsZWQnLCB0cnVlKTtcbiAgICAgICAgJCgnI21oLWNoYXQtc3RhdHVzLXRleHQnKS50ZXh0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0U2VhcmNoaW5nJykpO1xuICAgICAgICAkKCcjbWgtY2hhdC1jb3VudGRvd24nKS50ZXh0KCcnKTtcbiAgICAgICAgJCgnI21oLWNoYXQtcHJvZ3Jlc3MgLmJhcicpLmNzcygnd2lkdGgnLCAnMCUnKTtcbiAgICAgICAgJCgnI21oLWNoYXQtbW9kYWwnKS5tb2RhbCh7IGNsb3NhYmxlOiBmYWxzZSB9KS5tb2RhbCgnc2hvdycpO1xuICAgICAgICBzdGFydERpc2NvdmVyeShib3QuaWQsIGZhbHNlKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzdGFydERpc2NvdmVyeShib3RJZCwgcmVzdGFydCkge1xuICAgICAgICBhcGlQb3N0KCcvYm90cy8nICsgYm90SWQgKyAnOmRpc2NvdmVyQ2hhdHMnLCB7IHJlc3RhcnQ6IHJlc3RhcnQgPT09IHRydWUgfSwgZnVuY3Rpb24gKGJvdCkge1xuICAgICAgICAgICAgaWYgKCFzdGF0ZS5jaGF0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICBzdGF0ZS5jaGF0TW9kYWwuc2VsZWN0ZWQgPSB7fTtcbiAgICAgICAgICAgIHVwZGF0ZUNoYXRNb2RhbChib3QpO1xuICAgICAgICAgICAgc2NoZWR1bGVDaGF0UG9sbCgpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICBzaG93Q2hhdEVycm9yKGZhaWx1cmVUZXh0KGVycikpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzY2hlZHVsZUNoYXRQb2xsKCkge1xuICAgICAgICBzdG9wQ2hhdFBvbGwoKTtcbiAgICAgICAgc3RhdGUuY2hhdE1vZGFsLnRpbWVyID0gc2V0SW50ZXJ2YWwoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKCFzdGF0ZS5jaGF0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICBhcGlHZXQoJy9ib3RzLycgKyBzdGF0ZS5jaGF0TW9kYWwuYm90SWQsIHt9LCBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS5jaGF0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICAgICAgdXBkYXRlQ2hhdE1vZGFsKGJvdCk7XG4gICAgICAgICAgICAgICAgaWYgKCFib3QuZGlzY292ZXJ5LmFjdGl2ZSkge1xuICAgICAgICAgICAgICAgICAgICBzdG9wQ2hhdFBvbGwoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoKSB7IC8qIGtlZXAgdGhlIGxhc3Qgc3RhdGUgKi8gfSk7XG4gICAgICAgIH0sIDIwMDApO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHN0b3BDaGF0UG9sbCgpIHtcbiAgICAgICAgaWYgKHN0YXRlLmNoYXRNb2RhbCAmJiBzdGF0ZS5jaGF0TW9kYWwudGltZXIgIT09IG51bGwpIHtcbiAgICAgICAgICAgIGNsZWFySW50ZXJ2YWwoc3RhdGUuY2hhdE1vZGFsLnRpbWVyKTtcbiAgICAgICAgICAgIHN0YXRlLmNoYXRNb2RhbC50aW1lciA9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiB1cGRhdGVDaGF0TW9kYWwoYm90KSB7XG4gICAgICAgIGlmICghc3RhdGUuY2hhdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICBzdGF0ZS5jaGF0TW9kYWwuYm90ID0gYm90O1xuICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgIHZhciBkaXNjb3ZlcnkgPSBib3QuZGlzY292ZXJ5IHx8IHsgYWN0aXZlOiBmYWxzZSwgc3RhdHVzOiAnaWRsZScsIGZvdW5kOiBbXSB9O1xuICAgICAgICB2YXIgZm91bmQgPSBkaXNjb3ZlcnkuZm91bmQgfHwgW107XG4gICAgICAgIHZhciBzZWxlY3RlZENvdW50ID0gMDtcbiAgICAgICAgdmFyIGh0bWwgPSAnJztcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmb3VuZC5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGl0ZW0gPSBmb3VuZFtpXTtcbiAgICAgICAgICAgIHZhciBpbkJvdCA9IGZpbmRDaGF0QnlFeHRlcm5hbChib3QsIGl0ZW0uY2hhdF9pZCk7XG4gICAgICAgICAgICBpZiAoIWl0ZW0uYWxyZWFkeV9jb25uZWN0ZWQgJiYgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkW2l0ZW0uY2hhdF9pZF0gIT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkW2l0ZW0uY2hhdF9pZF0gPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFyIGNoZWNrZWQgPSAhaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCAmJiBzdGF0ZS5jaGF0TW9kYWwuc2VsZWN0ZWRbaXRlbS5jaGF0X2lkXSA9PT0gdHJ1ZTtcbiAgICAgICAgICAgIGlmIChjaGVja2VkKSB7IHNlbGVjdGVkQ291bnQrKzsgfVxuICAgICAgICAgICAgaHRtbCArPSAnPGxhYmVsIGNsYXNzPVwibWgtZm91bmQtcm93JyArIChpdGVtLmFscmVhZHlfY29ubmVjdGVkID8gJyBpcy1jb25uZWN0ZWQnIDogJycpICsgJ1wiIGRhdGEtY2hhdC1yb3c9XCInICsgKGluQm90ID8gaW5Cb3QuaWQgOiAwKSArICdcIiBkYXRhLWNoYXQta2V5PVwiJyArIGVzYyhpdGVtLmNoYXRfaWQpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cInVpIGNoZWNrYm94JyArIChjaGVja2VkID8gJyBjaGVja2VkJyA6ICcnKSArIChpdGVtLmFscmVhZHlfY29ubmVjdGVkID8gJyBkaXNhYmxlZCcgOiAnJykgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjbGFzcz1cImhpZGRlbiBtaC1mb3VuZC1jaGVja1wiJyArIChjaGVja2VkID8gJyBjaGVja2VkJyA6ICcnKSArIChpdGVtLmFscmVhZHlfY29ubmVjdGVkID8gJyBkaXNhYmxlZCcgOiAnJykgKyAnPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWJveFwiPjwvc3Bhbj48L3NwYW4+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtZm91bmQtdGl0bGVcIj48YiBjbGFzcz1cIm1oLXRydW5jYXRlXCI+JyArIGVzYyhpdGVtLnRpdGxlIHx8IGl0ZW0uY2hhdF9pZCkgKyAnPC9iPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1ldGFcIj4nICsgZXNjKGNoYXRLaW5kTGFiZWwoaXRlbS5jaGF0X2tpbmQpKSArICc8L3NwYW4+PC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cInVpICcgKyAoaXRlbS5hbHJlYWR5X2Nvbm5lY3RlZCA/ICdsYWJlbCcgOiAnYmx1ZSBsYWJlbCcpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArIGVzYyhpdGVtLmFscmVhZHlfY29ubmVjdGVkID8gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RFeGlzdHMnKSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0TmV3JykpICsgJzwvc3Bhbj48L2xhYmVsPic7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLWNoYXQtZm91bmQnKS5odG1sKGh0bWwpO1xuICAgICAgICAkKCcjbWgtY2hhdC1zYXZlJykudGV4dCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdENvbm5lY3RTYXZlJywgeyBjb3VudDogc2VsZWN0ZWRDb3VudCB9KSk7XG4gICAgICAgICQoJyNtaC1jaGF0LXNhdmUnKS5hdHRyKCdkaXNhYmxlZCcsIHNlbGVjdGVkQ291bnQgPT09IDAgPyB0cnVlIDogbnVsbCk7XG5cbiAgICAgICAgdmFyIHN0YXR1c1RleHQgPSAnJztcbiAgICAgICAgdmFyIGNvdW50ZG93biA9ICcnO1xuICAgICAgICB2YXIgcHJvZ3Jlc3MgPSAwO1xuICAgICAgICBpZiAoZGlzY292ZXJ5LmFjdGl2ZSkge1xuICAgICAgICAgICAgaWYgKGZvdW5kLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBzdGF0dXNUZXh0ID0gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0Rm91bmQnLCB7IGNvdW50OiBmb3VuZC5sZW5ndGggfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHN0YXR1c1RleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdFNlYXJjaGluZycpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY291bnRkb3duID0gdGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0UmVtYWluaW5nJywgeyB0aW1lOiBmbXRDb3VudGRvd24oZGlzY292ZXJ5LnJlbWFpbmluZ19zZWMpIH0pO1xuICAgICAgICAgICAgcHJvZ3Jlc3MgPSBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIE1hdGgucm91bmQoKDMwMCAtIGRpc2NvdmVyeS5yZW1haW5pbmdfc2VjKSAvIDMwMCAqIDEwMCkpKTtcbiAgICAgICAgICAgICQoJyNtaC1jaGF0LWVtcHR5JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICAgICAkKCcjbWgtY2hhdC1lcnJvcicpLmVtcHR5KCk7XG4gICAgICAgICAgICAkKCcjbWgtY2hhdC1hZ2FpbicpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLWNoYXQtc3RvcCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgJCgnI21oLWNoYXQtc3RvcCcpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgJCgnI21oLWNoYXQtYWdhaW4nKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgIGlmIChkaXNjb3Zlcnkuc3RhdHVzID09PSAnZXJyb3InKSB7XG4gICAgICAgICAgICAgICAgdmFyIGNvZGUgPSBTdHJpbmcoZGlzY292ZXJ5Lmxhc3RfZXJyb3JfY29kZSB8fCAnJyk7XG4gICAgICAgICAgICAgICAgdmFyIHRleHQ7XG4gICAgICAgICAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MDkud2ViaG9va19zZXQnKSB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdEVycm9yV2ViaG9vaycpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoY29kZSA9PT0gJ21heC40MDUud2ViaG9va19zZXQnKSB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdEVycm9yV2ViaG9va01heCcpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoaXNNYXhUbHNDb2RlKGNvZGUpKSB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQgPSB0bHNFcnJvclRleHQoKTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGNvZGUgPT09ICdtYXguNDAxLnVuYXV0aG9yaXplZCcgfHwgY29kZSA9PT0gJ3RlbGVncmFtLjQwMS51bmF1dGhvcml6ZWQnKSB7XG4gICAgICAgICAgICAgICAgICAgIHRleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkNDAxJyk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGV4dCA9IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRDb25uZWN0RXJyb3InKSArICcgKCcgKyBjb2RlICsgJyknO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzaG93Q2hhdEVycm9yKHRleHQpO1xuICAgICAgICAgICAgICAgIHN0YXR1c1RleHQgPSAnJztcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZGlzY292ZXJ5LnN0YXR1cyA9PT0gJ2VtcHR5Jykge1xuICAgICAgICAgICAgICAgIHN0YXR1c1RleHQgPSAnJztcbiAgICAgICAgICAgICAgICAkKCcjbWgtY2hhdC1lbXB0eScpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChmb3VuZC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgc3RhdHVzVGV4dCA9IHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdFRpbWVvdXQnLCB7IGNvdW50OiBmb3VuZC5sZW5ndGggfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHN0YXR1c1RleHQgPSB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0Q29ubmVjdE5vU2Vzc2lvbicpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY291bnRkb3duID0gJyc7XG4gICAgICAgICAgICBwcm9ncmVzcyA9IDEwMDtcbiAgICAgICAgfVxuICAgICAgICAkKCcjbWgtY2hhdC1zdGF0dXMtdGV4dCcpLnRleHQoc3RhdHVzVGV4dCk7XG4gICAgICAgICQoJyNtaC1jaGF0LWNvdW50ZG93bicpLnRleHQoY291bnRkb3duKTtcbiAgICAgICAgJCgnI21oLWNoYXQtcHJvZ3Jlc3MgLmJhcicpLmNzcygnd2lkdGgnLCBwcm9ncmVzcyArICclJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZmluZENoYXRCeUV4dGVybmFsKGJvdCwgY2hhdElkKSB7XG4gICAgICAgIHZhciBjaGF0cyA9IGJvdC5jaGF0cyB8fCBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGF0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKFN0cmluZyhjaGF0c1tpXS5jaGF0X2lkKSA9PT0gU3RyaW5nKGNoYXRJZCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gY2hhdHNbaV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2hvd0NoYXRFcnJvcih0ZXh0KSB7XG4gICAgICAgICQoJyNtaC1jaGF0LWVycm9yJykuaHRtbCgnPGRpdiBjbGFzcz1cInVpIG5lZ2F0aXZlIG1lc3NhZ2VcIiByb2xlPVwiYWxlcnRcIj4nXG4gICAgICAgICAgICArICc8c3ZnIGNsYXNzPVwibWgtaVwiIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiBhcmlhLWhpZGRlbj1cInRydWVcIj48Y2lyY2xlIGN4PVwiOFwiIGN5PVwiOFwiIHI9XCI2LjI1XCIvPjxwYXRoIGQ9XCJNNiA2bDQgNE0xMCA2bC00IDRcIi8+PC9zdmc+J1xuICAgICAgICAgICAgKyAnPGRpdj4nICsgZXNjKHRleHQpICsgJzwvZGl2PjwvZGl2PicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJpbmRDaGF0Rm91bmQoKSB7XG4gICAgICAgICQoJyNtaC1jaGF0LWZvdW5kJykub24oJ2NoYW5nZScsICcubWgtZm91bmQtY2hlY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoIXN0YXRlLmNoYXRNb2RhbCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHZhciBrZXkgPSBTdHJpbmcoJCh0aGlzKS5jbG9zZXN0KCcubWgtZm91bmQtcm93JykuZGF0YSgnY2hhdC1rZXknKSk7XG4gICAgICAgICAgICBzdGF0ZS5jaGF0TW9kYWwuc2VsZWN0ZWRba2V5XSA9ICQodGhpcykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICAgICAgdXBkYXRlQ2hhdE1vZGFsKHN0YXRlLmNoYXRNb2RhbC5ib3QpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlU2VsZWN0ZWRDaGF0cygpIHtcbiAgICAgICAgaWYgKCFzdGF0ZS5jaGF0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgIHZhciBib3QgPSBzdGF0ZS5jaGF0TW9kYWwuYm90O1xuICAgICAgICB2YXIgcGF0Y2hlcyA9IFtdO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IChib3QuZGlzY292ZXJ5LmZvdW5kIHx8IFtdKS5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGl0ZW0gPSBib3QuZGlzY292ZXJ5LmZvdW5kW2ldO1xuICAgICAgICAgICAgaWYgKGl0ZW0uYWxyZWFkeV9jb25uZWN0ZWQgfHwgc3RhdGUuY2hhdE1vZGFsLnNlbGVjdGVkW2l0ZW0uY2hhdF9pZF0gIT09IHRydWUpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBjaGF0ID0gZmluZENoYXRCeUV4dGVybmFsKGJvdCwgaXRlbS5jaGF0X2lkKTtcbiAgICAgICAgICAgIGlmIChjaGF0KSB7XG4gICAgICAgICAgICAgICAgcGF0Y2hlcy5wdXNoKHsgaWQ6IGNoYXQuaWQsIGVuYWJsZWQ6IHRydWUsIGNoYXRfa2luZDogaXRlbS5jaGF0X2tpbmQsIHRpdGxlOiBpdGVtLnRpdGxlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChwYXRjaGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGFwaVBhdGNoKCcvYm90cy8nICsgYm90LmlkLCB7IGNoYXRzOiBwYXRjaGVzIH0sIGZ1bmN0aW9uIChzYXZlZCkge1xuICAgICAgICAgICAgYXBpUG9zdCgnL2JvdHMvJyArIGJvdC5pZCArICc6ZGlzY292ZXJDaGF0cycsIHsgc3RvcDogdHJ1ZSB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgY2xvc2VDaGF0TW9kYWwoKTtcbiAgICAgICAgICAgICAgICByZXBsYWNlQm90KHNhdmVkKTtcbiAgICAgICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZWQnKSk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgY2xvc2VDaGF0TW9kYWwoKTtcbiAgICAgICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZWQnKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgc2hvd0NoYXRFcnJvcihmYWlsdXJlVGV4dChlcnIpKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY2xvc2VDaGF0TW9kYWwoKSB7XG4gICAgICAgIHN0b3BDaGF0UG9sbCgpO1xuICAgICAgICBzdGF0ZS5jaGF0TW9kYWwgPSBudWxsO1xuICAgICAgICAkKCcjbWgtY2hhdC1tb2RhbCcpLm1vZGFsKCdoaWRlJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3RvcERpc2NvdmVyeUFuZENsb3NlKCkge1xuICAgICAgICB2YXIgYm90ID0gc3RhdGUuY2hhdE1vZGFsID8gc3RhdGUuY2hhdE1vZGFsLmJvdCA6IG51bGw7XG4gICAgICAgIGlmIChib3QpIHtcbiAgICAgICAgICAgIGFwaVBvc3QoJy9ib3RzLycgKyBib3QuaWQgKyAnOmRpc2NvdmVyQ2hhdHMnLCB7IHN0b3A6IHRydWUgfSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGNsb3NlQ2hhdE1vZGFsKCk7XG4gICAgICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgY2xvc2VDaGF0TW9kYWwoKTtcbiAgICAgICAgICAgICAgICBsb2FkQm90cyh0cnVlKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2xvc2VDaGF0TW9kYWwoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gdGVzdCBtb2RhbCAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBvcGVuVGVzdE1vZGFsKGJvdCwgY2hhdElkcykge1xuICAgICAgICBpZiAoIWJvdCkgeyByZXR1cm47IH1cbiAgICAgICAgc3RhdGUudGVzdE1vZGFsID0geyBib3RJZDogYm90LmlkLCBib3Q6IGJvdCwgZXZlbnRJZDogMCwgY2hhdElkczogY2hhdElkcywgdGltZXI6IG51bGwsIHRyaWVzOiAwIH07XG4gICAgICAgICQoJyNtaC10ZXN0LWxpc3QnKS5odG1sKCc8ZGl2IGNsYXNzPVwibWgtbXV0ZWRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3RSdW5uaW5nJykpICsgJzwvZGl2PicpO1xuICAgICAgICAkKCcjbWgtdGVzdC1zdW1tYXJ5JykudGV4dCgnJyk7XG4gICAgICAgICQoJyNtaC10ZXN0LW1vZGFsJykubW9kYWwoeyBjbG9zYWJsZTogdHJ1ZSwgb25IaWRlOiBmdW5jdGlvbiAoKSB7IHN0b3BUZXN0UG9sbCgpOyB9IH0pLm1vZGFsKCdzaG93Jyk7XG4gICAgICAgIHZhciBwYXlsb2FkID0gY2hhdElkcyA9PT0gbnVsbCA/IHt9IDogeyBjaGF0X2lkczogY2hhdElkcyB9O1xuICAgICAgICBhcGlQb3N0KCcvYm90cy8nICsgYm90LmlkICsgJzpzZW5kVGVzdCcsIHBheWxvYWQsIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICBpZiAoIXN0YXRlLnRlc3RNb2RhbCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHN0YXRlLnRlc3RNb2RhbC5ldmVudElkID0gZGF0YS5ldmVudF9pZDtcbiAgICAgICAgICAgIHN0YXRlLnRlc3RNb2RhbC5ib3QgPSBkYXRhLmJvdDtcbiAgICAgICAgICAgIHJlcGxhY2VCb3QoZGF0YS5ib3QpO1xuICAgICAgICAgICAgcmVuZGVyVGVzdChkYXRhLmJvdCk7XG4gICAgICAgICAgICBzY2hlZHVsZVRlc3RQb2xsKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICQoJyNtaC10ZXN0LWxpc3QnKS5odG1sKCc8ZGl2IGNsYXNzPVwidWkgbmVnYXRpdmUgbWVzc2FnZVwiPjxkaXY+JyArIGVzYyhmYWlsdXJlVGV4dChlcnIpKSArICc8L2Rpdj48L2Rpdj4nKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2NoZWR1bGVUZXN0UG9sbCgpIHtcbiAgICAgICAgc3RvcFRlc3RQb2xsKCk7XG4gICAgICAgIHN0YXRlLnRlc3RNb2RhbC50aW1lciA9IHNldEludGVydmFsKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmICghc3RhdGUudGVzdE1vZGFsKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgc3RhdGUudGVzdE1vZGFsLnRyaWVzKys7XG4gICAgICAgICAgICBhcGlHZXQoJy9ib3RzLycgKyBzdGF0ZS50ZXN0TW9kYWwuYm90SWQsIHt9LCBmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS50ZXN0TW9kYWwpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICAgICAgc3RhdGUudGVzdE1vZGFsLmJvdCA9IGJvdDtcbiAgICAgICAgICAgICAgICByZXBsYWNlQm90KGJvdCk7XG4gICAgICAgICAgICAgICAgcmVuZGVyVGVzdChib3QpO1xuICAgICAgICAgICAgICAgIGlmICghdGVzdFBlbmRpbmcoYm90KSB8fCBzdGF0ZS50ZXN0TW9kYWwudHJpZXMgPiAyMCkge1xuICAgICAgICAgICAgICAgICAgICBzdG9wVGVzdFBvbGwoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgaWYgKHN0YXRlLnRlc3RNb2RhbCAmJiBzdGF0ZS50ZXN0TW9kYWwudHJpZXMgPiAzKSB7XG4gICAgICAgICAgICAgICAgICAgIHN0b3BUZXN0UG9sbCgpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9LCAyMDAwKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzdG9wVGVzdFBvbGwoKSB7XG4gICAgICAgIGlmIChzdGF0ZS50ZXN0TW9kYWwgJiYgc3RhdGUudGVzdE1vZGFsLnRpbWVyICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjbGVhckludGVydmFsKHN0YXRlLnRlc3RNb2RhbC50aW1lcik7XG4gICAgICAgICAgICBzdGF0ZS50ZXN0TW9kYWwudGltZXIgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdGVzdERlbGl2ZXJpZXMoYm90KSB7XG4gICAgICAgIHZhciBldmVudElkID0gc3RhdGUudGVzdE1vZGFsID8gc3RhdGUudGVzdE1vZGFsLmV2ZW50SWQgOiAwO1xuICAgICAgICB2YXIgcmVzdWx0ID0gW107XG4gICAgICAgIHZhciBjaGF0cyA9IGJvdC5jaGF0cyB8fCBbXTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGF0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGRlbGl2ZXJ5ID0gY2hhdHNbaV0ubGFzdF9kZWxpdmVyeTtcbiAgICAgICAgICAgIGlmIChkZWxpdmVyeSAmJiBOdW1iZXIoZGVsaXZlcnkuZXZlbnRfaWQpID09PSBOdW1iZXIoZXZlbnRJZCkpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQucHVzaCh7IGNoYXQ6IGNoYXRzW2ldLCBkZWxpdmVyeTogZGVsaXZlcnkgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB0ZXN0UGVuZGluZyhib3QpIHtcbiAgICAgICAgdmFyIGxpc3QgPSB0ZXN0RGVsaXZlcmllcyhib3QpO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBzdGF0dXMgPSBsaXN0W2ldLmRlbGl2ZXJ5LnN0YXR1cztcbiAgICAgICAgICAgIGlmIChzdGF0dXMgPT09ICdwZW5kaW5nJyB8fCBzdGF0dXMgPT09ICdzZW5kaW5nJykge1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBkZWxpdmVyeVN0YXR1c0xhYmVsKGRlbGl2ZXJ5KSB7XG4gICAgICAgIGlmIChkZWxpdmVyeS5zdGF0dXMgPT09ICdzZW50JykgeyByZXR1cm4geyBjbHM6ICdpcy1vaycsIHRleHQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3REZWxpdmVyZWQnKSB9OyB9XG4gICAgICAgIGlmIChkZWxpdmVyeS5zdGF0dXMgPT09ICdwZW5kaW5nJyB8fCBkZWxpdmVyeS5zdGF0dXMgPT09ICdzZW5kaW5nJykgeyByZXR1cm4geyBjbHM6ICcnLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0UXVldWVkJykgfTsgfVxuICAgICAgICByZXR1cm4geyBjbHM6ICdpcy1lcnInLCB0ZXh0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0RXJyb3InKSB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGRlbGl2ZXJ5RXJyb3JUZXh0KGNvZGUpIHtcbiAgICAgICAgaWYgKGlzTWF4VGxzQ29kZShjb2RlKSkgeyByZXR1cm4gdGxzRXJyb3JUZXh0KCk7IH1cbiAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MDEudW5hdXRob3JpemVkJyB8fCBjb2RlID09PSAnbWF4LjQwMS51bmF1dGhvcml6ZWQnKSB7IHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Cb3RDaGVja2VkNDAxJyk7IH1cbiAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MDMua2lja2VkJyB8fCBjb2RlID09PSAndGVsZWdyYW0uNDAzLmJsb2NrZWQnIHx8IGNvZGUgPT09ICd0ZWxlZ3JhbS40MDAuY2hhdF9ub3RfZm91bmQnXG4gICAgICAgICAgICB8fCBjb2RlID09PSAnbWF4LjQwMy5jaGF0X2RlbmllZCcgfHwgY29kZSA9PT0gJ21heC40MDQubm90X2ZvdW5kJyB8fCBjb2RlID09PSAnbWF4LjQwNC51bmtub3duJykge1xuICAgICAgICAgICAgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRTdGF0dXNHb25lJyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNvZGUgPT09ICd0ZWxlZ3JhbS40MjkucmF0ZV9saW1pdCcgfHwgY29kZSA9PT0gJ21heC40MjkucmF0ZV9saW1pdCcpIHsgcmV0dXJuIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NoYXRFcnJvclJhdGVMaW1pdCcpOyB9XG4gICAgICAgIGlmIChjb2RlID09PSAnc3RhbGUnKSB7IHJldHVybiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9DaGF0RXJyb3JTdGFsZScpOyB9XG4gICAgICAgIHJldHVybiBjb2RlO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlclRlc3QoYm90KSB7XG4gICAgICAgIHZhciBsaXN0ID0gdGVzdERlbGl2ZXJpZXMoYm90KTtcbiAgICAgICAgdmFyIGNvdW50cyA9IHsgc2VudDogMCwgcGVuZGluZzogMCwgZmFpbGVkOiAwIH07XG4gICAgICAgIHZhciBodG1sID0gJyc7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIGNoYXQgPSBsaXN0W2ldLmNoYXQ7XG4gICAgICAgICAgICB2YXIgZGVsaXZlcnkgPSBsaXN0W2ldLmRlbGl2ZXJ5O1xuICAgICAgICAgICAgdmFyIGxhYmVsID0gZGVsaXZlcnlTdGF0dXNMYWJlbChkZWxpdmVyeSk7XG4gICAgICAgICAgICBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAnc2VudCcpIHsgY291bnRzLnNlbnQrKzsgfVxuICAgICAgICAgICAgZWxzZSBpZiAoZGVsaXZlcnkuc3RhdHVzID09PSAncGVuZGluZycgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnc2VuZGluZycpIHsgY291bnRzLnBlbmRpbmcrKzsgfVxuICAgICAgICAgICAgZWxzZSB7IGNvdW50cy5mYWlsZWQrKzsgfVxuICAgICAgICAgICAgdmFyIHJldHJ5ID0gKGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ2ZhaWxlZCcgfHwgZGVsaXZlcnkuc3RhdHVzID09PSAnZHJvcHBlZCcpXG4gICAgICAgICAgICAgICAgPyAnPGJ1dHRvbiBjbGFzcz1cInVpIGJhc2ljIGJ1dHRvbiBtaC10ZXN0LXJldHJ5XCIgdHlwZT1cImJ1dHRvblwiIGRhdGEtY2hhdC1pZD1cIicgKyBjaGF0LmlkICsgJ1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfVGVzdFJldHJ5JykpICsgJzwvYnV0dG9uPidcbiAgICAgICAgICAgICAgICA6ICcnO1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIm1oLXRlc3Qtcm93XCI+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyICcgKyAoYm90LmNoYW5uZWwgPT09ICdtYXgnID8gJ21heCcgOiAndGcnKSArICcgc1wiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPicgKyAoYm90LmNoYW5uZWwgPT09ICdtYXgnID8gJ01BWCcgOiAnVEcnKSArICc8L3NwYW4+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC10ZXN0LXRpdGxlXCI+PGRpdiBjbGFzcz1cIm1oLXRydW5jYXRlXCI+JyArIGVzYyhjaGF0LnRpdGxlIHx8IGNoYXQuY2hhdF9pZCkgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgKGRlbGl2ZXJ5Lmxhc3RfZXJyb3JfY29kZSA/ICc8ZGl2IGNsYXNzPVwibWgtbWV0YSBtaC1lcnJvci10ZXh0XCI+JyArIGVzYyhkZWxpdmVyeUVycm9yVGV4dChkZWxpdmVyeS5sYXN0X2Vycm9yX2NvZGUpKSArICc8L2Rpdj4nIDogJycpXG4gICAgICAgICAgICAgICAgKyAnPC9kaXY+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtdGVzdC1zdGF0ZSAnICsgbGFiZWwuY2xzICsgJ1wiPicgKyBlc2MobGFiZWwudGV4dCkgKyAnPC9zcGFuPicgKyByZXRyeSArICc8L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmIChodG1sID09PSAnJykge1xuICAgICAgICAgICAgaHRtbCA9ICc8ZGl2IGNsYXNzPVwibWgtbXV0ZWRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1Rlc3RSdW5uaW5nJykpICsgJzwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLXRlc3QtbGlzdCcpLmh0bWwoaHRtbCk7XG4gICAgICAgICQoJyNtaC10ZXN0LXN1bW1hcnknKS50ZXh0KHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9UZXN0U3VtbWFyeScsIHtcbiAgICAgICAgICAgIG9rOiBjb3VudHMuc2VudCxcbiAgICAgICAgICAgIGZhaWxlZDogY291bnRzLmZhaWxlZCxcbiAgICAgICAgICAgIHBlbmRpbmc6IGNvdW50cy5wZW5kaW5nXG4gICAgICAgIH0pKTtcbiAgICAgICAgJCgnI21oLXRlc3QtbGlzdCAubWgtdGVzdC1yZXRyeScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBjaGF0SWQgPSBOdW1iZXIoJCh0aGlzKS5kYXRhKCdjaGF0LWlkJykpO1xuICAgICAgICAgICAgb3BlblRlc3RNb2RhbChzdGF0ZS50ZXN0TW9kYWwgPyBzdGF0ZS50ZXN0TW9kYWwuYm90IDogYm90LCBbY2hhdElkXSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gZ2VuZXJhbCBzZXR0aW5ncyAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBsb2FkR2VuZXJhbFNldHRpbmdzKCkge1xuICAgICAgICBhcGlHZXQoJy9zZXR0aW5ncycsIHt9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgc3RhdGUucmV0ZW50aW9uID0gZGF0YS5ldmVudHNfcmV0ZW50aW9uX2RheXM7XG4gICAgICAgICAgICBzdGF0ZS5zZXR0aW5ncyA9IGRhdGE7XG4gICAgICAgICAgICAkKCcjbWgtcmV0ZW50aW9uLWlucHV0JykudmFsKGRhdGEuZXZlbnRzX3JldGVudGlvbl9kYXlzKTtcbiAgICAgICAgICAgICQoJyNtaC1wdWJsaWMtdXJsLWlucHV0JykudmFsKGRhdGEucGJ4X3B1YmxpY191cmwgfHwgJycpO1xuICAgICAgICAgICAgJCgnI21oLXByb3h5LWlucHV0JykudmFsKGRhdGEucHJveHlfdXJsIHx8ICcnKTtcbiAgICAgICAgICAgICQoJyNtaC1tYXgtY2EtaW5wdXQnKS52YWwoZGF0YS5tYXhfY2FfYnVuZGxlX3BhdGggfHwgJycpO1xuICAgICAgICAgICAgY2xlYXJGaWVsZEVycm9yKCcjbWgtbWF4LWNhLWZpZWxkJyk7XG4gICAgICAgICAgICAkKCcjbWgtbWFzay1kZWZhdWx0JykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCBkYXRhLm1hc2tfcGhvbmVfZGVmYXVsdCA9PT0gdHJ1ZSk7XG4gICAgICAgICAgICAkKCcjbWgtbWFzay1kZWZhdWx0IGlucHV0JykucHJvcCgnY2hlY2tlZCcsIGRhdGEubWFza19waG9uZV9kZWZhdWx0ID09PSB0cnVlKTtcbiAgICAgICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLXB1YmxpYy11cmwtZmllbGQnKTtcbiAgICAgICAgICAgIGNsZWFyRmllbGRFcnJvcignI21oLXByb3h5LWZpZWxkJyk7XG4gICAgICAgICAgICBjbGVhclJldGVudGlvbkVycm9yKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICBtYXJrUmV0ZW50aW9uRXJyb3IodGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vbkxvYWRFcnJvcicsIHtcbiAgICAgICAgICAgICAgICB3aGF0OiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Mb2FkV2hhdFNldHRpbmdzJyksXG4gICAgICAgICAgICAgICAgY29kZTogZmFpbHVyZS5zdGF0dXMgPiAwID8gZmFpbHVyZS5zdGF0dXMgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25UaW1lb3V0JylcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZVNldHRpbmcocGF5bG9hZCwgZmllbGRTZWxlY3RvciwgcmV2ZXJ0KSB7XG4gICAgICAgIGFwaVBhdGNoKCcvc2V0dGluZ3MnLCBwYXlsb2FkLCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgc3RhdGUuc2V0dGluZ3MgPSBkYXRhO1xuICAgICAgICAgICAgaWYgKGZpZWxkU2VsZWN0b3IpIHsgY2xlYXJGaWVsZEVycm9yKGZpZWxkU2VsZWN0b3IpOyB9XG4gICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ29tbW9uU2F2ZWQnKSk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICBpZiAoZmllbGRTZWxlY3Rvcikge1xuICAgICAgICAgICAgICAgIG1hcmtGaWVsZEVycm9yKGZpZWxkU2VsZWN0b3IsIGZhaWx1cmVUZXh0KGZhaWx1cmUpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXZlcnQpIHsgcmV2ZXJ0KCk7IH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2F2ZVB1YmxpY1VybCgpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gU3RyaW5nKCQoJyNtaC1wdWJsaWMtdXJsLWlucHV0JykudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgdmFyIHByZXZpb3VzID0gc3RhdGUuc2V0dGluZ3MgPyBzdGF0ZS5zZXR0aW5ncy5wYnhfcHVibGljX3VybCA6ICcnO1xuICAgICAgICBpZiAodmFsdWUgPT09ICcnKSB7XG4gICAgICAgICAgICBzYXZlU2V0dGluZyh7IHBieF9wdWJsaWNfdXJsOiAnJyB9LCAnI21oLXB1YmxpYy11cmwtZmllbGQnKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIS9eaHR0cHM/OlxcL1xcL1xcUyskL2kudGVzdCh2YWx1ZSkpIHtcbiAgICAgICAgICAgIG1hcmtGaWVsZEVycm9yKCcjbWgtcHVibGljLXVybC1maWVsZCcsIHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NldHRpbmdzUHVibGljVXJsSW52YWxpZCcpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBzYXZlU2V0dGluZyh7IHBieF9wdWJsaWNfdXJsOiB2YWx1ZSB9LCAnI21oLXB1YmxpYy11cmwtZmllbGQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtcHVibGljLXVybC1pbnB1dCcpLnZhbChwcmV2aW91cyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVQcm94eSgpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gU3RyaW5nKCQoJyNtaC1wcm94eS1pbnB1dCcpLnZhbCgpIHx8ICcnKS50cmltKCk7XG4gICAgICAgIHZhciBwcmV2aW91cyA9IHN0YXRlLnNldHRpbmdzID8gc3RhdGUuc2V0dGluZ3MucHJveHlfdXJsIDogJyc7XG4gICAgICAgIGlmICh2YWx1ZSAhPT0gJycgJiYgIS9eKChodHRwcz98c29ja3M1aD8pOlxcL1xcLyk/W0EtWmEtejAtOS5cXC1dKzpcXGR7MSw1fSQvLnRlc3QodmFsdWUpKSB7XG4gICAgICAgICAgICBtYXJrRmllbGRFcnJvcignI21oLXByb3h5LWZpZWxkJywgdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU2V0dGluZ3NQcm94eUludmFsaWQnKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgc2F2ZVNldHRpbmcoeyBwcm94eV91cmw6IHZhbHVlIH0sICcjbWgtcHJveHktZmllbGQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtcHJveHktaW5wdXQnKS52YWwocHJldmlvdXMpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlTWF4Q2FCdW5kbGUoKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IFN0cmluZygkKCcjbWgtbWF4LWNhLWlucHV0JykudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgdmFyIHByZXZpb3VzID0gc3RhdGUuc2V0dGluZ3MgPyBzdGF0ZS5zZXR0aW5ncy5tYXhfY2FfYnVuZGxlX3BhdGggOiAnJztcbiAgICAgICAgaWYgKHZhbHVlICE9PSAnJyAmJiB2YWx1ZS5jaGFyQXQoMCkgIT09ICcvJykge1xuICAgICAgICAgICAgbWFya0ZpZWxkRXJyb3IoJyNtaC1tYXgtY2EtZmllbGQnLCB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9TZXR0aW5nc0NhUGF0aEludmFsaWQnKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgc2F2ZVNldHRpbmcoeyBtYXhfY2FfYnVuZGxlX3BhdGg6IHZhbHVlIH0sICcjbWgtbWF4LWNhLWZpZWxkJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLW1heC1jYS1pbnB1dCcpLnZhbChwcmV2aW91cyk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNhdmVNYXNrRGVmYXVsdCgpIHtcbiAgICAgICAgdmFyIGNoZWNrZWQgPSAkKCcjbWgtbWFzay1kZWZhdWx0IGlucHV0JykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICBzYXZlU2V0dGluZyh7IG1hc2tfcGhvbmVfZGVmYXVsdDogY2hlY2tlZCB9LCBudWxsLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtbWFzay1kZWZhdWx0IGlucHV0JykucHJvcCgnY2hlY2tlZCcsICFjaGVja2VkKTtcbiAgICAgICAgICAgICQoJyNtaC1tYXNrLWRlZmF1bHQnKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsICFjaGVja2VkKTtcbiAgICAgICAgICAgIHNob3dUb2FzdCh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25TYXZlRmFpbGVkJykpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmbXRDb3VudGRvd24oc2Vjb25kcykge1xuICAgICAgICB2YXIgdG90YWwgPSBNYXRoLm1heCgwLCBwYXJzZUludChzZWNvbmRzLCAxMCkgfHwgMCk7XG4gICAgICAgIHJldHVybiBNYXRoLmZsb29yKHRvdGFsIC8gNjApICsgJzonICsgcGFkKHRvdGFsICUgNjApO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gbm90aWZpY2F0aW9uczogcnVsZXMgQVBJICYgbGlzdCAtLS0tLS0tLS0tXG5cbiAgICBmdW5jdGlvbiBsb2FkUnVsZXMoc2lsZW50KSB7XG4gICAgICAgIGlmICghc2lsZW50KSB7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlc0xvYWRlZCA9IGZhbHNlO1xuICAgICAgICAgICAgcmVuZGVyUnVsZXNTa2VsZXRvbigpO1xuICAgICAgICB9XG4gICAgICAgIGFwaUdldCgnL3J1bGVzJywgeyBsaW1pdDogMjAwIH0sIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlcyA9IGRhdGEuaXRlbXMgfHwgW107XG4gICAgICAgICAgICBzdGF0ZS5ydWxlc0xvYWRlZCA9IHRydWU7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlc0Vycm9yID0gbnVsbDtcbiAgICAgICAgICAgIHJlbmRlclJ1bGVzKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlc0xvYWRlZCA9IHRydWU7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlc0Vycm9yID0gZmFpbHVyZTtcbiAgICAgICAgICAgIHJlbmRlclJ1bGVzKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlclJ1bGVzU2tlbGV0b24oKSB7XG4gICAgICAgIHZhciByb3cgPSAnPGRpdiBjbGFzcz1cIm1oLW5vdGlmLXJvd1wiPjxzcGFuIGNsYXNzPVwibWgtc2tlbFwiIHN0eWxlPVwid2lkdGg6MzZweDtoZWlnaHQ6MjBweDtib3JkZXItcmFkaXVzOjEwcHhcIj48L3NwYW4+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1za2VsXCIgc3R5bGU9XCJ3aWR0aDo0MCVcIj48L3NwYW4+PHNwYW4+PC9zcGFuPjxzcGFuPjwvc3Bhbj48L2Rpdj4nO1xuICAgICAgICAkKCcjbWgtcnVsZXMtbGlzdCcpLmh0bWwocm93ICsgcm93KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzb3VyY2VGb3JSdWxlKHJ1bGUpIHtcbiAgICAgICAgaWYgKHJ1bGUuc291cmNlX2lkKSB7XG4gICAgICAgICAgICB2YXIgYnlJZCA9IHNvdXJjZUJ5SWQocnVsZS5zb3VyY2VfaWQpO1xuICAgICAgICAgICAgaWYgKGJ5SWQpIHsgcmV0dXJuIGJ5SWQ7IH1cbiAgICAgICAgfVxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLnNvdXJjZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciB0eXBlcyA9IHN0YXRlLnNvdXJjZXNbaV0uZXZlbnRfdHlwZXMgfHwgW107XG4gICAgICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IHR5cGVzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICAgICAgaWYgKHJ1bGUuZXZlbnRfdHlwZXMgJiYgcnVsZS5ldmVudF90eXBlcy5pbmRleE9mKHR5cGVzW2pdLnR5cGUpID49IDApIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHN0YXRlLnNvdXJjZXNbaV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNldFJ1bGVBZGRWaXNpYmxlKHZpc2libGUpIHtcbiAgICAgICAgJCgnI21oLXJ1bGUtYWRkJykuYXR0cignaGlkZGVuJywgdmlzaWJsZSA/IG51bGwgOiB0cnVlKTtcbiAgICB9XG5cbiAgICAvLyBEZXNpZ24gdjMsIMKr0KPQstC10LTQvtC80LvQtdC90LjRj8K7OiBubyBib3Qg4oaSIHBpY2sgYSBtZXNzZW5nZXI7IGJvdCBidXQgbm8gbm90aWZpY2F0aW9ucyDihpIgb25lIHByaW1hcnkgYnV0dG9uO1xuICAgIC8vIG90aGVyd2lzZSB0aGUgbGlzdCBncm91cGVkINCX0LLQvtC90LrQuCDihpIg0JjQmCDQodGD0L/QtdGA0LLQsNC50LfQtdGAIOKGkiDQk9C+0LvQvtGB0L7QstC+0Lkg0LDQs9C10L3RgiDihpIg0KHQstGP0LfRjCDQuCDQkNCi0KEgKGhlYWRpbmdzIG9ubHkgZm9yIDIrIGdyb3VwcykuXG4gICAgZnVuY3Rpb24gcmVuZGVyUnVsZXMoKSB7XG4gICAgICAgIHZhciAkbGlzdCA9ICQoJyNtaC1ydWxlcy1saXN0Jyk7XG4gICAgICAgIGlmICghc3RhdGUucnVsZXNMb2FkZWQgfHwgIXN0YXRlLmJvdHNMb2FkZWQpIHtcbiAgICAgICAgICAgIHNldFJ1bGVBZGRWaXNpYmxlKGZhbHNlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc3RhdGUucnVsZXNFcnJvciAhPT0gbnVsbCAmJiBzdGF0ZS5ydWxlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHNldFJ1bGVBZGRWaXNpYmxlKGZhbHNlKTtcbiAgICAgICAgICAgICRsaXN0Lmh0bWwoJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlXCIgcm9sZT1cImFsZXJ0XCI+JyArIElDT05fRVJST1JcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtZ3Jvd1wiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZXNMb2FkRmFpbGVkJykpICsgJzwvZGl2PidcbiAgICAgICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uIG1oLW9uLW1lc3NhZ2VcIiB0eXBlPVwiYnV0dG9uXCIgaWQ9XCJtaC1ydWxlcy1yZXRyeVwiPidcbiAgICAgICAgICAgICAgICArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Db21tb25SZXRyeScpKSArICc8L2J1dHRvbj48L2Rpdj4nKTtcbiAgICAgICAgICAgICQoJyNtaC1ydWxlcy1yZXRyeScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHsgbG9hZFJ1bGVzKCk7IH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmIChzdGF0ZS5ib3RzLmxlbmd0aCA9PT0gMCAmJiBzdGF0ZS5ydWxlcy5sZW5ndGggPT09IDAgJiYgc3RhdGUuYm90c0Vycm9yID09PSBudWxsKSB7XG4gICAgICAgICAgICBzZXRSdWxlQWRkVmlzaWJsZShmYWxzZSk7XG4gICAgICAgICAgICAkbGlzdC5odG1sKCc8ZGl2IGNsYXNzPVwibWgtb25ib2FyZFwiIHJvbGU9XCJzdGF0dXNcIj4nXG4gICAgICAgICAgICAgICAgKyAnPGgzIGNsYXNzPVwidWkgaGVhZGVyIG1oLXBhZ2UtdGl0bGVcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX09uYm9hcmRUaXRsZScpKSArICc8L2gzPidcbiAgICAgICAgICAgICAgICArIG1lc3NlbmdlclRpbGVzKCkgKyAnPC9kaXY+Jyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHN0YXRlLnJ1bGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgc2V0UnVsZUFkZFZpc2libGUoZmFsc2UpO1xuICAgICAgICAgICAgJGxpc3QuaHRtbCgnPGRpdiBjbGFzcz1cIm1oLWVtcHR5IG1oLWVtcHR5LWJveFwiIHJvbGU9XCJzdGF0dXNcIj4nXG4gICAgICAgICAgICAgICAgKyAnPGgzIGNsYXNzPVwidWkgaGVhZGVyIG1oLXBhZ2UtdGl0bGVcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVzRW1wdHlUaXRsZScpKSArICc8L2gzPidcbiAgICAgICAgICAgICAgICArICc8YnV0dG9uIGNsYXNzPVwidWkgcHJpbWFyeSBidXR0b25cIiB0eXBlPVwiYnV0dG9uXCIgZGF0YS1hY3Rpb249XCJhZGRcIj4nICsgSUNPTl9QTFVTXG4gICAgICAgICAgICAgICAgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZXNBZGQnKSkgKyAnPC9idXR0b24+PC9kaXY+Jyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgc2V0UnVsZUFkZFZpc2libGUodHJ1ZSk7XG4gICAgICAgIHZhciBncm91cHMgPSB7fTtcbiAgICAgICAgc3RhdGUucnVsZXMuZm9yRWFjaChmdW5jdGlvbiAocnVsZSkge1xuICAgICAgICAgICAgdmFyIGdyb3VwID0gcnVsZS5ncm91cCB8fCAncGJ4JztcbiAgICAgICAgICAgIGlmIChHUk9VUF9PUkRFUi5pbmRleE9mKGdyb3VwKSA8IDApIHsgZ3JvdXAgPSAncGJ4JzsgfVxuICAgICAgICAgICAgKGdyb3Vwc1tncm91cF0gPSBncm91cHNbZ3JvdXBdIHx8IFtdKS5wdXNoKHJ1bGUpO1xuICAgICAgICB9KTtcbiAgICAgICAgdmFyIG9yZGVyID0gR1JPVVBfT1JERVIuZmlsdGVyKGZ1bmN0aW9uIChncm91cCkgeyByZXR1cm4gQm9vbGVhbihncm91cHNbZ3JvdXBdKTsgfSk7XG4gICAgICAgIHZhciBodG1sID0gJyc7XG4gICAgICAgIGlmIChzdGF0ZS5ydWxlc0Vycm9yICE9PSBudWxsKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwidWkgbmVnYXRpdmUgbWVzc2FnZVwiIHJvbGU9XCJhbGVydFwiPicgKyBJQ09OX0VSUk9SXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLWdyb3dcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVzTG9hZEZhaWxlZCcpKSArICc8L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAnPGJ1dHRvbiBjbGFzcz1cInVpIGJhc2ljIGJ1dHRvbiBtaC1vbi1tZXNzYWdlXCIgdHlwZT1cImJ1dHRvblwiIGlkPVwibWgtcnVsZXMtcmV0cnktaW5saW5lXCI+J1xuICAgICAgICAgICAgICAgICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblJldHJ5JykpICsgJzwvYnV0dG9uPjwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHNob3dIZWFkaW5ncyA9IG9yZGVyLmxlbmd0aCA+IDE7XG4gICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJtaC1ub3RpZi1saXN0JyArIChzaG93SGVhZGluZ3MgPyAnJyA6ICcgaXMtZmxhdCcpICsgJ1wiIHJvbGU9XCJsaXN0XCI+JztcbiAgICAgICAgb3JkZXIuZm9yRWFjaChmdW5jdGlvbiAoZ3JvdXApIHtcbiAgICAgICAgICAgIGlmIChzaG93SGVhZGluZ3MpIHtcbiAgICAgICAgICAgICAgICBodG1sICs9ICc8aDMgY2xhc3M9XCJtaC1ncm91cC10aXRsZVwiPicgKyBlc2Moc291cmNlR3JvdXBOYW1lKGdyb3VwKSkgKyAnPC9oMz4nO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZ3JvdXBzW2dyb3VwXS5mb3JFYWNoKGZ1bmN0aW9uIChydWxlKSB7XG4gICAgICAgICAgICAgICAgaHRtbCArPSByZW5kZXJSdWxlUm93KHJ1bGUpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkbGlzdC5odG1sKGh0bWwgKyAnPC9kaXY+Jyk7XG4gICAgICAgICQoJyNtaC1ydWxlcy1yZXRyeS1pbmxpbmUnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IGxvYWRSdWxlcygpOyB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBydWxlQ2hhbm5lbChydWxlKSB7XG4gICAgICAgIHZhciBjaGF0cyA9IHJ1bGUuY2hhdHMgfHwgW107XG4gICAgICAgIGlmIChjaGF0cy5sZW5ndGggPiAwICYmIGNoYXRzWzBdLmNoYW5uZWwpIHtcbiAgICAgICAgICAgIHJldHVybiBjaGF0c1swXS5jaGFubmVsO1xuICAgICAgICB9XG4gICAgICAgIHZhciBib3QgPSBjaGF0cy5sZW5ndGggPiAwID8gYm90QnlJZChjaGF0c1swXS5ib3RfaWQpIDogKHN0YXRlLmJvdHNbMF0gfHwgbnVsbCk7XG4gICAgICAgIHJldHVybiBib3QgJiYgYm90LmNoYW5uZWwgPT09ICdtYXgnID8gJ21heCcgOiAndGVsZWdyYW0nO1xuICAgIH1cblxuICAgIC8vIENvbG91ciBvbmx5IGZvciBhIHByb2JsZW06IHVuYXZhaWxhYmxlIHNvdXJjZSwgcmVqZWN0ZWQgdG9rZW4sIGRlbGV0ZWQgYm90IG9yIGNoYXQuXG4gICAgZnVuY3Rpb24gcnVsZVByb2JsZW1MYWJlbChydWxlKSB7XG4gICAgICAgIHZhciBzb3VyY2UgPSBzb3VyY2VCeUlkKHJ1bGUuc291cmNlX2lkKTtcbiAgICAgICAgaWYgKHNvdXJjZSAmJiBzb3VyY2UuYXZhaWxhYmlsaXR5ICYmIHNvdXJjZS5hdmFpbGFiaWxpdHkgIT09ICdhdmFpbGFibGUnKSB7XG4gICAgICAgICAgICB2YXIgbGFiZWxzID0ge1xuICAgICAgICAgICAgICAgIG1vZHVsZV9kaXNhYmxlZDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU291cmNlU3RhdGVNb2RvZmYnKSxcbiAgICAgICAgICAgICAgICBtb2R1bGVfbWlzc2luZzogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfU291cmNlU3RhdGVOb2luc3QnKSxcbiAgICAgICAgICAgICAgICBhcGlfZm9yYmlkZGVuOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9Ob3RpZlNvdXJjZU5vQWNjZXNzJyksXG4gICAgICAgICAgICAgICAgZGlzYWJsZWQ6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NvdXJjZVN0YXRlT2ZmJyksXG4gICAgICAgICAgICAgICAgZXJyb3I6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1NvdXJjZVN0YXRlRXJyJylcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBpZiAobGFiZWxzW3NvdXJjZS5hdmFpbGFiaWxpdHldKSB7XG4gICAgICAgICAgICAgICAgdmFyIGNscyA9IChzb3VyY2UuYXZhaWxhYmlsaXR5ID09PSAnbW9kdWxlX2Rpc2FibGVkJyB8fCBzb3VyY2UuYXZhaWxhYmlsaXR5ID09PSAnZGlzYWJsZWQnKSA/ICd1aSB5ZWxsb3cgbGFiZWwnIDogJ3VpIHJlZCBsYWJlbCc7XG4gICAgICAgICAgICAgICAgcmV0dXJuICc8c3BhbiBjbGFzcz1cIicgKyBjbHMgKyAnXCI+JyArIGVzYyhsYWJlbHNbc291cmNlLmF2YWlsYWJpbGl0eV0pICsgJzwvc3Bhbj4nO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHZhciBjaGF0cyA9IHJ1bGUuY2hhdHMgfHwgW107XG4gICAgICAgIGlmICgocnVsZS5jaGF0X2lkcyB8fCBbXSkubGVuZ3RoID4gY2hhdHMubGVuZ3RoKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCI+JyArIElDT05fRVJST1IgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRGVsaXZlcnlCb3REZWxldGVkJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICB9XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2hhdHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBib3QgPSBib3RCeUlkKGNoYXRzW2ldLmJvdF9pZCk7XG4gICAgICAgICAgICBpZiAoYm90ICYmIGJvdC5lbmFibGVkICE9PSBmYWxzZSAmJiBib3Quc3RhdHVzID09PSAndG9rZW5faW52YWxpZCcpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCI+JyArIElDT05fRVJST1IgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQm90U3RhdHVzVG9rZW5JbnZhbGlkJykpICsgJzwvc3Bhbj4nO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChjaGF0cy5sZW5ndGggPiAwICYmIGNoYXRzLmV2ZXJ5KGZ1bmN0aW9uIChjaGF0KSB7IHJldHVybiBjaGF0LnN0YXRlID09PSAnZ29uZSc7IH0pKSB7XG4gICAgICAgICAgICByZXR1cm4gJzxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCI+JyArIElDT05fRVJST1IgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfQ2hhdFN0YXR1c0dvbmUnKSkgKyAnPC9zcGFuPic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyUnVsZVJvdyhydWxlKSB7XG4gICAgICAgIHZhciBwcm9ibGVtID0gcnVsZVByb2JsZW1MYWJlbChydWxlKTtcbiAgICAgICAgdmFyIHJ1bGVGaXJzdCA9IHN0YXRlLnJ1bGVzLmxlbmd0aCA+IDAgJiYgTnVtYmVyKHN0YXRlLnJ1bGVzWzBdLmlkKSA9PT0gTnVtYmVyKHJ1bGUuaWQpO1xuICAgICAgICB2YXIgcnVsZUxhc3QgPSBzdGF0ZS5ydWxlcy5sZW5ndGggPiAwXG4gICAgICAgICAgICAmJiBOdW1iZXIoc3RhdGUucnVsZXNbc3RhdGUucnVsZXMubGVuZ3RoIC0gMV0uaWQpID09PSBOdW1iZXIocnVsZS5pZCk7XG4gICAgICAgIHZhciByaWdodCA9ICcnO1xuICAgICAgICBpZiAocHJvYmxlbSAhPT0gbnVsbCkge1xuICAgICAgICAgICAgcmlnaHQgPSBwcm9ibGVtO1xuICAgICAgICB9IGVsc2UgaWYgKHJ1bGUuZW5hYmxlZCAmJiBydWxlLmxhc3RfZXZlbnRfYXQpIHtcbiAgICAgICAgICAgIHJpZ2h0ID0gJzxzcGFuIGNsYXNzPVwibWgtbXV0ZWRcIj4nICsgZm10Q2VsbFRpbWUocnVsZS5sYXN0X2V2ZW50X2F0KSArICc8L3NwYW4+JztcbiAgICAgICAgfVxuICAgICAgICB2YXIgY2hhbm5lbCA9IHJ1bGVDaGFubmVsKHJ1bGUpO1xuXG4gICAgICAgIHJldHVybiAnPGRpdiBjbGFzcz1cIm1oLW5vdGlmLXJvdycgKyAocnVsZS5lbmFibGVkID8gJycgOiAnIGlzLW9mZicpICsgJ1wiIHJvbGU9XCJsaXN0aXRlbVwiIGRhdGEtcnVsZS1pZD1cIicgKyBydWxlLmlkICsgJ1wiPidcbiAgICAgICAgICAgICsgJzxsYWJlbCBjbGFzcz1cInVpIHRvZ2dsZSBjaGVja2JveCcgKyAocnVsZS5lbmFibGVkID8gJyBjaGVja2VkJyA6ICcnKSArICdcIiBhcmlhLWxhYmVsPVwiJyArIGVzYyhydWxlLnRpdGxlKSArICdcIj4nXG4gICAgICAgICAgICArICc8aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgY2xhc3M9XCJoaWRkZW4gbWgtcnVsZS10b2dnbGVcIicgKyAocnVsZS5lbmFibGVkID8gJyBjaGVja2VkJyA6ICcnKSArICc+J1xuICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC10cmFja1wiPjwvc3Bhbj48L2xhYmVsPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbm90aWYtbWFpblwiPidcbiAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbWVzc2VuZ2VyIHMgJyArIChjaGFubmVsID09PSAnbWF4JyA/ICdtYXgnIDogJ3RnJykgKyAnXCIgcm9sZT1cImltZ1wiIGFyaWEtbGFiZWw9XCInICsgKGNoYW5uZWwgPT09ICdtYXgnID8gJ01BWCcgOiAnVGVsZWdyYW0nKSArICdcIj4nXG4gICAgICAgICAgICArIChjaGFubmVsID09PSAnbWF4JyA/ICdNQVgnIDogJ1RHJykgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICsgJzxhIGhyZWY9XCIjXCIgY2xhc3M9XCJtaC1ub3RpZi10aXRsZSBtaC10cnVuY2F0ZVwiIGRhdGEtYWN0aW9uPVwiZWRpdFwiPicgKyBlc2MocnVsZS50aXRsZSkgKyAnPC9hPjwvc3Bhbj4nXG4gICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW5vdGlmLXN0YXR1c1wiPicgKyByaWdodCArICc8L3NwYW4+J1xuICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLXJ1bGUtbWVudS13cmFwXCI+J1xuICAgICAgICAgICAgKyAnPGJ1dHRvbiBjbGFzcz1cInVpIHRleHQgYnV0dG9uIG1oLXJ1bGUtbWVudS1idG5cIiB0eXBlPVwiYnV0dG9uXCIgZGF0YS1hY3Rpb249XCJtZW51XCIgYXJpYS1sYWJlbD1cIicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZU1lbnVNb3JlJykpICsgJ1wiIGFyaWEtZXhwYW5kZWQ9XCJmYWxzZVwiPidcbiAgICAgICAgICAgICsgJzxzdmcgY2xhc3M9XCJtaC1pXCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjxwYXRoIGQ9XCJNMy41IDhoLjAxTTggOGguMDFNMTIuNSA4aC4wMVwiIHN0cm9rZS13aWR0aD1cIjIuNFwiLz48L3N2Zz48L2J1dHRvbj4nXG4gICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtcnVsZS1tZW51XCIgaGlkZGVuPidcbiAgICAgICAgICAgICsgJzxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJlZGl0XCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlTWVudUVkaXQnKSkgKyAnPC9hPidcbiAgICAgICAgICAgICsgKHJ1bGVGaXJzdCA/ICcnIDogJzxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJ1cFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZU1lbnVVcCcpKSArICc8L2E+JylcbiAgICAgICAgICAgICsgKHJ1bGVMYXN0ID8gJycgOiAnPGEgaHJlZj1cIiNcIiBkYXRhLWFjdGlvbj1cImRvd25cIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVNZW51RG93bicpKSArICc8L2E+JylcbiAgICAgICAgICAgICsgJzxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJkZWxldGVcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1J1bGVNZW51RGVsZXRlJykpICsgJzwvYT4nXG4gICAgICAgICAgICArICc8L2Rpdj48L2Rpdj48L2Rpdj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJpbmRSdWxlc0NvbnRhaW5lcigpIHtcbiAgICAgICAgdmFyICR3cmFwID0gJCgnI21oLXJ1bGVzLWxpc3QnKTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImFkZFwiXScsIGZ1bmN0aW9uICgpIHsgb3BlblJ1bGVXaXphcmQobnVsbCk7IH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiYWRkLWJvdFwiXScsIGZ1bmN0aW9uICgpIHsgb3BlbkJvdE1vZGFsKCdhZGQnLCBudWxsLCAkKHRoaXMpLmRhdGEoJ2NoYW5uZWwnKSk7IH0pO1xuICAgICAgICAkd3JhcC5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiZWRpdFwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIG9wZW5SdWxlV2l6YXJkKHJ1bGVCeUlkKCQodGhpcykuY2xvc2VzdCgnLm1oLW5vdGlmLXJvdycpLmRhdGEoJ3J1bGUtaWQnKSkpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cIm1lbnVcIl0nLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgdmFyICRtZW51ID0gJCh0aGlzKS5zaWJsaW5ncygnLm1oLXJ1bGUtbWVudScpO1xuICAgICAgICAgICAgJCgnLm1oLXJ1bGUtbWVudScpLm5vdCgkbWVudSkucHJvcCgnaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICAgICAkbWVudS5wcm9wKCdoaWRkZW4nLCAhJG1lbnUucHJvcCgnaGlkZGVuJykpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cImRlbGV0ZVwiXScsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIGNvbmZpcm1EZWxldGVSdWxlKHJ1bGVCeUlkKCQodGhpcykuY2xvc2VzdCgnLm1oLW5vdGlmLXJvdycpLmRhdGEoJ3J1bGUtaWQnKSkpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHdyYXAub24oJ2NsaWNrJywgJ1tkYXRhLWFjdGlvbj1cInVwXCJdLCBbZGF0YS1hY3Rpb249XCJkb3duXCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgbW92ZVJ1bGUoXG4gICAgICAgICAgICAgICAgJCh0aGlzKS5jbG9zZXN0KCcubWgtbm90aWYtcm93JykuZGF0YSgncnVsZS1pZCcpLFxuICAgICAgICAgICAgICAgICQodGhpcykuZGF0YSgnYWN0aW9uJykgPT09ICd1cCcgPyAtMSA6IDFcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0pO1xuICAgICAgICAkd3JhcC5vbignY2hhbmdlJywgJy5taC1ydWxlLXRvZ2dsZScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBpZCA9ICQodGhpcykuY2xvc2VzdCgnLm1oLW5vdGlmLXJvdycpLmRhdGEoJ3J1bGUtaWQnKTtcbiAgICAgICAgICAgIHZhciBlbmFibGVkID0gJCh0aGlzKS5wcm9wKCdjaGVja2VkJyk7XG4gICAgICAgICAgICBhcGlQYXRjaCgnL3J1bGVzLycgKyBpZCwgeyBlbmFibGVkOiBlbmFibGVkIH0sIGZ1bmN0aW9uIChydWxlKSB7XG4gICAgICAgICAgICAgICAgcmVwbGFjZVJ1bGUocnVsZSk7XG4gICAgICAgICAgICAgICAgcmVuZGVyUnVsZXMoKTtcbiAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICAgICAgbG9hZFJ1bGVzKHRydWUpO1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdChmYWlsdXJlVGV4dChmYWlsdXJlKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoZG9jdW1lbnQpLm9uKCdjbGljaycsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgaWYgKCQoZXZlbnQudGFyZ2V0KS5jbG9zZXN0KCcubWgtcnVsZS1tZW51LXdyYXAnKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICAkKCcubWgtcnVsZS1tZW51JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGxvYWRQcm92aWRlcnMoZG9uZSkge1xuICAgICAgICBpZiAoc3RhdGUucHJvdmlkZXJzTG9hZGVkKSB7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29yZUdldCgnL3Byb3ZpZGVycycsIHsgbGltaXQ6IDIwMCB9LCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgICAgICAgdmFyIGl0ZW1zID0gZGF0YS5pdGVtcyB8fCBbXTtcbiAgICAgICAgICAgIHZhciBsaXN0ID0gW107XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGl0ZW1zLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgdmFyIHByb3ZpZGVyID0gaXRlbXNbaV07XG4gICAgICAgICAgICAgICAgdmFyIGlkID0gU3RyaW5nKHByb3ZpZGVyLmlkICE9PSB1bmRlZmluZWQgPyBwcm92aWRlci5pZCA6IChwcm92aWRlci5wcm92aWRlcl9pZCB8fCAnJykpO1xuICAgICAgICAgICAgICAgIGlmIChpZCA9PT0gJycpIHsgY29udGludWU7IH1cbiAgICAgICAgICAgICAgICB2YXIgbGFiZWwgPSBwcm92aWRlci5kZXNjcmlwdGlvbiB8fCBwcm92aWRlci51c2VybmFtZSB8fCAoJyMnICsgaWQpO1xuICAgICAgICAgICAgICAgIGxpc3QucHVzaCh7IGlkOiBpZCwgbGFiZWw6IGxhYmVsIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc3RhdGUucHJvdmlkZXJzID0gbGlzdDtcbiAgICAgICAgICAgIHN0YXRlLnByb3ZpZGVyc0xvYWRlZCA9IHRydWU7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLnByb3ZpZGVyc0xvYWRlZCA9IGZhbHNlO1xuICAgICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBtb3ZlUnVsZShpZCwgZGVsdGEpIHtcbiAgICAgICAgdmFyIGlkcyA9IFtdO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLnJ1bGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZHMucHVzaChOdW1iZXIoc3RhdGUucnVsZXNbaV0uaWQpKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgaW5kZXggPSBpZHMuaW5kZXhPZihOdW1iZXIoaWQpKTtcbiAgICAgICAgdmFyIHRhcmdldCA9IGluZGV4ICsgZGVsdGE7XG4gICAgICAgIGlmIChpbmRleCA8IDAgfHwgdGFyZ2V0IDwgMCB8fCB0YXJnZXQgPj0gaWRzLmxlbmd0aCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBzd2FwID0gaWRzW2luZGV4XTtcbiAgICAgICAgaWRzW2luZGV4XSA9IGlkc1t0YXJnZXRdO1xuICAgICAgICBpZHNbdGFyZ2V0XSA9IHN3YXA7XG4gICAgICAgIGFwaVBvc3QoJy9ydWxlczpjaGFuZ2VQcmlvcml0eScsIHsgb3JkZXI6IGlkcyB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBsb2FkUnVsZXModHJ1ZSk7XG4gICAgICAgICAgICBzaG93VG9hc3QodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUnVsZU9yZGVyU2F2ZWQnKSk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChmYWlsdXJlKSB7XG4gICAgICAgICAgICBzaG93VG9hc3QoZmFpbHVyZVRleHQoZmFpbHVyZSkpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBydWxlQnlJZChpZCkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHN0YXRlLnJ1bGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAoTnVtYmVyKHN0YXRlLnJ1bGVzW2ldLmlkKSA9PT0gTnVtYmVyKGlkKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBzdGF0ZS5ydWxlc1tpXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZXBsYWNlUnVsZShydWxlKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RhdGUucnVsZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChOdW1iZXIoc3RhdGUucnVsZXNbaV0uaWQpID09PSBOdW1iZXIocnVsZS5pZCkpIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5ydWxlc1tpXSA9IHJ1bGU7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHN0YXRlLnJ1bGVzLnB1c2gocnVsZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gY29uZmlybURlbGV0ZVJ1bGUocnVsZSkge1xuICAgICAgICBpZiAoIXJ1bGUpIHsgcmV0dXJuOyB9XG4gICAgICAgICQoJyNtaC1jb25maXJtLXRleHQnKS50ZXh0KHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SdWxlRGVsZXRlQ29uZmlybScsIHsgdGl0bGU6IHJ1bGUudGl0bGUgfSkpO1xuICAgICAgICAkKCcjbWgtY29uZmlybS1tb2RhbCcpLm1vZGFsKHsgY2xvc2FibGU6IHRydWUgfSkubW9kYWwoJ3Nob3cnKTtcbiAgICAgICAgJCgnI21oLWNvbmZpcm0tb2snKS5vZmYoJ2NsaWNrJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLWNvbmZpcm0tbW9kYWwnKS5tb2RhbCgnaGlkZScpO1xuICAgICAgICAgICAgYXBpRGVsZXRlKCcvcnVsZXMvJyArIHJ1bGUuaWQsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBsb2FkUnVsZXModHJ1ZSk7XG4gICAgICAgICAgICAgICAgc2hvd1RvYXN0KHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vbkRlbGV0ZWQnKSk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoZmFpbHVyZSkge1xuICAgICAgICAgICAgICAgIHNob3dUb2FzdChmYWlsdXJlVGV4dChmYWlsdXJlKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLSBub3RpZmljYXRpb25zOiB3aXphcmQgLS0tLS0tLS0tLVxuXG4gICAgZnVuY3Rpb24gZW1wdHlGaWx0ZXJzKCkge1xuICAgICAgICByZXR1cm4geyB1c2VyX2lkczogW10sIGRpcmVjdGlvbnM6IFtdLCBwcm92aWRlcnM6IFtdLCBxdWFsaXR5X3Njb3JlOiBudWxsIH07XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbm9ybWFsaXplUmV0cmFjdChvcHRpb25zKSB7XG4gICAgICAgIHZhciBjb25maWcgPSBvcHRpb25zICYmIG9wdGlvbnMucmV0cmFjdF9vbl9jYWxsYmFjayAmJiB0eXBlb2Ygb3B0aW9ucy5yZXRyYWN0X29uX2NhbGxiYWNrID09PSAnb2JqZWN0J1xuICAgICAgICAgICAgPyBvcHRpb25zLnJldHJhY3Rfb25fY2FsbGJhY2tcbiAgICAgICAgICAgIDoge307XG4gICAgICAgIHZhciB3aW5kb3cgPSBOdW1iZXIoY29uZmlnLndpbmRvd19taW4pO1xuICAgICAgICBpZiAoIXdpbmRvdyB8fCB3aW5kb3cgPCA1IHx8IHdpbmRvdyA+IDEyMCkge1xuICAgICAgICAgICAgd2luZG93ID0gMjA7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IGNvbmZpZy5lbmFibGVkID09PSB0cnVlLFxuICAgICAgICAgICAgd2luZG93X21pbjogd2luZG93LFxuICAgICAgICAgICAgY291bnRfaW5jb21pbmdfYW5zd2VyZWQ6IGNvbmZpZy5jb3VudF9pbmNvbWluZ19hbnN3ZXJlZCAhPT0gZmFsc2VcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBub3JtYWxpemVGaWx0ZXJzKGZpbHRlcnMpIHtcbiAgICAgICAgdmFyIHJlc3VsdCA9IGVtcHR5RmlsdGVycygpO1xuICAgICAgICBpZiAoIWZpbHRlcnMgfHwgdHlwZW9mIGZpbHRlcnMgIT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZpbHRlcnMudXNlcl9pZHMpKSB7XG4gICAgICAgICAgICByZXN1bHQudXNlcl9pZHMgPSBmaWx0ZXJzLnVzZXJfaWRzLm1hcChOdW1iZXIpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZpbHRlcnMuZGlyZWN0aW9ucykpIHtcbiAgICAgICAgICAgIHJlc3VsdC5kaXJlY3Rpb25zID0gZmlsdGVycy5kaXJlY3Rpb25zLnNsaWNlKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZmlsdGVycy5wcm92aWRlcnMpKSB7XG4gICAgICAgICAgICByZXN1bHQucHJvdmlkZXJzID0gZmlsdGVycy5wcm92aWRlcnMubWFwKFN0cmluZyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGZpbHRlcnMucXVhbGl0eV9zY29yZSAmJiB0eXBlb2YgZmlsdGVycy5xdWFsaXR5X3Njb3JlID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgcmVzdWx0LnF1YWxpdHlfc2NvcmUgPSB7fTtcbiAgICAgICAgICAgIGlmIChmaWx0ZXJzLnF1YWxpdHlfc2NvcmUubWluICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQucXVhbGl0eV9zY29yZS5taW4gPSBOdW1iZXIoZmlsdGVycy5xdWFsaXR5X3Njb3JlLm1pbik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoZmlsdGVycy5xdWFsaXR5X3Njb3JlLm1heCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0LnF1YWxpdHlfc2NvcmUubWF4ID0gTnVtYmVyKGZpbHRlcnMucXVhbGl0eV9zY29yZS5tYXgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgLy8gQXVkaW8gYXR0YWNobWVudCBtb2RlIG9mIGEgcnVsZSAoUGxhbi8wNSkuIFRoZSBzdGFnZS0yIGJvb2xlYW4gaXMgbm90IGEgbW9kZSBhbmQgcmVhZHMgYXMgXCJub25lXCIuXG4gICAgZnVuY3Rpb24gbm9ybWFsaXplQXR0YWNobWVudHMob3B0aW9ucykge1xuICAgICAgICB2YXIgdmFsdWUgPSBvcHRpb25zID8gb3B0aW9ucy5hdHRhY2htZW50cyA6IG51bGw7XG4gICAgICAgIHJldHVybiB2YWx1ZSA9PT0gJ2ZyYWdtZW50cycgfHwgdmFsdWUgPT09ICdyZWNvcmRpbmcnID8gdmFsdWUgOiAnbm9uZSc7XG4gICAgfVxuXG4gICAgLy8gTW9kZXMgb2ZmZXJlZCBmb3IgdGhlIHNlbGVjdGVkIGV2ZW50IHR5cGVzOiBvbmx5IGV2ZW50cyB0aGF0IGNhbiBjYXJyeSBhdWRpby5cbiAgICBmdW5jdGlvbiB3aXphcmRBdHRhY2htZW50TW9kZXModHlwZXMpIHtcbiAgICAgICAgaWYgKHR5cGVzLmluZGV4T2YoJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnKSA+PSAwKSB7IHJldHVybiBbJ25vbmUnLCAnZnJhZ21lbnRzJywgJ3JlY29yZGluZyddOyB9XG4gICAgICAgIGlmICh0eXBlcy5pbmRleE9mKCdjb3JlLnZvaWNlbWFpbCcpID49IDApIHsgcmV0dXJuIFsnbm9uZScsICdyZWNvcmRpbmcnXTsgfVxuICAgICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZW5zdXJlV2l6YXJkRGF0YSgpIHtcbiAgICAgICAgbG9hZEVtcGxveWVlcyhmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoc3RhdGUucnVsZVdpemFyZCAmJiBzdGF0ZS5ydWxlV2l6YXJkLnN0ZXAgPT09IDIpIHsgcmVuZGVyV2l6YXJkQ29uZGl0aW9ucygpOyB9XG4gICAgICAgIH0pO1xuICAgICAgICBsb2FkUHJvdmlkZXJzKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5ydWxlV2l6YXJkICYmIHN0YXRlLnJ1bGVXaXphcmQuc3RlcCA9PT0gMikgeyByZW5kZXJXaXphcmRDb25kaXRpb25zKCk7IH1cbiAgICAgICAgfSk7XG4gICAgICAgIGlmICghc3RhdGUuYm90c0xvYWRlZCkge1xuICAgICAgICAgICAgbG9hZEJvdHModHJ1ZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBvcGVuUnVsZVdpemFyZChydWxlKSB7XG4gICAgICAgIGVuc3VyZVdpemFyZERhdGEoKTtcbiAgICAgICAgdmFyIHNvdXJjZSA9IHJ1bGUgPyBzb3VyY2VGb3JSdWxlKHJ1bGUpIDogbnVsbDtcbiAgICAgICAgc3RhdGUucnVsZVdpemFyZCA9IHtcbiAgICAgICAgICAgIHN0ZXA6IHJ1bGUgPyBmaXJzdFN0ZXBBZnRlclNjZW5hcmlvKChydWxlLmV2ZW50X3R5cGVzIHx8IFtdKS5zbGljZSgpKSA6IDEsXG4gICAgICAgICAgICBlZGl0SWQ6IHJ1bGUgPyBOdW1iZXIocnVsZS5pZCkgOiAwLFxuICAgICAgICAgICAgc291cmNlSWQ6IHNvdXJjZSA/IHNvdXJjZS5pZCA6ICcnLFxuICAgICAgICAgICAgZXZlbnRUeXBlczogcnVsZSA/IChydWxlLmV2ZW50X3R5cGVzIHx8IFtdKS5zbGljZSgpIDogW10sXG4gICAgICAgICAgICB0aXRsZTogcnVsZSA/IHJ1bGUudGl0bGUgOiAnJyxcbiAgICAgICAgICAgIGZpbHRlcnM6IG5vcm1hbGl6ZUZpbHRlcnMocnVsZSA/IHJ1bGUuZmlsdGVycyA6IG51bGwpLFxuICAgICAgICAgICAgdGFyZ2V0TW9kZTogcnVsZSA/IHJ1bGUudGFyZ2V0X21vZGUgOiAnZW1wbG95ZWVfb3JfcmVjaXBpZW50cycsXG4gICAgICAgICAgICBjaGF0SWRzOiBydWxlXG4gICAgICAgICAgICAgICAgPyAocnVsZS5jaGF0X2lkcyB8fCBbXSkubWFwKE51bWJlcikuZmlsdGVyKGZ1bmN0aW9uIChpZCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gKHJ1bGUuY2hhdHMgfHwgW10pLnNvbWUoZnVuY3Rpb24gKGNoYXQpIHsgcmV0dXJuIE51bWJlcihjaGF0LmlkKSA9PT0gaWQ7IH0pO1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgOiBbXSxcbiAgICAgICAgICAgIG1hc2s6IHJ1bGUgPyAhIShydWxlLm9wdGlvbnMgJiYgcnVsZS5vcHRpb25zLm1hc2tfcGhvbmUgPT09IHRydWUpXG4gICAgICAgICAgICAgICAgOiAhIShzdGF0ZS5zZXR0aW5ncyAmJiBzdGF0ZS5zZXR0aW5ncy5tYXNrX3Bob25lX2RlZmF1bHQgPT09IHRydWUpLFxuICAgICAgICAgICAgcmV0cmFjdDogbm9ybWFsaXplUmV0cmFjdChydWxlID8gcnVsZS5vcHRpb25zIDogbnVsbCksXG4gICAgICAgICAgICBhdHRhY2htZW50czogbm9ybWFsaXplQXR0YWNobWVudHMocnVsZSA/IHJ1bGUub3B0aW9ucyA6IG51bGwpLFxuICAgICAgICAgICAgYm90SWQ6IHJ1bGUgJiYgcnVsZS5jaGF0cyAmJiBydWxlLmNoYXRzLmxlbmd0aCA+IDAgPyBOdW1iZXIocnVsZS5jaGF0c1swXS5ib3RfaWQpIDogMCxcbiAgICAgICAgICAgIGVycm9yOiAnJ1xuICAgICAgICB9O1xuICAgICAgICAkKCcjbWgtcnVsZXMtdmlldycpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkJykucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgICQoJyNtZXNzZW5nZXItaHViLXJvb3QnKS5hZGRDbGFzcygnbWgtd2l6YXJkLW9wZW4nKTtcbiAgICAgICAgY2xlYXJXaXphcmRFcnJvcigpO1xuICAgICAgICByZW5kZXJXaXphcmQoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjbG9zZVJ1bGVXaXphcmQoKSB7XG4gICAgICAgICQoJyNtaC13aXphcmQtcHJldmlldywgI21oLXdpemFyZC1wcmV2aWV3LXRhcmdldCcpLmVtcHR5KCk7XG4gICAgICAgIHN0YXRlLnJ1bGVXaXphcmQgPSBudWxsO1xuICAgICAgICAkKCcjbWgtd2l6YXJkJykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgICQoJyNtaC1ydWxlcy12aWV3JykucmVtb3ZlQXR0cignaGlkZGVuJyk7XG4gICAgICAgICQoJyNtZXNzZW5nZXItaHViLXJvb3QnKS5yZW1vdmVDbGFzcygnbWgtd2l6YXJkLW9wZW4nKTtcbiAgICAgICAgcmVuZGVyUnVsZXMoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRTY2VuYXJpbygpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICByZXR1cm4gdyAmJiB3LnNvdXJjZUlkID8gc291cmNlQnlJZCh3LnNvdXJjZUlkKSA6IG51bGw7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2l6YXJkU3VwcG9ydHNFbXBsb3llZXModHlwZXMpIHtcbiAgICAgICAgdmFyIGNhbGxUeXBlcyA9IFsnY29yZS5taXNzZWRfY2FsbCcsICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJ107XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdHlwZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChjYWxsVHlwZXMuaW5kZXhPZih0eXBlc1tpXSkgPj0gMCkgeyByZXR1cm4gdHJ1ZTsgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRTdXBwb3J0c0RpcmVjdGlvbnModHlwZXMpIHtcbiAgICAgICAgcmV0dXJuIHR5cGVzLmluZGV4T2YoJ2NvcmUubWlzc2VkX2NhbGwnKSA+PSAwIHx8IHR5cGVzLmluZGV4T2YoJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnKSA+PSAwO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHdpemFyZFN1cHBvcnRzUHJvdmlkZXJzKHR5cGVzKSB7XG4gICAgICAgIHJldHVybiB0eXBlcy5pbmRleE9mKCdjb3JlLnByb3ZpZGVyX2Rvd24nKSA+PSAwIHx8IHR5cGVzLmluZGV4T2YoJ2NvcmUucHJvdmlkZXJfdXAnKSA+PSAwO1xuICAgIH1cblxuICAgIC8vIFN0ZXAgMiBleGlzdHMgb25seSBmb3Igc2NlbmFyaW9zIHdpdGggY29uZGl0aW9uczsgdGhlIG90aGVycyBnbyBzdHJhaWdodCB0byDCq9Ca0YPQtNCwINC+0YLQv9GA0LDQstC40YLRjMK7LlxuICAgIGZ1bmN0aW9uIHdpemFyZEhhc0NvbmRpdGlvbnModHlwZXMpIHtcbiAgICAgICAgcmV0dXJuIHdpemFyZFN1cHBvcnRzRW1wbG95ZWVzKHR5cGVzKSB8fCB3aXphcmRTdXBwb3J0c0RpcmVjdGlvbnModHlwZXMpIHx8IHdpemFyZFN1cHBvcnRzUHJvdmlkZXJzKHR5cGVzKVxuICAgICAgICAgICAgfHwgdHlwZXMuaW5kZXhPZignY29yZS5taXNzZWRfY2FsbCcpID49IDAgfHwgdHlwZXMuaW5kZXhPZignYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCcpID49IDA7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZmlyc3RTdGVwQWZ0ZXJTY2VuYXJpbyh0eXBlcykge1xuICAgICAgICByZXR1cm4gd2l6YXJkSGFzQ29uZGl0aW9ucyh0eXBlcykgPyAyIDogMztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJXaXphcmQoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICAkKCcjbWgtd2l6YXJkLXN0ZXAtMScpLmF0dHIoJ2hpZGRlbicsIHcuc3RlcCAhPT0gMSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtc3RlcC0yJykuYXR0cignaGlkZGVuJywgdy5zdGVwICE9PSAyKTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1zdGVwLTMnKS5hdHRyKCdoaWRkZW4nLCB3LnN0ZXAgIT09IDMpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkJykuYXR0cignZGF0YS1zdGVwJywgU3RyaW5nKHcuc3RlcCkpO1xuICAgICAgICB2YXIgc2NlbmFyaW8gPSB3aXphcmRTY2VuYXJpbygpO1xuICAgICAgICB2YXIgdGl0bGU7XG4gICAgICAgIGlmICh3LnN0ZXAgPT09IDEpIHtcbiAgICAgICAgICAgIHRpdGxlID0gdy5lZGl0SWQgPiAwID8gdy50aXRsZSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFRpdGxlJyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aXRsZSA9IHcuZWRpdElkID4gMCA/IHcudGl0bGUgOiAoc2NlbmFyaW8gPyBzY2VuYXJpby5uYW1lIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkVGl0bGUnKSk7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLXdpemFyZC10aXRsZScpLnRleHQodGl0bGUpO1xuICAgICAgICAvLyBvbmUgYmFzaWMgYnV0dG9uIG9uIHRoZSBsZWZ0OiDCq9Ce0YLQvNC10L3QsMK7IG9uIHRoZSBmaXJzdCBzdGVwLCDCq9Cd0LDQt9Cw0LTCuyBhZnRlciBpdFxuICAgICAgICB2YXIgY2FuR29CYWNrID0gdy5zdGVwID4gMSAmJiAhKHcuZWRpdElkID4gMCAmJiB3LnN0ZXAgPT09IGZpcnN0U3RlcEFmdGVyU2NlbmFyaW8ody5ldmVudFR5cGVzKSAmJiB3LnNvdXJjZUlkID09PSAnJyk7XG4gICAgICAgICQoJyNtaC13aXphcmQtcHJldicpLnRleHQody5zdGVwID09PSAxID8gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkQ2FuY2VsJykgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRCYWNrQnV0dG9uJykpXG4gICAgICAgICAgICAuZGF0YSgnbW9kZScsIGNhbkdvQmFjayA/ICdiYWNrJyA6ICdjYW5jZWwnKTtcbiAgICAgICAgdmFyIGlzTGFzdCA9IHcuc3RlcCA9PT0gMztcbiAgICAgICAgJCgnI21oLXdpemFyZC1uZXh0JykudGV4dChpc0xhc3RcbiAgICAgICAgICAgID8gKHcuZWRpdElkID4gMCA/IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFNhdmUnKSA6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZENyZWF0ZScpKVxuICAgICAgICAgICAgOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmROZXh0JykpO1xuICAgICAgICBpZiAody5zdGVwID09PSAxKSB7IHJlbmRlcldpemFyZFNjZW5hcmlvcygpOyB9XG4gICAgICAgIGlmICh3LnN0ZXAgPT09IDIpIHsgcmVuZGVyV2l6YXJkQ29uZGl0aW9ucygpOyB9XG4gICAgICAgIGlmICh3LnN0ZXAgPT09IDMpIHsgcmVuZGVyV2l6YXJkUmVjaXBpZW50cygpOyB9XG4gICAgICAgIHVwZGF0ZVdpemFyZE5leHQoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB1cGRhdGVXaXphcmROZXh0KCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgdmFyIGRpc2FibGVkID0gdy5zdGVwID09PSAxICYmIHcuc291cmNlSWQgPT09ICcnO1xuICAgICAgICBpZiAody5zdGVwID09PSAzKSB7XG4gICAgICAgICAgICBkaXNhYmxlZCA9IGFjdGl2ZVdpemFyZEJvdCgpID09PSBudWxsO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC13aXphcmQtbmV4dCcpLnByb3AoJ2Rpc2FibGVkJywgZGlzYWJsZWQpLnRvZ2dsZUNsYXNzKCdkaXNhYmxlZCcsIGRpc2FibGVkKTtcbiAgICB9XG5cbiAgICAvLyBPbmUgaWNvbiBwZXIgc2NlbmFyaW8gKGRlc2lnbiB2Mywgc3RlcCAxKS5cbiAgICB2YXIgU0NFTkFSSU9fSUNPTlMgPSB7XG4gICAgICAgIHBob25lOiAnPHBhdGggZD1cIk00LjUgMi41aDJsMSAzLTEuNSAxYTggOCAwIDAgMCAzLjUgMy41bDEtMS41IDMgMXYyYTEuNSAxLjUgMCAwIDEtMS41IDEuNUExMC41IDEwLjUgMCAwIDEgMyA0YTEuNSAxLjUgMCAwIDEgMS41LTEuNXpcIi8+JyxcbiAgICAgICAgbWljOiAnPHJlY3QgeD1cIjZcIiB5PVwiMlwiIHdpZHRoPVwiNFwiIGhlaWdodD1cIjcuNVwiIHJ4PVwiMlwiLz48cGF0aCBkPVwiTTMuNSA4YTQuNSA0LjUgMCAwIDAgOSAwTTggMTIuNVYxNFwiLz4nLFxuICAgICAgICBzcGFya2xlOiAnPHBhdGggZD1cIk04IDJ2M004IDExdjNNMiA4aDNNMTEgOGgzTTMuOCAzLjhsMiAyTTEwLjIgMTAuMmwyIDJNMy44IDEyLjJsMi0yTTEwLjIgNS44bDItMlwiLz4nLFxuICAgICAgICByb2JvdDogJzxyZWN0IHg9XCIzXCIgeT1cIjVcIiB3aWR0aD1cIjEwXCIgaGVpZ2h0PVwiOFwiIHJ4PVwiMlwiLz48cGF0aCBkPVwiTTggMi41VjVNNiA5aC4wMU0xMCA5aC4wMVwiLz4nLFxuICAgICAgICBzZXJ2ZXI6ICc8cmVjdCB4PVwiMi41XCIgeT1cIjNcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiNFwiIHJ4PVwiMVwiLz48cmVjdCB4PVwiMi41XCIgeT1cIjlcIiB3aWR0aD1cIjExXCIgaGVpZ2h0PVwiNFwiIHJ4PVwiMVwiLz48cGF0aCBkPVwiTTUgNWguMDFNNSAxMWguMDFcIi8+JyxcbiAgICAgICAgd2FybmluZzogJzxwYXRoIGQ9XCJNOCAyLjVsNiAxMC41SDJ6XCIvPjxwYXRoIGQ9XCJNOCA2LjV2M004IDExLjJ2LjFcIi8+JyxcbiAgICAgICAgYm9sdDogJzxwYXRoIGQ9XCJNOSAxLjVMMy41IDlIOGwtMSA1LjVMMTIuNSA3SDh6XCIvPidcbiAgICB9O1xuICAgIHZhciBTQ0VOQVJJT19JQ09OX0JZX1NPVVJDRSA9IHtcbiAgICAgICAgJ2NvcmUubWlzc2VkX2NhbGwnOiAncGhvbmUnLFxuICAgICAgICAnY29yZS52b2ljZW1haWwnOiAnbWljJyxcbiAgICAgICAgJ2FpX3N1cGVydmlzb3IuYXR0ZW50aW9uX2NhbGwnOiAnc3BhcmtsZScsXG4gICAgICAgICdhaV9zdXBlcnZpc29yLndvcmtlcnMnOiAncm9ib3QnLFxuICAgICAgICAndm9pY2VfYWdlbnQuY2FsbGJhY2tzJzogJ3Bob25lJyxcbiAgICAgICAgJ3ZvaWNlX2FnZW50LnJ1bnRpbWUnOiAncm9ib3QnLFxuICAgICAgICAnY29yZS5wcm92aWRlcl9zdGF0dXMnOiAnc2VydmVyJyxcbiAgICAgICAgJ2NvcmUuYWR2aWNlJzogJ3dhcm5pbmcnLFxuICAgICAgICAnY29yZS5wYnhfc3RhcnRlZCc6ICdib2x0J1xuICAgIH07XG5cbiAgICBmdW5jdGlvbiBzY2VuYXJpb0ljb24oc291cmNlSWQpIHtcbiAgICAgICAgdmFyIHBhdGhzID0gU0NFTkFSSU9fSUNPTlNbU0NFTkFSSU9fSUNPTl9CWV9TT1VSQ0Vbc291cmNlSWRdIHx8ICd3YXJuaW5nJ107XG4gICAgICAgIHJldHVybiAnPHNwYW4gY2xhc3M9XCJtaC1zY2VuYXJpby1pY29uXCI+PHN2ZyBjbGFzcz1cIm1oLWlcIiB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+JyArIHBhdGhzICsgJzwvc3ZnPjwvc3Bhbj4nO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlcldpemFyZFNjZW5hcmlvcygpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICB2YXIgZ3JvdXBzID0gR1JPVVBfT1JERVIuZmlsdGVyKGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgcmV0dXJuIHN0YXRlLnNvdXJjZXMuc29tZShmdW5jdGlvbiAoc291cmNlKSB7IHJldHVybiBzb3VyY2UuZ3JvdXAgPT09IGdyb3VwOyB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIHZhciBodG1sID0gJyc7XG4gICAgICAgIGdyb3Vwcy5mb3JFYWNoKGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgdmFyIHNvdXJjZXMgPSBzdGF0ZS5zb3VyY2VzLmZpbHRlcihmdW5jdGlvbiAoc291cmNlKSB7IHJldHVybiBzb3VyY2UuZ3JvdXAgPT09IGdyb3VwOyB9KTtcbiAgICAgICAgICAgIGlmIChncm91cHMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgICAgIGh0bWwgKz0gJzxoMyBjbGFzcz1cIm1oLWdyb3VwLXRpdGxlXCI+JyArIGVzYyhzb3VyY2VHcm91cE5hbWUoZ3JvdXApKSArICc8L2gzPic7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwibWgtc2NlbmFyaW8tZ3JpZFwiPic7XG4gICAgICAgICAgICBzb3VyY2VzLmZvckVhY2goZnVuY3Rpb24gKHNvdXJjZSkge1xuICAgICAgICAgICAgICAgIHZhciBkaXNhYmxlZCA9IFsnbW9kdWxlX21pc3NpbmcnLCAnbW9kdWxlX2Rpc2FibGVkJywgJ2FwaV9mb3JiaWRkZW4nLCAnZXJyb3InLCAnZGlzYWJsZWQnXVxuICAgICAgICAgICAgICAgICAgICAuaW5kZXhPZihzb3VyY2UuYXZhaWxhYmlsaXR5KSA+PSAwO1xuICAgICAgICAgICAgICAgIHZhciBzZWxlY3RlZCA9IHcuc291cmNlSWQgPT09IHNvdXJjZS5pZDtcbiAgICAgICAgICAgICAgICAvLyBVbmF2YWlsYWJsZSBzY2VuYXJpbzogb25seSB0aGUgcmVhc29uLCBubyBhY3Rpb24gKHVzZXIgZGVjaXNpb24gUTE0KS5cbiAgICAgICAgICAgICAgICBodG1sICs9ICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cIm1oLXNjZW5hcmlvJyArIChkaXNhYmxlZCA/ICcgaXMtZGlzYWJsZWQnIDogJycpICsgKHNlbGVjdGVkID8gJyBpcy1zZWxlY3RlZCcgOiAnJylcbiAgICAgICAgICAgICAgICAgICAgKyAnXCIgZGF0YS1zb3VyY2UtaWQ9XCInICsgZXNjKHNvdXJjZS5pZCkgKyAnXCIgYXJpYS1wcmVzc2VkPVwiJyArIChzZWxlY3RlZCA/ICd0cnVlJyA6ICdmYWxzZScpICsgJ1wiJ1xuICAgICAgICAgICAgICAgICAgICArIChkaXNhYmxlZCA/ICcgZGlzYWJsZWQgYXJpYS1kaXNhYmxlZD1cInRydWVcIicgOiAnJykgKyAnPidcbiAgICAgICAgICAgICAgICAgICAgKyBzY2VuYXJpb0ljb24oc291cmNlLmlkKVxuICAgICAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXNjZW5hcmlvLXRleHRcIj48Yj4nICsgZXNjKHNvdXJjZS5uYW1lKSArICc8L2I+J1xuICAgICAgICAgICAgICAgICAgICArIChkaXNhYmxlZCA/ICc8c3BhbiBjbGFzcz1cIm1oLW1ldGFcIj4nICsgZXNjKHNvdXJjZS5hdmFpbGFiaWxpdHlfbmFtZSkgKyAnPC9zcGFuPicgOiAnJylcbiAgICAgICAgICAgICAgICAgICAgKyAnPC9zcGFuPjwvYnV0dG9uPic7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGh0bWwgKz0gJzwvZGl2Pic7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXNjZW5hcmlvcycpLmh0bWwoaHRtbCk7XG4gICAgfVxuXG4gICAgLy8gLS0tLSBzdGVwIDI6IGNvbmRpdGlvbnMgKG5vIGhpbnRzOyBhbiBlbXB0eSBjaG9pY2UgbWVhbnMgwqvQstGB0LXCuykgLS0tLVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyV2l6YXJkQ29uZGl0aW9ucygpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgIHZhciBodG1sID0gJyc7XG4gICAgICAgIGlmICh3aXphcmRTdXBwb3J0c0VtcGxveWVlcyh3LmV2ZW50VHlwZXMpKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZmllbGQnICsgKHN0YXRlLmVtcGxveWVlc0ZhaWxlZCA/ICcgZXJyb3InIDogJycpICsgJ1wiIGlkPVwibWgtY29uZC1lbXBsb3llZXMtZmllbGRcIj4nXG4gICAgICAgICAgICAgICAgKyAnPGxhYmVsPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkRW1wbG95ZWVzJykpICsgJzwvbGFiZWw+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJ1aSBtdWx0aXBsZSBzZWFyY2ggc2VsZWN0aW9uIGRyb3Bkb3duIG1oLWNvbmQtZHJvcGRvd25cIiBpZD1cIm1oLWNvbmQtZW1wbG95ZWVzXCIgdGFiaW5kZXg9XCIwXCI+J1xuICAgICAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiaGlkZGVuXCI+PHNwYW4gY2xhc3M9XCJkZWZhdWx0IHRleHRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0ZpbHRlckFsbCcpKSArICc8L3NwYW4+PGRpdiBjbGFzcz1cIm1lbnVcIj48L2Rpdj48L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAoc3RhdGUuZW1wbG95ZWVzRmFpbGVkXG4gICAgICAgICAgICAgICAgICAgID8gJzxzcGFuIGNsYXNzPVwibWgtaGVscFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkTGlzdEZhaWxlZCcpKVxuICAgICAgICAgICAgICAgICAgICAgICAgKyAnIDxhIGhyZWY9XCIjXCIgZGF0YS1hY3Rpb249XCJyZXRyeS1lbXBsb3llZXNcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0NvbW1vblJldHJ5JykpICsgJzwvYT48L3NwYW4+J1xuICAgICAgICAgICAgICAgICAgICA6ICcnKVxuICAgICAgICAgICAgICAgICsgJzwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHdpemFyZFN1cHBvcnRzRGlyZWN0aW9ucyh3LmV2ZW50VHlwZXMpKSB7XG4gICAgICAgICAgICB2YXIgZGlyZWN0aW9ucyA9IFtcbiAgICAgICAgICAgICAgICBbJ2luY29taW5nJywgJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZERpcmVjdGlvbkluY29taW5nJ10sXG4gICAgICAgICAgICAgICAgWydvdXRnb2luZycsICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmREaXJlY3Rpb25PdXRnb2luZyddLFxuICAgICAgICAgICAgICAgIFsnaW50ZXJuYWwnLCAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkRGlyZWN0aW9uSW50ZXJuYWwnXVxuICAgICAgICAgICAgXTtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJmaWVsZFwiPjxsYWJlbD4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZERpcmVjdGlvbnMnKSkgKyAnPC9sYWJlbD4nXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cIm1oLXNlZ1wiIHJvbGU9XCJncm91cFwiIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZERpcmVjdGlvbnMnKSkgKyAnXCI+JztcbiAgICAgICAgICAgIGRpcmVjdGlvbnMuZm9yRWFjaChmdW5jdGlvbiAocGFpcikge1xuICAgICAgICAgICAgICAgIHZhciBwcmVzc2VkID0gdy5maWx0ZXJzLmRpcmVjdGlvbnMuaW5kZXhPZihwYWlyWzBdKSA+PSAwO1xuICAgICAgICAgICAgICAgIGh0bWwgKz0gJzxidXR0b24gdHlwZT1cImJ1dHRvblwiIGRhdGEtZGlyZWN0aW9uPVwiJyArIHBhaXJbMF0gKyAnXCIgYXJpYS1wcmVzc2VkPVwiJyArIChwcmVzc2VkID8gJ3RydWUnIDogJ2ZhbHNlJykgKyAnXCI+J1xuICAgICAgICAgICAgICAgICAgICArIGVzYyh0KHBhaXJbMV0pKSArICc8L2J1dHRvbj4nO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBodG1sICs9ICc8L2Rpdj48L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3aXphcmRTdXBwb3J0c1Byb3ZpZGVycyh3LmV2ZW50VHlwZXMpKSB7XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZmllbGRcIj48bGFiZWw+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRQcm92aWRlcnMnKSkgKyAnPC9sYWJlbD4nXG4gICAgICAgICAgICAgICAgKyAnPGRpdiBjbGFzcz1cInVpIG11bHRpcGxlIHNlYXJjaCBzZWxlY3Rpb24gZHJvcGRvd24gbWgtY29uZC1kcm9wZG93blwiIGlkPVwibWgtY29uZC1wcm92aWRlcnNcIiB0YWJpbmRleD1cIjBcIj4nXG4gICAgICAgICAgICAgICAgKyAnPGlucHV0IHR5cGU9XCJoaWRkZW5cIj48c3BhbiBjbGFzcz1cImRlZmF1bHQgdGV4dFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRmlsdGVyQWxsJykpICsgJzwvc3Bhbj48ZGl2IGNsYXNzPVwibWVudVwiPjwvZGl2PjwvZGl2PjwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHcuZXZlbnRUeXBlcy5pbmRleE9mKCdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJykgPj0gMCkge1xuICAgICAgICAgICAgdmFyIHJhbmdlID0gdy5maWx0ZXJzLnF1YWxpdHlfc2NvcmUgfHwge307XG4gICAgICAgICAgICBodG1sICs9ICc8ZGl2IGNsYXNzPVwiZmllbGRcIj48bGFiZWw+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRRdWFsaXR5JykpICsgJzwvbGFiZWw+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1pbmxpbmUtaW5wdXRzXCI+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUXVhbGl0eUZyb20nKSkgKyAnPC9zcGFuPjxpbnB1dCB0eXBlPVwibnVtYmVyXCIgbWluPVwiMFwiIG1heD1cIjEwMFwiIGNsYXNzPVwibWgtcXVhbGl0eS1taW4gbWgtaW5wdXQteHNcIiB2YWx1ZT1cIicgKyAocmFuZ2UubWluICE9PSB1bmRlZmluZWQgPyByYW5nZS5taW4gOiAnJykgKyAnXCI+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUXVhbGl0eVRvJykpICsgJzwvc3Bhbj48aW5wdXQgdHlwZT1cIm51bWJlclwiIG1pbj1cIjBcIiBtYXg9XCIxMDBcIiBjbGFzcz1cIm1oLXF1YWxpdHktbWF4IG1oLWlucHV0LXhzXCIgdmFsdWU9XCInICsgKHJhbmdlLm1heCAhPT0gdW5kZWZpbmVkID8gcmFuZ2UubWF4IDogJycpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8L2Rpdj48L2Rpdj4nO1xuICAgICAgICB9XG4gICAgICAgIGlmICh3LmV2ZW50VHlwZXMuaW5kZXhPZignY29yZS5taXNzZWRfY2FsbCcpID49IDApIHtcbiAgICAgICAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9XCJtaC1zd2l0Y2gtcm93IG1oLXJldHJhY3Qtcm93XCI+J1xuICAgICAgICAgICAgICAgICsgJzxsYWJlbCBjbGFzcz1cInVpIHRvZ2dsZSBjaGVja2JveCcgKyAody5yZXRyYWN0LmVuYWJsZWQgPyAnIGNoZWNrZWQnIDogJycpICsgJ1wiIGlkPVwibWgtcmV0cmFjdC1lbmFibGVkXCI+J1xuICAgICAgICAgICAgICAgICsgJzxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjbGFzcz1cImhpZGRlblwiJyArICh3LnJldHJhY3QuZW5hYmxlZCA/ICcgY2hlY2tlZCcgOiAnJykgKyAnIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1JldHJhY3RFbmFibGVkJykpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLXRyYWNrXCI+PC9zcGFuPjwvbGFiZWw+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUmV0cmFjdEVuYWJsZWQnKSkgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLWlubGluZS1pbnB1dHNcIiBpZD1cIm1oLXJldHJhY3Qtb3B0aW9uc1wiJyArICh3LnJldHJhY3QuZW5hYmxlZCA/ICcnIDogJyBoaWRkZW4nKSArICc+J1xuICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtbXV0ZWRcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1JldHJhY3RXaW5kb3dCZWZvcmUnKSkgKyAnPC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8aW5wdXQgdHlwZT1cIm51bWJlclwiIG1pbj1cIjVcIiBtYXg9XCIxMjBcIiBpZD1cIm1oLXJldHJhY3Qtd2luZG93XCIgY2xhc3M9XCJtaC1pbnB1dC14c1wiIHZhbHVlPVwiJyArIHcucmV0cmFjdC53aW5kb3dfbWluICsgJ1wiIGFyaWEtbGFiZWw9XCInICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1JldHJhY3RNaW51dGVzJykpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW11dGVkXCI+JyArIGVzYyh0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9SZXRyYWN0TWludXRlcycpKSArICc8L3NwYW4+PC9zcGFuPidcbiAgICAgICAgICAgICAgICArICc8L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAod2l6YXJkSXNNYXgoKVxuICAgICAgICAgICAgICAgICAgICA/ICc8ZGl2IGNsYXNzPVwiZmllbGRcIiBpZD1cIm1oLXJldHJhY3QtbWF4LWhpbnRcIicgKyAody5yZXRyYWN0LmVuYWJsZWQgPyAnJyA6ICcgaGlkZGVuJykgKyAnPidcbiAgICAgICAgICAgICAgICAgICAgICAgICsgJzxzcGFuIGNsYXNzPVwibWgtaGVscFwiPicgKyBlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfUmV0cmFjdE1heEhpbnQnKSkgKyAnPC9zcGFuPjwvZGl2PidcbiAgICAgICAgICAgICAgICAgICAgOiAnJyk7XG4gICAgICAgIH1cbiAgICAgICAgJCgnI21oLXdpemFyZC1jb25kaXRpb25zJykuaHRtbChodG1sKTtcbiAgICAgICAgaW5pdENvbmRpdGlvbkRyb3Bkb3ducygpO1xuICAgICAgICBiaW5kV2l6YXJkQ29uZGl0aW9ucygpO1xuICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaW5pdENvbmRpdGlvbkRyb3Bkb3ducygpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICB2YXIgJGVtcGxveWVlcyA9ICQoJyNtaC1jb25kLWVtcGxveWVlcycpO1xuICAgICAgICBpZiAoJGVtcGxveWVlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB2YXIgc2VsZWN0ZWRVc2VycyA9IHcuZmlsdGVycy51c2VyX2lkcy5tYXAoU3RyaW5nKTtcbiAgICAgICAgICAgICRlbXBsb3llZXMuZHJvcGRvd24oe1xuICAgICAgICAgICAgICAgIHZhbHVlczogc3RhdGUuZW1wbG95ZWVzLm1hcChmdW5jdGlvbiAoZW1wbG95ZWUpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgbmFtZTogZW1wbG95ZWUubGFiZWwsIHZhbHVlOiBTdHJpbmcoZW1wbG95ZWUuaWQpLCBzZWxlY3RlZDogc2VsZWN0ZWRVc2Vycy5pbmRleE9mKFN0cmluZyhlbXBsb3llZS5pZCkpID49IDAgfTtcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcjogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfRmlsdGVyQWxsJyksXG4gICAgICAgICAgICAgICAgZnVsbFRleHRTZWFyY2g6IHRydWUsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogeyBub1Jlc3VsdHM6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0ZpbHRlck5vdGhpbmdGb3VuZCcpIH0sXG4gICAgICAgICAgICAgICAgb25DaGFuZ2U6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXN0YXRlLnJ1bGVXaXphcmQpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlLnJ1bGVXaXphcmQuZmlsdGVycy51c2VyX2lkcyA9IFN0cmluZyh2YWx1ZSB8fCAnJykuc3BsaXQoJywnKS5maWx0ZXIoQm9vbGVhbikubWFwKE51bWJlcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyICRwcm92aWRlcnMgPSAkKCcjbWgtY29uZC1wcm92aWRlcnMnKTtcbiAgICAgICAgaWYgKCRwcm92aWRlcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdmFyIHNlbGVjdGVkUHJvdmlkZXJzID0gdy5maWx0ZXJzLnByb3ZpZGVycy5tYXAoU3RyaW5nKTtcbiAgICAgICAgICAgICRwcm92aWRlcnMuZHJvcGRvd24oe1xuICAgICAgICAgICAgICAgIHZhbHVlczogc3RhdGUucHJvdmlkZXJzLm1hcChmdW5jdGlvbiAocHJvdmlkZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHsgbmFtZTogcHJvdmlkZXIubGFiZWwsIHZhbHVlOiBTdHJpbmcocHJvdmlkZXIuaWQpLCBzZWxlY3RlZDogc2VsZWN0ZWRQcm92aWRlcnMuaW5kZXhPZihTdHJpbmcocHJvdmlkZXIuaWQpKSA+PSAwIH07XG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgcGxhY2Vob2xkZXI6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX0ZpbHRlckFsbCcpLFxuICAgICAgICAgICAgICAgIGZ1bGxUZXh0U2VhcmNoOiB0cnVlLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IHsgbm9SZXN1bHRzOiB0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9GaWx0ZXJOb3RoaW5nRm91bmQnKSB9LFxuICAgICAgICAgICAgICAgIG9uQ2hhbmdlOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS5ydWxlV2l6YXJkKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLmZpbHRlcnMucHJvdmlkZXJzID0gU3RyaW5nKHZhbHVlIHx8ICcnKS5zcGxpdCgnLCcpLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGJpbmRXaXphcmRDb25kaXRpb25zKCkge1xuICAgICAgICB2YXIgJGZvcm0gPSAkKCcjbWgtd2l6YXJkLWNvbmRpdGlvbnMnKTtcbiAgICAgICAgJGZvcm0ub2ZmKCcud2l6YXJkJyk7XG4gICAgICAgICRmb3JtLm9uKCdjbGljay53aXphcmQnLCAnLm1oLXNlZyBidXR0b24nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIgdmFsdWUgPSBTdHJpbmcoJCh0aGlzKS5kYXRhKCdkaXJlY3Rpb24nKSk7XG4gICAgICAgICAgICB2YXIgaW5kZXggPSB3LmZpbHRlcnMuZGlyZWN0aW9ucy5pbmRleE9mKHZhbHVlKTtcbiAgICAgICAgICAgIGlmIChpbmRleCA+PSAwKSB7XG4gICAgICAgICAgICAgICAgdy5maWx0ZXJzLmRpcmVjdGlvbnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdy5maWx0ZXJzLmRpcmVjdGlvbnMucHVzaCh2YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAkKHRoaXMpLmF0dHIoJ2FyaWEtcHJlc3NlZCcsIGluZGV4ID49IDAgPyAnZmFsc2UnIDogJ3RydWUnKTtcbiAgICAgICAgICAgIHJlbmRlcldpemFyZFByZXZpZXcoKTtcbiAgICAgICAgfSk7XG4gICAgICAgICRmb3JtLm9uKCdjbGljay53aXphcmQnLCAnW2RhdGEtYWN0aW9uPVwicmV0cnktZW1wbG95ZWVzXCJdJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgc3RhdGUuZW1wbG95ZWVzRmFpbGVkID0gZmFsc2U7XG4gICAgICAgICAgICBsb2FkRW1wbG95ZWVzKGZ1bmN0aW9uICgpIHsgcmVuZGVyV2l6YXJkQ29uZGl0aW9ucygpOyB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgICRmb3JtLm9uKCdjaGFuZ2Uud2l6YXJkJywgJyNtaC1yZXRyYWN0LWVuYWJsZWQgaW5wdXQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB3LnJldHJhY3QuZW5hYmxlZCA9ICQodGhpcykucHJvcCgnY2hlY2tlZCcpO1xuICAgICAgICAgICAgJCgnI21oLXJldHJhY3QtZW5hYmxlZCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgdy5yZXRyYWN0LmVuYWJsZWQpO1xuICAgICAgICAgICAgJCgnI21oLXJldHJhY3Qtb3B0aW9ucycpLnByb3AoJ2hpZGRlbicsICF3LnJldHJhY3QuZW5hYmxlZCk7XG4gICAgICAgICAgICAkKCcjbWgtcmV0cmFjdC1tYXgtaGludCcpLnByb3AoJ2hpZGRlbicsICF3LnJldHJhY3QuZW5hYmxlZCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkZm9ybS5vbignaW5wdXQud2l6YXJkIGNoYW5nZS53aXphcmQnLCAnI21oLXJldHJhY3Qtd2luZG93JywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdmFyIHZhbHVlID0gTnVtYmVyKCQodGhpcykudmFsKCkpO1xuICAgICAgICAgICAgdy5yZXRyYWN0LndpbmRvd19taW4gPSB2YWx1ZSA+PSA1ICYmIHZhbHVlIDw9IDEyMCA/IHZhbHVlIDogMjA7XG4gICAgICAgIH0pO1xuICAgICAgICAkZm9ybS5vbignaW5wdXQud2l6YXJkJywgJy5taC1xdWFsaXR5LW1pbiwgLm1oLXF1YWxpdHktbWF4JywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICAgICAgaWYgKCF3KSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdmFyIG1pbiA9ICRmb3JtLmZpbmQoJy5taC1xdWFsaXR5LW1pbicpLnZhbCgpO1xuICAgICAgICAgICAgdmFyIG1heCA9ICRmb3JtLmZpbmQoJy5taC1xdWFsaXR5LW1heCcpLnZhbCgpO1xuICAgICAgICAgICAgdmFyIHJhbmdlID0ge307XG4gICAgICAgICAgICBpZiAoU3RyaW5nKG1pbikudHJpbSgpICE9PSAnJykgeyByYW5nZS5taW4gPSBOdW1iZXIobWluKTsgfVxuICAgICAgICAgICAgaWYgKFN0cmluZyhtYXgpLnRyaW0oKSAhPT0gJycpIHsgcmFuZ2UubWF4ID0gTnVtYmVyKG1heCk7IH1cbiAgICAgICAgICAgIHcuZmlsdGVycy5xdWFsaXR5X3Njb3JlID0gT2JqZWN0LmtleXMocmFuZ2UpLmxlbmd0aCA+IDAgPyByYW5nZSA6IG51bGw7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0gc3RlcCAzOiB3aGVyZSB0byBzZW5kIC0tLS1cblxuICAgIGZ1bmN0aW9uIGFjdGl2ZVdpemFyZEJvdCgpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuIG51bGw7IH1cbiAgICAgICAgdmFyIGJvdHMgPSBzdGF0ZS5ib3RzLmZpbHRlcihmdW5jdGlvbiAoYm90KSB7IHJldHVybiBib3QuZW5hYmxlZCAhPT0gZmFsc2U7IH0pO1xuICAgICAgICBpZiAody5ib3RJZCA+IDApIHtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYm90cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIGlmIChOdW1iZXIoYm90c1tpXS5pZCkgPT09IE51bWJlcih3LmJvdElkKSkgeyByZXR1cm4gYm90c1tpXTsgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBib3RzLmxlbmd0aCA+IDAgPyBib3RzWzBdIDogbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJXaXphcmRSZWNpcGllbnRzKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIHZhciBzdXBwb3J0c0VtcGxveWVlcyA9IHdpemFyZFN1cHBvcnRzRW1wbG95ZWVzKHcuZXZlbnRUeXBlcyk7XG4gICAgICAgIHZhciBib3RzID0gc3RhdGUuYm90cy5maWx0ZXIoZnVuY3Rpb24gKGJvdCkgeyByZXR1cm4gYm90LmVuYWJsZWQgIT09IGZhbHNlOyB9KTtcbiAgICAgICAgdmFyIGFjdGl2ZSA9IGFjdGl2ZVdpemFyZEJvdCgpO1xuICAgICAgICBpZiAoYWN0aXZlICE9PSBudWxsICYmIE51bWJlcih3LmJvdElkKSAhPT0gTnVtYmVyKGFjdGl2ZS5pZCkpIHtcbiAgICAgICAgICAgIHcuYm90SWQgPSBOdW1iZXIoYWN0aXZlLmlkKTsgLy8gYSBzaW5nbGUgYm90IGlzIHNlbGVjdGVkIGJ5IGl0c2VsZlxuICAgICAgICB9XG4gICAgICAgIHZhciBib3RIdG1sID0gJyc7XG4gICAgICAgIGJvdHMuZm9yRWFjaChmdW5jdGlvbiAoYm90KSB7XG4gICAgICAgICAgICB2YXIgc2VsZWN0ZWQgPSBhY3RpdmUgIT09IG51bGwgJiYgTnVtYmVyKGFjdGl2ZS5pZCkgPT09IE51bWJlcihib3QuaWQpO1xuICAgICAgICAgICAgdmFyIGNoYW5uZWwgPSBib3QuY2hhbm5lbCA9PT0gJ21heCcgPyAnbWF4JyA6ICd0Zyc7XG4gICAgICAgICAgICBib3RIdG1sICs9ICc8YnV0dG9uIHR5cGU9XCJidXR0b25cIiBjbGFzcz1cIm1oLXNjZW5hcmlvIG1oLWJvdC1jaG9pY2UnICsgKHNlbGVjdGVkID8gJyBpcy1zZWxlY3RlZCcgOiAnJylcbiAgICAgICAgICAgICAgICArICdcIiBkYXRhLWJvdC1pZD1cIicgKyBib3QuaWQgKyAnXCIgYXJpYS1wcmVzc2VkPVwiJyArIChzZWxlY3RlZCA/ICd0cnVlJyA6ICdmYWxzZScpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8c3BhbiBjbGFzcz1cIm1oLW1lc3NlbmdlciAnICsgY2hhbm5lbCArICdcIiBhcmlhLWhpZGRlbj1cInRydWVcIj4nICsgKGNoYW5uZWwgPT09ICdtYXgnID8gJ01BWCcgOiAnVEcnKSArICc8L3NwYW4+J1xuICAgICAgICAgICAgICAgICsgJzxiIGNsYXNzPVwibWgtdHJ1bmNhdGVcIj4nICsgZXNjKGJvdC50aXRsZSkgKyAnPC9iPjwvYnV0dG9uPic7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLWJvdHMnKS5odG1sKGJvdEh0bWwpO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLWJvdHMtZmllbGQnKS5hdHRyKCdoaWRkZW4nLCBib3RzLmxlbmd0aCA+IDAgPyBudWxsIDogdHJ1ZSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtbm8tYm90cycpLmF0dHIoJ2hpZGRlbicsIGJvdHMubGVuZ3RoID4gMCA/IHRydWUgOiBudWxsKTtcbiAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQnKS5hdHRyKCdoaWRkZW4nLCBib3RzLmxlbmd0aCA+IDAgPyBudWxsIDogdHJ1ZSk7XG5cbiAgICAgICAgaWYgKCFzdXBwb3J0c0VtcGxveWVlcykge1xuICAgICAgICAgICAgdy50YXJnZXRNb2RlID0gJ3JlY2lwaWVudHMnO1xuICAgICAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQgW3ZhbHVlPVwiZW1wbG95ZWVcIl0sICNtaC13aXphcmQtdGFyZ2V0IFt2YWx1ZT1cImVtcGxveWVlX29yX3JlY2lwaWVudHNcIl0nKVxuICAgICAgICAgICAgICAgIC5jbG9zZXN0KCdsYWJlbCcpLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQgW3ZhbHVlPVwiZW1wbG95ZWVcIl0sICNtaC13aXphcmQtdGFyZ2V0IFt2YWx1ZT1cImVtcGxveWVlX29yX3JlY2lwaWVudHNcIl0nKVxuICAgICAgICAgICAgICAgIC5jbG9zZXN0KCdsYWJlbCcpLnJlbW92ZUF0dHIoJ2hpZGRlbicpO1xuICAgICAgICB9XG4gICAgICAgICQoJyNtaC13aXphcmQtdGFyZ2V0IGlucHV0W25hbWU9XCJtaC10YXJnZXRcIl0nKS5lYWNoKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBjaGVja2VkID0gJCh0aGlzKS52YWwoKSA9PT0gdy50YXJnZXRNb2RlO1xuICAgICAgICAgICAgJCh0aGlzKS5wcm9wKCdjaGVja2VkJywgY2hlY2tlZCkuY2xvc2VzdCgnbGFiZWwnKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsIGNoZWNrZWQpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmVuZGVyV2l6YXJkQ2hhdHMoKTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1tYXNrJykudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCB3Lm1hc2spO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLW1hc2sgaW5wdXQnKS5wcm9wKCdjaGVja2VkJywgdy5tYXNrKTtcbiAgICAgICAgcmVuZGVyV2l6YXJkQXR0YWNobWVudHMoKTtcbiAgICAgICAgYmluZFdpemFyZFJlY2lwaWVudHMoKTtcbiAgICAgICAgLy8gYSBzY2VuYXJpbyB3aXRob3V0IGNvbmRpdGlvbnMgZ29lcyAxIC0+IDM6IHN0ZXAgMyBtdXN0IHJlbmRlciBpdHMgb3duIHByZXZpZXdcbiAgICAgICAgcmVuZGVyV2l6YXJkUHJldmlldygpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlbmRlcldpemFyZEF0dGFjaG1lbnRzKCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIHZhciBtb2RlcyA9IHdpemFyZEF0dGFjaG1lbnRNb2Rlcyh3LmV2ZW50VHlwZXMpO1xuICAgICAgICB2YXIgJGZpZWxkID0gJCgnI21oLXdpemFyZC1hdHRhY2htZW50cycpO1xuICAgICAgICBpZiAobW9kZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICB3LmF0dGFjaG1lbnRzID0gJ25vbmUnO1xuICAgICAgICAgICAgJGZpZWxkLmF0dHIoJ2hpZGRlbicsIHRydWUpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtb2Rlcy5pbmRleE9mKHcuYXR0YWNobWVudHMpIDwgMCkgeyB3LmF0dGFjaG1lbnRzID0gJ25vbmUnOyB9XG4gICAgICAgICRmaWVsZC5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgLy8gYSB2b2ljZW1haWwgaXMgb25lIGZpbGU6IHRoZSB3aG9sZS1jb252ZXJzYXRpb24gd29yZGluZyBiZWNvbWVzIHBsYWluIFwiUmVjb3JkaW5nXCJcbiAgICAgICAgdmFyIHZvaWNlbWFpbE9ubHkgPSB3LmV2ZW50VHlwZXMuaW5kZXhPZignYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCcpIDwgMDtcbiAgICAgICAgJCgnI21oLXdpemFyZC1hdHRhY2gtcmVjb3JkaW5nLXRleHQnKS50ZXh0KHQodm9pY2VtYWlsT25seVxuICAgICAgICAgICAgPyAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkQXR0YWNoVm9pY2VtYWlsJ1xuICAgICAgICAgICAgOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkQXR0YWNoUmVjb3JkaW5nJykpO1xuICAgICAgICAkZmllbGQuZmluZCgnbGFiZWxbZGF0YS1tb2RlXScpLmVhY2goZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIG1vZGUgPSBTdHJpbmcoJCh0aGlzKS5kYXRhKCdtb2RlJykpO1xuICAgICAgICAgICAgdmFyIGNoZWNrZWQgPSBtb2RlID09PSB3LmF0dGFjaG1lbnRzO1xuICAgICAgICAgICAgJCh0aGlzKS5hdHRyKCdoaWRkZW4nLCBtb2Rlcy5pbmRleE9mKG1vZGUpID49IDAgPyBudWxsIDogdHJ1ZSlcbiAgICAgICAgICAgICAgICAudG9nZ2xlQ2xhc3MoJ2NoZWNrZWQnLCBjaGVja2VkKS5maW5kKCdpbnB1dCcpLnByb3AoJ2NoZWNrZWQnLCBjaGVja2VkKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtYXR0YWNoLWhpbnQnKS5hdHRyKCdoaWRkZW4nLCB3LmF0dGFjaG1lbnRzID09PSAnbm9uZScgPyB0cnVlIDogbnVsbCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVuZGVyV2l6YXJkQ2hhdHMoKSB7XG4gICAgICAgIHZhciB3ID0gc3RhdGUucnVsZVdpemFyZDtcbiAgICAgICAgdmFyIGJvdCA9IGFjdGl2ZVdpemFyZEJvdCgpO1xuICAgICAgICB2YXIgY2hhdHMgPSBib3QgPyAoYm90LmNoYXRzIHx8IFtdKS5maWx0ZXIoZnVuY3Rpb24gKGNoYXQpIHtcbiAgICAgICAgICAgIHJldHVybiBjaGF0LnN0YXRlID09PSAnYWN0aXZlJyAmJiBjaGF0LmVuYWJsZWQgPT09IHRydWU7XG4gICAgICAgIH0pIDogW107XG4gICAgICAgIHZhciBpZHMgPSBjaGF0cy5tYXAoZnVuY3Rpb24gKGNoYXQpIHsgcmV0dXJuIE51bWJlcihjaGF0LmlkKTsgfSk7XG4gICAgICAgIHcuY2hhdElkcyA9IHcuY2hhdElkcy5maWx0ZXIoZnVuY3Rpb24gKGlkKSB7IHJldHVybiBpZHMuaW5kZXhPZihpZCkgPj0gMDsgfSk7XG4gICAgICAgICQoJyNtaC13aXphcmQtY2hhdHMtZmllbGQnKS5hdHRyKCdoaWRkZW4nLCB3LnRhcmdldE1vZGUgPT09ICdlbXBsb3llZScgPyB0cnVlIDogbnVsbCk7XG4gICAgICAgIHZhciAkZHJvcGRvd24gPSAkKCcjbWgtd2l6YXJkLWNoYXRzJyk7XG4gICAgICAgICRkcm9wZG93bi5kcm9wZG93bignZGVzdHJveScpO1xuICAgICAgICAkZHJvcGRvd24uZmluZCgnYS51aS5sYWJlbCcpLnJlbW92ZSgpO1xuICAgICAgICAkZHJvcGRvd24uZHJvcGRvd24oe1xuICAgICAgICAgICAgdmFsdWVzOiBjaGF0cy5tYXAoZnVuY3Rpb24gKGNoYXQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiBlc2MoY2hhdC50aXRsZSB8fCBjaGF0LmNoYXRfaWQpICsgJyA8c3BhbiBjbGFzcz1cIm1oLW1ldGFcIj7CtyAnICsgZXNjKGNoYXRLaW5kTGFiZWwoY2hhdC5jaGF0X2tpbmQpKSArICc8L3NwYW4+JyxcbiAgICAgICAgICAgICAgICAgICAgdGV4dDogZXNjKGNoYXQudGl0bGUgfHwgY2hhdC5jaGF0X2lkKSxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IFN0cmluZyhjaGF0LmlkKSxcbiAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWQ6IHcuY2hhdElkcy5pbmRleE9mKE51bWJlcihjaGF0LmlkKSkgPj0gMFxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBjaGF0cy5sZW5ndGggPiAwID8gdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkQ2hhdHNUaXRsZScpIDogdCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkTm9DaGF0cycpLFxuICAgICAgICAgICAgbWVzc2FnZTogeyBub1Jlc3VsdHM6IHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZE5vQ2hhdHMnKSB9LFxuICAgICAgICAgICAgb25DaGFuZ2U6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgIGlmICghc3RhdGUucnVsZVdpemFyZCkgeyByZXR1cm47IH1cbiAgICAgICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLmNoYXRJZHMgPSBTdHJpbmcodmFsdWUgfHwgJycpLnNwbGl0KCcsJykuZmlsdGVyKEJvb2xlYW4pLm1hcChOdW1iZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBiaW5kV2l6YXJkUmVjaXBpZW50cygpIHtcbiAgICAgICAgdmFyICRzdGVwID0gJCgnI21oLXdpemFyZC1zdGVwLTMnKTtcbiAgICAgICAgJHN0ZXAub2ZmKCcud2l6YXJkJyk7XG4gICAgICAgICRzdGVwLm9uKCdjbGljay53aXphcmQnLCAnLm1oLWJvdC1jaG9pY2UnLCBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBzdGF0ZS5ydWxlV2l6YXJkLmJvdElkID0gTnVtYmVyKCQodGhpcykuZGF0YSgnYm90LWlkJykpO1xuICAgICAgICAgICAgc3RhdGUucnVsZVdpemFyZC5jaGF0SWRzID0gW107XG4gICAgICAgICAgICByZW5kZXJXaXphcmRSZWNpcGllbnRzKCk7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgICAgICB1cGRhdGVXaXphcmROZXh0KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkc3RlcC5vbignY2hhbmdlLndpemFyZCcsICdpbnB1dFtuYW1lPVwibWgtdGFyZ2V0XCJdJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc3RhdGUucnVsZVdpemFyZC50YXJnZXRNb2RlID0gU3RyaW5nKCQodGhpcykudmFsKCkpO1xuICAgICAgICAgICAgJCgnI21oLXdpemFyZC10YXJnZXQgaW5wdXRbbmFtZT1cIm1oLXRhcmdldFwiXScpLmVhY2goZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICQodGhpcykuY2xvc2VzdCgnbGFiZWwnKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsICQodGhpcykucHJvcCgnY2hlY2tlZCcpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgJCgnI21oLXdpemFyZC1jaGF0cy1maWVsZCcpLmF0dHIoJ2hpZGRlbicsIHN0YXRlLnJ1bGVXaXphcmQudGFyZ2V0TW9kZSA9PT0gJ2VtcGxveWVlJyA/IHRydWUgOiBudWxsKTtcbiAgICAgICAgfSk7XG4gICAgICAgICRzdGVwLm9uKCdjaGFuZ2Uud2l6YXJkJywgJ2lucHV0W25hbWU9XCJtaC1hdHRhY2htZW50c1wiXScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHN0YXRlLnJ1bGVXaXphcmQuYXR0YWNobWVudHMgPSBTdHJpbmcoJCh0aGlzKS52YWwoKSk7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRBdHRhY2htZW50cygpO1xuICAgICAgICAgICAgcmVuZGVyV2l6YXJkUHJldmlldygpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHN0ZXAub24oJ2NoYW5nZS53aXphcmQnLCAnI21oLXdpemFyZC1tYXNrIGlucHV0JywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc3RhdGUucnVsZVdpemFyZC5tYXNrID0gJCh0aGlzKS5wcm9wKCdjaGVja2VkJyk7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLW1hc2snKS50b2dnbGVDbGFzcygnY2hlY2tlZCcsIHN0YXRlLnJ1bGVXaXphcmQubWFzayk7XG4gICAgICAgICAgICByZW5kZXJXaXphcmRQcmV2aWV3KCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0gcHJldmlldyAoc3RlcCAyLCByaWdodCBjb2x1bW4pIC0tLS1cblxuICAgIC8qKiBBIHJ1bGUgdGFyZ2V0cyBvbmUgYm90LCBzbyBpdHMgY2hhbm5lbCBpcyB0aGUgY2hhbm5lbCBvZiB0aGUgYWN0aXZlIHdpemFyZCBib3QuICovXG4gICAgZnVuY3Rpb24gd2l6YXJkSXNNYXgoKSB7XG4gICAgICAgIHZhciBib3QgPSBhY3RpdmVXaXphcmRCb3QoKTtcbiAgICAgICAgcmV0dXJuICEhYm90ICYmIGJvdC5jaGFubmVsID09PSAnbWF4JztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB3aXphcmRQcmV2aWV3Q2FsbFR5cGUodHlwZXMpIHtcbiAgICAgICAgdmFyIG9yZGVyID0gW1xuICAgICAgICAgICAgJ2NvcmUubWlzc2VkX2NhbGwnLCAnY29yZS52b2ljZW1haWwnLCAnYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCcsXG4gICAgICAgICAgICAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb2ZmbGluZScsICdhaV9zdXBlcnZpc29yLndvcmtlcl9vbmxpbmUnLFxuICAgICAgICAgICAgJ3ZvaWNlX2FnZW50LmNhbGxiYWNrX3JlcXVlc3QnLCAndm9pY2VfYWdlbnQucnVudGltZV9kb3duJywgJ3ZvaWNlX2FnZW50LnJ1bnRpbWVfdXAnLFxuICAgICAgICAgICAgJ2NvcmUucHJvdmlkZXJfZG93bicsICdjb3JlLnByb3ZpZGVyX3VwJywgJ2NvcmUuYWR2aWNlJywgJ2NvcmUucGJ4X3N0YXJ0ZWQnXG4gICAgICAgIF07XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgb3JkZXIubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmICh0eXBlcy5pbmRleE9mKG9yZGVyW2ldKSA+PSAwKSB7IHJldHVybiBvcmRlcltpXTsgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZW5kZXJXaXphcmRQcmV2aWV3KCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgdmFyIHR5cGUgPSB3aXphcmRQcmV2aWV3Q2FsbFR5cGUody5ldmVudFR5cGVzKTtcbiAgICAgICAgaWYgKHR5cGUgPT09ICcnKSB7XG4gICAgICAgICAgICAkKCcjbWgtd2l6YXJkLXByZXZpZXcsICNtaC13aXphcmQtcHJldmlldy10YXJnZXQnKS5lbXB0eSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciBuYW1lcyA9IGV2ZW50VHlwZU5hbWVzKCk7XG4gICAgICAgIHZhciB0aXRsZSA9IG5hbWVzW3R5cGVdIHx8IHR5cGU7XG4gICAgICAgIGlmICh0eXBlID09PSAnYWlfc3VwZXJ2aXNvci5hdHRlbnRpb25fY2FsbCcpIHtcbiAgICAgICAgICAgIHRpdGxlICs9ICcgwrcgJyArIHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlUXVhbGl0eVNjb3JlJywgeyBzY29yZTogNDggfSk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHBob25lID0gdy5tYXNrID8gJys3IDk2OCAqKiotKiotNDQnIDogJys3IDk2OCA5NjgtOTQtNDQnO1xuICAgICAgICB2YXIgbGluZXMgPSBbXTtcbiAgICAgICAgdmFyIG5vdGVzID0gW107XG4gICAgICAgIHZhciBidXR0b24gPSBmYWxzZTtcbiAgICAgICAgdmFyIGRpcmVjdGlvbiA9IHcuZmlsdGVycy5kaXJlY3Rpb25zLmxlbmd0aCA9PT0gMSA/IHcuZmlsdGVycy5kaXJlY3Rpb25zWzBdIDogJ2luY29taW5nJztcbiAgICAgICAgc3dpdGNoICh0eXBlKSB7XG4gICAgICAgICAgICBjYXNlICdjb3JlLm1pc3NlZF9jYWxsJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKCc8Yj4nICsgZXNjKHBob25lKSArICc8L2I+IOKGkiDQmNCy0LDQvdC+0LIg0JguICgyMzMpJyk7XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2MoJzAyLjEwLjIwMjYgMTU6NDEgwrcgJyArIHQoe1xuICAgICAgICAgICAgICAgICAgICBpbmNvbWluZzogJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VEaXJlY3Rpb25JbmNvbWluZycsXG4gICAgICAgICAgICAgICAgICAgIG91dGdvaW5nOiAnbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZURpcmVjdGlvbk91dGdvaW5nJyxcbiAgICAgICAgICAgICAgICAgICAgaW50ZXJuYWw6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlRGlyZWN0aW9uSW50ZXJuYWwnXG4gICAgICAgICAgICAgICAgfVtkaXJlY3Rpb25dKSkpO1xuICAgICAgICAgICAgICAgIGJ1dHRvbiA9IHRydWU7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdjb3JlLnZvaWNlbWFpbCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2ModCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZVZvaWNlbWFpbEhpbnQnKSkpO1xuICAgICAgICAgICAgICAgIGJ1dHRvbiA9IHRydWU7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYygn0J/QtdGC0YDQvtCy0LAg0JAuICgyNDEpIOKGkCAnICsgKHcubWFzayA/ICcrNyA5MTYgKioqLSoqLTE3JyA6ICcrNyA5MTYgMjA0LTU1LTE3JykgKyAnIMK3IDY6NDInKSk7XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2ModGYoJ21vZHVsZV9tZXNzZW5nZXJfaHViX01lc3NhZ2VSZWFzb25zJywgeyByZWFzb25zOiAn0JrQu9C40LXQvdGC0YMg0L3QtSDQv9C+0LzQvtCz0LvQuDsg0L/QvtCy0YLQvtGA0L3Ri9C5INC30LLQvtC90L7QuicgfSkpKTtcbiAgICAgICAgICAgICAgICBub3Rlcy5wdXNoKCfQmtC70LjQtdC90YLRgyDQvdC1INC/0L7QvNC+0LPQu9C4OiDQtNCy0LDQttC00Ysg0L7RgtC/0YDQsNCy0LjQu9C4INC90LAg0YHQsNC50YIsINGA0LXRiNC10L3QuNGPINC90LUg0L/RgNC10LTQu9C+0LbQuNC70LguJyk7XG4gICAgICAgICAgICAgICAgYnV0dG9uID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ3ZvaWNlX2FnZW50LmNhbGxiYWNrX3JlcXVlc3QnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKCfQn9GR0YLRgCDCtyAnICsgcGhvbmUpKTtcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKGVzYyh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfTWVzc2FnZVRvcGljJywgeyB0b3BpYzogJ9CS0L7Qt9Cy0YDQsNGCJyB9KSkpO1xuICAgICAgICAgICAgICAgIGJ1dHRvbiA9IHRydWU7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdjb3JlLnByb3ZpZGVyX2Rvd24nOlxuICAgICAgICAgICAgY2FzZSAnY29yZS5wcm92aWRlcl91cCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaChlc2MoJ1NJUCDCq9Cc0LXQs9Cw0YTQvtC9wrsgwrcgMTAuMC4wLjEnKSk7XG4gICAgICAgICAgICAgICAgbm90ZXMucHVzaCgncmVnaXN0ZXJlZCDihpIgdW5yZWdpc3RlcmVkJyk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdhaV9zdXBlcnZpc29yLndvcmtlcl9vZmZsaW5lJzpcbiAgICAgICAgICAgIGNhc2UgJ2FpX3N1cGVydmlzb3Iud29ya2VyX29ubGluZSc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaCgnc3R0LTEnKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ3ZvaWNlX2FnZW50LnJ1bnRpbWVfZG93bic6XG4gICAgICAgICAgICBjYXNlICd2b2ljZV9hZ2VudC5ydW50aW1lX3VwJzpcbiAgICAgICAgICAgICAgICBsaW5lcy5wdXNoKCdjb25uZWN0aW9uIHJlZnVzZWQnKTtcbiAgICAgICAgICAgICAgICBub3Rlcy5wdXNoKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9NZXNzYWdlTGF0ZW5jeScsIHsgbXM6IDEyMDAgfSkpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnY29yZS5hZHZpY2UnOlxuICAgICAgICAgICAgICAgIGxpbmVzLnB1c2goZXNjKCfQodCy0L7QsdC+0LTQvdC+IDggJSDQvdCwINGA0LDQt9C00LXQu9C1IC9zdG9yYWdlJykpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnY29yZS5wYnhfc3RhcnRlZCc6XG4gICAgICAgICAgICAgICAgbGluZXMucHVzaCgnMDIuMTAuMjAyNiAwMzoxMCcpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIHZhciBpc01heCA9IHdpemFyZElzTWF4KCk7XG4gICAgICAgIHZhciBodG1sID0gJzxkaXYgY2xhc3M9XCJtaC1wcmV2aWV3LW1zZycgKyAoaXNNYXggPyAnIGlzLW1heCcgOiAnJykgKyAnXCI+PGRpdj4nICsgZXNjKGljb25Gb3JUeXBlKHR5cGUpKSArICcgPGI+JyArIGVzYyh0aXRsZSkgKyAnPC9iPjwvZGl2Pic7XG4gICAgICAgIGxpbmVzLmZvckVhY2goZnVuY3Rpb24gKGxpbmUpIHsgaHRtbCArPSAnPGRpdj4nICsgbGluZSArICc8L2Rpdj4nOyB9KTtcbiAgICAgICAgbm90ZXMuZm9yRWFjaChmdW5jdGlvbiAobm90ZSkgeyBodG1sICs9ICc8ZGl2PjxpPicgKyBlc2Mobm90ZSkgKyAnPC9pPjwvZGl2Pic7IH0pO1xuICAgICAgICBodG1sICs9ICc8c3BhbiBjbGFzcz1cIm1oLXByZXZpZXctdGltZVwiPjE1OjQxPC9zcGFuPjwvZGl2Pic7XG4gICAgICAgIGh0bWwgKz0gd2l6YXJkUHJldmlld0F1ZGlvKHR5cGUsIHcuYXR0YWNobWVudHMsIGlzTWF4KTtcbiAgICAgICAgaWYgKGJ1dHRvbikge1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIm1oLXByZXZpZXctYnV0dG9uJyArIChpc01heCA/ICcgaXMtbWF4JyA6ICcnKSArICdcIj4nICsgZXNjKHQoJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFByZXZpZXdCdXR0b24nKSkgKyAnIOKGlzwvZGl2Pic7XG4gICAgICAgIH1cbiAgICAgICAgLy8gdGhlIG1lc3NlbmdlciBpcyBwYXJ0IG9mIHRoZSBwcmV2aWV3LCBzbyB0aGUgYXNpZGUgc2F5cyB3aGljaCBidWJibGUgaXQgc2hvd3NcbiAgICAgICAgLy8gKHRoZSBkZXNpZ24gaGFzIG5vIHZpc2libGUgY2FwdGlvbiBhYm92ZSB0aGUgYnViYmxlKVxuICAgICAgICAkKCcubWgtd2l6YXJkLXByZXZpZXcnKS5hdHRyKCdhcmlhLWxhYmVsJyxcbiAgICAgICAgICAgIHQoaXNNYXggPyAnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkUHJldmlld0NoYW5uZWxNYXgnIDogJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFByZXZpZXdUaXRsZScpKTtcbiAgICAgICAgLy8gc3RlcCAyIHNob3dzIHRoZSBjb25kaXRpb25zIHByZXZpZXcsIHN0ZXAgMyB0aGUgc2FtZSBwcmV2aWV3IGZvciB0aGUgY2hvc2VuIGJvdFxuICAgICAgICAkKCcjbWgtd2l6YXJkLXByZXZpZXcsICNtaC13aXphcmQtcHJldmlldy10YXJnZXQnKS5odG1sKGh0bWwpO1xuICAgIH1cblxuICAgIC8vIEF1ZGlvIGJ1YmJsZXMgZm9sbG93IHRoZSB0ZXh0IChQbGFuLzAzKTogZnJhZ21lbnRzID0gb25lIGJ1YmJsZSBwZXIgZnJhZ21lbnQsIG90aGVyd2lzZSB0aGUgd2hvbGUgZmlsZS5cbiAgICAvLyBUaGUgbnVtYmVycyBhcmUgc2FtcGxlIHZhbHVlcyBvZiB0aGUgcHJldmlldywgbmV2ZXIgcmVhbCBkYXRhLlxuICAgIGZ1bmN0aW9uIHdpemFyZFByZXZpZXdBdWRpbyh0eXBlLCBtb2RlLCBpc01heCkge1xuICAgICAgICBpZiAobW9kZSA9PT0gJ25vbmUnIHx8IHdpemFyZEF0dGFjaG1lbnRNb2RlcyhbdHlwZV0pLmluZGV4T2YobW9kZSkgPCAwKSB7IHJldHVybiAnJzsgfVxuICAgICAgICB2YXIgaXRlbXMgPSBbXTtcbiAgICAgICAgaWYgKG1vZGUgPT09ICdmcmFnbWVudHMnKSB7XG4gICAgICAgICAgICB2YXIgc2FtcGxlID0gWycwOjEyJywgJzA6MTgnXTtcbiAgICAgICAgICAgIHNhbXBsZS5mb3JFYWNoKGZ1bmN0aW9uIChkdXJhdGlvbiwgaW5kZXgpIHtcbiAgICAgICAgICAgICAgICBpdGVtcy5wdXNoKHRmKCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9QcmV2aWV3QXVkaW9GcmFnbWVudCcsIHsgbjogaW5kZXggKyAxLCB0b3RhbDogc2FtcGxlLmxlbmd0aCwgZHVyYXRpb246IGR1cmF0aW9uIH0pKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaXRlbXMucHVzaCh0ZignbW9kdWxlX21lc3Nlbmdlcl9odWJfUHJldmlld0F1ZGlvUmVjb3JkaW5nJywgeyBkdXJhdGlvbjogdHlwZSA9PT0gJ2NvcmUudm9pY2VtYWlsJyA/ICcwOjMyJyA6ICc2OjQyJyB9KSk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGh0bWwgPSAnJztcbiAgICAgICAgaXRlbXMuZm9yRWFjaChmdW5jdGlvbiAoY2FwdGlvbikge1xuICAgICAgICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz1cIm1oLXByZXZpZXctbXNnIG1oLXByZXZpZXctYXVkaW8nICsgKGlzTWF4ID8gJyBpcy1tYXgnIDogJycpICsgJ1wiPidcbiAgICAgICAgICAgICAgICArICc8ZGl2IGNsYXNzPVwibWgtcHJldmlldy1hdWRpby1yb3dcIj48c3BhbiBjbGFzcz1cIm1oLXByZXZpZXctcGxheVwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjwvc3Bhbj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1wcmV2aWV3LXdhdmVcIiBhcmlhLWhpZGRlbj1cInRydWVcIj48L3NwYW4+PC9kaXY+J1xuICAgICAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1tZXRhXCI+JyArIGVzYyhjYXB0aW9uKSArICc8L2Rpdj4nXG4gICAgICAgICAgICAgICAgKyAnPHNwYW4gY2xhc3M9XCJtaC1wcmV2aWV3LXRpbWVcIj4xNTo0MTwvc3Bhbj48L2Rpdj4nO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIGh0bWw7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaWNvbkZvclR5cGUodHlwZSkge1xuICAgICAgICBpZiAodHlwZSA9PT0gJ2NvcmUubWlzc2VkX2NhbGwnIHx8IHR5cGUgPT09ICd2b2ljZV9hZ2VudC5jYWxsYmFja19yZXF1ZXN0JykgeyByZXR1cm4gJ/Cfk54nOyB9XG4gICAgICAgIGlmICh0eXBlID09PSAnY29yZS52b2ljZW1haWwnKSB7IHJldHVybiAn8J+OmSc7IH1cbiAgICAgICAgaWYgKHR5cGUgPT09ICdhaV9zdXBlcnZpc29yLmF0dGVudGlvbl9jYWxsJyB8fCB0eXBlID09PSAnY29yZS5wcm92aWRlcl9kb3duJyB8fCB0eXBlID09PSAndm9pY2VfYWdlbnQucnVudGltZV9kb3duJykgeyByZXR1cm4gJ+KaoO+4jyc7IH1cbiAgICAgICAgaWYgKHR5cGUgPT09ICdjb3JlLnByb3ZpZGVyX3VwJyB8fCB0eXBlID09PSAndm9pY2VfYWdlbnQucnVudGltZV91cCcgfHwgdHlwZSA9PT0gJ2FpX3N1cGVydmlzb3Iud29ya2VyX29ubGluZScpIHsgcmV0dXJuICfinIUnOyB9XG4gICAgICAgIGlmICh0eXBlID09PSAnYWlfc3VwZXJ2aXNvci53b3JrZXJfb2ZmbGluZScpIHsgcmV0dXJuICfwn5SMJzsgfVxuICAgICAgICBpZiAodHlwZSA9PT0gJ2NvcmUucGJ4X3N0YXJ0ZWQnKSB7IHJldHVybiAn8J+UhCc7IH1cbiAgICAgICAgcmV0dXJuICfimqDvuI8nO1xuICAgIH1cblxuICAgIC8vIC0tLS0gbmF2aWdhdGlvbiBhbmQgc2F2ZSAtLS0tXG5cbiAgICBmdW5jdGlvbiB3aXphcmROZXh0KCkge1xuICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgIGlmICghdykgeyByZXR1cm47IH1cbiAgICAgICAgaWYgKHcuc3RlcCA9PT0gMSkge1xuICAgICAgICAgICAgaWYgKCF3LnNvdXJjZUlkKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgdy5zdGVwID0gZmlyc3RTdGVwQWZ0ZXJTY2VuYXJpbyh3LmV2ZW50VHlwZXMpO1xuICAgICAgICAgICAgcmVuZGVyV2l6YXJkKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHcuc3RlcCA9PT0gMikge1xuICAgICAgICAgICAgdy5zdGVwID0gMztcbiAgICAgICAgICAgIHJlbmRlcldpemFyZCgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHNhdmVSdWxlKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2l6YXJkUHJldigpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgIGlmICgkKCcjbWgtd2l6YXJkLXByZXYnKS5kYXRhKCdtb2RlJykgIT09ICdiYWNrJykge1xuICAgICAgICAgICAgY2xvc2VSdWxlV2l6YXJkKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHcuc3RlcCA9PT0gMyAmJiB3aXphcmRIYXNDb25kaXRpb25zKHcuZXZlbnRUeXBlcykpIHtcbiAgICAgICAgICAgIHcuc3RlcCA9IDI7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB3LnN0ZXAgPSAxO1xuICAgICAgICB9XG4gICAgICAgIGNsZWFyV2l6YXJkRXJyb3IoKTtcbiAgICAgICAgcmVuZGVyV2l6YXJkKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcHJ1bmVGaWx0ZXJzKGZpbHRlcnMpIHtcbiAgICAgICAgdmFyIHJlc3VsdCA9IHt9O1xuICAgICAgICBpZiAoZmlsdGVycy51c2VyX2lkcy5sZW5ndGggPiAwKSB7IHJlc3VsdC51c2VyX2lkcyA9IGZpbHRlcnMudXNlcl9pZHM7IH1cbiAgICAgICAgaWYgKGZpbHRlcnMuZGlyZWN0aW9ucy5sZW5ndGggPiAwKSB7IHJlc3VsdC5kaXJlY3Rpb25zID0gZmlsdGVycy5kaXJlY3Rpb25zOyB9XG4gICAgICAgIGlmIChmaWx0ZXJzLnByb3ZpZGVycy5sZW5ndGggPiAwKSB7IHJlc3VsdC5wcm92aWRlcnMgPSBmaWx0ZXJzLnByb3ZpZGVyczsgfVxuICAgICAgICBpZiAoZmlsdGVycy5xdWFsaXR5X3Njb3JlICE9PSBudWxsICYmIE9iamVjdC5rZXlzKGZpbHRlcnMucXVhbGl0eV9zY29yZSkubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgcmVzdWx0LnF1YWxpdHlfc2NvcmUgPSBmaWx0ZXJzLnF1YWxpdHlfc2NvcmU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzYXZlUnVsZSgpIHtcbiAgICAgICAgdmFyIHcgPSBzdGF0ZS5ydWxlV2l6YXJkO1xuICAgICAgICBpZiAoIXcpIHsgcmV0dXJuOyB9XG4gICAgICAgIHZhciBzY2VuYXJpbyA9IHdpemFyZFNjZW5hcmlvKCk7XG4gICAgICAgIC8vIHRoZSB3aXphcmQgaGFzIG5vIG5hbWUgZmllbGQgKGRlc2lnbiB2Myk6IGEgbmV3IG5vdGlmaWNhdGlvbiBpcyBuYW1lZCBhZnRlciBpdHMgc2NlbmFyaW9cbiAgICAgICAgdmFyIHRpdGxlID0gU3RyaW5nKHcudGl0bGUgfHwgJycpLnRyaW0oKSB8fCAoc2NlbmFyaW8gPyBzY2VuYXJpby5uYW1lIDogJycpO1xuICAgICAgICBpZiAodGl0bGUgPT09ICcnKSB7XG4gICAgICAgICAgICBzaG93V2l6YXJkRXJyb3IodCgnbW9kdWxlX21lc3Nlbmdlcl9odWJfV2l6YXJkVGl0bGVSZXF1aXJlZCcpKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAody50YXJnZXRNb2RlICE9PSAnZW1wbG95ZWUnICYmIHcuY2hhdElkcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHNob3dXaXphcmRFcnJvcih0KCdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmROZWVkQ2hhdHMnKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIG9wdGlvbnMgPSB7IG1hc2tfcGhvbmU6IHcubWFzayB9O1xuICAgICAgICBpZiAody5ldmVudFR5cGVzLmluZGV4T2YoJ2NvcmUubWlzc2VkX2NhbGwnKSA+PSAwKSB7XG4gICAgICAgICAgICBvcHRpb25zLnJldHJhY3Rfb25fY2FsbGJhY2sgPSB7XG4gICAgICAgICAgICAgICAgZW5hYmxlZDogdy5yZXRyYWN0LmVuYWJsZWQgPT09IHRydWUsXG4gICAgICAgICAgICAgICAgd2luZG93X21pbjogdy5yZXRyYWN0LndpbmRvd19taW4gPj0gNSAmJiB3LnJldHJhY3Qud2luZG93X21pbiA8PSAxMjAgPyB3LnJldHJhY3Qud2luZG93X21pbiA6IDIwLFxuICAgICAgICAgICAgICAgIGNvdW50X2luY29taW5nX2Fuc3dlcmVkOiB3LnJldHJhY3QuY291bnRfaW5jb21pbmdfYW5zd2VyZWQgIT09IGZhbHNlXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGlmICh3aXphcmRBdHRhY2htZW50TW9kZXMody5ldmVudFR5cGVzKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICBvcHRpb25zLmF0dGFjaG1lbnRzID0gdy5hdHRhY2htZW50cztcbiAgICAgICAgfVxuICAgICAgICB2YXIgcGF5bG9hZCA9IHtcbiAgICAgICAgICAgIHRpdGxlOiB0aXRsZSxcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBldmVudF90eXBlczogdy5ldmVudFR5cGVzLFxuICAgICAgICAgICAgbWluX3NldmVyaXR5OiAnaW5mbycsXG4gICAgICAgICAgICBmaWx0ZXJzOiBwcnVuZUZpbHRlcnMody5maWx0ZXJzKSxcbiAgICAgICAgICAgIHRhcmdldF9tb2RlOiB3LnRhcmdldE1vZGUsXG4gICAgICAgICAgICBjaGF0X2lkczogdy5jaGF0SWRzLFxuICAgICAgICAgICAgb3B0aW9uczogb3B0aW9uc1xuICAgICAgICB9O1xuICAgICAgICB2YXIgZG9uZSA9IGZ1bmN0aW9uIChydWxlKSB7XG4gICAgICAgICAgICBjbG9zZVJ1bGVXaXphcmQoKTtcbiAgICAgICAgICAgIHJlcGxhY2VSdWxlKHJ1bGUpO1xuICAgICAgICAgICAgbG9hZFJ1bGVzKHRydWUpO1xuICAgICAgICAgICAgc2hvd1RvYXN0KHQody5lZGl0SWQgPiAwID8gJ21vZHVsZV9tZXNzZW5nZXJfaHViX1dpemFyZFNhdmVkJyA6ICdtb2R1bGVfbWVzc2VuZ2VyX2h1Yl9XaXphcmRDcmVhdGVkJykpO1xuICAgICAgICB9O1xuICAgICAgICB2YXIgZmFpbHVyZSA9IGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgIHNob3dXaXphcmRFcnJvcihmYWlsdXJlVGV4dChlcnIpKTtcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKHcuZWRpdElkID4gMCkge1xuICAgICAgICAgICAgYXBpUGF0Y2goJy9ydWxlcy8nICsgdy5lZGl0SWQsIHBheWxvYWQsIGRvbmUsIGZhaWx1cmUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgYXBpUG9zdCgnL3J1bGVzJywgcGF5bG9hZCwgZG9uZSwgZmFpbHVyZSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzaG93V2l6YXJkRXJyb3IodGV4dCkge1xuICAgICAgICAkKCcjbWgtd2l6YXJkIC5taC13aXphcmQtZXJyb3Itc2xvdCcpLmh0bWwoJzxkaXYgY2xhc3M9XCJ1aSBuZWdhdGl2ZSBtZXNzYWdlXCIgcm9sZT1cImFsZXJ0XCI+JyArIElDT05fRVJST1JcbiAgICAgICAgICAgICsgJzxkaXYgY2xhc3M9XCJtaC1ncm93XCI+JyArIGVzYyh0ZXh0KSArICc8L2Rpdj48L2Rpdj4nKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjbGVhcldpemFyZEVycm9yKCkge1xuICAgICAgICAkKCcjbWgtd2l6YXJkIC5taC13aXphcmQtZXJyb3Itc2xvdCcpLmVtcHR5KCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYmluZFdpemFyZENvbnRyb2xzKCkge1xuICAgICAgICAkKCcjbWgtcnVsZS1hZGQnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IG9wZW5SdWxlV2l6YXJkKG51bGwpOyB9KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1iYWNrJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgY2xvc2VSdWxlV2l6YXJkKCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLW5leHQnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoJCh0aGlzKS5wcm9wKCdkaXNhYmxlZCcpKSB7IHJldHVybjsgfVxuICAgICAgICAgICAgY2xlYXJXaXphcmRFcnJvcigpO1xuICAgICAgICAgICAgd2l6YXJkTmV4dCgpO1xuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXdpemFyZC1wcmV2Jykub24oJ2NsaWNrJywgd2l6YXJkUHJldik7XG4gICAgICAgICQoJyNtaC13aXphcmQtb3Blbi1zZXR0aW5ncycpLm9uKCdjbGljaycsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIGNsb3NlUnVsZVdpemFyZCgpO1xuICAgICAgICAgICAgJCgnI21oLXRhYnMgLml0ZW1bZGF0YS10YWI9XCJzZXR0aW5nc1wiXScpLnRyaWdnZXIoJ2NsaWNrJyk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXNjZW5hcmlvcycpLm9uKCdjbGljaycsICcubWgtc2NlbmFyaW8nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgc291cmNlID0gc291cmNlQnlJZCgkKHRoaXMpLmRhdGEoJ3NvdXJjZS1pZCcpKTtcbiAgICAgICAgICAgIGlmICghc291cmNlIHx8ICQodGhpcykuaGFzQ2xhc3MoJ2lzLWRpc2FibGVkJykpIHsgcmV0dXJuOyB9XG4gICAgICAgICAgICB2YXIgdyA9IHN0YXRlLnJ1bGVXaXphcmQ7XG4gICAgICAgICAgICBpZiAody5zb3VyY2VJZCAhPT0gc291cmNlLmlkKSB7XG4gICAgICAgICAgICAgICAgdy5zb3VyY2VJZCA9IHNvdXJjZS5pZDtcbiAgICAgICAgICAgICAgICB3LmV2ZW50VHlwZXMgPSAoc291cmNlLmV2ZW50X3R5cGVzIHx8IFtdKS5tYXAoZnVuY3Rpb24gKHR5cGUpIHsgcmV0dXJuIHR5cGUudHlwZTsgfSk7XG4gICAgICAgICAgICAgICAgaWYgKHcuZWRpdElkID09PSAwKSB7IHcudGl0bGUgPSBzb3VyY2UubmFtZTsgfVxuICAgICAgICAgICAgICAgIHcuZmlsdGVycyA9IGVtcHR5RmlsdGVycygpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVuZGVyV2l6YXJkU2NlbmFyaW9zKCk7XG4gICAgICAgICAgICB1cGRhdGVXaXphcmROZXh0KCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtd2l6YXJkLXNjZW5hcmlvcycpLm9uKCdkYmxjbGljaycsICcubWgtc2NlbmFyaW86bm90KC5pcy1kaXNhYmxlZCknLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB3aXphcmROZXh0KCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIC0tLS0tLS0tLS0gdGFicyAmIGF1dG9yZWZyZXNoIC0tLS0tLS0tLS1cblxuICAgIGZ1bmN0aW9uIGluaXRUYWJzKCkge1xuICAgICAgICAkKCcjbWgtdGFicyAuaXRlbScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciB0YWIgPSAkKHRoaXMpLmRhdGEoJ3RhYicpO1xuICAgICAgICAgICAgJCgnI21oLXRhYnMgLml0ZW0nKS5yZW1vdmVDbGFzcygnYWN0aXZlJyk7XG4gICAgICAgICAgICAkKHRoaXMpLmFkZENsYXNzKCdhY3RpdmUnKTtcbiAgICAgICAgICAgICQoJyNtZXNzZW5nZXItaHViLXJvb3QgLm1oLXRhYi1wYW5lJykucmVtb3ZlQ2xhc3MoJ2FjdGl2ZScpO1xuICAgICAgICAgICAgJCgnI21lc3Nlbmdlci1odWItcm9vdCAubWgtdGFiLXBhbmVbZGF0YS10YWI9XCInICsgdGFiICsgJ1wiXScpLmFkZENsYXNzKCdhY3RpdmUnKTtcbiAgICAgICAgICAgICQoJyNtZXNzZW5nZXItaHViLXJvb3QnKS5hdHRyKCdkYXRhLWFjdGl2ZS10YWInLCB0YWIpO1xuICAgICAgICAgICAgaWYgKHRhYiA9PT0gJ25vdGlmaWNhdGlvbnMnKSB7XG4gICAgICAgICAgICAgICAgbG9hZFJ1bGVzKHRydWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRhYiA9PT0gJ3NldHRpbmdzJykge1xuICAgICAgICAgICAgICAgIGxvYWRHZW5lcmFsU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgICBsb2FkRW1wbG95ZWVzKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgbG9hZEJvdHMoKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gam91cm5hbFZpc2libGUoKSB7XG4gICAgICAgIHJldHVybiAkKCcjbWVzc2VuZ2VyLWh1Yi1yb290IC5taC10YWItcGFuZVtkYXRhLXRhYj1cImpvdXJuYWxcIl0nKS5oYXNDbGFzcygnYWN0aXZlJylcbiAgICAgICAgICAgICYmIGRvY3VtZW50LnZpc2liaWxpdHlTdGF0ZSA9PT0gJ3Zpc2libGUnO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG5vdGlmaWNhdGlvbnNWaXNpYmxlKCkge1xuICAgICAgICByZXR1cm4gJCgnI21lc3Nlbmdlci1odWItcm9vdCAubWgtdGFiLXBhbmVbZGF0YS10YWI9XCJub3RpZmljYXRpb25zXCJdJykuaGFzQ2xhc3MoJ2FjdGl2ZScpXG4gICAgICAgICAgICAmJiBkb2N1bWVudC52aXNpYmlsaXR5U3RhdGUgPT09ICd2aXNpYmxlJztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzY2hlZHVsZVJlZnJlc2goKSB7XG4gICAgICAgIHNldEludGVydmFsKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChqb3VybmFsVmlzaWJsZSgpKSB7XG4gICAgICAgICAgICAgICAgbG9hZCh7IHJlZnJlc2g6IHRydWUgfSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG5vdGlmaWNhdGlvbnNWaXNpYmxlKCkgJiYgc3RhdGUucnVsZVdpemFyZCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIGxvYWRSdWxlcyh0cnVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkb2N1bWVudC52aXNpYmlsaXR5U3RhdGUgPT09ICd2aXNpYmxlJykge1xuICAgICAgICAgICAgICAgIGxvYWRKb3VybmFsQmFkZ2UoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSwgUkVGUkVTSF9TRUMgKiAxMDAwKTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tIGluaXQgLS0tLS0tLS0tLVxuXG4gICAgJChkb2N1bWVudCkucmVhZHkoZnVuY3Rpb24gKCkge1xuICAgICAgICByb290ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ21lc3Nlbmdlci1odWItcm9vdCcpO1xuICAgICAgICBpZiAoIXJvb3QpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpbml0VGFicygpO1xuICAgICAgICBidWlsZFBlcmlvZE1lbnUoKTtcbiAgICAgICAgcmVuZGVyU2tlbGV0b24oKTtcblxuICAgICAgICAvLyBvdXIgY2hlY2tib3hlcyBhcmUgcGxhaW4gbGFiZWxzIGFyb3VuZCBoaWRkZW4gaW5wdXRzOiBrZWVwIHRoZSB2aXN1YWwgc3RhdGUgaW4gc3luY1xuICAgICAgICAkKGRvY3VtZW50KS5vbignY2hhbmdlJywgJy5tb2R1bGUtbWVzc2VuZ2VyLWh1YiAudWkuY2hlY2tib3ggaW5wdXQsIC5taC1tb2RhbCAudWkuY2hlY2tib3ggaW5wdXQnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgJGlucHV0ID0gJCh0aGlzKTtcbiAgICAgICAgICAgIGlmICgkaW5wdXQuYXR0cigndHlwZScpID09PSAncmFkaW8nKSB7XG4gICAgICAgICAgICAgICAgJCgnaW5wdXRbbmFtZT1cIicgKyAkaW5wdXQuYXR0cignbmFtZScpICsgJ1wiXScpLmVhY2goZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICAkKHRoaXMpLmNsb3Nlc3QoJy51aS5jaGVja2JveCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgdGhpcy5jaGVja2VkKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgJGlucHV0LmNsb3Nlc3QoJy51aS5jaGVja2JveCcpLnRvZ2dsZUNsYXNzKCdjaGVja2VkJywgdGhpcy5jaGVja2VkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgJCgnI21oLWpvdXJuYWwtcmVzZXQtZmlsdGVycycpLm9uKCdjbGljaycsIHJlc2V0RmlsdGVycyk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLXByb2JlcyBpbnB1dCcpLm9uKCdjaGFuZ2UnLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdGF0ZS5zaG93UHJvYmVzID0gJCh0aGlzKS5wcm9wKCdjaGVja2VkJyk7XG4gICAgICAgICAgICByZW5kZXJKb3VybmFsKCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1iYW5uZXInKS5vbignY2xpY2snLCAnW2RhdGEtYWN0aW9uPVwiYmFubmVyLWZpeFwiXScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBib3QgPSBib3RCeUlkKCQodGhpcykuZGF0YSgnYm90LWlkJykpO1xuICAgICAgICAgICAgaWYgKGJvdCkge1xuICAgICAgICAgICAgICAgIG9wZW5Cb3RNb2RhbCgnZWRpdCcsIGJvdCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG9wZW5Cb3RNb2RhbCgnYWRkJywgbnVsbCwgJ3RlbGVncmFtJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtam91cm5hbC1yZXRyeScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHsgbG9hZCgpOyB9KTtcbiAgICAgICAgJCgnI21oLWpvdXJuYWwtcHJldicpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChzdGF0ZS5vZmZzZXQgPj0gUEFHRV9MSU1JVCkge1xuICAgICAgICAgICAgICAgIHN0YXRlLm9mZnNldCAtPSBQQUdFX0xJTUlUO1xuICAgICAgICAgICAgICAgIGxvYWQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1qb3VybmFsLW5leHQnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBpZiAoc3RhdGUub2Zmc2V0ICsgc3RhdGUubGFzdEl0ZW1zLmxlbmd0aCA8IHN0YXRlLnRvdGFsKSB7XG4gICAgICAgICAgICAgICAgc3RhdGUub2Zmc2V0ICs9IFBBR0VfTElNSVQ7XG4gICAgICAgICAgICAgICAgbG9hZCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgJCgnI21oLXJldGVudGlvbi1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBzYXZlUmV0ZW50aW9uKTtcbiAgICAgICAgJCgnI21oLXB1YmxpYy11cmwtaW5wdXQnKS5vbignY2hhbmdlJywgc2F2ZVB1YmxpY1VybCk7XG4gICAgICAgICQoJyNtaC1wcm94eS1pbnB1dCcpLm9uKCdjaGFuZ2UnLCBzYXZlUHJveHkpO1xuICAgICAgICAkKCcjbWgtbWF4LWNhLWlucHV0Jykub24oJ2NoYW5nZScsIHNhdmVNYXhDYUJ1bmRsZSk7XG4gICAgICAgICQoJyNtaC1tYXNrLWRlZmF1bHQgaW5wdXQnKS5vbignY2hhbmdlJywgc2F2ZU1hc2tEZWZhdWx0KTtcblxuICAgICAgICBiaW5kQm90c0NvbnRhaW5lcigpO1xuICAgICAgICBiaW5kQ2hhdEZvdW5kKCk7XG4gICAgICAgIGJpbmRSdWxlc0NvbnRhaW5lcigpO1xuICAgICAgICBiaW5kV2l6YXJkQ29udHJvbHMoKTtcbiAgICAgICAgJCgnI21oLWJvdC1hZGQnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7IG9wZW5Cb3RNb2RhbCgnYWRkJywgbnVsbCwgJ3RlbGVncmFtJyk7IH0pO1xuICAgICAgICAkKCcjbWgtYm90LWNoZWNrLCAjbWgtYm90LWNoZWNrLXN0b3JlZCwgI21oLWJvdC1jaGVjay1uZXcnKS5vbignY2xpY2snLCBjaGVja0JvdEZvcm0pO1xuICAgICAgICAkKCcjbWgtYm90LXRva2VuLXJlcGxhY2UnKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkKCcjbWgtYm90LXRva2VuLW5ldy1yb3cnKS5yZW1vdmVBdHRyKCdoaWRkZW4nKTtcbiAgICAgICAgICAgICQoJyNtaC1ib3QtdG9rZW4tbmV3JykudHJpZ2dlcignZm9jdXMnKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1ib3QtdG9rZW4tY2FuY2VsJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1uZXcnKS52YWwoJycpO1xuICAgICAgICAgICAgJCgnI21oLWJvdC10b2tlbi1uZXctcm93JykuYXR0cignaGlkZGVuJywgdHJ1ZSk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtYm90LXNhdmUnKS5vbignY2xpY2snLCBzYXZlQm90Rm9ybSk7XG4gICAgICAgICQoJyNtaC1ib3QtbW9kYWwnKS5vbignY2xpY2snLCAnLm1oLWNoYW5uZWwtY2FyZCcsIGZ1bmN0aW9uIChldmVudCkge1xuICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgIGlmICghc3RhdGUuYm90TW9kYWwgfHwgJCh0aGlzKS5oYXNDbGFzcygnaXMtZGlzYWJsZWQnKSkgeyByZXR1cm47IH1cbiAgICAgICAgICAgIHN0YXRlLmJvdE1vZGFsLmNoYW5uZWwgPSBTdHJpbmcoJCh0aGlzKS5kYXRhKCdjaGFubmVsJykpO1xuICAgICAgICAgICAgJCgnI21oLWJvdC1jaGVjay1tZXNzYWdlJykuZW1wdHkoKTtcbiAgICAgICAgICAgIHN5bmNCb3RDaGFubmVsKCk7XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtYm90LWRlbGV0ZScpLm9uKCdjbGljaycsIGNvbmZpcm1EZWxldGVCb3QpO1xuICAgICAgICAkKCcjbWgtYm90LW1vZGFsIFtkYXRhLWFjdGlvbj1cImNhbmNlbFwiXScpLm9uKCdjbGljaycsIGNhbmNlbEJvdE1vZGFsKTtcbiAgICAgICAgJCgnI21oLWNoYXQtc3RvcCcpLm9uKCdjbGljaycsIHN0b3BEaXNjb3ZlcnlBbmRDbG9zZSk7XG4gICAgICAgICQoJyNtaC1jaGF0LWFnYWluJykub24oJ2NsaWNrJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgaWYgKHN0YXRlLmNoYXRNb2RhbCkge1xuICAgICAgICAgICAgICAgIHN0YXJ0RGlzY292ZXJ5KHN0YXRlLmNoYXRNb2RhbC5ib3RJZCwgdHJ1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICAkKCcjbWgtY2hhdC1zYXZlJykub24oJ2NsaWNrJywgc2F2ZVNlbGVjdGVkQ2hhdHMpO1xuICAgICAgICAkKCcjbWgtY2hhdC1tb2RhbCBbZGF0YS1hY3Rpb249XCJjYW5jZWxcIl0nKS5vbignY2xpY2snLCBzdG9wRGlzY292ZXJ5QW5kQ2xvc2UpO1xuICAgICAgICAkKCcjbWgtdGVzdC1tb2RhbCBbZGF0YS1hY3Rpb249XCJjYW5jZWxcIl0nKS5vbignY2xpY2snLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzdG9wVGVzdFBvbGwoKTtcbiAgICAgICAgICAgICQoJyNtaC10ZXN0LW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgfSk7XG4gICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsIFtkYXRhLWFjdGlvbj1cImNhbmNlbFwiXScpLm9uKCdjbGljaycsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQoJyNtaC1jb25maXJtLW1vZGFsJykubW9kYWwoJ2hpZGUnKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbG9hZENhdGFsb2coZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgYnVpbGRUeXBlTWVudSgpO1xuICAgICAgICAgICAgbG9hZEVtcGxveWVlcyhmdW5jdGlvbiAoKSB7fSk7XG4gICAgICAgICAgICBsb2FkUHJvdmlkZXJzKGZ1bmN0aW9uICgpIHt9KTtcbiAgICAgICAgICAgIGxvYWRCb3RzKHRydWUpO1xuICAgICAgICAgICAgbG9hZFJ1bGVzKCk7XG4gICAgICAgICAgICBsb2FkKCk7XG4gICAgICAgIH0pO1xuICAgICAgICBzY2hlZHVsZVJlZnJlc2goKTtcbiAgICB9KTtcbn0oKSk7XG4iXSwibWFwcGluZ3MiOiI7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNDLGFBQVk7RUFDVCxZQUFZOztFQUVaLElBQUksUUFBUSxHQUFHLHNDQUFzQztFQUNyRCxJQUFJLFVBQVUsR0FBRyxFQUFFO0VBQ25CLElBQUksV0FBVyxHQUFHLEVBQUU7RUFDcEIsSUFBSSxXQUFXLEdBQUcsQ0FBQyxPQUFPLEVBQUUsZUFBZSxFQUFFLGFBQWEsRUFBRSxLQUFLLENBQUM7RUFFbEUsSUFBSSxVQUFVLEdBQUcsK0hBQStIO0VBQ2hKLElBQUksWUFBWSxHQUFHLGlHQUFpRztFQUNwSCxJQUFJLFNBQVMsR0FBRywyRkFBMkY7RUFFM0csSUFBSSxJQUFJLEdBQUcsSUFBSTtFQUNmLElBQUksS0FBSyxHQUFHO0lBQ1IsT0FBTyxFQUFFLEVBQUU7SUFDWCxNQUFNLEVBQUUsT0FBTztJQUNmLFNBQVMsRUFBRSxFQUFFO0lBQ2IsTUFBTSxFQUFFLENBQUM7SUFDVCxLQUFLLEVBQUUsQ0FBQztJQUNSLFNBQVMsRUFBRSxLQUFLO0lBQ2hCLFNBQVMsRUFBRSxFQUFFO0lBQ2IsU0FBUyxFQUFFLENBQUMsQ0FBQztJQUNiLFVBQVUsRUFBRSxJQUFJO0lBQ2hCLE9BQU8sRUFBRSxDQUFDO0lBQ1YsU0FBUyxFQUFFLEVBQUU7SUFDYixRQUFRLEVBQUUsSUFBSTtJQUNkLElBQUksRUFBRSxFQUFFO0lBQ1IsVUFBVSxFQUFFLEtBQUs7SUFDakIsU0FBUyxFQUFFLElBQUk7SUFDZixZQUFZLEVBQUUsQ0FBQyxDQUFDO0lBQ2hCLFNBQVMsRUFBRSxFQUFFO0lBQ2IsZUFBZSxFQUFFLEtBQUs7SUFDdEIsZUFBZSxFQUFFLEtBQUs7SUFDdEIsVUFBVSxFQUFFLEtBQUs7SUFDakIsUUFBUSxFQUFFLElBQUk7SUFDZCxTQUFTLEVBQUUsSUFBSTtJQUNmLFNBQVMsRUFBRSxJQUFJO0lBQ2YsS0FBSyxFQUFFLEVBQUU7SUFDVCxXQUFXLEVBQUUsS0FBSztJQUNsQixVQUFVLEVBQUUsSUFBSTtJQUNoQixTQUFTLEVBQUUsRUFBRTtJQUNiLGVBQWUsRUFBRSxLQUFLO0lBQ3RCLFVBQVUsRUFBRTtFQUNoQixDQUFDOztFQUVEOztFQUVBLFNBQVMsQ0FBQyxDQUFDLEdBQUcsRUFBRTtJQUNaLElBQUksT0FBTyxlQUFlLEtBQUssV0FBVyxJQUFJLGVBQWUsQ0FBQyxHQUFHLENBQUMsRUFBRTtNQUNoRSxPQUFPLGVBQWUsQ0FBQyxHQUFHLENBQUM7SUFDL0I7SUFDQSxPQUFPLEdBQUc7RUFDZDtFQUVBLFNBQVMsRUFBRSxDQUFDLEdBQUcsRUFBRSxNQUFNLEVBQUU7SUFDckIsSUFBSSxJQUFJLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQztJQUNqQixNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxVQUFVLElBQUksRUFBRTtNQUM5QyxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEdBQUcsSUFBSSxHQUFHLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDbEUsQ0FBQyxDQUFDO0lBQ0YsT0FBTyxJQUFJO0VBQ2Y7O0VBRUE7O0VBRUEsU0FBUyxHQUFHLENBQUMsS0FBSyxFQUFFO0lBQ2hCLE9BQU8sS0FBSyxHQUFHLEVBQUUsR0FBRyxHQUFHLEdBQUcsS0FBSyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUM7RUFDbkQ7RUFFQSxTQUFTLE9BQU8sQ0FBQyxFQUFFLEVBQUU7SUFDakIsSUFBSSxDQUFDLEdBQUcsSUFBSSxJQUFJLENBQUMsRUFBRSxHQUFHLElBQUksQ0FBQztJQUMzQixPQUFPLEdBQUcsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7RUFDeEQ7RUFFQSxTQUFTLE9BQU8sQ0FBQyxFQUFFLEVBQUU7SUFDakIsSUFBSSxDQUFDLEdBQUcsSUFBSSxJQUFJLENBQUMsRUFBRSxHQUFHLElBQUksQ0FBQztJQUMzQixPQUFPLEdBQUcsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBQztFQUNqRjtFQUVBLFNBQVMsV0FBVyxDQUFDLEVBQUUsRUFBRTtJQUNyQixPQUFPLE9BQU8sQ0FBQyxFQUFFLENBQUMsR0FBRyxHQUFHLEdBQUcsT0FBTyxDQUFDLEVBQUUsQ0FBQztFQUMxQztFQUVBLFNBQVMsT0FBTyxDQUFDLEVBQUUsRUFBRTtJQUNqQixJQUFJLENBQUMsR0FBRyxJQUFJLElBQUksQ0FBQyxFQUFFLEdBQUcsSUFBSSxDQUFDO0lBQzNCLElBQUksR0FBRyxHQUFHLElBQUksSUFBSSxDQUFDLENBQUM7SUFDcEIsT0FBTyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsS0FBSyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUM7RUFDbEQ7RUFFQSxTQUFTLFdBQVcsQ0FBQyxFQUFFLEVBQUU7SUFDckIsSUFBSSxDQUFDLEdBQUcsSUFBSSxJQUFJLENBQUMsRUFBRSxHQUFHLElBQUksQ0FBQztJQUMzQixJQUFJLFNBQVMsR0FBRyxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxRQUFRLENBQUM7SUFDL0MsT0FBTyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsS0FBSyxTQUFTLENBQUMsWUFBWSxDQUFDLENBQUM7RUFDeEQ7O0VBRUE7RUFDQSxTQUFTLFdBQVcsQ0FBQyxFQUFFLEVBQUU7SUFDckIsSUFBSSxPQUFPLENBQUMsRUFBRSxDQUFDLEVBQUU7TUFDYixPQUFPLE9BQU8sQ0FBQyxFQUFFLENBQUM7SUFDdEI7SUFDQSxJQUFJLENBQUMsR0FBRyxJQUFJLElBQUksQ0FBQyxFQUFFLEdBQUcsSUFBSSxDQUFDO0lBQzNCLElBQUksR0FBRyxHQUFHLFdBQVcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsb0NBQW9DLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNwSCxPQUFPLHlCQUF5QixHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsR0FBRyxVQUFVLEdBQUcsT0FBTyxDQUFDLEVBQUUsQ0FBQztFQUMxRTtFQUVBLFNBQVMsR0FBRyxDQUFDLEtBQUssRUFBRTtJQUNoQixPQUFPLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssS0FBSyxJQUFJLElBQUksS0FBSyxLQUFLLFNBQVMsR0FBRyxFQUFFLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztFQUM5RjtFQUVBLFNBQVMsWUFBWSxHQUFHO0lBQ3BCLElBQUksQ0FBQyxHQUFHLElBQUksSUFBSSxDQUFDLENBQUM7SUFDbEIsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDdEIsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQztFQUN6QztFQUVBLFNBQVMsWUFBWSxHQUFHO0lBQ3BCLElBQUksR0FBRyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDO0lBQ3ZDLElBQUksVUFBVSxHQUFHLFlBQVksQ0FBQyxDQUFDO0lBQy9CLFFBQVEsS0FBSyxDQUFDLE1BQU07TUFDaEIsS0FBSyxPQUFPO1FBQUUsT0FBTztVQUFFLElBQUksRUFBRSxVQUFVO1VBQUUsRUFBRSxFQUFFO1FBQUksQ0FBQztNQUNsRCxLQUFLLFdBQVc7UUFBRSxPQUFPO1VBQUUsSUFBSSxFQUFFLFVBQVUsR0FBRyxLQUFLO1VBQUUsRUFBRSxFQUFFLFVBQVUsR0FBRztRQUFFLENBQUM7TUFDekUsS0FBSyxPQUFPO1FBQUUsT0FBTztVQUFFLElBQUksRUFBRSxVQUFVLEdBQUcsQ0FBQyxHQUFHLEtBQUs7VUFBRSxFQUFFLEVBQUU7UUFBSSxDQUFDO01BQzlELEtBQUssUUFBUTtRQUFFLE9BQU87VUFBRSxJQUFJLEVBQUUsVUFBVSxHQUFHLEVBQUUsR0FBRyxLQUFLO1VBQUUsRUFBRSxFQUFFO1FBQUksQ0FBQztNQUNoRTtRQUFTLE9BQU87VUFBRSxJQUFJLEVBQUUsQ0FBQztVQUFFLEVBQUUsRUFBRTtRQUFFLENBQUM7SUFDdEM7RUFDSjs7RUFFQTs7RUFFQSxTQUFTLE1BQU0sQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUU7SUFDaEQsQ0FBQyxDQUFDLElBQUksQ0FBQztNQUNILEdBQUcsRUFBRSxNQUFNLENBQUMsTUFBTSxHQUFHLFFBQVEsR0FBRyxJQUFJO01BQ3BDLE1BQU0sRUFBRSxLQUFLO01BQ2IsSUFBSSxFQUFFLE1BQU0sSUFBSSxDQUFDLENBQUM7TUFDbEIsS0FBSyxFQUFFO0lBQ1gsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsUUFBUSxFQUFFO01BQ3hCLElBQUksUUFBUSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssSUFBSSxFQUFFO1FBQ3RDLFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDO01BQzVCLENBQUMsTUFBTTtRQUNILFNBQVMsQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQUM7TUFDOUM7SUFDSixDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxHQUFHLEVBQUU7TUFDbkIsU0FBUyxDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDakQsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLFFBQVEsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUU7SUFDbkQsQ0FBQyxDQUFDLElBQUksQ0FBQztNQUNILEdBQUcsRUFBRSxNQUFNLENBQUMsTUFBTSxHQUFHLFFBQVEsR0FBRyxJQUFJO01BQ3BDLE1BQU0sRUFBRSxPQUFPO01BQ2YsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDO01BQzdCLFdBQVcsRUFBRSxrQkFBa0I7TUFDL0IsUUFBUSxFQUFFO0lBQ2QsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsUUFBUSxFQUFFO01BQ3hCLElBQUksUUFBUSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssSUFBSSxFQUFFO1FBQ3RDLFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDO01BQzVCLENBQUMsTUFBTTtRQUNILFNBQVMsQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQUM7TUFDOUM7SUFDSixDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxHQUFHLEVBQUU7TUFDbkIsU0FBUyxDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDakQsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLGdCQUFnQixDQUFDLFFBQVEsRUFBRSxNQUFNLEVBQUU7SUFDeEMsT0FBTztNQUNILE1BQU0sRUFBRSxNQUFNO01BQ2QsS0FBSyxFQUFHLFFBQVEsSUFBSSxRQUFRLENBQUMsSUFBSSxJQUFJLFFBQVEsQ0FBQyxJQUFJLENBQUMsS0FBSyxJQUFLLE9BQU8sR0FBRyxNQUFNO01BQzdFLFFBQVEsRUFBRyxRQUFRLElBQUksUUFBUSxDQUFDLFFBQVEsSUFBSSxRQUFRLENBQUMsUUFBUSxDQUFDLEtBQUssSUFBSztJQUM1RSxDQUFDO0VBQ0w7O0VBRUE7O0VBRUEsU0FBUyxXQUFXLENBQUMsSUFBSSxFQUFFO0lBQ3ZCLE1BQU0sQ0FBQyxzQkFBc0IsRUFBRSxDQUFDLENBQUMsRUFBRSxVQUFVLElBQUksRUFBRTtNQUMvQyxLQUFLLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQyxLQUFLLElBQUksRUFBRTtNQUNoQyxJQUFJLENBQUMsQ0FBQztJQUNWLENBQUMsRUFBRSxZQUFZO01BQ1gsS0FBSyxDQUFDLE9BQU8sR0FBRyxFQUFFO01BQ2xCLElBQUksQ0FBQyxDQUFDO0lBQ1YsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLFVBQVUsQ0FBQyxFQUFFLEVBQUU7SUFDcEIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO01BQzNDLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLEtBQUssRUFBRSxFQUFFO1FBQzVCLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7TUFDM0I7SUFDSjtJQUNBLE9BQU8sSUFBSTtFQUNmO0VBRUEsU0FBUyxjQUFjLEdBQUc7SUFDdEIsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDO0lBQ2QsS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsVUFBVSxNQUFNLEVBQUU7TUFDcEMsQ0FBQyxNQUFNLENBQUMsV0FBVyxJQUFJLEVBQUUsRUFBRSxPQUFPLENBQUMsVUFBVSxJQUFJLEVBQUU7UUFDL0MsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsSUFBSTtNQUNoQyxDQUFDLENBQUM7SUFDTixDQUFDLENBQUM7SUFDRixPQUFPLEtBQUs7RUFDaEI7O0VBRUE7O0VBRUEsU0FBUyxhQUFhLEdBQUc7SUFDckIsSUFBSSxLQUFLLEdBQUcsY0FBYyxDQUFDLENBQUM7SUFDNUIsSUFBSSxLQUFLLEdBQUcsRUFBRTtJQUNkLFdBQVcsQ0FBQyxPQUFPLENBQUMsVUFBVSxLQUFLLEVBQUU7TUFDakMsSUFBSSxPQUFPLEdBQUcsRUFBRTtNQUNoQixLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxVQUFVLE1BQU0sRUFBRTtRQUNwQyxJQUFJLE1BQU0sQ0FBQyxLQUFLLEtBQUssS0FBSyxFQUFFO1VBQ3hCO1FBQ0o7UUFDQSxDQUFDLE1BQU0sQ0FBQyxXQUFXLElBQUksRUFBRSxFQUFFLE9BQU8sQ0FBQyxVQUFVLElBQUksRUFBRTtVQUMvQyxPQUFPLENBQUMsSUFBSSxDQUFDO1lBQUUsS0FBSyxFQUFFLElBQUksQ0FBQyxJQUFJO1lBQUUsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSSxDQUFDO1VBQUssQ0FBQyxDQUFDO1FBQzNFLENBQUMsQ0FBQztNQUNOLENBQUMsQ0FBQztNQUNGLElBQUksT0FBTyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7UUFDcEIsS0FBSyxDQUFDLElBQUksQ0FBQztVQUFFLEtBQUssRUFBRSxlQUFlLENBQUMsS0FBSztRQUFFLENBQUMsQ0FBQztRQUM3QyxPQUFPLENBQUMsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFO1VBQzVCLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO1FBQ3BCLENBQUMsQ0FBQztNQUNOO0lBQ0osQ0FBQyxDQUFDO0lBQ0YsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLENBQUMsUUFBUSxDQUFDO01BQzlDLE1BQU0sRUFBRSxZQUFZLENBQUMsS0FBSyxDQUFDO01BQzNCLFdBQVcsRUFBRSxDQUFDLENBQUMscUNBQXFDLENBQUM7TUFDckQsUUFBUSxFQUFFLFNBQVYsUUFBUSxDQUFZLEtBQUssRUFBRTtRQUN2QixLQUFLLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDO1FBQ3JDLE1BQU0sQ0FBQyxDQUFDO01BQ1o7SUFDSixDQUFDLENBQUM7RUFDTjtFQUVBLFNBQVMsWUFBWSxDQUFDLEtBQUssRUFBRTtJQUN6QixPQUFPLEtBQUssQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLEVBQUU7TUFDN0IsSUFBSSxJQUFJLENBQUMsS0FBSyxFQUFFO1FBQ1osT0FBTztVQUFFLElBQUksRUFBRSxRQUFRO1VBQUUsSUFBSSxFQUFFLElBQUksQ0FBQztRQUFNLENBQUM7TUFDL0M7TUFDQSxPQUFPO1FBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJO1FBQUUsS0FBSyxFQUFFLElBQUksQ0FBQztNQUFNLENBQUM7SUFDakQsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLGVBQWUsQ0FBQyxLQUFLLEVBQUU7SUFDNUIsSUFBSSxHQUFHLEdBQUc7TUFDTixLQUFLLEVBQUUsaUNBQWlDO01BQ3hDLGFBQWEsRUFBRSx3Q0FBd0M7TUFDdkQsV0FBVyxFQUFFLHNDQUFzQztNQUNuRCxHQUFHLEVBQUU7SUFDVCxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksS0FBSztJQUNqQixPQUFPLENBQUMsQ0FBQyxHQUFHLENBQUM7RUFDakI7RUFFQSxTQUFTLGVBQWUsR0FBRztJQUN2QixDQUFDLENBQUMsdUNBQXVDLENBQUMsQ0FBQyxRQUFRLENBQUM7TUFDaEQsTUFBTSxFQUFFLENBQ0o7UUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDO1FBQUUsS0FBSyxFQUFFLE9BQU87UUFBRSxRQUFRLEVBQUU7TUFBSyxDQUFDLEVBQy9FO1FBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxzQ0FBc0MsQ0FBQztRQUFFLEtBQUssRUFBRTtNQUFZLENBQUMsRUFDdkU7UUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDO1FBQUUsS0FBSyxFQUFFO01BQVEsQ0FBQyxFQUMvRDtRQUFFLElBQUksRUFBRSxDQUFDLENBQUMsbUNBQW1DLENBQUM7UUFBRSxLQUFLLEVBQUU7TUFBUyxDQUFDLEVBQ2pFO1FBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxnQ0FBZ0MsQ0FBQztRQUFFLEtBQUssRUFBRTtNQUFNLENBQUMsQ0FDOUQ7TUFDRCxRQUFRLEVBQUUsU0FBVixRQUFRLENBQVksS0FBSyxFQUFFO1FBQ3ZCLEtBQUssQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDLEtBQUssSUFBSSxLQUFLLENBQUM7UUFDckMsTUFBTSxDQUFDLENBQUM7TUFDWjtJQUNKLENBQUMsQ0FBQztFQUNOO0VBRUEsU0FBUyxZQUFZLEdBQUc7SUFDcEIsS0FBSyxDQUFDLFNBQVMsR0FBRyxFQUFFO0lBQ3BCLEtBQUssQ0FBQyxNQUFNLEdBQUcsT0FBTztJQUN0QixLQUFLLENBQUMsTUFBTSxHQUFHLENBQUM7SUFDaEIsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQztJQUMxRCxDQUFDLENBQUMsdUNBQXVDLENBQUMsQ0FBQyxRQUFRLENBQUMsY0FBYyxFQUFFLE9BQU8sQ0FBQztJQUM1RSxNQUFNLENBQUMsQ0FBQztFQUNaO0VBRUEsU0FBUyxhQUFhLEdBQUc7SUFDckI7SUFDQSxPQUFPLEtBQUssQ0FBQyxTQUFTLEtBQUssRUFBRSxJQUFJLEtBQUssQ0FBQyxNQUFNLEtBQUssT0FBTztFQUM3RDs7RUFFQTs7RUFFQSxTQUFTLE1BQU0sR0FBRztJQUNkLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQztJQUNoQixJQUFJLENBQUMsQ0FBQztFQUNWO0VBRUEsU0FBUyxJQUFJLENBQUMsT0FBTyxFQUFFO0lBQ25CLElBQUksR0FBRyxHQUFHLEVBQUUsS0FBSyxDQUFDLE9BQU87SUFDekIsSUFBSSxNQUFNLEdBQUcsWUFBWSxDQUFDLENBQUM7SUFDM0IsSUFBSSxTQUFTLEdBQUcsT0FBTyxJQUFJLE9BQU8sQ0FBQyxPQUFPLEtBQUssSUFBSTtJQUNuRCxJQUFJLE1BQU0sR0FBRztNQUNULEtBQUssRUFBRSxVQUFVO01BQ2pCLE1BQU0sRUFBRSxLQUFLLENBQUM7SUFDbEIsQ0FBQztJQUNELElBQUksS0FBSyxDQUFDLFNBQVMsS0FBSyxFQUFFLEVBQUU7TUFBRSxNQUFNLENBQUMsVUFBVSxHQUFHLEtBQUssQ0FBQyxTQUFTO0lBQUU7SUFDbkUsSUFBSSxNQUFNLENBQUMsSUFBSSxHQUFHLENBQUMsRUFBRTtNQUFFLE1BQU0sQ0FBQyxTQUFTLEdBQUcsTUFBTSxDQUFDLElBQUk7SUFBRTtJQUN2RCxJQUFJLE1BQU0sQ0FBQyxFQUFFLEdBQUcsQ0FBQyxFQUFFO01BQUUsTUFBTSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUMsRUFBRTtJQUFFO0lBRWpELGNBQWMsQ0FBQyxJQUFJLEVBQUUsU0FBUyxDQUFDO0lBQy9CLE1BQU0sQ0FBQyxTQUFTLEVBQUUsTUFBTSxFQUFFLFVBQVUsSUFBSSxFQUFFO01BQ3RDLElBQUksR0FBRyxLQUFLLEtBQUssQ0FBQyxPQUFPLEVBQUU7UUFDdkIsT0FBTyxDQUFDO01BQ1o7TUFDQSxLQUFLLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLEdBQUcsQ0FBQztNQUN6RCxLQUFLLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxLQUFLLElBQUksRUFBRTtNQUNsQyxLQUFLLENBQUMsU0FBUyxHQUFHLElBQUk7TUFDdEIsY0FBYyxDQUFDLEtBQUssRUFBRSxTQUFTLENBQUM7TUFDaEMsYUFBYSxDQUFDLENBQUM7SUFDbkIsQ0FBQyxFQUFFLFVBQVUsT0FBTyxFQUFFO01BQ2xCLElBQUksR0FBRyxLQUFLLEtBQUssQ0FBQyxPQUFPLEVBQUU7UUFDdkI7TUFDSjtNQUNBLGNBQWMsQ0FBQyxLQUFLLEVBQUUsU0FBUyxDQUFDO01BQ2hDLGVBQWUsQ0FBQyxPQUFPLENBQUM7SUFDNUIsQ0FBQyxDQUFDO0lBQ0YsZ0JBQWdCLENBQUMsQ0FBQztFQUN0QjtFQUVBLFNBQVMsY0FBYyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7SUFDckMsSUFBSSxNQUFNLEdBQUcsQ0FBQyxDQUFDLHlCQUF5QixDQUFDO0lBQ3pDLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsSUFBSSxHQUFHLE1BQU0sR0FBRyxPQUFPLENBQUM7SUFDakUsTUFBTSxDQUFDLFdBQVcsQ0FBQyxlQUFlLEVBQUUsT0FBTyxDQUFDLElBQUksSUFBSSxTQUFTLENBQUMsQ0FBQztJQUMvRCxJQUFJLENBQUMsU0FBUyxFQUFFO01BQ1osSUFBSSxJQUFJLEVBQUU7UUFDTixjQUFjLENBQUMsQ0FBQztNQUNwQjtNQUNBLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO01BQzlCLENBQUMsQ0FBQywrQkFBK0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO0lBQzNEO0VBQ0o7RUFFQSxTQUFTLGdCQUFnQixHQUFHO0lBQ3hCLE9BQU8sK0hBQStILEdBQ2hJLHNCQUFzQixHQUN0QixNQUFNLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDLEdBQUcsT0FBTyxHQUM1RCxNQUFNLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDLEdBQUcsT0FBTyxHQUM3RCxXQUFXLEdBQ1gsTUFBTSxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMscUNBQXFDLENBQUMsQ0FBQyxHQUFHLE9BQU8sR0FDaEUsZUFBZTtFQUN6QjtFQUVBLFNBQVMsY0FBYyxHQUFHO0lBQ3RCLElBQUksSUFBSSxHQUFHLEVBQUU7SUFDYixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFO01BQ3hCLElBQUksSUFBSSw0RkFBNEYsR0FDOUYsNERBQTRELEdBQzVELDBEQUEwRCxHQUMxRCw4RkFBOEY7SUFDeEc7SUFDQSxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxJQUFJLENBQUMsdUZBQXVGLEdBQzdHLGdCQUFnQixDQUFDLENBQUMsR0FBRyxTQUFTLEdBQUcsSUFBSSxHQUFHLHdCQUF3QixDQUFDO0VBQzNFOztFQUVBOztFQUVBLFNBQVMsT0FBTyxDQUFDLElBQUksRUFBRTtJQUNuQixPQUFPLE9BQU8sQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLE9BQU8sSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssS0FBSyxJQUFJLENBQUM7RUFDdkU7RUFFQSxTQUFTLGFBQWEsQ0FBQyxLQUFLLEVBQUU7SUFDMUIsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDO0lBQ2QsQ0FBQyxLQUFLLElBQUksRUFBRSxFQUFFLE9BQU8sQ0FBQyxVQUFVLElBQUksRUFBRTtNQUNsQyxJQUFJLElBQUksQ0FBQyxVQUFVLEtBQUssMkJBQTJCLEVBQUU7UUFDakQ7TUFDSjtNQUNBLElBQUksSUFBSSxHQUFJLElBQUksQ0FBQyxPQUFPLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsSUFBSSxJQUFLLENBQUMsQ0FBQztNQUNwRixJQUFJLElBQUksQ0FBQyxlQUFlLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxFQUFFO1FBQ3RELEtBQUssQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLEdBQUcsSUFBSSxDQUFDLFdBQVc7TUFDbEQ7SUFDSixDQUFDLENBQUM7SUFDRixPQUFPLEtBQUs7RUFDaEI7RUFFQSxTQUFTLFlBQVksQ0FBQyxJQUFJLEVBQUU7SUFDeEIsSUFBSSxJQUFJLEdBQUksSUFBSSxDQUFDLE9BQU8sSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLElBQUssQ0FBQyxDQUFDO0lBQ3BGLElBQUksSUFBSSxDQUFDLFFBQVEsSUFBSSxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRTtNQUNqRCxPQUFPLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQztJQUN6QztJQUNBLElBQUksUUFBUSxHQUFHLENBQUM7SUFDaEIsQ0FBQyxJQUFJLENBQUMsVUFBVSxJQUFJLEVBQUUsRUFBRSxPQUFPLENBQUMsVUFBVSxRQUFRLEVBQUU7TUFDaEQsSUFBSSxRQUFRLENBQUMsV0FBVyxLQUFLLFFBQVEsS0FBSyxDQUFDLElBQUksUUFBUSxDQUFDLFdBQVcsR0FBRyxRQUFRLENBQUMsRUFBRTtRQUM3RSxRQUFRLEdBQUcsUUFBUSxDQUFDLFdBQVc7TUFDbkM7SUFDSixDQUFDLENBQUM7SUFDRixPQUFPLFFBQVE7RUFDbkI7RUFFQSxTQUFTLG1CQUFtQixHQUFHO0lBQzNCLEtBQUssQ0FBQyxTQUFTLEdBQUcsYUFBYSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUM7SUFDaEQsT0FBTyxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxVQUFVLElBQUksRUFBRTtNQUMxQyxJQUFJLElBQUksQ0FBQyxVQUFVLEtBQUssMkJBQTJCLEVBQUU7UUFDakQsT0FBTyxLQUFLO01BQ2hCO01BQ0EsT0FBTyxLQUFLLENBQUMsVUFBVSxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQztJQUM3QyxDQUFDLENBQUM7RUFDTjtFQUVBLFNBQVMsYUFBYSxHQUFHO0lBQ3JCLGlCQUFpQixDQUFDLENBQUM7SUFDbkIsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDOUIsbUJBQW1CLENBQUMsQ0FBQztJQUNyQixJQUFJLEtBQUssR0FBRyxtQkFBbUIsQ0FBQyxDQUFDO0lBRWpDLElBQUksS0FBSyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUU7TUFDcEIsSUFBSSxhQUFhLENBQUMsQ0FBQyxFQUFFO1FBQ2pCLENBQUMsQ0FBQyw0QkFBNEIsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUM7TUFDeEQsQ0FBQyxNQUFNO1FBQ0gsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQztNQUMvQztNQUNBLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO01BQzlCLFdBQVcsQ0FBQyxDQUFDO01BQ2I7SUFDSjtJQUVBLElBQUksS0FBSyxHQUFHLGNBQWMsQ0FBQyxDQUFDO0lBQzVCLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEVBQUU7TUFDcEIsS0FBSyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxvQ0FBb0MsQ0FBQztJQUMvRDtJQUNBLElBQUksSUFBSSxHQUFHLEVBQUU7SUFDYixLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFO01BQzFCLElBQUksSUFBSSxTQUFTLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQztNQUNsRSxJQUFJLEtBQUssQ0FBQyxVQUFVLEtBQUssSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUM5QixJQUFJLElBQUksZUFBZSxDQUFDLElBQUksQ0FBQztNQUNqQztJQUNKLENBQUMsQ0FBQztJQUNGLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxpRkFBaUYsR0FDdkcsZ0JBQWdCLENBQUMsQ0FBQyxHQUFHLFNBQVMsR0FBRyxJQUFJLEdBQUcsd0JBQXdCLENBQUM7SUFFdkUsQ0FBQyxDQUFDLHlDQUF5QyxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxZQUFZO01BQ2pFLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2pDLENBQUMsQ0FBQztJQUNGLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQyxFQUFFLENBQUMsYUFBYSxFQUFFLDZCQUE2QixFQUFFLFVBQVUsS0FBSyxFQUFFO01BQ3hHLEtBQUssQ0FBQyxlQUFlLENBQUMsQ0FBQztNQUN2QixJQUFJLE9BQU8sR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQztNQUN0QyxJQUFJLE9BQU8sR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxJQUFJLENBQUM7TUFDNUMsT0FBTyxDQUFDLFVBQVUsR0FBRyxPQUFPLEdBQUcsUUFBUSxFQUFFLENBQUMsQ0FBQyxFQUFFLFVBQVUsSUFBSSxFQUFFO1FBQ3pELFNBQVMsQ0FBQyxFQUFFLENBQUMsc0NBQXNDLEVBQUU7VUFBRSxLQUFLLEVBQUUsSUFBSSxDQUFDLE9BQU8sSUFBSTtRQUFFLENBQUMsQ0FBQyxDQUFDO1FBQ25GLElBQUksQ0FBQyxDQUFDO01BQ1YsQ0FBQyxFQUFFLFVBQVUsT0FBTyxFQUFFO1FBQ2xCLE9BQU8sQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLEtBQUssQ0FBQztRQUMvQixTQUFTLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDO01BQ25DLENBQUMsQ0FBQztJQUNOLENBQUMsQ0FBQztJQUVGLFdBQVcsQ0FBQyxDQUFDO0VBQ2pCO0VBRUEsU0FBUyxpQkFBaUIsR0FBRztJQUN6QixDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQztJQUMzQyxDQUFDLENBQUMsNEJBQTRCLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQztJQUNwRCxDQUFDLENBQUMsK0JBQStCLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQztFQUMzRDtFQUVBLFNBQVMsZUFBZSxDQUFDLE9BQU8sRUFBRTtJQUM5QixJQUFJLElBQUksR0FBRyxFQUFFLENBQUMsc0NBQXNDLEVBQUU7TUFDbEQsSUFBSSxFQUFFLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQztNQUM5QyxJQUFJLEVBQUUsT0FBTyxDQUFDLE1BQU0sR0FBRyxDQUFDLEdBQUcsT0FBTyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsb0NBQW9DO0lBQ3RGLENBQUMsQ0FBQztJQUNGLElBQUksS0FBSyxDQUFDLFNBQVMsSUFBSSxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7TUFDL0M7TUFDQSxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxJQUFJLENBQ3ZCLGdEQUFnRCxHQUFHLFVBQVUsR0FDM0QsdUJBQXVCLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLFFBQVEsR0FDOUMsMkZBQTJGLEdBQzNGLEdBQUcsQ0FBQyxDQUFDLENBQUMsa0NBQWtDLENBQUMsQ0FBQyxHQUFHLGlCQUNuRCxDQUFDO01BQ0QsQ0FBQyxDQUFDLDBCQUEwQixDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxZQUFZO1FBQUUsSUFBSSxDQUFDLENBQUM7TUFBRSxDQUFDLENBQUM7SUFDdEUsQ0FBQyxNQUFNO01BQ0gsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7TUFDOUIsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUM7TUFDM0MsQ0FBQyxDQUFDLG9DQUFvQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztNQUNsRCxDQUFDLENBQUMsK0JBQStCLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO0lBQzNEO0VBQ0o7O0VBRUE7O0VBRUE7RUFDQSxTQUFTLFVBQVUsR0FBRztJQUNsQixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7TUFDeEMsSUFBSSxHQUFHLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7TUFDdkIsSUFBSSxHQUFHLENBQUMsT0FBTyxLQUFLLEtBQUssSUFBSSxHQUFHLENBQUMsTUFBTSxLQUFLLGVBQWUsRUFBRTtRQUN6RCxPQUFPO1VBQ0gsSUFBSSxFQUFFLEVBQUUsQ0FBQyx5Q0FBeUMsRUFBRTtZQUNoRCxHQUFHLEVBQUUsR0FBRyxDQUFDLFlBQVksR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDLFlBQVksR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDLEtBQUssR0FBRztVQUN2RSxDQUFDLENBQUM7VUFDRixLQUFLLEVBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxFQUFFO1FBQ3hCLENBQUM7TUFDTDtJQUNKO0lBQ0E7SUFDQSxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7TUFDN0MsSUFBSSxVQUFVLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLElBQUksRUFBRTtNQUNwRCxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsVUFBVSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtRQUN4QyxJQUFJLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLElBQUksZ0JBQWdCLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUU7VUFDOUQsT0FBTztZQUFFLElBQUksRUFBRSxDQUFDLENBQUMsdUNBQXVDLENBQUM7WUFBRSxLQUFLLEVBQUU7VUFBRSxDQUFDO1FBQ3pFO01BQ0o7SUFDSjtJQUNBLE9BQU8sSUFBSTtFQUNmO0VBRUEsU0FBUyxtQkFBbUIsR0FBRztJQUMzQixJQUFJLE9BQU8sR0FBRyxLQUFLLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQyxDQUFDLEdBQUcsSUFBSTtJQUNwRCxJQUFJLE9BQU8sS0FBSyxJQUFJLEVBQUU7TUFDbEIsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7TUFDL0I7SUFDSjtJQUNBLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLElBQUksQ0FBQywwREFBMEQsR0FBRyxVQUFVLEdBQzlGLHVCQUF1QixHQUFHLEdBQUcsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEdBQUcsUUFBUSxHQUN0RCxvR0FBb0csR0FBRyxPQUFPLENBQUMsS0FBSyxHQUFHLElBQUksR0FDM0gsR0FBRyxDQUFDLENBQUMsQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFDLEdBQUcsaUJBQWlCLENBQUM7RUFDM0U7RUFFQSxTQUFTLGdCQUFnQixDQUFDLFFBQVEsRUFBRTtJQUNoQyxPQUFPLFFBQVEsQ0FBQyxNQUFNLEtBQUssUUFBUSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssU0FBUztFQUN4RTtFQUVBLFNBQVMsYUFBYSxDQUFDLElBQUksRUFBRTtJQUN6QixPQUFPLENBQUMsSUFBSSxDQUFDLFVBQVUsSUFBSSxFQUFFLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDO0VBQ3pEO0VBRUEsU0FBUyxnQkFBZ0IsR0FBRztJQUN4QixNQUFNLENBQUMsU0FBUyxFQUFFO01BQUUsU0FBUyxFQUFFLFlBQVksQ0FBQyxDQUFDO01BQUUsS0FBSyxFQUFFO0lBQUksQ0FBQyxFQUFFLFVBQVUsSUFBSSxFQUFFO01BQ3pFLElBQUksS0FBSyxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssSUFBSSxFQUFFLEVBQUUsTUFBTSxDQUFDLFVBQVUsSUFBSSxFQUFFO1FBQ2xELE9BQU8sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksYUFBYSxDQUFDLElBQUksQ0FBQztNQUNoRCxDQUFDLENBQUMsQ0FBQyxNQUFNO01BQ1QsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssR0FBRyxFQUFFLEdBQUcsS0FBSyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUMxRCxJQUFJLENBQUMsWUFBWSxFQUFFLEVBQUUsQ0FBQyx3Q0FBd0MsRUFBRTtRQUFFLEtBQUssRUFBRTtNQUFNLENBQUMsQ0FBQyxDQUFDLENBQ2xGLElBQUksQ0FBQyxRQUFRLEVBQUUsS0FBSyxHQUFHLENBQUMsR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFDO0lBQ2hELENBQUMsRUFBRSxZQUFZLENBQUMsQ0FBQyxDQUFDO0VBQ3RCOztFQUVBOztFQUVBLFNBQVMsUUFBUSxDQUFDLElBQUksRUFBRTtJQUNwQixJQUFJLE9BQU8sR0FBRyxJQUFJLENBQUMsT0FBTyxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxHQUFHLENBQUMsQ0FBQztJQUM5RSxJQUFJLEtBQUssR0FBRyxJQUFJLENBQUMsT0FBTyxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQztJQUN4RSxRQUFRLElBQUksQ0FBQyxVQUFVO01BQ25CLEtBQUssa0JBQWtCO01BQ3ZCLEtBQUssOEJBQThCO1FBQy9CLElBQUksU0FBUyxHQUFHLENBQUMsT0FBTyxDQUFDLFNBQVMsSUFBSSxFQUFFLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7UUFDdkUsSUFBSSxNQUFNLEdBQUcsT0FBTyxDQUFDLGFBQWEsSUFBSSxFQUFFO1FBQ3hDLElBQUksTUFBTSxLQUFLLEVBQUUsSUFBSSxTQUFTLEtBQUssRUFBRSxFQUFFO1VBQ25DLE9BQU8sTUFBTSxHQUFHLEtBQUssR0FBRyxTQUFTO1FBQ3JDO1FBQ0EsT0FBTyxNQUFNLEtBQUssRUFBRSxHQUFHLE1BQU0sR0FBRyxTQUFTO01BQzdDLEtBQUssOEJBQThCO1FBQy9CLElBQUksS0FBSyxDQUFDLE1BQU0sSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLE9BQU8sS0FBSyxJQUFJLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxPQUFPLEtBQUssU0FBUyxFQUFFO1VBQ3JGLE9BQU8sRUFBRSxDQUFDLGlDQUFpQyxFQUFFO1lBQUUsS0FBSyxFQUFFLEtBQUssQ0FBQyxNQUFNLENBQUM7VUFBUSxDQUFDLENBQUM7UUFDakY7UUFDQSxPQUFPLEtBQUssQ0FBQyxPQUFPLElBQUksT0FBTyxDQUFDLGFBQWEsSUFBSSxFQUFFO01BQ3ZELEtBQUssb0JBQW9CO01BQ3pCLEtBQUssa0JBQWtCO1FBQ25CLElBQUksUUFBUSxHQUFHLE9BQU8sQ0FBQyxRQUFRLElBQUksQ0FBQyxDQUFDO1FBQ3JDLE9BQU8sUUFBUSxDQUFDLFFBQVEsR0FBRyxPQUFPLEdBQUcsUUFBUSxDQUFDLFFBQVEsR0FBRyxHQUFHLEdBQUksUUFBUSxDQUFDLElBQUksSUFBSSxRQUFRLENBQUMsRUFBRSxJQUFJLEVBQUc7TUFDdkcsS0FBSyxhQUFhO1FBQ2QsT0FBTyxLQUFLLENBQUMsT0FBTyxJQUFJLFVBQVUsQ0FBQyxPQUFPLENBQUMsTUFBTSxJQUFJLENBQUMsQ0FBQyxDQUFDO01BQzVELEtBQUssVUFBVTtRQUNYLElBQUksVUFBVSxHQUFHLE9BQU8sQ0FBQyxNQUFNLElBQUksQ0FBQyxDQUFDO1FBQ3JDLE9BQU8sVUFBVSxDQUFDLFNBQVMsSUFBSSxFQUFFO01BQ3JDLEtBQUssOEJBQThCO01BQ25DLEtBQUssNkJBQTZCO1FBQzlCLE9BQVEsT0FBTyxDQUFDLE1BQU0sSUFBSSxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksSUFBSyxLQUFLLENBQUMsT0FBTyxJQUFJLEVBQUU7TUFDekU7UUFDSSxPQUFPLEtBQUssQ0FBQyxPQUFPLElBQUksRUFBRTtJQUNsQztFQUNKOztFQUVBO0VBQ0EsU0FBUyxhQUFhLENBQUMsUUFBUSxFQUFFO0lBQzdCLElBQUksSUFBSSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzdDLElBQUksS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDO0lBQzdCLElBQUksS0FBSyxDQUFDLE1BQU0sSUFBSSxDQUFDLElBQUksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtNQUN0QyxJQUFJLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUc7SUFDcEQ7SUFDQSxJQUFJLElBQUksS0FBSyxFQUFFLEVBQUU7TUFDYixPQUFPLE1BQU0sQ0FBQyxRQUFRLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQztJQUN4QztJQUNBLE9BQU8sUUFBUSxDQUFDLE1BQU0sR0FBRyxJQUFJLEdBQUcsSUFBSSxHQUFHLFFBQVEsQ0FBQyxNQUFNLEdBQUcsR0FBRyxHQUFHLElBQUk7RUFDdkU7RUFFQSxTQUFTLFlBQVksQ0FBQyxRQUFRLEVBQUU7SUFDNUIsT0FBTyxRQUFRLENBQUMsSUFBSSxHQUFHLFFBQVEsQ0FBQyxJQUFJLElBQUksUUFBUSxDQUFDLE1BQU0sR0FBRyxJQUFJLEdBQUcsUUFBUSxDQUFDLE1BQU0sR0FBRyxHQUFHLEdBQUcsRUFBRSxDQUFDLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxNQUFNLElBQUksRUFBRSxDQUFDO0VBQ2hJOztFQUVBO0VBQ0E7RUFDQSxTQUFTLFVBQVUsQ0FBQyxNQUFNLEVBQUU7SUFDeEIsSUFBSSxHQUFHLEdBQUksTUFBTSxJQUFJLE1BQU0sQ0FBQyxXQUFXLElBQUssRUFBRTtJQUM5QyxJQUFJLElBQUksR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDO0lBQ2pCLElBQUksR0FBRyxLQUFLLEVBQUUsSUFBSSxJQUFJLEtBQUssR0FBRyxFQUFFO01BQzVCLE9BQU8sR0FBRztJQUNkO0lBQ0EsSUFBSSxNQUFNLEdBQUksTUFBTSxJQUFJLE1BQU0sQ0FBQyxNQUFNLElBQUssQ0FBQyxDQUFDO0lBQzVDLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFO01BQ3hDLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsR0FBRyxJQUFJLEdBQUcsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztJQUNsRSxDQUFDLENBQUM7SUFDRjtJQUNBLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDLENBQzlCLE9BQU8sQ0FBQyxTQUFTLEVBQUUsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsZUFBZSxFQUFFLEdBQUcsQ0FBQyxDQUM3RSxPQUFPLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxHQUFHLENBQUMsQ0FDbEUsT0FBTyxDQUFDLE1BQU0sRUFBRSxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztFQUNwQztFQUVBLFNBQVMsU0FBUyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7SUFDaEMsSUFBSSxLQUFLLEdBQUcsT0FBTyxDQUFDLElBQUksQ0FBQyxHQUFHLHlCQUF5QixHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsK0JBQStCLENBQUMsQ0FBQyxHQUFHLFNBQVMsR0FBRyxFQUFFO0lBQ2hILElBQUksS0FBSyxHQUFHLFFBQVEsQ0FBQyxJQUFJLENBQUM7SUFDMUIsSUFBSSxRQUFRLEdBQUcsS0FBSyxDQUFDLFVBQVUsS0FBSyxJQUFJLENBQUMsRUFBRTtJQUMzQyxPQUFPLHlCQUF5QixJQUFJLFFBQVEsR0FBRyxTQUFTLEdBQUcsRUFBRSxDQUFDLEdBQUcsYUFBYSxHQUFHLElBQUksQ0FBQyxFQUFFLEdBQUcsbUJBQW1CLElBQUksUUFBUSxHQUFHLE1BQU0sR0FBRyxPQUFPLENBQUMsR0FBRyxJQUFJLEdBQy9JLDhCQUE4QixHQUFHLFlBQVksR0FBRyxPQUFPLEdBQ3ZELDJCQUEyQixHQUFHLFdBQVcsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsT0FBTyxHQUNyRSxrRUFBa0UsR0FBRyxHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsSUFBSSxHQUFHLEdBQUcsQ0FBQyxTQUFTLENBQUMsR0FBRyxTQUFTLEdBQUcsS0FBSyxHQUFHLGFBQWEsR0FDL0ksMENBQTBDLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLElBQUksR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsT0FBTyxHQUNyRixNQUFNLEdBQUcsWUFBWSxDQUFDLElBQUksQ0FBQyxHQUFHLE9BQU8sR0FDckMsT0FBTztFQUNqQjs7RUFFQTtFQUNBLFNBQVMsWUFBWSxDQUFDLElBQUksRUFBRTtJQUN4QixJQUFJLE9BQU8sR0FBRyxJQUFJLENBQUMsT0FBTyxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxHQUFHLENBQUMsQ0FBQztJQUM5RSxJQUFJLEtBQUssR0FBRyxJQUFJLENBQUMsT0FBTyxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQztJQUN4RSxJQUFJLE1BQU0sR0FBRyxFQUFFO0lBQ2YsSUFBSSxTQUFTLEdBQUcsQ0FBQyxPQUFPLENBQUMsU0FBUyxJQUFJLEVBQUUsRUFBRSxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztJQUN0RSxJQUFJLFNBQVMsS0FBSyxFQUFFLEVBQUU7TUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLEVBQUUsU0FBUyxDQUFDLENBQUM7SUFBRTtJQUM1RixJQUFJLE9BQU8sQ0FBQyxhQUFhLEVBQUU7TUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLG1DQUFtQyxDQUFDLEVBQUUsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBQUU7SUFDM0csSUFBSSxJQUFJLENBQUMsVUFBVSxLQUFLLGtCQUFrQixFQUFFO01BQ3hDLElBQUksUUFBUSxHQUFHLFlBQVksQ0FBQyxJQUFJLENBQUM7TUFDakMsSUFBSSxRQUFRLEdBQUcsQ0FBQyxFQUFFO1FBQ2QsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyx1Q0FBdUMsQ0FBQyxFQUFFLFdBQVcsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO01BQ3BGO0lBQ0o7SUFDQSxJQUFJLFFBQVEsR0FBRyxPQUFPLENBQUMsUUFBUSxJQUFJLENBQUMsQ0FBQztJQUNyQyxJQUFJLFFBQVEsQ0FBQyxRQUFRLElBQUksUUFBUSxDQUFDLElBQUksRUFBRTtNQUNwQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsUUFBUSxJQUFJLEVBQUUsS0FBSyxRQUFRLENBQUMsSUFBSSxHQUFHLEtBQUssR0FBRyxRQUFRLENBQUMsSUFBSSxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDckk7SUFDQSxJQUFJLE9BQU8sQ0FBQyxNQUFNLElBQUksT0FBTyxDQUFDLE1BQU0sQ0FBQyxXQUFXLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxFQUFFO01BQ2hFLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsb0NBQW9DLENBQUMsRUFBRSxVQUFVLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7SUFDdEY7SUFDQSxJQUFJLEtBQUssQ0FBQyxNQUFNLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxPQUFPLEtBQUssSUFBSSxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsT0FBTyxLQUFLLFNBQVMsRUFBRTtNQUNyRixNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDLEVBQUUsS0FBSyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUM5RTtJQUNBLElBQUksS0FBSyxDQUFDLE9BQU8sRUFBRTtNQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsb0NBQW9DLENBQUMsRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUM7SUFBRTtJQUM1RixJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sSUFBSSxFQUFFLEVBQUUsTUFBTSxHQUFHLENBQUMsRUFBRTtNQUNsQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLG9DQUFvQyxDQUFDLEVBQUUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztJQUNwRjtJQUNBLE9BQU8sTUFBTTtFQUNqQjtFQUVBLFNBQVMsV0FBVyxDQUFDLEVBQUUsRUFBRTtJQUNyQixJQUFJLE9BQU8sQ0FBQyxFQUFFLENBQUMsRUFBRTtNQUNiLE9BQU8sT0FBTyxDQUFDLEVBQUUsQ0FBQztJQUN0QjtJQUNBLE9BQU8sT0FBTyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEdBQUcsR0FBRyxPQUFPLENBQUMsRUFBRSxDQUFDO0VBQzFDO0VBRUEsU0FBUyxlQUFlLENBQUMsSUFBSSxFQUFFO0lBQzNCLElBQUksSUFBSSxHQUFHLHdCQUF3QjtJQUNuQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFO01BQ3ZDLElBQUksSUFBSSxNQUFNLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLFdBQVcsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsT0FBTztJQUN4RSxDQUFDLENBQUM7SUFDRixJQUFJLFNBQVMsR0FBRyxLQUFLO0lBQ3JCLENBQUMsSUFBSSxDQUFDLFVBQVUsSUFBSSxFQUFFLEVBQUUsT0FBTyxDQUFDLFVBQVUsUUFBUSxFQUFFO01BQ2hELElBQUksTUFBTSxHQUFHLGtCQUFrQixDQUFDLFFBQVEsQ0FBQztNQUN6QyxJQUFJLEtBQUssR0FBRyxjQUFjLENBQUMsUUFBUSxDQUFDO01BQ3BDLElBQUksT0FBTyxHQUFHLFFBQVEsQ0FBQyxlQUFlLElBQUksRUFBRTtNQUM1QyxJQUFJLElBQUksMEJBQTBCLEdBQUcsR0FBRyxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxHQUFHLE9BQU8sR0FDdEUsS0FBSyxJQUFJLE1BQU0sQ0FBQyxHQUFHLEdBQUcsd0JBQXdCLEdBQUcsRUFBRSxDQUFDLElBQUksT0FBTyxLQUFLLEVBQUUsR0FBRyxVQUFVLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsR0FBRyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEdBQUcsR0FDNUksR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFDZixLQUFLLEdBQUcscUJBQXFCLElBQUksS0FBSyxDQUFDLEdBQUcsR0FBRyxnQkFBZ0IsR0FBRyxFQUFFLENBQUMsR0FBRyxHQUFHLElBQ3JFLEtBQUssQ0FBQyxJQUFJLEtBQUssRUFBRSxHQUFHLFVBQVUsR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsUUFBUSxDQUFDLEdBQUcsR0FBRyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLFFBQVEsR0FBRyxFQUFFLENBQUMsR0FDbEksT0FBTztNQUNiLElBQUksUUFBUSxDQUFDLE1BQU0sS0FBSyxRQUFRLElBQUksQ0FBQyxRQUFRLENBQUMsV0FBVyxJQUFJLENBQUMsUUFBUSxDQUFDLFlBQVksRUFBRTtRQUNqRixTQUFTLEdBQUcsSUFBSTtNQUNwQjtJQUNKLENBQUMsQ0FBQztJQUNGLElBQUksSUFBSSxPQUFPO0lBQ2YsSUFBSSxTQUFTLEVBQUU7TUFDWCxJQUFJLElBQUkseUZBQXlGLEdBQUcsSUFBSSxDQUFDLEVBQUUsR0FBRyxJQUFJLEdBQzVHLEdBQUcsQ0FBQyxDQUFDLENBQUMsb0NBQW9DLENBQUMsQ0FBQyxHQUFHLFdBQVc7SUFDcEU7SUFDQSxPQUFPLHlDQUF5QyxHQUFHLElBQUksQ0FBQyxFQUFFLEdBQUcsZ0RBQWdELEdBQUcsSUFBSSxHQUFHLGtCQUFrQjtFQUM3STtFQUVBLFNBQVMsY0FBYyxDQUFDLFFBQVEsRUFBRTtJQUM5QixJQUFJLFFBQVEsQ0FBQyxVQUFVLEVBQUU7TUFDckIsT0FBTyxRQUFRLENBQUMsVUFBVTtJQUM5QjtJQUNBLElBQUksUUFBUSxDQUFDLFlBQVksRUFBRTtNQUN2QixPQUFPLENBQUMsQ0FBQywwQ0FBMEMsQ0FBQztJQUN4RDtJQUNBLE9BQU8sUUFBUSxDQUFDLGdCQUFnQixJQUFJLEdBQUc7RUFDM0M7RUFFQSxTQUFTLGNBQWMsQ0FBQyxJQUFJLEVBQUU7SUFDMUIsSUFBSSxNQUFNLEdBQUc7TUFBRSxLQUFLLEVBQUUsQ0FBQztNQUFFLElBQUksRUFBRSxDQUFDO01BQUUsTUFBTSxFQUFFLENBQUM7TUFBRSxPQUFPLEVBQUUsQ0FBQztNQUFFLFFBQVEsRUFBRTtJQUFFLENBQUM7SUFDdEUsQ0FBQyxJQUFJLENBQUMsVUFBVSxJQUFJLEVBQUUsRUFBRSxPQUFPLENBQUMsVUFBVSxRQUFRLEVBQUU7TUFDaEQsTUFBTSxDQUFDLEtBQUssRUFBRTtNQUNkLElBQUksZ0JBQWdCLENBQUMsUUFBUSxDQUFDLEVBQUU7UUFBRSxNQUFNLENBQUMsTUFBTSxFQUFFO01BQUUsQ0FBQyxNQUMvQyxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssU0FBUyxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssU0FBUyxFQUFFO1FBQUUsTUFBTSxDQUFDLE9BQU8sRUFBRTtNQUFFLENBQUMsTUFDekYsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLFdBQVcsRUFBRTtRQUFFLE1BQU0sQ0FBQyxRQUFRLEVBQUU7TUFBRSxDQUFDLE1BQzNEO1FBQUUsTUFBTSxDQUFDLElBQUksRUFBRTtNQUFFO0lBQzFCLENBQUMsQ0FBQztJQUNGLE9BQU8sTUFBTTtFQUNqQjtFQUVBLFNBQVMsWUFBWSxDQUFDLElBQUksRUFBRTtJQUN4QixJQUFJLENBQUMsR0FBRyxjQUFjLENBQUMsSUFBSSxDQUFDO0lBQzVCLElBQUksQ0FBQyxDQUFDLEtBQUssS0FBSyxDQUFDLEVBQUU7TUFDZixPQUFPLGlDQUFpQztJQUM1QztJQUNBLElBQUksQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7TUFDZCxPQUFPLDZCQUE2QixHQUFHLFVBQVUsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLDJDQUEyQyxDQUFDLENBQUMsR0FBRyxTQUFTO0lBQ3ZIO0lBQ0EsSUFBSSxDQUFDLENBQUMsT0FBTyxHQUFHLENBQUMsRUFBRTtNQUNmLE9BQU8sdUJBQXVCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDLEdBQUcsU0FBUztJQUMxRjtJQUNBLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLFFBQVEsR0FBRyxDQUFDLEVBQUU7TUFDaEMsT0FBTyx1QkFBdUIsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHlDQUF5QyxDQUFDLENBQUMsR0FBRyxTQUFTO0lBQ2xHO0lBQ0EsT0FBTyw2QkFBNkIsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLG9DQUFvQyxDQUFDLENBQUMsR0FBRyxTQUFTO0VBQ25HOztFQUVBO0VBQ0EsU0FBUyxrQkFBa0IsQ0FBQyxRQUFRLEVBQUU7SUFDbEMsSUFBSSxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsRUFBRTtNQUM1QixJQUFJLE1BQU0sR0FBRyxjQUFjLENBQUMsUUFBUSxDQUFDO01BQ3JDLE9BQU87UUFBRSxHQUFHLEVBQUUsSUFBSTtRQUFFLElBQUksRUFBRSxDQUFDLENBQUMsMkNBQTJDLENBQUMsSUFBSSxNQUFNLEtBQUssRUFBRSxHQUFHLEtBQUssR0FBRyxNQUFNLEdBQUcsRUFBRTtNQUFFLENBQUM7SUFDdEg7SUFDQSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssU0FBUyxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssU0FBUyxFQUFFO01BQ2hFLE9BQU87UUFBRSxHQUFHLEVBQUUsS0FBSztRQUFFLElBQUksRUFBRSxDQUFDLENBQUMsaUNBQWlDLENBQUMsSUFBSSxRQUFRLENBQUMsZUFBZSxHQUFHLENBQUMsR0FDekYsS0FBSyxHQUFHLEVBQUUsQ0FBQyxtQ0FBbUMsRUFBRTtVQUFFLElBQUksRUFBRSxXQUFXLENBQUMsUUFBUSxDQUFDLGVBQWU7UUFBRSxDQUFDLENBQUMsR0FDaEcsRUFBRTtNQUFFLENBQUM7SUFDZjtJQUNBLElBQUksUUFBUSxDQUFDLE1BQU0sS0FBSyxXQUFXLEVBQUU7TUFDakMsT0FBTztRQUFFLEdBQUcsRUFBRSxLQUFLO1FBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyw4Q0FBOEM7TUFBRSxDQUFDO0lBQ2xGO0lBQ0EsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLFdBQVcsRUFBRTtNQUNqQyxPQUFPO1FBQUUsR0FBRyxFQUFFLEtBQUs7UUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLDhDQUE4QztNQUFFLENBQUM7SUFDbEY7SUFDQSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssZ0JBQWdCLEVBQUU7TUFDdEMsT0FBTztRQUFFLEdBQUcsRUFBRSxJQUFJO1FBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxrREFBa0Q7TUFBRSxDQUFDO0lBQ3JGO0lBQ0EsT0FBTztNQUFFLEdBQUcsRUFBRSxLQUFLO01BQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxvQ0FBb0M7SUFBRSxDQUFDO0VBQ3hFOztFQUVBO0VBQ0EsSUFBSSxjQUFjLEdBQUc7SUFDakIsOEJBQThCLEVBQUUsbUJBQW1CO0lBQ25ELDhCQUE4QixFQUFFLGVBQWU7SUFDL0MsK0JBQStCLEVBQUUsZUFBZTtJQUNoRCwyQkFBMkIsRUFBRSxlQUFlO0lBQzVDLDhCQUE4QixFQUFFLGVBQWU7SUFDL0MsaUJBQWlCLEVBQUUsZUFBZTtJQUNsQyxvQkFBb0IsRUFBRSxjQUFjO0lBQ3BDLDhCQUE4QixFQUFFLGNBQWM7SUFDOUMsMkJBQTJCLEVBQUUsbUJBQW1CO0lBQ2hELHlCQUF5QixFQUFFLG1CQUFtQjtJQUM5QywwQkFBMEIsRUFBRSx1QkFBdUI7SUFDbkQsd0JBQXdCLEVBQUUsdUJBQXVCO0lBQ2pELDJCQUEyQixFQUFFLHVCQUF1QjtJQUNwRCwyQkFBMkIsRUFBRSxnQkFBZ0I7SUFDN0Msc0JBQXNCLEVBQUUsaUJBQWlCO0lBQ3pDLG9CQUFvQixFQUFFLGlCQUFpQjtJQUN2Qyw0QkFBNEIsRUFBRSxlQUFlO0lBQzdDLHFCQUFxQixFQUFFLGVBQWU7SUFDdEMscUJBQXFCLEVBQUUsZ0JBQWdCO0lBQ3ZDLGtCQUFrQixFQUFFLGdCQUFnQjtJQUNwQyxzQkFBc0IsRUFBRSxnQkFBZ0I7SUFDeEMsMEJBQTBCLEVBQUUsZ0JBQWdCO0lBQzVDLHNCQUFzQixFQUFFLGlCQUFpQjtJQUN6QyxxQkFBcUIsRUFBRSxvQkFBb0I7SUFDM0MsY0FBYyxFQUFFLG9CQUFvQjtJQUNwQyxrQkFBa0IsRUFBRSxvQkFBb0I7SUFDeEMsVUFBVSxFQUFFO0VBQ2hCLENBQUM7RUFFRCxTQUFTLFFBQVEsQ0FBQyxJQUFJLEVBQUU7SUFDcEIsSUFBSSxHQUFHLEdBQUcsY0FBYyxDQUFDLElBQUksQ0FBQztJQUM5QixPQUFPLEdBQUcsR0FBRyxDQUFDLENBQUMsdUJBQXVCLEdBQUcsR0FBRyxDQUFDLEdBQUcsSUFBSTtFQUN4RDs7RUFFQTtFQUNBLFNBQVMsY0FBYyxDQUFDLFFBQVEsRUFBRTtJQUM5QixJQUFJLENBQUMsR0FBRyxRQUFRLENBQUMsVUFBVTtJQUMzQixJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssSUFBSSxDQUFDLENBQUMsS0FBSyxLQUFLLE1BQU0sRUFBRTtNQUFFLE9BQU8sSUFBSTtJQUFFO0lBQ3pELElBQUksSUFBSTtJQUNSLElBQUksR0FBRyxHQUFHLEtBQUs7SUFDZixJQUFJLEtBQUssR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUM7SUFDaEMsSUFBSSxDQUFDLENBQUMsS0FBSyxLQUFLLFNBQVMsRUFBRTtNQUN2QixJQUFJLEdBQUcsQ0FBQyxDQUFDLG1DQUFtQyxDQUFDO0lBQ2pELENBQUMsTUFBTSxJQUFJLENBQUMsQ0FBQyxLQUFLLEtBQUssTUFBTSxFQUFFO01BQzNCLElBQUksR0FBRyxLQUFLLEdBQUcsQ0FBQyxHQUNWLEVBQUUsQ0FBQyxvQ0FBb0MsRUFBRTtRQUFFLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSTtRQUFFLEtBQUssRUFBRTtNQUFNLENBQUMsQ0FBQyxHQUN4RSxDQUFDLENBQUMsaUNBQWlDLENBQUM7SUFDOUMsQ0FBQyxNQUFNLElBQUksQ0FBQyxDQUFDLEtBQUssS0FBSyxTQUFTLEVBQUU7TUFDOUIsSUFBSSxHQUFHLEVBQUUsQ0FBQyxvQ0FBb0MsRUFBRTtRQUFFLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSTtRQUFFLEtBQUssRUFBRTtNQUFNLENBQUMsQ0FBQztJQUNuRixDQUFDLE1BQU0sSUFBSSxDQUFDLENBQUMsS0FBSyxLQUFLLFNBQVMsRUFBRTtNQUM5QjtNQUNBLElBQUksR0FBRyxDQUFDLENBQUMsSUFBSSxLQUFLLE1BQU0sR0FBRyxDQUFDLENBQUMscUNBQXFDLENBQUMsR0FBRyxDQUFDLENBQUMsb0NBQW9DLENBQUM7SUFDakgsQ0FBQyxNQUFNO01BQ0gsSUFBSSxHQUFHLENBQUMsQ0FBQyxtQ0FBbUMsQ0FBQztNQUM3QyxHQUFHLEdBQUcsSUFBSTtJQUNkO0lBQ0EsSUFBSSxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxLQUFLLEtBQUssU0FBUyxJQUFJLENBQUMsQ0FBQyxLQUFLLEtBQUssTUFBTSxFQUFFO01BQ3ZELElBQUksSUFBSSxLQUFLLEdBQUcsUUFBUSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7SUFDcEM7SUFDQSxPQUFPO01BQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxHQUFHLElBQUksR0FBRyxJQUFJO01BQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLElBQUksRUFBRTtNQUFFLEdBQUcsRUFBRTtJQUFJLENBQUM7RUFDdEc7RUFFQSxTQUFTLGNBQWMsQ0FBQyxRQUFRLEVBQUU7SUFDOUIsSUFBSSxRQUFRLENBQUMsV0FBVyxFQUFFO01BQUUsT0FBTyxDQUFDLENBQUMseUNBQXlDLENBQUM7SUFBRTtJQUNqRixJQUFJLFFBQVEsQ0FBQyxZQUFZLEVBQUU7TUFBRSxPQUFPLENBQUMsQ0FBQywwQ0FBMEMsQ0FBQztJQUFFO0lBQ25GLElBQUksSUFBSSxHQUFHLFFBQVEsQ0FBQyxlQUFlLElBQUksRUFBRTtJQUN6QyxJQUFJLElBQUksS0FBSywyQkFBMkIsRUFBRTtNQUFFLE9BQU8sQ0FBQyxDQUFDLDRDQUE0QyxDQUFDO0lBQUU7SUFDcEcsSUFBSSxJQUFJLEtBQUsscUJBQXFCLElBQUksSUFBSSxLQUFLLHNCQUFzQixJQUFJLElBQUksS0FBSyw2QkFBNkIsSUFDeEcsSUFBSSxLQUFLLHFCQUFxQixJQUFJLElBQUksS0FBSyxtQkFBbUIsSUFBSSxJQUFJLEtBQUssaUJBQWlCLEVBQUU7TUFDakcsT0FBTyxDQUFDLENBQUMscUNBQXFDLENBQUM7SUFDbkQ7SUFDQSxPQUFPLFFBQVEsQ0FBQyxJQUFJLENBQUM7RUFDekI7RUFFQSxTQUFTLFNBQVMsQ0FBQyxFQUFFLEVBQUU7SUFDbkIsS0FBSyxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUMsVUFBVSxLQUFLLEVBQUUsR0FBRyxJQUFJLEdBQUcsRUFBRTtJQUN0RCxhQUFhLENBQUMsQ0FBQztFQUNuQjs7RUFFQTs7RUFFQSxTQUFTLFdBQVcsR0FBRztJQUNuQixJQUFJLE1BQU0sR0FBRyxDQUFDLENBQUMsbUJBQW1CLENBQUM7SUFDbkMsSUFBSSxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQU0sS0FBSyxDQUFDLElBQUksS0FBSyxDQUFDLEtBQUssSUFBSSxVQUFVLEVBQUU7TUFDM0QsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO01BQzNCO0lBQ0o7SUFDQSxNQUFNLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQztJQUMzQixDQUFDLENBQUMsdUJBQXVCLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLGlDQUFpQyxFQUFFO01BQ2xFLElBQUksRUFBRSxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUM7TUFDdEIsRUFBRSxFQUFFLEtBQUssQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxNQUFNO01BQ3pDLEtBQUssRUFBRSxLQUFLLENBQUM7SUFDakIsQ0FBQyxDQUFDLENBQUM7SUFDSCxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLEtBQUssQ0FBQyxNQUFNLElBQUksQ0FBQyxDQUFDO0lBQ3pELENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDLE1BQU0sR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQU0sSUFBSSxLQUFLLENBQUMsS0FBSyxDQUFDO0VBQ2hHOztFQUVBOztFQUVBO0VBQ0EsU0FBUyxjQUFjLENBQUMsYUFBYSxFQUFFLE9BQU8sRUFBRTtJQUM1QyxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxJQUFJLEVBQUUsQ0FBQztFQUMzRTtFQUVBLFNBQVMsZUFBZSxDQUFDLGFBQWEsRUFBRTtJQUNwQyxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO0VBQ25FO0VBRUEsU0FBUyxrQkFBa0IsQ0FBQyxPQUFPLEVBQUU7SUFDakMsY0FBYyxDQUFDLHFCQUFxQixFQUFFLE9BQU8sQ0FBQztFQUNsRDtFQUVBLFNBQVMsbUJBQW1CLEdBQUc7SUFDM0IsZUFBZSxDQUFDLHFCQUFxQixDQUFDO0VBQzFDO0VBRUEsU0FBUyxhQUFhLEdBQUc7SUFDckIsSUFBSSxHQUFHLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDN0QsSUFBSSxJQUFJLEdBQUcsT0FBTyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxRQUFRLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNyRCxJQUFJLElBQUksR0FBRyxDQUFDLElBQUksSUFBSSxHQUFHLEdBQUcsRUFBRTtNQUN4QixrQkFBa0IsQ0FBQyxFQUFFLENBQUMsNkNBQTZDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztNQUN6RTtJQUNKO0lBQ0EsbUJBQW1CLENBQUMsQ0FBQztJQUNyQixRQUFRLENBQUMsV0FBVyxFQUFFO01BQUUscUJBQXFCLEVBQUU7SUFBSyxDQUFDLEVBQUUsWUFBWTtNQUMvRCxLQUFLLENBQUMsU0FBUyxHQUFHLElBQUk7TUFDdEIsU0FBUyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO0lBQ3BELENBQUMsRUFBRSxZQUFZO01BQ1gsa0JBQWtCLENBQUMsRUFBRSxDQUFDLHNDQUFzQyxFQUFFO1FBQzFELElBQUksRUFBRSxDQUFDLENBQUMsdUNBQXVDLENBQUM7UUFDaEQsSUFBSSxFQUFFO01BQ1YsQ0FBQyxDQUFDLENBQUM7TUFDSCxDQUFDLENBQUMscUJBQXFCLENBQUMsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQztJQUNqRCxDQUFDLENBQUM7RUFDTjtFQUVBLFNBQVMsU0FBUyxDQUFDLE9BQU8sRUFBRTtJQUN4QjtJQUNBLElBQUksUUFBUSxHQUFHLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxXQUFXLENBQUM7SUFDckQsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLFFBQVEsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7TUFDdEMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ25EO0lBQ0EsSUFBSSxLQUFLLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7SUFDekMsS0FBSyxDQUFDLFNBQVMsR0FBRyxVQUFVO0lBQzVCLEtBQUssQ0FBQyxZQUFZLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQztJQUNwQyxLQUFLLENBQUMsV0FBVyxHQUFHLE9BQU87SUFDM0IsUUFBUSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDO0lBQ2hDLFVBQVUsQ0FBQyxZQUFZO01BQ25CLElBQUksS0FBSyxDQUFDLFVBQVUsRUFBRTtRQUNsQixLQUFLLENBQUMsVUFBVSxDQUFDLFdBQVcsQ0FBQyxLQUFLLENBQUM7TUFDdkM7SUFDSixDQUFDLEVBQUUsSUFBSSxDQUFDO0VBQ1o7O0VBRUE7O0VBRUEsU0FBUyxPQUFPLENBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRTtJQUMxRCxJQUFJLE9BQU8sR0FBRztNQUNWLEdBQUcsRUFBRSxNQUFNLENBQUMsTUFBTSxHQUFHLFFBQVEsR0FBRyxJQUFJO01BQ3BDLE1BQU0sRUFBRSxNQUFNO01BQ2QsUUFBUSxFQUFFLE1BQU07TUFDaEIsS0FBSyxFQUFFO0lBQ1gsQ0FBQztJQUNELElBQUksT0FBTyxLQUFLLElBQUksSUFBSSxPQUFPLEtBQUssU0FBUyxFQUFFO01BQzNDLE9BQU8sQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUM7TUFDdEMsT0FBTyxDQUFDLFdBQVcsR0FBRyxrQkFBa0I7SUFDNUM7SUFDQSxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLFFBQVEsRUFBRTtNQUNyQyxJQUFJLFFBQVEsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLElBQUksRUFBRTtRQUN0QyxTQUFTLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQztNQUM1QixDQUFDLE1BQU07UUFDSCxTQUFTLENBQUMsZ0JBQWdCLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO01BQzlDO0lBQ0osQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsR0FBRyxFQUFFO01BQ25CLFNBQVMsQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsWUFBWSxJQUFJLElBQUksRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDckUsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLE9BQU8sQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUU7SUFDbEQsT0FBTyxDQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUUsT0FBTyxJQUFJLENBQUMsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLENBQUM7RUFDOUQ7RUFFQSxTQUFTLFNBQVMsQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRTtJQUMzQyxPQUFPLENBQUMsUUFBUSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLFNBQVMsQ0FBQztFQUN2RDtFQUVBLFNBQVMsT0FBTyxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRTtJQUNqRCxDQUFDLENBQUMsSUFBSSxDQUFDO01BQ0gsR0FBRyxFQUFFLE1BQU0sQ0FBQyxNQUFNLEdBQUcsaUJBQWlCLEdBQUcsSUFBSTtNQUM3QyxNQUFNLEVBQUUsS0FBSztNQUNiLElBQUksRUFBRSxNQUFNLElBQUksQ0FBQyxDQUFDO01BQ2xCLEtBQUssRUFBRTtJQUNYLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLFFBQVEsRUFBRTtNQUN4QixJQUFJLFFBQVEsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLElBQUksRUFBRTtRQUN0QyxTQUFTLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQztNQUM1QixDQUFDLE1BQU07UUFDSCxTQUFTLENBQUMsZ0JBQWdCLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO01BQzlDO0lBQ0osQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsR0FBRyxFQUFFO01BQ25CLFNBQVMsQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsWUFBWSxJQUFJLElBQUksRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDckUsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLFdBQVcsQ0FBQyxPQUFPLEVBQUU7SUFDMUIsSUFBSSxPQUFPLElBQUksT0FBTyxDQUFDLEtBQUssRUFBRTtNQUMxQixPQUFPLE9BQU8sQ0FBQyxRQUFRLENBQUMsTUFBTSxHQUFHLENBQUMsR0FBRyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxLQUFLO0lBQzVFO0lBQ0EsT0FBUSxPQUFPLElBQUksT0FBTyxDQUFDLEtBQUssR0FBSSxPQUFPLENBQUMsS0FBSyxHQUFHLFlBQVk7RUFDcEU7O0VBRUE7O0VBRUEsU0FBUyxPQUFPLENBQUMsRUFBRSxFQUFFO0lBQ2pCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtNQUN4QyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLLE1BQU0sQ0FBQyxFQUFFLENBQUMsRUFBRTtRQUN6QyxPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO01BQ3hCO0lBQ0o7SUFDQSxPQUFPLElBQUk7RUFDZjtFQUVBLFNBQVMsVUFBVSxDQUFDLEdBQUcsRUFBRTtJQUNyQixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7TUFDeEMsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsS0FBSyxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFO1FBQzdDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRztRQUNuQjtNQUNKO0lBQ0o7SUFDQSxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUM7RUFDeEI7RUFFQSxTQUFTLFFBQVEsQ0FBQyxNQUFNLEVBQUU7SUFDdEIsSUFBSSxDQUFDLE1BQU0sRUFBRTtNQUNULEtBQUssQ0FBQyxVQUFVLEdBQUcsS0FBSztNQUN4QixrQkFBa0IsQ0FBQyxDQUFDO0lBQ3hCO0lBQ0EsTUFBTSxDQUFDLE9BQU8sRUFBRTtNQUFFLEtBQUssRUFBRTtJQUFJLENBQUMsRUFBRSxVQUFVLElBQUksRUFBRTtNQUM1QyxLQUFLLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLElBQUksRUFBRTtNQUM3QixLQUFLLENBQUMsVUFBVSxHQUFHLElBQUk7TUFDdkIsS0FBSyxDQUFDLFNBQVMsR0FBRyxJQUFJO01BQ3RCLFVBQVUsQ0FBQyxDQUFDO01BQ1osV0FBVyxDQUFDLENBQUM7TUFDYixtQkFBbUIsQ0FBQyxDQUFDO0lBQ3pCLENBQUMsRUFBRSxVQUFVLE9BQU8sRUFBRTtNQUNsQixLQUFLLENBQUMsVUFBVSxHQUFHLElBQUk7TUFDdkIsS0FBSyxDQUFDLFNBQVMsR0FBRyxPQUFPO01BQ3pCLFVBQVUsQ0FBQyxDQUFDO01BQ1osV0FBVyxDQUFDLENBQUM7SUFDakIsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLGtCQUFrQixHQUFHO0lBQzFCLElBQUksSUFBSSxHQUFHLHlIQUF5SCxHQUM5SCxnSEFBZ0gsR0FDaEgsd0VBQXdFO0lBQzlFLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQztFQUNuQzs7RUFFQTtFQUNBLFNBQVMsY0FBYyxHQUFHO0lBQ3RCLE9BQU8sa0NBQWtDLEdBQ25DLGtHQUFrRyxHQUNsRyxvRkFBb0YsR0FDcEYsNkZBQTZGLEdBQzdGLGlGQUFpRixHQUNqRixRQUFRO0VBQ2xCO0VBRUEsU0FBUyxVQUFVLEdBQUc7SUFDbEIsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDLFVBQVUsQ0FBQztJQUN6QixJQUFJLEtBQUssQ0FBQyxTQUFTLEtBQUssSUFBSSxJQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtNQUNyRCxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUM7TUFDckMsS0FBSyxDQUFDLElBQUksQ0FBQyxnREFBZ0QsR0FBRyxVQUFVLEdBQ2xFLHVCQUF1QixHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMscUNBQXFDLENBQUMsQ0FBQyxHQUFHLFFBQVEsR0FDbEYsaUZBQWlGLEdBQ2pGLEdBQUcsQ0FBQyxDQUFDLENBQUMsa0NBQWtDLENBQUMsQ0FBQyxHQUFHLGlCQUFpQixDQUFDO01BQ3JFLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsWUFBWTtRQUFFLFFBQVEsQ0FBQyxDQUFDO01BQUUsQ0FBQyxDQUFDO01BQzVEO0lBQ0o7SUFDQSxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRTtNQUNuQjtJQUNKO0lBQ0EsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxHQUFHLElBQUksR0FBRyxJQUFJLENBQUM7SUFDcEUsSUFBSSxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUU7TUFDekIsS0FBSyxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDO01BQzVCO0lBQ0o7SUFDQSxJQUFJLElBQUksR0FBRywyQkFBMkI7SUFDdEMsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO01BQ3hDLElBQUksSUFBSSxhQUFhLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN4QztJQUNBLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxHQUFHLFFBQVEsQ0FBQztFQUMvQjtFQUVBLFNBQVMsYUFBYSxDQUFDLEdBQUcsRUFBRTtJQUN4QixJQUFJLFFBQVEsR0FBRyxLQUFLLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsS0FBSyxJQUFJO0lBQ2xELElBQUksSUFBSSxHQUFHLEVBQUU7SUFDYixJQUFJLFFBQVEsRUFBRTtNQUNWLElBQUksR0FBRywyQkFBMkIsR0FBRyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsR0FBRyxjQUFjLENBQUMsR0FBRyxDQUFDLEdBQUcsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLEdBQUcsUUFBUTtJQUMxSDtJQUNBLElBQUksU0FBUyxHQUFHLENBQUMsR0FBRyxDQUFDLEtBQUssSUFBSSxFQUFFLEVBQUUsTUFBTTtJQUN4QyxJQUFJLElBQUksR0FBRyxFQUFFO0lBQ2IsSUFBSSxHQUFHLENBQUMsWUFBWSxFQUFFO01BQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDLFlBQVksQ0FBQztJQUFFO0lBQzNELElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUMsb0NBQW9DLEVBQUU7TUFBRSxLQUFLLEVBQUU7SUFBVSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsbUNBQW1DLENBQUMsQ0FBQztJQUNsSSxPQUFPLHdCQUF3QixJQUFJLFFBQVEsR0FBRyxVQUFVLEdBQUcsRUFBRSxDQUFDLEdBQUcsaUJBQWlCLEdBQUcsR0FBRyxDQUFDLEVBQUUsR0FBRyxJQUFJLEdBQzVGLDBGQUEwRixJQUFJLFFBQVEsR0FBRyxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsSUFBSSxHQUNqSSw0QkFBNEIsSUFBSSxHQUFHLENBQUMsT0FBTyxLQUFLLEtBQUssR0FBRyxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsdUJBQXVCLElBQUksR0FBRyxDQUFDLE9BQU8sS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLFNBQVMsR0FDcEosb0RBQW9ELEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxNQUFNLEdBQzlFLG9DQUFvQyxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsZUFBZSxHQUM5RSw4QkFBOEIsR0FBRyxhQUFhLENBQUMsR0FBRyxDQUFDLEdBQUcsU0FBUyxHQUMvRCw4Q0FBOEMsR0FDOUMsZ0VBQWdFLElBQUksUUFBUSxHQUFHLEtBQUssR0FBRyxHQUFHLENBQUMsR0FBRyw4Q0FBOEMsR0FDNUksZUFBZSxHQUFHLElBQUksR0FBRyxRQUFRO0VBQzNDO0VBRUEsU0FBUyxhQUFhLENBQUMsR0FBRyxFQUFFO0lBQ3hCLElBQUksR0FBRyxDQUFDLE9BQU8sS0FBSyxLQUFLLEVBQUU7TUFDdkIsT0FBTyx1QkFBdUIsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHdDQUF3QyxDQUFDLENBQUMsR0FBRyxTQUFTO0lBQ2pHO0lBQ0EsSUFBSSxHQUFHLENBQUMsTUFBTSxLQUFLLElBQUksRUFBRTtNQUNyQixPQUFPLDZCQUE2QixHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsa0NBQWtDLENBQUMsQ0FBQyxHQUFHLFNBQVM7SUFDakc7SUFDQSxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssZUFBZSxFQUFFO01BQ2hDLE9BQU8sNkJBQTZCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyw0Q0FBNEMsQ0FBQyxDQUFDLEdBQUcsU0FBUztJQUMzRztJQUNBLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxVQUFVLEVBQUU7TUFDM0IsT0FBTyw2QkFBNkIsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLENBQUMsR0FBRyxTQUFTO0lBQ3RHO0lBQ0EsSUFBSSxHQUFHLENBQUMsTUFBTSxLQUFLLE9BQU8sRUFBRTtNQUN4QixPQUFPLGdDQUFnQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsMkNBQTJDLENBQUMsQ0FBQyxHQUFHLFNBQVM7SUFDN0c7SUFDQSxPQUFPLHVCQUF1QixHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsbUNBQW1DLENBQUMsQ0FBQyxHQUFHLFNBQVM7RUFDNUY7O0VBRUE7RUFDQTtFQUNBLFNBQVMsbUJBQW1CLENBQUMsR0FBRyxFQUFFO0lBQzlCLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxVQUFVLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxFQUFFO01BQ2pFLE9BQU8sRUFBRTtJQUNiO0lBQ0EsT0FBTyw4Q0FBOEMsR0FDL0MsOEhBQThILEdBQzlILE9BQU8sR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLENBQUMsR0FBRyxJQUFJLEdBQ2hFLEdBQUcsQ0FBQyxDQUFDLENBQUMscUNBQXFDLENBQUMsQ0FBQyxHQUFHLGNBQWM7RUFDeEU7RUFFQSxTQUFTLGFBQWEsQ0FBQyxJQUFJLEVBQUU7SUFDekIsSUFBSSxJQUFJLEtBQUssU0FBUyxFQUFFO01BQUUsT0FBTyxDQUFDLENBQUMsc0NBQXNDLENBQUM7SUFBRTtJQUM1RSxJQUFJLElBQUksS0FBSyxTQUFTLEVBQUU7TUFBRSxPQUFPLENBQUMsQ0FBQyxzQ0FBc0MsQ0FBQztJQUFFO0lBQzVFLE9BQU8sQ0FBQyxDQUFDLG9DQUFvQyxDQUFDO0VBQ2xEO0VBRUEsU0FBUyxjQUFjLENBQUMsR0FBRyxFQUFFO0lBQ3pCLElBQUksS0FBSyxHQUFHLEdBQUcsQ0FBQyxLQUFLLElBQUksRUFBRTtJQUMzQixJQUFJLEtBQUssQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO01BQ3BCLE9BQU8sdUNBQXVDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDLEdBQUcsUUFBUTtJQUM5RztJQUNBLElBQUksSUFBSSxHQUFHLDRCQUE0QjtJQUN2QyxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtNQUNuQyxJQUFJLElBQUksYUFBYSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDeEM7SUFDQSxPQUFPLElBQUksR0FBRyxRQUFRO0VBQzFCO0VBRUEsU0FBUyxhQUFhLENBQUMsR0FBRyxFQUFFLElBQUksRUFBRTtJQUM5QixJQUFJLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxLQUFLLE1BQU07SUFDaEMsSUFBSSxTQUFTO0lBQ2IsSUFBSSxJQUFJLEVBQUU7TUFDTixTQUFTLEdBQUcsb0NBQW9DLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxJQUFJLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDLEdBQUcsU0FBUztJQUMvSSxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsYUFBYSxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsTUFBTSxLQUFLLFFBQVEsRUFBRTtNQUNyRSxTQUFTLEdBQUcsNkJBQTZCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDLEdBQUcsU0FBUztJQUMxRyxDQUFDLE1BQU07TUFDSCxTQUFTLEdBQUcsNkJBQTZCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFDLEdBQUcsU0FBUztJQUN2RztJQUNBLE9BQU8seUNBQXlDLEdBQUcsSUFBSSxDQUFDLEVBQUUsR0FBRyxJQUFJLEdBQzNELHdEQUF3RCxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxTQUFTLEdBQ3RHLDJCQUEyQixHQUFHLEdBQUcsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEdBQUcsZ0JBQWdCLEdBQ25GLGNBQWMsQ0FBQyxJQUFJLENBQUMsR0FDcEIsOEJBQThCLEdBQUcsU0FBUyxHQUFHLFNBQVMsR0FDdEQsa0NBQWtDLElBQUksSUFBSSxDQUFDLE9BQU8sR0FBRyxVQUFVLEdBQUcsRUFBRSxDQUFDLElBQUksSUFBSSxHQUFHLFdBQVcsR0FBRyxFQUFFLENBQUMsR0FBRyxnQkFBZ0IsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLG9DQUFvQyxDQUFDLENBQUMsR0FBRyxJQUFJLEdBQzFLLHNEQUFzRCxJQUFJLElBQUksQ0FBQyxPQUFPLEdBQUcsVUFBVSxHQUFHLEVBQUUsQ0FBQyxJQUFJLElBQUksR0FBRyxXQUFXLEdBQUcsRUFBRSxDQUFDLEdBQUcsR0FBRyxHQUMzSCx3Q0FBd0MsR0FDeEMsUUFBUTtFQUNsQjtFQUVBLFNBQVMsY0FBYyxDQUFDLElBQUksRUFBRTtJQUMxQixJQUFJLE9BQU8sR0FBRyxvQkFBb0IsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLENBQUMsR0FBRyxXQUFXO0lBQ2hHLElBQUksS0FBSyxHQUFHLEtBQUs7SUFDakIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO01BQzdDLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDO01BQ2pDLElBQUksUUFBUSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLEtBQUssTUFBTSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUM7TUFDbEUsSUFBSSxRQUFRLEVBQUU7UUFBRSxLQUFLLEdBQUcsSUFBSTtNQUFFO01BQzlCLE9BQU8sSUFBSSxpQkFBaUIsR0FBRyxRQUFRLENBQUMsRUFBRSxHQUFHLEdBQUcsSUFBSSxRQUFRLEdBQUcsV0FBVyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxHQUFHLFdBQVc7SUFDOUg7SUFDQSxJQUFJLENBQUMsS0FBSyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxFQUFFO01BQzNDLE9BQU8sSUFBSSxpQkFBaUIsR0FBRyxJQUFJLENBQUMsY0FBYyxHQUFHLGNBQWMsR0FBRyxJQUFJLENBQUMsY0FBYyxHQUFHLFdBQVc7SUFDM0c7SUFDQSxPQUFPLGlEQUFpRCxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsbUNBQW1DLENBQUMsQ0FBQyxHQUFHLElBQUksR0FBRyxPQUFPLEdBQUcsV0FBVztFQUN6STtFQUVBLFNBQVMsZ0JBQWdCLENBQUMsR0FBRyxFQUFFO0lBQzNCLE9BQU8sOEJBQThCLEdBQy9CLG9DQUFvQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsd0NBQXdDLENBQUMsQ0FBQyxHQUFHLE1BQU0sR0FDaEcsaUNBQWlDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDLEdBQUcsTUFBTSxHQUMxRixpQ0FBaUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLENBQUMsR0FBRyxNQUFNLEdBQzFGLFFBQVE7RUFDbEI7O0VBRUE7O0VBRUEsU0FBUyxpQkFBaUIsR0FBRztJQUN6QixJQUFJLEtBQUssR0FBRyxDQUFDLENBQUMsVUFBVSxDQUFDO0lBQ3pCLEtBQUssQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLHdCQUF3QixFQUFFLFlBQVk7TUFDcEQsSUFBSSxFQUFFLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO01BQzlELEtBQUssQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUMsS0FBSyxJQUFJO01BQ3hELFVBQVUsQ0FBQyxDQUFDO0lBQ2hCLENBQUMsQ0FBQztJQUNGLEtBQUssQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLHdCQUF3QixFQUFFLFVBQVUsS0FBSyxFQUFFO01BQzNELElBQUksS0FBSyxDQUFDLEdBQUcsS0FBSyxPQUFPLElBQUksS0FBSyxDQUFDLEdBQUcsS0FBSyxHQUFHLEVBQUU7UUFDNUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBQ3RCLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDO01BQzVCO0lBQ0osQ0FBQyxDQUFDO0lBQ0YsS0FBSyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUseUJBQXlCLEVBQUUsWUFBWTtNQUFFLFlBQVksQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7SUFBRSxDQUFDLENBQUM7SUFDakgsS0FBSyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUseUJBQXlCLEVBQUUsVUFBVSxLQUFLLEVBQUU7TUFDMUQsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDO01BQ3RCLGFBQWEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztJQUN6RSxDQUFDLENBQUM7SUFDRixLQUFLLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSxVQUFVLEtBQUssRUFBRTtNQUN2RCxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUM7TUFDdEIsYUFBYSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQztJQUMvRSxDQUFDLENBQUM7SUFDRixLQUFLLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSxVQUFVLEtBQUssRUFBRTtNQUN2RCxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUM7TUFDdEIsWUFBWSxDQUFDLE1BQU0sRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztJQUNoRixDQUFDLENBQUM7SUFDRixLQUFLLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxpQkFBaUIsRUFBRSxZQUFZO01BQzlDLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQztNQUN6RCxJQUFJLE1BQU0sR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7TUFDNUQsSUFBSSxPQUFPLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7TUFDckMsUUFBUSxDQUFDLEtBQUssRUFBRTtRQUFFLEtBQUssRUFBRSxDQUFDO1VBQUUsRUFBRSxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUM7VUFBRSxPQUFPLEVBQUU7UUFBUSxDQUFDO01BQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxZQUFZO1FBQ3JGLFFBQVEsQ0FBQyxJQUFJLENBQUM7UUFDZCxTQUFTLENBQUMsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7TUFDekQsQ0FBQyxDQUFDO0lBQ04sQ0FBQyxDQUFDO0lBQ0YsS0FBSyxDQUFDLEVBQUUsQ0FBQyxRQUFRLEVBQUUscUJBQXFCLEVBQUUsWUFBWTtNQUNsRCxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUM7TUFDekQsSUFBSSxNQUFNLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO01BQzVELFFBQVEsQ0FBQyxLQUFLLEVBQUU7UUFBRSxLQUFLLEVBQUUsQ0FBQztVQUFFLEVBQUUsRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDO1VBQUUsY0FBYyxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7UUFBRSxDQUFDO01BQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxZQUFZO1FBQzFHLFFBQVEsQ0FBQyxJQUFJLENBQUM7UUFDZCxTQUFTLENBQUMsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7TUFDekQsQ0FBQyxDQUFDO0lBQ04sQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLFFBQVEsQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUU7SUFDcEQsUUFBUSxDQUFDLFFBQVEsR0FBRyxLQUFLLEVBQUUsT0FBTyxFQUFFLFVBQVUsR0FBRyxFQUFFO01BQy9DLFVBQVUsQ0FBQyxHQUFHLENBQUM7TUFDZixVQUFVLENBQUMsQ0FBQztNQUNaLElBQUksU0FBUyxFQUFFO1FBQUUsU0FBUyxDQUFDLEdBQUcsQ0FBQztNQUFFO0lBQ3JDLENBQUMsRUFBRSxTQUFTLElBQUksVUFBVSxPQUFPLEVBQUU7TUFDL0IsU0FBUyxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNuQyxDQUFDLENBQUM7RUFDTjs7RUFFQTs7RUFFQSxTQUFTLGFBQWEsQ0FBQyxJQUFJLEVBQUU7SUFDekIsSUFBSSxLQUFLLENBQUMsZUFBZSxFQUFFO01BQ3ZCLElBQUksQ0FBQyxDQUFDO01BQ047SUFDSjtJQUNBLE9BQU8sQ0FBQyxhQUFhLEVBQUU7TUFBRSxLQUFLLEVBQUU7SUFBSSxDQUFDLEVBQUUsVUFBVSxJQUFJLEVBQUU7TUFDbkQsSUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssSUFBSSxFQUFFO01BQzVCLElBQUksSUFBSSxHQUFHLENBQUMsQ0FBQztNQUNiLElBQUksSUFBSSxHQUFHLEVBQUU7TUFDYixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtRQUNuQyxJQUFJLElBQUksR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDO1FBQ25CLElBQUksTUFBTSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDO1FBQ2hDLElBQUksQ0FBQyxNQUFNLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFO1VBQ3pCO1FBQ0o7UUFDQSxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsSUFBSTtRQUNuQixJQUFJLElBQUksR0FBRyxJQUFJLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQyxNQUFNLElBQUssR0FBRyxHQUFHLE1BQU87UUFDekQsSUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEVBQUU7UUFDbkQsSUFBSSxLQUFLLEdBQUksTUFBTSxLQUFLLEVBQUUsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFJLElBQUksR0FBRyxJQUFJLEdBQUcsTUFBTSxHQUFHLEdBQUcsR0FBRyxJQUFJO1FBQ3RHLElBQUksQ0FBQyxJQUFJLENBQUM7VUFBRSxFQUFFLEVBQUUsTUFBTTtVQUFFLEtBQUssRUFBRTtRQUFNLENBQUMsQ0FBQztNQUMzQztNQUNBLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQyxFQUFFO1FBQUUsT0FBTyxDQUFDLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDO01BQUUsQ0FBQyxDQUFDO01BQ3JFLEtBQUssQ0FBQyxTQUFTLEdBQUcsSUFBSTtNQUN0QixLQUFLLENBQUMsZUFBZSxHQUFHLElBQUk7TUFDNUIsS0FBSyxDQUFDLGVBQWUsR0FBRyxLQUFLO01BQzdCLElBQUksQ0FBQyxDQUFDO0lBQ1YsQ0FBQyxFQUFFLFlBQVk7TUFDWCxLQUFLLENBQUMsZUFBZSxHQUFHLEtBQUs7TUFDN0IsS0FBSyxDQUFDLGVBQWUsR0FBRyxJQUFJO01BQzVCLElBQUksQ0FBQyxDQUFDO0lBQ1YsQ0FBQyxDQUFDO0VBQ047O0VBRUE7O0VBRUE7RUFDQTtFQUNBLElBQUksZ0JBQWdCLEdBQUcsQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDO0VBRTFDLFNBQVMsWUFBWSxDQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsT0FBTyxFQUFFO0lBQ3RDLEtBQUssQ0FBQyxRQUFRLEdBQUc7TUFDYixJQUFJLEVBQUUsSUFBSTtNQUNWLEdBQUcsRUFBRSxHQUFHO01BQ1IsT0FBTyxFQUFFLElBQUksS0FBSyxNQUFNLElBQUksR0FBRyxHQUFJLEdBQUcsQ0FBQyxPQUFPLElBQUksVUFBVSxHQUFLLE9BQU8sS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHLFVBQVc7TUFDeEcsT0FBTyxFQUFFLENBQUM7TUFDVixLQUFLLEVBQUUsS0FBSztNQUNaLFlBQVksRUFBRSxLQUFLO01BQ25CLElBQUksRUFBRTtJQUNWLENBQUM7SUFDRCxDQUFDLENBQUMsdUJBQXVCLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUNsQyxDQUFDLENBQUMscUJBQXFCLENBQUMsQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDO0lBQzdDLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUM7SUFDM0MsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksS0FBSyxNQUFNLEdBQUcsRUFBRSxDQUFDLG1DQUFtQyxFQUFFO01BQUUsS0FBSyxFQUFFLEdBQUcsQ0FBQztJQUFNLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO0lBQ3RKLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQyxLQUFLLEdBQUcsRUFBRSxDQUFDO0lBQzVDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO0lBQzFCLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7SUFDOUIsQ0FBQyxDQUFDLHVCQUF1QixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUM7SUFDL0MsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLEtBQUssTUFBTSxHQUFHLElBQUksR0FBRyxJQUFJLENBQUM7SUFDakUsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLEtBQUssTUFBTSxHQUFHLENBQUMsQ0FBQyw4QkFBOEIsQ0FBQyxHQUFHLENBQUMsQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFDO0lBQ3pILElBQUksSUFBSSxLQUFLLE1BQU0sRUFBRTtNQUNqQixDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQztNQUMzQyxDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO01BQ2hELENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLElBQUksR0FBRyxDQUFDLFVBQVUsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUNqRSxDQUFDLE1BQU07TUFDSCxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO01BQzNDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO0lBQ3BEO0lBQ0EsY0FBYyxDQUFDLENBQUM7SUFDaEIsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLEtBQUssQ0FBQztNQUFFLFFBQVEsRUFBRTtJQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUM7SUFDM0QsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUM7RUFDdkM7RUFFQSxTQUFTLGNBQWMsR0FBRztJQUN0QixJQUFJLEtBQUssR0FBRyxLQUFLLENBQUMsUUFBUTtJQUMxQixJQUFJLENBQUMsS0FBSyxFQUFFO01BQUU7SUFBUTtJQUN0QixDQUFDLENBQUMsZ0NBQWdDLENBQUMsQ0FBQyxJQUFJLENBQUMsWUFBWTtNQUNqRCxJQUFJLE9BQU8sR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztNQUM3QyxJQUFJLFFBQVEsR0FBRyxPQUFPLEtBQUssS0FBSyxDQUFDLE9BQU87TUFDeEMsSUFBSSxNQUFNLEdBQUcsS0FBSyxDQUFDLElBQUksS0FBSyxNQUFNLElBQUksQ0FBQyxRQUFRO01BQy9DLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxXQUFXLENBQUMsYUFBYSxFQUFFLFFBQVEsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDLENBQzFFLElBQUksQ0FBQyxlQUFlLEVBQUUsTUFBTSxHQUFHLE1BQU0sR0FBRyxJQUFJLENBQUM7TUFDbEQsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFFBQVEsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDO0lBQzVFLENBQUMsQ0FBQztJQUNGLElBQUksT0FBTyxHQUFHLGdCQUFnQixDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQztJQUMxRCxDQUFDLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsT0FBTyxDQUFDLENBQUMsV0FBVyxDQUFDLFVBQVUsRUFBRSxDQUFDLE9BQU8sQ0FBQztJQUM3RjtJQUNBLElBQUksT0FBTyxHQUFHLEtBQUssQ0FBQyxPQUFPLEtBQUssS0FBSztJQUNyQyxDQUFDLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxHQUFHLENBQUMsQ0FBQyxzQ0FBc0MsQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUN0RixDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLE9BQU8sR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFDO0VBQ3JFO0VBRUEsU0FBUyxZQUFZLENBQUMsSUFBSSxFQUFFO0lBQ3hCLE9BQU8sTUFBTSxDQUFDLElBQUksSUFBSSxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQztFQUN2RDtFQUVBLFNBQVMsWUFBWSxHQUFHO0lBQ3BCLE9BQU8sQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQztFQUN2RztFQUVBLFNBQVMsYUFBYSxHQUFHO0lBQ3JCLE9BQU87TUFDSCxLQUFLLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO01BQ3BELEtBQUssRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7TUFDcEQsUUFBUSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQztJQUM5RCxDQUFDO0VBQ0w7RUFFQSxTQUFTLGNBQWMsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFO0lBQ2hDLElBQUksR0FBRyxHQUFHLElBQUksS0FBSyxJQUFJLEdBQUcscUJBQXFCLEdBQUksSUFBSSxLQUFLLE1BQU0sR0FBRyxvQkFBb0IsR0FBRyxxQkFBc0I7SUFDbEgsSUFBSSxJQUFJLEdBQUcsSUFBSSxLQUFLLElBQUksR0FDbEIsc0VBQXNFLEdBQ3RFLGdFQUFnRTtJQUN0RSxDQUFDLENBQUMsdUJBQXVCLENBQUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxHQUFHLEdBQUcsR0FBRyxrQkFBa0IsR0FDbkUsMkRBQTJELEdBQUcsSUFBSSxHQUFHLFFBQVEsR0FDN0UsT0FBTyxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsR0FBRyxjQUFjLENBQUM7RUFDL0M7RUFFQSxTQUFTLGVBQWUsQ0FBQyxHQUFHLEVBQUU7SUFDMUIsSUFBSSxHQUFHLENBQUMsTUFBTSxLQUFLLElBQUksRUFBRTtNQUNyQixPQUFPO1FBQUUsSUFBSSxFQUFFLElBQUk7UUFBRSxJQUFJLEVBQUUsRUFBRSxDQUFDLG1DQUFtQyxFQUFFO1VBQy9ELFFBQVEsRUFBRSxHQUFHLENBQUMsWUFBWSxJQUFJLEdBQUcsQ0FBQyxlQUFlO1VBQ2pELElBQUksRUFBRSxHQUFHLENBQUMsWUFBWSxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsWUFBWSxHQUFHLEdBQUcsQ0FBQztRQUMxRCxDQUFDO01BQUUsQ0FBQztJQUNSO0lBQ0EsSUFBSSxHQUFHLENBQUMsZUFBZSxLQUFLLFdBQVcsRUFBRTtNQUNyQyxPQUFPO1FBQUUsSUFBSSxFQUFFLE1BQU07UUFBRSxJQUFJLEVBQUUsRUFBRSxDQUFDLHNDQUFzQyxFQUFFO1VBQ3BFLFFBQVEsRUFBRSxHQUFHLENBQUMsWUFBWSxJQUFJLEVBQUU7VUFDaEMsR0FBRyxFQUFFLEdBQUcsQ0FBQztRQUNiLENBQUM7TUFBRSxDQUFDO0lBQ1I7SUFDQSxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssZUFBZSxFQUFFO01BQ2hDLE9BQU87UUFBRSxJQUFJLEVBQUUsS0FBSztRQUFFLElBQUksRUFBRSxDQUFDLENBQUMsb0NBQW9DO01BQUUsQ0FBQztJQUN6RTtJQUNBLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxVQUFVLElBQUksWUFBWSxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsRUFBRTtNQUNoRSxPQUFPO1FBQUUsSUFBSSxFQUFFLEtBQUs7UUFBRSxJQUFJLEVBQUUsWUFBWSxDQUFDO01BQUUsQ0FBQztJQUNoRDtJQUNBLE9BQU87TUFBRSxJQUFJLEVBQUUsTUFBTTtNQUFFLElBQUksRUFBRSxDQUFDLENBQUMsc0NBQXNDLENBQUMsSUFBSSxHQUFHLENBQUMsZUFBZSxHQUFHLElBQUksR0FBRyxHQUFHLENBQUMsZUFBZSxHQUFHLEdBQUcsR0FBRyxFQUFFO0lBQUUsQ0FBQztFQUM1STtFQUVBLFNBQVMsWUFBWSxHQUFHO0lBQ3BCLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUSxJQUFJLGdCQUFnQixDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRTtNQUN6RTtJQUNKO0lBQ0EsSUFBSSxNQUFNLEdBQUcsYUFBYSxDQUFDLENBQUM7SUFDNUIsSUFBSSxNQUFNLENBQUMsS0FBSyxLQUFLLEVBQUUsRUFBRTtNQUNyQixDQUFDLENBQUMscUJBQXFCLENBQUMsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDO01BQzFDLGNBQWMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7TUFDakU7SUFDSjtJQUNBLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUM7SUFDN0MsSUFBSSxJQUFJLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJO0lBQzlCLElBQUksT0FBTztJQUNYLElBQUksSUFBSSxHQUFHLFNBQVAsSUFBSSxDQUFhLEdBQUcsRUFBRTtNQUN0QixLQUFLLENBQUMsUUFBUSxDQUFDLEdBQUcsR0FBRyxHQUFHO01BQ3hCLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxHQUFHLEdBQUcsQ0FBQyxFQUFFO01BQy9CLFVBQVUsQ0FBQyxHQUFHLENBQUM7TUFDZixJQUFJLE9BQU8sR0FBRyxlQUFlLENBQUMsR0FBRyxDQUFDO01BQ2xDLGNBQWMsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxJQUFJLENBQUM7SUFDOUMsQ0FBQztJQUNELElBQUksT0FBTyxHQUFHLFNBQVYsT0FBTyxDQUFhLEdBQUcsRUFBRTtNQUN6QixJQUFJLEdBQUcsQ0FBQyxLQUFLLEtBQUssT0FBTyxFQUFFO1FBQ3ZCLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUM7TUFDNUM7TUFDQSxjQUFjLENBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUMzQyxDQUFDO0lBQ0QsSUFBSSxJQUFJLEtBQUssS0FBSyxFQUFFO01BQ2hCLE9BQU8sR0FBRztRQUFFLE9BQU8sRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLE9BQU87UUFBRSxLQUFLLEVBQUUsTUFBTSxDQUFDLEtBQUs7UUFBRSxLQUFLLEVBQUUsTUFBTSxDQUFDO01BQU0sQ0FBQztNQUN2RixJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxHQUFHLENBQUMsRUFBRTtRQUM1QixRQUFRLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFO1VBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQyxLQUFLO1VBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQztRQUFNLENBQUMsRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDO01BQzVHLENBQUMsTUFBTTtRQUNILE9BQU8sQ0FBQyxPQUFPLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxPQUFPLENBQUM7TUFDNUM7TUFDQTtJQUNKO0lBQ0EsSUFBSSxNQUFNLENBQUMsUUFBUSxLQUFLLEVBQUUsRUFBRTtNQUN4QixPQUFPLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsR0FBRyxhQUFhLEVBQUU7UUFBRSxLQUFLLEVBQUUsTUFBTSxDQUFDO01BQVMsQ0FBQyxFQUFFLFVBQVUsSUFBSSxFQUFFO1FBQ2xHLElBQUksSUFBSSxDQUFDLEVBQUUsRUFBRTtVQUNULGNBQWMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLG1DQUFtQyxFQUFFO1lBQ3pELFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUTtZQUN2QixJQUFJLEVBQUUsSUFBSSxDQUFDO1VBQ2YsQ0FBQyxDQUFDLENBQUM7UUFDUCxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsVUFBVSxLQUFLLFdBQVcsRUFBRTtVQUN4QyxjQUFjLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQyxzQ0FBc0MsRUFBRTtZQUM5RCxRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVEsSUFBSSxFQUFFO1lBQzdCLEdBQUcsRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQztVQUM1QixDQUFDLENBQUMsQ0FBQztRQUNQLENBQUMsTUFBTSxJQUFJLElBQUksQ0FBQyxVQUFVLEtBQUssMkJBQTJCLElBQUksSUFBSSxDQUFDLFVBQVUsS0FBSyxzQkFBc0IsRUFBRTtVQUN0RyxjQUFjLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFDO1FBQ2xFLENBQUMsTUFBTSxJQUFJLFlBQVksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUU7VUFDdEMsY0FBYyxDQUFDLEtBQUssRUFBRSxZQUFZLENBQUMsQ0FBQyxDQUFDO1FBQ3pDLENBQUMsTUFBTTtVQUNILGNBQWMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDLHNDQUFzQyxDQUFDLEdBQUcsSUFBSSxHQUFHLElBQUksQ0FBQyxVQUFVLEdBQUcsR0FBRyxDQUFDO1FBQ3BHO01BQ0osQ0FBQyxFQUFFLE9BQU8sQ0FBQztNQUNYO0lBQ0o7SUFDQSxPQUFPLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsR0FBRyxhQUFhLEVBQUUsQ0FBQyxDQUFDLEVBQUUsVUFBVSxJQUFJLEVBQUU7TUFDMUUsUUFBUSxDQUFDLElBQUksQ0FBQztNQUNkLElBQUksSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUNULGNBQWMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLG1DQUFtQyxFQUFFO1VBQ3pELFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUTtVQUN2QixJQUFJLEVBQUUsSUFBSSxDQUFDO1FBQ2YsQ0FBQyxDQUFDLENBQUM7TUFDUCxDQUFDLE1BQU0sSUFBSSxZQUFZLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxFQUFFO1FBQ3RDLGNBQWMsQ0FBQyxLQUFLLEVBQUUsWUFBWSxDQUFDLENBQUMsQ0FBQztNQUN6QyxDQUFDLE1BQU07UUFDSCxjQUFjLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFDO01BQ2xFO0lBQ0osQ0FBQyxFQUFFLE9BQU8sQ0FBQztFQUNmO0VBRUEsU0FBUyxXQUFXLEdBQUc7SUFDbkIsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLElBQUksZ0JBQWdCLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFO01BQ3pFO0lBQ0o7SUFDQSxJQUFJLE1BQU0sR0FBRyxhQUFhLENBQUMsQ0FBQztJQUM1QixJQUFJLE1BQU0sQ0FBQyxLQUFLLEtBQUssRUFBRSxFQUFFO01BQ3JCLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUM7TUFDMUMsY0FBYyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsdUNBQXVDLENBQUMsQ0FBQztNQUNqRTtJQUNKO0lBQ0EsSUFBSSxJQUFJLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJO0lBQzlCLElBQUksTUFBTSxHQUFHLFNBQVQsTUFBTSxDQUFhLEdBQUcsRUFBRTtNQUN4QixLQUFLLENBQUMsUUFBUSxDQUFDLEtBQUssR0FBRyxJQUFJO01BQzNCLFVBQVUsQ0FBQyxHQUFHLENBQUM7TUFDZixDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztNQUNoQyxRQUFRLENBQUMsSUFBSSxDQUFDO01BQ2QsSUFBSSxJQUFJLEtBQUssS0FBSyxFQUFFO1FBQ2hCLGFBQWEsQ0FBQyxHQUFHLENBQUM7TUFDdEIsQ0FBQyxNQUFNO1FBQ0gsU0FBUyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO01BQ3BEO0lBQ0osQ0FBQztJQUNELElBQUksT0FBTyxHQUFHLFNBQVYsT0FBTyxDQUFhLEdBQUcsRUFBRTtNQUN6QixJQUFJLEdBQUcsQ0FBQyxLQUFLLEtBQUssT0FBTyxFQUFFO1FBQ3ZCLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUM7TUFDNUM7TUFDQSxjQUFjLENBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUMzQyxDQUFDO0lBQ0QsSUFBSSxJQUFJLEtBQUssS0FBSyxFQUFFO01BQ2hCLElBQUksTUFBTSxHQUFHLFNBQVQsTUFBTSxDQUFhLEVBQUUsRUFBRTtRQUN2QixPQUFPLENBQUMsUUFBUSxHQUFHLEVBQUUsR0FBRyxnQkFBZ0IsRUFBRSxDQUFDLENBQUMsRUFBRSxVQUFVLEdBQUcsRUFBRTtVQUN6RCxNQUFNLENBQUMsR0FBRyxDQUFDO1FBQ2YsQ0FBQyxFQUFFLE9BQU8sQ0FBQztNQUNmLENBQUM7TUFDRCxJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxHQUFHLENBQUMsRUFBRTtRQUM1QixRQUFRLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFO1VBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQyxLQUFLO1VBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQztRQUFNLENBQUMsRUFBRSxVQUFVLEdBQUcsRUFBRTtVQUNyRyxVQUFVLENBQUMsR0FBRyxDQUFDO1VBQ2YsTUFBTSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDbEIsQ0FBQyxFQUFFLE9BQU8sQ0FBQztNQUNmLENBQUMsTUFBTTtRQUNILE9BQU8sQ0FBQyxPQUFPLEVBQUU7VUFBRSxPQUFPLEVBQUUsS0FBSyxDQUFDLFFBQVEsQ0FBQyxPQUFPO1VBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQyxLQUFLO1VBQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQztRQUFNLENBQUMsRUFBRSxVQUFVLEdBQUcsRUFBRTtVQUMzRyxVQUFVLENBQUMsR0FBRyxDQUFDO1VBQ2YsTUFBTSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDbEIsQ0FBQyxFQUFFLE9BQU8sQ0FBQztNQUNmO01BQ0E7SUFDSjtJQUNBLElBQUksT0FBTyxHQUFHO01BQUUsS0FBSyxFQUFFLE1BQU0sQ0FBQztJQUFNLENBQUM7SUFDckMsSUFBSSxNQUFNLENBQUMsUUFBUSxLQUFLLEVBQUUsRUFBRTtNQUN4QixPQUFPLENBQUMsS0FBSyxHQUFHLE1BQU0sQ0FBQyxRQUFRO0lBQ25DO0lBQ0EsUUFBUSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUM7RUFDeEU7RUFFQSxTQUFTLGNBQWMsR0FBRztJQUN0QixJQUFJLEtBQUssR0FBRyxLQUFLLENBQUMsUUFBUTtJQUMxQixLQUFLLENBQUMsUUFBUSxHQUFHLElBQUk7SUFDckIsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUM7SUFDaEMsSUFBSSxLQUFLLElBQUksS0FBSyxDQUFDLE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFO01BQzVDO01BQ0EsU0FBUyxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUMsT0FBTyxFQUFFLFlBQVk7UUFBRSxRQUFRLENBQUMsSUFBSSxDQUFDO01BQUUsQ0FBQyxFQUFFLFlBQVk7UUFBRSxRQUFRLENBQUMsSUFBSSxDQUFDO01BQUUsQ0FBQyxDQUFDO0lBQ3pHLENBQUMsTUFBTTtNQUNILFFBQVEsQ0FBQyxJQUFJLENBQUM7SUFDbEI7RUFDSjtFQUVBLFNBQVMsZ0JBQWdCLEdBQUc7SUFDeEIsSUFBSSxHQUFHLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQyxHQUFHO0lBQzVCLElBQUksQ0FBQyxHQUFHLEVBQUU7TUFBRTtJQUFRO0lBQ3BCLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsdUNBQXVDLEVBQUU7TUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDLEtBQUs7TUFBRSxLQUFLLEVBQUUsQ0FBQyxHQUFHLENBQUMsS0FBSyxJQUFJLEVBQUUsRUFBRTtJQUFPLENBQUMsQ0FBQyxDQUFDO0lBQzlILENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLEtBQUssQ0FBQztNQUFFLFFBQVEsRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUM7SUFDOUQsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsWUFBWTtNQUNyRCxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDO01BQ3BDLFNBQVMsQ0FBQyxRQUFRLEdBQUcsR0FBRyxDQUFDLEVBQUUsRUFBRSxZQUFZO1FBQ3JDLEtBQUssQ0FBQyxRQUFRLENBQUMsS0FBSyxHQUFHLElBQUk7UUFDM0IsS0FBSyxDQUFDLFFBQVEsQ0FBQyxPQUFPLEdBQUcsQ0FBQztRQUMxQixDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztRQUNoQyxRQUFRLENBQUMsSUFBSSxDQUFDO1FBQ2QsU0FBUyxDQUFDLENBQUMsQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFDO01BQ3RELENBQUMsRUFBRSxVQUFVLEdBQUcsRUFBRTtRQUNkLFNBQVMsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUM7TUFDL0IsQ0FBQyxDQUFDO0lBQ04sQ0FBQyxDQUFDO0VBQ047O0VBRUE7O0VBRUEsU0FBUyxhQUFhLENBQUMsR0FBRyxFQUFFO0lBQ3hCLElBQUksQ0FBQyxHQUFHLEVBQUU7TUFBRTtJQUFRO0lBQ3BCLEtBQUssQ0FBQyxTQUFTLEdBQUc7TUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUU7TUFBRSxHQUFHLEVBQUUsR0FBRztNQUFFLEtBQUssRUFBRSxJQUFJO01BQUUsUUFBUSxFQUFFLENBQUM7SUFBRSxDQUFDO0lBQ3hFLENBQUMsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsdUNBQXVDLEVBQUU7TUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDO0lBQU0sQ0FBQyxDQUFDLENBQUM7SUFDakcsSUFBSSxLQUFLLEdBQUcsR0FBRyxDQUFDLE9BQU8sS0FBSyxLQUFLO0lBQ2pDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsS0FBSyxHQUFHLDBDQUEwQyxHQUFHLHVDQUF1QyxFQUFFO01BQ3RILEdBQUcsRUFBRSxHQUFHLENBQUMsWUFBWSxHQUFHLEdBQUcsR0FBRyxHQUFHLENBQUMsWUFBWSxHQUFHLEdBQUcsQ0FBQztJQUN6RCxDQUFDLENBQUMsQ0FBQztJQUNILENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQzNCLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQzNCLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO0lBQ3hDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO0lBQ3hDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO0lBQ3ZDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLElBQUksQ0FBQztJQUN6QyxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLDJDQUEyQyxDQUFDLENBQUM7SUFDOUUsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztJQUNoQyxDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQztJQUM5QyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxLQUFLLENBQUM7TUFBRSxRQUFRLEVBQUU7SUFBTSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDO0lBQzVELGNBQWMsQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLEtBQUssQ0FBQztFQUNqQztFQUVBLFNBQVMsY0FBYyxDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUU7SUFDcEMsT0FBTyxDQUFDLFFBQVEsR0FBRyxLQUFLLEdBQUcsZ0JBQWdCLEVBQUU7TUFBRSxPQUFPLEVBQUUsT0FBTyxLQUFLO0lBQUssQ0FBQyxFQUFFLFVBQVUsR0FBRyxFQUFFO01BQ3ZGLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxFQUFFO1FBQUU7TUFBUTtNQUNoQyxLQUFLLENBQUMsU0FBUyxDQUFDLFFBQVEsR0FBRyxDQUFDLENBQUM7TUFDN0IsZUFBZSxDQUFDLEdBQUcsQ0FBQztNQUNwQixnQkFBZ0IsQ0FBQyxDQUFDO0lBQ3RCLENBQUMsRUFBRSxVQUFVLEdBQUcsRUFBRTtNQUNkLGFBQWEsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDbkMsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLGdCQUFnQixHQUFHO0lBQ3hCLFlBQVksQ0FBQyxDQUFDO0lBQ2QsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEdBQUcsV0FBVyxDQUFDLFlBQVk7TUFDNUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUU7UUFBRTtNQUFRO01BQ2hDLE1BQU0sQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDLEVBQUUsVUFBVSxHQUFHLEVBQUU7UUFDeEQsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUU7VUFBRTtRQUFRO1FBQ2hDLGVBQWUsQ0FBQyxHQUFHLENBQUM7UUFDcEIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFO1VBQ3ZCLFlBQVksQ0FBQyxDQUFDO1FBQ2xCO01BQ0osQ0FBQyxFQUFFLFlBQVksQ0FBRSwwQkFBMkIsQ0FBQztJQUNqRCxDQUFDLEVBQUUsSUFBSSxDQUFDO0VBQ1o7RUFFQSxTQUFTLFlBQVksR0FBRztJQUNwQixJQUFJLEtBQUssQ0FBQyxTQUFTLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEtBQUssSUFBSSxFQUFFO01BQ25ELGFBQWEsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQztNQUNwQyxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssR0FBRyxJQUFJO0lBQ2hDO0VBQ0o7RUFFQSxTQUFTLGVBQWUsQ0FBQyxHQUFHLEVBQUU7SUFDMUIsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLEVBQUU7TUFBRTtJQUFRO0lBQ2hDLEtBQUssQ0FBQyxTQUFTLENBQUMsR0FBRyxHQUFHLEdBQUc7SUFDekIsVUFBVSxDQUFDLEdBQUcsQ0FBQztJQUNmLElBQUksU0FBUyxHQUFHLEdBQUcsQ0FBQyxTQUFTLElBQUk7TUFBRSxNQUFNLEVBQUUsS0FBSztNQUFFLE1BQU0sRUFBRSxNQUFNO01BQUUsS0FBSyxFQUFFO0lBQUcsQ0FBQztJQUM3RSxJQUFJLEtBQUssR0FBRyxTQUFTLENBQUMsS0FBSyxJQUFJLEVBQUU7SUFDakMsSUFBSSxhQUFhLEdBQUcsQ0FBQztJQUNyQixJQUFJLElBQUksR0FBRyxFQUFFO0lBQ2IsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7TUFDbkMsSUFBSSxJQUFJLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQztNQUNuQixJQUFJLEtBQUssR0FBRyxrQkFBa0IsQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQztNQUNqRCxJQUFJLENBQUMsSUFBSSxDQUFDLGlCQUFpQixJQUFJLEtBQUssQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSyxLQUFLLEVBQUU7UUFDN0UsS0FBSyxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLElBQUk7TUFDakQ7TUFDQSxJQUFJLE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsSUFBSSxLQUFLLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssSUFBSTtNQUN4RixJQUFJLE9BQU8sRUFBRTtRQUFFLGFBQWEsRUFBRTtNQUFFO01BQ2hDLElBQUksSUFBSSw0QkFBNEIsSUFBSSxJQUFJLENBQUMsaUJBQWlCLEdBQUcsZUFBZSxHQUFHLEVBQUUsQ0FBQyxHQUFHLG1CQUFtQixJQUFJLEtBQUssR0FBRyxLQUFLLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxHQUFHLG1CQUFtQixHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsSUFBSSxHQUNoTCwwQkFBMEIsSUFBSSxPQUFPLEdBQUcsVUFBVSxHQUFHLEVBQUUsQ0FBQyxJQUFJLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxXQUFXLEdBQUcsRUFBRSxDQUFDLEdBQUcsSUFBSSxHQUM3RyxzREFBc0QsSUFBSSxPQUFPLEdBQUcsVUFBVSxHQUFHLEVBQUUsQ0FBQyxJQUFJLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxXQUFXLEdBQUcsRUFBRSxDQUFDLEdBQUcsR0FBRyxHQUN4SSxxQ0FBcUMsR0FDckMsc0RBQXNELEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLE1BQU0sR0FDakcsd0JBQXdCLEdBQUcsR0FBRyxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsR0FBRyxnQkFBZ0IsR0FDaEYsa0JBQWtCLElBQUksSUFBSSxDQUFDLGlCQUFpQixHQUFHLE9BQU8sR0FBRyxZQUFZLENBQUMsR0FBRyxJQUFJLEdBQzdFLEdBQUcsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsQ0FBQyxDQUFDLHdDQUF3QyxDQUFDLEdBQUcsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLENBQUMsR0FBRyxpQkFBaUI7SUFDbEo7SUFDQSxDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO0lBQzlCLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLHNDQUFzQyxFQUFFO01BQUUsS0FBSyxFQUFFO0lBQWMsQ0FBQyxDQUFDLENBQUM7SUFDN0YsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsYUFBYSxLQUFLLENBQUMsR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFDO0lBRXRFLElBQUksVUFBVSxHQUFHLEVBQUU7SUFDbkIsSUFBSSxTQUFTLEdBQUcsRUFBRTtJQUNsQixJQUFJLFFBQVEsR0FBRyxDQUFDO0lBQ2hCLElBQUksU0FBUyxDQUFDLE1BQU0sRUFBRTtNQUNsQixJQUFJLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1FBQ2xCLFVBQVUsR0FBRyxFQUFFLENBQUMsdUNBQXVDLEVBQUU7VUFBRSxLQUFLLEVBQUUsS0FBSyxDQUFDO1FBQU8sQ0FBQyxDQUFDO01BQ3JGLENBQUMsTUFBTTtRQUNILFVBQVUsR0FBRyxDQUFDLENBQUMsMkNBQTJDLENBQUM7TUFDL0Q7TUFDQSxTQUFTLEdBQUcsRUFBRSxDQUFDLDJDQUEyQyxFQUFFO1FBQUUsSUFBSSxFQUFFLFlBQVksQ0FBQyxTQUFTLENBQUMsYUFBYTtNQUFFLENBQUMsQ0FBQztNQUM1RyxRQUFRLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsR0FBRyxTQUFTLENBQUMsYUFBYSxJQUFJLEdBQUcsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDO01BQzlGLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO01BQ3hDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO01BQzNCLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO01BQ3hDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO0lBQzNDLENBQUMsTUFBTTtNQUNILENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQztNQUN2QyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO01BQ3hDLElBQUksU0FBUyxDQUFDLE1BQU0sS0FBSyxPQUFPLEVBQUU7UUFDOUIsSUFBSSxJQUFJLEdBQUcsTUFBTSxDQUFDLFNBQVMsQ0FBQyxlQUFlLElBQUksRUFBRSxDQUFDO1FBQ2xELElBQUksSUFBSTtRQUNSLElBQUksSUFBSSxLQUFLLDBCQUEwQixFQUFFO1VBQ3JDLElBQUksR0FBRyxDQUFDLENBQUMsOENBQThDLENBQUM7UUFDNUQsQ0FBQyxNQUFNLElBQUksSUFBSSxLQUFLLHFCQUFxQixFQUFFO1VBQ3ZDLElBQUksR0FBRyxDQUFDLENBQUMsaURBQWlELENBQUM7UUFDL0QsQ0FBQyxNQUFNLElBQUksWUFBWSxDQUFDLElBQUksQ0FBQyxFQUFFO1VBQzNCLElBQUksR0FBRyxZQUFZLENBQUMsQ0FBQztRQUN6QixDQUFDLE1BQU0sSUFBSSxJQUFJLEtBQUssc0JBQXNCLElBQUksSUFBSSxLQUFLLDJCQUEyQixFQUFFO1VBQ2hGLElBQUksR0FBRyxDQUFDLENBQUMsb0NBQW9DLENBQUM7UUFDbEQsQ0FBQyxNQUFNO1VBQ0gsSUFBSSxHQUFHLENBQUMsQ0FBQyx1Q0FBdUMsQ0FBQyxHQUFHLElBQUksR0FBRyxJQUFJLEdBQUcsR0FBRztRQUN6RTtRQUNBLGFBQWEsQ0FBQyxJQUFJLENBQUM7UUFDbkIsVUFBVSxHQUFHLEVBQUU7TUFDbkIsQ0FBQyxNQUFNLElBQUksU0FBUyxDQUFDLE1BQU0sS0FBSyxPQUFPLEVBQUU7UUFDckMsVUFBVSxHQUFHLEVBQUU7UUFDZixDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO01BQzVDLENBQUMsTUFBTSxJQUFJLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1FBQ3pCLFVBQVUsR0FBRyxFQUFFLENBQUMseUNBQXlDLEVBQUU7VUFBRSxLQUFLLEVBQUUsS0FBSyxDQUFDO1FBQU8sQ0FBQyxDQUFDO01BQ3ZGLENBQUMsTUFBTTtRQUNILFVBQVUsR0FBRyxDQUFDLENBQUMsMkNBQTJDLENBQUM7TUFDL0Q7TUFDQSxTQUFTLEdBQUcsRUFBRTtNQUNkLFFBQVEsR0FBRyxHQUFHO0lBQ2xCO0lBQ0EsQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQztJQUMxQyxDQUFDLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO0lBQ3ZDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsUUFBUSxHQUFHLEdBQUcsQ0FBQztFQUM1RDtFQUVBLFNBQVMsa0JBQWtCLENBQUMsR0FBRyxFQUFFLE1BQU0sRUFBRTtJQUNyQyxJQUFJLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxJQUFJLEVBQUU7SUFDM0IsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7TUFDbkMsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRTtRQUM3QyxPQUFPLEtBQUssQ0FBQyxDQUFDLENBQUM7TUFDbkI7SUFDSjtJQUNBLE9BQU8sSUFBSTtFQUNmO0VBRUEsU0FBUyxhQUFhLENBQUMsSUFBSSxFQUFFO0lBQ3pCLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxnREFBZ0QsR0FDbkUsK0hBQStILEdBQy9ILE9BQU8sR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsY0FBYyxDQUFDO0VBQy9DO0VBRUEsU0FBUyxhQUFhLEdBQUc7SUFDckIsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxpQkFBaUIsRUFBRSxZQUFZO01BQzVELElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxFQUFFO1FBQUU7TUFBUTtNQUNoQyxJQUFJLEdBQUcsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7TUFDbkUsS0FBSyxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7TUFDdkQsZUFBZSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDO0lBQ3hDLENBQUMsQ0FBQztFQUNOO0VBRUEsU0FBUyxpQkFBaUIsR0FBRztJQUN6QixJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRTtNQUFFO0lBQVE7SUFDaEMsSUFBSSxHQUFHLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxHQUFHO0lBQzdCLElBQUksT0FBTyxHQUFHLEVBQUU7SUFDaEIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxLQUFLLElBQUksRUFBRSxFQUFFLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtNQUN6RCxJQUFJLElBQUksR0FBRyxHQUFHLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7TUFDakMsSUFBSSxJQUFJLENBQUMsaUJBQWlCLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLElBQUksRUFBRTtRQUMzRTtNQUNKO01BQ0EsSUFBSSxJQUFJLEdBQUcsa0JBQWtCLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUM7TUFDaEQsSUFBSSxJQUFJLEVBQUU7UUFDTixPQUFPLENBQUMsSUFBSSxDQUFDO1VBQUUsRUFBRSxFQUFFLElBQUksQ0FBQyxFQUFFO1VBQUUsT0FBTyxFQUFFLElBQUk7VUFBRSxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVM7VUFBRSxLQUFLLEVBQUUsSUFBSSxDQUFDO1FBQU0sQ0FBQyxDQUFDO01BQzlGO0lBQ0o7SUFDQSxJQUFJLE9BQU8sQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO01BQ3RCO0lBQ0o7SUFDQSxRQUFRLENBQUMsUUFBUSxHQUFHLEdBQUcsQ0FBQyxFQUFFLEVBQUU7TUFBRSxLQUFLLEVBQUU7SUFBUSxDQUFDLEVBQUUsVUFBVSxLQUFLLEVBQUU7TUFDN0QsT0FBTyxDQUFDLFFBQVEsR0FBRyxHQUFHLENBQUMsRUFBRSxHQUFHLGdCQUFnQixFQUFFO1FBQUUsSUFBSSxFQUFFO01BQUssQ0FBQyxFQUFFLFlBQVk7UUFDdEUsY0FBYyxDQUFDLENBQUM7UUFDaEIsVUFBVSxDQUFDLEtBQUssQ0FBQztRQUNqQixRQUFRLENBQUMsSUFBSSxDQUFDO1FBQ2QsU0FBUyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO01BQ3BELENBQUMsRUFBRSxZQUFZO1FBQ1gsY0FBYyxDQUFDLENBQUM7UUFDaEIsUUFBUSxDQUFDLElBQUksQ0FBQztRQUNkLFNBQVMsQ0FBQyxDQUFDLENBQUMsa0NBQWtDLENBQUMsQ0FBQztNQUNwRCxDQUFDLENBQUM7SUFDTixDQUFDLEVBQUUsVUFBVSxHQUFHLEVBQUU7TUFDZCxhQUFhLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ25DLENBQUMsQ0FBQztFQUNOO0VBRUEsU0FBUyxjQUFjLEdBQUc7SUFDdEIsWUFBWSxDQUFDLENBQUM7SUFDZCxLQUFLLENBQUMsU0FBUyxHQUFHLElBQUk7SUFDdEIsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztFQUNyQztFQUVBLFNBQVMscUJBQXFCLEdBQUc7SUFDN0IsSUFBSSxHQUFHLEdBQUcsS0FBSyxDQUFDLFNBQVMsR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDLEdBQUcsR0FBRyxJQUFJO0lBQ3RELElBQUksR0FBRyxFQUFFO01BQ0wsT0FBTyxDQUFDLFFBQVEsR0FBRyxHQUFHLENBQUMsRUFBRSxHQUFHLGdCQUFnQixFQUFFO1FBQUUsSUFBSSxFQUFFO01BQUssQ0FBQyxFQUFFLFlBQVk7UUFDdEUsY0FBYyxDQUFDLENBQUM7UUFDaEIsUUFBUSxDQUFDLElBQUksQ0FBQztNQUNsQixDQUFDLEVBQUUsWUFBWTtRQUNYLGNBQWMsQ0FBQyxDQUFDO1FBQ2hCLFFBQVEsQ0FBQyxJQUFJLENBQUM7TUFDbEIsQ0FBQyxDQUFDO0lBQ04sQ0FBQyxNQUFNO01BQ0gsY0FBYyxDQUFDLENBQUM7SUFDcEI7RUFDSjs7RUFFQTs7RUFFQSxTQUFTLGFBQWEsQ0FBQyxHQUFHLEVBQUUsT0FBTyxFQUFFO0lBQ2pDLElBQUksQ0FBQyxHQUFHLEVBQUU7TUFBRTtJQUFRO0lBQ3BCLEtBQUssQ0FBQyxTQUFTLEdBQUc7TUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUU7TUFBRSxHQUFHLEVBQUUsR0FBRztNQUFFLE9BQU8sRUFBRSxDQUFDO01BQUUsT0FBTyxFQUFFLE9BQU87TUFBRSxLQUFLLEVBQUUsSUFBSTtNQUFFLEtBQUssRUFBRTtJQUFFLENBQUM7SUFDbEcsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLElBQUksQ0FBQyx3QkFBd0IsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDLENBQUMsR0FBRyxRQUFRLENBQUM7SUFDekcsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztJQUM5QixDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxLQUFLLENBQUM7TUFBRSxRQUFRLEVBQUUsSUFBSTtNQUFFLE1BQU0sRUFBRSxTQUFSLE1BQU0sR0FBYztRQUFFLFlBQVksQ0FBQyxDQUFDO01BQUU7SUFBRSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDO0lBQ3BHLElBQUksT0FBTyxHQUFHLE9BQU8sS0FBSyxJQUFJLEdBQUcsQ0FBQyxDQUFDLEdBQUc7TUFBRSxRQUFRLEVBQUU7SUFBUSxDQUFDO0lBQzNELE9BQU8sQ0FBQyxRQUFRLEdBQUcsR0FBRyxDQUFDLEVBQUUsR0FBRyxXQUFXLEVBQUUsT0FBTyxFQUFFLFVBQVUsSUFBSSxFQUFFO01BQzlELElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxFQUFFO1FBQUU7TUFBUTtNQUNoQyxLQUFLLENBQUMsU0FBUyxDQUFDLE9BQU8sR0FBRyxJQUFJLENBQUMsUUFBUTtNQUN2QyxLQUFLLENBQUMsU0FBUyxDQUFDLEdBQUcsR0FBRyxJQUFJLENBQUMsR0FBRztNQUM5QixVQUFVLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQztNQUNwQixVQUFVLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQztNQUNwQixnQkFBZ0IsQ0FBQyxDQUFDO0lBQ3RCLENBQUMsRUFBRSxVQUFVLEdBQUcsRUFBRTtNQUNkLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsd0NBQXdDLEdBQUcsR0FBRyxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLGNBQWMsQ0FBQztJQUM5RyxDQUFDLENBQUM7RUFDTjtFQUVBLFNBQVMsZ0JBQWdCLEdBQUc7SUFDeEIsWUFBWSxDQUFDLENBQUM7SUFDZCxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssR0FBRyxXQUFXLENBQUMsWUFBWTtNQUM1QyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRTtRQUFFO01BQVE7TUFDaEMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUU7TUFDdkIsTUFBTSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsRUFBRSxVQUFVLEdBQUcsRUFBRTtRQUN4RCxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsRUFBRTtVQUFFO1FBQVE7UUFDaEMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxHQUFHLEdBQUcsR0FBRztRQUN6QixVQUFVLENBQUMsR0FBRyxDQUFDO1FBQ2YsVUFBVSxDQUFDLEdBQUcsQ0FBQztRQUNmLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEdBQUcsRUFBRSxFQUFFO1VBQ2pELFlBQVksQ0FBQyxDQUFDO1FBQ2xCO01BQ0osQ0FBQyxFQUFFLFlBQVk7UUFDWCxJQUFJLEtBQUssQ0FBQyxTQUFTLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxFQUFFO1VBQzlDLFlBQVksQ0FBQyxDQUFDO1FBQ2xCO01BQ0osQ0FBQyxDQUFDO0lBQ04sQ0FBQyxFQUFFLElBQUksQ0FBQztFQUNaO0VBRUEsU0FBUyxZQUFZLEdBQUc7SUFDcEIsSUFBSSxLQUFLLENBQUMsU0FBUyxJQUFJLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxLQUFLLElBQUksRUFBRTtNQUNuRCxhQUFhLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUM7TUFDcEMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEdBQUcsSUFBSTtJQUNoQztFQUNKO0VBRUEsU0FBUyxjQUFjLENBQUMsR0FBRyxFQUFFO0lBQ3pCLElBQUksT0FBTyxHQUFHLEtBQUssQ0FBQyxTQUFTLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxPQUFPLEdBQUcsQ0FBQztJQUMzRCxJQUFJLE1BQU0sR0FBRyxFQUFFO0lBQ2YsSUFBSSxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssSUFBSSxFQUFFO0lBQzNCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO01BQ25DLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhO01BQ3JDLElBQUksUUFBUSxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLEtBQUssTUFBTSxDQUFDLE9BQU8sQ0FBQyxFQUFFO1FBQzNELE1BQU0sQ0FBQyxJQUFJLENBQUM7VUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQztVQUFFLFFBQVEsRUFBRTtRQUFTLENBQUMsQ0FBQztNQUN2RDtJQUNKO0lBQ0EsT0FBTyxNQUFNO0VBQ2pCO0VBRUEsU0FBUyxXQUFXLENBQUMsR0FBRyxFQUFFO0lBQ3RCLElBQUksSUFBSSxHQUFHLGNBQWMsQ0FBQyxHQUFHLENBQUM7SUFDOUIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7TUFDbEMsSUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxNQUFNO01BQ3BDLElBQUksTUFBTSxLQUFLLFNBQVMsSUFBSSxNQUFNLEtBQUssU0FBUyxFQUFFO1FBQzlDLE9BQU8sSUFBSTtNQUNmO0lBQ0o7SUFDQSxPQUFPLEtBQUs7RUFDaEI7RUFFQSxTQUFTLG1CQUFtQixDQUFDLFFBQVEsRUFBRTtJQUNuQyxJQUFJLFFBQVEsQ0FBQyxNQUFNLEtBQUssTUFBTSxFQUFFO01BQUUsT0FBTztRQUFFLEdBQUcsRUFBRSxPQUFPO1FBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxvQ0FBb0M7TUFBRSxDQUFDO0lBQUU7SUFDMUcsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLFNBQVMsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLFNBQVMsRUFBRTtNQUFFLE9BQU87UUFBRSxHQUFHLEVBQUUsRUFBRTtRQUFFLElBQUksRUFBRSxDQUFDLENBQUMsaUNBQWlDO01BQUUsQ0FBQztJQUFFO0lBQ3RJLE9BQU87TUFBRSxHQUFHLEVBQUUsUUFBUTtNQUFFLElBQUksRUFBRSxDQUFDLENBQUMsZ0NBQWdDO0lBQUUsQ0FBQztFQUN2RTtFQUVBLFNBQVMsaUJBQWlCLENBQUMsSUFBSSxFQUFFO0lBQzdCLElBQUksWUFBWSxDQUFDLElBQUksQ0FBQyxFQUFFO01BQUUsT0FBTyxZQUFZLENBQUMsQ0FBQztJQUFFO0lBQ2pELElBQUksSUFBSSxLQUFLLDJCQUEyQixJQUFJLElBQUksS0FBSyxzQkFBc0IsRUFBRTtNQUFFLE9BQU8sQ0FBQyxDQUFDLG9DQUFvQyxDQUFDO0lBQUU7SUFDL0gsSUFBSSxJQUFJLEtBQUsscUJBQXFCLElBQUksSUFBSSxLQUFLLHNCQUFzQixJQUFJLElBQUksS0FBSyw2QkFBNkIsSUFDeEcsSUFBSSxLQUFLLHFCQUFxQixJQUFJLElBQUksS0FBSyxtQkFBbUIsSUFBSSxJQUFJLEtBQUssaUJBQWlCLEVBQUU7TUFDakcsT0FBTyxDQUFDLENBQUMscUNBQXFDLENBQUM7SUFDbkQ7SUFDQSxJQUFJLElBQUksS0FBSyx5QkFBeUIsSUFBSSxJQUFJLEtBQUssb0JBQW9CLEVBQUU7TUFBRSxPQUFPLENBQUMsQ0FBQyx5Q0FBeUMsQ0FBQztJQUFFO0lBQ2hJLElBQUksSUFBSSxLQUFLLE9BQU8sRUFBRTtNQUFFLE9BQU8sQ0FBQyxDQUFDLHFDQUFxQyxDQUFDO0lBQUU7SUFDekUsT0FBTyxJQUFJO0VBQ2Y7RUFFQSxTQUFTLFVBQVUsQ0FBQyxHQUFHLEVBQUU7SUFDckIsSUFBSSxJQUFJLEdBQUcsY0FBYyxDQUFDLEdBQUcsQ0FBQztJQUM5QixJQUFJLE1BQU0sR0FBRztNQUFFLElBQUksRUFBRSxDQUFDO01BQUUsT0FBTyxFQUFFLENBQUM7TUFBRSxNQUFNLEVBQUU7SUFBRSxDQUFDO0lBQy9DLElBQUksSUFBSSxHQUFHLEVBQUU7SUFDYixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtNQUNsQyxJQUFJLElBQUksR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSTtNQUN2QixJQUFJLFFBQVEsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUTtNQUMvQixJQUFJLEtBQUssR0FBRyxtQkFBbUIsQ0FBQyxRQUFRLENBQUM7TUFDekMsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLE1BQU0sRUFBRTtRQUFFLE1BQU0sQ0FBQyxJQUFJLEVBQUU7TUFBRSxDQUFDLE1BQzdDLElBQUksUUFBUSxDQUFDLE1BQU0sS0FBSyxTQUFTLElBQUksUUFBUSxDQUFDLE1BQU0sS0FBSyxTQUFTLEVBQUU7UUFBRSxNQUFNLENBQUMsT0FBTyxFQUFFO01BQUUsQ0FBQyxNQUN6RjtRQUFFLE1BQU0sQ0FBQyxNQUFNLEVBQUU7TUFBRTtNQUN4QixJQUFJLEtBQUssR0FBSSxRQUFRLENBQUMsTUFBTSxLQUFLLFFBQVEsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLFNBQVMsR0FDcEUsNEVBQTRFLEdBQUcsSUFBSSxDQUFDLEVBQUUsR0FBRyxJQUFJLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDLEdBQUcsV0FBVyxHQUN0SixFQUFFO01BQ1IsSUFBSSxJQUFJLDJCQUEyQixHQUM3Qiw0QkFBNEIsSUFBSSxHQUFHLENBQUMsT0FBTyxLQUFLLEtBQUssR0FBRyxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcseUJBQXlCLElBQUksR0FBRyxDQUFDLE9BQU8sS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLFNBQVMsR0FDdEosc0RBQXNELEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLFFBQVEsSUFDbEcsUUFBUSxDQUFDLGVBQWUsR0FBRyxxQ0FBcUMsR0FBRyxHQUFHLENBQUMsaUJBQWlCLENBQUMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxDQUFDLEdBQUcsUUFBUSxHQUFHLEVBQUUsQ0FBQyxHQUNySSxRQUFRLEdBQ1IsNkJBQTZCLEdBQUcsS0FBSyxDQUFDLEdBQUcsR0FBRyxJQUFJLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxTQUFTLEdBQUcsS0FBSyxHQUFHLFFBQVE7SUFDM0c7SUFDQSxJQUFJLElBQUksS0FBSyxFQUFFLEVBQUU7TUFDYixJQUFJLEdBQUcsd0JBQXdCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDLEdBQUcsUUFBUTtJQUMzRjtJQUNBLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO0lBQzdCLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsa0NBQWtDLEVBQUU7TUFDOUQsRUFBRSxFQUFFLE1BQU0sQ0FBQyxJQUFJO01BQ2YsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNO01BQ3JCLE9BQU8sRUFBRSxNQUFNLENBQUM7SUFDcEIsQ0FBQyxDQUFDLENBQUM7SUFDSCxDQUFDLENBQUMsOEJBQThCLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVk7TUFDdEQsSUFBSSxNQUFNLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7TUFDNUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxTQUFTLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxHQUFHLEdBQUcsR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDeEUsQ0FBQyxDQUFDO0VBQ047O0VBRUE7O0VBRUEsU0FBUyxtQkFBbUIsR0FBRztJQUMzQixNQUFNLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQyxFQUFFLFVBQVUsSUFBSSxFQUFFO01BQ3BDLEtBQUssQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLHFCQUFxQjtNQUM1QyxLQUFLLENBQUMsUUFBUSxHQUFHLElBQUk7TUFDckIsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQztNQUN4RCxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLGNBQWMsSUFBSSxFQUFFLENBQUM7TUFDeEQsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxTQUFTLElBQUksRUFBRSxDQUFDO01BQzlDLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLElBQUksRUFBRSxDQUFDO01BQ3hELGVBQWUsQ0FBQyxrQkFBa0IsQ0FBQztNQUNuQyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxrQkFBa0IsS0FBSyxJQUFJLENBQUM7TUFDOUUsQ0FBQyxDQUFDLHdCQUF3QixDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsa0JBQWtCLEtBQUssSUFBSSxDQUFDO01BQzdFLGVBQWUsQ0FBQyxzQkFBc0IsQ0FBQztNQUN2QyxlQUFlLENBQUMsaUJBQWlCLENBQUM7TUFDbEMsbUJBQW1CLENBQUMsQ0FBQztJQUN6QixDQUFDLEVBQUUsVUFBVSxPQUFPLEVBQUU7TUFDbEIsa0JBQWtCLENBQUMsRUFBRSxDQUFDLHNDQUFzQyxFQUFFO1FBQzFELElBQUksRUFBRSxDQUFDLENBQUMsdUNBQXVDLENBQUM7UUFDaEQsSUFBSSxFQUFFLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLG9DQUFvQztNQUN0RixDQUFDLENBQUMsQ0FBQztJQUNQLENBQUMsQ0FBQztFQUNOO0VBRUEsU0FBUyxXQUFXLENBQUMsT0FBTyxFQUFFLGFBQWEsRUFBRSxNQUFNLEVBQUU7SUFDakQsUUFBUSxDQUFDLFdBQVcsRUFBRSxPQUFPLEVBQUUsVUFBVSxJQUFJLEVBQUU7TUFDM0MsS0FBSyxDQUFDLFFBQVEsR0FBRyxJQUFJO01BQ3JCLElBQUksYUFBYSxFQUFFO1FBQUUsZUFBZSxDQUFDLGFBQWEsQ0FBQztNQUFFO01BQ3JELFNBQVMsQ0FBQyxDQUFDLENBQUMsa0NBQWtDLENBQUMsQ0FBQztJQUNwRCxDQUFDLEVBQUUsVUFBVSxPQUFPLEVBQUU7TUFDbEIsSUFBSSxhQUFhLEVBQUU7UUFDZixjQUFjLENBQUMsYUFBYSxFQUFFLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztNQUN2RDtNQUNBLElBQUksTUFBTSxFQUFFO1FBQUUsTUFBTSxDQUFDLENBQUM7TUFBRTtJQUM1QixDQUFDLENBQUM7RUFDTjtFQUVBLFNBQVMsYUFBYSxHQUFHO0lBQ3JCLElBQUksS0FBSyxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2hFLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQyxjQUFjLEdBQUcsRUFBRTtJQUNsRSxJQUFJLEtBQUssS0FBSyxFQUFFLEVBQUU7TUFDZCxXQUFXLENBQUM7UUFBRSxjQUFjLEVBQUU7TUFBRyxDQUFDLEVBQUUsc0JBQXNCLENBQUM7TUFDM0Q7SUFDSjtJQUNBLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUU7TUFDbEMsY0FBYyxDQUFDLHNCQUFzQixFQUFFLENBQUMsQ0FBQywrQ0FBK0MsQ0FBQyxDQUFDO01BQzFGO0lBQ0o7SUFDQSxXQUFXLENBQUM7TUFBRSxjQUFjLEVBQUU7SUFBTSxDQUFDLEVBQUUsc0JBQXNCLEVBQUUsWUFBWTtNQUN2RSxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDO0lBQzNDLENBQUMsQ0FBQztFQUNOO0VBRUEsU0FBUyxTQUFTLEdBQUc7SUFDakIsSUFBSSxLQUFLLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDM0QsSUFBSSxRQUFRLEdBQUcsS0FBSyxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDLFNBQVMsR0FBRyxFQUFFO0lBQzdELElBQUksS0FBSyxLQUFLLEVBQUUsSUFBSSxDQUFDLG9EQUFvRCxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRTtNQUNuRixjQUFjLENBQUMsaUJBQWlCLEVBQUUsQ0FBQyxDQUFDLDJDQUEyQyxDQUFDLENBQUM7TUFDakY7SUFDSjtJQUNBLFdBQVcsQ0FBQztNQUFFLFNBQVMsRUFBRTtJQUFNLENBQUMsRUFBRSxpQkFBaUIsRUFBRSxZQUFZO01BQzdELENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUM7SUFDdEMsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLGVBQWUsR0FBRztJQUN2QixJQUFJLEtBQUssR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM1RCxJQUFJLFFBQVEsR0FBRyxLQUFLLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUMsa0JBQWtCLEdBQUcsRUFBRTtJQUN0RSxJQUFJLEtBQUssS0FBSyxFQUFFLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsS0FBSyxHQUFHLEVBQUU7TUFDekMsY0FBYyxDQUFDLGtCQUFrQixFQUFFLENBQUMsQ0FBQyw0Q0FBNEMsQ0FBQyxDQUFDO01BQ25GO0lBQ0o7SUFDQSxXQUFXLENBQUM7TUFBRSxrQkFBa0IsRUFBRTtJQUFNLENBQUMsRUFBRSxrQkFBa0IsRUFBRSxZQUFZO01BQ3ZFLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUM7SUFDdkMsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLGVBQWUsR0FBRztJQUN2QixJQUFJLE9BQU8sR0FBRyxDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO0lBQ3pELFdBQVcsQ0FBQztNQUFFLGtCQUFrQixFQUFFO0lBQVEsQ0FBQyxFQUFFLElBQUksRUFBRSxZQUFZO01BQzNELENBQUMsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQyxPQUFPLENBQUM7TUFDckQsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsV0FBVyxDQUFDLFNBQVMsRUFBRSxDQUFDLE9BQU8sQ0FBQztNQUN0RCxTQUFTLENBQUMsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7SUFDekQsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLFlBQVksQ0FBQyxPQUFPLEVBQUU7SUFDM0IsSUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsUUFBUSxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDbkQsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssR0FBRyxFQUFFLENBQUMsR0FBRyxHQUFHLEdBQUcsR0FBRyxDQUFDLEtBQUssR0FBRyxFQUFFLENBQUM7RUFDekQ7O0VBRUE7O0VBRUEsU0FBUyxTQUFTLENBQUMsTUFBTSxFQUFFO0lBQ3ZCLElBQUksQ0FBQyxNQUFNLEVBQUU7TUFDVCxLQUFLLENBQUMsV0FBVyxHQUFHLEtBQUs7TUFDekIsbUJBQW1CLENBQUMsQ0FBQztJQUN6QjtJQUNBLE1BQU0sQ0FBQyxRQUFRLEVBQUU7TUFBRSxLQUFLLEVBQUU7SUFBSSxDQUFDLEVBQUUsVUFBVSxJQUFJLEVBQUU7TUFDN0MsS0FBSyxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxJQUFJLEVBQUU7TUFDOUIsS0FBSyxDQUFDLFdBQVcsR0FBRyxJQUFJO01BQ3hCLEtBQUssQ0FBQyxVQUFVLEdBQUcsSUFBSTtNQUN2QixXQUFXLENBQUMsQ0FBQztJQUNqQixDQUFDLEVBQUUsVUFBVSxPQUFPLEVBQUU7TUFDbEIsS0FBSyxDQUFDLFdBQVcsR0FBRyxJQUFJO01BQ3hCLEtBQUssQ0FBQyxVQUFVLEdBQUcsT0FBTztNQUMxQixXQUFXLENBQUMsQ0FBQztJQUNqQixDQUFDLENBQUM7RUFDTjtFQUVBLFNBQVMsbUJBQW1CLEdBQUc7SUFDM0IsSUFBSSxHQUFHLEdBQUcsMkdBQTJHLEdBQy9HLGlGQUFpRjtJQUN2RixDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQztFQUN2QztFQUVBLFNBQVMsYUFBYSxDQUFDLElBQUksRUFBRTtJQUN6QixJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUU7TUFDaEIsSUFBSSxJQUFJLEdBQUcsVUFBVSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7TUFDckMsSUFBSSxJQUFJLEVBQUU7UUFBRSxPQUFPLElBQUk7TUFBRTtJQUM3QjtJQUNBLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtNQUMzQyxJQUFJLEtBQUssR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsSUFBSSxFQUFFO01BQzlDLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO1FBQ25DLElBQUksSUFBSSxDQUFDLFdBQVcsSUFBSSxJQUFJLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFO1VBQ2xFLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7UUFDM0I7TUFDSjtJQUNKO0lBQ0EsT0FBTyxJQUFJO0VBQ2Y7RUFFQSxTQUFTLGlCQUFpQixDQUFDLE9BQU8sRUFBRTtJQUNoQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxPQUFPLEdBQUcsSUFBSSxHQUFHLElBQUksQ0FBQztFQUMzRDs7RUFFQTtFQUNBO0VBQ0EsU0FBUyxXQUFXLEdBQUc7SUFDbkIsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDLGdCQUFnQixDQUFDO0lBQy9CLElBQUksQ0FBQyxLQUFLLENBQUMsV0FBVyxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRTtNQUN6QyxpQkFBaUIsQ0FBQyxLQUFLLENBQUM7TUFDeEI7SUFDSjtJQUNBLElBQUksS0FBSyxDQUFDLFVBQVUsS0FBSyxJQUFJLElBQUksS0FBSyxDQUFDLEtBQUssQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO01BQ3ZELGlCQUFpQixDQUFDLEtBQUssQ0FBQztNQUN4QixLQUFLLENBQUMsSUFBSSxDQUFDLGdEQUFnRCxHQUFHLFVBQVUsR0FDbEUsdUJBQXVCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDLEdBQUcsUUFBUSxHQUNuRixrRkFBa0YsR0FDbEYsR0FBRyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDLEdBQUcsaUJBQWlCLENBQUM7TUFDckUsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxZQUFZO1FBQUUsU0FBUyxDQUFDLENBQUM7TUFBRSxDQUFDLENBQUM7TUFDOUQ7SUFDSjtJQUNBLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLEtBQUssQ0FBQyxJQUFJLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxLQUFLLENBQUMsSUFBSSxLQUFLLENBQUMsU0FBUyxLQUFLLElBQUksRUFBRTtNQUNqRixpQkFBaUIsQ0FBQyxLQUFLLENBQUM7TUFDeEIsS0FBSyxDQUFDLElBQUksQ0FBQyx3Q0FBd0MsR0FDN0Msc0NBQXNDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFDLEdBQUcsT0FBTyxHQUM5RixjQUFjLENBQUMsQ0FBQyxHQUFHLFFBQVEsQ0FBQztNQUNsQztJQUNKO0lBQ0EsSUFBSSxLQUFLLENBQUMsS0FBSyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUU7TUFDMUIsaUJBQWlCLENBQUMsS0FBSyxDQUFDO01BQ3hCLEtBQUssQ0FBQyxJQUFJLENBQUMsbURBQW1ELEdBQ3hELHNDQUFzQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsc0NBQXNDLENBQUMsQ0FBQyxHQUFHLE9BQU8sR0FDakcsb0VBQW9FLEdBQUcsU0FBUyxHQUNoRixHQUFHLENBQUMsQ0FBQyxDQUFDLCtCQUErQixDQUFDLENBQUMsR0FBRyxpQkFBaUIsQ0FBQztNQUNsRTtJQUNKO0lBQ0EsaUJBQWlCLENBQUMsSUFBSSxDQUFDO0lBQ3ZCLElBQUksTUFBTSxHQUFHLENBQUMsQ0FBQztJQUNmLEtBQUssQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFO01BQ2hDLElBQUksS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLElBQUksS0FBSztNQUMvQixJQUFJLFdBQVcsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxFQUFFO1FBQUUsS0FBSyxHQUFHLEtBQUs7TUFBRTtNQUNyRCxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUM7SUFDcEQsQ0FBQyxDQUFDO0lBQ0YsSUFBSSxLQUFLLEdBQUcsV0FBVyxDQUFDLE1BQU0sQ0FBQyxVQUFVLEtBQUssRUFBRTtNQUFFLE9BQU8sT0FBTyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUFFLENBQUMsQ0FBQztJQUNuRixJQUFJLElBQUksR0FBRyxFQUFFO0lBQ2IsSUFBSSxLQUFLLENBQUMsVUFBVSxLQUFLLElBQUksRUFBRTtNQUMzQixJQUFJLElBQUksZ0RBQWdELEdBQUcsVUFBVSxHQUMvRCx1QkFBdUIsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHNDQUFzQyxDQUFDLENBQUMsR0FBRyxRQUFRLEdBQ25GLHlGQUF5RixHQUN6RixHQUFHLENBQUMsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDLENBQUMsR0FBRyxpQkFBaUI7SUFDeEU7SUFDQSxJQUFJLFlBQVksR0FBRyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUM7SUFDbkMsSUFBSSxJQUFJLDJCQUEyQixJQUFJLFlBQVksR0FBRyxFQUFFLEdBQUcsVUFBVSxDQUFDLEdBQUcsZ0JBQWdCO0lBQ3pGLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxLQUFLLEVBQUU7TUFDM0IsSUFBSSxZQUFZLEVBQUU7UUFDZCxJQUFJLElBQUksNkJBQTZCLEdBQUcsR0FBRyxDQUFDLGVBQWUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFHLE9BQU87TUFDakY7TUFDQSxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFO1FBQ2xDLElBQUksSUFBSSxhQUFhLENBQUMsSUFBSSxDQUFDO01BQy9CLENBQUMsQ0FBQztJQUNOLENBQUMsQ0FBQztJQUNGLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxHQUFHLFFBQVEsQ0FBQztJQUMzQixDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVk7TUFBRSxTQUFTLENBQUMsQ0FBQztJQUFFLENBQUMsQ0FBQztFQUN6RTtFQUVBLFNBQVMsV0FBVyxDQUFDLElBQUksRUFBRTtJQUN2QixJQUFJLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxJQUFJLEVBQUU7SUFDNUIsSUFBSSxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxFQUFFO01BQ3RDLE9BQU8sS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU87SUFDM0I7SUFDQSxJQUFJLEdBQUcsR0FBRyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSztJQUMvRSxPQUFPLEdBQUcsSUFBSSxHQUFHLENBQUMsT0FBTyxLQUFLLEtBQUssR0FBRyxLQUFLLEdBQUcsVUFBVTtFQUM1RDs7RUFFQTtFQUNBLFNBQVMsZ0JBQWdCLENBQUMsSUFBSSxFQUFFO0lBQzVCLElBQUksTUFBTSxHQUFHLFVBQVUsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO0lBQ3ZDLElBQUksTUFBTSxJQUFJLE1BQU0sQ0FBQyxZQUFZLElBQUksTUFBTSxDQUFDLFlBQVksS0FBSyxXQUFXLEVBQUU7TUFDdEUsSUFBSSxNQUFNLEdBQUc7UUFDVCxlQUFlLEVBQUUsQ0FBQyxDQUFDLHdDQUF3QyxDQUFDO1FBQzVELGNBQWMsRUFBRSxDQUFDLENBQUMsd0NBQXdDLENBQUM7UUFDM0QsYUFBYSxFQUFFLENBQUMsQ0FBQywwQ0FBMEMsQ0FBQztRQUM1RCxRQUFRLEVBQUUsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDO1FBQ2xELEtBQUssRUFBRSxDQUFDLENBQUMscUNBQXFDO01BQ2xELENBQUM7TUFDRCxJQUFJLE1BQU0sQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLEVBQUU7UUFDN0IsSUFBSSxHQUFHLEdBQUksTUFBTSxDQUFDLFlBQVksS0FBSyxpQkFBaUIsSUFBSSxNQUFNLENBQUMsWUFBWSxLQUFLLFVBQVUsR0FBSSxpQkFBaUIsR0FBRyxjQUFjO1FBQ2hJLE9BQU8sZUFBZSxHQUFHLEdBQUcsR0FBRyxJQUFJLEdBQUcsR0FBRyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUMsR0FBRyxTQUFTO01BQ3RGO0lBQ0o7SUFDQSxJQUFJLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxJQUFJLEVBQUU7SUFDNUIsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLElBQUksRUFBRSxFQUFFLE1BQU0sR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFO01BQzdDLE9BQU8sNkJBQTZCLEdBQUcsVUFBVSxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMseUNBQXlDLENBQUMsQ0FBQyxHQUFHLFNBQVM7SUFDckg7SUFDQSxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtNQUNuQyxJQUFJLEdBQUcsR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQztNQUNsQyxJQUFJLEdBQUcsSUFBSSxHQUFHLENBQUMsT0FBTyxLQUFLLEtBQUssSUFBSSxHQUFHLENBQUMsTUFBTSxLQUFLLGVBQWUsRUFBRTtRQUNoRSxPQUFPLDZCQUE2QixHQUFHLFVBQVUsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLDRDQUE0QyxDQUFDLENBQUMsR0FBRyxTQUFTO01BQ3hIO0lBQ0o7SUFDQSxJQUFJLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLEtBQUssQ0FBQyxLQUFLLENBQUMsVUFBVSxJQUFJLEVBQUU7TUFBRSxPQUFPLElBQUksQ0FBQyxLQUFLLEtBQUssTUFBTTtJQUFFLENBQUMsQ0FBQyxFQUFFO01BQ3BGLE9BQU8sNkJBQTZCLEdBQUcsVUFBVSxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMscUNBQXFDLENBQUMsQ0FBQyxHQUFHLFNBQVM7SUFDakg7SUFDQSxPQUFPLElBQUk7RUFDZjtFQUVBLFNBQVMsYUFBYSxDQUFDLElBQUksRUFBRTtJQUN6QixJQUFJLE9BQU8sR0FBRyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUM7SUFDcEMsSUFBSSxTQUFTLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO0lBQ3ZGLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsSUFDOUIsTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7SUFDekUsSUFBSSxLQUFLLEdBQUcsRUFBRTtJQUNkLElBQUksT0FBTyxLQUFLLElBQUksRUFBRTtNQUNsQixLQUFLLEdBQUcsT0FBTztJQUNuQixDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsT0FBTyxJQUFJLElBQUksQ0FBQyxhQUFhLEVBQUU7TUFDM0MsS0FBSyxHQUFHLHlCQUF5QixHQUFHLFdBQVcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLEdBQUcsU0FBUztJQUNuRjtJQUNBLElBQUksT0FBTyxHQUFHLFdBQVcsQ0FBQyxJQUFJLENBQUM7SUFFL0IsT0FBTywwQkFBMEIsSUFBSSxJQUFJLENBQUMsT0FBTyxHQUFHLEVBQUUsR0FBRyxTQUFTLENBQUMsR0FBRyxrQ0FBa0MsR0FBRyxJQUFJLENBQUMsRUFBRSxHQUFHLElBQUksR0FDbkgsa0NBQWtDLElBQUksSUFBSSxDQUFDLE9BQU8sR0FBRyxVQUFVLEdBQUcsRUFBRSxDQUFDLEdBQUcsZ0JBQWdCLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxJQUFJLEdBQ2pILHNEQUFzRCxJQUFJLElBQUksQ0FBQyxPQUFPLEdBQUcsVUFBVSxHQUFHLEVBQUUsQ0FBQyxHQUFHLEdBQUcsR0FDL0Ysd0NBQXdDLEdBQ3hDLDhCQUE4QixHQUM5Qiw4QkFBOEIsSUFBSSxPQUFPLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRyxJQUFJLENBQUMsR0FBRywyQkFBMkIsSUFBSSxPQUFPLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRyxVQUFVLENBQUMsR0FBRyxJQUFJLElBQ2xKLE9BQU8sS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLFNBQVMsR0FDOUMsb0VBQW9FLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxhQUFhLEdBQ3RHLGdDQUFnQyxHQUFHLEtBQUssR0FBRyxTQUFTLEdBQ3BELGlDQUFpQyxHQUNqQywrRkFBK0YsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLG1DQUFtQyxDQUFDLENBQUMsR0FBRywwQkFBMEIsR0FDMUssc0lBQXNJLEdBQ3RJLG1DQUFtQyxHQUNuQyxpQ0FBaUMsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLG1DQUFtQyxDQUFDLENBQUMsR0FBRyxNQUFNLElBQ3ZGLFNBQVMsR0FBRyxFQUFFLEdBQUcsK0JBQStCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDLEdBQUcsTUFBTSxDQUFDLElBQ3RHLFFBQVEsR0FBRyxFQUFFLEdBQUcsaUNBQWlDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFDLEdBQUcsTUFBTSxDQUFDLEdBQzFHLG1DQUFtQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMscUNBQXFDLENBQUMsQ0FBQyxHQUFHLE1BQU0sR0FDNUYsb0JBQW9CO0VBQzlCO0VBRUEsU0FBUyxrQkFBa0IsR0FBRztJQUMxQixJQUFJLEtBQUssR0FBRyxDQUFDLENBQUMsZ0JBQWdCLENBQUM7SUFDL0IsS0FBSyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUscUJBQXFCLEVBQUUsWUFBWTtNQUFFLGNBQWMsQ0FBQyxJQUFJLENBQUM7SUFBRSxDQUFDLENBQUM7SUFDL0UsS0FBSyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUseUJBQXlCLEVBQUUsWUFBWTtNQUFFLFlBQVksQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7SUFBRSxDQUFDLENBQUM7SUFDakgsS0FBSyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsc0JBQXNCLEVBQUUsVUFBVSxLQUFLLEVBQUU7TUFDdkQsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDO01BQ3RCLGNBQWMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQztJQUM5RSxDQUFDLENBQUM7SUFDRixLQUFLLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSxVQUFVLEtBQUssRUFBRTtNQUN2RCxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUM7TUFDdkIsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLFFBQVEsQ0FBQyxlQUFlLENBQUM7TUFDN0MsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQztNQUNsRCxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDL0MsQ0FBQyxDQUFDO0lBQ0YsS0FBSyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsd0JBQXdCLEVBQUUsVUFBVSxLQUFLLEVBQUU7TUFDekQsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDO01BQ3RCLGlCQUFpQixDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLGVBQWUsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDO0lBQ2pGLENBQUMsQ0FBQztJQUNGLEtBQUssQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLDBDQUEwQyxFQUFFLFVBQVUsS0FBSyxFQUFFO01BQzNFLEtBQUssQ0FBQyxjQUFjLENBQUMsQ0FBQztNQUN0QixRQUFRLENBQ0osQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxlQUFlLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQ2hELENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEtBQUssSUFBSSxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQzNDLENBQUM7SUFDTCxDQUFDLENBQUM7SUFDRixLQUFLLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxpQkFBaUIsRUFBRSxZQUFZO01BQzlDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsZUFBZSxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQztNQUN6RCxJQUFJLE9BQU8sR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQztNQUNyQyxRQUFRLENBQUMsU0FBUyxHQUFHLEVBQUUsRUFBRTtRQUFFLE9BQU8sRUFBRTtNQUFRLENBQUMsRUFBRSxVQUFVLElBQUksRUFBRTtRQUMzRCxXQUFXLENBQUMsSUFBSSxDQUFDO1FBQ2pCLFdBQVcsQ0FBQyxDQUFDO01BQ2pCLENBQUMsRUFBRSxVQUFVLE9BQU8sRUFBRTtRQUNsQixTQUFTLENBQUMsSUFBSSxDQUFDO1FBQ2YsU0FBUyxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztNQUNuQyxDQUFDLENBQUM7SUFDTixDQUFDLENBQUM7SUFDRixDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxVQUFVLEtBQUssRUFBRTtNQUNyQyxJQUFJLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxDQUFDLG9CQUFvQixDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtRQUM1RCxDQUFDLENBQUMsZUFBZSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUM7TUFDM0M7SUFDSixDQUFDLENBQUM7RUFDTjtFQUVBLFNBQVMsYUFBYSxDQUFDLElBQUksRUFBRTtJQUN6QixJQUFJLEtBQUssQ0FBQyxlQUFlLEVBQUU7TUFDdkIsSUFBSSxDQUFDLENBQUM7TUFDTjtJQUNKO0lBQ0EsT0FBTyxDQUFDLFlBQVksRUFBRTtNQUFFLEtBQUssRUFBRTtJQUFJLENBQUMsRUFBRSxVQUFVLElBQUksRUFBRTtNQUNsRCxJQUFJLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxJQUFJLEVBQUU7TUFDNUIsSUFBSSxJQUFJLEdBQUcsRUFBRTtNQUNiLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO1FBQ25DLElBQUksUUFBUSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUM7UUFDdkIsSUFBSSxFQUFFLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxFQUFFLEtBQUssU0FBUyxHQUFHLFFBQVEsQ0FBQyxFQUFFLEdBQUksUUFBUSxDQUFDLFdBQVcsSUFBSSxFQUFHLENBQUM7UUFDdkYsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFO1VBQUU7UUFBVTtRQUMzQixJQUFJLEtBQUssR0FBRyxRQUFRLENBQUMsV0FBVyxJQUFJLFFBQVEsQ0FBQyxRQUFRLElBQUssR0FBRyxHQUFHLEVBQUc7UUFDbkUsSUFBSSxDQUFDLElBQUksQ0FBQztVQUFFLEVBQUUsRUFBRSxFQUFFO1VBQUUsS0FBSyxFQUFFO1FBQU0sQ0FBQyxDQUFDO01BQ3ZDO01BQ0EsS0FBSyxDQUFDLFNBQVMsR0FBRyxJQUFJO01BQ3RCLEtBQUssQ0FBQyxlQUFlLEdBQUcsSUFBSTtNQUM1QixJQUFJLENBQUMsQ0FBQztJQUNWLENBQUMsRUFBRSxZQUFZO01BQ1gsS0FBSyxDQUFDLGVBQWUsR0FBRyxLQUFLO01BQzdCLElBQUksQ0FBQyxDQUFDO0lBQ1YsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLFFBQVEsQ0FBQyxFQUFFLEVBQUUsS0FBSyxFQUFFO0lBQ3pCLElBQUksR0FBRyxHQUFHLEVBQUU7SUFDWixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7TUFDekMsR0FBRyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUN2QztJQUNBLElBQUksS0FBSyxHQUFHLEdBQUcsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ25DLElBQUksTUFBTSxHQUFHLEtBQUssR0FBRyxLQUFLO0lBQzFCLElBQUksS0FBSyxHQUFHLENBQUMsSUFBSSxNQUFNLEdBQUcsQ0FBQyxJQUFJLE1BQU0sSUFBSSxHQUFHLENBQUMsTUFBTSxFQUFFO01BQ2pEO0lBQ0o7SUFDQSxJQUFJLElBQUksR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDO0lBQ3JCLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxHQUFHLENBQUMsTUFBTSxDQUFDO0lBQ3hCLEdBQUcsQ0FBQyxNQUFNLENBQUMsR0FBRyxJQUFJO0lBQ2xCLE9BQU8sQ0FBQyx1QkFBdUIsRUFBRTtNQUFFLEtBQUssRUFBRTtJQUFJLENBQUMsRUFBRSxZQUFZO01BQ3pELFNBQVMsQ0FBQyxJQUFJLENBQUM7TUFDZixTQUFTLENBQUMsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLENBQUM7SUFDdkQsQ0FBQyxFQUFFLFVBQVUsT0FBTyxFQUFFO01BQ2xCLFNBQVMsQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDbkMsQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLFFBQVEsQ0FBQyxFQUFFLEVBQUU7SUFDbEIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO01BQ3pDLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssTUFBTSxDQUFDLEVBQUUsQ0FBQyxFQUFFO1FBQzFDLE9BQU8sS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7TUFDekI7SUFDSjtJQUNBLE9BQU8sSUFBSTtFQUNmO0VBRUEsU0FBUyxXQUFXLENBQUMsSUFBSSxFQUFFO0lBQ3ZCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtNQUN6QyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEVBQUU7UUFDL0MsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJO1FBQ3JCO01BQ0o7SUFDSjtJQUNBLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztFQUMxQjtFQUVBLFNBQVMsaUJBQWlCLENBQUMsSUFBSSxFQUFFO0lBQzdCLElBQUksQ0FBQyxJQUFJLEVBQUU7TUFBRTtJQUFRO0lBQ3JCLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsd0NBQXdDLEVBQUU7TUFBRSxLQUFLLEVBQUUsSUFBSSxDQUFDO0lBQU0sQ0FBQyxDQUFDLENBQUM7SUFDL0YsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsS0FBSyxDQUFDO01BQUUsUUFBUSxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQztJQUM5RCxDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxZQUFZO01BQ3JELENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUM7TUFDcEMsU0FBUyxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsRUFBRSxFQUFFLFlBQVk7UUFDdkMsU0FBUyxDQUFDLElBQUksQ0FBQztRQUNmLFNBQVMsQ0FBQyxDQUFDLENBQUMsb0NBQW9DLENBQUMsQ0FBQztNQUN0RCxDQUFDLEVBQUUsVUFBVSxPQUFPLEVBQUU7UUFDbEIsU0FBUyxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztNQUNuQyxDQUFDLENBQUM7SUFDTixDQUFDLENBQUM7RUFDTjs7RUFFQTs7RUFFQSxTQUFTLFlBQVksR0FBRztJQUNwQixPQUFPO01BQUUsUUFBUSxFQUFFLEVBQUU7TUFBRSxVQUFVLEVBQUUsRUFBRTtNQUFFLFNBQVMsRUFBRSxFQUFFO01BQUUsYUFBYSxFQUFFO0lBQUssQ0FBQztFQUMvRTtFQUVBLFNBQVMsZ0JBQWdCLENBQUMsT0FBTyxFQUFFO0lBQy9CLElBQUksTUFBTSxHQUFHLE9BQU8sSUFBSSxPQUFPLENBQUMsbUJBQW1CLElBQUksUUFBTyxPQUFPLENBQUMsbUJBQW1CLE1BQUssUUFBUSxHQUNoRyxPQUFPLENBQUMsbUJBQW1CLEdBQzNCLENBQUMsQ0FBQztJQUNSLElBQUksTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDO0lBQ3RDLElBQUksQ0FBQyxNQUFNLElBQUksTUFBTSxHQUFHLENBQUMsSUFBSSxNQUFNLEdBQUcsR0FBRyxFQUFFO01BQ3ZDLE1BQU0sR0FBRyxFQUFFO0lBQ2Y7SUFDQSxPQUFPO01BQ0gsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLEtBQUssSUFBSTtNQUNoQyxVQUFVLEVBQUUsTUFBTTtNQUNsQix1QkFBdUIsRUFBRSxNQUFNLENBQUMsdUJBQXVCLEtBQUs7SUFDaEUsQ0FBQztFQUNMO0VBRUEsU0FBUyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUU7SUFDL0IsSUFBSSxNQUFNLEdBQUcsWUFBWSxDQUFDLENBQUM7SUFDM0IsSUFBSSxDQUFDLE9BQU8sSUFBSSxRQUFPLE9BQU8sTUFBSyxRQUFRLEVBQUU7TUFDekMsT0FBTyxNQUFNO0lBQ2pCO0lBQ0EsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsRUFBRTtNQUNqQyxNQUFNLENBQUMsUUFBUSxHQUFHLE9BQU8sQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQztJQUNsRDtJQUNBLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUU7TUFDbkMsTUFBTSxDQUFDLFVBQVUsR0FBRyxPQUFPLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ2xEO0lBQ0EsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsRUFBRTtNQUNsQyxNQUFNLENBQUMsU0FBUyxHQUFHLE9BQU8sQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQztJQUNwRDtJQUNBLElBQUksT0FBTyxDQUFDLGFBQWEsSUFBSSxRQUFPLE9BQU8sQ0FBQyxhQUFhLE1BQUssUUFBUSxFQUFFO01BQ3BFLE1BQU0sQ0FBQyxhQUFhLEdBQUcsQ0FBQyxDQUFDO01BQ3pCLElBQUksT0FBTyxDQUFDLGFBQWEsQ0FBQyxHQUFHLEtBQUssU0FBUyxFQUFFO1FBQ3pDLE1BQU0sQ0FBQyxhQUFhLENBQUMsR0FBRyxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQztNQUNoRTtNQUNBLElBQUksT0FBTyxDQUFDLGFBQWEsQ0FBQyxHQUFHLEtBQUssU0FBUyxFQUFFO1FBQ3pDLE1BQU0sQ0FBQyxhQUFhLENBQUMsR0FBRyxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQztNQUNoRTtJQUNKO0lBQ0EsT0FBTyxNQUFNO0VBQ2pCOztFQUVBO0VBQ0EsU0FBUyxvQkFBb0IsQ0FBQyxPQUFPLEVBQUU7SUFDbkMsSUFBSSxLQUFLLEdBQUcsT0FBTyxHQUFHLE9BQU8sQ0FBQyxXQUFXLEdBQUcsSUFBSTtJQUNoRCxPQUFPLEtBQUssS0FBSyxXQUFXLElBQUksS0FBSyxLQUFLLFdBQVcsR0FBRyxLQUFLLEdBQUcsTUFBTTtFQUMxRTs7RUFFQTtFQUNBLFNBQVMscUJBQXFCLENBQUMsS0FBSyxFQUFFO0lBQ2xDLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyw4QkFBOEIsQ0FBQyxJQUFJLENBQUMsRUFBRTtNQUFFLE9BQU8sQ0FBQyxNQUFNLEVBQUUsV0FBVyxFQUFFLFdBQVcsQ0FBQztJQUFFO0lBQ3JHLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsRUFBRTtNQUFFLE9BQU8sQ0FBQyxNQUFNLEVBQUUsV0FBVyxDQUFDO0lBQUU7SUFDMUUsT0FBTyxFQUFFO0VBQ2I7RUFFQSxTQUFTLGdCQUFnQixHQUFHO0lBQ3hCLGFBQWEsQ0FBQyxZQUFZO01BQ3RCLElBQUksS0FBSyxDQUFDLFVBQVUsSUFBSSxLQUFLLENBQUMsVUFBVSxDQUFDLElBQUksS0FBSyxDQUFDLEVBQUU7UUFBRSxzQkFBc0IsQ0FBQyxDQUFDO01BQUU7SUFDckYsQ0FBQyxDQUFDO0lBQ0YsYUFBYSxDQUFDLFlBQVk7TUFDdEIsSUFBSSxLQUFLLENBQUMsVUFBVSxJQUFJLEtBQUssQ0FBQyxVQUFVLENBQUMsSUFBSSxLQUFLLENBQUMsRUFBRTtRQUFFLHNCQUFzQixDQUFDLENBQUM7TUFBRTtJQUNyRixDQUFDLENBQUM7SUFDRixJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRTtNQUNuQixRQUFRLENBQUMsSUFBSSxDQUFDO0lBQ2xCO0VBQ0o7RUFFQSxTQUFTLGNBQWMsQ0FBQyxJQUFJLEVBQUU7SUFDMUIsZ0JBQWdCLENBQUMsQ0FBQztJQUNsQixJQUFJLE1BQU0sR0FBRyxJQUFJLEdBQUcsYUFBYSxDQUFDLElBQUksQ0FBQyxHQUFHLElBQUk7SUFDOUMsS0FBSyxDQUFDLFVBQVUsR0FBRztNQUNmLElBQUksRUFBRSxJQUFJLEdBQUcsc0JBQXNCLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxJQUFJLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQztNQUN6RSxNQUFNLEVBQUUsSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQztNQUNsQyxRQUFRLEVBQUUsTUFBTSxHQUFHLE1BQU0sQ0FBQyxFQUFFLEdBQUcsRUFBRTtNQUNqQyxVQUFVLEVBQUUsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLFdBQVcsSUFBSSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUMsR0FBRyxFQUFFO01BQ3hELEtBQUssRUFBRSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssR0FBRyxFQUFFO01BQzdCLE9BQU8sRUFBRSxnQkFBZ0IsQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLENBQUM7TUFDckQsVUFBVSxFQUFFLElBQUksR0FBRyxJQUFJLENBQUMsV0FBVyxHQUFHLHdCQUF3QjtNQUM5RCxPQUFPLEVBQUUsSUFBSSxHQUNQLENBQUMsSUFBSSxDQUFDLFFBQVEsSUFBSSxFQUFFLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxVQUFVLEVBQUUsRUFBRTtRQUNyRCxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssSUFBSSxFQUFFLEVBQUUsSUFBSSxDQUFDLFVBQVUsSUFBSSxFQUFFO1VBQUUsT0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxLQUFLLEVBQUU7UUFBRSxDQUFDLENBQUM7TUFDdEYsQ0FBQyxDQUFDLEdBQ0EsRUFBRTtNQUNSLElBQUksRUFBRSxJQUFJLEdBQUcsQ0FBQyxFQUFFLElBQUksQ0FBQyxPQUFPLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxVQUFVLEtBQUssSUFBSSxDQUFDLEdBQzNELENBQUMsRUFBRSxLQUFLLENBQUMsUUFBUSxJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsa0JBQWtCLEtBQUssSUFBSSxDQUFDO01BQ3RFLE9BQU8sRUFBRSxnQkFBZ0IsQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLENBQUM7TUFDckQsV0FBVyxFQUFFLG9CQUFvQixDQUFDLElBQUksR0FBRyxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQztNQUM3RCxLQUFLLEVBQUUsSUFBSSxJQUFJLElBQUksQ0FBQyxLQUFLLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUM7TUFDckYsS0FBSyxFQUFFO0lBQ1gsQ0FBQztJQUNELENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO0lBQ3hDLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO0lBQ3BDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQztJQUNuRCxnQkFBZ0IsQ0FBQyxDQUFDO0lBQ2xCLFlBQVksQ0FBQyxDQUFDO0VBQ2xCO0VBRUEsU0FBUyxlQUFlLEdBQUc7SUFDdkIsQ0FBQyxDQUFDLCtDQUErQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDMUQsS0FBSyxDQUFDLFVBQVUsR0FBRyxJQUFJO0lBQ3ZCLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQztJQUNwQyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO0lBQ3hDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxnQkFBZ0IsQ0FBQztJQUN0RCxXQUFXLENBQUMsQ0FBQztFQUNqQjtFQUVBLFNBQVMsY0FBYyxHQUFHO0lBQ3RCLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxVQUFVO0lBQ3hCLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxRQUFRLEdBQUcsVUFBVSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsR0FBRyxJQUFJO0VBQzFEO0VBRUEsU0FBUyx1QkFBdUIsQ0FBQyxLQUFLLEVBQUU7SUFDcEMsSUFBSSxTQUFTLEdBQUcsQ0FBQyxrQkFBa0IsRUFBRSw4QkFBOEIsQ0FBQztJQUNwRSxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtNQUNuQyxJQUFJLFNBQVMsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFO1FBQUUsT0FBTyxJQUFJO01BQUU7SUFDekQ7SUFDQSxPQUFPLEtBQUs7RUFDaEI7RUFFQSxTQUFTLHdCQUF3QixDQUFDLEtBQUssRUFBRTtJQUNyQyxPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyw4QkFBOEIsQ0FBQyxJQUFJLENBQUM7RUFDdkc7RUFFQSxTQUFTLHVCQUF1QixDQUFDLEtBQUssRUFBRTtJQUNwQyxPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUM7RUFDN0Y7O0VBRUE7RUFDQSxTQUFTLG1CQUFtQixDQUFDLEtBQUssRUFBRTtJQUNoQyxPQUFPLHVCQUF1QixDQUFDLEtBQUssQ0FBQyxJQUFJLHdCQUF3QixDQUFDLEtBQUssQ0FBQyxJQUFJLHVCQUF1QixDQUFDLEtBQUssQ0FBQyxJQUNuRyxLQUFLLENBQUMsT0FBTyxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsOEJBQThCLENBQUMsSUFBSSxDQUFDO0VBQ3ZHO0VBRUEsU0FBUyxzQkFBc0IsQ0FBQyxLQUFLLEVBQUU7SUFDbkMsT0FBTyxtQkFBbUIsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQztFQUM3QztFQUVBLFNBQVMsWUFBWSxHQUFHO0lBQ3BCLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxVQUFVO0lBQ3hCLElBQUksQ0FBQyxDQUFDLEVBQUU7TUFBRTtJQUFRO0lBQ2xCLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLENBQUM7SUFDbkQsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsQ0FBQztJQUNuRCxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxDQUFDO0lBQ25ELENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDakQsSUFBSSxRQUFRLEdBQUcsY0FBYyxDQUFDLENBQUM7SUFDL0IsSUFBSSxLQUFLO0lBQ1QsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsRUFBRTtNQUNkLEtBQUssR0FBRyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQztJQUMxRSxDQUFDLE1BQU07TUFDSCxLQUFLLEdBQUcsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssR0FBSSxRQUFRLEdBQUcsUUFBUSxDQUFDLElBQUksR0FBRyxDQUFDLENBQUMsa0NBQWtDLENBQUU7SUFDdkc7SUFDQSxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDO0lBQ2pDO0lBQ0EsSUFBSSxTQUFTLEdBQUcsQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLHNCQUFzQixDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUMsUUFBUSxLQUFLLEVBQUUsQ0FBQztJQUNySCxDQUFDLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLG1DQUFtQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLENBQUMsQ0FDeEgsSUFBSSxDQUFDLE1BQU0sRUFBRSxTQUFTLEdBQUcsTUFBTSxHQUFHLFFBQVEsQ0FBQztJQUNoRCxJQUFJLE1BQU0sR0FBRyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUM7SUFDekIsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sR0FDekIsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLGlDQUFpQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLG1DQUFtQyxDQUFDLEdBQzdGLENBQUMsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO0lBQzNDLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLEVBQUU7TUFBRSxxQkFBcUIsQ0FBQyxDQUFDO0lBQUU7SUFDN0MsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsRUFBRTtNQUFFLHNCQUFzQixDQUFDLENBQUM7SUFBRTtJQUM5QyxJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxFQUFFO01BQUUsc0JBQXNCLENBQUMsQ0FBQztJQUFFO0lBQzlDLGdCQUFnQixDQUFDLENBQUM7RUFDdEI7RUFFQSxTQUFTLGdCQUFnQixHQUFHO0lBQ3hCLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxVQUFVO0lBQ3hCLElBQUksQ0FBQyxDQUFDLEVBQUU7TUFBRTtJQUFRO0lBQ2xCLElBQUksUUFBUSxHQUFHLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxRQUFRLEtBQUssRUFBRTtJQUNoRCxJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxFQUFFO01BQ2QsUUFBUSxHQUFHLGVBQWUsQ0FBQyxDQUFDLEtBQUssSUFBSTtJQUN6QztJQUNBLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsUUFBUSxDQUFDLENBQUMsV0FBVyxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUM7RUFDckY7O0VBRUE7RUFDQSxJQUFJLGNBQWMsR0FBRztJQUNqQixLQUFLLEVBQUUsaUlBQWlJO0lBQ3hJLEdBQUcsRUFBRSxpR0FBaUc7SUFDdEcsT0FBTyxFQUFFLDRGQUE0RjtJQUNyRyxLQUFLLEVBQUUsdUZBQXVGO0lBQzlGLE1BQU0sRUFBRSxtSUFBbUk7SUFDM0ksT0FBTyxFQUFFLDREQUE0RDtJQUNyRSxJQUFJLEVBQUU7RUFDVixDQUFDO0VBQ0QsSUFBSSx1QkFBdUIsR0FBRztJQUMxQixrQkFBa0IsRUFBRSxPQUFPO0lBQzNCLGdCQUFnQixFQUFFLEtBQUs7SUFDdkIsOEJBQThCLEVBQUUsU0FBUztJQUN6Qyx1QkFBdUIsRUFBRSxPQUFPO0lBQ2hDLHVCQUF1QixFQUFFLE9BQU87SUFDaEMscUJBQXFCLEVBQUUsT0FBTztJQUM5QixzQkFBc0IsRUFBRSxRQUFRO0lBQ2hDLGFBQWEsRUFBRSxTQUFTO0lBQ3hCLGtCQUFrQixFQUFFO0VBQ3hCLENBQUM7RUFFRCxTQUFTLFlBQVksQ0FBQyxRQUFRLEVBQUU7SUFDNUIsSUFBSSxLQUFLLEdBQUcsY0FBYyxDQUFDLHVCQUF1QixDQUFDLFFBQVEsQ0FBQyxJQUFJLFNBQVMsQ0FBQztJQUMxRSxPQUFPLDBGQUEwRixHQUFHLEtBQUssR0FBRyxlQUFlO0VBQy9IO0VBRUEsU0FBUyxxQkFBcUIsR0FBRztJQUM3QixJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsVUFBVTtJQUN4QixJQUFJLE1BQU0sR0FBRyxXQUFXLENBQUMsTUFBTSxDQUFDLFVBQVUsS0FBSyxFQUFFO01BQzdDLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsVUFBVSxNQUFNLEVBQUU7UUFBRSxPQUFPLE1BQU0sQ0FBQyxLQUFLLEtBQUssS0FBSztNQUFFLENBQUMsQ0FBQztJQUNuRixDQUFDLENBQUM7SUFDRixJQUFJLElBQUksR0FBRyxFQUFFO0lBQ2IsTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLEtBQUssRUFBRTtNQUM1QixJQUFJLE9BQU8sR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxVQUFVLE1BQU0sRUFBRTtRQUFFLE9BQU8sTUFBTSxDQUFDLEtBQUssS0FBSyxLQUFLO01BQUUsQ0FBQyxDQUFDO01BQ3hGLElBQUksTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7UUFDbkIsSUFBSSxJQUFJLDZCQUE2QixHQUFHLEdBQUcsQ0FBQyxlQUFlLENBQUMsS0FBSyxDQUFDLENBQUMsR0FBRyxPQUFPO01BQ2pGO01BQ0EsSUFBSSxJQUFJLGdDQUFnQztNQUN4QyxPQUFPLENBQUMsT0FBTyxDQUFDLFVBQVUsTUFBTSxFQUFFO1FBQzlCLElBQUksUUFBUSxHQUFHLENBQUMsZ0JBQWdCLEVBQUUsaUJBQWlCLEVBQUUsZUFBZSxFQUFFLE9BQU8sRUFBRSxVQUFVLENBQUMsQ0FDckYsT0FBTyxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDO1FBQ3RDLElBQUksUUFBUSxHQUFHLENBQUMsQ0FBQyxRQUFRLEtBQUssTUFBTSxDQUFDLEVBQUU7UUFDdkM7UUFDQSxJQUFJLElBQUksMENBQTBDLElBQUksUUFBUSxHQUFHLGNBQWMsR0FBRyxFQUFFLENBQUMsSUFBSSxRQUFRLEdBQUcsY0FBYyxHQUFHLEVBQUUsQ0FBQyxHQUNsSCxvQkFBb0IsR0FBRyxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxHQUFHLGtCQUFrQixJQUFJLFFBQVEsR0FBRyxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsR0FBRyxJQUMvRixRQUFRLEdBQUcsZ0NBQWdDLEdBQUcsRUFBRSxDQUFDLEdBQUcsR0FBRyxHQUN4RCxZQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxHQUN2QixvQ0FBb0MsR0FBRyxHQUFHLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLE1BQU0sSUFDL0QsUUFBUSxHQUFHLHdCQUF3QixHQUFHLEdBQUcsQ0FBQyxNQUFNLENBQUMsaUJBQWlCLENBQUMsR0FBRyxTQUFTLEdBQUcsRUFBRSxDQUFDLEdBQ3RGLGtCQUFrQjtNQUM1QixDQUFDLENBQUM7TUFDRixJQUFJLElBQUksUUFBUTtJQUNwQixDQUFDLENBQUM7SUFDRixDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO0VBQ3hDOztFQUVBOztFQUVBLFNBQVMsc0JBQXNCLEdBQUc7SUFDOUIsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDLFVBQVU7SUFDeEIsSUFBSSxDQUFDLENBQUMsRUFBRTtNQUFFO0lBQVE7SUFDbEIsSUFBSSxJQUFJLEdBQUcsRUFBRTtJQUNiLElBQUksdUJBQXVCLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxFQUFFO01BQ3ZDLElBQUksSUFBSSxtQkFBbUIsSUFBSSxLQUFLLENBQUMsZUFBZSxHQUFHLFFBQVEsR0FBRyxFQUFFLENBQUMsR0FBRyxpQ0FBaUMsR0FDbkcsU0FBUyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsc0NBQXNDLENBQUMsQ0FBQyxHQUFHLFVBQVUsR0FDdkUsMEdBQTBHLEdBQzFHLGtEQUFrRCxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsZ0NBQWdDLENBQUMsQ0FBQyxHQUFHLHVDQUF1QyxJQUN0SSxLQUFLLENBQUMsZUFBZSxHQUNsQix3QkFBd0IsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLENBQUMsR0FDdEUsNkNBQTZDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDLEdBQUcsYUFBYSxHQUM5RyxFQUFFLENBQUMsR0FDUCxRQUFRO0lBQ2xCO0lBQ0EsSUFBSSx3QkFBd0IsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLEVBQUU7TUFDeEMsSUFBSSxVQUFVLEdBQUcsQ0FDYixDQUFDLFVBQVUsRUFBRSw4Q0FBOEMsQ0FBQyxFQUM1RCxDQUFDLFVBQVUsRUFBRSw4Q0FBOEMsQ0FBQyxFQUM1RCxDQUFDLFVBQVUsRUFBRSw4Q0FBOEMsQ0FBQyxDQUMvRDtNQUNELElBQUksSUFBSSw0QkFBNEIsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLENBQUMsR0FBRyxVQUFVLEdBQzdGLCtDQUErQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsdUNBQXVDLENBQUMsQ0FBQyxHQUFHLElBQUk7TUFDOUcsVUFBVSxDQUFDLE9BQU8sQ0FBQyxVQUFVLElBQUksRUFBRTtRQUMvQixJQUFJLE9BQU8sR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQztRQUN4RCxJQUFJLElBQUksd0NBQXdDLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLGtCQUFrQixJQUFJLE9BQU8sR0FBRyxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsSUFBSSxHQUMvRyxHQUFHLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsV0FBVztNQUN2QyxDQUFDLENBQUM7TUFDRixJQUFJLElBQUksY0FBYztJQUMxQjtJQUNBLElBQUksdUJBQXVCLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxFQUFFO01BQ3ZDLElBQUksSUFBSSw0QkFBNEIsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHNDQUFzQyxDQUFDLENBQUMsR0FBRyxVQUFVLEdBQzVGLDBHQUEwRyxHQUMxRyxrREFBa0QsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLGdDQUFnQyxDQUFDLENBQUMsR0FBRyw2Q0FBNkM7SUFDdko7SUFDQSxJQUFJLENBQUMsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLDhCQUE4QixDQUFDLElBQUksQ0FBQyxFQUFFO01BQzNELElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsYUFBYSxJQUFJLENBQUMsQ0FBQztNQUN6QyxJQUFJLElBQUksNEJBQTRCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFDLEdBQUcsVUFBVSxHQUMxRixnQ0FBZ0MsR0FDaEMsUUFBUSxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsd0NBQXdDLENBQUMsQ0FBQyxHQUFHLDBGQUEwRixJQUFJLEtBQUssQ0FBQyxHQUFHLEtBQUssU0FBUyxHQUFHLEtBQUssQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEdBQUcsSUFBSSxHQUM1TSxRQUFRLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDLEdBQUcsMEZBQTBGLElBQUksS0FBSyxDQUFDLEdBQUcsS0FBSyxTQUFTLEdBQUcsS0FBSyxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsR0FBRyxJQUFJLEdBQzFNLGNBQWM7SUFDeEI7SUFDQSxJQUFJLENBQUMsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxFQUFFO01BQy9DLElBQUksSUFBSSw0Q0FBNEMsR0FDOUMsa0NBQWtDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEdBQUcsVUFBVSxHQUFHLEVBQUUsQ0FBQyxHQUFHLDRCQUE0QixHQUN6Ryx1Q0FBdUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sR0FBRyxVQUFVLEdBQUcsRUFBRSxDQUFDLEdBQUcsZUFBZSxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMscUNBQXFDLENBQUMsQ0FBQyxHQUFHLElBQUksR0FDeEosd0NBQXdDLEdBQ3hDLFFBQVEsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLENBQUMsR0FBRyxTQUFTLEdBQ3BFLHdEQUF3RCxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxHQUFHLEVBQUUsR0FBRyxTQUFTLENBQUMsR0FBRyxHQUFHLEdBQ3JHLHlCQUF5QixHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsMENBQTBDLENBQUMsQ0FBQyxHQUFHLFNBQVMsR0FDMUYsMkZBQTJGLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxVQUFVLEdBQUcsZ0JBQWdCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDLEdBQUcsSUFBSSxHQUM1TCx5QkFBeUIsR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLENBQUMsR0FBRyxnQkFBZ0IsR0FDNUYsUUFBUSxJQUNQLFdBQVcsQ0FBQyxDQUFDLEdBQ1YsNkNBQTZDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEdBQUcsRUFBRSxHQUFHLFNBQVMsQ0FBQyxHQUFHLEdBQUcsR0FDdEYsd0JBQXdCLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDLEdBQUcsZUFBZSxHQUM5RixFQUFFLENBQUM7SUFDakI7SUFDQSxDQUFDLENBQUMsdUJBQXVCLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO0lBQ3JDLHNCQUFzQixDQUFDLENBQUM7SUFDeEIsb0JBQW9CLENBQUMsQ0FBQztJQUN0QixtQkFBbUIsQ0FBQyxDQUFDO0VBQ3pCO0VBRUEsU0FBUyxzQkFBc0IsR0FBRztJQUM5QixJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsVUFBVTtJQUN4QixJQUFJLFVBQVUsR0FBRyxDQUFDLENBQUMsb0JBQW9CLENBQUM7SUFDeEMsSUFBSSxVQUFVLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtNQUN2QixJQUFJLGFBQWEsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDO01BQ2xELFVBQVUsQ0FBQyxRQUFRLENBQUM7UUFDaEIsTUFBTSxFQUFFLEtBQUssQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFVBQVUsUUFBUSxFQUFFO1VBQzVDLE9BQU87WUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLEtBQUs7WUFBRSxLQUFLLEVBQUUsTUFBTSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7WUFBRSxRQUFRLEVBQUUsYUFBYSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUk7VUFBRSxDQUFDO1FBQzFILENBQUMsQ0FBQztRQUNGLFdBQVcsRUFBRSxDQUFDLENBQUMsZ0NBQWdDLENBQUM7UUFDaEQsY0FBYyxFQUFFLElBQUk7UUFDcEIsT0FBTyxFQUFFO1VBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQyx5Q0FBeUM7UUFBRSxDQUFDO1FBQ3BFLFFBQVEsRUFBRSxTQUFWLFFBQVEsQ0FBWSxLQUFLLEVBQUU7VUFDdkIsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLEVBQUU7WUFBRTtVQUFRO1VBQ2pDLEtBQUssQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLFFBQVEsR0FBRyxNQUFNLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQztRQUNsRztNQUNKLENBQUMsQ0FBQztJQUNOO0lBQ0EsSUFBSSxVQUFVLEdBQUcsQ0FBQyxDQUFDLG9CQUFvQixDQUFDO0lBQ3hDLElBQUksVUFBVSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7TUFDdkIsSUFBSSxpQkFBaUIsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDO01BQ3ZELFVBQVUsQ0FBQyxRQUFRLENBQUM7UUFDaEIsTUFBTSxFQUFFLEtBQUssQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFVBQVUsUUFBUSxFQUFFO1VBQzVDLE9BQU87WUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLEtBQUs7WUFBRSxLQUFLLEVBQUUsTUFBTSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7WUFBRSxRQUFRLEVBQUUsaUJBQWlCLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSTtVQUFFLENBQUM7UUFDOUgsQ0FBQyxDQUFDO1FBQ0YsV0FBVyxFQUFFLENBQUMsQ0FBQyxnQ0FBZ0MsQ0FBQztRQUNoRCxjQUFjLEVBQUUsSUFBSTtRQUNwQixPQUFPLEVBQUU7VUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDLHlDQUF5QztRQUFFLENBQUM7UUFDcEUsUUFBUSxFQUFFLFNBQVYsUUFBUSxDQUFZLEtBQUssRUFBRTtVQUN2QixJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRTtZQUFFO1VBQVE7VUFDakMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUM7UUFDdkY7TUFDSixDQUFDLENBQUM7SUFDTjtFQUNKO0VBRUEsU0FBUyxvQkFBb0IsR0FBRztJQUM1QixJQUFJLEtBQUssR0FBRyxDQUFDLENBQUMsdUJBQXVCLENBQUM7SUFDdEMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUM7SUFDcEIsS0FBSyxDQUFDLEVBQUUsQ0FBQyxjQUFjLEVBQUUsZ0JBQWdCLEVBQUUsWUFBWTtNQUNuRCxJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsVUFBVTtNQUN4QixJQUFJLENBQUMsQ0FBQyxFQUFFO1FBQUU7TUFBUTtNQUNsQixJQUFJLEtBQUssR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQztNQUM3QyxJQUFJLEtBQUssR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO01BQy9DLElBQUksS0FBSyxJQUFJLENBQUMsRUFBRTtRQUNaLENBQUMsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDO01BQ3pDLENBQUMsTUFBTTtRQUNILENBQUMsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUM7TUFDcEM7TUFDQSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLGNBQWMsRUFBRSxLQUFLLElBQUksQ0FBQyxHQUFHLE9BQU8sR0FBRyxNQUFNLENBQUM7TUFDM0QsbUJBQW1CLENBQUMsQ0FBQztJQUN6QixDQUFDLENBQUM7SUFDRixLQUFLLENBQUMsRUFBRSxDQUFDLGNBQWMsRUFBRSxpQ0FBaUMsRUFBRSxVQUFVLEtBQUssRUFBRTtNQUN6RSxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUM7TUFDdEIsS0FBSyxDQUFDLGVBQWUsR0FBRyxLQUFLO01BQzdCLGFBQWEsQ0FBQyxZQUFZO1FBQUUsc0JBQXNCLENBQUMsQ0FBQztNQUFFLENBQUMsQ0FBQztJQUM1RCxDQUFDLENBQUM7SUFDRixLQUFLLENBQUMsRUFBRSxDQUFDLGVBQWUsRUFBRSwyQkFBMkIsRUFBRSxZQUFZO01BQy9ELElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxVQUFVO01BQ3hCLElBQUksQ0FBQyxDQUFDLEVBQUU7UUFBRTtNQUFRO01BQ2xCLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO01BQzNDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUM7TUFDbEUsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDO01BQzNELENBQUMsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQztJQUNoRSxDQUFDLENBQUM7SUFDRixLQUFLLENBQUMsRUFBRSxDQUFDLDRCQUE0QixFQUFFLG9CQUFvQixFQUFFLFlBQVk7TUFDckUsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDLFVBQVU7TUFDeEIsSUFBSSxDQUFDLENBQUMsRUFBRTtRQUFFO01BQVE7TUFDbEIsSUFBSSxLQUFLLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO01BQ2pDLENBQUMsQ0FBQyxPQUFPLENBQUMsVUFBVSxHQUFHLEtBQUssSUFBSSxDQUFDLElBQUksS0FBSyxJQUFJLEdBQUcsR0FBRyxLQUFLLEdBQUcsRUFBRTtJQUNsRSxDQUFDLENBQUM7SUFDRixLQUFLLENBQUMsRUFBRSxDQUFDLGNBQWMsRUFBRSxrQ0FBa0MsRUFBRSxZQUFZO01BQ3JFLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxVQUFVO01BQ3hCLElBQUksQ0FBQyxDQUFDLEVBQUU7UUFBRTtNQUFRO01BQ2xCLElBQUksR0FBRyxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztNQUM3QyxJQUFJLEdBQUcsR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7TUFDN0MsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDO01BQ2QsSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUU7UUFBRSxLQUFLLENBQUMsR0FBRyxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUM7TUFBRTtNQUMxRCxJQUFJLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtRQUFFLEtBQUssQ0FBQyxHQUFHLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQztNQUFFO01BQzFELENBQUMsQ0FBQyxPQUFPLENBQUMsYUFBYSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsR0FBRyxLQUFLLEdBQUcsSUFBSTtNQUN0RSxtQkFBbUIsQ0FBQyxDQUFDO0lBQ3pCLENBQUMsQ0FBQztFQUNOOztFQUVBOztFQUVBLFNBQVMsZUFBZSxHQUFHO0lBQ3ZCLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxVQUFVO0lBQ3hCLElBQUksQ0FBQyxDQUFDLEVBQUU7TUFBRSxPQUFPLElBQUk7SUFBRTtJQUN2QixJQUFJLElBQUksR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVLEdBQUcsRUFBRTtNQUFFLE9BQU8sR0FBRyxDQUFDLE9BQU8sS0FBSyxLQUFLO0lBQUUsQ0FBQyxDQUFDO0lBQzlFLElBQUksQ0FBQyxDQUFDLEtBQUssR0FBRyxDQUFDLEVBQUU7TUFDYixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRTtRQUNsQyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssTUFBTSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsRUFBRTtVQUFFLE9BQU8sSUFBSSxDQUFDLENBQUMsQ0FBQztRQUFFO01BQ2xFO0lBQ0o7SUFDQSxPQUFPLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJO0VBQzNDO0VBRUEsU0FBUyxzQkFBc0IsR0FBRztJQUM5QixJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsVUFBVTtJQUN4QixJQUFJLGlCQUFpQixHQUFHLHVCQUF1QixDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUM7SUFDN0QsSUFBSSxJQUFJLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsVUFBVSxHQUFHLEVBQUU7TUFBRSxPQUFPLEdBQUcsQ0FBQyxPQUFPLEtBQUssS0FBSztJQUFFLENBQUMsQ0FBQztJQUM5RSxJQUFJLE1BQU0sR0FBRyxlQUFlLENBQUMsQ0FBQztJQUM5QixJQUFJLE1BQU0sS0FBSyxJQUFJLElBQUksTUFBTSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsS0FBSyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxFQUFFO01BQzFELENBQUMsQ0FBQyxLQUFLLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO0lBQ2pDO0lBQ0EsSUFBSSxPQUFPLEdBQUcsRUFBRTtJQUNoQixJQUFJLENBQUMsT0FBTyxDQUFDLFVBQVUsR0FBRyxFQUFFO01BQ3hCLElBQUksUUFBUSxHQUFHLE1BQU0sS0FBSyxJQUFJLElBQUksTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsS0FBSyxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztNQUN0RSxJQUFJLE9BQU8sR0FBRyxHQUFHLENBQUMsT0FBTyxLQUFLLEtBQUssR0FBRyxLQUFLLEdBQUcsSUFBSTtNQUNsRCxPQUFPLElBQUksd0RBQXdELElBQUksUUFBUSxHQUFHLGNBQWMsR0FBRyxFQUFFLENBQUMsR0FDaEcsaUJBQWlCLEdBQUcsR0FBRyxDQUFDLEVBQUUsR0FBRyxrQkFBa0IsSUFBSSxRQUFRLEdBQUcsTUFBTSxHQUFHLE9BQU8sQ0FBQyxHQUFHLElBQUksR0FDdEYsNEJBQTRCLEdBQUcsT0FBTyxHQUFHLHVCQUF1QixJQUFJLE9BQU8sS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLFNBQVMsR0FDakgseUJBQXlCLEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxlQUFlO0lBQ3RFLENBQUMsQ0FBQztJQUNGLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUM7SUFDbEMsQ0FBQyxDQUFDLHVCQUF1QixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFDO0lBQ3hFLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLEdBQUcsSUFBSSxHQUFHLElBQUksQ0FBQztJQUNyRSxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxHQUFHLElBQUksR0FBRyxJQUFJLENBQUM7SUFFcEUsSUFBSSxDQUFDLGlCQUFpQixFQUFFO01BQ3BCLENBQUMsQ0FBQyxVQUFVLEdBQUcsWUFBWTtNQUMzQixDQUFDLENBQUMsMEZBQTBGLENBQUMsQ0FDeEYsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO0lBQzlDLENBQUMsTUFBTTtNQUNILENBQUMsQ0FBQywwRkFBMEYsQ0FBQyxDQUN4RixPQUFPLENBQUMsT0FBTyxDQUFDLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQztJQUM5QztJQUNBLENBQUMsQ0FBQywyQ0FBMkMsQ0FBQyxDQUFDLElBQUksQ0FBQyxZQUFZO01BQzVELElBQUksT0FBTyxHQUFHLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxVQUFVO01BQzVDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQztJQUNyRixDQUFDLENBQUM7SUFDRixpQkFBaUIsQ0FBQyxDQUFDO0lBQ25CLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQztJQUNuRCxDQUFDLENBQUMsdUJBQXVCLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUM7SUFDbEQsdUJBQXVCLENBQUMsQ0FBQztJQUN6QixvQkFBb0IsQ0FBQyxDQUFDO0lBQ3RCO0lBQ0EsbUJBQW1CLENBQUMsQ0FBQztFQUN6QjtFQUVBLFNBQVMsdUJBQXVCLEdBQUc7SUFDL0IsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDLFVBQVU7SUFDeEIsSUFBSSxLQUFLLEdBQUcscUJBQXFCLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQztJQUMvQyxJQUFJLE1BQU0sR0FBRyxDQUFDLENBQUMsd0JBQXdCLENBQUM7SUFDeEMsSUFBSSxLQUFLLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtNQUNwQixDQUFDLENBQUMsV0FBVyxHQUFHLE1BQU07TUFDdEIsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDO01BQzNCO0lBQ0o7SUFDQSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsRUFBRTtNQUFFLENBQUMsQ0FBQyxXQUFXLEdBQUcsTUFBTTtJQUFFO0lBQ2hFLE1BQU0sQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO0lBQzNCO0lBQ0EsSUFBSSxhQUFhLEdBQUcsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsOEJBQThCLENBQUMsR0FBRyxDQUFDO0lBQzVFLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsYUFBYSxHQUNwRCw0Q0FBNEMsR0FDNUMsNENBQTRDLENBQUMsQ0FBQztJQUNwRCxNQUFNLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLENBQUMsSUFBSSxDQUFDLFlBQVk7TUFDN0MsSUFBSSxJQUFJLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7TUFDdkMsSUFBSSxPQUFPLEdBQUcsSUFBSSxLQUFLLENBQUMsQ0FBQyxXQUFXO01BQ3BDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLElBQUksR0FBRyxJQUFJLENBQUMsQ0FDekQsV0FBVyxDQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxPQUFPLENBQUM7SUFDL0UsQ0FBQyxDQUFDO0lBQ0YsQ0FBQyxDQUFDLHdCQUF3QixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUMsV0FBVyxLQUFLLE1BQU0sR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFDO0VBQ3RGO0VBRUEsU0FBUyxpQkFBaUIsR0FBRztJQUN6QixJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsVUFBVTtJQUN4QixJQUFJLEdBQUcsR0FBRyxlQUFlLENBQUMsQ0FBQztJQUMzQixJQUFJLEtBQUssR0FBRyxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsS0FBSyxJQUFJLEVBQUUsRUFBRSxNQUFNLENBQUMsVUFBVSxJQUFJLEVBQUU7TUFDdkQsT0FBTyxJQUFJLENBQUMsS0FBSyxLQUFLLFFBQVEsSUFBSSxJQUFJLENBQUMsT0FBTyxLQUFLLElBQUk7SUFDM0QsQ0FBQyxDQUFDLEdBQUcsRUFBRTtJQUNQLElBQUksR0FBRyxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLEVBQUU7TUFBRSxPQUFPLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO0lBQUUsQ0FBQyxDQUFDO0lBQ2hFLENBQUMsQ0FBQyxPQUFPLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsVUFBVSxFQUFFLEVBQUU7TUFBRSxPQUFPLEdBQUcsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQztJQUFFLENBQUMsQ0FBQztJQUM1RSxDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxVQUFVLEtBQUssVUFBVSxHQUFHLElBQUksR0FBRyxJQUFJLENBQUM7SUFDckYsSUFBSSxTQUFTLEdBQUcsQ0FBQyxDQUFDLGtCQUFrQixDQUFDO0lBQ3JDLFNBQVMsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDO0lBQzdCLFNBQVMsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDckMsU0FBUyxDQUFDLFFBQVEsQ0FBQztNQUNmLE1BQU0sRUFBRSxLQUFLLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSxFQUFFO1FBQzlCLE9BQU87VUFDSCxJQUFJLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLDJCQUEyQixHQUFHLEdBQUcsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEdBQUcsU0FBUztVQUNwSCxJQUFJLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQztVQUNyQyxLQUFLLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7VUFDdEIsUUFBUSxFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSTtRQUNwRCxDQUFDO01BQ0wsQ0FBQyxDQUFDO01BQ0YsV0FBVyxFQUFFLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyx1Q0FBdUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxvQ0FBb0MsQ0FBQztNQUNwSCxPQUFPLEVBQUU7UUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDLG9DQUFvQztNQUFFLENBQUM7TUFDL0QsUUFBUSxFQUFFLFNBQVYsUUFBUSxDQUFZLEtBQUssRUFBRTtRQUN2QixJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsRUFBRTtVQUFFO1FBQVE7UUFDakMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLEtBQUssSUFBSSxFQUFFLENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUM7TUFDekY7SUFDSixDQUFDLENBQUM7RUFDTjtFQUVBLFNBQVMsb0JBQW9CLEdBQUc7SUFDNUIsSUFBSSxLQUFLLEdBQUcsQ0FBQyxDQUFDLG1CQUFtQixDQUFDO0lBQ2xDLEtBQUssQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDO0lBQ3BCLEtBQUssQ0FBQyxFQUFFLENBQUMsY0FBYyxFQUFFLGdCQUFnQixFQUFFLFVBQVUsS0FBSyxFQUFFO01BQ3hELEtBQUssQ0FBQyxjQUFjLENBQUMsQ0FBQztNQUN0QixLQUFLLENBQUMsVUFBVSxDQUFDLEtBQUssR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztNQUN2RCxLQUFLLENBQUMsVUFBVSxDQUFDLE9BQU8sR0FBRyxFQUFFO01BQzdCLHNCQUFzQixDQUFDLENBQUM7TUFDeEIsbUJBQW1CLENBQUMsQ0FBQztNQUNyQixnQkFBZ0IsQ0FBQyxDQUFDO0lBQ3RCLENBQUMsQ0FBQztJQUNGLEtBQUssQ0FBQyxFQUFFLENBQUMsZUFBZSxFQUFFLHlCQUF5QixFQUFFLFlBQVk7TUFDN0QsS0FBSyxDQUFDLFVBQVUsQ0FBQyxVQUFVLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO01BQ25ELENBQUMsQ0FBQywyQ0FBMkMsQ0FBQyxDQUFDLElBQUksQ0FBQyxZQUFZO1FBQzVELENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUMsV0FBVyxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO01BQzVFLENBQUMsQ0FBQztNQUNGLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsS0FBSyxDQUFDLFVBQVUsQ0FBQyxVQUFVLEtBQUssVUFBVSxHQUFHLElBQUksR0FBRyxJQUFJLENBQUM7SUFDeEcsQ0FBQyxDQUFDO0lBQ0YsS0FBSyxDQUFDLEVBQUUsQ0FBQyxlQUFlLEVBQUUsOEJBQThCLEVBQUUsWUFBWTtNQUNsRSxLQUFLLENBQUMsVUFBVSxDQUFDLFdBQVcsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7TUFDcEQsdUJBQXVCLENBQUMsQ0FBQztNQUN6QixtQkFBbUIsQ0FBQyxDQUFDO0lBQ3pCLENBQUMsQ0FBQztJQUNGLEtBQUssQ0FBQyxFQUFFLENBQUMsZUFBZSxFQUFFLHVCQUF1QixFQUFFLFlBQVk7TUFDM0QsS0FBSyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7TUFDL0MsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsV0FBVyxDQUFDLFNBQVMsRUFBRSxLQUFLLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQztNQUNsRSxtQkFBbUIsQ0FBQyxDQUFDO0lBQ3pCLENBQUMsQ0FBQztFQUNOOztFQUVBOztFQUVBO0VBQ0EsU0FBUyxXQUFXLEdBQUc7SUFDbkIsSUFBSSxHQUFHLEdBQUcsZUFBZSxDQUFDLENBQUM7SUFDM0IsT0FBTyxDQUFDLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxPQUFPLEtBQUssS0FBSztFQUN6QztFQUVBLFNBQVMscUJBQXFCLENBQUMsS0FBSyxFQUFFO0lBQ2xDLElBQUksS0FBSyxHQUFHLENBQ1Isa0JBQWtCLEVBQUUsZ0JBQWdCLEVBQUUsOEJBQThCLEVBQ3BFLDhCQUE4QixFQUFFLDZCQUE2QixFQUM3RCw4QkFBOEIsRUFBRSwwQkFBMEIsRUFBRSx3QkFBd0IsRUFDcEYsb0JBQW9CLEVBQUUsa0JBQWtCLEVBQUUsYUFBYSxFQUFFLGtCQUFrQixDQUM5RTtJQUNELEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO01BQ25DLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUU7UUFBRSxPQUFPLEtBQUssQ0FBQyxDQUFDLENBQUM7TUFBRTtJQUN6RDtJQUNBLE9BQU8sRUFBRTtFQUNiO0VBRUEsU0FBUyxtQkFBbUIsR0FBRztJQUMzQixJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsVUFBVTtJQUN4QixJQUFJLENBQUMsQ0FBQyxFQUFFO01BQUU7SUFBUTtJQUNsQixJQUFJLElBQUksR0FBRyxxQkFBcUIsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDO0lBQzlDLElBQUksSUFBSSxLQUFLLEVBQUUsRUFBRTtNQUNiLENBQUMsQ0FBQywrQ0FBK0MsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO01BQzFEO0lBQ0o7SUFDQSxJQUFJLEtBQUssR0FBRyxjQUFjLENBQUMsQ0FBQztJQUM1QixJQUFJLEtBQUssR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSTtJQUMvQixJQUFJLElBQUksS0FBSyw4QkFBOEIsRUFBRTtNQUN6QyxLQUFLLElBQUksS0FBSyxHQUFHLEVBQUUsQ0FBQywwQ0FBMEMsRUFBRTtRQUFFLEtBQUssRUFBRTtNQUFHLENBQUMsQ0FBQztJQUNsRjtJQUNBLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQyxJQUFJLEdBQUcsa0JBQWtCLEdBQUcsa0JBQWtCO0lBQzVELElBQUksS0FBSyxHQUFHLEVBQUU7SUFDZCxJQUFJLEtBQUssR0FBRyxFQUFFO0lBQ2QsSUFBSSxNQUFNLEdBQUcsS0FBSztJQUNsQixJQUFJLFNBQVMsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxNQUFNLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxHQUFHLFVBQVU7SUFDeEYsUUFBUSxJQUFJO01BQ1IsS0FBSyxrQkFBa0I7UUFDbkIsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLHdCQUF3QixDQUFDO1FBQ3pELEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLHFCQUFxQixHQUFHLENBQUMsQ0FBQztVQUNyQyxRQUFRLEVBQUUsK0NBQStDO1VBQ3pELFFBQVEsRUFBRSwrQ0FBK0M7VUFDekQsUUFBUSxFQUFFO1FBQ2QsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNmLE1BQU0sR0FBRyxJQUFJO1FBQ2I7TUFDSixLQUFLLGdCQUFnQjtRQUNqQixLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsMkNBQTJDLENBQUMsQ0FBQyxDQUFDO1FBQy9ELE1BQU0sR0FBRyxJQUFJO1FBQ2I7TUFDSixLQUFLLDhCQUE4QjtRQUMvQixLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxxQkFBcUIsSUFBSSxDQUFDLENBQUMsSUFBSSxHQUFHLGtCQUFrQixHQUFHLGtCQUFrQixDQUFDLEdBQUcsU0FBUyxDQUFDLENBQUM7UUFDdkcsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLHFDQUFxQyxFQUFFO1VBQUUsT0FBTyxFQUFFO1FBQXVDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDL0csS0FBSyxDQUFDLElBQUksQ0FBQyxzRUFBc0UsQ0FBQztRQUNsRixNQUFNLEdBQUcsSUFBSTtRQUNiO01BQ0osS0FBSyw4QkFBOEI7UUFDL0IsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQyxDQUFDO1FBQ2xDLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxtQ0FBbUMsRUFBRTtVQUFFLEtBQUssRUFBRTtRQUFVLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDOUUsTUFBTSxHQUFHLElBQUk7UUFDYjtNQUNKLEtBQUssb0JBQW9CO01BQ3pCLEtBQUssa0JBQWtCO1FBQ25CLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLDBCQUEwQixDQUFDLENBQUM7UUFDM0MsS0FBSyxDQUFDLElBQUksQ0FBQywyQkFBMkIsQ0FBQztRQUN2QztNQUNKLEtBQUssOEJBQThCO01BQ25DLEtBQUssNkJBQTZCO1FBQzlCLEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDO1FBQ25CO01BQ0osS0FBSywwQkFBMEI7TUFDL0IsS0FBSyx3QkFBd0I7UUFDekIsS0FBSyxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQztRQUNoQyxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxxQ0FBcUMsRUFBRTtVQUFFLEVBQUUsRUFBRTtRQUFLLENBQUMsQ0FBQyxDQUFDO1FBQ25FO01BQ0osS0FBSyxhQUFhO1FBQ2QsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsa0NBQWtDLENBQUMsQ0FBQztRQUNuRDtNQUNKLEtBQUssa0JBQWtCO1FBQ25CLEtBQUssQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUM7UUFDOUI7SUFDUjtJQUNBLElBQUksS0FBSyxHQUFHLFdBQVcsQ0FBQyxDQUFDO0lBQ3pCLElBQUksSUFBSSxHQUFHLDRCQUE0QixJQUFJLEtBQUssR0FBRyxTQUFTLEdBQUcsRUFBRSxDQUFDLEdBQUcsU0FBUyxHQUFHLEdBQUcsQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxNQUFNLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLFlBQVk7SUFDNUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxVQUFVLElBQUksRUFBRTtNQUFFLElBQUksSUFBSSxPQUFPLEdBQUcsSUFBSSxHQUFHLFFBQVE7SUFBRSxDQUFDLENBQUM7SUFDckUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxVQUFVLElBQUksRUFBRTtNQUFFLElBQUksSUFBSSxVQUFVLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLFlBQVk7SUFBRSxDQUFDLENBQUM7SUFDakYsSUFBSSxJQUFJLGtEQUFrRDtJQUMxRCxJQUFJLElBQUksa0JBQWtCLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxXQUFXLEVBQUUsS0FBSyxDQUFDO0lBQ3RELElBQUksTUFBTSxFQUFFO01BQ1IsSUFBSSxJQUFJLCtCQUErQixJQUFJLEtBQUssR0FBRyxTQUFTLEdBQUcsRUFBRSxDQUFDLEdBQUcsSUFBSSxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsMENBQTBDLENBQUMsQ0FBQyxHQUFHLFVBQVU7SUFDL0k7SUFDQTtJQUNBO0lBQ0EsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLENBQUMsSUFBSSxDQUFDLFlBQVksRUFDckMsQ0FBQyxDQUFDLEtBQUssR0FBRyw4Q0FBOEMsR0FBRyx5Q0FBeUMsQ0FBQyxDQUFDO0lBQzFHO0lBQ0EsQ0FBQyxDQUFDLCtDQUErQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztFQUNqRTs7RUFFQTtFQUNBO0VBQ0EsU0FBUyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRTtJQUMzQyxJQUFJLElBQUksS0FBSyxNQUFNLElBQUkscUJBQXFCLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUU7TUFBRSxPQUFPLEVBQUU7SUFBRTtJQUNyRixJQUFJLEtBQUssR0FBRyxFQUFFO0lBQ2QsSUFBSSxJQUFJLEtBQUssV0FBVyxFQUFFO01BQ3RCLElBQUksTUFBTSxHQUFHLENBQUMsTUFBTSxFQUFFLE1BQU0sQ0FBQztNQUM3QixNQUFNLENBQUMsT0FBTyxDQUFDLFVBQVUsUUFBUSxFQUFFLEtBQUssRUFBRTtRQUN0QyxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQywyQ0FBMkMsRUFBRTtVQUFFLENBQUMsRUFBRSxLQUFLLEdBQUcsQ0FBQztVQUFFLEtBQUssRUFBRSxNQUFNLENBQUMsTUFBTTtVQUFFLFFBQVEsRUFBRTtRQUFTLENBQUMsQ0FBQyxDQUFDO01BQzNILENBQUMsQ0FBQztJQUNOLENBQUMsTUFBTTtNQUNILEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLDRDQUE0QyxFQUFFO1FBQUUsUUFBUSxFQUFFLElBQUksS0FBSyxnQkFBZ0IsR0FBRyxNQUFNLEdBQUc7TUFBTyxDQUFDLENBQUMsQ0FBQztJQUMzSDtJQUNBLElBQUksSUFBSSxHQUFHLEVBQUU7SUFDYixLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsT0FBTyxFQUFFO01BQzdCLElBQUksSUFBSSw2Q0FBNkMsSUFBSSxLQUFLLEdBQUcsU0FBUyxHQUFHLEVBQUUsQ0FBQyxHQUFHLElBQUksR0FDakYsNEZBQTRGLEdBQzVGLGdFQUFnRSxHQUNoRSx1QkFBdUIsR0FBRyxHQUFHLENBQUMsT0FBTyxDQUFDLEdBQUcsUUFBUSxHQUNqRCxrREFBa0Q7SUFDNUQsQ0FBQyxDQUFDO0lBQ0YsT0FBTyxJQUFJO0VBQ2Y7RUFFQSxTQUFTLFdBQVcsQ0FBQyxJQUFJLEVBQUU7SUFDdkIsSUFBSSxJQUFJLEtBQUssa0JBQWtCLElBQUksSUFBSSxLQUFLLDhCQUE4QixFQUFFO01BQUUsT0FBTyxJQUFJO0lBQUU7SUFDM0YsSUFBSSxJQUFJLEtBQUssZ0JBQWdCLEVBQUU7TUFBRSxPQUFPLElBQUk7SUFBRTtJQUM5QyxJQUFJLElBQUksS0FBSyw4QkFBOEIsSUFBSSxJQUFJLEtBQUssb0JBQW9CLElBQUksSUFBSSxLQUFLLDBCQUEwQixFQUFFO01BQUUsT0FBTyxJQUFJO0lBQUU7SUFDcEksSUFBSSxJQUFJLEtBQUssa0JBQWtCLElBQUksSUFBSSxLQUFLLHdCQUF3QixJQUFJLElBQUksS0FBSyw2QkFBNkIsRUFBRTtNQUFFLE9BQU8sR0FBRztJQUFFO0lBQzlILElBQUksSUFBSSxLQUFLLDhCQUE4QixFQUFFO01BQUUsT0FBTyxJQUFJO0lBQUU7SUFDNUQsSUFBSSxJQUFJLEtBQUssa0JBQWtCLEVBQUU7TUFBRSxPQUFPLElBQUk7SUFBRTtJQUNoRCxPQUFPLElBQUk7RUFDZjs7RUFFQTs7RUFFQSxTQUFTLFVBQVUsR0FBRztJQUNsQixJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsVUFBVTtJQUN4QixJQUFJLENBQUMsQ0FBQyxFQUFFO01BQUU7SUFBUTtJQUNsQixJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxFQUFFO01BQ2QsSUFBSSxDQUFDLENBQUMsQ0FBQyxRQUFRLEVBQUU7UUFBRTtNQUFRO01BQzNCLENBQUMsQ0FBQyxJQUFJLEdBQUcsc0JBQXNCLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQztNQUM3QyxZQUFZLENBQUMsQ0FBQztNQUNkO0lBQ0o7SUFDQSxJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxFQUFFO01BQ2QsQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDO01BQ1YsWUFBWSxDQUFDLENBQUM7TUFDZDtJQUNKO0lBQ0EsUUFBUSxDQUFDLENBQUM7RUFDZDtFQUVBLFNBQVMsVUFBVSxHQUFHO0lBQ2xCLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxVQUFVO0lBQ3hCLElBQUksQ0FBQyxDQUFDLEVBQUU7TUFBRTtJQUFRO0lBQ2xCLElBQUksQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLE1BQU0sRUFBRTtNQUM5QyxlQUFlLENBQUMsQ0FBQztNQUNqQjtJQUNKO0lBQ0EsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsSUFBSSxtQkFBbUIsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLEVBQUU7TUFDbkQsQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDO0lBQ2QsQ0FBQyxNQUFNO01BQ0gsQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDO0lBQ2Q7SUFDQSxnQkFBZ0IsQ0FBQyxDQUFDO0lBQ2xCLFlBQVksQ0FBQyxDQUFDO0VBQ2xCO0VBRUEsU0FBUyxZQUFZLENBQUMsT0FBTyxFQUFFO0lBQzNCLElBQUksTUFBTSxHQUFHLENBQUMsQ0FBQztJQUNmLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO01BQUUsTUFBTSxDQUFDLFFBQVEsR0FBRyxPQUFPLENBQUMsUUFBUTtJQUFFO0lBQ3ZFLElBQUksT0FBTyxDQUFDLFVBQVUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO01BQUUsTUFBTSxDQUFDLFVBQVUsR0FBRyxPQUFPLENBQUMsVUFBVTtJQUFFO0lBQzdFLElBQUksT0FBTyxDQUFDLFNBQVMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO01BQUUsTUFBTSxDQUFDLFNBQVMsR0FBRyxPQUFPLENBQUMsU0FBUztJQUFFO0lBQzFFLElBQUksT0FBTyxDQUFDLGFBQWEsS0FBSyxJQUFJLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtNQUNqRixNQUFNLENBQUMsYUFBYSxHQUFHLE9BQU8sQ0FBQyxhQUFhO0lBQ2hEO0lBQ0EsT0FBTyxNQUFNO0VBQ2pCO0VBRUEsU0FBUyxRQUFRLEdBQUc7SUFDaEIsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDLFVBQVU7SUFDeEIsSUFBSSxDQUFDLENBQUMsRUFBRTtNQUFFO0lBQVE7SUFDbEIsSUFBSSxRQUFRLEdBQUcsY0FBYyxDQUFDLENBQUM7SUFDL0I7SUFDQSxJQUFJLEtBQUssR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLFFBQVEsR0FBRyxRQUFRLENBQUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUMzRSxJQUFJLEtBQUssS0FBSyxFQUFFLEVBQUU7TUFDZCxlQUFlLENBQUMsQ0FBQyxDQUFDLDBDQUEwQyxDQUFDLENBQUM7TUFDOUQ7SUFDSjtJQUNBLElBQUksQ0FBQyxDQUFDLFVBQVUsS0FBSyxVQUFVLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO01BQ3ZELGVBQWUsQ0FBQyxDQUFDLENBQUMsc0NBQXNDLENBQUMsQ0FBQztNQUMxRDtJQUNKO0lBQ0EsSUFBSSxPQUFPLEdBQUc7TUFBRSxVQUFVLEVBQUUsQ0FBQyxDQUFDO0lBQUssQ0FBQztJQUNwQyxJQUFJLENBQUMsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxFQUFFO01BQy9DLE9BQU8sQ0FBQyxtQkFBbUIsR0FBRztRQUMxQixPQUFPLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEtBQUssSUFBSTtRQUNuQyxVQUFVLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxVQUFVLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsVUFBVSxJQUFJLEdBQUcsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsR0FBRyxFQUFFO1FBQ2hHLHVCQUF1QixFQUFFLENBQUMsQ0FBQyxPQUFPLENBQUMsdUJBQXVCLEtBQUs7TUFDbkUsQ0FBQztJQUNMO0lBQ0EsSUFBSSxxQkFBcUIsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtNQUNoRCxPQUFPLENBQUMsV0FBVyxHQUFHLENBQUMsQ0FBQyxXQUFXO0lBQ3ZDO0lBQ0EsSUFBSSxPQUFPLEdBQUc7TUFDVixLQUFLLEVBQUUsS0FBSztNQUNaLE9BQU8sRUFBRSxJQUFJO01BQ2IsV0FBVyxFQUFFLENBQUMsQ0FBQyxVQUFVO01BQ3pCLFlBQVksRUFBRSxNQUFNO01BQ3BCLE9BQU8sRUFBRSxZQUFZLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQztNQUNoQyxXQUFXLEVBQUUsQ0FBQyxDQUFDLFVBQVU7TUFDekIsUUFBUSxFQUFFLENBQUMsQ0FBQyxPQUFPO01BQ25CLE9BQU8sRUFBRTtJQUNiLENBQUM7SUFDRCxJQUFJLElBQUksR0FBRyxTQUFQLElBQUksQ0FBYSxJQUFJLEVBQUU7TUFDdkIsZUFBZSxDQUFDLENBQUM7TUFDakIsV0FBVyxDQUFDLElBQUksQ0FBQztNQUNqQixTQUFTLENBQUMsSUFBSSxDQUFDO01BQ2YsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsR0FBRyxrQ0FBa0MsR0FBRyxvQ0FBb0MsQ0FBQyxDQUFDO0lBQzFHLENBQUM7SUFDRCxJQUFJLE9BQU8sR0FBRyxTQUFWLE9BQU8sQ0FBYSxHQUFHLEVBQUU7TUFDekIsZUFBZSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNyQyxDQUFDO0lBQ0QsSUFBSSxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtNQUNkLFFBQVEsQ0FBQyxTQUFTLEdBQUcsQ0FBQyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLE9BQU8sQ0FBQztJQUMxRCxDQUFDLE1BQU07TUFDSCxPQUFPLENBQUMsUUFBUSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDO0lBQzdDO0VBQ0o7RUFFQSxTQUFTLGVBQWUsQ0FBQyxJQUFJLEVBQUU7SUFDM0IsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDLENBQUMsSUFBSSxDQUFDLGdEQUFnRCxHQUFHLFVBQVUsR0FDbEcsdUJBQXVCLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLGNBQWMsQ0FBQztFQUMvRDtFQUVBLFNBQVMsZ0JBQWdCLEdBQUc7SUFDeEIsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7RUFDakQ7RUFFQSxTQUFTLGtCQUFrQixHQUFHO0lBQzFCLENBQUMsQ0FBQyxjQUFjLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVk7TUFBRSxjQUFjLENBQUMsSUFBSSxDQUFDO0lBQUUsQ0FBQyxDQUFDO0lBQ3BFLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsVUFBVSxLQUFLLEVBQUU7TUFDOUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDO01BQ3RCLGVBQWUsQ0FBQyxDQUFDO0lBQ3JCLENBQUMsQ0FBQztJQUNGLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsWUFBWTtNQUN6QyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUU7UUFBRTtNQUFRO01BQ3hDLGdCQUFnQixDQUFDLENBQUM7TUFDbEIsVUFBVSxDQUFDLENBQUM7SUFDaEIsQ0FBQyxDQUFDO0lBQ0YsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxVQUFVLENBQUM7SUFDNUMsQ0FBQyxDQUFDLDBCQUEwQixDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxVQUFVLEtBQUssRUFBRTtNQUN2RCxLQUFLLENBQUMsY0FBYyxDQUFDLENBQUM7TUFDdEIsZUFBZSxDQUFDLENBQUM7TUFDakIsQ0FBQyxDQUFDLHFDQUFxQyxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQztJQUM3RCxDQUFDLENBQUM7SUFDRixDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLGNBQWMsRUFBRSxZQUFZO01BQzlELElBQUksTUFBTSxHQUFHLFVBQVUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDO01BQ2xELElBQUksQ0FBQyxNQUFNLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsRUFBRTtRQUFFO01BQVE7TUFDMUQsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDLFVBQVU7TUFDeEIsSUFBSSxDQUFDLENBQUMsUUFBUSxLQUFLLE1BQU0sQ0FBQyxFQUFFLEVBQUU7UUFDMUIsQ0FBQyxDQUFDLFFBQVEsR0FBRyxNQUFNLENBQUMsRUFBRTtRQUN0QixDQUFDLENBQUMsVUFBVSxHQUFHLENBQUMsTUFBTSxDQUFDLFdBQVcsSUFBSSxFQUFFLEVBQUUsR0FBRyxDQUFDLFVBQVUsSUFBSSxFQUFFO1VBQUUsT0FBTyxJQUFJLENBQUMsSUFBSTtRQUFFLENBQUMsQ0FBQztRQUNwRixJQUFJLENBQUMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO1VBQUUsQ0FBQyxDQUFDLEtBQUssR0FBRyxNQUFNLENBQUMsSUFBSTtRQUFFO1FBQzdDLENBQUMsQ0FBQyxPQUFPLEdBQUcsWUFBWSxDQUFDLENBQUM7TUFDOUI7TUFDQSxxQkFBcUIsQ0FBQyxDQUFDO01BQ3ZCLGdCQUFnQixDQUFDLENBQUM7SUFDdEIsQ0FBQyxDQUFDO0lBQ0YsQ0FBQyxDQUFDLHNCQUFzQixDQUFDLENBQUMsRUFBRSxDQUFDLFVBQVUsRUFBRSxnQ0FBZ0MsRUFBRSxZQUFZO01BQ25GLFVBQVUsQ0FBQyxDQUFDO0lBQ2hCLENBQUMsQ0FBQztFQUNOOztFQUVBOztFQUVBLFNBQVMsUUFBUSxHQUFHO0lBQ2hCLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsWUFBWTtNQUN4QyxJQUFJLEdBQUcsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQztNQUM3QixDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDO01BQ3pDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDO01BQzFCLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUM7TUFDM0QsQ0FBQyxDQUFDLDZDQUE2QyxHQUFHLEdBQUcsR0FBRyxJQUFJLENBQUMsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDO01BQ2hGLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxHQUFHLENBQUM7TUFDckQsSUFBSSxHQUFHLEtBQUssZUFBZSxFQUFFO1FBQ3pCLFNBQVMsQ0FBQyxJQUFJLENBQUM7TUFDbkI7TUFDQSxJQUFJLEdBQUcsS0FBSyxVQUFVLEVBQUU7UUFDcEIsbUJBQW1CLENBQUMsQ0FBQztRQUNyQixhQUFhLENBQUMsWUFBWTtVQUN0QixRQUFRLENBQUMsQ0FBQztRQUNkLENBQUMsQ0FBQztNQUNOO0lBQ0osQ0FBQyxDQUFDO0VBQ047RUFFQSxTQUFTLGNBQWMsR0FBRztJQUN0QixPQUFPLENBQUMsQ0FBQyxzREFBc0QsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsSUFDNUUsUUFBUSxDQUFDLGVBQWUsS0FBSyxTQUFTO0VBQ2pEO0VBRUEsU0FBUyxvQkFBb0IsR0FBRztJQUM1QixPQUFPLENBQUMsQ0FBQyw0REFBNEQsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsSUFDbEYsUUFBUSxDQUFDLGVBQWUsS0FBSyxTQUFTO0VBQ2pEO0VBRUEsU0FBUyxlQUFlLEdBQUc7SUFDdkIsV0FBVyxDQUFDLFlBQVk7TUFDcEIsSUFBSSxjQUFjLENBQUMsQ0FBQyxFQUFFO1FBQ2xCLElBQUksQ0FBQztVQUFFLE9BQU8sRUFBRTtRQUFLLENBQUMsQ0FBQztRQUN2QjtNQUNKO01BQ0EsSUFBSSxvQkFBb0IsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLFVBQVUsS0FBSyxJQUFJLEVBQUU7UUFDckQsU0FBUyxDQUFDLElBQUksQ0FBQztNQUNuQjtNQUNBLElBQUksUUFBUSxDQUFDLGVBQWUsS0FBSyxTQUFTLEVBQUU7UUFDeEMsZ0JBQWdCLENBQUMsQ0FBQztNQUN0QjtJQUNKLENBQUMsRUFBRSxXQUFXLEdBQUcsSUFBSSxDQUFDO0VBQzFCOztFQUVBOztFQUVBLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxLQUFLLENBQUMsWUFBWTtJQUMxQixJQUFJLEdBQUcsUUFBUSxDQUFDLGNBQWMsQ0FBQyxvQkFBb0IsQ0FBQztJQUNwRCxJQUFJLENBQUMsSUFBSSxFQUFFO01BQ1A7SUFDSjtJQUNBLFFBQVEsQ0FBQyxDQUFDO0lBQ1YsZUFBZSxDQUFDLENBQUM7SUFDakIsY0FBYyxDQUFDLENBQUM7O0lBRWhCO0lBQ0EsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxRQUFRLEVBQUUsd0VBQXdFLEVBQUUsWUFBWTtNQUMzRyxJQUFJLE1BQU0sR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDO01BQ3BCLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxPQUFPLEVBQUU7UUFDakMsQ0FBQyxDQUFDLGNBQWMsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxZQUFZO1VBQzVELENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUMsV0FBVyxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsT0FBTyxDQUFDO1FBQ3hFLENBQUMsQ0FBQztNQUNOLENBQUMsTUFBTTtRQUNILE1BQU0sQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLENBQUMsV0FBVyxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsT0FBTyxDQUFDO01BQ3ZFO0lBQ0osQ0FBQyxDQUFDO0lBRUYsQ0FBQyxDQUFDLDJCQUEyQixDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxZQUFZLENBQUM7SUFDeEQsQ0FBQyxDQUFDLDBCQUEwQixDQUFDLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxZQUFZO01BQ25ELEtBQUssQ0FBQyxVQUFVLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7TUFDMUMsYUFBYSxDQUFDLENBQUM7SUFDbkIsQ0FBQyxDQUFDO0lBQ0YsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSw0QkFBNEIsRUFBRSxZQUFZO01BQzFFLElBQUksR0FBRyxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO01BQ3pDLElBQUksR0FBRyxFQUFFO1FBQ0wsWUFBWSxDQUFDLE1BQU0sRUFBRSxHQUFHLENBQUM7TUFDN0IsQ0FBQyxNQUFNO1FBQ0gsWUFBWSxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsVUFBVSxDQUFDO01BQ3pDO0lBQ0osQ0FBQyxDQUFDO0lBQ0YsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxZQUFZO01BQUUsSUFBSSxDQUFDLENBQUM7SUFBRSxDQUFDLENBQUM7SUFDM0QsQ0FBQyxDQUFDLGtCQUFrQixDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxZQUFZO01BQzFDLElBQUksS0FBSyxDQUFDLE1BQU0sSUFBSSxVQUFVLEVBQUU7UUFDNUIsS0FBSyxDQUFDLE1BQU0sSUFBSSxVQUFVO1FBQzFCLElBQUksQ0FBQyxDQUFDO01BQ1Y7SUFDSixDQUFDLENBQUM7SUFDRixDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVk7TUFDMUMsSUFBSSxLQUFLLENBQUMsTUFBTSxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUMsTUFBTSxHQUFHLEtBQUssQ0FBQyxLQUFLLEVBQUU7UUFDckQsS0FBSyxDQUFDLE1BQU0sSUFBSSxVQUFVO1FBQzFCLElBQUksQ0FBQyxDQUFDO01BQ1Y7SUFDSixDQUFDLENBQUM7SUFDRixDQUFDLENBQUMscUJBQXFCLENBQUMsQ0FBQyxFQUFFLENBQUMsUUFBUSxFQUFFLGFBQWEsQ0FBQztJQUNwRCxDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxFQUFFLENBQUMsUUFBUSxFQUFFLGFBQWEsQ0FBQztJQUNyRCxDQUFDLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxFQUFFLENBQUMsUUFBUSxFQUFFLFNBQVMsQ0FBQztJQUM1QyxDQUFDLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxFQUFFLENBQUMsUUFBUSxFQUFFLGVBQWUsQ0FBQztJQUNuRCxDQUFDLENBQUMsd0JBQXdCLENBQUMsQ0FBQyxFQUFFLENBQUMsUUFBUSxFQUFFLGVBQWUsQ0FBQztJQUV6RCxpQkFBaUIsQ0FBQyxDQUFDO0lBQ25CLGFBQWEsQ0FBQyxDQUFDO0lBQ2Ysa0JBQWtCLENBQUMsQ0FBQztJQUNwQixrQkFBa0IsQ0FBQyxDQUFDO0lBQ3BCLENBQUMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVk7TUFBRSxZQUFZLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxVQUFVLENBQUM7SUFBRSxDQUFDLENBQUM7SUFDcEYsQ0FBQyxDQUFDLHdEQUF3RCxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxZQUFZLENBQUM7SUFDckYsQ0FBQyxDQUFDLHVCQUF1QixDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxZQUFZO01BQy9DLENBQUMsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUM7TUFDL0MsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQztJQUMzQyxDQUFDLENBQUM7SUFDRixDQUFDLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVk7TUFDOUMsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztNQUM5QixDQUFDLENBQUMsdUJBQXVCLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQztJQUNuRCxDQUFDLENBQUM7SUFDRixDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxXQUFXLENBQUM7SUFDMUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsa0JBQWtCLEVBQUUsVUFBVSxLQUFLLEVBQUU7TUFDaEUsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDO01BQ3RCLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUSxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLEVBQUU7UUFBRTtNQUFRO01BQ2xFLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO01BQ3hELENBQUMsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO01BQ2xDLGNBQWMsQ0FBQyxDQUFDO0lBQ3BCLENBQUMsQ0FBQztJQUNGLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsZ0JBQWdCLENBQUM7SUFDakQsQ0FBQyxDQUFDLHNDQUFzQyxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxjQUFjLENBQUM7SUFDckUsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUscUJBQXFCLENBQUM7SUFDckQsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxZQUFZO01BQ3hDLElBQUksS0FBSyxDQUFDLFNBQVMsRUFBRTtRQUNqQixjQUFjLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDO01BQy9DO0lBQ0osQ0FBQyxDQUFDO0lBQ0YsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsaUJBQWlCLENBQUM7SUFDakQsQ0FBQyxDQUFDLHVDQUF1QyxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxxQkFBcUIsQ0FBQztJQUM3RSxDQUFDLENBQUMsdUNBQXVDLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLFlBQVk7TUFDL0QsWUFBWSxDQUFDLENBQUM7TUFDZCxDQUFDLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDO0lBQ3JDLENBQUMsQ0FBQztJQUNGLENBQUMsQ0FBQywwQ0FBMEMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsWUFBWTtNQUNsRSxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDO0lBQ3hDLENBQUMsQ0FBQztJQUVGLFdBQVcsQ0FBQyxZQUFZO01BQ3BCLGFBQWEsQ0FBQyxDQUFDO01BQ2YsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUM7TUFDN0IsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUM7TUFDN0IsUUFBUSxDQUFDLElBQUksQ0FBQztNQUNkLFNBQVMsQ0FBQyxDQUFDO01BQ1gsSUFBSSxDQUFDLENBQUM7SUFDVixDQUFDLENBQUM7SUFDRixlQUFlLENBQUMsQ0FBQztFQUNyQixDQUFDLENBQUM7QUFDTixDQUFDLEVBQUMsQ0FBQyIsImlnbm9yZUxpc3QiOltdfQ==

