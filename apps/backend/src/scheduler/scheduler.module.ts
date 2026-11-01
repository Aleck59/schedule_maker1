import { Module } from '@nestjs/common';
import { GenerationQueueService } from './generation-queue.service';
import { GenerationRunnerService } from './generation-runner.service';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { ProblemBuilderService } from './problem-builder.service';
import { SolverClientService } from './solver-client.service';

@Module({
  controllers: [GenerationController],
  providers: [
    ProblemBuilderService,
    SolverClientService,
    GenerationRunnerService,
    GenerationQueueService,
    GenerationService,
  ],
  exports: [
    GenerationService,
    GenerationQueueService,
    ProblemBuilderService,
    SolverClientService,
    GenerationRunnerService,
  ],
})
export class SchedulerModule {}
