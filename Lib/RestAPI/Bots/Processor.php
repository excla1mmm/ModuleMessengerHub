<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Bots;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModuleMessengerHub\Lib\Bots\BotRepository;
use Modules\ModuleMessengerHub\Lib\Bots\DiscoveryService;
use Modules\ModuleMessengerHub\Lib\Channels\BotCredentials;
use Modules\ModuleMessengerHub\Lib\Channels\BotIdentity;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelFactory;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelRegistry;
use Modules\ModuleMessengerHub\Lib\Delivery\BeanstalkDeliveryWaker;
use Modules\ModuleMessengerHub\Lib\Delivery\DeliveryWaker;
use Modules\ModuleMessengerHub\Lib\Delivery\NullDeliveryWaker;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\NotFoundException;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\Responder;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\UnknownActionException;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\ValidationException;
use Modules\ModuleMessengerHub\Lib\Routing\LinkBuilder;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\Templates\TestTemplate;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;
use Modules\ModuleMessengerHub\Lib\Storage\PhalconHubDatabase;
use Modules\ModuleMessengerHub\Lib\Support\ArrayTexts;
use Modules\ModuleMessengerHub\Lib\Support\CoreTexts;
use Modules\ModuleMessengerHub\Lib\Support\Texts;
use Throwable;

/**
 * Bots resource (Plan/06): CRUD over bots with nested chats, plus checkToken, discoverChats and sendTest.
 *
 * Secrets: `token` is write-only. Every response is built by serialize(), which never copies it;
 * only `token_hint` (last 4 characters) leaves the module. Errors are codes, never the token.
 *
 * Core calls the static callBack(); unit checks instantiate the processor with a test database, a fake
 * channel registry and a null waker, so the logic stays Core-free.
 */
final class Processor
{
    public function __construct(
        private readonly ?HubDatabase $db = null,
        private readonly ?ChannelRegistry $channels = null,
        private readonly ?DeliveryWaker $waker = null,
        private readonly ?Texts $texts = null,
    ) {
    }

    /** Entry point used by Core (WorkerApiCommands). */
    public static function callBack(array $request): PBXApiResult
    {
        return (new self())->process($request);
    }

    /** @param array<string, mixed> $request */
    public function process(array $request): PBXApiResult
    {
        $action = (string)($request['action'] ?? '');
        $data = Responder::data($request);

        return Responder::handle(__METHOD__, $action, function () use ($action, $data): array {
            switch ($action) {
                case 'getList':
                    return [$this->list($data)];
                case 'getRecord':
                    return [$this->record($data)];
                case 'getDefault':
                    return [$this->defaults()];
                case 'create':
                    return [$this->create($data), 201];
                case 'update':
                    return [$this->save($data, true)];
                case 'patch':
                    return [$this->save($data, false)];
                case 'delete':
                    return [$this->remove($data)];
                case 'checkToken':
                    return [$this->checkToken($data)];
                case 'discoverChats':
                    return [$this->discoverChats($data)];
                case 'sendTest':
                    return [$this->sendTest($data)];
                default:
                    throw new UnknownActionException($action);
            }
        });
    }

    /** @param array<string, mixed> $data */
    private function list(array $data): array
    {
        [$limit, $offset] = Responder::page($data);
        $now = time();
        $items = array_map(
            fn (array $bot): array => $this->serialize($bot, $now),
            $this->repo()->all($limit, $offset)
        );
        $total = $this->repo()->count();

        return [
            'items' => $items,
            'pagination' => [
                'limit' => $limit,
                'offset' => $offset,
                'total' => $total,
                'has_more' => $offset + count($items) < $total,
            ],
        ];
    }

    /** @param array<string, mixed> $data */
    private function record(array $data): array
    {
        return $this->serialize($this->requireBot($this->botId($data)), time());
    }

    /** @return array<string, mixed> */
    private function defaults(): array
    {
        return [
            'channel' => 'telegram',
            'title' => '',
            'token_hint' => '',
            'enabled' => true,
            'status' => 'new',
            'status_checked_at' => 0,
            'last_error_code' => '',
            'bot_username' => '',
            'chats' => [],
            'discovery' => $this->discovery(null, [], time()),
        ];
    }

