-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('customer', 'admin', 'superadmin');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'frozen', 'closed');

-- CreateEnum
CREATE TYPE "SessionRevokedReason" AS ENUM ('user_signout', 'newer_login', 'password_changed', 'admin_revoke', 'reuse_detected');

-- CreateEnum
CREATE TYPE "MfaChannel" AS ENUM ('sms');

-- CreateEnum
CREATE TYPE "SignupStage" AS ENUM ('started', 'contact_collected', 'channel_chosen', 'verified', 'dob_collected', 'card_chosen', 'address_collected', 'password_set', 'details_collected', 'ssn_collected', 'docs_submitted', 'completed', 'abandoned');

-- CreateEnum
CREATE TYPE "VerificationChannel" AS ENUM ('email', 'sms');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('pending', 'in_review', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('id_front', 'id_back', 'selfie', 'utility_bill');

-- CreateEnum
CREATE TYPE "DocumentSubtype" AS ENUM ('drivers_license', 'passport', 'state_id', 'ssn_card', 'other');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('checking', 'savings');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'frozen', 'closed');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('pending', 'posted', 'declined', 'reversed');

-- CreateEnum
CREATE TYPE "TransactionCategory" AS ENUM ('groceries', 'dining', 'transport', 'entertainment', 'shopping', 'bills', 'health', 'travel', 'utilities', 'transfer', 'income', 'other');

-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('card_purchase', 'ach_in', 'ach_out', 'p2p_in', 'p2p_out', 'fee', 'interest', 'deposit', 'refund', 'adjustment');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');

-- CreateEnum
CREATE TYPE "PostingDirection" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "TransferKind" AS ENUM ('internal', 'ach_in', 'ach_out', 'wire_in', 'wire_out', 'p2p');

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('weekly', 'biweekly', 'monthly');

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('pending', 'paid', 'declined', 'expired');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('virtual', 'physical');

-- CreateEnum
CREATE TYPE "CardStatus" AS ENUM ('active', 'frozen', 'replaced', 'shipped', 'delivered', 'closed');

-- CreateEnum
CREATE TYPE "CardOrderStatus" AS ENUM ('ordered', 'shipped', 'delivered');

-- CreateEnum
CREATE TYPE "LinkedAccountStatus" AS ENUM ('connected', 'requires_reauth', 'disconnected');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('transaction', 'security', 'offer', 'system');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('sent', 'signed_up', 'qualified', 'paid');

-- CreateEnum
CREATE TYPE "OverrideStatus" AS ENUM ('pending', 'settled', 'declined', 'reversed', 'hidden');

