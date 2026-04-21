import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import fastifyCookie from '@fastify/cookie';
import fastifyCsrfProtection from '@fastify/csrf-protection';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyMultipart from '@fastify/multipart';
import { AppModule } from './app.module';
import { RpcErrorInterceptor } from './common/interceptors/rpc-error.interceptor';
import { RedisIoAdapter } from './ws/redis-io.adapter';
import { env } from './config/environment';

const MAX_BODY_BYTES = 100 * 1024; // 100 KB — BFF handles small JSON only
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.totpCode',
  'req.body.refreshToken',
  'res.headers["set-cookie"]',
];

async function bootstrap() {
  // trustProxy allowlist — NEVER set to bare `true` in prod. A global-true
  // lets any caller spoof X-Forwarded-For and bypass the per-IP rate-limit
  // fallback in ThrottleGuard. In prod we trust only the explicit upstream
  // proxies listed in TRUSTED_PROXIES (comma-separated IPs / CIDR blocks),
  // or fall back to loopback-only when none were provided. In dev + test
  // we don't trust XFF at all — the real req.ip is what we want.
  const trustProxy: boolean | string[] =
    env.NODE_ENV === 'production'
      ? env.TRUSTED_PROXIES
        ? env.TRUSTED_PROXIES.split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : ['loopback']
      : false;

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: {
        level: env.LOG_LEVEL as any,
        redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      },
      bodyLimit: MAX_BODY_BYTES,
      trustProxy,
      disableRequestLogging: false,
    }),
  );

  // OWASP-aligned security headers: CSP, HSTS (prod only), X-Frame-Options (via CSP frame-ancestors),
  // X-Content-Type-Options, Referrer-Policy, Cross-Origin-Resource-Policy.
  await app.register(fastifyHelmet as any, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'", ...env.ALLOWED_ORIGINS.split(',')],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'object-src': ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts:
      env.NODE_ENV === 'production'
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  // Rate limiting — blunt defense against brute force and scraping.
  await app.register(fastifyRateLimit as any, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    allowList: env.NODE_ENV === 'development' ? ['127.0.0.1', '::1'] : [],
  });

  // Multipart for attachment uploads (EPIC-08). 20 MiB max matches §3.4 —
  // per-file enforcement + server-side magic-byte sniff happens in the
  // backend AttachmentsService, so this is just the Fastify-level hard cap.
  await app.register(fastifyMultipart as any, {
    limits: {
      fileSize: 20 * 1024 * 1024, // 20 MiB ceiling (backend tightens to 3 MiB for images)
      files: 10, // per-request
      fields: 10,
      fieldSize: 1024, // comment field
    },
  });

  await app.register(fastifyCookie as any, { secret: env.COOKIE_SECRET });

  // CSRF double-submit: cookie is NOT HttpOnly so FE JS can read it and
  // echo it via the x-csrf-token header. Safe methods (GET/HEAD/OPTIONS)
  // skip validation by default in @fastify/csrf-protection.
  await app.register(fastifyCsrfProtection as any, {
    cookieKey: 'csrf',
    cookieOpts: {
      path: '/',
      sameSite: 'strict',
      secure: env.NODE_ENV === 'production',
      httpOnly: false,
      signed: false,
    },
    getToken: (req: any) => (req.headers['x-csrf-token'] as string | undefined) ?? '',
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalInterceptors(new RpcErrorInterceptor());

  app.enableCors({
    origin: env.ALLOWED_ORIGINS.split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
    maxAge: 600,
  });

  // Exclude `/metrics` from the global prefix — Prometheus scrapes at root
  // path (see app/observability/prometheus.yml).
  app.setGlobalPrefix('api/v1', { exclude: ['/metrics'] });

  // WS plane — Socket.IO adapter backed by Redis pub/sub so broadcasts
  // fan out across BFF replicas. Connect to Redis *before* listen() so
  // the adapter is live when the first WS upgrade arrives.
  const ioAdapter = new RedisIoAdapter(app);
  await ioAdapter.connectToRedis();
  app.useWebSocketAdapter(ioAdapter);

  await app.listen(env.PORT, '0.0.0.0');
  console.log(`BFF running on port ${env.PORT}`);
}

bootstrap();
