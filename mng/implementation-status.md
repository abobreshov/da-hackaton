# Implementation Status

Live progress tracker for MVP build-out. Updated as milestones land.
See `mng/specs/` for specifications + `mng/architecture/` for diagrams.

**Last updated:** 2026-04-20 (M2 split).

## Milestone map

| Milestone | Demo state | Status |
|---|---|---|
| **M1 — Auth loop** | Register → login → 2FA → /dashboard → browse empty /rooms catalog → logout. MailPit observable. | **DONE** (2026-04-20) |
| **M2a — WS + presence pipeline** | Internal integration target: WS gateway mounted, session-cookie handshake, PresenceService + eager publish + scheduler, 2-browser presence demo in devtools. | NOT STARTED |
| **M2b — Rooms & membership UI** | Demo-able: create/browse/join/leave rooms; presence online/AFK/offline dots in members pane; friends pane; rate-limit decorators applied on register/reset. | NOT STARTED |
| **M3 — Messaging core** | Room + DM messaging, admin delete, friend → DM flow, moderation basics. | NOT STARTED |
| **M4 — Attachments & unread** | Upload image/file; unread badges; offline delivery. | NOT STARTED |
| **M5 — Reviewer-ready** | Top-5 reviewer journeys green; rate-limits + CSRF + OriginGuard tightened; retention tested. | NOT STARTED |

## Per-EPIC status

Legend: ✅ shipped · 🟡 partial · ⏳ not started · ⏸ deferred

| EPIC | Backend | BFF | Frontend | Tests | Notes |
|---|---|---|---|---|---|
| 01 accounts-auth | ✅ | ✅ | ✅ | ✅ | register, reset (email-token via Mailpit), change, delete w/ async cascade; JWT + TOTP 2FA; refresh rotation |
| 02 sessions-presence | 🟡 schema | ⏳ | ⏳ | — | migration + schema; presence service + scheduler still TODO |
| 03 realtime-transport | ⏳ | 🟡 skeleton | ⏳ | 🟡 | WS OriginGuard + Redis IoAdapter ready; gateway + session-ticket still TODO |
| 04 contacts-friends | ✅ friends+bans | ⏳ proxy | ⏳ | ✅ | atomic ban-tx, post-commit events; BFF proxy + UI pending |
| 05 rooms | ✅ | ✅ proxy | ✅ empty catalog | ✅ | CRUD + catalog + join/leave/invite; empty-state view live |
| 06 moderation | ✅ moderation + reports + audit | ⏳ proxy | ⏳ admin modal | ✅ | server-side complete; BFF/FE surfaces pending |
| 07 messaging | 🟡 schema | ⏳ | ⏳ | — | FKs + indexes; service + WS wiring pending |
| 08 attachments | 🟡 schema | ⏳ | ⏳ | — | schema + indexes; service + FS storage pending |
| 09 notifications-unread | 🟡 schema | ⏳ | ⏳ | — | `user_last_read` UNIQUE functional index; observer logic pending |
| 10 ui-shell | — | — | 🟡 partial | ✅ | login, register, reset, verify-2fa, dashboard, rooms-empty; chat viewport + admin modal + responsive pending |
| 11 scale-reliability | ✅ workers + scheduler | ✅ rate-limiter | ⏳ | ✅ | BullMQ 4 queues + nightly retention.prune; Redis sliding-window throttle guard |
| 12 deployment | ✅ compose | — | — | — | Postgres, Redis, Mailpit, Dozzle, attachments volume; mTLS certs |
| 13 xmpp-federation | ⏸ DEFERRED | ⏸ | ⏸ | ⏸ | post-MVP per product decision |
| 14 security-nfrs | — | ✅ | ✅ partial | ✅ | CSRF double-submit, WS OriginGuard, WireError envelope, mTLS, throttle decorator |
| 15 contracts | ✅ | ✅ | ✅ | ✅ | `@app/contracts` wired across 4 services; 29 unit tests |
| design-system | — | — | 🟡 spec only | — | binding spec landed; Tailwind tokens + UI primitives refactor pending |

## Test coverage

