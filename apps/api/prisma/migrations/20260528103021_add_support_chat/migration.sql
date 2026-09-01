-- CreateEnum
CREATE TYPE "SupportThreadStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "SupportSenderRole" AS ENUM ('customer', 'admin');

-- DropIndex
DROP INDEX "merchant_name_trgm_idx";

-- DropIndex
DROP INDEX "transaction_description_trgm_idx";

-- CreateTable
CREATE TABLE "SupportThread" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "subject" TEXT,
    "status" "SupportThreadStatus" NOT NULL DEFAULT 'open',
    "lastMessageAt" TIMESTAMP(3),
    "unreadForAdmins" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "senderRole" "SupportSenderRole" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportThread_userId_idx" ON "SupportThread"("userId");

-- CreateIndex
CREATE INDEX "SupportThread_status_lastMessageAt_idx" ON "SupportThread"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportMessage_threadId_createdAt_idx" ON "SupportMessage"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "SupportThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
