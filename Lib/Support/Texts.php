<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Support;

/**
 * Message texts resolved from the module catalog (Messages/<locale>.php, PBX language).
 *
 * Templates stay Core-free: unit checks pass ArrayTexts built from the catalog, the worker wires
 * CoreTexts over Core's translation service.
 */
interface Texts
{
    /**
     * @param array<string, scalar|null> $params placeholders in the {name} form
     */
    public function t(string $key, array $params = []): string;
}
