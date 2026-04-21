import { Global, Module, type Provider } from '@nestjs/common';
import IORedis from 'ioredis';
import { env } from '../../config/environment';
import { PresencePublisher } from './presence-publisher.service';
import { TRANSPORT_REDIS_PUB } from './transport.tokens';

/**
 * TransportModule — EPIC-03 realtime transport primitives exposed to the
 * rest of the backend.
 *
 * Today it owns:
 *   - A dedicated ioredis publisher connection (`TRANSPORT_REDIS_PUB`).
 *   - `PresencePublisher`, which debounces presence deltas into a single
 *     PUBLISH on `RedisChannel.presenceGlobal` every 500 ms.
 *
 * The pub client is isolated from the BullMQ pool intentionally — pub/sub
 * and blocking BullMQ commands do not share a connection well. It uses
 * default retry settings (not `maxRetriesPerRequest: null`) because a
 * PUBLISH is a one-shot fire-and-forget, not a blocking BRPOP.
 */
const redisPubProvider: Provider = {
  provide: TRANSPORT_REDIS_PUB,
  useFactory: (): IORedis =>
    new IORedis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      lazyConnect: false,
    }),
};

@Global()
@Module({
  providers: [redisPubProvider, PresencePublisher],
  exports: [PresencePublisher, TRANSPORT_REDIS_PUB],
})
export class TransportModule {}
