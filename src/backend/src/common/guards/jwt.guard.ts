import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { env } from '../../config/environment';

@Injectable()
export class JwtGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const auth = request.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();

    const token = auth.slice(7);
    const res = await fetch(`${env.AUTH_SERVICE_URL}/api/v1/auth/customer/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });

    if (!res.ok) throw new UnauthorizedException();
    const user = await res.json();
    request.user = user;
    return true;
  }
}
