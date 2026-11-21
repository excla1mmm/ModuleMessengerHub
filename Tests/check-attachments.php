<?php

declare(strict_types=1);

// Stage 3a-1 backend: attachment decisions (Plan/03, Plan/05), path allow-list, converter argument
// arrays and timeouts, per-event cache, per-part delivery progress (the text is never sent twice),
// MAX attachment.not.ready with the same upload token, fallback notes, and retraction ids.

require __DIR__ . '/support/bootstrap.php';

use Modules\ModuleMessengerHub\Lib\Api\RestReader;
use Modules\ModuleMessengerHub\Lib\Attachments\AttachmentMode;
use Modules\ModuleMessengerHub\Lib\Attachments\AttachmentPlan;
use Modules\ModuleMessengerHub\Lib\Attachments\AttachmentPlanner;
use Modules\ModuleMessengerHub\Lib\Attachments\AttachmentService;
use Modules\ModuleMessengerHub\Lib\Attachments\Converter;
use Modules\ModuleMessengerHub\Lib\Attachments\PathGuard;
use Modules\ModuleMessengerHub\Lib\Attachments\PreparedRecordingsRepository;
use Modules\ModuleMessengerHub\Lib\Attachments\ProcessResult;
use Modules\ModuleMessengerHub\Lib\Attachments\ProcessRunner;
use Modules\ModuleMessengerHub\Lib\Attachments\RecordingLocator;
use Modules\ModuleMessengerHub\Lib\Attachments\RecordingRoots;
use Modules\ModuleMessengerHub\Lib\Attachments\RestFileDownloader;
use Modules\ModuleMessengerHub\Lib\Attachments\TempDir;
use Modules\ModuleMessengerHub\Lib\Attachments\ToolFinder;
use Modules\ModuleMessengerHub\Lib\Channels\AttachmentPart;
use Modules\ModuleMessengerHub\Lib\Channels\AttachmentResult;
use Modules\ModuleMessengerHub\Lib\Channels\BotCredentials;
use Modules\ModuleMessengerHub\Lib\Channels\BotIdentity;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelInterface;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelLimits;
use Modules\ModuleMessengerHub\Lib\Channels\ChannelRegistry;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryBatch;
use Modules\ModuleMessengerHub\Lib\Channels\DiscoveryCursor;
use Modules\ModuleMessengerHub\Lib\Channels\Recipient;
use Modules\ModuleMessengerHub\Lib\Channels\SendResult;
use Modules\ModuleMessengerHub\Lib\Delivery\DeliveryService;
use Modules\ModuleMessengerHub\Lib\Delivery\OutboxRepository;
use Modules\ModuleMessengerHub\Lib\Delivery\RateLimiter;
use Modules\ModuleMessengerHub\Lib\Delivery\RetractionService;
use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\LinkBuilder;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\Rule;
use Modules\ModuleMessengerHub\Lib\Sources\SourceException;
use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

// ---------- helpers ----------

final class StaticRoots implements RecordingRoots
{
    public function __construct(private readonly string $monitor, private readonly string $probe)
    {
    }

    public function monitorRoots(): array
    {
        return [$this->monitor];
    }

    public function probeRoot(): string
    {
        return $this->probe;
    }
}

final class FakeRunner implements ProcessRunner
{
    /** @var list<list<string>> */
    public array $commands = [];

    /** @var list<ProcessResult> */
    private array $queue = [];

    public function queue(ProcessResult $result): void
    {
        $this->queue[] = $result;
    }

    public function run(array $command, int $timeoutSec): ProcessResult
    {
        $this->commands[] = $command;
        if ($this->queue !== []) {
            return array_shift($this->queue);
        }
        $last = end($command);
        if (in_array('-show_entries', $command, true) || in_array('-D', $command, true)) {
            return new ProcessResult(0, false, '', '3.500');
        }
        if (is_string($last) && str_ends_with($last, '.mp3')) {
            file_put_contents($last, 'ID3' . str_repeat("\0", 96));

            return new ProcessResult(0, false);
        }
        if (is_string($last) && str_ends_with($last, '.wav')) {
            file_put_contents($last, 'RIFF....WAVE' . str_repeat("\0", 64));

            return new ProcessResult(0, false);
        }

        return new ProcessResult(0, false);
    }
}

final class MapRest implements RestReader
{
    /** @var array<string, array<mixed>|SourceException> */
    public array $routes = [];

    public function get(string $path, array $query = []): array
    {
        $route = $this->routes[$path] ?? null;
        if ($route instanceof SourceException) {
            throw $route;
        }
        if (is_array($route)) {
            return $route;
        }
        throw new SourceException('api_not_found');
    }
}

final class MapDownloader implements RestFileDownloader
{
    public string $error = '';

    public string $content = 'fake-audio';

    public int $calls = 0;

    public array $urls = [];

    public function download(string $pathAndQuery, string $destination, int $maxBytes): string
    {
        $this->calls++;
        $this->urls[] = $pathAndQuery;
        if ($this->error !== '') {
            return $this->error;
        }
        file_put_contents($destination, $this->content);

        return '';
    }
}

final class AttachChannel implements ChannelInterface
{
    /** @var list<RenderedMessage> */
    public array $messages = [];

    /** @var list<AttachmentPart> */
    public array $attachments = [];

    /** @var list<SendResult> */
    public array $sendResults = [];

    /** @var list<AttachmentResult> */
    public array $attachmentResults = [];

    /** @var list<SendResult> */
    public array $deleteResults = [];

    /** @var list<string> */
    public array $deleted = [];

    public function __construct(private readonly ChannelLimits $limits)
    {
    }

    public function id(): string
    {
        return 'telegram';
    }

    public function checkToken(BotCredentials $bot): BotIdentity
    {
        return BotIdentity::ok('bot', '1');
    }

    public function discoverChats(BotCredentials $bot, DiscoveryCursor $cursor): DiscoveryBatch
    {
        return new DiscoveryBatch();
    }

    public function send(BotCredentials $bot, Recipient $to, RenderedMessage $message): SendResult
    {
        $this->messages[] = $message;

        return array_shift($this->sendResults) ?? SendResult::sent(['text-' . count($this->messages)]);
    }

    public function sendAttachment(BotCredentials $bot, Recipient $to, AttachmentPart $part): AttachmentResult
    {
        $this->attachments[] = $part;

        return array_shift($this->attachmentResults) ?? AttachmentResult::of(SendResult::sent(['audio-' . count($this->attachments)]));
    }

    public function delete(BotCredentials $bot, Recipient $to, string $externalMessageId): SendResult
    {
        $result = array_shift($this->deleteResults) ?? SendResult::sent();
        if ($result->outcome === SendResult::SENT) {
            $this->deleted[] = $externalMessageId;
        }

        return $result;
    }

    public function limits(): ChannelLimits
    {
        return $this->limits;
    }
}

function rmrf(string $path): void
{
    if (!file_exists($path)) {
        return;
    }
    if (is_file($path) || is_link($path)) {
        @unlink($path);

        return;
    }
    foreach (glob($path . '/*') ?: [] as $child) {
        rmrf($child);
    }
    @rmdir($path);
}

