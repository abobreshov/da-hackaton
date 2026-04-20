import { Module } from '@nestjs/common';
import { EventsModule } from '../../common/events/events.module';
import { AbuseReportsService } from './abuse-reports.service';
import { AbuseReportsController } from './abuse-reports.controller';
import { AbuseReportsTcpController } from './abuse-reports.tcp';
import { DrizzleAbuseReportsRepository } from './abuse-reports.repository';
import { ABUSE_REPORTS_REPOSITORY } from './abuse-reports.types';

@Module({
  imports: [EventsModule],
  controllers: [AbuseReportsController, AbuseReportsTcpController],
  providers: [
    AbuseReportsService,
    { provide: ABUSE_REPORTS_REPOSITORY, useClass: DrizzleAbuseReportsRepository },
  ],
  exports: [AbuseReportsService],
})
export class AbuseReportsModule {}
