import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { JwtGuard } from '../../common/guards/jwt.guard';

interface AuthedRequest {
  user?: { id?: number; sub?: number };
}

function getUserId(req: AuthedRequest): number {
  const raw = req.user?.id ?? req.user?.sub;
  if (typeof raw !== 'number') throw new UnauthorizedException();
  return raw;
}

@Controller('rooms')
@UseGuards(JwtGuard)
export class RoomsController {
  constructor(private readonly service: RoomsService) {}

  /** Public catalog (AC-05-03 / AC-05-04). Unlike the other endpoints this
   *  still requires an authenticated user — anon access is not in scope. */
  @Get('catalog')
  catalog() {
    return this.service.catalog();
  }

  /** Rooms the caller is a member of (AC-05-12 index-backed). */
  @Get('my')
  listMy(@Req() req: AuthedRequest) {
    return this.service.listMy(getUserId(req));
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateRoomDto, @Req() req: AuthedRequest) {
    return this.service.create({
      ownerId: getUserId(req),
      name: dto.name,
      visibility: dto.visibility,
      description: dto.description,
    });
  }

  @Post(':id/join')
  @HttpCode(204)
  async join(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    await this.service.join({ userId: getUserId(req), roomId: id });
  }

  @Post(':id/leave')
  @HttpCode(204)
  async leave(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    await this.service.leave({ userId: getUserId(req), roomId: id });
  }

  @Post(':id/invitations')
  @HttpCode(201)
  invite(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: InviteUserDto,
    @Req() req: AuthedRequest,
  ) {
    return this.service.invite({
      inviterId: getUserId(req),
      inviteeId: dto.invitedUserId,
      roomId: id,
    });
  }
}
