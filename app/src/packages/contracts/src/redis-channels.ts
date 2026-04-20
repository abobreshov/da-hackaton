export const RedisChannel = {
  room:           (roomId: number | string) => `room:${roomId}`,
  user:           (userId: number | string) => `user:${userId}`,
  dm:             (dmId:   number | string) => `dm:${dmId}`,
  presenceGlobal: 'presence:global',
  adminsGlobal:   'admins.global',
} as const;
