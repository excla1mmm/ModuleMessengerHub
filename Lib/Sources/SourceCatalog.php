<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

use Modules\ModuleMessengerHub\Lib\Sources\Modules\ModuleStatusSource;

/**
 * UI metadata of sources: interface group, name/event-type/module/availability translation keys.
 *
 * Pure data so the REST layer stays Core-free and testable (Plan/06, getSources).
 * Group order is the fixed order of the approved design: Calls → AI Supervisor → Speech recognition and cloud AI → Voice agent → PBX
 * (the speech/cloud-AI group sits next to the AI Supervisor: the same audience, the same AI pipeline).
 */
final class SourceCatalog
{
    public const string GROUP_CALLS = 'calls';
    public const string GROUP_AI_SUPERVISOR = 'ai_supervisor';
    public const string GROUP_SPEECH_AI = 'speech_ai';
    public const string GROUP_VOICE_AGENT = 'voice_agent';
    public const string GROUP_PBX = 'pbx';

    /** @var list<string> */
    public const array GROUP_ORDER = [
        self::GROUP_CALLS,
        self::GROUP_AI_SUPERVISOR,
        self::GROUP_SPEECH_AI,
        self::GROUP_VOICE_AGENT,
        self::GROUP_PBX,
    ];

    private const string KEY_PREFIX = 'module_messenger_hub_';

    /** source id → interface group */
    private const array SOURCE_GROUPS = [
        'core.missed_call' => self::GROUP_CALLS,
        'core.voicemail' => self::GROUP_CALLS,
        'ai_supervisor.attention_call' => self::GROUP_AI_SUPERVISOR,
        'ai_supervisor.workers' => self::GROUP_AI_SUPERVISOR,
        'local_stt.workers' => self::GROUP_SPEECH_AI,
        'local_stt.backlog' => self::GROUP_SPEECH_AI,
        'cloud_stt.incidents' => self::GROUP_SPEECH_AI,
        'cloud_stt.paused' => self::GROUP_SPEECH_AI,
        'cloud_ai.paused' => self::GROUP_SPEECH_AI,
        'voice_agent.callbacks' => self::GROUP_VOICE_AGENT,
        'voice_agent.runtime' => self::GROUP_VOICE_AGENT,
        'core.provider_status' => self::GROUP_PBX,
        'core.advice' => self::GROUP_PBX,
        'core.pbx_started' => self::GROUP_PBX,
    ];

    /** event type → translation key suffix */
    private const array EVENT_TYPE_KEYS = [
        'core.missed_call' => 'EventTypeMissedCall',
        'core.missed_call_resolved' => 'EventTypeMissedCallResolved',
        'core.voicemail' => 'EventTypeVoicemail',
        'core.provider_down' => 'EventTypeProviderDown',
        'core.provider_up' => 'EventTypeProviderUp',
        'core.advice' => 'EventTypeAdvice',
        'core.pbx_started' => 'EventTypePbxStarted',
        'ai_supervisor.attention_call' => 'EventTypeAttentionCall',
        'ai_supervisor.worker_offline' => 'EventTypeWorkerOffline',
        'ai_supervisor.worker_online' => 'EventTypeWorkerOnline',
        'local_stt.worker_offline' => 'EventTypeLocalSttWorkerOffline',
        'local_stt.worker_online' => 'EventTypeLocalSttWorkerOnline',
        'local_stt.backlog_no_workers' => 'EventTypeLocalSttBacklog',
        'local_stt.backlog_resolved' => 'EventTypeLocalSttBacklogResolved',
        'cloud_stt.incident' => 'EventTypeCloudSttIncident',
        'cloud_stt.incident_resolved' => 'EventTypeCloudSttIncidentResolved',
        'cloud_stt.paused' => 'EventTypeCloudSttPaused',
        'cloud_stt.resumed' => 'EventTypeCloudSttResumed',
        'cloud_ai.paused' => 'EventTypeCloudAiPaused',
        'cloud_ai.resumed' => 'EventTypeCloudAiResumed',
        'voice_agent.callback_request' => 'EventTypeCallbackRequest',
        'voice_agent.runtime_down' => 'EventTypeRuntimeDown',
        'voice_agent.runtime_up' => 'EventTypeRuntimeUp',
    ];

    /** moduleUniqueID → translation key suffix */
    private const array MODULE_NAME_KEYS = [
        'ModuleAISupervisor' => 'ModuleAISupervisor',
        'ModuleVoiceAgent' => 'ModuleVoiceAgent',
        'ModuleLocalSpeechToText' => 'ModuleLocalSpeechToText',
        'ModuleCloudSpeechToText' => 'ModuleCloudSpeechToText',
        'ModuleCloudAISupervisor' => 'ModuleCloudAISupervisor',
    ];

    /** SourceAvailability value → translation key suffix */
    private const array AVAILABILITY_KEYS = [
        SourceAvailability::AVAILABLE => 'SourceStateOk',
        SourceAvailability::DISABLED => 'SourceStateOff',
        SourceAvailability::MODULE_MISSING => 'SourceStateNoinst',
        SourceAvailability::MODULE_DISABLED => 'SourceStateModoff',
        SourceAvailability::API_FORBIDDEN => 'SourceStateNoacc',
        SourceAvailability::API_INCOMPATIBLE => 'SourceStateOutdated',
        SourceAvailability::ERROR => 'SourceStateErr',
    ];

