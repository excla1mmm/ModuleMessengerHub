<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels\Telegram;

use Modules\ModuleMessengerHub\Lib\Channels\BotCredentials;
use Modules\ModuleMessengerHub\Lib\Channels\BotIdentity;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryBatch;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryCursor;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveredChat;
use Modules\ModuleMessengerHub\Lib\Channels\HttpClient;
use Modules\ModuleMessengerHub\Lib\Channels\HttpResponse;
use Modules\ModuleMessengerHub\Lib\Channels\SendResult;

/**
 * Telegram Bot API calls (Plan/03-channels.md; facts checked 18.11.2026).
 *
 * The token lives in the URL, so nothing here logs or throws URLs, headers or bodies. Every failure
 * becomes a normalised code: telegram.429.rate_limit, telegram.403.blocked, telegram.403.kicked,
 * telegram.400.chat_not_found, telegram.400.migrate, telegram.401.unauthorized, http.timeout ...
 *
 * The base URL is injectable for tests (a local fixture server), production uses api.telegram.org.
 */
final class TelegramApi
{
    public const string BASE_URL = 'https://api.telegram.org';
    private const string PREFIX = 'telegram';

    public function __construct(
        private readonly HttpClient $http,
        private readonly string $baseUrl = self::BASE_URL,
    ) {
    }

    public function getMe(BotCredentials $bot): BotIdentity
    {
        $response = $this->call($bot, 'getMe');
        if ($response->failed()) {
            return BotIdentity::failed($response->errorCode);
        }
        $json = $response->json();
        if ($response->status === 200 && ($json['ok'] ?? false) === true) {
            $user = is_array($json['result'] ?? null) ? $json['result'] : [];
            $username = is_string($user['username'] ?? null) ? $user['username'] : '';
            $name = trim(
                (is_string($user['first_name'] ?? null) ? $user['first_name'] : '')
                . ' '
                . (is_string($user['last_name'] ?? null) ? $user['last_name'] : '')
            );

            return BotIdentity::ok($username, (string)($user['id'] ?? ''), $name);
        }

        return BotIdentity::failed(self::errorCode($response));
    }

    /**
     * One getUpdates poll. Only discovery sessions use it: a webhook blocks the method, which is
     * reported as telegram.409.webhook_set, and long polling is meant for the five-minute window.
     */
    public function getUpdates(BotCredentials $bot, DiscoveryCursor $cursor): DiscoveryBatch
    {
        $payload = [
            'offset' => $cursor->offset,
            'limit' => 100,
            'timeout' => max(0, min(50, $cursor->longPollSec)),
            'allowed_updates' => ['message', 'my_chat_member'],
        ];
        $response = $this->call($bot, 'getUpdates', $payload);
        if ($response->failed()) {
            return new DiscoveryBatch([], $cursor->offset, $response->errorCode);
        }
        $json = $response->json();
        if ($response->status !== 200 || ($json['ok'] ?? false) !== true) {
            $code = self::errorCode($response);
            $description = strtolower((string)($json['description'] ?? ''));
            if (str_contains($description, 'webhook')) {
                $code = self::PREFIX . '.409.webhook_set';
            }

            return new DiscoveryBatch([], $cursor->offset, $code);
        }

        $chats = [];
        $nextOffset = $cursor->offset;
        foreach (is_array($json['result'] ?? null) ? $json['result'] : [] as $update) {
            if (!is_array($update)) {
                continue;
            }
            $nextOffset = max($nextOffset, (int)($update['update_id'] ?? 0) + 1);
            $chat = self::updateChat($update);
            if ($chat === null || isset($chats[$chat->chatId])) {
                continue;
            }
            $chats[$chat->chatId] = $chat;
        }

        return new DiscoveryBatch(array_values($chats), $nextOffset);
    }

    /** @param list<array{text: string, url: string}> $buttons */
    public function sendMessage(BotCredentials $bot, string $chatId, string $html, array $buttons = []): SendResult
    {
        $payload = [
            'chat_id' => $chatId,
            'text' => $html,
            'parse_mode' => 'HTML',
            'disable_web_page_preview' => true,
        ];
        if ($buttons !== []) {
            $keyboard = [];
            foreach ($buttons as $button) {
                $keyboard[] = [['text' => $button['text'], 'url' => $button['url']]];
            }
            $payload['reply_markup'] = ['inline_keyboard' => $keyboard];
        }

        return $this->send($bot, 'sendMessage', $payload);
    }

    public function deleteMessage(BotCredentials $bot, string $chatId, string $messageId): SendResult
    {
        $response = $this->call($bot, 'deleteMessage', ['chat_id' => $chatId, 'message_id' => $messageId]);
        if ($response->failed()) {
            return SendResult::retry(10, $response->errorCode, true);
        }
        $json = $response->json();
        if ($response->status === 200 && ($json['ok'] ?? false) === true) {
            return SendResult::sent();
        }
        $description = strtolower((string)($json['description'] ?? ''));
        if (str_contains($description, 'message to delete not found')) {
            return SendResult::sent(); // already gone: the goal is reached
        }

        return self::classify($response, $json);
    }

    /** Stage 3a hook: voice message as MP3/M4A. `$caption` must already be escaped HTML (see TelegramChannel). */
    public function sendAudio(BotCredentials $bot, string $chatId, string $filePath, string $caption = ''): SendResult
    {
        $fields = ['chat_id' => $chatId];
        if ($caption !== '') {
            $fields['caption'] = $caption;
            $fields['parse_mode'] = 'HTML';
        }
        $response = $this->http->postMultipart(
            $this->url($bot, 'sendAudio'),
            $fields,
            'audio',
            $filePath,
            basename($filePath),
            'audio/mpeg'
        );

        return self::result($response);
    }

