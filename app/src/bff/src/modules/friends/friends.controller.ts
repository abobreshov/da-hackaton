import {
  Body,
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
import { FriendsService } from './friends.service';
import { FriendRequestDto } from './dto/friend-request.dto';
import { SessionGuard } from '../../auth/session.guard';
import { ThrottleGuard } from '../../common/guards/throttle.guard';
import { Throttle } from '../../common/decorators/throttle.decorator';
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
 * User-facing friend graph surface. Mirrors the backend HTTP controller at
 * `/friends` but speaks TCP to the backend via {@link FriendsService}.
 */
@Controller('friends')
@UseGuards(SessionGuard)
export class FriendsController {
  constructor(private readonly service: FriendsService) {}

  /**
   * Returns the FE-facing `FriendsResponse` envelope (accepted friends +
   * pending requests in both directions, usernames hydrated). Aggregation
   * lives in {@link FriendsService.listEnvelope}.
   */
  @Get()
  list(@Req() req: SessionRequest) {
    return this.service.listEnvelope({ userId: getUserId(req) });
  }

  @Get('pending')
  listPending(@Req() req: SessionRequest) {
    return this.service.listPending({ userId: getUserId(req) });
  }

  @Post('request')
  @HttpCode(201)
  // AC-14-13 — spam suppression: 20 friend-requests per hour per user.
  // Fail-open: Redis outage must not block social actions; this is advisory,
  // not a security boundary like login/reset.
  @UseGuards(ThrottleGuard)
  @Throttle({
    scope: 'friend-req',
    limit: 20,
    windowMs: 3_600_000,
    failClosed: false,
    keyFn: (req: any) => req?.session?.sub ?? 'ip:unknown',
  })
  request(@Body() dto: FriendRequestDto, @Req() req: SessionRequest) {
    return this.service.request({
      requesterId: getUserId(req),
      targetUsername: dto.username,
      text: dto.text,
    });
  }

  @Post('requests/:id/accept')
  @HttpCode(204)
  async accept(@Param('id', ParseIntPipe) id: number, @Req() req: SessionRequest) {
    await this.service.accept({ userId: getUserId(req), requestId: id });
  }

  @Post('requests/:id/reject')
  @HttpCode(204)
  async reject(@Param('id', ParseIntPipe) id: number, @Req() req: SessionRequest) {
    await this.service.reject({ userId: getUserId(req), requestId: id });
  }

  @Delete(':userId')
  @HttpCode(204)
  async remove(@Param('userId', ParseIntPipe) otherUserId: number, @Req() req: SessionRequest) {
    await this.service.remove({ userId: getUserId(req), otherUserId });
  }
}
