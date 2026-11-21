<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing;

/**
 * Phone formatting and masking (Plan/05-events-rules-templates.md, "Маскирование").
 *
 * The full number stays in the event payload (filters need it); only the rendered text is masked:
 * +7 968 968-94-44 -> +7 968 ***-**-44. Unknown formats keep a readable shape without exposing the
 * middle digits.
 */
final class PhoneMasker
{
    public static function format(string $number): string
    {
        $parts = self::parts($number);

        return $parts === null ? trim($number) : sprintf('+7 %s %s-%s-%s', $parts[0], $parts[1], $parts[2], $parts[3]);
    }

    public static function mask(string $number): string
    {
        $parts = self::parts($number);
        if ($parts !== null) {
            return sprintf('+7 %s ***-**-%s', $parts[0], $parts[3]);
        }
        // unknown length: keep the leading and trailing digits, hide the rest
        $digits = (string)preg_replace('/\D+/', '', $number);
        if (strlen($digits) < 7) {
            return trim($number);
        }

        return '+' . substr($digits, 0, 3) . ' ***-**-' . substr($digits, -2);
    }

    /** @return array{0: string, 1: string, 2: string, 3: string}|null */
    private static function parts(string $number): ?array
    {
        $digits = (string)preg_replace('/\D+/', '', $number);
        if (strlen($digits) === 11 && ($digits[0] === '7' || $digits[0] === '8')) {
            $digits = substr($digits, 1);
        }
        if (strlen($digits) !== 10) {
            return null;
        }

        return [substr($digits, 0, 3), substr($digits, 3, 3), substr($digits, 6, 2), substr($digits, 8, 2)];
    }
}
