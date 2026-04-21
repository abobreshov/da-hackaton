# Architecture — Online Chat Server

High-level system diagram + transport model. Targets: 300 concurrent users, 1000 members/room, 10k-message history, ≤3s message delivery, ≤2s presence propagation.

## Component overview

```mermaid
flowchart TB
    subgraph Client
        U["Users (browser)"]
        FE["Frontend — React 19, TanStack Router, Socket.IO client"]
    end

    subgraph EdgeBFF["BFF — NestJS + Fastify"]
        BFFH["HTTP Controllers<br/>login, session, rooms, attachments"]
        BFFWS["WebSocket Gateway<br/>Socket.IO"]
        BFFSG["SessionGuard<br/>two-layer signed cookie"]
        BFFORIG["WS OriginGuard<br/>ALLOWED_WS_ORIGINS"]
        BFFCSRF["CSRF double-submit<br/>@fastify/csrf-protection"]
        BFFRL["RateLimit<br/>login 5/15m · reset 1/min · msg 30/5s"]
        BFFRED["Redis client<br/>pub/sub + cache"]
    end

    subgraph Services["Internal (docker network only)"]
        AUTH["Auth Service<br/>NestJS HTTP 3003 + TCP 4003<br/>Drizzle, Redis refresh tokens"]
        BE["BE Service<br/>NestJS HTTP 3004 + TCP 4004<br/>Drizzle, Redis, XMPP bridge"]
        WORKER["BullMQ Worker<br/>user.cascade.delete · retention.prune · attachments.cleanup"]
    end

    subgraph Data
        PGMAIN[(Postgres — single app DB<br/>users, rooms, messages, attachments,<br/>abuse_reports, audit_log)]
        REDIS[(Redis<br/>presence · pub/sub · refresh tokens ·<br/>BullMQ · rate-limit counters ·<br/>socket.io-redis-adapter)]
        FS[("Local FS<br/>/data/attachments")]
    end

    subgraph Edge["Edge"]
        TLS["Reverse Proxy / TLS terminator<br/>nginx or Caddy · 301 http→https"]
    end
    subgraph Ops["Ops (dev + MVP)"]
        MAIL["Mailpit<br/>SMTP capture + REST API · :8025 UI"]
        DOZZLE["Dozzle<br/>container log viewer"]
    end

    subgraph Advanced["EPIC-13 Jabber — DEFERRED POST-MVP"]
        XMPPA["ejabberd A"]
        XMPPB["ejabberd B"]
    end

    U --> FE
    FE -->|HTTPS + cookies| TLS --> BFFH
    FE -->|WSS + cookie| TLS --> BFFWS

    BFFH --> BFFRL --> BFFCSRF --> BFFSG
    BFFWS --> BFFORIG --> BFFSG
    BFFH -->|TCP ClientProxy| AUTH
    BFFH -->|TCP ClientProxy| BE
    BFFWS -->|TCP ClientProxy| BE
    BFFH --> BFFRED
    BFFWS --> BFFRED
    BFFRED <--> REDIS
    BFFRL --> REDIS

    BE --> PGMAIN
    BE -->|enqueue| REDIS
    WORKER -->|consume BullMQ| REDIS
    WORKER --> PGMAIN
    WORKER --> FS
    BE --> REDIS
    BE --> FS
    AUTH --> PGMAIN
    AUTH --> REDIS
    AUTH -->|SMTP password-reset| MAIL

    BE <-->|XMPP bridge| XMPPA
    XMPPA <-->|s2s federation| XMPPB
```

## Transport choices

| Path | Protocol | Why |
|---|---|---|
| FE ↔ BFF (HTTP) | HTTPS + signed session cookie | Single edge, cookie-based auth, CSRF double-submit |
| FE ↔ BFF (realtime) | Socket.IO (WSS + cookie handshake) | Cookie auth on upgrade (ADR-003) |
| BFF → Auth | NestJS TCP microservice + **mTLS** + `_sys` envelope | Internal RPC, `SystemKeyRpcGuard` rejects forged calls |
| BFF → BE | NestJS TCP microservice + **mTLS** + `_sys` envelope | Same |
| BE → BFF (push) | Redis pub/sub via `@socket.io/redis-adapter` | Fan-out across BFF replicas (ADR-004) |
| BE ↔ XMPP | XMPP (s2s) | EPIC-13 federation — **deferred post-MVP** |

## Auth flow summary

