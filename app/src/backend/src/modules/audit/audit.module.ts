import { Module } from '@nestjs/common';
import { AuthClientModule } from '../../common/auth-client.module';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditTcpController } from './audit.tcp';

@Module({
  imports: [AuthClientModule],
  controllers: [AuditController, AuditTcpController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
