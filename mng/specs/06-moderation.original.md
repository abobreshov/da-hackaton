# EPIC-06 — Room Moderation (Admins & Bans)

**Req refs:** §2.4.7–2.4.8, §4.5

## Goal
Roles (owner / admin / member). Admin actions: delete msgs, remove members, ban, view bans. Owner-only: remove admins, delete room.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-06-01 | Room always has exactly one owner |
| AC-06-02 | Owner is always an admin and cannot be demoted |
| AC-06-03 | Admins can: delete messages, remove members, ban/unban, view ban list, remove non-owner admins |
| AC-06-04 | Owner can: everything admin can + remove admins + delete room |
| AC-06-05 | Removing a member from a room treats it as ban (cannot rejoin) |
| AC-06-06 | Banned user cannot rejoin unless unbanned |
| AC-06-07 | Banned user loses access to room messages + files in UI |
| AC-06-08 | Files remain stored unless room deleted |
| AC-06-09 | Ban list shows: user + who banned them + timestamp |

## Data model

```sql
CREATE TABLE room_bans (
  room_id      INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by    INT NOT NULL REFERENCES users(id),
  banned_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);
```

## API (BFF)
- `POST /api/v1/rooms/:id/members/:userId/promote` (owner → admin)
- `POST /api/v1/rooms/:id/members/:userId/demote` (admin → member; owner-only if target is admin)
- `DELETE /api/v1/rooms/:id/members/:userId` (= ban)
- `POST /api/v1/rooms/:id/bans/:userId/unban`
- `GET /api/v1/rooms/:id/bans`

## Authorization matrix

| Action | owner | admin | member |
|---|---|---|---|
| delete message | ✓ | ✓ | own only |
| remove member (=ban) | ✓ | ✓ | — |
| unban | ✓ | ✓ | — |
| promote to admin | ✓ | — | — |
| demote admin | ✓ (not self) | — | — |
| delete room | ✓ | — | — |

Enforced server-side in BE via `RoomAuthService.ensureCan(userId, roomId, action)`.

## WS events
- `room.role.changed` { roomId, userId, role }
- `room.banned.you` { roomId }

## Dependencies
EPIC-05.

## Risks
Self-demotion of owner forbidden. Check before every privileged action.
