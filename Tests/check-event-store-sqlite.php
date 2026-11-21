<?php

declare(strict_types=1);

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Events\EventStore;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;

$db = hubTestDatabase();
$store = new EventStore($db);

$event = new HubEvent('core.missed_call', 'core.missed_call', HubEvent::SEVERITY_INFO, 'missed:mikopbx-1.1', 1700000000, [
    'subject' => ['client_number' => '79001234567'],
]);

check($store->record($event, 1700000001) === true, 'first record must be new');
check($store->record($event, 1700000002) === false, 'same dedupe_key must be ignored');
$other = new HubEvent('core.missed_call', 'core.missed_call', HubEvent::SEVERITY_INFO, 'missed:mikopbx-1.2', 1700000100);
check($store->record($other, 1700000101) === true, 'different dedupe_key must be stored');

$page = $store->page([], 50, 0);
check($page['total'] === 2, 'total must count both events');
check(!array_key_exists('dedupe_key', $page['items'][0]), 'dedupe_key is internal and not part of the page items');
check($page['items'][0]['occurred_at'] === 1700000100, 'newest first');
check(($page['items'][1]['payload']['subject']['client_number'] ?? '') === '79001234567', 'payload decoded');

$filtered = $store->page(['from' => 1700000050], 50, 0);
check($filtered['total'] === 1, 'from filter');

check($store->purgeOlderThan(1700000050, 1) === 1, 'purge removes only older rows');
check($store->page([], 50, 0)['total'] === 1, 'one row left after purge');

$store->record(new HubEvent('core.provider_status', 'core.provider_down', HubEvent::SEVERITY_CRITICAL, 'provider:1:down:1', 1700000200), 1700000200);
$store->record(new HubEvent('core.missed_call', 'core.missed_call', HubEvent::SEVERITY_WARNING, 'missed:3', 1700000300), 1700000300);
check($store->page(['severity' => HubEvent::SEVERITY_WARNING], 50, 0)['total'] === 1, 'severity filter');
check($store->page(['severity' => HubEvent::SEVERITY_CRITICAL], 50, 0)['total'] === 1, 'severity filter selects the other row');
check($store->page(['severity' => ''], 50, 0)['total'] === 3, 'empty severity means no filter');
check($store->page(['from' => 0, 'to' => 0], 50, 0)['total'] === 3, 'zero period bounds mean no filter');

$record = $store->getRecord((int)($store->page([], 1, 0)['items'][0]['id']));
check($record !== null && $record['event_type'] === 'core.missed_call', 'getRecord returns the newest row');
check(isset($record['payload']) && is_array($record['payload']), 'getRecord decodes the payload');
check(!array_key_exists('dedupe_key', $record), 'getRecord exposes no dedupe_key');
check($store->getRecord(999999) === null, 'getRecord of a missing id is null');

foreach ([
    ['src', 'bad type', HubEvent::SEVERITY_INFO, 'k', 1],
    ['', 'core.x', HubEvent::SEVERITY_INFO, 'k', 1],
    ['src', 'core.x', 'loud', 'k', 1],
    ['src', 'core.x', HubEvent::SEVERITY_INFO, '', 1],
    ['src', 'core.x', HubEvent::SEVERITY_INFO, 'k', 0],
] as [$source, $type, $severity, $key, $at]) {
    $thrown = false;
    try {
        new HubEvent($source, $type, $severity, $key, $at);
    } catch (InvalidArgumentException) {
        $thrown = true;
    }
    check($thrown, 'invalid HubEvent must be rejected: ' . json_encode([$source, $type, $severity, $key, $at]));
}

finish('event store OK');
