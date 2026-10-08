import { Module } from '@nestjs/common';
import { CurriculumImportService } from './curriculum-import.service';
import { CurriculumController } from './curriculum.controller';
import { CurriculumService } from './curriculum.service';
import { ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';

@Module({
  controllers: [ProgramsController, CurriculumController],
  providers: [ProgramsService, CurriculumService, CurriculumImportService],
  exports: [ProgramsService, CurriculumService],
})
export class ProgramsModule {}
