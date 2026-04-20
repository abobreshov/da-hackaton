import { RedisKey } from './redis-keys';

describe('RedisKey', () => {
  it('presenceSessions(id) builds "presence:sessions:<id>"', () => {
    expect(RedisKey.presenceSessions(42)).toBe('presence:sessions:42');
  });

  it('presenceState(id) builds "presence:state:<id>"', () => {
    expect(RedisKey.presenceState(42)).toBe('presence:state:42');
  });

  it('ratelimit(scope, key) builds "ratelimit:<scope>:<key>"', () => {
    expect(RedisKey.ratelimit('login', 'alice@example.com')).toBe(
      'ratelimit:login:alice@example.com',
    );
    expect(RedisKey.ratelimit('register', 123)).toBe('ratelimit:register:123');
  });

  it('refreshCustomer(userId, hash) builds "refresh:u:<userId>:<hash>"', () => {
    expect(RedisKey.refreshCustomer(1, 'abc')).toBe('refresh:u:1:abc');
  });

  it('refreshAdmin(adminId, hash) builds "refresh:a:<adminId>:<hash>"', () => {
    expect(RedisKey.refreshAdmin(2, 'xyz')).toBe('refresh:a:2:xyz');
  });
});
