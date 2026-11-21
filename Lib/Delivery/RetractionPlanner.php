<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Delivery;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\RuleRepository;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

/**
 * Turns a `core.missed_call_resolved` event into queue actions (Plan/12, "Доставка").
 *
 * For every delivery of the original missed call it checks the rule that produced it:
 *  - the rule must have `retract_on_callback.enabled`;
 *  - the callback must fall inside the rule's window (5–120 min) after the missed call;
 *  - an incoming answered call only counts when `count_incoming_answered` is true.
 *
 * A queued delivery becomes `cancelled`; a sent one gets a retraction request that
 * RetractionService executes through the channel. Everything else is left untouched.
 */
final class RetractionPlanner
{
    public const string RESOLVED_TYPE = 'core.missed_call_resolved';
    public const int DEFAULT_WINDOW_MIN = 20;
    public const int MIN_WINDOW_MIN = 5;
    public const int MAX_WINDOW_MIN = 120;

    public function __construct(
        private readonly HubDatabase $db,
        private readonly RuleRepository $rules,
    ) {
    }

    /**
     * @return array{cancelled: int, requested: int, skipped: int}
     */
    public function apply(HubEvent $resolved, int $now): array
    {
        $stats = ['cancelled' => 0, 'requested' => 0, 'skipped' => 0];
        $subject = is_array($resolved->payload['subject'] ?? null) ? $resolved->payload['subject'] : [];
        $call = is_array($subject['call'] ?? null) ? $subject['call'] : [];
        $missedLinkedid = (string)($call['missed_linkedid'] ?? '');
        if ($missedLinkedid === '') {
            return $stats;
        }
        $missed = $this->db->fetchOne(
            'SELECT id, occurred_at FROM m_MessengerHubEvents WHERE dedupe_key = :key',
            ['key' => 'missed:' . $missedLinkedid]
        );
        if ($missed === null) {
            return $stats;
        }
        $delta = $resolved->occurredAt - (int)$missed['occurred_at'];
        if ($delta < 0) {
            return $stats;
        }
        $direction = (string)($call['direction'] ?? '');
        $resolvedBy = self::employeeLabel($subject['employees'] ?? []);
        $outbox = new OutboxRepository($this->db);

        foreach ($outbox->rowsForEvent((int)$missed['id']) as $row) {
            $rule = (int)($row['rule_id'] ?? 0) > 0 ? $this->rules->find((int)$row['rule_id']) : null;
            $config = $rule?->options['retract_on_callback'] ?? null;
            if (!is_array($config) || ($config['enabled'] ?? false) !== true) {
                $stats['skipped']++;

                continue;
            }
            $windowMin = max(
                self::MIN_WINDOW_MIN,
                min(self::MAX_WINDOW_MIN, (int)($config['window_min'] ?? self::DEFAULT_WINDOW_MIN))
            );
            if ($delta > $windowMin * 60) {
                $stats['skipped']++;

                continue;
            }
            $countIncoming = !array_key_exists('count_incoming_answered', $config)
                || $config['count_incoming_answered'] === true;
            if ($direction === 'incoming' && !$countIncoming) {
                $stats['skipped']++;

                continue;
            }

            $status = (string)$row['status'];
            if ($status === 'pending') {
                $parts = json_decode((string)($row['delivery_parts_json'] ?? ''), true);
                if (is_array($parts) && (($parts['text']['state'] ?? '') === 'sent')) {
                    // the text is already in the chat: finish the row as sent, then retract it
                    $outbox->finalizeTextSentRow((int)$row['id'], 'resolved_after_send', $now);
                    if ($outbox->requestRetraction((int)$row['id'], 'resolved_after_send', $resolved->occurredAt, $resolvedBy, $now) === 1) {
                        $stats['requested']++;
                    } else {
                        $stats['skipped']++;
                    }

                    continue;
                }
                if ($outbox->cancelForResolved((int)$row['id'], 'resolved_before_send', $resolved->occurredAt, $resolvedBy, $now) === 1) {
                    $stats['cancelled']++;
                }

                continue;
            }
            if ($status === 'sent' || $status === 'sending') {
                if ($outbox->requestRetraction((int)$row['id'], 'resolved_after_send', $resolved->occurredAt, $resolvedBy, $now) === 1) {
                    $stats['requested']++;
                }

                continue;
            }
            $stats['skipped']++;
        }

        return $stats;
    }

    /** @param mixed $employees */
    private static function employeeLabel(mixed $employees): string
    {
        foreach (is_array($employees) ? $employees : [] as $employee) {
            if (!is_array($employee)) {
                continue;
            }
            $name = trim((string)($employee['name'] ?? ''));
            $number = trim((string)($employee['number'] ?? ''));
            if ($name !== '' && $number !== '') {
                return $name . ' (' . $number . ')';
            }
            if ($name !== '') {
                return $name;
            }
            if ($number !== '') {
                return $number;
            }
        }

        return '';
    }
}
