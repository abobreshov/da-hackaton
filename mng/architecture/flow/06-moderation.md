# Flow — EPIC-06 Moderation

## Admin removes (=bans) member

```mermaid
sequenceDiagram
    participant ADMIN
    participant BFF
    participant BE
    participant DB
    participant REDIS
    participant Q as BullMQ
    participant TARGET as Target user (WS)
    ADMIN->>BFF: DELETE /rooms/:id/members/:userId
    BFF->>BE: TCP rooms.member.remove
    BE->>BE: ensureCan(admin, room, 'ban')
    BE->>DB: BEGIN
    BE->>DB: DELETE room_memberships
    BE->>DB: INSERT room_bans(room, userId, banned_by=admin)
    BE->>DB: INSERT audit_log(actor=admin, action='room.member.ban', target=user, metadata={roomId})
    BE->>DB: COMMIT
    BE->>REDIS: PUBLISH room:{id} room.member.removed
    BE->>REDIS: PUBLISH user:{userId} banned {roomId}
    BE->>Q: enqueue room.cascade.ban {roomId, userId}
    BE-->>BFF: 204
    REDIS-->>BFF: sub events
    BFF->>TARGET: ws banned {roomId}
    TARGET->>TARGET: leave socket room, hide room from UI
```

## Permission matrix check

```mermaid
flowchart TD
    A[action request] --> Q{role of actor}
    Q -->|owner| O[any action allowed except demote self]
    Q -->|admin| AD{action in admin set?}
    Q -->|member| M{action = delete own msg?}
    AD -->|yes and target != owner| OK[proceed]
    AD -->|no| DENY[403]
    M -->|yes and msg.author = actor| OK
    M -->|no| DENY
    O --> OK
```

## Owner deletes admin

```mermaid
sequenceDiagram
    participant OWNER
    participant BFF
    participant BE
    OWNER->>BFF: POST /rooms/:id/members/:userId/demote
    BFF->>BE: TCP rooms.admin.remove
    BE->>BE: ensureCan(owner, room, 'demote_admin')
    BE->>BE: target != owner
    BE->>DB: UPDATE role='member'
    BE->>REDIS: PUBLISH room:{id} room.role.changed
```

## Abuse report (user → admin queue)

```mermaid
sequenceDiagram
    participant USER
    participant BFF
    participant BE
    participant DB
    participant REDIS
    participant ADMIN as Online admins (WS)
    USER->>BFF: POST /api/v1/reports {targetType, targetId, reason}
    BFF->>BFF: rate-limit check (Redis)
    BFF->>BE: TCP reports.create
    BE->>DB: INSERT abuse_reports (status='open')
    Note over DB: partial UNIQUE (reporter_id, target_type, target_id) WHERE status='open'<br/>collision → 409 dedup
    BE->>DB: INSERT audit_log(actor=user, action='report.create', target=...)
    BE->>REDIS: PUBLISH admins.global report.new {reportId}
    BE-->>BFF: 201
    REDIS-->>BFF: sub
    BFF->>ADMIN: ws report.new
```

## Admin resolves report + audit query

```mermaid
sequenceDiagram
    participant ADMIN
    participant BFF
    participant BE
    participant DB
    ADMIN->>BFF: POST /api/v1/admin/reports/:id/resolve
    BFF->>BE: TCP reports.resolve
    BE->>BE: ensureCan(admin, 'report.resolve')
    BE->>DB: UPDATE abuse_reports SET status='resolved', resolved_by, resolved_at
    BE->>DB: INSERT audit_log(actor=admin, action='report.resolve', target=report)
    BE-->>BFF: 204
    ADMIN->>BFF: GET /api/v1/admin/audit-log?actor=&from=&to=
    BFF->>BE: TCP audit.page
    BE->>DB: SELECT ... ORDER BY created_at DESC (keyset)
    BE-->>ADMIN: {entries[], nextCursor}
    Note over DB: audit-write failure is best-effort; never blocks privileged action
```