function fakeToolDir(string $base): string
{
    $dir = $base . '/tools';
    @mkdir($dir, 0700, true);
    foreach (['ffmpeg', 'ffprobe', 'sox', 'lame', 'soxi', 'nice'] as $name) {
        $path = $dir . '/' . $name;
        file_put_contents($path, "#!/bin/sh\nexit 0\n");
        chmod($path, 0755);
    }

    return $dir;
}

function tools(string $dir): ToolFinder
{
    return new ToolFinder(array_combine(
        ['ffmpeg', 'ffprobe', 'sox', 'lame', 'soxi', 'nice'],
        array_map(static fn (string $name): string => $dir . '/' . $name, ['ffmpeg', 'ffprobe', 'sox', 'lame', 'soxi', 'nice'])
    ));
}

function rule(string $mode): Rule
{
    return Rule::fromRow([
        'id' => 1,
        'title' => 'r',
        'enabled' => '1',
        'event_types' => '["core.voicemail","ai_supervisor.attention_call","core.missed_call"]',
        'min_severity' => 'info',
        'filters_json' => '{}',
        'target_mode' => 'recipients',
        'chat_ids_json' => '[]',
        'template_key' => '',
        'options_json' => json_encode(['attachments' => $mode], JSON_THROW_ON_ERROR),
        'sort' => 10,
    ]);
}

/** @param array<string, mixed> $payload */
function event(string $type, array $payload, int $at = 1792000000): HubEvent
{
    return new HubEvent($type, $type, 'warning', 'k' . uniqid('', true), $at, $payload);
}

function attentionPayload(array $quotes, string $path = '', ?array $recording = null, bool $probe = false): array
{
    $attachments = [];
    if ($path !== '') {
        $attachments[] = ['kind' => 'recording', 'path' => $path];
    } elseif ($recording !== null) {
        $attachments[] = $recording;
    }

    return [
        'subject' => [
            'call' => ['linkedid' => 'mikopbx-1792000000.1', 'direction' => 'incoming', 'started_at' => 1792000000, 'duration_sec' => 300],
            'client_number' => '79000000000',
            'employees' => [],
            'provider' => null,
            'attention' => ['ref_id' => 77],
        ],
        'facts' => ['quotes' => $quotes, 'scores' => [], 'reasons' => []],
        'links' => [],
        'attachments' => $attachments,
        'probe' => $probe,
    ];
}

function seedAttachDelivery(
    HubDatabase $db,
    int $eventId,
    ?string $attachmentJson,
    int $chatSuffix = 1,
    ?string $partsJson = null,
    int $now = 1792000000,
): int {
    $db->execute(
        'INSERT OR IGNORE INTO m_MessengerHubBots (id, channel, title, token, token_hint, bot_username, bot_external_id,'
        . " enabled, status, status_checked_at, last_error_code, created_at, updated_at)"
        . " VALUES (1, 'telegram', 'Bot', '123:secret', 'cret', 'bot', '1', '1', 'ok', 1, '', 1, 1)"
    );
    $db->execute(
        'INSERT OR IGNORE INTO m_MessengerHubBotChats (id, bot_id, chat_id, chat_kind, title, linked_user_id,'
        . " enabled, state, gone_reason, discovered_at)"
        . " VALUES (:id, 1, :chat, 'group', 'Группа', 0, '1', 'active', '', 1)",
        ['id' => $chatSuffix, 'chat' => '-100' . $chatSuffix]
    );
    $rendered = json_encode(
        (new RenderedMessage(title: 'Пропущенный', lines: ['строка'], footer: 'call-1'))->toArray(),
        JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
    );
    $db->execute(
        'INSERT INTO m_MessengerHubOutbox (event_id, chat_id, bot_id, rule_id, status, attempts, uncertain_attempts,'
        . ' next_attempt_at, lease_owner, lease_until, rendered_json, attachment_json, delivery_parts_json,'
        . ' external_message_ids, last_error_code, last_error_at, created_at, updated_at, sent_at)'
        . ' VALUES (:event, :chat, 1, 1, :status, :attempts, 0, 0, :owner, :until, :rendered, :attachment, :parts,'
        . " '[]', '', NULL, :now, :now, NULL)",
        [
            'event' => $eventId,
            'chat' => $chatSuffix,
            'status' => $partsJson === null ? 'pending' : 'sending',
            'attempts' => 0,
            'owner' => $partsJson === null ? '' : 'dead',
            'until' => $partsJson === null ? null : $now - 10,
            'rendered' => $rendered,
            'attachment' => $attachmentJson,
            'parts' => $partsJson,
            'now' => $now,
        ]
    );

    return $db->lastInsertId();
}

function newEventId(HubDatabase $db, int $now = 1792000000): int
{
    $db->execute(
        'INSERT INTO m_MessengerHubEvents (source_id, event_type, severity, dedupe_key, occurred_at, payload_json,'
        . " routed_at, created_at) VALUES ('core.voicemail', 'core.voicemail', 'warning', :key, :at, '{}', 1, :at)",
        ['key' => 'e' . uniqid('', true), 'at' => $now]
    );

    return $db->lastInsertId();
}

function deliver(HubDatabase $db, AttachChannel $channel, AttachmentService $pipeline, int $now): array
{
    $service = new DeliveryService(
        new OutboxRepository($db),
        new ChannelRegistry([$channel]),
        new RateLimiter(),
        'test',
        120,
        20,
        $pipeline
    );

    return $service->runOnce($now);
}

function outbox(HubDatabase $db, int $id): array
{
    return (array)$db->fetchOne('SELECT * FROM ' . OutboxRepository::TABLE . ' WHERE id = :id', ['id' => $id]);
}

function pipelineFor(
    HubDatabase $db,
    string $base,
    FakeRunner $runner,
    MapRest $rest,
    MapDownloader $downloader,
    int $score = 0,
): AttachmentService {
    $tools = tools(fakeToolDir($base . '/t' . $score));
    $temp = new TempDir($base . '/module');
    $paths = new PathGuard(new StaticRoots($base . '/monitor', $base . '/probe'));

    return new AttachmentService(
        new Converter($runner, $tools),
        new RecordingLocator($rest, $downloader, $paths),
        $paths,
        new PreparedRecordingsRepository($db),
        $temp,
        $db
    );
}

// ---------- 1. rule option ----------

check(AttachmentMode::fromOptions([]) === AttachmentMode::NONE, 'attachments: absent -> none');
check(AttachmentMode::fromOptions(['attachments' => true]) === AttachmentMode::NONE, 'attachments: legacy true -> none (no silent recordings)');
check(AttachmentMode::fromOptions(['attachments' => 'fragments']) === AttachmentMode::FRAGMENTS, 'attachments: fragments');
check(AttachmentMode::fromOptions(['attachments' => 'recording']) === AttachmentMode::RECORDING, 'attachments: recording');
check(AttachmentMode::fromOptions(['attachments' => 'bogus']) === AttachmentMode::NONE, 'attachments: unknown -> none');

// ---------- 2. planner: which event gets what ----------

