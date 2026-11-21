<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Channels;

/**
 * One audio part of a delivery (stage 3a): a local MP3 file, a plain-text caption (the channel escapes
 * it exactly once) and, for MAX, the upload token of a previous `attachment.not.ready` answer.
 *
 * The file path never reaches a log, an error code or REST.
 */
final class AttachmentPart
{
    public function __construct(
        public readonly string $filePath,
        public readonly string $caption = '',
        public readonly string $pendingToken = '',
    ) {
    }
}
