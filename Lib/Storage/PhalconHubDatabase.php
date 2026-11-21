<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Storage;

use Modules\ModuleMessengerHub\Models\MessengerHubEvents;
use Phalcon\Db\Adapter\AdapterInterface;
use Phalcon\Db\Enum;

/**
 * HubDatabase over the module's own SQLite connection (the one Phalcon gives the module models).
 */
final class PhalconHubDatabase implements HubDatabase
{
    private AdapterInterface $connection;

    public function __construct(?AdapterInterface $connection = null)
    {
        $this->connection = $connection ?? (new MessengerHubEvents())->getWriteConnection();
    }

    public function execute(string $sql, array $bind = []): int
    {
        $this->connection->execute($sql, $bind);

        return $this->connection->affectedRows();
    }

    public function fetchAll(string $sql, array $bind = []): array
    {
        return array_values($this->connection->fetchAll($sql, Enum::FETCH_ASSOC, $bind));
    }

    public function fetchOne(string $sql, array $bind = []): ?array
    {
        $row = $this->connection->fetchOne($sql, Enum::FETCH_ASSOC, $bind);

        return is_array($row) ? $row : null;
    }

    public function lastInsertId(): int
    {
        return (int)$this->connection->lastInsertId();
    }
}
