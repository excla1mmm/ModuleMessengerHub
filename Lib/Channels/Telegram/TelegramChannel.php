<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels\Telegram;

use Modules\ModuleMessengerHub\Lib\Channels\BotCredentials;
use Modules\ModuleMessengerHub\Lib\Channels\BotIdentity;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelInterface;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelLimits;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryBatch;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryCursor;
use Modules\ModuleMessengerHub\Lib\Channels\Recipient;
use Modules\ModuleMessengerHub\Lib\Channels\SendResult;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;

/**
 * Telegram adapter (Plan/03-channels.md). All API facts and error classification live in TelegramApi;
 * this class only maps the neutral contract onto it.
 *
 * Attachments are rendered in stage 3a: send() delivers the text message, sendAudio/sendDocument
 * already exist in the client for that step.
 */
final class TelegramChannel implements ChannelInterface
{
    public const string ID = 'telegram';

    private readonly TelegramHtml $html;

    public function __construct(private readonly TelegramApi $api)
    {
        $this->html = new TelegramHtml($this->limits());
    }

    public function id(): string
    {
        return self::ID;
    }

    public function checkToken(BotCredentials $bot): BotIdentity
    {
        return $this->api->getMe($bot);
    }

    public function discoverChats(BotCredentials $bot, DiscoveryCursor $cursor): DiscoveryBatch
    {
        return $this->api->getUpdates($bot, $cursor);
    }

    public function send(BotCredentials $bot, Recipient $to, RenderedMessage $message): SendResult
    {
        $rendered = $this->html->render($message);

        return $this->api->sendMessage($bot, $to->chatId, $rendered['text'], $rendered['buttons']);
    }

    public function delete(BotCredentials $bot, Recipient $to, string $externalMessageId): SendResult
    {
        if ($externalMessageId === '') {
            return SendResult::sent();
        }

        return $this->api->deleteMessage($bot, $to->chatId, $externalMessageId);
    }

    public function limits(): ChannelLimits
    {
        return ChannelLimits::telegram();
    }
}
