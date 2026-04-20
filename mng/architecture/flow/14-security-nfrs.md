# Flow — EPIC-14 Security NFRs

Cross-cutting NFRs. Rate-limits live in Redis. CSRF at BFF REST. Origin check at WS handshake. Refresh rotation in Auth.

## CSRF double-submit on state-changing REST

```mermaid
sequenceDiagram
    participant FE
    participant BFF
    participant AUTH
    FE->>BFF: GET /auth/session (bootstrap)
    BFF-->>FE: Set-Cookie: csrf=<rnd> (NOT HttpOnly) · body {csrfToken}
    FE->>FE: store csrfToken in memory
    FE->>BFF: POST /rooms (Cookie: session,csrf · Header: X-CSRF-Token)
    BFF->>BFF: @fastify/csrf-protection: cookie.csrf == header.X-CSRF-Token
    alt mismatch / missing
        BFF-->>FE: 403 {code:'CSRF_INVALID'}
    else
        BFF->>AUTH: TCP ... proceed
    end
```

## WS origin + SessionGuard

```mermaid
sequenceDiagram
    participant FE
    participant BFF
    FE->>BFF: WS upgrade (Origin: https://chat.example)
    BFF->>BFF: OriginGuard: origin ∈ ALLOWED_WS_ORIGINS?
    alt reject
        BFF-->>FE: 403 close (before SessionGuard)
    else
        BFF->>BFF: SessionGuard: verify signed session cookie
        alt invalid
            BFF-->>FE: 401 close
        else
            BFF-->>FE: upgraded
        end
    end
```

## Sliding-window rate-limits (login · reset · messaging)

```mermaid
flowchart TD
    REQ[request arrives at BFF] --> K{endpoint}
    K -->|POST /auth/login| L1["INCR ratelimit:login:{email} TTL 15m<br/>fail if > 5 failures"]
    K -->|POST /auth/password-reset/request| R1["INCR ratelimit:reset:{email} TTL 60s · must be ≤1<br/>INCR ratelimit:reset:ip:{ip} TTL 1h · must be ≤5"]
    K -->|ws message.send| M1["ZADD ratelimit:msg:{userId} now; ZREMRANGEBYSCORE <now-5s;<br/>ZCARD ≤ 30"]
    L1 -->|exceed| DEN[429 · no info leak]
    R1 -->|exceed| DEN
    M1 -->|exceed| DENWS[ws error RATE_LIMITED retryAfterMs]
    L1 -->|ok| OK[proceed]
    R1 -->|ok| OK
    M1 -->|ok| OK
```

Redis-outage fail-mode: login+reset fail-closed; messaging fail-open + log.

## Refresh token rotation + reuse detection

```mermaid
sequenceDiagram
    participant FE
    participant BFF
    participant AUTH
    participant REDIS
    FE->>BFF: any request (access expired)
    BFF->>AUTH: TCP auth.refresh {refreshToken}
    AUTH->>REDIS: GETDEL refresh:u:{userId}:{tokenHash}
    alt missing (already used OR unknown)
        AUTH->>REDIS: DEL refresh:u:{userId}:* (revoke all)
        AUTH->>DB: INSERT audit_log(action='refresh.reuse.detected')
        AUTH-->>BFF: 401 FULL_REVOKE
        BFF-->>FE: 401 clear cookies
    else ok
        AUTH->>AUTH: issue new access + new refresh
        AUTH->>REDIS: SET refresh:u:{userId}:{newTokenHash} TTL
        AUTH-->>BFF: {access, refresh}
        BFF->>BFF: re-sign session + refresh cookies
        BFF-->>FE: Set-Cookie rotated
    end
```

## TLS edge termination

```mermaid
flowchart LR
    U[Browser] -->|HTTPS/WSS :443| RP[Reverse proxy<br/>nginx/Caddy<br/>TLS cert]
    RP -->|HTTP/WS :3006 docker net| BFF
    U -->|HTTP :80| RP80[301 https]
```

HSTS · Secure cookies · `NODE_ENV=production`.

## Acceptance → artifact map

| AC | Diagram |
|---|---|
| AC-14-01 TLS | TLS edge termination |
| AC-14-02 CSRF | CSRF double-submit |
| AC-14-03 WS origin | WS origin + SessionGuard |
| AC-14-04 msg 30/5s | Sliding-window (messaging branch) |
| AC-14-05 reset 1/min · 5/hr | Sliding-window (reset branch) + flow/01 |
| AC-14-06 login 5/15m | Sliding-window (login branch) |
| AC-14-11 refresh single-use | Refresh rotation |
