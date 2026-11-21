# Prompt: ModuleMessengerHub — stage 3a (attachments)

You are continuing development of the MikoPBX module **ModuleMessengerHub** at
the repository root (git, branch `develop`). Answer the user in Russian;
code, identifiers and commit messages in English.

Stages 2 (Telegram) and 3 (MAX) are accepted (package 6.1 on the station, 21.11.2026). Stage 3a adds **audio
attachments**: the call recording (or fragments around the quotes) sent after the text message, converted to MP3,
within channel limits. Read `Plan/09` («Этап 3а») — this prompt details it.

## 0. Read first (mandatory)

1. `AGENTS.md`, `CLAUDE.md`. Non-negotiable: never modify MikoPBX Core or source modules (Core files may be
   **read**, never written); pull model — other modules only through their public REST API v3; secrets never in
   logs/codes/REST; **personal data leaves the PBX only when the admin enabled it** (rule 7).
2. `Plan/03` («Вложения», Telegram/MAX audio rows), `Plan/04` (`external_message_ids`, `options_json`),
   `Plan/05` (event `attachments`), `Plan/06` (rule `options.attachments`), `Plan/07`, `Plan/08`, `Plan/11` (Q7:
   ffmpeg/sox/lame exist on the station, degrade at runtime), `Plan/12` (retract deletes **every** id of a delivery).
3. Existing hooks: `TelegramApi::sendAudio/sendDocument`, `MaxApi::sendAudio/sendDocument/requestUpload`,
   `HttpTransport::postMultipart`, `RenderedMessage::$attachments`, `ChannelLimits::maxFileBytes/maxCaptionLength`,
   `TODO(stage 3a)` in `RetractionService` (one rate reservation per delete), `MissedCallSource` /
   `VoicemailSource` (already put `{kind: recording, path}` into the event), `AiAttentionCallSource` (no attachment
   yet; quotes carry `start_ms/end_ms`).
4. Load `mikopbx-module` before REST/UI work, `babel-compiler` for JS (no local Docker — local Babel in the
   scratchpad, same targets; say so), `translations` for new keys (Russian first, 29 locales, literal arrays).

## Station and safety rules (unchanged — mandatory)

- Test station: access in `LOCAL.md` (not in git); «Working rules» of `docs/agent-prompts/stage-1-continuation.md`.
- Temporary Core API keys only without `full_permissions`, deleted afterwards; never touch station credentials;
  `select id,description,full_permissions from m_ApiKeys where id>=232` at the end of every station session.
- Never install certificates into any system store (station or the user's Mac); never disable TLS verification.
- **Do not write into Core directories** (`/storage/usbdisk1/mikopbx/astspool/monitor`, voicemail dirs, `/cf`, …).
  Test audio lives only in the module's own temp/data dir (see 3a-1 item 6).
- Bot tokens: the bots already exist on the station; never print or store tokens; checks by length/hash only.

---

## Stage 3a-1 — decisions, then backend (no UI)

Before code, settle these and write them into `Plan/03` («Вложения») and `Plan/05`. Stop and ask only if a
decision needs Core/source-module changes or contradicts the Plan.

1. **Which events get what.**
   - `core.voicemail` — the voicemail file (it *is* the message).
   - `ai_supervisor.attention_call` — the call recording, or fragments around the (up to 3) quotes
     (`start_ms/end_ms` ± padding, e.g. 5 s, merged when they overlap) — fragments are the default because they are
     short; full recording as a rule option if cheap.
   - `core.missed_call` — **no attachment** (nothing was said; a `recordingfile` of a missed call is IVR/greeting at
     best). Justify or argue otherwise.
2. **Where the file comes from (no Core changes).** Voicemail/missed-call paths come from AMI. For the AI attention
   call find a legal source: the public REST of ModuleAISupervisor (does `calls/{id}` expose a recording/linkedid?)
   or Core REST v3 CDR (Core `src/PBXCoreREST/Controllers/Cdr` — playback/download by
   linkedid). If a REST path is used, add it to the hub key `allowed_paths` as `read` only (key sync, Q15).
   Never read AI Supervisor tables or files by its internal paths.
3. **Path safety.** A path from AMI/REST is untrusted: `realpath()` must be inside an allow-list of Core recording
   roots read from Core settings/constants (not hard-coded guesses; find them in Core — read only); symlinks out of
   the root, `..`, missing/unreadable files → no attachment, a code (`attachment.path_rejected`, `…missing`), never
   the path in logs or codes.
4. **Conversion.** `ffmpeg` (fallback `sox`/`lame`) → MP3 mono, modest bitrate (e.g. 32–48 kbps, enough for
   speech and small files); fragment cutting in the same pass. Run with `nice`, hard timeout, `proc_open` with an
   argument array (no shell string), output only into the module's own temp dir (0700), deleted after the delivery
   finishes or fails for good; a janitor removes leftovers older than N hours. Tool missing → degrade to text only
   with a code (`attachment.converter_missing`) — the text message is never delayed or lost because of audio.
5. **Limits and fallback.** Size/duration over the channel limit (Telegram 50 MB; MAX 256 MB / 60 min) or a
   conversion failure → no file; the text gets a line «запись доступна в АТС» with the call card link when
   `pbx_public_url` is set. Caption limits: the audio goes as a **separate message after the text** (Plan/12 already
   expects several ids), caption short (event title + time), escaped.
6. **Privacy switch.** Rule option `attachments` (`none | fragments | recording`, default **`none`** for new and
   existing rules — migration must not start sending recordings by itself). Phone masking still applies to text and
   captions. Probe events may only reference files in the module's own probe dir (generated test tone/speech via
   sox), never real recordings; the path allow-list includes that dir **only for `probe=true` events**.
