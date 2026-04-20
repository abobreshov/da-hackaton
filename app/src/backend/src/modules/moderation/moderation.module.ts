import { Module } from '@nestjs/common';
import { EventsModule } from '../../common/events/events.module';
import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';
import { ModerationTcpController } from './moderation.tcp';
import { DrizzleModerationRepository } from './moderation.repository';
import { MODERATION_REPOSITORY } from './moderation.types';

@Module({
  imports: [EventsModule],
  controllers: [ModerationController, ModerationTcpController],
  providers: [
    ModerationService,
    { provide: MODERATION_REPOSITORY, useClass: DrizzleModerationRepository },
  ],
  exports: [ModerationService],
})
export class ModerationModule {}
