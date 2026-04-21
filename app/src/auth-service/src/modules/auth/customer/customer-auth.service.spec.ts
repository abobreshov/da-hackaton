// Seed required env BEFORE importing anything that triggers config/environment parsing.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? 'x'.repeat(48);
process.env.JWT_CUSTOMER_SECRET = process.env.JWT_CUSTOMER_SECRET ?? 'y'.repeat(48);
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'z'.repeat(48);
process.env.JWT_ACCESS_TOKEN_EXPIRATION = process.env.JWT_ACCESS_TOKEN_EXPIRATION ?? '15m';
process.env.FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL ?? 'http://localhost:3007';

import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { CustomerAuthService } from './customer-auth.service';
import type { PasswordService } from '../shared/password.service';
import type { JwtService } from '../shared/jwt.service';
import type { RefreshTokenService } from '../shared/refresh-token.service';
import type { TotpService } from '../shared/totp.service';
import type { MailerService } from '../../mail/mail.service';
import type { ClientProxy } from '@nestjs/microservices';

// --- Test doubles -----------------------------------------------------------

/**
 * Fluent Drizzle query builder double. Each terminal method (`limit`,
 * `returning`, `onConflictDoNothing`) resolves to the value queued for that
 * terminal — the builder is a thenable that resolves to `defaultResult` when
 * awaited without an explicit terminal.
 */
function builder(defaultResult: unknown = undefined) {
  const state: { terminals: Record<string, unknown>; default: unknown } = {
    terminals: {},
    default: defaultResult,
  };

  const thenable: any = {
    from: jest.fn().mockImplementation(() => thenable),
    where: jest.fn().mockImplementation(() => thenable),
    set: jest.fn().mockImplementation(() => thenable),
    values: jest.fn().mockImplementation(() => thenable),
    limit: jest
      .fn()
      .mockImplementation(() => Promise.resolve(state.terminals.limit ?? state.default)),
    returning: jest
      .fn()
      .mockImplementation(() => Promise.resolve(state.terminals.returning ?? state.default)),
    onConflictDoNothing: jest
      .fn()
      .mockImplementation(() => Promise.resolve(state.terminals.onConflict ?? state.default)),
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
      try {
        resolve(state.default);
      } catch (e) {
        reject(e);
      }
    },
    __setTerminal: (name: string, value: unknown) => {
      state.terminals[name] = value;
      return thenable;
    },
    __setDefault: (value: unknown) => {
      state.default = value;
      return thenable;
    },
    __state: state,
  };
  return thenable;
}

function makeDb() {
  const selectBuilder = builder([]);
  const insertBuilder = builder([]);
  const updateBuilder = builder();
  const txSelectBuilder = builder([]);
  const txInsertBuilder = builder([]);
  const txUpdateBuilder = builder();

  const select = jest.fn().mockReturnValue(selectBuilder);
  const insert = jest.fn().mockReturnValue(insertBuilder);
  const update = jest.fn().mockReturnValue(updateBuilder);

  const txSelect = jest.fn().mockReturnValue(txSelectBuilder);
  const txInsert = jest.fn().mockReturnValue(txInsertBuilder);
  const txUpdate = jest.fn().mockReturnValue(txUpdateBuilder);

  const tx = { select: txSelect, insert: txInsert, update: txUpdate };
  const transaction = jest
    .fn()
    .mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

  const db = { select, insert, update, transaction } as any;

  return {
    db,
    selectBuilder,
    insertBuilder,
    updateBuilder,
    txUpdateBuilder,
    tx,
    select,
    insert,
    update,
    transaction,
    txUpdate,
  };
}

function makePasswordService(): jest.Mocked<PasswordService> {
  return {
    hash: jest.fn().mockResolvedValue('hashed-password'),
    compare: jest.fn().mockResolvedValue(true),
  } as any;
}

function makeJwtService(): jest.Mocked<JwtService> {
  return {
    signAdmin: jest.fn().mockReturnValue('admin.jwt'),
    signUser: jest.fn().mockReturnValue('user.jwt'),
    verifyAdmin: jest.fn(),
    verifyUser: jest.fn(),
  } as any;
}

