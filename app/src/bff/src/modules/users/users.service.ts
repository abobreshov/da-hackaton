import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { BACKEND_SERVICE } from '../../common/microservice.module';
import { withSys } from '../../common/rpc-transport';

interface BackendUserRow {
  id: number;
  name: string;
  email?: string;
  role?: string;
  accessStatus?: string;
  createdAt?: string;
}

@Injectable()
export class UsersService {
  constructor(@Inject(BACKEND_SERVICE) private readonly client: ClientProxy) {}

  list() {
    return firstValueFrom(this.client.send({ cmd: 'users.list' }, withSys({})));
  }

  findById(id: number) {
    return firstValueFrom(this.client.send({ cmd: 'users.findById' }, withSys({ id })));
  }

  /**
   * Resolve a username (== `users.name`, per schema at
   * `backend/src/database/schema/users.ts`) to a numeric userId. Used by
   * `RoomsService.invite` to accept `{username}` on the HTTP surface without
   * adding a new backend TCP command.
   *
   * Throws `NotFoundException` if no user matches — callers surface this as
   * a 404 so the inviter sees "user not found" rather than a silent no-op.
   * Match is case-insensitive on `.toLowerCase()`; room-side uniqueness of
   * names is enforced by the schema's unique-email (names may collide).
   * Where multiple rows share a case-insensitive name, we pick the first —
   * good enough until a dedicated `users.findByUsername` lands.
   */
  async resolveUserIdByUsername(username: string): Promise<number> {
    const trimmed = username.trim();
    if (!trimmed) throw new NotFoundException(`user "${username}" not found`);
    const rows = (await firstValueFrom(
      this.client.send({ cmd: 'users.list' }, withSys({})),
    )) as BackendUserRow[];
    const needle = trimmed.toLowerCase();
    const hit = rows.find((u) => typeof u?.name === 'string' && u.name.toLowerCase() === needle);
    if (!hit) throw new NotFoundException(`user "${trimmed}" not found`);
    return hit.id;
  }
}
