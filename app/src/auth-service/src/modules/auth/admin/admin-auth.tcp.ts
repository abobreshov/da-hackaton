import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto } from './dto/login.dto';

/**
 * Admin auth TCP surface. HttpException -> RpcException translation is done
 * globally by `RpcExceptionFilter` (registered via APP_FILTER in AppModule).
 */
@Controller()
export class AdminAuthTcpController {
  constructor(private readonly service: AdminAuthService) {}

  @MessagePattern({ cmd: 'auth.admin.login' })
  login(@Payload() dto: AdminLoginDto) {
    return this.service.login(dto);
  }

  @MessagePattern({ cmd: 'auth.admin.refresh' })
  refresh(@Payload() data: { refreshToken: string }) {
    return this.service.refresh(data.refreshToken);
  }

  @MessagePattern({ cmd: 'auth.admin.logout' })
  async logout(@Payload() data: { refreshToken: string }) {
    await this.service.logout(data.refreshToken);
    return { ok: true };
  }
}
