<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Settings;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModuleMessengerHub\Lib\Api\ApiKeyReconciler;
use Modules\ModuleMessengerHub\Lib\Api\ApiKeySync;
use Modules\ModuleMessengerHub\Lib\Api\HubApiKey;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\ArrayTranslator;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\CoreTranslator;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\Responder;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\Translator;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\UnknownActionException;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\ValidationException;
use Modules\ModuleMessengerHub\Lib\Routing\RuleRepository;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Sources\CoreModuleStatusProbe;
use Modules\ModuleMessengerHub\Lib\Sources\ModuleStatusProbe;
use Modules\ModuleMessengerHub\Lib\Sources\SourceAvailability;
use Modules\ModuleMessengerHub\Lib\Sources\SourceCatalog;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRegistry;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;
use Modules\ModuleMessengerHub\Lib\Storage\PhalconHubDatabase;
use Throwable;

/**
 * GET/PUT/PATCH /module-messenger-hub/settings and settings:getSources (Plan/06).
 *
 * Enabling a source resets its cursor through SourceStateRepository::setEnabled — a fresh baseline
 * without history. Unknown source ids are rejected. Secrets (HubSettings::SECRET_KEYS) are never returned.
 * A source toggle also applies the new API-key path set immediately (Q15): the next collector poll then
 * finds the path authorised instead of a short api_forbidden.
 *
 * Core calls the static callBack(); unit checks instantiate the processor with a test database
 * (Tests/support/bootstrap.php), so the logic itself stays Core-free.
 */
final class Processor
{
    private ?HubSettings $settings;
    private ?SourceStateRepository $states;
    private ?ModuleStatusProbe $modules;
    private ?Translator $translator;
    private ?ApiKeySync $apiKeySync;
    private ?HubDatabase $db;
    private bool $legacyIdsMigrated = false;

    public function __construct(
        ?HubSettings $settings = null,
        ?SourceStateRepository $states = null,
        ?ModuleStatusProbe $modules = null,
        ?Translator $translator = null,
        ?ApiKeySync $apiKeySync = null,
        ?HubDatabase $db = null,
    ) {
        $this->settings = $settings;
        $this->states = $states;
        $this->modules = $modules;
        $this->translator = $translator;
        $this->apiKeySync = $apiKeySync;
        $this->db = $db;
    }

    /** Entry point used by Core (WorkerApiCommands). */
    public static function callBack(array $request): PBXApiResult
    {
        return (new self(apiKeySync: new HubApiKey(new HubSettings(new PhalconHubDatabase()))))->process($request);
    }

    /** @param array<string, mixed> $request */
    public function process(array $request): PBXApiResult
    {
        $action = (string)($request['action'] ?? '');
        $data = Responder::data($request);

        return Responder::handle(__METHOD__, $action, function () use ($action, $data): array {
            switch ($action) {
                case 'getList':
                    return [$this->state()];
                case 'getDefault':
                    return [$this->defaults()];
                case 'update':
                    return [$this->save($data, true)];
                case 'patch':
                    return [$this->save($data, false)];
                case 'getSources':
                    return [['items' => $this->sources()]];
                default:
                    throw new UnknownActionException($action);
            }
        });
    }

    /** @return array<string, mixed> */
    private function state(): array
    {
        $sources = [];
        foreach (SourceRegistry::default()->all() as $source) {
            $sources[$source->id()] = $this->states()->isEnabled($source->id());
        }

        return [
            'hub_enabled' => $this->settings()->hubEnabled(),
            'events_retention_days' => $this->settings()->retentionDays(),
            'sources' => $sources,
            'pbx_public_url' => $this->settings()->pbxPublicUrl(),
            'mask_phone_default' => $this->settings()->maskPhoneDefault(),
            'proxy_url' => $this->settings()->proxyUrl(),
            'max_ca_bundle_path' => $this->settings()->maxCaBundlePath(),
            'queue_abandon_min_wait_sec' => $this->settings()->queueAbandonMinWaitSec(),
            'queue_long_wait_sec' => $this->settings()->queueLongWaitSec(),
            'config_change_quiet_sec' => $this->settings()->configChangeQuietSec(),
            'external_ip_poll_min' => $this->settings()->externalIpPollMin(),
            'license_poll_hours' => $this->settings()->licensePollHours(),
            'license_warn_days' => HubSettings::warnDaysToString($this->settings()->licenseWarnDays()),
            'toll_fraud_prefixes' => implode(',', $this->settings()->tollFraudPrefixes()),
            'toll_fraud_home_prefixes' => implode(',', $this->settings()->tollFraudHomePrefixes()),
            'toll_fraud_burst_calls' => $this->settings()->tollFraudBurstCalls(),
            'toll_fraud_burst_window_min' => $this->settings()->tollFraudBurstWindowMin(),
            'toll_fraud_offhours_enabled' => $this->settings()->tollFraudOffHoursEnabled(),
            'toll_fraud_offhours_from' => $this->settings()->tollFraudOffHoursFrom(),
            'toll_fraud_offhours_to' => $this->settings()->tollFraudOffHoursTo(),
            'sip_authfail_threshold' => $this->settings()->sipAuthFailThreshold(),
            'sip_authfail_window_min' => $this->settings()->sipAuthFailWindowMin(),
            'sip_authfail_quiet_min' => $this->settings()->sipAuthFailQuietMin(),
            'sip_authfail_extensions_per_poll' => $this->settings()->sipAuthFailExtensionsPerPoll(),
        ];
    }

