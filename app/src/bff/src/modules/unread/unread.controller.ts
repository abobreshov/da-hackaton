import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UnreadService } from './unread.service';
import { MarkReadDto } from './dto/mark-read.dto';
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
 * User-facing unread surface (EPIC-09). Owns three routes mounted next to
 * `rooms` and `dms` so callers can mark a scope read in the same shape they
 * paginated it, plus a single `/unread` aggregate for the sidebar badge.
 *
 * Global prefix `api/v1` is applied by `main.ts` — the paths here are the
 * resource-relative portion.
 */
@Controller()
@UseGuards(SessionGuard)
export class UnreadController {
  constructor(private readonly service: UnreadService) {}

  @Post('rooms/:id/read')
  @HttpCode(204)
  async markReadRoom(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkReadDto,
    @Req() req: SessionRequest,
  ): Promise<void> {
    await this.service.markReadRoom({
      userId: getUserId(req),
      roomId: id,
      lastReadId: dto.lastReadId,
    });
  }

  @Post('dms/:userId/read')
  @HttpCode(204)
  async markReadDm(
    @Param('userId', ParseIntPipe) peerUserId: number,
    @Body() dto: MarkReadDto,
    @Req() req: SessionRequest,
  ): Promise<void> {
    const me = getUserId(req);
    if (me === peerUserId) {
      // Self-DM is not a valid scope; the backend would resolve to null
      // anyway, but we short-circuit here so upstream stays untouched.
      throw new BadRequestException('cannot mark your own DM as read');
    }
    await this.service.markReadDm({
      userId: me,
      dmUserId: peerUserId,
      lastReadId: dto.lastReadId,
    });
  }

  @Get('unread')
  getForUser(@Req() req: SessionRequest) {
    return this.service.getForUser(getUserId(req));
  }
}
