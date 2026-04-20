# EPIC-16 — Deferred backlog (post-MVP)

Captures items flagged by the `devils-advocate` and `oop-patterns-reviewer` reviews that are correctly scoped OUT of the hackathon MVP. Each item lists the cost driver + the condition under which it becomes a blocker.

**Status legend:**
- 🟡 Should — worth picking up in the next working session; reviewer signal is strong.
- 🔴 Big — multi-session effort or infrastructure change; plan as its own epic.

## Auth / OIDC

### 🟡 1. OIDC access-token reshape (`jwt.service.ts`)

**Current state:** customer + admin access tokens are signed as `{ userId, email, role, scopes }`. Session cookies are now OIDC-shaped (`sub`, `type`, `email`, `name`, `scopes`); access tokens are not.

**Cost:** one file in `auth-service` (`modules/auth/shared/jwt.service.ts`), the consumer in `backend/src/common/guards/jwt.guard.ts` (TODO comment already parked there), and unit tests for both. One coordinated commit because producer + consumer must land together.

**Blocker trigger:** we start signing an external-facing access token (e.g. mobile client, third-party relying party). Until then, the BFF-only access path is closed and the field rename is purely hygiene.

### 🟡 2. `validateToken` RPC reshape to OAuth introspection shape

**Current state:** `auth.customer.validateToken` returns `{ userId, email, role, scopes }` on the TCP envelope. OAuth introspection response (RFC 7662) is `{ active, sub, scope, username, exp, iat, token_type }`.

**Cost:** `customer-auth.service.ts:243-255` + every consumer. Trivial; roughly an hour with tests. Gated by item 1 — ship together.

**Blocker trigger:** introducing a second client that performs token introspection.

### 🟡 3. Register endpoint — email / username enumeration

**Current state:** `POST /auth/register` returns `409 "email or username taken"` on collision. Disclose user existence.

**Tradeoff:** generic "Registration failed" hurts recovery ("did I typo my email?"). OWASP's canonical answer is:
1. Always return `202 Accepted`.
2. If the email is new, send a verification email with the usual link.
3. If the email already exists, send a different email telling the user they already have an account + password-reset link.
4. UI shows the same "Check your inbox" regardless.

**Cost:** medium — requires a second email template in the mailer pipeline, one controller change, one DTO tweak. Low risk but touches the email plumbing that is only loosely wired in the MVP (Mailpit only).

**Blocker trigger:** the app is exposed to the public internet OR an ASVS L2 audit is planned.

### 🟡 4. Session cookie rotation on password change

**Current state:** `customer-auth.service.ts#changePassword` revokes all refresh tokens but the issued session JWT cookie continues to verify until its TTL expires (1 h).

**Cost:** wire the BFF's `password-change` controller to also call `cookieService.setSessionCookie` with a fresh JWT after a successful change. One commit, ~30 min.

**Blocker trigger:** any multi-device story where logging out of device B after a password change on device A must be instant.

### 🔴 5. HIBP breached-password check (ASVS V2.1.7)

**Current state:** not implemented. Password policy enforces complexity only.

**Why big:** the k-anonymity protocol talks to an external service (`api.pwnedpasswords.com`), which introduces network failure modes (fail-open vs fail-closed), adds a hot-path dependency on hashing + prefix lookup, needs caching (1 h TTL on prefix range cache), and has legal / privacy posture decisions (is outbound call disclosed to users?). Also non-trivial in tests.

**Blocker trigger:** ASVS L2 audit or a compliance posture that explicitly cites NIST SP 800-63B §5.1.1.

### 🔴 6. Argon2id migration path

**Current state:** `password.service.ts` uses bcrypt cost 12.

**Why big:** requires:
1. `argon2` dep + hash-format detection at verify time.
2. Rehash-on-login strategy: when a user successfully logs in against a bcrypt hash, opportunistically rewrite their hash as Argon2id on the same transaction.
3. Perf budget: argon2id default params are slower than bcrypt(12); need to tune memory/iterations/parallelism for our target p50 login latency.
4. Two-algorithm window until the last bcrypt hash is migrated.

**Blocker trigger:** compliance posture mandates Argon2 (several EU frameworks explicitly prefer it post-2022) OR bcrypt cost cannot hit the OWASP 2023 threshold on our hardware.

## Authorization

### 🟡 7. Wire `@Scopes()` guard that actually consumes `session.scopes`

**Current state:** `session.scopes: ['read:profile', 'write:profile', 'read:dashboard']` is stored + returned but no guard reads it. RBAC-in-scopes cosplay.

**Cost:** one new decorator + guard in `bff/src/common/guards/scopes.guard.ts` (backend already has a `ScopesGuard` — mirror its shape). Then annotate routes that should be scope-gated. Small. Blocked on a design decision: which scopes apply to which routes? That's a spec-side conversation (`01-accounts-auth.md` already defines `read:dashboard`).

**Blocker trigger:** we grow a second account tier (e.g. "read-only viewer") that requires differential access inside the existing authenticated surface.

## Frontend UI kit

### 🟡 8. `_auth/dm/$userId.tsx` GlassCard retrofit

**Current state:** three inline `rounded-[2rem] bg-surface-container-lowest/80 …` blocks still in this single file after the C-batch retrofit. Left out-of-scope in that batch.

**Cost:** 10 min, mechanical. Grep shows `dm/$userId.tsx` is the only remaining offender in `_auth/*`.

**Blocker trigger:** none — pure hygiene; fix next opportunity.

### 🟡 9. `ChatChatLogo` raw hex + inline style + hand-joined `className`

