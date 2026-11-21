<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

/**
 * Bot credentials for a channel call.
 *
 * The token is the only secret here: it must never reach logs, REST responses, SendResult codes or
 * exception messages. HubLogger masks token-shaped strings as a last line of defence, and the
 * transport never logs URLs (Telegram puts the token into the URL).
 */
final class BotCredentials
{
    public function __construct(
        public readonly string $channel,
        #[\SensitiveParameter] public readonly string $token,
    ) {
    }

    /** @return array<string, string> */
    public function __debugInfo(): array
    {
        return ['channel' => $this->channel, 'token' => '***'];
    }
}
