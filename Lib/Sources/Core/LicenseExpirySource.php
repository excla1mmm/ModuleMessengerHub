<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceException;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;

/**
 * core.license_expiring — poll source over GET /pbxcore/api/v3/license:getLicenseInfo (4s-C).
 *
 * Where the dates come from (read-only Core contract):
 *  - `src/PBXCoreREST/Lib/License/GetLicenseInfoAction.php:42-73` returns the licence server answer as
 *    a JSON STRING in `data.licenseInfo` (Core caches it two minutes, so a poll never hammers the
 *    marketplace);
 *  - the document is the JSON form of the licence XML. Its real shape is what the Core cabinet reads:
 *    `sites/admin-cabinet/assets/js/src/PbxExtensionModules/pbx-extension-module-keycheck.js:318-371` —
 *    `@attributes.companyname|contact|email|tel`, `product` (one object or a list) with
 *    `name`, `expired` ("YYYY-MM-DD", may be empty) and `trial`, and nested `feature` nodes
 *    (`name`, `count`, `counteach`, `captured`) that carry NO dates in this contract.
 *    Only `product.name` and `product.expired` are used; `@attributes` (the registration data) and
 *    the licence key itself are never read into the event.
 *
 * Reminders: `license_warn_days` (HubSettings, default 14,7,1) buckets before `expired`, plus exactly
 * one event after the date has passed. One event per (product, expiry date, bucket):
 * dedupe_key = license:{sha1(product name) 12}:{expiry}:{bucket|expired}. A renewal changes the date,
 * so the new series of reminders starts over.
 *
 * Baseline (decided here, documented in Plan/02): the first successful poll is silent for the early
 * buckets (installing the hub two weeks before a renewal must not announce it), but it DOES announce the
 * current urgent state — the last configured bucket (1 day by default) or an already expired product —
 * mirroring the provider baseline rule "the first seen up is silent, the first seen down is announced".
 *
 * A poll that brings no licence document (no key on the PBX, licence server unreachable: Core answers
 * 400 with `result: false`) is not an error of the source and not a change: nothing is emitted, the
 * stored series is kept, and the next check is retried sooner than the normal interval.
 */
final class LicenseExpirySource implements SourceInterface
{
    public const string ID = 'core.license_expiring';
    public const string EVENT_TYPE = 'core.license_expiring';
    public const string PATH = '/pbxcore/api/v3/license:getLicenseInfo';
    public const string API_READ_PATH = '/api/v3/license';

    public const string BUCKET_EXPIRED = 'expired';

    /** Retry of a poll without a licence document (no key / marketplace down): sooner than the interval. */
    public const int FAILED_RETRY_SEC = 1800;

    /** @var (callable(): int)|null */
    private $intervalHours;

    /** @var (callable(): list<int>)|null */
    private $warnDays;

    /**
     * @param (callable(): int)|null $intervalHours hours between checks; null = 6
     * @param (callable(): list<int>)|null $warnDays reminder buckets in days; null = [14, 7, 1]
     */
    public function __construct(?callable $intervalHours = null, ?callable $warnDays = null)
    {
        $this->intervalHours = $intervalHours;
        $this->warnDays = $warnDays;
    }

    public function id(): string
    {
        return self::ID;
    }

    public function eventTypes(): array
    {
        return [self::EVENT_TYPE];
    }

    public function requiredModule(): ?string
    {
        return null;
    }

    public function apiReadPaths(): array
    {
        return [self::API_READ_PATH];
    }

    public function mode(): string
    {
        return SourceInterface::MODE_POLL;
    }

    /** The collector's granularity: the real interval lives in the cursor (see poll()). */
    public function pollIntervalSec(): int
    {
        return 300;
    }

    public function poll(SourceContext $context, array $cursor): SourceBatch
    {
        $now = $context->now();
        $interval = max(1, $this->interval()) * 3600;
        if (!self::isDue($cursor, $now)) {
            return new SourceBatch([], $cursor);
        }

        try {
            $data = $context->rest->get(self::PATH);
        } catch (SourceException $exception) {
            if ($exception->errorCode !== 'api_bad_response') {
                throw $exception; // a key problem must stay visible as the source state
            }
            $data = [];
        }

        $raw = $data['licenseInfo'] ?? null;
        $json = is_array($raw) ? json_encode($raw) : (is_string($raw) ? $raw : '');

        return self::buildBatch(self::productsFrom($json), $cursor, $now, $this->buckets(), $interval);
    }

