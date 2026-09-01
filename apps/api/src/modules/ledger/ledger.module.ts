import { Global, Module, OnApplicationBootstrap } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { TrialBalanceService } from './trial-balance.service';

@Global()
@Module({
  providers: [LedgerService, TrialBalanceService],
  exports: [LedgerService, TrialBalanceService],
})
export class LedgerModule implements OnApplicationBootstrap {
  constructor(private readonly ledger: LedgerService) {}
  async onApplicationBootstrap() {
    await this.ledger.ensureSystemAccounts();
  }
}
