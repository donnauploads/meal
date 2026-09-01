-- Soft-delete column for biometric enrollments. Toggling biometric off
-- in the Security Center sets this; toggling on clears it. The OS-level
-- passkey persists across the toggle either way, so we just track the
-- user's preference instead of repeatedly re-enrolling.
ALTER TABLE "BiometricEnrollment"
  ADD COLUMN "disabledAt" TIMESTAMP(3);
