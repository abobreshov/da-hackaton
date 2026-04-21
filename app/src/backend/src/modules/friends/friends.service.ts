import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { friendships, userBans, users } from '../../database/schema';
import { EVENT_PUBLISHER, IEventPublisher } from '../../common/events/event-publisher.interface';

export interface FriendRequestInput {
  requesterId: number;
  targetUsername: string;
  text?: string;
}

export interface AcceptInput {
  userId: number;
  requestId: number;
}

export interface RejectInput {
  userId: number;
  requestId: number;
}

export interface RemoveInput {
  userId: number;
  otherUserId: number;
}

export interface ListInput {
  userId: number;
}

/**
 * Canonical pair ordering. The friendships / dm_channels schemas enforce
 * `user_a < user_b` so pair rows are unique regardless of initiator.
 */
function pair(a: number, b: number): { low: number; high: number } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}

@Injectable()
export class FriendsService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    @Inject(EVENT_PUBLISHER) private readonly events: IEventPublisher,
  ) {}

  /**
   * AC-04-02 / AC-04-03 / AC-04-04.
   *
   * Looks up `targetUsername` against users.name, normalises the pair, and
   * inserts a pending friendship row. A unique index on (user_a, user_b)
   * guarantees idempotency at the DB level; we also pre-check so the caller
   * gets a clean 409 rather than a raw constraint violation.
   *
   * Blocks self-friend (400) and honours existing bans in either direction (409).
   */
  async request(input: FriendRequestInput) {
    const { requesterId, targetUsername, text } = input;

    const [target] = await this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.name, targetUsername))
      .limit(1);

    if (!target) throw new NotFoundException(`user '${targetUsername}' not found`);
    if (target.id === requesterId) {
      throw new BadRequestException('cannot friend yourself');
    }

    const { low, high } = pair(requesterId, target.id);

    const existing = await this.db
      .select({ id: friendships.id, status: friendships.status })
      .from(friendships)
      .where(and(eq(friendships.userA, low), eq(friendships.userB, high)))
      .limit(1);

    if (existing.length) {
      throw new ConflictException(
        existing[0].status === 'accepted' ? 'already friends' : 'friend request already pending',
      );
    }

    const bans = await this.db
      .select({ bannerId: userBans.bannerId, bannedId: userBans.bannedId })
      .from(userBans)
      .where(
        or(
          and(eq(userBans.bannerId, requesterId), eq(userBans.bannedId, target.id)),
          and(eq(userBans.bannerId, target.id), eq(userBans.bannedId, requesterId)),
        ),
      )
      .limit(1);

    if (bans.length) {
      throw new ConflictException('friend request blocked by ban');
    }

    const [row] = await this.db
      .insert(friendships)
      .values({
        userA: low,
        userB: high,
        status: 'pending',
        requestedBy: requesterId,
        requestText: text ?? null,
      })
      .returning({ id: friendships.id });

    this.events.emit('friend.request.new', {
      fromUserId: requesterId,
      toUserId: target.id,
      text: text ?? null,
      requestId: row.id,
    });

    return { id: row.id };
  }

  /**
   * AC-04-04: only the counterparty (not the requester) can accept.
   * Row must still be pending; otherwise 409.
   */
  async accept(input: AcceptInput) {
    const { userId, requestId } = input;

    const [row] = await this.db
      .select()
      .from(friendships)
      .where(eq(friendships.id, requestId))
      .limit(1);

    if (!row) throw new NotFoundException('friend request not found');
    if (row.userA !== userId && row.userB !== userId) {
      throw new NotFoundException('friend request not found');
    }
    if (row.requestedBy === userId) {
      throw new BadRequestException('cannot accept your own friend request');
    }
    if (row.status !== 'pending') {
      throw new ConflictException('friend request is not pending');
    }

    await this.db
      .update(friendships)
      .set({ status: 'accepted', acceptedAt: new Date() })
      .where(eq(friendships.id, requestId));

    this.events.emit('friend.request.accepted', {
      requestId,
      accepterId: userId,
      requesterId: row.requestedBy,
    });
    // Return a concrete object so the TCP transport emits a value — RxJS
    // `firstValueFrom` on the BFF side treats `undefined` as an empty stream
    // and throws `EmptyError`.
    return { ok: true as const };
  }

  /**
   * AC-04-04 (implicit): counterparty decides. The requester cancelling their
   * own request goes through `remove` (DELETE /friends/:userId), not reject.
   */
  async reject(input: RejectInput) {
    const { userId, requestId } = input;

    const [row] = await this.db
      .select()
      .from(friendships)
      .where(eq(friendships.id, requestId))
      .limit(1);

    if (!row) throw new NotFoundException('friend request not found');
    if (row.userA !== userId && row.userB !== userId) {
      throw new NotFoundException('friend request not found');
    }
    if (row.requestedBy === userId) {
      throw new BadRequestException('cannot reject your own friend request');
    }
    if (row.status !== 'pending') {
      throw new ConflictException('friend request is not pending');
    }

    await this.db.delete(friendships).where(eq(friendships.id, requestId));
    return { ok: true as const };
  }

  /**
   * AC-04-05: either side can remove an accepted friendship; also used by the
   * requester to cancel their own pending request (distinct from reject).
   */
  async remove(input: RemoveInput) {
    const { userId, otherUserId } = input;
    if (userId === otherUserId) throw new BadRequestException('cannot remove yourself');

    const { low, high } = pair(userId, otherUserId);

    const [row] = await this.db
      .select()
      .from(friendships)
      .where(and(eq(friendships.userA, low), eq(friendships.userB, high)))
      .limit(1);

    if (!row) throw new NotFoundException('friendship not found');

    await this.db
      .delete(friendships)
      .where(and(eq(friendships.userA, low), eq(friendships.userB, high)));

    this.events.emit('friend.removed', { userId, otherUserId });
    return { ok: true as const };
  }

  /**
   * AC-04-01: personal friend list (accepted only).
   * Pending requests live on a separate endpoint to keep the UX shapes clean.
   */
  async list(input: ListInput) {
    const { userId } = input;
    const rows = await this.db
      .select({
        friendshipId: friendships.id,
        userA: friendships.userA,
        userB: friendships.userB,
        status: friendships.status,
        acceptedAt: friendships.acceptedAt,
      })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, 'accepted'),
          or(eq(friendships.userA, userId), eq(friendships.userB, userId)),
        ),
      );

    return rows.map((r) => ({
      id: r.friendshipId,
      friendId: r.userA === userId ? r.userB : r.userA,
      acceptedAt: r.acceptedAt,
    }));
  }

  /**
   * Friend-pair gate used by MessagesService before any `upsertDmChannel`.
   * Returns true only when an `accepted` friendships row exists for the
   * canonical pair. Self-pair is meaningless here — the service-level
   * self-DM guard catches it earlier — but we still short-circuit to false
   * so a misuse never returns a phantom "friend with self".
   *
   * Implements the `IsFriendChecker` port declared in
   * `messages/messages.types.ts`.
   */
  async isFriends(userA: number, userB: number): Promise<boolean> {
    if (userA === userB) return false;
    const { low, high } = pair(userA, userB);
    const rows = await this.db
      .select({ id: friendships.id })
      .from(friendships)
      .where(
        and(
          eq(friendships.userA, low),
          eq(friendships.userB, high),
          eq(friendships.status, 'accepted'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async listPending(input: ListInput) {
    const { userId } = input;
    const rows = await this.db
      .select({
        id: friendships.id,
        userA: friendships.userA,
        userB: friendships.userB,
        requestedBy: friendships.requestedBy,
        requestText: friendships.requestText,
        createdAt: friendships.createdAt,
      })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, 'pending'),
          or(eq(friendships.userA, userId), eq(friendships.userB, userId)),
        ),
      );

    return rows.map((r) => ({
      id: r.id,
      requesterId: r.requestedBy,
      otherUserId: r.requestedBy === r.userA ? r.userA : r.userB,
      incoming: r.requestedBy !== userId,
      requestText: r.requestText,
      createdAt: r.createdAt,
    }));
  }
}
