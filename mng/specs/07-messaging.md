# EPIC-07 — Messaging Core

**Req refs:** §2.5.1–2.5.6, §2.3.6, §3.2 (delivery ≤3s, 10k history), §3.3

## Goal
Room + DM messaging. Text/emoji/reply/edit/delete, infinite history, offline delivery.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-07-01 | Message supports plain text, multiline, emoji, UTF-8 |
| AC-07-02 | Max text 3KB |
| AC-07-03 | Message may reference (reply) another message; UI quotes it |
| AC-07-04 | Author can edit own message; UI shows `edited` indicator |
| AC-07-05 | Author can delete own message |
| AC-07-06 | Room admin can delete any message in that room |
| AC-07-07 | DM allowed only if friends AND neither banned other AND dm_channels.frozen_at IS NULL (ban transaction owned by EPIC-04) |
| AC-07-08 | Messages delivered to online recipients ≤3s |
| AC-07-09 | Messages persisted; chat history scrollable backward (infinite scroll) |
| AC-07-10 | Offline user sees previously-missed messages on next login via history fetch (GET) + `messages.since {lastSeenId}` sync-reconnect hydrate (EPIC-03 AC-03-09). No WS replay push on login. |
| AC-07-11 | Room with 10k messages remains usable |
| AC-07-12 | `messages.create` rate-limit 30/5s per user sliding window. `messages.edit` + `messages.delete` share separate 60/min budget (self-correction, low abuse). |
| AC-07-13 | dm_channels has FK to users(id) ON DELETE CASCADE on both sides → account delete removes orphan DM rows |
| AC-07-14 | messages.reply_to ON DELETE SET NULL → retention prune of parent message leaves orphan replies intact (body preserved, "replying to deleted message" in UI) |
| AC-07-15 | Indexed: reply_to (partial), (author_id, created_at DESC), (created_at) WHERE deleted_at IS NULL — retention sweeps avoid seq scans |
| AC-07-16 | dm_channels row created lazily on first `messages.create {dmUserId}` via `INSERT ... ON CONFLICT (user_low, user_high) DO UPDATE SET id=id RETURNING id`. Friendship accept does NOT create dm_channels. Ban on non-existent channel is no-op. |
| AC-07-17 | No time-window on author edit/delete for MVP. `edited_at` stamped on every update. Admin deletes logged to audit_log per EPIC-06 AC-06-12. |
| AC-07-18 | WS payload contract: `message.new` `{message}`, `message.edited` `{id, body, editedAt, roomId|dmId}`, `message.deleted` `{id, roomId|dmId, deletedAt}` — body omitted on delete; client replaces with tombstone placeholder. |
| AC-07-19 | DM eligibility atomic: `INSERT INTO messages ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM dm_channels WHERE id=:dmId AND frozen_at IS NOT NULL)` — 0 rows affected → 403 WireError DM_FROZEN. Closes race between frozen_at read and insert. |
| AC-07-20 | Keyset pagination composite cursor `(created_at, id) < (:beforeTs, :beforeId)`. Index `messages_room_created_idx` extended to `(room_id, created_at DESC, id DESC)` via migration. |

## Data model

```sql
CREATE TABLE dm_channels (
  id           SERIAL PRIMARY KEY,
  user_low     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  frozen_at    TIMESTAMPTZ,                        -- set when user_bans exist either direction
  UNIQUE (user_low, user_high),
  CHECK (user_low < user_high)
);

CREATE TABLE messages (
  id           BIGSERIAL PRIMARY KEY,
  room_id      INT REFERENCES rooms(id) ON DELETE CASCADE,
  dm_id        INT REFERENCES dm_channels(id) ON DELETE CASCADE,
  author_id    INT NOT NULL REFERENCES users(id),
  body         TEXT NOT NULL,
  reply_to     BIGINT REFERENCES messages(id) ON DELETE SET NULL,
  edited_at    TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  CHECK ((room_id IS NOT NULL) <> (dm_id IS NOT NULL))
);

CREATE INDEX messages_room_created_idx ON messages(room_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX messages_dm_created_idx   ON messages(dm_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX messages_reply_to_idx ON messages(reply_to) WHERE reply_to IS NOT NULL;
CREATE INDEX messages_author_idx ON messages(author_id, created_at DESC);
CREATE INDEX messages_created_prune_idx ON messages(created_at) WHERE deleted_at IS NULL;
```

Soft delete (`deleted_at`) for audit. UI treat `deleted_at IS NOT NULL` as gone.

## API (BFF TCP → BE)
- `POST /api/v1/messages` `{roomId|dmUserId, body, replyToId?, attachmentIds?}` → 201 `{message}`
- `PATCH /api/v1/messages/:id` `{body}` (author) → 200
- `DELETE /api/v1/messages/:id` (author or room admin) → 204
- `GET /api/v1/rooms/:id/messages?before=&limit=50` → `{messages[]}` (cursor)
- `GET /api/v1/dms/:userId/messages?before=&limit=50`
- `GET /api/v1/messages/:id` → `{ message }` (for reply-chip hover / report target hydration)

## Send flow
1. BFF `@SubscribeMessage('message.send')`: validate session, enforce rate-limit 30 msg/5s per user (Redis `ratelimit:msg:{userId}`, sliding window; see EPIC-14).
2. BFF TCP `messages.create` → BE.
3. BE: auth (member+not banned OR DM-eligible per EPIC-04 invariant — friends + no user_ban either dir + `dm_channels.frozen_at IS NULL`), insert, `PUBLISH room:{id}` (or `dm:{id}`).
4. BFF WS ack `{id, createdAt}` to sender. Broadcast to other room members on Redis event.

## DM eligibility check (§2.3.6)
At create (DM): BE checks `exists(friendship accepted) AND NOT exists(user_ban either direction) AND dm_channels.frozen_at IS NULL`. Invariant maintained atomically by EPIC-04 BanService.banUser transaction. Else 403.

## Pagination (infinite scroll)
Keyset: `WHERE room_id = ? AND created_at < :before ORDER BY created_at DESC LIMIT 50`. Avoid offset pain at 10k+.

## Dependencies
EPIC-03 (transport), EPIC-04 (DM eligibility + frozen_at invariant), EPIC-05 (rooms), EPIC-06 (admin delete), EPIC-14 (rate-limit infra).

## Risks
- Edit race with delete → check `deleted_at IS NULL` in UPDATE WHERE clause.
- Large attachments — see EPIC-08.
- Rate-limit Redis outage: fail-open for messaging (log warning, allow), fail-closed for login/reset (EPIC-14).