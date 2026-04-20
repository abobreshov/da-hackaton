import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerLoginDto } from './dto/login.dto';
import { toRpc } from '../../../common/rpc-exception.util';

@Controller()
export class CustomerAuthTcpController {
  constructor(private readonly service: CustomerAuthService) {}

  @MessagePattern({ cmd: 'auth.customer.login' })
  login(@Payload() dto: CustomerLoginDto) {
    return toRpc(() => this.service.login(dto));
  }

  @MessagePattern({ cmd: 'auth.customer.refresh' })
  refresh(@Payload() data: { refreshToken: string }) {
    return toRpc(() => this.service.refresh(data.refreshToken));
  }

  @MessagePattern({ cmd: 'auth.customer.logout' })
  async logout(@Payload() data: { refreshToken: string }) {
    return toRpc(async () => {
      await this.service.logout(data.refreshToken);
      return { ok: true };
    });
  }

  @MessagePattern({ cmd: 'auth.customer.validateToken' })
  validateToken(@Payload() data: { token: string }) {
    return toRpc(() => this.service.validateToken(data.token));
  }
}
