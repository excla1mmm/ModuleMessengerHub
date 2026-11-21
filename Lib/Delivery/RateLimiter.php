<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Delivery;

use Modules\ModuleMessengerHub\Lib\Channels\ChannelLimits;

/**
 * Per-chat, per-group and per-bot send limits (Plan/03, Plan/08). In-process state is enough: the
 * delivery worker is the only sender, and a restart merely starts the windows empty.
 *
 * reserve() either records a send and returns 0, or returns the number of seconds the row must wait.
 * A limited row is postponed, never failed.
 *
 * A channel whose per-bot cap is a platform-wide limit (MAX: 30 rps for the whole
 * platform-api2.max.ru) shares one bucket between all its bots of the station, so two MAX bots do
 * not double the host rate.
 */
final class RateLimiter
{
    /** @var array<string, int> "bot:chat" => last accepted send */
    private array $lastChat = [];

    /** @var array<string, list<int>> "bot:chat" => group sends inside the last minute */
    private array $groupTimes = [];

    /** @var array<string, list<int>> bucket => sends inside the last second */
    private array $botTimes = [];

    public function reserve(
        int $botId,
        string $chatId,
        string $chatKind,
        int $now,
        ChannelLimits $limits,
        string $channelId = '',
    ): int {
        $chatKey = $botId . ':' . $chatId;
        $last = $this->lastChat[$chatKey] ?? null;
        if ($last !== null && $now - $last < $limits->perChatSec) {
            return max(1, $limits->perChatSec - ($now - $last));
        }

        if ($chatKind === 'group') {
            $times = array_values(array_filter(
                $this->groupTimes[$chatKey] ?? [],
                static fn (int $at): bool => $now - $at < 60
            ));
            $this->groupTimes[$chatKey] = $times;
            if (count($times) >= $limits->perGroupPerMinute) {
                return max(1, 60 - ($now - $times[0]));
            }
        }

        $bucket = $limits->perBotSharedHost && $channelId !== '' ? 'channel:' . $channelId : 'bot:' . $botId;
        $botTimes = array_values(array_filter(
            $this->botTimes[$bucket] ?? [],
            static fn (int $at): bool => $now - $at < 1
        ));
        $this->botTimes[$bucket] = $botTimes;
        if (count($botTimes) >= $limits->perBotPerSec) {
            return 1;
        }

        $this->lastChat[$chatKey] = $now;
        if ($chatKind === 'group') {
            $this->groupTimes[$chatKey][] = $now;
        }
        $this->botTimes[$bucket][] = $now;

        return 0;
    }
}
