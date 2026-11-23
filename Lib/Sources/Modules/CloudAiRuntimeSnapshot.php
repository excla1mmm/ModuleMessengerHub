<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\SourceException;

/**
 * Reader of ModuleCloudAISupervisor `GET /pbxcore/api/v3/module-cloud-ai-supervisor/runtime` (needs
 * `read`: the module's RestRequestContext::isAdministrator accepts `read` of the exact path for GET).
 * The module ships no `/status` (decision of 2026-11-23, Plan/11 Q10).
 *
 * Fields used: `pause.paused`, `pause.pause_reason`, `pause.paused_at` (seconds), `summary.analysis_pending`
 * (the counter, when present). A paused module becomes one `processing_paused` issue with `ref` = the
 * reason code and `since` = paused_at, exactly the issue the module's own status builder produced.
 * Balance amounts, model names and limits are never read.
 */
final class CloudAiRuntimeSnapshot
{
    public const string API_PATH = '/api/v3/module-cloud-ai-supervisor/runtime';
    public const string PATH = '/pbxcore' . self::API_PATH;

    private const string REASON_PATTERN = '/^[a-z][a-z0-9_]{0,63}$/';

    /**
     * @param array<string, mixed> $data PBXApiResult data of `/runtime`
     * @return array{state: string, since: int, issues: list<array<string, mixed>>, counters: array<string, int>}
     */
    public static function snapshot(array $data): array
    {
        $pause = $data['pause'] ?? null;
        if (!is_array($pause) || !is_bool($pause['paused'] ?? null)) {
            throw new SourceException('api_bad_response');
        }
        $reason = is_string($pause['pause_reason'] ?? null) ? trim($pause['pause_reason']) : '';
        $issues = [];
        if ($pause['paused'] === true && preg_match(self::REASON_PATTERN, $reason) === 1) {
            $issues[] = [
                'code' => 'processing_paused',
                'ref' => $reason,
                'severity' => in_array($reason, ['insufficient_funds', 'low_balance'], true)
                    ? HubEvent::SEVERITY_CRITICAL
                    : HubEvent::SEVERITY_WARNING,
                'since' => max(0, (int)($pause['paused_at'] ?? 0)),
            ];
        }

        $counters = [];
        $summary = $data['summary'] ?? null;
        if (is_array($summary) && is_int($summary['analysis_pending'] ?? null)) {
            $counters['jobs_waiting'] = max(0, $summary['analysis_pending']);
        }

        return [
            'state' => $issues === [] ? 'ok' : 'paused',
            'since' => $issues === [] ? 0 : (int)$issues[0]['since'],
            'issues' => $issues,
            'counters' => $counters,
        ];
    }
}
