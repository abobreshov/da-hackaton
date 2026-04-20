import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { AUTH_SERVICE } from '../auth-client.module';
import { withSys } from '../rpc-transport';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(@Inject(AUTH_SERVICE) private readonly auth: ClientProxy) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const auth = request.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();

    const token = auth.slice(7);
    try {
      const user = await firstValueFrom(
        this.auth.send<any>({ cmd: 'auth.customer.validateToken' }, withSys({ token })),
      );
      // TODO(oidc): auth-service still returns `{ userId, email, role, scopes }`.
      // When its JWT signer is reshaped to OIDC (`sub: 'u:<id>'`, `type: 'user'`),
      // project the response back to the same shape here or adopt the new shape
      // across every backend consumer of `request.user`. Ticket: hand-off with
      // the auth-service agent — touching `customer-auth.service.ts` is out of
      // scope for this change.
      request.user = user;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
