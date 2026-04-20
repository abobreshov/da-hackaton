# Boilerplate Instructions: NestJS + React Business Application

> **Purpose:** Instructions for Claude to scaffold a new full-stack business application
> using the patterns established in this codebase.
> Invoke with: "Use BOILERPLATE_INSTRUCTIONS.md to scaffold [app-name]"

---

## Stack Overview

| Layer | Technology |
|-------|-----------|
| **Auth Service** | NestJS 11 + Fastify 5, Drizzle ORM, PostgreSQL, Redis |
| **BFF** | NestJS 11 + Fastify 5, no database, TCP → backend |
| **Backend** | NestJS 11 + Fastify 5, Drizzle ORM, PostgreSQL |
| **Frontend** | React 19, TanStack Router, TanStack Query, Zustand, Tailwind, Radix UI |
| **Runtime** | Node 22+, Yarn workspaces (or per-service package.json) |
| **Infra** | PostgreSQL 16, Redis 7, Docker Compose |

---

## Services to Scaffold

```
[app-name]/
├── auth-service/       # Port 3003 — JWT auth, refresh tokens, 2FA
├── backend/            # Port 3004 — Domain logic, REST API, Drizzle ORM, TCP server
├── bff/                # Port 3006 — Thin proxy, session cookies, TCP → backend
├── frontend/           # Port 3007 — React 19 SPA, TanStack Router
└── docker-compose.yml  # PostgreSQL, Redis, all services
```

---

## 1. auth-service

### Purpose
Single source of truth for credentials, tokens, and sessions. Other services NEVER touch
passwords or issue JWTs — they call this service.

### Directory Structure
```
auth-service/
├── src/
│   ├── main.ts                        # Fastify bootstrap, Pino logger, Swagger
│   ├── app.module.ts
│   ├── config/
│   │   └── environment.ts             # Zod schema: all env vars validated at startup
│   ├── database/
│   │   ├── connection.ts              # node-postgres pool via Drizzle
│   │   ├── database.module.ts         # Global provider: inject DATABASE token
│   │   ├── schema/
│   │   │   └── index.ts              # All Drizzle table definitions (see schema below)
│   │   └── repositories/
│   │       ├── base.repository.ts    # Generic findById, findAll, create, update, delete
│   │       ├── user.repository.ts
│   │       └── admin.repository.ts
│   ├── cache/
│   │   ├── cache.module.ts           # ioredis client, global provider
│   │   └── index.ts
│   └── modules/
│       ├── auth/
│       │   ├── auth.module.ts
│       │   ├── admin/
│       │   │   ├── admin-auth.controller.ts   # POST /auth/admin/login, /refresh, /logout
│       │   │   └── admin-auth.service.ts
│       │   ├── customer/
│       │   │   ├── customer-auth.controller.ts  # POST /auth/customer/login, /validate-token
│       │   │   └── customer-auth.service.ts
│       │   ├── shared/
│       │   │   ├── jwt.service.ts              # generateToken, verifyToken
│       │   │   ├── password.service.ts         # bcrypt hash/compare (12 rounds)
│       │   │   └── refresh-token.service.ts    # Redis: create, validateAndRotate, revoke
│       │   ├── guards/
│       │   │   └── jwt.guard.ts
│       │   └── decorators/
│       │       ├── current-user.ts             # @CurrentUser()
│       │       └── public.ts                   # @Public() — skip guard
│       ├── two-factor/                         # Email + SMS OTP (optional, enable per project)
│       └── health/
└── drizzle/                                    # Migration files
```

### Drizzle Schema (minimum viable)
```typescript
// schema/index.ts
import { pgTable, serial, varchar, text, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['ADMIN', 'USER']);
export const accessStatusEnum = pgEnum('access_status', ['ACTIVE', 'INACTIVE']);

export const admins = pgTable('admins', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),  // use citext in prod
  name: varchar('name', { length: 255 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  twoFactorEnabled: boolean('two_factor_enabled').default(false),
  accessStatus: accessStatusEnum('access_status').default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: roleEnum('role').default('USER'),
  accessStatus: accessStatusEnum('access_status').default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
```

### JWT Payloads
```typescript
// Admin JWT (15m TTL, signed with JWT_ADMIN_SECRET)
interface AdminJwtPayload {
  adminId: number;
  email: string;
  iat: number;
  exp: number;
}

// Customer/User JWT (15m TTL, signed with JWT_CUSTOMER_SECRET)
interface UserJwtPayload {
  userId: number;
  email: string;
  role: string;
  iat: number;
  exp: number;
}
```

### Refresh Token Pattern (Redis)
```
Key:   refresh:{type}:{id}:{hash(token)}
Value: JSON { userId/adminId, sessionStartedAt }
TTL:   24h (sliding on each rotation)
Token: {type}:{id}:{64-hex-random}   (e.g. "a:42:deadbeef...")

Max session: 7 days from sessionStartedAt (enforced on rotation)
Rotation: old key deleted atomically, new key written — single-use
Revocation: del key + sRem from tracking set {type}:{id}:tokens
```

### Key Endpoints
```
POST /auth/admin/login           { email, password } → { admin, refreshToken }
POST /auth/admin/refresh         { refreshToken } → { admin, refreshToken }
POST /auth/admin/logout          { refreshToken } → 204
POST /auth/customer/login        { email, password } → { user, refreshToken }
POST /auth/customer/refresh      { refreshToken } → { user, refreshToken }
POST /auth/customer/validate-token  Bearer <jwt> → { userId, email, role }
GET  /health
```

