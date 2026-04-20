import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { SessionGuard } from '../../auth/session.guard';
import { parseSub } from '../../auth/cookie.service';

interface SessionRequest {
  session?: { sub?: string; type?: string };
}

function getActorId(req: SessionRequest): number {
  const sub = req.session?.sub;
  if (!sub) throw new Error('no userId in session');
  const { type, numericId } = parseSub(sub);
  if (type !== 'user') throw new Error('no userId in session');
  return numericId;
}

/**
 * Room moderation surface. Covers EPIC-06 HTTP endpoints:
 *   POST   /rooms/:id/members/:userId/promote
 *   POST   /rooms/:id/members/:userId/demote
 *   DELETE /rooms/:id/members/:userId          (== ban)
 *   POST   /rooms/:id/bans/:userId/unban
 *   GET    /rooms/:id/bans
 *   DELETE /rooms/:id                           (owner-only delete)
 *
 * Every route is guarded by `SessionGuard`; the actor's identity (room owner /
 * moderator checks) is enforced on the backend, not here.
 */
@Controller('rooms')
@UseGuards(SessionGuard)
export class ModerationController {
  constructor(private readonly service: ModerationService) {}

  @Post(':id/members/:userId/promote')
  @HttpCode(204)
  async promote(
    @Param('id', ParseIntPipe) roomId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: SessionRequest,
  ) {
    await this.service.promote({ roomId, userId, actorId: getActorId(req) });
  }

  @Post(':id/members/:userId/demote')
  @HttpCode(204)
  async demote(
    @Param('id', ParseIntPipe) roomId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: SessionRequest,
  ) {
    await this.service.demote({ roomId, userId, actorId: getActorId(req) });
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  async banMember(
    @Param('id', ParseIntPipe) roomId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: SessionRequest,
  ) {
    await this.service.banMember({ roomId, userId, actorId: getActorId(req) });
  }

  @Post(':id/bans/:userId/unban')
  @HttpCode(204)
  async unbanMember(
    @Param('id', ParseIntPipe) roomId: number,
    @Param('userId', ParseIntPipe) userId: number,
    @Req() req: SessionRequest,
  ) {
    await this.service.unbanMember({ roomId, userId, actorId: getActorId(req) });
  }

  @Get(':id/bans')
  listBans(@Param('id', ParseIntPipe) roomId: number, @Req() req: SessionRequest) {
    return this.service.listBans({ roomId, actorId: getActorId(req) });
  }

  @Delete(':id')
  @HttpCode(204)
  async deleteRoom(@Param('id', ParseIntPipe) roomId: number, @Req() req: SessionRequest) {
    await this.service.deleteRoom({ roomId, actorId: getActorId(req) });
  }
}
