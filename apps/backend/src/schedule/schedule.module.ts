import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { EntityScheduleController } from './entity-schedule.controller';
import { MakeupTasksService } from './makeup-tasks.service';
import { ScheduleLessonsController } from './schedule-lessons.controller';
import { ScheduleLessonsService } from './schedule-lessons.service';
import { SchedulePeriodsController } from './schedule-periods.controller';
import { SchedulePeriodsService } from './schedule-periods.service';
import { SlotFinderService } from './slot-finder.service';

@Module({
  imports: [GroupsModule],
  controllers: [SchedulePeriodsController, ScheduleLessonsController, EntityScheduleController],
  providers: [SchedulePeriodsService, ScheduleLessonsService, MakeupTasksService, SlotFinderService],
  exports: [SchedulePeriodsService, ScheduleLessonsService, SlotFinderService],
})
export class ScheduleModule {}
