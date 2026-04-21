import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { userSessions } from '../../database/schema';
import {
  RecordLoginInput,
  RevokeInput,
  SessionRow,
  SessionsRepositoryPort,
} from './sessions.types';

/**
 * Drizzle adapter for SessionsRepositoryPort (EPIC-02 §2.2.4).
 *
 * The `user_sessions` partial index `(user_id) WHERE revoked_at IS NULL`
 * makes the listActive scan a hot-path index lookup. Revocation flips
 * `revoked_at` rather than deleting so the row remains visible to audit
 * + admin-side review (planned for EPIC-12).
 */
@Injectable()
export class DrizzleSessionsRepository implements SessionsRepositoryPort {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  async insertOnLogin(input: RecordLoginInput): Promise<SessionRow> {
    const id = input.id ?? randomUUID();
    const [row] = await this.db
      .insert(userSessions)
      .values({
        id,
        userId: input.userId,
        userAgent: input.userAgent ?? null,
        ip: input.ip ?? null,
      })
      .returning();
    if (!row) throw new Error('sessions.insertOnLogin: insert returned no rows');
    return toSessionRow(row);
  }

  async listForUser(userId: number): Promise<SessionRow[]> {
    const rows = await this.db
      .select()
      .from(userSessions)
      .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
      .orderBy(desc(userSessions.lastSeenAt));
    return rows.map(toSessionRow);
  }

  async revoke(input: RevokeInput): Promise<{ revoked: boolean }> {
    const updated = await this.db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(userSessions.id, input.id),
          eq(userSessions.userId, input.userId),
          isNull(userSessions.revokedAt),
        ),
      )
      .returning({ id: userSessions.id });
    return { revoked: updated.length > 0 };
  }
}

function toSessionRow(r: typeof userSessions.$inferSelect): SessionRow {
  return {
    id: r.id,
    userId: r.userId,
    userAgent: r.userAgent ?? null,
    ip: r.ip ?? null,
    createdAt: r.createdAt,
    lastSeenAt: r.lastSeenAt,
    revokedAt: r.revokedAt ?? null,
  };
}
