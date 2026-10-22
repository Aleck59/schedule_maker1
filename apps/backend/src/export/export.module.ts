import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { HourControlModule } from '../hour-control/hour-control.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { ExcelService } from './excel.service';
import { ExportController } from './export.controller';
import { PdfService } from './pdf.service';
import { ScheduleFormService } from './schedule-form.service';

@Module({
  imports: [ScheduleModule, HourControlModule, GroupsModule],
  controllers: [ExportController],
  providers: [PdfService, ExcelService, ScheduleFormService],
  exports: [PdfService, ExcelService],
})
export class ExportModule {}
