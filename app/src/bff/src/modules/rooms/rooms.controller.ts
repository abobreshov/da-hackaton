import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
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
  // SessionGuard guarantees req.session is present for user flows; this is
  // defence-in-depth in case an admin session hits a user-scoped endpoint.
  if (type !== 'user') throw new Error('no userId in session');
  return numericId;
}

@Controller('rooms')
@UseGuards(SessionGuard)
export class RoomsController {
  constructor(private readonly service: RoomsService) {}

  /** Public catalog — auth required, but no per-user filter. Wraps the
   *  backend's raw `RoomRow[]` into the `{rooms, total}` envelope the FE
   *  (`lib/rooms.ts: RoomsCatalogResponse`) expects, projected down to the
   *  4 fields `CatalogRoom` exposes. `memberCount` is defaulted to `0` until
   *  the backend gains a counted query — the FE renders "0 members" rather
   *  than crashing on `undefined`. */
  @Get('catalog')
  async catalog(): Promise<{
    rooms: Array<{
      id: number;
      name: string;
      description: string | null;
      memberCount: number;
    }>;
    total: number;
  }> {
    const raw = (await this.service.catalog()) as Array<{
      id: number;
      name: string;
      description?: string | null;
      memberCount?: number | null;
    }> | null;
    const list = Array.isArray(raw) ? raw : [];
    const rooms = list.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? null,
      memberCount: typeof r.memberCount === 'number' ? r.memberCount : 0,
    }));
    return { rooms, total: rooms.length };
  }

  /** Rooms the caller is a member of. */
  @Get('my')
  listMy(@Req() req: SessionRequest) {
    return this.service.listMy(getUserId(req));
  }

  @Post()
  @HttpCode(201)
  // AC-14-13 — spam suppression: 10 room-creates per hour per user.
  // Fail-open (advisory, not security-critical).
  @UseGuards(ThrottleGuard)
  @Throttle({
    scope: 'room-create',
    limit: 10,
    windowMs: 3_600_000,
    failClosed: false,
    keyFn: (req: any) => req?.session?.sub ?? 'ip:unknown',
  })
  create(@Body() dto: CreateRoomDto, @Req() req: SessionRequest) {
    return this.service.create({
      ownerId: getUserId(req),
      name: dto.name,
      visibility: dto.visibility,
      description: dto.description,
    });
  }

  @Post(':id/join')
  @HttpCode(204)
  async join(@Param('id', ParseIntPipe) id: number, @Req() req: SessionRequest) {
    await this.service.join({ userId: getUserId(req), roomId: id });
  }

  @Post(':id/leave')
  @HttpCode(204)
  async leave(@Param('id', ParseIntPipe) id: number, @Req() req: SessionRequest) {
    await this.service.leave({ userId: getUserId(req), roomId: id });
  }

  @Post(':id/invitations')
  @HttpCode(201)
  invite(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: InviteUserDto,
    @Req() req: SessionRequest,
  ) {
    return this.service.invite({
      inviterId: getUserId(req),
      inviteeId: dto.invitedUserId,
      username: dto.username,
      roomId: id,
    });
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoomDto,
    @Req() req: SessionRequest,
  ) {
    return this.service.update({
      roomId: id,
      actorId: getUserId(req),
      patch: {
        name: dto.name,
        description: dto.description,
        visibility: dto.visibility,
      },
    });
  }
}
