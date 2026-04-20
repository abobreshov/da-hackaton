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
  })
  .refine((v) => !v.TLS_ENABLED || (v.TLS_CA_PATH && v.TLS_CERT_PATH && v.TLS_KEY_PATH), {
    message: 'TLS_ENABLED=true requires TLS_CA_PATH, TLS_CERT_PATH, TLS_KEY_PATH',
  });

export type Env = z.infer<typeof schema>;
export const env = schema.parse(process.env);
