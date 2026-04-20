# CLAUDE.md

Project root for the AI Herders Jam hackathon. Git repo, agents, OpenViking memory, and specs live here. Implementation code (services, docker stack, E2E suite) lives under `app/` — that is the yarn workspace root.

Launch Claude Code from this folder (`hackathone/`) so SessionStart hooks activate OpenViking memory for the whole project.

## Structure

```
hackathone/
├── .claude/
│   ├── agents/              system-architect, business-analyst
│   ├── skills/              memory-recall, ov-search, ov-ingest, review, grill-me
│   ├── settings.json        OpenViking hooks (point at app/claude-memory-plugin)
│   └── settings.local.json
├── .openviking/             (gitignored) session memory state
├── data/                    (gitignored) OpenViking vectordb + agfs storage
├── ov.conf                  (gitignored) OpenViking provider config (API keys)
├── CLAUDE.md                this file
├── README.md                project overview
├── docs/                    project-wide docs
├── mng/
│   ├── README.md
│   ├── architecture/        C4 diagrams + architecture notes
│   ├── specs/               feature specs (numbered 01–14; EPIC-13 deferred post-MVP)
│   └── requirements/        official hackathon requirements PDF
└── app/                     implementation workspace (yarn 4 monorepo root)
    ├── CLAUDE.md            stack + service wiring details
    ├── package.json         yarn workspaces root
    ├── .yarnrc.yml          yarn 4 config
    ├── tsconfig.base.json
    ├── docker-compose.yml
    ├── docker-compose.dev.yml
    ├── docker-compose.infra.yml
    ├── docker-compose.override.yml
    ├── dev.sh               Docker stack (all services + infra)
    ├── dev-local.sh         infra in Docker, services on host
    ├── src/
    │   ├── auth-service/    NestJS — JWT, 2FA, refresh tokens
    │   ├── backend/         NestJS — domain tables (Drizzle ORM)
    │   ├── bff/             NestJS — session cookies, TCP proxy to auth + backend
    │   ├── frontend/        React 19 + TanStack Router
    │   └── packages/        shared internal packages
    ├── e2e-tests/           Playwright + POM
    └── claude-memory-plugin/  OpenViking hooks + bridge scripts
```

## Frontend design system

All frontend work (React + Tailwind under `app/src/frontend/`) must follow the binding spec at **`mng/specs/design-system.md`** — "The Kinetic Playground". Fluid, bouncy, lounge energy — not a dashboard. Short rules:

