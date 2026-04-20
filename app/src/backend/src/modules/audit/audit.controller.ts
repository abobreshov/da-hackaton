import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user';
import { AUTH_SERVICE } from '../../common/auth-client.module';
import { withSys } from '../../common/rpc-transport';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';

/**
 * Admin-only audit log viewer. Mounted at `/admin/audit-log`.
 *
 * The JWT guard already validates the bearer token. We re-verify via an
 * auth.customer.validateToken round-trip for role — the backend does not
 * hold its own role store; auth-service is the source of truth.
 */
@Controller('admin/audit-log')
@UseGuards(JwtGuard)
export class AuditController {
  constructor(
    private readonly service: AuditService,
    @Inject(AUTH_SERVICE) private readonly auth: ClientProxy,
  ) {}

  @Get()
  async page(@CurrentUser() user: { id: number; role?: string }, @Query() q: AuditQueryDto) {
    // Defence-in-depth: ensure the caller is an admin. `user.role` is
    // populated by JwtGuard from validateToken — prefer that over an extra
    // round-trip. Fall back to auth-service if role is absent.
    let role = user.role;
    if (!role) {
      const validated = await firstValueFrom(
        this.auth.send<any>({ cmd: 'auth.customer.validateToken' }, withSys({})),
      ).catch(() => null);
      role = validated?.role;
    }
    if (role !== 'ADMIN' && role !== 'admin') {
      throw new ForbiddenException('admin required');
    }

    const before =
      q.beforeCreatedAt && q.beforeId
        ? { createdAt: q.beforeCreatedAt, id: q.beforeId }
        : undefined;

    return this.service.page({
      actor: q.actor,
      action: q.action,
      from: q.from,
      to: q.to,
      limit: q.limit,
      before,
    });
  }
}
