<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Delivery;

use Modules\ModuleMessengerHub\Lib\Attachments\AttachmentPipeline;
use Modules\ModuleMessengerHub\Lib\Attachments\AttachmentPlan;
use Modules\ModuleMessengerHub\Lib\Attachments\PrepareResult;
use Modules\ModuleMessengerHub\Lib\Channels\AttachmentPart;
use Modules\ModuleMessengerHub\Lib\Channels\AttachmentResult;
use Modules\ModuleMessengerHub\Lib\Channels\BotCredentials;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelInterface;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelLimits;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelRegistry;
use Modules\ModuleMessengerHub\Lib\Channels\Recipient;
use Modules\ModuleMessengerHub\Lib\Channels\SendResult;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;
use Throwable;

/**
 * Sends claimed outbox rows through the channel adapters (Plan/08-reliability.md, Plan/03 stage 3a).
 *
 * - rows are leased; a restarted worker returns stale leases to pending;
 * - rate limits postpone a row instead of failing it;
 * - retry/backoff uses RetryPolicy, but a channel retry_after is never shortened;
 * - an unknown outcome of the TEXT is at-most-once (no duplicate notification); audio is skipped;
 * - recipient_gone marks the chat gone and drops everything queued for it;
 * - permanent errors fail the row; a rejected token marks the bot;
 * - a Telegram group migration updates the chat id and resends immediately.
 *
 * Stage 3a: one row is a main text + N audio parts + an optional fallback note. The text is sent
 * BEFORE any download/conversion, so audio never delays it. Per-part progress is persisted while the
 * row is still leased by this worker; a long conversion extends the lease instead of letting a second
 * worker send the same row.
 */
final class DeliveryService
{
    private const int PREPARE_LEASE_SEC = 1800;
    private const int PREPARE_EXTEND_SEC = 900;
    private const int BUSY_RETRY_SEC = 5;
    private const int MAX_NOT_READY = 3;
    private const array NOT_READY_DELAYS = [5, 10, 20];

    public function __construct(
        private readonly OutboxRepository $outbox,
        private readonly ChannelRegistry $channels,
        private readonly RateLimiter $limiter,
        private readonly string $owner,
        private readonly int $leaseSec = 120,
        private readonly int $batch = 20,
        private readonly ?AttachmentPipeline $attachments = null,
    ) {
    }

    /**
     * @return array{claimed: int, sent: int, retried: int, failed: int, dropped: int}
     */
    public function runOnce(int $now): array
    {
        $stats = ['claimed' => 0, 'sent' => 0, 'retried' => 0, 'failed' => 0, 'dropped' => 0];
        $this->outbox->reclaimExpiredLeases($now);
        $this->outbox->dropStaleInfo($now);

        $ids = $this->outbox->claim($this->batch, $now, $this->owner, $this->leaseSec);
        $stats['claimed'] = count($ids);
        foreach ($ids as $id) {
            // a long batch must not leave the next row with a lease that already expired
            if (!$this->outbox->extendLease($id, $this->owner, time() + max(30, $this->leaseSec), time())) {
                continue; // another worker owns the row now
            }
            try {
                $outcome = $this->deliver($id, $now);
            } catch (Throwable $exception) {
                // never let one row kill the batch; the code, not the message, goes to the log
                $this->outbox->markFailed($id, 0, 'internal_error', $now, $this->owner);
                HubLogger::event('delivery', 'row_failed', ['id' => $id, 'error' => $exception::class], LOG_ERR);
                $outcome = 'failed';
            }
            if (isset($stats[$outcome])) {
                $stats[$outcome]++;
            }
        }

        return $stats;
    }

