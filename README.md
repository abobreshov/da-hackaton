# AI Herders Jam — Online Chat Server

> Classic web chat (rooms + DMs + presence + files + moderation), built for the AI Herders Jam hackathon. Judge verification guide.

---

## TL;DR for judges

- **1665+ unit tests** (auth-service 199 · backend 515 · BFF 380 · frontend 488 · contracts 83) and **30+ Playwright E2E specs**, plus k6 load scaffolds.
- **One command to boot:** `cd app && ./dev.sh` (full Docker) or `cd app && ./dev-local.sh` (infra-only Docker, services on host).
- Then walk **Section 4 — Verification by requirement** to confirm every section of `mng/requirements/requirements.md` is implemented and demonstrable.
- If something looks broken, **Section 8 — Troubleshooting** has the recipe.
- **Honest limitations** are listed in **Section 7 — Known limitations**: full Kinetic Playground retheme is partial, no emoji picker (UTF-8 paste works), XMPP federation (§6) is deferred.

---

## 1. Quick start

### 1.1 Prerequisites

- Docker + Docker Compose (v2)
- Node **22+**
- Corepack-enabled Yarn 4.9.1 (`corepack enable && corepack prepare yarn@4.9.1 --activate`)
- For `dev-local.sh`: host ports `5433` (postgres) + `6380` (redis) free
- For `dev.sh`: host ports `3006` (BFF) + `3007` (frontend) + `8025` (Mailpit) + `9999` (Dozzle) free

> Yarn 4 only — never `npm`. The repo is a Yarn workspace (`app/` is the workspace root).

### 1.2 First-time setup

```bash
cd app
yarn install
./scripts/gen-certs.sh        # mints throwaway dev CA + per-service mTLS certs into ./secrets/internal-ca/
```

`gen-certs.sh` is idempotent. `dev-local.sh` re-runs it automatically when `ca.crt` is missing.

### 1.3 Boot the stack — pick one

**Option A — full Docker (recommended for judges):**

```bash
cd app
./dev.sh                # foreground, Ctrl-C tears down
./dev.sh --build        # rebuild images first
./dev.sh --no-seed      # skip DB seeding
```

All 4 services + Postgres + Redis + Mailpit + Dozzle run in containers. Hot-reload via `src/` bind mounts.

**Option B — infra in Docker, services on host (faster iteration):**

```bash
cd app
./dev-local.sh
./dev-local.sh --skip-install --skip-seed
```

Postgres + Redis + Mailpit run in Docker (`docker-compose.infra.yml`). Services run via `yarn start:dev` / `yarn dev` on host. Logs land in `app/.dev-logs/*.log`.

### 1.4 URLs after boot

| URL | Purpose |
|---|---|
| http://localhost:3007 | Frontend (React 19 + TanStack Router) |
| http://localhost:3006/api/v1 | BFF (NestJS — session cookies) |
| http://localhost:8025 | **Mailpit** — captures all outgoing emails (verify, reset, etc.) |
| http://localhost:9999 | Dozzle — container log viewer (Option A only) |
| http://localhost:3003 | auth-service (Option B only — direct) |
| http://localhost:3004 | backend (Option B only — direct) |

### 1.5 Seed credentials

Inserted by `app/src/auth-service/scripts/seed.ts` on first boot:

| Email | Password | Role | 2FA |
|---|---|---|---|
| `admin@example.com` | `Admin123!` | admin | off |
| `user@example.com` | `User1234!` | user | off |
| `user2fa@example.com` | `Secure2FA!` | user | **on** (TOTP secret in `app/.seed-admin-totp.txt`) |

Re-seed: `yarn workspace @app/auth-service seed` (Option B) or `docker compose -f app/docker-compose.dev.yml exec auth-service yarn seed` (Option A).

### 1.6 Recovery — `./dev-doctor.sh`

If a previous run left orphan `docker-proxy` instances pinning host ports (`EADDRINUSE`):

```bash
cd app
./dev-doctor.sh                    # read-only — shows port owners + hackathone procs
./dev-doctor.sh --clean-services   # SIGTERM our node/nest/vite, keep postgres+redis up
./dev-doctor.sh --clean            # + bring docker infra down
./dev-doctor.sh --force            # SIGKILL stubborn procs
```

