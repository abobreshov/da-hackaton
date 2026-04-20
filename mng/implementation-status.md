# Implementation Status

Live progress tracker MVP build-out. Updated as milestones land.
See `mng/specs/` for specs + `mng/architecture/` for diagrams.

**Last updated:** 2026-04-20 (M3 shipped + review fixes)

## Milestone map

| Milestone | Demo state | Status |
|---|---|---|
| **M1 — Auth loop** | Register → login → 2FA → /dashboard → browse empty /rooms catalog → logout. Mailpit observable. | **DONE** (2026-04-20) |
| **M2a — WS + presence pipeline** | WS gateway mounted, cookie handshake, PresenceService + eager publish + scheduler, 2-browser presence demo. | **DONE** (2026-04-20) |
| **M2b — Rooms & membership UI** | Browse/join/leave rooms; presence dots on members pane; friends pane; rate-limits on register/login/reset. | **DONE** (2026-04-20) |
| **M3 — Messaging core** | Room + DM messaging, admin delete, friend → DM flow, moderation basics, admin FE panel. | **DONE** (2026-04-20) |
| **M4 — Attachments & unread** | Upload image/file; unread badges; offline delivery. | NOT STARTED |
| **M5 — Reviewer-ready** | Top-5 reviewer journeys green; load test; retention tested; dep-hygiene. | NOT STARTED |

## Per-EPIC status

Legend: ✅ shipped · 🟡 partial · ⏳ not started · ⏸ deferred

| EPIC | Backend | BFF | Frontend | Tests | Notes |
|---|---|---|---|---|---|
| 01 accounts-auth | ✅ | ✅ | ✅ | ✅ | register, reset via Mailpit, change, delete w/ async cascade; JWT + TOTP 2FA; refresh rotation + family invalidation |
| 02 sessions-presence | ✅ | ✅ | ✅ | ✅ | `presence:sessions:{id}` + `presence:state:{id}` Redis; eager publish + 10s scheduler; AFK_THRESHOLD_SECONDS env |
| 03 realtime-transport | ✅ PresencePublisher | ✅ gateway + subscriber + msg fan-out | ✅ Socket.IO client + hooks | ✅ | `/ws` cookie handshake; presence via interest-graph + coalesced `presence:global`; messages via `io.to(room:{id}).emit` (ADR-004) |
| 04 contacts-friends | ✅ + atomic ban-tx | ✅ proxy + list endpoints + block-UX | ✅ contacts route + UserPopover | ✅ | friends.list + listPending + bans wired end-to-end |
| 05 rooms | ✅ membersOf/ensureMember/update | ✅ proxy (RpcProxyService) | ✅ catalog + detail + Manage Room modal | ✅ | PATCH room (name/desc/visibility) owner-only; username-resolve invite (ADR-005 fail-silent) |
| 06 moderation | ✅ moderation + reports + audit (Observer-driven) | ✅ proxy + AdminGuard | ✅ Manage Room tabs + admin layout | ✅ | ModerationRepositoryPort + AbuseReportsRepositoryPort extracted; AuditSubscriber via IEventPublisher |
| 07 messaging | ✅ MessagesService + repository + TCP | ✅ proxy + WS send/edit/delete/sync.since | ✅ MessageList + Composer + Bubble + useMessages split | ✅ | Atomic DM-frozen INSERT...WHERE NOT EXISTS guard; composite `(created_at, id)` keyset; migration 0009 |
| 08 attachments | 🟡 schema | ⏳ | ⏳ | — | service + FS storage + 20MB/3MB limits pending (M4) |
| 09 notifications-unread | 🟡 schema | ⏳ | ⏳ | — | `user_last_read` functional unique index; observer logic pending (M4) |
| 10 ui-shell | — | — | ✅ login/register/reset/2FA/dashboard/rooms catalog+detail/contacts/chat/DM/admin + ManageRoom + UserPopover | ✅ | chat composer responsive breakpoints + attachments UI pending (M4) |
| 11 scale-reliability | ✅ workers + scheduler | ✅ throttle on register/login/reset | ⏳ | ✅ | BullMQ 4 queues + nightly retention.prune; Redis sliding-window |
| 12 deployment | ✅ compose + shutdown hooks | — | — | — | Postgres, Redis, Mailpit, Dozzle, attachments volume; mTLS certs; Redis `.quit()` on SIGTERM |
| 13 xmpp-federation | ⏸ DEFERRED | ⏸ | ⏸ | ⏸ | post-MVP per product decision |
| 14 security-nfrs | ✅ global RpcExceptionFilter + main.ts invariant-throw | ✅ CSRF + OriginGuard + WireError + mTLS + throttle mounted + WS connect limit + spam limits | ✅ CSRF cookie wired | ✅ | AC-14-04 scope: 30 msg/5s create, 60/min edit+delete; AC-14-12/13 mounted; `INTERNAL_ERROR` code distinct from `UPSTREAM_UNAVAILABLE` |
| 15 contracts | ✅ | ✅ | ✅ | ✅ + grep-gate | `@app/contracts` wired; PASSWORD_MIN/USERNAME_MIN/USERNAME_MAX + MessageScope XOR + ErrorCode enum (14) + inline-drift CI gate |
| design-system | — | — | 🟡 partial retheme | — | Kinetic Playground tokens partial; full UI primitives retheme + responsive breakpoints pending |

## Test coverage (post-M3 + review fixes)