### Environment Variables
```env
PORT=3003
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/appdb
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_ADMIN_SECRET=min-32-chars-secret
JWT_CUSTOMER_SECRET=min-32-chars-secret
JWT_ACCESS_TOKEN_EXPIRATION=15m
JWT_REFRESH_TOKEN_EXPIRATION=24h
SESSION_MAX_DURATION_DAYS=7
ALLOWED_ORIGINS=http://localhost:3007
ALLOW_PASSWORD_ONLY_ADMIN_LOGIN=false
```

---

## 2. backend

### Purpose
Domain logic, PostgreSQL via Drizzle ORM, exposes REST endpoints (HTTP) AND a TCP
microservice interface for BFF-to-backend communication.

### Directory Structure
```
backend/
├── src/
│   ├── main.ts                       # Fastify HTTP server (port 3004)
│   ├── microservice.ts               # TCP server bootstrap (port 4004)
│   ├── app.module.ts
│   ├── config/
│   │   └── environment.ts            # Zod env validation
│   ├── database/
│   │   ├── connection.ts
│   │   ├── database.module.ts
│   │   ├── schema/
│   │   │   └── index.ts             # Domain tables (extend auth-service schema here)
│   │   └── repositories/
│   │       └── base.repository.ts
│   ├── common/
│   │   ├── guards/
│   │   │   ├── jwt.guard.ts         # Validates via auth-service /validate-token
│   │   │   └── system-key.guard.ts  # x-system-key header for internal calls
│   │   └── decorators/
│   │       └── current-user.ts
│   └── modules/
│       ├── auth/                     # Proxy auth calls to auth-service
│       │   └── auth.module.ts
│       ├── [domain]/                 # One module per domain entity
│       │   ├── [domain].module.ts
│       │   ├── [domain].controller.ts   # HTTP: GET/POST/PUT/DELETE /api/v1/[domain]
│       │   ├── [domain].tcp.ts          # TCP: @MessagePattern({ cmd: '[domain].*' })
│       │   └── [domain].service.ts      # Business logic (shared by HTTP + TCP)
│       └── health/
└── drizzle/
```

### TCP Pattern (expose to BFF)
```typescript
// [domain].tcp.ts
import { MessagePattern, Payload } from '@nestjs/microservices';

@Controller()
export class DomainTcpController {
  constructor(private readonly service: DomainService) {}

  @MessagePattern({ cmd: 'domain.list' })
  list(@Payload() data: ListDto) {
    return this.service.list(data);
  }

  @MessagePattern({ cmd: 'domain.findById' })
  findById(@Payload() data: { id: number }) {
    return this.service.findById(data.id);
  }
}
```

### JWT Validation Guard (calls auth-service)
```typescript
// guards/jwt.guard.ts
// On every guarded request: POST auth-service /auth/customer/validate-token
// Attaches { userId, email, role } to req.user
// Cache validation result in Redis (optional, 30s TTL) for high-throughput
```

### Environment Variables
```env
PORT=3004
TCP_PORT=4004
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/appdb
AUTH_SERVICE_URL=http://localhost:3003
SYSTEM_KEY=min-32-chars-internal-key
ALLOWED_ORIGINS=http://localhost:3006,http://localhost:3007
LOG_LEVEL=info
```

---

## 3. bff

### Purpose
Thin proxy layer. No database. Owns browser session (two-layer signed cookies). Calls
auth-service over HTTP for login/refresh. Calls backend over TCP for domain data.
React frontend talks ONLY to this service.

### Directory Structure
```
bff/
├── src/
│   ├── main.ts                         # Fastify + @fastify/cookie
│   ├── app.module.ts
│   ├── config/
│   │   └── environment.ts
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts          # POST /auth/login, /refresh, /logout; GET /session
│   │   ├── auth.service.ts             # HTTP calls to auth-service
│   │   ├── cookie.service.ts           # Two-layer signed cookies
│   │   └── session.guard.ts            # Fast path (cookie JWT) + slow path (refresh)
│   ├── common/
│   │   ├── microservice.module.ts      # TCP ClientProxy → backend:4004
│   │   └── interceptors/
│   │       └── rpc-error.interceptor.ts  # RpcException → HTTP errors
│   └── modules/
│       └── [domain]/
│           ├── [domain].module.ts
│           ├── [domain].controller.ts   # GET/POST /[domain] — SessionGuard applied
│           └── [domain].service.ts      # firstValueFrom(tcpClient.send(...))
```

### Cookie Strategy (Two-Layer Security)
```
Layer 1 — @fastify/cookie signing (COOKIE_SECRET)
  Prevents cookie tampering via HMAC signature on the raw value.
  reply.setCookie(name, value, { signed: true })
  req.unsignCookie(cookieValue) → { value, valid }

Layer 2 — JWT signing (SESSION_COOKIE_SECRET)
  The value stored IN the cookie is itself a JWT.
  Carries: { adminId, email, iat, exp, iss, aud }
  Short TTL (1h) — refresh token handles renewal.

Cookie names:
  session  — JWT, httpOnly, secure, sameSite=lax, TTL 1h
  refresh  — raw token string, httpOnly, secure, sameSite=lax, TTL 48h
```

### SessionGuard Logic
```typescript
async canActivate(context): Promise<boolean> {
  const req = context.switchToHttp().getRequest();
  const reply = context.switchToHttp().getResponse();

  // 1. FAST PATH — validate session cookie (no I/O)
  const sessionCookie = cookieService.readSessionCookie(req);
  if (sessionCookie) {
    const payload = await authService.verifySession(sessionCookie);
    if (payload) {
      req.admin = { id: payload.adminId, email: payload.email };
      return true;
    }
  }

  // 2. SLOW PATH — use refresh token to get new session
  const refreshToken = cookieService.readRefreshCookie(req);
  if (!refreshToken) throw new UnauthorizedException();

  const { admin, refreshToken: newRefresh } = await authService.refresh(refreshToken);
  cookieService.setSessionCookie(reply, admin);
  cookieService.setRefreshCookie(reply, newRefresh);
  req.admin = admin;
  return true;
}
```

