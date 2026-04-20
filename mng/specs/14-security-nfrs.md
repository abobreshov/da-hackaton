# EPIC-14 — Security NFRs & Abuse Prevention

**Req refs:** cross-cutting (§2.1, §3.5, §3.6, §5)

## Goal
Non-functional security baseline. Rate-limit abuse vectors (login, password-reset email, messaging). TLS, CSRF, WS origin, XSS/input-sanitization. Apply all EPICs.

## Scope
- TLS termination at edge (reverse proxy / load balancer; MVP: self-signed or behind tunnel)
- CSRF protection on cookie-auth endpoints (SameSite=Lax default; double-submit token for state-changing non-WS endpoints)
- WebSocket origin check at handshake (reject non-allowed origins)
- Global per-user messaging rate-limit: 30 msg / 5s sliding window. Exceed → WS error + 429 on REST fallback.
- Password-reset email rate-limit: 1/min per email AND 5/hr per client IP
- Login attempt rate-limit: 5 failed / 15min per email (per existing code if any; else add)
- Input sanitization: server-side. Store raw text, reject control chars (except \n, \t). UTF-8 validated.
- Output encoding: frontend escape message body; no innerHTML of untrusted content
- Password hashing: bcrypt ≥12 rounds (existing, restated as invariant)
- Session cookies: HttpOnly, Secure (prod), SameSite=Lax, signed + encrypted (existing two-layer per app/CLAUDE.md)
- JWT refresh rotation: single-use refresh tokens, Redis-backed (existing)
- SMTP credentials via env, never committed
- WS connect + spam rate-limits (friend-req, room-create, report-create) per AC-14-12/13

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-14-01 | TLS required in prod deploy (non-TLS traffic 301→https) |
| AC-14-02 | Cookie-auth state-changing endpoints require CSRF double-submit token |
| AC-14-03 | WS handshake rejects non-allowed origin (configurable `ALLOWED_WS_ORIGINS` env) |
| AC-14-04 | `messages.create` rate-limit 30/5s sliding window per user (Redis `ratelimit:msg:{userId}`). Exceed → WS `error` event `{code:'RATE_LIMITED', retryAfterMs}`. `messages.edit`+`messages.delete` share a separate 60/min per user budget (spam guard, not abuse-vector sized). |
| AC-14-05 | Password-reset email: ≤1/min per email, ≤5/hr per IP. Exceed → 429; no info leak |
| AC-14-06 | Login: 5 failed attempts / 15min per email → temporary lockout (15min) |
| AC-14-07 | Bodies sanitized server-side: UTF-8 validated, control chars rejected except \n, \t |
| AC-14-08 | Frontend escapes all message body rendering; no raw HTML injection |
| AC-14-09 | Passwords bcrypt ≥12 rounds (invariant check on startup) |
| AC-14-10 | Session cookies HttpOnly + SameSite=Lax; Secure enforced when `NODE_ENV=production` |
| AC-14-11 | Refresh tokens single-use; reuse attempt → full session revocation for that user |
| AC-14-12 | WS connect rate-limit: 10 connects/60s per userId (Redis `ratelimit:wsconn:{userId}`). Exceed → handshake close code 4429 `WireError {code:RATE_LIMITED}`. Fail-closed. |
| AC-14-13 | Spam rate-limits: friend-request create 20/hr per userId, room-create 10/hr per userId, report-create 10/hr per userId. Exceed → 429 `WireError {code:RATE_LIMITED, retryAfterMs}`. Fail-open (chat bias). |

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
- CSRF for WS not applicable (upgrade request); origin check is defense.
- Same IP NAT → many users share IP. Per-email limit primary; per-IP blunt guard.