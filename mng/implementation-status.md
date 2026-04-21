# Implementation Status

Live progress tracker MVP build-out. Updated as milestones land.
See `mng/specs/` for specs + `mng/architecture/` for diagrams.

**Last updated:** 2026-04-21 (M5 critical fixes done — 8-agent review-fix fan-out landed)

## Milestone map

| Milestone | Demo state | Status |
|---|---|---|
| **M1 — Auth loop** | Register → login → 2FA → /dashboard → browse empty /rooms catalog → logout. Mailpit observable. | **DONE** (2026-04-20) |
| **M2a — WS + presence pipeline** | WS gateway mounted, cookie handshake, PresenceService + eager publish + scheduler, 2-browser presence demo. | **DONE** (2026-04-20) |
| **M2b — Rooms & membership UI** | Browse/join/leave rooms; presence dots on members pane; friends pane; rate-limits on register/login/reset. | **DONE** (2026-04-20) |
| **M3 — Messaging core** | Room + DM messaging, admin delete, friend → DM flow, moderation basics, admin FE panel. | **DONE** (2026-04-20) |
| **M4 — Attachments & unread** | Upload image/file; unread badges; offline delivery. | **DONE** (2026-04-21) — sessions FE + E2E + polish landed |
| **M5 — Reviewer-ready** | Top-5 reviewer journeys green; load test; retention tested; dep-hygiene. | **CRITICAL FIXES DONE** (2026-04-21) — live-stack E2E + load-test runs pending |

## Per-EPIC status

Legend: ✅ shipped · 🟡 partial · ⏳ not started · ⏸ deferred

| EPIC | Backend | BFF | Frontend | Tests | Notes |
|---|---|---|---|---|---|
| 01 accounts-auth | ✅ | ✅ | ✅ | ✅ | register, reset via Mailpit, change, delete w/ async cascade; JWT + TOTP 2FA; refresh rotation + family invalidation |
| 02 sessions-presence | ✅ | ✅ | ✅ | ✅ | presence Redis pipeline (eager + 10s scheduler) + sessions FE w/ revoke (sid-claim binding — ADR-007); BFF `/sessions` proxy live |
| 03 realtime-transport | ✅ PresencePublisher | ✅ gateway + subscriber + msg fan-out | ✅ Socket.IO client + hooks | ✅ | `/ws` cookie handshake; presence via interest-graph + coalesced `presence:global`; messages via `io.to(room:{id}).emit` (ADR-004) |
| 04 contacts-friends | ✅ + atomic ban-tx | ✅ proxy + list endpoints + block-UX | ✅ contacts route + UserPopover | ✅ | friends.list + listPending + bans wired end-to-end |
| 05 rooms | ✅ membersOf/ensureMember/update | ✅ proxy (RpcProxyService) | ✅ catalog + detail + Manage Room modal | ✅ | PATCH room (name/desc/visibility) owner-only; username-resolve invite (ADR-005 fail-silent) |
| 06 moderation | ✅ moderation + reports + audit (Observer-driven) | ✅ proxy + AdminGuard | ✅ Manage Room tabs + admin layout | ✅ | ModerationRepositoryPort + AbuseReportsRepositoryPort extracted; AuditSubscriber via IEventPublisher |
| 07 messaging | ✅ MessagesService + repository + TCP | ✅ proxy + WS send/edit/delete/sync.since | ✅ MessageList + Composer + Bubble + useMessages split | ✅ | Atomic DM-frozen INSERT...WHERE NOT EXISTS guard; composite `(created_at, id)` keyset; migration 0009 |
| 08 attachments | ✅ service + FS storage + magic-byte sniff + 20/3 MiB caps + path-traversal guard + UUID gen + bind-on-create | ✅ multipart upload (rooms + DMs) + RFC 5987 download + Content-Disposition hardening + `dmUserId`→`dmId` resolve | ✅ `lib/attachments` + `<AttachmentUploader>` chip strip + paste handler + `<AttachmentView>` inline image/file | ✅ | security-review applied (Vuln 1–5 fixed); history listing no attachments yet (follow-up) |
| 09 notifications-unread | ✅ UnreadService + repo + TCP + `UnreadSubscriber` via IEventPublisher fan-out on `user:{id}` | ✅ proxy (GET /unread, POST /rooms/:id/read, POST /dms/:userId/read) + WS delta passthrough | ✅ `useUnread` zustand store + `useAutoMarkRead` (visibility-gated) + `<UnreadBadge>` (99+ cap) | ✅ | DM badges keyed by peerUserId (not dmId) so FE address via route param |
| 10 ui-shell | — | — | ✅ login/register/reset/2FA/dashboard/rooms catalog+detail/contacts/chat/DM/admin + ManageRoom + UserPopover + attachments + unread badges | ✅ | chat composer responsive breakpoints + sessions-management page pending |
| 11 scale-reliability | ✅ workers + scheduler | ✅ throttle on register/login/reset | ⏳ | ✅ | BullMQ 4 queues + nightly retention.prune; Redis sliding-window |
| 12 deployment | ✅ compose + shutdown hooks | — | — | — | Postgres, Redis, Mailpit, Dozzle, attachments volume; mTLS certs; Redis `.quit()` on SIGTERM |
| 13 xmpp-federation | ❌ OUT OF SCOPE | ❌ | ❌ | ❌ | Jabber federation intentionally dropped from submission. Also removes the only brief-mandatory load test (§6 "50+50 clients federation load test"). Unit/E2E scale targets in §3.1/§3.2 remain but are NFR, not deliverables. |
| 14 security-nfrs | ✅ global RpcExceptionFilter + main.ts invariant-throw | ✅ CSRF + OriginGuard + WireError + mTLS + throttle mounted + WS connect limit + spam limits | ✅ CSRF cookie wired | ✅ | AC-14-04 scope: 30 msg/5s create, 60/min edit+delete; AC-14-12/13 mounted; `INTERNAL_ERROR` code distinct from `UPSTREAM_UNAVAILABLE` |
| 15 contracts | ✅ | ✅ | ✅ | ✅ + grep-gate | `@app/contracts` wired; PASSWORD_MIN/USERNAME_MIN/USERNAME_MAX + MessageScope XOR + ErrorCode enum (14) + inline-drift CI gate |
| design-system | — | — | 🟡 partial retheme | — | Kinetic Playground tokens partial; full UI primitives retheme + responsive breakpoints pending |

