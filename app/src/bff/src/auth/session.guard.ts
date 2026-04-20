import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { CookieService, makeSub } from './cookie.service';
import { AuthService } from './auth.service';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly cookieService: CookieService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const reply = context.switchToHttp().getResponse();

    // Fast path: valid session cookie
    const sessionToken = this.cookieService.readSessionCookie(req);
    if (sessionToken) {
      const payload = this.cookieService.verifySession(sessionToken);
      if (payload) {
        req.session = payload;
        return true;
      }
    }

    // Slow path: use refresh token.
    //
    // The refresh cookie's `a:` / `u:` prefix is independent of the session
    // JWT's `sub` prefix — it comes from auth-service's refresh-token store,
    // not our claims shape. Routing on it stays as-is.
    const refreshToken = this.cookieService.readRefreshCookie(req);
    if (!refreshToken) throw new UnauthorizedException('Not authenticated');

    try {
      let result: any;
      if (refreshToken.startsWith('a:')) {
        result = await this.authService.refreshAdmin(refreshToken);
        const { admin, refreshToken: newRefresh } = result;
        const session = {
          sub: makeSub('admin', admin.id),
          email: admin.email,
          name: admin.name,
          type: 'admin' as const,
          scopes: [],
        };
        this.cookieService.setSessionCookie(reply, session);
        this.cookieService.setRefreshCookie(reply, newRefresh);
        req.session = session;
      } else {
        result = await this.authService.refreshUser(refreshToken);
        const { user, refreshToken: newRefresh } = result;
        const scopes = user.scopes ?? [];
        const session = {
          sub: makeSub('user', user.id),
          email: user.email,
          name: user.name,
          type: 'user' as const,
          scopes,
        };
        this.cookieService.setSessionCookie(reply, session);
        this.cookieService.setRefreshCookie(reply, newRefresh);
        req.session = session;
      }
      return true;
    } catch {
      this.cookieService.clearCookies(reply);
      throw new UnauthorizedException('Session expired, please log in again');
    }
  }
}
