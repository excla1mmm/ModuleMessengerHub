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
    /** Stage 4s-C thresholds of the PBX configuration and infrastructure sources (Plan/02). */
    public const string CONFIG_CHANGE_QUIET_SEC = 'config_change_quiet_sec';
    public const string EXTERNAL_IP_POLL_MIN = 'external_ip_poll_min';
    public const string LICENSE_POLL_HOURS = 'license_poll_hours';
    public const string LICENSE_WARN_DAYS = 'license_warn_days';

    /**
     * Stage 4s-A security sources (Plan/02-sources.md): toll-fraud rules of core.toll_fraud and the
     * brute-force rule of core.sip_auth_failures. Lists are comma-separated dialled prefixes.
     */
    public const string TOLL_FRAUD_PREFIXES = 'toll_fraud_prefixes';
    public const string TOLL_FRAUD_HOME_PREFIXES = 'toll_fraud_home_prefixes';
    public const string TOLL_FRAUD_BURST_CALLS = 'toll_fraud_burst_calls';
    public const string TOLL_FRAUD_BURST_WINDOW_MIN = 'toll_fraud_burst_window_min';
    public const string TOLL_FRAUD_OFFHOURS_ENABLED = 'toll_fraud_offhours_enabled';
    public const string TOLL_FRAUD_OFFHOURS_FROM = 'toll_fraud_offhours_from';
    public const string TOLL_FRAUD_OFFHOURS_TO = 'toll_fraud_offhours_to';
    public const string SIP_AUTHFAIL_THRESHOLD = 'sip_authfail_threshold';
    public const string SIP_AUTHFAIL_WINDOW_MIN = 'sip_authfail_window_min';
    public const string SIP_AUTHFAIL_QUIET_MIN = 'sip_authfail_quiet_min';
    public const string SIP_AUTHFAIL_EXTENSIONS_PER_POLL = 'sip_authfail_extensions_per_poll';

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
        self::CONFIG_CHANGE_QUIET_SEC => '60',
        self::EXTERNAL_IP_POLL_MIN => '15',
        self::LICENSE_POLL_HOURS => '6',
        self::LICENSE_WARN_DAYS => '14,7,1',
        // international access prefixes; the home-country prefixes below are not dangerous
        self::TOLL_FRAUD_PREFIXES => '810,00,+',
        // the module's primary locale is Russia: a domestic +7 / 8-10-7 / 00-7 call is not a toll-fraud
        // signal; for another country the administrator edits this list (Core exposes no country code)
        self::TOLL_FRAUD_HOME_PREFIXES => '+7,8107,007',
        self::TOLL_FRAUD_BURST_CALLS => '20',
        self::TOLL_FRAUD_BURST_WINDOW_MIN => '10',
        self::TOLL_FRAUD_OFFHOURS_ENABLED => '0',
        self::TOLL_FRAUD_OFFHOURS_FROM => '22:00',
        self::TOLL_FRAUD_OFFHOURS_TO => '07:00',
        self::SIP_AUTHFAIL_THRESHOLD => '10',
        self::SIP_AUTHFAIL_WINDOW_MIN => '10',
        self::SIP_AUTHFAIL_QUIET_MIN => '30',
        self::SIP_AUTHFAIL_EXTENSIONS_PER_POLL => '25',
    ];

    /** Agreed bounds of the journal retention (Plan/06, settings resource). */
    public const int RETENTION_MIN_DAYS = 1;
    public const int RETENTION_MAX_DAYS = 365;

    /** Agreed bounds of the queue wait thresholds (Plan/02, 4s-B): 0 = the check is off. */
    public const int QUEUE_WAIT_MIN_SEC = 0;
    public const int QUEUE_WAIT_MAX_SEC = 3600;
    /** Bounds of the config-change quiet window (4s-C): long enough to coalesce a save, short enough to stay useful. */
    public const int CONFIG_QUIET_MIN_SEC = 10;
    public const int CONFIG_QUIET_MAX_SEC = 3600;

    /** Bounds of the external-IP poll: the request leaves the PBX for an outside service (checkip.amazonaws.com). */
    public const int EXTERNAL_IP_POLL_MIN_MIN = 5;
    public const int EXTERNAL_IP_POLL_MIN_MAX = 1440;

    /** Bounds of the license poll: the request goes to the MIKO license server (cached 2 minutes by Core). */
    public const int LICENSE_POLL_HOURS_MIN = 1;
    public const int LICENSE_POLL_HOURS_MAX = 168;

    /** Bucket list bounds: at most five reminders, each in 1..365 days before expiry. */
    public const int LICENSE_WARN_MAX_BUCKETS = 5;
    public const int LICENSE_WARN_MIN_DAYS = 1;
    public const int LICENSE_WARN_MAX_DAYS = 365;

    /** Bounds of the security thresholds (Plan/02-sources.md, section 4s-A). */
    public const int PREFIX_LIST_MAX_ITEMS = 20;
    public const int BURST_CALLS_MIN = 2;
    public const int BURST_CALLS_MAX = 1000;
    public const int WINDOW_MIN_MIN = 1;
    public const int WINDOW_MIN_MAX = 1440;
    public const int AUTHFAIL_THRESHOLD_MIN = 1;
    public const int AUTHFAIL_THRESHOLD_MAX = 1000;
    public const int AUTHFAIL_QUIET_MIN = 5;
    public const int AUTHFAIL_EXTENSIONS_MIN = 5;
    public const int AUTHFAIL_EXTENSIONS_MAX = 200;

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
    /** Quiet window of core.config_changed: a burst of model changes becomes one event after it. */
    public function configChangeQuietSec(): int
    {
        return self::clamp(
            (int)$this->get(self::CONFIG_CHANGE_QUIET_SEC),
            self::CONFIG_QUIET_MIN_SEC,
            self::CONFIG_QUIET_MAX_SEC,
            (int)self::DEFAULTS[self::CONFIG_CHANGE_QUIET_SEC]
        );
    }

    /** Minutes between two external-IP checks (core.external_ip_changed). */
    public function externalIpPollMin(): int
    {
        return self::clamp(
            (int)$this->get(self::EXTERNAL_IP_POLL_MIN),
            self::EXTERNAL_IP_POLL_MIN_MIN,
            self::EXTERNAL_IP_POLL_MIN_MAX,
            (int)self::DEFAULTS[self::EXTERNAL_IP_POLL_MIN]
        );
    }

    /** Hours between two license checks (core.license_expiring). */
    public function licensePollHours(): int
    {
        return self::clamp(
            (int)$this->get(self::LICENSE_POLL_HOURS),
            self::LICENSE_POLL_HOURS_MIN,
            self::LICENSE_POLL_HOURS_MAX,
            (int)self::DEFAULTS[self::LICENSE_POLL_HOURS]
        );
    }

    /**
     * Reminder buckets in days before expiry, newest first, unique, at most LICENSE_WARN_MAX_BUCKETS.
     * The stored value is a comma separated list ("14,7,1").
     *
     * @return list<int>
     */
    public function licenseWarnDays(): array
    {
        return self::parseWarnDays($this->get(self::LICENSE_WARN_DAYS));
    }

    /**
     * Parses and normalises a bucket list; anything unparsable falls back to the default list,
     * values outside 1..365 are dropped.
     *
     * @return list<int>
     */
    public static function parseWarnDays(string $raw): array
    {
        $days = [];
        foreach (preg_split('~[^0-9]+~', $raw) ?: [] as $item) {
            if ($item === '' || !ctype_digit($item)) {
                continue;
            }
            $day = (int)$item;
            if ($day >= self::LICENSE_WARN_MIN_DAYS && $day <= self::LICENSE_WARN_MAX_DAYS) {
                $days[$day] = true;
            }
        }
        if ($days === []) {
            return self::parseWarnDays((string)self::DEFAULTS[self::LICENSE_WARN_DAYS]);
        }
        $days = array_keys($days);
        rsort($days, SORT_NUMERIC);

        return array_slice($days, 0, self::LICENSE_WARN_MAX_BUCKETS);
    }

    /** Canonical storage form of a bucket list ("14,7,1"). @param list<int> $days */
    public static function warnDaysToString(array $days): string
    {
        rsort($days, SORT_NUMERIC);

        return implode(',', array_slice(array_values(array_unique($days)), 0, self::LICENSE_WARN_MAX_BUCKETS));
    }

    /** Keeps a stored number inside its bounds; a zero/garbage value (empty string, text) means the default. */
    private static function clamp(int $value, int $min, int $max, int $fallback): int
    {
        if ($value <= 0) {
            return $fallback;
        }

        return max($min, min($max, $value));
    }

    /**
     * Dangerous dialled prefixes of the toll-fraud rule (international access codes by default).
     * An empty list switches the "dangerous destination" rule of `core.toll_fraud` off.
     *
     * @return list<string>
     */
    public function tollFraudPrefixes(): array
    {
        return self::prefixList((string)$this->get(self::TOLL_FRAUD_PREFIXES));
    }

    /**
     * Prefixes excluded from the dangerous list: the home-country dialling forms of the PBX.
     *
     * @return list<string>
     */
    public function tollFraudHomePrefixes(): array
    {
        return self::prefixList((string)$this->get(self::TOLL_FRAUD_HOME_PREFIXES));
    }

    public function tollFraudBurstCalls(): int
    {
        return self::clampInt((string)$this->get(self::TOLL_FRAUD_BURST_CALLS), (int)self::DEFAULTS[self::TOLL_FRAUD_BURST_CALLS], self::BURST_CALLS_MIN, self::BURST_CALLS_MAX);
    }

    public function tollFraudBurstWindowMin(): int
    {
        return self::clampInt((string)$this->get(self::TOLL_FRAUD_BURST_WINDOW_MIN), (int)self::DEFAULTS[self::TOLL_FRAUD_BURST_WINDOW_MIN], self::WINDOW_MIN_MIN, self::WINDOW_MIN_MAX);
    }

    public function tollFraudOffHoursEnabled(): bool
    {
        return $this->get(self::TOLL_FRAUD_OFFHOURS_ENABLED) === '1';
    }

    public function tollFraudOffHoursFrom(): string
    {
        return self::timeOfDay((string)$this->get(self::TOLL_FRAUD_OFFHOURS_FROM), (string)self::DEFAULTS[self::TOLL_FRAUD_OFFHOURS_FROM]);
    }

    public function tollFraudOffHoursTo(): string
    {
        return self::timeOfDay((string)$this->get(self::TOLL_FRAUD_OFFHOURS_TO), (string)self::DEFAULTS[self::TOLL_FRAUD_OFFHOURS_TO]);
    }

    /** Failures an extension must gain inside the growth window before `core.sip_auth_failures` alerts. */
    public function sipAuthFailThreshold(): int
    {
        return self::clampInt((string)$this->get(self::SIP_AUTHFAIL_THRESHOLD), (int)self::DEFAULTS[self::SIP_AUTHFAIL_THRESHOLD], self::AUTHFAIL_THRESHOLD_MIN, self::AUTHFAIL_THRESHOLD_MAX);
    }

    public function sipAuthFailWindowMin(): int
    {
        return self::clampInt((string)$this->get(self::SIP_AUTHFAIL_WINDOW_MIN), (int)self::DEFAULTS[self::SIP_AUTHFAIL_WINDOW_MIN], self::WINDOW_MIN_MIN, self::WINDOW_MIN_MAX);
    }

    /** An episode ends after this long without a new failed attempt. */
    public function sipAuthFailQuietMin(): int
    {
        return self::clampInt((string)$this->get(self::SIP_AUTHFAIL_QUIET_MIN), (int)self::DEFAULTS[self::SIP_AUTHFAIL_QUIET_MIN], self::AUTHFAIL_QUIET_MIN, self::WINDOW_MIN_MAX);
    }

    /** Extensions with a stats request per poll (the rest wait for the next rotation). */
    public function sipAuthFailExtensionsPerPoll(): int
    {
        return self::clampInt(
            (string)$this->get(self::SIP_AUTHFAIL_EXTENSIONS_PER_POLL),
            (int)self::DEFAULTS[self::SIP_AUTHFAIL_EXTENSIONS_PER_POLL],
            self::AUTHFAIL_EXTENSIONS_MIN,
            self::AUTHFAIL_EXTENSIONS_MAX
        );
    }

    /**
     * Comma-separated prefix list -> unique, validated entries (digits with an optional leading "+").
     *
     * @return list<string>
     */
    public static function prefixList(string $value): array
    {
        $list = [];
        foreach (explode(',', $value) as $item) {
            $item = trim($item);
            if ($item !== '' && preg_match('/^\+?\d{0,8}$/', $item) === 1 && $item !== '' && !in_array($item, $list, true)) {
                $list[] = $item;
            }
            if (count($list) >= self::PREFIX_LIST_MAX_ITEMS) {
                break;
            }
        }

        return $list;
    }

    private static function clampInt(string $value, int $fallback, int $min, int $max): int
    {
        if (preg_match('/^\d+$/', $value) !== 1) {
            return $fallback;
        }

        return max($min, min($max, (int)$value));
    }

    private static function timeOfDay(string $value, string $fallback): string
    {
        return preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $value) === 1 ? $value : $fallback;
    }
}
