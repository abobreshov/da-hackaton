import { z } from 'zod';

const schema = z
  .object({
    PORT: z.coerce.number().default(3003),
    TCP_PORT: z.coerce.number().default(4003),
    TCP_BIND: z.string().default('127.0.0.1'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.string().url(),
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().default(6379),
    JWT_ADMIN_SECRET: z.string().min(32),
    JWT_CUSTOMER_SECRET: z.string().min(32),
    JWT_ACCESS_TOKEN_EXPIRATION: z.string().default('15m'),
    JWT_REFRESH_TOKEN_EXPIRATION: z.string().default('24h'),
    SESSION_MAX_DURATION_DAYS: z.coerce.number().default(7),
    ALLOWED_ORIGINS: z.string().default('http://localhost:3007'),
    ALLOW_PASSWORD_ONLY_ADMIN_LOGIN: z
      .string()
      .transform((v) => v === 'true')
      .default('false'),
    SYSTEM_KEY: z.string().min(32),
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
