# EPIC-04 — Contacts, Friends, User Bans

**Req refs:** §2.3.1–2.3.6

## Goal
Friend graph + per-user bans. Enable DM eligibility (§2.3.6). EPIC-04 owns atomic ban transaction (ban + friendship removal + DM freeze). See `BanService` below.

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
| AC-04-10 | BanService.banUser atomic: inserts user_bans + deletes friendship rows + sets dm_channels.frozen_at in single DB transaction |
| AC-04-11 | Unban (DELETE /users/:userId/ban) does NOT restore friendship or unfreeze DM; user must re-request friend |
| AC-04-12 | Account deletion: cascade (rooms, messages, attachments, friendships, bans) runs as async BullMQ job (consumer per EPIC-11); user sees immediate 204, cleanup completes eventually |
| AC-04-13 | Friendships indexed for O(log n) lookup by either side; user_bans indexed by banned_id for "who banned me" queries |

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
  CHECK (requested_by IN (user_a, user_b)),
  UNIQUE (user_a, user_b),
  CHECK (user_a < user_b)
);

CREATE TABLE user_bans (
  banner_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (banner_id, banned_id)
);

CREATE INDEX friendships_user_a_accepted_idx ON friendships(user_a) WHERE status = 'accepted';
CREATE INDEX friendships_user_b_accepted_idx ON friendships(user_b) WHERE status = 'accepted';
CREATE INDEX friendships_pending_idx ON friendships(user_b) WHERE status = 'pending';
CREATE INDEX user_bans_banned_idx ON user_bans(banned_id);
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

## Ban transaction ownership

`BanService.banUser(bannerId, bannedId)` (backend, EPIC-04) executes in a single Postgres transaction:

1. INSERT INTO user_bans (banner_id, banned_id) — ON CONFLICT DO NOTHING
2. DELETE FROM friendships WHERE {user_a, user_b} matches pair
3. UPDATE dm_channels SET frozen_at = NOW() WHERE (user_low, user_high) matches pair AND frozen_at IS NULL
4. COMMIT
5. After COMMIT: publish `user.banned.me` to `user:{bannedId}`, `friend.removed` to both, `dm.frozen` to both

EPIC-07 (messaging) consumes this invariant: on message.create for a DM, backend rejects 403 if `dm_channels.frozen_at IS NOT NULL`. No writes to frozen_at from EPIC-07.

## Account deletion cascade (async)

DELETE /api/v1/account → auth-service soft-marks user, enqueues BullMQ job `user.cascade.delete` (queue consumer in EPIC-11). Job deletes: owned rooms + their messages + attachments, friendship rows, user_bans rows, refresh tokens, sessions. User sees immediate 204 + cookie clear.

## Dependencies
EPIC-01.

## Risks
- Ban transaction failure between steps 1-3: single Postgres tx = all-or-nothing rollback. No partial state.
- Unban does not restore prior friendship (deliberate per §2.3.5).
- Async cascade window: between DELETE /account and job completion, some rooms may still be visible to members. Acceptable for MVP; consumer runs promptly.