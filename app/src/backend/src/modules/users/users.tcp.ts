import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { UsersService } from './users.service';

@Controller()
export class UsersTcpController {
  constructor(private readonly service: UsersService) {}

  @MessagePattern({ cmd: 'users.list' })
  list() {
    return this.service.findAll();
  }

  @MessagePattern({ cmd: 'users.findById' })
  findById(@Payload() data: { id: number }) {
    return this.service.findById(data.id);
  }

  @MessagePattern({ cmd: 'users.findByUsername' })
  findByUsername(@Payload() data: { username: string }) {
    return this.service.findByUsername(data.username);
  }
}
