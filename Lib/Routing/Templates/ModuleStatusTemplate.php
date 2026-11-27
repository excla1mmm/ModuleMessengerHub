<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\MessageFormat;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;
use Modules\ModuleMessengerHub\Lib\Sources\SourceCatalog;

/**
 * Stage 3b module status events (local_stt.*, cloud_stt.*, cloud_ai.*, ai_supervisor.worker_*).
 *
 * The event carries fixed codes only; this template turns a (code, ref) pair into a human phrase
 * from the catalog. A raw code never becomes the main text: an unknown pair falls back to a neutral
 * "the module state changed" line. Counters of the poll are shown as italic notes, then the start
 * time of the episode.
 */
final class ModuleStatusTemplate implements TemplateInterface
{
    /** event type => catalog key of one sentence (onset and recovery differ). */
    private const array RECOVERY_TEXT_KEYS = [
        'local_stt.worker_online' => 'MessageStatusWorkerOnline',
        'local_stt.backlog_resolved' => 'MessageStatusBacklogResolved',
        'cloud_stt.incident_resolved' => 'MessageStatusIncidentResolved',
        'cloud_stt.resumed' => 'MessageStatusResumed',
        'cloud_ai.resumed' => 'MessageStatusCloudAiResumed',
        'ai_supervisor.worker_online' => 'MessageStatusWorkerOnline',
    ];

    /** code => catalog key for the onset line. */
    private const array CODE_TEXT_KEYS = [
        'worker_offline' => 'MessageStatusWorkerOffline',
        'backlog_no_workers' => 'MessageStatusBacklog',
        'incident_open' => 'MessageStatusIncident',
    ];

    /** code => ref => catalog key, where the reason changes the words. */
    private const array REF_TEXT_KEYS = [
        'processing_paused' => [
            'user' => 'MessageStatusPausedUser',
            'maintenance' => 'MessageStatusPausedMaintenance',
            'recovery_blocked' => 'MessageStatusPausedRecoveryBlocked',
            'manual' => 'MessageStatusCloudAiManual',
            'license_missing' => 'MessageStatusCloudAiLicense',
            'auth_invalid' => 'MessageStatusCloudAiAuth',
            'model_unavailable' => 'MessageStatusCloudAiModel',
            'daily_limit_reached' => 'MessageStatusCloudAiDailyLimit',
            'source_unavailable' => 'MessageStatusCloudAiSourceUnavailable',
            'insufficient_funds' => 'MessageStatusCloudAiInsufficientFunds',
            'low_balance' => 'MessageStatusCloudAiLowBalance',
        ],
    ];

    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $status = is_array($subject['module_status'] ?? null) ? $subject['module_status'] : [];
        $texts = $context->texts;
        $code = (string)($status['code'] ?? '');
        $ref = (string)($status['ref'] ?? '');

        $typeKey = SourceCatalog::eventTypeKey($event->eventType);
        $title = $typeKey === null ? $texts->t('module_messenger_hub_MessageStatusUnknown') : $texts->t($typeKey);

        $lines = [];
        $moduleKey = SourceCatalog::moduleNameKey((string)($status['module'] ?? ''));
        if ($moduleKey !== null) {
            $lines[] = $texts->t($moduleKey);
        }
        $lines[] = $texts->t('module_messenger_hub_' . $this->textKey($event->eventType, $code, $ref));

        $notes = [];
        $counters = is_array($status['counters'] ?? null) ? $status['counters'] : [];
        $online = $counters['workers_online'] ?? null;
        $total = $counters['workers_total'] ?? null;
        if (is_int($online) && is_int($total)) {
            $notes[] = $texts->t('module_messenger_hub_MessageStatusWorkersCounters', [
                'online' => $online,
                'total' => $total,
            ]);
        }
        if (isset($counters['jobs_waiting']) && is_int($counters['jobs_waiting'])) {
            $notes[] = $texts->t('module_messenger_hub_MessageStatusJobsWaiting', [
                'count' => $counters['jobs_waiting'],
            ]);
        }
        if (isset($counters['incidents_open']) && is_int($counters['incidents_open'])) {
            $notes[] = $texts->t('module_messenger_hub_MessageStatusIncidentsOpen', [
                'count' => $counters['incidents_open'],
            ]);
        }
        $since = (int)($status['since'] ?? 0);
        if ($since > 0) {
            $notes[] = $texts->t('module_messenger_hub_MessageStatusSince', [
                'time' => MessageFormat::time($since),
            ]);
        }

        return new RenderedMessage(title: $title, lines: $lines, notes: $notes);
    }

    private function textKey(string $eventType, string $code, string $ref): string
    {
        $key = self::RECOVERY_TEXT_KEYS[$eventType] ?? null;

        return $key
            ?? self::REF_TEXT_KEYS[$code][$ref]
            ?? self::CODE_TEXT_KEYS[$code]
            ?? 'MessageStatusUnknown';
    }
}
