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
   * Bulk username hydration. Returns a Map keyed by user id so callers can
   * cheaply zip into raw row arrays without re-scanning. Missing ids are
   * absent from the map (not a thrown 404) — the friend-list aggregator falls
   * back to a placeholder so a deleted user never crashes the whole response.
   *
   * Empty input short-circuits to an empty Map without an upstream call.
   */
  async findManyByIds(ids: number[]): Promise<Map<number, string>> {
    const cleaned = [...new Set((ids ?? []).filter((n) => Number.isInteger(n) && n > 0))];
    if (cleaned.length === 0) return new Map();
    const rows = await this.proxy.forward<Array<{ id: number; name: string }>>(
      this.client,
      { cmd: TcpCmd.users.listByIds },
      { ids: cleaned },
    );
    const map = new Map<number, string>();
    for (const r of rows ?? []) map.set(r.id, r.name);
    return map;
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

  /**
   * Autocomplete for the FE add-friend dropdown. Returns at most `limit`
   * users whose `name` starts with `q` (case-insensitive), excluding the
   * caller's own row. Empty / whitespace `q` short-circuits to `[]` so the
   * dropdown stays empty until the user types a character.
   *
   * The backend clamps `limit` between 1 and 25; we forward the FE's
   * request verbatim and let the server own the bound.
   */
  async searchByUsernamePrefix(
    q: string,
    excludeUserId: number | null,
    limit: number,
  ): Promise<Array<{ id: number; name: string }>> {
    const trimmed = (q ?? '').trim();
    if (!trimmed) return [];
    const rows = await this.proxy.forward<Array<{ id: number; name: string }>>(
      this.client,
      { cmd: TcpCmd.users.search },
      { q: trimmed, excludeUserId, limit },
    );
    return rows ?? [];
  }
}
