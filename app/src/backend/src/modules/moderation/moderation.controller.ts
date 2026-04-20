import {
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
import { ModerationService } from './moderation.service';

/**
 * HTTP-facing moderation endpoints. Mounted on the backend at `/rooms/...`
 * and proxied through the BFF at `/api/v1/rooms/...`.
 *
 * All endpoints require a JWT. Authorization (owner / admin / member)
 * is enforced inside the service against `room_memberships.role`.
 */
@Controller('rooms')
@UseGuards(JwtGuard)
export class ModerationController {
  constructor(private readonly service: ModerationService) {}

  @Post(':id/members/:userId/promote')
  @HttpCode(204)
  async promote(
    @CurrentUser() actor: { id: number },
    @Param('id', ParseIntPipe) roomId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    await this.service.promote({ roomId, actorId: actor.id, userId });
  }

  @Post(':id/members/:userId/demote')
  @HttpCode(204)
  async demote(
    @CurrentUser() actor: { id: number },
    @Param('id', ParseIntPipe) roomId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    await this.service.demote({ roomId, actorId: actor.id, userId });
  }

  /**
   * "Remove member" = ban (AC-06-05). DELETE semantic chosen because the
   * membership row is removed; the ban row is a side effect.
   */
  @Delete(':id/members/:userId')
  @HttpCode(204)
  async removeMember(
    @CurrentUser() actor: { id: number },
    @Param('id', ParseIntPipe) roomId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    await this.service.banMember({ roomId, adminId: actor.id, userId });
  }

  @Post(':id/bans/:userId/unban')
  @HttpCode(204)
  async unban(
    @CurrentUser() actor: { id: number },
    @Param('id', ParseIntPipe) roomId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    await this.service.unbanMember({ roomId, adminId: actor.id, userId });
  }

  @Get(':id/bans')
  async listBans(
    @CurrentUser() actor: { id: number },
    @Param('id', ParseIntPipe) roomId: number,
  ) {
    return this.service.listBans({ roomId, viewerId: actor.id });
  }

  @Delete(':id')
  @HttpCode(204)
  async deleteRoom(
    @CurrentUser() actor: { id: number },
    @Param('id', ParseIntPipe) roomId: number,
  ) {
    await this.service.deleteRoom({ roomId, actorId: actor.id });
  }
}
