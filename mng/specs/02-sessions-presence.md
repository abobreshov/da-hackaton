# EPIC-02 — Sessions & Presence

**Req refs:** §2.2.1–2.2.4, §3.2 (presence ≤2s), §3.5

## Goal
Track online / AFK / offline per user across multi tabs + devices. Expose active-sessions screen w/ per-session logout. EPIC-02 is source of truth for presence state (see ADR-001); EPIC-03 provides transport primitive; EPIC-09 observer only.

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
| AC-02-09 | PresenceService is single writer of presence state; publishes via PresencePublisher (EPIC-03) only |

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
2. On WS connect: client sends `sessionId`; BFF registers in `presence:{userId}` HASH w/ current ts (via TCP to backend `presence.ping`).
3. Client sends `presence.ping` every 20s when active; on window blur stop.
4. Backend `PresenceService` owns state machine. Scheduled job (every 10s) scans `presence:{userId}` keys: derives state (online / afk / offline), writes `presence_state:{userId}` STRING TTL 90s. If state changed, calls `PresencePublisher.publish(userId, state)`.
5. `PresencePublisher` (from EPIC-03 transport module, injected into PresenceService) executes `PUBLISH user:{userId}` + coalesced `presence:global` (500ms debounce for bulk fan-out).
6. BFF `RedisSubscriberService` (EPIC-03) routes deltas to Socket.IO rooms; delivers `presence.update` to interested WS clients.
7. EPIC-09 consumes `user:{userId}` channel as observer — no writes.

## Dependencies
EPIC-01 (auth). EPIC-03 (PresencePublisher primitive + transport). See ADR-001.

## Out of scope
Device names, geolocation, typing indicators.

## Risks
- Storm of presence updates → throttle at BE (coalesce 500ms), fan-out per-room only to joined clients.
- PresencePublisher coupling: EPIC-02 hard-imports EPIC-03 module (NestJS provider). Acceptable: same backend process, type-safe, mockable.
- Scheduler skew under load: 300 users × 10s cycle. Mitigate via Redis pipeline batching + per-user dirty flag (set on ping, cleared on evaluate).