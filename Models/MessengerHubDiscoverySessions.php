<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Models;

use MikoPBX\Modules\Models\ModulesModelsBase;

/**
 * «Подключить чат» sessions: five minutes of getUpdates per bot (Plan/03-channels.md).
 *
 * The poll runs in a worker, never inside the REST request; the REST layer only starts the session
 * and reads its state. found_json keeps discovered chats (chat id is not personal data by itself).
 *
 * @Indexes(
 *     [name='bot_status', columns=['bot_id', 'status'], type='']
 * )
 */
class MessengerHubDiscoverySessions extends ModulesModelsBase
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
     * @Column(type="integer", nullable=false)
     */
    public ?string $started_at = '0';

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $expires_at = '0';

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $updates_offset = '0';

    /** JSON list of {chat_id, chat_kind, title}. */
    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $found_json = '[]';

    /** running | found | expired | empty | error */
    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $status = 'running';

    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $last_error_code = '';

    public function initialize(): void
    {
        $this->setSource('m_MessengerHubDiscoverySessions');
        parent::initialize();
    }
}
