import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { BACKEND_SERVICE } from '../../common/microservice.module';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';
import { UsersService } from '../users/users.service';

export interface FriendRequestInput {
  requesterId: number;
  targetUsername: string;
  text?: string;
}

export interface FriendDecisionInput {
  userId: number;
  requestId: number;
}

export interface FriendRemoveInput {
  userId: number;
  otherUserId: number;
}

export interface FriendListInput {
  userId: number;
}

/** Backend `friends.list` row shape — see `backend/.../friends.service.ts#list`. */
export interface BackendFriendRow {
  id: number;
  friendId: number;
  acceptedAt: string | Date | null;
}

/** Backend `friends.listPending` row shape — see `backend/.../friends.service.ts#listPending`. */
export interface BackendPendingRow {
  id: number;
  requesterId: number;
  otherUserId: number;
  /** True iff the row represents a request *received* by `userId` (i.e. not sent by them). */
  incoming: boolean;
  requestText: string | null;
  createdAt: string | Date;
}

/** Public envelope shape — must match `frontend/lib/friends.ts: FriendsResponse`. */
export interface FriendSummary {
  userId: number;
  username: string;
}
export interface IncomingFriendRequest {
  id: number;
  from: FriendSummary;
}
export interface OutgoingFriendRequest {
  id: number;
  to: FriendSummary;
}
export interface FriendsEnvelope {
  friends: FriendSummary[];
  incoming: IncomingFriendRequest[];
  outgoing: OutgoingFriendRequest[];
}

/**
 * Placeholder used when a referenced user id no longer resolves (deleted /
 * banned account). Surfacing `unknown` keeps the FE rendering instead of
 * crashing on `username === undefined`; the FE can treat the row as stale.
 */
const PLACEHOLDER_USERNAME = 'unknown';

/**
 * Thin BFF proxy for the backend's friends module. Every method delegates
 * straight to {@link RpcProxyService.forward} which owns the `_sys` envelope,
 * upstream timeout, and RxJS→Promise glue.
 */
@Injectable()
export class FriendsService {
  constructor(
    @Inject(BACKEND_SERVICE) private readonly client: ClientProxy,
    private readonly proxy: RpcProxyService,
    private readonly users: UsersService,
  ) {}

  request(input: FriendRequestInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.friends.request }, { ...input });
  }

  accept(input: FriendDecisionInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.friends.accept }, { ...input });
  }

  reject(input: FriendDecisionInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.friends.reject }, { ...input });
  }

  remove(input: FriendRemoveInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.friends.remove }, { ...input });
  }

  list(input: FriendListInput) {
    return this.proxy.forward<BackendFriendRow[]>(
      this.client,
      { cmd: TcpCmd.friends.list },
      { ...input },
    );
  }

  listPending(input: FriendListInput) {
    return this.proxy.forward<BackendPendingRow[]>(
      this.client,
      { cmd: TcpCmd.friends.listPending },
      { ...input },
    );
  }

  /**
   * Aggregator for `GET /api/v1/friends`. Combines:
   *   - `friends.list` (accepted friendships) →  `friends[]`
   *   - `friends.listPending` (pending) split by direction → `incoming[]` / `outgoing[]`
   *   - `users.listByIds` for username hydration in a single round-trip.
   *
   * Shape MUST match `frontend/src/lib/friends.ts: FriendsResponse` — that
   * interface is the contract; the BFF wraps backend rows to satisfy it.
   *
   * Deleted / missing users surface as `{userId, username: 'unknown'}` rather
   * than dropping the row, so the FE can still render the request id and
   * offer a "remove" action.
   */
  async listEnvelope(input: FriendListInput): Promise<FriendsEnvelope> {
    const [friendsRows, pendingRows] = await Promise.all([
      this.list(input),
      this.listPending(input),
    ]);

    const incomingRaw = (pendingRows ?? []).filter((r) => r.incoming);
    const outgoingRaw = (pendingRows ?? []).filter((r) => !r.incoming);

    // Single hydration call covering every distinct id we'll need to render.
    const ids = new Set<number>();
    for (const f of friendsRows ?? []) ids.add(f.friendId);
    for (const p of incomingRaw) ids.add(p.otherUserId);
    for (const p of outgoingRaw) ids.add(p.otherUserId);

    const usernames = await this.users.findManyByIds([...ids]);
    const summary = (id: number): FriendSummary => ({
      userId: id,
      username: usernames.get(id) ?? PLACEHOLDER_USERNAME,
    });

    return {
      friends: (friendsRows ?? []).map((r) => summary(r.friendId)),
      incoming: incomingRaw.map((r) => ({ id: r.id, from: summary(r.otherUserId) })),
      outgoing: outgoingRaw.map((r) => ({ id: r.id, to: summary(r.otherUserId) })),
    };
  }
}
