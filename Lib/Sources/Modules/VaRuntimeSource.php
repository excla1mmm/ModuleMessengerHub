<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;

/**
 * voice_agent.runtime — poll source over ModuleVoiceAgent REST v3
 * GET /pbxcore/api/v3/module-voice-agent/runtime -> data.health (Plan/02-sources.md).
 *
 * health.state mapping: up = ok; down = unreachable, error, unauthorized; not_configured is
 * neither (nothing deployed — a configuration state, not an outage): it produces no event and
 * leaves the last real state in the cursor, so a later real transition still fires.
 * dedupe_key va_runtime:{down|up}:{transition-ts}.
 */
final class VaRuntimeSource implements SourceInterface
{
    public const string ID = 'voice_agent.runtime';
    public const string EVENT_DOWN = 'voice_agent.runtime_down';
    public const string EVENT_UP = 'voice_agent.runtime_up';
    public const string API_READ_PATH = '/api/v3/module-voice-agent/runtime';
    public const string PATH = '/pbxcore' . self::API_READ_PATH;

    private const array DOWN_STATES = ['unreachable', 'error', 'unauthorized'];

    public function id(): string
    {
        return self::ID;
    }

    public function eventTypes(): array
    {
        return [self::EVENT_DOWN, self::EVENT_UP];
    }

    public function requiredModule(): ?string
    {
        return 'ModuleVoiceAgent';
    }

    public function apiReadPaths(): array
    {
        return [self::API_READ_PATH];
    }

    public function mode(): string
    {
        return SourceInterface::MODE_POLL;
    }

    public function pollIntervalSec(): int
    {
        return 60;
    }

    public function poll(SourceContext $context, array $cursor): SourceBatch
    {
        $data = $context->rest->get(self::PATH);
        $health = is_array($data['health'] ?? null) ? $data['health'] : [];

        return self::buildBatch($health, $cursor, $context->now());
    }

    /**
     * @param array<string, mixed> $health data.health
     */
    public static function buildBatch(array $health, array $cursor, int $now): SourceBatch
    {
        $state = self::normalizeState((string)($health['state'] ?? ''));
        $previous = (string)($cursor['state'] ?? '');
        if ($cursor === []) {
            return SourceBatch::baseline(['state' => $state, 'since' => $now]);
        }
        if ($state === '' || $state === $previous) {
            return new SourceBatch([], $cursor);
        }

        $down = $state === 'down';
        $event = new HubEvent(
            sourceId: self::ID,
            eventType: $down ? self::EVENT_DOWN : self::EVENT_UP,
            severity: $down ? HubEvent::SEVERITY_CRITICAL : HubEvent::SEVERITY_INFO,
            dedupeKey: 'va_runtime:' . ($down ? 'down' : 'up') . ':' . $now,
            occurredAt: $now,
            payload: [
                'subject' => [
                    'call' => null,
                    'client_number' => '',
                    'employees' => [],
                    'provider' => null,
                    'runtime' => [
                        'state' => $state,
                        'previous_state' => $previous,
                        'health_state' => (string)($health['state'] ?? ''),
                        'error' => (string)($health['error'] ?? ''),
                        'latency_ms' => (int)($health['latency_ms'] ?? 0),
                        'runtime_version' => (string)($health['runtime_version'] ?? ''),
                        'checked_at' => (int)($health['checked_at'] ?? 0),
                    ],
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => [],
            ],
        );

        return new SourceBatch([$event], ['state' => $state, 'since' => $now]);
    }

    /** @return string up|down|'' (not_configured and unknown states are not transitions) */
    public static function normalizeState(string $healthState): string
    {
        $state = strtolower(trim($healthState));
        if ($state === 'ok') {
            return 'up';
        }
        if (in_array($state, self::DOWN_STATES, true)) {
            return 'down';
        }

        return '';
    }
}
