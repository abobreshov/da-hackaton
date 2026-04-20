import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { RoomsModule } from '../rooms/rooms.module';
import { AttachmentsService } from './attachments.service';
import { AttachmentsTcpController } from './attachments.tcp';
import { DrizzleAttachmentsRepository } from './attachments.repository';
import { ATTACHMENTS_REPOSITORY } from './attachments.types';
import { ATTACHMENT_STORAGE } from './storage/attachment-storage.types';
import { FsAttachmentStorage } from './storage/fs-attachment-storage';

@Module({
  imports: [DatabaseModule, RoomsModule],
  controllers: [AttachmentsTcpController],
  providers: [
    AttachmentsService,
    { provide: ATTACHMENTS_REPOSITORY, useClass: DrizzleAttachmentsRepository },
    { provide: ATTACHMENT_STORAGE, useClass: FsAttachmentStorage },
  ],
  exports: [AttachmentsService, ATTACHMENTS_REPOSITORY],
})
export class AttachmentsModule {}
