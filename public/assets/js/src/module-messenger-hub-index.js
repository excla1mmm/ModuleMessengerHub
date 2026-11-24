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
            case 'today': return { from: todayStart, to: now };
            case 'yesterday': return { from: todayStart - 86400, to: todayStart - 1 };
            case '7days': return { from: todayStart - 6 * 86400, to: now };
            case '30days': return { from: todayStart - 29 * 86400, to: now };
            default: return { from: 0, to: 0 };
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
            error: (response && response.data && response.data.error) || 'http_' + status,
            messages: (response && response.messages && response.messages.error) || []
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
                    inGroup.push({ value: type.type, text: names[type.type] || type.type });
                });
            });
            if (inGroup.length > 0) {
                items.push({ group: sourceGroupName(group) });
                inGroup.forEach(function (item) {
                    items.push(item);
                });
            }
        });
        $('#mh-journal-filters .mh-filter-type').dropdown({
            values: menuToValues(items),
            placeholder: t('module_messenger_hub_FilterAllTypes'),
            onChange: function (value) {
                state.eventType = String(value || '');
                reload();
            }
        });
    }

    function menuToValues(items) {
        return items.map(function (item) {
            if (item.group) {
                return { type: 'header', name: item.group };
            }
            return { name: item.text, value: item.value };
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
    var CLOUD_AI_REASON_GROUPS = [
        ['module_messenger_hub_WizardReasonGroupMoney', ['insufficient_funds', 'low_balance']],
        ['module_messenger_hub_WizardReasonGroupLicense', ['license_missing', 'auth_invalid']],
        ['module_messenger_hub_WizardReasonGroupLimits', ['daily_limit_reached', 'model_unavailable']],
        ['module_messenger_hub_WizardReasonGroupSource', ['source_unavailable']],
        ['module_messenger_hub_WizardReasonGroupManual', ['manual']]
    ];

    function cloudAiReasons(includeManual) {
        var reasons = [];
        CLOUD_AI_REASON_GROUPS.forEach(function (group) {
            group[1].forEach(function (reason) {
                if (includeManual || reason !== 'manual') { reasons.push(reason); }
            });
        });
        return reasons;
    }

    function moduleStatusOf(item) {
        var subject = item && item.payload && item.payload.subject ? item.payload.subject : {};
        return subject.module_status && typeof subject.module_status === 'object' ? subject.module_status : null;
    }

    /** One sentence for an event type + (code, ref); an unknown pair gets a neutral line, never the raw code. */
    function statusPhrase(eventType, status) {
        var code = String((status && status.code) || '');
        var ref = String((status && status.ref) || '');
        var key = STATUS_RECOVERY_KEYS[eventType]
            || (code === 'processing_paused' ? STATUS_PAUSE_KEYS[ref] : null)
            || STATUS_CODE_KEYS[code]
            || 'MessageStatusUnknown';
        return t('module_messenger_hub_' + key);
    }

    function statusCounterNotes(status) {
        var counters = status && status.counters ? status.counters : {};
        var notes = [];
        if (typeof counters.workers_online === 'number' && typeof counters.workers_total === 'number') {
            notes.push(tf('module_messenger_hub_MessageStatusWorkersCounters', { online: counters.workers_online, total: counters.workers_total }));
        }
        if (typeof counters.jobs_waiting === 'number') {
            notes.push(tf('module_messenger_hub_MessageStatusJobsWaiting', { count: counters.jobs_waiting }));
        }
        if (typeof counters.incidents_open === 'number') {
            notes.push(tf('module_messenger_hub_MessageStatusIncidentsOpen', { count: counters.incidents_open }));
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
                return source.update_to
                    ? tf('module_messenger_hub_SourceStateOutdatedTo', { version: source.update_to })
                    : t('module_messenger_hub_SourceStateOutdatedAny');
            default:
                return source.availability_name || '';
        }
    }

    function buildPeriodMenu() {
        $('#mh-journal-filters .mh-filter-period').dropdown({
            values: [
                { name: t('module_messenger_hub_PeriodToday'), value: 'today', selected: true },
                { name: t('module_messenger_hub_PeriodYesterday'), value: 'yesterday' },
                { name: t('module_messenger_hub_Period7Days'), value: '7days' },
                { name: t('module_messenger_hub_Period30Days'), value: '30days' },
                { name: t('module_messenger_hub_PeriodAll'), value: 'all' }
            ],
            onChange: function (value) {
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
        if (state.eventType !== '') { params.event_type = state.eventType; }
        if (bounds.from > 0) { params.date_from = bounds.from; }
        if (bounds.to > 0) { params.date_to = bounds.to; }

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
        return '<colgroup><col style="width:36px"><col style="width:104px"><col style="width:240px"><col><col style="width:160px"></colgroup>'
            + '<thead><tr><th></th>'
            + '<th>' + esc(t('module_messenger_hub_ColumnTime')) + '</th>'
            + '<th>' + esc(t('module_messenger_hub_ColumnEvent')) + '</th>'
            + '<th></th>'
            + '<th>' + esc(t('module_messenger_hub_ColumnDelivery')) + '</th>'
            + '</tr></thead>';
    }

    function renderSkeleton() {
        var rows = '';
        for (var i = 0; i < 3; i++) {
            rows += '<tr class="mh-skel-row"><td></td><td><span class="mh-skel" style="width:36px"></span></td>'
                + '<td><span class="mh-skel" style="width:160px"></span></td>'
                + '<td><span class="mh-skel" style="width:70%"></span></td>'
                + '<td><span class="mh-skel" style="width:96px;height:20px;border-radius:5px"></span></td></tr>';
        }
        $('#mh-journal-table').html('<div class="mh-table-wrap"><table class="ui table mh-journal-table" aria-busy="true">'
            + journalTableHead() + '<tbody>' + rows + '</tbody></table></div>');
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
            var call = (item.payload && item.payload.subject && item.payload.subject.call) || {};
            if (call.missed_linkedid && !index[call.missed_linkedid]) {
                index[call.missed_linkedid] = item.occurred_at;
            }
        });
        return index;
    }

    function callbackTime(item) {
        var call = (item.payload && item.payload.subject && item.payload.subject.call) || {};
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
        $('#mh-journal-table').html('<div class="mh-table-wrap"><table class="ui selectable table mh-journal-table">'
            + journalTableHead() + '<tbody>' + rows + '</tbody></table></div>');

        $('#mh-journal-table tbody tr.mh-event-row').on('click', function () {
            toggleRow($(this).data('id'));
        });
        $('#mh-journal-table').off('click.retry').on('click.retry', '[data-action="retry-event"]', function (event) {
            event.stopPropagation();
            var eventId = $(this).data('event-id');
            var $button = $(this).prop('disabled', true);
            apiPost('/events/' + eventId + ':retry', {}, function (data) {
                showToast(tf('module_messenger_hub_DeliveryRetried', { count: data.retried || 0 }));
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
            $('#mh-journal-error').html(
                '<div class="ui negative message" role="alert">' + ICON_ERROR
                + '<div class="mh-grow">' + esc(hint) + '</div>'
                + '<button class="ui basic button mh-on-message" type="button" id="mh-journal-retry-inline">'
                + esc(t('module_messenger_hub_CommonRetry')) + '</button></div>'
            );
            $('#mh-journal-retry-inline').on('click', function () { load(); });
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
                    return { text: t('module_messenger_hub_BannerBotDeleted'), botId: 0 };
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
        $('#mh-journal-banner').html('<div class="ui negative message mh-banner" role="alert">' + ICON_ERROR
            + '<div class="mh-grow">' + esc(problem.text) + '</div>'
            + '<button class="ui basic button mh-on-message" type="button" data-action="banner-fix" data-bot-id="' + problem.botId + '">'
            + esc(t('module_messenger_hub_BannerConnect')) + '</button></div>');
    }

    function isFailedDelivery(delivery) {
        return delivery.status === 'failed' || delivery.status === 'dropped';
    }

    function isUndelivered(item) {
        return (item.deliveries || []).some(isFailedDelivery);
    }

    function loadJournalBadge() {
        apiGet('/events', { date_from: startOfToday(), limit: 200 }, function (data) {
            var count = (data.items || []).filter(function (item) {
                return !isProbe(item) && isUndelivered(item);
            }).length;
            $('#mh-journal-badge').text(count > 99 ? '99+' : String(count))
                .attr('aria-label', tf('module_messenger_hub_JournalBadgeLabel', { count: count }))
                .attr('hidden', count > 0 ? null : true);
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
            case 'ai_supervisor.attention_call':
                if (facts.scores && facts.scores.quality !== null && facts.scores.quality !== undefined) {
                    return tf('module_messenger_hub_BriefScore', { score: facts.scores.quality });
                }
                return facts.summary || subject.client_number || '';
            case 'core.provider_down':
            case 'core.provider_up':
                var provider = subject.provider || {};
                return provider.username ? 'SIP «' + provider.username + '»' : (provider.host || provider.id || '');
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
                return (subject.worker && subject.worker.name) || facts.summary || '';
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
        var tpl = (advice && advice.message_tpl) || '';
        var text = t(tpl);
        if (tpl === '' || text === tpl) {
            return tpl;
        }
        var params = (advice && advice.params) || {};
        Object.keys(params).forEach(function (name) {
            text = text.split('%' + name + '%').join(String(params[name]));
        });
        // Never parse as HTML (params may carry user-entered names): strip tags as text, output is escaped later.
        return text.replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'")
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ').trim();
    }

    function renderRow(item, eventName) {
        var probe = isProbe(item) ? '<span class="mh-probe">' + esc(t('module_messenger_hub_ProbeTag')) + '</span>' : '';
        var brief = briefFor(item);
        var expanded = state.expandedId === item.id;
        return '<tr class="mh-event-row' + (expanded ? ' active' : '') + '" data-id="' + item.id + '" aria-expanded="' + (expanded ? 'true' : 'false') + '">'
            + '<td class="mh-chevron-cell">' + ICON_CHEVRON + '</td>'
            + '<td class="mh-cell-time">' + fmtCellTime(item.occurred_at) + '</td>'
            + '<td><div class="mh-event-cell"><span class="mh-truncate" title="' + esc(eventName) + '">' + esc(eventName) + '</span>' + probe + '</div></td>'
            + '<td class="mh-truncate mh-muted" title="' + esc(statusRawCode(item) !== '' ? brief + ' (' + statusRawCode(item) + ')' : brief) + '">' + esc(brief) + '</td>'
            + '<td>' + deliveryCell(item) + '</td>'
            + '</tr>';
    }

    // 3–4 human fields; technical ones (event type, call ID, source) stay out of the interface.
    function detailFields(item) {
        var subject = item.payload && item.payload.subject ? item.payload.subject : {};
        var facts = item.payload && item.payload.facts ? item.payload.facts : {};
        var fields = [];
        var employees = (subject.employees || []).map(fullEmployee).join(', ');
        if (employees !== '') { fields.push([t('module_messenger_hub_DetailEmployee'), employees]); }
        if (subject.client_number) { fields.push([t('module_messenger_hub_DetailClient'), subject.client_number]); }
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
        if (facts.summary) { fields.push([t('module_messenger_hub_DetailSummary'), facts.summary]); }
        if (subject.module_status) {
            fields.push([t('module_messenger_hub_DetailSummary'),
                [statusPhrase(item.event_type, subject.module_status)].concat(statusCounterNotes(subject.module_status)).join('. ')]);
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
            html += '<dt class="mh-truncate">' + esc(recipientTitle(delivery)) + '</dt>'
                + '<dd' + (status.bad ? ' class="mh-error-text"' : '') + (rawCode !== '' ? ' title="' + esc(rawCode).replace(/"/g, '&quot;') + '"' : '') + '>'
                + esc(status.text)
                + (audio ? '<div class="mh-meta' + (audio.bad ? ' mh-error-text' : '') + '"'
                    + (audio.code !== '' ? ' title="' + esc(audio.code).replace(/"/g, '&quot;') + '"' : '') + '>' + esc(audio.text) + '</div>' : '')
                + '</dd>';
            if (delivery.status === 'failed' && !delivery.bot_deleted && !delivery.chat_deleted) {
                retryable = true;
            }
        });
        html += '</dl>';
        if (retryable) {
            html += '<button class="ui basic button" type="button" data-action="retry-event" data-event-id="' + item.id + '">'
                + esc(t('module_messenger_hub_DeliveryRetry')) + '</button>';
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
        var counts = { total: 0, sent: 0, failed: 0, pending: 0, resolved: 0 };
        (item.deliveries || []).forEach(function (delivery) {
            counts.total++;
            if (isFailedDelivery(delivery)) { counts.failed++; }
            else if (delivery.status === 'pending' || delivery.status === 'sending') { counts.pending++; }
            else if (delivery.status === 'cancelled') { counts.resolved++; }
            else { counts.sent++; }
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
            return { bad: true, text: t('module_messenger_hub_DeliveryNotDelivered') + (reason !== '' ? ' · ' + reason : '') };
        }
        if (delivery.status === 'pending' || delivery.status === 'sending') {
            return { bad: false, text: t('module_messenger_hub_TestQueued') + (delivery.next_attempt_at > 0
                ? ' · ' + tf('module_messenger_hub_DeliveryNext', { time: fmtCellText(delivery.next_attempt_at) })
                : '') };
        }
        if (delivery.status === 'cancelled') {
            return { bad: false, text: t('module_messenger_hub_DeliveryStatusCancelled') };
        }
        if (delivery.status === 'retracted') {
            return { bad: false, text: t('module_messenger_hub_DeliveryStatusRetracted') };
        }
        if (delivery.status === 'retract_failed') {
            return { bad: true, text: t('module_messenger_hub_DeliveryStatusRetractFailed') };
        }
        return { bad: false, text: t('module_messenger_hub_TestDelivered') };
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
        if (!a || !a.state || a.state === 'none') { return null; }
        var text;
        var bad = false;
        var total = Number(a.parts) || 0;
        if (a.state === 'pending') {
            text = t('module_messenger_hub_AttachQueued');
        } else if (a.state === 'sent') {
            text = total > 1
                ? tf('module_messenger_hub_AttachPartial', { sent: a.sent, total: total })
                : t('module_messenger_hub_AttachSent');
        } else if (a.state === 'partial') {
            text = tf('module_messenger_hub_AttachPartial', { sent: a.sent, total: total });
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
        return { text: t('module_messenger_hub_AttachLabel') + ': ' + text, code: a.code || '', bad: bad };
    }

    function deliveryReason(delivery) {
        if (delivery.bot_deleted) { return t('module_messenger_hub_DeliveryBotDeleted'); }
        if (delivery.chat_deleted) { return t('module_messenger_hub_DeliveryChatDeleted'); }
        var code = delivery.last_error_code || '';
        if (code === 'telegram.401.unauthorized') { return t('module_messenger_hub_BotStatusTokenInvalid'); }
        if (code === 'telegram.403.kicked' || code === 'telegram.403.blocked' || code === 'telegram.400.chat_not_found'
            || code === 'max.403.chat_denied' || code === 'max.404.not_found' || code === 'max.404.unknown') {
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
        apiPatch('/settings', { events_retention_days: days }, function () {
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
        return (failure && failure.error) ? failure.error : 'http_error';
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
        apiGet('/bots', { limit: 200 }, function (data) {
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
        var card = '<div class="mh-bot-card mh-bot-skeleton"><span class="mh-skel" style="width:32px;height:32px;border-radius:8px"></span>'
            + '<div style="flex:1;display:flex;flex-direction:column;gap:6px"><span class="mh-skel" style="width:50%"></span>'
            + '<span class="mh-skel" style="width:30%;height:8px"></span></div></div>';
        $('#mh-bots').html(card + card);
    }

    // Telegram / MAX tiles: the first-run screen and «Настройки» without bots (design v3).
    function messengerTiles() {
        return '<div class="mh-messenger-tiles">'
            + '<button type="button" class="mh-scenario mh-tile" data-action="add-bot" data-channel="telegram">'
            + '<span class="mh-messenger tg" aria-hidden="true">TG</span><b>Telegram</b></button>'
            + '<button type="button" class="mh-scenario mh-tile" data-action="add-bot" data-channel="max">'
            + '<span class="mh-messenger max" aria-hidden="true">MAX</span><b>MAX</b></button>'
            + '</div>';
    }

    function renderBots() {
        var $wrap = $('#mh-bots');
        if (state.botsError !== null && state.bots.length === 0) {
            $('#mh-bot-add').attr('hidden', true);
            $wrap.html('<div class="ui negative message" role="alert">' + ICON_ERROR
                + '<div class="mh-grow">' + esc(t('module_messenger_hub_BotsLoadFailed')) + '</div>'
                + '<button class="ui basic button mh-on-message" type="button" id="mh-bots-retry">'
                + esc(t('module_messenger_hub_CommonRetry')) + '</button></div>');
            $('#mh-bots-retry').on('click', function () { loadBots(); });
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
        if (bot.bot_username) { meta.push('@' + bot.bot_username); }
        meta.push(chatCount > 0 ? tf('module_messenger_hub_BotChatsCount', { count: chatCount }) : t('module_messenger_hub_BotChatsNone'));
        return '<div class="mh-bot-row' + (expanded ? ' is-open' : '') + '" data-bot-id="' + bot.id + '">'
            + '<div class="mh-bot-head" data-action="toggle" role="button" tabindex="0" aria-expanded="' + (expanded ? 'true' : 'false') + '">'
            + '<span class="mh-messenger ' + (bot.channel === 'max' ? 'max' : 'tg') + '" aria-hidden="true">' + (bot.channel === 'max' ? 'MAX' : 'TG') + '</span>'
            + '<div class="mh-bot-titles"><b class="mh-truncate">' + esc(bot.title) + '</b>'
            + '<span class="mh-meta mh-truncate">' + esc(meta.join(' · ')) + '</span></div>'
            + '<span class="mh-bot-status">' + botStatusCell(bot) + '</span>'
            + '<span class="mh-chevron" aria-hidden="true">'
            + '<svg class="mh-i" viewBox="0 0 16 16" style="transform:rotate(' + (expanded ? '180' : '0') + 'deg)"><path d="M3.5 6L8 10.5 12.5 6"/></svg>'
            + '</span></div>' + body + '</div>';
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
        return '<div class="ui warning message" role="note">'
            + '<svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.5v4M8 11h.01"/></svg>'
            + '<div>' + esc(t('module_messenger_hub_BotStatusCaError')) + '. '
            + esc(t('module_messenger_hub_BotCaErrorHint')) + '</div></div>';
    }

    function chatKindLabel(kind) {
        if (kind === 'private') { return t('module_messenger_hub_ChatTypePrivate'); }
        if (kind === 'channel') { return t('module_messenger_hub_ChatTypeChannel'); }
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
        return '<div class="mh-chat-row" data-chat-id="' + chat.id + '">'
            + '<span class="mh-chat-title"><span class="mh-truncate">' + esc(chat.title || chat.chat_id) + '</span>'
            + '<span class="mh-meta"> · ' + esc(chatKindLabel(chat.chat_kind)) + '</span></span>'
            + employeeSelect(chat)
            + '<span class="mh-chat-state">' + stateCell + '</span>'
            + '<label class="ui toggle checkbox' + (chat.enabled ? ' checked' : '') + (gone ? ' disabled' : '') + '" aria-label="' + esc(t('module_messenger_hub_BotEnableChat')) + '">'
            + '<input type="checkbox" class="hidden mh-chat-toggle"' + (chat.enabled ? ' checked' : '') + (gone ? ' disabled' : '') + '>'
            + '<span class="mh-track"></span></label>'
            + '</div>';
    }

    function employeeSelect(chat) {
        var options = '<option value="0">' + esc(t('module_messenger_hub_ChatNoEmployee')) + '</option>';
        var found = false;
        for (var i = 0; i < state.employees.length; i++) {
            var employee = state.employees[i];
            var selected = Number(employee.id) === Number(chat.linked_user_id);
            if (selected) { found = true; }
            options += '<option value="' + employee.id + '"' + (selected ? ' selected' : '') + '>' + esc(employee.label) + '</option>';
        }
        if (!found && Number(chat.linked_user_id) > 0) {
            options += '<option value="' + chat.linked_user_id + '" selected>#' + chat.linked_user_id + '</option>';
        }
        return '<select class="mh-employee-select" aria-label="' + esc(t('module_messenger_hub_ChatEmployee')) + '">' + options + '</select>';
    }

    function renderBotActions(bot) {
        return '<div class="mh-bot-actions">'
            + '<a href="#" data-action="connect">' + esc(t('module_messenger_hub_BotActionsConnect')) + '</a>'
            + '<a href="#" data-action="test">' + esc(t('module_messenger_hub_BotActionsTest')) + '</a>'
            + '<a href="#" data-action="edit">' + esc(t('module_messenger_hub_BotActionsEdit')) + '</a>'
            + '</div>';
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
        $wrap.on('click', '[data-action="add-bot"]', function () { openBotModal('add', null, $(this).data('channel')); });
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
            patchBot(botId, { chats: [{ id: Number(chatId), enabled: enabled }] }, null, function () {
                loadBots(true);
                showToast(t('module_messenger_hub_CommonSaveFailed'));
            });
        });
        $wrap.on('change', '.mh-employee-select', function () {
            var botId = $(this).closest('.mh-bot-row').data('bot-id');
            var chatId = $(this).closest('.mh-chat-row').data('chat-id');
            patchBot(botId, { chats: [{ id: Number(chatId), linked_user_id: Number($(this).val()) }] }, null, function () {
                loadBots(true);
                showToast(t('module_messenger_hub_CommonSaveFailed'));
            });
        });
    }

    function patchBot(botId, payload, onSuccess, onFailure) {
        apiPatch('/bots/' + botId, payload, function (bot) {
            replaceBot(bot);
            renderBots();
            if (onSuccess) { onSuccess(bot); }
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
        coreGet('/extensions', { limit: 500 }, function (data) {
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
                var name = item.callerid || item.number || ('#' + userId);
                var number = item.number ? String(item.number) : '';
                var label = (number !== '' && String(name).indexOf(number) === -1) ? name + ' (' + number + ')' : name;
                list.push({ id: userId, label: label });
            }
            list.sort(function (a, b) { return a.label.localeCompare(b.label); });
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
            channel: mode === 'edit' && bot ? (bot.channel || 'telegram') : (channel === 'max' ? 'max' : 'telegram'),
            draftId: 0,
            saved: false,
            tokenChanged: false,
            busy: false
        };
        $('#mh-bot-check-message').empty();
        $('#mh-bot-title-field').removeClass('error');
        $('#mh-bot-token-row').removeClass('error');
        $('#mh-bot-modal-title').text(mode === 'edit' ? tf('module_messenger_hub_BotEditTitle', { title: bot.title }) : t('module_messenger_hub_BotAddTitle'));
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
        $('#mh-bot-modal').modal({ closable: false }).modal('show');
        $('#mh-bot-title').trigger('focus');
    }

    function syncBotChannel() {
        var modal = state.botModal;
        if (!modal) { return; }
        $('#mh-bot-modal .mh-channel-card').each(function () {
            var channel = String($(this).data('channel'));
            var selected = channel === modal.channel;
            var locked = modal.mode === 'edit' && !selected;
            $(this).toggleClass('is-selected', selected).toggleClass('is-disabled', locked)
                .attr('aria-disabled', locked ? 'true' : null);
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
        var cls = kind === 'ok' ? 'ui positive message' : (kind === 'warn' ? 'ui warning message' : 'ui negative message');
        var icon = kind === 'ok'
            ? '<circle cx="8" cy="8" r="6.25"/><path d="M5.5 8.2l1.8 1.8 3.3-3.6"/>'
            : '<circle cx="8" cy="8" r="6.25"/><path d="M6 6l4 4M10 6l-4 4"/>';
        $('#mh-bot-check-message').html('<div class="' + cls + '" role="status">'
            + '<svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true">' + icon + '</svg>'
            + '<div>' + esc(text) + '</div></div>');
    }

    function botCheckMessage(bot) {
        if (bot.status === 'ok') {
            return { kind: 'ok', text: tf('module_messenger_hub_BotCheckedOk', {
                username: bot.bot_username || bot.bot_external_id,
                name: bot.bot_username ? '@' + bot.bot_username : bot.title
            }) };
        }
        if (bot.last_error_code === 'other_bot') {
            return { kind: 'warn', text: tf('module_messenger_hub_BotCheckedOther', {
                username: bot.bot_username || '',
                bot: bot.title
            }) };
        }
        if (bot.status === 'token_invalid') {
            return { kind: 'err', text: t('module_messenger_hub_BotChecked401') };
        }
        if (bot.status === 'ca_error' || isMaxTlsCode(bot.last_error_code)) {
            return { kind: 'err', text: tlsErrorText() };
        }
        return { kind: 'warn', text: t('module_messenger_hub_BotCheckNetwork') + (bot.last_error_code ? ' (' + bot.last_error_code + ')' : '') };
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
        var done = function (bot) {
            state.botModal.bot = bot;
            state.botModal.draftId = bot.id;
            replaceBot(bot);
            var message = botCheckMessage(bot);
            showBotMessage(message.kind, message.text);
        };
        var failure = function (err) {
            if (err.field === 'token') {
                $('#mh-bot-token-row').addClass('error');
            }
            showBotMessage('err', failureText(err));
        };
        if (mode === 'add') {
            payload = { channel: state.botModal.channel, title: values.title, token: values.token };
            if (state.botModal.draftId > 0) {
                apiPatch('/bots/' + state.botModal.draftId, { title: values.title, token: values.token }, done, failure);
            } else {
                apiPost('/bots', payload, done, failure);
            }
            return;
        }
        if (values.tokenNew !== '') {
            apiPost('/bots/' + state.botModal.bot.id + ':checkToken', { token: values.tokenNew }, function (data) {
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
        var finish = function (bot) {
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
        var failure = function (err) {
            if (err.field === 'token') {
                $('#mh-bot-token-row').addClass('error');
            }
            showBotMessage('err', failureText(err));
        };
        if (mode === 'add') {
            var create = function (id) {
                apiPost('/bots/' + id + ':discoverChats', {}, function (bot) {
                    finish(bot);
                }, failure);
            };
            if (state.botModal.draftId > 0) {
                apiPatch('/bots/' + state.botModal.draftId, { title: values.title, token: values.token }, function (bot) {
                    replaceBot(bot);
                    create(bot.id);
                }, failure);
            } else {
                apiPost('/bots', { channel: state.botModal.channel, title: values.title, token: values.token }, function (bot) {
                    replaceBot(bot);
                    create(bot.id);
                }, failure);
            }
            return;
        }
        var payload = { title: values.title };
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
            apiDelete('/bots/' + modal.draftId, function () { loadBots(true); }, function () { loadBots(true); });
        } else {
            loadBots(true);
        }
    }

    function confirmDeleteBot() {
        var bot = state.botModal.bot;
        if (!bot) { return; }
        $('#mh-confirm-text').text(tf('module_messenger_hub_BotDeleteConfirm', { title: bot.title, count: (bot.chats || []).length }));
        $('#mh-confirm-modal').modal({ closable: true }).modal('show');
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
        if (!bot) { return; }
        state.chatModal = { botId: bot.id, bot: bot, timer: null, selected: {} };
        $('#mh-chat-modal-title').text(tf('module_messenger_hub_ChatConnectTitle', { title: bot.title }));
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
        $('#mh-chat-modal').modal({ closable: false }).modal('show');
        startDiscovery(bot.id, false);
    }

    function startDiscovery(botId, restart) {
        apiPost('/bots/' + botId + ':discoverChats', { restart: restart === true }, function (bot) {
            if (!state.chatModal) { return; }
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
            if (!state.chatModal) { return; }
            apiGet('/bots/' + state.chatModal.botId, {}, function (bot) {
                if (!state.chatModal) { return; }
                updateChatModal(bot);
                if (!bot.discovery.active) {
                    stopChatPoll();
                }
            }, function () { /* keep the last state */ });
        }, 2000);
    }

    function stopChatPoll() {
        if (state.chatModal && state.chatModal.timer !== null) {
            clearInterval(state.chatModal.timer);
            state.chatModal.timer = null;
        }
    }

    function updateChatModal(bot) {
        if (!state.chatModal) { return; }
        state.chatModal.bot = bot;
        replaceBot(bot);
        var discovery = bot.discovery || { active: false, status: 'idle', found: [] };
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
            if (checked) { selectedCount++; }
            html += '<label class="mh-found-row' + (item.already_connected ? ' is-connected' : '') + '" data-chat-row="' + (inBot ? inBot.id : 0) + '" data-chat-key="' + esc(item.chat_id) + '">'
                + '<span class="ui checkbox' + (checked ? ' checked' : '') + (item.already_connected ? ' disabled' : '') + '">'
                + '<input type="checkbox" class="hidden mh-found-check"' + (checked ? ' checked' : '') + (item.already_connected ? ' disabled' : '') + '>'
                + '<span class="mh-box"></span></span>'
                + '<span class="mh-found-title"><b class="mh-truncate">' + esc(item.title || item.chat_id) + '</b>'
                + '<span class="mh-meta">' + esc(chatKindLabel(item.chat_kind)) + '</span></span>'
                + '<span class="ui ' + (item.already_connected ? 'label' : 'blue label') + '">'
                + esc(item.already_connected ? t('module_messenger_hub_ChatConnectExists') : t('module_messenger_hub_ChatConnectNew')) + '</span></label>';
        }
        $('#mh-chat-found').html(html);
        $('#mh-chat-save').text(tf('module_messenger_hub_ChatConnectSave', { count: selectedCount }));
        $('#mh-chat-save').attr('disabled', selectedCount === 0 ? true : null);

        var statusText = '';
        var countdown = '';
        var progress = 0;
        if (discovery.active) {
            if (found.length > 0) {
                statusText = tf('module_messenger_hub_ChatConnectFound', { count: found.length });
            } else {
                statusText = t('module_messenger_hub_ChatConnectSearching');
            }
            countdown = tf('module_messenger_hub_ChatConnectRemaining', { time: fmtCountdown(discovery.remaining_sec) });
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
                statusText = tf('module_messenger_hub_ChatConnectTimeout', { count: found.length });
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
        $('#mh-chat-error').html('<div class="ui negative message" role="alert">'
            + '<svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M6 6l4 4M10 6l-4 4"/></svg>'
            + '<div>' + esc(text) + '</div></div>');
    }

    function bindChatFound() {
        $('#mh-chat-found').on('change', '.mh-found-check', function () {
            if (!state.chatModal) { return; }
            var key = String($(this).closest('.mh-found-row').data('chat-key'));
            state.chatModal.selected[key] = $(this).prop('checked');
            updateChatModal(state.chatModal.bot);
        });
    }

    function saveSelectedChats() {
        if (!state.chatModal) { return; }
        var bot = state.chatModal.bot;
        var patches = [];
        for (var i = 0; i < (bot.discovery.found || []).length; i++) {
            var item = bot.discovery.found[i];
            if (item.already_connected || state.chatModal.selected[item.chat_id] !== true) {
                continue;
            }
            var chat = findChatByExternal(bot, item.chat_id);
            if (chat) {
                patches.push({ id: chat.id, enabled: true, chat_kind: item.chat_kind, title: item.title });
            }
        }
        if (patches.length === 0) {
            return;
        }
        apiPatch('/bots/' + bot.id, { chats: patches }, function (saved) {
            apiPost('/bots/' + bot.id + ':discoverChats', { stop: true }, function () {
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
            apiPost('/bots/' + bot.id + ':discoverChats', { stop: true }, function () {
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
        if (!bot) { return; }
        state.testModal = { botId: bot.id, bot: bot, eventId: 0, chatIds: chatIds, timer: null, tries: 0 };
        $('#mh-test-list').html('<div class="mh-muted">' + esc(t('module_messenger_hub_TestRunning')) + '</div>');
        $('#mh-test-summary').text('');
        $('#mh-test-modal').modal({ closable: true, onHide: function () { stopTestPoll(); } }).modal('show');
        var payload = chatIds === null ? {} : { chat_ids: chatIds };
        apiPost('/bots/' + bot.id + ':sendTest', payload, function (data) {
            if (!state.testModal) { return; }
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
            if (!state.testModal) { return; }
            state.testModal.tries++;
            apiGet('/bots/' + state.testModal.botId, {}, function (bot) {
                if (!state.testModal) { return; }
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
                result.push({ chat: chats[i], delivery: delivery });
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
        if (delivery.status === 'sent') { return { cls: 'is-ok', text: t('module_messenger_hub_TestDelivered') }; }
        if (delivery.status === 'pending' || delivery.status === 'sending') { return { cls: '', text: t('module_messenger_hub_TestQueued') }; }
        return { cls: 'is-err', text: t('module_messenger_hub_TestError') };
    }

    function deliveryErrorText(code) {
        if (isMaxTlsCode(code)) { return tlsErrorText(); }
        if (code === 'telegram.401.unauthorized' || code === 'max.401.unauthorized') { return t('module_messenger_hub_BotChecked401'); }
        if (code === 'telegram.403.kicked' || code === 'telegram.403.blocked' || code === 'telegram.400.chat_not_found'
            || code === 'max.403.chat_denied' || code === 'max.404.not_found' || code === 'max.404.unknown') {
            return t('module_messenger_hub_ChatStatusGone');
        }
        if (code === 'telegram.429.rate_limit' || code === 'max.429.rate_limit') { return t('module_messenger_hub_ChatErrorRateLimit'); }
        if (code === 'stale') { return t('module_messenger_hub_ChatErrorStale'); }
        return code;
    }

    function renderTest(bot) {
        var list = testDeliveries(bot);
        var counts = { sent: 0, pending: 0, failed: 0 };
        var html = '';
        for (var i = 0; i < list.length; i++) {
            var chat = list[i].chat;
            var delivery = list[i].delivery;
            var label = deliveryStatusLabel(delivery);
            if (delivery.status === 'sent') { counts.sent++; }
            else if (delivery.status === 'pending' || delivery.status === 'sending') { counts.pending++; }
            else { counts.failed++; }
            var retry = (delivery.status === 'failed' || delivery.status === 'dropped')
                ? '<button class="ui basic button mh-test-retry" type="button" data-chat-id="' + chat.id + '">' + esc(t('module_messenger_hub_TestRetry')) + '</button>'
                : '';
            html += '<div class="mh-test-row">'
                + '<span class="mh-messenger ' + (bot.channel === 'max' ? 'max' : 'tg') + ' s" aria-hidden="true">' + (bot.channel === 'max' ? 'MAX' : 'TG') + '</span>'
                + '<div class="mh-test-title"><div class="mh-truncate">' + esc(chat.title || chat.chat_id) + '</div>'
                + (delivery.last_error_code ? '<div class="mh-meta mh-error-text">' + esc(deliveryErrorText(delivery.last_error_code)) + '</div>' : '')
                + '</div>'
                + '<span class="mh-test-state ' + label.cls + '">' + esc(label.text) + '</span>' + retry + '</div>';
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
            if (fieldSelector) { clearFieldError(fieldSelector); }
            showToast(t('module_messenger_hub_CommonSaved'));
        }, function (failure) {
            if (fieldSelector) {
                markFieldError(fieldSelector, failureText(failure));
            }
            if (revert) { revert(); }
        });
    }

    function savePublicUrl() {
        var value = String($('#mh-public-url-input').val() || '').trim();
        var previous = state.settings ? state.settings.pbx_public_url : '';
        if (value === '') {
            saveSetting({ pbx_public_url: '' }, '#mh-public-url-field');
            return;
        }
        if (!/^https?:\/\/\S+$/i.test(value)) {
            markFieldError('#mh-public-url-field', t('module_messenger_hub_SettingsPublicUrlInvalid'));
            return;
        }
        saveSetting({ pbx_public_url: value }, '#mh-public-url-field', function () {
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
        saveSetting({ proxy_url: value }, '#mh-proxy-field', function () {
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
        saveSetting({ max_ca_bundle_path: value }, '#mh-max-ca-field', function () {
            $('#mh-max-ca-input').val(previous);
        });
    }

    function saveMaskDefault() {
        var checked = $('#mh-mask-default input').prop('checked');
        saveSetting({ mask_phone_default: checked }, null, function () {
            $('#mh-mask-default input').prop('checked', !checked);
            $('#mh-mask-default').toggleClass('checked', !checked);
            showToast(t('module_messenger_hub_CommonSaveFailed'));
        });
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
            if (day < 1 || day > 365 || days.indexOf(day) >= 0) { valid = false; return; }
            days.push(day);
        });
        if (!valid || days.length === 0) {
            markFieldError('#mh-license-days-field', t('module_messenger_hub_SettingsLicenseDaysError'));
            return;
        }
        days.sort(function (a, b) { return b - a; });
        clearFieldError('#mh-license-days-field');
        apiPatch('/settings', { license_warn_days: days.join(',') }, function (data) {
            state.settings = data;
            $('#mh-license-days-input').val(data.license_warn_days || '');
            showToast(t('module_messenger_hub_CommonSaved'));
        }, function (failure) {
            markFieldError('#mh-license-days-field', failureText(failure));
            $('#mh-license-days-input').val(state.settings ? state.settings.license_warn_days : '');
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
        apiGet('/rules', { limit: 200 }, function (data) {
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
        var row = '<div class="mh-notif-row"><span class="mh-skel" style="width:36px;height:20px;border-radius:10px"></span>'
            + '<span class="mh-skel" style="width:40%"></span><span></span><span></span></div>';
        $('#mh-rules-list').html(row + row);
    }

    function sourceForRule(rule) {
        if (rule.source_id) {
            var byId = sourceById(rule.source_id);
            if (byId) { return byId; }
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
            $list.html('<div class="ui negative message" role="alert">' + ICON_ERROR
                + '<div class="mh-grow">' + esc(t('module_messenger_hub_RulesLoadFailed')) + '</div>'
                + '<button class="ui basic button mh-on-message" type="button" id="mh-rules-retry">'
                + esc(t('module_messenger_hub_CommonRetry')) + '</button></div>');
            $('#mh-rules-retry').on('click', function () { loadRules(); });
            return;
        }
        if (state.bots.length === 0 && state.rules.length === 0 && state.botsError === null) {
            setRuleAddVisible(false);
            $list.html('<div class="mh-onboard" role="status">'
                + '<h3 class="ui header mh-page-title">' + esc(t('module_messenger_hub_OnboardTitle')) + '</h3>'
                + messengerTiles() + '</div>');
            return;
        }
        if (state.rules.length === 0) {
            setRuleAddVisible(false);
            $list.html('<div class="mh-empty mh-empty-box" role="status">'
                + '<h3 class="ui header mh-page-title">' + esc(t('module_messenger_hub_RulesEmptyTitle')) + '</h3>'
                + '<button class="ui primary button" type="button" data-action="add">' + ICON_PLUS
                + esc(t('module_messenger_hub_RulesAdd')) + '</button></div>');
            return;
        }
        setRuleAddVisible(true);
        var groups = {};
        state.rules.forEach(function (rule) {
            var group = rule.group || 'pbx';
            if (GROUP_ORDER.indexOf(group) < 0) { group = 'pbx'; }
            (groups[group] = groups[group] || []).push(rule);
        });
        var order = GROUP_ORDER.filter(function (group) { return Boolean(groups[group]); });
        var html = '';
        if (state.rulesError !== null) {
            html += '<div class="ui negative message" role="alert">' + ICON_ERROR
                + '<div class="mh-grow">' + esc(t('module_messenger_hub_RulesLoadFailed')) + '</div>'
                + '<button class="ui basic button mh-on-message" type="button" id="mh-rules-retry-inline">'
                + esc(t('module_messenger_hub_CommonRetry')) + '</button></div>';
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
        $('#mh-rules-retry-inline').on('click', function () { loadRules(); });
    }

    function ruleChannel(rule) {
        var chats = rule.chats || [];
        if (chats.length > 0 && chats[0].channel) {
            return chats[0].channel;
        }
        var bot = chats.length > 0 ? botById(chats[0].bot_id) : (state.bots[0] || null);
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
                var cls = (source.availability === 'module_disabled' || source.availability === 'disabled' || source.availability === 'api_incompatible') ? 'ui yellow label' : 'ui red label';
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
        if (chats.length > 0 && chats.every(function (chat) { return chat.state === 'gone'; })) {
            return '<span class="ui red label">' + ICON_ERROR + esc(t('module_messenger_hub_ChatStatusGone')) + '</span>';
        }
        return null;
    }

    function renderRuleRow(rule) {
        var problem = ruleProblemLabel(rule);
        var ruleFirst = state.rules.length > 0 && Number(state.rules[0].id) === Number(rule.id);
        var ruleLast = state.rules.length > 0
            && Number(state.rules[state.rules.length - 1].id) === Number(rule.id);
        var right = '';
        if (problem !== null) {
            right = problem;
        } else if (rule.enabled && rule.last_event_at) {
            right = '<span class="mh-muted">' + fmtCellTime(rule.last_event_at) + '</span>';
        }
        var channel = ruleChannel(rule);

        return '<div class="mh-notif-row' + (rule.enabled ? '' : ' is-off') + '" role="listitem" data-rule-id="' + rule.id + '">'
            + '<label class="ui toggle checkbox' + (rule.enabled ? ' checked' : '') + '" aria-label="' + esc(rule.title) + '">'
            + '<input type="checkbox" class="hidden mh-rule-toggle"' + (rule.enabled ? ' checked' : '') + '>'
            + '<span class="mh-track"></span></label>'
            + '<span class="mh-notif-main">'
            + '<span class="mh-messenger s ' + (channel === 'max' ? 'max' : 'tg') + '" role="img" aria-label="' + (channel === 'max' ? 'MAX' : 'Telegram') + '">'
            + (channel === 'max' ? 'MAX' : 'TG') + '</span>'
            + '<a href="#" class="mh-notif-title mh-truncate" data-action="edit">' + esc(rule.title) + '</a></span>'
            + '<span class="mh-notif-status">' + right + '</span>'
            + '<div class="mh-rule-menu-wrap">'
            + '<button class="ui text button mh-rule-menu-btn" type="button" data-action="menu" aria-label="' + esc(t('module_messenger_hub_RuleMenuMore')) + '" aria-expanded="false">'
            + '<svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h.01M8 8h.01M12.5 8h.01" stroke-width="2.4"/></svg></button>'
            + '<div class="mh-rule-menu" hidden>'
            + '<a href="#" data-action="edit">' + esc(t('module_messenger_hub_RuleMenuEdit')) + '</a>'
            + (ruleFirst ? '' : '<a href="#" data-action="up">' + esc(t('module_messenger_hub_RuleMenuUp')) + '</a>')
            + (ruleLast ? '' : '<a href="#" data-action="down">' + esc(t('module_messenger_hub_RuleMenuDown')) + '</a>')
            + '<a href="#" data-action="delete">' + esc(t('module_messenger_hub_RuleMenuDelete')) + '</a>'
            + '</div></div></div>';
    }

    function bindRulesContainer() {
        var $wrap = $('#mh-rules-list');
        $wrap.on('click', '[data-action="add"]', function () { openRuleWizard(null); });
        $wrap.on('click', '[data-action="add-bot"]', function () { openBotModal('add', null, $(this).data('channel')); });
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
            moveRule(
                $(this).closest('.mh-notif-row').data('rule-id'),
                $(this).data('action') === 'up' ? -1 : 1
            );
        });
        $wrap.on('change', '.mh-rule-toggle', function () {
            var id = $(this).closest('.mh-notif-row').data('rule-id');
            var enabled = $(this).prop('checked');
            apiPatch('/rules/' + id, { enabled: enabled }, function (rule) {
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
        coreGet('/providers', { limit: 200 }, function (data) {
            var items = data.items || [];
            var list = [];
            for (var i = 0; i < items.length; i++) {
                var provider = items[i];
                var id = String(provider.id !== undefined ? provider.id : (provider.provider_id || ''));
                if (id === '') { continue; }
                var label = provider.description || provider.username || ('#' + id);
                list.push({ id: id, label: label });
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
        apiPost('/rules:changePriority', { order: ids }, function () {
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
        if (!rule) { return; }
        $('#mh-confirm-text').text(tf('module_messenger_hub_RuleDeleteConfirm', { title: rule.title }));
        $('#mh-confirm-modal').modal({ closable: true }).modal('show');
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
        return { user_ids: [], directions: [], providers: [], quality_score: null, reasons: null };
    }

    function normalizeRetract(options) {
        var config = options && options.retract_on_callback && typeof options.retract_on_callback === 'object'
            ? options.retract_on_callback
            : {};
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
        if (!filters || typeof filters !== 'object') {
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
        if (filters.quality_score && typeof filters.quality_score === 'object') {
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
        if (types.indexOf('ai_supervisor.attention_call') >= 0) { return ['none', 'fragments', 'recording']; }
        if (types.indexOf('core.voicemail') >= 0) { return ['none', 'recording']; }
        return [];
    }

    function ensureWizardData() {
        loadEmployees(function () {
            if (state.ruleWizard && state.ruleWizard.step === 2) { renderWizardConditions(); }
        });
        loadProviders(function () {
            if (state.ruleWizard && state.ruleWizard.step === 2) { renderWizardConditions(); }
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
            chatIds: rule
                ? (rule.chat_ids || []).map(Number).filter(function (id) {
                    return (rule.chats || []).some(function (chat) { return Number(chat.id) === id; });
                })
                : [],
            mask: rule ? !!(rule.options && rule.options.mask_phone === true)
                : !!(state.settings && state.settings.mask_phone_default === true),
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
            if (callTypes.indexOf(types[i]) >= 0) { return true; }
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
        return Object.keys(STATUS_PAIRS).some(function (problem) { return types.indexOf(STATUS_PAIRS[problem]) >= 0; });
    }

    // A module status scenario (problem and/or its recovery): step 2 offers «Сообщать о восстановлении».
    function wizardHasStatus(types) {
        return wizardHasRecovery(types) || Object.keys(STATUS_PAIRS).some(function (problem) { return types.indexOf(problem) >= 0; });
    }

    function wizardSupportsReasons(types) {
        return types.indexOf('cloud_ai.paused') >= 0 || types.indexOf('cloud_ai.resumed') >= 0;
    }

    function wizardSupportsSeverity(types) {
        return types.indexOf('cloud_stt.incident') >= 0;
    }

    // Adds or removes the recovery type of every problem type in the list.
    function wizardWithRecovery(types, on) {
        var recoveries = Object.keys(STATUS_PAIRS).map(function (problem) { return STATUS_PAIRS[problem]; });
        var result = types.filter(function (type) { return recoveries.indexOf(type) < 0; });
        if (on) {
            result.slice().forEach(function (type) {
                if (STATUS_PAIRS[type] && result.indexOf(STATUS_PAIRS[type]) < 0) { result.push(STATUS_PAIRS[type]); }
            });
        }
        return result;
    }

    // Step 2 exists only for scenarios with conditions; the others go straight to «Куда отправить».
    function wizardHasConditions(types) {
        return wizardSupportsEmployees(types) || wizardSupportsDirections(types) || wizardSupportsProviders(types)
            || wizardHasStatus(types)
            || types.indexOf('core.missed_call') >= 0 || types.indexOf('ai_supervisor.attention_call') >= 0;
    }

    function firstStepAfterScenario(types) {
        return wizardHasConditions(types) ? 2 : 3;
    }

    function renderWizard() {
        var w = state.ruleWizard;
        if (!w) { return; }
        $('#mh-wizard-step-1').attr('hidden', w.step !== 1);
        $('#mh-wizard-step-2').attr('hidden', w.step !== 2);
        $('#mh-wizard-step-3').attr('hidden', w.step !== 3);
        $('#mh-wizard').attr('data-step', String(w.step));
        var scenario = wizardScenario();
        var title;
        if (w.step === 1) {
            title = w.editId > 0 ? w.title : t('module_messenger_hub_WizardTitle');
        } else {
            title = w.editId > 0 ? w.title : (scenario ? scenario.name : t('module_messenger_hub_WizardTitle'));
        }
        $('#mh-wizard-title').text(title);
        // one basic button on the left: «Отмена» on the first step, «Назад» after it
        var canGoBack = w.step > 1 && !(w.editId > 0 && w.step === firstStepAfterScenario(w.eventTypes) && w.sourceId === '');
        $('#mh-wizard-prev').text(w.step === 1 ? t('module_messenger_hub_WizardCancel') : t('module_messenger_hub_WizardBackButton'))
            .data('mode', canGoBack ? 'back' : 'cancel');
        var isLast = w.step === 3;
        $('#mh-wizard-next').text(isLast
            ? (w.editId > 0 ? t('module_messenger_hub_WizardSave') : t('module_messenger_hub_WizardCreate'))
            : t('module_messenger_hub_WizardNext'));
        if (w.step === 1) { renderWizardScenarios(); }
        if (w.step === 2) { renderWizardConditions(); }
        if (w.step === 3) { renderWizardRecipients(); }
        updateWizardNext();
    }

    function updateWizardNext() {
        var w = state.ruleWizard;
        if (!w) { return; }
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
        key: '<circle cx="5.5" cy="8" r="2.5"/><path d="M8 8h6M12 8v2.5M10 8v2"/>'
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
        'core.pbx_started': 'bolt',
        'core.config_changed': 'gear',
        'core.external_ip_changed': 'globe',
        'core.license_expiring': 'key'
    };

    function scenarioIcon(sourceId) {
        var paths = SCENARIO_ICONS[SCENARIO_ICON_BY_SOURCE[sourceId] || 'warning'];
        return '<span class="mh-scenario-icon"><svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true">' + paths + '</svg></span>';
    }

    function renderWizardScenarios() {
        var w = state.ruleWizard;
        var groups = GROUP_ORDER.filter(function (group) {
            return state.sources.some(function (source) { return source.group === group; });
        });
        var html = '';
        groups.forEach(function (group) {
            var sources = state.sources.filter(function (source) { return source.group === group; });
            if (groups.length > 1) {
                html += '<h3 class="mh-group-title">' + esc(sourceGroupName(group)) + '</h3>';
            }
            html += '<div class="mh-scenario-grid">';
            sources.forEach(function (source) {
                var disabled = ['module_missing', 'module_disabled', 'api_forbidden', 'api_incompatible', 'error', 'disabled']
                    .indexOf(source.availability) >= 0;
                var selected = w.sourceId === source.id;
                // Unavailable scenario: only the reason, no action (user decision Q14).
                html += '<button type="button" class="mh-scenario' + (disabled ? ' is-disabled' : '') + (selected ? ' is-selected' : '')
                    + '" data-source-id="' + esc(source.id) + '" aria-pressed="' + (selected ? 'true' : 'false') + '"'
                    + (disabled ? ' disabled aria-disabled="true"' : '') + '>'
                    + scenarioIcon(source.id)
                    + '<span class="mh-scenario-text"><b>' + esc(source.name) + '</b>'
                    + (disabled ? '<span class="mh-meta">' + esc(sourceStateText(source)) + '</span>' : '')
                    + '</span></button>';
            });
            html += '</div>';
        });
        $('#mh-wizard-scenarios').html(html);
    }

    // ---- step 2: conditions (no hints; an empty choice means «все») ----

    function renderWizardConditions() {
        var w = state.ruleWizard;
        if (!w) { return; }
        var html = '';
        if (wizardSupportsEmployees(w.eventTypes)) {
            html += '<div class="field' + (state.employeesFailed ? ' error' : '') + '" id="mh-cond-employees-field">'
                + '<label>' + esc(t('module_messenger_hub_WizardEmployees')) + '</label>'
                + '<div class="ui multiple search selection dropdown mh-cond-dropdown" id="mh-cond-employees" tabindex="0">'
                + '<input type="hidden"><span class="default text">' + esc(t('module_messenger_hub_FilterAll')) + '</span><div class="menu"></div></div>'
                + (state.employeesFailed
                    ? '<span class="mh-help">' + esc(t('module_messenger_hub_WizardListFailed'))
                        + ' <a href="#" data-action="retry-employees">' + esc(t('module_messenger_hub_CommonRetry')) + '</a></span>'
                    : '')
                + '</div>';
        }
        if (wizardSupportsDirections(w.eventTypes)) {
            var directions = [
                ['incoming', 'module_messenger_hub_WizardDirectionIncoming'],
                ['outgoing', 'module_messenger_hub_WizardDirectionOutgoing'],
                ['internal', 'module_messenger_hub_WizardDirectionInternal']
            ];
            html += '<div class="field"><label>' + esc(t('module_messenger_hub_WizardDirections')) + '</label>'
                + '<div class="mh-seg" role="group" aria-label="' + esc(t('module_messenger_hub_WizardDirections')) + '">';
            directions.forEach(function (pair) {
                var pressed = w.filters.directions.indexOf(pair[0]) >= 0;
                html += '<button type="button" data-direction="' + pair[0] + '" aria-pressed="' + (pressed ? 'true' : 'false') + '">'
                    + esc(t(pair[1])) + '</button>';
            });
            html += '</div></div>';
        }
        if (wizardSupportsProviders(w.eventTypes)) {
            html += '<div class="field"><label>' + esc(t('module_messenger_hub_WizardProviders')) + '</label>'
                + '<div class="ui multiple search selection dropdown mh-cond-dropdown" id="mh-cond-providers" tabindex="0">'
                + '<input type="hidden"><span class="default text">' + esc(t('module_messenger_hub_FilterAll')) + '</span><div class="menu"></div></div></div>';
        }
        if (w.eventTypes.indexOf('ai_supervisor.attention_call') >= 0) {
            var range = w.filters.quality_score || {};
            html += '<div class="field"><label>' + esc(t('module_messenger_hub_WizardQuality')) + '</label>'
                + '<div class="mh-inline-inputs">'
                + '<span>' + esc(t('module_messenger_hub_WizardQualityFrom')) + '</span><input type="number" min="0" max="100" class="mh-quality-min mh-input-xs" value="' + (range.min !== undefined ? range.min : '') + '">'
                + '<span>' + esc(t('module_messenger_hub_WizardQualityTo')) + '</span><input type="number" min="0" max="100" class="mh-quality-max mh-input-xs" value="' + (range.max !== undefined ? range.max : '') + '">'
                + '</div></div>';
        }
        if (wizardSupportsSeverity(w.eventTypes)) {
            html += '<div class="field"><label>' + esc(t('module_messenger_hub_WizardSeverity')) + '</label>'
                + '<div class="mh-seg" role="group" aria-label="' + esc(t('module_messenger_hub_WizardSeverity')) + '">';
            [['warning', 'module_messenger_hub_WizardSeverityWarning'], ['critical', 'module_messenger_hub_WizardSeverityCritical']].forEach(function (pair) {
                html += '<button type="button" data-severity="' + pair[0] + '" aria-pressed="' + (w.minSeverity === pair[0] ? 'true' : 'false') + '">'
                    + esc(t(pair[1])) + '</button>';
            });
            html += '</div></div>';
        }
        if (wizardSupportsReasons(w.eventTypes)) {
            var chosen = w.filters.reasons || [];
            html += '<div class="field" id="mh-cond-reasons"><label>' + esc(t('module_messenger_hub_WizardReasons')) + '</label>';
            CLOUD_AI_REASON_GROUPS.forEach(function (group) {
                html += '<div class="mh-reason-group"><div class="mh-reason-title">' + esc(t(group[0])) + '</div>';
                group[1].forEach(function (reason) {
                    html += '<label class="mh-reason-check"><input type="checkbox" data-reason="' + reason + '"'
                        + (chosen.indexOf(reason) >= 0 ? ' checked' : '') + '>'
                        + '<span>' + esc(t('module_messenger_hub_' + STATUS_PAUSE_KEYS[reason])) + '</span></label>';
                });
                html += '</div>';
            });
            html += '</div>';
        }
        if (wizardHasStatus(w.eventTypes)) {
            html += '<div class="mh-switch-row mh-recover-row">'
                + '<label class="ui toggle checkbox' + (w.recover ? ' checked' : '') + '" id="mh-recover-enabled">'
                + '<input type="checkbox" class="hidden"' + (w.recover ? ' checked' : '') + ' aria-label="' + esc(t('module_messenger_hub_WizardRecovery')) + '">'
                + '<span class="mh-track"></span></label>'
                + '<span>' + esc(t('module_messenger_hub_WizardRecovery')) + '</span></div>';
        }
        if (w.eventTypes.indexOf('core.missed_call') >= 0) {
            html += '<div class="mh-switch-row mh-retract-row">'
                + '<label class="ui toggle checkbox' + (w.retract.enabled ? ' checked' : '') + '" id="mh-retract-enabled">'
                + '<input type="checkbox" class="hidden"' + (w.retract.enabled ? ' checked' : '') + ' aria-label="' + esc(t('module_messenger_hub_RetractEnabled')) + '">'
                + '<span class="mh-track"></span></label>'
                + '<span>' + esc(t('module_messenger_hub_RetractEnabled')) + '</span>'
                + '<span class="mh-inline-inputs" id="mh-retract-options"' + (w.retract.enabled ? '' : ' hidden') + '>'
                + '<span class="mh-muted">' + esc(t('module_messenger_hub_RetractWindowBefore')) + '</span>'
                + '<input type="number" min="5" max="120" id="mh-retract-window" class="mh-input-xs" value="' + w.retract.window_min + '" aria-label="' + esc(t('module_messenger_hub_RetractMinutes')) + '">'
                + '<span class="mh-muted">' + esc(t('module_messenger_hub_RetractMinutes')) + '</span></span>'
                + '</div>'
                + (wizardIsMax()
                    ? '<div class="field" id="mh-retract-max-hint"' + (w.retract.enabled ? '' : ' hidden') + '>'
                        + '<span class="mh-help">' + esc(t('module_messenger_hub_RetractMaxHint')) + '</span></div>'
                    : '');
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
                    return { name: employee.label, value: String(employee.id), selected: selectedUsers.indexOf(String(employee.id)) >= 0 };
                }),
                placeholder: t('module_messenger_hub_FilterAll'),
                fullTextSearch: true,
                message: { noResults: t('module_messenger_hub_FilterNothingFound') },
                onChange: function (value) {
                    if (!state.ruleWizard) { return; }
                    state.ruleWizard.filters.user_ids = String(value || '').split(',').filter(Boolean).map(Number);
                }
            });
        }
        var $providers = $('#mh-cond-providers');
        if ($providers.length > 0) {
            var selectedProviders = w.filters.providers.map(String);
            $providers.dropdown({
                values: state.providers.map(function (provider) {
                    return { name: provider.label, value: String(provider.id), selected: selectedProviders.indexOf(String(provider.id)) >= 0 };
                }),
                placeholder: t('module_messenger_hub_FilterAll'),
                fullTextSearch: true,
                message: { noResults: t('module_messenger_hub_FilterNothingFound') },
                onChange: function (value) {
                    if (!state.ruleWizard) { return; }
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
            if (!w) { return; }
            w.minSeverity = String($(this).data('severity')) === 'critical' ? 'critical' : 'warning';
            $(this).closest('.mh-seg').find('button').attr('aria-pressed', 'false');
            $(this).attr('aria-pressed', 'true');
            renderWizardPreview();
        });
        $form.on('change.wizard', '#mh-recover-enabled input', function () {
            var w = state.ruleWizard;
            if (!w) { return; }
            w.recover = $(this).prop('checked');
            $('#mh-recover-enabled').toggleClass('checked', w.recover);
            w.eventTypes = wizardWithRecovery(w.eventTypes, w.recover);
            renderWizardPreview();
        });
        $form.on('change.wizard', '#mh-cond-reasons input[data-reason]', function () {
            var w = state.ruleWizard;
            if (!w) { return; }
            w.filters.reasons = $form.find('#mh-cond-reasons input[data-reason]:checked').map(function () {
                return String($(this).data('reason'));
            }).get();
            renderWizardPreview();
        });
        $form.on('click.wizard', '.mh-seg button[data-direction]', function () {
            var w = state.ruleWizard;
            if (!w) { return; }
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
            loadEmployees(function () { renderWizardConditions(); });
        });
        $form.on('change.wizard', '#mh-retract-enabled input', function () {
            var w = state.ruleWizard;
            if (!w) { return; }
            w.retract.enabled = $(this).prop('checked');
            $('#mh-retract-enabled').toggleClass('checked', w.retract.enabled);
            $('#mh-retract-options').prop('hidden', !w.retract.enabled);
            $('#mh-retract-max-hint').prop('hidden', !w.retract.enabled);
        });
        $form.on('input.wizard change.wizard', '#mh-retract-window', function () {
            var w = state.ruleWizard;
            if (!w) { return; }
            var value = Number($(this).val());
            w.retract.window_min = value >= 5 && value <= 120 ? value : 20;
        });
        $form.on('input.wizard', '.mh-quality-min, .mh-quality-max', function () {
            var w = state.ruleWizard;
            if (!w) { return; }
            var min = $form.find('.mh-quality-min').val();
            var max = $form.find('.mh-quality-max').val();
            var range = {};
            if (String(min).trim() !== '') { range.min = Number(min); }
            if (String(max).trim() !== '') { range.max = Number(max); }
            w.filters.quality_score = Object.keys(range).length > 0 ? range : null;
            renderWizardPreview();
        });
    }

    // ---- step 3: where to send ----

    function activeWizardBot() {
        var w = state.ruleWizard;
        if (!w) { return null; }
        var bots = state.bots.filter(function (bot) { return bot.enabled !== false; });
        if (w.botId > 0) {
            for (var i = 0; i < bots.length; i++) {
                if (Number(bots[i].id) === Number(w.botId)) { return bots[i]; }
            }
        }
        return bots.length > 0 ? bots[0] : null;
    }

    function renderWizardRecipients() {
        var w = state.ruleWizard;
        var supportsEmployees = wizardSupportsEmployees(w.eventTypes);
        var bots = state.bots.filter(function (bot) { return bot.enabled !== false; });
        var active = activeWizardBot();
        if (active !== null && Number(w.botId) !== Number(active.id)) {
            w.botId = Number(active.id); // a single bot is selected by itself
        }
        var botHtml = '';
        bots.forEach(function (bot) {
            var selected = active !== null && Number(active.id) === Number(bot.id);
            var channel = bot.channel === 'max' ? 'max' : 'tg';
            botHtml += '<button type="button" class="mh-scenario mh-bot-choice' + (selected ? ' is-selected' : '')
                + '" data-bot-id="' + bot.id + '" aria-pressed="' + (selected ? 'true' : 'false') + '">'
                + '<span class="mh-messenger ' + channel + '" aria-hidden="true">' + (channel === 'max' ? 'MAX' : 'TG') + '</span>'
                + '<b class="mh-truncate">' + esc(bot.title) + '</b></button>';
        });
        $('#mh-wizard-bots').html(botHtml);
        $('#mh-wizard-bots-field').attr('hidden', bots.length > 0 ? null : true);
        $('#mh-wizard-no-bots').attr('hidden', bots.length > 0 ? true : null);
        $('#mh-wizard-target').attr('hidden', bots.length > 0 ? null : true);

        if (!supportsEmployees) {
            w.targetMode = 'recipients';
            $('#mh-wizard-target [value="employee"], #mh-wizard-target [value="employee_or_recipients"]')
                .closest('label').attr('hidden', true);
        } else {
            $('#mh-wizard-target [value="employee"], #mh-wizard-target [value="employee_or_recipients"]')
                .closest('label').removeAttr('hidden');
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
        if (modes.indexOf(w.attachments) < 0) { w.attachments = 'none'; }
        $field.removeAttr('hidden');
        // a voicemail is one file: the whole-conversation wording becomes plain "Recording"
        var voicemailOnly = w.eventTypes.indexOf('ai_supervisor.attention_call') < 0;
        $('#mh-wizard-attach-recording-text').text(t(voicemailOnly
            ? 'module_messenger_hub_WizardAttachVoicemail'
            : 'module_messenger_hub_WizardAttachRecording'));
        $field.find('label[data-mode]').each(function () {
            var mode = String($(this).data('mode'));
            var checked = mode === w.attachments;
            $(this).attr('hidden', modes.indexOf(mode) >= 0 ? null : true)
                .toggleClass('checked', checked).find('input').prop('checked', checked);
        });
        $('#mh-wizard-attach-hint').attr('hidden', w.attachments === 'none' ? true : null);
    }

    function renderWizardChats() {
        var w = state.ruleWizard;
        var bot = activeWizardBot();
        var chats = bot ? (bot.chats || []).filter(function (chat) {
            return chat.state === 'active' && chat.enabled === true;
        }) : [];
        var ids = chats.map(function (chat) { return Number(chat.id); });
        w.chatIds = w.chatIds.filter(function (id) { return ids.indexOf(id) >= 0; });
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
            message: { noResults: t('module_messenger_hub_WizardNoChats') },
            onChange: function (value) {
                if (!state.ruleWizard) { return; }
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
        var order = [
            'core.missed_call', 'core.voicemail', 'ai_supervisor.attention_call',
            'ai_supervisor.worker_offline', 'ai_supervisor.worker_online',
            'local_stt.worker_offline', 'local_stt.worker_online', 'local_stt.backlog_no_workers', 'local_stt.backlog_resolved',
            'cloud_stt.incident', 'cloud_stt.incident_resolved', 'cloud_stt.paused', 'cloud_stt.resumed',
            'cloud_ai.paused', 'cloud_ai.resumed',
            'voice_agent.callback_request', 'voice_agent.runtime_down', 'voice_agent.runtime_up',
            'core.provider_down', 'core.provider_up', 'core.advice', 'core.pbx_started'
        ];
        for (var i = 0; i < order.length; i++) {
            if (types.indexOf(order[i]) >= 0) { return order[i]; }
        }
        return '';
    }

    // Sample data of the preview bubbles for the module status events; never real values.
    var STATUS_PREVIEW_SAMPLES = {
        'ai_supervisor.worker_offline': { code: 'worker_offline', ref: 'sample', counters: { workers_online: 1, workers_total: 2 } },
        'ai_supervisor.worker_online': { code: 'worker_offline', ref: 'sample', counters: { workers_online: 2, workers_total: 2 } },
        'local_stt.worker_offline': { code: 'worker_offline', ref: 'sample', counters: { workers_online: 2, workers_total: 3 } },
        'local_stt.worker_online': { code: 'worker_offline', ref: 'sample', counters: { workers_online: 3, workers_total: 3 } },
        'local_stt.backlog_no_workers': { code: 'backlog_no_workers', ref: 'queue', counters: { workers_online: 0, workers_total: 3, jobs_waiting: 12 } },
        'local_stt.backlog_resolved': { code: 'backlog_no_workers', ref: 'queue', counters: { workers_online: 3, workers_total: 3, jobs_waiting: 0 } },
        'cloud_stt.incident': { code: 'incident_open', ref: 'sample', counters: { incidents_open: 1 } },
        'cloud_stt.incident_resolved': { code: 'incident_open', ref: 'sample', counters: { incidents_open: 0 } },
        'cloud_stt.paused': { code: 'processing_paused', ref: 'maintenance', counters: {} },
        'cloud_stt.resumed': { code: 'processing_paused', ref: 'maintenance', counters: {} },
        'cloud_ai.paused': { code: 'processing_paused', ref: 'insufficient_funds', counters: { jobs_waiting: 12 } },
        'cloud_ai.resumed': { code: 'processing_paused', ref: 'insufficient_funds', counters: { jobs_waiting: 0 } }
    };

    function renderWizardPreview() {
        var w = state.ruleWizard;
        if (!w) { return; }
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
        $('.mh-wizard-preview').attr('aria-label',
            t(wizardIsMax() ? 'module_messenger_hub_WizardPreviewChannelMax' : 'module_messenger_hub_WizardPreviewTitle'));
        // step 2 shows the conditions preview, step 3 the same preview for the chosen bot
        $('#mh-wizard-preview, #mh-wizard-preview-target').html(html);
    }

    function wizardPreviewBubble(type, w) {
        var names = eventTypeNames();
        var title = names[type] || type;
        if (type === 'ai_supervisor.attention_call') {
            title += ' · ' + tf('module_messenger_hub_MessageQualityScore', { score: 48 });
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
                lines.push(esc(tf('module_messenger_hub_MessageReasons', { reasons: 'Клиенту не помогли; повторный звонок' })));
                notes.push('Клиенту не помогли: дважды отправили на сайт, решения не предложили.');
                button = true;
                break;
            case 'voice_agent.callback_request':
                lines.push(esc('Пётр · ' + phone));
                lines.push(esc(tf('module_messenger_hub_MessageTopic', { topic: 'Возврат' })));
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
                    sample = $.extend({}, sample, { ref: w.filters.reasons[0] });
                }
                var scenarioSource = sourceById(w.sourceId);
                if (scenarioSource && scenarioSource.module_name) {
                    lines.push(esc(scenarioSource.module_name));
                }
                lines.push(esc(statusPhrase(type, sample)));
                statusCounterNotes(sample).forEach(function (note) { notes.push(note); });
                break;
            case 'voice_agent.runtime_down':
            case 'voice_agent.runtime_up':
                lines.push('connection refused');
                notes.push(tf('module_messenger_hub_MessageLatency', { ms: 1200 }));
                break;
            case 'core.advice':
                lines.push(esc('Свободно 8 % на разделе /storage'));
                break;
            case 'core.config_changed':
                lines.push(esc(tf('module_messenger_hub_MessageConfigArea', {
                    area: t('module_messenger_hub_ConfigAreaProviders'), count: 2
                })));
                lines.push(esc(tf('module_messenger_hub_MessageConfigArea', {
                    area: t('module_messenger_hub_ConfigAreaRouting'), count: 1
                })));
                notes.push('02.10.2026 15:41');
                break;
            case 'core.external_ip_changed':
                lines.push('203.0.113.5 → 203.0.113.9');
                notes.push(esc(tf('module_messenger_hub_MessageExternalIpSeenAt', { time: '02.10.2026 15:41' })));
                break;
            case 'core.license_expiring':
                lines.push('MikoPBX');
                lines.push(esc(tf('module_messenger_hub_MessageLicenseExpiresOn', { date: '31.12.2026' })));
                notes.push(esc(tf('module_messenger_hub_MessageLicenseDaysLeft', { days: 7 })));
                break;
            case 'core.pbx_started':
                lines.push('02.10.2026 03:10');
                break;
        }
        var isMax = wizardIsMax();
        var html = '<div class="mh-preview-msg' + (isMax ? ' is-max' : '') + '"><div>' + esc(iconForType(type)) + ' <b>' + esc(title) + '</b></div>';
        lines.forEach(function (line) { html += '<div>' + line + '</div>'; });
        notes.forEach(function (note) { html += '<div><i>' + esc(note) + '</i></div>'; });
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
        if (mode === 'none' || wizardAttachmentModes([type]).indexOf(mode) < 0) { return ''; }
        var items = [];
        if (mode === 'fragments') {
            var sample = ['0:12', '0:18'];
            sample.forEach(function (duration, index) {
                items.push(tf('module_messenger_hub_PreviewAudioFragment', { n: index + 1, total: sample.length, duration: duration }));
            });
        } else {
            items.push(tf('module_messenger_hub_PreviewAudioRecording', { duration: type === 'core.voicemail' ? '0:32' : '6:42' }));
        }
        var html = '';
        items.forEach(function (caption) {
            html += '<div class="mh-preview-msg mh-preview-audio' + (isMax ? ' is-max' : '') + '">'
                + '<div class="mh-preview-audio-row"><span class="mh-preview-play" aria-hidden="true"></span>'
                + '<span class="mh-preview-wave" aria-hidden="true"></span></div>'
                + '<div class="mh-meta">' + esc(caption) + '</div>'
                + '<span class="mh-preview-time">15:41</span></div>';
        });
        return html;
    }

    function iconForType(type) {
        if (type === 'core.missed_call' || type === 'voice_agent.callback_request') { return '📞'; }
        if (type === 'core.voicemail') { return '🎙'; }
        if (type === 'ai_supervisor.attention_call' || type === 'core.provider_down' || type === 'voice_agent.runtime_down') { return '⚠️'; }
        if (STATUS_RECOVERY_KEYS[type] || type === 'core.provider_up' || type === 'voice_agent.runtime_up') { return '✅'; }
        if (type === 'ai_supervisor.worker_offline' || type === 'local_stt.worker_offline') { return '🔌'; }
        if (type === 'core.pbx_started') { return '🔄'; }
        if (type === 'core.config_changed') { return '🛠'; }
        if (type === 'core.external_ip_changed') { return '🌐'; }
        if (type === 'core.license_expiring') { return '⚠️'; }
        return '⚠️';
    }

    // ---- navigation and save ----

    function wizardNext() {
        var w = state.ruleWizard;
        if (!w) { return; }
        if (w.step === 1) {
            if (!w.sourceId) { return; }
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
        if (!w) { return; }
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
        if (filters.user_ids.length > 0) { result.user_ids = filters.user_ids; }
        if (filters.directions.length > 0) { result.directions = filters.directions; }
        if (filters.providers.length > 0) { result.providers = filters.providers; }
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
        if (!w) { return; }
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
        var options = { mask_phone: w.mask };
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
            filters: pruneFilters(wizardSupportsReasons(w.eventTypes) ? w.filters : $.extend({}, w.filters, { reasons: null })),
            target_mode: w.targetMode,
            chat_ids: w.chatIds,
            options: options
        };
        var done = function (rule) {
            closeRuleWizard();
            replaceRule(rule);
            loadRules(true);
            showToast(t(w.editId > 0 ? 'module_messenger_hub_WizardSaved' : 'module_messenger_hub_WizardCreated'));
        };
        var failure = function (err) {
            showWizardError(failureText(err));
        };
        if (w.editId > 0) {
            apiPatch('/rules/' + w.editId, payload, done, failure);
        } else {
            apiPost('/rules', payload, done, failure);
        }
    }

    function showWizardError(text) {
        $('#mh-wizard .mh-wizard-error-slot').html('<div class="ui negative message" role="alert">' + ICON_ERROR
            + '<div class="mh-grow">' + esc(text) + '</div></div>');
    }

    function clearWizardError() {
        $('#mh-wizard .mh-wizard-error-slot').empty();
    }

    function bindWizardControls() {
        $('#mh-rule-add').on('click', function () { openRuleWizard(null); });
        $('#mh-wizard-back').on('click', function (event) {
            event.preventDefault();
            closeRuleWizard();
        });
        $('#mh-wizard-next').on('click', function () {
            if ($(this).prop('disabled')) { return; }
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
            if (!source || $(this).hasClass('is-disabled')) { return; }
            var w = state.ruleWizard;
            if (w.sourceId !== source.id) {
                w.sourceId = source.id;
                w.eventTypes = (source.event_types || []).map(function (type) { return type.type; });
                if (w.editId === 0) { w.title = source.name; }
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
        return $('#messenger-hub-root .mh-tab-pane[data-tab="journal"]').hasClass('active')
            && document.visibilityState === 'visible';
    }

    function notificationsVisible() {
        return $('#messenger-hub-root .mh-tab-pane[data-tab="notifications"]').hasClass('active')
            && document.visibilityState === 'visible';
    }

    function scheduleRefresh() {
        setInterval(function () {
            if (journalVisible()) {
                load({ refresh: true });
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
        $('#mh-journal-retry').on('click', function () { load(); });
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

        bindBotsContainer();
        bindChatFound();
        bindRulesContainer();
        bindWizardControls();
        $('#mh-bot-add').on('click', function () { openBotModal('add', null, 'telegram'); });
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
            if (!state.botModal || $(this).hasClass('is-disabled')) { return; }
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
}());
