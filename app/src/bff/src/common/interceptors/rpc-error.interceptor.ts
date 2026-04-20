import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadGatewayException,
  BadRequestException,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';
import { RpcException } from '@nestjs/microservices';

@Injectable()
export class RpcErrorInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err) => {
        if (err instanceof RpcException) {
          const error = err.getError() as any;
          const status = error?.status ?? error?.statusCode ?? 500;
          switch (status) {
            case 400: return throwError(() => new BadRequestException(error?.message));
            case 401: return throwError(() => new UnauthorizedException(error?.message));
            case 403: return throwError(() => new ForbiddenException(error?.message));
            case 404: return throwError(() => new NotFoundException(error?.message));
            case 409: return throwError(() => new ConflictException(error?.message));
            case 422: return throwError(() => new UnprocessableEntityException(error?.message));
            default: return throwError(() => new BadGatewayException(error?.message ?? 'Upstream service error'));
          }
        }
        return throwError(() => err);
      }),
    );
  }
}
