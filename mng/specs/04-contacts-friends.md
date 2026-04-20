# EPIC-04 — Contacts, Friends, User Bans

**Req refs:** §2.3.1–2.3.6

## Goal
Friend graph + per-user bans. Enable DM eligibility (§2.3.6).

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-04-01 | User has personal friend list |
| AC-04-02 | Friend request by username or from a room's member list |
| AC-04-03 | Friend request accepts optional free-form text |
| AC-04-04 | Adding a friend requires recipient confirmation |
| AC-04-05 | Either side can remove friend |
| AC-04-06 | User-to-user ban blocks all new contact (DM, requests, visibility of ban initiator) |
| AC-04-07 | Existing DM history with banned user becomes read-only |
| AC-04-08 | Ban terminates friendship |
| AC-04-09 | DM allowed only if friends AND neither side banned other |

## Data model

```sql
CREATE TABLE friendships (
  id            SERIAL PRIMARY KEY,
  user_a        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('pending','accepted')),
  requested_by  INT NOT NULL REFERENCES users(id),
  request_text  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  accepted_at   TIMESTAMPTZ,
  UNIQUE (user_a, user_b),
  CHECK (user_a < user_b)
);

CREATE TABLE user_bans (
  banner_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (banner_id, banned_id)
);
```

Helper: normalize `(user_a, user_b)` by sorting ids so pair unique in `friendships`.

## API (BFF)
- `GET /api/v1/friends`
- `POST /api/v1/friends/request` `{username, text?}` → 201
- `POST /api/v1/friends/requests/:id/accept` → 204
- `POST /api/v1/friends/requests/:id/reject` → 204
- `DELETE /api/v1/friends/:userId`
- `POST /api/v1/users/:userId/ban`
- `DELETE /api/v1/users/:userId/ban`
- `GET /api/v1/users/:userId/bans` (self)

## WS push
- `friend.request.new` { fromUser, text }
- `friend.request.accepted` { user }
- `friend.removed` { userId }
- `user.banned.me` { byUserId }

## Dependencies
EPIC-01.

## Risks
Edge case: ban + friend race. Ban wins: friendship row removed atomically when ban inserted.