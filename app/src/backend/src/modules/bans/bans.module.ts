import { Module } from '@nestjs/common';
import { BansController } from './bans.controller';
import { BansTcpController } from './bans.tcp';
import { BansService } from './bans.service';
import { EventsModule } from '../../common/events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [BansController, BansTcpController],
  providers: [BansService],
  exports: [BansService],
})
export class BansModule {}
