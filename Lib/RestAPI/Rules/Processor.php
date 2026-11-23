<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Rules;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModuleMessengerHub\Lib\Api\ApiKeyReconciler;
use Modules\ModuleMessengerHub\Lib\Api\ApiKeySync;
use Modules\ModuleMessengerHub\Lib\Api\HubApiKey;
use Modules\ModuleMessengerHub\Lib\Attachments\AttachmentMode;
use Modules\ModuleMessengerHub\Lib\Routing\EventTypeMatcher;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Sources\CoreModuleStatusProbe;
use Modules\ModuleMessengerHub\Lib\Sources\ModuleStatusProbe;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\NotFoundException;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\Responder;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\UnknownActionException;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\ValidationException;
use Modules\ModuleMessengerHub\Lib\Routing\ChatResolver;
use Modules\ModuleMessengerHub\Lib\Routing\Rule;
use Modules\ModuleMessengerHub\Lib\Sources\Modules\CloudAiPauseReasons;
use Modules\ModuleMessengerHub\Lib\Routing\RuleRepository;
use Modules\ModuleMessengerHub\Lib\Sources\SourceCatalog;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;
use Modules\ModuleMessengerHub\Lib\Storage\PhalconHubDatabase;

/**
 * Rules resource (Plan/06): the notifications of the hub.
 *
 * A rule = event types + filters + recipients + presentation. The notifications screen and the
 * three-step wizard use exactly this resource; there is no preview-matches method (decision Q14).
 * Stage 2 filters: employees, call direction, providers, and the quality score range of
 * ai_supervisor.attention_call. Groups/departments are a stage 4 To Do.
 */
final class Processor
{
    private const array SEVERITIES = ['info', 'warning', 'critical'];
    private const array DIRECTIONS = ['incoming', 'outgoing', 'internal'];
    private const array TARGET_MODES = [
        Rule::MODE_RECIPIENTS,
        Rule::MODE_EMPLOYEE,
        Rule::MODE_EMPLOYEE_OR_RECIPIENTS,
    ];
    private const array OPTION_KEYS = ['mask_phone', 'attachments', 'retract_on_callback'];
    private const array ATTACHMENT_MODES = [AttachmentMode::NONE, AttachmentMode::FRAGMENTS, AttachmentMode::RECORDING];
    private const array FILTER_KEYS = ['user_ids', 'directions', 'providers', 'quality_score', 'reasons'];

    public function __construct(
        private readonly ?HubDatabase $db = null,
        private readonly ?ApiKeySync $apiKeySync = null,
        private readonly ?ModuleStatusProbe $probe = null,
    ) {
    }

    /** Entry point used by Core (WorkerApiCommands). */
    public static function callBack(array $request): PBXApiResult
    {
        $probe = null;
        try {
            $probe = new CoreModuleStatusProbe();
        } catch (\Throwable) {
            // no Core DI: the collector reconciles the key within a minute
        }

        return (new self(null, new HubApiKey(new HubSettings(new PhalconHubDatabase())), $probe))->process($request);
    }

    /** @param array<string, mixed> $request */
    public function process(array $request): PBXApiResult
    {
        $action = (string)($request['action'] ?? '');
        $data = Responder::data($request);

        return Responder::handle(__METHOD__, $action, function () use ($action, $data): array {
            switch ($action) {
                case 'getList':
                    return [$this->list($data)];
                case 'getRecord':
                    return [$this->record($data)];
                case 'getDefault':
                    return [$this->defaults()];
                case 'create':
                    return [$this->create($data), 201];
                case 'update':
                    return [$this->save($data, true)];
                case 'patch':
                    return [$this->save($data, false)];
                case 'delete':
                    return [$this->remove($data)];
                case 'changePriority':
                    return [$this->changePriority($data)];
                default:
                    throw new UnknownActionException($action);
            }
        });
    }

    /** @param array<string, mixed> $data */
    private function list(array $data): array
    {
        [$limit, $offset] = Responder::page($data);
        $now = time();
        $all = $this->repo()->rows();
        $rows = array_slice($all, $offset, $limit);
        $items = array_map(fn (array $row): array => $this->serialize($row, $now), $rows);
        $total = count($all);

        return [
            'items' => $items,
            'pagination' => [
                'limit' => $limit,
                'offset' => $offset,
                'total' => $total,
                'has_more' => $offset + count($items) < $total,
            ],
        ];
    }