    /** @return array<string, mixed> */
    private function defaults(): array
    {
        $sources = [];
        foreach (SourceRegistry::default()->all() as $source) {
            $sources[$source->id()] = true;
        }

        return [
            'hub_enabled' => false,
            'events_retention_days' => (int)HubSettings::DEFAULTS[HubSettings::EVENTS_RETENTION_DAYS],
            'sources' => $sources,
            'pbx_public_url' => (string)HubSettings::DEFAULTS[HubSettings::PBX_PUBLIC_URL],
            'mask_phone_default' => HubSettings::DEFAULTS[HubSettings::MASK_PHONE_DEFAULT] === '1',
            'proxy_url' => (string)HubSettings::DEFAULTS[HubSettings::PROXY_URL],
            'max_ca_bundle_path' => (string)HubSettings::DEFAULTS[HubSettings::MAX_CA_BUNDLE_PATH],
            'queue_abandon_min_wait_sec' => (int)HubSettings::DEFAULTS[HubSettings::QUEUE_ABANDON_MIN_WAIT_SEC],
            'queue_long_wait_sec' => (int)HubSettings::DEFAULTS[HubSettings::QUEUE_LONG_WAIT_SEC],
            'config_change_quiet_sec' => (int)HubSettings::DEFAULTS[HubSettings::CONFIG_CHANGE_QUIET_SEC],
            'external_ip_poll_min' => (int)HubSettings::DEFAULTS[HubSettings::EXTERNAL_IP_POLL_MIN],
            'license_poll_hours' => (int)HubSettings::DEFAULTS[HubSettings::LICENSE_POLL_HOURS],
            'license_warn_days' => (string)HubSettings::DEFAULTS[HubSettings::LICENSE_WARN_DAYS],
            'toll_fraud_prefixes' => (string)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_PREFIXES],
            'toll_fraud_home_prefixes' => (string)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_HOME_PREFIXES],
            'toll_fraud_burst_calls' => (int)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_BURST_CALLS],
            'toll_fraud_burst_window_min' => (int)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_BURST_WINDOW_MIN],
            'toll_fraud_offhours_enabled' => HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_OFFHOURS_ENABLED] === '1',
            'toll_fraud_offhours_from' => (string)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_OFFHOURS_FROM],
            'toll_fraud_offhours_to' => (string)HubSettings::DEFAULTS[HubSettings::TOLL_FRAUD_OFFHOURS_TO],
            'sip_authfail_threshold' => (int)HubSettings::DEFAULTS[HubSettings::SIP_AUTHFAIL_THRESHOLD],
            'sip_authfail_window_min' => (int)HubSettings::DEFAULTS[HubSettings::SIP_AUTHFAIL_WINDOW_MIN],
            'sip_authfail_quiet_min' => (int)HubSettings::DEFAULTS[HubSettings::SIP_AUTHFAIL_QUIET_MIN],
            'sip_authfail_extensions_per_poll' => (int)HubSettings::DEFAULTS[HubSettings::SIP_AUTHFAIL_EXTENSIONS_PER_POLL],
        ];
    }

    /**
     * PUT (full replacement) / PATCH (partial change). An unknown source id is a validation error.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed> the new state plus the list of changed fields
     */
    private function save(array $data, bool $full): array
    {
        $current = $this->state();
        $changed = [];
        $updates = [];

        $requestedSources = $data['sources'] ?? null;
        if (is_array($requestedSources)) {
            $knownIds = array_map(static fn (SourceInterface $s): string => $s->id(), SourceRegistry::default()->all());
            if ($full) {
                foreach ($knownIds as $knownId) {
                    if (!array_key_exists($knownId, $requestedSources)) {
                        // full replacement must speak about every registered source
                        throw new ValidationException('sources_incomplete', 'sources');
                    }
                }
            }
            foreach ($requestedSources as $sourceId => $enabled) {
                if (!in_array($sourceId, $knownIds, true)) {
                    throw new ValidationException('unknown_source', 'sources');
                }
                $updates[(string)$sourceId] = $this->boolValue($enabled, 'sources');
            }
        } elseif ($full) {
            throw new ValidationException('sources_required', 'sources');
        }

        $hubEnabled = null;
        if (array_key_exists('hub_enabled', $data)) {
            $hubEnabled = $this->boolValue($data['hub_enabled'], 'hub_enabled');
        } elseif ($full) {
            throw new ValidationException('hub_enabled_required', 'hub_enabled');
        }

        $retention = null;
        if (array_key_exists('events_retention_days', $data)) {
            $retention = $this->retentionValue($data['events_retention_days']);
        } elseif ($full) {
            throw new ValidationException('events_retention_days_required', 'events_retention_days');
        }

        // Stage 2 fields (Plan/06): public PBX address for the "open call" button, masking default,
        // proxy for messenger calls, CA bundle for MAX (stage 3). PUT replaces them like the rest.
        $publicUrl = null;
        if (array_key_exists('pbx_public_url', $data)) {
            $publicUrl = $this->urlValue($data['pbx_public_url'], 'pbx_public_url');
        } elseif ($full) {
            throw new ValidationException('pbx_public_url_required', 'pbx_public_url');
        }

        $maskDefault = null;
        if (array_key_exists('mask_phone_default', $data)) {
            $maskDefault = $this->boolValue($data['mask_phone_default'], 'mask_phone_default');
        } elseif ($full) {
            throw new ValidationException('mask_phone_default_required', 'mask_phone_default');
        }

        $proxyUrl = null;
        if (array_key_exists('proxy_url', $data)) {
            $proxyUrl = $this->proxyValue($data['proxy_url']);
        } elseif ($full) {
            throw new ValidationException('proxy_url_required', 'proxy_url');
        }

        $caBundle = null;
        if (array_key_exists('max_ca_bundle_path', $data)) {
            $caBundle = $this->caBundleValue($data['max_ca_bundle_path']);
        } elseif ($full) {
            throw new ValidationException('max_ca_bundle_path_required', 'max_ca_bundle_path');
        }

        // Stage 4s-B source options: optional even in a full replacement, so existing clients that
        // PUT the stage-2 payload keep working; PATCH is what the interface uses.
        $queueMinWait = null;
        if (array_key_exists('queue_abandon_min_wait_sec', $data)) {
            $queueMinWait = $this->waitSecValue($data['queue_abandon_min_wait_sec'], 'queue_abandon_min_wait_sec');
        }
        $queueLongWait = null;
        if (array_key_exists('queue_long_wait_sec', $data)) {
            $queueLongWait = $this->waitSecValue($data['queue_long_wait_sec'], 'queue_long_wait_sec');
        }
        // Stage 4s-C thresholds of the PBX configuration and infrastructure sources (Plan/02); optional even in
        // a full replacement, like the 4s-B fields, so older clients that PUT the stage-2 payload keep working.
        $quietSec = null;
        if (array_key_exists('config_change_quiet_sec', $data)) {
            $quietSec = $this->intRangeValue(
                $data['config_change_quiet_sec'],
                'config_change_quiet_sec',
                HubSettings::CONFIG_QUIET_MIN_SEC,
                HubSettings::CONFIG_QUIET_MAX_SEC
            );
        }

        $externalIpMin = null;
        if (array_key_exists('external_ip_poll_min', $data)) {
            $externalIpMin = $this->intRangeValue(
                $data['external_ip_poll_min'],
                'external_ip_poll_min',
                HubSettings::EXTERNAL_IP_POLL_MIN_MIN,
                HubSettings::EXTERNAL_IP_POLL_MIN_MAX
            );
        }

        $licenseHours = null;
        if (array_key_exists('license_poll_hours', $data)) {
            $licenseHours = $this->intRangeValue(
                $data['license_poll_hours'],
                'license_poll_hours',
                HubSettings::LICENSE_POLL_HOURS_MIN,
                HubSettings::LICENSE_POLL_HOURS_MAX
            );
        }

        $licenseDays = null;
        if (array_key_exists('license_warn_days', $data)) {
            $licenseDays = $this->warnDaysValue($data['license_warn_days']);
        }

        // Stage 4s-A security thresholds. They are optional in PUT as well: an older client that
        // replaces the settings wholesale must not be forced to know them (they keep their values).
        $tollPrefixes = null;
        if (array_key_exists('toll_fraud_prefixes', $data)) {
            $tollPrefixes = $this->prefixListValue($data['toll_fraud_prefixes'], 'toll_fraud_prefixes');
        }
        $tollHomePrefixes = null;
        if (array_key_exists('toll_fraud_home_prefixes', $data)) {
            $tollHomePrefixes = $this->prefixListValue($data['toll_fraud_home_prefixes'], 'toll_fraud_home_prefixes');
        }
        $burstCalls = null;
        if (array_key_exists('toll_fraud_burst_calls', $data)) {
            $burstCalls = $this->boundedIntValue(
                $data['toll_fraud_burst_calls'],
                'toll_fraud_burst_calls',
                HubSettings::BURST_CALLS_MIN,
                HubSettings::BURST_CALLS_MAX
            );
        }
        $burstWindow = null;
        if (array_key_exists('toll_fraud_burst_window_min', $data)) {
            $burstWindow = $this->boundedIntValue(
                $data['toll_fraud_burst_window_min'],
                'toll_fraud_burst_window_min',
                HubSettings::WINDOW_MIN_MIN,
                HubSettings::WINDOW_MIN_MAX
            );
        }
        $offHours = null;
        if (array_key_exists('toll_fraud_offhours_enabled', $data)) {
            $offHours = $this->boolValue($data['toll_fraud_offhours_enabled'], 'toll_fraud_offhours_enabled');
        }
        $offHoursFrom = null;
        if (array_key_exists('toll_fraud_offhours_from', $data)) {
            $offHoursFrom = $this->timeOfDayValue($data['toll_fraud_offhours_from'], 'toll_fraud_offhours_from');
        }
        $offHoursTo = null;
        if (array_key_exists('toll_fraud_offhours_to', $data)) {
            $offHoursTo = $this->timeOfDayValue($data['toll_fraud_offhours_to'], 'toll_fraud_offhours_to');
        }
        $authThreshold = null;
        if (array_key_exists('sip_authfail_threshold', $data)) {
            $authThreshold = $this->boundedIntValue(
                $data['sip_authfail_threshold'],
                'sip_authfail_threshold',
                HubSettings::AUTHFAIL_THRESHOLD_MIN,
                HubSettings::AUTHFAIL_THRESHOLD_MAX
            );
        }
        $authWindow = null;
        if (array_key_exists('sip_authfail_window_min', $data)) {
            $authWindow = $this->boundedIntValue(
                $data['sip_authfail_window_min'],
                'sip_authfail_window_min',
                HubSettings::WINDOW_MIN_MIN,
                HubSettings::WINDOW_MIN_MAX
            );
        }
        $authQuiet = null;
        if (array_key_exists('sip_authfail_quiet_min', $data)) {
            $authQuiet = $this->boundedIntValue(
                $data['sip_authfail_quiet_min'],
                'sip_authfail_quiet_min',
                HubSettings::AUTHFAIL_QUIET_MIN,
                HubSettings::WINDOW_MIN_MAX
            );
        }
        $authPerPoll = null;
        if (array_key_exists('sip_authfail_extensions_per_poll', $data)) {
            $authPerPoll = $this->boundedIntValue(
                $data['sip_authfail_extensions_per_poll'],
                'sip_authfail_extensions_per_poll',
                HubSettings::AUTHFAIL_EXTENSIONS_MIN,
                HubSettings::AUTHFAIL_EXTENSIONS_MAX
            );
        }

        $now = time();
        $sourcesChanged = false;
        foreach ($updates as $sourceId => $enabled) {
            if ($current['sources'][$sourceId] !== $enabled) {
                // enabling resets the cursor: fresh baseline, no history broadcast (AGENTS.md rule 5)
                $this->states()->setEnabled($sourceId, $enabled, $now);
                $changed[] = 'sources.' . $sourceId;
                $sourcesChanged = true;
            }
        }
        if ($hubEnabled !== null && $current['hub_enabled'] !== $hubEnabled) {
            $this->settings()->set(HubSettings::HUB_ENABLED, $hubEnabled ? '1' : '0');
            $changed[] = 'hub_enabled';
        }
        if ($retention !== null && $current['events_retention_days'] !== $retention) {
            $this->settings()->set(HubSettings::EVENTS_RETENTION_DAYS, (string)$retention);
            $changed[] = 'events_retention_days';
        }
        if ($publicUrl !== null && $current['pbx_public_url'] !== $publicUrl) {
            $this->settings()->set(HubSettings::PBX_PUBLIC_URL, $publicUrl);
            $changed[] = 'pbx_public_url';
        }
        if ($maskDefault !== null && $current['mask_phone_default'] !== $maskDefault) {
            $this->settings()->set(HubSettings::MASK_PHONE_DEFAULT, $maskDefault ? '1' : '0');
            $changed[] = 'mask_phone_default';
        }
        if ($proxyUrl !== null && $current['proxy_url'] !== $proxyUrl) {
            $this->settings()->set(HubSettings::PROXY_URL, $proxyUrl);
            $changed[] = 'proxy_url';
        }
        if ($caBundle !== null && $current['max_ca_bundle_path'] !== $caBundle) {
            $this->settings()->set(HubSettings::MAX_CA_BUNDLE_PATH, $caBundle);
            $changed[] = 'max_ca_bundle_path';
        }
        if ($queueMinWait !== null && $current['queue_abandon_min_wait_sec'] !== $queueMinWait) {
            $this->settings()->set(HubSettings::QUEUE_ABANDON_MIN_WAIT_SEC, (string)$queueMinWait);
            $changed[] = 'queue_abandon_min_wait_sec';
        }
        if ($queueLongWait !== null && $current['queue_long_wait_sec'] !== $queueLongWait) {
            $this->settings()->set(HubSettings::QUEUE_LONG_WAIT_SEC, (string)$queueLongWait);
            $changed[] = 'queue_long_wait_sec';
        }
        if ($quietSec !== null && $current['config_change_quiet_sec'] !== $quietSec) {
            $this->settings()->set(HubSettings::CONFIG_CHANGE_QUIET_SEC, (string)$quietSec);
            $changed[] = 'config_change_quiet_sec';
        }
        if ($externalIpMin !== null && $current['external_ip_poll_min'] !== $externalIpMin) {
            $this->settings()->set(HubSettings::EXTERNAL_IP_POLL_MIN, (string)$externalIpMin);
            $changed[] = 'external_ip_poll_min';
        }
        if ($licenseHours !== null && $current['license_poll_hours'] !== $licenseHours) {
            $this->settings()->set(HubSettings::LICENSE_POLL_HOURS, (string)$licenseHours);
            $changed[] = 'license_poll_hours';
        }
        if ($licenseDays !== null && $current['license_warn_days'] !== $licenseDays) {
            $this->settings()->set(HubSettings::LICENSE_WARN_DAYS, $licenseDays);
            $changed[] = 'license_warn_days';
        }
        foreach ([
            HubSettings::TOLL_FRAUD_PREFIXES => ['value' => $tollPrefixes, 'field' => 'toll_fraud_prefixes'],
            HubSettings::TOLL_FRAUD_HOME_PREFIXES => ['value' => $tollHomePrefixes, 'field' => 'toll_fraud_home_prefixes'],
            HubSettings::TOLL_FRAUD_BURST_CALLS => ['value' => $burstCalls, 'field' => 'toll_fraud_burst_calls'],
            HubSettings::TOLL_FRAUD_BURST_WINDOW_MIN => ['value' => $burstWindow, 'field' => 'toll_fraud_burst_window_min'],
            HubSettings::TOLL_FRAUD_OFFHOURS_ENABLED => ['value' => $offHours, 'field' => 'toll_fraud_offhours_enabled'],
            HubSettings::TOLL_FRAUD_OFFHOURS_FROM => ['value' => $offHoursFrom, 'field' => 'toll_fraud_offhours_from'],
            HubSettings::TOLL_FRAUD_OFFHOURS_TO => ['value' => $offHoursTo, 'field' => 'toll_fraud_offhours_to'],
            HubSettings::SIP_AUTHFAIL_THRESHOLD => ['value' => $authThreshold, 'field' => 'sip_authfail_threshold'],
            HubSettings::SIP_AUTHFAIL_WINDOW_MIN => ['value' => $authWindow, 'field' => 'sip_authfail_window_min'],
            HubSettings::SIP_AUTHFAIL_QUIET_MIN => ['value' => $authQuiet, 'field' => 'sip_authfail_quiet_min'],
            HubSettings::SIP_AUTHFAIL_EXTENSIONS_PER_POLL => ['value' => $authPerPoll, 'field' => 'sip_authfail_extensions_per_poll'],
        ] as $key => $item) {
            $value = $item['value'];
            if ($value === null) {
                continue;
            }
            $stored = is_bool($value) ? ($value ? '1' : '0') : (string)$value;
            if ($current[$item['field']] != $stored) {
                $this->settings()->set($key, $stored);
                $changed[] = $item['field'];
            }
        }
        if ($sourcesChanged) {
            $this->syncApiKey();
        }

        return $this->state() + ['changed' => $changed];
    }

    /**
     * Q15: the new path set must reach the Core key before the next poll, otherwise the freshly
     * toggled source is polled with the old paths and briefly reports api_forbidden. The collector
     * worker reconciles the key every minute anyway; this only makes the toggle instant. A failure
     * here never fails the PATCH itself.
     */
    private function syncApiKey(): void
    {
        try {
            (new ApiKeyReconciler(
                $this->apiKeySync,
                $this->states(),
                new RuleRepository($this->database()),
                $this->moduleProbe()
            ))->apply();
        } catch (Throwable) {
            // the collector worker reconciles the key within a minute
        }
    }

    /** Catalog and health state of every source (Plan/06, getSources). */
    private function sources(): array
    {
        $translator = $this->translation();
        $items = [];
        foreach (SourceRegistry::default()->all() as $source) {
            $state = $this->states()->get($source->id());
            $availability = $this->effectiveAvailability($source, $state);
            $group = SourceCatalog::group($source->id());
            $eventTypes = [];
            foreach (SourceCatalog::eventTypeKeys($source->id()) as $type => $typeKey) {
                $eventTypes[] = [
                    'type' => $type,
                    'name_key' => $typeKey,
                    'name' => $translator->t($typeKey),
                ];
            }
            $module = (string)($source->requiredModule() ?? '');
            $moduleKey = $module === '' ? null : SourceCatalog::moduleNameKey($module);

            $items[] = [
                'id' => $source->id(),
                'name_key' => SourceCatalog::nameKey($source->id()),
                'name' => $translator->t(SourceCatalog::nameKey($source->id())),
                'group' => $group,
                'group_key' => SourceCatalog::groupKey($group),
                'group_name' => $translator->t(SourceCatalog::groupKey($group)),
                'kind' => $module === '' ? 'core' : 'module',
                'module' => $module,
                'module_name' => $moduleKey === null ? $module : $translator->t($moduleKey),
                'event_types' => $eventTypes,
                'mode' => $source->mode(),
                'poll_interval_sec' => $source->pollIntervalSec(),
                'enabled' => $state['enabled'],
                'availability' => $availability,
                'availability_name' => $translator->t((string)SourceCatalog::availabilityKey($availability)),
                // the version that serves the contract: the UI tells "update the module to N"
                'update_to' => SourceCatalog::minVersion($source->id()),
                'last_poll_at' => $state['last_poll_at'],
                'last_ok_at' => $state['last_ok_at'],
                'last_error_code' => $state['last_error_code'],
                'baseline_set_at' => $state['baseline_set_at'],
            ];
        }

        return $items;
    }

    /**
     * A disabled source is 'disabled'; a module source whose module is missing/disabled reports that
     * live status; otherwise the stored health of the last poll wins ('' — never polled yet — means fresh).
     *
     * @param array<string, mixed> $state
     */
    private function effectiveAvailability(SourceInterface $source, array $state): string
    {
        if (!$state['enabled']) {
            return SourceAvailability::DISABLED;
        }
        $module = $source->requiredModule();
        if ($module !== null) {
            $status = $this->moduleStatus($module);
            if ($status !== null && $status !== SourceAvailability::AVAILABLE) {
                return $status;
            }
        }
        $stored = (string)$state['availability'];

        return $stored === '' ? SourceAvailability::AVAILABLE : $stored;
    }

    /** Live module status, or null when there is no probe (unit checks without Core, probe failure). */
    private function moduleStatus(string $module): ?string
    {
        try {
            $probe = $this->moduleProbe();

            return $probe === null ? null : $probe->status($module);
        } catch (Throwable) {
            return null;
        }
    }

    /** @param mixed $value */
    private function boolValue($value, string $field): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if ($value === 1 || $value === 0 || $value === '1' || $value === '0') {
            return (bool)$value;
        }
        throw new ValidationException('invalid_boolean', $field);
    }

    /** @param mixed $value */
    private function retentionValue($value): int
    {
        if (is_bool($value) || is_array($value) || $value === null || (is_string($value) && trim($value) === '')) {
            throw new ValidationException('invalid_retention_days', 'events_retention_days');
        }
        if (!is_int($value) && (!is_string($value) || !preg_match('/^\d+$/', $value))) {
            throw new ValidationException('invalid_retention_days', 'events_retention_days');
        }
        $days = (int)$value;
        if ($days < HubSettings::RETENTION_MIN_DAYS || $days > HubSettings::RETENTION_MAX_DAYS) {
            throw new ValidationException('invalid_retention_days', 'events_retention_days');
        }

        return $days;
    }

    /** @param mixed $value */
    private function urlValue($value, string $field): string
    {
        if (is_array($value)) {
            throw new ValidationException('invalid_url', $field);
        }
        $url = trim((string)$value);
        if ($url === '') {
            return '';
        }
        if (strlen($url) > 255 || preg_match('~^https?://[^\s]+$~i', $url) !== 1) {
            throw new ValidationException('invalid_url', $field);
        }

        return rtrim($url, '/');
    }

    /** @param mixed $value */
    private function proxyValue($value): string
    {
        if (is_array($value)) {
            throw new ValidationException('invalid_proxy_url', 'proxy_url');
        }
        $proxy = trim((string)$value);
        if ($proxy === '') {
            return '';
        }
        if (strlen($proxy) > 255 || preg_match('~^((https?|socks5h?)://)?[A-Za-z0-9.\-]+:\d{1,5}$~', $proxy) !== 1) {
            throw new ValidationException('invalid_proxy_url', 'proxy_url');
        }

        return $proxy;
    }

    /** @param mixed $value */
    private function caBundleValue($value): string
    {
        if (is_array($value)) {
            throw new ValidationException('invalid_ca_bundle_path', 'max_ca_bundle_path');
        }
        $path = trim((string)$value);
        if ($path === '') {
            return '';
        }
        if (strlen($path) > 255 || !str_starts_with($path, '/')) {
            throw new ValidationException('invalid_ca_bundle_path', 'max_ca_bundle_path');
        }

        return $path;
    }

    /** Queue wait threshold in seconds: an integer 0..3600, 0 = the check is off. @param mixed $value */
    private function waitSecValue($value, string $field): int
    {
        if (is_bool($value) || is_array($value) || $value === null || (is_string($value) && trim($value) === '')) {
            throw new ValidationException('invalid_wait_seconds', $field);
        }
        if (!is_int($value) && (!is_string($value) || !preg_match('/^\d+$/', $value))) {
            throw new ValidationException('invalid_wait_seconds', $field);
        }
        $seconds = (int)$value;
        if ($seconds < HubSettings::QUEUE_WAIT_MIN_SEC || $seconds > HubSettings::QUEUE_WAIT_MAX_SEC) {
            throw new ValidationException('invalid_wait_seconds', $field);
        }

        return $seconds;
    }
    /** Integer field with an explicit range; a numeric string is accepted like the retention field. */
    private function intRangeValue(mixed $value, string $field, int $min, int $max): int
    {
        if (is_bool($value) || is_array($value) || $value === null || (is_string($value) && trim($value) === '')) {
            throw new ValidationException('invalid_number', $field);
        }
        if (!is_int($value) && (!is_string($value) || preg_match('/^\d+$/', $value) !== 1)) {
            throw new ValidationException('invalid_number', $field);
        }
        $number = (int)$value;
        if ($number < $min || $number > $max) {
            throw new ValidationException('invalid_number', $field);
        }

        return $number;
    }

    /**
     * "14,7,1" (or an array of days) => the canonical "14,7,1": unique, newest first, 1..365,
     * at most HubSettings::LICENSE_WARN_MAX_BUCKETS entries, never empty (an empty list would silence
     * every license reminder).
     *
     * @param mixed $value
     */
    private function warnDaysValue($value): string
    {
        if (is_array($value)) {
            $value = implode(',', array_map(static fn (mixed $item): string => (string)$item, $value));
        }
        if (!is_string($value)) {
            throw new ValidationException('invalid_license_warn_days', 'license_warn_days');
        }
        $raw = trim($value);
        if ($raw === '') {
            throw new ValidationException('invalid_license_warn_days', 'license_warn_days');
        }
        $days = [];
        $items = 0;
        foreach (preg_split('~[\s,;]+~', $raw) ?: [] as $item) {
            if ($item === '') {
                continue;
            }
            $items++;
            if (!ctype_digit($item)) {
                throw new ValidationException('invalid_license_warn_days', 'license_warn_days');
            }
            $day = (int)$item;
            if ($day < HubSettings::LICENSE_WARN_MIN_DAYS || $day > HubSettings::LICENSE_WARN_MAX_DAYS) {
                throw new ValidationException('invalid_license_warn_days', 'license_warn_days');
            }
            $days[$day] = true;
        }
        if ($days === [] || $items > HubSettings::LICENSE_WARN_MAX_BUCKETS) {
            throw new ValidationException('invalid_license_warn_days', 'license_warn_days');
        }

        return HubSettings::warnDaysToString(array_keys($days));
    }

    /**
     * Comma-separated dialled prefix list ("810,00,+"). An empty value switches the rule off;
     * a malformed item is a validation error rather than silently dropping the entry.
     *
     * @param mixed $value
     */
    private function prefixListValue($value, string $field): string
    {
        if (is_array($value) || is_bool($value) || $value === null) {
            throw new ValidationException('invalid_prefix_list', $field);
        }
        $raw = trim((string)$value);
        if ($raw === '') {
            return '';
        }
        if (strlen($raw) > 255) {
            throw new ValidationException('invalid_prefix_list', $field);
        }
        $items = array_values(array_filter(array_map('trim', explode(',', $raw)), static fn (string $item): bool => $item !== ''));
        if ($items === [] || count($items) > HubSettings::PREFIX_LIST_MAX_ITEMS) {
            throw new ValidationException('invalid_prefix_list', $field);
        }
        foreach ($items as $item) {
            if (preg_match('/^\+?\d{0,8}$/', $item) !== 1 || $item === '') {
                throw new ValidationException('invalid_prefix_list', $field);
            }
        }
        // canonical form: de-duplicated, order of the admin kept
        return implode(',', HubSettings::prefixList($raw));
    }

    /** @param mixed $value */
    private function boundedIntValue($value, string $field, int $min, int $max): int
    {
        if (is_bool($value) || is_array($value) || $value === null || (is_string($value) && trim($value) === '')) {
            throw new ValidationException('invalid_number', $field);
        }
        if (!is_int($value) && (!is_string($value) || preg_match('/^\d+$/', $value) !== 1)) {
            throw new ValidationException('invalid_number', $field);
        }
        $number = (int)$value;
        if ($number < $min || $number > $max) {
            throw new ValidationException('invalid_number', $field);
        }

        return $number;
    }

    /** @param mixed $value */
    private function timeOfDayValue($value, string $field): string
    {
        if (is_array($value) || is_bool($value) || $value === null) {
            throw new ValidationException('invalid_time_of_day', $field);
        }
        $time = trim((string)$value);
        if (preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $time) !== 1) {
            throw new ValidationException('invalid_time_of_day', $field);
        }

        return $time;
    }

    private function settings(): HubSettings
    {
        return $this->settings ?? new HubSettings($this->database());
    }
    private function states(): SourceStateRepository
    {
        $repository = $this->states ?? new SourceStateRepository($this->database());
        if (!$this->legacyIdsMigrated) {
            $this->legacyIdsMigrated = true;
            $repository->migrateLegacyIds(); // stage 3b-4: before the interface lazily creates the new rows
        }

        return $repository;
    }

    private function moduleProbe(): ?ModuleStatusProbe
    {
        if ($this->modules !== null) {
            return $this->modules;
        }
        try {
            return new CoreModuleStatusProbe();
        } catch (Throwable) {
            return null; // unit checks without Core DI: stored availability only
        }
    }

    private function translation(): Translator
    {
        if ($this->translator !== null) {
            return $this->translator;
        }
        try {
            $di = \Phalcon\Di\Di::getDefault();
            $service = $di instanceof \Phalcon\Di\Di ? $di->getShared('translation') : null;
            if (is_object($service) && method_exists($service, '_')) {
                return new CoreTranslator($service);
            }
        } catch (Throwable) {
            // unit checks without Core: keys stay untranslated
        }

        return new ArrayTranslator([]);
    }

    private function database(): HubDatabase
    {
        return $this->db ?? new PhalconHubDatabase();
    }
}