$base = sys_get_temp_dir() . '/mh-attach-' . bin2hex(random_bytes(4));
@mkdir($base . '/module/tmp', 0700, true);
@mkdir($base . '/monitor', 0755, true);
@mkdir($base . '/probe', 0700, true);
file_put_contents($base . '/monitor/rec.webm', str_repeat('x', 128));
file_put_contents($base . '/probe/tone.mp3', str_repeat('y', 128));

$texts = hubTestTexts();
$plannerWithLink = new AttachmentPlanner($texts, new LinkBuilder('https://pbx.example'));
$plannerNoLink = new AttachmentPlanner($texts, new LinkBuilder(''));
$message = new RenderedMessage(title: '🎙 Голосовая почта');

$plan = $plannerWithLink->plan(
    event('core.voicemail', ['subject' => ['call' => ['linkedid' => 'v1']], 'attachments' => [['kind' => 'recording', 'path' => $base . '/monitor/rec.webm']]]),
    rule('recording'),
    $message
);
check($plan !== null && $plan->available(), 'voicemail: recording plan');
check($plan !== null && $plan->source['type'] === 'path', 'voicemail: source is the AMI path');
check($plan !== null && $plan->fragments === [], 'voicemail: the whole file');
check($plan !== null && $plan->fallbackLine !== '', 'voicemail: fallback line present');
check($plan !== null && $plan->captionBase !== '', 'voicemail: caption base has title and time');

$plan = $plannerWithLink->plan(
    event('core.voicemail', ['attachments' => [['kind' => 'recording', 'path' => $base . '/monitor/rec.webm']]]),
    rule('fragments'),
    $message
);
check($plan !== null && $plan->fragments === [], 'voicemail: fragments = the whole file (it is the message)');

$quotes = [
    ['quote' => 'a', 'start_ms' => 42000, 'end_ms' => 47500],
    ['quote' => 'b', 'start_ms' => 61000, 'end_ms' => 65800],
    ['quote' => 'c', 'start_ms' => 158000, 'end_ms' => 162500],
];
$plan = $plannerWithLink->plan(
    event('ai_supervisor.attention_call', attentionPayload($quotes, '', ['kind' => 'recording', 'source' => 'cdr', 'linkedid' => 'mikopbx-1792000000.1', 'cdr_id' => 501])),
    rule('fragments'),
    $message
);
check($plan !== null && $plan->mode === AttachmentMode::FRAGMENTS, 'attention: fragments mode');
check($plan !== null && $plan->source['type'] === 'cdr' && $plan->source['cdr_id'] === 501, 'attention: CDR source with cdr_id');
check($plan !== null && $plan->fragments === [
    ['start_ms' => 37000, 'end_ms' => 52500],
    ['start_ms' => 56000, 'end_ms' => 70800],
    ['start_ms' => 153000, 'end_ms' => 167500],
], 'attention: ±5 s padding, three fragments');

$overlap = [
    ['start_ms' => 42000, 'end_ms' => 47500],
    ['start_ms' => 46000, 'end_ms' => 50000],
];
check(
    AttachmentPlanner::fragments(['quotes' => $overlap], 300) === [['start_ms' => 37000, 'end_ms' => 55000]],
    'attention: overlapping fragments merge'
);

$plan = $plannerWithLink->plan(
    event('ai_supervisor.attention_call', attentionPayload([])),
    rule('fragments'),
    $message
);
check($plan !== null && !$plan->available() && $plan->unavailableCode === AttachmentPlanner::CODE_QUOTES_MISSING, 'attention: fragments without quotes -> unavailable line, not the whole call');

$plan = $plannerWithLink->plan(
    event('ai_supervisor.attention_call', attentionPayload($quotes, '', ['kind' => 'recording', 'source' => 'cdr', 'linkedid' => 'mikopbx-1792000000.1'])),
    rule('recording'),
    $message
);
check($plan !== null && $plan->fragments === [], 'attention: recording mode = the whole conversation');

check($plannerWithLink->plan(event('core.missed_call', ['attachments' => [['kind' => 'recording', 'path' => $base . '/monitor/rec.webm']]]), rule('recording'), $message) === null, 'missed call: never an attachment');
check($plannerWithLink->plan(event('core.voicemail', ['attachments' => [['kind' => 'recording', 'path' => $base . '/monitor/rec.webm']]]), rule('none'), $message) === null, 'attachments none: no plan');
check($plannerNoLink->plan(event('core.voicemail', ['attachments' => [['kind' => 'recording', 'path' => $base . '/monitor/rec.webm']]]), rule('recording'), $message)?->fallbackLine === $texts->t('module_messenger_hub_MessageVoicemailHint'), 'no public URL: the journal hint is the fallback line');
$probePlan = $plannerWithLink->plan(
    event('core.voicemail', ['attachments' => [['kind' => 'recording', 'path' => $base . '/probe/tone.mp3']], 'probe' => true]),
    rule('recording'),
    $message
);
check($probePlan !== null && $probePlan->probe === true, 'probe: the plan keeps the probe flag for the path allow-list');

// ---------- 3. path allow-list ----------

$outside = $base . '/outside.txt';
file_put_contents($outside, 'secret');
file_put_contents($base . '/monitor/empty', '');
@mkdir($base . '/monitor/dir');
@symlink($outside, $base . '/monitor/link');

$guard = new PathGuard(new StaticRoots($base . '/monitor', $base . '/probe'));
$ok = $guard->resolve($base . '/monitor/rec.webm', false);
check(($ok['path'] ?? '') === realpath($base . '/monitor/rec.webm'), 'path: a file inside the monitor root is allowed');
check(($guard->resolve($base . '/monitor/../outside.txt', false)['code'] ?? '') === PathGuard::CODE_REJECTED, 'path: traversal outside the root is rejected');
check(($guard->resolve($base . '/monitor/link', false)['code'] ?? '') === PathGuard::CODE_REJECTED, 'path: a symlink out of the root is rejected');
check(($guard->resolve($base . '/monitor/missing.webm', false)['code'] ?? '') === PathGuard::CODE_MISSING, 'path: a missing file is a code, not a path');
check(($guard->resolve($base . '/monitor/empty', false)['code'] ?? '') === PathGuard::CODE_MISSING, 'path: an empty file is rejected');
check(($guard->resolve($base . '/monitor/dir', false)['code'] ?? '') === PathGuard::CODE_MISSING, 'path: a directory is rejected');
check(($guard->resolve('relative/rec.webm', false)['code'] ?? '') === PathGuard::CODE_REJECTED, 'path: a relative path is rejected');
check(isset($guard->resolve($base . '/probe/tone.mp3', true)['path']), 'probe: the module probe dir is allowed for a probe event');
check(($guard->resolve($base . '/probe/tone.mp3', false)['code'] ?? '') === PathGuard::CODE_REJECTED, 'probe: the probe dir is not a real-event root');
check(($guard->resolve($base . '/monitor/rec.webm', true)['code'] ?? '') === PathGuard::CODE_REJECTED, 'probe: a real recording is not a probe source');

// ---------- 4. converter: argument arrays, nice, timeout, fallback ----------

