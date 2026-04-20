import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { roomBans, roomMemberships, rooms } from '../../database/schema';
import {
  BanMemberRepoInput,
  ModerationRepositoryPort,
  Role,
  RoomBanRow,
} from './moderation.types';

/**
 * Drizzle adapter for `ModerationRepositoryPort`. Owns every Drizzle call
 * the moderation domain needs so `ModerationService` stays free of schema
 * + query-builder concerns.
 *
 * `banMember` runs the ban-insert + membership-delete inside a single
 * transaction — the table snapshot must never contain both the ban row
 * and the membership row simultaneously (AC-06-05/06/09). The Postgres
 * unique-violation (`23505`) is re-thrown unchanged so the service can
 * map it to a wire-level CONFLICT.
 */
@Injectable()
export class DrizzleModerationRepository implements ModerationRepositoryPort {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  async roleOf(roomId: number, userId: number): Promise<Role | null> {
    const rows = await (this.db as any)
      .select()
      .from(roomMemberships)
      .where(and(eq(roomMemberships.roomId, roomId), eq(roomMemberships.userId, userId)))
      .limit(1);
    return (rows[0]?.role as Role | undefined) ?? null;
  }

  async banMember(input: BanMemberRepoInput): Promise<void> {
    await (this.db as any).transaction(async (tx: any) => {
      await tx.insert(roomBans).values({
        roomId: input.roomId,
        userId: input.userId,
        bannedBy: input.bannedBy,
      });
      await tx
        .delete(roomMemberships)
        .where(
          and(
            eq(roomMemberships.roomId, input.roomId),
            eq(roomMemberships.userId, input.userId),
          ),
        );
    });
  }

  async unbanMember(roomId: number, userId: number): Promise<void> {
    await (this.db as any)
      .delete(roomBans)
      .where(and(eq(roomBans.roomId, roomId), eq(roomBans.userId, userId)));
  }

  async listBans(roomId: number): Promise<RoomBanRow[]> {
    const rows = await (this.db as any)
      .select()
      .from(roomBans)
      .where(eq(roomBans.roomId, roomId))
      .orderBy(desc(roomBans.bannedAt));
    return rows as RoomBanRow[];
  }

  async promoteMember(roomId: number, userId: number): Promise<void> {
    await (this.db as any)
      .update(roomMemberships)
      .set({ role: 'admin' })
      .where(and(eq(roomMemberships.roomId, roomId), eq(roomMemberships.userId, userId)));
  }

  async demoteMember(roomId: number, userId: number): Promise<void> {
    await (this.db as any)
      .update(roomMemberships)
      .set({ role: 'member' })
      .where(and(eq(roomMemberships.roomId, roomId), eq(roomMemberships.userId, userId)));
  }

  async deleteRoom(roomId: number, deletedAt: Date): Promise<void> {
    await (this.db as any)
      .update(rooms)
      .set({ deletedAt })
      .where(eq(rooms.id, roomId));
  }
}
