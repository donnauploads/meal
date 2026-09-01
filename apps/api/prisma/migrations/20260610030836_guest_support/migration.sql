-- Made idempotent so it can be re-applied after a partial failure (P3018).
-- This migration previously failed mid-way on some databases, leaving the
-- enum value / columns / table partially created. Every statement below now
-- tolerates the object already existing, so a re-run converges cleanly
-- regardless of how far the original attempt got.

-- AlterEnum
ALTER TYPE "SupportSenderRole" ADD VALUE IF NOT EXISTS 'guest';

-- AlterTable
ALTER TABLE "SupportMessage" ALTER COLUMN "senderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SupportThread" ADD COLUMN IF NOT EXISTS "guestEmail" TEXT;
ALTER TABLE "SupportThread" ADD COLUMN IF NOT EXISTS "guestId" TEXT;
ALTER TABLE "SupportThread" ADD COLUMN IF NOT EXISTS "guestName" TEXT;
ALTER TABLE "SupportThread" ALTER COLUMN "userId" DROP NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PasswordResetChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "emailHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PasswordResetChallenge_userId_idx" ON "PasswordResetChallenge"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PasswordResetChallenge_emailHash_idx" ON "PasswordResetChallenge"("emailHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupportThread_guestId_idx" ON "SupportThread"("guestId");

-- AddForeignKey (guarded — ADD CONSTRAINT has no IF NOT EXISTS)
DO $$ BEGIN
  ALTER TABLE "PasswordResetChallenge"
    ADD CONSTRAINT "PasswordResetChallenge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
