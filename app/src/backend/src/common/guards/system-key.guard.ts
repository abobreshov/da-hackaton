import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { env } from '../../config/environment';

@Injectable()
export class SystemKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (request.headers['x-system-key'] !== env.SYSTEM_KEY) throw new UnauthorizedException();
    return true;
  }
}
