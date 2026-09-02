import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { BootstrapModule } from './modules/bootstrap/bootstrap.module';
import { BackupModule } from './modules/backup/backup.module';
import { EmailModule } from './common/email/email.module';
import { CacheModule } from './common/cache/cache.module';
import { EventLoggerModule } from './common/event-logger/event-logger.module';
import { GeoipModule } from './common/geoip/geoip.module';
import { CryptoModule } from './modules/crypto/crypto.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { DevicesModule } from './modules/devices/devices.module';
import { MfaModule } from './modules/mfa/mfa.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { SupportModule } from './modules/support/support.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { KycModule } from './modules/kyc/kyc.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { InsightsModule } from './modules/insights/insights.module';
import { GreetingModule } from './modules/greeting/greeting.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { IdempotencyModule } from './modules/idempotency/idempotency.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { RecurringTransfersModule } from './modules/recurring-transfers/recurring-transfers.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { PayModule } from './modules/pay/pay.module';
import { PaymentRequestsModule } from './modules/payment-requests/payment-requests.module';
import { ElevationModule } from './modules/elevation/elevation.module';
import { CardPanModule } from './modules/card-pan/card-pan.module';
import { CardsModule } from './modules/cards/cards.module';
import { GoalsModule } from './modules/goals/goals.module';
import { AutosaveModule } from './modules/autosave/autosave.module';
import { RoundUpsModule } from './modules/round-ups/round-ups.module';
import { LinkedAccountsModule } from './modules/linked-accounts/linked-accounts.module';
import { DirectDepositModule } from './modules/direct-deposit/direct-deposit.module';
import { DealsModule } from './modules/deals/deals.module';
import { SmsModule } from './modules/sms/sms.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProfileModule } from './modules/profile/profile.module';
import { MeSecurityModule } from './modules/me-security/me-security.module';
import { BiometricModule } from './modules/biometric/biometric.module';
import { StatementsModule } from './modules/statements/statements.module';
import { TaxFormsModule } from './modules/tax-forms/tax-forms.module';
import { PolicyDocsModule } from './modules/policy-docs/policy-docs.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { AdminAuditModule } from './modules/admin-audit/admin-audit.module';
import { AdminModule } from './modules/admin/admin.module';
import { AdminNotificationsModule } from './modules/admin-notifications/admin-notifications.module';
import { AtmsModule } from './modules/atms/atms.module';
import { CheckDepositsModule } from './modules/check-deposits/check-deposits.module';
import { JwtAccessGuard } from './modules/auth/guards/jwt-access.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { buildBullMQRootModule } from './modules/workers/bullmq.config';
import { FxModule } from './modules/fx/fx.module';
import { MailModule } from './modules/mail/mail.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 50,
      verboseMemoryLeak: false,
      ignoreErrors: false,
    }),
    ScheduleModule.forRoot(),
    buildBullMQRootModule(),
    PrismaModule,
    BootstrapModule,
    BackupModule,
    EmailModule,
    CacheModule,
    EventLoggerModule,
    GeoipModule,
    CryptoModule,
    HealthModule,
    AuthModule,
    SessionsModule,
    DevicesModule,
    MfaModule,
    RbacModule,
    RealtimeModule,
    DocumentsModule,
    KycModule,
    AccountsModule,
    TransactionsModule,
    InsightsModule,
    GreetingModule,
    LedgerModule,
    IdempotencyModule,
    FxModule,
    TransfersModule,
    RecurringTransfersModule,
    ContactsModule,
    PayModule,
    PaymentRequestsModule,
    ElevationModule,
    CardPanModule,
    CardsModule,
    GoalsModule,
    AutosaveModule,
    RoundUpsModule,
    LinkedAccountsModule,
    DirectDepositModule,
    DealsModule,
    SmsModule,
    NotificationsModule,
    ProfileModule,
    MeSecurityModule,
    BiometricModule,
    StatementsModule,
    TaxFormsModule,
    PolicyDocsModule,
    ReferralsModule,
    AdminAuditModule,
    AdminModule.register(),
    AdminNotificationsModule,
    SupportModule,
    AtmsModule,
    CheckDepositsModule,
    MailModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAccessGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
