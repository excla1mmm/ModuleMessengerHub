<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Common;

use Phalcon\Translate\Adapter\AdapterInterface;

/** Translator over the Core translation service ('translation', the admin's locale) — thin glue. */
final class CoreTranslator implements Translator
{
    public function __construct(private readonly AdapterInterface $translation)
    {
    }

    public function t(string $key): string
    {
        try {
            $value = $this->translation->_($key);
        } catch (\Throwable) {
            return $key;
        }

        return is_string($value) && $value !== '' ? $value : $key;
    }
}
