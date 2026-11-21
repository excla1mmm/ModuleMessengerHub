<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Storage;

/**
 * Minimal SQL port used by stores, so their logic runs on Phalcon in production and on PDO in tests.
 */
interface HubDatabase
{
    /** Executes a statement with named binds; returns the number of affected rows. */
    public function execute(string $sql, array $bind = []): int;

    /** @return list<array<string, mixed>> */
    public function fetchAll(string $sql, array $bind = []): array;

    /** @return array<string, mixed>|null */
    public function fetchOne(string $sql, array $bind = []): ?array;

    public function lastInsertId(): int;
}
