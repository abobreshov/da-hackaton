import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { createHash, randomBytes } from 'crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { ErrorCode, TcpCmd, WireError, makeSub, parseSub } from '@app/contracts';
import { DATABASE } from '../../../database/database.module';
import { Db } from '../../../database/connection';
import { passwordResets, users } from '../../../database/schema';
import { PasswordService } from '../shared/password.service';
import { JwtService } from '../shared/jwt.service';
import { RefreshTokenService } from '../shared/refresh-token.service';
import { TotpService } from '../shared/totp.service';
import { BACKEND_SERVICE } from '../shared/backend-client.module';
import { MailerService } from '../../mail/mail.service';
import { env } from '../../../config/environment';
import { withSys } from '../../../common/rpc-transport';
import { CustomerLoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { PasswordChangeDto } from './dto/password-change.dto';

/** Shape thrown to HTTP / mapped by RpcExceptionFilter for TCP. */
function wire(status: HttpStatus, code: ErrorCode, message: string): HttpException {
  const body: WireError = { code, message };
  return new HttpException(body, status);
}

@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger(CustomerAuthService.name);
  private readonly RESET_TTL_MS = 60 * 60 * 1000; // 1h
  private readonly VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly totpService: TotpService,
    private readonly mailer: MailerService,
    @Inject(BACKEND_SERVICE) private readonly backend: ClientProxy,
  ) {}

  async login(dto: CustomerLoginDto) {
    const [user] = await this.db.select().from(users).where(eq(users.email, dto.email)).limit(1);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.deletedAt) throw new UnauthorizedException('Invalid credentials');

    const valid = await this.passwordService.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (user.accessStatus !== 'ACTIVE') throw new ForbiddenException('Account inactive');

    if (user.twoFactorEnabled) {
      if (!dto.totpCode) {
        return { requires2fa: true as const };
      }
      const ok = await this.totpService.verifyWithReplayGuard(
        user.id,
        dto.totpCode,
        user.twoFactorSecret!,
        { scope: 'u' },
      );
      if (!ok) {
        throw new UnauthorizedException('Invalid TOTP code');
      }
    }

    // EPIC-02 §2.2.4 — persist a row on the active-sessions surface and bind
    // its id into the access token's `sid` claim so revoke takes effect on the
    // next BFF round-trip (M5 review). Synchronous (`send` + first-value) so
    // we get the id back, but best-effort: if backend is offline / TCP errors
    // we log and still mint tokens without sid (back-compat path through
    // `validateToken`, which only enforces revoke when sid is present).
    const sessionId = await this.recordLoginBestEffort({
      userId: user.id,
      userAgent: dto.userAgent ?? null,
      ip: dto.ip ?? null,
    });
    return this.issueTokens(user, sessionId);
  }

  private async recordLoginBestEffort(payload: {
    userId: number;
    userAgent: string | null;
    ip: string | null;
  }): Promise<string | undefined> {
    try {
      const row$ = this.backend.send<{ id: string }>(
        { cmd: TcpCmd.sessions.recordLogin },
        withSys(payload),
      );
      const row = await firstValueFrom(row$.pipe(timeout(2000)));
      return row?.id;
    } catch (err) {
      this.logger.warn(`sessions.recordLogin send failed: ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * OWASP V3.1.1 — register must not leak whether an email or username is
   * already in use. Returns `{ ok: true }` in every branch; side-effects are:
   *
   *   A. new email + new username → insert user (emailVerified=false) and
   *      email the verification link.
   *   B. email already in use → no insert; email a "someone tried to sign up"
   *      notice with a real password-reset link.
   *   C. username collides but email is new → silently do nothing (no insert,
   *      no email). Logged at warn for analyst debugging. Same 202 response.
   */
  async register(dto: RegisterDto): Promise<{ ok: true }> {
    const [existingByEmail] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1);

    // Case B — email already in use. Do not reveal; send an account-exists
    // email carrying a real password-reset token.
    if (existingByEmail && !existingByEmail.deletedAt) {
      const resetToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(resetToken).digest('hex');
      const expiresAt = new Date(Date.now() + this.RESET_TTL_MS);
      await this.db
        .insert(passwordResets)
        .values({ tokenHash, userId: existingByEmail.id, expiresAt })
        .onConflictDoNothing();
      await this.mailer.sendAccountExistsEmail(existingByEmail.email, resetToken);
      return { ok: true };
    }

    // Case C — username collision but email is fresh. Silent no-op.
    // Indistinguishable client response; warn-log for internal debugging.
    const [existingByName] = await this.db
      .select()
      .from(users)
      .where(eq(users.name, dto.username))
      .limit(1);
    if (existingByName && !existingByName.deletedAt) {
      this.logger.warn(`register username collision — email=${dto.email} username=${dto.username}`);
      return { ok: true };
    }

    // Case A — wholly new. Insert + verification email inside one logical
    // unit: on postgres-level unique-violation (race with concurrent
    // registrations for the same email/username) fall through silently with
    // the same {ok:true} shape. No partial user rows left behind.
    const passwordHash = await this.passwordService.hash(dto.password);
    const verifyToken = randomBytes(32).toString('hex');
    const verifyTokenHash = createHash('sha256').update(verifyToken).digest('hex');
    const verifyTokenExpiresAt = new Date(Date.now() + this.VERIFY_TTL_MS);
    const defaultScopes = ['read:profile', 'write:profile', 'read:dashboard'];

    try {
      await this.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(users)
          .values({
            email: dto.email,
            name: dto.username,
            passwordHash,
            role: 'USER',
            scopes: defaultScopes,
            emailVerified: false,
            verifyTokenHash,
            verifyTokenExpiresAt,
          })
          .returning();
        if (!inserted) {
          throw wire(HttpStatus.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL, 'register failed');
        }
      });
      await this.mailer.sendVerificationEmail(dto.email, verifyToken);
      return { ok: true };
    } catch (err) {
      // Race-loser on unique violation — treat as silent collision (indistinguishable).
      if ((err as { code?: string })?.code === '23505') {
        this.logger.warn(`register race collision — email=${dto.email} username=${dto.username}`);
        return { ok: true };
      }
      throw err;
    }
  }

  /**
   * Consume a verification token: mark the user verified, clear the token
   * columns, and mint a fresh session. Fails with NOT_FOUND on unknown or
   * expired tokens — same response either way so attackers can't probe
   * whether a given token value existed.
   */
  async verifyEmail(token: string) {
    const now = new Date();
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.verifyTokenHash, tokenHash), gt(users.verifyTokenExpiresAt, now)))
      .limit(1);

    if (!user || user.deletedAt) {
      throw wire(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Verification token invalid or expired',
      );
    }

    await this.db
      .update(users)
      .set({
        emailVerified: true,
        verifyTokenHash: null,
        verifyTokenExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));

    return this.issueTokens({ ...user, emailVerified: true });
  }

  async passwordResetRequest(dto: PasswordResetRequestDto): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.email, dto.email)).limit(1);
    // Silent when no user / soft-deleted: prevent enumeration. Always return void.
    if (!user || user.deletedAt) return;

    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + this.RESET_TTL_MS);

    await this.db
      .insert(passwordResets)
      .values({ tokenHash, userId: user.id, expiresAt })
      .onConflictDoNothing();

    const resetLink = `${env.FRONTEND_BASE_URL.replace(/\/$/, '')}/reset-password?token=${token}`;
    await this.mailer.sendPasswordResetEmail(user.email, resetLink);
  }

  async passwordResetConfirm(dto: PasswordResetConfirmDto): Promise<void> {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const now = new Date();

    const [row] = await this.db
      .select()
      .from(passwordResets)
      .where(
        and(
          eq(passwordResets.tokenHash, tokenHash),
          isNull(passwordResets.usedAt),
          gt(passwordResets.expiresAt, now),
        ),
      )
      .limit(1);

    if (!row) {
      throw wire(HttpStatus.BAD_REQUEST, ErrorCode.CONFLICT, 'invalid or expired reset token');
    }

    const newHash = await this.passwordService.hash(dto.newPassword);

    await this.db.transaction(async (tx) => {
      await tx
        .update(passwordResets)
        .set({ usedAt: now })
        .where(eq(passwordResets.tokenHash, tokenHash));
      await tx
        .update(users)
        .set({ passwordHash: newHash, updatedAt: now })
        .where(eq(users.id, row.userId));
    });

    // Revoke all outstanding refresh tokens for this user.
    await this.refreshTokenService.revokeAll('u', row.userId);
  }

  async passwordChange(dto: PasswordChangeDto & { userId: number }) {
    const [user] = await this.db.select().from(users).where(eq(users.id, dto.userId)).limit(1);
    if (!user || user.deletedAt) throw new NotFoundException('user not found');

    const valid = await this.passwordService.compare(dto.currentPassword, user.passwordHash);
    if (!valid) {
      throw wire(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED, 'current password incorrect');
    }

    const newHash = await this.passwordService.hash(dto.newPassword);
    await this.db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, dto.userId));

    // Kill every existing refresh token (revokes the old family wholesale),
    // then mint a fresh one — `refreshTokenService.create()` generates a new
    // `familyId`, so the replacement session is not inheriting a revoked
    // lineage. The BFF will then rewrite both the session + refresh cookies
    // (session JWT `iat` re-minted here → downstream consumers that check
    // against password-change timestamps won't serve a stale token).
    await this.refreshTokenService.revokeAll('u', dto.userId);

    return this.issueTokens(user);
  }

  async deleteAccount({ userId }: { userId: number }): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundException('user not found');
    if (user.deletedAt) return; // idempotent

    const now = new Date();
    await this.db
      .update(users)
      .set({
        deletedAt: now,
        accessStatus: 'INACTIVE',
        // scrub email/name so the unique index frees up the old values.
        email: sql`${users.email} || ':deleted:' || ${users.id}`,
        updatedAt: now,
      })
      .where(eq(users.id, userId));

    await this.refreshTokenService.revokeAll('u', userId);

    // Best-effort cascade enqueue. Backend may not expose this handler yet (or may be
    // offline in dev) — log and continue. Cascade is eventually consistent.
    try {
      this.backend.emit<unknown>({ cmd: 'users.cascade.enqueue' }, withSys({ userId })).subscribe({
        error: (err) => this.logger.warn(`cascade enqueue failed: ${(err as Error).message}`),
      });
    } catch (err) {
      this.logger.warn(`cascade enqueue threw: ${(err as Error).message}`);
    }
  }

  async refresh(token: string) {
    const parts = token.split(':');
    if (parts.length < 3 || parts[0] !== 'u')
      throw new UnauthorizedException('Invalid refresh token');
    const userId = parseInt(parts[1], 10);

    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.accessStatus !== 'ACTIVE' || user.deletedAt)
      throw new UnauthorizedException();

    // Rotation preserves the `sid` claim across refreshes (M5 review): the
    // refresh-token store binds `sid` to the family at login, hands it back
    // here, and we re-stamp it onto both the new access JWT and the new
    // refresh token so a single `sessions.revoke` still kills the line.
    const { token: newRefreshToken, sid } = await this.refreshTokenService.validateAndRotate(
      'u',
      userId,
      token,
    );
    const accessToken = this.jwtService.signUser({
      sub: makeSub('user', user.id),
      type: 'user',
      email: user.email,
      name: user.name,
      scopes: user.scopes ?? [],
      ...(sid ? { sid } : {}),
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        scopes: user.scopes ?? [],
      },
      accessToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(token: string) {
    const parts = token.split(':');
    if (parts.length >= 3 && parts[0] === 'u') {
      const userId = parseInt(parts[1], 10);
      await this.refreshTokenService.revoke('u', userId, token);
    }
  }

  /**
   * OIDC-shaped introspection. Returns the OAuth-style subject (`u:<id>`),
   * account type, email, optional name, and scopes. Legacy `userId` is also
   * returned (derived from `sub`) so back-compat readers in backend
   * controllers keep working until they migrate to `sub` + `parseSub`.
   */
  async validateToken(token: string) {
    let claims;
    try {
      claims = this.jwtService.verifyUser(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    // M5 review fix — when the access token carries a `sid` claim, ask backend
    // whether the underlying user_sessions row is revoked. If so, reject the
    // cookie path immediately instead of waiting for the JWT to expire (15m).
    // Tokens minted before this field shipped have no `sid` → behaviour
    // unchanged (back-compat). Backend transport failure is fail-OPEN: the JWT
    // already verified, and we'd rather serve a slightly-stale auth than 401
    // every request when the tracker hiccups. Logged at warn for visibility.
    if (claims.sid) {
      try {
        const probe$ = this.backend.send<{ revoked: boolean }>(
          { cmd: TcpCmd.sessions.isRevoked },
          withSys({ sessionId: claims.sid }),
        );
        const { revoked } = await firstValueFrom(probe$.pipe(timeout(2000)));
        if (revoked) throw new UnauthorizedException('Session revoked');
      } catch (err) {
        if (err instanceof UnauthorizedException) throw err;
        this.logger.warn(`sessions.isRevoked probe failed: ${(err as Error).message}`);
      }

      // sys-arch MED 5 — bump `last_seen_at` so the active-sessions UI
      // surfaces a real heartbeat instead of the row's creation timestamp.
      // Fire-and-forget: never block the auth probe on a tracker hiccup.
      // Already-revoked sessions return early above, so this only fires for
      // live ones (the touch repo is also a no-op on revoked rows as a
      // belt-and-braces guard).
      try {
        const touch$ = this.backend.send<{ touched: boolean }>(
          { cmd: TcpCmd.sessions.touch },
          withSys({ sessionId: claims.sid }),
        );
        touch$.subscribe({
          error: (err) =>
            this.logger.warn(`sessions.touch fire-and-forget failed: ${(err as Error).message}`),
        });
      } catch (err) {
        this.logger.warn(`sessions.touch send threw: ${(err as Error).message}`);
      }
    }

    const { numericId } = parseSub(claims.sub);
    return {
      sub: claims.sub,
      type: claims.type,
      userId: numericId, // deprecated — use parseSub(sub).numericId
      email: claims.email,
      name: claims.name,
      scopes: claims.scopes ?? [],
      ...(claims.sid ? { sid: claims.sid } : {}),
    };
  }

  // ---- helpers ----

  private async issueTokens(user: typeof users.$inferSelect, sid?: string) {
    const accessToken = this.jwtService.signUser({
      sub: makeSub('user', user.id),
      type: 'user',
      email: user.email,
      name: user.name,
      scopes: user.scopes ?? [],
      ...(sid ? { sid } : {}),
    });
    // Bind sid to the refresh family so subsequent rotations re-stamp the
    // same sid on the new access token (M5 review — refresh-rotation must
    // not drop the active-sessions revoke link).
    const refreshToken = await this.refreshTokenService.create('u', user.id, sid ? { sid } : {});

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        scopes: user.scopes ?? [],
      },
      accessToken,
      refreshToken,
    };
  }
}
