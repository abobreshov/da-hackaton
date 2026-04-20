import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DATABASE } from '../../../database/database.module';
import { Db } from '../../../database/connection';
import { users } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { PasswordService } from '../shared/password.service';
import { JwtService } from '../shared/jwt.service';
import { RefreshTokenService } from '../shared/refresh-token.service';
import { TotpService } from '../shared/totp.service';
import { CustomerLoginDto } from './dto/login.dto';

@Injectable()
export class CustomerAuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly totpService: TotpService,
  ) {}

  async login(dto: CustomerLoginDto) {
    const [user] = await this.db.select().from(users).where(eq(users.email, dto.email)).limit(1);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await this.passwordService.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (user.accessStatus !== 'ACTIVE') throw new ForbiddenException('Account inactive');

    if (user.twoFactorEnabled) {
      if (!dto.totpCode) throw new UnauthorizedException('TOTP code required');
      if (!this.totpService.verify(dto.totpCode, user.twoFactorSecret!)) {
        throw new UnauthorizedException('Invalid TOTP code');
      }
    }

    const accessToken = this.jwtService.signUser({ userId: user.id, email: user.email, role: user.role ?? 'USER' });
    const refreshToken = await this.refreshTokenService.create('u', user.id);

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      accessToken,
      refreshToken,
    };
  }

  async refresh(token: string) {
    const parts = token.split(':');
    if (parts.length < 3 || parts[0] !== 'u') throw new UnauthorizedException('Invalid refresh token');
    const userId = parseInt(parts[1], 10);

    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.accessStatus !== 'ACTIVE') throw new UnauthorizedException();

    const newRefreshToken = await this.refreshTokenService.validateAndRotate('u', userId, token);
    const accessToken = this.jwtService.signUser({ userId: user.id, email: user.email, role: user.role ?? 'USER' });

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
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

  async validateToken(token: string) {
    try {
      const payload = this.jwtService.verifyUser(token);
      return { userId: payload.userId, email: payload.email, role: payload.role };
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