- No 1 px solid borders for sectioning — separate regions with `surface_container_*` tier shifts.
- No `<hr>` dividers — tonal transitions or whitespace only.
- No raw hex literals in components — consume tokens from `tailwind.config.ts`.
- No pure-grey shadows — tint with `on_surface` (#39264c) at 4–8%, blur 30–60 px.
- No rigid-grid alignment — intentional off-axis drift encouraged.
- Plus Jakarta Sans for `display/headline/title`, Be Vietnam Pro for `body/label`.
- Primary buttons: full round (9999 px), gradient `primary` → `primary_dim`, 1.02× hover scale.
- Chat bubbles: asymmetric — `xl` on 3 corners, `sm` on avatar-side corner (speech-tail, no triangles).

Full tokens + component rules + enforcement criteria live in the spec. Any PR violating the non-negotiables must be rejected at review.

## Agents (`.claude/agents/`)

| Agent | Scope |
|---|---|
| **system-architect** | system design, DB schema, API architecture, microservice decomposition, C4 diagrams, perf + security architecture. Uses OpenViking memory + Context7 for current library docs. Delegates when out of scope. |
| **business-analyst** | requirements, user stories (INVEST + Gherkin), process flows, impact analysis, prioritization. Mandatory `grill-me` self-review before finalizing. Delegates feasibility to system-architect. |

Invoke via trigger phrases in each agent's description, or `Task` tool with `subagent_type: <name>`.

## Parallel subagent dispatch

Prefer running subagents in parallel when work is independent. Send **one message with multiple `Agent` tool calls** — they execute concurrently. Good fits:

- Editing N independent spec files (one agent per file)
- Running research across separate modules (one agent per module)
- Compressing / ingesting multiple docs
- Independent lint / typecheck / test runs across services

Rules:
- Each agent prompt must be self-contained (no shared conversation state).
- No two agents should write the same file (race → lost edits).
- Use `run_in_background: true` when the main thread has other work to do while agents run; you'll be notified on completion.
- When tasks depend on each other (B needs A's output), run sequentially, not parallel.
- Foreground parallel fan-out is fine for small batches (≤5); for larger batches use background + continue other work.

## Memory formation principles (auto-memory at `~/.claude/projects/.../memory/`)

Keep the index thin and the detail deep. Every entry worth remembering lives in its own file; `MEMORY.md` is a reading map, not a content store.

**File layout**
- One `.md` file per discrete memory. Name it by topic (`feedback_commit_style.md`, `project_security_posture.md`, `reference_incident_tracker.md`).
- Frontmatter is required:

  ```yaml
  ---
  name: <short human title>
  description: <one line that makes future-you decide "relevant or skip">
  type: feedback | project | user | reference
  ---
  ```
- Body structure by type:
  - **feedback** (how the user wants to collaborate) — rule first, then `**Why:**` (the reason the user gave — often a past incident or strong preference) and `**How to apply:**` (when/where this kicks in).
  - **project** (facts about ongoing work) — fact or decision first, then `**Why:**` and `**How to apply:**`. Convert relative dates (“Thursday”) to absolute (`2026-04-25`) at write time.
  - **user** (role/goals/knowledge) — short profile, what they already know, what they care about.
  - **reference** (pointers to external systems) — what lives where, when to consult it.

**`MEMORY.md` (the index)**
- Lines only. Each line: `- [Title](file.md) — one-line hook ≤ 150 chars.`
- Group by type under `## Feedback`, `## Project`, `## User`, `## Reference` — makes recall fast.
- No frontmatter, no prose, no memory content inline. Stays short enough to load every session (cut off past 200 lines).

**What NOT to save**
- Code patterns, file paths, architecture decisions derivable from the tree — read the code.
- Git history / authorship — `git log` / `git blame` is the source of truth.
- Ephemeral task state or debug recipes — that belongs in a plan or commit message.
- Anything already covered in this `CLAUDE.md` or `app/CLAUDE.md`.

**Discipline**
- Before writing a new file, grep existing memories for overlap and **update** rather than duplicate.
- When a memory turns out stale, edit or delete — don't stack contradictions.
- Never echo secrets or PII into a memory file, even if the user just shared them.
- After saving a file, add or fix its line in `MEMORY.md` in the same edit.

### Dual-source recall — auto-memory + OpenViking in parallel

This project has **two** memory stores; always consult both on non-trivial work, in parallel:

- **Auto-memory** (`~/.claude/projects/<project>/memory/`, loaded at session start) — short, hand-curated; user preferences, process rules, current project posture.
- **OpenViking** (`Skill: ov-search`, `Skill: memory-recall`) — long-term semantic index over `mng/` specs, past sessions, reviews. Good for "what did we decide two weeks ago?" / "where's the rule about X?".

**Recall pattern:**
1. Read `MEMORY.md` + follow links for hand-curated context.
2. In the same turn, dispatch `memory-recall` (prior-session extracts) **and** `ov-search` (ingested docs) — parallel tool calls so neither blocks the other.
3. For "what's the preference on X", auto-memory wins. For "what does the spec say about Y", OpenViking. For "is this file still there", grep live tree.

**Conflict resolution (memories disagree with each other or with live state):**
1. Both stores are *point-in-time claims*, not truth.
2. Live code / `git log` / current docs outrank any memory when state is easy to re-check.
3. Most recent user instruction supersedes older feedback — edit the older auto-memory file to mark the supersession; never leave two files saying opposite things.
4. For project state, re-ingest the authoritative doc into OpenViking (`Skill: ov-ingest`) and/or edit the auto-memory file. Record the reconciliation in the commit message that forced it.
5. When a memory names a specific file / function / flag and the user is about to act on that recommendation, verify existence first.

`ov-ingest` after creating or updating any spec, ADR, or review so OpenViking stays current; `MEMORY.md` only grows when something is worth hand-curating for future sessions.

## OpenViking memory

- Session hooks: `.claude/settings.json` → `$CLAUDE_PROJECT_DIR/app/claude-memory-plugin/hooks/*.sh`
- Runtime state: `./.openviking/`, storage: `./data/` (both gitignored)
- Config + secrets: `./ov.conf` (gitignored)
- Skills: `.claude/skills/{memory-recall, ov-search, ov-ingest, review, grill-me}`
- `mng/` content is ingested as searchable knowledge — query via `ov-search`.

Python bridge uses `~/.openviking-venv`. Ensure it is set up before first run.

## Package manager

Yarn 4.9.1 via corepack. **Never npm.** Run yarn commands from `app/` (workspace root) or use `yarn workspace @app/<name> ...` from there.

```bash
cd app
yarn install
yarn workspace @app/auth-service seed
yarn workspace @app/frontend dev
```

## Running the stack

Prereqs: Docker, Node 22+, corepack-enabled yarn 4.9.1.

Both scripts live in `app/`:

```bash
cd app
yarn install
./scripts/gen-certs.sh   # first run only — mints internal-ca + per-service mTLS certs

./dev.sh                 # full Docker stack (all 4 services + infra, hot-reload)
./dev.sh --build         # rebuild images
./dev.sh --no-seed       # skip DB seed

./dev-local.sh           # postgres + redis in Docker (ports 5433/6380), services on host
./dev-local.sh --skip-install --skip-seed
```

Hot-reload is always on (`nest start --watch` for NestJS, `vite` for React). Editing files under `src/` rebuilds + restarts the affected service automatically — no stack restart needed for code changes.

## Debugging a stuck stack — `./dev-doctor.sh`

`EADDRINUSE` on boot usually means an orphan `docker-proxy` from a prior `./dev.sh` or a crashed `dev-local.sh` watcher. Run the doctor:

```bash
cd app
./dev-doctor.sh                    # read-only report — port owners + hackathone procs
./dev-doctor.sh --clean-services   # SIGTERM our node/nest/vite/esbuild/tsc, keep postgres+redis
./dev-doctor.sh --clean            # + `docker compose -f docker-compose.infra.yml down`
./dev-doctor.sh --force            # SIGKILL if SIGTERM failed
```

Safe next to unrelated Node/Docker workloads — only PIDs whose cwd is inside `app/` are touched. If a port belongs to an orphan `docker-proxy` (root-owned), the report prints the exact `sudo kill <pids>` to run.

## Inter-service security

BFF ↔ auth-service ↔ backend calls are protected by two independent layers:

1. **Shared-secret envelope.** Every `client.send(pattern, payload)` is wrapped with `withSys({...})` which injects `_sys: env.SYSTEM_KEY`. `SystemKeyRpcGuard` (APP_GUARD on auth-service + backend) validates it and throws `RpcException 401` otherwise. HTTP contexts bypass via `ctx.getType() !== 'rpc'`.
2. **Mutual TLS.** When `TLS_ENABLED=true`, NestJS `Transport.TCP` accepts `tlsOptions` with `requestCert: true, rejectUnauthorized: true`. Certs are minted by `app/scripts/gen-certs.sh` into `app/secrets/internal-ca/` (gitignored, 1 year).

`TCP_BIND` defaults to `127.0.0.1` on the host; docker-compose overrides to `0.0.0.0` because containers speak over the internal network. See `app/CLAUDE.md` for the ValidationPipe caveat (`forbidNonWhitelisted` must stay off on auth-service/backend or `_sys` trips validation).

After startup:

- frontend → http://localhost:3007
- BFF → http://localhost:3006
- auth-service → http://localhost:3003 (dev-local only)
- backend → http://localhost:3004 (dev-local only)

Stop: `Ctrl-C` (dev.sh traps cleanup). Full wipe: `docker compose -f app/docker-compose.dev.yml down -v`.

Seed creds (see README) are inserted on first run. Re-seed with `yarn workspace @app/auth-service seed`.

See `app/CLAUDE.md` for ports, auth flow, 2FA behavior, and gotchas.

## Git

Repo root is this folder. Main branch: `master`. Remote: `origin`.
