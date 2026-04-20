export const RedisKey = {
  presenceSessions: (userId: number) => `presence:sessions:${userId}`,
  presenceState: (userId: number) => `presence:state:${userId}`,
  ratelimit: (scope: string, key: string | number) => `ratelimit:${scope}:${key}`,
  refreshCustomer: (userId: number, hash: string) => `refresh:u:${userId}:${hash}`,
  refreshAdmin: (adminId: number, hash: string) => `refresh:a:${adminId}:${hash}`,
} as const;
