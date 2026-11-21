<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Common;

/**
 * Texts the REST layer resolves server-side (source names, groups, event types — Plan/06).
 *
 * Kept as an interface so processors stay Core-free in unit checks: tests pass an ArrayTranslator
 * built from the Messages catalog, the station entry point wires CoreTranslator.
 */
interface Translator
{
    /** Returns the translation for $key, falling back to the key itself (never throws). */
    public function t(string $key): string;
}
