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
      await this.publishUnreadChanged(event.peerUserId, { dmId: event.dmId });
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

    await Promise.all(
      members
        .filter((m) => m.userId !== authorId)
        .map((m) => this.publishUnreadChanged(m.userId, { roomId })),
    );
  }

  private async publishUnreadChanged(
    userId: number,
    scope: { roomId: number } | { dmId: number },
  ): Promise<void> {
    let count: number;
    try {
      count = await this.unread.countSince({ userId, ...scope });
    } catch (err) {
      this.logger.warn(`unread.subscriber countSince(${userId}) failed: ${(err as Error).message}`);
      return;
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
