<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRecorder;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Modules\ModuleMessengerHub\Lib\Sources\TickingSource;

/**
 * core.provider_status — push source fed by the Core hook onProviderStatusChange
 * (Core GetAllStatusesAction sends changes[] only for real transitions; UNKNOWN seeds are skipped there).
 *
 * State mapping follows Core AbstractProviderStatusAction::isSuccessState/isFailureState:
 *  - down:  unregistered, rejected, unreachable, lagged (case-insensitive);
 *  - up:    registered, ok, reachable;
 *  - other (UNKNOWN, REMOVED, ...) are ignored.
 *
 * Debounce (replaces the old cooldown, which could swallow the recovery event):
 *  - the hook only stores per provider the current state and the time it changed (+ the last EMITTED state)
 *    in the source cursor (m_MessengerHubSourceState) — a couple of cheap local statements, no network;
 *  - tick() (called by WorkerMessengerHubCollector every pass) emits an event once the current state has held
 *    for DEBOUNCE_SEC and differs from the last emitted state. Invariant: the last emitted state converges to
 *    the actual state, so a recovery is never suppressed;
 *  - the first state ever seen for a provider (no emitted state yet) emits only when it is "down" — an "up" is
 *    recorded silently as the baseline, so installing the hub does not announce every provider as up.
 * dedupe_key = provider:{id}:{down|up}:{change_ts} is stable per real transition.
 */
final class ProviderStatusSource implements SourceInterface, TickingSource
{
    public const string ID = 'core.provider_status';
    public const string EVENT_DOWN = 'core.provider_down';
    public const string EVENT_UP = 'core.provider_up';

    /** A state must hold this long before it is announced. */
    public const int DEBOUNCE_SEC = 120;

    private const array DOWN_STATES = ['unregistered', 'rejected', 'unreachable', 'lagged'];
    private const array UP_STATES = ['registered', 'ok', 'reachable'];

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
        return null;
    }

    public function apiReadPaths(): array
    {
        return [];
    }

    public function mode(): string
    {
        return SourceInterface::MODE_PUSH;
    }

    public function pollIntervalSec(): int
    {
        return 0;
    }

    public function poll(SourceContext $context, array $cursor): SourceBatch
    {
        return SourceBatch::baseline([]);
    }

    /** @return string|null core.provider_down | core.provider_up | null (no event for this state) */
    public static function eventTypeForState(string $state): ?string
    {
        $state = strtolower(trim($state));
        if (in_array($state, self::DOWN_STATES, true)) {
            return self::EVENT_DOWN;
        }
        if (in_array($state, self::UP_STATES, true)) {
            return self::EVENT_UP;
        }

        return null;
    }

    /**
     * Hook side (pure): fold Core changes[] into the per-provider debounce state.
     *
     * @param list<array<string, mixed>> $changes Core changes[] (provider_id, type, old_state, new_state,
     *     username, host, timestamp, details)
     * @param array<string, array<string, mixed>> $providers cursor["providers"]:
     *     id => {state: down|up, since: int, emitted: ''|down|up, meta: array}
     * @return array<string, array<string, mixed>>
     */
    public static function applyChanges(array $changes, array $providers, int $now): array
    {
        foreach ($changes as $change) {
            if (!is_array($change)) {
                continue;
            }
            $providerId = trim((string)($change['provider_id'] ?? ''));
            $eventType = self::eventTypeForState((string)($change['new_state'] ?? ''));
            if ($providerId === '' || $eventType === null) {
                continue;
            }
            $state = $eventType === self::EVENT_DOWN ? 'down' : 'up';
            $provider = $providers[$providerId] ?? ['state' => '', 'since' => 0, 'emitted' => '', 'meta' => []];
            $meta = [
                'type' => (string)($change['type'] ?? ''),
                'old_state' => (string)($change['old_state'] ?? ''),
                'new_state' => (string)($change['new_state'] ?? ''),
                'username' => (string)($change['username'] ?? ''),
                'host' => (string)($change['host'] ?? ''),
                'details' => (string)($change['details'] ?? ''),
            ];
            if (($provider['state'] ?? '') !== $state) {
                $provider['state'] = $state;
                $provider['since'] = max(1, (int)($change['timestamp'] ?? $now));
            }
            $provider['emitted'] = (string)($provider['emitted'] ?? '');
            $provider['meta'] = $meta;
            $providers[$providerId] = $provider;
        }

        return $providers;
    }

    /**
     * Worker side (pure): emit what has been stable for $debounceSec and differs from the last emitted state.
     *
     * @param array<string, array<string, mixed>> $providers
     * @return array{0: list<HubEvent>, 1: array<string, array<string, mixed>>}
     */
    public static function flush(array $providers, int $debounceSec, int $now): array
    {
        $events = [];
        foreach ($providers as $providerId => $provider) {
            $state = (string)($provider['state'] ?? '');
            $emitted = (string)($provider['emitted'] ?? '');
            $since = (int)($provider['since'] ?? 0);
            if (!in_array($state, ['down', 'up'], true) || $state === $emitted || $now - $since < $debounceSec) {
                continue;
            }
            // first state ever seen: "up" is the baseline, only "down" is news
            if ($emitted !== '' || $state === 'down') {
                $events[] = self::buildEvent(
                    is_array($provider['meta'] ?? null) ? $provider['meta'] : [],
                    (string)$providerId,
                    $state === 'down' ? self::EVENT_DOWN : self::EVENT_UP,
                    $since
                );
            }
            $providers[$providerId]['emitted'] = $state;
        }

        return [$events, $providers];
    }

    public function tick(SourceStateRepository $states, SourceRecorder $recorder, int $now): void
    {
        $cursor = $states->get(self::ID);
        if (!$cursor['enabled']) {
            return;
        }
        $providers = $cursor['cursor']['providers'] ?? [];
        if (!is_array($providers) || $providers === []) {
            return;
        }
        [$events, $flushed] = self::flush($providers, self::DEBOUNCE_SEC, $now);
        if ($flushed === $providers) {
            return;
        }
        foreach ($events as $event) {
            $recorder->record($event, $now);
        }
        // lost the race with the hook: the hook's newer state wins, the next pass flushes again
        // (events are idempotent by dedupe_key)
        $states->compareAndSaveCursor(self::ID, $cursor['cursor'], ['providers' => $flushed] + $cursor['cursor']);
    }

    /**
     * @param array<string, mixed> $change provider meta (type, old_state, new_state, username, host, details)
     */
    private static function buildEvent(array $change, string $providerId, string $eventType, int $changeTs): HubEvent
    {
        $isDown = $eventType === self::EVENT_DOWN;

        return new HubEvent(
            sourceId: self::ID,
            eventType: $eventType,
            severity: $isDown ? HubEvent::SEVERITY_CRITICAL : HubEvent::SEVERITY_INFO,
            dedupeKey: 'provider:' . $providerId . ':' . ($isDown ? 'down' : 'up') . ':' . $changeTs,
            occurredAt: $changeTs,
            payload: [
                'subject' => [
                    'call' => null,
                    'client_number' => '',
                    'employees' => [],
                    'provider' => [
                        'id' => $providerId,
                        'type' => (string)($change['type'] ?? ''),
                        'old_state' => (string)($change['old_state'] ?? ''),
                        'new_state' => (string)($change['new_state'] ?? ''),
                        'username' => (string)($change['username'] ?? ''),
                        'host' => (string)($change['host'] ?? ''),
                        'details' => (string)($change['details'] ?? ''),
                    ],
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => [],
            ],
        );
    }
}
