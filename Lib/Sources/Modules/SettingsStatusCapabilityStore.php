<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Throwable;

/**
 * Capability cache in m_MessengerHubSettings (key `status_capability.<source id>`), so the
 * collector worker, the settings PATCH reconcile and a worker restart all agree on whether a
 * module serves /status. Never throws: a broken value is simply "not checked yet".
 */
final class SettingsStatusCapabilityStore implements StatusCapabilityStore
{
    private const string KEY_PREFIX = 'status_capability.';

    public function __construct(private readonly HubSettings $settings)
    {
    }

    public function get(string $sourceId): StatusCapability
    {
        try {
            $raw = $this->settings->get(self::KEY_PREFIX . $sourceId);
            if ($raw === '') {
                return StatusCapability::unknown();
            }
            $decoded = json_decode($raw, true, 4);

            return is_array($decoded) ? StatusCapability::fromArray($decoded) : StatusCapability::unknown();
        } catch (Throwable) {
            return StatusCapability::unknown();
        }
    }

    public function remember(string $sourceId, StatusCapability $capability): void
    {
        try {
            $this->settings->set(
                self::KEY_PREFIX . $sourceId,
                json_encode($capability->toArray(), JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)
            );
        } catch (Throwable) {
            // the next poll asks again; a missed cache write never breaks a poll
        }
    }
}
