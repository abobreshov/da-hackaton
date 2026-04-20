import { Global, Module } from '@nestjs/common';
import { MailerService } from './mail.service';

@Global()
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailModule {}
