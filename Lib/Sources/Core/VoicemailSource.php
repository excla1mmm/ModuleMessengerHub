<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources\Core;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Sources\AmiEventSource;
use Modules\ModuleMessengerHub\Lib\Sources\SourceBatch;
use Modules\ModuleMessengerHub\Lib\Sources\SourceContext;
use Modules\ModuleMessengerHub\Lib\Sources\SourceInterface;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRecorder;

/**
 * core.voicemail — push source over AMI "UserEvent: voicemail_end"
 * (Core sbin/voicemail-sender publishes it after a voice message is stored).
 *
 * The recording path is stored only as an attachment reference; the file itself is read
 * and delivered by later stages.
 */
final class VoicemailSource implements SourceInterface, AmiEventSource
{
    public const string ID = 'core.voicemail';
    public const string USER_EVENT = 'voicemail_end';

    public function id(): string
    {
        return self::ID;
    }

    public function eventTypes(): array
    {
        return [self::ID];
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

    public function amiUserEvents(): array
    {
        return [self::USER_EVENT];
    }

    public function onAmiEvent(array $parameters, SourceRecorder $recorder, int $now): void
    {
        if (($parameters['UserEvent'] ?? '') !== self::USER_EVENT) {
            return;
        }
        $event = self::buildEvent($parameters, $now);
        if ($event !== null) {
            $recorder->record($event, $now);
        }
    }

    public function tick(SourceRecorder $recorder, int $now): void
    {
    }

    /**
     * @param array<string, string> $fields raw AMI event fields (linkedid, vm-recordingfile, endtime)
     */
    public static function buildEvent(array $fields, int $now): ?HubEvent
    {
        $linkedid = trim((string)($fields['linkedid'] ?? ''));
        if ($linkedid === '') {
            return null;
        }
        $recording = trim((string)($fields['vm-recordingfile'] ?? ''));
        $occurredAt = MissedCallSource::strToTs((string)($fields['endtime'] ?? '')) ?: $now;

        return new HubEvent(
            sourceId: self::ID,
            eventType: self::ID,
            severity: HubEvent::SEVERITY_INFO,
            dedupeKey: 'voicemail:' . $linkedid,
            occurredAt: $occurredAt,
            payload: [
                'subject' => [
                    'call' => ['linkedid' => $linkedid],
                    'client_number' => '',
                    'employees' => [],
                    'provider' => null,
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => $recording === '' ? [] : [['kind' => 'recording', 'path' => $recording]],
            ],
        );
    }
}
