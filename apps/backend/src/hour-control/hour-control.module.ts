import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { HourControlController } from './hour-control.controller';
import { HourControlService } from './hour-control.service';

@Module({
  imports: [GroupsModule],
  controllers: [HourControlController],
  providers: [HourControlService],
  exports: [HourControlService],
})
export class HourControlModule {}
