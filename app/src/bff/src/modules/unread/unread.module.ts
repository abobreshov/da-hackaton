import { Module } from '@nestjs/common';
import { MicroserviceModule } from '../../common/microservice.module';
import { AuthModule } from '../../auth/auth.module';
import { UnreadService } from './unread.service';
import { UnreadController } from './unread.controller';

@Module({
  imports: [MicroserviceModule, AuthModule],
  controllers: [UnreadController],
  providers: [UnreadService],
  exports: [UnreadService],
})
export class UnreadModule {}
