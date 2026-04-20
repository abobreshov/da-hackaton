import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { AUTH_SERVICE } from '../common/microservice.module';

@Injectable()
export class AuthService {
  constructor(@Inject(AUTH_SERVICE) private readonly client: ClientProxy) {}

  loginAdmin(email: string, password: string, totpCode?: string) {
    return firstValueFrom(
      this.client.send<any>({ cmd: 'auth.admin.login' }, { email, password, totpCode }),
    );
  }

  loginUser(email: string, password: string, totpCode?: string) {
    return firstValueFrom(
      this.client.send<any>({ cmd: 'auth.customer.login' }, { email, password, totpCode }),
    );
  }

  refreshAdmin(refreshToken: string) {
    return firstValueFrom(this.client.send<any>({ cmd: 'auth.admin.refresh' }, { refreshToken }));
  }

  refreshUser(refreshToken: string) {
    return firstValueFrom(
      this.client.send<any>({ cmd: 'auth.customer.refresh' }, { refreshToken }),
    );
  }

  logoutAdmin(refreshToken: string) {
    return firstValueFrom(this.client.send<any>({ cmd: 'auth.admin.logout' }, { refreshToken }));
  }

  logoutUser(refreshToken: string) {
    return firstValueFrom(this.client.send<any>({ cmd: 'auth.customer.logout' }, { refreshToken }));
  }

  validateUserToken(token: string) {
    return firstValueFrom(this.client.send<any>({ cmd: 'auth.customer.validateToken' }, { token }));
  }
}
