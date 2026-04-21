import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { friendships, roomMemberships, users } from '../../database/schema';
import { PresenceService } from '../presence/presence.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly presence: PresenceService,
  ) {}

  async findAll() {
    return this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        accessStatus: users.accessStatus,
        createdAt: users.createdAt,
      })
      .from(users);
  }

  async findById(id: number) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  /**
   * Bulk lookup — returns one `{id, name}` row per existing id. Missing ids
   * are silently dropped; callers MUST handle the gap (typically by
   * substituting a placeholder username). Empty input short-circuits to `[]`
   * to avoid a degenerate `WHERE id IN ()` query.
   */
  async findByIds(ids: number[]): Promise<Array<{ id: number; name: string }>> {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    // De-dup + drop non-positive ids before hitting the DB.
    const cleaned = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
    if (cleaned.length === 0) return [];
    return this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, cleaned));
  }

  /**
   * Case-insensitive username lookup. Returns the row or `null` when no match
   * exists — callers (BFF invite flow, ADR-005) use `null` to implement
   * fail-silent enumeration-safe invites, so we deliberately do NOT throw on
   * miss. Empty / whitespace-only input is still rejected up front to prevent
   * a degenerate `WHERE lower(name) = ''` scan.
   *
   * The query uses the `users_name_lower_idx` functional index
   * (`lower(name)`) added in `drizzle/0010_*.sql` — matches regardless of how
   * the caller cased the needle.
   */
  async findByUsername(username: string) {
    const trimmed = (username ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('username must not be empty');
    }
    const [user] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.name}) = lower(${trimmed})`)
      .limit(1);
    return user ?? null;
  }

  /**
   * Autocomplete backend for the FE "add friend" flow. Returns at most
   * `limit` users whose `name` starts with `q` (case-insensitive). The
   * caller's own id is filtered out so the dropdown never surfaces the
   * logged-in user. Empty / whitespace `q` short-circuits to an empty list
   * rather than scanning the whole table.
   *
   * Rows come back ordered alphabetically so the dropdown is stable as the
   * user types. Uses the same `users_name_lower_idx` functional index as
   * `findByUsername` — prefix matches stay index-backed.
   */
  async searchByUsernamePrefix(
    q: string,
    excludeUserId: number | null,
    limit: number,
  ): Promise<Array<{ id: number; name: string }>> {
    const trimmed = (q ?? '').trim();
    if (!trimmed) return [];
    // Hard-cap the limit server-side even when the caller doesn't; keeps a
    // misbehaving client from pulling the whole directory.
    const cappedLimit = Math.min(Math.max(Number(limit) || 8, 1), 25);
    const needle = trimmed.toLowerCase().replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
    const where = excludeUserId
      ? and(sql`lower(${users.name}) like ${`${needle}%`}`, ne(users.id, excludeUserId))
      : sql`lower(${users.name}) like ${`${needle}%`}`;
    return this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(where)
      .orderBy(asc(sql`lower(${users.name})`))
      .limit(cappedLimit);
  }

  /**
   * Cascade cleanup after `auth-service.deleteAccount` has soft-deleted
   * the users row. Must be safe to retry (idempotent) — auth-service
   * fires-and-forgets this RPC, so the worst case is the same userId
   * landing here twice. Every statement uses `where userId = $1` so a
   * second run is a no-op.
   *
   * Cleaned up:
   *   - Friendships (both directions, any status).
   *   - Room memberships — the deleted user disappears from every room
   *     they were in. Rooms they owned stay (separate "orphan room"
   *     policy; MVP treats that as a manual moderator cleanup).
   *   - Presence hashes — so the FE presence map flips to `offline`
   *     within one fanout tick instead of lingering at `afk` until
   *     the 3-minute offline-threshold prune.
   *
   * DMs are NOT mutated here: `messaging.dm_channels` is keyed by the
   * users the DM belongs to and surface-level permissions are enforced
   * on send (FRIEND_REQUIRED). Once the friendship row is gone the next
   * DM send from the peer will 403 as FRIEND_REQUIRED, which is the
   * correct surface.
   */
  async cascadeDelete(userId: number): Promise<void> {
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new BadRequestException('userId must be a positive integer');
    }
    try {
      await this.db
        .delete(friendships)
        .where(or(eq(friendships.userA, userId), eq(friendships.userB, userId)));
    } catch (e) {
      this.logger.warn(`cascade friendships delete failed: ${(e as Error).message}`);
    }
    try {
      await this.db.delete(roomMemberships).where(eq(roomMemberships.userId, userId));
    } catch (e) {
      this.logger.warn(`cascade roomMemberships delete failed: ${(e as Error).message}`);
    }
    try {
      await this.presence.purge(userId);
    } catch (e) {
      this.logger.warn(`cascade presence purge failed: ${(e as Error).message}`);
    }
  }
}
