<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Models;

use MikoPBX\Modules\Models\ModulesModelsBase;

/**
 * Delivery queue (Plan/04-data-model.md, Plan/08-reliability.md).
 *
 * UNIQUE(event_id, chat_id) makes "one event -> one message per chat" idempotent. Every external
 * message id of a delivery (text + attachments, stage 3a) is stored as a JSON list so 2d can retract
 * the whole delivery. Rows are leased by WorkerMessengerHubDelivery.
 *
 * Statuses: pending | sending | sent | failed | dropped | cancelled | retracted | retract_failed.
 *
 * @Indexes(
 *     [name='event_chat', columns=['event_id', 'chat_id'], type='UNIQUE'],
 *     [name='status_next', columns=['status', 'next_attempt_at'], type=''],
 *     [name='chat_status', columns=['chat_id', 'status'], type=''],
 *     [name='event_id', columns=['event_id'], type='']
 * )
 */
class MessengerHubOutbox extends ModulesModelsBase
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

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $chat_id = '0';

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $bot_id = '0';

    /**
     * @Column(type="integer", nullable=true)
     */
    public ?string $rule_id = null;

    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $status = 'pending';

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $attempts = '0';

    /** Unknown-outcome retries already spent (Plan/08: at most one). */
    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $uncertain_attempts = '0';

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $next_attempt_at = '0';

    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $lease_owner = '';

    /**
     * @Column(type="integer", nullable=true)
     */
    public ?string $lease_until = null;

    /** Neutral RenderedMessage JSON as rendered at routing time (already masked). */
    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $rendered_json = '';

    /** JSON list of message ids in the messenger (text + attachments). */
    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $external_message_ids = '[]';

    /** Stage 3a: frozen attachment plan (mode, source, fragments, fallback line). */
    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $attachment_json = null;

    /** Stage 3a: per-part progress (text, audio N, note) with external ids and MAX upload tokens. */
    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $delivery_parts_json = null;

    /** Stage 3a: which retraction ids are already deleted / left after a partial failure. */
    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $retract_progress_json = null;

    /**
     * @Column(type="string", nullable=false)
     */
    public ?string $last_error_code = '';

    /**
     * @Column(type="integer", nullable=true)
     */
    public ?string $last_error_at = null;

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $created_at = '0';

    /**
     * @Column(type="integer", nullable=false)
     */
    public ?string $updated_at = '0';

    /**
     * @Column(type="integer", nullable=true)
     */
    public ?string $sent_at = null;

    // ---- stage 2d: retract the message when the client was called back (Plan/12) ----

    /** Set when the resolved event asked to delete the sent message. */
    /**
     * @Column(type="integer", nullable=true)
     */
    public ?string $retract_requested_at = null;

    /**
     * @Column(type="integer", nullable=true)
     */
    public ?string $retract_attempts = null;

    /**
     * @Column(type="integer", nullable=true)
     */
    public ?string $retract_next_attempt_at = null;

    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $retract_last_error_code = null;

    /**
     * @Column(type="integer", nullable=true)
     */
    public ?string $retracted_at = null;

    /** resolved_before_send | resolved_after_send */
    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $retract_reason = null;

    /**
     * @Column(type="integer", nullable=true)
     */
    public ?string $resolved_at = null;

    /** Employee who called back, "Иванов И. (233)". */
    /**
     * @Column(type="string", nullable=true)
     */
    public ?string $resolved_by = null;

    public function initialize(): void
    {
        $this->setSource('m_MessengerHubOutbox');
        parent::initialize();
    }
}
