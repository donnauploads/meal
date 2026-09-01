import { Module } from '@nestjs/common';
import { RecurringTransfersService } from './recurring-transfers.service';
import { RecurringTransfersController } from './recurring-transfers.controller';
import { RecurringScanWorker } from './recurring.worker';
import { TransfersModule } from '../transfers/transfers.module';

@Module({
  imports: [TransfersModule],
  providers: [RecurringTransfersService, RecurringScanWorker],
  controllers: [RecurringTransfersController],
  exports: [RecurringTransfersService],
})
export class RecurringTransfersModule {}
