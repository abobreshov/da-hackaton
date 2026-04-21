import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
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

  /**
   * Autocomplete for add-friend. `excludeUserId` keeps the caller out of
   * their own suggestions, `limit` is clamped server-side in the service.
   */
  @MessagePattern({ cmd: 'users.search' })
  search(
    @Payload()
    data: { q: string; excludeUserId?: number | null; limit?: number; _sys?: string },
  ) {
    return this.service.searchByUsernamePrefix(
      data?.q ?? '',
      data?.excludeUserId ?? null,
      data?.limit ?? 8,
    );
  }

  /**
   * Account-cascade fan-out, invoked by auth-service immediately after it
   * soft-deletes the users row. Drops friendships, room memberships, and
   * clears the presence keys so other clients stop seeing the user.
   *
   * MUST be `@EventPattern`, not `@MessagePattern`: auth-service publishes
   * this with `ClientProxy.emit(...)` (fire-and-forget event dispatch),
   * and `emit` matches ONLY `@EventPattern` handlers. Binding this to
   * `@MessagePattern` looks right at read time but never fires at run
   * time — the cascade silently no-ops, which is how a deleted user
   * lingered in other users' friend lists + member panes.
   */
  @EventPattern({ cmd: 'users.cascade.enqueue' })
  async cascadeDelete(@Payload() data: { userId: number; _sys?: string }): Promise<void> {
    await this.service.cascadeDelete(data.userId);
  }
}
