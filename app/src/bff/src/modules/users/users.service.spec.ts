// Stub env so transitive imports (microservice.module → environment) don't
// require real secrets at test time. Mirrors RoomsService spec pattern.
jest.mock('../../config/environment', () => ({
  env: {
    SYSTEM_KEY: 'test-sys-key',
    TLS_ENABLED: false,
    BACKEND_TCP_HOST: '127.0.0.1',
    BACKEND_TCP_PORT: 4004,
    AUTH_TCP_HOST: '127.0.0.1',
    AUTH_TCP_PORT: 4003,
    NODE_ENV: 'test',
    SESSION_COOKIE_TTL: 900,
    REFRESH_COOKIE_TTL: 2_592_000,
    SESSION_COOKIE_SECRET: 'test-session-secret',
  },
}));

import { of, throwError } from 'rxjs';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

function makeClient() {
  return {
    send: jest.fn(),
  };
}

describe('UsersService (BFF)', () => {
  let client: ReturnType<typeof makeClient>;
  let service: UsersService;

  beforeEach(() => {
    client = makeClient();
    service = new UsersService(client as any);
  });

  describe('list()', () => {
    it('sends users.list with _sys envelope and returns upstream rows', async () => {
      const rows = [{ id: 1, name: 'alice' }];
      client.send.mockReturnValueOnce(of(rows));

      const result = await service.list();

      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'users.list' },
        expect.objectContaining({ _sys: 'test-sys-key' }),
      );
      expect(result).toEqual(rows);
    });
  });

  describe('findById(id)', () => {
    it('sends users.findById with {id} in the payload', async () => {
      const row = { id: 1, name: 'alice' };
      client.send.mockReturnValueOnce(of(row));

      const result = await service.findById(1);

      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'users.findById' },
        expect.objectContaining({ _sys: 'test-sys-key', id: 1 }),
      );
      expect(result).toEqual(row);
    });
  });

  describe('resolveUserIdByUsername(username)', () => {
    it('returns the id when a case-matching name is found', async () => {
      client.send.mockReturnValueOnce(
        of([
          { id: 1, name: 'alice' },
          { id: 2, name: 'bob' },
        ]),
      );

      await expect(service.resolveUserIdByUsername('bob')).resolves.toBe(2);
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'users.list' },
        expect.objectContaining({ _sys: 'test-sys-key' }),
      );
    });

    it('is case-insensitive', async () => {
      client.send.mockReturnValueOnce(
        of([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'bob' },
        ]),
      );
      await expect(service.resolveUserIdByUsername('alice')).resolves.toBe(1);
    });

    it('trims whitespace before matching', async () => {
      client.send.mockReturnValueOnce(of([{ id: 9, name: 'charlie' }]));
      await expect(service.resolveUserIdByUsername('  charlie  ')).resolves.toBe(9);
    });

    it('throws NotFoundException when the username is absent', async () => {
      client.send.mockReturnValueOnce(of([{ id: 1, name: 'alice' }]));
      await expect(service.resolveUserIdByUsername('ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFoundException without hitting upstream when username is empty', async () => {
      await expect(service.resolveUserIdByUsername('   ')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(client.send).not.toHaveBeenCalled();
    });

    it('propagates RPC errors verbatim', async () => {
      const err = new Error('upstream down');
      client.send.mockReturnValueOnce(throwError(() => err));
      await expect(service.resolveUserIdByUsername('alice')).rejects.toBe(err);
    });
  });
});
