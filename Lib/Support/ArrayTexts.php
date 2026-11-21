<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Support;

/** Texts over a literal catalog (Messages/<locale>.php shape), used in unit checks. */
final class ArrayTexts implements Texts
{
    /** @param array<string, string> $catalog */
    public function __construct(private readonly array $catalog)
    {
    }

    public function t(string $key, array $params = []): string
    {
        $text = $this->catalog[$key] ?? $key;

        return TextsPlaceholders::apply($text, $params);
    }
}