$toolDir = fakeToolDir($base . '/conv');
$runner = new FakeRunner();
$converter = new Converter($runner, tools($toolDir));
check($converter->available(), 'converter: ffmpeg/sox found');
$commands = $converter->buildCommands('/src/a b.webm', $base . '/module/tmp/out.mp3', ['start_ms' => 37000, 'end_ms' => 52500], $base . '/module/tmp/out.wav');
check($commands !== [], 'converter: commands built');
$first = $commands[0];
check(is_array($first) && !is_string($first), 'converter: the command is an argument array, not a shell string');
check(in_array('-nostdin', $first, true), 'converter: ffmpeg never reads worker stdin');
check(in_array('-ss', $first, true) && in_array('-t', $first, true), 'converter: a fragment is cut in the same pass');
check(in_array('32k', $first, true), 'converter: modest MP3 bitrate');
check(in_array('-n', $first, true) && str_ends_with($first[0], '/nice'), 'converter: nice prefix');
check(in_array('/src/a b.webm', $first, true), 'converter: the path stays one argument element');

$result = $converter->convert($base . '/monitor/rec.webm', $base . '/module/tmp/out.mp3');
check($result->ok(), 'converter: a successful run returns the file');
check($result->durationMs === 3500, 'converter: duration comes from ffprobe');
$ffmpegOnly = new ToolFinder([
    'ffmpeg' => $toolDir . '/ffmpeg',
    'ffprobe' => '/nope/ffprobe',
    'sox' => '/nope/sox',
    'lame' => '/nope/lame',
    'nice' => $toolDir . '/nice',
]);
$runner2 = new FakeRunner();
$runner2->queue(new ProcessResult(1, false));
$converter2 = new Converter($runner2, $ffmpegOnly);
$result = $converter2->convert($base . '/monitor/rec.webm', $base . '/module/tmp/fail.mp3');
check(!$result->ok() && $result->code === Converter::CODE_FAILED, 'converter: a failed run is a code, no file');
check(!file_exists($base . '/module/tmp/fail.mp3'), 'converter: no partial file after a failure');
$runner3 = new FakeRunner();
$runner3->queue(new ProcessResult(-1, true));
$converter3 = new Converter($runner3, $ffmpegOnly);
$result = $converter3->convert($base . '/monitor/rec.webm', $base . '/module/tmp/timeout.mp3');
check(!$result->ok() && $result->code === Converter::CODE_TIMEOUT, 'converter: a timeout is its own code');
$missing = new Converter(new FakeRunner(), new ToolFinder([
    'ffmpeg' => '/nope/ffmpeg',
    'ffprobe' => '/nope/ffprobe',
    'sox' => '/nope/sox',
    'lame' => '/nope/lame',
    'nice' => '/nope/nice',
]));
check(!$missing->available(), 'converter: missing tools are detected');
check($missing->convert('/src.webm', '/out.mp3')->code === Converter::CODE_MISSING, 'converter: missing tool -> converter_missing');

$soxOnly = new Converter(new FakeRunner(), new ToolFinder([
    'ffmpeg' => '/nope/ffmpeg',
    'sox' => $toolDir . '/sox',
    'lame' => $toolDir . '/lame',
    'nice' => $toolDir . '/nice',
]));
$soxCommands = $soxOnly->buildCommands('/src.webm', '/out.mp3', null, '/out.wav');
check(count($soxCommands) === 3, 'converter: sox -> wav + lame fallback chain');
check(in_array($toolDir . '/lame', $soxCommands[2], true), 'converter: lame is the last fallback');

// ---------- 5. locator: CDR via the public Core REST ----------

$rest = new MapRest();
$downloader = new MapDownloader();
$locator = new RecordingLocator($rest, $downloader, $guard);
$pathPlan = new AttachmentPlan('recording', ['type' => 'path', 'path' => $base . '/monitor/rec.webm'], [], 'line', 'caption');
$located = $locator->locate($pathPlan, $base . '/module/tmp/src1');
check($located->ok() && $located->path === realpath($base . '/monitor/rec.webm'), 'locator: a path source is read in place');

$cdrPlan = new AttachmentPlan('recording', ['type' => 'cdr', 'linkedid' => 'mikopbx-1', 'cdr_id' => 501], [], 'line', 'caption');
$rest->routes['/pbxcore/api/v3/cdr/501'] = ['download_url' => '/pbxcore/api/v3/cdr:download?token=abc123'];
$located = $locator->locate($cdrPlan, $base . '/module/tmp/src2');
check($located->ok(), 'locator: CDR by id downloaded');
check($located->ok() && $located->bytes > 0, 'locator: CDR recording is downloaded');
check($downloader->urls[0] === '/pbxcore/api/v3/cdr:download?token=abc123', 'locator: only the relative Core download URL is used');

$rest->routes['/pbxcore/api/v3/cdr/501'] = ['download_url' => 'https://evil.example/steal'];
$downloader->calls = 0;
$located = $locator->locate($cdrPlan, $base . '/module/tmp/src3');
check(!$located->ok() && $located->code === RecordingLocator::CODE_SOURCE_MISSING, 'locator: a foreign URL is never followed');
check($downloader->calls === 0, 'locator: no download without a Core URL');

$rest->routes['/pbxcore/api/v3/cdr/501'] = ['linkedid' => 'another-call', 'download_url' => '/pbxcore/api/v3/cdr:download?token=abc123'];
$located = $locator->locate($cdrPlan, $base . '/module/tmp/src7');
check(!$located->ok() && $located->code === RecordingLocator::CODE_SOURCE_MISSING, 'locator: a record of another call is not used');

$rest->routes['/pbxcore/api/v3/cdr/501'] = new SourceException('api_not_found');
$located = $locator->locate($cdrPlan, $base . '/module/tmp/src4');
check(!$located->ok() && $located->retryable, 'locator: a not-yet-visible CDR row is retried, then falls back');
$rest->routes['/pbxcore/api/v3/cdr/501'] = ['download_url' => '/pbxcore/api/v3/cdr:download?token=abc123'];
$downloader->error = 'http.timeout';
$located = $locator->locate($cdrPlan, $base . '/module/tmp/src5');
check(!$located->ok() && $located->retryable, 'locator: a network failure is retryable');
$downloader->error = '';
$linkedOnly = new AttachmentPlan('recording', ['type' => 'cdr', 'linkedid' => 'mikopbx-1'], [], 'line', 'caption');
$rest->routes['/pbxcore/api/v3/cdr'] = [
    'records' => [
        ['records' => [['recordingfile' => '', 'download_url' => '/pbxcore/api/v3/cdr:download?token=abc123']]],
    ],
];
$located = $locator->locate($linkedOnly, $base . '/module/tmp/src6');
check($located->ok(), 'locator: the grouped CDR response is searched for a recording');
$downloader->error = '';
check((new \Modules\ModuleMessengerHub\Lib\Attachments\LocalRestFileDownloader('key'))->download('https://evil.example/x', $base . '/module/tmp/x', 100) === 'api_bad_path', 'downloader: non-Core paths are rejected');

// ---------- 6. prepared cache and attachment service ----------

