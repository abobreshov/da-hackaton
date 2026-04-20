import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3003),
  TCP_PORT: z.coerce.number().default(4003),
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
});

export type Env = z.infer<typeof schema>;
export const env = schema.parse(process.env);
