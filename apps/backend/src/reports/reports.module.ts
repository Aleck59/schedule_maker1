import { Module } from '@nestjs/common';
import { ExportModule } from '../export/export.module';
import { HourControlModule } from '../hour-control/hour-control.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [ExportModule, HourControlModule, ScheduleModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
