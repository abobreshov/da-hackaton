/**
 * DI tokens for the TransportModule.
 *
 * `TRANSPORT_REDIS_PUB` is a dedicated ioredis connection for PUBLISHing
 * presence + other realtime deltas. It is intentionally separate from the
 * BullMQ pool (`WORKERS_REDIS_CONNECTION`) because mixing pub/sub and
 * blocking BullMQ commands on one connection causes head-of-line blocking.
 */
export const TRANSPORT_REDIS_PUB = 'TRANSPORT_REDIS_PUB';
