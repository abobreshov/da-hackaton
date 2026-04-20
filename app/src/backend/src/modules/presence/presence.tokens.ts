/**
 * DI tokens for the PresenceModule.
 *
 * `PRESENCE_REDIS` is a dedicated ioredis client used for presence
 * bookkeeping (HSET/HGETALL/HDEL/DEL/EXPIRE/MGET/SCAN on
 * `presence:sessions:{userId}` HASHes + `presence:state:{userId}`
 * STRINGs). It is intentionally separate from:
 *   - `WORKERS_REDIS_CONNECTION` (BullMQ pool — `maxRetriesPerRequest: null`
 *     required for blocking BRPOP, not appropriate for short presence ops).
 *   - `TRANSPORT_REDIS_PUB` (pub-only, reserved for presence coalesced
 *     PUBLISH — the service here calls `PresencePublisher.publish` instead
 *     of publishing directly).
 */
export const PRESENCE_REDIS = 'PRESENCE_REDIS';
