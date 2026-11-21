# MAX fixtures

Anonymised MAX Bot API responses for `Tests/check-max-channel.php`.

**Source: a mix of live responses and the documentation (21.11.2026).** Files marked **live** were
captured from the real test bot in stage 3d and anonymised (ids, names, titles and the webhook URL are
invented; the shapes, status codes and `code` fields are real). The rest were written from
`https://dev.max.ru/docs-api` and the OpenAPI schema `max-messenger/api-schema` (0.0.34).

| File | API call / case | Source |
|---|---|---|
| `me_ok.json` | `GET /me` → `{user_id, first_name, is_bot, username, last_activity_time, description, avatar_url, name}` | **live** |
| `error_400_text_too_long.json` | HTTP 400 `{"code":"proto.payload","message":"Field 'text' size (4010) must be at most 4000"}` — the limit counts the raw `text` string with markup | **live** |
| `error_403_chat_denied.json` | 403 `{"code":"chat.denied","message":"Key: error.dialog.suspended, args: [<user_id>,]."}` — the user blocked the bot | **live** |
| `error_404_error_not_found.json` | 404 `{"code":"error.not.found","message":"error.not.found"}` — the bot was removed from the chat | **live** |
| `send_ok.json` | `POST /messages` → `{message: {recipient, timestamp, body: {mid, seq, text}, sender}}` | **live** (shape) |
| `chats_ok.json` | `GET /chats/{chatId}` of a group (`chat_id, type, status, last_event_time, participants_count, is_public, title, messages_count`) | **live** (shape) |
| `subscriptions_active.json` | `GET /subscriptions` with one webhook subscription | **live** (shape) |
| `subscriptions_empty.json` | `GET /subscriptions` → `{"subscriptions":[]}` | **live** |
| `updates_empty.json` | `GET /updates` → `{"updates":[],"marker":…}` — also the answer while a webhook subscription is active | **live** |
| `updates_ok.json` | `GET /updates` with `bot_added` (chat + channel), `bot_started` (dialog), `bot_removed`, `user_removed`, `marker` | GET /updates, objects/Update |
| `updates_empty.json` | empty page with a new `marker` | GET /updates |
| `chats_ok.json` | `GET /chats/{chatId}` of a group (`type: chat`, `title`) — one call per `bot_added` | GET /chats/{chatId} |
| `chats_channel.json` | `GET /chats/{chatId}` of a channel | GET /chats/{chatId} |
| `send_ok.json` | `POST /messages` → `{message: {recipient, timestamp, body: {mid, seq, text}}}` | POST /messages |
| `send_ok_no_mid.json` | 200 with a body without `mid` (unknown message id) | — (defensive case) |
| `error_401.json` | 401 `{code: "verify.token", message: …}` (real body for a missing token) | **live** |
| `error_403_chat_denied.json` | see above (**live**) | live |
| `error_404_not_found.json` | 404 `{code: "not.found"}` | Общее описание |
| `error_429.json` | 429 `{code: "rate.limit"}`; the `Retry-After` header is simulated in the test (fixtures hold bodies) | Общее описание, limits |
| `error_500.json` | 5xx with no documented body shape | Общее описание |
| `error_200_attachment_not_ready.json` | HTTP 200 `{success: false, code: "attachment.not.ready", message: "Key: errors.process.attachment.file.not.processed"}` | POST /uploads, «Обработка медиафайлов» |
| `error_200_proto_payload.json` | HTTP 200 `{success: false, code: "proto.payload"}` — unknown code | Общее описание |
| `error_200_no_code.json` | HTTP 200 `{success: false}` without a code (`code` is optional there) | Общее описание |
| `error_405_webhook.json` | 405 on `GET /updates` — mapped to `max.405.webhook_set`, **assumption (Q9)** | GET /updates (405 listed) |
| `delete_ok.json` | `DELETE /messages` → `{success: true}` | DELETE /messages |
| `delete_not_found.json` | `DELETE /messages` → `{success: false, code: "not.found"}` | DELETE /messages |
| `uploads_ok.json` | `POST /uploads?type=audio` → `{url, token}` (stage 3a hook) | POST /uploads |
| `malformed.txt` | a non-JSON body with HTTP 200 (gateway page) | — (defensive case) |

Still open after the live session (see `Plan/03`, Q9): the delete age limit (the test bot has no
message older than a day), `Retry-After` on 429 (never hit) and whether the bot can write first in a
dialog. `GET /updates` does **not** answer 405 for an active subscription — it returns 200 with an
empty page, which is what `updates_empty.json` shows.