function makeRefreshTokenService(): jest.Mocked<RefreshTokenService> {
  return {
    create: jest.fn().mockResolvedValue('u:1:abcd'),
    validateAndRotate: jest.fn().mockResolvedValue('u:1:rotated'),
    revoke: jest.fn().mockResolvedValue(undefined),
    revokeAll: jest.fn().mockResolvedValue(undefined),
  } as any;
}

function makeTotpService(): jest.Mocked<TotpService> {
  return {
    generateSecret: jest.fn().mockReturnValue('SECRET'),
    generateQrCode: jest.fn().mockResolvedValue('data:image/png;base64,x'),
    verify: jest.fn().mockReturnValue(true),
    verifyWithReplayGuard: jest.fn().mockResolvedValue(true),
  } as any;
}

function makeMailer(): jest.Mocked<MailerService> {
  return {
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    sendAccountExistsEmail: jest.fn().mockResolvedValue(undefined),
    onModuleInit: jest.fn(),
  } as any;
}

function makeBackend(): jest.Mocked<ClientProxy> {
  return {
    emit: jest.fn().mockReturnValue(of(undefined)),
    send: jest.fn().mockReturnValue(of(undefined)),
    connect: jest.fn(),
    close: jest.fn(),
  } as any;
}

function baseUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: 'u@example.com',
    name: 'u',
    passwordHash: 'hashed',
    role: 'USER',
    scopes: ['read:profile'],
    twoFactorEnabled: false,
    twoFactorSecret: null,
    accessStatus: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('CustomerAuthService', () => {
  let svc: CustomerAuthService;
  let deps: ReturnType<typeof makeDb>;
  let pw: jest.Mocked<PasswordService>;
  let jwt: jest.Mocked<JwtService>;
  let refresh: jest.Mocked<RefreshTokenService>;
  let totp: jest.Mocked<TotpService>;
  let mailer: jest.Mocked<MailerService>;
  let backend: jest.Mocked<ClientProxy>;

  beforeEach(() => {
    deps = makeDb();
    pw = makePasswordService();
    jwt = makeJwtService();
    refresh = makeRefreshTokenService();
    totp = makeTotpService();
    mailer = makeMailer();
    backend = makeBackend();
    svc = new CustomerAuthService(deps.db, pw, jwt, refresh, totp, mailer, backend);
  });

  // -------- login -----------------------------------------------------------

  describe('login', () => {
    it('throws UnauthorizedException when user not found', async () => {
      deps.selectBuilder.__setTerminal('limit', []);
      await expect(svc.login({ email: 'nope@x.com', password: 'pw' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when user is soft-deleted', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseUser({ deletedAt: new Date() })]);
      await expect(svc.login({ email: 'u@example.com', password: 'pw' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException on password mismatch', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseUser()]);
      pw.compare.mockResolvedValue(false);
      await expect(svc.login({ email: 'u@example.com', password: 'pw' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws ForbiddenException when accessStatus !== ACTIVE', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseUser({ accessStatus: 'INACTIVE' })]);
      await expect(svc.login({ email: 'u@example.com', password: 'pw' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('returns { requires2fa: true } when 2FA enabled and no totpCode supplied', async () => {
      deps.selectBuilder.__setTerminal('limit', [
        baseUser({ twoFactorEnabled: true, twoFactorSecret: 'SEC' }),
      ]);
      await expect(svc.login({ email: 'u@example.com', password: 'pw' })).resolves.toEqual({
        requires2fa: true,
      });
    });

    it('throws UnauthorizedException when totpCode is invalid', async () => {
      deps.selectBuilder.__setTerminal('limit', [
        baseUser({ twoFactorEnabled: true, twoFactorSecret: 'SEC' }),
      ]);
      totp.verifyWithReplayGuard.mockResolvedValue(false);
      await expect(
        svc.login({ email: 'u@example.com', password: 'pw', totpCode: '000000' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('issues access+refresh tokens on success', async () => {
      const user = baseUser();
      deps.selectBuilder.__setTerminal('limit', [user]);
      const result = await svc.login({ email: user.email, password: 'pw' });
      expect(jwt.signUser).toHaveBeenCalledWith({
        sub: `u:${user.id}`,
        type: 'user',
        email: user.email,
        name: user.name,
        scopes: user.scopes,
      });
      expect(refresh.create).toHaveBeenCalledWith('u', user.id);
      expect(result).toMatchObject({
        user: { id: user.id, email: user.email, name: user.name, role: 'USER' },
        accessToken: 'user.jwt',
        refreshToken: 'u:1:abcd',
      });
    });

    it('defaults role to USER and scopes to [] when user row has nullish values', async () => {
      const user = baseUser({ role: null, scopes: null });
      deps.selectBuilder.__setTerminal('limit', [user]);
      const result = await svc.login({ email: user.email, password: 'pw' });
      expect(jwt.signUser).toHaveBeenCalledWith({
        sub: `u:${user.id}`,
        type: 'user',
        email: user.email,
        name: user.name,
        scopes: [],
      });
      expect((result as any).user.scopes).toEqual([]);
    });

    it('issues tokens after valid totpCode when 2FA enabled', async () => {
      const user = baseUser({ twoFactorEnabled: true, twoFactorSecret: 'SEC' });
      deps.selectBuilder.__setTerminal('limit', [user]);
      totp.verifyWithReplayGuard.mockResolvedValue(true);
      const result = await svc.login({
        email: user.email,
        password: 'pw',
        totpCode: '123456',
      });
      expect(totp.verifyWithReplayGuard).toHaveBeenCalledWith(
        user.id,
        '123456',
        'SEC',
        expect.objectContaining({ scope: 'u' }),
      );
      expect(result).toMatchObject({ accessToken: 'user.jwt' });
    });

    describe('sessions.recordLogin TCP hook (EPIC-02 §2.2.4)', () => {
      it('emits sessions.recordLogin with userId, userAgent, ip after successful login', async () => {
        const user = baseUser();
        deps.selectBuilder.__setTerminal('limit', [user]);
        await svc.login({
          email: user.email,
          password: 'pw',
          userAgent: 'Mozilla/5.0',
          ip: '203.0.113.7',
        } as any);
        expect(backend.emit).toHaveBeenCalledWith(
          { cmd: 'sessions.recordLogin' },
          expect.objectContaining({
            userId: user.id,
            userAgent: 'Mozilla/5.0',
            ip: '203.0.113.7',
            _sys: expect.any(String),
          }),
        );
      });

      it('still emits sessions.recordLogin when UA/IP are absent (nulls)', async () => {
        const user = baseUser();
        deps.selectBuilder.__setTerminal('limit', [user]);
        await svc.login({ email: user.email, password: 'pw' });
        expect(backend.emit).toHaveBeenCalledWith(
          { cmd: 'sessions.recordLogin' },
          expect.objectContaining({ userId: user.id, _sys: expect.any(String) }),
        );
      });

      it('does NOT emit sessions.recordLogin when login returns requires2fa', async () => {
        deps.selectBuilder.__setTerminal('limit', [
          baseUser({ twoFactorEnabled: true, twoFactorSecret: 'SEC' }),
        ]);
        await svc.login({ email: 'u@example.com', password: 'pw' });
        const recordLoginEmits = backend.emit.mock.calls.filter(
          (c) => (c[0] as any)?.cmd === 'sessions.recordLogin',
        );
        expect(recordLoginEmits).toHaveLength(0);
      });

      it('login still resolves when sessions.recordLogin emit observable errors', async () => {
        const user = baseUser();
        deps.selectBuilder.__setTerminal('limit', [user]);
        backend.emit.mockImplementation((pattern: any) => {
          if (pattern?.cmd === 'sessions.recordLogin') {
            return throwError(() => new Error('tcp down')) as any;
          }
          return of(undefined) as any;
        });
        await expect(
          svc.login({ email: user.email, password: 'pw' }),
        ).resolves.toMatchObject({ accessToken: 'user.jwt' });
      });

      it('login still resolves when backend.emit throws synchronously', async () => {
        const user = baseUser();
        deps.selectBuilder.__setTerminal('limit', [user]);
        backend.emit.mockImplementation((pattern: any) => {
          if (pattern?.cmd === 'sessions.recordLogin') {
            throw new Error('client exploded');
          }
          return of(undefined) as any;
        });
        await expect(
          svc.login({ email: user.email, password: 'pw' }),
        ).resolves.toMatchObject({ accessToken: 'user.jwt' });
      });
    });
  });

  // -------- register (OWASP V3.1.1 enumeration-safe) -----------------------
  //
  // The service-level SELECT is used twice per call (email first, username
  // second). Here we drive both lookups through a single fluent builder: each
  // test queues the ordered `limit` results it expects the two .limit() calls
  // to resolve to. The double builder is a jest.fn that returns a fresh
  // thenable whose `limit()` pops the next queued value.

  describe('register (OWASP V3.1.1 enumeration-safe)', () => {
    function queueSelects(rows: unknown[][]) {
      // Each call to db.select() returns a new builder; .limit() resolves to
      // the next row-array in `rows`. Order: [0]=email lookup, [1]=username.
      const queue = [...rows];
      (deps.select as jest.Mock).mockImplementation(() => {
        const b = builder([]);
        b.__setTerminal('limit', queue.shift() ?? []);
        return b;
      });
    }

    it('case A: new email + new username → inserts user with emailVerified=false, sends verification email, returns { ok: true }', async () => {
      queueSelects([[], []]); // email miss, username miss
      const inserted = baseUser({ id: 9, email: 'new@x.com', name: 'new' });
      // The insert happens inside db.transaction(cb) — cb receives `tx`, so
      // the returning() resolution lives on txInsertBuilder.
      (deps as any).tx.insert.mockImplementation(() => {
        const b = builder([]);
        b.__setTerminal('returning', [inserted]);
        return b;
      });

      const res = await svc.register({
        email: 'new@x.com',
        username: 'new',
        password: 'Sup3rSecret',
      });

      expect(res).toEqual({ ok: true });
      expect(pw.hash).toHaveBeenCalledWith('Sup3rSecret');
      expect(deps.transaction).toHaveBeenCalledTimes(1);
      const valuesArg = deps.tx.insert.mock.results[0].value.values.mock.calls[0][0];
      expect(valuesArg.email).toBe('new@x.com');
      expect(valuesArg.name).toBe('new');
      expect(valuesArg.emailVerified).toBe(false);
      expect(valuesArg.verifyTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(valuesArg.verifyTokenExpiresAt.getTime()).toBeGreaterThan(
        Date.now() + 23 * 60 * 60 * 1000,
      );

      expect(mailer.sendVerificationEmail).toHaveBeenCalledTimes(1);
      const [to, token] = mailer.sendVerificationEmail.mock.calls[0];
      expect(to).toBe('new@x.com');
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      // Hash stored == sha256(plaintext emailed token).
      const { createHash } = await import('crypto');
      expect(createHash('sha256').update(token).digest('hex')).toBe(valuesArg.verifyTokenHash);

      expect(mailer.sendAccountExistsEmail).not.toHaveBeenCalled();
      // No session / refresh on the registration path — user must verify first.
      expect(refresh.create).not.toHaveBeenCalled();
      expect(jwt.signUser).not.toHaveBeenCalled();
    });

    it('case B: existing email → sends account-exists email with real reset token, no user created, returns { ok: true }', async () => {
      const existing = baseUser({ id: 4, email: 'dup@x.com' });
      queueSelects([[existing]]); // email hit — no 2nd select needed

      const res = await svc.register({
        email: 'dup@x.com',
        username: 'whatever',
        password: 'Sup3rSecret',
      });

      expect(res).toEqual({ ok: true });

      // Reset token was generated + stored (hashed) in password_resets.
      expect(deps.insert).toHaveBeenCalled();
      const valuesArg = deps.insertBuilder.values.mock.calls[0][0];
      expect(valuesArg.userId).toBe(4);
      expect(valuesArg.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(deps.insertBuilder.onConflictDoNothing).toHaveBeenCalled();

      // Account-exists email sent — NOT the verification email.
      expect(mailer.sendAccountExistsEmail).toHaveBeenCalledTimes(1);
      const [to, token] = mailer.sendAccountExistsEmail.mock.calls[0];
      expect(to).toBe('dup@x.com');
      // Stored hash must match sha256(plaintext) from the email link.
      const { createHash } = await import('crypto');
      expect(createHash('sha256').update(token).digest('hex')).toBe(valuesArg.tokenHash);

      expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
      expect(pw.hash).not.toHaveBeenCalled();
      expect(deps.transaction).not.toHaveBeenCalled();
    });

    it('case C: username collides but email is new → silent no-op, no emails, warn-logs, returns { ok: true }', async () => {
      queueSelects([[], [baseUser({ id: 7, name: 'taken' })]]);
      const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);

      const res = await svc.register({
        email: 'brand-new@x.com',
        username: 'taken',
        password: 'Sup3rSecret',
      });

      expect(res).toEqual({ ok: true });
      expect(pw.hash).not.toHaveBeenCalled();
      expect(deps.transaction).not.toHaveBeenCalled();
      expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
      expect(mailer.sendAccountExistsEmail).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('treats a soft-deleted email-match as free (falls through to username check)', async () => {
      const soft = baseUser({ id: 3, email: 'recycled@x.com', deletedAt: new Date() });
      queueSelects([[soft], []]);
      (deps as any).tx.insert.mockImplementation(() => {
        const b = builder([]);
        b.__setTerminal('returning', [baseUser({ id: 10 })]);
        return b;
      });

      const res = await svc.register({
        email: 'recycled@x.com',
        username: 'fresh',
        password: 'Sup3rSecret',
      });

      expect(res).toEqual({ ok: true });
      expect(mailer.sendAccountExistsEmail).not.toHaveBeenCalled();
      expect(mailer.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it('silently absorbs postgres unique-violation during insert (race loser is indistinguishable)', async () => {
      queueSelects([[], []]);
      const err: any = new Error('duplicate key');
      err.code = '23505';
      // Transaction callback raises — the service's catch turns that into ok.
      deps.transaction.mockImplementation(async () => {
        throw err;
      });

      const res = await svc.register({
        email: 'race@x.com',
        username: 'race',
        password: 'Sup3rSecret',
      });
      expect(res).toEqual({ ok: true });
      expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('rethrows unknown DB errors during insert (fail loud on non-race failures)', async () => {
      queueSelects([[], []]);
      const err = new Error('boom');
      deps.transaction.mockImplementation(async () => {
        throw err;
      });
      await expect(
        svc.register({ email: 'a@x.com', username: 'a', password: 'Sup3rSecret' }),
      ).rejects.toBe(err);
    });
  });

  // -------- verifyEmail ----------------------------------------------------

  describe('verifyEmail', () => {
    it('throws NOT_FOUND when no unexpired user row matches the hashed token', async () => {
      deps.selectBuilder.__setTerminal('limit', []);
      const promise = svc.verifyEmail('no-such-token');
      await expect(promise).rejects.toBeInstanceOf(HttpException);
      await promise.catch((e: HttpException) => {
        expect(e.getStatus()).toBe(HttpStatus.NOT_FOUND);
      });
    });

    it('marks verified, clears token columns, and issues fresh session tokens', async () => {
      const user = baseUser({
        id: 11,
        emailVerified: false,
        verifyTokenHash: 'x'.repeat(64),
        verifyTokenExpiresAt: new Date(Date.now() + 60_000),
      });
      deps.selectBuilder.__setTerminal('limit', [user]);

      const res = await svc.verifyEmail('raw-token-value');

      expect(deps.updateBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({
          emailVerified: true,
          verifyTokenHash: null,
          verifyTokenExpiresAt: null,
        }),
      );
      expect(jwt.signUser).toHaveBeenCalled();
      expect(refresh.create).toHaveBeenCalledWith('u', 11);
      expect(res).toMatchObject({
        user: { id: 11, email: user.email },
        accessToken: 'user.jwt',
        refreshToken: 'u:1:abcd',
      });
    });

    it('treats a soft-deleted match as NOT_FOUND', async () => {
      const user = baseUser({
        id: 2,
        deletedAt: new Date(),
        verifyTokenHash: 'x'.repeat(64),
        verifyTokenExpiresAt: new Date(Date.now() + 60_000),
      });
      deps.selectBuilder.__setTerminal('limit', [user]);
      await expect(svc.verifyEmail('t')).rejects.toBeInstanceOf(HttpException);
    });
  });

  // -------- passwordResetRequest -------------------------------------------

  describe('passwordResetRequest', () => {
    it('returns void silently when user does not exist (enumeration-safe)', async () => {
      deps.selectBuilder.__setTerminal('limit', []);
      await expect(svc.passwordResetRequest({ email: 'nope@x.com' })).resolves.toBeUndefined();
      expect(deps.insert).not.toHaveBeenCalled();
      expect(mailer.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('returns void silently when user is soft-deleted', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseUser({ deletedAt: new Date() })]);
      await expect(svc.passwordResetRequest({ email: 'u@example.com' })).resolves.toBeUndefined();
      expect(deps.insert).not.toHaveBeenCalled();
      expect(mailer.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('INSERTs a SHA-256 hashed reset token and emails a one-hour link', async () => {
      const user = baseUser({ id: 42, email: 'u@example.com' });
      deps.selectBuilder.__setTerminal('limit', [user]);

      await svc.passwordResetRequest({ email: user.email });

      // values(...) must be called with a 64-char hex token hash and a future expiry.
      const valuesArg = deps.insertBuilder.values.mock.calls[0][0];
      expect(valuesArg.userId).toBe(42);
      expect(valuesArg.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      const ttl = valuesArg.expiresAt.getTime() - Date.now();
      // ~1h, allow jitter.
      expect(ttl).toBeGreaterThan(59 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
      expect(deps.insertBuilder.onConflictDoNothing).toHaveBeenCalled();

      // The emailed link must contain the *plaintext* token, not the hash.
      const [emailTo, resetLink] = mailer.sendPasswordResetEmail.mock.calls[0];
      expect(emailTo).toBe(user.email);
      expect(resetLink).toMatch(/^http:\/\/localhost:3007\/reset-password\?token=[0-9a-f]{64}$/);
      const plain = resetLink.split('token=')[1];
      const { createHash } = await import('crypto');
      expect(createHash('sha256').update(plain).digest('hex')).toBe(valuesArg.tokenHash);
    });
  });

  // -------- passwordResetConfirm -------------------------------------------

  describe('passwordResetConfirm', () => {
    it('throws 400 when no matching (unused, unexpired) token row exists', async () => {
      deps.selectBuilder.__setTerminal('limit', []);
      const promise = svc.passwordResetConfirm({
        token: 'x'.repeat(64),
        newPassword: 'Sup3rSecret',
      });
      await expect(promise).rejects.toBeInstanceOf(HttpException);
      await promise.catch((e: HttpException) => {
        expect(e.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      });
    });

    it('updates used_at + re-hashes password + revokes all refresh tokens on success', async () => {
      const row = {
        tokenHash: 'hash',
        userId: 9,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      };
      deps.selectBuilder.__setTerminal('limit', [row]);

      await svc.passwordResetConfirm({
        token: 'raw-token-value',
        newPassword: 'NewPass123',
      });

      expect(pw.hash).toHaveBeenCalledWith('NewPass123');
      expect(deps.transaction).toHaveBeenCalledTimes(1);
      // tx.update was invoked twice: once to mark reset used, once to update user hash.
      expect(deps.tx.update).toHaveBeenCalledTimes(2);
      expect(refresh.revokeAll).toHaveBeenCalledWith('u', 9);
    });
  });

  // -------- passwordChange -------------------------------------------------

  describe('passwordChange', () => {
    it('throws NotFoundException when user does not exist', async () => {
      deps.selectBuilder.__setTerminal('limit', []);
      await expect(
        svc.passwordChange({ userId: 1, currentPassword: 'old', newPassword: 'NewPass123' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when user is soft-deleted', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseUser({ deletedAt: new Date() })]);
      await expect(
        svc.passwordChange({ userId: 1, currentPassword: 'old', newPassword: 'NewPass123' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 401 HttpException when current password is wrong', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseUser()]);
      pw.compare.mockResolvedValue(false);
      const promise = svc.passwordChange({
        userId: 1,
        currentPassword: 'wrong',
        newPassword: 'NewPass123',
      });
      await expect(promise).rejects.toBeInstanceOf(HttpException);
      await promise.catch((e: HttpException) => {
        expect(e.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      });
      expect(refresh.revokeAll).not.toHaveBeenCalled();
    });

    it('re-hashes the password, revokes all refresh tokens, and issues a fresh session on success', async () => {
      const user = baseUser({ id: 7 });
      deps.selectBuilder.__setTerminal('limit', [user]);
      const result = await svc.passwordChange({
        userId: 7,
        currentPassword: 'old',
        newPassword: 'NewPass123',
      });
      expect(pw.hash).toHaveBeenCalledWith('NewPass123');
      expect(deps.updateBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({ passwordHash: 'hashed-password' }),
      );
      expect(refresh.revokeAll).toHaveBeenCalledWith('u', 7);
      // Fresh tokens must be minted so the BFF can rotate both cookies.
      expect(jwt.signUser).toHaveBeenCalledWith({
        sub: `u:${user.id}`,
        type: 'user',
        email: user.email,
        name: user.name,
        scopes: user.scopes,
      });
      expect(refresh.create).toHaveBeenCalledWith('u', 7);
      expect(result).toMatchObject({
        user: { id: 7, email: user.email, name: user.name, role: 'USER' },
        accessToken: 'user.jwt',
        refreshToken: 'u:1:abcd',
      });
    });

    it('revokes existing tokens BEFORE minting the replacement so the new token starts a fresh family', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseUser({ id: 11 })]);

      const callOrder: string[] = [];
      refresh.revokeAll.mockImplementation(async () => {
        callOrder.push('revokeAll');
      });
      refresh.create.mockImplementation(async () => {
        callOrder.push('create');
        return 'u:11:fresh';
      });

      const result = await svc.passwordChange({
        userId: 11,
        currentPassword: 'old',
        newPassword: 'NewPass123',
      });

      // Order matters: revokeAll flips the old family to revoked; only after
      // that do we call create() which allocates a brand-new familyId. If
      // these were reversed the new token could inherit a revoked lineage.
      expect(callOrder).toEqual(['revokeAll', 'create']);
      expect(result.refreshToken).toBe('u:11:fresh');
    });
  });

  // -------- deleteAccount --------------------------------------------------

  describe('deleteAccount', () => {
    it('throws NotFoundException when user does not exist', async () => {
      deps.selectBuilder.__setTerminal('limit', []);
      await expect(svc.deleteAccount({ userId: 1 })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is idempotent for already-soft-deleted users (no update, no revoke, no emit)', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseUser({ deletedAt: new Date() })]);
      await svc.deleteAccount({ userId: 1 });
      expect(deps.update).not.toHaveBeenCalled();
      expect(refresh.revokeAll).not.toHaveBeenCalled();
      expect(backend.emit).not.toHaveBeenCalled();
    });

    it('soft-deletes (sets deleted_at, scrubs email, marks INACTIVE), revokes refresh, emits cascade', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseUser({ id: 5 })]);
      await svc.deleteAccount({ userId: 5 });

      expect(deps.update).toHaveBeenCalled();
      const setArg = deps.updateBuilder.set.mock.calls[0][0];
      expect(setArg.accessStatus).toBe('INACTIVE');
      expect(setArg.deletedAt).toBeInstanceOf(Date);
      // Email scrub is a SQL fragment that concatenates ':deleted:{id}'.
      expect(setArg.email).toBeDefined();

      expect(refresh.revokeAll).toHaveBeenCalledWith('u', 5);
      expect(backend.emit).toHaveBeenCalledWith(
        { cmd: 'users.cascade.enqueue' },
        expect.objectContaining({ userId: 5, _sys: expect.any(String) }),
      );
    });

    it('logs and continues when cascade enqueue observable errors', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseUser({ id: 5 })]);
      backend.emit.mockReturnValue(throwError(() => new Error('tcp down')));
      // Should not reject — cascade is best-effort.
      await expect(svc.deleteAccount({ userId: 5 })).resolves.toBeUndefined();
    });

    it('logs and continues when backend.emit throws synchronously', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseUser({ id: 5 })]);
      backend.emit.mockImplementation(() => {
        throw new Error('client exploded');
      });
      await expect(svc.deleteAccount({ userId: 5 })).resolves.toBeUndefined();
    });
  });

  // -------- refresh --------------------------------------------------------

  describe('refresh', () => {
    it('throws UnauthorizedException on malformed (too few parts) token', async () => {
      await expect(svc.refresh('u:1')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when token prefix is not "u"', async () => {
      await expect(svc.refresh('a:1:abcd')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when user missing / inactive / soft-deleted', async () => {
      deps.selectBuilder.__setTerminal('limit', []);
      await expect(svc.refresh('u:1:abcd')).rejects.toBeInstanceOf(UnauthorizedException);

      deps.selectBuilder.__setTerminal('limit', [baseUser({ accessStatus: 'INACTIVE' })]);
      await expect(svc.refresh('u:1:abcd')).rejects.toBeInstanceOf(UnauthorizedException);

      deps.selectBuilder.__setTerminal('limit', [baseUser({ deletedAt: new Date() })]);
      await expect(svc.refresh('u:1:abcd')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rotates the refresh token and issues a fresh access token', async () => {
      const user = baseUser({ id: 3 });
      deps.selectBuilder.__setTerminal('limit', [user]);
      refresh.validateAndRotate.mockResolvedValue('u:3:rotated');

      const result = await svc.refresh('u:3:abcd');
      expect(refresh.validateAndRotate).toHaveBeenCalledWith('u', 3, 'u:3:abcd');
      expect(result).toMatchObject({
        accessToken: 'user.jwt',
        refreshToken: 'u:3:rotated',
        user: { id: 3, email: user.email },
      });
    });

    it('defaults role to USER and scopes to [] when the user row has nullish values', async () => {
      const user = baseUser({ id: 4, role: null, scopes: null });
      deps.selectBuilder.__setTerminal('limit', [user]);
      refresh.validateAndRotate.mockResolvedValue('u:4:rotated');

      const result = await svc.refresh('u:4:abcd');
      expect(jwt.signUser).toHaveBeenCalledWith({
        sub: 'u:4',
        type: 'user',
        email: user.email,
        name: user.name,
        scopes: [],
      });
      expect(result.user.scopes).toEqual([]);
    });
  });

  // -------- logout ---------------------------------------------------------

  describe('logout', () => {
    it('silently no-ops on malformed token', async () => {
      await expect(svc.logout('bad')).resolves.toBeUndefined();
      expect(refresh.revoke).not.toHaveBeenCalled();
    });

    it('silently no-ops on admin-shaped token (prefix "a")', async () => {
      await expect(svc.logout('a:1:abcd')).resolves.toBeUndefined();
      expect(refresh.revoke).not.toHaveBeenCalled();
    });

    it('revokes the matching refresh token for a valid customer token', async () => {
      await svc.logout('u:5:abcdef');
      expect(refresh.revoke).toHaveBeenCalledWith('u', 5, 'u:5:abcdef');
    });
  });

  // -------- validateToken --------------------------------------------------

  describe('validateToken', () => {
    it('projects OIDC claims + legacy userId for back-compat readers', async () => {
      jwt.verifyUser.mockReturnValue({
        sub: 'u:9',
        type: 'user',
        email: 'u@example.com',
        name: 'Nine',
        scopes: ['s1'],
      } as never);
      await expect(svc.validateToken('tok')).resolves.toEqual({
        sub: 'u:9',
        type: 'user',
        userId: 9,
        email: 'u@example.com',
        name: 'Nine',
        scopes: ['s1'],
      });
    });

    it('defaults scopes to [] when JWT payload omits them', async () => {
      jwt.verifyUser.mockReturnValue({
        sub: 'u:9',
        type: 'user',
        email: 'u@example.com',
      } as any);
      await expect(svc.validateToken('tok')).resolves.toMatchObject({ scopes: [], sub: 'u:9' });
    });

    it('throws UnauthorizedException on verify failure', async () => {
      jwt.verifyUser.mockImplementation(() => {
        throw new Error('bad sig');
      });
      await expect(svc.validateToken('tok')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
