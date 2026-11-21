<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Delivery;

use Modules\ModuleMessengerHub\Lib\Channels\BotCredentials;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelRegistry;
use Modules\ModuleMessengerHub\Lib\Channels\Recipient;
use Modules\ModuleMessengerHub\Lib\Channels\SendResult;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;
use Throwable;

/**
 * Executes retraction requests through the same queue, retries and channel limits as sends
 * (Plan/12, "Доставка"; Plan/08).
 *
 * - the stored external message ids (text and every attachment) are deleted one by one;
 * - a missing message counts as deleted (idempotent);
 * - a bot removed from the chat or a permanent API error ends in `retract_failed` at once;
 * - transient failures use RetryPolicy, a 429 honours retry_after;
 * - a rate-limited row is postponed, not failed.
 */
final class RetractionService
{
    public function __construct(
        private readonly OutboxRepository $outbox,
        private readonly ChannelRegistry $channels,
        private readonly RateLimiter $limiter,
        private readonly string $owner,
        private readonly int $leaseSec = 120,
        private readonly int $batch = 10,
    ) {
    }

    /**
     * @return array{claimed: int, retracted: int, retried: int, failed: int}
     */
    public function runOnce(int $now): array
    {
        $stats = ['claimed' => 0, 'retracted' => 0, 'retried' => 0, 'failed' => 0];
        $ids = $this->outbox->claimRetractions($this->batch, $now, $this->owner, $this->leaseSec);
        $stats['claimed'] = count($ids);
        foreach ($ids as $id) {
            try {
                $outcome = $this->retract($id, $now);
            } catch (Throwable $exception) {
                $this->outbox->markRetractFailed($id, 0, 'internal_error', $now);
                HubLogger::event('retraction', 'row_failed', ['id' => $id, 'error' => $exception::class], LOG_ERR);
                $outcome = 'failed';
            }
            if (isset($stats[$outcome])) {
                $stats[$outcome]++;
            }
        }

        return $stats;
    }

    /** @return string retracted|retried|failed */
    private function retract(int $id, int $now): string
    {
        $row = $this->outbox->loadRetraction($id);
        if ($row === null) {
            $this->outbox->markRetractFailed($id, 0, 'retraction_missing', $now);

            return 'failed';
        }
        $attempts = (int)($row['retract_attempts'] ?? 0);
        if ($row['chat_present'] === null || $row['bot_present'] === null) {
            // the bot or its chat row is gone: the message cannot be deleted any more
            $this->outbox->markRetractFailed($id, $attempts + 1, 'bot_deleted', $now);

            return 'failed';
        }
        $channelId = (string)$row['channel'];
        $channel = $this->channels->find($channelId);
        if ($channel === null) {
            $this->outbox->markRetractFailed($id, $attempts + 1, 'channel_unknown', $now);

            return 'failed';
        }

        $wait = $this->limiter->reserve(
            (int)$row['bot_id'],
            (string)$row['external_chat_id'],
            (string)$row['chat_kind'],
            $now,
            $channel->limits(),
            $channelId
        );
        if ($wait > 0) {
            $this->outbox->markRetractRetry($id, $attempts, $now + $wait, '', $now);

            return 'retried';
        }

        $ids = json_decode((string)($row['external_message_ids'] ?? '[]'), true);
        $ids = is_array($ids) ? array_values(array_filter($ids, static fn (mixed $v): bool => is_string($v) && $v !== '')) : [];
        if ($ids === []) {
            // nothing to delete (e.g. an old row): the goal is reached
            $this->outbox->markRetracted($id, $now);

            return 'retracted';
        }

        // TODO(stage 3a): attachments give a row several ids; MAX allows two deletes per second per
        // chat, so the reservation will have to happen per delete (today a row has one text id).
        $credentials = new BotCredentials($channelId, (string)$row['token']);
        $recipient = new Recipient((string)$row['external_chat_id'], (string)$row['chat_kind'], (string)$row['chat_title']);
        foreach ($ids as $externalId) {
            $result = $channel->delete($credentials, $recipient, $externalId);
            if ($result->outcome === SendResult::SENT) {
                continue;
            }
            if ($result->outcome === SendResult::RECIPIENT_GONE || $result->outcome === SendResult::PERMANENT) {
                $this->outbox->markRetractFailed($id, $attempts + 1, $result->code, $now);
                HubLogger::event('retraction', 'failed', ['id' => $id, 'code' => $result->code], LOG_WARNING);

                return 'failed';
            }
            $nextAttempt = $attempts + 1;
            $delay = RetryPolicy::delayAfter($nextAttempt);
            if ($delay === null) {
                $this->outbox->markRetractFailed($id, $nextAttempt, $result->code, $now);
                HubLogger::event('retraction', 'failed', ['id' => $id, 'code' => $result->code], LOG_WARNING);

                return 'failed';
            }
            $this->outbox->markRetractRetry(
                $id,
                $nextAttempt,
                $now + max($delay, $result->retryAfterSec),
                $result->code,
                $now
            );

            return 'retried';
        }

        $this->outbox->markRetracted($id, $now);

        return 'retracted';
    }
}
