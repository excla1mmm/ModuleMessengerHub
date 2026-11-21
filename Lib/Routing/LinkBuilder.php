<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Routing;

/**
 * Builds the "open the call" button URL (Plan/05, client spec moduleaisupervisor#10, Q16).
 *
 * Sources may put a ready link into payload.links.call_card. Otherwise:
 *  - AI Supervisor calls open the call card of the module by its URL contract
 *    (`ais_screen=calls&ais_card=<ref_id>`, `react-app/src/call-list-target.js`):
 *    `{public}/admin-cabinet/module-a-i-supervisor/module-a-i-supervisor/index?ais_screen=calls&ais_card=N`;
 *  - Core calls open the CDR journal; the Core page has no search-by-URL for `linkedid`, so the
 *    journal is the deepest link available (Q16).
 * With no public URL the button is omitted.
 */
final class LinkBuilder
{
    public const string AI_SUPERVISOR_PAGE = '/admin-cabinet/module-a-i-supervisor/module-a-i-supervisor/index';
    public const string CALL_JOURNAL_PAGE = '/admin-cabinet/call-detail-records/index';

    public function __construct(private readonly string $publicUrl = '')
    {
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function callCard(array $payload, string $eventType): string
    {
        $links = $payload['links'] ?? null;
        if (is_array($links) && is_string($links['call_card'] ?? null) && self::allowed($links['call_card'])) {
            return $links['call_card'];
        }
        $base = rtrim(trim($this->publicUrl), '/');
        if (!self::allowed($base)) {
            return '';
        }
        if ($eventType === 'ai_supervisor.attention_call') {
            $refId = (int)($payload['subject']['attention']['ref_id'] ?? 0);
            $query = $refId > 0 ? '?ais_screen=calls&ais_card=' . $refId : '';

            return $base . self::AI_SUPERVISOR_PAGE . $query;
        }

        return $base . self::CALL_JOURNAL_PAGE;
    }

    private static function allowed(string $url): bool
    {
        return preg_match('~^https?://~i', $url) === 1;
    }
}
