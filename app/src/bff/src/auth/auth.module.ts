import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';
import { SessionGuard } from './session.guard';
import { ThrottleGuard } from '../common/guards/throttle.guard';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, CookieService, SessionGuard, ThrottleGuard],
  exports: [CookieService, SessionGuard, AuthService],
})
export class AuthModule {}
