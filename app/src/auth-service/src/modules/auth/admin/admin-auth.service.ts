import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DATABASE } from '../../../database/database.module';
import { Db } from '../../../database/connection';
import { admins } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { PasswordService } from '../shared/password.service';
import { JwtService } from '../shared/jwt.service';
import { RefreshTokenService } from '../shared/refresh-token.service';
import { TotpService } from '../shared/totp.service';
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

    if (admin.twoFactorEnabled) {
      if (!dto.totpCode) {
        return { requires2fa: true as const };
      }
      if (!this.totpService.verify(dto.totpCode, admin.twoFactorSecret!)) {
        throw new UnauthorizedException('Invalid TOTP code');
      }
    }

    const accessToken = this.jwtService.signAdmin({ adminId: admin.id, email: admin.email });
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

    const newRefreshToken = await this.refreshTokenService.validateAndRotate('a', adminId, token);
    const accessToken = this.jwtService.signAdmin({ adminId: admin.id, email: admin.email });

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
