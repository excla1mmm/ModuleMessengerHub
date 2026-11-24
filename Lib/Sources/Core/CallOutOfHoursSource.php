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
 * core.call_out_of_hours — push source over AMI "UserEvent: CdrConnector" (Plan/02-sources.md, 4s-B).
 *
 * Core's out-of-work-time dialplan routes an incoming call into `[playback-exit]`, which runs
 * `Gosub(dial_outworktimes,...)` once per call (src/Core/Asterisk/Configs/ExtensionsOutWorkTimeConf.php:161-163)
 * and then plays the message and hangs up. The Lua handler publishes the fact as a CdrConnector UserEvent
 * with action "dial_outworktimes" (src/Core/Asterisk/Configs/lua/extensions.lua:1845-1867) on top of the
 * regular dial fields built by event_dial() (src_num, did, start, linkedid).
 *
 * The event carries no off-work-time rule id/description: the generated dialplan does not pass the rule to
 * the handler (Plan/11, open question). The payload therefore keeps those fields empty instead of guessing.
 */
final class CallOutOfHoursSource implements SourceInterface, AmiEventSource
{
    public const string ID = 'core.call_out_of_hours';
    public const string USER_EVENT = 'CdrConnector';
    public const string ACTION = 'dial_outworktimes';

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
        $data = AgiDataDecoder::decode((string)($parameters['AgiData'] ?? ''));
        if ($data === null || ($data['action'] ?? '') !== self::ACTION) {
            return;
        }
        $event = self::buildEvent($data, $now);
        if ($event !== null) {
            $recorder->record($event, $now);
        }
    }

    public function tick(SourceRecorder $recorder, int $now): void
    {
    }

    /**
     * @param array<string, mixed> $fields decoded CdrConnector payload
     */
    public static function buildEvent(array $fields, int $now): ?HubEvent
    {
        $linkedid = trim((string)($fields['linkedid'] ?? ''));
        if ($linkedid === '') {
            return null;
        }
        $caller = trim((string)($fields['src_num'] ?? ''));
        $did = trim((string)($fields['did'] ?? ''));
        $startedAt = MissedCallSource::strToTs((string)($fields['start'] ?? ''));

        return new HubEvent(
            sourceId: self::ID,
            eventType: self::ID,
            severity: HubEvent::SEVERITY_WARNING,
            dedupeKey: 'ooh:' . $linkedid,
            occurredAt: $startedAt > 0 ? $startedAt : $now,
            payload: [
                'subject' => [
                    'call' => [
                        'linkedid' => $linkedid,
                        'direction' => 'incoming',
                        'started_at' => $startedAt > 0 ? $startedAt : $now,
                        'did' => $did,
                        'rule_id' => null,
                        'rule_name' => '',
                    ],
                    'client_number' => $caller,
                    'employees' => [],
                    'provider' => null,
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => [],
            ],
        );
    }
}
