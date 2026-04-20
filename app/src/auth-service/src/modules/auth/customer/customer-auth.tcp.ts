import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerLoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { PasswordChangeDto } from './dto/password-change.dto';

/**
 * Customer auth TCP surface. HttpException -> RpcException translation is done
 * globally by `RpcExceptionFilter` (registered via APP_FILTER in AppModule).
 * Handlers dispatch straight to the service; no per-method wrapping.
 */
@Controller()
export class CustomerAuthTcpController {
  constructor(private readonly service: CustomerAuthService) {}

  @MessagePattern({ cmd: TcpCmd.auth.customer.login })
  login(@Payload() dto: CustomerLoginDto) {
    return this.service.login(dto);
  }

  @MessagePattern({ cmd: TcpCmd.auth.customer.refresh })
  refresh(@Payload() data: { refreshToken: string }) {
    return this.service.refresh(data.refreshToken);
  }

  @MessagePattern({ cmd: TcpCmd.auth.customer.logout })
  async logout(@Payload() data: { refreshToken: string }) {
    await this.service.logout(data.refreshToken);
    return { ok: true };
  }

  @MessagePattern({ cmd: TcpCmd.auth.customer.validateToken })
  validateToken(@Payload() data: { token: string }) {
    return this.service.validateToken(data.token);
  }

  @MessagePattern({ cmd: TcpCmd.auth.customer.register })
  register(@Payload() dto: RegisterDto) {
    return this.service.register(dto);
  }

  @MessagePattern({ cmd: TcpCmd.auth.customer.passwordResetRequest })
  async passwordResetRequest(@Payload() dto: PasswordResetRequestDto) {
    await this.service.passwordResetRequest(dto);
    return { ok: true };
  }

  @MessagePattern({ cmd: TcpCmd.auth.customer.passwordResetConfirm })
  async passwordResetConfirm(@Payload() dto: PasswordResetConfirmDto) {
    await this.service.passwordResetConfirm(dto);
    return { ok: true };
  }

  @MessagePattern({ cmd: TcpCmd.auth.customer.passwordChange })
  passwordChange(@Payload() data: PasswordChangeDto & { userId: number }) {
    // Returns { user, accessToken, refreshToken } — same shape as login/refresh
    // so the BFF can drive `cookieService.issueAuthCookies` with zero new
    // branches. Cookie rotation on password change closes the window where
    // the previously issued 1h session JWT would still verify.
    return this.service.passwordChange(data);
  }

  @MessagePattern({ cmd: TcpCmd.auth.customer.delete })
  async deleteAccount(@Payload() data: { userId: number }) {
    await this.service.deleteAccount(data);
    return { ok: true };
  }
}
