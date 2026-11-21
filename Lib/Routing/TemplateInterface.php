<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;

/**
 * Per-event renderer. Implementations are per event type and store no state
 * (Plan/05-events-rules-templates.md, "Шаблоны").
 */
interface TemplateInterface
{
    public function render(HubEvent $event, RenderContext $context): RenderedMessage;
}
