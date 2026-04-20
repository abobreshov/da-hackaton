# EPIC-15 — Wire Contracts & Conventions

**Req refs:** cross-cutting (all EPICs); derived from contract-consistency review 2026-04-20.

## Goal
Lock wire-level contracts across services (REST paths, TCP cmds, WS events, Redis channels/keys, BullMQ queues, error envelope). Single shared package `@app/contracts` sourced by all services + frontend. Prevents drift, enables typed clients.

## Scope
- Uniform error envelope (all transports)
- TCP cmd namespace (auth.customer.*, auth.admin.*, users.*, messages.*, rooms.*, friends.*, presence.*, reports.*, audit.*)
- WS event catalog (server→client facts past-tense, client→server commands present-tense)
- Redis channel names (colon-delimited scope) + Redis data-key layout
- BullMQ queue names (dot-delimited domain.action)
- REST path conventions (/api/v1, plural collections, RESTful verbs + sparing action suffixes)
- Error code enum (SCREAMING_SNAKE, stable)
- Shared package `@app/contracts` shape (files, exports)
- Breaking changes from earlier specs (rename decisions)

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-15-01 | Shared package `@app/contracts` exposes: errors, tcp-commands, ws-events, redis-channels, redis-keys, queues as named constants/types |
| AC-15-02 | BFF `RpcErrorInterceptor` forwards `{code, message, details?, retryAfterMs?, requestId?}` envelope end-to-end (REST + WS) |
| AC-15-03 | Error code enum enumerable: `RATE_LIMITED`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `VALIDATION_FAILED`, `UPSTREAM_UNAVAILABLE`, `DM_FROZEN`, `FRIEND_REQUIRED`, `BANNED_FROM_ROOM`, `TOTP_REQUIRED`, `TOTP_INVALID`, `CSRF_INVALID`, `UNAUTHENTICATED` |
| AC-15-04 | TCP cmd names: `domain.subdomain.verb` lowercase dot-delimited. Examples `auth.customer.login`, `messages.create`, `presence.touch` |
| AC-15-05 | WS events: server→client past-tense facts (`message.new`, `room.member.added`, `room.role.changed`, `unread.changed`); client→server imperative (`message.send`, `presence.ping`). No `.me` / `.you` suffixes — channel scope conveys target |
| AC-15-06 | Redis pub/sub channels: `room:{id}`, `user:{id}`, `presence:global`, `dm:{id}`, `admins.global` |
| AC-15-07 | Redis data keys: `presence:sessions:{userId}` (HASH), `presence:state:{userId}` (STRING), `ratelimit:{scope}:{key}`, `refresh:{u\|a}:{userId}:{hash}` |
| AC-15-08 | BullMQ queues: `user.cascade.delete`, `retention.prune`, `attachments.cleanup`, `abuse.report.notify` |
| AC-15-09 | REST: `/api/v1/*` prefix mandatory; plural resources; action suffixes only for non-CRUD state transitions (`/accept`, `/reject`, `/resolve`, `/dismiss`, `/join`, `/leave`, `/read`). Inverse ops verb-inverted not suffix-inverted (`DELETE /users/:id/ban`, not `POST /users/:id/unban`) |
| AC-15-10 | Renames applied across specs 04, 05, 06, 09: `user.banned.me` → `user.banned`; `room.banned.you` → `room.banned`; `unread.incremented` → `unread.changed`; `invitation.new` → `room.invitation.new` |
| AC-15-11 | Code enum + constants reside under `/home/abobreshov/Work/dataart/hackathone/app/src/packages/contracts/` |
| AC-15-12 | BFF + auth-service + backend + frontend import from `@app/contracts` (no string literals for wire names) |

## API impact
- Extend `auth-service/src/common/rpc-exception.util.ts` `toRpc` signature to pass `{ status, code, message, details?, retryAfterMs? }`
- Extend `bff/src/common/interceptors/rpc-error.interceptor.ts` to preserve full envelope (currently drops code/details/retryAfterMs)
- WS gateway emits `error` event with same envelope
- class-validator failures map to `VALIDATION_FAILED` with `details: { fields: {field: [reasons]} }`

## Interfaces

```ts
// @app/contracts/src/errors.ts
export const ErrorCode = {
  UNAUTHENTICATED:     'UNAUTHENTICATED',
  FORBIDDEN:           'FORBIDDEN',
  NOT_FOUND:           'NOT_FOUND',
  CONFLICT:            'CONFLICT',
  VALIDATION_FAILED:   'VALIDATION_FAILED',
  RATE_LIMITED:        'RATE_LIMITED',
  UPSTREAM_UNAVAILABLE:'UPSTREAM_UNAVAILABLE',
  CSRF_INVALID:        'CSRF_INVALID',
  DM_FROZEN:           'DM_FROZEN',
  FRIEND_REQUIRED:     'FRIEND_REQUIRED',
  BANNED_FROM_ROOM:    'BANNED_FROM_ROOM',
  TOTP_REQUIRED:       'TOTP_REQUIRED',
  TOTP_INVALID:        'TOTP_INVALID',
} as const;
export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

export interface WireError {
  code: ErrorCode;
  message: string;
  details?: unknown;
  retryAfterMs?: number;
  requestId?: string;
}
```