| Workspace | Tests | Stmt | Branch |
|---|---|---|---|
| `@app/auth-service` | 137 | 99.8% | 92.8% |
| `@app/backend` | 203 | 92.5% | 98.0% |
| `@app/bff` | 142 | 99.4% | 87.2% |
| `@app/frontend` | 94 | 89.8% | — |
| `@app/contracts` | 29 | — | — |
| **Unit total** | **605** | | |
| E2E (Playwright) | 13 | | |
| Integration (testcontainers) | 1 | | |

## Post-M1 debt

1. **Design-system refactor** — `tailwind.config.ts` still default shadcn; UI primitives + routes built during M1 violate "The Kinetic Playground" non-negotiables (no-border, surface tiers, Plus Jakarta Sans + Be Vietnam Pro, gradient CTAs, asymmetric chat bubbles).
2. **Frontend `ErrorCode.INTERNAL` typo** — not in enum; existing test files reference it; should be `UPSTREAM_UNAVAILABLE`.
3. **Doc count stale** — root `CLAUDE.md` + `README.md` say specs "01-14"; actual = 15 feature specs + design-system.
4. **E2E suite** — covers auth loop; registration, rooms-empty, admin-ban, attachments, messaging journeys pending.
5. **Backend schema index.ts** — Drizzle barrel accessors uncovered (40-66%); acceptable, exercised by integration tests only.
6. **Rate-limit decorators not mounted** on `/auth/register` and `/auth/password-reset/*` endpoints. Guard + decorator exist; wire-up pending.

## M2 candidates (ordered by critical path)

**M2a (ordered)**
1. **M2a** — OOP blockers: add `ModerationTcpController`; consolidate `toRpc` to `common/rpc-transport.ts` and delete per-module copies; extract `IEventPublisher` interface + DI token.
2. **M2a** — Dep install: `socket.io-client` in frontend; verify `@nestjs/websockets` + `@nestjs/platform-socket.io` as direct BFF deps (promote if transitive).
3. **M2a** — EPIC-02 PresenceService + PresenceModule + scheduler (eager publish, AFK_THRESHOLD_SECONDS env, default 60).
4. **M2a** — EPIC-03 PresencePublisher + TransportModule in backend.
5. **M2a** — BFF WS gateway + WsModule + RedisSubscriberService + mount RedisIoAdapter + WsOriginGuard in main.ts.
6. **M2a** — Backend TCP additions: `presence.stateOf`, `presence.disconnect`, `rooms.membersOf`, `rooms.ensureMember`.
7. **M2a** — Frontend: Socket.IO client singleton (`lib/socket.ts`), `usePresence` ping loop, typed `useSocket` hook, `PresenceDot` component.
8. **M2a** — Contracts drift consolidation — 25 inline wire-string literals found by M1 grep-gate; all should import from `@app/contracts`:
   - `app/src/bff/src/auth/auth.service.ts` — 12 `auth.*` TCP cmd strings
   - `app/src/backend/src/common/guards/jwt.guard.ts` — `auth.customer.validateToken`
   - `app/src/backend/src/modules/audit/audit.controller.ts` — `auth.customer.validateToken`
   - `app/src/backend/src/modules/moderation/moderation.service.ts` — 5 audit `action` strings
   - `app/src/backend/src/modules/bans/bans.service.ts` — 3 `events.emit()` names
   - `app/src/backend/src/modules/friends/friends.service.ts` — 3 `events.emit()` names

**M2b**
1. **M2b** — BFF proxies for friends, bans, moderation, reports, audit (after extracting generic `RpcProxyService` helper per devils-advocate).
2. **M2b** — Frontend: rooms detail shell (`_auth/rooms/$roomId.tsx`), contacts pane (`_auth/contacts.tsx`), admin modal skeleton.
3. **M2b** — EPIC-14 rate-limit decorator mount on `/auth/register` + `/auth/password-reset/*` endpoints + new AC-14-12/13 buckets.
4. **M2b** — Seed-demo real impl.
5. **M2b** — Contracts grep-gate CI.

## ADR index

- **ADR-001** — Presence source of truth: EPIC-02 owns state + DB writes; EPIC-03 provides `PresencePublisher` primitive; EPIC-09 observer only.
- **ADR-002** — Async account-delete cascade: auth-service invokes backend TCP `users.cascade.enqueue`; backend owns BullMQ enqueue to `user.cascade.delete`; consumer in EPIC-11.
- **ADR-003** — WS handshake auth: cookie-only for MVP (same-origin BFF). No session-ticket endpoint. Cross-origin / native clients POST-MVP.