-- CreateTable
CREATE TABLE "LinkedAccount" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "providerItemId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "institutionName" TEXT NOT NULL,
    "mask" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "accessTokenEnc" BYTEA NOT NULL,
    "accessTokenKeyId" TEXT NOT NULL DEFAULT 'local-aes-v1',
    "status" "LinkedAccountStatus" NOT NULL DEFAULT 'connected',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectDeposit" (
    "userId" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3),
    "employerId" UUID,
    "partnerRequestId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectDeposit_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Employer" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "partnerSlug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" UUID NOT NULL,
    "merchantId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cashbackBps" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivatedDeal" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),

    CONSTRAINT "ActivatedDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "phoneE164" TEXT,
    "passwordHash" TEXT NOT NULL,
    "novaTag" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "dob" TIMESTAMP(3),
    "avatarUrl" TEXT,
    "bio" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'customer',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT,
    "email" TEXT,
    "phoneE164" TEXT,
    "avatarUrl" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" UUID NOT NULL,
    "requesterUserId" UUID NOT NULL,
    "payerUserId" UUID,
    "payerContactRef" TEXT,
    "amountCents" BIGINT NOT NULL,
    "note" TEXT NOT NULL,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "paidTransferId" UUID,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "type" "CardType" NOT NULL,
    "last4" TEXT NOT NULL,
    "expMonth" INTEGER NOT NULL,
    "expYear" INTEGER NOT NULL,
    "status" "CardStatus" NOT NULL DEFAULT 'active',
    "spendingLimitCents" BIGINT,
    "panCiphertext" BYTEA NOT NULL,
    "panKeyId" TEXT NOT NULL,
    "cvvCiphertext" BYTEA NOT NULL,
    "cvvKeyId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "frozenAt" TIMESTAMP(3),
    "replacedFromCardId" UUID,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardOrder" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "shipAddress" JSONB NOT NULL,
    "status" "CardOrderStatus" NOT NULL DEFAULT 'ordered',
    "etaDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "resolvedCardId" UUID,

    CONSTRAINT "CardOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetCents" BIGINT,
    "currentCents" BIGINT NOT NULL DEFAULT 0,
    "targetDate" TIMESTAMP(3),
    "contributePerWeek" BIGINT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutosaveConfig" (
    "userId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "roundUpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "roundUpSourceAccountId" UUID,
    "splits" JSONB NOT NULL,
    "weeklyContributionCents" BIGINT,
    "weeklyDay" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutosaveConfig_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RoundUpLedger" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoundUpLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "AccountType" NOT NULL,
    "label" TEXT NOT NULL,
    "balanceCents" BIGINT NOT NULL DEFAULT 0,
    "apyBps" INTEGER,
    "status" "AccountStatus" NOT NULL DEFAULT 'active',
    "mockRoutingNumber" TEXT NOT NULL,
    "mockAccountNumber" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mcc" TEXT,
    "logoUrl" TEXT,
    "category" "TransactionCategory",

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "kind" "TransactionKind" NOT NULL,
    "status" "TransactionStatus" NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "description" TEXT NOT NULL,
    "merchantId" UUID,
    "category" "TransactionCategory" NOT NULL DEFAULT 'other',
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountLimits" (
    "accountId" UUID NOT NULL,
    "atmDailyCents" BIGINT NOT NULL,
    "cardPurchasesDailyCents" BIGINT NOT NULL,
    "cashDepositCents" BIGINT NOT NULL,
    "mobileCheckCents" BIGINT NOT NULL,
    "outgoingWireCents" BIGINT NOT NULL,

    CONSTRAINT "AccountLimits_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "normalBalance" "PostingDirection" NOT NULL,
    "ownerUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Posting" (
    "id" UUID NOT NULL,
    "journalEntryId" UUID NOT NULL,
    "ledgerAccountId" UUID NOT NULL,
    "direction" "PostingDirection" NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Posting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" UUID NOT NULL,
    "kind" "TransferKind" NOT NULL,
    "status" "TransactionStatus" NOT NULL,
    "fromAccountId" UUID NOT NULL,
    "toAccountId" UUID,
    "externalRef" TEXT,
    "amountCents" BIGINT NOT NULL,
    "feeCents" BIGINT NOT NULL DEFAULT 0,
    "instant" BOOLEAN NOT NULL DEFAULT false,
    "initiatedByUserId" UUID NOT NULL,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "pendingTransactionId" UUID,
    "settledTransactionId" UUID,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringTransfer" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fromAccountId" UUID NOT NULL,
    "toAccountId" UUID NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "frequency" "RecurringFrequency" NOT NULL,
    "dayOf" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "responseBody" JSONB NOT NULL,
    "statusCode" INTEGER NOT NULL DEFAULT 200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "ipFirstSeen" TEXT NOT NULL,
    "ipLastSeen" TEXT NOT NULL,
    "locationLastSeen" JSONB,
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "accessTokenJti" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "refreshTokenFamilyId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" "SessionRevokedReason",

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshTokenAudit" (
    "id" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" UUID NOT NULL,

    CONSTRAINT "RefreshTokenAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfaChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "channel" "MfaChannel" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pendingDeviceFingerprint" TEXT NOT NULL,
    "pendingDeviceName" TEXT NOT NULL,
    "pendingDeviceOs" TEXT NOT NULL,
    "pendingDeviceBrowser" TEXT NOT NULL,
    "pendingIp" TEXT NOT NULL,

    CONSTRAINT "MfaChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignupSession" (
    "id" UUID NOT NULL,
    "stage" "SignupStage" NOT NULL DEFAULT 'started',
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "dob" TIMESTAMP(3),
    "phoneE164" TEXT,
    "verifiedChannel" "VerificationChannel",
    "verifiedAt" TIMESTAMP(3),
    "cardChoice" TEXT,
    "street" TEXT,
    "apt" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "passwordHash" TEXT,
    "income" TEXT,
    "occupation" TEXT,
    "annualIncome" TEXT,
    "payMethod" TEXT,
    "foundUs" TEXT,
    "ssnEncrypted" BYTEA,
    "ssnHash" TEXT,
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "referralCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedUserId" UUID,

    CONSTRAINT "SignupSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" UUID NOT NULL,
    "signupSessionId" UUID NOT NULL,
    "channel" "VerificationChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "ownerSignupId" UUID,
    "ownerUserId" UUID,
    "type" "DocumentType" NOT NULL,
    "subtype" "DocumentSubtype",
    "status" "DocumentStatus" NOT NULL DEFAULT 'pending',
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" UUID,
    "rejectionReason" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'pending',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" UUID,
    "rejectionReason" TEXT,
    "missingFields" TEXT[],

    CONSTRAINT "KycRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "ctaUrl" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" UUID NOT NULL,
    "txAll" BOOLEAN NOT NULL DEFAULT true,
    "txLargeOnly" BOOLEAN NOT NULL DEFAULT false,
    "txLargeThresholdCents" BIGINT NOT NULL DEFAULT 10000,
    "securityAlerts" BOOLEAN NOT NULL DEFAULT true,
    "marketingEmail" BOOLEAN NOT NULL DEFAULT true,
    "marketingPush" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "userId" UUID NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "doNotSell" BOOLEAN NOT NULL DEFAULT false,
    "marketingData" BOOLEAN NOT NULL DEFAULT true,
    "analytics" BOOLEAN NOT NULL DEFAULT true,
    "shareContacts" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "TotpSecret" (
    "userId" UUID NOT NULL,
    "secretEnc" BYTEA NOT NULL,
    "secretKeyId" TEXT NOT NULL DEFAULT 'local-aes-v1',
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "TotpSecret_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "BiometricEnrollment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "signCount" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "BiometricEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiometricChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "challenge" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BiometricChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Statement" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Statement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxForm" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "formType" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDoc" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "bodyMd" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" UUID NOT NULL,
    "referrerUserId" UUID NOT NULL,
    "invitedEmail" TEXT,
    "invitedUserId" UUID,
    "code" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'sent',
    "payoutCents" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "qualifiedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionOverride" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "overrideAmountCents" BIGINT,
    "overrideOccurredAt" TIMESTAMP(3),
    "overrideDescription" TEXT,
    "overrideCategory" "TransactionCategory",
    "overrideStatus" "OverrideStatus",
    "compensatingEntryId" UUID,
    "appliedByUserId" UUID NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "TransactionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LinkedAccount_userId_idx" ON "LinkedAccount"("userId");

-- CreateIndex
CREATE INDEX "LinkedAccount_userId_status_idx" ON "LinkedAccount"("userId", "status");

-- CreateIndex
CREATE INDEX "DirectDeposit_active_idx" ON "DirectDeposit"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Employer_name_key" ON "Employer"("name");

-- CreateIndex
CREATE INDEX "Deal_expiresAt_idx" ON "Deal"("expiresAt");

-- CreateIndex
CREATE INDEX "ActivatedDeal_userId_idx" ON "ActivatedDeal"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivatedDeal_userId_dealId_key" ON "ActivatedDeal"("userId", "dealId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneE164_key" ON "User"("phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "User_novaTag_key" ON "User"("novaTag");

-- CreateIndex
CREATE INDEX "Contact_ownerUserId_idx" ON "Contact"("ownerUserId");

-- CreateIndex
CREATE INDEX "PaymentRequest_requesterUserId_idx" ON "PaymentRequest"("requesterUserId");

-- CreateIndex
CREATE INDEX "PaymentRequest_payerUserId_status_idx" ON "PaymentRequest"("payerUserId", "status");

-- CreateIndex
CREATE INDEX "Card_accountId_idx" ON "Card"("accountId");

-- CreateIndex
CREATE INDEX "Card_accountId_status_idx" ON "Card"("accountId", "status");

-- CreateIndex
CREATE INDEX "CardOrder_userId_idx" ON "CardOrder"("userId");

-- CreateIndex
CREATE INDEX "Goal_userId_idx" ON "Goal"("userId");

-- CreateIndex
CREATE INDEX "RoundUpLedger_userId_appliedAt_idx" ON "RoundUpLedger"("userId", "appliedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_mockAccountNumber_key" ON "Account"("mockAccountNumber");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_name_key" ON "Merchant"("name");

-- CreateIndex
CREATE INDEX "Transaction_accountId_occurredAt_idx" ON "Transaction"("accountId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "Transaction_accountId_status_idx" ON "Transaction"("accountId", "status");

-- CreateIndex
CREATE INDEX "Transaction_accountId_category_idx" ON "Transaction"("accountId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_code_key" ON "LedgerAccount"("code");

-- CreateIndex
CREATE INDEX "LedgerAccount_ownerUserId_idx" ON "LedgerAccount"("ownerUserId");

-- CreateIndex
CREATE INDEX "JournalEntry_source_referenceId_idx" ON "JournalEntry"("source", "referenceId");

-- CreateIndex
CREATE INDEX "Posting_ledgerAccountId_idx" ON "Posting"("ledgerAccountId");

-- CreateIndex
CREATE INDEX "Posting_journalEntryId_idx" ON "Posting"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_idempotencyKey_key" ON "Transfer"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Transfer_fromAccountId_idx" ON "Transfer"("fromAccountId");

-- CreateIndex
CREATE INDEX "Transfer_toAccountId_idx" ON "Transfer"("toAccountId");

-- CreateIndex
CREATE INDEX "Transfer_status_idx" ON "Transfer"("status");

-- CreateIndex
CREATE INDEX "RecurringTransfer_userId_idx" ON "RecurringTransfer"("userId");

-- CreateIndex
CREATE INDEX "RecurringTransfer_active_nextRunAt_idx" ON "RecurringTransfer"("active", "nextRunAt");

-- CreateIndex
CREATE INDEX "IdempotencyKey_userId_endpoint_idx" ON "IdempotencyKey"("userId", "endpoint");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_fingerprint_key" ON "Device"("userId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Session_accessTokenJti_key" ON "Session"("accessTokenJti");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_refreshTokenFamilyId_idx" ON "Session"("refreshTokenFamilyId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshTokenAudit_tokenHash_key" ON "RefreshTokenAudit"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshTokenAudit_familyId_idx" ON "RefreshTokenAudit"("familyId");

-- CreateIndex
CREATE INDEX "MfaChallenge_userId_idx" ON "MfaChallenge"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SignupSession_email_key" ON "SignupSession"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SignupSession_ssnHash_key" ON "SignupSession"("ssnHash");

-- CreateIndex
CREATE INDEX "Verification_signupSessionId_consumedAt_idx" ON "Verification"("signupSessionId", "consumedAt");

-- CreateIndex
CREATE INDEX "Document_ownerSignupId_idx" ON "Document"("ownerSignupId");

-- CreateIndex
CREATE INDEX "Document_ownerUserId_idx" ON "Document"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "KycRecord_userId_key" ON "KycRecord"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "BiometricEnrollment_credentialId_key" ON "BiometricEnrollment"("credentialId");

-- CreateIndex
CREATE INDEX "BiometricEnrollment_userId_idx" ON "BiometricEnrollment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BiometricEnrollment_userId_deviceId_key" ON "BiometricEnrollment"("userId", "deviceId");

-- CreateIndex
CREATE INDEX "BiometricChallenge_userId_type_idx" ON "BiometricChallenge"("userId", "type");

-- CreateIndex
CREATE INDEX "Statement_accountId_periodStart_idx" ON "Statement"("accountId", "periodStart" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Statement_accountId_periodStart_key" ON "Statement"("accountId", "periodStart");

-- CreateIndex
CREATE INDEX "TaxForm_userId_taxYear_idx" ON "TaxForm"("userId", "taxYear");

-- CreateIndex
CREATE UNIQUE INDEX "TaxForm_userId_formType_taxYear_key" ON "TaxForm"("userId", "formType", "taxYear");

-- CreateIndex
CREATE INDEX "PolicyDoc_slug_effectiveAt_idx" ON "PolicyDoc"("slug", "effectiveAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDoc_slug_version_key" ON "PolicyDoc"("slug", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_code_key" ON "Referral"("code");

-- CreateIndex
CREATE INDEX "Referral_referrerUserId_idx" ON "Referral"("referrerUserId");

-- CreateIndex
CREATE INDEX "Referral_invitedUserId_idx" ON "Referral"("invitedUserId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_actorUserId_createdAt_idx" ON "AdminAuditLog"("actorUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionOverride_transactionId_key" ON "TransactionOverride"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionOverride_appliedByUserId_idx" ON "TransactionOverride"("appliedByUserId");

-- AddForeignKey
ALTER TABLE "DirectDeposit" ADD CONSTRAINT "DirectDeposit_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivatedDeal" ADD CONSTRAINT "ActivatedDeal_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutosaveConfig" ADD CONSTRAINT "AutosaveConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountLimits" ADD CONSTRAINT "AccountLimits_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Posting" ADD CONSTRAINT "Posting_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Posting" ADD CONSTRAINT "Posting_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaChallenge" ADD CONSTRAINT "MfaChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_signupSessionId_fkey" FOREIGN KEY ("signupSessionId") REFERENCES "SignupSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_ownerSignupId_fkey" FOREIGN KEY ("ownerSignupId") REFERENCES "SignupSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycRecord" ADD CONSTRAINT "KycRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionOverride" ADD CONSTRAINT "TransactionOverride_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
