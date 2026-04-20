# EPIC-03 — Real-time Transport (WebSocket)

**Req refs:** §3.2 (≤3s delivery, ≤2s presence), §3.6 consistency

## Goal
WebSocket transport between FE, BFF, BE. BFF terminate WS; BE publish events via Redis. Reconnect handling + at-least-once delivery. Expose PresencePublisher primitive consumed by EPIC-02; consumed as observer by EPIC-09 (see ADR-001).

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-03-01 | Socket.IO handshake validates session cookie (`SessionGuard` reuse) |
| AC-03-02 | Reconnect after network loss restores subscriptions |
| AC-03-03 | Client can request missed events since last known `message_id` |
| AC-03-04 | BE horizontal replicas fan out via Redis pub/sub |
| AC-03-05 | BFF horizontal replicas fan out via `@socket.io/redis-adapter` |
| AC-03-06 | Message delivery to online recipients p95 ≤3s |
| AC-03-07 | PresencePublisher NestJS provider exposes publish(userId, state): Promise<void>; publishes to user:{userId} + coalesced presence:global (500ms debounce) |
| AC-03-08 | EPIC-09 subscribes user:{userId} as consumer only (no presence writes) |

## BFF WebSocket gateway

```
namespace /ws
events:
  client→server:
    room.join      { roomId }
    room.leave     { roomId }
    message.send   { roomId, text, replyToId?, attachmentIds? } → ack { id }
    message.edit   { id, text }                                 → ack
    message.delete { id }                                       → ack
    presence.ping  { sessionId }
    sync.since     { roomId, lastId }                           → { messages[] }
  server→client:
    message.new    { message }
    message.edited { id, text, editedAt }
    message.deleted{ id }
    room.member.added   { roomId, user }
    room.member.removed { roomId, userId, reason }
    presence.update     { userId, state }
    banned              { roomId }
    error               { code, message }
```

## BE publish channels (Redis)

- `room:{roomId}` — all room events (`message.new`, `message.edited`, `message.deleted`, member changes)
- `user:{userId}` — user-scoped events (friend request, user ban, presence)
- `presence:global` — coalesced presence deltas (500ms debounce), for fan-out to large-member rooms

BFF subscribe lazy: on first WS client join room, subscribe `room:{roomId}`. Unsubscribe when last client leave.

## Presence publish primitive (ADR-001)

EPIC-03 exposes `PresencePublisher` NestJS provider (`TransportModule`):

```ts
// transport/presence-publisher.service.ts
@Injectable()
export class PresencePublisher {
  publish(userId: number, state: 'online' | 'afk' | 'offline'): Promise<void>;
}
```

- Publishes `{ event: 'presence.update', userId, state }` to `user:{userId}`
- Batches + debounces 500ms into `presence:global` payload `{ deltas: [{userId, state}, ...] }`
- Consumed by EPIC-02 (writer) and EPIC-09 (observer only)
- Unit testable via `jest.fn()` mock; no Redis needed in EPIC-02 tests

## Delivery guarantees

- BE persist-before-publish: transaction commit, then `PUBLISH`
- FE store last seen `message_id` per room; on reconnect emit `sync.since`
- BFF return gap messages from BE via TCP `messages.since`

## Dependencies
EPIC-01, EPIC-02. Exposes primitive for EPIC-02 + EPIC-09.

## Risks
- Sticky sessions or Redis adapter required for multi-BFF
- Zombie subscriptions on disconnect → per-room ref-count, scheduled sweep

## Out of scope
WebTransport / QUIC, SSE fallback.