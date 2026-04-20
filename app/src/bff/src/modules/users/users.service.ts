import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { BACKEND_SERVICE } from '../../common/microservice.module';
import { withSys } from '../../common/rpc-transport';

@Injectable()
export class UsersService {
  constructor(@Inject(BACKEND_SERVICE) private readonly client: ClientProxy) {}

  list() {
    return firstValueFrom(this.client.send({ cmd: 'users.list' }, withSys({})));
  }

  findById(id: number) {
    return firstValueFrom(this.client.send({ cmd: 'users.findById' }, withSys({ id })));
  }
}
