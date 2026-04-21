import { HttpException, Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { EmptyError, Observable, TimeoutError, firstValueFrom, timeout } from 'rxjs';
import { ErrorCode } from '@app/contracts';
import { AUTH_SERVICE } from '../common/microservice.module';
import { withSys } from '../common/rpc-transport';

const UPSTREAM_TIMEOUT_MS = 5_000;

/**
 * Wrap every BFF→auth-service RPC with a deadline + EmptyError trap.
 *
 * Why: when `nest --watch` rebuilds auth-service, the TCP socket is killed
 * mid-flight. The cached `ClientProxy` returns an observable that **completes
 * without emitting**, which makes `firstValueFrom` reject with `EmptyError`,
 * which the global RpcErrorInterceptor cannot translate (not an RpcException),
 * so Fastify renders an opaque 500 to the browser. Same story for a hung
 * upstream where the socket never replies. Both modes degrade to a clean
 * 503 UPSTREAM_UNAVAILABLE here so the SPA can show a real "retry" message.
 *
 * Upstream `RpcException`s and HttpException are intentionally re-thrown
 * unchanged — only "no answer at all" becomes 503.
 */
async function awaitUpstream<T>(source$: Observable<T>): Promise<T> {
  try {
    return await firstValueFrom(source$.pipe(timeout(UPSTREAM_TIMEOUT_MS)));
  } catch (err) {
    if (err instanceof EmptyError || err instanceof TimeoutError) {
      throw new HttpException(
        {
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: 'Auth service unavailable, retry',
        },
        503,
      );
    }
    throw err;
  }
}

@Injectable()
export class AuthService {
  constructor(@Inject(AUTH_SERVICE) private readonly client: ClientProxy) {}

  loginAdmin(
    email: string,
    password: string,
    totpCode?: string,
    userAgent?: string,
    ip?: string,
  ) {
    return awaitUpstream(
      this.client.send<any>(
        { cmd: 'auth.admin.login' },
        withSys({ email, password, totpCode, userAgent, ip }),
      ),
    );
  }

  loginUser(
    email: string,
    password: string,
    totpCode?: string,
    userAgent?: string,
    ip?: string,
  ) {
    return awaitUpstream(
      this.client.send<any>(
        { cmd: 'auth.customer.login' },
        withSys({ email, password, totpCode, userAgent, ip }),
      ),
    );
  }

  refreshAdmin(refreshToken: string) {
    return awaitUpstream(
      this.client.send<any>({ cmd: 'auth.admin.refresh' }, withSys({ refreshToken })),
    );
  }

  refreshUser(refreshToken: string) {
    return awaitUpstream(
      this.client.send<any>({ cmd: 'auth.customer.refresh' }, withSys({ refreshToken })),
    );
  }

  logoutAdmin(refreshToken: string) {
    return awaitUpstream(
      this.client.send<any>({ cmd: 'auth.admin.logout' }, withSys({ refreshToken })),
    );
  }

  logoutUser(refreshToken: string) {
    return awaitUpstream(
      this.client.send<any>({ cmd: 'auth.customer.logout' }, withSys({ refreshToken })),
    );
  }

  validateUserToken(token: string) {
    return awaitUpstream(
      this.client.send<any>({ cmd: 'auth.customer.validateToken' }, withSys({ token })),
    );
  }

  register(email: string, username: string, password: string) {
    return awaitUpstream(
      this.client.send<any>(
        { cmd: 'auth.customer.register' },
        withSys({ email, username, password }),
      ),
    );
  }

  verifyEmail(token: string) {
    return awaitUpstream(
      this.client.send<any>({ cmd: 'auth.customer.verifyEmail' }, withSys({ token })),
    );
  }

  passwordResetRequest(email: string) {
    return awaitUpstream(
      this.client.send<any>({ cmd: 'auth.customer.passwordReset.request' }, withSys({ email })),
    );
  }

  passwordResetConfirm(token: string, newPassword: string) {
    return awaitUpstream(
      this.client.send<any>(
        { cmd: 'auth.customer.passwordReset.confirm' },
        withSys({ token, newPassword }),
      ),
    );
  }

  passwordChange(userId: number, currentPassword: string, newPassword: string) {
    return awaitUpstream(
      this.client.send<any>(
        { cmd: 'auth.customer.passwordChange' },
        withSys({ userId, currentPassword, newPassword }),
      ),
    );
  }

  deleteAccount(userId: number) {
    return awaitUpstream(
      this.client.send<any>({ cmd: 'auth.customer.delete' }, withSys({ userId })),
    );
  }
}
