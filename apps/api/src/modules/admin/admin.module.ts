import { Module } from '@nestjs/common';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';
import { AdminKycController } from './kyc/admin-kyc.controller';
import { AdminKycService } from './kyc/admin-kyc.service';
import { AdminTransfersController } from './transfers/admin-transfers.controller';
import { AdminTransfersService } from './transfers/admin-transfers.service';
import { AdminQueueCountsController } from './queue/admin-queue.controller';
import { AdminSessionsController } from './sessions/admin-sessions.controller';
import { AdminSessionsService } from './sessions/admin-sessions.service';
import { AdminWiresController } from './wires/admin-wires.controller';
import { AdminWiresService } from './wires/admin-wires.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminTransactionsModule } from './transactions/admin-transactions.module';
import { SessionsModule } from '../sessions/sessions.module';
import { KycModule } from '../kyc/kyc.module';
import { TransfersModule } from '../transfers/transfers.module';
import { LedgerModule } from '../ledger/ledger.module';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { CryptoModule } from '../crypto/crypto.module';
import { EmailModule } from '../../common/email/email.module';
import { AccountsModule } from '../accounts/accounts.module';

@Module({})
export class AdminModule {
  static register() {
    const demoOverride = (process.env.DEMO_OVERRIDE_MODE ?? 'true').toLowerCase() !== 'false';
    return {
      module: AdminModule,
      imports: [
        SessionsModule,
        KycModule,
        TransfersModule,
        LedgerModule,
        AdminAuditModule,
        CryptoModule,
        EmailModule,
        NotificationsModule,
        AccountsModule,
        ...(demoOverride ? [AdminTransactionsModule] : []),
      ],
      controllers: [
        AdminUsersController,
        AdminKycController,
        AdminTransfersController,
        AdminQueueCountsController,
        AdminSessionsController,
        AdminWiresController,
      ],
      providers: [
        AdminUsersService,
        AdminKycService,
        AdminTransfersService,
        AdminSessionsService,
        AdminWiresService,
      ],
      exports: [
        AdminUsersService,
        AdminKycService,
        AdminTransfersService,
        AdminSessionsService,
        AdminWiresService,
      ],
    };
  }
}
