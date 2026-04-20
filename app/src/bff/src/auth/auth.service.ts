import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { AUTH_SERVICE } from '../common/microservice.module';
import { withSys } from '../common/rpc-transport';

@Injectable()
export class AuthService {
  constructor(@Inject(AUTH_SERVICE) private readonly client: ClientProxy) {}

  loginAdmin(email: string, password: string, totpCode?: string) {
    return firstValueFrom(
      this.client.send<any>({ cmd: 'auth.admin.login' }, withSys({ email, password, totpCode })),
    );
  }

  loginUser(email: string, password: string, totpCode?: string) {
    return firstValueFrom(
      this.client.send<any>({ cmd: 'auth.customer.login' }, withSys({ email, password, totpCode })),
    );
  }

  refreshAdmin(refreshToken: string) {
    return firstValueFrom(
      this.client.send<any>({ cmd: 'auth.admin.refresh' }, withSys({ refreshToken })),
    );
  }

  refreshUser(refreshToken: string) {
    return firstValueFrom(
      this.client.send<any>({ cmd: 'auth.customer.refresh' }, withSys({ refreshToken })),
    );
  }

  logoutAdmin(refreshToken: string) {
    return firstValueFrom(
      this.client.send<any>({ cmd: 'auth.admin.logout' }, withSys({ refreshToken })),
    );
  }

  logoutUser(refreshToken: string) {
    return firstValueFrom(
      this.client.send<any>({ cmd: 'auth.customer.logout' }, withSys({ refreshToken })),
    );
  }

  validateUserToken(token: string) {
    return firstValueFrom(
      this.client.send<any>({ cmd: 'auth.customer.validateToken' }, withSys({ token })),
    );
  }
}
