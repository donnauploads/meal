-- Capture the amount + currency the customer entered on the deposit form
-- (their display currency) so decision emails show exactly what they selected.
-- `amountCents` stays the USD ledger value. Both columns are nullable and
-- back-compatible with existing rows.
ALTER TABLE "CheckDeposit" ADD COLUMN "displayAmountCents" BIGINT;
ALTER TABLE "CheckDeposit" ADD COLUMN "displayCurrency" TEXT;
