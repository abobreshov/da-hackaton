import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  CountSinceInput,
  MarkReadInput,
  UNREAD_REPOSITORY,
  UnreadCounts,
  UnreadRepositoryPort,
} from './unread.types';

/**
 * EPIC-09 unread domain service. Pure business rules — XOR scope enforcement
 * + delegate to the repo port. The 99 cap is enforced at the repo layer so
 * both SQL and the fake agree on the contract.
 */
@Injectable()
export class UnreadService {
  constructor(
    @Inject(UNREAD_REPOSITORY)
    private readonly repo: UnreadRepositoryPort,
  ) {}

  async markRead(input: MarkReadInput): Promise<void> {
    this.assertScope(input);
    await this.repo.upsertLastRead(input);
  }

  async getUnreadCounts(params: { userId: number }): Promise<UnreadCounts> {
    const [rooms, dms] = await Promise.all([
      this.repo.unreadRoomsFor(params.userId),
      this.repo.unreadDmsFor(params.userId),
    ]);
    return { rooms, dms };
  }

  async countSince(input: CountSinceInput): Promise<number> {
    this.assertScope(input);
    return this.repo.countSince(input);
  }

  /**
   * Batched per-recipient room unread counts. Used by `UnreadSubscriber`
   * to fan out `unread.changed` after a room message — one SQL round-trip
   * instead of one per recipient. Returns `[]` early when `userIds` is empty
   * to avoid issuing a degenerate query.
   */
  async countsSinceForRoomMembers(
    roomId: number,
    userIds: number[],
  ): Promise<Array<{ userId: number; count: number }>> {
    if (userIds.length === 0) return [];
    return this.repo.countSinceForRoomMembers(roomId, userIds);
  }

  private assertScope(p: { roomId?: number; dmId?: number }): void {
    const hasRoom = p.roomId != null;
    const hasDm = p.dmId != null;
    if (hasRoom === hasDm) {
      throw new BadRequestException('exactly one of roomId or dmId must be provided');
    }
  }
}
