<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Bots;

use Modules\ModuleMessengerHub\Lib\Channels\BotCredentials;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelRegistry;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryCursor;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;

/**
 * «Подключить чат»: five minutes of getUpdates per bot, in the worker, never in a REST request
 * (Plan/03-channels.md, Plan/06).
 *
 * Discovered chats are stored disabled: the admin opts in on the found-chats list before anything is
 * sent. The session states match the design: running / found / expired / empty / error.
 */
final class DiscoveryService
{
    public const int SESSION_TTL_SEC = 300;
    /** One poll waits at most this long for Telegram; short so a stop/expiry is noticed at once. */
    private const int LONG_POLL_SEC = 2;

    public function __construct(
        private readonly BotRepository $bots,
        private readonly ChannelRegistry $channels,
    ) {
    }

    /** Starts a fresh five-minute session; a still-running one is closed first. */
    public function start(int $botId, int $now): int
    {
        $active = $this->bots->activeSession($botId);
        if ($active !== null) {
            $this->bots->stopSession((int)$active['id'], $this->closingStatus($active), $now);
        }

        return $this->bots->createSession($botId, $now, self::SESSION_TTL_SEC);
    }

    public function stop(int $botId, int $now): void
    {
        $active = $this->bots->activeSession($botId);
        if ($active !== null) {
            $this->bots->stopSession((int)$active['id'], $this->closingStatus($active), $now);
        }
    }

    /**
     * One worker pass: finalize expired sessions, poll every active one.
     *
     * @return array{polled: int, found: int, errors: int}
     */
    public function runOnce(int $now): array
    {
        $this->bots->finalizeExpired($now);
        $stats = ['polled' => 0, 'found' => 0, 'errors' => 0];
        foreach ($this->bots->sessionsToPoll($now) as $session) {
            $bot = $this->bots->find((int)$session['bot_id']);
            if ($bot === null || (string)$bot['enabled'] !== '1') {
                $this->bots->stopSession((int)$session['id'], 'error', $now);

                continue;
            }
            $channel = $this->channels->find((string)$bot['channel']);
            if ($channel === null) {
                $this->bots->saveSession(
                    (int)$session['id'],
                    (int)$session['updates_offset'],
                    [],
                    'error',
                    'channel_unavailable',
                    $now
                );
                $stats['errors']++;

                continue;
            }

            $stats['polled']++;
            $batch = $channel->discoverChats(
                new BotCredentials((string)$bot['channel'], (string)$bot['token']),
                new DiscoveryCursor((int)$session['updates_offset'], self::LONG_POLL_SEC)
            );
            if ($batch->errorCode !== '') {
                // a transient blink (timeout, 5xx, 429) must not kill the five-minute session: only a
                // terminal answer (bad token, webhook, missing channel) closes it
                $terminal = self::isTerminal($batch->errorCode);
                $this->bots->saveSession(
                    (int)$session['id'],
                    (int)$session['updates_offset'],
                    $this->decodedFound($session),
                    $terminal ? 'error' : (string)$session['status'],
                    $batch->errorCode,
                    $now
                );
                HubLogger::event('discovery', 'poll_failed', [
                    'bot_id' => (int)$bot['id'],
                    'code' => $batch->errorCode,
                ], LOG_WARNING);
                $stats['errors']++;

                continue;
            }

            $found = $this->decodedFound($session);
            $known = [];
            foreach ($found as $item) {
                $known[(string)($item['chat_id'] ?? '')] = true;
            }
            foreach ($batch->chats as $chat) {
                if (isset($known[$chat->chatId])) {
                    continue;
                }
                $known[$chat->chatId] = true;
                // remember whether the chat was already connected before this discovery, so the UI
                // can show «Есть» instead of «Новый» (the row exists by presentation time either way)
                $existing = $this->bots->findChatByExternal((int)$bot['id'], $chat->chatId);
                $already = $existing !== null;
                if ($existing !== null && (string)$existing['state'] !== 'active') {
                    // the bot is demonstrably here again (bot_added/bot_started): let delivery retry
                    $this->bots->updateChat((int)$existing['id'], ['state' => 'active', 'gone_reason' => '']);
                }
                $found[] = $chat->toArray() + ['already_connected' => $already];
                $this->bots->upsertChat((int)$bot['id'], [
                    'chat_id' => $chat->chatId,
                    'chat_kind' => $chat->kind,
                    'title' => $chat->title,
                    'enabled' => '0',
                    'discovered_at' => $now,
                ], $now);
                $stats['found']++;
            }

            $status = $found === [] ? 'running' : 'found';
            $this->bots->saveSession(
                (int)$session['id'],
                $batch->nextOffset,
                $found,
                $status,
                '',
                $now
            );
        }

        return $stats;
    }

    /**
     * Codes no retry can fix: a rejected token, a webhook subscription, a missing chat or a TLS trust
     * problem. Everything else is a blink and the session keeps polling. The list is explicit on
     * purpose: the admin UI reacts to the `error` state (the webhook hint, a bad token), and a
     * substring rule once left telegram.409.webhook_set in `running` with the hint never shown.
     */
    private const array TERMINAL_CODES = [
        'channel_unavailable',
        'http.tls',
        'telegram.401.unauthorized',
        'telegram.403.forbidden',
        'telegram.409.webhook_set',
        'max.401.unauthorized',
        'max.403.forbidden',
        'max.404.not_found',
        'max.404.unknown',
        'max.405.not_allowed',
        'max.405.webhook_set',
        'max.tls.untrusted_ca',
    ];

    private static function isTerminal(string $code): bool
    {
        return in_array($code, self::TERMINAL_CODES, true);
    }

    /** @param array<string, mixed> $session */
    private function closingStatus(array $session): string
    {
        return $this->decodedFound($session) === [] ? 'empty' : 'expired';
    }

    /**
     * @param array<string, mixed> $session
     * @return list<array<string, mixed>>
     */
    private function decodedFound(array $session): array
    {
        $decoded = json_decode((string)($session['found_json'] ?? ''), true);

        return is_array($decoded) ? array_values(array_filter($decoded, 'is_array')) : [];
    }
}