    /** @return string sent|retried|failed|dropped */
    private function deliver(int $id, int $now): string
    {
        $row = $this->outbox->load($id);
        if ($row === null) {
            // the chat or bot row vanished (deleted bot): never leave the row leased forever
            $this->outbox->markFailed($id, 0, 'delivery_missing', $now, $this->owner);

            return 'failed';
        }
        $botId = (int)$row['bot_id'];
        $attempts = (int)$row['attempts'];

        if ((string)$row['chat_enabled'] !== '1' || (string)$row['chat_state'] !== 'active') {
            $this->outbox->markDropped($id, 'chat_unavailable', $now, $this->owner);

            return 'dropped';
        }
        if ((string)$row['bot_enabled'] !== '1') {
            $this->outbox->markDropped($id, 'bot_disabled', $now, $this->owner);

            return 'dropped';
        }

        $channelId = (string)$row['channel'];
        $channel = $this->channels->find($channelId);
        if ($channel === null) {
            $this->outbox->markFailed($id, $attempts, 'channel_unknown', $now, $this->owner);

            return 'failed';
        }

        $message = $this->rendered($row);
        if ($message === null) {
            $this->outbox->markFailed($id, $attempts, 'render_invalid', $now, $this->owner);

            return 'failed';
        }

        $plan = $this->plan($row);
        $state = DeliveryState::fromJson((string)($row['delivery_parts_json'] ?? ''));
        $legacyIds = json_decode((string)($row['external_message_ids'] ?? '[]'), true);
        if (($row['delivery_parts_json'] ?? null) === null
            && is_array($legacyIds)
            && isset($legacyIds[0])
            && is_string($legacyIds[0])
            && $legacyIds[0] !== ''
        ) {
            // a pre-3a row that already delivered its text: never send it again after the upgrade
            $state->markTextSent($legacyIds[0]);
        }
        if ($plan !== null && $plan->available() && $state->audio === []) {
            foreach (self::audioRanges($plan) as $index => $range) {
                $state->addAudio($index, $range);
            }
        }
        $credentials = new BotCredentials($channelId, (string)$row['token']);
        $recipient = new Recipient(
            (string)$row['external_chat_id'],
            (string)$row['chat_kind'],
            (string)$row['chat_title']
        );
        $limits = $channel->limits();
        $noteAllowed = true;
        $textUncertain = false;

        // ---------- 1. the main text: never delayed by audio ----------
        if ($state->textState === DeliveryState::SENDING) {
            // the previous worker may have reached the messenger: do not send the text twice
            $state->markTextSent('', 'delivery.uncertain');
            if (!$this->save($id, $state, $now)) {
                return 'retried';
            }
            $textUncertain = true;
            HubLogger::event('delivery', 'text_uncertain', ['id' => $id], LOG_WARNING);
        } elseif ($state->textState !== DeliveryState::SENT && $state->textState !== DeliveryState::FAILED) {
            $outgoing = $message;
            if ($plan !== null) {
                if (!$plan->available()) {
                    $outgoing = $message->withLine($plan->fallbackLine);
                    $state->attachmentSkipped($plan->unavailableCode);
                    $plan = null;
                    $noteAllowed = false;
                } elseif ($this->attachments !== null) {
                    $preflight = $this->attachments->preflight($plan);
                    if (!$preflight->ok) {
                        $outgoing = $message->withLine($plan->fallbackLine);
                        $state->attachmentSkipped($preflight->code);
                        $plan = null;
                        $noteAllowed = false;
                    }
                } else {
                    $state->attachmentSkipped('attachment.unavailable');
                    $plan = null;
                }
            }

            $wait = $this->limiter->reserve(
                $botId,
                (string)$row['external_chat_id'],
                (string)$row['chat_kind'],
                $now,
                $limits,
                $channelId
            );
            if ($wait > 0) {
                $this->outbox->markRetry($id, $attempts, $now + $wait, '', false, $now, $this->owner);

                return 'retried';
            }

            $state->markTextSending();
            if (!$this->save($id, $state, $now)) {
                return 'retried'; // another worker owns the row now
            }
            $result = $channel->send($credentials, $recipient, $outgoing);
            if ($result->outcome === SendResult::SENT) {
                $state->markTextSent((string)($result->ids[0] ?? ''));
                if (!$this->save($id, $state, $now)) {
                    return 'retried';
                }
                $this->outbox->markBotOk($botId, $now);
            } else {
                $this->save($id, $state, $now);
                if ($result->outcome === SendResult::RETRY && $result->uncertain) {
                    // at-most-once: the messenger may have the text already, never duplicate it
                    $state->markTextSent('', 'delivery.uncertain');
                    if (!$this->save($id, $state, $now)) {
                        return 'retried';
                    }
                    $textUncertain = true;
                    HubLogger::event('delivery', 'text_uncertain', ['id' => $id], LOG_WARNING);
                } else {
                    if ($result->outcome === SendResult::RECIPIENT_GONE) {
                        $state->markTextFailed($result->code);
                    } else {
                        $state->markTextPending($result->code);
                    }
                    if ($result->outcome === SendResult::PERMANENT) {
                        $state->markTextFailed($result->code);
                    }
                    $this->save($id, $state, $now);

                    return $this->apply($id, $row, $result, $now);
                }
            }
        }

        // ---------- 2. audio parts: after the text, under an extended lease ----------
        if ($textUncertain && $state->hasPendingAudio()) {
            // the text may be missing: an orphan audio or note alone would be confusing
            $this->skipAudio($state, 'attachment.text_uncertain', false);
            $this->save($id, $state, $now);
            $plan = null;
            $noteAllowed = false;
        }
        if ($plan === null && $state->hasPendingAudio()) {
            // keep the preflight/unavailable reason, do not overwrite it with "not applicable"
            $code = $state->attachmentCode !== '' ? $state->attachmentCode : 'attachment.not_applicable';
            $this->skipAudio($state, $code, false);
            $this->save($id, $state, $now);
        }
        $audioFile = [];
        if ($plan !== null && $state->hasPendingAudio()) {
            foreach ($state->audio as $index => $part) {
                if (($part['state'] ?? '') === DeliveryState::SENDING) {
                    // a reclaimed send: the file may have arrived, never duplicate the audio
                    $state->skipAudio((int)$index, 'attachment.uncertain');
                }
            }
            $this->save($id, $state);

            if ($this->attachments === null) {
                $this->skipAudio($state, 'attachment.unavailable');
                $this->save($id, $state, $now);
                $plan = null;
            } else {
                if (!$this->outbox->extendLease($id, $this->owner, $now + self::PREPARE_LEASE_SEC, $now)) {
                    return 'retried'; // another worker owns the row now
                }
                $heartbeat = function (int $at) use ($id): bool {
                    return $this->outbox->extendLease($id, $this->owner, $at + self::PREPARE_EXTEND_SEC, $at);
                };
                try {
                    $prepared = $this->attachments->prepare(
                        (int)$row['event_id'],
                        $plan,
                        $limits,
                        $this->owner,
                        max($now, time()), // a long batch must not hand the cache a stale lease
                        $heartbeat
                    );
                } catch (Throwable $exception) {
                    // a broken preparation must not fail a row whose text is already delivered
                    HubLogger::event('attachments', 'prepare_failed', ['error' => $exception::class], LOG_ERR);
                    $prepared = PrepareResult::failed('attachment.prepare_failed');
                }
                if ($prepared->state === PrepareResult::BUSY) {
                    $this->outbox->markRetry(
                        $id,
                        $attempts,
                        $now + self::BUSY_RETRY_SEC,
                        'attachment.busy',
                        false,
                        $now,
                        $this->owner
                    );

                    return 'retried';
                }
                if ($prepared->state === PrepareResult::RETRY) {
                    if ($attempts < 2) {
                        $this->save($id, $state, $now);

                        return $this->schedule($id, $row, SendResult::retry(30, $prepared->code), $now);
                    }
                    $this->skipAudio($state, $prepared->code);
                    $this->save($id, $state, $now);
                    $plan = null;
                } elseif ($prepared->state === PrepareResult::FAILED) {
                    $this->skipAudio($state, $prepared->code);
                    $this->save($id, $state, $now);
                    $plan = null;
                } else {
                    foreach ($prepared->files as $index => $file) {
                        if (!is_array($file)) {
                            continue;
                        }
                        if (is_string($file['skip_code'] ?? null) && $file['skip_code'] !== '') {
                            $state->skipAudio((int)$index, (string)$file['skip_code']);
                            continue;
                        }
                        if (is_string($file['path'] ?? null) && $file['path'] !== '') {
                            $audioFile[(int)$index] = $file;
                        }
                    }
                    foreach ($state->audio as $index => $part) {
                        if (($part['state'] ?? '') === DeliveryState::PENDING && !isset($audioFile[(int)$index])) {
                            $state->skipAudio((int)$index, 'attachment.source_missing');
                        }
                    }
                    $this->save($id, $state, $now);
                }
            }
        }

        if ($plan !== null && $state->hasPendingAudio()) {
            $audioOutcome = $this->sendAudioParts(
                $id,
                $row,
                $channel,
                $credentials,
                $recipient,
                $limits,
                $state,
                $audioFile,
                $plan,
                $attempts,
                $now
            );
            if ($audioOutcome !== '') {
                return $audioOutcome;
            }
        }
        if ($state->audio !== [] && !$state->hasPendingAudio()) {
            $state->recalculateAttachment();
            if ($noteAllowed && self::hasSkippedAudio($state)) {
                $state->addNote();
            }
            $this->save($id, $state, $now);
        }

        // ---------- 3. a short fallback note only when a late failure left the chat without audio ----------
        if ($state->hasNote() && in_array($state->noteState, [DeliveryState::PENDING, DeliveryState::SENDING], true)) {
            $noteOutcome = $this->sendNote($id, $row, $channel, $credentials, $recipient, $limits, $state, $now);
            if ($noteOutcome !== '') {
                return $noteOutcome;
            }
        }

        // ---------- 4. done ----------
        if ($state->isComplete()) {
            $state->recalculateAttachment();
            if (!$this->outbox->markSentWithParts($id, $state->toArray(), $state->externalIds(), $now, $this->owner)) {
                return 'retried'; // another worker owns the row now
            }
            $this->outbox->markBotOk($botId, $now);
            if ($this->attachments !== null) {
                try {
                    $this->attachments->cleanupEvent((int)$row['event_id'], $now);
                } catch (Throwable $exception) {
                    HubLogger::event('attachments', 'cleanup_failed', ['error' => $exception::class], LOG_WARNING);
                }
            }

            return 'sent';
        }

        // a defensive stop: a part is still pending, retry by the shared policy instead of looping forever
        $nextAttempt = $attempts + 1;
        $delay = RetryPolicy::delayAfter($nextAttempt);
        if ($delay === null) {
            $this->outbox->markFailed($id, $nextAttempt, 'delivery.incomplete', $now, $this->owner);
            HubLogger::event('delivery', 'delivery_failed', ['id' => $id, 'code' => 'delivery.incomplete'], LOG_WARNING);

            return 'failed';
        }
        $this->outbox->markRetry($id, $nextAttempt, $now + $delay, 'delivery.incomplete', false, $now, $this->owner);

        return 'retried';
    }

