<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels\Max;

use Modules\ModuleMessengerHub\Lib\Channels\AttachmentResult;
use Modules\ModuleMessengerHub\Lib\Channels\BotCredentials;
use Modules\ModuleMessengerHub\Lib\Channels\BotIdentity;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveredChat;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryBatch;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryCursor;
use Modules\ModuleMessengerHub\Lib\Channels\HttpClient;
use Modules\ModuleMessengerHub\Lib\Channels\HttpResponse;
use Modules\ModuleMessengerHub\Lib\Channels\Recipient;
use Modules\ModuleMessengerHub\Lib\Channels\SendResult;

/**
 * MAX Bot API calls (Plan/03-channels.md; facts checked 21.11.2026).
 *
 * The token travels only in the `Authorization` header (no `Bearer`), so nothing here logs or throws
 * URLs, headers or bodies. Every failure becomes a normalised code: max.403.chat_denied,
 * max.404.not_found, max.401.unauthorized, max.429.rate_limit, max.tls.untrusted_ca, http.timeout…
 * API `message` texts are never used in codes: they can carry personal data.
 *
 * MAX answers errors two ways: HTTP 4xx with `{code, message}` (POST /messages, GET /me, …) and
 * HTTP 200 with `{success: false, code, message}` (DELETE /messages, subscriptions, …). Both are
 * handled through the same classifier.
 *
 * The base URL is injectable for tests (a local fixture server), production is platform-api2.max.ru.
 */
final class MaxApi
{
    public const string BASE_URL = 'https://platform-api2.max.ru';
    private const string PREFIX = 'max';
    private const int PAGE = 100;
    private const int MAX_LONG_POLL_SEC = 90;
    /** At most this many GET /chats/{chatId} per poll: a title is nice, a live session is essential. */
    private const int TITLE_LOOKUPS_PER_POLL = 10;

    /**
     * Discovery only needs to learn chats: an addition creates one, a removal must never create one.
     * message_created is not requested — the bot is not an admin in most groups, so it is not granted.
     */
    private const array DISCOVERY_TYPES = ['bot_added', 'bot_started', 'bot_removed', 'user_removed'];

    public function __construct(
        private readonly HttpClient $http,
        private readonly string $baseUrl = self::BASE_URL,
    ) {
    }

    public function me(BotCredentials $bot): BotIdentity
    {
        $response = $this->call($bot, 'GET', '/me');
        if ($response->failed()) {
            return BotIdentity::failed(self::transportCode($response));
        }
        if ($response->status === 200 && $response->isJson()) {
            $json = $response->json();
            if (isset($json['user_id'])) {
                $userId = (string)$json['user_id'];
                $username = is_string($json['username'] ?? null) ? $json['username'] : '';
                $name = trim(is_string($json['name'] ?? null) ? $json['name'] : '');
                if ($name === '') {
                    $name = trim((string)($json['first_name'] ?? ''));
                }

                return BotIdentity::ok($username, $userId, $name);
            }
        }

        return BotIdentity::failed(self::errorCode($response));
    }

    /**
     * One GET /updates poll — discovery sessions only. MAX limits long polling to development use and
     * a bot cannot run it together with a webhook subscription. MAX does not report that conflict: it
     * answers 200 with an empty page (checked live 21.11.2026), so the first empty page of a session is
     * verified against GET /subscriptions and becomes max.405.webhook_set for the UI.
     */
    public function updates(BotCredentials $bot, DiscoveryCursor $cursor): DiscoveryBatch
    {
        $query = [
            'limit' => self::PAGE,
            'timeout' => max(0, min(self::MAX_LONG_POLL_SEC, $cursor->longPollSec)),
            'types' => implode(',', self::DISCOVERY_TYPES),
        ];
        if ($cursor->offset > 0) {
            // the marker points at the next unread update; without it MAX replays what is unconfirmed
            $query['marker'] = $cursor->offset;
        }
        $response = $this->call($bot, 'GET', '/updates', $query);
        if ($response->failed()) {
            return new DiscoveryBatch([], $cursor->offset, self::transportCode($response));
        }
        if ($response->status !== 200 || !$response->isJson()) {
            return new DiscoveryBatch([], $cursor->offset, self::discoveryErrorCode($response));
        }

        $json = $response->json();
        $chats = [];
        $titleLookups = 0;
        $nextOffset = $cursor->offset;
        $marker = $json['marker'] ?? null;
        if (is_int($marker) || (is_string($marker) && ctype_digit($marker))) {
            $nextOffset = max($nextOffset, (int)$marker);
        }
        $updates = is_array($json['updates'] ?? null) ? $json['updates'] : [];
        foreach ($updates as $update) {
            if (!is_array($update)) {
                continue;
            }
            $chat = self::updateChat($update);
            if ($chat === null || isset($chats[$chat->chatId])) {
                continue;
            }
            if ($chat->kind !== 'private' && $chat->title === '' && $titleLookups < self::TITLE_LOOKUPS_PER_POLL) {
                // bot_added has no title: one GET /chats/{chatId} fills it, a failure keeps it empty.
                // The budget keeps a slow API from eating the whole five-minute discovery session.
                $titleLookups++;
                $title = $this->chatTitle($bot, $chat->chatId);
                if ($title !== '') {
                    $chat = new DiscoveredChat($chat->chatId, $chat->kind, $title);
                }
            }
            $chats[$chat->chatId] = $chat;
        }

        if ($updates === [] && $cursor->offset === 0 && $this->hasSubscription($bot)) {
            return new DiscoveryBatch([], $cursor->offset, self::PREFIX . '.405.webhook_set');
        }

        return new DiscoveryBatch(array_values($chats), $nextOffset);
    }

