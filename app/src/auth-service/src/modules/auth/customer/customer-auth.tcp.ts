import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerLoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { PasswordChangeDto } from './dto/password-change.dto';
import { toRpc } from '../../../common/rpc-exception.util';

@Controller()
export class CustomerAuthTcpController {
  constructor(private readonly service: CustomerAuthService) {}

  @MessagePattern({ cmd: TcpCmd.auth.customer.login })
  login(@Payload() dto: CustomerLoginDto) {
    return toRpc(() => this.service.login(dto));
  }

  @MessagePattern({ cmd: TcpCmd.auth.customer.refresh })
  refresh(@Payload() data: { refreshToken: string }) {
    return toRpc(() => this.service.refresh(data.refreshToken));
  }

  @MessagePattern({ cmd: TcpCmd.auth.customer.logout })
  async logout(@Payload() data: { refreshToken: string }) {
    return toRpc(async () => {
      await this.service.logout(data.refreshToken);
      return { ok: true };
    });
  }

  @MessagePattern({ cmd: TcpCmd.auth.customer.validateToken })
  validateToken(@Payload() data: { token: string }) {
    return toRpc(() => this.service.validateToken(data.token));
  }

  @MessagePattern({ cmd: TcpCmd.auth.customer.register })
  register(@Payload() dto: RegisterDto) {
    return toRpc(() => this.service.register(dto));
  }

  @MessagePattern({ cmd: TcpCmd.auth.customer.passwordResetRequest })
  passwordResetRequest(@Payload() dto: PasswordResetRequestDto) {
    return toRpc(async () => {
      await this.service.passwordResetRequest(dto);
      return { ok: true };
    });
  }

  @MessagePattern({ cmd: TcpCmd.auth.customer.passwordResetConfirm })
  passwordResetConfirm(@Payload() dto: PasswordResetConfirmDto) {
    return toRpc(async () => {
      await this.service.passwordResetConfirm(dto);
      return { ok: true };
    });
  }

  @MessagePattern({ cmd: TcpCmd.auth.customer.passwordChange })
  passwordChange(@Payload() data: PasswordChangeDto & { userId: number }) {
    return toRpc(async () => {
      await this.service.passwordChange(data);
      return { ok: true };
    });
  }

  @MessagePattern({ cmd: TcpCmd.auth.customer.delete })
  deleteAccount(@Payload() data: { userId: number }) {
    return toRpc(async () => {
      await this.service.deleteAccount(data);
      return { ok: true };
    });
  }
}
