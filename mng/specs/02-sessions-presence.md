# EPIC-02 — Sessions & Presence

**Req refs:** §2.2.1–2.2.4, §3.2 (presence ≤2s), §3.5

## Goal
Track online / AFK / offline per user across multi tabs + devices. Expose active-sessions screen w/ per-session logout. EPIC-02 is source of truth for presence state (see ADR-001); EPIC-03 provides transport primitive; EPIC-09 observer only.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-02-01 | Presence states: `online`, `afk`, `offline` |
| AC-02-02 | AFK: no interaction any tab > AFK_THRESHOLD_SECONDS (env-configurable, default 60s) |
| AC-02-03 | Active ≥1 tab → online |
| AC-02-04 | Offline: no open tab (all closed/unloaded) |
| AC-02-05 | Sessions screen lists browser + IP per active session |
| AC-02-06 | User can log out any individual session |
| AC-02-07 | Logout of current session invalidates only that browser |
| AC-02-08 | Presence propagation ≤2s |
| AC-02-09 | PresenceService is single writer of presence state; publishes via PresencePublisher (EPIC-03) only |
| AC-02-10 | On WS disconnect backend emits TCP `presence.disconnect`; removes sessionId from HASH, re-derives, eager publish. Last-session-gone → offline ≤2s (not waiting for TTL). |
| AC-02-11 | Eager publish on state transition (online, afk, offline); scheduler publishes only AFK threshold crossings it detects. ≤2s propagation SLA (AC-02-08) met by eager path. |

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
presence:sessions:{userId}   HASH    { sessionId: lastActivityTs }   (sessionId entries swept on disconnect or TTL 90s)
presence:state:{userId}      STRING  online|afk|offline               (TTL 90s, derived; SAFETY NET, eager publish on transition)
```

## API

- `GET /api/v1/sessions` → list sessions for current user
- `DELETE /api/v1/sessions/:id` → revoke session
- WS events:
  - `client→server`: `presence.ping` (throttled, on visibility change + activity)
  - `server→client`: `presence.update {userId, state}`

## Logic
1. On login: create `user_sessions` row + refresh token → sessionId cookie.
2. On WS connect: client sends `sessionId`; BFF TCP-calls backend `presence.touch {userId, sessionId}`; backend writes HASH entry + computes state + emits `PresencePublisher.publish(userId, state)` **eagerly** if state changed. Covers "new tab → online" within <500ms (ping interval + Redis RTT).
3. Client sends `presence.ping` every 20s when active; on window blur pings stop; on visibilitychange visible → ping. Each ping refreshes HASH ts. If state changed (e.g. AFK → online), eager publish.
4. On WS disconnect: BFF TCP-calls backend `presence.disconnect {userId, sessionId}`; backend removes entry from HASH + re-derives + eagerly publishes. Last sessionId removed → offline within <2s (no wait for TTL).
5. Scheduler (every 10s) handles AFK threshold + crashed-client cleanup only: for each user with HASH entries, if freshest ts > AFK_THRESHOLD_SECONDS ago → state=afk (eager publish if changed); if HASH empty or all expired → state=offline + DEL key. Does NOT drive online transitions.
6. `PresencePublisher` (from EPIC-03 transport module) emits `presence.update {userId, state}` to `RedisChannel.presenceGlobal` (500ms debounced coalescer for bursts). BFF subscribers filter to interested clients per AC-03-11.
7. EPIC-09 consumes `presence:global` as observer — no writes.

## Dependencies
EPIC-01 (auth). EPIC-03 (PresencePublisher primitive + transport). See ADR-001. EPIC-03 PresencePublisher primitive. Env var AFK_THRESHOLD_SECONDS (default 60).

## Out of scope
Device names, geolocation, typing indicators.

## Risks
- Storm of presence updates → throttle at BE (coalesce 500ms), fan-out per-room only to joined clients.
- PresencePublisher coupling: EPIC-02 hard-imports EPIC-03 module (NestJS provider). Acceptable: same backend process, type-safe, mockable.
- Scheduler skew under load: 300 users × 10s cycle. Mitigate via Redis pipeline batching + per-user dirty flag (set on ping, cleared on evaluate).
- Crashed-client fallback: 90s TTL on presence:state:{userId} safety net if scheduler dies mid-cycle. Dead-man switch, not primary path.
- Reconnect: 5-second network blip → HASH TTL does NOT expire; state stays online if sweep hasn't fired. FE must re-emit ping on reconnect to refresh ts.