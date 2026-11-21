<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

use Modules\ModuleMessengerHub\Lib\Channels\Max\MaxApi;
use Modules\ModuleMessengerHub\Lib\Channels\Max\MaxCaBundle;
use Modules\ModuleMessengerHub\Lib\Channels\Max\MaxChannel;
use Modules\ModuleMessengerHub\Lib\Channels\Telegram\TelegramApi;
use Modules\ModuleMessengerHub\Lib\Channels\Telegram\TelegramChannel;
use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;

/**
 * The one place that builds channel adapters (Plan/03, Plan/09 stage 3b).
 *
 * REST checks, the delivery worker and the discovery worker all ask here, so a channel is added,
 * and its transport configured, exactly once. Settings that must not need a worker restart (proxy,
 * MAX CA bundle) are read on every rebuild of the registry.
 *
 * Both channels honour `proxy_url`; only MAX gets the Минцифры CA bundle, so Telegram and the
 * station trust store stay untouched (MaxCaBundle).
 */
final class ChannelFactory
{
    public static function create(
        HubSettings $settings,
        int $timeoutSec = 15,
        int $connectTimeoutSec = 5,
    ): ChannelRegistry {
        return new ChannelRegistry([
            new TelegramChannel(new TelegramApi(self::transportFor(TelegramChannel::ID, $settings, $timeoutSec, $connectTimeoutSec))),
            new MaxChannel(new MaxApi(self::transportFor(MaxChannel::ID, $settings, $timeoutSec, $connectTimeoutSec))),
        ]);
    }

    /**
     * The transport of one channel. Exposed so a contract check can prove that the CA bundle reaches
     * only MAX and that TLS verification is on for both.
     */
    public static function transportFor(
        string $channel,
        HubSettings $settings,
        int $timeoutSec = 15,
        int $connectTimeoutSec = 5,
    ): HttpTransport {
        return new HttpTransport(
            proxyUrl: $settings->proxyUrl(),
            caBundlePath: $channel === MaxChannel::ID ? MaxCaBundle::resolve($settings) : '',
            timeoutSec: $timeoutSec,
            connectTimeoutSec: $connectTimeoutSec,
        );
    }
}