```mermaid
sequenceDiagram
    autonumber
    participant U as Browser
    participant FE as Frontend (React)
    participant BFF as BFF (NestJS)
    participant AUTH as Auth Service
    participant R as Redis

    U->>FE: enter email + password
    FE->>BFF: POST /auth/login {email, password}
    BFF->>AUTH: TCP auth.customer.login (mTLS + _sys)
    AUTH->>AUTH: bcrypt verify + 2FA gate
    alt 2FA enabled
        AUTH-->>BFF: { requires2fa: true }
        BFF-->>FE: 200 { requires2fa: true }
        FE->>BFF: POST /auth/login { email, password, totpCode }
        BFF->>AUTH: TCP auth.customer.login (+ totp)
    end
    AUTH->>R: refresh:u:{id}:{hash} SET
    AUTH-->>BFF: { user, accessToken, refreshToken, sid }
    BFF-->>FE: Set-Cookie: session + refresh (HMAC-signed JWTs)
    FE->>BFF: Socket.IO connect (cookie handshake)
    BFF->>BFF: SessionGuard validates on upgrade
    BFF-->>FE: ws open
```

## Real-time flow summary

```mermaid
sequenceDiagram
    autonumber
    participant A as Sender (Browser A)
    participant BA as BFF-replica-A
    participant BE as Backend
    participant R as Redis (pub/sub + socket.io-redis-adapter)
    participant BB as BFF-replica-B
    participant B as Receiver (Browser B)

    A->>BA: socket.emit('message.send', {roomId, body})
    BA->>BE: TCP messages.create (mTLS + _sys)
    BE->>BE: persist row + hydrate author
    BE-->>BA: ack { message }
    BA-->>A: ack (optimistic → convergent)
    BE->>R: PUBLISH room:{id} message.new
    R-->>BA: fan-out message.new
    R-->>BB: fan-out message.new
    BA-->>A: emit message.new (dedup by id)
    BB-->>B: emit message.new
```

## Presence flow summary

```mermaid
sequenceDiagram
    autonumber
    participant FE as Frontend
    participant BFF as BFF WS Gateway
    participant BE as Backend (presence service)
    participant R as Redis (presence hash + pub/sub)

    FE->>BFF: socket connect (cookie handshake)
    BFF->>BE: TCP presence.touch {userId, sessionId}
    BE->>R: HSET presence:user:{id} status=online ts=now
    BE->>R: PUBLISH presence:user:{id} online
    R-->>BFF: fan-out presence event
    BFF-->>FE: emit presence.update {userId, status}
    note over FE: AFK threshold (dev 5s, prod 60s)<br/>scheduler prunes dead keys every 10s (ADR-001)
    FE-->>BFF: socket disconnect (tab close)
    BFF->>BE: TCP presence.dropSession
    BE->>R: HDEL / publish offline when last session gone
```

## Scale model

- BFF horizontal: sticky sessions OR `@socket.io/redis-adapter` for cross-node broadcast
- BE horizontal: stateless; Redis is single source of truth for pub/sub
- Postgres: single primary; indexes `(room_id, created_at DESC)` for messages, cursor pagination
- Files: local FS for MVP (per §3.4). For multi-replica BE, switch to shared volume or S3-compatible store

## Security boundaries

- Only BFF + FE are exposed to the internet. Auth-service + BE listen on `127.0.0.1` (host) or the internal docker network (containers). `TCP_BIND` defaults to `127.0.0.1`; docker-compose overrides to `0.0.0.0`.
- BE never reads `COOKIE_SECRET` or `SESSION_COOKIE_SECRET`.
- Rate limiting + request logging at the BFF edge.
- CSRF double-submit on state-changing REST (`X-CSRF-Token`); WS origin checked at handshake (`ALLOWED_WS_ORIGINS`); Redis sliding-window counters (login 5/15 min, reset 1/min, msg 30/5 s).
- **Two independent defenses on every TCP RPC** (see `app/CLAUDE.md` → Inter-service security):
  1. **`_sys` envelope** — `withSys(payload)` injects `_sys: SYSTEM_KEY`; `SystemKeyRpcGuard` (`APP_GUARD`) rejects mismatches with `RpcException 401`.
  2. **Mutual TLS** — `Transport.TCP` built with `tlsOptions: { ca, cert, key, requestCert: true, rejectUnauthorized: true }`. Certs minted by `app/scripts/gen-certs.sh` into `app/secrets/internal-ca/` (gitignored).
- **Session revocation** — every access JWT carries a `sid` UUID claim bound at mint; `validateToken` probes `sessions.isRevoked(sid)` over TCP on every hit (ADR-007).

## Non-functional targets mapping

| Req | Implementation |
|---|---|
| §3.1 300 users / 1000 per room | Socket.IO + Redis adapter; Postgres indexed tables |
| §3.2 ≤3s deliver / ≤2s presence | WS direct push + Redis pub/sub |
| §3.3 Persistence for years | Postgres + time-partitioned messages (optional) |
| §3.4 Local FS, 20MB/3MB | Fastify multipart + MIME/size validation |
| §3.5 No auto-logout, persistent | Long-TTL refresh cookie + transparent refresh |
| §3.6 Consistency | Server-side permission checks only; BullMQ for async cleanup |
| §5 TLS + CSRF + WS origin + rate-limit | Edge TLS, @fastify/csrf-protection, OriginGuard, Redis sliding-window |