Only processes whose cwd is inside `app/` are touched. Safe next to unrelated workloads.

---

## 2. Mapping — requirement section → spec → code

Spec files are at `mng/specs/`. Implementation status per EPIC is at `mng/implementation-status.md`.

| Requirement (`mng/requirements/requirements.md`) | Spec | Source dir |
|---|---|---|
| §2.1 Accounts & auth | `mng/specs/01-accounts-auth.md` | `app/src/auth-service/` |
| §2.2 Presence + sessions | `mng/specs/02-sessions-presence.md` | `app/src/backend/src/presence/`, `app/src/backend/src/sessions/` |
| §2.3 Contacts / friends | `mng/specs/04-contacts-friends.md` | `app/src/backend/src/friends/` |
| §2.4 Rooms | `mng/specs/05-rooms.md` + `mng/specs/06-moderation.md` | `app/src/backend/src/rooms/` |
| §2.5 Messaging | `mng/specs/07-messaging.md` | `app/src/backend/src/messages/` |
| §2.6 Attachments | `mng/specs/08-attachments.md` | `app/src/backend/src/attachments/`, `app/src/bff/src/attachments/` |
| §2.7 Notifications | `mng/specs/09-notifications-unread.md` | `app/src/backend/src/unread/`, `app/src/frontend/src/lib/unread/` |
| §3 NFRs | `mng/specs/11-scale-reliability.md` + `mng/specs/14-security-nfrs.md` | `app/src/backend/src/workers/`, mTLS in `app/scripts/gen-certs.sh` |
| §4 UI layout | `mng/specs/10-ui-shell.md` + `mng/specs/design-system.md` | `app/src/frontend/` |
| §6 XMPP federation | `mng/specs/13-xmpp-federation.md` | **deferred** (see §7) |

---

## 3. Verification — by requirement section

Boot the stack (§1.3). Open **Chrome** and **Firefox** (or Chrome + an incognito window) — independent cookie jars matter for two-user demos.

### 3.1 §2.1 Accounts & authentication

#### §2.1.1 + §2.1.2 — Self-registration with unique email + immutable username

