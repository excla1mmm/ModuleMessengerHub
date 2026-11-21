<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Models;

use MikoPBX\Modules\Models\ModulesModelsBase;

/**
 * Recipient chats of a bot (Plan/04-data-model.md; chats are nested under their bot in Plan/06).
 *
 * `chat_id` is a string: Telegram group ids are negative. UNIQUE(bot_id, chat_id) keeps discovery
 * idempotent. `linked_user_id` binds a chat to an employee for personal notifications
 * (target_mode = employee in rules).
 *
 * @Indexes(
 *     [name='bot_chat', columns=['bot_id', 'chat_id'], type='UNIQUE'],
 *     [name='bot_id', columns=['bot_id'], type=''],
 *     [name='linked_user_id', columns=['linked_user_id'], type='']
 * )
 */
class MessengerHubBotChats extends ModulesModelsBase
{
    /**
     * @Primary
     * @Identity
     * @Column(type="integer", nullable=false)
     */
    public $id;

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $bot_id = '0';

    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $chat_id = '';

    /** private | group | channel */
    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $chat_kind = 'private';

    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $title = '';

    /**
     * Employee id from m_Users for personal notifications; 0 = not linked.
     *
     * @Column(type="integer", nullable=false)
     */
    public ?string $linked_user_id = '0';

    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $enabled = '1';

    /** active | gone */
    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $state = 'active';

    /**
     * Normalised code, never API text with personal data.
     *
     * @Column(type="string", nullable=false)
     */
    public ?string $gone_reason = '';

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $discovered_at = '0';

    public function initialize(): void
    {
        $this->setSource('m_MessengerHubBotChats');
        parent::initialize();
    }
}
