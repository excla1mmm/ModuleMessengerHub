<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Attachments;

/**
 * Finds external audio tools without a shell (Plan/03, Q7). Nothing is installed or modified; a
 * missing tool simply degrades delivery to text.
 */
final class ToolFinder
{
    private const array DEFAULT_DIRS = [
        '/usr/bin',
        '/usr/local/bin',
        '/bin',
        '/sbin',
        '/usr/sbin',
        '/opt/homebrew/bin',
        '/opt/local/bin',
    ];

    /** @var array<string, string> name => executable path ('' = missing) */
    private array $resolved = [];

    /** @param array<string, string> $overrides explicit name => path, for the unit checks */
    public function __construct(private readonly array $overrides = [])
    {
    }

    public static function system(): self
    {
        return new self();
    }

    public function path(string $name): string
    {
        if (array_key_exists($name, $this->resolved)) {
            return $this->resolved[$name];
        }
        if (isset($this->overrides[$name])) {
            $path = $this->overrides[$name];

            return $this->resolved[$name] = is_file($path) && is_executable($path) ? $path : '';
        }
        if (str_contains($name, '/')) {
            return $this->resolved[$name] = is_file($name) && is_executable($name) ? $name : '';
        }
        foreach (self::DEFAULT_DIRS as $dir) {
            $candidate = $dir . '/' . $name;
            if (is_file($candidate) && is_executable($candidate)) {
                return $this->resolved[$name] = $candidate;
            }
        }

        return $this->resolved[$name] = '';
    }

    public function has(string $name): bool
    {
        return $this->path($name) !== '';
    }
}