7. **Delivery semantics (queue-resilience).** One Outbox row = text + N audio parts. Store progress per part
   (which parts are sent, their external ids) so a retry **never re-sends the text** or an already sent part.
   Conversion happens in the delivery worker **before** the lease clock matters: either a separate «prepare» step
   with its own lease/state or a lease extension; a 60-minute recording must not make a second worker send the same
   row. Prepared files are cached per event (one conversion for all chats of the event). MAX `attachment.not.ready`
   → retry the *same* upload token with growing pause (bounded), then fall back to the text-only line.
   Telegram 413 / MAX size error → fallback line, `permanent` for the part, the row is still `sent`.
8. **Retract.** `RetractionService` deletes every stored id, one rate reservation per delete (MAX ≤ 2/s per chat);
   partial failure → `retract_failed` with the ids left, no endless retries.
9. **Tests** (`Tests/check-attachments.php` + extend delivery/retraction/max/telegram checks): path allow-list and
   traversal/symlink cases, converter command building (no shell), missing tool, size fallback, per-part progress
   (text never sent twice across retries and lease expiry), cache per event, `attachment.not.ready` sequence,
   retract of text + parts, `attachments: none` sends nothing, no path/token in any code or log line.

**STOP — report decisions + backend, wait.**

## Stage 3a-2 — REST + UI

1. Rules REST: `options.attachments` enum, validation, default `none`, OpenAPI keys in `en.php`/`ru.php`.
2. Wizard step 3: «Прикладывать запись: нет / фрагменты с цитатами / весь разговор» only for event types that can
   have audio; a privacy hint («запись уйдёт в мессенджер — за пределы АТС»); preview shows an audio bubble.
3. Journal: per delivery — attachment state (sent / replaced by link / skipped + reason) as text, not codes.
4. Settings: nothing new unless a decision above needs it (justify).
5. Translations, recompiled JS, `Plan/06` updated, CHANGELOG.

**STOP — report and wait.**

## Stage 3a-3 — station + acceptance

1. Check `ffmpeg`/`sox`/`lame` versions on the station; conversion time and size for a 1-min and a 10-min test file.
2. Probe voicemail and probe attention call (generated audio in the module probe dir) → Telegram group, Telegram
   private, MAX group: text + audio arrive, one event → one text + parts per chat, the audio plays.
3. Rule with `attachments: none` → text only. Oversized file (generate > 50 MB for Telegram) → link line.
4. Retry: break the proxy after the text was sent → after recovery only the missing audio part is sent.
5. «Удалять, если перезвонили» → text and audio both deleted in Telegram and MAX.
6. Leftover from stage 3: MAX delete age limit — try to delete a MAX message older than 24 h (e.g. the sendTest
   message of 21.11.2026 on bot 16, group «Test», if it is still there) and record the result in `Plan/03` and the wizard hint.
7. Ask the user whether to remove the stage-3 probe rules; remove only after the answer.
8. Temp dir empty after deliveries; no recording path, token or phone number in logs; `m_ApiKeys` proof.
9. Mark stage 3a criteria in `Plan/09` (live / probe / synthetic + date), README, CHANGELOG.

Before every commit: `php Tests/run-all.php`, `php -l` over all PHP (empty), `./scripts/package-module.sh`.
Conventional Commits on `develop`. Reviewers from `AGENTS.md`: `queue-resilience-reviewer` (parts, leases, retries),
`module-security-reviewer` (paths, process spawning, personal data), `module-contract-guardian` (rules REST),
`admin-ui-reviewer` (wizard, journal).

**STOP — report and wait.** Stage 3b (STT/cloud AI sources) gets its own prompt.
