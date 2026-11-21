<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

/**
 * Restores the "client number → recent missed calls" index from the event journal (Plan/12).
 *
 * Runs once when the AMI worker starts; runtime additions come from MissedCallSource itself.
 */
final class RecentMissedLoader
{
    private const int LIMIT = 500;

    /**
     * @return list<array{linkedid: string, client_norm: string, occurred_at: int}>
     */
    public static function load(HubDatabase $db, int $now): array
    {
        $rows = $db->fetchAll(
            'SELECT occurred_at, payload_json FROM m_MessengerHubEvents'
            . ' WHERE event_type = :type AND occurred_at >= :from ORDER BY occurred_at DESC LIMIT ' . self::LIMIT,
            ['type' => MissedCallSource::ID, 'from' => $now - MissedCallSource::RESOLVE_WINDOW_SEC]
        );
        $result = [];
        foreach ($rows as $row) {
            $payload = json_decode((string)($row['payload_json'] ?? ''), true);
            if (!is_array($payload)) {
                continue;
            }
            $subject = is_array($payload['subject'] ?? null) ? $payload['subject'] : [];
            $call = is_array($subject['call'] ?? null) ? $subject['call'] : [];
            $linkedid = (string)($call['linkedid'] ?? '');
            $norm = MissedCallSource::normalizeNumber((string)($subject['client_number'] ?? ''));
            if ($linkedid === '' || $norm === '') {
                continue;
            }
            $result[] = [
                'linkedid' => $linkedid,
                'client_norm' => $norm,
                'occurred_at' => (int)($row['occurred_at'] ?? 0),
            ];
        }

        return $result;
    }
}
