/**
 * UsersService — thin read-only layer over drizzle.
 *
 * The service only delegates to `db.select().from(users)...` so the unit
 * spec mocks the chain and asserts:
 *  - findAll() returns whatever the select chain resolves to
 *  - findById(id) returns the single row or throws NotFound
 *  - findByUsername(name) returns the row or null (enumeration-safe) and
 *    rejects empty input with BadRequest before hitting the DB.
 */

jest.mock('../../config/environment', () => ({
  env: { DATABASE_URL: 'postgres://test', SYSTEM_KEY: 'x'.repeat(32), TLS_ENABLED: false },
}));
jest.mock('../../database/connection', () => ({
  db: {},
  pool: { end: () => Promise.resolve() },
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

function makeChain(resolve: () => any) {
  const thenResolve = (onFulfilled: any) => Promise.resolve(resolve()).then(onFulfilled);
  const chain: any = {
    select: jest.fn(() => chain),
    from: jest.fn(() => chain),
    where: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    then: jest.fn(thenResolve),
  };
  return chain;
}

describe('UsersService', () => {
  describe('findAll', () => {
    it('returns whatever the select chain resolves to', async () => {
      const rows = [
        { id: 1, email: 'a@x', name: 'alice', role: 'USER', accessStatus: 'active', createdAt: new Date() },
        { id: 2, email: 'b@x', name: 'bob', role: 'ADMIN', accessStatus: 'active', createdAt: new Date() },
      ];
      const db: any = { select: jest.fn(() => makeChain(() => rows)) };
      const svc = new UsersService(db);
      const out = await svc.findAll();
      expect(db.select).toHaveBeenCalled();
      expect(out).toEqual(rows);
    });

    it('returns an empty array when there are no users', async () => {
      const db: any = { select: jest.fn(() => makeChain(() => [])) };
      const svc = new UsersService(db);
      await expect(svc.findAll()).resolves.toEqual([]);
    });
  });

  describe('findById', () => {
    it('returns the row for a known id', async () => {
      const user = { id: 1, email: 'a@x', name: 'alice' };
      const db: any = { select: jest.fn(() => makeChain(() => [user])) };
      const svc = new UsersService(db);
      await expect(svc.findById(1)).resolves.toEqual(user);
    });

    it('throws NotFoundException when no row matches', async () => {
      const db: any = { select: jest.fn(() => makeChain(() => [])) };
      const svc = new UsersService(db);
      await expect(svc.findById(999)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findByUsername', () => {
    it('returns the row when a case-insensitive name match exists', async () => {
      const user = { id: 4, email: 'a@x', name: 'Alice' };
      const db: any = { select: jest.fn(() => makeChain(() => [user])) };
      const svc = new UsersService(db);
      await expect(svc.findByUsername('alice')).resolves.toEqual(user);
      expect(db.select).toHaveBeenCalled();
    });

    it('returns null (not throw) when no row matches — enumeration-safe', async () => {
      const db: any = { select: jest.fn(() => makeChain(() => [])) };
      const svc = new UsersService(db);
      await expect(svc.findByUsername('ghost')).resolves.toBeNull();
    });

    it('trims whitespace before querying', async () => {
      const user = { id: 9, name: 'charlie' };
      const db: any = { select: jest.fn(() => makeChain(() => [user])) };
      const svc = new UsersService(db);
      await expect(svc.findByUsername('  charlie  ')).resolves.toEqual(user);
    });

    it('throws BadRequestException on empty / whitespace-only input', async () => {
      const db: any = { select: jest.fn(() => makeChain(() => [])) };
      const svc = new UsersService(db);
      await expect(svc.findByUsername('')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.findByUsername('   ')).rejects.toBeInstanceOf(BadRequestException);
      // Guard must reject before hitting the DB — no select() call.
      expect(db.select).not.toHaveBeenCalled();
    });
  });
});
