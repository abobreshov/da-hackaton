import {
  Injectable,
  Logger,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';
import { RpcException } from '@nestjs/microservices';
import { ErrorCode, WireError } from '@app/contracts';

// Generic, user-safe messages keyed by ErrorCode. In production we replace
// the upstream error text with these so we never leak internal detail
// (stack fragments, SQL snippets, upstream service names, etc.) to the
// browser. Outside production we keep verbose upstream text for debugging.
const SAFE_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.UNAUTHENTICATED]:      'Authentication required',
  [ErrorCode.FORBIDDEN]:            'Forbidden',
  [ErrorCode.NOT_FOUND]:            'Not found',
  [ErrorCode.CONFLICT]:             'Conflict',
  [ErrorCode.VALIDATION_FAILED]:    'Validation failed',
  [ErrorCode.RATE_LIMITED]:         'Too many requests',
  [ErrorCode.UPSTREAM_UNAVAILABLE]: 'Service temporarily unavailable',
  [ErrorCode.CSRF_INVALID]:         'CSRF validation failed',
  [ErrorCode.DM_FROZEN]:            'Conversation is frozen',
  [ErrorCode.FRIEND_REQUIRED]:      'Friendship required',
  [ErrorCode.BANNED_FROM_ROOM]:     'Access to this room has been revoked',
  [ErrorCode.TOTP_REQUIRED]:        'Two-factor authentication required',
  [ErrorCode.TOTP_INVALID]:         'Two-factor authentication failed',
  [ErrorCode.INTERNAL]:             'Request failed',
};
const GENERIC_SAFE_MESSAGE = 'Request failed';

const logger = new Logger('RpcErrorInterceptor');

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION_FAILED,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  422: ErrorCode.VALIDATION_FAILED,
  429: ErrorCode.RATE_LIMITED,
};

const CODE_TO_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION_FAILED]: 400,
  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.TOTP_REQUIRED]: 401,
  [ErrorCode.TOTP_INVALID]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.CSRF_INVALID]: 403,
  [ErrorCode.DM_FROZEN]: 403,
  [ErrorCode.FRIEND_REQUIRED]: 403,
  [ErrorCode.BANNED_FROM_ROOM]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.UPSTREAM_UNAVAILABLE]: 502,
  [ErrorCode.INTERNAL]: 500,
};

function inferCode(status: number): ErrorCode {
  return STATUS_TO_CODE[status] ?? ErrorCode.UPSTREAM_UNAVAILABLE;
}

function buildEnvelope(error: any, requestId?: string): { status: number; body: WireError } {
  const rawCode = typeof error?.code === 'string' ? (error.code as ErrorCode) : undefined;
  const rawStatus = typeof error?.status === 'number'
    ? error.status
    : typeof error?.statusCode === 'number'
      ? error.statusCode
      : undefined;

  const code: ErrorCode = rawCode ?? inferCode(rawStatus ?? 500);
  const status = rawStatus ?? CODE_TO_STATUS[code] ?? 500;
  const rawMessage =
    typeof error?.message === 'string' && error.message.length > 0
      ? error.message
      : 'Upstream service error';

  // In production, swap the upstream text for a user-safe generic so we
  // don't leak internal detail (DB errors, stack fragments, upstream service
  // identities). Preserve verbose behaviour in dev/test so debugging stays
  // productive. Details / retryAfterMs / requestId are untouched — those are
  // structured fields our own code owns.
  const isProd = process.env.NODE_ENV === 'production';
  const safeMessage = SAFE_MESSAGES[code] ?? GENERIC_SAFE_MESSAGE;
  const message = isProd ? safeMessage : rawMessage;

  if (isProd && rawMessage !== safeMessage) {
    logger.warn(
      `upstream error sanitized — code=${code} status=${status} requestId=${requestId ?? '-'} raw="${rawMessage}"`,
    );
  }

  const body: WireError = { code, message };
  if (error?.details !== undefined) body.details = error.details;
  if (typeof error?.retryAfterMs === 'number') body.retryAfterMs = error.retryAfterMs;
  if (requestId) body.requestId = requestId;

  return { status, body };
}

@Injectable()
export class RpcErrorInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err) => {
        if (err instanceof RpcException) {
          const http = ctx.switchToHttp();
          const req = http.getRequest?.();
          const res = http.getResponse?.();
          const requestId =
            (req?.headers?.['x-request-id'] as string | undefined) ??
            (req?.id as string | undefined);

          const { status, body } = buildEnvelope(err.getError(), requestId);

          if (res && requestId && typeof res.header === 'function') {
            res.header('X-Request-Id', requestId);
          }

          return throwError(() => new HttpException(body as unknown as Record<string, unknown>, status));
        }
        return throwError(() => err);
      }),
    );
  }
}

export const __test__ = {
  buildEnvelope,
  inferCode,
  STATUS_TO_CODE,
  CODE_TO_STATUS,
  SAFE_MESSAGES,
  GENERIC_SAFE_MESSAGE,
  HttpStatus,
};
