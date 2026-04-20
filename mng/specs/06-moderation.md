# EPIC-06 — Room Moderation (Admins & Bans)

**Req refs:** §2.4.7–2.4.8, §4.5

## Goal
Roles (owner / admin / member). Admin actions: delete msgs, remove members, ban, view bans. Owner-only: remove admins, delete room. Abuse reporting skeleton (user reports → admin queue). Admin audit log (all privileged actions recorded).

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-06-01 | Room always has exactly one owner |
| AC-06-02 | Owner always admin, cannot demote |
| AC-06-03 | Admins can: delete messages, remove members, ban/unban, view ban list, remove non-owner admins |
| AC-06-04 | Owner can: all admin can + remove admins + delete room |
| AC-06-05 | Remove member = ban (no rejoin) |
| AC-06-06 | Banned user cannot rejoin unless unbanned |
| AC-06-07 | Banned user lose access to room messages + files in UI |
| AC-06-08 | Files stay stored unless room deleted |
| AC-06-09 | Ban list show: user + who banned + timestamp |
| AC-06-10 | User can report any message or user with reason text (≤500 chars); creates abuse_reports row with status='open' |
| AC-06-11 | Admins see abuse reports queue (list + resolve/dismiss); resolving does NOT auto-act (admin decides kick/ban/delete separately) |
| AC-06-12 | Every privileged action (ban, kick, unban, role change, message delete by admin, room delete, report resolution) written to audit_log with actor_id, target_type, target_id, action, metadata (jsonb), created_at |
| AC-06-13 | Audit log retention per AUDIT_LOG_RETENTION_DAYS env (EPIC-11); pruning job runs nightly |

## Data model

```sql
CREATE TABLE room_bans (
  room_id      INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by    INT NOT NULL REFERENCES users(id),
  banned_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE abuse_reports (
  id            BIGSERIAL PRIMARY KEY,
  reporter_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type   TEXT NOT NULL CHECK (target_type IN ('message','user')),
  target_id     BIGINT NOT NULL,
  reason        TEXT NOT NULL CHECK (length(reason) <= 500),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolved_by   INT REFERENCES users(id),
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX abuse_reports_status_idx ON abuse_reports(status, created_at DESC);

CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_id      INT REFERENCES users(id),
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('user','admin','system')),
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     BIGINT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX audit_log_created_idx ON audit_log(created_at DESC);
CREATE INDEX audit_log_actor_idx   ON audit_log(actor_id, created_at DESC);
```

## API (BFF)
- `POST /api/v1/rooms/:id/members/:userId/promote` (owner → admin)
- `POST /api/v1/rooms/:id/members/:userId/demote` (admin → member; owner-only if target admin)
- `DELETE /api/v1/rooms/:id/members/:userId` (= ban)
- `POST /api/v1/rooms/:id/bans/:userId/unban`
- `GET /api/v1/rooms/:id/bans`

```
- `POST /api/v1/reports` `{targetType, targetId, reason}` → 201
- `GET  /api/v1/admin/reports?status=open&limit=50` → list
- `POST /api/v1/admin/reports/:id/resolve` `{note?}` → 204
- `POST /api/v1/admin/reports/:id/dismiss` `{note?}` → 204
- `GET  /api/v1/admin/audit-log?actor=&action=&from=&to=&limit=50` → keyset-paginated
```

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
- `report.new` (to admins online) `{ report }`

## Dependencies
EPIC-05, EPIC-11 (retention + pruning job).

## Risks
Owner self-demote forbidden. Check before every privileged action.
- `Abuse-report spam: same reporter + same target in short window → deduplicate at insert (unique constraint on (reporter_id, target_type, target_id, DATE(created_at))).`
- `Audit log write failure must not block the privileged action; write in same tx when possible, else best-effort log + warn.`