    /** @param array<string, mixed> $cursor */
    public static function isDue(array $cursor, int $now): bool
    {
        if ($cursor === []) {
            return true; // baseline is due immediately
        }
        $next = (int)($cursor['next_check_at'] ?? 0);

        return $next === 0 || $now >= $next;
    }

    /**
     * Licence document => watched products, or null when there is no usable document.
     *
     * @return list<array{key: string, name: string, expiry: string}>|null
     */
    public static function productsFrom(string $json): ?array
    {
        if (trim($json) === '') {
            return null;
        }
        $decoded = json_decode($json, true);
        if (!is_array($decoded) || (!array_key_exists('product', $decoded) && !array_key_exists('@attributes', $decoded))) {
            return null; // not a licence document at all
        }
        /** @var mixed $raw */
        $raw = $decoded['product'] ?? [];
        $list = array_is_list($raw) ? $raw : [$raw];
        $products = [];
        foreach ($list as $item) {
            if (!is_array($item)) {
                continue;
            }
            $node = self::node($item);
            $name = self::text($node['name'] ?? '');
            $expiry = self::text($node['expired'] ?? '');
            if (self::date($expiry) === '') {
                continue; // no date: a trial without expiry carries nothing to watch
            }
            $products[] = ['key' => substr(sha1($name), 0, 12), 'name' => $name, 'expiry' => $expiry];
        }

        return $products;
    }

    /**
     * One product's expiry date => whole days left (0 on the expiry day, negative after it).
     * Noon-to-noon of the PBX timezone, so a DST change does not shift the day count.
     */
    public static function daysLeft(string $expiry, int $now): int
    {
        $target = strtotime($expiry . ' 12:00:00');
        $today = strtotime(date('Y-m-d', $now) . ' 12:00:00');
        if ($target === false || $today === false) {
            return PHP_INT_MAX;
        }

        return (int)round(($target - $today) / 86400);
    }

    /**
     * Pure: products + cursor => (events, new cursor). Unit-tested against the shapes of the licence XML.
     *
     * @param list<array{key: string, name: string, expiry: string}>|null $products null = no document
     * @param array<string, mixed> $cursor
     * @param list<int> $buckets
     */
    public static function buildBatch(?array $products, array $cursor, int $now, array $buckets, int $intervalSec): SourceBatch
    {
        $intervalSec = max(60, $intervalSec);
        $state = self::readState($cursor);
        $baseline = !($cursor['baseline_done'] ?? false);

        if ($products === null) {
            // no document (no key, marketplace unreachable): not a change, keep the stored series
            return new SourceBatch([], [
                'products' => $state,
                'baseline_done' => !$baseline,
                'next_check_at' => $now + min(self::FAILED_RETRY_SEC, $intervalSec),
                'checked_at' => $now,
            ]);
        }

        $buckets = self::normalizeBuckets($buckets);
        $events = [];
        $next = [];
        foreach ($products as $product) {
            $key = (string)$product['key'];
            $entry = $state[$key] ?? null;
            $entry = is_array($entry) && ($entry['expiry'] ?? '') === $product['expiry']
                ? ['expiry' => $product['expiry'], 'sent' => self::readSent($entry)]
                : ['expiry' => $product['expiry'], 'sent' => []];
            $days = self::daysLeft($product['expiry'], $now);
            $event = self::evaluate($product, $entry['sent'], $days, $buckets, $baseline, $now);
            if ($event !== null) {
                $events[] = $event;
            }
            $next[$key] = $entry;
        }

        return new SourceBatch($events, [
            'products' => $next,
            'baseline_done' => true,
            'next_check_at' => $now + $intervalSec,
            'checked_at' => $now,
        ]);
    }

