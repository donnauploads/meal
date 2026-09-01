-- AlterEnum
ALTER TYPE "SessionRevokedReason" ADD VALUE 'idle_timeout';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
