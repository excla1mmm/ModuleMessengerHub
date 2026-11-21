<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Models;

use MikoPBX\Modules\Models\ModulesModelsBase;

/**
 * Global key/value settings of the hub (Plan/04-data-model.md).
 *
 * @Indexes(
 *     [name='key', columns=['key'], type='UNIQUE']
 * )
 */
class MessengerHubSettings extends ModulesModelsBase
{
    // Keys and defaults live in Lib/Settings/HubSettings.

    /**
     * @Primary
     * @Identity
     * @Column(type="integer", nullable=false)
     */
    public $id;

    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $key = '';

    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $value = '';

    public function initialize(): void
    {
        $this->setSource('m_MessengerHubSettings');
        parent::initialize();
    }
}
