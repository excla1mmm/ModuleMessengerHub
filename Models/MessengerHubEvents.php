<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Models;

use MikoPBX\Modules\Models\ModulesModelsBase;

/**
 * Normalised events collected from sources (Plan/04-data-model.md).
 *
 * Writes go through Lib/Events/EventStore (INSERT OR IGNORE on dedupe_key), never through save().
 *
 * @Indexes(
 *     [name='dedupe_key', columns=['dedupe_key'], type='UNIQUE'],
 *     [name='routed_at', columns=['routed_at'], type=''],
 *     [name='occurred_at', columns=['occurred_at'], type=''],
 *     [name='event_type', columns=['event_type'], type='']
 * )
 */
class MessengerHubEvents extends ModulesModelsBase
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
     * @Column(type="string", nullable=false)
     */
    public ?string $event_type = '';

    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $severity = 'info';

    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $dedupe_key = '';

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $occurred_at = '0';

    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $payload_json = '';

    /**
     * NULL until the router (stage 2) has processed the event.
     *
     * @Column(type="integer", nullable=true)
     */
    public ?string $routed_at = null;

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $created_at = '0';

    public function initialize(): void
    {
        $this->setSource('m_MessengerHubEvents');
        parent::initialize();
    }
}
