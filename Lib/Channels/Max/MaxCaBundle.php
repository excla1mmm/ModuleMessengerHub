<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels\Max;

use Modules\ModuleMessengerHub\Lib\Settings\HubSettings;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;

/**
 * Trust anchor for platform-api2.max.ru (Plan/03-channels.md, "Корневой сертификат НУЦ Минцифры").
 *
 * MAX serves a certificate chained to the Russian Trusted Root CA of the Ministry of Digital
 * Development, which the station does not have. Only the Root CA is shipped: MAX sends the
 * intermediate `Russian Trusted Sub CA` in the handshake itself (checked 21.11.2026), so a rotating
 * sub CA never needs a new module version. Every certificate in the shipped file is checked against a
 * pinned SHA-256 fingerprint before use.
 *
 * The transport gets a bundle, not the system store replacement: system CAs + the shipped PEM,
 * built once per content hash under the system temp dir. Only the MAX transport is given that path,
 * so Telegram and the station trust store stay untouched, and TLS verification is never disabled.
 *
 * Settings `max_ca_bundle_path` overrides the shipped file (an admin can install a rotated sub CA).
 * A tampered shipped file is not used at all: verification stays on and the send fails closed with
 * max.tls.untrusted_ca.
 */
final class MaxCaBundle
{
    public const string SHIPPED = __DIR__ . '/certs/russian_trusted_ca.pem';

    /**
     * SHA-256 of the DER body, uppercase with colons. Source:
     * https://gu-st.ru/content/Other/doc/russiantrustedca.pem (checked 21.11.2026). Only the Root CA:
     * the Sub CA is not a trust anchor and comes from the server, so it is not pinned and not shipped.
     */
    private const array PINNED_SHA256 = [
        'D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31' => true,
    ];

    /** Common CA store locations of the stations and images the module runs on. */
    private const array SYSTEM_CA_FILES = [
        '/etc/ssl/certs/ca-certificates.crt',
        '/etc/pki/tls/certs/ca-bundle.crt',
        '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem',
        '/etc/ssl/cert.pem',
    ];

    /** @var array{override: string, path: string}|null per-process cache of the built bundle */
    private static ?array $resolved = null;

    /**
     * Path curl must use as CAINFO for MAX, or '' when nothing trustworthy is available (the caller
     * then keeps the system store and TLS fails closed). Cached per process: every registry rebuild
     * would otherwise hash the whole station CA store again.
     */
    public static function resolve(HubSettings $settings): string
    {
        $override = $settings->maxCaBundlePath();
        if (self::$resolved !== null && self::$resolved['override'] === $override
            && is_file(self::$resolved['path'])) {
            return self::$resolved['path'];
        }

        $path = self::build($override);
        self::$resolved = ['override' => $override, 'path' => $path];

        return $path;
    }

    private static function build(string $override): string
    {
        if ($override !== '') {
            if (self::hasCertificate($override)) {
                // an admin-supplied trust anchor is a configuration change worth seeing in the log
                HubLogger::event('max', 'ca_override_used', [], LOG_WARNING);

                return $override;
            }
            // a broken setting must not take the channel down: fall back to the verified shipped file
            HubLogger::event('max', 'ca_override_rejected', [], LOG_WARNING);
        }

        $shipped = self::shippedPem();
        if ($shipped === '') {
            return '';
        }

        $content = self::systemBundle() . $shipped;
        $path = self::materialise($content);

        return $path === '' ? self::SHIPPED : $path;
    }

    /**
     * True when the file is a readable PEM with at least one certificate. An admin override may carry
     * a rotated sub CA (2027), so it is not checked against the pins — only against being a certificate.
     */
    public static function hasCertificate(string $file): bool
    {
        if (!is_file($file) || !is_readable($file)) {
            return false;
        }

        return self::pemBlocks((string)file_get_contents($file)) !== [];
    }

    /** True when every certificate of $file matches a pinned fingerprint and nothing else is inside. */
    public static function verify(string $file): bool
    {
        if (!is_file($file) || !is_readable($file)) {
            return false;
        }

        return self::verifyPem((string)file_get_contents($file));
    }

