import { Module } from '@nestjs/common';
import { AdminReportsController, ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