### TCP Client Call Pattern
```typescript
// [domain].service.ts
import { firstValueFrom } from 'rxjs';

async list(filters: ListDto) {
  return firstValueFrom(
    this.client.send<DomainEntity[]>({ cmd: 'domain.list' }, filters)
  );
}
```

### RPC Error Interceptor
```typescript
// Maps RpcException status codes → HTTP exceptions
// NOT_FOUND       → NotFoundException (404)
// ALREADY_EXISTS  → ConflictException (409)
// INVALID_ARG     → UnprocessableEntityException (422)
// default         → BadGatewayException (502)
```

### Environment Variables
```env
PORT=3006
NODE_ENV=development
LOG_LEVEL=debug
AUTH_SERVICE_URL=http://localhost:3003
BACKEND_HTTP_URL=http://localhost:3004
BACKEND_TCP_HOST=localhost
BACKEND_TCP_PORT=4004
JWT_SECRET=min-32-chars-session-jwt-secret
SESSION_COOKIE_SECRET=64-hex-chars
COOKIE_SECRET=64-hex-chars
SESSION_COOKIE_TTL=3600
REFRESH_COOKIE_TTL=172800
ALLOWED_ORIGINS=http://localhost:3007
```

---

## 4. frontend

### Purpose
React 19 SPA. Communicates ONLY with BFF (never auth-service or backend directly).
All requests include credentials (cookies). TanStack Router handles auth guards.

### Directory Structure
```
frontend/
├── src/
│   ├── main.tsx
│   ├── routes/
│   │   ├── __root.tsx              # Root layout (nav, error boundary)
│   │   ├── _auth.tsx               # Auth layout: beforeLoad checks /auth/session
│   │   ├── _auth/
│   │   │   ├── dashboard.tsx
│   │   │   └── [domain]/
│   │   │       ├── index.tsx       # List page
│   │   │       └── $id.tsx         # Detail page
│   │   └── login.tsx
│   ├── lib/
│   │   ├── api-client.ts           # apiFetch(): base URL + credentials: 'include' + error handling
│   │   ├── api-error.ts            # ApiError class with status + body
│   │   ├── auth.ts                 # fetchSession(), login(), logout()
│   │   └── [domain]-api.ts         # Domain-specific fetch calls
│   ├── hooks/
│   │   └── useSession.ts           # Zustand store hydrated by TanStack Router beforeLoad
│   ├── components/
│   │   ├── ui/                     # Radix UI primitives + Tailwind (Button, Dialog, Table, etc.)
│   │   └── [feature]/
│   └── vite.config.ts              # Dev: proxy /api → BFF:3006
└── package.json
```

### Auth Route Guard Pattern
```typescript
// routes/_auth.tsx
export const Route = createFileRoute('/_auth')({
  beforeLoad: async ({ context }) => {
    const session = await fetchSession();  // GET /auth/session (cookie-based)
    if (!session) {
      throw redirect({ to: '/login' });
    }
    context.setSession(session);  // Zustand store
  },
  component: AuthLayout,
});
```

### API Client Pattern
```typescript
// lib/api-client.ts
const BASE_URL = import.meta.env.VITE_BFF_URL ?? '';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body);
  }
  return res.json();
}
```

### Auth API Helpers
```typescript
// lib/auth.ts
export const fetchSession = () => apiFetch('/auth/session');
export const login = (email: string, password: string) =>
  apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
export const logout = () => apiFetch('/auth/logout', { method: 'POST' });
```

### Session Store (Zustand)
```typescript
// hooks/useSession.ts
interface SessionStore {
  admin: { id: number; email: string } | null;
  setSession: (admin: SessionStore['admin']) => void;
  clearSession: () => void;
}
export const useSession = create<SessionStore>((set) => ({
  admin: null,
  setSession: (admin) => set({ admin }),
  clearSession: () => set({ admin: null }),
}));
```

### Environment Variables
```env
VITE_BFF_URL=http://localhost:3006
```

### Vite Dev Proxy
```typescript
// vite.config.ts
server: {
  proxy: {
    '/api': { target: 'http://localhost:3006', changeOrigin: true },
    '/auth': { target: 'http://localhost:3006', changeOrigin: true },
  }
}
```

---

