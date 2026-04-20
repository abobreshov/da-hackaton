import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { SessionGuard } from '../../auth/session.guard';
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

const DEFAULT_LIMIT = 50;

/**
 * User-facing message surface. Uses full paths rather than a single controller
 * prefix so the room-history and DM-history routes mount next to `rooms` and
 * `dms` trees while still owning all message mutation verbs.
 *
 * Global prefix `api/v1` is applied by `main.ts` — the paths here are already
 * the resource-relative portion.
 */
@Controller()
@UseGuards(SessionGuard)
export class MessagesController {
  constructor(private readonly service: MessagesService) {}

  @Post('messages')
  @HttpCode(201)
  create(@Body() dto: CreateMessageDto, @Req() req: SessionRequest) {
    return this.service.create({
      authorId: getUserId(req),
      roomId: dto.roomId,
      dmUserId: dto.dmUserId,
      body: dto.body,
      replyToId: dto.replyToId,
    });
  }

  @Get('rooms/:id/messages')
  listRoom(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.service.list({
      roomId: id,
      beforeCreatedAt: query.before,
      beforeId: query.beforeId,
      limit: query.limit ?? DEFAULT_LIMIT,
    });
  }

  @Get('dms/:userId/messages')
  listDm(
    @Param('userId', ParseIntPipe) userId: number,
    @Query() query: ListMessagesQueryDto,
    @Req() req: SessionRequest,
  ) {
    const me = getUserId(req);
    if (me === userId) {
      // Self-DM has no meaning; short-circuit with 400 so the backend never
      // sees a self-referencing thread id.
      throw new BadRequestException('cannot DM yourself');
    }
    return this.service.list({
      dmUserId: userId,
      beforeCreatedAt: query.before,
      beforeId: query.beforeId,
      limit: query.limit ?? DEFAULT_LIMIT,
    });
  }

  @Get('messages/:id')
  getById(@Param('id') id: string, @Req() req: SessionRequest) {
    return this.service.getById({
      messageId: id,
      actorId: getUserId(req),
    });
  }

  @Patch('messages/:id')
  edit(
    @Param('id') id: string,
    @Body() dto: EditMessageDto,
    @Req() req: SessionRequest,
  ) {
    return this.service.edit({
      messageId: id,
      actorId: getUserId(req),
      body: dto.body,
    });
  }

  @Delete('messages/:id')
  @HttpCode(204)
  async delete(@Param('id') id: string, @Req() req: SessionRequest) {
    await this.service.delete({
      messageId: id,
      actorId: getUserId(req),
    });
  }
}
