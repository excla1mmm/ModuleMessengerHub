<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Events;

use InvalidArgumentException;

/**
 * Normalised hub event (Plan/05-events-rules-templates.md). Immutable value object.
 *
 * The payload carries facts only (subject, facts, links, attachments) — never rendered text:
 * templates render per channel later.
 */
final class HubEvent
{
    public const string SEVERITY_INFO = 'info';
    public const string SEVERITY_WARNING = 'warning';
    public const string SEVERITY_CRITICAL = 'critical';

    private const array SEVERITIES = [self::SEVERITY_INFO, self::SEVERITY_WARNING, self::SEVERITY_CRITICAL];
    private const int MAX_DEDUPE_KEY_LENGTH = 255;

    /**
     * @param array<string, mixed> $payload
     */
    public function __construct(
        public readonly string $sourceId,
        public readonly string $eventType,
        public readonly string $severity,
        public readonly string $dedupeKey,
        public readonly int $occurredAt,
        public readonly array $payload = [],
    ) {
        if (preg_match('/^[a-z0-9_]+\.[a-z0-9_]+$/', $eventType) !== 1) {
            throw new InvalidArgumentException('event_type must look like "<source>.<event>"');
        }
        if ($sourceId === '') {
            throw new InvalidArgumentException('source_id is required');
        }
        if (!in_array($severity, self::SEVERITIES, true)) {
            throw new InvalidArgumentException('unknown severity');
        }
        if ($dedupeKey === '' || strlen($dedupeKey) > self::MAX_DEDUPE_KEY_LENGTH) {
            throw new InvalidArgumentException('dedupe_key must be 1..255 bytes');
        }
        if ($occurredAt <= 0) {
            throw new InvalidArgumentException('occurred_at must be a unix timestamp');
        }
    }

    public static function severityRank(string $severity): int
    {
        $rank = array_search($severity, self::SEVERITIES, true);

        return $rank === false ? -1 : $rank;
    }

    public function payloadJson(): string
    {
        return json_encode(
            $this->payload,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        );
    }
}