    /** @param array<string, mixed> $data */
    private function record(array $data): array
    {
        return $this->serialize($this->requireRule($this->ruleId($data)), time());
    }

    /** @return array<string, mixed> */
    private function defaults(): array
    {
        return [
            'id' => 0,
            'title' => '',
            'enabled' => true,
            'event_types' => [],
            'min_severity' => 'info',
            'filters' => [],
            'target_mode' => Rule::MODE_EMPLOYEE_OR_RECIPIENTS,
            'chat_ids' => [],
            'chats' => [],
            'options' => [],
            'priority' => 100,
            'template_key' => '',
            'source_id' => '',
            'group' => '',
            'last_event_at' => null,
        ];
    }

    /** @param array<string, mixed> $data */
    private function create(array $data): array
    {
        $fields = $this->validated($data, true);
        $this->checkAttachments($fields['event_types'] ?? [], $fields['options'] ?? []);
        if (!isset($data['priority'])) {
            $fields['priority'] = $this->repo()->maxSort() + 10;
        }
        $now = time();
        $id = $this->repo()->create($fields, $now);
        $this->syncApiKey();

        return $this->serialize($this->requireRule($id), $now);
    }

    /** @param array<string, mixed> $data */
    private function save(array $data, bool $full): array
    {
        $row = $this->requireRule($this->ruleId($data));
        $fields = $this->validated($data, $full);
        // the effective combination is checked: a PATCH of event_types alone must not leave a stored
        // audio mode on a rule that can no longer carry audio
        $this->checkAttachments(
            $fields['event_types'] ?? self::decodeList($row['event_types'] ?? '[]'),
            $fields['options'] ?? self::decodeObject($row['options_json'] ?? '{}')
        );
        if ($fields !== []) {
            $this->repo()->update((int)$row['id'], $fields, time());
            $this->syncApiKey();
        }

        return $this->serialize($this->requireRule((int)$row['id']), time());
    }

    /** @param array<string, mixed> $data */
    private function remove(array $data): array
    {
        $row = $this->requireRule($this->ruleId($data));
        $this->repo()->delete((int)$row['id']);
        $this->syncApiKey();

        return ['id' => (int)$row['id'], 'deleted' => true];
    }

