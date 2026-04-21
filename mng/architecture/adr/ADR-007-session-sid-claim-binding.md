# ADR-007 — Session-ID claim binding for revoke chain

**Status:** Accepted (2026-04-21)
**Milestone:** M5 critical fixes
**Related commits:** `e2cbe79` (sessions backend), `ffee0f5` (BFF + FE surface), `af8d1dd` (revoke wires sid → JWT validate)

## Context

EPIC-02 needs a working "Sign out other sessions" gesture. Without it the revoke endpoint deletes the `user_sessions` row but the access-token cookie keeps minting authenticated requests until its natural expiry (15 min). Reviewer-grade demo requires immediate effect — the revoked tab must lose access on the next request, not 15 minutes later.

Constraints we picked from:

1. **Per-request DB lookup on every authed call.** Honest but expensive — adds a Postgres round-trip per request to a table that is otherwise cold.
2. **Short TTL on access tokens (e.g. 60 s).** Leaks the lifetime budget into the auth contract; refresh storms on every tab.
3. **Bind a session-id claim to the access token + check revocation per validate.** Adds a single TCP probe to auth-service per request; revocation is O(1) on a bool column already on `user_sessions`.

## Decision

Adopt option 3.

- At login (and 2FA second-step) auth-service issues a fresh `sid` UUID, persists it on the new `user_sessions` row, and stamps the access-token + refresh-token JWT payload with `{ sub, sid }`.
- `validateToken` (called by BFF on every authed request) decodes the JWT, then probes `sessions.isRevoked(sid)` over TCP (`TcpCmd.sessions.isRevoked`). Revoked → 401, BFF clears cookies, FE bounces to `/login`.
- `sessions.revoke(sid)` flips `is_revoked = true` + `revoked_at = now()` on the row. No JWT blacklist; the row IS the blacklist.
- Refresh-token rotation MUST preserve the original `sid` so the revoke target stays addressable across token cycles. `recordLogin` only mints a new sid on a true new login (not on rotation).

## Trade-offs

- **Latency:** +1 TCP probe per validate. Measured ~5 ms on localhost mTLS; cached via in-memory LRU (5 s TTL) for hot paths. Acceptable for the demo envelope (300 concurrent × 6 msg/s — see ADR-006).
- **Fail-OPEN on backend bounce:** if backend TCP is down, `isRevoked` throws → guard treats as "unknown, allow". Chose OPEN over CLOSED because a dead backend already prevents every domain operation; closing auth on top blocks recovery flows. Logged at WARN.
- **Best-effort `recordLogin`:** if backend is down at login, auth-service still mints a token — but with `sid: null`. Such tokens cannot be revoked individually and survive until natural expiry. Tracked as known gap; acceptable for hackathon, would harden post-MVP via outbox.
- **No backwards-compat for pre-`sid` tokens:** any token minted before this commit lacks `sid`; treated identically to the fail-open backend case (allowed until expiry). Refresh forces re-mint.

## Consequences

- Refresh-token rotation logic in auth-service must thread `sid` through the new token (covered by parallel work landing alongside `af8d1dd`). A rotation that drops `sid` would silently break revoke for the rotated tab.
- BFF `/sessions` DELETE endpoint is now meaningful end-to-end; the FE "Sign out other sessions" button is no longer cosmetic.
- `user_sessions.is_revoked` becomes hot read; covered by the existing `(user_id, sid)` index, no new index required at MVP scale.
- Future work: move the revoke check into Redis (publish on revoke, subscribe in auth-service) to drop the per-request TCP. Out of scope for M5.