    /** Stage 3a hook: any document (e.g. a recording kept in its original format). */
    public function sendDocument(BotCredentials $bot, string $chatId, string $filePath, string $caption = ''): SendResult
    {
        $fields = ['chat_id' => $chatId];
        if ($caption !== '') {
            $fields['caption'] = $caption;
            $fields['parse_mode'] = 'HTML';
        }
        $response = $this->http->postMultipart(
            $this->url($bot, 'sendDocument'),
            $fields,
            'document',
            $filePath,
            basename($filePath)
        );

        return self::result($response);
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function send(BotCredentials $bot, string $method, array $payload): SendResult
    {
        return self::result($this->call($bot, $method, $payload));
    }

    private static function result(HttpResponse $response): SendResult
    {
        if ($response->failed()) {
            // the messenger may have accepted the request before the answer was lost
            return SendResult::retry(10, $response->errorCode, true);
        }
        $json = $response->json();
        if ($response->status === 200 && ($json['ok'] ?? false) === true) {
            $messageId = $json['result']['message_id'] ?? null;

            return SendResult::sent($messageId === null ? [] : [(string)$messageId]);
        }

        return self::classify($response, $json);
    }

    /**
     * Maps a Telegram error to one of the four queue outcomes (Plan/03-channels.md).
     *
     * @param array<string, mixed> $json
     */
    private static function classify(HttpResponse $response, array $json): SendResult
    {
        $code = (int)($json['error_code'] ?? $response->status);
        $description = strtolower((string)($json['description'] ?? ''));
        $parameters = is_array($json['parameters'] ?? null) ? $json['parameters'] : [];

        if ($code === 429) {
            return SendResult::retry((int)($parameters['retry_after'] ?? 30), self::PREFIX . '.429.rate_limit');
        }
        if ($code === 401) {
            return SendResult::permanent(self::PREFIX . '.401.unauthorized');
        }
        if ($code === 403) {
            if (str_contains($description, 'blocked')) {
                return SendResult::recipientGone(self::PREFIX . '.403.blocked');
            }
            if (str_contains($description, 'kicked') || str_contains($description, 'not a member')) {
                return SendResult::recipientGone(self::PREFIX . '.403.kicked');
            }

            return SendResult::permanent(self::PREFIX . '.403.forbidden');
        }
        if ($code === 400) {
            if (isset($parameters['migrate_to_chat_id'])) {
                // the group became a supergroup: update the chat id and retry at once
                return SendResult::retry(0, self::PREFIX . '.400.migrate', false, (string)$parameters['migrate_to_chat_id']);
            }
            if (str_contains($description, 'chat not found')) {
                return SendResult::recipientGone(self::PREFIX . '.400.chat_not_found');
            }
            if (str_contains($description, 'message to delete not found')) {
                return SendResult::sent();
            }

            return SendResult::permanent(self::PREFIX . '.400.bad_request');
        }
        if ($code >= 500) {
            return SendResult::retry(30, self::PREFIX . '.' . $code . '.server_error');
        }

        return SendResult::permanent(self::PREFIX . '.' . ($code > 0 ? $code : 'unknown') . '.error');
    }

    private static function errorCode(HttpResponse $response): string
    {
        if ($response->failed()) {
            return $response->errorCode;
        }
        $json = $response->json();
        $code = (int)($json['error_code'] ?? $response->status);

        return match ($code) {
            401 => self::PREFIX . '.401.unauthorized',
            403 => self::PREFIX . '.403.forbidden',
            429 => self::PREFIX . '.429.rate_limit',
            default => self::PREFIX . '.' . ($code > 0 ? $code : 'unknown') . '.error',
        };
    }

    /** @param array<string, mixed> $payload */
    private function call(BotCredentials $bot, string $method, array $payload = []): HttpResponse
    {
        $url = $this->url($bot, $method);

        return $payload === [] ? $this->http->get($url) : $this->http->postJson($url, $payload);
    }

    private function url(BotCredentials $bot, string $method): string
    {
        return rtrim($this->baseUrl, '/') . '/bot' . $bot->token . '/' . $method;
    }

    /** @param array<string, mixed> $update */
    private static function updateChat(array $update): ?DiscoveredChat
    {
        // my_chat_member says the bot's own membership changed: kicked/left means the chat is not a
        // destination any more, so it must never be offered as a discovered chat
        $memberStatus = (string)($update['my_chat_member']['new_chat_member']['status'] ?? '');
        if (in_array($memberStatus, ['kicked', 'left'], true)) {
            return null;
        }
        $chat = $update['message']['chat'] ?? $update['my_chat_member']['chat'] ?? null;
        if (!is_array($chat) || !isset($chat['id'])) {
            return null;
        }
        $type = (string)($chat['type'] ?? '');
        $kind = match ($type) {
            'private' => 'private',
            'channel' => 'channel',
            'group', 'supergroup' => 'group',
            default => '',
        };
        if ($kind === '') {
            return null;
        }
        $title = (string)($chat['title'] ?? '');
        if ($title === '') {
            $title = trim((string)($chat['first_name'] ?? '') . ' ' . (string)($chat['last_name'] ?? ''));
        }
        if ($title === '' && is_string($chat['username'] ?? null)) {
            $title = '@' . $chat['username'];
        }

        return new DiscoveredChat((string)$chat['id'], $kind, $title);
    }
}
