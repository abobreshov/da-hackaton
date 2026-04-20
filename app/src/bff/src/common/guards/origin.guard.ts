import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { env } from '../../config/environment';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALLOWED_ORIGINS = new Set(
  env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
);

@Injectable()
export class OriginGuard implements CanActivate {
  private readonly logger = new Logger(OriginGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const method = (req.method ?? '').toUpperCase();
    if (SAFE_METHODS.has(method)) return true;

    const origin = req.headers?.origin as string | undefined;
    const referer = req.headers?.referer as string | undefined;
    const source = origin ?? (referer ? safeOrigin(referer) : undefined);

    if (!source) {
      this.logger.warn(`Blocked ${method} ${req.url} — missing Origin and Referer`);
      throw new ForbiddenException('Origin required for state-changing request');
    }
    if (!ALLOWED_ORIGINS.has(source)) {
      this.logger.warn(`Blocked ${method} ${req.url} from disallowed origin: ${source}`);
      throw new ForbiddenException('Origin not allowed');
    }
    return true;
  }
}

function safeOrigin(url: string): string | undefined {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}