## Test coverage (post-M5 critical fixes)

| Workspace | Tests | Notes |
|---|---|---|
| `@app/auth-service` | 199 | +7 since M4 (sid-claim binding on validate + revoke chain + refresh rotation) |
| `@app/backend` | 515 | +25 since M4 (DM friend/freeze gate + worker timeout backstop + sync.since reconnect) |
| `@app/bff` | 380 | +9 since M4 (UA/IP injection from request headers + sessions DELETE proxy) |
| `@app/frontend` | 488 | +22 since M4 (`/_auth/sessions` route + per-chip attachment caption + page-object retheme) |
| `@app/contracts` | 83 | +18 since M4 (`sessions.{isRevoked,revoke}` + caption field on attachments + DM gate errors) |
| **Unit total** | **1665** | +81 since M4 |
| E2E (Playwright) | 30+ | T22 session-revoke unblocked + T27 PDF + critical ship-blocker specs — live-stack run pending |
| Integration (testcontainers) | 3 | unchanged |
| Load (k6) | 2 scaffolds (optional) | message-burst + presence-fanout — `b246c38`. Not required by brief after EPIC-13 dropped; kept as optional p95 harness. |

## Deferred / debt (post-M5 critical fixes)

### ✅ Landed in M5 critical-fix block

- **Unread fan-out batched SQL** — `2488a17` (one SQL per room write, `VALUES` recipient list).
- **Attachments history hydration** — `0edec86` (`findByMessageIds` + `attachmentsByMessageId` on list/since).
- **DM friend/freeze gate** — `021e902` (gate on `resolveOrCreateDmChannelId` blocks lazy upsert from blocked/non-friend pairs).
- **Sessions revoke chain end-to-end** — `e2cbe79` + `ffee0f5` + `af8d1dd` (sid-claim binding — see ADR-007).
- **BFF UA/IP injection** — `45ff888` (request-header derived; XSS hardening on session-list display).
- **Workers wall-clock timeout** — `1bd6b80` (per-queue backstop prevents indefinite stalls).
- **`sync.since` on WS reconnect** — `128baa2` (backfills missed messages on transient disconnects).
- **AC-08-04 per-chip caption** — `0acfe76` (uploader exposes caption input per attachment).
- **M4 Playwright E2E** — `0f65f34` + `b61ca11` + `4cb20da` (T22 session-revoke unblocked; ship-blocker specs in place).
- **Sessions FE surface** — `ffee0f5` (`/_auth/sessions` route + revoke UI live; T26 done).

### Still open

