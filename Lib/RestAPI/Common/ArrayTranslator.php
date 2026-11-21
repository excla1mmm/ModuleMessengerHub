<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Common;

/** Translator over a literal catalog (Messages/<locale>.php shape), used in unit checks. */
final class ArrayTranslator implements Translator
{
    /** @param array<string, string> $catalog */
    public function __construct(private readonly array $catalog)
    {
    }

    public function t(string $key): string
    {
        $value = $this->catalog[$key] ?? $key;

        return is_string($value) && $value !== '' ? $value : $key;
    }
}
