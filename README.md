# AI Herders Jam — Hackathon Project

Project root. Implementation lives under `app/` (yarn 4 monorepo, NestJS services + React 19 frontend, PostgreSQL + Redis).

## Layout

```
hackathone/
├── .claude/               agents, skills, settings (project-wide)
├── app/                   implementation (yarn workspace root)
│   ├── src/
│   │   ├── auth-service/  NestJS — JWT + 2FA
│   │   ├── backend/       NestJS — domain + Drizzle ORM
│   │   ├── bff/           NestJS — BFF session cookies
│   │   ├── frontend/      React 19 + TanStack Router
│   │   └── packages/      shared
│   ├── e2e-tests/         Playwright
│   ├── claude-memory-plugin/
│   ├── docker-compose.*.yml
│   └── dev.sh / dev-local.sh
├── docs/                  project-wide docs
├── mng/                   specs, architecture, requirements
│   ├── architecture/
│   ├── requirements/      official requirements PDF
│   └── specs/             features 01–13
├── CLAUDE.md              guidance for Claude Code (root)
└── README.md              this file
```

## Stack

| Layer | Tech |
|---|---|
| auth-service | NestJS 11 + Fastify 5 |
| backend | NestJS 11 + Fastify 5 |
| bff | NestJS 11 + Fastify 5 |
| frontend | React 19 + TanStack Router |
| Database | PostgreSQL 16 |
| Cache / Queue | Redis 7 |
| Package mgr | Yarn 4.9.1 (corepack) — **never npm** |

## Ports

| Service | HTTP | TCP |
|---|---|---|
| auth-service | 3003 | 4003 |
| backend | 3004 | 4004 |
| bff | 3006 | — |
| frontend | 3007 | — |
| postgres | 5433 (dev-local) / 5432 | — |
| redis | 6380 (dev-local) / 6379 | — |

## Quick start

```bash
cd app
yarn install

# Option A: full stack in Docker
./dev.sh

# Option B: infra in Docker, services on host
./dev-local.sh
```

Seed creds (created by `src/auth-service/scripts/seed.ts`):

| Email | Password | Role | 2FA |
|---|---|---|---|
| admin@example.com | Admin123! | admin | off |
| user@example.com | User1234! | user | off |
| user2fa@example.com | Secure2FA! | user | on |

## Further reading

- `CLAUDE.md` — project-root guidance for Claude Code sessions.
- `app/CLAUDE.md` — stack, service wiring, auth flow, gotchas.
- `mng/README.md` — specs index.
- `mng/requirements/` — official hackathon brief.
