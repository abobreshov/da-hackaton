# Implementation Status

Live progress tracker MVP build-out. Updated as milestones land.
See `mng/specs/` for specs + `mng/architecture/` for diagrams.

**Last updated:** 2026-04-20 (M4 feature work shipped; review round pending)

## Milestone map

| Milestone | Demo state | Status |
|---|---|---|
| **M1 — Auth loop** | Register → login → 2FA → /dashboard → browse empty /rooms catalog → logout. Mailpit observable. | **DONE** (2026-04-20) |
| **M2a — WS + presence pipeline** | WS gateway mounted, cookie handshake, PresenceService + eager publish + scheduler, 2-browser presence demo. | **DONE** (2026-04-20) |
| **M2b — Rooms & membership UI** | Browse/join/leave rooms; presence dots on members pane; friends pane; rate-limits on register/login/reset. | **DONE** (2026-04-20) |
| **M3 — Messaging core** | Room + DM messaging, admin delete, friend → DM flow, moderation basics, admin FE panel. | **DONE** (2026-04-20) |
| **M4 — Attachments & unread** | Upload image/file; unread badges; offline delivery. | **FEATURE WORK DONE** (2026-04-20) — review + E2E + sessions FE pending |
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
| 08 attachments | ✅ service + FS storage + magic-byte sniff + 20/3 MiB caps + path-traversal guard + UUID gen + bind-on-create | ✅ multipart upload (rooms + DMs) + RFC 5987 download + Content-Disposition hardening + `dmUserId`→`dmId` resolve | ✅ `lib/attachments` + `<AttachmentUploader>` chip strip + paste handler + `<AttachmentView>` inline image/file | ✅ | security-review applied (Vuln 1–5 fixed); history listing does NOT carry attachments yet (follow-up) |
| 09 notifications-unread | ✅ UnreadService + repo + TCP + `UnreadSubscriber` via IEventPublisher fan-out on `user:{id}` | ✅ proxy (GET /unread, POST /rooms/:id/read, POST /dms/:userId/read) + WS delta passthrough | ✅ `useUnread` zustand store + `useAutoMarkRead` (visibility-gated) + `<UnreadBadge>` (99+ cap) | ✅ | DM badges keyed by peerUserId (not dmId) so FE can address via route param |
| 10 ui-shell | — | — | ✅ login/register/reset/2FA/dashboard/rooms catalog+detail/contacts/chat/DM/admin + ManageRoom + UserPopover + attachments + unread badges | ✅ | chat composer responsive breakpoints + sessions-management page pending |
| 11 scale-reliability | ✅ workers + scheduler | ✅ throttle on register/login/reset | ⏳ | ✅ | BullMQ 4 queues + nightly retention.prune; Redis sliding-window |
| 12 deployment | ✅ compose + shutdown hooks | — | — | — | Postgres, Redis, Mailpit, Dozzle, attachments volume; mTLS certs; Redis `.quit()` on SIGTERM |
| 13 xmpp-federation | ⏸ DEFERRED | ⏸ | ⏸ | ⏸ | post-MVP per product decision |
| 14 security-nfrs | ✅ global RpcExceptionFilter + main.ts invariant-throw | ✅ CSRF + OriginGuard + WireError + mTLS + throttle mounted + WS connect limit + spam limits | ✅ CSRF cookie wired | ✅ | AC-14-04 scope: 30 msg/5s create, 60/min edit+delete; AC-14-12/13 mounted; `INTERNAL_ERROR` code distinct from `UPSTREAM_UNAVAILABLE` |
| 15 contracts | ✅ | ✅ | ✅ | ✅ + grep-gate | `@app/contracts` wired; PASSWORD_MIN/USERNAME_MIN/USERNAME_MAX + MessageScope XOR + ErrorCode enum (14) + inline-drift CI gate |
| design-system | — | — | 🟡 partial retheme | — | Kinetic Playground tokens partial; full UI primitives retheme + responsive breakpoints pending |

## Test coverage (post-M4 feature work)

