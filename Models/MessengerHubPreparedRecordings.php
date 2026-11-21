<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Models;

use MikoPBX\Modules\Models\ModulesModelsBase;

/**
 * Prepared audio cache of one event (Plan/04, stage 3a).
 *
 * One row per (event, mode, source, fragments): every chat of the event reuses the same converted
 * files. `lease_owner`/`lease_until` keep two workers from converting the same recording at once.
 * Files live in the module temp directory and are deleted after the delivery finishes or fails.
 *
 * @Indexes(
 *     [name='cache_key', columns=['cache_key'], type='UNIQUE'],
 *     [name='event_id', columns=['event_id'], type=''],
 *     [name='status_lease', columns=['status', 'lease_until'], type='']
 * )
 */
class MessengerHubPreparedRecordings extends ModulesModelsBase
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
    public ?string $event_id = '0';

    /** sha256 of event + mode + source + fragments; never contains a path. */
    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $cache_key = '';

    /** preparing | ready | failed */
    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $status = 'preparing';

    /** JSON list of prepared parts: path, bytes, duration_ms, start_ms, end_ms. */
    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $files_json = '[]';

    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $lease_owner = '';

    /**
     * @Column(type="integer", nullable=true)
     */
    public ?string $lease_until = null;

    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $error_code = '';

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
        $this->setSource('m_MessengerHubPreparedRecordings');
        parent::initialize();
    }
}
