<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Models;

use MikoPBX\Modules\Models\ModulesModelsBase;

/**
 * Per-source state: on/off switch, poll cursor, availability, baseline (Plan/04-data-model.md).
 *
 * @Indexes(
 *     [name='source_id', columns=['source_id'], type='UNIQUE']
 * )
 */
class MessengerHubSourceState extends ModulesModelsBase
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
    public ?string $source_id = '';

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $enabled = '1';

    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $cursor_json = '';

    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $availability = '';

    /**
     * @Column(type="integer", nullable=true)
     */
    public ?string $last_poll_at = null;

    /**
     * @Column(type="integer", nullable=true)
     */
    public ?string $last_ok_at = null;

    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $last_error_code = '';

    /**
     * Moment from which the source produces events; history before it is never broadcast.
     *
     * @Column(type="integer", nullable=true)
     */
    public ?string $baseline_set_at = null;

    public function initialize(): void
    {
        $this->setSource('m_MessengerHubSourceState');
        parent::initialize();
    }
}
