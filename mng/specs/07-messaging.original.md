# EPIC-07 — Messaging Core

**Req refs:** §2.5.1–2.5.6, §2.3.6, §3.2 (delivery ≤3s, 10k history), §3.3

## Goal
Room and personal (DM) messaging with text/emoji/reply/edit/delete, infinite history, offline delivery.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-07-01 | Message supports plain text, multiline, emoji, UTF-8 |
| AC-07-02 | Max text 3KB |
| AC-07-03 | Message may reference (reply) another message; UI quotes it |
| AC-07-04 | Author can edit own message; UI shows `edited` indicator |
| AC-07-05 | Author can delete own message |
| AC-07-06 | Room admin can delete any message in that room |
| AC-07-07 | DM allowed only if friends AND neither banned other |
| AC-07-08 | Messages delivered to online recipients ≤3s |
| AC-07-09 | Messages persisted; chat history scrollable backward (infinite scroll) |
| AC-07-10 | Offline user receives unread messages on next login |
| AC-07-11 | Room with 10k messages remains usable |

## Data model

```sql
CREATE TABLE dm_channels (
  id           SERIAL PRIMARY KEY,
  user_low     INT NOT NULL,
  user_high    INT NOT NULL,
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
  reply_to     BIGINT REFERENCES messages(id),
  edited_at    TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  CHECK ((room_id IS NOT NULL) <> (dm_id IS NOT NULL))
);

CREATE INDEX messages_room_created_idx ON messages(room_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX messages_dm_created_idx   ON messages(dm_id, created_at DESC) WHERE deleted_at IS NULL;
```

Soft delete (`deleted_at`) to allow audit; UI treats `deleted_at IS NOT NULL` as gone.

## API (BFF TCP → BE)
- `POST /api/v1/messages` `{roomId|dmUserId, body, replyToId?, attachmentIds?}` → 201 `{message}`
- `PATCH /api/v1/messages/:id` `{body}` (author) → 200
- `DELETE /api/v1/messages/:id` (author or room admin) → 204
- `GET /api/v1/rooms/:id/messages?before=&limit=50` → `{messages[]}` (cursor)
- `GET /api/v1/dms/:userId/messages?before=&limit=50`

## Send flow
1. BFF `@SubscribeMessage('message.send')`: validate session, rate-limit (e.g. 10 msg / 5s).
2. BFF TCP `messages.create` → BE.
3. BE: auth (member+not banned OR friends+not user-banned), insert, `PUBLISH room:{id}` (or `dm:{id}`).
4. BFF WS ack with `{id, createdAt}` to sender; broadcast to other room members on Redis event.

## DM eligibility check (§2.3.6)
At create time: `exists(friendship accepted) AND NOT exists(user_ban either direction)`. Otherwise 403.

## Pagination (infinite scroll)
Keyset: `WHERE room_id = ? AND created_at < :before ORDER BY created_at DESC LIMIT 50`. Prevents offset pain at 10k+.

## Dependencies
EPIC-03 (transport), EPIC-04 (DM eligibility), EPIC-05 (rooms), EPIC-06 (admin delete).

## Risks
- Edit race with delete → check `deleted_at IS NULL` in UPDATE WHERE clause.
- Large attachments — see EPIC-08.
