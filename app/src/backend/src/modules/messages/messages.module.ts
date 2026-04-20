import { Module } from '@nestjs/common';
import {
  DmMessagesController,
  MessagesController,
  RoomMessagesController,
} from './messages.controller';
import { MessagesTcpController } from './messages.tcp';
import { MessagesService } from './messages.service';
import { DrizzleMessagesRepository } from './messages.repository';
import { MESSAGES_REPOSITORY } from './messages.types';
import { RoomsModule } from '../rooms/rooms.module';

@Module({
  imports: [RoomsModule],
  controllers: [
    MessagesController,
    RoomMessagesController,
    DmMessagesController,
    MessagesTcpController,
  ],
  providers: [
    MessagesService,
    { provide: MESSAGES_REPOSITORY, useClass: DrizzleMessagesRepository },
  ],
  exports: [MessagesService],
})
export class MessagesModule {}
