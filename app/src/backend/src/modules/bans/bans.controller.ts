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
import { BansService } from './bans.service';

/**
 * HTTP surface for user-to-user bans. Mounted at `/users/:userId/ban` and
 * `/users/:userId/bans` on the backend; the BFF rewrites `/api/v1/...` → `/...`.
 *
 * AC-04-06 / AC-04-11 apply — ban is atomic (service owns the tx), unban is
 * the smallest possible op (single delete).
 */
@Controller('users')
@UseGuards(JwtGuard)
export class BansController {
  constructor(private readonly service: BansService) {}

  @Post(':userId/ban')
  @HttpCode(200)
  ban(@CurrentUser() user: { id: number }, @Param('userId', ParseIntPipe) bannedId: number) {
    return this.service.banUser({ bannerId: user.id, bannedId });
  }

  @Delete(':userId/ban')
  @HttpCode(204)
  async unban(
    @CurrentUser() user: { id: number },
    @Param('userId', ParseIntPipe) bannedId: number,
  ) {
    await this.service.unbanUser({ bannerId: user.id, bannedId });
  }

  /**
   * `:userId` must equal the authenticated user — you can only see your own
   * banlist. We short-circuit with a 403 in the service rather than burning a
   * policy guard here.
   */
  @Get(':userId/bans')
  list(@CurrentUser() user: { id: number }, @Param('userId', ParseIntPipe) userId: number) {
    if (userId !== user.id) {
      // Keep the leak surface tiny: pretend there's nothing there.
      return [];
    }
    return this.service.listBansByUser({ userId });
  }
}
