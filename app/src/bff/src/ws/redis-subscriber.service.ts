import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import Redis from 'ioredis';
import { RedisChannel } from '@app/contracts';

/**
 * Interest graph tracked per connected socket. A socket may subscribe to
 * N room channels (one per room it has joined) and watch the presence of
 * M users (its friends list + room members on open rooms).
 */
export interface SocketInterest {
  rooms: Set<string>;
  presenceOf: Set<number>;
}

/**
 * Reference-counted wrapper around a single ioredis SUBSCRIBE-mode client.
 *
 * Why ref count: two sockets on the same BFF replica joining `room:5`
 * must not issue two SUBSCRIBE commands — that would be wasteful and
 * Redis already multiplexes per-connection. We keep a `Map<channel, count>`
 * and only issue SUBSCRIBE on 0→1 transitions, UNSUBSCRIBE on 1→0.
 *
 * Filtering: the BFF subscribes to `presence:global` for the whole
 * server, but per-socket interest filters the fanout (AC-03-11). This
 * avoids every online user receiving every presence update.
 */
export const REDIS_SUB_CLIENT = Symbol('REDIS_SUB_CLIENT');

export type Emittable = { id: string; emit: (event: string, payload: any) => void };

@Injectable()
export class RedisSubscriberService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisSubscriberService.name);
  private readonly sockets = new Map<string, Emittable>();
  private readonly interest = new Map<string, SocketInterest>();
  /** channel → set of socketIds interested in that channel */
  private readonly channelSubscribers = new Map<string, Set<string>>();
  /** channel → open ref count (mirrors channelSubscribers.size but kept for clarity) */
  private readonly refCount = new Map<string, number>();
  private initialized = false;

  constructor(@Optional() @Inject(REDIS_SUB_CLIENT) private readonly sub?: Redis) {
    // Fallback client — overridden by provider factory in WsModule.
    if (!this.sub) {
      const host = process.env.REDIS_HOST ?? 'localhost';
      const port = Number(process.env.REDIS_PORT ?? 6379);
      this.sub = new Redis({ host, port, lazyConnect: false });
    }
  }

  onModuleInit(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.sub!.on('message', (channel, raw) => this.onMessage(channel, raw));
    this.sub!.on('error', (e) => this.logger.error(`redis sub error: ${e.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.sub?.quit();
    } catch {
      /* swallow — shutdown is best effort */
    }
  }

  // --- interest graph ----------------------------------------------------

  registerSocket(socket: Emittable): void {
    this.sockets.set(socket.id, socket);
    this.interest.set(socket.id, { rooms: new Set(), presenceOf: new Set() });
  }

  unregisterSocket(socketId: string): void {
    const interest = this.interest.get(socketId);
    if (interest) {
      // Release every held channel. Fire-and-forget — unsubscribeFor
      // handles ref count and async is irrelevant for cleanup.
      for (const channel of interest.rooms) {
        void this.unsubscribeFor(socketId, channel);
      }
      if (interest.presenceOf.size > 0) {
        void this.unsubscribeFor(socketId, RedisChannel.presenceGlobal);
      }
    }
    this.sockets.delete(socketId);
    this.interest.delete(socketId);
  }

  hasSocket(socketId: string): boolean {
    return this.sockets.has(socketId);
  }

  getInterest(socketId: string): SocketInterest | undefined {
    return this.interest.get(socketId);
  }

  // --- subscription primitives ------------------------------------------

  async subscribeFor(socketId: string, channel: string): Promise<void> {
    let subs = this.channelSubscribers.get(channel);
    if (!subs) {
      subs = new Set();
      this.channelSubscribers.set(channel, subs);
    }
    if (!subs.has(socketId)) {
      subs.add(socketId);
      const next = (this.refCount.get(channel) ?? 0) + 1;
      this.refCount.set(channel, next);
      if (next === 1) {
        await this.sub!.subscribe(channel);
      }
    }

    const interest = this.interest.get(socketId);
    if (interest && this.isRoomChannel(channel)) {
      interest.rooms.add(channel);
    }
  }

  async unsubscribeFor(socketId: string, channel: string): Promise<void> {
    const subs = this.channelSubscribers.get(channel);
    if (!subs || !subs.has(socketId)) return;
    subs.delete(socketId);
    const next = Math.max(0, (this.refCount.get(channel) ?? 0) - 1);
    this.refCount.set(channel, next);
    if (next === 0) {
      this.refCount.delete(channel);
      this.channelSubscribers.delete(channel);
      await this.sub!.unsubscribe(channel);
    }

    const interest = this.interest.get(socketId);
    if (interest) interest.rooms.delete(channel);
  }

  /**
   * Register interest in a list of user presences. Ensures the socket
   * is subscribed to `presence:global` (once per BFF) and tags the
   * interest set so fanout can filter.
   */
  async watchPresenceOf(socketId: string, userIds: Array<number | string>): Promise<void> {
    const interest = this.interest.get(socketId);
    if (!interest) return;
    for (const uid of userIds) interest.presenceOf.add(Number(uid));
    await this.subscribeFor(socketId, RedisChannel.presenceGlobal);
  }

  // --- message handling --------------------------------------------------

  private onMessage(channel: string, raw: string): void {
    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      this.logger.warn(`dropped malformed pub/sub payload on ${channel}`);
      return;
    }

    if (channel === RedisChannel.presenceGlobal) {
      this.fanoutPresence(payload);
      return;
    }

    this.fanoutChannel(channel, payload);
  }

  private fanoutPresence(payload: { userId?: number | string }): void {
    if (!payload || payload.userId == null) return;
    const uid = Number(payload.userId);
    for (const [socketId, interest] of this.interest.entries()) {
      if (!interest.presenceOf.has(uid)) continue;
      const socket = this.sockets.get(socketId);
      socket?.emit('presence.update', payload);
    }
  }

  private fanoutChannel(channel: string, payload: { event?: string; payload?: any } | any): void {
    const subs = this.channelSubscribers.get(channel);
    if (!subs || subs.size === 0) return;
    const event = payload?.event ?? channel;
    const body = payload?.payload ?? payload;
    for (const socketId of subs) {
      this.sockets.get(socketId)?.emit(event, body);
    }
  }

  private isRoomChannel(channel: string): boolean {
    return channel.startsWith('room:') || channel.startsWith('dm:') || channel.startsWith('user:');
  }
}
