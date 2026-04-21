import { Controller, Get, Param, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { SessionGuard } from '../../auth/session.guard';
import { parseSub } from '../../auth/cookie.service';

interface SessionRequest {
  session?: { sub?: string; type?: string };
}

function currentUserIdOrNull(req: SessionRequest): number | null {
  const sub = req.session?.sub;
  if (!sub) return null;
  try {
    const { type, numericId } = parseSub(sub);
    return type === 'user' ? numericId : null;
  } catch {
    return null;
  }
}

@Controller('users')
@UseGuards(SessionGuard)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  list() {
    return this.service.list();
  }

  /**
   * Autocomplete for the FE add-friend dropdown. `q` is a case-insensitive
   * prefix, `limit` is clamped server-side. The caller's own row is
   * filtered out so the dropdown never offers "add yourself".
   *
   * Registered BEFORE `GET /users/:id` so ParseIntPipe doesn't swallow the
   * literal path segment "search".
   */
  @Get('search')
  search(@Query('q') q: string, @Query('limit') limitRaw: string, @Req() req: SessionRequest) {
    const parsedLimit = Number.parseInt(limitRaw ?? '', 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 8;
    return this.service.searchByUsernamePrefix(q ?? '', currentUserIdOrNull(req), limit);
  }

  @Get(':id')
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.service.findById(id);
  }
}