**Current state:** `components/brand/chatchat-logo.tsx` uses `rgba(34, 0, 77, 0.35)` inside the `style` prop and assembles className with `[…].filter(Boolean).join(' ')` instead of the project's `cn()`.

**Cost:** move the gradient + inset shadow into `index.css` as utility classes (or CSS vars), swap the className join to `cn()`. One file, ~20 min.

**Blocker trigger:** none — PR hygiene, catches in the next design-system review.

### 🟡 10. `AppHeader` inherit `AppShell.maxWidth`

**Current state:** `AppHeader` pins `max-w-6xl`; `AppShell` exposes a `maxWidth` prop that the header ignores.

**Cost:** thread the prop through or read it from a React context. ~15 min.

**Blocker trigger:** any route that sets `AppShell.maxWidth` other than `6xl`.

### 🟡 11. Unify variant naming (`variant` / `sizing` / `tone`)

**Current state:** Button uses `variant`+`size`; Input uses `variant`+`sizing` (renamed because HTML `size` collides); Chip uses `tone`; AvatarDisc uses `size`+`tone`; HeroCard uses `tone`; GlassCard uses `radius`+`padding`+`shadow`+`tone`.

**Suggested convention:** `tone` for colour families, `variant` for structural shapes, `size` everywhere else (with `sizing` on Input documented as an HTML-attr-collision exception). Button's current `variant` prop is actually tonal (`primary`/`secondary`/`ghost`/`danger`/`outline`) so it could move to `tone` — but the consumer churn is non-trivial.

**Cost:** primitive renames are cheap; updating every call-site in routes (≈ 40+ hits) is the cost. Medium.

**Blocker trigger:** a new primitive author picks the wrong axis and adds further drift.

### 🟡 12. `GlassCard.as` stringly-typed whitelist → `asChild` Slot

**Current state:** `GlassCard` accepts `as?: 'div' | 'section' | 'article' | 'header' | 'aside'`. Button + AvatarDisc use `@radix-ui/react-slot`'s `asChild` instead. Two idioms in one kit.

**Cost:** primitive change + migrate the callers that pass `as=`. Small (<10 callers) but visible.

**Blocker trigger:** a future primitive author reaches past the whitelist and adds a new DOM tag.

### 🟡 13. `FormField` accept `<textarea>` / `<select>`

**Current state:** `FormField` hardcodes `<Input>`. First settings/profile-edit page will fork the primitive.

**Cost:** either add a `control` render-prop (`(a11yProps) => ReactNode`) or export a `useFormFieldA11y` hook that the consumer calls from a custom FormField variant. Medium-small.

**Blocker trigger:** first route that needs a multiline bio, a dropdown, or a checkbox inside a form.

## Infrastructure / runtime

### 🔴 14. Backend HTTP ports off host in prod compose

**Current state:** `docker-compose.yml` publishes `3003:3003` (auth-service) and `3004:3004` (backend) for dev convenience. README claims "only BFF and FE exposed."

**Cost:** remove the `ports:` blocks from the prod-shaped compose; update docs to reflect that auth-service + backend are internal-network-only. Small diff, big correctness improvement.

**Blocker trigger:** anyone actually deploys to a server using `docker-compose.yml` as a template.

### 🔴 15. Extract workers from backend process

**Current state:** backend's `WorkersModule` boots four BullMQ queue+worker pairs (`userCascadeDelete`, `retentionPrune`, `attachmentsCleanup`, `abuseReportNotify`) inside the same process that handles TCP RPC. Event-loop starvation vector during retention prune or cascade delete.

**Cost:** new `worker` entrypoint (a `src/worker.ts` alongside `src/main.ts`), separate Docker service in compose, shared module imports. Medium.

**Blocker trigger:** user activity reveals request-latency spikes correlated with scheduled retention runs.

### 🔴 16. `dev.sh` cleanup trap vs `dev-doctor.sh`

**Current state:** `dev-doctor.sh` cleans up stale `docker-proxy` / orphaned nest watchers because `dev.sh` doesn't trap `EXIT|INT|TERM`. The doctor script is load-bearing because the trap is missing, not because docker is intrinsically messy.

**Cost:** two lines in `dev.sh` (`trap 'docker compose -f docker-compose.dev.yml down --remove-orphans' EXIT INT TERM` before the `docker compose up`). `dev-doctor.sh` remains useful for the case where someone `kill -9`'d the prior run.

**Blocker trigger:** none — it's quality-of-life, but the dev-doctor existence suggests new developers hit the symptom regularly.

### 🔴 17. WS real-time end-to-end

**Current state:** `ChatGateway` scaffolded, Socket.IO adapter wired to Redis, presence hooks in place. Room message flow (send → fan-out → ack → FE render) needs end-to-end verification + a Playwright E2E covering at least one send+receive between two browser sessions.

**Cost:** multi-milestone epic. Not hackathon-demo-blocking if judging only walks the login + dashboard path. Real chat interaction is the killer missing demo feature.

**Blocker trigger:** judging walkthrough includes actual message exchange OR first post-MVP user test.

## Suggested ordering when picking this up

1. Small win: items 4, 8, 9, 10 (auth session rotation + three UI hygiene fixes). A single parallel-agent batch.
2. OIDC completion: items 1 + 2 together (one atomic migration of access-token shape + consumer).
3. Scope guard: item 7 — unblocks a proper role model.
4. UI kit polish: items 11, 12, 13 — one batch once the design language has settled another week.
5. Security epics: items 3 (enumeration), 5 (HIBP), 6 (Argon2id). Each is a standalone ticket.
6. Infra epics: items 14, 15, 16, 17. Scope + plan separately.