## 5. docker-compose.yml

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: appdb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports: ['5432:5432']
    volumes: [pgdata:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    ports: ['6379:6379']

  auth-service:
    build: ./auth-service
    ports: ['3003:3003']
    depends_on: [postgres, redis]
    env_file: ./auth-service/.env

  backend:
    build: ./backend
    ports: ['3004:3004', '4004:4004']  # HTTP + TCP
    depends_on: [postgres, auth-service]
    env_file: ./backend/.env

  bff:
    build: ./bff
    ports: ['3006:3006']
    depends_on: [auth-service, backend]
    env_file: ./bff/.env

  frontend:
    build: ./frontend
    ports: ['3007:3007']
    depends_on: [bff]

volumes:
  pgdata:
```

---

## 6. Auth Flow: End-to-End

```
LOGIN
  Browser POST /auth/login {email, password}
    → BFF AuthController.login()
    → HTTP POST auth-service /auth/admin/login
    → auth-service: bcrypt verify, generate JWT (15m) + refreshToken (Redis, 24h)
    → auth-service returns { admin, refreshToken }
    → BFF: set two signed cookies (session JWT 1h + refresh 48h)
    → Browser stores cookies automatically

AUTHENTICATED REQUEST (session valid)
  Browser GET /domain (credentials: include)
    → BFF SessionGuard fast-path: unsign cookie → verify JWT
    → BFF DomainController: firstValueFrom(tcpClient.send('domain.list', {}))
    → Backend TCP handler: query DB, return data
    → BFF returns JSON to browser

SESSION EXPIRED (transparent refresh)
  Browser GET /domain → 401? No.
    → BFF SessionGuard slow-path: session cookie invalid
    → BFF reads refresh cookie
    → HTTP POST auth-service /auth/admin/refresh
    → auth-service: Redis lookup + rotate (old deleted, new written)
    → BFF: set new session cookie + new refresh cookie in response headers
    → request continues, user never sees 401

LOGOUT
  Browser POST /auth/logout
    → BFF AuthController.logout()
    → HTTP POST auth-service /auth/admin/logout (revoke refresh token in Redis)
    → BFF: clearCookie session + refresh
    → Browser: cookies deleted, redirect to /login
```

---

## 7. NestJS Patterns to Replicate

### main.ts Bootstrap (Fastify)
```typescript
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({ logger: pinoLogger }),
);
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
app.register(fastifyCookie, { secret: process.env.COOKIE_SECRET });
app.enableCors({ origin: process.env.ALLOWED_ORIGINS?.split(','), credentials: true });
app.setGlobalPrefix('api/v1');
await app.listen(process.env.PORT, '0.0.0.0');
```

### Environment Validation (Zod)
```typescript
// config/environment.ts
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  // ...
});

export const env = schema.parse(process.env);  // throws at startup if invalid
```

### Repository Base Pattern
```typescript
export class BaseRepository<T> {
  constructor(protected readonly db: PostgresJsDatabase, protected readonly table: T) {}

  async findById(id: number) {
    return this.db.select().from(this.table).where(eq(this.table.id, id)).limit(1);
  }
}
```

### Guard Composition Rule
```
Class-level @UseGuards(A, B) + method-level @UseGuards(C) → runs A → B → C.
Class-level does NOT get replaced by method-level. Both run.
For mixed-auth controllers: apply guards per-method, not per-class.
```

---

## 8. Scaffolding Checklist

When asked to scaffold from these instructions:

- [ ] Create directory structure for all 4 services
- [ ] `package.json` with exact dependencies (NestJS 11, Drizzle 0.44, Fastify 5, React 19, etc.)
- [ ] `docker-compose.yml` with postgres + redis + all services
- [ ] auth-service: Drizzle schema + migrations + JWT + refresh token service + login/refresh/logout endpoints
- [ ] auth-service: bcrypt password hashing (12 rounds), Redis token storage
- [ ] backend: Drizzle schema + domain module stub + TCP message patterns + HTTP routes
- [ ] backend: JWT guard that calls auth-service `/validate-token`
- [ ] bff: TCP ClientProxy registered globally + RpcErrorInterceptor global
- [ ] bff: SessionGuard with fast path (cookie JWT) + slow path (refresh call)
- [ ] bff: CookieService with two-layer signing
- [ ] bff: AuthController: login, session, logout, refresh endpoints
- [ ] frontend: TanStack Router with `_auth.tsx` layout route guard
- [ ] frontend: apiFetch wrapper with `credentials: 'include'`
- [ ] frontend: Zustand session store
- [ ] frontend: login page (React Hook Form + Zod)
- [ ] frontend: Vite dev proxy → BFF
- [ ] All `.env.example` files with documented variables
- [ ] `drizzle.config.ts` in auth-service and backend
- [ ] Health endpoints on all services (`GET /health → { status: 'ok' }`)
- [ ] `tsconfig.json` with strict mode, paths configured
- [ ] ESLint + Prettier config per service
- [ ] Vitest config per service

---

## 9. Key Dependencies (pinned versions from this codebase)

### auth-service / bff / backend (package.json)
```json
{
  "@nestjs/common": "^11.0.0",
  "@nestjs/core": "^11.0.0",
  "@nestjs/platform-fastify": "^11.0.0",
  "@nestjs/jwt": "^11.0.0",
  "@nestjs/microservices": "^11.0.0",
  "@nestjs/throttler": "^6.5.0",
  "drizzle-orm": "^0.44.0",
  "drizzle-kit": "^0.30.0",
  "pg": "^8.16.0",
  "ioredis": "^5.6.0",
  "bcrypt": "^5.1.0",
  "@fastify/cookie": "^11.0.0",
  "fastify": "^5.0.0",
  "zod": "^3.24.0",
  "class-validator": "^0.14.0",
  "class-transformer": "^0.5.0",
  "pino": "^9.0.0",
  "rxjs": "^7.8.0"
}
```

### frontend (package.json)
```json
{
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "@tanstack/react-router": "^1.168.0",
  "@tanstack/react-query": "^5.0.0",
  "zustand": "^5.0.0",
  "react-hook-form": "^7.0.0",
  "zod": "^3.24.0",
  "@hookform/resolvers": "^3.0.0",
  "tailwindcss": "^3.4.0",
  "@radix-ui/react-dialog": "latest",
  "@radix-ui/react-toast": "latest",
  "vite": "^6.0.0",
  "typescript": "^5.0.0"
}
```

---

## 10. OpenViking Memory Plugin Setup

OpenViking gives Claude persistent cross-session memory — decisions, patterns, fixes extracted automatically from each session.

### Prerequisites
- Python 3.10+
- OpenAI API key (for embeddings + VLM summarization)
- `jq` installed (optional; plugin falls back to Python if missing)

### Step 1: Install OpenViking
```bash
uv pip install openviking --upgrade
# verify
python3 -c "import openviking; print(openviking.__version__)"
```

Run from **project directory**, not from inside OpenViking source repo.

### Step 2: Create `ov.conf` in project root
```json
{
  "embedding": {
    "dense": {
      "api_base": "https://api.openai.com/v1",
      "api_key": "sk-YOUR-OPENAI-KEY",
      "provider": "openai",
      "dimension": 1536,
      "model": "text-embedding-3-small"
    }
  },
  "vlm": {
    "api_base": "https://api.openai.com/v1",
    "api_key": "sk-YOUR-OPENAI-KEY",
    "provider": "openai",
    "model": "gpt-4.1-mini"
  },
  "storage": {
    "workspace": "./data",
    "agfs": { "backend": "local" },
    "vectordb": { "backend": "local" }
  }
}
```

Model choices (OpenAI):
- **Embedding**: `text-embedding-3-small` ($0.02/1M tokens) — best value, use this
- **VLM**: `gpt-4.1-mini` ($0.40/$1.60 per 1M in/out) — good quality/cost; `gpt-5-nano` cheapest option

Add `ov.conf` to `.gitignore` — contains secrets.

### Step 3: Copy plugin into project
```bash
# From source repo:
cp -r /path/to/OpenViking/examples/claude-memory-plugin ./claude-memory-plugin

