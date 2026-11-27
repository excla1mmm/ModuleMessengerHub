<?php

declare(strict_types=1);

// Admin UI escaping contract (EGOR-52): esc() is safe inside quoted attributes, Fomantic dropdown
// `name` values (rendered as HTML) are escaped, and the shipped JS carries no inline source map.

$root = dirname(__DIR__);
$srcPath = $root . '/public/assets/js/src/module-messenger-hub-index.js';
$builtPath = $root . '/public/assets/js/module-messenger-hub-index.js';
$failures = [];

$fail = static function (string $message) use (&$failures): void {
    $failures[] = $message;
};

$src = (string)file_get_contents($srcPath);
$built = (string)file_get_contents($builtPath);
if ($src === '' || $built === '') {
    fwrite(STDERR, "admin UI JS not found\n");
    exit(1);
}

// 1. esc() replaces all five HTML-significant characters, & first.
if (preg_match('/function esc\(value\) \{(.*?)\n    \}/s', $src, $m) !== 1) {
    $fail('esc() not found in the JS source');
} else {
    $body = $m[1];
    $expected = [
        "replace(/&/g, '&amp;')",
        "replace(/</g, '&lt;')",
        "replace(/>/g, '&gt;')",
        "replace(/\"/g, '&quot;')",
        "replace(/'/g, '&#39;')",
    ];
    $positions = [];
    foreach ($expected as $needle) {
        $pos = strpos($body, $needle);
        if ($pos === false) {
            $fail('esc() does not escape: ' . $needle);
        }
        $positions[] = $pos;
    }
    if (!in_array(false, $positions, true) && min($positions) !== $positions[0]) {
        $fail('esc() must replace & before the other characters');
    }
}

// 2. No hand-made quote fixes on top of esc() are left (esc() covers attributes now).
if (preg_match('/esc\([^)]*\)\.replace\(/', $src) === 1) {
    $fail('esc(...).replace(...) left in the JS source');
}

// 3. Every `name:` passed to a Fomantic dropdown `values` list is escaped (esc) or a catalog string (t).
$checkNames = static function (string $block, string $where) use ($fail): void {
    if (preg_match_all('/\bname:\s*([^,}\n]+)/', $block, $names) === false) {
        return;
    }
    foreach ($names[1] as $value) {
        $value = trim($value);
        if (!str_starts_with($value, 'esc(') && !str_starts_with($value, 't(')) {
            $fail(sprintf('dropdown name not escaped in %s: %s', $where, $value));
        }
    }
};

$dropdowns = preg_match_all('/\.dropdown\(\{\s*values:(.*?)(?:placeholder:|onChange:|message:)/s', $src, $blocks, PREG_OFFSET_CAPTURE);
if ($dropdowns < 4) {
    $fail('expected at least 4 dropdowns with values, found ' . (int)$dropdowns);
}
foreach ($blocks[1] as [$block, $offset]) {
    $checkNames($block, 'dropdown at line ' . (substr_count($src, "\n", 0, $offset) + 1));
}
if (preg_match('/function menuToValues\(items\) \{(.*?)\n    \}/s', $src, $menu) !== 1) {
    $fail('menuToValues() not found');
} else {
    $checkNames($menu[1], 'menuToValues()');
}

// 4. The compiled file matches the fix and ships without an inline source map.
if (str_contains($built, 'sourceMappingURL')) {
    $fail('compiled JS carries a source map; build without --source-maps');
}
if (!str_contains($built, ".replace(/\"/g, '&quot;').replace(/'/g, '&#39;')")) {
    $fail('compiled JS is stale: esc() without quote escaping');
}
if (str_contains($built, "\$('<div/>').text(")) {
    $fail('compiled JS is stale: old jQuery-based esc()');
}

if ($failures !== []) {
    fwrite(STDERR, implode(PHP_EOL, $failures) . PHP_EOL);
    exit(1);
}

echo "admin UI escaping OK\n";
