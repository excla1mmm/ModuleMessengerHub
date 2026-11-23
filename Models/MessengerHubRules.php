<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Models;

use MikoPBX\Modules\Models\ModulesModelsBase;

/**
 * Routing rules: which events, with which filters, to whom and how (Plan/05-events-rules-templates.md).
 *
 * JSON columns are encoded by Lib/Routing/RuleRepository; the model only declares the schema.
 * `sort` is the evaluation order (lower first); all matching rules fire, duplicates per
 * (event, chat) are dropped by the Outbox unique index.
 *
 * @Indexes(
 *     [name='enabled_sort', columns=['enabled', 'sort'], type='']
 * )
 */
class MessengerHubRules extends ModulesModelsBase
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
    public ?string $title = '';

    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $enabled = '0';

    /** JSON list of event types, "prefix.*" allowed. */
    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $event_types = '[]';

    /** info | warning | critical */
    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $min_severity = 'info';

    /** JSON object: user_ids, directions, providers, quality_score, reasons. */
    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $filters_json = '{}';

    /** recipients | employee | employee_or_recipients */
    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $target_mode = 'recipients';

    /** JSON list of m_MessengerHubBotChats ids. */
    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $chat_ids_json = '[]';

    /** '' = per-event template */
    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $template_key = '';

    /** JSON object: mask_phone, attachments, retract_on_callback (stage 2d). */
    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $options_json = '{}';

    /** JSON object, stage 4. */
    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $quiet_hours_json = '{}';

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $sort = '100';

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
        $this->setSource('m_MessengerHubRules');
        parent::initialize();
    }
}