    /**
     * @param array<string, mixed> $row
     * @param array<int, array<string, mixed>> $files
     * @return string '' when the parts were processed, otherwise a row outcome for runOnce
     */
    private function sendAudioParts(
        int $id,
        array $row,
        ChannelInterface $channel,
        BotCredentials $credentials,
        Recipient $recipient,
        ChannelLimits $limits,
        DeliveryState $state,
        array $files,
        AttachmentPlan $plan,
        int $attempts,
        int $now,
    ): string {
        $botId = (int)$row['bot_id'];
        foreach (array_keys($state->audio) as $index) {
            $index = (int)$index;
            $part = $state->audioPart($index);
            if (($part['state'] ?? '') !== DeliveryState::PENDING) {
                continue;
            }
            $file = $files[$index] ?? null;
            if (!is_array($file) || !is_string($file['path'] ?? null) || $file['path'] === '') {
                $state->skipAudio($index, 'attachment.source_missing');
                $this->save($id, $state);
                continue;
            }
            $bytes = (int)($file['bytes'] ?? 0);
            if ($limits->maxFileBytes > 0 && $bytes > $limits->maxFileBytes) {
                $state->skipAudio($index, 'attachment.too_big');
                $this->save($id, $state);
                continue;
            }
            $durationMs = (int)($file['duration_ms'] ?? 0);
            if ($limits->maxFileDurationSec > 0 && $durationMs > $limits->maxFileDurationSec * 1000) {
                $state->skipAudio($index, 'attachment.duration_too_long');
                $this->save($id, $state);
                continue;
            }

            $wait = $this->limiter->reserve(
                $botId,
                (string)$row['external_chat_id'],
                (string)$row['chat_kind'],
                $now,
                $limits,
                (string)$row['channel']
            );
            if ($wait > 0) {
                $this->save($id, $state);
                $this->outbox->markRetry($id, $attempts, $now + $wait, '', false, $now, $this->owner);

                return 'retried';
            }

            $state->markAudioSending($index);
            if (!$this->save($id, $state)) {
                return 'retried';
            }
            $result = $channel->sendAttachment(
                $credentials,
                $recipient,
                new AttachmentPart(
                    (string)$file['path'],
                    $plan->caption($index),
                    (string)($part['token'] ?? '')
                )
            );
            if ($result->result->outcome === SendResult::SENT) {
                $state->markAudioSent($index, (string)($result->result->ids[0] ?? ''));
                $this->save($id, $state);
                $this->outbox->markBotOk($botId, $now);
                continue;
            }
            if ($result->result->outcome === SendResult::RECIPIENT_GONE) {
                $this->save($id, $state);

                return $this->apply($id, $row, $result->result, $now);
            }
            if ($result->result->outcome === SendResult::PERMANENT) {
                // one bad part must not lose the text or the other parts (413 / MAX size error)
                $state->skipAudio($index, self::audioCode($result->result->code));
                $this->save($id, $state);
                continue;
            }
            if ($result->notReady) {
                $count = $state->markAudioNotReady($index, $result->pendingToken);
                $this->save($id, $state);
                if ($count < self::MAX_NOT_READY) {
                    $delay = self::NOT_READY_DELAYS[min($count - 1, count(self::NOT_READY_DELAYS) - 1)];
                    $this->outbox->markRetry(
                        $id,
                        $attempts + 1,
                        $now + $delay,
                        'max.attachment.not_ready',
                        false,
                        $now,
                        $this->owner
                    );

                    return 'retried';
                }
                $state->skipAudio($index, 'max.attachment.not_ready');
                $this->save($id, $state);
                continue;
            }
            if ($result->result->uncertain) {
                $state->skipAudio($index, 'attachment.uncertain');
                $this->save($id, $state);
                continue;
            }
            $state->markAudioPending($index, $result->result->code);
            $this->save($id, $state);

            return $this->schedule($id, $row, $result->result, $now);
        }

        $state->recalculateAttachment();
        if (self::hasSkippedAudio($state)) {
            $state->addNote();
        }
        $this->save($id, $state);

        return '';
    }

