import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user';
import { FriendsService } from './friends.service';
import { FriendRequestDto } from './dto/friend-request.dto';

/**
 * HTTP surface for friend graph. Bound at `/api/v1/friends` via the BFF's
 * HTTP proxy; the backend itself mounts the controller at `/friends` and the
 * BFF rewrites the path.
 */
@Controller('friends')
@UseGuards(JwtGuard)
export class FriendsController {
  constructor(private readonly service: FriendsService) {}

  @Get()
  list(@CurrentUser() user: { id: number }) {
    return this.service.list({ userId: user.id });
  }

  @Get('pending')
  pending(@CurrentUser() user: { id: number }) {
    return this.service.listPending({ userId: user.id });
  }

  @Post('request')
  @HttpCode(201)
  request(@CurrentUser() user: { id: number }, @Body() dto: FriendRequestDto) {
    return this.service.request({
      requesterId: user.id,
      targetUsername: dto.username,
      text: dto.text,
    });
  }

  @Post('requests/:id/accept')
  @HttpCode(204)
  async accept(
    @CurrentUser() user: { id: number },
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.service.accept({ userId: user.id, requestId: id });
  }

  @Post('requests/:id/reject')
  @HttpCode(204)
  async reject(
    @CurrentUser() user: { id: number },
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.service.reject({ userId: user.id, requestId: id });
  }

  @Delete(':userId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: { id: number },
    @Param('userId', ParseIntPipe) otherUserId: number,
  ) {
    await this.service.remove({ userId: user.id, otherUserId });
  }
}
