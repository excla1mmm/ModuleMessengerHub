<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Modules;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;

/**
 * One `issues[].code` of a module /status resource and what the hub does with it (stage 3b).
 *
 * severityByRef maps opaque refs (reason codes, queue labels) to a severity; the default is used
 * for everything else. ignoreRefs produce no events at all — Cloud AI `not_configured` is a
 * permanent configuration state of a PBX that never enabled cloud AI, not an outage.
 */
final class ModuleStatusRule
{
    /**
     * @param array<string, string> $severityByRef
     * @param list<string> $ignoreRefs
     */
    public function __construct(
        public readonly string $code,
        public readonly string $eventType,
        public readonly ?string $recoveryEventType,
        public readonly string $severity = HubEvent::SEVERITY_WARNING,
        public readonly int $debounceSec = 0,
        public readonly array $severityByRef = [],
        public readonly array $ignoreRefs = [],
    ) {
        if ($this->code === '' || $this->eventType === '') {
            throw new \InvalidArgumentException('module status rule needs a code and an event type');
        }
    }

    /** @param array{code: string, event?: string, event_type?: string, recovery?: string, severity?: string,
     *     debounce?: int, severity_by_ref?: array<string, string>, ignore_refs?: list<string>} $config */
    public static function fromArray(array $config): self
    {
        return new self(
            code: (string)$config['code'],
            eventType: (string)($config['event_type'] ?? $config['event'] ?? ''),
            recoveryEventType: isset($config['recovery']) ? (string)$config['recovery'] : null,
            severity: (string)($config['severity'] ?? HubEvent::SEVERITY_WARNING),
            debounceSec: max(0, (int)($config['debounce'] ?? 0)),
            severityByRef: (array)($config['severity_by_ref'] ?? []),
            ignoreRefs: array_values(array_map('strval', (array)($config['ignore_refs'] ?? []))),
        );
    }

    public function ignores(string $ref): bool
    {
        return in_array($ref, $this->ignoreRefs, true);
    }

    /**
     * The rule may pin a severity per ref; the module's own issue severity is honoured only when
     * the rule says so (Cloud STT incidents already classify themselves).
     */
    public function severityFor(string $ref, string $issueSeverity): string
    {
        if (isset($this->severityByRef[$ref])) {
            return $this->severityByRef[$ref];
        }
        if (in_array($issueSeverity, [
            HubEvent::SEVERITY_INFO,
            HubEvent::SEVERITY_WARNING,
            HubEvent::SEVERITY_CRITICAL,
        ], true)) {
            return $issueSeverity;
        }

        return $this->severity;
    }
}
