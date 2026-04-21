import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { makeSub } from '@app/contracts';
import { DATABASE } from '../../../database/database.module';
import { Db } from '../../../database/connection';
import { admins } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { PasswordService } from '../shared/password.service';
import { JwtService } from '../shared/jwt.service';
import { RefreshTokenService } from '../shared/refresh-token.service';
import { TotpService } from '../shared/totp.service';
import { env } from '../../../config/environment';
import { AdminLoginDto } from './dto/login.dto';

@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly totpService: TotpService,
  ) {}

  async login(dto: AdminLoginDto) {
    const [admin] = await this.db.select().from(admins).where(eq(admins.email, dto.email)).limit(1);
    if (!admin) throw new UnauthorizedException('Invalid credentials');

    const valid = await this.passwordService.compare(dto.password, admin.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (admin.accessStatus !== 'ACTIVE') throw new ForbiddenException('Account inactive');

    // OWASP A07 — admin surfaces MUST enforce a second factor. An account
    // without TOTP enabled is refused outright; the operator needs to enrol
    // before logging in. A dev escape hatch (`ALLOW_PASSWORD_ONLY_ADMIN_LOGIN`)
    // exists to unbreak local-only workflows but is off by default.
    if (!admin.twoFactorEnabled) {
      if (!env.ALLOW_PASSWORD_ONLY_ADMIN_LOGIN) {
        throw new UnauthorizedException(
          'Admin accounts require two-factor authentication. Please enable TOTP.',
        );
      }
    } else {
      if (!dto.totpCode) {
        return { requires2fa: true as const };
      }
      const ok = await this.totpService.verifyWithReplayGuard(
        admin.id,
        dto.totpCode,
        admin.twoFactorSecret!,
        { scope: 'a' }, // admin → fail-closed on Redis outage (the default)
      );
      if (!ok) {
        throw new UnauthorizedException('Invalid TOTP code');
      }
    }

    const accessToken = this.jwtService.signAdmin({
      sub: makeSub('admin', admin.id),
      type: 'admin',
      email: admin.email,
      name: admin.name,
      scopes: [],
    });
    const refreshToken = await this.refreshTokenService.create('a', admin.id);

    return {
      admin: { id: admin.id, email: admin.email, name: admin.name },
      accessToken,
      refreshToken,
    };
  }

  async refresh(token: string) {
    const parts = token.split(':');
    if (parts.length < 3 || parts[0] !== 'a')
      throw new UnauthorizedException('Invalid refresh token');
    const adminId = parseInt(parts[1], 10);

    const [admin] = await this.db.select().from(admins).where(eq(admins.id, adminId)).limit(1);
    if (!admin || admin.accessStatus !== 'ACTIVE') throw new UnauthorizedException();

    const { token: newRefreshToken } = await this.refreshTokenService.validateAndRotate(
      'a',
      adminId,
      token,
    );
    const accessToken = this.jwtService.signAdmin({
      sub: makeSub('admin', admin.id),
      type: 'admin',
      email: admin.email,
      name: admin.name,
      scopes: [],
    });

    return {
      admin: { id: admin.id, email: admin.email, name: admin.name },
      accessToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(token: string) {
    const parts = token.split(':');
    if (parts.length >= 3 && parts[0] === 'a') {
      const adminId = parseInt(parts[1], 10);
      await this.refreshTokenService.revoke('a', adminId, token);
    }
  }
}
