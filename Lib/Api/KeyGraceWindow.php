<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Api;

use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;

/**
 * Grace period after a hub key change (Plan/08-reliability.md).
 *
 * Core keeps the old permissions of an API key in its token cache for about 5 minutes (also inside its
 * own API worker, which the hub cannot clear). Right after the hub created, updated or repaired its key,
 * a 401/403 from a source poll is therefore transient. The deadline lives in hub settings so that a
 * collector restart keeps it and so that the settings REST (another process) can start it too.
 */
final class KeyGraceWindow
{
    public const int GRACE_SEC = 360;

    public function __construct(private readonly HubSettings $settings)
    {
    }

    /** Starts (or restarts) the window; called after any change of allowed_paths, levels or network filter. */
    public function start(int $now): void
    {
        $this->settings->set(HubSettings::HUB_API_KEY_GRACE_UNTIL, (string)($now + self::GRACE_SEC));
    }

    /** First collector pass after install or update: starts the window once, when it was never started. */
    public function ensureStarted(int $now): void
    {
        if ($this->settings->get(HubSettings::HUB_API_KEY_GRACE_UNTIL) === '') {
            $this->start($now);
        }
    }

    public function active(int $now): bool
    {
        return (int)$this->settings->get(HubSettings::HUB_API_KEY_GRACE_UNTIL) > $now;
    }
}
