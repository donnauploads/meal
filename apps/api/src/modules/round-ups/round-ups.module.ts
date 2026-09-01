import { Module } from '@nestjs/common';
import { RoundUpsService } from './round-ups.service';
import { RoundUpsDailyWorker } from './round-ups.worker';
import { TransfersModule } from '../transfers/transfers.module';

@Module({
  imports: [TransfersModule],
  providers: [RoundUpsService, RoundUpsDailyWorker],
  exports: [RoundUpsService],
})
export class RoundUpsModule {}
