import { RedisChannel } from './redis-channels';

describe('RedisChannel', () => {
  it('room(id) builds "room:<id>"', () => {
    expect(RedisChannel.room(42)).toBe('room:42');
    expect(RedisChannel.room('lobby')).toBe('room:lobby');
  });

  it('user(id) builds "user:<id>"', () => {
    expect(RedisChannel.user('foo')).toBe('user:foo');
    expect(RedisChannel.user(7)).toBe('user:7');
  });

  it('presenceGlobal === "presence:global"', () => {
    expect(RedisChannel.presenceGlobal).toBe('presence:global');
  });

  it('adminsGlobal === "admins.global"', () => {
    expect(RedisChannel.adminsGlobal).toBe('admins.global');
  });
});
