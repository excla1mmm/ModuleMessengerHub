<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing\Templates;

use Modules\ModuleMessengerHub\Lib\Events\HubEvent;
use Modules\ModuleMessengerHub\Lib\Routing\RenderContext;
use Modules\ModuleMessengerHub\Lib\Routing\RenderedMessage;
use Modules\ModuleMessengerHub\Lib\Routing\TemplateInterface;

/**
 * hub.test — «Отправить тест» (design: «Проверка связи от АТС MikoPBX ({адрес})»).
 *
 * The test goes through the same Outbox as real notifications; the processor renders it at queue time
 * and the delivery worker sends it exactly like an event.
 */
final class TestTemplate implements TemplateInterface
{
    public function render(HubEvent $event, RenderContext $context): RenderedMessage
    {
        $subject = is_array($event->payload['subject'] ?? null) ? $event->payload['subject'] : [];
        $system = is_array($subject['system'] ?? null) ? $subject['system'] : [];
        $url = trim((string)($system['public_url'] ?? ''));
        $bot = trim((string)($system['bot_title'] ?? ''));

        return new RenderedMessage(
            title: '🔔 ' . $context->texts->t('module_messenger_hub_EventTypeTest'),
            lines: [
                $context->texts->t('module_messenger_hub_TestMessage', ['url' => $url !== '' ? $url : 'MikoPBX']),
            ],
            notes: $bot !== '' ? [$bot] : [],
        );
    }
}
