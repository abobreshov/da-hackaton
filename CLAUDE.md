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

./dev.sh                 # full Docker stack (all 4 services + infra, hot-reload)
./dev.sh --build         # rebuild images
./dev.sh --no-seed       # skip DB seed

./dev-local.sh           # postgres + redis in Docker (ports 5433/6380), services on host
./dev-local.sh --skip-install --skip-seed
```

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
