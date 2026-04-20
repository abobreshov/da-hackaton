# EPIC-02 — Sessions & Presence

**Req refs:** §2.2.1–2.2.4, §3.2 (presence ≤2s), §3.5

## Goal
Track online / AFK / offline per user across multi tabs + devices. Expose active-sessions screen w/ per-session logout.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-02-01 | Presence states: `online`, `afk`, `offline` |
| AC-02-02 | AFK: no interaction any tab >60s |
| AC-02-03 | Active ≥1 tab → online |
| AC-02-04 | Offline: no open tab (all closed/unloaded) |
| AC-02-05 | Sessions screen lists browser + IP per active session |
| AC-02-06 | User can log out any individual session |
| AC-02-07 | Logout of current session invalidates only that browser |
| AC-02-08 | Presence propagation ≤2s |

## Data model

```sql
-- Existing: refresh tokens in Redis. Add durable session records.
CREATE TABLE user_sessions (
  id              UUID PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent      TEXT,
  ip              INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ
);
CREATE INDEX ON user_sessions(user_id) WHERE revoked_at IS NULL;
```

Presence in Redis (ephemeral):
```
presence:{userId}            HASH  { sessionId: lastActivityTs }
presence_state:{userId}      STRING  online|afk|offline  (derived, TTL 90s)
```

## API

- `GET /api/v1/sessions` → list sessions for current user
- `DELETE /api/v1/sessions/:id` → revoke session
- WS events:
  - `client→server`: `presence.ping` (throttled, on visibility change + activity)
  - `server→client`: `presence.update {userId, state}`

## Logic
1. On login: create `user_sessions` row + refresh token → sessionId cookie.
2. On WS connect: client sends `sessionId`; BFF registers in `presence:{userId}` w/ current ts.
3. Client sends `presence.ping` every 20s when active; on window blur stop.
4. BE job (every 10s) scans `presence:{userId}`, evaluates freshest session; if latest > 60s → `afk`; if no sessions → `offline`. Emits `presence.update` via Redis pub/sub.
5. BFF subscribes, pushes to interested WS clients (contacts + room members).

## Dependencies
EPIC-01 (auth).

## Out of scope
Device names, geolocation, typing indicators.

## Risks
- Storm of presence updates → throttle at BE (coalesce 500ms), fan-out per-room only to joined clients.