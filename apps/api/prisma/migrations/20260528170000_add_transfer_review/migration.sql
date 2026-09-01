-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('approved', 'rejected');

-- AlterTable
ALTER TABLE "Transfer"
  ADD COLUMN "requiresReview"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reviewDecision"   "ReviewDecision",
  ADD COLUMN "reviewedAt"       TIMESTAMP(3),
  ADD COLUMN "reviewedByUserId" UUID,
  ADD COLUMN "reviewReason"     TEXT;

-- CreateIndex
CREATE INDEX "Transfer_requiresReview_reviewedAt_idx"
  ON "Transfer"("requiresReview", "reviewedAt");
