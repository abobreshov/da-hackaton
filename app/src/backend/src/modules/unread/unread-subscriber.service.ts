import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type IORedis from 'ioredis';
import { RedisChannel } from '@app/contracts';
import { EVENT_PUBLISHER, IEventPublisher } from '../../common/events/event-publisher.interface';
import { MESSAGE_CREATED_EVENT, type MessageCreatedEvent } from '../messages/messages.service';
import { RoomsService } from '../rooms/rooms.service';
import { TRANSPORT_REDIS_PUB } from '../transport/transport.tokens';
import { UnreadService } from './unread.service';

/**
 * EPIC-09 AC-09-04 — translate `message.created` domain events into
 * per-recipient `unread.changed` Redis PUBLISHes on `user:{id}`.
 *
 * Producer side (`MessagesService.create`) emits without knowing about
 * unread state; subscriber resolves recipients (room members minus author,
 * or the DM peer) and fans out a single PUBLISH per recipient. Counts come
 * from `UnreadService.countSince`, which already applies the 99 cap.
 *
 * Failure isolation: all errors are swallowed + logged. An unread fan-out
 * is a best-effort UX signal; it must never fail a message write.
 */
@Injectable()
export class UnreadSubscriber implements OnApplicationBootstrap {
  private readonly logger = new Logger(UnreadSubscriber.name);

  constructor(
    @Inject(EVENT_PUBLISHER)
    private readonly events: IEventPublisher,
    private readonly unread: UnreadService,
    private readonly rooms: RoomsService,
    @Inject(TRANSPORT_REDIS_PUB)
    private readonly redis: IORedis,
  ) {}

  onApplicationBootstrap(): void {
    this.events.on(MESSAGE_CREATED_EVENT, (payload) =>
      this.handle(payload as MessageCreatedEvent | null).catch((err) =>
        this.logger.warn(`unread.subscriber failed: ${(err as Error).message}`),
      ),
    );
  }

  private async handle(event: MessageCreatedEvent | null): Promise<void> {
    if (!event || typeof event !== 'object') return;

    if (event.scope === 'room') {
      if (typeof event.roomId !== 'number' || typeof event.authorId !== 'number') {
        return;
      }
      await this.handleRoom(event.roomId, event.authorId);
      return;
    }

    if (event.scope === 'dm') {
      if (
        typeof event.dmId !== 'number' ||
        typeof event.peerUserId !== 'number' ||
        typeof event.authorId !== 'number'
      ) {
        return;
      }
      // Self-DM doesn't exist in the domain (MessagesService rejects it),
      // but guard the subscriber too — a malformed event must never echo
      // back to the author as a pseudo-peer.
      if (event.peerUserId === event.authorId) return;
      // From the recipient's perspective, the other side of the DM is the
      // author — include it in the scope so FE can key its DM unread map
      // by peer userId without a dm_channels lookup.
      await this.publishUnreadChanged(event.peerUserId, {
        dmId: event.dmId,
        peerUserId: event.authorId,
      });
      return;
    }
  }

  private async handleRoom(roomId: number, authorId: number): Promise<void> {
    let members: Array<{ userId: number }>;
    try {
      const out = await this.rooms.membersOf(roomId);
      members = out.members;
    } catch (err) {
      this.logger.warn(`unread.subscriber membersOf(${roomId}) failed: ${(err as Error).message}`);
      return;
    }

    const recipients = members
      .filter((m) => m.userId !== authorId)
      .map((m) => m.userId);
    if (recipients.length === 0) return;

    // Single SQL round-trip for all recipients — replaces the prior
    // per-member countSince fan-out (M4 review HIGH deferral). Failure
    // here aborts the whole fan-out: an unread badge update is best-effort,
    // and a degraded DB shouldn't trigger N retries either.
    let counts: Array<{ userId: number; count: number }>;
    try {
      counts = await this.unread.countsSinceForRoomMembers(roomId, recipients);
    } catch (err) {
      this.logger.warn(
        `unread.subscriber countsSinceForRoomMembers(${roomId}) failed: ${(err as Error).message}`,
      );
      return;
    }

    await Promise.all(
      counts.map(({ userId, count }) =>
        this.publishUnreadChanged(userId, { roomId }, count),
      ),
    );
  }

  private async publishUnreadChanged(
    userId: number,
    scope: { roomId: number } | { dmId: number; peerUserId: number },
    precomputedCount?: number,
  ): Promise<void> {
    let count: number;
    if (typeof precomputedCount === 'number') {
      count = precomputedCount;
    } else {
      // UnreadService.countSince only needs { roomId } or { dmId } — strip
      // peerUserId before delegating (it's a client-addressing hint, not a
      // query input).
      const countScope: { roomId?: number; dmId?: number } =
        'roomId' in scope ? { roomId: scope.roomId } : { dmId: scope.dmId };
      try {
        count = await this.unread.countSince({ userId, ...countScope });
      } catch (err) {
        this.logger.warn(
          `unread.subscriber countSince(${userId}) failed: ${(err as Error).message}`,
        );
        return;
      }
    }

    const payload = JSON.stringify({
      event: 'unread.changed',
      scope,
      count,
    });
    try {
      await this.redis.publish(RedisChannel.user(userId), payload);
    } catch (err) {
      this.logger.warn(
        `unread.subscriber publish user:${userId} failed: ${(err as Error).message}`,
      );
    }
  }
}
