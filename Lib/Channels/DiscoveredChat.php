<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

/**
 * One chat found during a discovery session.
 */
final class DiscoveredChat
{
    public function __construct(
        public readonly string $chatId,
        public readonly string $kind,
        public readonly string $title,
    ) {
    }

    /** @return array{chat_id: string, chat_kind: string, title: string} */
    public function toArray(): array
    {
        return ['chat_id' => $this->chatId, 'chat_kind' => $this->kind, 'title' => $this->title];
    }
}
