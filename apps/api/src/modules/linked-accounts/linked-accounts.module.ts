import { Module } from '@nestjs/common';
import { LinkedAccountsService } from './linked-accounts.service';
import { LinkedAccountAuthService } from './linked-account-auth.service';
import { LinkedAccountsController } from './linked-accounts.controller';
import { AdminLinkRequestsController } from './admin-link-requests.controller';
import { LINK_PROVIDER } from './providers/link.provider.interface';
import { PlaidStubProvider } from './providers/plaid-stub.provider';
import { PlaidProvider } from './providers/plaid.provider';

@Module({
  providers: [
    LinkedAccountsService,
    LinkedAccountAuthService,
    PlaidStubProvider,
    PlaidProvider,
    { provide: LINK_PROVIDER, useExisting: PlaidStubProvider },
  ],
  controllers: [LinkedAccountsController, AdminLinkRequestsController],
  exports: [LinkedAccountsService, LinkedAccountAuthService],
})
export class LinkedAccountsModule {}
