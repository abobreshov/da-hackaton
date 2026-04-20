import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Stacks on top of {@link SessionGuard}: `SessionGuard` populates
 * `req.session` (either user or admin flow), and this guard checks the
 * resulting session is an admin session.
 *
 * Session shape (see `auth.controller.ts`, OIDC-aligned):
 *   - user session  → `{ sub: 'u:<id>', type: 'user', ... }`
 *   - admin session → `{ sub: 'a:<id>', type: 'admin', ... }`
 *
 * The check is type-string based rather than pattern-matching `sub` so a
 * rogue session blob with a spoofed `a:` prefix cannot sneak through —
 * the cookie signer controls `type`, the handler body does not.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<{
      session?: { type?: string; sub?: string };
    }>();

    const session = req.session;
    if (!session) {
      // SessionGuard should have populated this; if we got here without it,
      // something up the pipeline is misconfigured — treat as unauthenticated.
      throw new UnauthorizedException('Not authenticated');
    }

    if (session.type !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
