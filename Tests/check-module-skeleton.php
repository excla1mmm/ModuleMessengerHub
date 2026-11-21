<?php

declare(strict_types=1);

// Stage 0 skeleton contract: metadata, translation catalogs, PHP syntax, agent docs.

$root = dirname(__DIR__);
$moduleId = 'ModuleMessengerHub';
$failures = [];

$fail = static function (string $message) use (&$failures): void {
    $failures[] = $message;
};

// module.json
$meta = json_decode((string)file_get_contents($root . '/module.json'), true);
if (!is_array($meta)) {
    $fail('module.json is not valid JSON');
} else {
    if (($meta['moduleUniqueID'] ?? '') !== $moduleId) {
        $fail('module.json moduleUniqueID must be ' . $moduleId);
    }
    if (($meta['min_pbx_version'] ?? '') !== '2025.1.1') {
        $fail('module.json min_pbx_version must be 2025.1.1');
    }
    if (!isset($meta['version'])) {
        $fail('module.json must contain version');
    }
}

// Translation catalogs: 29 locales, standalone literal arrays, registration keys present.
$locales = [
    'az', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'hr', 'hu', 'it', 'ja', 'ka', 'ko',
    'mn', 'nl', 'pl', 'pt', 'pt_BR', 'ro', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh_Hans', 'zh_TW',
];
$registrationKeys = [
    'AdditionalMenuItem' . $moduleId,
    'Breadcrumb' . $moduleId,
    'SubHeader' . $moduleId,
];
$forbiddenCatalogPattern = '/(require|include)(_once)?\s*\(?\s*(__DIR__|__FILE__|\$[A-Za-z_]|[\'"][^\'"]*\.php)|\b(array_keys|array_combine|array_merge)\s*\(/';

foreach ($locales as $locale) {
    $file = $root . '/Messages/' . $locale . '.php';
    if (!is_file($file)) {
        $fail('missing catalog Messages/' . $locale . '.php');
        continue;
    }
    $source = (string)file_get_contents($file);
    if (preg_match($forbiddenCatalogPattern, $source) === 1) {
        $fail('Messages/' . $locale . '.php must return a standalone literal array');
    }
    $catalog = require $file;
    if (!is_array($catalog)) {
        $fail('Messages/' . $locale . '.php must return an array');
        continue;
    }
    foreach ($registrationKeys as $key) {
        if (!isset($catalog[$key]) || trim((string)$catalog[$key]) === '') {
            $fail('Messages/' . $locale . '.php misses ' . $key);
        }
    }
    foreach ($catalog as $key => $value) {
        if (!is_string($key) || !is_string($value)) {
            $fail('Messages/' . $locale . '.php has a non-string key or value');
            break;
        }
    }
}
$extraCatalogs = array_diff(
    array_map(static fn (string $f): string => basename($f, '.php'), glob($root . '/Messages/*.php') ?: []),
    $locales
);
if ($extraCatalogs !== []) {
    $fail('unexpected catalogs: ' . implode(', ', $extraCatalogs));
}

// PHP files: strict types header, no closing tag, valid syntax.
$php = PHP_BINARY ?: 'php';
$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
foreach ($iterator as $file) {
    $path = $file->getPathname();
    if (!str_ends_with($path, '.php') || str_contains($path, '/vendor/') || str_contains($path, '/.git/')) {
        continue;
    }
    $relative = substr($path, strlen($root) + 1);
    $source = (string)file_get_contents($path);
    if (!str_starts_with($source, "<?php\n\ndeclare(strict_types=1);")) {
        $fail($relative . ' must start with "<?php" + blank line + declare(strict_types=1);');
    }
    if (preg_match('/\?>\s*$/', $source) === 1) {
        $fail($relative . ' must not end with a closing PHP tag');
    }
    exec(escapeshellarg($php) . ' -l ' . escapeshellarg($path) . ' 2>&1', $output, $code);
    if ($code !== 0) {
        $fail($relative . ' has syntax errors: ' . implode(' ', $output));
    }
    $output = [];
}

// Required project files.
foreach ([
    'AGENTS.md', 'CLAUDE.md', 'README.md', 'README.ru.md', 'CHANGELOG.md',
    'Plan/README.md', 'Plan/09-roadmap.md', 'Plan/11-open-questions.md',
    'Setup/PbxExtensionSetup.php', 'Lib/MessengerHubConf.php',
    'scripts/package-module.sh', '.gitlab-ci.yml',
] as $required) {
    if (!is_file($root . '/' . $required)) {
        $fail('missing ' . $required);
    }
}

if ($failures !== []) {
    fwrite(STDERR, implode(PHP_EOL, $failures) . PHP_EOL);
    exit(1);
}

echo "module skeleton OK\n";
