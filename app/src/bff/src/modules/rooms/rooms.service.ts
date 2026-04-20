import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { BACKEND_SERVICE } from '../../common/microservice.module';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';
import { UsersService } from '../users/users.service';

export interface CreateRoomInput {
  ownerId: number;
  name: string;
  visibility: 'public' | 'private';
  description?: string;
}

export interface JoinLeaveInput {
  userId: number;
  roomId: number;
}

export interface InviteInput {
  inviterId: number;
  /** Pre-resolved numeric id. Supply **either** this or `username`. */
  inviteeId?: number;
  /** Invitee username — resolved to id via `UsersService` before RPC. */
  username?: string;
  roomId: number;
}

/**
 * Result of an invite call. Two flavours:
 *  - Backend accepted the invite — `queued: false`, `invited` is the upstream
 *    invitation row.
 *  - Username-based invite where the user does not exist — `{ queued: true,
 *    invited: null }`. Per ADR-005 (fail-silent / enumeration-safe), we do
 *    NOT surface a 404 to the inviter; the response is indistinguishable from
 *    a real queued invite, so an attacker cannot probe for usernames.
 */
export interface InviteResult {
  queued: boolean;
  invited: unknown | null;
}

export interface UpdateRoomPatch {
  name?: string;
  description?: string;
  visibility?: 'public' | 'private';
}

export interface UpdateRoomInput {
  roomId: number;
  actorId: number;
  patch: UpdateRoomPatch;
}

@Injectable()
export class RoomsService {
  constructor(
    @Inject(BACKEND_SERVICE) private readonly client: ClientProxy,
    private readonly proxy: RpcProxyService,
    private readonly users: UsersService,
  ) {}

  catalog() {
    return this.proxy.forward(this.client, { cmd: TcpCmd.rooms.catalog }, {});
  }

  listMy(userId: number) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.rooms.listMy }, { userId });
  }

  create(input: CreateRoomInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.rooms.create }, { ...input });
  }

  join(input: JoinLeaveInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.rooms.join }, { ...input });
  }

  leave(input: JoinLeaveInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.rooms.leave }, { ...input });
  }

  /**
   * Forward an invite to the backend's `rooms.invite` RPC. Accepts either
   * `{inviteeId}` (legacy id-based callers) or `{username}` (FE popover +
   * manage-room modal).
   *
   * Username path is enumeration-safe (ADR-005): when the username does not
   * resolve to a real user, we return `{ queued: true, invited: null }` —
   * indistinguishable from a successful queue — instead of throwing 404. The
   * inviter sees the same UX either way; an attacker cannot probe.
   */
  async invite(input: InviteInput): Promise<InviteResult> {
    let inviteeId = input.inviteeId;
    if (inviteeId === undefined) {
      const resolved = await this.users.resolveUserIdByUsername(input.username ?? '');
      if (!resolved.found) {
        return { queued: true, invited: null };
      }
      inviteeId = resolved.userId as number;
    }
    const invited = await this.proxy.forward(
      this.client,
      { cmd: TcpCmd.rooms.invite },
      { inviterId: input.inviterId, inviteeId, roomId: input.roomId },
    );
    return { queued: false, invited };
  }

  update(input: UpdateRoomInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.rooms.update }, { ...input });
  }
}
