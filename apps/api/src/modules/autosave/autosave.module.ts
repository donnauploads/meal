import { Module } from '@nestjs/common';
import { AutosaveService } from './autosave.service';
import { AutosaveController } from './autosave.controller';
import { AutosaveWeeklyWorker } from './autosave.worker';
import { TransfersModule } from '../transfers/transfers.module';

@Module({
  imports: [TransfersModule],
  providers: [AutosaveService, AutosaveWeeklyWorker],
  controllers: [AutosaveController],
  exports: [AutosaveService],
})
export class AutosaveModule {}