    /** SHA-256 of the DER body as XX:XX:…, the form `openssl x509 -fingerprint -sha256` prints. */
    public static function fingerprint(string $pemBlock): string
    {
        $body = preg_replace('/-----(BEGIN|END) CERTIFICATE-----/', '', $pemBlock) ?? '';
        $der = base64_decode((string)preg_replace('/\s+/', '', $body), true);
        if ($der === false) {
            return '';
        }

        return strtoupper(implode(':', str_split(hash('sha256', $der), 2)));
    }

    /** The shipped PEM, or '' when it is missing or was modified (fail closed, never silently trust). */
    private static function shippedPem(): string
    {
        // read once and verify this very string: re-reading the file would reopen a TOCTOU window
        $pem = is_file(self::SHIPPED) ? (string)@file_get_contents(self::SHIPPED) : '';
        if ($pem === '' || !self::verifyPem($pem)) {
            HubLogger::event('max', 'ca_bundle_invalid', [], LOG_ERR);

            return '';
        }

        return $pem;
    }

    private static function verifyPem(string $pem): bool
    {
        $blocks = self::pemBlocks($pem);
        if ($blocks === []) {
            return false;
        }
        foreach ($blocks as $block) {
            if (!isset(self::PINNED_SHA256[self::fingerprint($block)])) {
                return false;
            }
        }

        return true;
    }

    /** The station CA store, so a bundle still validates anything signed by a public CA. */
    private static function systemBundle(): string
    {
        $candidates = [];
        $ini = (string)ini_get('curl.cainfo');
        if ($ini !== '') {
            $candidates[] = $ini;
        }
        $candidates = [...$candidates, ...self::SYSTEM_CA_FILES];
        foreach ($candidates as $file) {
            if (is_file($file) && is_readable($file)) {
                $content = (string)file_get_contents($file);
                if ($content !== '') {
                    return rtrim($content) . "\n";
                }
            }
        }

        return '';
    }

    /**
     * Writes the bundle once per content hash and returns its path ('' when it cannot be written).
     *
     * The temp dir is shared with other local users, so the directory and the file are validated
     * before use: a pre-created directory or a symlink planted by somebody else must never become a
     * trust anchor for MAX (that would be a token-intercepting MITM).
     */
    private static function materialise(string $content): string
    {
        $dir = sys_get_temp_dir() . '/module-messenger-hub-ca-' . self::uid();
        if (!self::trustedDir($dir)) {
            HubLogger::event('max', 'ca_bundle_unwritable', [], LOG_WARNING);

            return '';
        }
        $hash = hash('sha256', $content);
        $path = $dir . '/' . $hash . '.pem';
        if (self::trustedFile($path, $hash)) {
            return $path;
        }
        $tmp = @tempnam($dir, 'ca-');
        if ($tmp === false) {
            HubLogger::event('max', 'ca_bundle_unwritable', [], LOG_WARNING);

            return '';
        }
        if (@file_put_contents($tmp, $content) === false || !@chmod($tmp, 0600) || !@rename($tmp, $path)) {
            @unlink($tmp);
            HubLogger::event('max', 'ca_bundle_unwritable', [], LOG_WARNING);

            return '';
        }

        return self::trustedFile($path, $hash) ? $path : '';
    }

    /** A directory we own, mode 0700, not a symlink; created when absent. */
    private static function trustedDir(string $dir): bool
    {
        if (is_link($dir) || (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir))) {
            return false;
        }

        return !is_link($dir)
            && is_dir($dir)
            && @fileowner($dir) === self::uid()
            && ((int)@fileperms($dir) & 0x1FF) === 0x1C0; // 0700
    }

    /** A regular file we own, no symlink, whose content still matches the hash in its name. */
    private static function trustedFile(string $path, string $hash): bool
    {
        if (is_link($path) || !is_file($path) || @fileowner($path) !== self::uid()) {
            return false;
        }

        return hash('sha256', (string)@file_get_contents($path)) === $hash;
    }

    private static function uid(): int
    {
        return function_exists('posix_geteuid') ? (int)posix_geteuid() : 0;
    }

    /** @return list<string> the certificate blocks of a PEM file */
    private static function pemBlocks(string $pem): array
    {
        $count = preg_match_all('/-----BEGIN CERTIFICATE-----.+?-----END CERTIFICATE-----/s', $pem, $matches);
        if ($count === false || $count === 0) {
            return [];
        }

        return array_values(array_filter($matches[0] ?? [], 'is_string'));
    }
}
