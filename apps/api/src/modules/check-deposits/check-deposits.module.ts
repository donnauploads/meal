import { Module } from '@nestjs/common';
import { CheckDepositsController } from './check-deposits.controller';
import { AdminCheckDepositsController } from './admin-check-deposits.controller';
import { CheckDepositsService } from './check-deposits.service';

@Module({
  controllers: [CheckDepositsController, AdminCheckDepositsController],
  providers: [CheckDepositsService],
})
export class CheckDepositsModule {}
