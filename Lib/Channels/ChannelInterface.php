<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;

/**
 * Messenger channel adapter contract (Plan/03-channels.md, docs/adding-a-channel.md).
 *
 * Adapters own error classification and markup: the queue and the router only see SendResult.
 * Credentials arrive as BotCredentials and must never be put into exceptions, logs or results.
 */
interface ChannelInterface
{
    /** 'telegram' | 'max' */
    public function id(): string;

    public function checkToken(BotCredentials $bot): BotIdentity;

    /**
     * One discovery poll (the five-minute session is driven by a worker, not by a REST request).
     */
    public function discoverChats(BotCredentials $bot, DiscoveryCursor $cursor): DiscoveryBatch;

    public function send(BotCredentials $bot, Recipient $to, RenderedMessage $message): SendResult;

    /**
     * One audio part of a delivery (stage 3a). The adapter escapes the caption once and maps the API
     * answer to the same four outcomes; MAX may answer `notReady` with a token to reuse.
     */
    public function sendAttachment(BotCredentials $bot, Recipient $to, AttachmentPart $part): AttachmentResult;

    /**
     * Deletes one previously sent message (stage 2d: retract a missed-call notification).
     * A missing message counts as deleted (sent with no ids).
     */
    public function delete(BotCredentials $bot, Recipient $to, string $externalMessageId): SendResult;

    public function limits(): ChannelLimits;
}