$db = hubTestDatabase();
$runner = new FakeRunner();
$rest = new MapRest();
$downloader = new MapDownloader();
$pipeline = pipelineFor($db, $base, $runner, $rest, $downloader, 1);
$monitorPlan = new AttachmentPlan('recording', ['type' => 'path', 'path' => $base . '/monitor/rec.webm'], [], 'line', 'caption');
$files = 0;
$heartbeat = static function (int $at) use (&$files): void {
    $files++;
};
$preflight = $pipeline->preflight($monitorPlan);
check($preflight->ok, 'service: a local recording passes preflight');
$prepared = $pipeline->prepare(1, $monitorPlan, ChannelLimits::telegram(), 'w1', 1792000000, $heartbeat);
check($prepared->state === 'ready' && isset($prepared->files[0]['path']), 'service: one MP3 prepared');
check($runner->commands !== [] && $files > 0, 'service: converter ran and the lease heartbeat was called');
$commandsAfterFirst = count($runner->commands);
$prepared = $pipeline->prepare(1, $monitorPlan, ChannelLimits::telegram(), 'w1', 1792000100, $heartbeat);
check($prepared->state === 'ready' && count($runner->commands) === $commandsAfterFirst, 'service: a second chat reuses the cache');
$secondService = pipelineFor($db, $base, $runner, $rest, $downloader, 2);
$prepared = $secondService->prepare(1, $monitorPlan, ChannelLimits::telegram(), 'w2', 1792000200, $heartbeat);
check($prepared->state === 'ready' && count($runner->commands) === $commandsAfterFirst, 'service: the cache survives a service restart');

$busyPlan = new AttachmentPlan('recording', ['type' => 'path', 'path' => $base . '/monitor/rec.webm'], [], 'line', 'caption');
$cacheKey = $busyPlan->cacheKey(9);
$repo = new PreparedRecordingsRepository($db);
check($repo->claim(9, $cacheKey, 'other-worker', 1792000300, 1800), 'cache: another worker took the lease');
$busy = $pipeline->prepare(9, $busyPlan, ChannelLimits::telegram(), 'me', 1792000400, $heartbeat);
check($busy->state === 'busy', 'cache: a live foreign lease means busy, not a second conversion');

$rest->routes['/pbxcore/api/v3/cdr/501'] = ['download_url' => '/pbxcore/api/v3/cdr:download?token=abc123'];
$downloader->error = 'http.timeout';
$cdrPrepared = $pipeline->prepare(10, $cdrPlan, ChannelLimits::telegram(), 'w1', 1792000500, $heartbeat);
check($cdrPrepared->state === 'retry' && $cdrPrepared->code === 'http.timeout', 'service: a transient CDR failure is retryable');
$downloader->error = '';
$rest->routes['/pbxcore/api/v3/cdr/501'] = ['download_url' => '/pbxcore/api/v3/cdr:download?token=abc123'];

$smallLimits = new ChannelLimits(4096, 1024, 0, 1000, 100, 10, false, 0);
$smallPlan = new AttachmentPlan('recording', ['type' => 'path', 'path' => $base . '/monitor/rec.webm'], [], 'line', 'caption');
$small = $pipeline->prepare(11, $smallPlan, $smallLimits, 'w1', 1792000600, $heartbeat);
check($small->state === 'ready' && isset($small->files[0]['path']), 'service: the cache keeps the file; channel limits are checked per send');

$kept = $prepared->files[0]['path'] ?? '';
check($kept !== '' && file_exists($kept), 'service: the prepared file exists before cleanup');
$pipeline->cleanupEvent(1, 1792000800);
check(!file_exists($kept), 'service: cleanup deletes the prepared file when no delivery needs it');

// journal retry of a failed text: the text is sent first, never audio-only
$db = hubTestDatabase();
$runner = new FakeRunner();
$pipeline = pipelineFor($db, $base, $runner, new MapRest(), new MapDownloader(), 12);
$channel = new AttachChannel(new ChannelLimits(4096, 1024, 0, 1000, 100, 50 * 1024 * 1024, false, 0));
$plan = new AttachmentPlan('recording', ['type' => 'path', 'path' => $base . '/monitor/rec.webm'], [], 'Запись доступна в АТС.', 'Запись');
$eventId = newEventId($db);
$parts = [
    'text' => ['state' => 'failed', 'id' => '', 'code' => 'telegram.401.unauthorized'],
    'note' => ['state' => 'none'],
    'attachment' => ['state' => 'pending'],
    'audio' => [['state' => 'pending', 'id' => '', 'code' => '', 'token' => '', 'not_ready' => 0, 'start_ms' => 0, 'end_ms' => 0]],
];
$rowId = seedAttachDelivery($db, $eventId, json_encode($plan->toArray(), JSON_THROW_ON_ERROR), 1, json_encode($parts, JSON_THROW_ON_ERROR));
$db->execute('UPDATE ' . OutboxRepository::TABLE . " SET status = 'failed' WHERE id = :id", ['id' => $rowId]);
check((new OutboxRepository($db))->retryFailedForEvent($eventId, 1792000000) === 1, 'retry: the failed row is queued again');
deliver($db, $channel, $pipeline, 1792000000);
$row = outbox($db, $rowId);
check($row['status'] === 'sent' && count($channel->messages) === 1, 'retry: the text is delivered first');
check(count($channel->attachments) === 1, 'retry: audio follows the text');
$saved = json_decode((string)$row['delivery_parts_json'], true);
check(($saved['text']['state'] ?? '') === 'sent', 'retry: the text is no longer failed');

// a pre-3a row with a delivered text id is never re-sent after the upgrade
$db = hubTestDatabase();
$channel = new AttachChannel(new ChannelLimits(4096, 1024, 0, 1000, 100, 50 * 1024 * 1024, false, 0));
$eventId = newEventId($db);
$rowId = seedAttachDelivery($db, $eventId, null);
$db->execute(
    'UPDATE ' . OutboxRepository::TABLE . " SET external_message_ids = '[\"old-1\"]' WHERE id = :id",
    ['id' => $rowId]
);
deliver($db, $channel, pipelineFor($db, $base, new FakeRunner(), new MapRest(), new MapDownloader(), 13), 1792000000);
check($channel->messages === [], 'legacy: an already delivered text is not sent again');
check(outbox($db, $rowId)['status'] === 'sent', 'legacy: the row completes');

// a reclaimed audio part is skipped, never sent twice
$db = hubTestDatabase();
$channel = new AttachChannel(new ChannelLimits(4096, 1024, 0, 1000, 100, 50 * 1024 * 1024, false, 0));
$eventId = newEventId($db);
$plan = new AttachmentPlan('recording', ['type' => 'path', 'path' => $base . '/monitor/rec.webm'], [], 'Запись доступна в АТС.', 'Запись');
$parts = [
    'text' => ['state' => 'sent', 'id' => 't1', 'code' => ''],
    'note' => ['state' => 'none'],
    'attachment' => ['state' => 'pending'],
    'audio' => [['state' => 'sending', 'id' => '', 'code' => '', 'token' => '', 'not_ready' => 0, 'start_ms' => 0, 'end_ms' => 0]],
];
$rowId = seedAttachDelivery($db, $eventId, json_encode($plan->toArray(), JSON_THROW_ON_ERROR), 1, json_encode($parts, JSON_THROW_ON_ERROR));
deliver($db, $channel, pipelineFor($db, $base, new FakeRunner(), new MapRest(), new MapDownloader(), 14), 1792000000);
$saved = json_decode((string)outbox($db, $rowId)['delivery_parts_json'], true);
check($channel->attachments === [], 'at-most-once: a reclaimed audio part is never sent again');
check(($saved['audio'][0]['state'] ?? '') === 'skipped' && ($saved['audio'][0]['code'] ?? '') === 'attachment.uncertain', 'at-most-once: the audio uncertain outcome is recorded');

