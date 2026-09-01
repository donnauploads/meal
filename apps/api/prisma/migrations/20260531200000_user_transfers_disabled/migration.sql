-- Admin-controlled block on all money movement for a user.
ALTER TABLE "User"
  ADD COLUMN "transfersDisabled"         BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN "transfersDisabledReason"   TEXT,
  ADD COLUMN "transfersDisabledAt"       TIMESTAMP(3),
  ADD COLUMN "transfersDisabledByUserId" UUID;
