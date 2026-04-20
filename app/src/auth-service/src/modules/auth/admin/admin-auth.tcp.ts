import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto } from './dto/login.dto';
import { toRpc } from '../../../common/rpc-exception.util';

@Controller()
export class AdminAuthTcpController {
  constructor(private readonly service: AdminAuthService) {}

  @MessagePattern({ cmd: 'auth.admin.login' })
  login(@Payload() dto: AdminLoginDto) {
    return toRpc(() => this.service.login(dto));
  }

  @MessagePattern({ cmd: 'auth.admin.refresh' })
  refresh(@Payload() data: { refreshToken: string }) {
    return toRpc(() => this.service.refresh(data.refreshToken));
  }

  @MessagePattern({ cmd: 'auth.admin.logout' })
  async logout(@Payload() data: { refreshToken: string }) {
    return toRpc(async () => {
      await this.service.logout(data.refreshToken);
      return { ok: true };
    });
  }
}
