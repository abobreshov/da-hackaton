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
      // auth-service.validateToken now returns an OIDC-shaped introspection:
      //   { sub: 'u:<id>', type: 'user', userId, email, name?, scopes }
      // `userId` is still present for back-compat readers in older controllers;
      // new code should prefer `parseSub(user.sub).numericId`.
      request.user = user;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