// a per-channel size limit skips only that part and adds the fallback note
$db = hubTestDatabase();
$runner = new FakeRunner();
$pipeline = pipelineFor($db, $base, $runner, new MapRest(), new MapDownloader(), 11);
$channel = new AttachChannel(new ChannelLimits(4096, 1024, 0, 1000, 100, 10, false, 0));
$plan = new AttachmentPlan('recording', ['type' => 'path', 'path' => $base . '/monitor/rec.webm'], [], 'Запись доступна в АТС.', 'Запись');
$eventId = newEventId($db);
$rowId = seedAttachDelivery($db, $eventId, json_encode($plan->toArray(), JSON_THROW_ON_ERROR));
$stats = deliver($db, $channel, $pipeline, 1792000000);
check($stats['sent'] === 1 && outbox($db, $rowId)['status'] === 'sent', 'size: the row is still sent');
check($channel->attachments === [] && count($channel->messages) === 2, 'size: the part is skipped and the note is sent');
$parts = json_decode((string)outbox($db, $rowId)['delivery_parts_json'], true);
check(($parts['audio'][0]['state'] ?? '') === 'skipped' && ($parts['audio'][0]['code'] ?? '') === 'attachment.too_big', 'size: the part reason is recorded');

// ---------- 6b. temp tree and janitor ----------

$janitorTemp = new TempDir($base . '/module');
$janitorPaths = new PathGuard(new StaticRoots($base . '/monitor', $base . '/probe'));
$janitorRepo = new PreparedRecordingsRepository($db);
$janitorService = new AttachmentService(
    new Converter(new FakeRunner(), tools(fakeToolDir($base . '/janitor-tools'))),
    new RecordingLocator(new MapRest(), new MapDownloader(), $janitorPaths),
    $janitorPaths,
    $janitorRepo,
    $janitorTemp,
    $db,
    10,
    10
);
check((fileperms($janitorTemp->attachmentsDir()) & 0777) === 0700, 'temp: the attachments dir is 0700');
check((fileperms($janitorTemp->probeDir()) & 0777) === 0700, 'temp: the probe dir is 0700');
$preparedPath = $prepared->files[0]['path'] ?? '';
check($preparedPath !== '' && str_starts_with($preparedPath, $base . '/module/tmp/attachments/'), 'temp: prepared files stay inside the module temp tree');

$nowJan = 1792001000;
$janitorRepo->claim(20, 'stale', 'w', $nowJan - 7200, 900);
$janitorService->janitor($nowJan);
check($janitorRepo->find('stale') === null, 'janitor: a stale preparing row is removed');

$janitorRepo->claim(21, 'failed', 'w', $nowJan, 900);
$failedRow = $janitorRepo->find('failed');
$janitorRepo->markFailed((int)$failedRow['id'], 'w', 'attachment.conversion_failed', $nowJan - 100);
$janitorService->janitor($nowJan);
check($janitorRepo->find('failed') === null, 'janitor: an old failed cache row is reaped');

$readyPath = $janitorTemp->tempPath('ready') . '.mp3';
file_put_contents($readyPath, 'ID3' . str_repeat('\0', 64));
$janitorRepo->claim(22, 'ready', 'w', $nowJan, 900);
$readyRow = $janitorRepo->find('ready');
$janitorRepo->markReady((int)$readyRow['id'], 'w', [['path' => $readyPath, 'bytes' => 67]], $nowJan - 100);
$janitorService->janitor($nowJan);
check($janitorRepo->find('ready') === null && !file_exists($readyPath), 'janitor: an unreferenced ready cache and its file are removed');

$outsideFile = $base . '/outside-sweep.txt';
file_put_contents($outsideFile, 'keep me');
$link = $janitorTemp->attachmentsDir() . '/planted-link';
@symlink($outsideFile, $link);
$janitorTemp->sweep($nowJan, 0);
check(file_exists($outsideFile) && !is_link($link), 'temp: the janitor removes a symlink, never its target');

// ---------- 6c. owner guards: a stale worker writes nothing ----------

$db = hubTestDatabase();
$eventId = newEventId($db);
$rowId = seedAttachDelivery($db, $eventId, null);
$repoGuarded = new OutboxRepository($db);
$nowGuard = 1792002000;
check($repoGuarded->claim(1, $nowGuard, 'owner1', 120) === [$rowId], 'owner: the first worker claims the row');
$db->execute(
    'UPDATE ' . OutboxRepository::TABLE . ' SET lease_until = :past WHERE id = :id',
    ['past' => $nowGuard - 10, 'id' => $rowId]
);
$repoGuarded->reclaimExpiredLeases($nowGuard);
check($repoGuarded->claim(1, $nowGuard, 'owner2', 120) === [$rowId], 'owner: a second worker claims the expired row');
check(!$repoGuarded->markSentWithParts($rowId, [], [], $nowGuard, 'owner1'), 'owner: a stale worker cannot mark the row sent');
check(!$repoGuarded->markRetry($rowId, 1, $nowGuard + 10, 'x', false, $nowGuard, 'owner1'), 'owner: a stale worker cannot postpone the row');
check(!$repoGuarded->markFailed($rowId, 1, 'x', $nowGuard, 'owner1'), 'owner: a stale worker cannot fail the row');
check(!$repoGuarded->markDropped($rowId, 'x', $nowGuard, 'owner1'), 'owner: a stale worker cannot drop the row');
$guardedRow = outbox($db, $rowId);
check($guardedRow['status'] === 'sending' && $guardedRow['lease_owner'] === 'owner2', 'owner: the winner still owns the row');

// a per-channel duration limit skips the part (MAX 60 min) without poisoning the cache
$db = hubTestDatabase();
$runner = new FakeRunner();
$pipeline = pipelineFor($db, $base, $runner, new MapRest(), new MapDownloader(), 15);
$channel = new AttachChannel(new ChannelLimits(4096, 1024, 0, 1000, 100, 50 * 1024 * 1024, false, 1));
$plan = new AttachmentPlan('recording', ['type' => 'path', 'path' => $base . '/monitor/rec.webm'], [], 'Запись доступна в АТС.', 'Запись');
$eventId = newEventId($db);
$rowId = seedAttachDelivery($db, $eventId, json_encode($plan->toArray(), JSON_THROW_ON_ERROR));
deliver($db, $channel, $pipeline, 1792000000);
$parts = json_decode((string)outbox($db, $rowId)['delivery_parts_json'], true);
check($channel->attachments === [] && ($parts['audio'][0]['code'] ?? '') === 'attachment.duration_too_long', 'duration: the part is skipped for this channel only');
check($runner->commands !== [], 'duration: the file is still prepared and cached');

