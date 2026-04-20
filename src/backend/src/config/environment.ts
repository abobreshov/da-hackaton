import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3004),
  TCP_PORT: z.coerce.number().default(4004),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  AUTH_SERVICE_URL: z.string().url().default('http://localhost:3003'),
  SYSTEM_KEY: z.string().min(32),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3006,http://localhost:3007'),
  LOG_LEVEL: z.string().default('info'),
});

export type Env = z.infer<typeof schema>;
export const env = schema.parse(process.env);
