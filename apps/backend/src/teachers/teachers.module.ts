import { Module } from '@nestjs/common';
import { TeachersController } from './teachers.controller';
import { AvailabilityRulesService } from './availability-rules.service';
import { TeachersService } from './teachers.service';

@Module({
  controllers: [TeachersController],
  providers: [TeachersService, AvailabilityRulesService],
  exports: [TeachersService],
})
export class TeachersModule {}
