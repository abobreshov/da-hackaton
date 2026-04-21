import { z } from 'zod';

const schema = z
  .object({
    PORT: z.coerce.number().default(3004),
    TCP_PORT: z.coerce.number().default(4004),
    TCP_BIND: z.string().default('127.0.0.1'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.string().url(),
    AUTH_TCP_HOST: z.string().default('localhost'),
    AUTH_TCP_PORT: z.coerce.number().default(4003),
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().default(6379),
    SYSTEM_KEY: z.string().min(32),
    ALLOWED_ORIGINS: z.string().default('http://localhost:3006,http://localhost:3007'),
    LOG_LEVEL: z.string().default('info'),
    TLS_ENABLED: z
      .string()
      .transform((v) => v === 'true')
      .default('false'),
    TLS_CA_PATH: z.string().optional(),
    TLS_CERT_PATH: z.string().optional(),
    TLS_KEY_PATH: z.string().optional(),
    AFK_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(60),
    /**
     * Session entries in `presence:sessions:{userId}` older than this are
     * treated as dead by both the derive path and the scheduler prune
     * pass. Closes the gap where a crashed client (no clean WS
     * disconnect) would stay `afk` forever because the HASH entry never
     * gets evicted. Default = 3× AFK window (180 s), which gives a user
     * ≥ 2 missed heartbeat cycles before we assume the tab is gone.
     */
    PRESENCE_OFFLINE_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(180),
    WORKERS_ENABLED: z.coerce.boolean().default(false),
    ATTACHMENTS_DIR: z.string().default('/data/attachments'),
  })
  .refine((v) => !v.TLS_ENABLED || (v.TLS_CA_PATH && v.TLS_CERT_PATH && v.TLS_KEY_PATH), {
    message: 'TLS_ENABLED=true requires TLS_CA_PATH, TLS_CERT_PATH, TLS_KEY_PATH',
  });

export type Env = z.infer<typeof schema>;
export const env = schema.parse(process.env);
