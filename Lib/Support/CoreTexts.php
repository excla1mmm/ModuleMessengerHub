<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Support;

use Phalcon\Translate\Adapter\AdapterInterface;
use Throwable;

/** Texts over Core's translation service (the PBX/admin locale) — thin glue, never used in unit checks. */
final class CoreTexts implements Texts
{
    public function __construct(private readonly AdapterInterface $translation)
    {
    }

    public function t(string $key, array $params = []): string
    {
        try {
            $text = $this->translation->_($key);
        } catch (Throwable) {
            return $key;
        }

        return TextsPlaceholders::apply(is_string($text) && $text !== '' ? $text : $key, $params);
    }
}