# Or clone/download from OpenViking GitHub
```

Result:
```
[app-name]/
├── ov.conf
├── claude-memory-plugin/
│   ├── .claude-plugin/plugin.json
│   ├── hooks/
│   │   ├── common.sh
│   │   ├── session-start.sh
│   │   ├── user-prompt-submit.sh
│   │   ├── stop.sh
│   │   └── session-end.sh
│   └── scripts/
│       └── ov_memory.py
```

### Step 4: Configure `.claude/settings.json`
```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "bash \"$PROJECT_DIR/claude-memory-plugin/hooks/session-start.sh\"",
        "timeout": 12
      }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "bash \"$PROJECT_DIR/claude-memory-plugin/hooks/user-prompt-submit.sh\"",
        "timeout": 8
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "bash \"$PROJECT_DIR/claude-memory-plugin/hooks/stop.sh\"",
        "async": true,
        "timeout": 120
      }]
    }],
    "SessionEnd": [{
      "hooks": [{
        "type": "command",
        "command": "bash \"$PROJECT_DIR/claude-memory-plugin/hooks/session-end.sh\"",
        "timeout": 20
      }]
    }]
  }
}
```

`$PROJECT_DIR` is set by Claude Code to the working directory. If not available, replace with absolute path.

### Step 5: Add `memory-recall` skill
```bash
mkdir -p .claude/skills/memory-recall
cp claude-memory-plugin/skills/memory-recall/SKILL.md .claude/skills/memory-recall/SKILL.md
```

Verify paths in `SKILL.md` resolve to:
```bash
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
STATE_FILE="$PROJECT_DIR/.openviking/memory/session_state.json"
BRIDGE="$PROJECT_DIR/claude-memory-plugin/scripts/ov_memory.py"
```

### Step 6: Add `.gitignore` entries
```gitignore
ov.conf
data/
.openviking/
```

### Step 7: Verify
Start new Claude Code session. Should see system message:
```
[openviking-memory] mode=local session=<session-id>
```

Manual verify:
```bash
python3 claude-memory-plugin/scripts/ov_memory.py \
  --project-dir . \
  --state-file .openviking/memory/session_state.json \
  session-start
# Expected: {"ok": true, "mode": "local", ...}
```

### How it works

| Hook | Trigger | Action |
|------|---------|--------|
| `SessionStart` | Session opens | Validates `ov.conf`, creates OpenViking session |
| `UserPromptSubmit` | Each prompt | Hints memory available |
| `Stop` (async) | Claude responds | Summarizes turn → appends to session |
| `SessionEnd` | Session closes | Commits session → extracts long-term memories |

Use `/memory-recall <query>` skill to search extracted memories across sessions.

### Step 6: Create Claude Skills

Create `.claude/skills/` directory with four skills. Exact file content below.

#### `.claude/skills/memory-recall/SKILL.md`
```markdown
---
name: memory-recall
description: Recall relevant long-term memories extracted by OpenViking Session memory. Use when the user asks about past decisions, prior fixes, historical context, or what was done in earlier sessions.
context: fork
allowed-tools: Bash
---

You are a memory retrieval sub-agent for OpenViking memory.

## Goal
Find the most relevant historical memories for: $ARGUMENTS

## Steps

1. Resolve the memory bridge script path.
```bash
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
STATE_FILE="$PROJECT_DIR/.openviking/memory/session_state.json"
BRIDGE="${CLAUDE_PLUGIN_ROOT:-}/scripts/ov_memory.py"

if [ ! -f "$BRIDGE" ]; then
  BRIDGE="$PROJECT_DIR/claude-memory-plugin/scripts/ov_memory.py"
fi
```

2. Run memory recall search.
```bash
~/.openviking-venv/bin/python3 "$BRIDGE" --project-dir "$PROJECT_DIR" --state-file "$STATE_FILE" recall --query "$ARGUMENTS" --top-k 5
```

3. Evaluate results and keep only truly relevant memories.
4. Return a concise curated summary to the main agent.

## Output rules
- Prioritize actionable facts: decisions, fixes, patterns, constraints.
- Include source URIs for traceability.
- If nothing useful appears, respond exactly: `No relevant memories found.`
```

#### `.claude/skills/ov-search/SKILL.md`
```markdown
---
name: ov-search
description: Search project documentation (specs, architecture docs, code reviews, memory files) using OpenViking semantic search. Use when looking for feature specs, architecture decisions, review findings, or any project knowledge that might exist in docs.
context: fork
allowed-tools: Bash
---

You are a documentation search sub-agent for OpenViking resources.

## Goal
Find the most relevant project documentation for: $ARGUMENTS

