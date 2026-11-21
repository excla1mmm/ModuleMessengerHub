<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing;

use Modules\ModuleMessengerHub\Lib\Attachments\AttachmentMode;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;

/**
 * One routing rule (Plan/05-events-rules-templates.md).
 *
 * All matching rules fire; the Outbox unique index keeps one message per (event, chat).
 * Stage 2 filters (user decision Q14): employees, call direction, providers, and for
 * ai_supervisor.attention_call the quality score range. Groups/departments are a stage 4 To Do.
 */
final class Rule
{
    public const string MODE_RECIPIENTS = 'recipients';
    public const string MODE_EMPLOYEE = 'employee';
    public const string MODE_EMPLOYEE_OR_RECIPIENTS = 'employee_or_recipients';

    /**
     * @param list<string> $eventTypes
     * @param array<string, mixed> $filters
     * @param list<int> $chatIds
     * @param array<string, mixed> $options
     */
    public function __construct(
        public readonly int $id,
        public readonly string $title,
        public readonly bool $enabled,
        public readonly array $eventTypes,
        public readonly string $minSeverity,
        public readonly array $filters,
        public readonly string $targetMode,
        public readonly array $chatIds,
        public readonly string $templateKey,
        public readonly array $options,
        public readonly int $sort,
    ) {
    }

    /** @param array<string, mixed> $row */
    public static function fromRow(array $row): self
    {
        $decode = static function (mixed $json, array $default): array {
            $decoded = json_decode(is_string($json) ? $json : '', true);

            return is_array($decoded) ? $decoded : $default;
        };
        $eventTypes = [];
        foreach ($decode($row['event_types'] ?? '[]', []) as $type) {
            if (is_string($type) && $type !== '') {
                $eventTypes[] = $type;
            }
        }
        $chatIds = [];
        foreach ($decode($row['chat_ids_json'] ?? '[]', []) as $chatId) {
            if (is_int($chatId) || (is_string($chatId) && ctype_digit($chatId))) {
                $chatIds[] = (int)$chatId;
            }
        }

        return new self(
            id: (int)($row['id'] ?? 0),
            title: (string)($row['title'] ?? ''),
            enabled: (string)($row['enabled'] ?? '0') === '1',
            eventTypes: $eventTypes,
            minSeverity: (string)($row['min_severity'] ?? HubEvent::SEVERITY_INFO),
            filters: $decode($row['filters_json'] ?? '{}', []),
            targetMode: (string)($row['target_mode'] ?? self::MODE_RECIPIENTS),
            chatIds: $chatIds,
            templateKey: (string)($row['template_key'] ?? ''),
            options: $decode($row['options_json'] ?? '{}', []),
            sort: (int)($row['sort'] ?? 100),
        );
    }

    public function matches(HubEvent $event): bool
    {
        if (!$this->enabled || !EventTypeMatcher::matches($this->eventTypes, $event->eventType)) {
            return false;
        }
        if (HubEvent::severityRank($event->severity) < HubEvent::severityRank($this->minSeverity)) {
            return false;
        }

        return $this->filtersMatch($event);
    }

    /** Masking: the rule wins, otherwise the global default (Plan/05). */
    public function maskPhone(bool $globalDefault): bool
    {
        $value = $this->options['mask_phone'] ?? null;

        return is_bool($value) ? $value : $globalDefault;
    }

    /**
     * Audio attachment mode (Plan/05): `none` by default, a legacy boolean is not a mode.
     */
    public function attachmentsMode(): string
    {
        return AttachmentMode::fromOptions($this->options);
    }

    /** @return list<int> */
    public function eventUserIds(HubEvent $event): array
    {
        $ids = [];
        $employees = $event->payload['subject']['employees'] ?? null;
        foreach (is_array($employees) ? $employees : [] as $employee) {
            $id = is_array($employee) ? (int)($employee['user_id'] ?? 0) : 0;
            if ($id > 0) {
                $ids[$id] = true;
            }
        }

        return array_keys($ids);
    }

    private function filtersMatch(HubEvent $event): bool
    {
        return $this->employeesMatch($event)
            && $this->directionsMatch($event)
            && $this->providersMatch($event)
            && $this->qualityMatch($event);
    }

    private function employeesMatch(HubEvent $event): bool
    {
        $wanted = self::ints($this->filters['user_ids'] ?? []);
        if ($wanted === []) {
            return true;
        }

        return array_intersect($wanted, $this->eventUserIds($event)) !== [];
    }

    private function directionsMatch(HubEvent $event): bool
    {
        $wanted = self::strings($this->filters['directions'] ?? []);
        if ($wanted === []) {
            return true;
        }
        $direction = (string)($event->payload['subject']['call']['direction'] ?? '');

        return $direction !== '' && in_array($direction, $wanted, true);
    }

    private function providersMatch(HubEvent $event): bool
    {
        $wanted = self::strings($this->filters['providers'] ?? []);
        if ($wanted === []) {
            return true;
        }
        $provider = $event->payload['subject']['provider'] ?? null;
        if (!is_array($provider)) {
            return false;
        }
        $id = (string)($provider['id'] ?? '');
        $username = (string)($provider['username'] ?? '');

        return ($id !== '' && in_array($id, $wanted, true))
            || ($username !== '' && in_array($username, $wanted, true));
    }

    private function qualityMatch(HubEvent $event): bool
    {
        $range = $this->filters['quality_score'] ?? null;
        if (!is_array($range) || (!isset($range['min']) && !isset($range['max']))) {
            return true;
        }
        if ($event->eventType !== 'ai_supervisor.attention_call') {
            return true;
        }
        $score = $event->payload['facts']['scores']['quality'] ?? null;
        if (!is_numeric($score)) {
            return false; // a rule that asks for a range needs a score to compare
        }
        $score = (float)$score;
        if (isset($range['min']) && is_numeric($range['min']) && $score < (float)$range['min']) {
            return false;
        }
        if (isset($range['max']) && is_numeric($range['max']) && $score > (float)$range['max']) {
            return false;
        }

        return true;
    }

    /** @return list<int> */
    private static function ints(mixed $value): array
    {
        $result = [];
        foreach (is_array($value) ? $value : [] as $item) {
            if (is_int($item) || (is_string($item) && ctype_digit($item))) {
                $result[] = (int)$item;
            }
        }

        return $result;
    }

    /** @return list<string> */
    private static function strings(mixed $value): array
    {
        $result = [];
        foreach (is_array($value) ? $value : [] as $item) {
            if (is_string($item) && $item !== '') {
                $result[] = $item;
            }
        }

        return $result;
    }
}
