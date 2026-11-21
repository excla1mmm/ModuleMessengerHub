<?php

declare(strict_types=1);

// Test bootstrap: PSR-4 autoload of module classes, in-memory SQLite HubDatabase, tiny assert helpers.
// Classes that need MikoPBX Core (models, Core probes, workers) are never loaded by unit checks.

use Modules\ModuleMessengerHub\Lib\Storage\HubDatabase;

spl_autoload_register(static function (string $class): void {
    $prefix = 'Modules\\ModuleMessengerHub\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $file = dirname(__DIR__, 2) . '/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});

final class PdoHubDatabase implements HubDatabase
{
    public function __construct(public readonly PDO $pdo)
    {
    }

    public function execute(string $sql, array $bind = []): int
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute(self::prefix($bind));

        return $statement->rowCount();
    }

    public function fetchAll(string $sql, array $bind = []): array
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute(self::prefix($bind));

        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    public function fetchOne(string $sql, array $bind = []): ?array
    {
        $row = $this->fetchAll($sql, $bind)[0] ?? null;

        return is_array($row) ? $row : null;
    }

    public function lastInsertId(): int
    {
        return (int)$this->pdo->lastInsertId();
    }

    /** @return array<string, mixed> */
    private static function prefix(array $bind): array
    {
        $out = [];
        foreach ($bind as $key => $value) {
            $out[':' . $key] = $value;
        }

        return $out;
    }
}

/** Fresh in-memory database with the module schema (kept in sync with Models/ annotations). */
function hubTestDatabase(): PdoHubDatabase
{
    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec(
        'CREATE TABLE m_MessengerHubEvents (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL,'
        . ' event_type TEXT NOT NULL, severity TEXT NOT NULL, dedupe_key TEXT NOT NULL, occurred_at INTEGER NOT NULL,'
        . ' payload_json TEXT, routed_at INTEGER, created_at INTEGER NOT NULL)'
    );
    $pdo->exec('CREATE UNIQUE INDEX dedupe_key ON m_MessengerHubEvents (dedupe_key)');
    $pdo->exec(
        'CREATE TABLE m_MessengerHubSourceState (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL,'
        . ' enabled INTEGER NOT NULL, cursor_json TEXT, availability TEXT, last_poll_at INTEGER, last_ok_at INTEGER,'
        . ' last_error_code TEXT, baseline_set_at INTEGER)'
    );
    $pdo->exec('CREATE UNIQUE INDEX source_id ON m_MessengerHubSourceState (source_id)');
    $pdo->exec('CREATE TABLE m_MessengerHubSettings (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, value TEXT)');
    $pdo->exec('CREATE UNIQUE INDEX key ON m_MessengerHubSettings (key)');
    $pdo->exec(
        'CREATE TABLE m_MessengerHubBots (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL,'
        . " title TEXT NOT NULL, token TEXT NOT NULL, token_hint TEXT NOT NULL, bot_username TEXT,"
        . " bot_external_id TEXT, enabled TEXT NOT NULL, status TEXT NOT NULL, status_checked_at INTEGER NOT NULL,"
        . " last_error_code TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"
    );
    $pdo->exec(
        'CREATE TABLE m_MessengerHubBotChats (id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id INTEGER NOT NULL,'
        . " chat_id TEXT NOT NULL, chat_kind TEXT NOT NULL, title TEXT NOT NULL, linked_user_id INTEGER NOT NULL,"
        . " enabled TEXT NOT NULL, state TEXT NOT NULL, gone_reason TEXT NOT NULL, discovered_at INTEGER NOT NULL)"
    );
    $pdo->exec('CREATE UNIQUE INDEX bot_chat ON m_MessengerHubBotChats (bot_id, chat_id)');
    $pdo->exec(
        'CREATE TABLE m_MessengerHubRules (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,'
        . " enabled TEXT NOT NULL, event_types TEXT NOT NULL, min_severity TEXT NOT NULL,"
        . " filters_json TEXT NOT NULL, target_mode TEXT NOT NULL, chat_ids_json TEXT NOT NULL,"
        . " template_key TEXT NOT NULL, options_json TEXT NOT NULL, quiet_hours_json TEXT,"
        . " sort INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"
    );
    $pdo->exec(
        'CREATE TABLE m_MessengerHubOutbox (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL,'
        . " chat_id INTEGER NOT NULL, bot_id INTEGER NOT NULL, rule_id INTEGER, status TEXT NOT NULL,"
        . " attempts INTEGER NOT NULL, uncertain_attempts INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL,"
        . " lease_owner TEXT, lease_until INTEGER, rendered_json TEXT, external_message_ids TEXT NOT NULL,"
        . " last_error_code TEXT NOT NULL, last_error_at INTEGER, created_at INTEGER NOT NULL,"
        . " updated_at INTEGER NOT NULL, sent_at INTEGER, retract_requested_at INTEGER, retract_attempts INTEGER,"
        . " retract_next_attempt_at INTEGER, retract_last_error_code TEXT, retracted_at INTEGER,"
        . " retract_reason TEXT, resolved_at INTEGER, resolved_by TEXT)"
    );
    $pdo->exec('CREATE UNIQUE INDEX event_chat ON m_MessengerHubOutbox (event_id, chat_id)');
    $pdo->exec(
        'CREATE TABLE m_MessengerHubDiscoverySessions (id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id INTEGER NOT NULL,'
        . " started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, updates_offset INTEGER NOT NULL,"
        . " found_json TEXT NOT NULL, status TEXT NOT NULL, last_error_code TEXT NOT NULL)"
    );

    return new PdoHubDatabase($pdo);
}

/** Message catalog of the unit checks (Russian, the source locale). */
function hubTestTexts(): \Modules\ModuleMessengerHub\Lib\Support\ArrayTexts
{
    /** @var array<string, string> $catalog */
    $catalog = require dirname(__DIR__, 2) . '/Messages/ru.php';

    return new \Modules\ModuleMessengerHub\Lib\Support\ArrayTexts($catalog);
}

/**
 * Anonymised Telegram response fixture (Tests/fixtures/telegram/<name>.json).
 *
 * @return array<string, mixed>
 */
function telegramFixture(string $name): array
{
    $file = dirname(__DIR__) . '/fixtures/telegram/' . $name . '.json';
    $decoded = json_decode((string)file_get_contents($file), true);

    return is_array($decoded) ? $decoded : [];
}

/** @var list<string> $GLOBALS['hubTestFailures'] */
$GLOBALS['hubTestFailures'] = [];

function check(bool $condition, string $message): void
{
    if (!$condition) {
        $GLOBALS['hubTestFailures'][] = $message;
    }
}

function finish(string $okMessage): never
{
    if ($GLOBALS['hubTestFailures'] !== []) {
        fwrite(STDERR, implode(PHP_EOL, $GLOBALS['hubTestFailures']) . PHP_EOL);
        exit(1);
    }
    echo $okMessage . PHP_EOL;
    exit(0);
}
