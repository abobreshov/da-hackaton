# Implementation Status

Live progress tracker for MVP build-out. Updated as milestones land.
See `mng/specs/` for specifications + `mng/architecture/` for diagrams.

**Last updated:** 2026-04-20 (M3 plan)

## Milestone map

| Milestone | Demo state | Status |
|---|---|---|
| **M1 — Auth loop** | Register → login → 2FA → /dashboard → browse empty /rooms catalog → logout. Mailpit observable. | **DONE** (2026-04-20) |
| **M2a — WS + presence pipeline** | Internal integration: WS gateway mounted, cookie handshake, PresenceService + eager publish + scheduler, 2-browser presence demo in devtools. | **DONE** (2026-04-20) |
| **M2b — Rooms & membership UI** | Demo-able: browse/join/leave rooms; presence online/AFK/offline dots in members pane; friends pane; rate-limit decorators on register/login/reset. | **DONE** (2026-04-20) |
| **M3 — Messaging core** | Room + DM messaging, admin delete, friend → DM flow, moderation basics. | NOT STARTED |
| **M4 — Attachments & unread** | Upload image/file; unread badges; offline delivery. | NOT STARTED |
| **M5 — Reviewer-ready** | Top-5 reviewer journeys green; rate-limits + CSRF + OriginGuard tightened; retention tested. | NOT STARTED |

## Per-EPIC status

Legend: ✅ shipped · 🟡 partial · ⏳ not started · ⏸ deferred

| EPIC | Backend | BFF | Frontend | Tests | Notes |
|---|---|---|---|---|---|
| 01 accounts-auth | ✅ | ✅ | ✅ | ✅ | register, reset (email-token via Mailpit), change, delete w/ async cascade; JWT + TOTP 2FA; refresh rotation |
| 02 sessions-presence | ✅ | ✅ WS-driven | ✅ hooks + PresenceDot | ✅ | PresenceService eager-publish + scheduler; `presence:sessions:{id}` + `presence:state:{id}` Redis layout; AFK_THRESHOLD_SECONDS env |
| 03 realtime-transport | ✅ PresencePublisher | ✅ gateway + subscriber | ✅ Socket.IO client | ✅ | WS gateway on `/ws`, Redis IoAdapter mounted, cookie handshake, interest-graph fan-out via `presence:global` coalesced 500ms |
| 04 contacts-friends | ✅ | ✅ proxy + list endpoints | ✅ contacts route | ✅ | atomic ban-tx, friends.list + listPending wired end-to-end |
| 05 rooms | ✅ + membersOf/ensureMember | ✅ proxy | ✅ catalog + detail | ✅ | rooms detail renders members w/ live PresenceDot |
| 06 moderation | ✅ moderation + reports + audit | ✅ proxy + admin-gated | ⏳ admin modal | ✅ | ModerationTcpController added; AdminGuard in BFF; FE admin modal pending |
| 07 messaging | 🟡 schema | ⏳ | ⏳ | — | FKs + indexes; service + WS wiring pending (M3) |
| 08 attachments | 🟡 schema | ⏳ | ⏳ | — | schema + indexes; service + FS storage pending (M4) |
| 09 notifications-unread | 🟡 schema | ⏳ | ⏳ | — | `user_last_read` functional unique index; observer logic pending (M4) |
| 10 ui-shell | — | — | 🟡 partial | ✅ | login, register, reset, verify-2fa, dashboard, rooms catalog + detail, contacts; chat composer + admin modal + responsive pending |
| 11 scale-reliability | ✅ workers + scheduler | ✅ rate-limiter + throttle-mounted | ⏳ | ✅ | BullMQ 4 queues + nightly retention.prune; Redis sliding-window throttle on register/login/reset |
| 12 deployment | ✅ compose | — | — | — | Postgres, Redis, Mailpit, Dozzle, attachments volume; mTLS certs |
| 13 xmpp-federation | ⏸ DEFERRED | ⏸ | ⏸ | ⏸ | post-MVP per product decision |
| 14 security-nfrs | — | ✅ | ✅ partial | ✅ | CSRF double-submit, WS OriginGuard mounted, WireError envelope, mTLS, throttle decorator; AC-14-12/13 spam limits pending |
| 15 contracts | ✅ | ✅ | ✅ | ✅ + grep-gate | `@app/contracts` wired; inline-drift CI gate w/ 76-literal allow-list |
| design-system | — | — | 🟡 spec only + partial retheme | — | Kinetic Playground tokens partially landed in login/auth shell; full UI primitives refactor pending |

## Test coverage (post-M2)

| Workspace | Tests | Notes |
|---|---|---|
| `@app/auth-service` | 137 | Coverage 99.8% stmt |
| `@app/backend` | 286 | +83 since M1 |
| `@app/bff` | 226 | +84 since M1 |
| `@app/frontend` | 143 | +49 since M1; 3 pre-existing copy-drift failures |
| `@app/contracts` | 32 | +3 grep-gate |
| **Unit total** | **824** | |
| E2E (Playwright) | 16 | +3 M2 specs (red until live stack) |
| Integration (testcontainers) | 1 | |

## Deferred / debt (post-M2)

