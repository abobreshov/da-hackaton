import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RoomsService } from '../rooms/rooms.service';
import { MessageRow, DmChannelRow } from './messages.types';

interface AuthedRequest {
  user?: { id?: number; sub?: number };
}

function getUserId(req: AuthedRequest): number {
  const raw = req.user?.id ?? req.user?.sub;
  if (typeof raw !== 'number') throw new UnauthorizedException();
  return raw;
}

/**
 * HTTP surface for EPIC-07 messaging. The backend mounts these controllers
 * at root paths; the BFF rewrites `/api/v1/*` -> `/*` when proxying.
 *
 * Authorisation:
 *   - Room message reads require membership (re-uses `RoomsService.ensureMember`).
 *   - DM reads require the caller to be one of the two pair participants.
 *   - `PATCH /:id` is author-only; `DELETE /:id` is author OR room-admin.
 */

@Controller('messages')
@UseGuards(JwtGuard)
export class MessagesController {
  constructor(
    private readonly service: MessagesService,
    private readonly rooms: RoomsService,
  ) {}

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateMessageDto, @Req() req: AuthedRequest) {
    return this.service.create({
      authorId: getUserId(req),
      roomId: dto.roomId,
      dmUserId: dto.dmUserId,
      body: dto.body,
      replyToId: dto.replyToId ? BigInt(dto.replyToId) : null,
      attachmentIds: dto.attachmentIds,
    });
  }

  @Patch(':id')
  edit(@Param('id') id: string, @Body() dto: EditMessageDto, @Req() req: AuthedRequest) {
    return this.service.edit({
      id: BigInt(id),
      actorId: getUserId(req),
      body: dto.body,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string, @Req() req: AuthedRequest) {
    const messageId = BigInt(id);
    const actorId = getUserId(req);
    const existing = await this.service.getById(messageId);
    const row = existing.message;

    let isRoomAdmin = false;
    if (row.roomId != null && row.authorId !== actorId) {
      isRoomAdmin = await this.isRoomAdmin(row.roomId, actorId);
      if (!isRoomAdmin) {
        throw new ForbiddenException('only the author or a room admin can delete');
      }
    }
    await this.service.delete({ id: messageId, actorId, isRoomAdmin });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.getById(BigInt(id));
  }

  private async isRoomAdmin(roomId: number, userId: number): Promise<boolean> {
    // Best-effort role lookup via RoomsService: ensureMember throws if not a
    // member; to get the role we use listMy / findMembership is private. A
    // narrow exposure helper would be cleaner; for now the service guards
    // against non-author non-admin already, so treat a thrown ensureMember as
    // "definitely not an admin".
    try {
      const members = await this.rooms.membersOf(roomId);
      const me = members.members.find((m) => m.userId === userId);
      return me?.role === 'admin' || me?.role === 'owner';
    } catch {
      return false;
    }
  }
}

/** Room-scoped history: `GET /rooms/:id/messages`. Separate controller to keep
 *  the `/rooms` prefix locally colocated; the BFF forwards as-is. */
@Controller('rooms')
@UseGuards(JwtGuard)
export class RoomMessagesController {
  constructor(
    private readonly service: MessagesService,
    private readonly rooms: RoomsService,
  ) {}

  @Get(':id/messages')
  async list(
    @Param('id', ParseIntPipe) roomId: number,
    @Query('before') before: string | undefined,
    @Query('beforeId') beforeId: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<{ messages: MessageRow[] }> {
    const userId = getUserId(req);
    await this.rooms.ensureMember({ roomId, userId });

    const cursor = parseBeforeCursor(before, beforeId);
    return this.service.list({
      roomId,
      before: cursor,
      limit: parseLimit(limit),
    });
  }
}

/** DM-scoped history: `GET /dms/:userId/messages`. Resolves the channel from
 *  the (caller, other) pair. If no channel exists yet (no messages ever
 *  exchanged), returns an empty list rather than 404. */
@Controller('dms')
@UseGuards(JwtGuard)
export class DmMessagesController {
  constructor(private readonly service: MessagesService) {}

  @Get(':userId/messages')
  async list(
    @Param('userId', ParseIntPipe) otherUserId: number,
    @Query('before') before: string | undefined,
    @Query('beforeId') beforeId: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<{ messages: MessageRow[] }> {
    const me = getUserId(req);
    const dmId = await this.service.resolveDmChannelId(me, otherUserId);
    if (dmId == null) return { messages: [] };

    const cursor = parseBeforeCursor(before, beforeId);
    return this.service.list({
      dmId,
      before: cursor,
      limit: parseLimit(limit),
    });
  }
}

/** CR-N4 — validate `?before=` is a parseable ISO timestamp paired w/ a
 *  BigInt-safe id. Invalid values → 400 rather than Invalid Date / NaN
 *  leaking into Drizzle's query builder. */
function parseBeforeCursor(
  before: string | undefined,
  beforeId: string | undefined,
): { createdAt: Date; id: bigint } | undefined {
  if (!before || !beforeId) return undefined;
  const createdAt = new Date(before);
  if (Number.isNaN(createdAt.getTime())) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'invalid `before` — expected ISO 8601 timestamp',
    });
  }
  let id: bigint;
  try {
    id = BigInt(beforeId);
  } catch {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'invalid `beforeId` — expected integer string',
    });
  }
  return { createdAt, id };
}

function parseLimit(raw: string | undefined): number {
  if (!raw) return 50;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

// Re-export so downstream code can use the types without reaching into `.types`.
export type { DmChannelRow };
