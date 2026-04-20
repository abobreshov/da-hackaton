import { Controller, Post, Get, Body, Req, Res, HttpCode, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';
import { SessionGuard } from './session.guard';
import { LoginDto } from './dto/login.dto';

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
      const { admin, refreshToken } = await this.authService.loginAdmin(dto.email, dto.password, dto.totpCode);
      this.cookieService.setSessionCookie(reply, { adminId: admin.id, email: admin.email, type: 'admin' });
      this.cookieService.setRefreshCookie(reply, refreshToken);
      return { admin };
    } else {
      const { user, refreshToken } = await this.authService.loginUser(dto.email, dto.password, dto.totpCode);
      this.cookieService.setSessionCookie(reply, { userId: user.id, email: user.email, type: 'user' });
      this.cookieService.setRefreshCookie(reply, refreshToken);
      return { user };
    }
  }

  @Get('session')
  @UseGuards(SessionGuard)
  session(@Req() req: any) {
    return req.session;
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
