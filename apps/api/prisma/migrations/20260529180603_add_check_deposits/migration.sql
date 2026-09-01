-- CreateEnum
CREATE TYPE "CheckDepositStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "CheckDeposit" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "status" "CheckDepositStatus" NOT NULL DEFAULT 'pending',
    "frontKey" TEXT NOT NULL,
    "backKey" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" UUID,
    "decisionReason" TEXT,
    "transactionId" UUID,

    CONSTRAINT "CheckDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckDeposit_userId_submittedAt_idx" ON "CheckDeposit"("userId", "submittedAt");

-- CreateIndex
CREATE INDEX "CheckDeposit_status_submittedAt_idx" ON "CheckDeposit"("status", "submittedAt");
