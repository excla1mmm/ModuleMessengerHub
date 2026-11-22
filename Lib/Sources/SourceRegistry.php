<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

use InvalidArgumentException;
use Modules\ModuleMessengerHub\Lib\Sources\Modules\StatusCapabilityStore;

/**
 * The list of all event sources the hub knows about (Plan/02-sources.md).
 *
 * Register new adapters in default(); ids must be unique.
 */
final class SourceRegistry
{
    /** @var array<string, SourceInterface> */
    private array $sources = [];

    /** @param list<SourceInterface> $sources */
    public function __construct(array $sources)
    {
        foreach ($sources as $source) {
            $id = $source->id();
            if (isset($this->sources[$id])) {
                throw new InvalidArgumentException('duplicate source id ' . $id);
            }
            $this->sources[$id] = $source;
        }
    }

    /**
     * Production registry. Stage 1.2/1.3 adapters are added here.
     * The employee-map provider is the only Core glue (Lib/Support/InternalNumbersLoader, Plan/11 Q12);
     * it runs lazily at poll time inside the collector worker.
     *
     * Stage 3b-1: one ModuleStatusSource per module with a `/status` resource. The capability store
     * tells whether the fallback to `/workers` is still needed (AI Supervisor, TODO(#1)); without a
     * store the answer is "not checked yet", which keeps both paths in the key until the first poll.
     */
    public static function default(?StatusCapabilityStore $statusCapabilities = null): self
    {
        $sources = [
            new Core\MissedCallSource(),
            new Core\VoicemailSource(),
            new Core\ProviderStatusSource(),
            new Core\PbxStartedSource(),
            new Core\AdviceSource(),
            new Modules\AiAttentionCallSource(
                static fn (): array => \Modules\ModuleMessengerHub\Lib\Support\InternalNumbersLoader::load()
            ),
            new Modules\VaCallbackSource(),
            new Modules\VaRuntimeSource(),
        ];
        foreach (Modules\ModuleStatusSource::profiles() as $profile) {
            $sources[] = new Modules\ModuleStatusSource($profile, $statusCapabilities);
        }

        return new self($sources);
    }

    /** @return list<SourceInterface> */
    public function all(): array
    {
        return array_values($this->sources);
    }

    public function find(string $id): ?SourceInterface
    {
        return $this->sources[$id] ?? null;
    }

    /** @return list<SourceInterface> */
    public function pollSources(): array
    {
        return array_values(array_filter(
            $this->sources,
            static fn (SourceInterface $s): bool => $s->mode() === SourceInterface::MODE_POLL
        ));
    }

    /** @return list<AmiEventSource&SourceInterface> */
    public function amiSources(): array
    {
        return array_values(array_filter(
            $this->sources,
            static fn (SourceInterface $s): bool => $s instanceof AmiEventSource
        ));
    }

    /**
     * Core REST paths the hub API key must be able to read, for the given enabled source ids.
     *
     * @param list<string> $enabledIds
     * @return list<string> sorted, unique
     */
    public function apiReadPaths(array $enabledIds): array
    {
        $paths = [];
        foreach ($enabledIds as $id) {
            foreach ($this->find($id)?->apiReadPaths() ?? [] as $path) {
                $paths[$path] = true;
            }
        }
        $paths = array_keys($paths);
        sort($paths, SORT_STRING);

        return $paths;
    }
}