    /**
     * @param array<string, mixed> $row
     * @return string '' processed, otherwise a row outcome
     */
    private function sendNote(
        int $id,
        array $row,
        ChannelInterface $channel,
        BotCredentials $credentials,
        Recipient $recipient,
        ChannelLimits $limits,
        DeliveryState $state,
        int $now,
    ): string {
        $botId = (int)$row['bot_id'];
        $attempts = (int)$row['attempts'];
        $plan = $this->plan($row);
        $line = $plan?->fallbackLine ?? '';
        if ($line === '') {
            $state->markNoteFailed('attachment.note_missing');
            $this->save($id, $state);

            return '';
        }
        if ($state->noteState === DeliveryState::SENDING) {
            $state->markNoteSent('', 'delivery.uncertain');
            $this->save($id, $state);

            return '';
        }
        $wait = $this->limiter->reserve(
            $botId,
            (string)$row['external_chat_id'],
            (string)$row['chat_kind'],
            $now,
            $limits,
            (string)$row['channel']
        );
        if ($wait > 0) {
            $this->save($id, $state);
            $this->outbox->markRetry($id, $attempts, $now + $wait, '', false, $now, $this->owner);

            return 'retried';
        }
        $state->markNoteSending();
        if (!$this->save($id, $state)) {
            return 'retried';
        }
        $result = $channel->send($credentials, $recipient, new RenderedMessage(lines: [$line]));
        if ($result->outcome === SendResult::SENT) {
            $state->markNoteSent((string)($result->ids[0] ?? ''));
            $this->save($id, $state);
            $this->outbox->markBotOk($botId, $now);

            return '';
        }
        if ($result->outcome === SendResult::RECIPIENT_GONE) {
            $this->save($id, $state);

            return $this->apply($id, $row, $result, $now);
        }
        if ($result->outcome === SendResult::PERMANENT) {
            // the information is nice to have; the text itself is already delivered
            $state->markNoteFailed($result->code);
            $this->save($id, $state);

            return '';
        }
        if ($result->uncertain) {
            $state->markNoteSent('', 'delivery.uncertain');
            $this->save($id, $state);

            return '';
        }
        $state->markNotePending($result->code);
        $this->save($id, $state);

        return $this->schedule($id, $row, $result, $now);
    }

