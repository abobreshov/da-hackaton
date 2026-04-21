import { Module } from '@nestjs/common';
import {
  DmMessagesController,
  MessagesController,
  RoomMessagesController,
} from './messages.controller';
import { MessagesTcpController } from './messages.tcp';
import { MessagesService } from './messages.service';
import { DrizzleMessagesRepository } from './messages.repository';
import { FRIENDS_CHECKER, MESSAGES_REPOSITORY } from './messages.types';
import { RoomsModule } from '../rooms/rooms.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { FriendsModule } from '../friends/friends.module';
import { FriendsService } from '../friends/friends.service';

@Module({
  imports: [RoomsModule, AttachmentsModule, FriendsModule],
  controllers: [
    MessagesController,
    RoomMessagesController,
    DmMessagesController,
    MessagesTcpController,
  ],
  providers: [
    MessagesService,
    { provide: MESSAGES_REPOSITORY, useClass: DrizzleMessagesRepository },
    // Wire FriendsService into the IsFriendChecker port so the messages
    // module stays decoupled from the friends Drizzle schema at type level.
    { provide: FRIENDS_CHECKER, useExisting: FriendsService },
  ],
  exports: [MessagesService],
})
export class MessagesModule {}