1. **Live-stack E2E run** — `app/e2e-tests` specs need stack up + green pass. Compose smoke landed (`0f65f34`); full suite run pending.
2. ~~**k6 load-test live run**~~ — DROPPED. Brief's only mandatory load test was §6 Jabber-federation (50+50 clients); EPIC-13 is out of scope. §3.1/§3.2 numbers remain as NFR targets, no live run required. Scaffolds stay in `app/load-tests/` as an opt-in harness.
3. **Retention prune verification** — run nightly job against seeded 10k-msg room.
4. **Design-system refactor** — full Kinetic Playground retheme of remaining UI primitives + ManageRoom modal breakpoints.
5. **M1-era contracts drift backfill** — inline wire-string literals allow-listed in grep-gate (unchanged list from M3).
6. **Pre-existing backend messages.controller spec fails** — bigint JSON serialization test mock (unaffected).
7. **Migration 0009/0010 not CONCURRENTLY** — prod day-one lock risk; MVP-safe only.
8. **zod 3 → 4 bump** — cascades type breakage across 4 workspaces + `@hookform/resolvers` upgrade. Deferred.
9. **Dependabot** — 12 vulns (10 high + 2 moderate) flagged on origin/master.
10. **Sidless token gap on backend-down login** — `recordLogin` best-effort (ADR-007 trade-off). Tokens minted while backend down survive until natural expiry. Post-MVP outbox.

## M4 commits

### 2026-04-20

- `eb27823` — backend attachments (schema, service, storage, repo, tcp) + unread module + messages `bindAttachments`
- `0fe4a2e` — BFF attachments multipart + RFC 5987 download + `messages.attachmentIds` passthrough
- `35c7fcf` — `message.created` event emit + UnreadSubscriber → `unread.changed` Redis fan-out
- `9917323` — BFF unread endpoints + backend `dmUserId` → `dmId` resolution in unread tcp
- `1046088` — FE unread badges + auto-mark-read + DM peer-keyed counts
- `6a88f19` — FE attachments UI (uploader, paste, inline view, composer integration) + chat.gateway unwrap
- `feacf6f` — Playwright specs: attachment upload round-trip + unread badge round-trip (2 specs; live-stack dependent)
- `9a82aa4` — review fixes: TCP scope XOR, broadcastTarget orphan fallback drop, UnreadSubscriber batched fan-out + self-DM guard, useAutoMarkRead dep-array

### 2026-04-21 (8-agent parallel fan-out)

- `b61ca11` — Playwright specs: T22 session-revoke (test.skip pending T26 FE) + T27 PDF-requirement smoke
- `f8affcf` — T29 responsive: `sm:` breakpoints across composer, bubble, uploader chip, attachment-view image
- `5c289f6` — T31 moderation `inviteUser` shape fix + fail-silent invite copy in `manage-room-modal`
- `0edec86` — M5 follow-up: attachments hydrated on history (`messages.list` + `.since` carry `attachmentsByMessageId`); FE store applies on `replaceAll` + `prependOlder` — closes demo-visible scroll-back gap
- `2488a17` — M5 follow-up: unread fan-out batched into one SQL via `(VALUES …)` recipient list — replaces N round-trips per room write
- `e2cbe79` — T23-T25: sessions backend module + auth-service `recordLogin` emit (best-effort, fail-safe). New `TcpCmd.sessions.{recordLogin,listForUser,revoke}`. T26 (BFF + FE surface) still pending.

### 2026-04-21 (M5 critical-fix block — 8-agent fan-out)

- `8368a45` — docs: M4 fan-out outcomes (6 commits, 2 M5 deferrals cleared).
- `0f65f34` — E2E coverage for critical ship-blockers + compose smoke spec.
- `ffee0f5` — T26 sessions BFF proxy + FE `/_auth/sessions` route w/ revoke UI.
- `4d113a3` — quick-wins from 5-reviewer round (devils + oop + sys-arch consolidated).
- `e533561` — README demo walkthrough + features + arch + test status sections.
- `b246c38` — k6 load-test scaffold (message-burst + presence-fanout).
- `0acfe76` — AC-08-04 per-chip attachment caption input.
- `128baa2` — `sync.since` on WS reconnect, backfills missed messages.
- `1bd6b80` — per-queue wall-clock timeout backstop on BullMQ workers.
- `021e902` — friend/freeze gate on DM channel resolution (closes lazy-upsert hardening gap).
- `45ff888` — BFF injects `userAgent`/`ip` from request headers (XSS hardening on sessions display).
- `af8d1dd` — session revoke invalidates cookie path via sid claim (binds ADR-007).
- `4cb20da` — E2E page-objects realigned to Kinetic Playground copy.

13 commits in block (`8368a45..4cb20da`).

## M4 review round — consolidated (5 reviewers: oop-patterns / devils-advocate / system-architect / business-analyst / coderabbit)

