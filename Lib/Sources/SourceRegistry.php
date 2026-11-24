<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Sources;

use InvalidArgumentException;

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
     * Core glue is lazy and read-only (Lib/Support/*): the internal-number map (Q12), the SIP extension
     * list of the auth-failure source and the settings snapshot of the security thresholds; all three run
     * only inside the collector worker at poll time, never in a Core hook.
     *
     * Stage 3b: one ModuleStatusSource per kind of problem (a wizard scenario); all read `/status` only.
     * Stage 4s-A: the security sources (toll fraud, new device, SIP auth failures).
     */
    public static function default(): self
    {
        $settingsValues = static function (): array {
            $settings = new \Modules\ModuleMessengerHub\Lib\Settings\HubSettings(
                new \Modules\ModuleMessengerHub\Lib\Storage\PhalconHubDatabase()
            );
            $values = [];
            foreach (array_keys(\Modules\ModuleMessengerHub\Lib\Settings\HubSettings::DEFAULTS) as $key) {
                $values[(string)$key] = $settings->get((string)$key);
            }

            return $values;
        };
        $internalMap = static fn (): array => \Modules\ModuleMessengerHub\Lib\Support\InternalNumbersLoader::load();

        $sources = [
            new Core\MissedCallSource(),
            new Core\VoicemailSource(),
            new Core\ProviderStatusSource(),
            new Core\PbxStartedSource(),
            new Core\AdviceSource(),
            new Core\TollFraudSource(
                static fn (): Core\TollFraudPolicy => Core\TollFraudPolicy::fromHubSettingsValues($settingsValues()),
                $internalMap
            ),
            new Core\ExtensionNewDeviceSource(),
            new Core\SipAuthFailureSource(
                static fn (): array => \Modules\ModuleMessengerHub\Lib\Support\AuthFailureTargetsLoader::load(),
                $settingsValues
            ),
            new Modules\AiAttentionCallSource($internalMap),
            new Modules\VaCallbackSource(),
            new Modules\VaRuntimeSource(),
        ];
        foreach (Modules\ModuleStatusSource::profiles() as $profile) {
            $sources[] = new Modules\ModuleStatusSource($profile);
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
