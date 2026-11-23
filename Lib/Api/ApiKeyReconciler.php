<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Api;

use Modules\ModuleMessengerHub\Lib\Routing\RuleRepository;
use Modules\ModuleMessengerHub\Lib\Sources\ApiKeyPaths;
use Modules\ModuleMessengerHub\Lib\Sources\ModuleStatusProbe;
use Modules\ModuleMessengerHub\Lib\Sources\SourceRegistry;
use Modules\ModuleMessengerHub\Lib\Sources\SourceStateRepository;
use Throwable;

/**
 * Applies the wanted hub-key path set right away (Q15): enabled sources whose module is available,
 * plus `/api/v3/cdr` while an enabled rule attaches attention-call audio. Used by the settings PATCH
 * and by the rules REST so a toggle or a rule edit does not wait for the collector's one-minute cycle.
 * Never throws: the collector worker reconciles the key anyway.
 */
final class ApiKeyReconciler
{
    public function __construct(
        private readonly ?ApiKeySync $sync,
        private readonly SourceStateRepository $states,
        private readonly RuleRepository $rules,
        private readonly ?ModuleStatusProbe $probe,
    ) {
    }

    public function apply(): void
    {
        if ($this->sync === null || $this->probe === null) {
            return;
        }
        try {
            $probe = $this->probe;
            $paths = ApiKeyPaths::compute(
                SourceRegistry::default()->pollSources(),
                fn (string $id): bool => $this->states->isEnabled($id),
                static fn (string $module): string => $probe->status($module)
            );
            $paths = ApiKeyPaths::attentionCdr($paths, $this->rules->needsAttentionAttachments());
            $this->sync->sync($paths);
        } catch (Throwable) {
            // the collector worker reconciles the key within a minute
        }
    }
}
