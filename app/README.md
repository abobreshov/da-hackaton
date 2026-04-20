# App Monorepo

Yarn 4 monorepo with NestJS services, a React frontend, PostgreSQL, and Redis.

## Stack

| Layer | Technology |
|---|---|
| auth-service | NestJS 11 + Fastify 5 |
| backend | NestJS 11 + Fastify 5 |
| bff | NestJS 11 + Fastify 5 |
| frontend | React 19 |
| Database | PostgreSQL 16 |
| Cache / Queue | Redis 7 |

## Ports

| Service | Port(s) |
|---|---|
| auth-service | 3003 |
| backend | 3004 (HTTP), 4004 (WebSocket) |
| bff | 3006 |
| frontend | 3007 |
| postgres | 5432 |
| redis | 6379 |

## Quick Start

```bash
# Install all workspace dependencies
yarn install

# Start all infrastructure and services
docker-compose up
```

## Workspace Layout

```
src/
  auth-service/   NestJS authentication service
  backend/        NestJS core API service
  bff/            NestJS backend-for-frontend
  frontend/       React 19 application
  packages/       Shared internal packages
```