    /**
     * True when the bot has a webhook subscription. MAX silently stops long polling while one exists,
     * so discovery asks once per session (first empty page) instead of waiting five minutes for nothing.
     */
    public function hasSubscription(BotCredentials $bot): bool
    {
        $response = $this->call($bot, 'GET', '/subscriptions');
        if ($response->failed() || $response->status !== 200 || !$response->isJson()) {
            return false;
        }
        $subscriptions = $response->json()['subscriptions'] ?? null;

        return is_array($subscriptions) && $subscriptions !== [];
    }

    /**
     * Visible title of a chat/channel (GET /chats/{chatId}). Only discovery uses it, to give a group
     * found by `bot_added` a human name; a failure returns '' and never breaks the discovery session.
     */
    public function chatTitle(BotCredentials $bot, string $chatId): string
    {
        if (preg_match('/^-?\d{1,20}$/', $chatId) !== 1) {
            // chat ids are (possibly negative) numbers: anything else would address another API path
            return '';
        }
        $response = $this->call($bot, 'GET', '/chats/' . rawurlencode($chatId));
        if ($response->failed() || $response->status !== 200 || !$response->isJson()) {
            return '';
        }
        $title = $response->json()['title'] ?? null;

        return is_string($title) ? mb_substr(trim($title), 0, 255) : '';
    }

    /**
     * Sends one message. MAX addresses a dialog by user id and a group/channel by chat id (Plan/03):
     * the hub stores the MAX user id as the chat id for private chats, so `user_id` is always the
     * right query parameter for them.
     *
     * `$html` is rendered channel markup: callers pass MaxMarkup output, never raw event data.
     *
     * @param list<array{text: string, url: string}> $buttons
     */
    public function sendMessage(BotCredentials $bot, Recipient $to, string $html, array $buttons = []): SendResult
    {
        $query = $to->kind === 'private'
            ? ['user_id' => $to->chatId]
            : ['chat_id' => $to->chatId];
        $payload = ['text' => $html, 'format' => 'html', 'notify' => true];
        if ($buttons !== []) {
            $keyboard = [];
            foreach ($buttons as $button) {
                // one button per row: link keys are limited to three per row by MAX
                $keyboard[] = [['type' => 'link', 'text' => $button['text'], 'url' => $button['url']]];
            }
            $payload['attachments'] = [['type' => 'inline_keyboard', 'payload' => ['buttons' => $keyboard]]];
        }

        return self::result($this->call($bot, 'POST', '/messages', $query, $payload));
    }

    /**
     * Deletes one bot message. A message that is already gone counts as deleted (idempotent retract).
     *
     * MAX deletes by message id only; the bot must be an admin with the delete right in a chat, in a
     * dialog it may delete only its own messages. An age limit is not documented (Q9).
     */
    public function deleteMessage(BotCredentials $bot, string $messageId): SendResult
    {
        $response = $this->call($bot, 'DELETE', '/messages', ['message_id' => $messageId]);
        if ($response->failed()) {
            return self::transportResult($response);
        }
        $json = $response->json();
        if (self::isNotFound(strtolower(trim((string)($json['code'] ?? '')))) || $response->status === 404) {
            return SendResult::sent(); // already gone: the goal is reached
        }
        if ($response->status === 200) {
            if (!$response->isJson() || ($json['success'] ?? true) !== false) {
                return SendResult::sent();
            }
        }

        return self::classify($response, $json);
    }

