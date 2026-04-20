import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsTcpController } from './rooms.tcp';
import { RoomsService } from './rooms.service';
import { DrizzleRoomsRepository } from './rooms.repository';
import { ROOMS_REPOSITORY } from './rooms.types';

@Module({
  controllers: [RoomsController, RoomsTcpController],
  providers: [
    RoomsService,
    { provide: ROOMS_REPOSITORY, useClass: DrizzleRoomsRepository },
  ],
  exports: [RoomsService],
})
export class RoomsModule {}
