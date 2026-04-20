/**
 * Demo-data seed — EPIC-12 AC-12-10.
 *
 * Creates three public rooms (#general, #random, #demo), assigns memberships,
 * inserts an accepted admin ↔ user friendship (for DM demo), and writes sample
 * messages per room. Idempotent: re-running will not duplicate rooms,
 * memberships, friendships, or messages (messages are guarded by a per-room
 * sentinel body so the second run becomes a no-op).
 *
 * Preconditions:
 *   - Drizzle migrations applied (rooms, room_memberships, friendships,
 *     messages, dm_channels).
 *   - auth-service seed already ran (admin@example.com + user@example.com).
 *
 * Run: yarn workspace @app/backend seed:demo
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { and, eq, inArray, sql } from 'drizzle-orm';

import * as schema from '../src/database/schema';
import { users, rooms, roomMemberships, friendships, messages } from '../src/database/schema';

// Sentinel prefix to detect prior seed runs so message inserts stay idempotent.
const SEED_TAG = '[seed:demo]';

interface DemoMessage {
  author: 'admin' | 'user';
  body: string;
  reply?: number; // 0-based index of the message in this array to reply to
  edited?: boolean;
}

const ROOM_NAMES = ['general', 'random', 'demo'] as const;
type RoomName = (typeof ROOM_NAMES)[number];

const ROOM_DESCRIPTIONS: Record<RoomName, string> = {
  general: 'Welcome! Say hi.',
  random: 'Casual chat.',
  demo: 'Showcases reply / edit / delete / attachments.',
};

const ROOM_MESSAGES: Record<RoomName, DemoMessage[]> = {
  general: [
    { author: 'admin', body: `${SEED_TAG} Welcome to #general! This is where the team hangs out.` },
    { author: 'user', body: 'Hey everyone, glad to be here.' },
    { author: 'admin', body: 'Feel free to introduce yourself.' },
    { author: 'user', body: 'I work on frontend mostly.', reply: 2 },
    { author: 'admin', body: 'Nice — let us know if you need anything.' },
    { author: 'user', body: 'Will do. Thanks!' },
    { author: 'admin', body: 'Pinning the onboarding link in the topic.', edited: true },
    { author: 'user', body: 'Got it, reading now.' },
  ],
  random: [
    { author: 'admin', body: `${SEED_TAG} #random — memes, coffee talk, anything off-topic.` },
    { author: 'user', body: 'What is everyone watching this week?' },
    { author: 'admin', body: 'Catching up on a sci-fi series. Slow burn but worth it.' },
    { author: 'user', body: 'Recommend?', reply: 2 },
    { author: 'admin', body: 'Yeah, will DM you the name.' },
    { author: 'user', body: 'Coffee or tea, decide once and for all.' },
    { author: 'admin', body: 'Coffee in the morning, tea after 3pm. Compromise.' },
    { author: 'user', body: 'Diplomatic answer. Approved.' },
  ],
  demo: [
    {
      author: 'admin',
      body: `${SEED_TAG} #demo — walkthroughs for reviewers. Only admin here by default.`,
    },
    { author: 'admin', body: 'Messages support reply, edit, and soft-delete.' },
    { author: 'admin', body: 'This message is a reply to the one above.', reply: 1 },
    {
      author: 'admin',
      body: 'This message has been edited to show the "edited" label.',
      edited: true,
    },
    { author: 'admin', body: 'Attachments land here once EPIC-09 ships.' },
    { author: 'admin', body: 'Reactions arrive with EPIC-08.' },
    { author: 'admin', body: 'Keyset pagination: scroll up for older messages.' },
    { author: 'admin', body: 'End of demo tour. Exit through the gift shop.' },
  ],
};

export interface SeedDemoResult {
  roomsCreated: number;
  membershipsCreated: number;
  friendshipsCreated: number;
  messagesCreated: number;
  skipped: boolean;
}

export async function seedDemo(connectionString: string): Promise<SeedDemoResult> {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  try {
    // Look up pre-seeded users by email — auth-service seed owns this.
    const admin = await db.query.users.findFirst({
      where: eq(users.email, 'admin@example.com'),
    });
    const user = await db.query.users.findFirst({
      where: eq(users.email, 'user@example.com'),
    });

    if (!admin || !user) {
      throw new Error(
        'auth-service seed must run first — admin@example.com and user@example.com are required.',
      );
    }

    // 1) Rooms — upsert by unique name.
    let roomsCreated = 0;
    for (const name of ROOM_NAMES) {
      const inserted = await db
        .insert(rooms)
        .values({
          name,
          ownerId: admin.id,
          visibility: 'public',
          description: ROOM_DESCRIPTIONS[name],
        })
        .onConflictDoNothing({ target: rooms.name })
        .returning({ id: rooms.id });
      roomsCreated += inserted.length;
    }

    // Resolve the three rooms (whether newly inserted or pre-existing).
    const roomRows = await db
      .select()
      .from(rooms)
      .where(inArray(rooms.name, ROOM_NAMES as unknown as string[]));
    const roomsByName = new Map<RoomName, (typeof roomRows)[number]>();
    for (const r of roomRows) {
      if ((ROOM_NAMES as readonly string[]).includes(r.name)) {
        roomsByName.set(r.name as RoomName, r);
      }
    }

    // 2) Memberships.
    //    - admin is owner of every demo room
    //    - user joins #general and #random (not #demo, to show the "not a member" state)
    let membershipsCreated = 0;
    for (const name of ROOM_NAMES) {
      const room = roomsByName.get(name);
      if (!room) continue;

      const adminMembership = await db
        .insert(roomMemberships)
        .values({ roomId: room.id, userId: admin.id, role: 'owner' })
        .onConflictDoNothing()
        .returning({ roomId: roomMemberships.roomId });
      membershipsCreated += adminMembership.length;

      if (name !== 'demo') {
        const userMembership = await db
          .insert(roomMemberships)
          .values({ roomId: room.id, userId: user.id, role: 'member' })
          .onConflictDoNothing()
          .returning({ roomId: roomMemberships.roomId });
        membershipsCreated += userMembership.length;
      }
    }

    // 3) Friendship — admin ↔ user accepted (canonical order user_a < user_b).
    const [ua, ub] = admin.id < user.id ? [admin.id, user.id] : [user.id, admin.id];
    const friendshipInsert = await db
      .insert(friendships)
      .values({
        userA: ua,
        userB: ub,
        requestedBy: admin.id,
        status: 'accepted',
        acceptedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: friendships.id });
    const friendshipsCreated = friendshipInsert.length;

    // 4) Messages — skip entirely if any seed-tagged message already exists in
    //    any demo room (prior run). This keeps the script idempotent without
    //    tracking per-message uniqueness.
    const existing = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          inArray(
            messages.roomId,
            roomRows.map((r) => r.id),
          ),
          sql`${messages.body} LIKE ${SEED_TAG + '%'}`,
        ),
      )
      .limit(1);

    let messagesCreated = 0;
    let skipped = false;
    if (existing.length > 0) {
      skipped = true;
    } else {
      for (const name of ROOM_NAMES) {
        const room = roomsByName.get(name);
        if (!room) continue;

        // Track inserted ids within this room so `reply` indexes can resolve
        // to the actual bigserial message id.
        const insertedIds: bigint[] = [];

        for (const m of ROOM_MESSAGES[name]) {
          const authorId = m.author === 'admin' ? admin.id : user.id;
          const now = new Date();
          const replyToId =
            typeof m.reply === 'number' && insertedIds[m.reply] !== undefined
              ? insertedIds[m.reply]
              : null;

          const result = await db
            .insert(messages)
            .values({
              roomId: room.id,
              authorId,
              body: m.body,
              replyTo: replyToId,
              editedAt: m.edited ? now : null,
            })
            .returning({ id: messages.id });
          insertedIds.push(result[0].id);
          messagesCreated += 1;

          // Small gap so `created_at` differs per message for deterministic
          // chronological ordering in the UI.
          await new Promise((r) => setTimeout(r, 5));
        }
      }
    }

    return {
      roomsCreated,
      membershipsCreated,
      friendshipsCreated,
      messagesCreated,
      skipped,
    };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not set');
  }

  const result = await seedDemo(connectionString);

   
  console.log(
    `[seed:demo] rooms=+${result.roomsCreated} memberships=+${result.membershipsCreated} ` +
      `friendships=+${result.friendshipsCreated} messages=+${result.messagesCreated}` +
      (result.skipped ? ' (messages skipped — prior seed detected)' : ''),
  );
}

// Invoke only when executed directly (CLI), not when imported by tests.
if (require.main === module) {
  main().catch((err) => {
     
    console.error('[seed:demo] failed:', err);
    process.exit(1);
  });
}