```ts
// @app/contracts/src/tcp-commands.ts
export const TcpCmd = {
  auth: {
    customer: { login: 'auth.customer.login', refresh: 'auth.customer.refresh', logout: 'auth.customer.logout', register: 'auth.customer.register', validateToken: 'auth.customer.validateToken', passwordResetRequest: 'auth.customer.passwordReset.request', passwordResetConfirm: 'auth.customer.passwordReset.confirm', passwordChange: 'auth.customer.passwordChange', delete: 'auth.customer.delete' },
    admin:    { login: 'auth.admin.login', refresh: 'auth.admin.refresh', logout: 'auth.admin.logout' },
  },
  users: { list: 'users.list', findById: 'users.findById', ban: 'users.ban', unban: 'users.unban' },
  messages: { create: 'messages.create', edit: 'messages.edit', delete: 'messages.delete', list: 'messages.list', since: 'messages.since' },
  rooms: { create: 'rooms.create', join: 'rooms.join', leave: 'rooms.leave', invite: 'rooms.invite', listMy: 'rooms.listMy', catalog: 'rooms.catalog' },
  friends: { request: 'friends.request', accept: 'friends.accept', reject: 'friends.reject', remove: 'friends.remove' },
  presence: { touch: 'presence.touch' },
  reports: { create: 'reports.create', resolve: 'reports.resolve', dismiss: 'reports.dismiss' },
  audit: { page: 'audit.page' },
} as const;
```

```ts
// @app/contracts/src/ws-events.ts
export const WsEvent = {
  client: { messageSend: 'message.send', messageEdit: 'message.edit', messageDelete: 'message.delete', roomJoin: 'room.join', roomLeave: 'room.leave', presencePing: 'presence.ping', syncSince: 'sync.since' },
  server: { messageNew: 'message.new', messageEdited: 'message.edited', messageDeleted: 'message.deleted', roomMemberAdded: 'room.member.added', roomMemberRemoved: 'room.member.removed', roomRoleChanged: 'room.role.changed', roomBanned: 'room.banned', roomInvitationNew: 'room.invitation.new', roomDeleted: 'room.deleted', friendRequestNew: 'friend.request.new', friendRequestAccepted: 'friend.request.accepted', friendRemoved: 'friend.removed', userBanned: 'user.banned', dmFrozen: 'dm.frozen', presenceUpdate: 'presence.update', unreadChanged: 'unread.changed', reportNew: 'report.new', reportResolved: 'report.resolved', reportDismissed: 'report.dismissed', error: 'error' },
} as const;
```

```ts
// @app/contracts/src/redis-channels.ts
export const RedisChannel = {
  room:           (roomId: number | string) => `room:${roomId}`,
  user:           (userId: number | string) => `user:${userId}`,
  dm:             (dmId:   number | string) => `dm:${dmId}`,
  presenceGlobal: 'presence:global',
  adminsGlobal:   'admins.global',
} as const;

// @app/contracts/src/redis-keys.ts
export const RedisKey = {
  presenceSessions: (userId: number) => `presence:sessions:${userId}`,
  presenceState:    (userId: number) => `presence:state:${userId}`,
  ratelimit:        (scope: string, key: string | number) => `ratelimit:${scope}:${key}`,
  refreshCustomer:  (userId: number, hash: string) => `refresh:u:${userId}:${hash}`,
  refreshAdmin:     (adminId: number, hash: string) => `refresh:a:${adminId}:${hash}`,
} as const;

// @app/contracts/src/queues.ts
export const QueueName = {
  userCascadeDelete:  'user.cascade.delete',
  retentionPrune:     'retention.prune',
  attachmentsCleanup: 'attachments.cleanup',
  abuseReportNotify:  'abuse.report.notify',
} as const;
```

## Renames (breaking changes for specs 04/05/06/09 — already updated in-place via EPIC-15 AC-15-10)

| Old | New | Spec |
|---|---|---|
| `user.banned.me` | `user.banned` | EPIC-04 |
| `room.banned.you` | `room.banned` | EPIC-06 |
| `unread.incremented` | `unread.changed` | EPIC-09 |
| `invitation.new` | `room.invitation.new` | EPIC-05 |
| TCP `presence.ping` | `presence.touch` | EPIC-02 (WS `presence.ping` retained) |
| Redis `presence:{userId}` HASH | `presence:sessions:{userId}` | EPIC-02 |
| Redis `presence_state:{userId}` STRING | `presence:state:{userId}` | EPIC-02 |
| REST `POST /rooms/:id/bans/:userId/unban` | `DELETE /rooms/:id/bans/:userId` | EPIC-06 |
| REST `POST /rooms/:id/members/:userId/promote` + `/demote` | `PATCH /rooms/:id/members/:userId { role }` | EPIC-06 |

## Dependencies
All EPICs (cross-cutting). Package must publish before services wire.

## Risks
- Lock before EPIC-03 transport code ships; once frontend subscribes, renames become breaking-change clients.
- Error envelope change to `bff/rpc-error.interceptor.ts` is breaking — must coordinate with frontend error handler in single commit.
- `@app/contracts` must build before consumer services — add to yarn workspace build order (tsconfig project refs).

## Out of scope
- Runtime schema validation (zod/valibot). Keep TypeScript types for MVP.
- OpenAPI / AsyncAPI generation. Post-MVP.
- gRPC / protobuf.
