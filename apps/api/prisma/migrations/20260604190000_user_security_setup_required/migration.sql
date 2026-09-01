-- First-login security gate: admin-created users (or admin-set passwords with
-- requireSecuritySetup) must change their password and set a transaction PIN
-- on first sign-in. Cleared once the PIN is set.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "securitySetupRequired" BOOLEAN NOT NULL DEFAULT false;
