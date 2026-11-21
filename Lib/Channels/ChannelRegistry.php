<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

/**
 * channel id -> adapter. Stage 2 has Telegram only; stage 3 adds MAX here and nowhere else.
 */
final class ChannelRegistry
{
    /** @var array<string, ChannelInterface> */
    private array $channels = [];

    /** @param list<ChannelInterface> $channels */
    public function __construct(array $channels)
    {
        foreach ($channels as $channel) {
            $this->channels[$channel->id()] = $channel;
        }
    }

    public function find(string $channelId): ?ChannelInterface
    {
        return $this->channels[$channelId] ?? null;
    }
}
