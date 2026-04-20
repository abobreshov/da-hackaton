# EPIC-09 — Notifications & Unread Indicators

**Req refs:** §2.7.1–2.7.2, §4.4

## Goal
Track unread per user per room/DM. Visual badges near room + contact names. Low-latency presence.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-09-01 | Rooms/DMs with unread messages show indicator near name |
| AC-09-02 | Opening a chat clears its unread indicator |
| AC-09-03 | Indicator distinguishes count (or "1+" for many) |
| AC-09-04 | Presence state changes appear within ≤2s |

## Data model

```sql
CREATE TABLE user_last_read (
  user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id        INT REFERENCES rooms(id) ON DELETE CASCADE,
  dm_id          INT REFERENCES dm_channels(id) ON DELETE CASCADE,
  last_message_id BIGINT,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, COALESCE(room_id,0), COALESCE(dm_id,0))
);
```

## API
- `POST /api/v1/rooms/:id/read` `{lastMessageId}` → 204
- `POST /api/v1/dms/:userId/read` `{lastMessageId}`
- `GET /api/v1/unread` → `{rooms: [{id, count}], dms: [{userId, count}]}`

## Push
- On new message: BE publishes `user:{recipientId}` event `unread.incremented {roomId|dmId, count}`
- Client decrements locally on open chat + POST read

## Count strategy
Cheap approximation: `count(*) FROM messages WHERE room_id=? AND id > last_message_id`. Cap 99 for UI. Rooms with 1000 members: per-open-client cost bounded by cursor scan on indexed column.

## Dependencies
EPIC-02 (presence), EPIC-07 (messages).

## Out of scope
Push notifications (browser Notification API) — if time permits.