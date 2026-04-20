# EPIC-14 — Security NFRs & Abuse Prevention

**Req refs:** cross-cutting (§2.1, §3.5, §3.6, §5)

## Goal
Non-functional security baseline. Rate-limit abuse vectors (login, password-reset email, messaging). TLS, CSRF, WS origin, XSS/input-sanitization. Applies to all EPICs.

## Scope
- TLS termination at edge (reverse proxy / load balancer; MVP: self-signed or behind tunnel)
- CSRF protection on cookie-authenticated endpoints (SameSite=Lax default; double-submit token for state-changing non-WS endpoints)
- WebSocket origin check at handshake (reject non-allowed origins)
- Global per-user messaging rate-limit: 30 msg / 5s sliding window. Exceed → WS error + 429 on REST fallback.
- Password-reset email rate-limit: 1 per minute per email address AND 5 per hour per client IP
- Login attempt rate-limit: 5 failed attempts / 15min per email (per existing code if any; else add)
- Input sanitization: server-side. Store raw text but reject control chars (except \n, \t). UTF-8 validated.
- Output encoding: frontend escapes message body; no innerHTML of untrusted content
- Password hashing: bcrypt ≥12 rounds (existing, restated here as invariant)
- Session cookies: HttpOnly, Secure (prod), SameSite=Lax, signed + encrypted (existing two-layer per app/CLAUDE.md)
- JWT refresh rotation: single-use refresh tokens, Redis-backed (existing)
- SMTP credentials via env, never committed

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-14-01 | TLS required in prod deploy (non-TLS traffic 301→https) |
| AC-14-02 | Cookie-auth state-changing endpoints require CSRF double-submit token |
| AC-14-03 | WS handshake rejects non-allowed origin (configurable `ALLOWED_WS_ORIGINS` env) |
| AC-14-04 | Global rate-limit 30 msg/5s per user. Exceed → 429/WS error event |
| AC-14-05 | Password-reset email: ≤1/min per email, ≤5/hr per IP. Exceed → 429; no info leak |
| AC-14-06 | Login: 5 failed attempts / 15min per email → temporary lockout (15min) |
| AC-14-07 | Bodies sanitized server-side: UTF-8 validated, control chars rejected except \n, \t |
| AC-14-08 | Frontend escapes all message body rendering; no raw HTML injection |
| AC-14-09 | Passwords bcrypt ≥12 rounds (invariant check on startup) |
| AC-14-10 | Session cookies HttpOnly + SameSite=Lax; Secure enforced when `NODE_ENV=production` |
| AC-14-11 | Refresh tokens single-use; reuse attempt → full session revocation for that user |

## API impact
- All mutating REST endpoints: accept `X-CSRF-Token` header, compared against cookie-bound token (`csrf` cookie, not HttpOnly)
- WS gateway: `handshake.headers.origin` checked against `ALLOWED_WS_ORIGINS`
- Error response shape: `{ code: 'RATE_LIMITED', retryAfterMs }`

## Infra
- Rate-limit store: Redis (`ratelimit:msg:{userId}`, `ratelimit:reset:{email}`, `ratelimit:login:{email}`) — sliding window or token-bucket via `@nestjs/throttler` + Redis storage adapter
- CSRF: `@fastify/csrf-protection` plugin in BFF

## Out of scope
- Secrets rotation automation
- Pen test / SAST / DAST pipelines
- SOC2 / audit certification
- WAF / bot mitigation
- MFA beyond TOTP (EPIC-01)

## Dependencies
All EPICs (cross-cutting). Rate-limit wiring consumed by EPIC-01 (login + reset), EPIC-07 (messaging).

## Risks
- Rate-limit store Redis outage → fail-open (log + allow) vs fail-closed. MVP: fail-open for messaging, fail-closed for login/reset.
- CSRF for WS not applicable (upgrade request); origin check is the defense.
- Same IP NAT → many users share IP. Per-email limit is primary; per-IP is a blunt guard.
