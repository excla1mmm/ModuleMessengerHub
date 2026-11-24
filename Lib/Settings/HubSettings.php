<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Settings;

use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

/**
 * Key/value settings over m_MessengerHubSettings.
 *
 * Keys listed in SECRET_KEYS must never be exposed by REST or logs (Plan/07-security-privacy.md).
 */
final class HubSettings
{
    public const string TABLE = 'm_MessengerHubSettings';

    public const string HUB_ENABLED = 'hub_enabled';
    public const string EVENTS_RETENTION_DAYS = 'events_retention_days';
    public const string HUB_API_KEY = 'hub_api_key';
    public const string HUB_API_KEY_ID = 'hub_api_key_id';
    public const string HUB_API_KEY_PATHS = 'hub_api_key_paths';
    /** Unix time until which 401/403 from source polls are transient (Core token cache, KeyGraceWindow). */
    public const string HUB_API_KEY_GRACE_UNTIL = 'hub_api_key_grace_until';

    /** Stage 2 fields (Plan/06): public PBX address for links, masking default, proxy, MAX CA bundle. */
    public const string PBX_PUBLIC_URL = 'pbx_public_url';
    public const string MASK_PHONE_DEFAULT = 'mask_phone_default';
    public const string PROXY_URL = 'proxy_url';
    public const string MAX_CA_BUNDLE_PATH = 'max_ca_bundle_path';

    /** Stage 4s-B: queue wait thresholds of core.queue_abandoned (seconds, 0 disables the check). */
    public const string QUEUE_ABANDON_MIN_WAIT_SEC = 'queue_abandon_min_wait_sec';
    public const string QUEUE_LONG_WAIT_SEC = 'queue_long_wait_sec';

    public const array SECRET_KEYS = [self::HUB_API_KEY];

    public const array DEFAULTS = [
        self::HUB_ENABLED => '0',
        self::EVENTS_RETENTION_DAYS => '30',
        self::PBX_PUBLIC_URL => '',
        self::MASK_PHONE_DEFAULT => '0',
        self::PROXY_URL => '',
        self::MAX_CA_BUNDLE_PATH => '',
        self::QUEUE_ABANDON_MIN_WAIT_SEC => '0',
        self::QUEUE_LONG_WAIT_SEC => '0',
    ];

    /** Agreed bounds of the journal retention (Plan/06, settings resource). */
    public const int RETENTION_MIN_DAYS = 1;
    public const int RETENTION_MAX_DAYS = 365;

    /** Agreed bounds of the queue wait thresholds (Plan/02, 4s-B): 0 = the check is off. */
    public const int QUEUE_WAIT_MIN_SEC = 0;
    public const int QUEUE_WAIT_MAX_SEC = 3600;

    public function __construct(private readonly HubDatabase $db)
    {
    }

    public function get(string $key): string
    {
        $row = $this->db->fetchOne('SELECT value FROM ' . self::TABLE . ' WHERE key = :key', ['key' => $key]);

        return $row === null ? (self::DEFAULTS[$key] ?? '') : (string)($row['value'] ?? '');
    }

    public function set(string $key, string $value): void
    {
        $this->db->execute(
            'INSERT INTO ' . self::TABLE . ' (key, value) VALUES (:key, :value)'
            . ' ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            ['key' => $key, 'value' => $value]
        );
    }

    public function delete(string $key): void
    {
        $this->db->execute('DELETE FROM ' . self::TABLE . ' WHERE key = :key', ['key' => $key]);
    }

    public function retentionDays(): int
    {
        return max(1, min(365, (int)$this->get(self::EVENTS_RETENTION_DAYS)));
    }

    public function hubEnabled(): bool
    {
        return $this->get(self::HUB_ENABLED) === '1';
    }

    /** Public PBX address used for "open the call" buttons; empty means no links. */
    public function pbxPublicUrl(): string
    {
        $url = trim($this->get(self::PBX_PUBLIC_URL));

        return preg_match('~^https?://~i', $url) === 1 ? rtrim($url, '/') : '';
    }

    public function maskPhoneDefault(): bool
    {
        return $this->get(self::MASK_PHONE_DEFAULT) === '1';
    }

    public function proxyUrl(): string
    {
        return trim($this->get(self::PROXY_URL));
    }

    public function maxCaBundlePath(): string
    {
        return trim($this->get(self::MAX_CA_BUNDLE_PATH));
    }

    /** Minimum queue wait (seconds) before an unanswered queue leg is reported; 0 = any abandonment. */
    public function queueAbandonMinWaitSec(): int
    {
        return $this->waitSec(self::QUEUE_ABANDON_MIN_WAIT_SEC);
    }

    /** Optional "long wait" threshold of a queue leg, answered or not; 0 = off. */
    public function queueLongWaitSec(): int
    {
        return $this->waitSec(self::QUEUE_LONG_WAIT_SEC);
    }

    private function waitSec(string $key): int
    {
        $value = trim($this->get($key));
        if ($value === '' || preg_match('/^\d+$/', $value) !== 1) {
            return (int)(self::DEFAULTS[$key] ?? '0');
        }

        return max(self::QUEUE_WAIT_MIN_SEC, min(self::QUEUE_WAIT_MAX_SEC, (int)$value));
    }
}
