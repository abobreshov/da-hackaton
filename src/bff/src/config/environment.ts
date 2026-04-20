import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3006),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('debug'),
  AUTH_SERVICE_URL: z.string().url().default('http://localhost:3003'),
  BACKEND_TCP_HOST: z.string().default('localhost'),
  BACKEND_TCP_PORT: z.coerce.number().default(4004),
  JWT_SECRET: z.string().min(32),
  SESSION_COOKIE_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  SESSION_COOKIE_TTL: z.coerce.number().default(3600),
  REFRESH_COOKIE_TTL: z.coerce.number().default(172800),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3007'),
});

export type Env = z.infer<typeof schema>;
export const env = schema.parse(process.env);