### Applied in `9a82aa4`

- Scope-XOR runtime guard on `TcpCmd.attachments.upload` (closes: could persist row with both roomId + dmId).
- `broadcastTarget` orphan fallback dropped — no more `room:orphan` leak vector; malformed upstream = log + skip fan-out.
- `UnreadSubscriber` room fan-out batched at concurrency 16 + self-DM echo guard.
- `useAutoMarkRead` dep array flattened to primitives.

### Deferred to M5 (documented, not fixed)

- **Unread batched SQL** — ✅ landed in `2488a17` (one SQL per room write via `VALUES` recipient list).
- **Attachments history hydration** — ✅ landed in `0edec86` (`findByMessageIds` + `attachmentsByMessageId` on list/since).
- **DM lazy upsert friend/ban gate** — `resolveOrCreateDmChannelId` upserts `dm_channels` row for any user pair attacker addresses. Low impact in hackathon demo; add friend/ban check before upsert for hardening.
- **AC-09-03 "1+" vs "99+" text drift** — spec says "1+", FE renders "99+". Reconcile by editing spec (UI cap matches spec intent).
- **AC-09-07 strict-delta `unread.changed`** — subscriber fires on every message.created; AC says "only on count delta". Compare prior vs next before PUBLISH.
- **AC-08-04 comment UI** — DB + API accept `comment` field, but uploader no input exposed.
- **Controller SRP / DTO unification** — `bff/attachments.controller.ts` mixes HTTP + multipart + header encoding; `AttachmentDto` + `BffAttachment` + `AttachmentRow` three near-identical shapes worth unifying into `@app/contracts`.
- **`<img src>` vs octet-stream UX** — Safari may refuse to render images from `Content-Disposition: attachment` responses. Add `/attachments/:id/inline` route with `Content-Disposition: inline` + sandbox CSP for known-safe image MIMEs.
- **Attachments paste cap** — composer paste-upload skips `MAX_FILES_PER_UPLOAD` check (uploader enforces, paste not). Move cap enforcement into `uploadAttachments`.

## M4 pending

1. **T28 / T30** — non-blocking polish deferred: Kinetic Playground token audit (T28) + emoji picker (T30). Both pure UX/visual; not on demo critical path.

## M5 remaining

1. **Live-stack E2E run** — full Playwright suite against running compose stack; confirm M2 + M3 + M4 + M5 specs green.
2. ~~**Live k6 load run**~~ — DROPPED (Jabber out of scope; brief's only mandatory load test was §6 federation). k6 scaffolds remain opt-in.
3. **Retention prune verification** — run against seeded 10k-msg room; check non-blocking + batch sizing.
4. **Dependabot cleanup** — resolve 12 flagged vulns.
5. **Migration 0009/0010 rewrite CONCURRENTLY** — prod-safe variant.
6. **Observability** — Dozzle + Prometheus/Loki scaffolding for demo dashboards.

## ADR index

- **ADR-001** — Presence source of truth: EPIC-02 owns state + DB writes; EPIC-03 `PresencePublisher` primitive; EPIC-09 observer only.
- **ADR-002** — Async account-delete cascade: auth-service → backend TCP `users.cascade.enqueue` → BullMQ `user.cascade.delete`; consumer EPIC-11.
- **ADR-003** — WS handshake auth: cookie-only MVP (same-origin BFF). No session-ticket endpoint. Cross-origin POST-MVP.
- **ADR-004** — Message fan-out: Socket.IO room + @socket.io/redis-adapter (`io.to('room:'+id).emit`). Presence keeps explicit interest-graph subscriber (different semantics).
- **ADR-005** — Invite username enumeration: BFF `resolveUserIdByUsername` returns `{queued:true, invited:null}` on miss (fail-silent). Rate-limit via AC-14-13 friend-req bucket. Prevents auth'd users probing directory via invite API.
- **ADR-006** — Message fan-out scaling envelope: 300 concurrent × 1000 members/room × 6 msg/s = 6000 socket-emits/s/room. @socket.io/redis-adapter stream-per-room default. Re-visit if p99 > 250ms or hot rooms > 10. Resharding trigger: Redis aggregate > 50k msg/s.
- **ADR-007** — Session-id claim binding for revoke chain: bind `sid` UUID to access + refresh JWT at mint, validate via per-request `sessions.isRevoked(sid)` TCP probe (~5 ms localhost mTLS). Fails OPEN on backend bounce; refresh rotation must preserve sid. See `mng/architecture/adr/ADR-007-session-sid-claim-binding.md`.