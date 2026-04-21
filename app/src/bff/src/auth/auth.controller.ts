import { Controller, Post, Get, Delete, Body, Req, Res, HttpCode, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';
import { makeSub, parseSub, type SessionPayload } from './cookie.service';
import { SessionGuard } from './session.guard';
import { ThrottleGuard } from '../common/guards/throttle.guard';
import { Throttle } from '../common/decorators/throttle.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { PasswordChangeDto } from './dto/password-change.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookieService: CookieService,
  ) {}

  @Post('login')
  @UseGuards(ThrottleGuard)
  @Throttle({
    scope: 'login',
    limit: 5,
    windowMs: 900_000,
    failClosed: true,
    // Rate-limit per target email, not per IP — stops credential stuffing
    // even when attackers rotate IPs. Falls back to IP if body is malformed.
    keyFn: (req: any) =>
      req?.body?.email
        ? `email:${req.body.email}`
        : `ip:${req?.ip ?? req?.socket?.remoteAddress ?? 'unknown'}`,
  })
  async login(@Body() dto: LoginDto, @Req() req: any, @Res({ passthrough: true }) reply: any) {
    const isAdmin = dto.type === 'admin';
    // M5 MED #4/#5 — userAgent + ip MUST come from the request, never the
    // body. Persisting body-controlled strings into user_sessions enables
    // stored XSS via the active-sessions UI and IP spoofing for authz
    // heuristics. Cap lengths to avoid log/DB bloat from a hostile client.
    const { userAgent, ip } = extractClientFingerprint(req);

    if (isAdmin) {
      const result = await this.authService.loginAdmin(
        dto.email,
        dto.password,
        dto.totpCode,
        userAgent,
        ip,
      );
      if (result?.requires2fa) return { requires2fa: true };
      const { admin, refreshToken } = result;
      this.cookieService.issueAuthCookies(reply, {
        session: {
          sub: makeSub('admin', admin.id),
          email: admin.email,
          name: admin.name,
          type: 'admin',
          scopes: [],
        },
        refreshToken,
      });
      return { admin };
    } else {
      const result = await this.authService.loginUser(
        dto.email,
        dto.password,
        dto.totpCode,
        userAgent,
        ip,
      );
      if (result?.requires2fa) return { requires2fa: true };
      const { user, refreshToken } = result;
      this.cookieService.issueAuthCookies(reply, {
        session: {
          sub: makeSub('user', user.id),
          email: user.email,
          name: user.name,
          type: 'user',
          scopes: user.scopes ?? [],
        },
        refreshToken,
      });
      return { user };
    }
  }

  /**
   * OWASP V3.1.1 — register never discloses whether the email / username is
   * available. Always 202 + identical body. No cookies set; the user must
   * verify their email before being authenticated.
   */
  @Post('register')
  @HttpCode(202)
  @UseGuards(ThrottleGuard)
  @Throttle({ scope: 'register', limit: 5, windowMs: 3_600_000, failClosed: true })
  async register(@Body() dto: RegisterDto) {
    await this.authService.register(dto.email, dto.username, dto.password);
    return {
      ok: true,
      message: 'If the address is available, check your inbox to verify.',
    };
  }

  /**
   * Consume the link emailed on registration. On success we mint the session
   * + refresh cookies (user is now logged in) and return `{ user }`.
   */
  @Post('verify-email')
  @UseGuards(ThrottleGuard)
  @Throttle({ scope: 'verify-email', limit: 5, windowMs: 900_000, failClosed: true })
  async verifyEmail(@Body() dto: { token: string }, @Res({ passthrough: true }) reply: any) {
    const { user, refreshToken } = await this.authService.verifyEmail(dto.token);
    this.cookieService.issueAuthCookies(reply, {
      session: {
        sub: makeSub('user', user.id),
        email: user.email,
        name: user.name,
        type: 'user',
        scopes: user.scopes ?? [],
      },
      refreshToken,
    });
    return { user };
  }

  @Post('password-reset/request')
  @HttpCode(204)
  @UseGuards(ThrottleGuard)
  @Throttle({
    scope: 'reset',
    limit: 1,
    windowMs: 60_000,
    failClosed: true,
    // Per-email bucket — 1/min across all IPs for a given target address.
    // Falls back to IP when the body is malformed, so limiter still bites.
    keyFn: (req: any) =>
      req?.body?.email
        ? `email:${req.body.email}`
        : `ip:${req?.ip ?? req?.socket?.remoteAddress ?? 'unknown'}`,
  })
  @Throttle({
    scope: 'reset-ip',
    limit: 5,
    windowMs: 3_600_000,
    failClosed: true,
    keyFn: (req: any) => `ip:${req?.ip ?? req?.socket?.remoteAddress ?? 'unknown'}`,
  })
  async passwordResetRequest(@Body() dto: PasswordResetRequestDto): Promise<void> {
    await this.authService.passwordResetRequest(dto.email);
  }

  @Post('password-reset/confirm')
  @HttpCode(204)
  async passwordResetConfirm(@Body() dto: PasswordResetConfirmDto): Promise<void> {
    await this.authService.passwordResetConfirm(dto.token, dto.newPassword);
  }

  @Post('password-change')
  @UseGuards(SessionGuard)
  async passwordChange(
    @Body() dto: PasswordChangeDto,
    @Req() req: any,
    @Res({ passthrough: true }) reply: any,
  ) {
    const userId = getUserIdFromSession(req.session);
    // Upstream now returns { user, refreshToken, accessToken } on success so
    // we can rotate BOTH cookies. Previously we only revoked refresh tokens;
    // the already-issued session JWT (1h TTL) survived until natural expiry,
    // which defeats the point of forcing re-auth on password change.
    const { user, refreshToken } = await this.authService.passwordChange(
      userId,
      dto.currentPassword,
      dto.newPassword,
    );
    this.cookieService.issueAuthCookies(reply, {
      session: {
        sub: makeSub('user', user.id),
        email: user.email,
        name: user.name,
        type: 'user',
        scopes: user.scopes ?? [],
      },
      refreshToken,
    });
    return { user };
  }

  @Delete('account')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async deleteAccount(@Req() req: any, @Res({ passthrough: true }) reply: any): Promise<void> {
    const userId = getUserIdFromSession(req.session);
    await this.authService.deleteAccount(userId);
    this.cookieService.clearCookies(reply);
  }

  @Get('session')
  @UseGuards(SessionGuard)
  session(@Req() req: any, @Res({ passthrough: true }) reply: any) {
    // Issue/refresh CSRF token for double-submit pattern. Cookie is NOT
    // HttpOnly so the FE can read it; body echoes the same token so the
    // FE can stash it in memory for header use.
    const csrfToken =
      typeof reply.generateCsrf === 'function'
        ? reply.generateCsrf()
        : typeof req.server?.csrfProtection?.generate === 'function'
          ? req.server.csrfProtection.generate(req, reply)
          : undefined;
    return { ...req.session, csrfToken };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: any, @Res({ passthrough: true }) reply: any) {
    const refreshToken = this.cookieService.readRefreshCookie(req);
    if (refreshToken) {
      if (refreshToken.startsWith('a:')) {
        await this.authService.logoutAdmin(refreshToken);
      } else {
        await this.authService.logoutUser(refreshToken);
      }
    }
    this.cookieService.clearCookies(reply);
  }
}

