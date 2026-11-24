<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * event_type -> template. A rule may pin a template_key, but stage 2 has exactly one template per
 * event type; an unknown type is not rendered and produces no delivery.
 */
final class TemplateRegistry
{
    /** @var array<string, TemplateInterface> */
    private array $templates;

    /** @param array<string, TemplateInterface>|null $templates */
    public function __construct(?array $templates = null)
    {
        $this->templates = $templates ?? [
            'core.missed_call' => new MissedCallTemplate(),
            'core.voicemail' => new VoicemailTemplate(),
            'core.provider_down' => new ProviderStatusTemplate(),
            'core.provider_up' => new ProviderStatusTemplate(),
            'core.advice' => new AdviceTemplate(),
            'core.pbx_started' => new PbxStartedTemplate(),
            'core.config_changed' => new ConfigChangeTemplate(),
            'core.external_ip_changed' => new ExternalIpTemplate(),
            'core.license_expiring' => new LicenseExpiryTemplate(),
            'ai_supervisor.attention_call' => new AttentionCallTemplate(),
            'ai_supervisor.worker_offline' => new AiWorkerTemplate(),
            'ai_supervisor.worker_online' => new AiWorkerTemplate(),
            'local_stt.worker_offline' => new ModuleStatusTemplate(),
            'local_stt.worker_online' => new ModuleStatusTemplate(),
            'local_stt.backlog_no_workers' => new ModuleStatusTemplate(),
            'local_stt.backlog_resolved' => new ModuleStatusTemplate(),
            'cloud_stt.incident' => new ModuleStatusTemplate(),
            'cloud_stt.incident_resolved' => new ModuleStatusTemplate(),
            'cloud_stt.paused' => new ModuleStatusTemplate(),
            'cloud_stt.resumed' => new ModuleStatusTemplate(),
            'cloud_ai.paused' => new ModuleStatusTemplate(),
            'cloud_ai.resumed' => new ModuleStatusTemplate(),
            'voice_agent.callback_request' => new CallbackRequestTemplate(),
            'voice_agent.runtime_down' => new RuntimeTemplate(),
            'voice_agent.runtime_up' => new RuntimeTemplate(),
            'hub.test' => new TestTemplate(),
        ];
    }

    public function forEvent(string $eventType): ?TemplateInterface
    {
        return $this->templates[$eventType] ?? null;
    }
}
