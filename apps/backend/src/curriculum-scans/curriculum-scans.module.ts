import { Module } from '@nestjs/common';
import { CurriculumScansController } from './curriculum-scans.controller';
import { CurriculumScansService } from './curriculum-scans.service';

@Module({
  controllers: [CurriculumScansController],
  providers: [CurriculumScansService],
})
export class CurriculumScansModule {}