| Workspace | Tests | Notes |
|---|---|---|
| `@app/auth-service` | 173 | +36 since M2; 99.8% stmt |
| `@app/backend` | 402 | +116 since M2; 3 pre-existing messages.controller spec fails (bigint JSON test mock) |
| `@app/bff` | 345 | +119 since M2; 3 pre-existing redis-io adapter spec fails (env mock) |
| `@app/frontend` | 409 | +266 since M2 |
| `@app/contracts` | 65 | +33 since M2; grep-gate + validators + scopes specs |
| **Unit total** | **1394** | +570 since M2 |
| E2E (Playwright) | 24 | +8 M3 specs (red until live stack) |
| Integration (testcontainers) | 3 | +2 (messages, seed-demo) |

## Deferred / debt (post-M3)

1. **Design-system refactor** — full Kinetic Playground retheme of UI primitives + responsive breakpoints for chat composer + ManageRoom modal.
2. **M1-era contracts drift backfill** — inline wire-string literals allow-listed in grep-gate:
   - `bff/src/auth/auth.service.ts` — 12 `auth.*`
   - `backend/src/common/guards/jwt.guard.ts` — `auth.customer.validateToken`
   - `backend/src/modules/audit/audit.controller.ts` — `auth.customer.validateToken`
   - `backend/src/modules/bans/bans.service.ts` — `dm.frozen`, `friend.removed`
   - `backend/src/modules/friends/friends.service.ts` — `friend.removed`, `friend.request.accepted`, `friend.request.new`
   - `backend/src/modules/users/users.tcp.ts` — `users.list`, `users.findById` (extended w/ `users.findByUsername` in M3)
   - `auth-service/src/modules/auth/admin/admin-auth.tcp.ts` — 3 `auth.admin.*`
3. **E2E specs red** — live-stack dependent; M2 + M3 specs need stack up + run for green.
4. **Frontend moderation.ts inviteUser** — return type out-of-sync w/ new BFF `{queued, invited}` shape (fail-silent enumeration fix). FE update pending.
5. **3 pre-existing backend messages.controller spec fails** — bigint JSON serialization test mock.
6. **3 pre-existing BFF redis-io + shutdown spec fails** — env seeding mismatch in tests.
7. **Migration 0009/0010 not CONCURRENTLY** — prod day-one lock risk; MVP-safe only.
8. **Dashboard copy-drift tests** — Kinetic Playground redesign broke 3 assertions.
9. **Backend schema index.ts coverage** — Drizzle barrel accessors uncovered; integration-only.
10. **EPIC-02 session DB row** — `user_sessions` table exists; backend still writes only Redis. §2.2.4 active-sessions UI pending.
11. **zod 3 → 4 bump** — cascades type breakage across 4 workspaces + `@hookform/resolvers` upgrade. Deferred.
12. **Dependabot** — 12 vulns (10 high + 2 moderate) flagged on origin/master.

## M4 candidates (ordered by critical path)

1. **EPIC-08 attachments** — MessagesService.create extended w/ attachment refs; backend FS storage path + size/MIME guards (§3.4 20MB/3MB); BFF multipart upload endpoint; FE `<AttachmentUploader>` + paste handler + thumbnail gallery.
2. **EPIC-09 notifications + unread** — user_last_read writer on message.read WS event; batched `unread.changed` WS broadcast; FE unread badges on room/contact rows (AC-09-01/02/03).
3. **EPIC-02 session DB row** — backend writes `user_sessions` on login + revoke on logout; BFF `/sessions` endpoint + FE active-sessions screen (§2.2.4).
4. **Responsive + design-system** — finish Kinetic Playground tokens; mobile breakpoints on chat + Manage Room + admin panel.
5. **Chat composer polish** — emoji picker (§4.3); paste-to-send; typing-indicator scaffolding (stretch).
6. **ErrorCode.INTERNAL_ERROR wiring** — FE moderation.ts + components consuming new return shapes.
7. **Frontend follow-ups** — fix `moderation.ts inviteUser` return shape; dashboard copy-drift tests.

## M5 candidates (reviewer-ready)

1. **Load test harness** — k6 / artillery scripts for 300 concurrent × 1000 members × 6 msg/s; measure p95 msg delivery + presence propagation.
2. **Retention prune verification** — run against seeded 10k-msg room; check non-blocking + batch sizing.
3. **Dependabot cleanup** — resolve 12 flagged vulns.
4. **Migration 0009/0010 rewrite CONCURRENTLY** — prod-safe variant.
5. **Observability** — Dozzle + Prometheus/Loki scaffolding for demo dashboards.
6. **README.md + mng/README.md demo walkthrough refresh**.
7. **E2E green** against live stack — confirm M2 + M3 specs all pass.

## ADR index

- **ADR-001** — Presence source of truth: EPIC-02 owns state + DB writes; EPIC-03 `PresencePublisher` primitive; EPIC-09 observer only.
- **ADR-002** — Async account-delete cascade: auth-service → backend TCP `users.cascade.enqueue` → BullMQ `user.cascade.delete`; consumer EPIC-11.
- **ADR-003** — WS handshake auth: cookie-only MVP (same-origin BFF). No session-ticket endpoint. Cross-origin POST-MVP.
- **ADR-004** — Message fan-out: Socket.IO room + @socket.io/redis-adapter (`io.to('room:'+id).emit`). Presence keeps explicit interest-graph subscriber (different semantics).
- **ADR-005** — Invite username enumeration: BFF `resolveUserIdByUsername` returns `{queued:true, invited:null}` on miss (fail-silent). Rate-limit via AC-14-13 friend-req bucket. Prevents auth'd users probing directory via invite API.
- **ADR-006** — Message fan-out scaling envelope: 300 concurrent × 1000 members/room × 6 msg/s = 6000 socket-emits/s/room. @socket.io/redis-adapter stream-per-room default. Re-visit if p99 > 250ms or hot rooms > 10. Resharding trigger: Redis aggregate > 50k msg/s.
