<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing;

use Modules\ModuleMessengerHub\Lib\Support\Texts;

/**
 * What a template may use: texts, links and the masking decision taken at routing time.
 */
final class RenderContext
{
    public function __construct(
        public readonly Texts $texts,
        public readonly LinkBuilder $links,
        public readonly bool $maskPhone = false,
    ) {
    }
}
