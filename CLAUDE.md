# CLAUDE.md (project root)

Project root for the AI Herders Jam hackathon. The implementation lives under `app/`.

## Structure

```
hackathone/
├── .claude/
│   └── agents/                  # project-wide agents (system-architect, business-analyst)
├── mng/                         # specs + architecture docs (ingested into OpenViking)
├── app/                         # implementation workspace — yarn workspaces root
│   ├── src/                     # services: auth-service, backend, bff, frontend, packages
│   ├── e2e-tests/               # Playwright E2E suite
│   ├── claude-memory-plugin/    # OpenViking hooks + scripts
│   ├── .claude/                 # app-scoped skills + settings
│   ├── docker-compose.*.yml     # dev stack
│   ├── dev.sh / dev-local.sh    # run stack
│   ├── package.json             # yarn 4 workspaces root
│   ├── tsconfig.base.json
│   └── CLAUDE.md                # stack + architecture details
├── .gitignore
├── BOILERPLATE_INSTRUCTIONS.md
└── 2026_04_18_AI_herders_jam_-_requirements_v3 1.pdf
```

Git repo lives at project root. Yarn workspace root is `app/` — run `yarn` commands from `app/` (or `yarn workspace @app/<name> ...`).

## Agents (project root `.claude/agents/`)

- **system-architect** — system design, DB schema, API architecture, microservices decomposition, C4 diagrams, perf + security architecture. Uses OpenViking memory + Context7 for current docs. Delegates when out of scope.
- **business-analyst** — requirements, user stories (INVEST + Gherkin), process flows, impact analysis, prioritization. OpenViking memory + mandatory `grill-me` self-review. Delegates technical feasibility to `system-architect`.

Invoke via trigger phrases in the agent description or `Task` tool with `subagent_type: <name>`.

## Stack details

See `app/CLAUDE.md` for service wiring, auth flow, common commands, gotchas.

## OpenViking memory

Configured under `app/`. Session hooks + skills (`memory-recall`, `ov-search`, `ov-ingest`) live in `app/.claude/`. Docs in `mng/` are ingested into OpenViking — use `ov-search` to retrieve.

## Package manager

Yarn 4.9.1 via corepack. **Never npm.**
