<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Settings;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
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
use Modules\ModuleMessengerHub\Lib\Sources\ApiKeyPaths;
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
        if ($this->apiKeySync === null) {
            return; // unit checks without Core: the collector worker reconciles the key
        }
        try {
            $probe = $this->moduleProbe();
            if ($probe === null) {
                return;
            }
            $paths = ApiKeyPaths::compute(
                SourceRegistry::default()->pollSources(),
                fn (string $id): bool => $this->states()->isEnabled($id),
                static fn (string $module): string => $probe->status($module)
            );
            // the CDR grant exists only while an enabled rule can attach the attention-call audio
            $paths = ApiKeyPaths::attentionCdr(
                $paths,
                (new RuleRepository($this->database()))->needsAttentionAttachments()
            );
            $this->apiKeySync->sync($paths);
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

    private function settings(): HubSettings
    {
        return $this->settings ?? new HubSettings($this->database());
    }

    private function states(): SourceStateRepository
    {
        return $this->states ?? new SourceStateRepository($this->database());
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
