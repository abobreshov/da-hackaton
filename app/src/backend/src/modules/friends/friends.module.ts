import { Module } from '@nestjs/common';
import { FriendsController } from './friends.controller';
import { FriendsTcpController } from './friends.tcp';
import { FriendsService } from './friends.service';
import { EventsModule } from '../../common/events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [FriendsController, FriendsTcpController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
