import { z } from 'zod';

const schema = z
  .object({
    PORT: z.coerce.number().default(3006),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.string().default('debug'),
    AUTH_TCP_HOST: z.string().default('localhost'),
    AUTH_TCP_PORT: z.coerce.number().default(4003),
    BACKEND_TCP_HOST: z.string().default('localhost'),
    BACKEND_TCP_PORT: z.coerce.number().default(4004),
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().default(6379),
    JWT_SECRET: z.string().min(32),
    SESSION_COOKIE_SECRET: z.string().min(32),
    COOKIE_SECRET: z.string().min(32),
    SESSION_COOKIE_TTL: z.coerce.number().default(3600),
    REFRESH_COOKIE_TTL: z.coerce.number().default(172800),
    ALLOWED_ORIGINS: z.string().default('http://localhost:3007'),
    SYSTEM_KEY: z.string().min(32),
    // Comma-separated list of upstream proxy IPs / CIDR blocks Fastify will
    // trust for X-Forwarded-For. Empty / unset → loopback-only in production.
    // Never set to a bare wildcard: any value of `true` lets clients spoof
    // source IPs and bypass the per-IP rate-limit fallback.
    TRUSTED_PROXIES: z.string().optional(),
    // Dev-only opt-out for Secure cookie flag (plain HTTP dev stack).
    // MUST remain false (default) in staging / production.
    COOKIE_SECURE_DISABLED: z.coerce.boolean().default(false),
    TLS_ENABLED: z
      .string()
      .transform((v) => v === 'true')
      .default('false'),
    TLS_CA_PATH: z.string().optional(),
    TLS_CERT_PATH: z.string().optional(),
    TLS_KEY_PATH: z.string().optional(),
  })
  .refine((v) => !v.TLS_ENABLED || (v.TLS_CA_PATH && v.TLS_CERT_PATH && v.TLS_KEY_PATH), {
    message: 'TLS_ENABLED=true requires TLS_CA_PATH, TLS_CERT_PATH, TLS_KEY_PATH',
  });

export type Env = z.infer<typeof schema>;
export const env = schema.parse(process.env);
