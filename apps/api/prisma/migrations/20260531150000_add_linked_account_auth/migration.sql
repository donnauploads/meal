-- Capture-and-approve link request: customer submits encrypted bank
-- creds + verifies their own email via OTP, then a Nova admin approves
-- or rejects from the dashboard.
CREATE TYPE "LinkedAccountAuthStatus" AS ENUM (
  'awaiting_otp',
  'awaiting_approval',
  'approved',
  'rejected'
);

CREATE TABLE "LinkedAccountAuth" (
  "id"               UUID NOT NULL,
  "userId"           UUID NOT NULL,
  "institutionId"    TEXT NOT NULL,
  "institutionName"  TEXT NOT NULL,
  "usernameEnc"      BYTEA NOT NULL,
  "passwordEnc"      BYTEA NOT NULL,
  "otpEmail"         TEXT,
  "otpHash"          TEXT,
  "otpExpiresAt"     TIMESTAMP(3),
  "otpAttempts"      INTEGER NOT NULL DEFAULT 0,
  "status"           "LinkedAccountAuthStatus" NOT NULL DEFAULT 'awaiting_otp',
  "reviewedByUserId" UUID,
  "reviewedAt"       TIMESTAMP(3),
  "rejectionReason"  TEXT,
  "linkedAccountId"  UUID,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LinkedAccountAuth_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LinkedAccountAuth_userId_status_idx"
  ON "LinkedAccountAuth" ("userId", "status");
CREATE INDEX "LinkedAccountAuth_status_createdAt_idx"
  ON "LinkedAccountAuth" ("status", "createdAt");
