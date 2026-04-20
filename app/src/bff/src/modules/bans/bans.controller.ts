import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BansService } from './bans.service';
import { SessionGuard } from '../../auth/session.guard';

interface SessionRequest {
  session?: { userId?: number; type?: string };
}

function getUserId(req: SessionRequest): number {
  const raw = req.session?.userId;
  if (typeof raw !== 'number') {
    throw new Error('no userId in session');
  }
  return raw;
}

/**
 * BFF-facing user-to-user ban surface. Matches the backend's
 * `/users/:userId/ban` shape; BFF rewrites `/api/v1/...` → `/...` before the
 * TCP call.
 */
@Controller('users')
@UseGuards(SessionGuard)
export class BansController {
  constructor(private readonly service: BansService) {}

  @Post(':userId/ban')
  @HttpCode(200)
  ban(@Param('userId', ParseIntPipe) bannedId: number, @Req() req: SessionRequest) {
    return this.service.ban({ bannerId: getUserId(req), bannedId });
  }

  @Delete(':userId/ban')
  @HttpCode(204)
  async unban(@Param('userId', ParseIntPipe) bannedId: number, @Req() req: SessionRequest) {
    await this.service.unban({ bannerId: getUserId(req), bannedId });
  }

  /**
   * Self-only view of a user's own banlist. Asserts `:userId === session.userId`
   * so you can't probe someone else's banlist via URL guessing.
   */
  @Get(':userId/bans')
  list(@Param('userId', ParseIntPipe) userId: number, @Req() req: SessionRequest) {
    if (userId !== getUserId(req)) {
      throw new ForbiddenException('can only view your own banlist');
    }
    return this.service.listBans({ userId });
  }
}
