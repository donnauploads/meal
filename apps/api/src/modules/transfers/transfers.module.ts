import { Module } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { TransfersController } from './transfers.controller';
import { TransfersRepository } from './transfers.repository';
import { SettlementWorker } from './settlement.worker';
import { QUEUE_NAMES, registerQueues } from '../workers/bullmq.config';
import { FxModule } from '../fx/fx.module';

@Module({
  imports: [registerQueues(QUEUE_NAMES.TransferSettlement), FxModule],
  providers: [TransfersService, TransfersRepository, SettlementWorker],
  controllers: [TransfersController],
  exports: [TransfersService, TransfersRepository],
})
export class TransfersModule {}
