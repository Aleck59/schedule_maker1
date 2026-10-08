import { Global, Module } from '@nestjs/common';
import { PlanningService } from './planning.service';

@Global()
@Module({
  providers: [PlanningService],
  exports: [PlanningService],
})
export class PlanningModule {}
