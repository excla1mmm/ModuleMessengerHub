<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing;

/**
 * Small formatting helpers shared by the templates. Times are rendered in the PBX timezone.
 */
final class MessageFormat
{
    public static function time(int $timestamp): string
    {
        return $timestamp > 0 ? date('d.m.Y H:i', $timestamp) : '';
    }

    public static function shortTime(int $timestamp): string
    {
        return $timestamp > 0 ? date('H:i', $timestamp) : '';
    }

    public static function duration(int $seconds): string
    {
        $seconds = max(0, $seconds);

        return sprintf('%d:%02d', intdiv($seconds, 60), $seconds % 60);
    }

    /**
     * @param array<string, mixed> $employee {user_id, number, name}
     */
    public static function employee(array $employee): string
    {
        $name = trim((string)($employee['name'] ?? ''));
        $number = trim((string)($employee['number'] ?? ''));
        if ($name === '') {
            return $number;
        }

        return $number === '' ? $name : $name . ' (' . $number . ')';
    }

    public static function phone(string $number, bool $mask): string
    {
        if ($number === '') {
            return '';
        }

        return $mask ? PhoneMasker::mask($number) : PhoneMasker::format($number);
    }
}
