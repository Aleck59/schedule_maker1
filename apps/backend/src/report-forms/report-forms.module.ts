import { Module } from '@nestjs/common';
import { ExportModule } from '../export/export.module';
import { ReportsModule } from '../reports/reports.module';
import { ReportFormsController } from './report-forms.controller';
import { ReportFormsService } from './report-forms.service';

@Module({
  imports: [ExportModule, ReportsModule],
  controllers: [ReportFormsController],
  providers: [ReportFormsService],
})
export class ReportFormsModule {}