1. **Design-system refactor** — `tailwind.config.ts` default shadcn; login/auth shell partially themed to Kinetic Playground. Full UI primitives retheme + route audit pending. Applies to rooms-detail + contacts + admin modal when built.
2. **M1 contracts drift backfill** — inline wire-string literals allow-listed in grep-gate:
   - `bff/src/auth/auth.service.ts` — 12 `auth.*`
   - `bff/src/modules/users/users.service.ts` — `users.list`, `users.findById`
   - `backend/src/common/guards/jwt.guard.ts` — `auth.customer.validateToken`
   - `backend/src/modules/audit/audit.controller.ts` — `auth.customer.validateToken`
   - `backend/src/modules/bans/bans.service.ts` — `dm.frozen`, `friend.removed`
   - `backend/src/modules/friends/friends.service.ts` — `friend.removed`, `friend.request.accepted`, `friend.request.new`
   - `backend/src/modules/users/users.tcp.ts` — `users.list`, `users.findById`
   - `backend/src/workers/queue.producer.ts` — 4 `QueueName` values
   - `auth-service/src/modules/auth/admin/admin-auth.tcp.ts` — 3 `auth.admin.*`
3. **E2E M2 specs red** — live-stack dependent; bring up stack + re-run for green.
4. **Dashboard copy-drift tests** — 3 pre-existing failures in `dashboard.test.tsx` asserting old `scopes:read/write` / `no scopes assigned` / `user` type copy removed in Kinetic Playground redesign.
5. **Backend schema index.ts coverage** — Drizzle barrel accessors uncovered (40-66%); covered by integration tests only.
6. **EPIC-02 session DB row** — `user_sessions` table migration exists; backend service still writes only to Redis. Durable session record + active-sessions UI (§2.2.4) pending.

## M3 candidates (split)

**M3a — Messaging pipe (backend + BFF + WS handlers + OOP refactors + seed)**

1. OOP refactor: global RpcExceptionFilter on backend + auth-service microservice bootstrap; delete 6 toRpc copies across modules (rooms, moderation, abuse-reports, audit, friends, bans). Controllers become pure dispatch.
2. OOP refactor: slim ChatGateway — extract `WsAuthenticator` (cookie → session), inject `RpcProxyService` in place of raw `this.backend.send(...)` calls (currently bypasses the new proxy).
3. Backend `MessagesModule` + `MessagesService` + `MessagesRepository` (port/adapter to match rooms) + `MessagesTcpController`. AC-07-16 lazy dm_channels upsert, AC-07-19 atomic INSERT...WHERE NOT EXISTS frozen guard, AC-07-20 composite `(created_at, id)` keyset cursor. Migration for index extension if needed.
4. Backend `messages.getById` TCP cmd (reply hover + admin report target hydration).
5. Backend `rooms.update` TCP cmd + service method (owner PATCH).
6. BFF `MessagesModule` proxy via `RpcProxyService` + `GET /rooms/:id/messages` + `GET /dms/:userId/messages` + `GET /messages/:id` + `PATCH /rooms/:id` (owner).
7. BFF `ChatGateway` extended with `@SubscribeMessage('message.send'|'message.edit'|'message.delete'|'sync.since')`. Fan-out via `io.to('room:'+id).emit(...)` using Socket.IO + redis-adapter (drop custom BFF subscriber for msg fan-out; keep for presence).
8. AC-14-04 refined rate-limit: 30 msg/5s create, 60/min edit+delete budget. Mount on send/edit/delete WS handlers.
9. `seed:demo` real impl: `#general`, `#random`, `#demo` rooms + 10-20 sample messages each (mix regular/reply/edited).
10. E2E specs: backend messaging integration test via testcontainers; BFF WS send-receive spec via socket.io-client.

**M3b — Frontend chat viewport + Track B admin FE + Manage Room + ban UX**

11. Frontend chat viewport on `/rooms/$roomId`: `MessageList` (keyset infinite scroll), `MessageComposer` (send + reply quote), `MessageBubble` w/ Kinetic Playground asymmetric rounding + gradient "me" bubbles, edit indicator, tombstone render.
12. `useMessages(roomId|dmId)` hook — normalized Map cache keyed by messageId; WS subscribe to message.new/edited/deleted; applies mutations regardless of viewport.
13. `UserPopover` component (AC-10-15) — hookable to avatar/name/mention clicks. Exposes Open DM, Add friend, Block, Report.
14. `/_auth/admin/*` layout + routes: `reports`, `audit-log`, `users`, `rooms` (AC-10-12 superseded). Guard via `session.type === 'admin'` in beforeLoad.
15. Manage Room modal (AC-10-16): 5 tabs Members / Admins / Banned users / Invitations / Settings. Invitations tab wires backend `rooms.invite` — close §2.4.9 PDF gap.
16. DM path: `/_auth/dm/$userId` route via lazy dm_channel resolve. Composer disabled + "frozen" banner when dm_channels.frozen_at set (AC-04-07).
17. Spam rate-limits AC-14-13: friend-request 20/hr, room-create 10/hr, report-create 10/hr — decorator mount on respective endpoints.
18. WS connect rate-limit AC-14-12: 10 connects/60s per userId — mount on handshake.
19. E2E: send-receive 2-browser ≤3s, edit indicator, author-delete, admin-delete, report → admin resolve → audit visible, block-from-popover → DM frozen.

## ADR index

- **ADR-001** — Presence source of truth: EPIC-02 owns state + DB writes; EPIC-03 provides `PresencePublisher` primitive; EPIC-09 observer only.
- **ADR-002** — Async account-delete cascade: auth-service invokes backend TCP `users.cascade.enqueue`; backend owns BullMQ enqueue to `user.cascade.delete`; consumer in EPIC-11.
- **ADR-003** — WS handshake auth: cookie-only for MVP (same-origin BFF). No session-ticket endpoint. Cross-origin / native clients POST-MVP.
- **ADR-004** — Message fan-out: Socket.IO room + @socket.io/redis-adapter native broadcast (`io.to('room:'+id).emit`). Drop custom BFF subscriber for message channel. Presence keeps explicit interest-graph subscriber (different semantics).
