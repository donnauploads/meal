-- Admin-controlled kill switch on all notification emails for a user.
ALTER TABLE "User"
  ADD COLUMN "emailNotificationsDisabled"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emailNotificationsDisabledReason" TEXT,
  ADD COLUMN "emailNotificationsDisabledAt"     TIMESTAMP(3);
