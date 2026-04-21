import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersTcpController } from './users.tcp';
import { UsersService } from './users.service';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [
    // UsersService.cascadeDelete clears the deleted user's presence keys
    // through PresenceService. Without importing PresenceModule the DI
    // container can't resolve PresenceService at the cascade call site.
    PresenceModule,
  ],
  controllers: [UsersController, UsersTcpController],
  providers: [UsersService],
})
export class UsersModule {}