    /** @param array<string, mixed> $row */
    private function apply(int $id, array $row, SendResult $result, int $now): string
    {
        return $this->applyResult($id, $row, $result, $now, true);
    }

    /** @param array<string, mixed> $row */
    private function schedule(int $id, array $row, SendResult $result, int $now): string
    {
        return $this->applyResult($id, $row, $result, $now, false);
    }

    /** @param array<string, mixed> $row */
    private function applyResult(int $id, array $row, SendResult $result, int $now, bool $markRowOnPermanent): string
    {
        $chatId = (int)$row['chat_id'];
        $botId = (int)$row['bot_id'];
        $attempts = (int)$row['attempts'];

        if ($result->outcome === SendResult::RECIPIENT_GONE) {
            HubLogger::event('delivery', 'recipient_gone', ['chat_id' => $chatId, 'code' => $result->code]);
            $this->outbox->markChatGone($chatId, $result->code, $now);

            return 'dropped';
        }

        if ($result->outcome === SendResult::PERMANENT && $markRowOnPermanent) {
            $this->outbox->markFailed($id, $attempts + 1, $result->code, $now, $this->owner);
            if (str_contains($result->code, '.401.')) {
                $this->outbox->markBotError($botId, 'token_invalid', $result->code, $now);
            } elseif (str_contains($result->code, '.tls.')) {
                // a TLS trust problem is a bot configuration error, not a message problem (Plan/08)
                $this->outbox->markBotError($botId, 'ca_error', $result->code, $now);
            }
            HubLogger::event('delivery', 'delivery_failed', ['id' => $id, 'code' => $result->code], LOG_WARNING);

            return 'failed';
        }

        // RETRY (a permanent result never reaches here for an audio part: it is skipped instead)
        if ($result->migratedChatId !== null) {
            if (!$this->outbox->updateChatId($chatId, $result->migratedChatId)) {
                return 'dropped';
            }
            $this->outbox->markRetry($id, $attempts + 1, $now, $result->code, false, $now, $this->owner);

            return 'retried';
        }

        if ($result->uncertain) {
            if ((int)$row['uncertain_attempts'] >= 1) {
                $this->outbox->markFailed($id, $attempts + 1, $result->code, $now, $this->owner);

                return 'failed';
            }
            $delay = RetryPolicy::delayAfter($attempts + 1) ?? 60;
            $this->outbox->markRetry(
                $id,
                $attempts + 1,
                $now + max($delay, $result->retryAfterSec),
                $result->code,
                true,
                $now,
                $this->owner
            );

            return 'retried';
        }

        $nextAttempt = $attempts + 1;
        $delay = RetryPolicy::delayAfter($nextAttempt);
        if ($delay === null) {
            $this->outbox->markFailed($id, $nextAttempt, $result->code, $now, $this->owner);
            HubLogger::event('delivery', 'delivery_failed', ['id' => $id, 'code' => $result->code], LOG_WARNING);

            return 'failed';
        }
        $this->outbox->markRetry(
            $id,
            $nextAttempt,
            $now + max($delay, $result->retryAfterSec),
            $result->code,
            false,
            $now,
            $this->owner
        );

        return 'retried';
    }

