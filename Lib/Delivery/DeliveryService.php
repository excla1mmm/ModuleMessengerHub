<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Delivery;

use Modules\ModuleMessengerHub\Lib\Channels\BotCredentials;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelRegistry;
use Modules\ModuleMessengerHub\Lib\Channels\Recipient;
use Modules\ModuleMessengerHub\Lib\Channels\SendResult;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;
use Throwable;

/**
 * Sends claimed outbox rows through the channel adapters (Plan/08-reliability.md).
 *
 * - rows are leased; a restarted worker returns stale leases to pending;
 * - rate limits postpone a row instead of failing it;
 * - retry/backoff uses RetryPolicy, but a channel retry_after is never shortened;
 * - an unknown outcome is retried at most once ("не более одного повтора при неизвестном исходе");
 * - recipient_gone marks the chat gone and drops everything queued for it;
 * - permanent errors fail the row; a rejected token marks the bot;
 * - a Telegram group migration updates the chat id and resends immediately.
 */
final class DeliveryService
{
    public function __construct(
        private readonly OutboxRepository $outbox,
        private readonly ChannelRegistry $channels,
        private readonly RateLimiter $limiter,
        private readonly string $owner,
        private readonly int $leaseSec = 120,
        private readonly int $batch = 20,
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
            try {
                $outcome = $this->deliver($id, $now);
            } catch (Throwable $exception) {
                // never let one row kill the batch; the code, not the message, goes to the log
                $this->outbox->markFailed($id, 0, 'internal_error', $now);
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
            $this->outbox->markFailed($id, 0, 'delivery_missing', $now);

            return 'failed';
        }
        $botId = (int)$row['bot_id'];
        $attempts = (int)$row['attempts'];

        if ((string)$row['chat_enabled'] !== '1' || (string)$row['chat_state'] !== 'active') {
            $this->outbox->markDropped($id, 'chat_unavailable', $now);

            return 'dropped';
        }
        if ((string)$row['bot_enabled'] !== '1') {
            $this->outbox->markDropped($id, 'bot_disabled', $now);

            return 'dropped';
        }

        $channelId = (string)$row['channel'];
        $channel = $this->channels->find($channelId);
        if ($channel === null) {
            $this->outbox->markFailed($id, $attempts, 'channel_unknown', $now);

            return 'failed';
        }

        $wait = $this->limiter->reserve(
            $botId,
            (string)$row['external_chat_id'],
            (string)$row['chat_kind'],
            $now,
            $channel->limits(),
            $channelId
        );
        if ($wait > 0) {
            $this->outbox->markRetry($id, $attempts, $now + $wait, '', false, $now);

            return 'retried';
        }

        $message = $this->rendered($row);
        if ($message === null) {
            $this->outbox->markFailed($id, $attempts, 'render_invalid', $now);

            return 'failed';
        }

        $result = $channel->send(
            new BotCredentials($channelId, (string)$row['token']),
            new Recipient((string)$row['external_chat_id'], (string)$row['chat_kind'], (string)$row['chat_title']),
            $message
        );

        return $this->apply($id, $row, $result, $now);
    }

    /** @param array<string, mixed> $row */
    private function apply(int $id, array $row, SendResult $result, int $now): string
    {
        $chatId = (int)$row['chat_id'];
        $botId = (int)$row['bot_id'];
        $attempts = (int)$row['attempts'];

        if ($result->outcome === SendResult::SENT) {
            $this->outbox->markSent($id, $result->ids, $now);
            $this->outbox->markBotOk($botId, $now);

            return 'sent';
        }

        if ($result->outcome === SendResult::RECIPIENT_GONE) {
            HubLogger::event('delivery', 'recipient_gone', ['chat_id' => $chatId, 'code' => $result->code]);
            $this->outbox->markChatGone($chatId, $result->code, $now);

            return 'dropped';
        }

        if ($result->outcome === SendResult::PERMANENT) {
            $this->outbox->markFailed($id, $attempts + 1, $result->code, $now);
            if (str_contains($result->code, '.401.')) {
                $this->outbox->markBotError($botId, 'token_invalid', $result->code, $now);
            } elseif (str_contains($result->code, '.tls.')) {
                // a TLS trust problem is a bot configuration error, not a message problem (Plan/08)
                $this->outbox->markBotError($botId, 'ca_error', $result->code, $now);
            }
            HubLogger::event('delivery', 'delivery_failed', ['id' => $id, 'code' => $result->code], LOG_WARNING);

            return 'failed';
        }

        // RETRY
        if ($result->migratedChatId !== null) {
            if (!$this->outbox->updateChatId($chatId, $result->migratedChatId)) {
                // the supergroup already has its own chat row: this stale duplicate is gone
                return 'dropped';
            }
            $this->outbox->markRetry($id, $attempts + 1, $now, $result->code, false, $now);

            return 'retried';
        }

        if ($result->uncertain) {
            if ((int)$row['uncertain_attempts'] >= 1) {
                // a second unknown outcome: stop, "не более одного повтора при неизвестном исходе"
                $this->outbox->markFailed($id, $attempts + 1, $result->code, $now);

                return 'failed';
            }
            $delay = RetryPolicy::delayAfter($attempts + 1) ?? 60;
            $this->outbox->markRetry(
                $id,
                $attempts + 1,
                $now + max($delay, $result->retryAfterSec),
                $result->code,
                true,
                $now
            );

            return 'retried';
        }

        $nextAttempt = $attempts + 1;
        $delay = RetryPolicy::delayAfter($nextAttempt);
        if ($delay === null) {
            $this->outbox->markFailed($id, $nextAttempt, $result->code, $now);
            HubLogger::event('delivery', 'delivery_failed', ['id' => $id, 'code' => $result->code], LOG_WARNING);

            return 'failed';
        }
        $this->outbox->markRetry(
            $id,
            $nextAttempt,
            $now + max($delay, $result->retryAfterSec),
            $result->code,
            false,
            $now
        );

        return 'retried';
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
