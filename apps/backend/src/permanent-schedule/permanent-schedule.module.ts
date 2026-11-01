import { Module } from '@nestjs/common';
import { ExportModule } from '../export/export.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { PermanentScheduleController } from './permanent-schedule.controller';
import { PermanentScheduleService } from './permanent-schedule.service';

@Module({
  imports: [SchedulerModule, ExportModule],
  controllers: [PermanentScheduleController],
  providers: [PermanentScheduleService],
})
export class PermanentScheduleModule {}
