import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { ConflictFixesController } from './conflict-fixes.controller';
import { ConflictFixesService } from './conflict-fixes.service';
import { EntityScheduleController } from './entity-schedule.controller';
import { MakeupTasksService } from './makeup-tasks.service';
import { ScheduleLessonsController } from './schedule-lessons.controller';
import { ScheduleLessonsService } from './schedule-lessons.service';
import { SchedulePeriodsController } from './schedule-periods.controller';
import { SchedulePeriodsService } from './schedule-periods.service';
import { SlotFinderService } from './slot-finder.service';

@Module({
  imports: [GroupsModule],
  controllers: [
    SchedulePeriodsController,
    ScheduleLessonsController,
    EntityScheduleController,
    ConflictFixesController,
  ],
  providers: [
    SchedulePeriodsService,
    ScheduleLessonsService,
    MakeupTasksService,
    SlotFinderService,
    ConflictFixesService,
  ],
  exports: [SchedulePeriodsService, ScheduleLessonsService, SlotFinderService],
})
export class ScheduleModule {}
