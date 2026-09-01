import { Module } from '@nestjs/common';
import { DealsService } from './deals.service';
import { DealsController } from './deals.controller';
import { DirectDepositActiveGuard } from './dd-active.guard';

@Module({
  providers: [DealsService, DirectDepositActiveGuard],
  controllers: [DealsController],
  exports: [DealsService],
})
export class DealsModule {}
