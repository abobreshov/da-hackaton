import {
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
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { SessionGuard } from '../../auth/session.guard';

interface SessionRequest {
  session?: { userId?: number; type?: string };
}

function getUserId(req: SessionRequest): number {
  const raw = req.session?.userId;
  if (typeof raw !== 'number') {
    // SessionGuard guarantees req.session is present for user flows; this is
    // defence-in-depth in case an admin session hits a user-scoped endpoint.
    throw new Error('no userId in session');
  }
  return raw;
}

@Controller('rooms')
@UseGuards(SessionGuard)
export class RoomsController {
  constructor(private readonly service: RoomsService) {}

  /** Public catalog — auth required, but no per-user filter. */
  @Get('catalog')
  catalog() {
    return this.service.catalog();
  }

  /** Rooms the caller is a member of. */
  @Get('my')
  listMy(@Req() req: SessionRequest) {
    return this.service.listMy(getUserId(req));
  }

  @Post()
  @HttpCode(201)
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
      roomId: id,
    });
  }
}
