# Adding a messenger channel

Spec: `Plan/03-channels.md`. Contract: `ChannelInterface` (`checkToken`, `discoverChats`, `send`,
`sendAttachment`, `delete`, `limits`).

## Checklist

1. **Collect API facts from official docs** (base URL, auth, send, media upload, chat discovery, limits, error
   format) and add a section to `Plan/03-channels.md` with links and the date checked.
2. **Classes**: `Lib/Channels/<Name>/<Name>Channel.php` (contract) and `<Name>Api[Client].php` (HTTP calls via
   `HttpTransport` only). Add the adapter to `ChannelFactory` — the single place that builds the channel
   registry for REST, delivery and discovery (and the only place a channel-specific transport option such as
   a CA bundle belongs).
3. **Secrets**: credentials only from `BotCredentials`; never put them into exceptions, logs or `SendResult`.
   If the API takes the token in the URL, make sure `HttpTransport` is told not to log the URL; if it takes a
   header, pass it as an extra header — `HttpTransport` logs neither URLs nor headers.
4. **Result mapping**: every API response maps to `sent | retry(after) | permanent | recipient_gone` with a
   normalised code `<channel>.<http>.<reason>`.
5. **Rendering**: convert `RenderedMessage` into the channel markup; escape all data fields; respect text and
   caption limits; keep the ID line and buttons when truncating. `sendAttachment` receives a **plain-text**
   caption and must escape it exactly once (no double escaping).
6. **Attachments (stage 3a)**: `sendAttachment` sends one audio part and returns `AttachmentResult`. If the
   API answers "not ready" (MAX `attachment.not.ready`), return `notReady` plus the upload token that must be
   reused on the next attempt; never re-upload for that retry. Never put a file path, a URL with a token or a
   bot token into a code.
7. **Limits**: return per-chat and per-bot rates and the file size/duration limits in `limits()`;
   `RateLimiter` and the attachment preparer enforce them.
8. **Discovery**: implement the 5-minute discovery session the same way as Telegram/MAX, or document why the
   channel needs manual chat ids.
9. **UI and REST**: add the channel to the bot form enum and its help text; translations.
10. **Tests**: fixtures of real (anonymised) API responses for success, rate limit, recipient gone, bad token,
   malformed response; secret-leak check.