    /**
     * Stage 3a hook: asks MAX for an upload endpoint. Returns ['url' => …, 'token' => …] or null.
     * The token is an attachment token, not the bot token: it is not a secret and is not logged.
     *
     * @return array{url: string, token: string}|null
     */
    public function requestUpload(BotCredentials $bot, string $type): ?array
    {
        // the type belongs to the query; the same value in the body keeps the request a JSON object
        $response = $this->call($bot, 'POST', '/uploads', ['type' => $type], ['type' => $type]);
        if ($response->failed() || $response->status !== 200 || !$response->isJson()) {
            return null;
        }
        $json = $response->json();
        $url = is_string($json['url'] ?? null) ? $json['url'] : '';
        $token = is_string($json['token'] ?? null) ? $json['token'] : '';
        if (preg_match('~^https://~i', $url) !== 1 || $token === '' || !$this->isMaxHost($url)) {
            // fail closed: a hostile/hijacked /uploads answer must never receive the recording
            return null;
        }

        return ['url' => $url, 'token' => $token];
    }

    /**
     * Stage 3a hook: voice message as MP3/M4A (mirrors Telegram sendAudio). Two steps — POST /uploads,
     * then the file, then POST /messages with the attachment token. MAX may answer
     * max.attachment.not_ready while the file is still being processed: the SAME upload token is
     * returned to the caller so the queue retries after a growing pause (decision 3a-1).
     */
    public function sendAudio(
        BotCredentials $bot,
        Recipient $to,
        string $filePath,
        string $htmlCaption = '',
        string $pendingToken = '',
    ): AttachmentResult {
        return $this->sendFile($bot, $to, 'audio', $filePath, $htmlCaption, 'audio/mpeg', $pendingToken);
    }

    /**
     * Stage 3a hook: any document (a recording kept in its original format).
     * `$htmlCaption` must already be escaped channel markup (see MaxChannel).
     */
    public function sendDocument(BotCredentials $bot, Recipient $to, string $filePath, string $htmlCaption = ''): SendResult
    {
        return $this->sendFile($bot, $to, 'file', $filePath, $htmlCaption, '')->result;
    }

    private function sendFile(
        BotCredentials $bot,
        Recipient $to,
        string $type,
        string $filePath,
        string $htmlCaption,
        string $mimeType,
        string $pendingToken = '',
    ): AttachmentResult {
        $token = $pendingToken;
        if ($token === '') {
            $upload = $this->requestUpload($bot, $type);
            if ($upload === null) {
                // stage 3a picks the pause schedule; for now the shared retry policy drives it
                return AttachmentResult::of(SendResult::retry(30, self::PREFIX . '.upload.failed'));
            }
            $response = $this->http->postMultipart(
                $upload['url'],
                [],
                'data',
                $filePath,
                basename($filePath),
                $mimeType,
                // the upload host comes from the API answer: never hand the bot token to a foreign host
                $this->isMaxHost($upload['url']) ? [self::authorization($bot)] : []
            );
            if ($response->failed()) {
                return AttachmentResult::of(self::transportResult($response));
            }
            if ($response->status >= 400) {
                // a 401/429/5xx of the upload endpoint is classified like any other API answer
                return AttachmentResult::of(self::classify($response, $response->json()));
            }
            $token = $upload['token'];
        }
        $query = $to->kind === 'private' ? ['user_id' => $to->chatId] : ['chat_id' => $to->chatId];
        $payload = ['format' => 'html', 'attachments' => [['type' => $type, 'payload' => ['token' => $token]]]];
        if ($htmlCaption !== '') {
            $payload['text'] = $htmlCaption;
        }

        $result = self::result($this->call($bot, 'POST', '/messages', $query, $payload));
        if ($result->code === self::PREFIX . '.attachment.not_ready') {
            // still being processed: retry with the same token, never re-upload
            return AttachmentResult::of($result, true, $token);
        }

        return AttachmentResult::of($result);
    }

