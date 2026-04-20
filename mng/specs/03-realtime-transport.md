# EPIC-03 — Real-time Transport (WebSocket)

**Req refs:** §3.2 (≤3s delivery, ≤2s presence), §3.6 consistency

## Goal
WebSocket transport between FE, BFF, BE. BFF terminate WS; BE publish events via Redis. Reconnect handling + at-least-once delivery. Expose PresencePublisher primitive consumed by EPIC-02; consumed as observer by EPIC-09 (see ADR-001).

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-03-01 | Socket.IO handshake validates signed session cookie via SessionGuard on upgrade. No separate ticket endpoint for MVP (FE origin = BFF origin; cookie forwarded natively). |
| AC-03-02 | Reconnect after network loss restores subscriptions |
| AC-03-03 | Client can request missed events since last known `message_id` |
| AC-03-04 | BE horizontal replicas fan out via Redis pub/sub |
| AC-03-05 | BFF horizontal replicas fan out via `@socket.io/redis-adapter` |
| AC-03-06 | Message delivery to online recipients p95 ≤3s |
| AC-03-07 | PresencePublisher NestJS provider exposes publish(userId, state): Promise<void>; publishes to user:{userId} + coalesced presence:global (500ms debounce) |
| AC-03-08 | EPIC-09 subscribes user:{userId} as consumer only (no presence writes) |
| AC-03-09 | `room.join` ack payload shape: `{ ok:true, members:[{userId,state,role}] }` on success, `WireError` on fail. BFF resolves members via TCP `rooms.membersOf` + `presence.stateOf` before acking so FE renders member pane pre-first-presence-delta. |
| AC-03-10 | WS handshake cookie-only; no session-ticket endpoint in MVP. Cross-origin / native clients POST-MVP. |
| AC-03-11 | BFF subscribes `RedisChannel.presenceGlobal` for all presence deltas (500ms debounced coalescer). Per-socket interest filter = room co-members ∪ friends. Does NOT per-user subscribe for presence. `user:{id}` reserved for friend/ban/DM events. |
| AC-03-12 | WS `error` event uses WireError envelope (EPIC-15 AC-15-03) — identical shape to REST error body. Close code 4401 on auth fail, 4403 on origin reject, 4429 on rate-limit close. |
| AC-03-13 | BFF maintains in-memory interest graph: `Map<socketId, {rooms:Set<roomId>, presenceOf:Set<userId>}>`. Refcount adjusts on join/leave/disconnect; unsubscribe Redis channels when refcount zero. |
| AC-03-14 | Per-room WS message fan-out uses Socket.IO room membership + @socket.io/redis-adapter — BFF calls `this.server.to('room:'+roomId).emit(event, payload)` directly. Backend publishes on `RedisChannel.room(id)` Redis channel; BFF subscribes once (via IoAdapter); adapter propagates cross-replica. BFF does NOT query DB members per broadcast. Presence-specific `user:{id}` path stays via explicit RedisSubscriberService interest graph. |

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
    error               WireError   // { code, message, details?, retryAfterMs?, requestId? } — see EPIC-15 AC-15-03
```

## BE publish channels (Redis)

- `room:{roomId}` — all room events (`message.new`, `message.edited`, `message.deleted`, member changes)
- `user:{userId}` — user-scoped events: friend request/accept/reject/removed, user.banned, dm.frozen. NOT for presence (presence uses presenceGlobal per AC-03-11).
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
EPIC-15 contracts (error envelope, channel names); EPIC-14 rate-limits.

## Risks
- Sticky sessions or Redis adapter required for multi-BFF
- Zombie subscriptions on disconnect → per-room ref-count, scheduled sweep
- Message fan-out vs presence fan-out use different paths: messages → Socket.IO room + redis-adapter (implicit cross-replica); presence → explicit RedisSubscriberService subscription + interest-graph filter. Two paths justified by per-channel semantics.

## Out of scope
WebTransport / QUIC, SSE fallback.