<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Models;

use MikoPBX\Modules\Models\ModulesModelsBase;

/**
 * Connected messenger bots (Plan/04-data-model.md).
 *
 * `token` is write-only: it never leaves the module through REST, logs or error codes — only
 * `token_hint` is exposed (Plan/07-security-privacy.md). Writes go through Lib/RestAPI/Bots.
 *
 * @Indexes(
 *     [name='channel', columns=['channel'], type='']
 * )
 */
class MessengerHubBots extends ModulesModelsBase
{
    /**
     * @Primary
     * @Identity
     * @Column(type="integer", nullable=false)
     */
    public $id;

    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $channel = 'telegram';

    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $title = '';

    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $token = '';

    /**
     * Last 4 characters of the token, the only token-derived value ever shown.
     *
     * @Column(type="string", nullable=false)
     */
    public ?string $token_hint = '';

    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $bot_username = '';

    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $bot_external_id = '';

    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $enabled = '1';

    /** new | ok | token_invalid | error */
    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $status = 'new';

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $status_checked_at = '0';

    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $last_error_code = '';

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $created_at = '0';

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $updated_at = '0';

    public function initialize(): void
    {
        $this->setSource('m_MessengerHubBots');
        parent::initialize();
    }
}
