import { Global, Module } from '@nestjs/common';
import { LessonCheckerService } from './lesson-checker.service';
import { ScheduleValidatorService } from './schedule-validator.service';
import { ValidationController } from './validation.controller';

@Global()
@Module({
  controllers: [ValidationController],
  providers: [ScheduleValidatorService, LessonCheckerService],
  exports: [ScheduleValidatorService, LessonCheckerService],
})
export class ValidationModule {}
