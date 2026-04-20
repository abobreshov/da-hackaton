# EPIC-05 — Chat Rooms (CRUD + Membership)

**Req refs:** §2.4.1–2.4.6, §2.4.9, §5

## Goal
Create, list, join, leave rooms. Public catalog with search. Private room invitations.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-05-01 | Any authenticated user may create room |
| AC-05-02 | Room has name (unique), description, visibility (public|private), owner |
| AC-05-03 | Public rooms appear in catalog; visible: name, description, member count |
| AC-05-04 | Catalog supports prefix/substring search |
| AC-05-05 | Private rooms invisible in catalog; join by invitation only |
| AC-05-06 | Authenticated user can freely join public room unless banned |
| AC-05-07 | User can leave any room |
| AC-05-08 | Owner cannot leave own room |
| AC-05-09 | Only owner can delete room |
| AC-05-10 | Deleting room deletes all messages + attachments permanently |
| AC-05-11 | User can invite another user to private room |

## Data model

```sql
CREATE TABLE rooms (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(128) NOT NULL UNIQUE,
  description  TEXT,
  visibility   TEXT NOT NULL CHECK (visibility IN ('public','private')),
  owner_id     INT NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

CREATE TABLE room_memberships (
  room_id      INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  joined_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE room_invitations (
  id           SERIAL PRIMARY KEY,
  room_id      INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  inviter_id   INT NOT NULL REFERENCES users(id),
  invitee_id   INT NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  accepted_at  TIMESTAMPTZ,
  rejected_at  TIMESTAMPTZ,
  UNIQUE (room_id, invitee_id)
);

CREATE INDEX rooms_name_trgm ON rooms USING GIN (name gin_trgm_ops);
```

## API (BFF)
- `POST /api/v1/rooms` `{name, description, visibility}` → 201 `{room}`
- `GET /api/v1/rooms/catalog?q=...&offset=&limit=` → `{rooms, total}`
- `GET /api/v1/rooms/my` → rooms user member of
- `GET /api/v1/rooms/:id` → room detail (403 if not member/public)
- `DELETE /api/v1/rooms/:id` (owner)
- `POST /api/v1/rooms/:id/join`
- `POST /api/v1/rooms/:id/leave`
- `POST /api/v1/rooms/:id/invitations` `{invitedUserId}`
- `POST /api/v1/invitations/:id/accept` / `.../reject`

## WS events
- `room.member.added` / `room.member.removed`
- `room.deleted`
- `invitation.new` (to invitee)

## Dependencies
EPIC-01.

## Risks
Name uniqueness race → unique constraint + retry on conflict.