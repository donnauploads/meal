import { Global, Module } from '@nestjs/common';
import { DirectDepositService } from './direct-deposit.service';
import { DirectDepositController, DirectDepositWebhookController } from './direct-deposit.controller';
import { DirectDepositPdfRenderer } from './pdf.renderer';
import { AtomicStubProvider } from './providers/atomic-stub.provider';
import { SWITCH_PROVIDER } from './providers/switch.provider.interface';

@Global()
@Module({
  providers: [
    DirectDepositService,
    DirectDepositPdfRenderer,
    AtomicStubProvider,
    { provide: SWITCH_PROVIDER, useExisting: AtomicStubProvider },
  ],
  controllers: [DirectDepositController, DirectDepositWebhookController],
  exports: [DirectDepositService],
})
export class DirectDepositModule {}
