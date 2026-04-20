import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AbuseReportsService } from './abuse-reports.service';
import { AbuseReportsController } from './abuse-reports.controller';
import { AbuseReportsTcpController } from './abuse-reports.tcp';

@Module({
  imports: [AuditModule],
  controllers: [AbuseReportsController, AbuseReportsTcpController],
  providers: [AbuseReportsService],
  exports: [AbuseReportsService],
})
export class AbuseReportsModule {}