    public static function group(string $sourceId): string
    {
        return self::SOURCE_GROUPS[$sourceId] ?? self::GROUP_PBX;
    }

    private const array SOURCE_NAME_KEYS = [
        'core.missed_call' => 'SourceMissedCalls',
        'core.voicemail' => 'SourceVoicemail',
        'core.provider_status' => 'SourceProviderStatus',
        'core.advice' => 'SourceAdvice',
        'core.pbx_started' => 'SourcePbxStarted',
        'ai_supervisor.attention_call' => 'SourceAttentionCall',
        'ai_supervisor.workers' => 'SourceAiWorkers',
        'local_stt.workers' => 'SourceLocalSttWorkers',
        'local_stt.backlog' => 'SourceLocalSttBacklog',
        'cloud_stt.incidents' => 'SourceCloudSttIncidents',
        'cloud_stt.paused' => 'SourceCloudSttPaused',
        'cloud_ai.paused' => 'SourceCloudAiPaused',
        'voice_agent.callbacks' => 'SourceVaCallbacks',
        'voice_agent.runtime' => 'SourceVaRuntime',
    ];

    /** Translation key of the source display name. */
    public static function nameKey(string $sourceId): string
    {
        return self::KEY_PREFIX . (self::SOURCE_NAME_KEYS[$sourceId] ?? 'Source_' . str_replace('.', '_', $sourceId));
    }

    /** Translation key of an event type display name (null for unknown types). */
    public static function eventTypeKey(string $eventType): ?string
    {
        return isset(self::EVENT_TYPE_KEYS[$eventType])
            ? self::KEY_PREFIX . self::EVENT_TYPE_KEYS[$eventType]
            : null;
    }

    /** @return list<string> all event types the hub knows (catalog, not the registry) */
    public static function knownEventTypes(): array
    {
        return array_keys(self::EVENT_TYPE_KEYS);
    }

    /** Source id that produces an event type (null for unknown types). */
    public static function sourceForEventType(string $eventType): ?string
    {
        foreach (self::SOURCE_GROUPS as $sourceId => $group) {
            if (in_array($eventType, self::sourceEventTypes($sourceId), true)) {
                return $sourceId;
            }
        }

        return null;
    }

    /** @return list<string> event types of a source */
    public static function eventTypes(string $sourceId): array
    {
        return self::sourceEventTypes($sourceId);
    }

    /** @return array<string, string> event type → translation key, preserving the source's order */
    public static function eventTypeKeys(string $sourceId): array
    {
        $keys = [];
        foreach (self::sourceEventTypes($sourceId) as $type) {
            $key = self::eventTypeKey($type);
            if ($key !== null) {
                $keys[$type] = $key;
            }
        }

        return $keys;
    }

    /** Translation key of a module display name (null when the module has no friendly name yet). */
    public static function moduleNameKey(string $moduleUniqueId): ?string
    {
        return isset(self::MODULE_NAME_KEYS[$moduleUniqueId])
            ? self::KEY_PREFIX . self::MODULE_NAME_KEYS[$moduleUniqueId]
            : null;
    }

    public static function groupKey(string $group): string
    {
        return self::KEY_PREFIX . match ($group) {
            self::GROUP_CALLS => 'GroupCalls',
            self::GROUP_AI_SUPERVISOR => 'GroupAiSupervisor',
            self::GROUP_SPEECH_AI => 'GroupSpeechAi',
            self::GROUP_VOICE_AGENT => 'GroupVoiceAgent',
            default => 'GroupPbx',
        };
    }

    /**
     * Minimal module version that serves the source contract ('' when the source has no such bound).
     * A source whose `/status` answers 404 reports availability api_incompatible; the interface can
     * then say "update the module to <version>" instead of a generic error.
     */
    public static function minVersion(string $sourceId): string
    {
        return ModuleStatusSource::profileFor($sourceId)?->minVersion ?? '';
    }

    public static function availabilityKey(string $availability): ?string
    {
        return isset(self::AVAILABILITY_KEYS[$availability])
            ? self::KEY_PREFIX . self::AVAILABILITY_KEYS[$availability]
            : null;
    }

    /** Event types the source can produce, read from the adapter contract without instantiating Core glue. */
    private static function sourceEventTypes(string $sourceId): array
    {
        return match ($sourceId) {
            'core.missed_call' => ['core.missed_call'],
            'core.voicemail' => ['core.voicemail'],
            'core.provider_status' => ['core.provider_down', 'core.provider_up'],
            'core.advice' => ['core.advice'],
            'core.pbx_started' => ['core.pbx_started'],
            'ai_supervisor.attention_call' => ['ai_supervisor.attention_call'],
            'ai_supervisor.workers' => ['ai_supervisor.worker_offline', 'ai_supervisor.worker_online'],
            'local_stt.workers' => ['local_stt.worker_offline', 'local_stt.worker_online'],
            'local_stt.backlog' => ['local_stt.backlog_no_workers', 'local_stt.backlog_resolved'],
            'cloud_stt.incidents' => ['cloud_stt.incident', 'cloud_stt.incident_resolved'],
            'cloud_stt.paused' => ['cloud_stt.paused', 'cloud_stt.resumed'],
            'cloud_ai.paused' => ['cloud_ai.paused', 'cloud_ai.resumed'],
            'voice_agent.callbacks' => ['voice_agent.callback_request'],
            'voice_agent.runtime' => ['voice_agent.runtime_down', 'voice_agent.runtime_up'],
            default => [],
        };
    }
}
