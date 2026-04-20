# Flow — EPIC-07 Messaging Core

## Send room message

```mermaid
sequenceDiagram
    participant S as Sender
    participant BFF
    participant RL as Redis sliding-window
    participant BE
    participant DB
    participant REDIS
    participant OTHERS as Other members online
    S->>BFF: ws message.send {roomId, body, replyTo?, attachmentIds?}
    BFF->>RL: ZADD ratelimit:msg:{userId} now; ZREMRANGEBYSCORE <now-5s
    BFF->>RL: ZCARD → count
    alt count > 30 (30 msg / 5s per user)
        BFF-->>S: ws error {code:'RATE_LIMITED', retryAfterMs}
    end
    BFF->>BE: TCP messages.create
    BE->>DB: check membership + not banned
    BE->>DB: INSERT message tx commit
    BE->>REDIS: PUBLISH room:{id} message.new
    BE-->>BFF: {id, createdAt}
    BFF-->>S: ack {id}
    REDIS-->>BFF: sub
    BFF->>OTHERS: ws message.new
```

## Send DM (with friendship + ban check)

```mermaid
sequenceDiagram
    participant A
    participant BFF
    participant BE
    participant DB
    A->>BFF: ws message.send {dmUserId=B, body}
    BFF->>BE: TCP messages.create
    BE->>DB: SELECT friendships accepted for (A,B)
    BE->>DB: SELECT user_bans (A,B) OR (B,A)
    alt not friends OR banned
        BE-->>A: 403 (frozen)
    else
        BE->>DB: ensure dm_channels row
        BE->>DB: INSERT message dm_id=...
        BE->>REDIS: PUBLISH dm:{id} message.new
    end
```

## Edit

```mermaid
sequenceDiagram
    participant AUTHOR
    participant BFF
    participant BE
    participant DB
    AUTHOR->>BFF: ws message.edit {id, body}
    BFF->>BE: TCP messages.edit
    BE->>DB: UPDATE messages SET body, edited_at WHERE id AND author_id AND deleted_at IS NULL
    alt 0 rows
        BE-->>AUTHOR: 404/403
    else
        BE->>REDIS: PUBLISH room:{id} message.edited
    end
```

## Delete (author or room admin)

```mermaid
sequenceDiagram
    participant ACTOR
    participant BFF
    participant BE
    participant DB
    ACTOR->>BFF: ws message.delete {id}
    BFF->>BE: TCP messages.delete
    BE->>DB: fetch message
    BE->>BE: actor = author OR actor has admin role in room
    alt allowed
        BE->>DB: UPDATE deleted_at=NOW()
        BE->>REDIS: PUBLISH room:{id} message.deleted
    else
        BE-->>ACTOR: 403
    end
```

## Infinite scroll (history)

```mermaid
sequenceDiagram
    participant FE
    participant BFF
    participant BE
    participant DB
    FE->>BFF: GET /rooms/:id/messages?before=<cursorTs>&limit=50
    BFF->>BE: TCP messages.page
    BE->>DB: SELECT ... WHERE room_id=? AND created_at < ? ORDER BY created_at DESC LIMIT 50
    BE-->>FE: {messages[], nextCursor}
```
