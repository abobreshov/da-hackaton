# EPIC-08 — Attachments

**Req refs:** §2.6.1–2.6.5, §3.4

## Goal
Upload images + files up to size limits, attach to messages, access-control by room membership, persist even if uploader lose access.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-08-01 | Supports images + arbitrary file types |
| AC-08-02 | Upload via button + paste |
| AC-08-03 | Original file name preserved |
| AC-08-04 | User may add optional comment to attachment |
| AC-08-05 | Max file size 20 MB; max image 3 MB |
| AC-08-06 | Only current room members (or DM participants) can download |
| AC-08-07 | User losing room access loses attachment download |
| AC-08-08 | File persists after uploader leaves room, deleted only when room deleted |
| AC-08-09 | Stored on local FS (`/data/attachments/<yyyy>/<mm>/<uuid>_<name>`) |

## Data model

```sql
CREATE TABLE attachments (
  id           UUID PRIMARY KEY,
  room_id      INT REFERENCES rooms(id) ON DELETE CASCADE,
  dm_id        INT REFERENCES dm_channels(id) ON DELETE CASCADE,
  message_id   BIGINT REFERENCES messages(id) ON DELETE SET NULL,
  uploader_id  INT NOT NULL REFERENCES users(id),
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size_bytes   INT NOT NULL,
  path         TEXT NOT NULL,
  comment      TEXT,
  is_image     BOOLEAN NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  CHECK ((room_id IS NOT NULL) <> (dm_id IS NOT NULL))
);
```

## API
- `POST /api/v1/rooms/:id/attachments` multipart `{files[], comment?}` → `[{attachmentId, ...}]`
- `POST /api/v1/dms/:userId/attachments` multipart
- `GET /api/v1/attachments/:id/download` — stream file, access-controlled
- Attachment ids pass to `POST /messages` body to bind to message

## Access rules
On download: require `room_memberships(roomId, userId)` exist AND `room_bans` absent; DM: both participants still friends + no ban.

## Storage layout
```
/data/attachments/2026/04/<uuid>_<original>.<ext>
```

## Paste handling (FE)
Listen `paste` event on composer; read `ClipboardItem`; upload; insert attachment chip.

## Dependencies
EPIC-05, EPIC-07.

## Risks
- MIME sniffing: enforce allowed MIME vs extension; reject disallowed (e.g. executables) only if policy require (spec allows arbitrary).
- Disk pressure: cleanup on room delete via BullMQ job.