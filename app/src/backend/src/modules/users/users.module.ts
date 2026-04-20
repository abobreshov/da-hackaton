import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersTcpController } from './users.tcp';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, UsersTcpController],
  providers: [UsersService],
})
export class UsersModule {}
