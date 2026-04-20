# EPIC-03 — Real-time Transport (WebSocket)

**Req refs:** §3.2 (≤3s delivery, ≤2s presence), §3.6 consistency

## Goal
Establish WebSocket transport between FE, BFF, and BE. BFF terminates WS; BE publishes events over Redis. Reconnect handling + at-least-once delivery.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-03-01 | Socket.IO handshake validates session cookie (`SessionGuard` reuse) |
| AC-03-02 | Reconnect after network loss restores subscriptions |
| AC-03-03 | Client can request missed events since last known `message_id` |
| AC-03-04 | BE horizontal replicas fan out via Redis pub/sub |
| AC-03-05 | BFF horizontal replicas fan out via `@socket.io/redis-adapter` |
| AC-03-06 | Message delivery to online recipients p95 ≤3s |

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
- `presence:global` — coalesced presence deltas

BFF subscribes lazily: on first WS client joining a room, subscribe `room:{roomId}`. Unsubscribe when last client leaves.

## Delivery guarantees

- BE persist-before-publish: transaction commits, then `PUBLISH`
- FE stores last seen `message_id` per room; on reconnect emits `sync.since`
- BFF returns gap messages from BE via TCP `messages.since`

## Dependencies
EPIC-01, EPIC-02.

## Risks
- Sticky sessions or Redis adapter required for multi-BFF
- Zombie subscriptions on disconnect → per-room ref-count, scheduled sweep

## Out of scope
WebTransport / QUIC, SSE fallback.
