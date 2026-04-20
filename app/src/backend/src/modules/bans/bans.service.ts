import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { dmChannels, friendships, userBans } from '../../database/schema';
import { EVENT_PUBLISHER, IEventPublisher } from '../../common/events/event-publisher.interface';

export interface BanInput {
  bannerId: number;
  bannedId: number;
}

export interface UnbanInput {
  bannerId: number;
  bannedId: number;
}

export interface IsBannedInput {
  a: number;
  b: number;
}

export interface ListBansByUserInput {
  userId: number;
}

function pair(a: number, b: number): { low: number; high: number } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}

/**
 * EPIC-04 AC-04-10.
 *
 * BanService owns the atomic ban transaction. The cascade (insert user_bans,
 * remove friendships, freeze DM) has to be all-or-nothing or the system can
 * end up in a state where a user is banned but still sees the banner's DMs
 * or appears in their friend list — any partial state silently violates
 * AC-04-07 / AC-04-08 / AC-04-09.
 *
 * Events are published AFTER commit so we never broadcast a state that ends
 * up rolled back. EPIC-08 will replace the in-proc publisher with Redis.
 */
@Injectable()
export class BansService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    @Inject(EVENT_PUBLISHER) private readonly events: IEventPublisher,
  ) {}

  async banUser(input: BanInput): Promise<{ ok: true }> {
    const { bannerId, bannedId } = input;
    if (bannerId === bannedId) throw new BadRequestException('cannot ban yourself');

    const { low, high } = pair(bannerId, bannedId);

    await this.db.transaction(async (tx) => {
      // 1. insert ban row (idempotent — duplicate ban is a no-op).
      await tx.insert(userBans).values({ bannerId, bannedId }).onConflictDoNothing();

      // 2. terminate friendship (AC-04-08). UNIQUE on (user_a, user_b) means
      //    at most one row matches the pair.
      await tx
        .delete(friendships)
        .where(and(eq(friendships.userA, low), eq(friendships.userB, high)));

      // 3. freeze DM channel if any — do not clobber a prior freeze
      //    (AC-04-07). EPIC-07 reads frozen_at during message create.
      //    `isNull(frozenAt)` preserves the "first ban wins" timestamp.
      await tx
        .update(dmChannels)
        .set({ frozenAt: new Date() })
        .where(
          and(
            eq(dmChannels.userLow, low),
            eq(dmChannels.userHigh, high),
            isNull(dmChannels.frozenAt),
          ),
        );
    });

    // post-commit fan-out
    this.events.emit('user.banned.me', { byUserId: bannerId, userId: bannedId });
    this.events.emit('friend.removed', {
      userId: bannerId,
      otherUserId: bannedId,
      reason: 'banned',
    });
    this.events.emit('dm.frozen', { userA: low, userB: high });

    return { ok: true };
  }

  /**
   * AC-04-11: unban does NOT restore prior friendship and does NOT unfreeze DM.
   */
  async unbanUser(input: UnbanInput): Promise<{ ok: true }> {
    const { bannerId, bannedId } = input;
    if (bannerId === bannedId) throw new BadRequestException('cannot unban yourself');

    await this.db
      .delete(userBans)
      .where(and(eq(userBans.bannerId, bannerId), eq(userBans.bannedId, bannedId)));

    return { ok: true };
  }

  async isBanned(input: IsBannedInput): Promise<boolean> {
    const { a, b } = input;
    const rows = await this.db
      .select({ bannerId: userBans.bannerId, bannedId: userBans.bannedId })
      .from(userBans)
      .where(
        or(
          and(eq(userBans.bannerId, a), eq(userBans.bannedId, b)),
          and(eq(userBans.bannerId, b), eq(userBans.bannedId, a)),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async listBansByUser(input: ListBansByUserInput) {
    const { userId } = input;
    return this.db
      .select({ bannedId: userBans.bannedId, createdAt: userBans.createdAt })
      .from(userBans)
      .where(eq(userBans.bannerId, userId));
  }
}