## What's indexed
- `viking://resources/memory` — architectural decisions, feature status, user preferences, branching strategy
- `viking://resources/mng` — feature specs, architecture docs, service documentation, setup guides
- `viking://resources/[app-name]` — active code reviews, architecture notes

## Steps

1. Resolve the resource script path.
```bash
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
SCRIPT="$PROJECT_DIR/claude-memory-plugin/scripts/ov_resources.py"
```

2. Run semantic search across all resources.
```bash
~/.openviking-venv/bin/python3 "$SCRIPT" search "$ARGUMENTS" --limit 10
```

3. For the top 3 most relevant results (score > 0.4), read their content.
```bash
~/.openviking-venv/bin/python3 "$SCRIPT" read "<viking_uri>"
```

4. Evaluate and curate — extract the key facts, decisions, and actionable information.

## Output rules
- Lead with most relevant findings, grouped by topic.
- Include `viking://` URIs for traceability.
- Quote specific decisions, rules, or constraints verbatim when important.
- Flag any contradictions or gaps between documents.
- If nothing relevant appears, respond exactly: `No relevant documentation found.`
```

#### `.claude/skills/ov-ingest/SKILL.md`
```markdown
---
name: ov-ingest
description: Ingest or update documents in OpenViking resource storage. Use after creating/updating specs, architecture docs, reviews, memory files, or any project artifact that should be searchable via /ov-search.
context: fork
allowed-tools: Bash
---

You are a resource ingestion sub-agent for OpenViking.

## Goal
Ingest or update a document/directory in OpenViking: $ARGUMENTS

## How to parse arguments
- `$ARGUMENTS` is a path (file or directory), optionally followed by `--reason "why"`
- Examples:
  - `/ov-ingest mng/features/new-spec.md --reason "new feature spec"`
  - `/ov-ingest reviews/ --reason "updated code reviews"`

## Steps

1. Resolve paths and parse arguments.
```bash
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
SCRIPT="$PROJECT_DIR/claude-memory-plugin/scripts/ov_resources.py"
PYTHON="$HOME/.openviking-venv/bin/python3"
```

2. Check what resources already exist.
```bash
$PYTHON "$SCRIPT" list
```

3. Determine target path from `$ARGUMENTS`. If relative, resolve from `$PROJECT_DIR`.

4. If path already ingested, remove old version first to avoid duplicates.
```bash
export OPENVIKING_CONFIG_FILE="$PROJECT_DIR/ov.conf"
$PYTHON -c "
import os
os.environ['OPENVIKING_CONFIG_FILE'] = '$PROJECT_DIR/ov.conf'
from openviking import SyncOpenViking
ov = SyncOpenViking(path='$PROJECT_DIR/data')
ov.initialize()
ov.rm('viking://resources/<OLD_NAME>')
print('Removed old resource')
" 2>&1 || true
```

If `ov.rm()` fails with "directory not empty", remove directly:
```bash
rm -rf "$PROJECT_DIR/data/viking/default/resources/<OLD_NAME>"
```

5. Ingest new/updated content.
```bash
$PYTHON "$SCRIPT" add "<RESOLVED_PATH>" --reason "<REASON>"
```

6. Verify ingestion.
```bash
$PYTHON "$SCRIPT" list
```

## Output rules
- Report: resource URI, number of embeddings, any errors.
- End with: `Ingested: <viking_uri> (<N> embeddings)`
```

#### `.claude/skills/grill-me/SKILL.md`

> **Note:** `grill-me` has no OpenViking dependency and no project-specific paths — safe to install globally at `~/.claude/skills/grill-me/SKILL.md` and reuse across all projects unchanged.

```markdown
---
name: grill-me
description: Use when user wants to stress-test a plan or design through relentless questioning, mentions "grill me", or needs thorough vetting of decisions before implementation. Also use when user wants to be interviewed about their design choices.
---

# Grill Me

Two-voice interrogation of your plan or design. **You** get grilled by a technical architect (me) and a **Business Analyst acting as partial Product Owner** (BA agent). We walk down every branch of the decision tree together until all three parties reach shared understanding.

## Two Grillers, One User

| Role | Focus | Source of authority |
|------|-------|-------------------|
| **Me (Architect)** | Technical feasibility, architecture, codebase constraints, implementation trade-offs | Codebase exploration + engineering judgment |
| **BA/PO Agent** | Business value, user workflows, scope, success criteria, prioritization, stakeholder impact | Business analysis + product ownership lens |

The BA is NOT a passive reviewer. It **contributes design decisions** from a product perspective: what to build, for whom, what success looks like, what to cut, what to prioritize. When BA and Architect disagree, present both positions to the user.

## BA/PO Agent — Initial Dispatch

Dispatch **business-analyst** agent in the background at the start:

```
You are acting as a Business Analyst with partial Product Owner authority for this design review.

Analyze this plan/design:
[paste the plan/design]

Your job is to CONTRIBUTE to the design, not just analyze it. Produce:

1. **Product decisions you'd make as PO:** What to prioritize, what to defer, what to cut, MVP scope
2. **Success criteria:** How do we know this worked? Measurable outcomes.
3. **User workflow analysis:** Walk through the user journey. Where does it break? What's missing?
4. **Business risks:** Assumptions that need validation, market/compliance/stakeholder concerns
5. **Scope challenges:** What's the user asking for vs what they actually need?
6. **New branches for the decision tree:** Questions that must be resolved, with YOUR recommended answer for each

For every finding, include your recommendation — not just the question. You have authority to propose design decisions from a business/product perspective.

Format each item as:
- **Finding:** [what you found]
- **PO Recommendation:** [your decision/suggestion]
- **Severity:** P0 (blocks design) / P1 (must resolve before build) / P2 (nice to resolve)
```

