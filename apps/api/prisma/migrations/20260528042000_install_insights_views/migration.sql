-- Stage 4 — insights materialised views.
-- Promotes the previously-manual `prisma/sql/stage4-views.sql` into a
-- tracked migration so a fresh `prisma migrate deploy` boots the API
-- with insights queryable out of the box (no separate psql step).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS transaction_description_trgm_idx
  ON "Transaction" USING gin (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS merchant_name_trgm_idx
  ON "Merchant" USING gin (name gin_trgm_ops);

-- Monthly totals per account.
CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_monthly_v AS
SELECT
  "accountId"                                                                   AS account_id,
  date_trunc('month', "occurredAt")                                             AS month_start,
  to_char(date_trunc('month', "occurredAt"), 'YYYY-MM')                         AS year_month,
  SUM(CASE WHEN "amountCents" > 0 THEN "amountCents" ELSE 0 END)::bigint        AS total_in_cents,
  SUM(CASE WHEN "amountCents" < 0 THEN -"amountCents" ELSE 0 END)::bigint       AS total_out_cents,
  COUNT(*)                                                                      AS tx_count
FROM "Transaction"
WHERE "status" = 'posted'
GROUP BY 1, 2;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_monthly_v_pk
  ON transactions_monthly_v (account_id, month_start);

-- Category totals per account per month.
CREATE MATERIALIZED VIEW IF NOT EXISTS transactions_by_category_v AS
SELECT
  "accountId"                                                                   AS account_id,
  date_trunc('month', "occurredAt")                                             AS month_start,
  "category"                                                                    AS category,
  SUM(CASE WHEN "amountCents" < 0 THEN -"amountCents" ELSE 0 END)::bigint       AS total_spent_cents,
  COUNT(*)                                                                      AS tx_count
FROM "Transaction"
WHERE "status" = 'posted'
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_by_category_v_pk
  ON transactions_by_category_v (account_id, month_start, category);
