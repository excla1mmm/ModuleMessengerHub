<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Events;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModuleMessengerHub\Lib\Delivery\BeanstalkDeliveryWaker;
use Modules\ModuleMessengerHub\Lib\Delivery\DeliveryWaker;
use Modules\ModuleMessengerHub\Lib\Delivery\OutboxRepository;
use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\NotFoundException;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\Responder;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\UnknownActionException;
use Modules\ModuleMessengerHub\Lib\RestAPI\Common\ValidationException;
use Modules\ModuleMessengerHub\Lib\Storage\PhalconHubDatabase;

/**
 * GET /module-messenger-hub/events — paged history with filters, and /events/{id} with the full payload.
 *
 * Core calls the static callBack(); unit checks instantiate the processor with an EventStore over the
 * test database (Tests/support/bootstrap.php), so the logic itself stays Core-free.
 */
final class Processor
{
    /** @var list<string> */
    private const array SEVERITIES = [
        HubEvent::SEVERITY_INFO,
        HubEvent::SEVERITY_WARNING,
        HubEvent::SEVERITY_CRITICAL,
    ];

    public function __construct(
        private readonly ?EventStore $events = null,
        private readonly ?OutboxRepository $outbox = null,
        private readonly ?DeliveryWaker $waker = null,
    ) {
    }

    /** Entry point used by Core (WorkerApiCommands). */
    public static function callBack(array $request): PBXApiResult
    {
        return (new self())->process($request);
    }

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
                case 'retry':
                    return [$this->retry($data)];
                default:
                    throw new UnknownActionException($action);
            }
        });
    }

    /** @param array<string, mixed> $data */
    private function list(array $data): array
    {
        $filters = $this->filters($data);
        [$limit, $offset] = Responder::page($data);
        $page = $this->store()->page($filters, $limit, $offset);
        $page['items'] = $this->withDeliveries($page['items']);

        return [
            'items' => $page['items'],
            'pagination' => [
                'limit' => $limit,
                'offset' => $offset,
                'total' => $page['total'],
                'has_more' => $offset + count($page['items']) < $page['total'],
            ],
        ];
    }

    /** @param array<string, mixed> $data */
    private function record(array $data): array
    {
        $record = $this->store()->getRecord($this->eventId($data));
        if ($record === null) {
            throw new NotFoundException('event_not_found');
        }
        $record['deliveries'] = $this->deliveriesOf($record);

        return $record;
    }

    /**
     * Plan/06: POST /events/{id}:retry restarts every failed delivery of the event; anything already
     * sent, queued or dropped is left alone. The delivery worker is woken at once.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function retry(array $data): array
    {
        $id = $this->eventId($data);
        $record = $this->store()->getRecord($id);
        if ($record === null) {
            throw new NotFoundException('event_not_found');
        }
        $retried = $this->outbox()->retryFailedForEvent($id, time());
        if ($retried > 0) {
            $this->waker()->wake();
        }
        $record['deliveries'] = $this->deliveriesOf($record);

        return ['retried' => $retried] + $record;
    }

    /**
     * @param list<array<string, mixed>> $items
     * @return list<array<string, mixed>>
     */
    private function withDeliveries(array $items): array
    {
        $ids = [];
        foreach ($items as $item) {
            $ids[] = (int)($item['id'] ?? 0);
        }
        $map = $this->outbox()->deliveriesForEvents($ids);
        foreach ($items as $index => $item) {
            $items[$index]['deliveries'] = $map[(int)($item['id'] ?? 0)] ?? [];
        }

        return $items;
    }

    /**
     * @param array<string, mixed> $record
     * @return list<array<string, mixed>>
     */
    private function deliveriesOf(array $record): array
    {
        $map = $this->outbox()->deliveriesForEvents([(int)($record['id'] ?? 0)]);

        return $map[(int)($record['id'] ?? 0)] ?? [];
    }

    /**
     * @param array<string, mixed> $data
     * @return array{event_type: string, source_id: string, severity: string, from: int, to: int}
     */
    private function filters(array $data): array
    {
        $filters = [
            'event_type' => self::stringFilter($data, 'event_type'),
            'source_id' => self::stringFilter($data, 'source_id'),
            'severity' => '',
            'from' => self::timeFilter($data, 'date_from'),
            'to' => self::timeFilter($data, 'date_to'),
        ];
        $severity = self::stringFilter($data, 'severity');
        if ($severity !== '') {
            if (!in_array($severity, self::SEVERITIES, true)) {
                throw new ValidationException('unknown_severity', 'severity');
            }
            $filters['severity'] = $severity;
        }

        return $filters;
    }

    /** @param array<string, mixed> $data */
    private static function eventId(array $data): int
    {
        $id = (int)($data['id'] ?? 0);
        if ($id <= 0) {
            throw new ValidationException('invalid_event_id', 'id');
        }

        return $id;
    }

    /** @param array<string, mixed> $data */
    private static function stringFilter(array $data, string $key): string
    {
        $value = $data[$key] ?? '';
        if (is_array($value)) {
            throw new ValidationException('invalid_filter', $key);
        }

        return trim((string)$value);
    }

    /** @param array<string, mixed> $data */
    private static function timeFilter(array $data, string $key): int
    {
        $value = $data[$key] ?? null;
        if ($value === null || (is_string($value) && trim($value) === '')) {
            return 0;
        }
        if (!is_numeric($value)) {
            throw new ValidationException('invalid_filter', $key);
        }

        return (int)$value;
    }

    private function store(): EventStore
    {
        return $this->events ?? new EventStore(new PhalconHubDatabase());
    }

    private function outbox(): OutboxRepository
    {
        return $this->outbox ?? new OutboxRepository(new PhalconHubDatabase());
    }

    private function waker(): DeliveryWaker
    {
        return $this->waker ?? new BeanstalkDeliveryWaker();
    }
}
