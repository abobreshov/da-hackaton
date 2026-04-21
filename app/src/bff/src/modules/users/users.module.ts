import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  // FriendsModule (and other aggregators) reuse `findManyByIds` for username
  // hydration, so the service is exported alongside the module.
  exports: [UsersService],
})
export class UsersModule {}
