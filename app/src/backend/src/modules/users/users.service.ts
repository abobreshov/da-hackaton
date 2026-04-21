import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { users } from '../../database/schema';

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

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
}