## BA/PO Agent — Ongoing Consultation

During the grill, use **SendMessage** to consult the BA agent on business/product questions:

```
[Context of the current branch and user's answer so far]

As PO, what's your recommendation on: [specific question]?
Does this align with the success criteria and user workflow you identified?
```

## Rules

1. **One question at a time.** Never batch. Each message = one focused question about one decision.
2. **Dual recommendations.** When a question has both technical and business dimensions, present BOTH the Architect recommendation and the BA/PO recommendation. If they disagree, present the tension and let user decide.
3. **Codebase first.** If a question can be answered by reading code, explore it instead of asking.
4. **BA contributes, not just questions.** The BA agent proposes design decisions (scope, priority, MVP cuts, success metrics).
5. **Track the tree.** Follow branches depth-first. When BA adds new branches, integrate them at the right level.
6. **No softballs.** Challenge assumptions from both technical AND business angles.
7. **Resolve dependencies.** If decision B depends on A, resolve A first.

## Question Format

```
**[Branch: <topic>]**

<question>

**Architect recommendation:** <technical perspective + reasoning>
**BA/PO recommendation:** <business/product perspective + reasoning>
*(or "Aligned" if both agree)*

**Why this matters:** <1-line consequence of getting this wrong>
```

## Completion

When all branches resolved, send the full decision tree to BA for final review, then present to user:

```markdown
## Resolved Decision Tree

### <Branch 1>
- Decision: ...
- Architect rationale: ...
- BA/PO rationale: ...

## BA/PO Final Assessment
- Priority order: ...
- Recommended cuts: ...
- Success criteria: ...
```
```

#### `.claude/skills/review/SKILL.md`

Adapt this template — replace `[app-name]` with actual project name, adjust agent list to project needs (remove AWS agent for non-cloud projects, etc.):

```markdown
---
name: review
description: Run a multi-agent code review on the current branch vs a base branch. Use when the user asks for a code review, branch review, or wants to review changes before merging.
argument-hint: "[base-branch] (default: main)"
disable-model-invocation: true
---

# Multi-Agent Code Review

## Setup

1. Parse `$ARGUMENTS` for base branch (default: `main`)
2. Get current branch: `git branch --show-current`
3. Get changed files: `git diff <base>...HEAD --name-only`
4. Get full diff: `git diff <base>...HEAD`
5. If no changed files, stop.
6. Get commit history: `git log <base>...HEAD --oneline`

## Change Summary

Before launching agents, write short summary:
- **Why?** — problem this change addresses
- **What?** — high-level changes
- **How?** — approach, services affected, key design choices

## Review Execution

Spawn ALL agents IN PARALLEL in a SINGLE message:

### Agent 1: Security Review
- subagent_type: `general-purpose`
- Focus: Injection risks, auth/authz issues, secrets exposure, OWASP Top 10, input validation

### Agent 2: Architecture Review
- subagent_type: `general-purpose`
- Focus: Patterns, separation of concerns, module boundaries, API design, breaking changes

### Agent 3: Code Quality Review
- subagent_type: `general-purpose`
- Focus: Readability, naming, DRY, error handling, test coverage, TypeScript type safety

### Agent 4: SOLID Principles Review
- subagent_type: `solid-code-reviewer`
- Focus: SOLID/DRY compliance, SRP, testability, coupling

### Agent 5: Backend Architecture Review
- subagent_type: `backend-architect`
- Focus: DB schema, inter-service communication, API contracts, performance, data model

### Agent 6: Challenger Review
- subagent_type: `challenger`
- Focus: Challenge assumptions, alternatives not considered, over/under-engineering, edge cases

For each agent provide:
```
Reviewing branch `{current_branch}` vs `{base_branch}`.

Changed files:
{changed_files_list}

Full diff:
{full_diff}

Read additional files as needed. Use /ov-search to check related architecture decisions or prior reviews.

Severity: CRITICAL / HIGH / MEDIUM / LOW
```

## Compilation

After all agents complete:
1. Consolidate + deduplicate findings
2. Remove false positives
3. Write review file to `reviews/YYYY-MM-DD-review-{feature-slug}.md`
4. Write OpenViking summary to `mng/reviews/YYYY-MM-DD-{feature-slug}-summary.md`
5. Run `/ov-ingest mng/reviews/YYYY-MM-DD-{feature-slug}-summary.md --reason "{feature-slug} change summary"`

## Review File Format

```markdown
# Code Review: {Branch Name}
**Date**: YYYY-MM-DD  |  **Branch**: `{branch}` vs `{base}`  |  **Files**: N

## Change Summary
**Why**: ...  **What**: ...  **How**: ...

## Findings Overview
| Severity | Count |
|----------|-------|
| Critical | X |
| High | X |
| Medium | X |
| Low | X |

## Critical / High / Medium / Low Findings
{verified findings, agent source noted}

## Review Details by Agent
{full output per agent}
```
```

### When scaffolding: what to do
- [ ] Ask user for OpenAI API key for embeddings
- [ ] Create `ov.conf` with placeholder keys (mark `YOUR-KEY` clearly)
- [ ] Copy `claude-memory-plugin/` directory (from OpenViking repo or GitHub)
- [ ] Wire all 4 hooks into `.claude/settings.json`
- [ ] Create all 4 skill files under `.claude/skills/`
- [ ] Update `ov-search` SKILL.md: replace `[app-name]` in `## What's indexed` section
- [ ] Update `review` SKILL.md: adjust agent list and paths for the new project
- [ ] Install `grill-me` globally at `~/.claude/skills/grill-me/SKILL.md` (once, reused by all projects)
- [ ] Add `ov.conf`, `data/`, `.openviking/` to `.gitignore`
- [ ] Create initial `mng/` directory structure: `features/`, `architecture/`, `reviews/`
- [ ] Run first ingest after scaffolding: `/ov-ingest mng/ --reason "initial project docs"`