    /**
     * `{order: [id, id, …]}` — a permutation of all rules; the first one is evaluated first.
     *
     * @param array<string, mixed> $data
     */
    private function changePriority(array $data): array
    {
        $order = $data['order'] ?? null;
        if (!is_array($order)) {
            throw new ValidationException('invalid_order', 'order');
        }
        $known = array_map(static fn (array $row): int => (int)$row['id'], $this->repo()->rows());
        $ids = [];
        foreach ($order as $id) {
            if (!is_int($id) && !(is_string($id) && ctype_digit($id))) {
                throw new ValidationException('invalid_order', 'order');
            }
            $ids[] = (int)$id;
        }
        sort($known);
        $sorted = $ids;
        sort($sorted);
        if ($sorted !== $known || count(array_unique($ids)) !== count($ids)) {
            throw new ValidationException('invalid_order', 'order');
        }
        $this->repo()->reorder($ids);

        return $this->list([]);
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function serialize(array $row, int $now): array
    {
        $types = self::decodeList($row['event_types'] ?? '[]');
        $chatIds = [];
        foreach (self::decodeList($row['chat_ids_json'] ?? '[]') as $id) {
            if (is_int($id) || (is_string($id) && ctype_digit($id))) {
                $chatIds[] = (int)$id;
            }
        }
        $source = $types !== [] ? SourceCatalog::sourceForEventType((string)$types[0]) : null;

        return [
            'id' => (int)$row['id'],
            'title' => (string)$row['title'],
            'enabled' => (string)$row['enabled'] === '1',
            'event_types' => $types,
            'min_severity' => (string)$row['min_severity'],
            'filters' => self::decodeObject($row['filters_json'] ?? '{}'),
            'target_mode' => (string)$row['target_mode'],
            'chat_ids' => $chatIds,
            'chats' => array_map(static fn (array $chat): array => [
                'id' => (int)$chat['id'],
                'chat_id' => (string)$chat['chat_id'],
                'chat_kind' => (string)$chat['chat_kind'],
                'title' => (string)$chat['title'],
                'bot_id' => (int)$chat['bot_id'],
                'bot_title' => (string)$chat['bot_title'],
                'channel' => (string)$chat['channel'],
                'enabled' => (string)$chat['enabled'] === '1',
                'state' => (string)$chat['state'],
            ], $this->repo()->chatsByIds($chatIds)),
            'options' => self::decodeObject($row['options_json'] ?? '{}'),
            'priority' => (int)$row['sort'],
            'template_key' => (string)$row['template_key'],
            'source_id' => $source ?? '',
            'group' => $source !== null ? SourceCatalog::group($source) : '',
            'last_event_at' => $this->repo()->lastEventAt($types),
        ];
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function validated(array $data, bool $full): array
    {
        $fields = [];

        if (array_key_exists('title', $data)) {
            $title = trim((string)$data['title']);
            if ($title === '' || mb_strlen($title) > 128) {
                throw new ValidationException('invalid_title', 'title');
            }
            $fields['title'] = $title;
        } elseif ($full) {
            throw new ValidationException('title_required', 'title');
        }

        if (array_key_exists('enabled', $data)) {
            $fields['enabled'] = self::boolValue($data['enabled'], 'enabled') ? '1' : '0';
        } elseif ($full) {
            throw new ValidationException('enabled_required', 'enabled');
        }

        if (array_key_exists('event_types', $data)) {
            $types = $this->eventTypesValue($data['event_types']);
            if ($types === []) {
                throw new ValidationException('event_types_required', 'event_types');
            }
            $fields['event_types'] = $types;
        } elseif ($full) {
            throw new ValidationException('event_types_required', 'event_types');
        }

        if (array_key_exists('min_severity', $data)) {
            $severity = (string)$data['min_severity'];
            if (!in_array($severity, self::SEVERITIES, true)) {
                throw new ValidationException('invalid_severity', 'min_severity');
            }
            $fields['min_severity'] = $severity;
        }

        if (array_key_exists('filters', $data)) {
            $fields['filters'] = $this->filtersValue($data['filters']);
        }

        $targetMode = null;
        if (array_key_exists('target_mode', $data)) {
            $targetMode = (string)$data['target_mode'];
            if (!in_array($targetMode, self::TARGET_MODES, true)) {
                throw new ValidationException('invalid_target_mode', 'target_mode');
            }
            $fields['target_mode'] = $targetMode;
        } elseif ($full) {
            throw new ValidationException('target_mode_required', 'target_mode');
        }

        $chatIds = null;
        if (array_key_exists('chat_ids', $data)) {
            $chatIds = $this->chatIdsValue($data['chat_ids']);
            $fields['chat_ids'] = $chatIds;
        }

        $needChats = ($fields['target_mode'] ?? $targetMode) !== Rule::MODE_EMPLOYEE;
        if ($needChats) {
            $effective = $chatIds;
            if ($effective === null && !array_key_exists('chat_ids', $data)) {
                // PATCH without chats keeps the stored set; only a create/replacement can be empty
                $effective = $full ? [] : null;
            }
            if ($effective !== null && $effective === []) {
                throw new ValidationException('chat_ids_required', 'chat_ids');
            }
        }

        if (array_key_exists('options', $data)) {
            $fields['options'] = $this->optionsValue($data['options']);
        }

        if (array_key_exists('template_key', $data)) {
            $template = trim((string)$data['template_key']);
            if ($template !== '' && SourceCatalog::eventTypeKey($template) === null) {
                throw new ValidationException('unknown_event_type', 'template_key');
            }
            $fields['template_key'] = $template;
        }

        if (array_key_exists('priority', $data)) {
            $priority = (int)$data['priority'];
            if ($priority < 0 || $priority > 10000) {
                throw new ValidationException('invalid_priority', 'priority');
            }
            $fields['priority'] = $priority;
        }

        return $fields;
    }

    /**
     * Audio is offered only where the event can carry it (Plan/05): `recording` needs a voicemail or an
     * attention-call type among the rule's event types, `fragments` an attention-call type (for voicemail
     * a fragments mode would mean "whole file", so a voicemail-only rule must say `recording`). Wildcards
     * count through the matcher. `none` is always valid.
     *
     * @param list<mixed> $eventTypes
     * @param array<string, mixed> $options
     */
    private function checkAttachments(array $eventTypes, array $options): void
    {
        $mode = $options['attachments'] ?? AttachmentMode::NONE;
        if (!is_string($mode) || !AttachmentMode::enabled($mode)) {
            return;
        }
        $types = array_values(array_filter($eventTypes, 'is_string'));
        $allowed = $mode === AttachmentMode::FRAGMENTS
            ? EventTypeMatcher::matches($types, 'ai_supervisor.attention_call')
            : EventTypeMatcher::matches($types, 'ai_supervisor.attention_call')
                || EventTypeMatcher::matches($types, 'core.voicemail');
        if (!$allowed) {
            throw new ValidationException('attachments_not_supported', 'options');
        }
    }

    /** Applies the hub-key path set at once (the CDR grant follows rules); never fails the request. */
    private function syncApiKey(): void
    {
        (new ApiKeyReconciler(
            $this->apiKeySync,
            new SourceStateRepository($this->db()),
            $this->repo(),
            $this->probe
        ))->apply();
    }

    /** @param mixed $value @return list<string> */
    private function eventTypesValue($value): array
    {
        if (!is_array($value)) {
            throw new ValidationException('invalid_event_types', 'event_types');
        }
        $known = SourceCatalog::knownEventTypes();
        $types = [];
        foreach ($value as $type) {
            if (!is_string($type)) {
                throw new ValidationException('invalid_event_types', 'event_types');
            }
            if (str_ends_with($type, '.*')) {
                if (preg_match('/^[a-z0-9_]+\.\*$/', $type) !== 1) {
                    throw new ValidationException('invalid_event_types', 'event_types');
                }
                $types[$type] = true;

                continue;
            }
            if (!in_array($type, $known, true)) {
                throw new ValidationException('unknown_event_type', 'event_types');
            }
            $types[$type] = true;
        }

        return array_keys($types);
    }

    /** @param mixed $value @return array<string, mixed> */
    private function filtersValue($value): array
    {
        if (!is_array($value)) {
            throw new ValidationException('invalid_filters', 'filters');
        }
        $filters = [];
        foreach ($value as $key => $item) {
            if (!in_array($key, self::FILTER_KEYS, true)) {
                throw new ValidationException('unknown_filter', 'filters');
            }
            switch ($key) {
                case 'user_ids':
                    if (!is_array($item)) {
                        throw new ValidationException('invalid_filter', 'filters');
                    }
                    $ids = [];
                    foreach ($item as $id) {
                        if (!is_int($id) && !(is_string($id) && ctype_digit($id))) {
                            throw new ValidationException('invalid_filter', 'filters');
                        }
                        $ids[] = (int)$id;
                    }
                    $filters['user_ids'] = array_values(array_unique($ids));
                    break;
                case 'directions':
                    if (!is_array($item)) {
                        throw new ValidationException('invalid_filter', 'filters');
                    }
                    $directions = [];
                    foreach ($item as $direction) {
                        if (!is_string($direction) || !in_array($direction, self::DIRECTIONS, true)) {
                            throw new ValidationException('invalid_filter', 'filters');
                        }
                        $directions[$direction] = true;
                    }
                    $filters['directions'] = array_keys($directions);
                    break;
                case 'providers':
                    if (!is_array($item)) {
                        throw new ValidationException('invalid_filter', 'filters');
                    }
                    $providers = [];
                    foreach ($item as $provider) {
                        if (!is_string($provider) || trim($provider) === '') {
                            throw new ValidationException('invalid_filter', 'filters');
                        }
                        $providers[trim($provider)] = true;
                    }
                    $filters['providers'] = array_keys($providers);
                    break;
                case 'reasons':
                    // Cloud AI pause reasons; an empty list would silence the rule, so it is refused
                    if (!is_array($item) || $item === []) {
                        throw new ValidationException('invalid_filter', 'filters');
                    }
                    $reasons = [];
                    foreach ($item as $reason) {
                        if (!is_string($reason) || !CloudAiPauseReasons::isKnown($reason)) {
                            throw new ValidationException('invalid_filter', 'filters');
                        }
                        $reasons[$reason] = true;
                    }
                    $filters['reasons'] = array_keys($reasons);
                    break;
                case 'quality_score':
                    if (!is_array($item)) {
                        throw new ValidationException('invalid_filter', 'filters');
                    }
                    $range = [];
                    foreach (['min', 'max'] as $bound) {
                        if (!array_key_exists($bound, $item)) {
                            continue;
                        }
                        if (!is_numeric($item[$bound]) || (float)$item[$bound] < 0 || (float)$item[$bound] > 100) {
                            throw new ValidationException('invalid_filter', 'filters');
                        }
                        $range[$bound] = (int)$item[$bound];
                    }
                    if ($range === []) {
                        throw new ValidationException('invalid_filter', 'filters');
                    }
                    if (isset($range['min'], $range['max']) && $range['min'] > $range['max']) {
                        throw new ValidationException('invalid_filter', 'filters');
                    }
                    $filters['quality_score'] = $range;
                    break;
            }
        }

        return $filters;
    }

    /** @param mixed $value @return array<string, mixed> */
    private function optionsValue($value): array
    {
        if (!is_array($value)) {
            throw new ValidationException('invalid_options', 'options');
        }
        $options = [];
        foreach ($value as $key => $item) {
            if (!in_array($key, self::OPTION_KEYS, true)) {
                throw new ValidationException('unknown_option', 'options');
            }
            switch ($key) {
                case 'mask_phone':
                    if ($item === null) {
                        $options['mask_phone'] = null;
                    } else {
                        $options['mask_phone'] = self::boolValue($item, 'options');
                    }
                    break;
                case 'attachments':
                    // enum only; the stage-2 boolean is no longer accepted (it never meant a mode)
                    if (!is_string($item) || !in_array($item, self::ATTACHMENT_MODES, true)) {
                        throw new ValidationException('invalid_attachments_mode', 'options');
                    }
                    $options['attachments'] = $item;
                    break;
                case 'retract_on_callback':
                    if (!is_array($item)) {
                        throw new ValidationException('invalid_options', 'options');
                    }
                    $config = [];
                    if (array_key_exists('enabled', $item)) {
                        $config['enabled'] = self::boolValue($item['enabled'], 'options');
                    }
                    if (array_key_exists('window_min', $item)) {
                        $window = $item['window_min'];
                        if (!is_int($window) && !(is_string($window) && ctype_digit($window))) {
                            throw new ValidationException('invalid_options', 'options');
                        }
                        $window = (int)$window;
                        if ($window < 5 || $window > 120) {
                            throw new ValidationException('invalid_options', 'options');
                        }
                        $config['window_min'] = $window;
                    }
                    if (array_key_exists('count_incoming_answered', $item)) {
                        $config['count_incoming_answered'] = self::boolValue($item['count_incoming_answered'], 'options');
                    }
                    $options['retract_on_callback'] = $config;
                    break;
            }
        }

        return $options;
    }

    /** @param mixed $value @return list<int> */
    private function chatIdsValue($value): array
    {
        if (!is_array($value)) {
            throw new ValidationException('invalid_chat_ids', 'chat_ids');
        }
        $ids = [];
        foreach ($value as $id) {
            if (!is_int($id) && !(is_string($id) && ctype_digit($id))) {
                throw new ValidationException('invalid_chat_ids', 'chat_ids');
            }
            $ids[] = (int)$id;
        }
        $ids = array_values(array_unique($ids));
        if ($ids === []) {
            return [];
        }
        if (count($this->repo()->chatsByIds($ids)) !== count($ids)) {
            throw new ValidationException('unknown_chat', 'chat_ids');
        }

        return $ids;
    }

    /** @param array<string, mixed> $data */
    private function ruleId(array $data): int
    {
        $id = (int)($data['id'] ?? 0);
        if ($id <= 0) {
            throw new ValidationException('invalid_rule_id', 'id');
        }

        return $id;
    }

    /** @return array<string, mixed> */
    private function requireRule(int $id): array
    {
        $row = $this->db()->fetchOne('SELECT * FROM ' . RuleRepository::TABLE . ' WHERE id = :id', ['id' => $id]);
        if ($row === null) {
            throw new NotFoundException('rule_not_found');
        }

        return $row;
    }

    /** @param mixed $value */
    private static function boolValue($value, string $field): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if ($value === 1 || $value === 0 || $value === '1' || $value === '0') {
            return (bool)$value;
        }
        throw new ValidationException('invalid_boolean', $field);
    }

    /** @return list<mixed> */
    private static function decodeList(mixed $json): array
    {
        $decoded = json_decode(is_string($json) ? $json : '', true);

        return is_array($decoded) ? array_values($decoded) : [];
    }

    /** @return array<string, mixed> */
    private static function decodeObject(mixed $json): array
    {
        $decoded = json_decode(is_string($json) ? $json : '', true);

        return is_array($decoded) ? $decoded : [];
    }

    private function repo(): RuleRepository
    {
        return new RuleRepository($this->db());
    }

    private function db(): HubDatabase
    {
        return $this->db ?? new PhalconHubDatabase();
    }
}
