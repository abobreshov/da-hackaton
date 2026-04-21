import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { SessionGuard } from '../../auth/session.guard';
import { parseSub } from '../../auth/cookie.service';

interface SessionRequest {
  session?: { sub?: string; type?: string };
}

function getUserId(req: SessionRequest): number {
  const sub = req.session?.sub;
  if (!sub) throw new Error('no userId in session');
  const { type, numericId } = parseSub(sub);
  if (type !== 'user') throw new Error('no userId in session');
  return numericId;
}

/**
 * Backend `SessionRow` shape, plus the FE-facing fields the controller
 * surfaces. Kept inline (not imported) so the BFF doesn't reach into backend
 * source. Date instances or ISO strings are both tolerated on the wire — the
 * mapper normalises to ISO string.
 */
interface BackendSessionRow {
  id: string;
  userId: number;
  userAgent: string | null;
  ip: string | null;
  createdAt: string | Date;
  lastSeenAt: string | Date;
  revokedAt: string | Date | null;
}

interface SessionSummary {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

function isoString(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : v;
}

/**
 * Active-sessions surface (EPIC-02 §2.2.4 / T26 BFF half). Lets a user see
 * every device currently logged in under their account and revoke any one
 * of them. The `id` here is the server-minted UUID stored in `user_sessions`
 * (cookie-addressable, not enumerable) — NOT the numeric user id, so the
 * route param stays a string and skips `ParseIntPipe`.
 *
 * Global prefix `api/v1` is applied by `main.ts`.
 */
@Controller('sessions')
@UseGuards(SessionGuard)
export class SessionsController {
  constructor(private readonly service: SessionsService) {}

  /**
   * FE-facing active-sessions snapshot — wraps backend `SessionRow[]` into
   * `{ sessions: SessionSummary[] }` matching `frontend/src/lib/sessions.ts`.
   * Drops backend-internal fields (`userId`, `revokedAt`) and adds `current`.
   *
   * `current` is hard-coded to `false` until the BFF embeds the session id in
   * the session cookie (see `backend/.../sessions.types.ts` — "next slice").
   * Once `req.session.sid` lands, flip the row whose `id === sid` to `true`.
   */
  @Get()
  async list(@Req() req: SessionRequest): Promise<{ sessions: SessionSummary[] }> {
    const raw = (await this.service.listForUser(getUserId(req))) as
      | { sessions?: BackendSessionRow[] }
      | BackendSessionRow[]
      | null
      | undefined;
    const rows: BackendSessionRow[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.sessions)
        ? raw!.sessions!
        : [];
    const sessions: SessionSummary[] = rows.map((r) => ({
      id: r.id,
      userAgent: r.userAgent,
      ip: r.ip,
      createdAt: isoString(r.createdAt),
      lastSeenAt: isoString(r.lastSeenAt),
      current: false,
    }));
    return { sessions };
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@Param('id') id: string, @Req() req: SessionRequest): Promise<void> {
    await this.service.revoke({ sessionId: id, userId: getUserId(req) });
  }
}
