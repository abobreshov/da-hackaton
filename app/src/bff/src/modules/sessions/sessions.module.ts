import { Module } from '@nestjs/common';
import { MicroserviceModule } from '../../common/microservice.module';
import { AuthModule } from '../../auth/auth.module';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';

@Module({
  imports: [MicroserviceModule, AuthModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