    /**
     * One product: returns the event (if any) and records the buckets that are now considered sent.
     *
     * @param array{key: string, name: string, expiry: string} $product
     * @param list<string> $sent
     * @param list<int> $buckets
     * @return ?HubEvent
     */
    private static function evaluate(array $product, array &$sent, int $days, array $buckets, bool $baseline, int $now): ?HubEvent
    {
        if ($days < 0) {
            if (in_array(self::BUCKET_EXPIRED, $sent, true)) {
                return null;
            }
            $sent = [self::BUCKET_EXPIRED];

            // an already expired product is a current state, not history: announced on the baseline too
            return self::buildEvent($product, self::BUCKET_EXPIRED, $days, $now);
        }

        $bucket = null;
        foreach (array_reverse($buckets) as $candidate) { // smallest bucket that is reached
            if ($days <= $candidate) {
                $bucket = $candidate;
                break;
            }
        }
        if ($bucket === null) {
            return null;
        }
        $label = (string)$bucket;
        $already = in_array($label, $sent, true);
        // a late start with an untouched series marks the larger buckets as passed: one reminder now,
        // not three at once
        foreach ($buckets as $candidate) {
            if ($candidate >= $bucket && !in_array((string)$candidate, $sent, true)) {
                $sent[] = (string)$candidate;
            }
        }
        if ($already) {
            return null;
        }
        if ($baseline && $bucket !== min($buckets)) {
            return null; // installing the hub is not news about a distant renewal
        }

        return self::buildEvent($product, $label, $days, $now);
    }

    /**
     * @param array{key: string, name: string, expiry: string} $product
     */
    private static function buildEvent(array $product, string $bucket, int $days, int $now): HubEvent
    {
        $expired = $bucket === self::BUCKET_EXPIRED;

        return new HubEvent(
            sourceId: self::ID,
            eventType: self::EVENT_TYPE,
            severity: $expired ? HubEvent::SEVERITY_CRITICAL : HubEvent::SEVERITY_WARNING,
            dedupeKey: 'license:' . $product['key'] . ':' . $product['expiry'] . ':' . $bucket,
            occurredAt: max(1, $now),
            payload: [
                'subject' => [
                    'call' => null,
                    'client_number' => '',
                    'employees' => [],
                    'provider' => null,
                    'license' => [
                        'product' => $product['name'],
                        'expiry' => $product['expiry'],
                        'days_left' => $days,
                        'bucket' => $bucket,
                    ],
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => [],
            ],
        );
    }

    /**
     * The stored series of sent buckets; also reads the flat legacy form so a format change never re-alerts.
     *
     * @param array<string, mixed> $cursor
     * @return array<string, array{expiry: string, sent: list<string>}>
     */
    private static function readState(array $cursor): array
    {
        $state = [];
        $raw = $cursor['products'] ?? [];
        foreach (is_array($raw) ? $raw : [] as $key => $entry) {
            if (!is_string($key) || !is_array($entry) || !is_string($entry['expiry'] ?? null)) {
                continue;
            }
            $state[$key] = ['expiry' => $entry['expiry'], 'sent' => self::readSent($entry)];
        }

        return $state;
    }

    /**
     * @param array<string, mixed> $entry
     * @return list<string>
     */
    private static function readSent(array $entry): array
    {
        $sent = [];
        foreach (is_array($entry['sent'] ?? null) ? $entry['sent'] : [] as $item) {
            if (is_string($item) && $item !== '') {
                $sent[] = $item;
            } elseif (is_int($item)) {
                $sent[] = (string)$item;
            }
        }

        return $sent;
    }

    /**
     * @param list<int> $buckets
     * @return list<int> newest (largest) first, unique, at least one item
     */
    private static function normalizeBuckets(array $buckets): array
    {
        $clean = [];
        foreach ($buckets as $day) {
            if ($day >= 1 && $day <= 365) {
                $clean[$day] = true;
            }
        }
        if ($clean === []) {
            return [14, 7, 1];
        }
        $clean = array_keys($clean);
        rsort($clean, SORT_NUMERIC);

        return array_slice($clean, 0, 5);
    }

    /** XML node as JSON: `@attributes` wins over the plain keys of the same node. @param array<mixed> $node */
    private static function node(array $node): array
    {
        $attributes = $node['@attributes'] ?? null;

        return is_array($attributes) ? $attributes + $node : $node;
    }

    /** @param mixed $value */
    private static function text($value): string
    {
        return is_string($value) ? trim($value) : '';
    }

    /** Strict "YYYY-MM-DD", or '' when the string is not a date. */
    private static function date(string $value): string
    {
        $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        if ($parsed === false || $parsed->format('Y-m-d') !== $value) {
            return '';
        }

        return $value;
    }

    /** @return list<int> */
    private function buckets(): array
    {
        return $this->warnDays === null ? [14, 7, 1] : array_values(array_map('intval', (array)($this->warnDays)()));
    }

    private function interval(): int
    {
        return $this->intervalHours === null ? 6 : (int)($this->intervalHours)();
    }
}
