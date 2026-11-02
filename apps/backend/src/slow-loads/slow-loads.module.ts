import { Module } from '@nestjs/common';
import { SlowLoadsController } from './slow-loads.controller';
import { SlowLoadsService } from './slow-loads.service';

@Module({
  controllers: [SlowLoadsController],
  providers: [SlowLoadsService],
})
export class SlowLoadsModule {}