// ---------- 7. delivery parts: text first, no duplicates, note on late failure ----------

$db = hubTestDatabase();
$runner = new FakeRunner();
$rest = new MapRest();
$downloader = new MapDownloader();
$pipeline = pipelineFor($db, $base, $runner, $rest, $downloader, 3);
$channel = new AttachChannel(new ChannelLimits(4096, 1024, 0, 1000, 100, 50 * 1024 * 1024, false, 0));
$plan = new AttachmentPlan('recording', ['type' => 'path', 'path' => $base . '/monitor/rec.webm'], [['start_ms' => 0, 'end_ms' => 1000]], 'Запись доступна в АТС.', 'Запись');
$eventId = newEventId($db);
$rowId = seedAttachDelivery($db, $eventId, json_encode($plan->toArray(), JSON_THROW_ON_ERROR));
$channel->sendResults = [SendResult::sent(['t1'])];
$channel->attachmentResults = [AttachmentResult::of(SendResult::retry(10, 'telegram.500.server_error'))];
$stats = deliver($db, $channel, $pipeline, 1792000000);
check($stats['retried'] === 1, 'parts: audio failure postpones the row');
$row = outbox($db, $rowId);
check($row['status'] === 'pending' && count($channel->messages) === 1, 'parts: the text was sent once');
$parts = json_decode((string)$row['delivery_parts_json'], true);
check(($parts['text']['state'] ?? '') === 'sent' && ($parts['text']['id'] ?? '') === 't1', 'parts: text progress persisted');
check(($parts['audio'][0]['state'] ?? '') === 'pending', 'parts: audio part is still pending');
check($row['external_message_ids'] === '["t1"]', 'parts: only the sent text id is stored');
$commandsAfterText = count($runner->commands);
$channel->attachmentResults = [AttachmentResult::of(SendResult::sent(['a2']))];
$stats = deliver($db, $channel, $pipeline, 1792000011);
$row = outbox($db, $rowId);
check($stats['sent'] === 1 && $row['status'] === 'sent', 'parts: the row completes on the retry');
check(count($channel->messages) === 1, 'parts: the retry never sends the text again');
check(count($runner->commands) === $commandsAfterText, 'parts: the retry reuses the prepared file');
check($row['external_message_ids'] === '["t1","a2"]', 'parts: text and audio ids are stored for retraction');

// preflight failure: the line goes into the text, never into a delayed audio attempt
$db = hubTestDatabase();
$runner = new FakeRunner();
$pipeline = pipelineFor($db, $base, $runner, new MapRest(), new MapDownloader(), 4);
$channel = new AttachChannel(new ChannelLimits(4096, 1024, 0, 1000, 100, 50 * 1024 * 1024, false, 0));
$plan = new AttachmentPlan('recording', ['type' => 'path', 'path' => $base . '/monitor/missing.webm'], [], 'Запись доступна в АТС.', 'Запись');
$eventId = newEventId($db);
$rowId = seedAttachDelivery($db, $eventId, json_encode($plan->toArray(), JSON_THROW_ON_ERROR));
$stats = deliver($db, $channel, $pipeline, 1792000000);
check($stats['sent'] === 1 && outbox($db, $rowId)['status'] === 'sent', 'preflight: the row is sent without audio');
check(count($channel->messages) === 1 && in_array('Запись доступна в АТС.', $channel->messages[0]->lines, true), 'preflight: the fallback line is in the text');
check($channel->attachments === [] && count($runner->commands) === 0, 'preflight: no conversion and no audio send');
$parts = json_decode((string)outbox($db, $rowId)['delivery_parts_json'], true);
check(($parts['attachment']['state'] ?? '') === 'skipped', 'preflight: the journal shows a skipped attachment');
check(($parts['attachment']['code'] ?? '') === 'attachment.path_missing', 'preflight: the journal keeps the real reason');

// late CDR failure: the text goes first, then the short note
$db = hubTestDatabase();
$runner = new FakeRunner();
$rest = new MapRest();
$rest->routes['/pbxcore/api/v3/cdr/501'] = ['recordingfile' => '', 'download_url' => ''];
$pipeline = pipelineFor($db, $base, $runner, $rest, new MapDownloader(), 5);
$channel = new AttachChannel(new ChannelLimits(4096, 1024, 0, 1000, 100, 50 * 1024 * 1024, false, 0));
$plan = new AttachmentPlan('recording', ['type' => 'cdr', 'cdr_id' => 501], [], 'Запись доступна в АТС.', 'Запись');
$eventId = newEventId($db);
$rowId = seedAttachDelivery($db, $eventId, json_encode($plan->toArray(), JSON_THROW_ON_ERROR));
$stats = deliver($db, $channel, $pipeline, 1792000000);
$row = outbox($db, $rowId);
check($stats['sent'] === 1 && $row['status'] === 'sent', 'late failure: the row is still sent');
check(count($channel->messages) === 2, 'late failure: text + fallback note');
check(!in_array('Запись доступна в АТС.', $channel->messages[0]->lines, true), 'late failure: the text was not delayed or rewritten');
check($channel->messages[1]->lines === ['Запись доступна в АТС.'], 'late failure: the note carries the link line');
check($channel->attachments === [], 'late failure: no audio was sent');
check($row['external_message_ids'] === '["text-1","text-2"]', 'late failure: text and note ids are stored');

// attachments none: nothing audio-related
$db = hubTestDatabase();
$pipeline = pipelineFor($db, $base, new FakeRunner(), new MapRest(), new MapDownloader(), 6);
$channel = new AttachChannel(new ChannelLimits(4096, 1024, 0, 1000, 100, 50 * 1024 * 1024, false, 0));
$eventId = newEventId($db);
$rowId = seedAttachDelivery($db, $eventId, null);
deliver($db, $channel, $pipeline, 1792000000);
check(count($channel->messages) === 1 && $channel->attachments === [], 'attachments none: text only');
check(outbox($db, $rowId)['status'] === 'sent', 'attachments none: row sent');

// reclaimed text: persisted `sending` is never sent again
$db = hubTestDatabase();
$channel = new AttachChannel(new ChannelLimits(4096, 1024, 0, 1000, 100, 50 * 1024 * 1024, false, 0));
$eventId = newEventId($db);
$parts = ['text' => ['state' => 'sending', 'id' => '', 'code' => ''], 'note' => ['state' => 'none'], 'attachment' => ['state' => 'none'], 'audio' => []];
$rowId = seedAttachDelivery($db, $eventId, null, 1, json_encode($parts, JSON_THROW_ON_ERROR));
deliver($db, $channel, pipelineFor($db, $base, new FakeRunner(), new MapRest(), new MapDownloader(), 7), 1792000000);
$row = outbox($db, $rowId);
$saved = json_decode((string)$row['delivery_parts_json'], true);
check($channel->messages === [], 'at-most-once: a reclaimed text is never re-sent');
check($row['status'] === 'sent' && ($saved['text']['code'] ?? '') === 'delivery.uncertain', 'at-most-once: the uncertain outcome is recorded');

