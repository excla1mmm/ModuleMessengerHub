{# ModuleMessengerHub: tabs Notifications / Journal / Settings. Reference: docs/design/ModuleMessengerHub-v3.html. #}
{# Everything dynamic is rendered by module-messenger-hub-index.js from the REST resources. #}
<div class="module-messenger-hub" id="messenger-hub-root"
     data-active-tab="notifications"
     data-timezone-offset="{{ timeZoneOffsetMinutes }}"
     data-module-enabled="{{ moduleEnabled ? '1' : '0' }}">
  <div class="mh-page-card">
    <div class="mh-tabs-row">
        <nav class="ui secondary pointing menu" id="mh-tabs" aria-label="{{ t._('module_messenger_hub_TabsLabel') }}">
            <a class="item active" data-tab="notifications">{{ t._('module_messenger_hub_TabNotifications') }}</a>
            <a class="item" data-tab="journal">{{ t._('module_messenger_hub_TabJournal') }}<span class="ui red circular label" id="mh-journal-badge" hidden></span></a>
            <a class="item" data-tab="settings">{{ t._('module_messenger_hub_TabSettings') }}</a>
        </nav>
        <div class="mh-tabs-actions" data-for-tab="notifications">
            <button class="ui primary button" type="button" id="mh-rule-add" hidden>
                <svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>
                {{ t._('module_messenger_hub_RulesAdd') }}
            </button>
        </div>
    </div>

    {# ---- Notifications: list + the new-notification wizard ---- #}
    <div class="ui tab segment mh-tab-pane active" data-tab="notifications">
        <div id="mh-rules-view">
            <div id="mh-rules-list" aria-live="polite"></div>
        </div>

        <div id="mh-wizard" hidden>
            <div class="mh-wizard-head">
                <a href="#" class="mh-back-link" id="mh-wizard-back">
                    <svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8 10 12.5"/></svg>{{ t._('module_messenger_hub_WizardBack') }}
                </a>
                <h3 class="ui header mh-page-title" id="mh-wizard-title">{{ t._('module_messenger_hub_WizardTitle') }}</h3>
            </div>

            <section id="mh-wizard-step-1">
                <div id="mh-wizard-scenarios"></div>
            </section>

            <section id="mh-wizard-step-2" class="mh-wizard-columns" hidden>
                <form class="ui form mh-form-col mh-wizard-form" id="mh-wizard-conditions" aria-label="{{ t._('module_messenger_hub_WizardConditionsTitle') }}" onsubmit="return false"></form>
                <aside class="mh-wizard-preview" aria-label="{{ t._('module_messenger_hub_WizardPreviewTitle') }}">
                    <div class="mh-preview-bubble" id="mh-wizard-preview"></div>
                </aside>
            </section>

            <section id="mh-wizard-step-3" class="mh-wizard-columns" hidden>
                <form class="ui form mh-form-col mh-wizard-form" aria-label="{{ t._('module_messenger_hub_WizardRecipientsTitle') }}" onsubmit="return false">
                    <div class="field" id="mh-wizard-bots-field">
                        <label>{{ t._('module_messenger_hub_WizardBot') }}</label>
                        <div class="mh-tile-grid" id="mh-wizard-bots"></div>
                    </div>
                    <div class="field" id="mh-wizard-no-bots" hidden>
                        <div class="mh-no-messenger">
                            <b>{{ t._('module_messenger_hub_WizardNoMessengerTitle') }}</b>
                            <a href="#" id="mh-wizard-open-settings" class="ui basic button">{{ t._('module_messenger_hub_SettingsConnect') }}</a>
                        </div>
                    </div>
                    <fieldset class="field mh-target-fieldset" id="mh-wizard-target">
                        <label>{{ t._('module_messenger_hub_WizardToTitle') }}</label>
                        <label class="ui radio checkbox">
                            <input type="radio" name="mh-target" value="employee" class="hidden">
                            <span class="mh-box"></span><span>{{ t._('module_messenger_hub_WizardToEmployee') }}</span>
                        </label>
                        <label class="ui radio checkbox">
                            <input type="radio" name="mh-target" value="recipients" class="hidden">
                            <span class="mh-box"></span><span>{{ t._('module_messenger_hub_WizardToRecipients') }}</span>
                        </label>
                        <label class="ui radio checkbox checked">
                            <input type="radio" name="mh-target" value="employee_or_recipients" class="hidden" checked>
                            <span class="mh-box"></span><span>{{ t._('module_messenger_hub_WizardToEmployeeOrRecipients') }}</span>
                        </label>
                        <div class="mh-chats-pick" id="mh-wizard-chats-field">
                            <div class="ui multiple selection dropdown" id="mh-wizard-chats" tabindex="0" aria-label="{{ t._('module_messenger_hub_WizardChatsTitle') }}">
                                <input type="hidden" name="mh-wizard-chats">
                                <span class="default text">{{ t._('module_messenger_hub_WizardChatsTitle') }}</span>
                                <div class="menu"></div>
                            </div>
                        </div>
                    </fieldset>
                    <div class="mh-switch-row">
                        <label class="ui toggle checkbox" id="mh-wizard-mask">
                            <input type="checkbox" class="hidden" aria-label="{{ t._('module_messenger_hub_WizardMask') }}">
                            <span class="mh-track"></span>
                        </label>
                        <span>{{ t._('module_messenger_hub_WizardMask') }}</span>
                    </div>
                    <fieldset class="field mh-target-fieldset" id="mh-wizard-attachments" hidden>
                        <label>{{ t._('module_messenger_hub_WizardAttachTitle') }}</label>
                        <label class="ui radio checkbox checked" data-mode="none">
                            <input type="radio" name="mh-attachments" value="none" class="hidden" checked>
                            <span class="mh-box"></span><span>{{ t._('module_messenger_hub_WizardAttachNone') }}</span>
                        </label>
                        <label class="ui radio checkbox" data-mode="fragments">
                            <input type="radio" name="mh-attachments" value="fragments" class="hidden">
                            <span class="mh-box"></span><span>{{ t._('module_messenger_hub_WizardAttachFragments') }}</span>
                        </label>
                        <label class="ui radio checkbox" data-mode="recording">
                            <input type="radio" name="mh-attachments" value="recording" class="hidden">
                            <span class="mh-box"></span><span id="mh-wizard-attach-recording-text">{{ t._('module_messenger_hub_WizardAttachRecording') }}</span>
                        </label>
                        <div class="mh-meta" id="mh-wizard-attach-hint" hidden>{{ t._('module_messenger_hub_WizardAttachPrivacy') }}</div>
                    </fieldset>
                </form>
                <aside class="mh-wizard-preview" aria-label="{{ t._('module_messenger_hub_WizardPreviewTitle') }}">
                    <div class="mh-preview-bubble" id="mh-wizard-preview-target"></div>
                </aside>
            </section>

            <div class="mh-wizard-error-slot"></div>
            <div class="mh-actions">
                <button class="ui basic button" type="button" id="mh-wizard-prev">{{ t._('module_messenger_hub_WizardCancel') }}</button>
                <span class="mh-spacer"></span>
                <button class="ui primary button" type="button" id="mh-wizard-next">{{ t._('module_messenger_hub_WizardNext') }}</button>
            </div>
        </div>
    </div>

    {# ---- Journal ---- #}
    <div class="ui tab segment mh-tab-pane" data-tab="journal">
        <div id="mh-journal-banner"></div>
        <form class="ui form mh-filters" id="mh-journal-filters" aria-label="{{ t._('module_messenger_hub_JournalFilterPeriod') }}" onsubmit="return false">
            <div class="ui selection dropdown mh-filter mh-filter-period" tabindex="0" aria-label="{{ t._('module_messenger_hub_JournalFilterPeriod') }}">
                <svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></svg>
                <span class="text">{{ t._('module_messenger_hub_PeriodToday') }}</span>
            </div>
            <div class="ui selection dropdown mh-filter mh-filter-type" tabindex="0" aria-label="{{ t._('module_messenger_hub_JournalFilterType') }}">
                <span class="default text">{{ t._('module_messenger_hub_FilterAllTypes') }}</span>
            </div>
            <label class="ui checkbox mh-probe-toggle" id="mh-journal-probes">
                <input type="checkbox" class="hidden">
                <span class="mh-box"></span><span>{{ t._('module_messenger_hub_JournalShowProbes') }}</span>
            </label>
        </form>

        <div id="mh-journal-error"></div>

        <div class="mh-empty" id="mh-journal-empty" role="status" hidden>
            <h3 class="ui header">{{ t._('module_messenger_hub_EventsEmpty') }}</h3>
        </div>

        <div class="mh-empty" id="mh-journal-empty-filtered" role="status" hidden>
            <h3 class="ui header">{{ t._('module_messenger_hub_EventsEmptyFiltered') }}</h3>
            <button class="ui basic button" type="button" id="mh-journal-reset-filters">{{ t._('module_messenger_hub_EventsResetFilters') }}</button>
        </div>

        <div class="mh-empty" id="mh-journal-error-placeholder" role="alert" hidden>
            <h3 class="ui header">{{ t._('module_messenger_hub_EventsLoadFailed') }}</h3>
            <p class="mh-muted" id="mh-journal-error-placeholder-hint"></p>
            <button class="ui basic button" type="button" id="mh-journal-retry">{{ t._('module_messenger_hub_CommonRetry') }}</button>
        </div>

        <div id="mh-journal-table" aria-busy="true"></div>

        <div class="mh-pager" id="mh-journal-pager" hidden>
            <span class="mh-meta" id="mh-journal-page-info"></span>
            <nav class="mh-pager-buttons" aria-label="{{ t._('module_messenger_hub_PagerPrev') }} / {{ t._('module_messenger_hub_PagerNext') }}">
                <button class="ui basic icon button" type="button" id="mh-journal-prev" aria-label="{{ t._('module_messenger_hub_PagerPrev') }}" disabled>
                    <svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8 10 12.5"/></svg>
                </button>
                <button class="ui basic icon button" type="button" id="mh-journal-next" aria-label="{{ t._('module_messenger_hub_PagerNext') }}">
                    <svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg>
                </button>
            </nav>
        </div>
    </div>

    {# ---- Settings: messengers and general options ---- #}
    <div class="ui tab segment mh-tab-pane" data-tab="settings">
        <section class="mh-section">
            <div class="mh-section-head">
                <h3 class="mh-group-title">{{ t._('module_messenger_hub_SettingsMessengers') }}</h3>
                <button class="ui primary button" type="button" id="mh-bot-add" hidden>
                    <svg class="mh-i" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>
                    {{ t._('module_messenger_hub_SettingsConnect') }}
                </button>
            </div>
            <div id="mh-bots" aria-live="polite"></div>
        </section>

        <section class="mh-section mh-form-col">
            <h3 class="mh-group-title">{{ t._('module_messenger_hub_SettingsGeneral') }}</h3>
            <form class="ui form mh-settings-form" aria-label="{{ t._('module_messenger_hub_SettingsGeneral') }}" onsubmit="return false">
                <div class="field" id="mh-public-url-field">
                    <label for="mh-public-url-input">{{ t._('module_messenger_hub_SettingsPublicUrl') }}</label>
                    <input id="mh-public-url-input" type="text" inputmode="url" autocomplete="off" placeholder="https://pbx.example.ru">
                    <span class="mh-help" id="mh-public-url-help"></span>
                </div>
                <div class="mh-switch-row">
                    <label class="ui toggle checkbox" id="mh-mask-default">
                        <input type="checkbox" class="hidden" aria-label="{{ t._('module_messenger_hub_SettingsMaskPhone') }}">
                        <span class="mh-track"></span>
                    </label>
                    <span>{{ t._('module_messenger_hub_SettingsMaskPhone') }}</span>
                </div>
                <div class="field" id="mh-retention-field">
                    <label for="mh-retention-input">{{ t._('module_messenger_hub_SettingsRetention') }}</label>
                    <input id="mh-retention-input" class="mh-input-xs" type="number" min="1" max="365" step="1" value="30">
                    <span class="mh-help" id="mh-retention-help"></span>
                </div>
                <div class="field" id="mh-proxy-field">
                    <label for="mh-proxy-input">{{ t._('module_messenger_hub_SettingsProxy') }}</label>
                    <input id="mh-proxy-input" class="mh-input-s" type="text" autocomplete="off" placeholder="{{ t._('module_messenger_hub_SettingsProxyNone') }}">
                    <span class="mh-help" id="mh-proxy-help"></span>
                </div>
                <div class="field" id="mh-max-ca-field">
                    <label for="mh-max-ca-input">{{ t._('module_messenger_hub_SettingsMaxCa') }}</label>
                    <input id="mh-max-ca-input" class="mh-input-s mh-mono" type="text" autocomplete="off" spellcheck="false" placeholder="{{ t._('module_messenger_hub_SettingsMaxCaNone') }}">
                    <span class="mh-help" id="mh-max-ca-help">{{ t._('module_messenger_hub_SettingsMaxCaHelp') }}</span>
                </div>
                <div class="field" id="mh-queue-min-wait-field">
                    <label for="mh-queue-min-wait-input">{{ t._('module_messenger_hub_SettingsQueueMinWait') }}</label>
                    <input id="mh-queue-min-wait-input" class="mh-input-xs" type="number" min="0" max="3600" step="1" value="0">
                    <span class="mh-help" id="mh-queue-min-wait-help">{{ t._('module_messenger_hub_SettingsQueueMinWaitHelp') }}</span>
                </div>
                <div class="field" id="mh-queue-long-wait-field">
                    <label for="mh-queue-long-wait-input">{{ t._('module_messenger_hub_SettingsQueueLongWait') }}</label>
                    <input id="mh-queue-long-wait-input" class="mh-input-xs" type="number" min="0" max="3600" step="1" value="0">
                    <span class="mh-help" id="mh-queue-long-wait-help">{{ t._('module_messenger_hub_SettingsQueueLongWaitHelp') }}</span>
                </div>
                <div class="field" id="mh-config-quiet-field">
                    <label for="mh-config-quiet-input">{{ t._('module_messenger_hub_SettingsConfigQuiet') }}</label>
                    <input id="mh-config-quiet-input" class="mh-input-xs" type="number" min="10" max="3600" step="1" value="60">
                    <span class="mh-help" id="mh-config-quiet-help"></span>
                </div>
                <div class="field" id="mh-external-ip-field">
                    <label for="mh-external-ip-input">{{ t._('module_messenger_hub_SettingsExternalIpMin') }}</label>
                    <input id="mh-external-ip-input" class="mh-input-xs" type="number" min="5" max="1440" step="1" value="15">
                    <span class="mh-help" id="mh-external-ip-help"></span>
                </div>
                <div class="field" id="mh-license-hours-field">
                    <label for="mh-license-hours-input">{{ t._('module_messenger_hub_SettingsLicenseHours') }}</label>
                    <input id="mh-license-hours-input" class="mh-input-xs" type="number" min="1" max="168" step="1" value="6">
                    <span class="mh-help" id="mh-license-hours-help"></span>
                </div>
                <div class="field" id="mh-license-days-field">
                    <label for="mh-license-days-input">{{ t._('module_messenger_hub_SettingsLicenseDays') }}</label>
                    <input id="mh-license-days-input" class="mh-input-s mh-mono" type="text" autocomplete="off" spellcheck="false" placeholder="14,7,1">
                    <span class="mh-help" id="mh-license-days-help"></span>
                </div>
            </form>
            <span class="mh-meta">{{ t._('module_messenger_hub_SettingsPrivacy') }}</span>
        </section>
    </div>
  </div>

    {# ---- Bot form (add / edit) ---- #}
    <div class="ui modal mh-modal" id="mh-bot-modal" role="dialog" aria-labelledby="mh-bot-modal-title">
        <div class="header" id="mh-bot-modal-title">{{ t._('module_messenger_hub_BotAddTitle') }}</div>
        <div class="content ui form mh-modal-form">
            <fieldset class="field mh-channel-fieldset">
                <label>{{ t._('module_messenger_hub_BotChannel') }}</label>
                <div class="mh-channel-cards">
                    <label class="mh-channel-card is-selected" data-channel="telegram">
                        <input type="radio" name="mh-bot-channel" value="telegram" class="hidden" checked>
                        <span class="mh-messenger tg s" aria-hidden="true">TG</span><span>Telegram</span>
                    </label>
                    <label class="mh-channel-card" data-channel="max">
                        <input type="radio" name="mh-bot-channel" value="max" class="hidden">
                        <span class="mh-messenger max s" aria-hidden="true">MAX</span><span>MAX</span>
                    </label>
                </div>
            </fieldset>
            <div class="field" id="mh-bot-title-field">
                <label for="mh-bot-title">{{ t._('module_messenger_hub_BotTitle') }}</label>
                <input id="mh-bot-title" type="text" maxlength="128" autocomplete="off">
            </div>
            <div class="field" id="mh-bot-token-row">
                <label for="mh-bot-token">{{ t._('module_messenger_hub_BotToken') }}</label>
                <div class="mh-token-row">
                    <input id="mh-bot-token" type="text" autocomplete="off" spellcheck="false" class="mh-mono" aria-describedby="mh-bot-token-help">
                    <button class="ui basic button" type="button" id="mh-bot-check">{{ t._('module_messenger_hub_BotCheck') }}</button>
                </div>
            </div>
            <div class="field" id="mh-bot-token-hint-row" hidden>
                <label>{{ t._('module_messenger_hub_BotToken') }}</label>
                <div class="mh-token-row">
                    <code id="mh-bot-token-hint">••••</code>
                    <button class="ui basic button" type="button" id="mh-bot-token-replace">{{ t._('module_messenger_hub_BotTokenReplace') }}</button>
                    <button class="ui text button" type="button" id="mh-bot-check-stored">{{ t._('module_messenger_hub_BotCheck') }}</button>
                </div>
                <div class="mh-token-row" id="mh-bot-token-new-row" hidden>
                    <input id="mh-bot-token-new" type="text" autocomplete="off" spellcheck="false" class="mh-mono">
                    <button class="ui basic button" type="button" id="mh-bot-check-new">{{ t._('module_messenger_hub_BotCheck') }}</button>
                    <button class="ui text button" type="button" id="mh-bot-token-cancel">{{ t._('module_messenger_hub_BotCancel') }}</button>
                </div>
            </div>
            <div class="field" id="mh-bot-token-help-row" hidden>
                <span class="mh-help" id="mh-bot-token-help"></span>
            </div>
            <div id="mh-bot-check-message"></div>
        </div>
        <div class="actions">
            <button class="ui red basic button" type="button" id="mh-bot-delete" hidden>{{ t._('module_messenger_hub_BotDelete') }}</button>
            <span class="mh-spacer"></span>
            <button class="ui basic button" type="button" data-action="cancel">{{ t._('module_messenger_hub_BotCancel') }}</button>
            <button class="ui primary button" type="button" id="mh-bot-save">{{ t._('module_messenger_hub_BotSave') }}</button>
        </div>
    </div>

    {# ---- Connect chat modal ---- #}
    <div class="ui modal mh-modal" id="mh-chat-modal" role="dialog" aria-labelledby="mh-chat-modal-title">
        <div class="header" id="mh-chat-modal-title">{{ t._('module_messenger_hub_ChatConnectTitle') }}</div>
        <div class="content mh-modal-form">
            <p class="mh-muted" id="mh-chat-steps"></p>
            <div class="mh-chat-status" role="status" aria-live="polite">
                <div class="mh-chat-status-line">
                    <span id="mh-chat-status-text"></span>
                    <b id="mh-chat-countdown"></b>
                </div>
                <div class="ui progress mh-progress" id="mh-chat-progress" aria-hidden="true"><div class="bar"></div></div>
            </div>
            <div id="mh-chat-error"></div>
            <div id="mh-chat-empty" hidden>
                <h3 class="ui header">{{ t._('module_messenger_hub_ChatConnectNothingTitle') }}</h3>
                <p class="mh-muted">{{ t._('module_messenger_hub_ChatConnectNothingHint') }}</p>
            </div>
            <div class="ui segment mh-flush" id="mh-chat-found"></div>
        </div>
        <div class="actions">
            <button class="ui basic button" type="button" id="mh-chat-stop">{{ t._('module_messenger_hub_ChatConnectStop') }}</button>
            <button class="ui text button" type="button" id="mh-chat-again" hidden>{{ t._('module_messenger_hub_ChatConnectAgain') }}</button>
            <span class="mh-spacer"></span>
            <button class="ui basic button" type="button" data-action="cancel">{{ t._('module_messenger_hub_BotCancel') }}</button>
            <button class="ui primary button" type="button" id="mh-chat-save" disabled>{{ t._('module_messenger_hub_ChatConnectSaveIdle') }}</button>
        </div>
    </div>

    {# ---- Test result modal ---- #}
    <div class="ui modal mh-modal" id="mh-test-modal" role="dialog" aria-labelledby="mh-test-modal-title">
        <div class="header" id="mh-test-modal-title">{{ t._('module_messenger_hub_TestResult') }}</div>
        <div class="content">
            <div class="mh-test-head">
                <span class="mh-muted" id="mh-test-summary"></span>
            </div>
            <div id="mh-test-list" role="status" aria-live="polite"></div>
        </div>
        <div class="actions">
            <button class="ui basic button" type="button" data-action="cancel">{{ t._('module_messenger_hub_ChatConnectClose') }}</button>
        </div>
    </div>

    {# ---- Confirm modal ---- #}
    <div class="ui mini modal mh-modal" id="mh-confirm-modal" role="dialog" aria-labelledby="mh-confirm-text">
        <div class="content"><p id="mh-confirm-text"></p></div>
        <div class="actions">
            <button class="ui basic button" type="button" data-action="cancel">{{ t._('module_messenger_hub_BotCancel') }}</button>
            <button class="ui red button" type="button" id="mh-confirm-ok">{{ t._('module_messenger_hub_BotDelete') }}</button>
        </div>
    </div>
</div>
