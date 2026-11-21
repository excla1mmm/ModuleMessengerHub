<?php

declare(strict_types=1);

namespace Modules\ModuleMessengerHub\Lib\Delivery;

/**
 * Per-part progress of one delivery (Plan/03, decision 3a-1; Plan/08).
 *
 * One Outbox row is a main text + N audio parts + an optional short fallback note. Every part has its
 * own state; `sending` is persisted BEFORE the channel call, so a restart or an expired lease can
 * never turn a sent part back into `pending` (no duplicate text, no duplicate audio).
 */
final class DeliveryState
{
    public const string PENDING = 'pending';
    public const string SENDING = 'sending';
    public const string SENT = 'sent';
    public const string SKIPPED = 'skipped';
    public const string FAILED = 'failed';
    public const string NONE = 'none';

    public string $textState = self::PENDING;
    public string $textId = '';
    public string $textCode = '';

    public string $noteState = self::NONE;
    public string $noteId = '';
    public string $noteCode = '';
    public int $noteAttempts = 0;

    /** none | pending | sent | partial | skipped | failed */
    public string $attachmentState = self::NONE;
    public string $attachmentCode = '';
    public int $attachmentAttempts = 0;

    /** @var array<int|string, array<string, mixed>> part index => {state,id,code,token,not_ready,start_ms,end_ms} */
    public array $audio = [];

    /** @param array<string, mixed> $fragments plan fragments: index => {start_ms,end_ms} */
    public static function start(?array $fragments): self
    {
        $state = new self();
        if ($fragments !== null) {
            foreach (array_values($fragments) as $index => $fragment) {
                $state->audio[$index] = [
                    'state' => self::PENDING,
                    'id' => '',
                    'code' => '',
                    'token' => '',
                    'not_ready' => 0,
                    'attempts' => 0,
                    'start_ms' => (int)($fragment['start_ms'] ?? 0),
                    'end_ms' => (int)($fragment['end_ms'] ?? 0),
                ];
            }
            if ($state->audio !== []) {
                $state->attachmentState = self::PENDING;
            }
        }

        return $state;
    }