    private function save(int $id, DeliveryState $state, ?int $now = null): bool
    {
        return $this->outbox->saveParts(
            $id,
            $this->owner,
            $state->toArray(),
            $state->externalIds(),
            $now ?? time(),
            time() + max(30, $this->leaseSec)
        );
    }

    private function skipAudio(DeliveryState $state, string $code, bool $addNote = true): void
    {
        foreach (array_keys($state->audio) as $index) {
            $part = $state->audioPart((int)$index);
            if (($part['state'] ?? '') === DeliveryState::PENDING || ($part['state'] ?? '') === DeliveryState::SENDING) {
                $state->skipAudio((int)$index, $code);
            }
        }
        $state->attachmentSkipped($code);
        if ($addNote) {
            $state->addNote();
        }
    }

    private static function hasSkippedAudio(DeliveryState $state): bool
    {
        foreach ($state->audio as $part) {
            if (($part['state'] ?? '') === DeliveryState::SKIPPED) {
                return true;
            }
        }

        return false;
    }

    /** @return list<array{start_ms: int, end_ms: int}> */
    private static function audioRanges(AttachmentPlan $plan): array
    {
        return $plan->fragments === [] ? [['start_ms' => 0, 'end_ms' => 0]] : array_values($plan->fragments);
    }

    private static function audioCode(string $code): string
    {
        return $code !== '' ? $code : 'attachment.rejected';
    }

    /** @param array<string, mixed> $row */
    private function plan(array $row): ?AttachmentPlan
    {
        $decoded = json_decode((string)($row['attachment_json'] ?? ''), true);

        return is_array($decoded) ? AttachmentPlan::fromArray($decoded) : null;
    }

    /** @param array<string, mixed> $row */
    private function rendered(array $row): ?RenderedMessage
    {
        $decoded = json_decode((string)($row['rendered_json'] ?? ''), true);
        if (!is_array($decoded)) {
            return null;
        }

        return RenderedMessage::fromArray($decoded);
    }
}
