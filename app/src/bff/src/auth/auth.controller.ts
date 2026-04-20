import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Req,
  Res,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';
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
  async login(@Body() dto: LoginDto, @Req() req: any, @Res({ passthrough: true }) reply: any) {
    const isAdmin = dto.type === 'admin';

    if (isAdmin) {
      const result = await this.authService.loginAdmin(dto.email, dto.password, dto.totpCode);
      if (result?.requires2fa) return { requires2fa: true };
      const { admin, refreshToken } = result;
      this.cookieService.issueAuthCookies(reply, {
        session: {
          adminId: admin.id,
          email: admin.email,
          name: admin.name,
          type: 'admin',
          scopes: [],
        },
        refreshToken,
      });
      return { admin };
    } else {
      const result = await this.authService.loginUser(dto.email, dto.password, dto.totpCode);
      if (result?.requires2fa) return { requires2fa: true };
      const { user, refreshToken } = result;
      this.cookieService.issueAuthCookies(reply, {
        session: {
          userId: user.id,
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

  @Post('register')
  @HttpCode(201)
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) reply: any) {
    const { user, refreshToken } = await this.authService.register(
      dto.email,
      dto.username,
      dto.password,
    );
    this.cookieService.issueAuthCookies(reply, {
      session: {
        userId: user.id,
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
  @Throttle({ scope: 'reset', limit: 1, windowMs: 60_000, failClosed: true })
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
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async passwordChange(
    @Body() dto: PasswordChangeDto,
    @Req() req: any,
  ): Promise<void> {
    const userId = req.session?.userId;
    await this.authService.passwordChange(userId, dto.currentPassword, dto.newPassword);
  }

  @Delete('account')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async deleteAccount(
    @Req() req: any,
    @Res({ passthrough: true }) reply: any,
  ): Promise<void> {
    const userId = req.session?.userId;
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
