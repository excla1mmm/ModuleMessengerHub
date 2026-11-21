<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing;

use Modules\ModuleMessengerHub\Lib\Attachments\AttachmentPlanner;
use Modules\ModuleMessengerHub\Lib\Delivery\RetractionPlanner;
use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;
use Modules\ModuleMessengerHub\Lib\Support\Texts;
use Modules\ModuleMessengerHub\Lib\Routing\Templates\TemplateRegistry;

/**
 * Router: unrouted events -> matching rules -> recipient chats -> rendered message -> Outbox rows
 * (Plan/01-architecture.md, Plan/05-events-rules-templates.md).
 *
 * - all matching rules fire; UNIQUE(event_id, chat_id) keeps one message per chat even when two rules
 *   resolve the same chat;
 * - no matching rule: the event stays in the journal, nothing is sent;
 * - hub_enabled = 0: events are still collected and recorded, but every event is marked processed
 *   without a delivery row — nothing leaves the PBX, and enabling the hub later never broadcasts
 *   the backlog (history is not sent);
 * - an event that cannot be rendered (no template) produces no delivery but is still marked processed.
 */
final class Router
{
    public const string OUTBOX_TABLE = 'm_MessengerHubOutbox';

    private readonly RetractionPlanner $retractions;

    public function __construct(
        private readonly HubDatabase $db,
        private readonly EventStore $events,
        private readonly RuleRepository $rules,
        private readonly ChatResolver $chats,
        private readonly TemplateRegistry $templates,
        private readonly HubSettings $settings,
        private readonly Texts $texts,
    ) {
        $this->retractions = new RetractionPlanner($db, $rules);
    }

    /**
     * @return array{events: int, deliveries: int}
     */
    public function runOnce(int $now, int $batch = 200): array
    {
        if (!$this->settings->hubEnabled()) {
            $skipped = $this->events->markAllRouted($now);

            return ['events' => $skipped, 'deliveries' => 0];
        }

        $rows = $this->events->unrouted($batch);
        if ($rows === []) {
            return ['events' => 0, 'deliveries' => 0];
        }

        $enabled = $this->rules->enabled();
        $links = new LinkBuilder($this->settings->pbxPublicUrl());
        $planner = new AttachmentPlanner($this->texts, $links);
        $maskDefault = $this->settings->maskPhoneDefault();
        $deliveries = 0;
        $processed = [];

        foreach ($rows as $row) {
            $event = self::event($row);
            if ($event === null) {
                $processed[] = (int)$row['id'];

                continue;
            }
            if ($event->eventType === RetractionPlanner::RESOLVED_TYPE) {
                // Plan/12: cancel queued notifications or request deletion of sent ones
                $result = $this->retractions->apply($event, $now);
                if ($result['cancelled'] + $result['requested'] > 0) {
                    HubLogger::event('router', 'retraction_requested', $result);
                }
                $processed[] = (int)$row['id'];

                continue;
            }
            foreach ($enabled as $rule) {
                if (!$rule->matches($event)) {
                    continue;
                }
                $chats = $this->chats->resolve($rule, $event);
                if ($chats === []) {
                    continue;
                }
                $template = $this->templates->forEvent(
                    $rule->templateKey !== '' ? $rule->templateKey : $event->eventType
                );
                if ($template === null) {
                    HubLogger::event('router', 'template_missing', ['event_type' => $event->eventType], LOG_WARNING);

                    continue;
                }
                $message = $template->render(
                    $event,
                    new RenderContext($this->texts, $links, $rule->maskPhone($maskDefault))
                );
                if (($event->payload['probe'] ?? false) === true) {
                    // replay/probe events on the test station are visibly marked in the messenger
                    $message = $message->withNote($this->texts->t('module_messenger_hub_ProbeNote'));
                }
                $rendered = json_encode(
                    $message->toArray(),
                    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
                );
                $plan = $planner->plan($event, $rule, $message);
                $attachmentJson = $plan === null
                    ? null
                    : json_encode(
                        $plan->toArray(),
                        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
                    );
                foreach ($chats as $chat) {
                    $deliveries += $this->insertDelivery(
                        (int)$row['id'],
                        $chat['id'],
                        $chat['bot_id'],
                        $rule->id,
                        $rendered,
                        $attachmentJson,
                        $now
                    );
                }
            }
            $processed[] = (int)$row['id'];
        }

        $this->events->markRouted($processed, $now);

        return ['events' => count($processed), 'deliveries' => $deliveries];
    }

    private function insertDelivery(
        int $eventId,
        int $chatId,
        int $botId,
        int $ruleId,
        string $rendered,
        ?string $attachmentJson,
        int $now
    ): int {
        return $this->db->execute(
            'INSERT OR IGNORE INTO ' . self::OUTBOX_TABLE
            . ' (event_id, chat_id, bot_id, rule_id, status, attempts, uncertain_attempts, next_attempt_at,'
            . ' lease_owner, lease_until, rendered_json, attachment_json, external_message_ids, last_error_code, last_error_at,'
            . ' created_at, updated_at, sent_at)'
            . " VALUES (:event_id, :chat_id, :bot_id, :rule_id, 'pending', 0, 0, :now,"
            . " '', NULL, :rendered, :attachment_json, '[]', '', NULL, :created_at, :updated_at, NULL)",
            [
                'event_id' => $eventId,
                'chat_id' => $chatId,
                'bot_id' => $botId,
                'rule_id' => $ruleId,
                'now' => $now,
                'rendered' => $rendered,
                'attachment_json' => $attachmentJson,
                'created_at' => $now,
                'updated_at' => $now,
            ]
        );
    }

    /** @param array<string, mixed> $row */
    private static function event(array $row): ?HubEvent
    {
        try {
            $payload = json_decode((string)($row['payload_json'] ?? ''), true);

            return new HubEvent(
                sourceId: (string)($row['source_id'] ?? ''),
                eventType: (string)($row['event_type'] ?? ''),
                severity: (string)($row['severity'] ?? ''),
                dedupeKey: (string)($row['dedupe_key'] ?? ''),
                occurredAt: (int)($row['occurred_at'] ?? 0),
                payload: is_array($payload) ? $payload : [],
            );
        } catch (\Throwable) {
            return null;
        }
    }
}