| Workspace | Tests | Notes |
|---|---|---|
| `@app/auth-service` | 173 | unchanged since M3 |
| `@app/backend` | 462 | +60 since M3 (attachments service/repo/tcp + unread service/repo/tcp + unread-subscriber + messages event emit) |
| `@app/bff` | 371 | +26 since M3 (attachments proxy/multipart + unread proxy + chat.gateway attachments unwrap) |
| `@app/frontend` | 460 | +51 since M3 (lib/attachments + AttachmentUploader/View + lib/unread + useUnread + useAutoMarkRead + UnreadBadge) |
| `@app/contracts` | 65 | +1 `messages.resolveDm` command |
| **Unit total** | **1531** | +137 since M3 |
| E2E (Playwright) | 24 | unchanged — M4 specs pending in T13/T15/T22/T27 block |
| Integration (testcontainers) | 3 | unchanged |

## Deferred / debt (post-M4 feature work)

1. **M4 review round** — 5 reviewers (oop-patterns, devils-advocate, system-architect, business-analyst, code-reviewer) + consolidated + critical fixes. Not yet run.
2. **M4 Playwright E2E** — T13 (attachment upload + view), T15 (unread badge + auto-mark-read), T22 (sessions), T27 (PDF-requirement pass) all pending.
3. **Attachments history hydration gap** — `messages.list` + `.since` don't JOIN attachments. Send-ack + WS broadcast carry them, but scrolling history shows body-only. Follow-up: batch `findAttachmentsByMessageIds` in service.
4. **Sessions management FE** — backend writes `user_sessions` on login + revoke endpoint + BFF proxy + FE `/_auth/sessions` route (T23–T26 block). Still uses Redis-only refresh store today.
5. **Design-system refactor** — full Kinetic Playground retheme of UI primitives + responsive breakpoints for chat composer + ManageRoom modal.
6. **M1-era contracts drift backfill** — inline wire-string literals allow-listed in grep-gate (unchanged list from M3).
7. **E2E specs red** — live-stack dependent; M2 + M3 specs need stack up + run for green.
8. **Frontend moderation.ts inviteUser** — return type out-of-sync w/ new BFF `{queued, invited}` shape. FE update pending.
9. **Pre-existing backend messages.controller spec fails** — bigint JSON serialization test mock (unaffected by M4).
10. **Migration 0009/0010 not CONCURRENTLY** — prod day-one lock risk; MVP-safe only.
11. **Dashboard copy-drift tests** — Kinetic Playground redesign broke 3 assertions.
12. **zod 3 → 4 bump** — cascades type breakage across 4 workspaces + `@hookform/resolvers` upgrade. Deferred.
13. **Dependabot** — 12 vulns (10 high + 2 moderate) flagged on origin/master.

## M4 commits (2026-04-20)

- `eb27823` — backend attachments (schema, service, storage, repo, tcp) + unread module + messages `bindAttachments`
- `0fe4a2e` — BFF attachments multipart + RFC 5987 download + `messages.attachmentIds` passthrough
- `35c7fcf` — `message.created` event emit + UnreadSubscriber → `unread.changed` Redis fan-out
- `9917323` — BFF unread endpoints + backend `dmUserId` → `dmId` resolution in unread tcp
- `1046088` — FE unread badges + auto-mark-read + DM peer-keyed counts
- `6a88f19` — FE attachments UI (uploader, paste, inline view, composer integration) + chat.gateway unwrap

## M4 pending

1. **T13/T15/T22/T27** — Playwright E2E: attachment round-trip (image + file), unread badge appearance + auto-clear, session revoke, PDF-requirement coverage pass.
2. **T23–T26** — sessions DB writer on login, backend TCP `sessions.listForUser`/`.revoke`, BFF `/sessions` endpoints, FE `/_auth/sessions` route.
3. **T28–T32** — polish: Kinetic Playground token audit, responsive breakpoints, emoji picker, `moderation.ts inviteUser` shape fix, dashboard copy-drift tests.
4. **M4 review round** — 5 reviewers → consolidated → critical fixes → this doc refresh.
5. **Attachments history hydration** — batch `findAttachmentsByMessageIds` into `messages.list`/`.since` so older history carries attachments too.

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
