<?php

declare(strict_types=1);

// core.advice: a PBX restart (empty / shrunken advice list) must not re-alert known warnings
// (found on the test station 2026-11-18; fix 33f8f47).

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Sources\Core\AdviceSource;

$warnA = ['messageTpl' => 'adv_SipTransportTlsDeprecated', 'messageParams' => ['number' => '217']];
$warnB = ['messageTpl' => 'adv_AvailableNewVersionPBX', 'messageParams' => ['ver' => '2026.8.2']];
$errC = ['messageTpl' => 'adv_SipPasswordWeak', 'messageParams' => ['record' => '203']];
$infoD = ['messageTpl' => 'adv_AvailableNewVersionModule', 'messageParams' => ['module' => 'X']];

$day = static fn (string $date): int => (int)strtotime($date . ' 12:00:00');
$poll = static function (array $advice, array $cursor, string $date) use ($day): array {
    $batch = AdviceSource::buildBatch($advice, $cursor, $day($date));

    return [count($batch->events), $batch->cursor];
};

$full = ['warning' => [$warnA, $warnB], 'info' => [$infoD]];

// baseline
[$events, $cursor] = $poll($full, [], '2026-11-18');
check($events === 0, 'baseline: no events');

// PBX restart: empty list, then the same warnings come back the same day
[$events, $afterEmpty] = $poll([], $cursor, '2026-11-18');
check($events === 0, 'empty list: no events');
check($afterEmpty === $cursor, 'empty list: cursor unchanged');
[$events, $cursor] = $poll($full, $afterEmpty, '2026-11-18');
check($events === 0, 'restart: known warnings coming back do not re-alert');

// shrunken list (only B visible), A absent for 3 days, then back -> silent
[$events, $cursor] = $poll(['warning' => [$warnB]], $cursor, '2026-11-19');
check($events === 0, 'shrunken list: no events');
[$events, $cursor] = $poll(['warning' => [$warnB]], $cursor, '2026-11-21');
[$events, $cursor] = $poll($full, $cursor, '2026-11-22');
check($events === 0, 'A absent 3 days and back: silent');

// A absent 8 days, then back -> one new event
[$events, $cursor] = $poll(['warning' => [$warnB]], $cursor, '2026-11-23');
[$events, $cursor] = $poll(['warning' => [$warnB]], $cursor, '2026-11-30');
[$events, $cursor] = $poll($full, $cursor, '2026-12-01');
check($events === 1, 'A absent 8 days and back: exactly one event (got ' . $events . ')');
[$events, $cursor] = $poll($full, $cursor, '2026-12-01');
check($events === 0, 'repeat poll after re-alert: no duplicate');

// a genuinely new error while A is absent -> exactly one event
[$events, $cursor] = $poll(['warning' => [$warnB], 'error' => [$errC]], $cursor, '2026-12-02');
check($events === 1, 'new error while another warning is absent: exactly one event');

// info items never alert
[$events, $cursor] = $poll(['warning' => [$warnB], 'error' => [$errC], 'info' => [$infoD, ['messageTpl' => 'adv_New', 'messageParams' => []]]], $cursor, '2026-12-02');
check($events === 0, 'info items never alert');

// migration: the stage-1 cursor format {"seen": {"tpl:hash": "Y-m-d"}} must not broadcast history
$oldCursor = ['seen' => []];
$baseline = AdviceSource::buildBatch($full, [], $day('2026-11-18'))->cursor;
foreach (array_keys($baseline['seen']) as $fingerprint) {
    $oldCursor['seen'][$fingerprint] = '2026-11-18';
}
[$events] = $poll($full, $oldCursor, '2026-11-20');
check($events === 0, 'old cursor format: no history broadcast');
[$events] = $poll([], $oldCursor, '2026-11-20');
check($events === 0, 'old cursor format + empty list: no events');

finish('advice retention OK');