    /** @param array<string, mixed> $payload */
    private static function result(HttpResponse $response): SendResult
    {
        if ($response->failed()) {
            return self::transportResult($response);
        }
        $json = $response->json();
        if ($response->status === 200) {
            if (!$response->isJson()) {
                // MAX answers 200 only for a created message, but the body is unreadable: the outcome
                // is unknown, so the queue retries at most once (Plan/08)
                return SendResult::retry(10, self::PREFIX . '.200.malformed', true);
            }
            $mid = $json['message']['body']['mid'] ?? $json['message']['mid'] ?? null;
            if (!is_string($mid) && !is_int($mid)) {
                $mid = '';
            }
            if ((string)$mid !== '') {
                return SendResult::sent([(string)$mid]);
            }
            if (($json['success'] ?? null) !== false) {
                // a created message whose id was not reported: delivered, but not retractable
                return SendResult::sent();
            }
        }

        return self::classify($response, $json);
    }

    /**
     * Maps a MAX error to one of the four queue outcomes. Codes are `max.<http>.<reason>`; the reason
     * comes from the machine-readable `code` field only, never from `message`.
     *
     * @param array<string, mixed> $json
     */
    private static function classify(HttpResponse $response, array $json): SendResult
    {
        $status = $response->status;
        $code = strtolower(trim((string)($json['code'] ?? '')));

        if ($code === 'attachment.not.ready') {
            // the upload is still being processed; RetryPolicy grows the pause on every attempt
            return SendResult::retry(10, self::PREFIX . '.attachment.not_ready');
        }
        if ($status === 401) {
            return SendResult::permanent(self::PREFIX . '.401.unauthorized');
        }
        if ($status === 429) {
            return SendResult::retry(
                $response->retryAfterSec > 0 ? $response->retryAfterSec : 30,
                self::PREFIX . '.429.rate_limit'
            );
        }
        if ($status === 403) {
            if ($code === 'chat.denied') {
                // documented: the user suspended the bot or the bot lost access to the chat/channel
                return SendResult::recipientGone(self::PREFIX . '.403.chat_denied');
            }

            return SendResult::permanent(self::PREFIX . '.403.forbidden');
        }
        if (self::isNotFound($code)) {
            // documented: only the machine-readable "not.found" proves the chat/message is gone
            return SendResult::recipientGone(self::PREFIX . '.404.not_found');
        }
        if ($status === 404) {
            // a bare 404 (e.g. an HTML gateway page) is no proof that the recipient is gone
            return SendResult::permanent(self::PREFIX . '.404.unknown');
        }
        if ($status === 405) {
            return SendResult::permanent(self::PREFIX . '.405.not_allowed');
        }
        if ($status >= 500) {
            return SendResult::retry(30, self::PREFIX . '.' . $status . '.server_error');
        }
        if (($json['success'] ?? null) === false && $code !== '') {
            return SendResult::permanent(self::PREFIX . '.200.' . self::reason($code));
        }

        return SendResult::permanent(self::PREFIX . '.' . ($status > 0 ? $status : 'unknown') . '.' . self::reason($code));
    }

    /** Transport failures: TLS is a permanent configuration error, the rest is an unknown outcome. */
    private static function transportResult(HttpResponse $response): SendResult
    {
        if ($response->errorCode === 'http.tls') {
            // verification stays on; the admin fixes the CA (Plan/03, "Корневой сертификат")
            return SendResult::permanent(self::PREFIX . '.tls.untrusted_ca');
        }
        if ($response->errorCode === 'http.bad_request' || $response->errorCode === 'file.unavailable') {
            return SendResult::permanent(self::PREFIX . '.400.bad_request');
        }

        // the messenger may have accepted the request before the answer was lost, unless the request
        // never left the station (DNS/proxy/connect)
        return SendResult::retry(10, $response->errorCode, !$response->isRequestNotSent());
    }

    private static function transportCode(HttpResponse $response): string
    {
        return $response->errorCode === 'http.tls' ? self::PREFIX . '.tls.untrusted_ca' : $response->errorCode;
    }

    private static function discoveryErrorCode(HttpResponse $response): string
    {
        if ($response->status === 405) {
            // a webhook subscription blocks long polling; the UI explains how to remove it
            return self::PREFIX . '.405.webhook_set';
        }
        $code = strtolower(trim((string)($response->json()['code'] ?? '')));
        if (in_array($code, ['webhook.enabled', 'webhook.set', 'subscription.exists'], true)) {
            return self::PREFIX . '.405.webhook_set';
        }

        return self::errorCode($response);
    }

