import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthController } from './admin/admin-auth.controller';
import { AdminAuthService } from './admin/admin-auth.service';
import { CustomerAuthController } from './customer/customer-auth.controller';
import { CustomerAuthService } from './customer/customer-auth.service';
import { JwtService } from './shared/jwt.service';
import { PasswordService } from './shared/password.service';
import { RefreshTokenService } from './shared/refresh-token.service';
import { TotpService } from './shared/totp.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminAuthController, CustomerAuthController],
  providers: [
    AdminAuthService,
    CustomerAuthService,
    JwtService,
    PasswordService,
    RefreshTokenService,
    TotpService,
  ],
})
export class AuthModule {}
