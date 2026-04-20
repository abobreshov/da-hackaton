import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';
import { ModerationTcpController } from './moderation.tcp';

@Module({
  imports: [AuditModule],
  controllers: [ModerationController, ModerationTcpController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