    public static function fromJson(?string $json): self
    {
        $state = new self();
        $data = json_decode((string)$json, true);
        if (!is_array($data)) {
            return $state;
        }
        $text = is_array($data['text'] ?? null) ? $data['text'] : [];
        $note = is_array($data['note'] ?? null) ? $data['note'] : [];
        $attachment = is_array($data['attachment'] ?? null) ? $data['attachment'] : [];
        $state->textState = self::known((string)($text['state'] ?? self::PENDING));
        $state->textId = (string)($text['id'] ?? '');
        $state->textCode = (string)($text['code'] ?? '');
        $state->noteState = self::known(
            (string)($note['state'] ?? self::NONE),
            [self::NONE, self::PENDING, self::SENDING, self::SENT, self::FAILED]
        );
        $state->noteId = (string)($note['id'] ?? '');
        $state->noteCode = (string)($note['code'] ?? '');
        $state->noteAttempts = (int)($note['attempts'] ?? 0);
        $state->attachmentState = self::known(
            (string)($attachment['state'] ?? self::NONE),
            [self::NONE, self::PENDING, self::SENT, 'partial', self::SKIPPED, self::FAILED]
        );
        $state->attachmentCode = (string)($attachment['code'] ?? '');
        $state->attachmentAttempts = (int)($attachment['attempts'] ?? 0);
        foreach (is_array($data['audio'] ?? null) ? $data['audio'] : [] as $index => $part) {
            if (!is_array($part)) {
                continue;
            }
            $state->audio[$index] = [
                'state' => self::known((string)($part['state'] ?? self::PENDING)),
                'id' => (string)($part['id'] ?? ''),
                'code' => (string)($part['code'] ?? ''),
                'token' => (string)($part['token'] ?? ''),
                'not_ready' => (int)($part['not_ready'] ?? 0),
                'attempts' => (int)($part['attempts'] ?? 0),
                'start_ms' => (int)($part['start_ms'] ?? 0),
                'end_ms' => (int)($part['end_ms'] ?? 0),
            ];
        }

        return $state;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'text' => ['state' => $this->textState, 'id' => $this->textId, 'code' => $this->textCode],
            'note' => [
                'state' => $this->noteState,
                'id' => $this->noteId,
                'code' => $this->noteCode,
                'attempts' => $this->noteAttempts,
            ],
            'attachment' => [
                'state' => $this->attachmentState,
                'code' => $this->attachmentCode,
                'attempts' => $this->attachmentAttempts,
            ],
            'audio' => $this->audio,
        ];
    }

    /** @param array{start_ms?: int, end_ms?: int} $fragment */
    public function addAudio(int $index, array $fragment): void
    {
        if ($this->attachmentState === self::NONE) {
            $this->attachmentState = self::PENDING;
        }
        if (isset($this->audio[$index])) {
            return;
        }
        $this->audio[$index] = [
            'state' => self::PENDING,
            'id' => '',
            'code' => '',
            'token' => '',
            'not_ready' => 0,
            'attempts' => 0,
            'start_ms' => (int)($fragment['start_ms'] ?? 0),
            'end_ms' => (int)($fragment['end_ms'] ?? 0),
        ];
    }

    public function bumpAttachmentAttempt(): int
    {
        return ++$this->attachmentAttempts;
    }

    public function bumpNoteAttempt(): int
    {
        return ++$this->noteAttempts;
    }

    public function bumpAudioAttempt(int $index): int
    {
        if (!isset($this->audio[$index])) {
            return 0;
        }
        $this->audio[$index]['attempts'] = (int)($this->audio[$index]['attempts'] ?? 0) + 1;

        return (int)$this->audio[$index]['attempts'];
    }

    public function textDone(): bool
    {
        return $this->textState === self::SENT;
    }

    public function hasPendingAudio(): bool
    {
        foreach ($this->audio as $part) {
            if (in_array($part['state'], [self::PENDING, self::SENDING], true)) {
                return true;
            }
        }

        return false;
    }

    public function audioComplete(): bool
    {
        foreach ($this->audio as $part) {
            if (!in_array($part['state'], [self::SENT, self::SKIPPED], true)) {
                return false;
            }
        }

        return true;
    }

    public function isComplete(): bool
    {
        if (!$this->textDone()) {
            return false;
        }
        if (!$this->audioComplete()) {
            return false;
        }

        return !in_array($this->noteState, [self::PENDING, self::SENDING], true);
    }

    /** @return list<string> */
    public function externalIds(): array
    {
        $ids = [];
        if ($this->textId !== '') {
            $ids[] = $this->textId;
        }
        foreach ($this->audio as $part) {
            if (($part['state'] ?? '') === self::SENT && (string)($part['id'] ?? '') !== '') {
                $ids[] = (string)$part['id'];
            }
        }
        if ($this->noteId !== '') {
            $ids[] = $this->noteId;
        }

        return array_values(array_unique($ids));
    }

    public function markTextSending(): void
    {
        $this->textState = self::SENDING;
    }

    public function markTextSent(string $id, string $code = ''): void
    {
        $this->textState = self::SENT;
        $this->textId = $id;
        $this->textCode = $code;
    }

    public function markTextPending(string $code = ''): void
    {
        $this->textState = self::PENDING;
        $this->textCode = $code;
    }

    public function markTextFailed(string $code): void
    {
        $this->textState = self::FAILED;
        $this->textCode = $code;
    }

    /** @return array<string, mixed> */
    public function audioPart(int $index): array
    {
        return $this->audio[$index] ?? [];
    }

    public function markAudioSending(int $index): void
    {
        if (isset($this->audio[$index])) {
            $this->audio[$index]['state'] = self::SENDING;
        }
    }

    public function markAudioSent(int $index, string $id): void
    {
        if (isset($this->audio[$index])) {
            $this->audio[$index]['state'] = self::SENT;
            $this->audio[$index]['id'] = $id;
        }
    }

    public function markAudioPending(int $index, string $code = ''): void
    {
        if (isset($this->audio[$index])) {
            $this->audio[$index]['state'] = self::PENDING;
            $this->audio[$index]['code'] = $code;
        }
    }

    public function skipAudio(int $index, string $code): void
    {
        if (isset($this->audio[$index])) {
            $this->audio[$index]['state'] = self::SKIPPED;
            $this->audio[$index]['code'] = $code;
        }
    }

    /** Remembers the MAX token of an `attachment.not.ready` answer and counts the attempt. */
    public function markAudioNotReady(int $index, string $token): int
    {
        if (!isset($this->audio[$index])) {
            return 0;
        }
        $this->audio[$index]['state'] = self::PENDING;
        if ($token !== '') {
            $this->audio[$index]['token'] = $token;
        }
        $this->audio[$index]['not_ready'] = (int)$this->audio[$index]['not_ready'] + 1;

        return (int)$this->audio[$index]['not_ready'];
    }

    public function addNote(): void
    {
        if ($this->noteState === self::NONE) {
            $this->noteState = self::PENDING;
        }
    }

    public function hasNote(): bool
    {
        return $this->noteState !== self::NONE;
    }

    public function markNoteSending(): void
    {
        $this->noteState = self::SENDING;
    }

    public function markNoteSent(string $id, string $code = ''): void
    {
        $this->noteState = self::SENT;
        $this->noteId = $id;
        $this->noteCode = $code;
    }

    public function markNotePending(string $code = ''): void
    {
        $this->noteState = self::PENDING;
        $this->noteCode = $code;
    }

    public function markNoteFailed(string $code): void
    {
        $this->noteState = self::FAILED;
        $this->noteCode = $code;
    }

    public function attachmentSent(): void
    {
        $this->attachmentState = $this->audio === [] ? self::NONE : self::SENT;
    }

    public function attachmentSkipped(string $code): void
    {
        $this->attachmentState = self::SKIPPED;
        $this->attachmentCode = $code;
    }

    /** Any audio skipped but not all: the journal shows a partial delivery. */
    public function recalculateAttachment(): void
    {
        if ($this->audio === []) {
            return;
        }
        $sent = 0;
        $skipped = 0;
        foreach ($this->audio as $part) {
            if ($part['state'] === self::SENT) {
                $sent++;
            } elseif ($part['state'] === self::SKIPPED) {
                $skipped++;
            }
        }
        if ($skipped > 0) {
            $this->attachmentState = $sent > 0 ? 'partial' : self::SKIPPED;
            if ($this->attachmentCode === '') {
                foreach ($this->audio as $part) {
                    if ($part['state'] === self::SKIPPED && (string)($part['code'] ?? '') !== '') {
                        $this->attachmentCode = (string)$part['code'];
                        break;
                    }
                }
            }
        } elseif ($this->audioComplete()) {
            $this->attachmentState = self::SENT;
        }
    }

    /** @param list<string> $allowed */
    private static function known(string $value, array $allowed = [self::PENDING, self::SENDING, self::SENT, self::SKIPPED, self::FAILED]): string
    {
        return in_array($value, $allowed, true) ? $value : self::PENDING;
    }
}
