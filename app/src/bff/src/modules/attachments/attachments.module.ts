import { Module } from '@nestjs/common';
import { MicroserviceModule } from '../../common/microservice.module';
import { AuthModule } from '../../auth/auth.module';
import { AttachmentsService } from './attachments.service';
import { AttachmentsController } from './attachments.controller';

@Module({
  imports: [MicroserviceModule, AuthModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
