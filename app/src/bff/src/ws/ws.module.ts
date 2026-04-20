import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import fastifyCookie from '@fastify/cookie';
import { AuthModule } from '../auth/auth.module';
import { env } from '../config/environment';
import { ChatGateway } from './chat.gateway';
import { RedisSubscriberService, REDIS_SUB_CLIENT } from './redis-subscriber.service';
import { WsOriginGuard } from './origin.guard';
import { COOKIE_SIGNER, WsAuthenticator } from './ws-authenticator.service';
import { WsConnectRateLimit } from './ws-connect-rate-limit.service';

/**
 * WS plane wiring.
 *
 * - Imports AuthModule so WsAuthenticator + gateway reuse CookieService to
 *   verify the same signed-JWT session issued by HTTP login (EPIC-03 AC-03-10).
 * - Provides the @fastify/cookie Signer behind a DI token so tests can swap
 *   it in isolation (see ws-authenticator.service.spec).
 * - Provides a dedicated ioredis SUBSCRIBE-mode client to the subscriber.
 *   Kept separate from the Socket.IO adapter's pub/sub pair — ioredis puts
 *   a connection into subscriber mode and no other commands may run on it,
 *   so sharing the adapter's client is unsafe.
 */
@Module({
  imports: [AuthModule],
  providers: [
    WsOriginGuard,
    {
      provide: REDIS_SUB_CLIENT,
      useFactory: () => {
        const host = process.env.REDIS_HOST ?? 'localhost';
        const port = Number(process.env.REDIS_PORT ?? 6379);
        return new Redis({ host, port, lazyConnect: false });
      },
    },
    {
      provide: COOKIE_SIGNER,
      useFactory: () => new (fastifyCookie as any).Signer(env.COOKIE_SECRET),
    },
    WsAuthenticator,
    WsConnectRateLimit,
    RedisSubscriberService,
    ChatGateway,
  ],
  exports: [RedisSubscriberService],
})
export class WsModule {}