    private static function errorCode(HttpResponse $response): string
    {
        $json = $response->json();
        $status = $response->status;
        $code = strtolower(trim((string)($json['code'] ?? '')));

        return match (true) {
            $status === 401 => self::PREFIX . '.401.unauthorized',
            $status === 403 => self::PREFIX . '.403.forbidden',
            $status === 404 => self::PREFIX . '.404.not_found',
            $status === 429 => self::PREFIX . '.429.rate_limit',
            $status >= 500 => self::PREFIX . '.' . $status . '.server_error',
            default => self::PREFIX . '.' . ($status > 0 ? $status : 'unknown') . '.'
                . ($code !== '' ? self::reason($code) : 'error'),
        };
    }

    private static function isNotFound(string $code): bool
    {
        // MAX answers 404 `error.not.found` when the bot is no longer a member of the chat
        // (checked live 21.11.2026); the other two are the documented variants.
        return in_array($code, ['not.found', 'message.not.found', 'chat.not.found', 'error.not.found'], true);
    }

    /** A safe machine fragment: only the API code, shortened; no free text ever reaches a code. */
    private static function reason(string $code): string
    {
        $reason = (string)preg_replace('/[^a-z0-9._]/', '', strtolower($code));
        if ($reason === '') {
            return 'error';
        }

        return substr(str_replace('.', '_', $reason), 0, 40);
    }

    private static function authorization(BotCredentials $bot): string
    {
        // a header value must never carry control characters, whatever token a caller supplies
        return 'Authorization: ' . (string)preg_replace('/[\x00-\x1F\x7F]/', '', $bot->token);
    }

    /** True when the URL belongs to the API host or a MAX subdomain (upload endpoints live there). */
    private function isMaxHost(string $url): bool
    {
        $host = strtolower((string)parse_url($url, PHP_URL_HOST));
        $apiHost = strtolower((string)parse_url($this->baseUrl, PHP_URL_HOST));
        if ($host === '' || $apiHost === '') {
            return false;
        }

        return $host === $apiHost || str_ends_with($host, '.max.ru');
    }

    /**
     * @param array<string, scalar> $query
     * @param array<string, mixed>|null $payload
     */
    private function call(
        BotCredentials $bot,
        string $method,
        string $path,
        array $query = [],
        ?array $payload = null,
    ): HttpResponse {
        $url = $this->url($path, $query);
        $headers = [self::authorization($bot)];

        return match ($method) {
            'GET' => $this->http->get($url, $headers),
            'DELETE' => $this->http->delete($url, $headers),
            default => $this->http->postJson($url, $payload ?? [], $headers),
        };
    }

    /** @param array<string, scalar> $query */
    private function url(string $path, array $query): string
    {
        $url = rtrim($this->baseUrl, '/') . $path;
        if ($query === []) {
            return $url;
        }
        // MAX expects the dialog/chat id and a comma separated `types` list, not percent-encoded commas
        $encoded = http_build_query($query, '', '&', PHP_QUERY_RFC3986);

        return $url . '?' . str_replace('%2C', ',', $encoded);
    }

    /** @param array<string, mixed> $update */
    private static function updateChat(array $update): ?DiscoveredChat
    {
        $type = (string)($update['update_type'] ?? '');
        if ($type === 'bot_removed' || $type === 'user_removed' || $type === 'bot_stopped') {
            // a removal never creates a chat (Plan/03): the chat row is marked gone by delivery
            return null;
        }
        if ($type === 'bot_started') {
            // bot_started carries the dialog id and the user; a dialog is addressed by the user id
            $user = is_array($update['user'] ?? null) ? $update['user'] : [];
            $userId = $user['user_id'] ?? null;
            if (!is_int($userId) && !(is_string($userId) && ctype_digit($userId))) {
                // a dialog is addressed by the user id: without it there is no usable recipient
                return null;
            }
            $name = trim(
                (is_string($user['first_name'] ?? null) ? $user['first_name'] : '')
                . ' '
                . (is_string($user['last_name'] ?? null) ? $user['last_name'] : '')
            );

            return new DiscoveredChat((string)$userId, 'private', $name);
        }
        if ($type !== 'bot_added') {
            return null;
        }
        $chatId = $update['chat_id'] ?? null;
        if (!is_int($chatId) && !(is_string($chatId) && ctype_digit($chatId))) {
            return null;
        }
        // bot_added has no chat title: MAX shows the id until the admin renames the chat in the UI
        $kind = ($update['is_channel'] ?? false) === true ? 'channel' : 'group';

        return new DiscoveredChat((string)$chatId, $kind, '');
    }
}
