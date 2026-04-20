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
| FE ↔ BFF | HTTPS + Socket.IO WebSocket | Single edge, cookie-based auth |
| BFF → Auth | NestJS TCP microservice | Internal RPC, RpcException mapping |
| BFF → BE | NestJS TCP microservice | Internal RPC for commands |
| BE → BFF (push) | Redis pub/sub | Fan-out of real-time events to BFF replicas |
| BE ↔ XMPP | XMPP (s2s) | EPIC-13 federation |

## Auth flow summary

1. FE POST `/auth/login` → BFF → Auth (TCP `auth.customer.login`)
2. Auth returns `{user, accessToken, refreshToken}` OR `{requires2fa:true}`
3. BFF sets two-layer signed cookies (JWT session + refresh)
4. FE opens Socket.IO with `credentials:'include'`; BFF `SessionGuard` validates cookie on WS upgrade

## Real-time flow summary

1. FE `socket.emit('message.send', {roomId, text})`
2. BFF WS handler validates session, calls BE via TCP `messages.create`
3. BE persists, publishes `channel room:{id}` on Redis
4. BFF subscribers for that room receive event → broadcast to Socket.IO clients in room
5. Sender de-duplicates by message id

## Scale model

- BFF horizontal: sticky sessions OR `@socket.io/redis-adapter` for cross-node broadcast
- BE horizontal: stateless; Redis is single source of truth for pub/sub
- Postgres: single primary; indexes `(room_id, created_at DESC)` for messages, cursor pagination
- Files: local FS for MVP (per §3.4). For multi-replica BE, switch to shared volume or S3-compatible store

## Security boundaries

- Only BFF and FE exposed to internet. Auth/BE services listen on docker-internal network only.
- BE never reads `COOKIE_SECRET` or `SESSION_COOKIE_SECRET`.
- Rate limiting + request logging at BFF edge.
- CSRF double-submit on state-changing REST (X-CSRF-Token); WS origin checked at handshake (ALLOWED_WS_ORIGINS); rate-limit counters in Redis (login 5/15m, reset 1/min, msg 30/5s).
- System-to-system calls use `x-system-key` header (existing `SystemKeyGuard`).

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
