import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { BACKEND_SERVICE } from '../../common/microservice.module';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

interface BackendUserRow {
  id: number;
  name: string;
  email?: string;
  role?: string;
  accessStatus?: string;
  createdAt?: string;
}

export interface ResolveUsernameResult {
  /** Numeric backend user id, or `null` when no case-insensitive match was found. */
  userId: number | null;
  /** True iff a row came back. Callers (invite flow, ADR-005) branch on this to
   *  implement fail-silent / enumeration-safe behaviour without re-checking
   *  `userId === null`. */
  found: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(BACKEND_SERVICE) private readonly client: ClientProxy,
    private readonly proxy: RpcProxyService,
  ) {}

  list() {
    return this.proxy.forward(this.client, { cmd: TcpCmd.users.list }, {});
  }

  findById(id: number) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.users.findById }, { id });
  }

  /**
   * Resolve a username (== `users.name`, per schema at
   * `backend/src/database/schema/users.ts`) to a numeric userId.
   *
   * Uses the dedicated `users.findByUsername` TCP command (backed by the
   * `users_name_lower_idx` functional index — see `drizzle/0010_*.sql`) so we
   * no longer fan out `users.list` and scan client-side.
   *
   * Returns `{ userId, found }`:
   *   - hit  → `{ userId: <n>, found: true }`
   *   - miss → `{ userId: null, found: false }` (caller decides whether to
   *            surface 404 or fail silent per ADR-005 / invite flow).
   *
   * Empty / whitespace-only input is rejected with `BadRequestException` — a
   * genuine client bug, not an absent row.
   */
  async resolveUserIdByUsername(username: string): Promise<ResolveUsernameResult> {
    const trimmed = (username ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('username must not be empty');
    }
    const row = await this.proxy.forward<BackendUserRow | null>(
      this.client,
      { cmd: TcpCmd.users.findByUsername },
      { username: trimmed },
    );
    if (!row) return { userId: null, found: false };
    return { userId: row.id, found: true };
  }
}