---

## 11. Reusing Memory + Skills in a New Project

All memory and skills are portable. Each project gets its own isolated OpenViking storage (`data/`, `.openviking/`). Skills use `$PROJECT_DIR` (set by Claude Code) so they resolve paths at runtime — no hardcoded paths.

### What makes skills portable

Every skill resolves its paths dynamically:
```bash
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"       # set by Claude Code to working dir
BRIDGE="$PROJECT_DIR/claude-memory-plugin/scripts/ov_memory.py"
SCRIPT="$PROJECT_DIR/claude-memory-plugin/scripts/ov_resources.py"
```

Each project has its own:
- `ov.conf` — API keys + storage config (points to `./data`)
- `data/` — vector DB + AGFS stored locally per project
- `.openviking/memory/` — session state per project

Nothing is shared across projects.

### Exact steps to set up memory+skills in a new project

```bash
NEW_PROJECT="/path/to/new-project"
SOURCE_PROJECT="/home/abobreshov/Work/leadtone/card-platform"

# 1. Copy the memory plugin
cp -r "$SOURCE_PROJECT/claude-memory-plugin" "$NEW_PROJECT/claude-memory-plugin"

# 2. Copy project-level skills (OpenViking-dependent, per-project)
mkdir -p "$NEW_PROJECT/.claude/skills"
cp -r "$SOURCE_PROJECT/.claude/skills/memory-recall" "$NEW_PROJECT/.claude/skills/"
cp -r "$SOURCE_PROJECT/.claude/skills/ov-search"     "$NEW_PROJECT/.claude/skills/"
cp -r "$SOURCE_PROJECT/.claude/skills/ov-ingest"     "$NEW_PROJECT/.claude/skills/"
cp -r "$SOURCE_PROJECT/.claude/skills/review"        "$NEW_PROJECT/.claude/skills/"

# 2b. Install grill-me globally (reusable across ALL projects, no per-project copy needed)
mkdir -p ~/.claude/skills/grill-me
cp "$SOURCE_PROJECT/.claude/skills/grill-me/SKILL.md" ~/.claude/skills/grill-me/SKILL.md
# Or copy from the boilerplate template above

# 3. Create ov.conf (fill in your API keys)
cat > "$NEW_PROJECT/ov.conf" << 'EOF'
{
  "embedding": {
    "dense": {
      "api_base": "https://api.openai.com/v1",
      "api_key": "sk-YOUR-OPENAI-KEY",
      "provider": "openai",
      "dimension": 1536,
      "model": "text-embedding-3-small"
    }
  },
  "vlm": {
    "api_base": "https://api.openai.com/v1",
    "api_key": "sk-YOUR-OPENAI-KEY",
    "provider": "openai",
    "model": "gpt-4.1-mini"
  },
  "storage": {
    "workspace": "./data",
    "agfs": { "backend": "local" },
    "vectordb": { "backend": "local" }
  }
}
EOF

# 4. Create .claude/settings.json with hooks
mkdir -p "$NEW_PROJECT/.claude"
cat > "$NEW_PROJECT/.claude/settings.json" << 'EOF'
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "bash \"$PROJECT_DIR/claude-memory-plugin/hooks/session-start.sh\"",
        "timeout": 12
      }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "bash \"$PROJECT_DIR/claude-memory-plugin/hooks/user-prompt-submit.sh\"",
        "timeout": 8
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "bash \"$PROJECT_DIR/claude-memory-plugin/hooks/stop.sh\"",
        "async": true,
        "timeout": 120
      }]
    }],
    "SessionEnd": [{
      "hooks": [{
        "type": "command",
        "command": "bash \"$PROJECT_DIR/claude-memory-plugin/hooks/session-end.sh\"",
        "timeout": 20
      }]
    }]
  }
}
EOF

# 5. Add gitignore entries
cat >> "$NEW_PROJECT/.gitignore" << 'EOF'
ov.conf
data/
.openviking/
EOF
```

### Per-project customization after copy

| File | What to change |
|------|---------------|
| `ov.conf` | Fill in real API keys |
| `.claude/skills/ov-search/SKILL.md` | Update `## What's indexed` — replace `[app-name]` with project name and list actual resource namespaces |
| `.claude/skills/review/SKILL.md` | Adjust agent list (remove AWS agent for non-cloud projects), update paths to match new project's `mng/` structure |

### Verify in new project
```bash
cd /path/to/new-project

# Test OpenViking works
python3 claude-memory-plugin/scripts/ov_memory.py \
  --project-dir . \
  --state-file .openviking/memory/session_state.json \
  session-start
# Expected: {"ok": true, "mode": "local", ...}

# Then open Claude Code — should see:
# [openviking-memory] mode=local session=<id>
```

### First ingest for a new project
After setup, ingest the project's docs so `/ov-search` can find them:
```
/ov-ingest mng/ --reason "initial project docs"
/ov-ingest CLAUDE.md --reason "project conventions and stack"
```

---

## 12. What to Ask Before Scaffolding

Before generating code, confirm:

1. **App name** — used for package names, DB name, cookie names, Docker service names
2. **Domain entities** — what tables/modules beyond User/Admin (e.g., Product, Order, Invoice)
3. **Auth modes needed** — admin only? customers too? API keys? HMAC?
4. **2FA** — required or optional?
5. **Multi-tenancy** — single tenant or white-label / org-scoped?
6. **Email/SMS** — AWS SES, SMTP, or skip for now?
7. **Output target** — new directory? existing monorepo?