// reclaimed text with planned audio: no orphan audio, no note
$db = hubTestDatabase();
$channel = new AttachChannel(new ChannelLimits(4096, 1024, 0, 1000, 100, 50 * 1024 * 1024, false, 0));
$eventId = newEventId($db);
$plan = new AttachmentPlan('recording', ['type' => 'path', 'path' => $base . '/monitor/rec.webm'], [], 'Запись доступна в АТС.', 'Запись');
$parts = [
    'text' => ['state' => 'sending', 'id' => '', 'code' => ''],
    'note' => ['state' => 'none'],
    'attachment' => ['state' => 'pending'],
    'audio' => [['state' => 'pending', 'id' => '', 'code' => '', 'token' => '', 'not_ready' => 0, 'start_ms' => 0, 'end_ms' => 0]],
];
$rowId = seedAttachDelivery($db, $eventId, json_encode($plan->toArray(), JSON_THROW_ON_ERROR), 1, json_encode($parts, JSON_THROW_ON_ERROR));
deliver($db, $channel, pipelineFor($db, $base, new FakeRunner(), new MapRest(), new MapDownloader(), 10), 1792000000);
$saved = json_decode((string)outbox($db, $rowId)['delivery_parts_json'], true);
check($channel->messages === [] && $channel->attachments === [], 'at-most-once: no orphan audio or note after an uncertain text');
check(($saved['audio'][0]['state'] ?? '') === 'skipped' && ($saved['audio'][0]['code'] ?? '') === 'attachment.text_uncertain', 'at-most-once: the audio is skipped with the text_uncertain reason');

// MAX attachment.not.ready: the same token is reused, bounded
$db = hubTestDatabase();
$runner = new FakeRunner();
$pipeline = pipelineFor($db, $base, $runner, new MapRest(), new MapDownloader(), 8);
$channel = new AttachChannel(new ChannelLimits(4096, 1024, 0, 1000, 100, 50 * 1024 * 1024, false, 3600));
$plan = new AttachmentPlan('recording', ['type' => 'path', 'path' => $base . '/monitor/rec.webm'], [], 'Запись доступна в АТС.', 'Запись');
$eventId = newEventId($db);
$rowId = seedAttachDelivery($db, $eventId, json_encode($plan->toArray(), JSON_THROW_ON_ERROR));
$channel->attachmentResults = [
    AttachmentResult::of(SendResult::retry(5, 'max.attachment.not_ready'), true, 'tok-1'),
    AttachmentResult::of(SendResult::retry(5, 'max.attachment.not_ready'), true, 'tok-1'),
    AttachmentResult::of(SendResult::sent(['a9'])),
];
deliver($db, $channel, $pipeline, 1792000000);
deliver($db, $channel, $pipeline, 1792000006);
deliver($db, $channel, $pipeline, 1792000017);
$row = outbox($db, $rowId);
check($row['status'] === 'sent', 'not.ready: the part is sent after bounded retries');
check(count($channel->attachments) === 3, 'not.ready: three sends');
check($channel->attachments[0]->pendingToken === '' && $channel->attachments[1]->pendingToken === 'tok-1' && $channel->attachments[2]->pendingToken === 'tok-1', 'not.ready: the same upload token is reused');
check(count($channel->messages) === 1, 'not.ready: the text is sent once');

// one conversion for all chats of an event
$db = hubTestDatabase();
$runner = new FakeRunner();
$pipeline = pipelineFor($db, $base, $runner, new MapRest(), new MapDownloader(), 9);
$channel = new AttachChannel(new ChannelLimits(4096, 1024, 0, 1000, 100, 50 * 1024 * 1024, false, 0));
$plan = new AttachmentPlan('recording', ['type' => 'path', 'path' => $base . '/monitor/rec.webm'], [], 'Запись доступна в АТС.', 'Запись');
$eventId = newEventId($db);
seedAttachDelivery($db, $eventId, json_encode($plan->toArray(), JSON_THROW_ON_ERROR), 1);
seedAttachDelivery($db, $eventId, json_encode($plan->toArray(), JSON_THROW_ON_ERROR), 2);
$stats = deliver($db, $channel, $pipeline, 1792000000);
check($stats['sent'] === 2, 'cache: both chats delivered');
check(count($runner->commands) === 2, 'cache: one conversion + one probe for both chats');
check(count($channel->messages) === 2 && count($channel->attachments) === 2, 'cache: text and audio per chat');

// ---------- 8. retraction ids of text + parts ----------

$db = hubTestDatabase();
$channel = new AttachChannel(ChannelLimits::telegram());
$eventId = newEventId($db);
$rowId = seedAttachDelivery($db, $eventId, null, 1, null, 1792000000);
$db->execute(
    'UPDATE ' . OutboxRepository::TABLE . " SET status = 'sent', external_message_ids = '[\"t1\",\"a1\",\"a2\"]',"
    . ' sent_at = :now, retract_requested_at = :now, retract_attempts = 0, retract_next_attempt_at = :now'
    . ' WHERE id = :id',
    ['now' => 1792000000, 'id' => $rowId]
);
$channel->deleteResults = [
    SendResult::sent(),
    SendResult::sent(),
    SendResult::permanent('telegram.400.bad_request'),
];
$retractions = new RetractionService(new OutboxRepository($db), new ChannelRegistry([$channel]), new RateLimiter(), 'test');
$stats = $retractions->runOnce(1792000000);
check($stats['retried'] === 1, 'retract: one delete per rate window');
check($channel->deleted === ['t1'], 'retract: the text id is deleted first');
$progress = json_decode((string)outbox($db, $rowId)['retract_progress_json'], true);
check(($progress['done'] ?? []) === ['t1'], 'retract: the done id is persisted');

$retractions->runOnce(1792000001);
$stats = $retractions->runOnce(1792000002);
check($stats['failed'] === 1, 'retract: a permanent failure ends retraction');
$row = outbox($db, $rowId);
check($row['status'] === 'retract_failed' && $row['retract_last_error_code'] === 'telegram.400.bad_request', 'retract: retract_failed with the channel code');
$progress = json_decode((string)$row['retract_progress_json'], true);
check(($progress['done'] ?? []) === ['t1', 'a1'], 'retract: successfully deleted ids are kept');
check(($progress['failed'] ?? []) === ['a2'], 'retract: the remaining id is reported, no endless retries');

// ---------- 9. codes never carry a path or a token ----------

foreach ([
    PathGuard::CODE_REJECTED,
    PathGuard::CODE_MISSING,
    Converter::CODE_MISSING,
    Converter::CODE_FAILED,
    Converter::CODE_TIMEOUT,
    RecordingLocator::CODE_SOURCE_MISSING,
    RecordingLocator::CODE_TOO_BIG,
    'attachment.quotes_missing',
    'attachment.not_applicable',
    'attachment.uncertain',
] as $code) {
    check(!str_contains($code, $base), 'code has no temporary path: ' . $code);
    check(!str_contains($code, 'token'), 'code has no token: ' . $code);
    check(!str_contains($code, 'abc123'), 'code has no playback token: ' . $code);
    check(!str_contains($code, $base . '/monitor'), 'code has no recording path: ' . $code);
}

rmrf($base);
finish('attachments OK');