/**
 * Extract the numeric user id from a user session's OIDC-style `sub`.
 * Used by the two self-service endpoints below (`passwordChange`,
 * `deleteAccount`) — these are user-only, so an admin session reaching
 * them is a misconfigured route guard. We still fail closed on a bad
 * prefix rather than trusting the `type` field alone.
 */
/**
 * Pull the client User-Agent + IP from the Fastify request, capping each
 * to a sane length before forwarding. Headers are server-controlled (set
 * by the proxy / Fastify) and cannot be overridden by the JSON body, so
 * this is the only path through which these fields reach auth-service.
 *
 * Fastify quirk: `req.ip` is a getter that already considers
 * `trustProxy`. We fall back to `req.socket.remoteAddress` only when the
 * getter returns falsy (e.g. unit tests, raw Node http injection).
 */
const UA_MAX = 1024;
const IP_MAX = 64;
function extractClientFingerprint(req: any): { userAgent?: string; ip?: string } {
  const rawUa = req?.headers?.['user-agent'];
  const rawIp = req?.ip ?? req?.socket?.remoteAddress;
  const userAgent = typeof rawUa === 'string' && rawUa.length > 0 ? rawUa.slice(0, UA_MAX) : undefined;
  const ip = typeof rawIp === 'string' && rawIp.length > 0 ? rawIp.slice(0, IP_MAX) : undefined;
  return { userAgent, ip };
}

function getUserIdFromSession(session: Partial<SessionPayload> | undefined): number {
  if (!session?.sub) throw new Error('no session sub');
  const { type, numericId } = parseSub(session.sub);
  if (type !== 'user') throw new Error('user endpoint called with non-user session');
  return numericId;
}
