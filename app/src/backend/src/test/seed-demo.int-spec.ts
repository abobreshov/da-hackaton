/**
 * Integration test for `scripts/seed-demo.ts`.
 *
 * Seeds the two required users directly (auth-service owns the `users` table
 * in prod; here we use the harness's minimal DDL bootstrap + manual inserts),
 * then runs `seedDemo()` against a real Postgres container and asserts:
 *   - rooms: #general, #random, #demo all created
 *   - memberships: admin is owner of all three, user is in #general + #random
 *     but NOT in #demo
 *   - friendship: admin ↔ user, status accepted
 *   - messages: 8 per room, with at least one reply and one edited row in #demo
 *   - second run is idempotent (no new rooms / memberships / messages)
 */

import { and, eq, inArray, sql } from 'drizzle-orm';

import { seedDemo } from '../../scripts/seed-demo';
import { startTestStack } from './integration-harness';
import {
  users,
  rooms,
  roomMemberships,
  friendships,
  messages,
} from '../database/schema';

describe('seed-demo integration', () => {
  let connectionString: string;
  let adminId: number;
  let userId: number;

  beforeAll(async () => {
    const { db } = await startTestStack();
    connectionString = db.connectionString;

    // Create the two users seed-demo expects. Auth-service owns these in prod.
    const [admin] = await db.drizzle
      .insert(users)
      .values({
        email: 'admin@example.com',
        name: 'Dev Admin',
        role: 'ADMIN',
      })
      .returning({ id: users.id });
    const [user] = await db.drizzle
      .insert(users)
      .values({
        email: 'user@example.com',
        name: 'Dev User',
        role: 'USER',
      })
      .returning({ id: users.id });
    adminId = admin.id;
    userId = user.id;
  }, 120_000);

  it('creates rooms, memberships, friendship, and messages on first run', async () => {
    const result = await seedDemo(connectionString);

    expect(result.roomsCreated).toBe(3);
    // admin in 3 rooms + user in 2 rooms = 5 memberships
    expect(result.membershipsCreated).toBe(5);
    expect(result.friendshipsCreated).toBe(1);
    // 8 messages per room * 3 rooms
    expect(result.messagesCreated).toBe(24);
    expect(result.skipped).toBe(false);

    const { db } = await startTestStack();

    // Rooms
    const roomRows = await db.drizzle
      .select()
      .from(rooms)
      .where(inArray(rooms.name, ['general', 'random', 'demo']));
    expect(roomRows).toHaveLength(3);
    for (const r of roomRows) {
      expect(r.visibility).toBe('public');
      expect(r.ownerId).toBe(adminId);
    }

    // Memberships: admin owner everywhere, user only in general + random
    const adminMemberships = await db.drizzle
      .select()
      .from(roomMemberships)
      .where(eq(roomMemberships.userId, adminId));
    expect(adminMemberships).toHaveLength(3);
    for (const m of adminMemberships) {
      expect(m.role).toBe('owner');
    }

    const userMemberships = await db.drizzle
      .select()
      .from(roomMemberships)
      .where(eq(roomMemberships.userId, userId));
    expect(userMemberships).toHaveLength(2);
    for (const m of userMemberships) {
      expect(m.role).toBe('member');
    }
    const userRoomIds = new Set(userMemberships.map((m) => m.roomId));
    const demoRoom = roomRows.find((r) => r.name === 'demo')!;
    expect(userRoomIds.has(demoRoom.id)).toBe(false);

    // Friendship — accepted, canonical order
    const friendRows = await db.drizzle.select().from(friendships);
    expect(friendRows).toHaveLength(1);
    expect(friendRows[0].status).toBe('accepted');
    expect(friendRows[0].acceptedAt).not.toBeNull();
    const [lo, hi] = adminId < userId ? [adminId, userId] : [userId, adminId];
    expect(friendRows[0].userA).toBe(lo);
    expect(friendRows[0].userB).toBe(hi);

    // Messages — 8 per room
    for (const r of roomRows) {
      const rows = await db.drizzle
        .select()
        .from(messages)
        .where(eq(messages.roomId, r.id));
      expect(rows).toHaveLength(8);
    }

    // At least one reply and one edited message exist in #demo
    const demoMessages = await db.drizzle
      .select()
      .from(messages)
      .where(eq(messages.roomId, demoRoom.id));
    expect(demoMessages.some((m) => m.replyTo !== null)).toBe(true);
    expect(demoMessages.some((m) => m.editedAt !== null)).toBe(true);
  }, 120_000);

  it('is idempotent on a second run', async () => {
    const result = await seedDemo(connectionString);

    expect(result.roomsCreated).toBe(0);
    expect(result.membershipsCreated).toBe(0);
    expect(result.friendshipsCreated).toBe(0);
    expect(result.messagesCreated).toBe(0);
    expect(result.skipped).toBe(true);

    const { db } = await startTestStack();
    // Exactly 24 messages total — no duplicates inserted.
    const total = await db.drizzle
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(messages)
      .where(
        and(
          inArray(
            messages.roomId,
            (
              await db.drizzle
                .select({ id: rooms.id })
                .from(rooms)
                .where(inArray(rooms.name, ['general', 'random', 'demo']))
            ).map((r) => r.id),
          ),
        ),
      );
    expect(total[0].count).toBe(24);
  }, 120_000);
});