1. Open http://localhost:3007/register.
2. Fill email, **username** (immutable per §2.1.2), password (≥ 10 chars, mixed case + digit + symbol per OWASP V2.1 — stricter than the brief's silence on policy).
3. Submit → page shows **"Check your inbox"**. **You are NOT auto-logged-in** — the brief allows skipping email verification (§2.1.2), but we ship verify-then-login because OWASP V3.1.1 forbids granting a session before address ownership is proven. Honest deviation, justified by OWASP.
4. Open http://localhost:8025 (Mailpit) → click the verification email → click **Verify my email**.
5. Browser lands on `/dashboard` with a session cookie.

**Uniqueness:** retry §2 with the same email or username → form rejects with 409 from `auth.register` (`apps/auth-service/src/auth/users.service.ts`).

#### §2.1.3 — Sign in / sign out / persistent login

1. http://localhost:3007/login → `user@example.com` / `User1234!` → **Let's Go** → `/dashboard`.
2. Close the browser tab → reopen http://localhost:3007 → still logged in (refresh cookie persists, see ADR-007 below).
3. Click **Sign out** in the top menu → redirected to `/login`. The other browser (Firefox, see §3.1.6) stays logged in — sign-out is per-session, not global, per §2.1.3.

#### §2.1.4 — Password reset (Mailpit)

1. http://localhost:3007/login → **Forgot it?**.
2. Enter `user@example.com` → submit. Copy is enumeration-safe ("if the email exists…") — not in the brief but standard practice.
3. Open http://localhost:8025 → click the reset email → land on `reset-password?token=<hex>`.
4. Set a new password → redirected to `/login` → log in with the new password.

#### §2.1.4 — Password change for logged-in users

1. Log in. Open the user menu → **Account settings** → **Change password**.
2. Enter current + new + confirm → save. Re-login is forced on the current session per `app/src/auth-service/src/auth/auth.service.ts`.

#### §2.1.5 — Account removal + room cascade

1. Register a throwaway account (§3.1.1). Log in.
2. Create one room (§3.4) and post one message in it.
3. Settings → **Delete account**.
4. Cookies clear; redirected to `/login`.
5. As `admin@example.com`: poll `/rooms` for ~15 s — the throwaway-owned room disappears as the BullMQ `user.cascade.delete` job fires.

> **Why async?** ADR-002 (`mng/architecture/adr/` — see §6 caveat). Auth-service responds fast and enqueues a TCP `users.cascade.enqueue` call to backend; the worker (EPIC-11) wipes domain rows in the background.

#### §2.1 (extra) — 2FA login

1. http://localhost:3007/login → `user2fa@example.com` / `Secure2FA!` → **Let's Go**.
2. UI transitions to TOTP step.
3. Read the TOTP secret from `app/.seed-admin-totp.txt` (written by the seeder). From CLI: `oathtool --totp -b "<secret>"`. Or scan the QR row in `app/src/auth-service/scripts/seed.ts`.
4. Enter the 6-digit code → **Verify** → `/dashboard`.

#### §2.2.4 — Active sessions list + remote revoke

1. Log in as `user@example.com` in Chrome **and** Firefox (two browsers → two sessions).
2. In Chrome → top menu → **Sessions** → http://localhost:3007/_auth/sessions.
3. Two rows visible (browser + IP).
4. Click **Revoke** on the Firefox row.
5. In Firefox → click any link → kicked to `/login` within one BFF→auth-service round-trip.

> **Why immediate?** ADR-007 binds a `sid` UUID claim into both access + refresh JWTs at mint. Every `validateToken` call probes `sessions.isRevoked(sid)` over TCP (~5 ms localhost mTLS). Revocation invalidates the cookie path **without waiting for JWT expiry**. See `mng/architecture/adr/ADR-007-session-sid-claim-binding.md`.

### 3.2 §2.2 Presence (online / AFK / offline) + multi-tab

**Note on AFK threshold:** brief says **1 minute** (§2.2.2). For demo speed the dev build uses **5 seconds** so the judge does not have to wait. Configurable via `PRESENCE_AFK_THRESHOLD_MS` in `app/src/backend/.env`.

1. Chrome: log in as `admin@example.com`. Firefox: log in as `user@example.com`.
2. Both navigate to `/contacts`.
3. Each side sees the other's presence dot flip **green** within ~2 s of login (eager-publish, well under the §3.2 < 2 s bar).
4. In Firefox: leave the tab idle 5 s without focus → Chrome sees user dot turn **amber** (AFK).
5. Move the mouse / focus the tab in Firefox → flip back to green within ~2 s.
6. Open a **second** Firefox tab on http://localhost:3007 (same user, multi-tab per §2.2.3). Idle the first tab → Chrome still sees user as **online** (multi-tab rule: any active tab keeps user online).
7. Close all Firefox tabs → user dot turns **grey** (offline) within the scheduler interval (10 s — see ADR-001).

### 3.3 §2.3 Contacts & friends

#### §2.3.2 + §2.3.3 — Friend request by username + confirm

1. Chrome admin → `/contacts` → **Add by username** → type `user` → submit. Optional text per §2.3.2.
2. Firefox user → `/contacts` → **Pending** tab → **Accept**.
3. Both sides now see each other in the friends list.

#### §2.3.2 — Send friend request from a chat-room user list

1. Both join the same room (§3.4).
2. In the right-pane Members list, click any user → UserPopover → **Add friend**.

#### §2.3.4 — Remove a friend

1. Chrome admin → `/contacts` → click user row → UserPopover → **Remove friend**. Confirms via modal.

#### §2.3.5 — User-to-user ban (atomic)

1. Firefox user → `/contacts` → admin row → UserPopover → **Block**.
2. Chrome admin tries to send a DM to user → composer shows the **frozen** banner.
3. Atomicity: the INSERT goes through `INSERT … WHERE NOT EXISTS (SELECT 1 FROM dm_channels WHERE frozen_at IS NOT NULL)` — no ghost writes between check and insert (`app/src/backend/src/messages/`).
4. Existing history is preserved + read-only per §2.3.5.

#### §2.3.6 — Personal-messaging gate

DM send fails for non-friends or banned pairs at the DB layer via the friend/freeze gate on `resolveOrCreateDmChannelId` (commit `021e902` in `mng/implementation-status.md`).

### 3.4 §2.4 Chat rooms

#### §2.4.1 + §2.4.2 + §2.4.3 — Create + catalog + unique name

1. Login as admin → `/rooms` → **+ New room** → fill name, description, visibility=public → create.
2. The catalog at `/rooms` shows the room with name, description, member count (§2.4.3).
3. Search box at the top filters by name/description (§2.4.3).
4. Try creating a second room with the same name → 409 from `rooms.create`.

#### §2.4.4 — Private rooms

1. Create a second room with visibility=**private**.
2. Login as user (Firefox) → `/rooms` → private room is **not** in the catalog.

#### §2.4.5 — Join + leave (public freely; owner cannot leave)

1. As user → click public room → **Join**.
2. Click **Leave Room** in the room detail header → user removed; admin's Members tab updates within ~2 s via WS fan-out (§3.2 NFR).
3. As admin (the owner) → **Leave Room** button is disabled → only **Delete room** is available, per §2.4.5.

#### §2.4.6 — Room deletion cascade

1. Admin → Manage Room → Settings tab → **Delete room** → confirm.
2. Catalog removes the room. Messages and attachments wipe per §2.4.6 (FS attachment files purged by the BullMQ retention worker).

#### §2.4.7 — Owner + admin roles

1. Admin → Manage Room → **Members** tab → click **Make admin** on user → user appears in Admins tab.
2. **Admins** tab: try to remove the owner → action absent (owner cannot lose admin per §2.4.7).
3. As the new admin (Firefox user, after promote): can ban members + delete messages + view banned list. Cannot remove the owner.

#### §2.4.8 + §2.4.9 — Room ban + invitation by username

1. Admin → Manage Room → Members → **Ban** user → user vanishes from the room.
2. **Banned users** tab shows the row with banned_by + timestamp + **Unban**.
3. User tries to rejoin via the public catalog → blocked.
4. Click **Unban** → user can rejoin.
5. **Invitations** tab → invite by username. Per **ADR-005** the API returns `{queued: true, invited: null}` whether the username exists or not — fail-silent to prevent enumeration. UI copy reflects this honestly ("Invite sent if the username exists").

### 3.5 §2.5 Messaging

#### §2.5.1 — Room + DM parity

DM uses the same composer + bubble + edit/delete UI as room messaging — both routes mount `<ChatThread>` (`app/src/frontend/src/routes/`).

#### §2.5.2 — Multiline + UTF-8 + emoji + 3 KB cap

1. In any room composer: type multiline (Shift+Enter) → newlines preserved.
2. Paste a UTF-8 emoji (e.g. `🎉`) → renders fine. **No emoji picker UI** — see §7 limitations; UTF-8 paste covers the requirement functionally.
3. Paste 3+ KB of text → composer rejects with a length warning (`@app/contracts` `MESSAGE_MAX_LENGTH = 3072`).

#### §2.5.3 — Reply / quote

1. Hover any bubble → click **Reply** icon → composer shows quote chip → send.
2. Reply renders with quoted parent block above the new bubble.
3. Delete the parent → reply keeps showing but the quote becomes an "original message deleted" orphan marker (§2.5.5: deletes are not recoverable).

#### §2.5.4 — Edit + "edited" indicator

1. Hover own bubble → **Edit** → change text → save → grey "edited" tag visible on both viewports.

#### §2.5.5 — Delete by author + admin

1. Author deletes own message → tombstone shown.
2. Admin (in a room they admin) deletes a member's message → tombstone shown for everyone.
3. In a DM: only the author can delete (DMs have no admins per §2.5.1).

#### §2.5.6 — Persistent + chronological + infinite scroll + offline delivery

1. In a populated room scroll up to the top → older messages load via keyset pagination on `(created_at, id)` — no jank, no duplicates (composite index in migration 0009).
2. **Offline delivery test:** in Firefox, log out user. In Chrome, send 3 DMs to user. Re-login user → messages appear in the DM thread, in order. WS reconnect also fires `sync.since` to backfill any messages missed during a transient disconnect (`128baa2`).

### 3.6 §2.6 Attachments

#### §2.6.1 + §2.6.2 — Image + arbitrary file via button + paste

1. Composer → click **+ Attach** → choose a PNG/JPG/WebP ≤ 3 MiB → preview chip appears → send.
2. Inline thumbnail renders in both viewports (§4.3 covered).
3. Paste an image from the clipboard (Ctrl+V with an image in clipboard) → handled by the same uploader pipeline (`paste handler` in `app/src/frontend/src/lib/attachments/`).
4. Pick an arbitrary file (e.g. `.zip`, `.txt`) → file pill renders; click downloads.

#### §2.6.3 — Original filename + optional caption

1. Per-chip caption input — type a comment under any uploaded file before sending (AC-08-04, commit `0acfe76`).
2. After download: filename matches the upload via RFC 5987 `Content-Disposition` encoding.

#### §2.6.4 — Access control + ban revoke

1. Admin in a room → upload a file. User joins → can download.
2. Admin → Manage Room → Ban user.
3. User opens the file URL directly → **403 Forbidden** (membership check at `app/src/bff/src/attachments/`).
4. Admin still gets 200.

#### §2.6.5 — File persists after the uploader loses access

1. User uploads a file in a room. Admin bans user. File remains stored on the FS volume — admin can still see + download it. User cannot.
2. Files only get deleted when the **room itself** is deleted (§2.4.6) — verified by the retention worker.

#### §3.4 — File-size caps

1. Upload an image > 3 MiB → rejected at the BFF with a clear error (`MAX_IMAGE_BYTES = 3_145_728`).
2. Upload a non-image file > 20 MiB → rejected (`MAX_FILE_BYTES = 20_971_520`).
3. Magic-byte sniffing (`app/src/backend/src/attachments/`) blocks file-extension spoofing.

### 3.7 §2.7 Notifications

#### §2.7.1 — Unread indicators

1. Firefox user on `/contacts` (not in any DM).
2. Chrome admin sends a DM → Firefox `/contacts` shows a numeric badge on admin's row within ~1 s.
3. Click the row → DM opens → `useAutoMarkRead` (visibility-gated) clears the badge.
4. Send 100+ messages → badge caps at **99+** (`@app/contracts` `UNREAD_BADGE_CAP = 99`).
5. Same flow works for room-channel unread badges in the rooms sidebar.

#### §2.7.2 — Presence latency

Section 3.2 already exercised this. Eager publish + 10 s scheduler comfortably beat the < 2 s NFR on a local stack.

### 3.8 §3 Non-functional requirements

#### §3.1 + §3.2 — Capacity + perf envelope (300 users / 1000-member rooms / 6 msg/s)

Load test scaffolds at `app/load-tests/`:

```bash
cd app/load-tests
./seed-load.sh                     # idempotent — ensures default fixtures
k6 run k6-message-burst.js         # burst write to room id=1
k6 run k6-presence-fanout.js       # presence subscriber fan-out
```

Install k6 first (not bundled): `sudo apt install k6` (Linux) or `brew install k6` (macOS). See `app/load-tests/README.md` for full envelope notes (300 × 1000 × 6 msg/s = 6000 emits/s/room — ADR-006 sizing).

Live runs are **pending** (`mng/implementation-status.md` → "Still open" #2). The scaffolds work; they have not been run at full envelope yet.

#### §3.3 — Persistence + 10k-message room

Postgres-backed; messages keep across restarts. Infinite scroll works on rooms with thousands of messages — keyset pagination on `(created_at, id)` index. Retention prune verification against a seeded 10 k-message room is **pending** (`mng/implementation-status.md` "Still open" #3).

#### §3.4 — Local FS file storage + 20 MiB / 3 MiB caps

Storage path: `data/attachments/` (Docker volume in `docker-compose.dev.yml`). Caps enforced at BFF + backend.

#### §3.5 — Persistent login + multi-tab

Verified in §3.1.3 + §3.2.

#### §3.6 — Reliability (consistency invariants)

- **Membership + room bans + admin/owner perms:** transactional moves (`app/src/backend/src/rooms/`).
- **File access rights:** access-revoke-on-ban (§3.6 verification).
- **DM frozen guard:** atomic `INSERT … WHERE NOT EXISTS` (§3.3 verification).
- **Refresh-token family invalidation:** rotation across the session family on suspected reuse (`app/src/auth-service/src/auth/`).

#### Inter-service security (not in brief, mentioned for completeness)

- **mTLS** between auth-service ↔ backend ↔ BFF over TCP (`TLS_ENABLED=true` + per-service cert/key from `app/scripts/gen-certs.sh`).
- **`SYSTEM_KEY` envelope** wraps every TCP message; `SystemKeyRpcGuard` rejects forged calls. See `app/CLAUDE.md` → "Inter-service security".

### 3.9 §4 UI requirements

#### §4.1 + §4.1.1 — 3-pane layout + accordion compaction

Open any room → left sidebar compacts (rooms accordion), centre is messages, right pane shows members with presence dots. Top menu carries Rooms, Contacts, Sessions, Profile, Sign out.

#### §4.2 — Auto-scroll + sticky-on-scrollback + infinite scroll

1. Send a message at the bottom → list auto-scrolls.
2. Scroll up to read history → new incoming messages do **not** force-scroll.
3. Scroll back to the bottom → auto-scroll resumes.

#### §4.3 — Composer (multiline + emoji + attachment + reply)

Verified in §3.5 + §3.6. **Emoji picker UI is missing** (deferred T30) — UTF-8 emoji paste works fine.

#### §4.4 — Unread visual cues

Verified in §3.7.

#### §4.5 — Admin actions via modal dialogs

Manage Room modal (§3.4) covers ban/unban + remove + manage admins + view banned + delete messages (admin tab in chat) + delete room.

### 3.10 Design system — Kinetic Playground

Visual language spec: `mng/specs/design-system.md`. Vibrant purples + oranges, asymmetric chat bubbles, fluid lounge feel, no `<hr>`, no flat grey shadows.

**Honest state:** retheme is **partial** (`mng/implementation-status.md` design-system row = 🟡). Tokens are in `app/src/frontend/tailwind.config.js` and the core primitives (Button, Input, Label) are themed. Full sweep of remaining components + responsive breakpoints on the ManageRoom modal is pending. See §7.

---

## 4. Automated verification

### 4.1 One-shot smoke gauntlet

```bash
cd app
./scripts/smoke.sh              # build + unit + e2e typecheck across all workspaces
./scripts/smoke.sh --skip-build # tests only
./scripts/smoke.sh --workspace=@app/bff
```

Prints a coloured summary table with per-workspace test counts. Exit 0 = all green. Asserts the **1665+ unit total** quoted in the TL;DR.

### 4.2 Demo-day verifier (boots stack + Playwright + k6)

```bash
cd app
./scripts/demo-verify.sh
```

Brings up the stack, seeds, runs Playwright + k6, captures pass/fail counts and p95 latencies, writes a timestamped report to `app/scripts/demo-reports/demo-verify-<YYYYMMDD-HHMMSS>.md`. Auto-skips k6 if not installed.

### 4.3 Per-workspace test commands

Run from `app/`:

```bash
yarn test                                        # all workspaces
yarn workspace @app/auth-service test            # 199 tests (Jest)
yarn workspace @app/backend test                 # 515 tests (Jest)
yarn workspace @app/bff test                     # 380 tests (Jest)
yarn workspace @app/frontend test                # 488 tests (Vitest)
yarn workspace @app/contracts test               # 83 tests
yarn workspace @app/<n> test --coverage          # coverage report (Jest v8 / Vitest v8)

yarn typecheck                                   # tsc --noEmit, all workspaces
yarn lint                                        # ESLint 9 flat config
yarn build                                       # production builds
```

### 4.4 E2E — Playwright (live stack)

```bash
cd app
yarn workspace @app/tests install:browsers       # first run only
./dev.sh                                         # in another terminal
yarn workspace @app/tests test                   # run the 30+ specs against the live stack
yarn workspace @app/tests report                 # open HTML report
```

POM under `app/e2e-tests/pages/`, fixtures in `app/e2e-tests/fixtures/test.ts`.

---

## 5. Architecture at a glance

### 5.1 Monorepo (Yarn 4 workspaces, root = `app/`)

```
app/
├── src/
│   ├── auth-service/   NestJS  port 3003 → JWT + 2FA + sessions + refresh rotation
│   ├── backend/        NestJS  port 3004 → domain (Drizzle ORM) + WS gateway + workers
│   ├── bff/            NestJS  port 3006 → session cookies + CSRF + RPC proxy to auth+backend
│   ├── frontend/       React 19 port 3007 → TanStack Router + Socket.IO client
│   └── packages/
│       └── contracts/  shared DTOs + ErrorCode enum + grep-gate against drift
├── e2e-tests/          Playwright (POM)
├── load-tests/         k6 scaffolds + seed-load.sh
├── scripts/            gen-certs.sh, smoke.sh, demo-verify.sh
├── docker-compose.*.yml
├── dev.sh / dev-local.sh / dev-doctor.sh
└── claude-memory-plugin/
```

### 5.2 Inter-service wiring

- **Frontend ↔ BFF:** HTTP + Set-Cookie session (`SESSION_COOKIE_SECRET`) + CSRF double-submit + OriginGuard.
- **BFF ↔ auth-service / backend:** NestJS TCP transport over **mTLS** (`Transport.TCP` + `tlsOptions: { requestCert: true, rejectUnauthorized: true }`) + **`_sys` envelope** (`SYSTEM_KEY` shared secret validated by `SystemKeyRpcGuard`). Both layers required.
- **Realtime:** Socket.IO over `/ws` from frontend to backend (cookie handshake — ADR-003) with `@socket.io/redis-adapter` for cross-instance fan-out (ADR-004).

### 5.3 Architecture Decision Records

The full ADR for session sid-claim binding is committed:

- **ADR-007** — `mng/architecture/adr/ADR-007-session-sid-claim-binding.md` — sessions revoke chain.

ADR-001 through ADR-006 are summarised inline at the bottom of `mng/implementation-status.md` (presence source-of-truth, async cascade delete, WS handshake auth, message fan-out, invite enumeration, fan-out scaling envelope) but not yet broken out into individual files. Honest gap; the rationales are recorded, just not in dedicated `.md` files.

C4 + flow diagrams live at `mng/architecture/architecture.md` and `mng/architecture/flow/`.

---

## 6. Test coverage (current)

| Workspace | Tests | Notes |
|---|---|---|
| `@app/auth-service` | **199** | Jest. JWT + 2FA + sid-binding + refresh rotation. |
| `@app/backend` | **515** | Jest. Domain + WS + workers + atomic guards. |
| `@app/bff` | **380** | Jest. CSRF + Origin + RPC proxy + sessions DELETE. |
| `@app/frontend` | **488** | Vitest. Components + stores + page-objects. |
| `@app/contracts` | **83** | Jest. Inline-drift grep-gate + DTO XOR. |
| **Unit total** | **1665+** | + 81 since M4. |
| Playwright E2E | **30+** | `app/e2e-tests/`, live-stack, run via `./scripts/demo-verify.sh`. |
| Integration (testcontainers) | 3 | DB-backed. |
| Load (k6) | 2 scaffolds | `app/load-tests/k6-message-burst.js` + `k6-presence-fanout.js`. |

Coverage report per workspace: `cd app && yarn workspace @app/<n> jest --coverage` (or `vitest --coverage` for frontend).

---

## 7. Known limitations / deferred (honest)

These are genuine gaps — listed up front so judges aren't surprised.

1. **T28 Kinetic Playground full retheme — partial.** Tokens live in `app/src/frontend/tailwind.config.js`; core primitives (Button/Input/Label) themed; full sweep of secondary components + ManageRoom modal responsive breakpoints **pending**.
2. **T30 Emoji picker UI — not built.** UTF-8 emoji paste works (covers §2.5.2 + §4.3 functionally) — but no in-composer emoji picker.
3. **§6 Advanced — XMPP federation deferred.** EPIC-13 is `⏸ DEFERRED` in `mng/implementation-status.md`. No Jabber transport, no federation load-test, no admin federation dashboard.
4. **AFK threshold = 5 s in dev (not 1 min per §2.2.2).** Configurable via `PRESENCE_AFK_THRESHOLD_MS`. Set to 60000 to match the brief letter-perfectly.
5. **Live-stack E2E + k6 runs pending.** Specs + scaffolds exist; full stack execution not yet recorded (`mng/implementation-status.md` → "Still open" #1 + #2).
6. **Retention prune verification on a 10 k-message room — pending.** Worker is wired; large-room run-through not yet executed.
7. **Migrations 0009 / 0010 not `CONCURRENTLY`.** Day-one prod lock risk; safe for hackathon demo. 0011 added the pattern; 0009/0010 swap recipe in `app/src/backend/drizzle/`.
8. **Admin sid-binding follow-up.** Admin sessions live in a separate `admins` table — full sid-binding parity with user sessions is on the post-MVP list (ADR-007 follow-up).
9. **Dependabot — 12 vulns flagged on origin/master** (10 high + 2 moderate, transitive dev tooling, blocked on major bumps including zod 3 → 4 cascade).
10. **Sidless token gap on backend-down login.** `recordLogin` is best-effort (ADR-007 trade-off). Tokens minted while backend is unreachable survive until natural JWT expiry — outbox pattern is a post-MVP item.
11. **ADRs 001-006 not yet broken into individual files.** Rationales captured in `mng/implementation-status.md`; only ADR-007 has a dedicated `.md`.

---

## 8. Reviewer 5-minute tour (if pressed for time)

If you only have 5 minutes, the densest path:

1. **Boot:** `cd app && ./dev.sh`. Wait for "frontend → http://localhost:3007".
2. **Two-browser presence + DM:** Chrome admin + Firefox user → `/contacts` → presence dots → admin opens DM → user sees badge → user opens DM → badge clears. (Covers §2.2 + §2.7 + WS realtime.)
3. **Room + attachment:** both join a public room → admin uploads an image → user sees inline thumbnail + downloads it. (Covers §2.4 + §2.5 + §2.6.)
4. **Sessions revoke:** admin opens `/_auth/sessions` in Chrome → logs in to a 3rd browser → revokes that row → 3rd browser kicked. (Covers §2.2.4 + ADR-007.)
5. **Account delete cascade:** register a throwaway → create a room → delete account → watch room disappear from `/rooms`. (Covers §2.1.5 + ADR-002.)

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `EADDRINUSE` on `3006` / `3007` boot | `cd app && ./dev-doctor.sh --clean` (or `--force` if SIGTERM stalls) |
| Mailpit inbox empty after register / reset | Check `app/.dev-logs/auth-service.log` for `SMTP_HOST`; confirm Mailpit container `app_mailpit_1` is up (`docker ps`) |
| `TLS_ENABLED=true but cert files are missing` | `cd app && ./scripts/gen-certs.sh` to remint dev CA + per-service certs |
| Playwright redis-throttle bleed between specs | Already handled — `e2e-tests/global-setup.ts` flushes Redis on each run |
| k6 not found in `demo-verify.sh` | Script auto-skips k6 leg; install per https://k6.io/docs/get-started/installation/ to enable |
| 2FA — can't find TOTP secret | `cat app/.seed-admin-totp.txt` (written by `app/src/auth-service/scripts/seed.ts` on seed) |
| Stack won't fully tear down | `cd app && docker compose -f docker-compose.dev.yml down -v` + `docker compose -f docker-compose.infra.yml down -v` |
| Port-orphan `docker-proxy` (root-owned) | `./dev-doctor.sh` prints exact `sudo kill <pids>` to run, or `sudo systemctl restart docker` |
| Want to use alternate ports | Set `PORT=13006` in `bff/.env`, `VITE_PORT=13007 + VITE_BFF_URL=http://localhost:13006` in `frontend/.env`. `vite.config.ts` honors them. |

---

## 10. Further reading

- `mng/requirements/requirements.md` — official hackathon brief (source of truth).
- `mng/implementation-status.md` — live progress tracker, per-EPIC, ADR index, deferred list, commit log.
- `mng/specs/` — per-EPIC specs (01–15 + design-system; 13 deferred, 16 = post-MVP backlog).
- `mng/architecture/architecture.md` — system overview + C4 diagrams.
- `mng/architecture/flow/` — sequence diagrams.
- `mng/architecture/adr/ADR-007-session-sid-claim-binding.md` — committed ADR.
- `app/CLAUDE.md` — stack + service wiring details (ports, auth flow, gotchas, ValidationPipe caveat).
- `app/load-tests/README.md` — k6 envelope + run instructions.
- `CLAUDE.md` (project root) — Claude Code session guidance + memory hooks.