    /** @param array<string, mixed> $data */
    private function create(array $data): array
    {
        $channel = $this->channelValue($data);
        $title = $this->titleValue($data, true);
        $token = $this->tokenValue($data, true, $channel);
        $now = time();
        $id = $this->repo()->create([
            'channel' => $channel,
            'title' => $title,
            'token' => $token,
            'token_hint' => self::tokenHint($token),
            'enabled' => $this->boolValue($data['enabled'] ?? true, 'enabled') ? '1' : '0',
            'status' => 'new',
            'status_checked_at' => 0,
            'last_error_code' => '',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $this->applyTokenCheck($id, $channel, $token, $now);
        if (array_key_exists('chats', $data)) {
            try {
                $this->applyChats($id, $data['chats'], $now);
            } catch (Throwable $exception) {
                // do not leave a half-created bot behind when a nested chat is invalid
                $this->repo()->delete($id, $now);
                throw $exception;
            }
        }

        return $this->serialize($this->requireBot($id), $now);
    }

    /** @param array<string, mixed> $data */
    private function save(array $data, bool $full): array
    {
        $bot = $this->requireBot($this->botId($data));
        $id = (int)$bot['id'];
        $now = time();
        $fields = ['updated_at' => $now];

        $channel = $this->channelValue($data, false);
        if ($channel !== null && $channel !== (string)$bot['channel']) {
            throw new ValidationException('channel_immutable', 'channel');
        }
        $title = $this->titleValue($data, $full);
        if ($title !== null) {
            $fields['title'] = $title;
        }
        if (array_key_exists('enabled', $data)) {
            $fields['enabled'] = $this->boolValue($data['enabled'], 'enabled') ? '1' : '0';
        } elseif ($full) {
            throw new ValidationException('enabled_required', 'enabled');
        }

        $newToken = null;
        if (array_key_exists('token', $data)) {
            $newToken = $this->tokenValue($data, true, (string)$bot['channel']);
            $fields['token'] = $newToken;
            $fields['token_hint'] = self::tokenHint($newToken);
        }

        $this->repo()->update($id, $fields);
        if ($newToken !== null) {
            // a replacement token is a different bot more often than a typo: check identity at once
            $this->applyTokenCheck($id, (string)$bot['channel'], $newToken, $now);
        }
        if (array_key_exists('chats', $data)) {
            $this->applyChats($id, $data['chats'], $now);
        }

        return $this->serialize($this->requireBot($id), $now);
    }

    /** @param array<string, mixed> $data */
    private function remove(array $data): array
    {
        $bot = $this->requireBot($this->botId($data));
        $this->repo()->delete((int)$bot['id'], time());

        return ['id' => (int)$bot['id'], 'deleted' => true];
    }

    /**
     * Checks the stored token (no body) or a candidate token (body `token`, resource-level only).
     * A candidate is never persisted: the admin saves it with PATCH after the check.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function checkToken(array $data): array
    {
        $id = (int)($data['id'] ?? 0);
        $bot = $id > 0 ? $this->requireBot($id) : null;
        // a saved bot's channel is immutable and comes from the record only: a `channel` in the body
        // would send the stored token of one messenger to another one
        if ($bot !== null) {
            if (array_key_exists('channel', $data)
                && trim((string)$data['channel']) !== ''
                && trim((string)$data['channel']) !== (string)$bot['channel']) {
                throw new ValidationException('channel_immutable', 'channel');
            }
            $channel = (string)$bot['channel'];
        } else {
            $channel = $this->channelValue($data, false) ?? 'telegram';
        }
        $candidate = array_key_exists('token', $data) && trim((string)$data['token']) !== '';
        $token = $candidate ? $this->tokenValue($data, true, $channel) : (string)($bot['token'] ?? '');
        if ($token === '') {
            throw new ValidationException('token_required', 'token');
        }

        $identity = $this->identity($channel, $token);
        if (!$identity->ok) {
            if ($bot !== null && !$candidate) {
                $this->storeIdentityFailure($id, $identity, time());
            }

            return [
                'ok' => false,
                'error_code' => $identity->errorCode,
                'status' => self::statusFor($identity->errorCode),
                'username' => '',
                'display_name' => '',
                'external_id' => '',
            ];
        }

        $other = $this->repo()->findByExternalId($identity->externalId);
        if ($other !== null && (int)$other['id'] !== $id) {
            if ($bot !== null && !$candidate) {
                $this->repo()->update($id, [
                    'status' => 'token_invalid',
                    'last_error_code' => 'other_bot',
                    'status_checked_at' => time(),
                    'updated_at' => time(),
                ]);
            }

            return [
                'ok' => false,
                'error_code' => 'other_bot',
                'status' => 'token_invalid',
                'username' => $identity->username,
                'display_name' => $identity->displayName,
                'external_id' => $identity->externalId,
                'other_bot' => [
                    'id' => (int)$other['id'],
                    'title' => (string)$other['title'],
                    'bot_username' => (string)$other['bot_username'],
                ],
            ];
        }

        if ($bot !== null && !$candidate) {
            $this->repo()->update($id, [
                'status' => 'ok',
                'last_error_code' => '',
                'bot_username' => $identity->username,
                'bot_external_id' => $identity->externalId,
                'status_checked_at' => time(),
                'updated_at' => time(),
            ]);
        }

        return [
            'ok' => true,
            'error_code' => '',
            'status' => 'ok',
            'username' => $identity->username,
            'display_name' => $identity->displayName,
            'external_id' => $identity->externalId,
        ];
    }

    /**
     * Starts or stops the five-minute discovery session. The poll itself runs in
     * WorkerMessengerHubDiscovery, never in this request.
     *
     * @param array<string, mixed> $data
     */
    private function discoverChats(array $data): array
    {
        $bot = $this->requireBot($this->botId($data));
        $now = time();
        if ((string)$bot['token'] === '') {
            throw new ValidationException('token_required', 'token');
        }
        $service = new DiscoveryService($this->repo(), $this->channels());
        if ($this->boolValue($data['stop'] ?? false, 'stop')) {
            $service->stop((int)$bot['id'], $now);
        } else {
            $active = $this->repo()->activeSession((int)$bot['id']);
            if ($active === null || $this->boolValue($data['restart'] ?? false, 'restart')) {
                $service->start((int)$bot['id'], $now);
            }
        }

        return $this->serialize($this->requireBot((int)$bot['id']), $now);
    }

    /**
     * Queues a test message through the Outbox — the same path as real notifications. The test event is
     * marked routed so no rule picks it up; deliveries are visible per chat in the bot record.
     *
     * @param array<string, mixed> $data
     */
    private function sendTest(array $data): array
    {
        $bot = $this->requireBot($this->botId($data));
        if ((string)$bot['token'] === '') {
            throw new ValidationException('token_required', 'token');
        }
        $now = time();
        $chats = $this->testChats($bot, $data);
        if ($chats === []) {
            throw new ValidationException('no_chats', 'chat_ids');
        }

        $settings = new HubSettings($this->db());
        $event = new HubEvent(
            sourceId: 'hub.test',
            eventType: 'hub.test',
            severity: HubEvent::SEVERITY_INFO,
            dedupeKey: 'test:' . (int)$bot['id'] . ':' . bin2hex(random_bytes(8)),
            occurredAt: $now,
            payload: [
                'subject' => [
                    'system' => [
                        'public_url' => $settings->pbxPublicUrl(),
                        'bot_title' => (string)$bot['title'],
                    ],
                ],
                'facts' => ['reasons' => [], 'summary' => null, 'quotes' => [], 'scores' => []],
                'links' => [],
                'attachments' => [],
            ],
        );
        $rendered = (new TestTemplate())->render(
            $event,
            new RenderContext($this->texts(), new LinkBuilder(''), false)
        );
        $renderedJson = json_encode(
            $rendered->toArray(),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        );

        $this->db()->execute(
            'INSERT INTO ' . BotRepository::EVENTS . ' (source_id, event_type, severity, dedupe_key, occurred_at,'
            . ' payload_json, routed_at, created_at) VALUES (:source, :type, :severity, :dedupe, :occurred,'
            . ' :payload, :routed, :created)',
            [
                'source' => $event->sourceId,
                'type' => $event->eventType,
                'severity' => $event->severity,
                'dedupe' => $event->dedupeKey,
                'occurred' => $now,
                'payload' => $event->payloadJson(),
                'routed' => $now,
                'created' => $now,
            ]
        );
        $eventId = $this->db()->lastInsertId();

        $chatIds = [];
        foreach ($chats as $chat) {
            $inserted = $this->db()->execute(
                'INSERT OR IGNORE INTO ' . BotRepository::OUTBOX . ' (event_id, chat_id, bot_id, rule_id, status,'
                . ' attempts, uncertain_attempts, next_attempt_at, lease_owner, lease_until, rendered_json,'
                . ' external_message_ids, last_error_code, last_error_at, created_at, updated_at, sent_at)'
                . " VALUES (:event, :chat, :bot, NULL, 'pending', 0, 0, :next, '', NULL, :rendered, '[]', '',"
                . ' NULL, :created, :updated, NULL)',
                [
                    'event' => $eventId,
                    'chat' => (int)$chat['id'],
                    'bot' => (int)$bot['id'],
                    'next' => $now,
                    'rendered' => $renderedJson,
                    'created' => $now,
                    'updated' => $now,
                ]
            );
            if ($inserted > 0) {
                $chatIds[] = (int)$chat['id'];
            }
        }
        $this->waker()->wake();

        return [
            'event_id' => $eventId,
            'chat_ids' => $chatIds,
            'bot' => $this->serialize($this->requireBot((int)$bot['id']), $now),
        ];
    }

    // ---------- chats ----------

    /**
     * @param mixed $chats
     */
    private function applyChats(int $botId, mixed $chats, int $now): void
    {
        if (!is_array($chats)) {
            throw new ValidationException('invalid_chats', 'chats');
        }
        foreach ($chats as $item) {
            if (!is_array($item)) {
                throw new ValidationException('invalid_chats', 'chats');
            }
            $rowId = (int)($item['id'] ?? 0);
            $external = trim((string)($item['chat_id'] ?? ''));
            $row = null;
            if ($rowId > 0) {
                $row = $this->repo()->findChat($botId, $rowId);
                if ($row === null) {
                    throw new ValidationException('unknown_chat', 'chats');
                }
            } elseif ($external !== '') {
                $row = $this->repo()->findChatByExternal($botId, $external);
            }
            if ($row === null && $external === '') {
                throw new ValidationException('chat_required', 'chats');
            }

            $fields = [];
            if ($external !== '') {
                $fields['chat_id'] = $external;
            }
            if (array_key_exists('chat_kind', $item)) {
                $fields['chat_kind'] = $this->chatKindValue($item['chat_kind']);
            }
            if (array_key_exists('title', $item)) {
                $fields['title'] = mb_substr(trim((string)$item['title']), 0, 255);
            }
            if (array_key_exists('linked_user_id', $item)) {
                $userId = (int)$item['linked_user_id'];
                if ($userId < 0) {
                    throw new ValidationException('invalid_linked_user', 'chats');
                }
                $fields['linked_user_id'] = $userId;
            }
            if (array_key_exists('enabled', $item)) {
                $enabled = $this->boolValue($item['enabled'], 'chats');
                $fields['enabled'] = $enabled ? '1' : '0';
                if ($enabled) {
                    // re-enabling a chat the bot was removed from gives it a fresh chance
                    $fields['state'] = 'active';
                    $fields['gone_reason'] = '';
                }
            }

            if ($row === null) {
                $this->repo()->upsertChat($botId, [
                    'chat_id' => $external,
                    'chat_kind' => $fields['chat_kind'] ?? 'group',
                    'title' => $fields['title'] ?? '',
                    'linked_user_id' => $fields['linked_user_id'] ?? 0,
                    'enabled' => $fields['enabled'] ?? '1',
                    'discovered_at' => $now,
                ], $now);

                continue;
            }
            if (isset($fields['chat_id'], $row['chat_id']) && $fields['chat_id'] !== (string)$row['chat_id']) {
                $conflict = $this->repo()->findChatByExternal($botId, (string)$fields['chat_id']);
                if ($conflict !== null && (int)$conflict['id'] !== (int)$row['id']) {
                    throw new ValidationException('chat_exists', 'chats');
                }
            }
            $this->repo()->updateChat((int)$row['id'], $fields);
        }
    }

    /**
     * Chats of a test: requested ones must belong to the bot; by default every enabled active chat.
     *
     * @param array<string, mixed> $bot
     * @param array<string, mixed> $data
     * @return list<array<string, mixed>>
     */
    private function testChats(array $bot, array $data): array
    {
        $all = [];
        foreach ($this->repo()->chats((int)$bot['id']) as $chat) {
            if ((string)$chat['state'] === 'active') {
                $all[(int)$chat['id']] = $chat;
            }
        }
        $requested = $data['chat_ids'] ?? null;
        if ($requested === null) {
            return array_values(array_filter(
                $all,
                static fn (array $chat): bool => (string)$chat['enabled'] === '1'
            ));
        }
        if (!is_array($requested)) {
            throw new ValidationException('invalid_chat_ids', 'chat_ids');
        }
        $result = [];
        foreach ($requested as $id) {
            $id = (int)$id;
            if (!isset($all[$id])) {
                throw new ValidationException('unknown_chat', 'chat_ids');
            }
            $result[] = $all[$id];
        }

        return $result;
    }

    // ---------- presentation ----------

    /**
     * The only place a bot becomes a response. `token` is never copied (Plan/07).
     *
     * @param array<string, mixed> $bot
     * @return array<string, mixed>
     */
    private function serialize(array $bot, int $now): array
    {
        $chatRows = $this->repo()->chats((int)$bot['id']);
        $deliveries = $this->repo()->lastDeliveries((int)$bot['id']);
        $chats = [];
        foreach ($chatRows as $chat) {
            $rowId = (int)$chat['id'];
            $chats[] = [
                'id' => $rowId,
                'chat_id' => (string)$chat['chat_id'],
                'chat_kind' => (string)$chat['chat_kind'],
                'title' => (string)$chat['title'],
                'linked_user_id' => (int)$chat['linked_user_id'],
                'enabled' => (string)$chat['enabled'] === '1',
                'state' => (string)$chat['state'],
                'gone_reason' => (string)$chat['gone_reason'],
                'discovered_at' => (int)$chat['discovered_at'],
                'last_delivery' => $deliveries[$rowId] ?? null,
            ];
        }

        return [
            'id' => (int)$bot['id'],
            'channel' => (string)$bot['channel'],
            'title' => (string)$bot['title'],
            'token_hint' => (string)$bot['token_hint'],
            'bot_username' => (string)$bot['bot_username'],
            'bot_external_id' => (string)$bot['bot_external_id'],
            'enabled' => (string)$bot['enabled'] === '1',
            'status' => (string)$bot['status'],
            'status_checked_at' => (int)$bot['status_checked_at'],
            'last_error_code' => (string)$bot['last_error_code'],
            'created_at' => (int)$bot['created_at'],
            'updated_at' => (int)$bot['updated_at'],
            'discovery' => $this->discovery($this->repo()->latestSession((int)$bot['id']), $chats, $now),
            'chats' => $chats,
        ];
    }

    /**
     * @param array<string, mixed>|null $session
     * @param list<array<string, mixed>> $chats
     * @return array<string, mixed>
     */
    private function discovery(?array $session, array $chats, int $now): array
    {
        if ($session === null) {
            return [
                'active' => false,
                'status' => 'idle',
                'started_at' => 0,
                'expires_at' => 0,
                'remaining_sec' => 0,
                'last_error_code' => '',
                'found' => [],
            ];
        }
        $decoded = json_decode((string)($session['found_json'] ?? ''), true);
        $found = [];
        foreach (is_array($decoded) ? $decoded : [] as $item) {
            if (!is_array($item) || !isset($item['chat_id'])) {
                continue;
            }
            $found[] = [
                'chat_id' => (string)$item['chat_id'],
                'chat_kind' => (string)($item['chat_kind'] ?? 'group'),
                'title' => (string)($item['title'] ?? ''),
                'already_connected' => (bool)($item['already_connected'] ?? false),
            ];
        }
        $expiresAt = (int)$session['expires_at'];
        $status = (string)$session['status'];
        if (in_array($status, ['running', 'found'], true) && $expiresAt <= $now) {
            $status = $found === [] ? 'empty' : 'expired';
        }

        return [
            'active' => in_array($status, ['running', 'found'], true) && $expiresAt > $now,
            'status' => $status,
            'started_at' => (int)$session['started_at'],
            'expires_at' => $expiresAt,
            'remaining_sec' => max(0, $expiresAt - $now),
            'last_error_code' => (string)$session['last_error_code'],
            'found' => $found,
        ];
    }

    // ---------- token checks ----------

    private function applyTokenCheck(int $id, string $channel, string $token, int $now): void
    {
        $identity = $this->identity($channel, $token);
        if ($identity->ok) {
            $other = $this->repo()->findByExternalId($identity->externalId);
            if ($other !== null && (int)$other['id'] !== $id) {
                $this->repo()->update($id, [
                    'status' => 'token_invalid',
                    'last_error_code' => 'other_bot',
                    'bot_username' => $identity->username,
                    'bot_external_id' => $identity->externalId,
                    'status_checked_at' => $now,
                    'updated_at' => $now,
                ]);

                return;
            }
            $this->repo()->update($id, [
                'status' => 'ok',
                'last_error_code' => '',
                'bot_username' => $identity->username,
                'bot_external_id' => $identity->externalId,
                'status_checked_at' => $now,
                'updated_at' => $now,
            ]);

            return;
        }
        $this->storeIdentityFailure($id, $identity, $now);
    }

    private function storeIdentityFailure(int $id, BotIdentity $identity, int $now): void
    {
        $this->repo()->update($id, [
            'status' => self::statusFor($identity->errorCode),
            'last_error_code' => $identity->errorCode,
            'status_checked_at' => $now,
            'updated_at' => $now,
        ]);
    }

    private static function statusFor(string $errorCode): string
    {
        if (str_starts_with($errorCode, 'telegram.401')
            || str_starts_with($errorCode, 'max.401')
            || $errorCode === 'other_bot') {
            return 'token_invalid';
        }
        if (str_contains($errorCode, '.tls.')) {
            // the token is fine, the CA is not: a separate state with its own UI hint (stage 3c).
            // The same predicate as DeliveryService, so both producers agree on the state.
            return 'ca_error';
        }

        return 'error';
    }

    private function identity(string $channel, string $token): BotIdentity
    {
        $adapter = $this->channels()->find($channel);
        if ($adapter === null) {
            return BotIdentity::failed('channel_unavailable');
        }
        try {
            return $adapter->checkToken(new BotCredentials($channel, $token));
        } catch (Throwable) {
            return BotIdentity::failed('check_failed');
        }
    }

    // ---------- values ----------

    /** @param array<string, mixed> $data */
    private function botId(array $data): int
    {
        $id = (int)($data['id'] ?? 0);
        if ($id <= 0) {
            throw new ValidationException('invalid_bot_id', 'id');
        }

        return $id;
    }

    /** @return array<string, mixed> */
    private function requireBot(int $id): array
    {
        $bot = $this->repo()->find($id);
        if ($bot === null) {
            throw new NotFoundException('bot_not_found');
        }

        return $bot;
    }

    /** @param array<string, mixed> $data */
    private function channelValue(array $data, bool $required = true): ?string
    {
        if (!array_key_exists('channel', $data)) {
            if (!$required) {
                return null;
            }
            throw new ValidationException('channel_required', 'channel');
        }
        $channel = trim((string)$data['channel']);
        if (!in_array($channel, ['telegram', 'max'], true)) {
            throw new ValidationException('unknown_channel', 'channel');
        }
        if ($this->channels()->find($channel) === null) {
            // the form still knows the channel, but this build has no adapter for it
            throw new ValidationException('channel_not_available', 'channel');
        }

        return $channel;
    }

    /** @param array<string, mixed> $data */
    private function titleValue(array $data, bool $required): ?string
    {
        if (!array_key_exists('title', $data)) {
            if ($required) {
                throw new ValidationException('title_required', 'title');
            }

            return null;
        }
        $title = trim((string)$data['title']);
        if ($title === '') {
            if ($required) {
                throw new ValidationException('title_required', 'title');
            }

            return null;
        }

        return mb_substr($title, 0, 128);
    }

    /**
     * A bot token is a single header-safe line. Telegram has a documented shape; the MAX token format
     * is not documented, so it is checked only for being a plausible opaque value (no spaces, no
     * control characters) — a strict pattern would reject real tokens, a loose one must still make
     * header injection impossible.
     *
     * @param array<string, mixed> $data
     */
    private function tokenValue(array $data, bool $required, string $channel): string
    {
        $token = trim((string)($data['token'] ?? ''));
        if ($token === '') {
            if ($required) {
                throw new ValidationException('token_required', 'token');
            }

            return '';
        }
        $valid = $channel === 'max'
            // printable ASCII without a space: a token ends up in a header value, so anything else
            // (quotes, Cyrillic, control characters) cannot work and must not be "accepted"
            ? preg_match('/^[!#-~]{8,512}$/', $token) === 1
            : preg_match('/^\d{5,}:[A-Za-z0-9_-]{30,}$/', $token) === 1;
        if (!$valid) {
            throw new ValidationException('invalid_token', 'token');
        }

        return $token;
    }

    private function chatKindValue(mixed $value): string
    {
        $kind = trim((string)$value);
        if (!in_array($kind, ['private', 'group', 'channel'], true)) {
            throw new ValidationException('invalid_chat_kind', 'chats');
        }

        return $kind;
    }

    /** @param mixed $value */
    private function boolValue($value, string $field): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if ($value === 1 || $value === 0 || $value === '1' || $value === '0') {
            return (bool)$value;
        }
        throw new ValidationException('invalid_boolean', $field);
    }

    private static function tokenHint(string $token): string
    {
        return $token === '' ? '' : substr($token, -4);
    }

    // ---------- dependencies ----------

    private function db(): HubDatabase
    {
        return $this->db ?? new PhalconHubDatabase();
    }

    private function repo(): BotRepository
    {
        return new BotRepository($this->db());
    }

    private function channels(): ChannelRegistry
    {
        if ($this->channels !== null) {
            return $this->channels;
        }
        // REST checks must answer quickly even when a messenger is unreachable
        return ChannelFactory::create(new HubSettings($this->db()), 8, 4);
    }

    private function waker(): DeliveryWaker
    {
        if ($this->waker !== null) {
            return $this->waker;
        }
        try {
            return new BeanstalkDeliveryWaker();
        } catch (Throwable) {
            return new NullDeliveryWaker();
        }
    }

    private function texts(): Texts
    {
        if ($this->texts !== null) {
            return $this->texts;
        }
        try {
            $di = \Phalcon\Di\Di::getDefault();
            $service = $di instanceof \Phalcon\Di\Di ? $di->getShared('translation') : null;
            if (is_object($service) && method_exists($service, '_')) {
                return new CoreTexts($service);
            }
        } catch (Throwable) {
            // unit checks without Core: keys stay untranslated
        }

        return new ArrayTexts([]);
    }
}
