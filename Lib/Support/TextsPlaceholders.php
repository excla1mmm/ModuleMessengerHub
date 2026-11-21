<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Support;

/** {name} placeholder substitution shared by the Texts implementations. */
final class TextsPlaceholders
{
    /** @param array<string, scalar|null> $params */
    public static function apply(string $text, array $params): string
    {
        if ($params === []) {
            return $text;
        }
        $replace = [];
        foreach ($params as $key => $value) {
            $replace['{' . $key . '}'] = (string)($value ?? '');
        }

        return strtr($text, $replace);
    }
}
