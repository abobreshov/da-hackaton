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

  @Get()
  list(@Req() req: SessionRequest) {
    return this.service.listForUser(getUserId(req));
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@Param('id') id: string, @Req() req: SessionRequest): Promise<void> {
    await this.service.revoke({ sessionId: id, userId: getUserId(req) });
  }
}
