import { Module } from '@nestjs/common';
import { HourControlModule } from '../hour-control/hour-control.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [HourControlModule, ScheduleModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
