<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\RestAPI\Common;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModuleMessengerHub\Lib\Support\HubLogger;
use Throwable;

/**
 * Runs a processor action and turns its outcome into the PBXApiResult envelope.
 *
 * Domain exceptions become 400 / 404 / 422 with a safe message; anything else is logged and answered
 * with a generic 500 (no internals, no secrets). Validation errors are the admin's input and are not logged.
 */
final class Responder
{
    /** @param callable(): array{0: mixed, 1?: int} $action returns [data, httpCode] */
    public static function handle(string $processor, string $function, callable $action): PBXApiResult
    {
        $result = new PBXApiResult();
        $result->processor = $processor;
        $result->function = $function;
        try {
            $outcome = $action();
            $result->success = true;
            $result->data = is_array($outcome[0]) ? $outcome[0] : ['result' => $outcome[0]];
            $result->httpCode = $outcome[1] ?? 200;
        } catch (ValidationException $exception) {
            self::fail($result, 422, 'validation_error', $exception->getMessage());
            if ($exception->field !== '') {
                $result->data['field'] = $exception->field;
            }
        } catch (NotFoundException $exception) {
            self::fail($result, 404, 'not_found', $exception->getMessage());
        } catch (UnknownActionException $exception) {
            self::fail($result, 400, 'unknown_action', $exception->getMessage());
        } catch (Throwable $exception) {
            HubLogger::event('rest', 'request_failed', [
                'resource' => self::resourceOf($processor),
                'action' => $function,
                'error' => $exception::class,
            ], LOG_ERR);
            self::fail($result, 500, 'internal_error', 'internal_error');
        }

        return $result;
    }

    /** @param array<string, mixed> $request */
    public static function data(array $request): array
    {
        return is_array($request['data'] ?? null) ? $request['data'] : [];
    }

    /**
     * limit/offset from the request, bounded to the agreed defaults (Plan/06).
     *
     * @param array<string, mixed> $data
     * @return array{0: int, 1: int}
     */
    public static function page(array $data, int $defaultLimit = 50, int $maxLimit = 200): array
    {
        $limit = (int)($data['limit'] ?? $defaultLimit);
        $offset = (int)($data['offset'] ?? 0);

        return [max(1, min($maxLimit, $limit ?: $defaultLimit)), max(0, $offset)];
    }

    private static function resourceOf(string $processor): string
    {
        // Modules\ModuleMessengerHub\Lib\RestAPI\Settings\Processor -> settings
        $parts = explode('\\', $processor);

        return strtolower($parts[count($parts) - 2] ?? $processor);
    }

    private static function fail(PBXApiResult $result, int $code, string $error, string $message): void
    {
        $result->success = false;
        $result->httpCode = $code;
        $result->data = ['error' => $error];
        $result->messages['error'][] = $message;
    }
}
