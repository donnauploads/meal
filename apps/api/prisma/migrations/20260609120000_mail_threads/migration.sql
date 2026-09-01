-- CreateEnum
CREATE TYPE "MailDesk" AS ENUM ('customer_care', 'administrator', 'bank_manager');

-- CreateEnum
CREATE TYPE "MailThreadStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "MailDirection" AS ENUM ('outbound', 'inbound');

-- CreateTable
CREATE TABLE "MailThread" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "toEmail" TEXT NOT NULL,
    "toName" TEXT,
    "desk" "MailDesk" NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "MailThreadStatus" NOT NULL DEFAULT 'open',
    "replyToken" TEXT NOT NULL,
    "references" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "unreadForAdmins" BOOLEAN NOT NULL DEFAULT false,
    "assignedAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailMessage" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "direction" "MailDirection" NOT NULL,
    "desk" "MailDesk" NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "rfcMessageId" TEXT,
    "inReplyTo" TEXT,
    "authoredByAdminId" UUID,
    "readByAdminAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailAttachment" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT,
    "resendAttachmentId" TEXT,
    "inline" BOOLEAN NOT NULL DEFAULT false,
    "contentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailThread_replyToken_key" ON "MailThread"("replyToken");

-- CreateIndex
CREATE INDEX "MailThread_status_lastMessageAt_idx" ON "MailThread"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "MailThread_userId_idx" ON "MailThread"("userId");

-- CreateIndex
CREATE INDEX "MailThread_desk_idx" ON "MailThread"("desk");

-- CreateIndex
CREATE INDEX "MailMessage_threadId_createdAt_idx" ON "MailMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "MailAttachment_messageId_idx" ON "MailAttachment"("messageId");

-- AddForeignKey
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailAttachment" ADD CONSTRAINT "MailAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "MailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
