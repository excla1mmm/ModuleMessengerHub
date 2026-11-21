# Adding a messenger channel

Spec: `Plan/03-channels.md`. Contract: `ChannelInterface` (`checkToken`, `discoverChats`, `send`, `limits`).

## Checklist

1. **Collect API facts from official docs** (base URL, auth, send, media upload, chat discovery, limits, error
   format) and add a section to `Plan/03-channels.md` with links and the date checked.
2. **Classes**: `Lib/Channels/<Name>/<Name>Channel.php` (contract) and `<Name>ApiClient.php` (HTTP calls via
   `HttpTransport` only). Register in the channel registry.
3. **Secrets**: credentials only from `BotCredentials`; never put them into exceptions, logs or `SendResult`.
   If the API takes the token in the URL, make sure `HttpTransport` is told not to log the URL.
4. **Result mapping**: every API response maps to `sent | retry(after) | permanent | recipient_gone` with a
   normalised code `<channel>.<http>.<reason>`.
5. **Rendering**: convert `RenderedMessage` into the channel markup; escape all data fields; respect text and
   caption limits; keep the ID line and buttons when truncating.
6. **Limits**: return per-chat and per-bot rates in `limits()`; `RateLimiter` enforces them.
7. **Discovery**: implement the 5-minute discovery session the same way as Telegram/MAX, or document why the
   channel needs manual chat ids.
8. **UI and REST**: add the channel to the bot form enum and its help text; translations.
9. **Tests**: fixtures of real (anonymised) API responses for success, rate limit, recipient gone, bad token,
   malformed response; secret-leak check.
