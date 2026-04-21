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

  /**
   * Bulk lookup by ids — used by BFF aggregators (friends list, etc.) to
   * hydrate usernames in a single round-trip. Returns `{id, name}` rows for
   * every id that exists; missing ids are silently dropped (caller decides
   * how to surface gaps).
   */
  @MessagePattern({ cmd: 'users.listByIds' })
  listByIds(@Payload() data: { ids: number[]; _sys?: string }) {
    return this.service.findByIds(data.ids ?? []);
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
