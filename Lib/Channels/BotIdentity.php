<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

/**
 * What checkToken() learned about a bot. Error codes are normalised (telegram.401.unauthorized),
 * never API descriptions with tokens.
 */
final class BotIdentity
{
    public function __construct(
        public readonly bool $ok,
        public readonly string $username = '',
        public readonly string $externalId = '',
        public readonly string $displayName = '',
        public readonly string $errorCode = '',
    ) {
    }

    public static function ok(string $username, string $externalId, string $displayName = ''): self
    {
        return new self(true, $username, $externalId, $displayName);
    }

    public static function failed(string $errorCode): self
    {
        return new self(false, errorCode: $errorCode);
    }
}
