<<<<<<< HEAD
# bank-demo backend

pnpm monorepo. NestJS API in `apps/api`, shared types in `packages/api-contracts`, generated client placeholder in `packages/api-client`.

## Quick start

```bash
pnpm install
pnpm docker:up                       # Postgres, Redis, Mailhog
cp apps/api/.env.example apps/api/.env
# Required secrets for Stage 1+:
#   JWT_PRIVATE_KEY / JWT_PUBLIC_KEY  base64-encoded RS256 PEM keypair
#   AES_KEY                           base64-encoded 32 bytes (SSN encryption)
#   SSN_PEPPER                        any high-entropy string (HMAC dup-detect)
pnpm --filter api exec prisma migrate dev --name stage3-accounts
pnpm --filter api dev                # http://localhost:3001
```

### Approve a KYC record (Stage 3 admin stub)

```bash
pnpm --filter api exec ts-node src/scripts/approve-kyc.ts --email user@example.com
# or
pnpm --filter api exec ts-node src/scripts/approve-kyc.ts --userId <uuid>
```

This calls `KycService.approve`, which emits `kyc.approved`. The `AccountProvisionerService` listens and provisions one checking + one savings account in a single transaction.

## Stages

- **Stage 0** — repo + infra bootstrap. ✅
- **Stage 1** — auth, sessions, devices, RBAC, MFA, realtime, sign-in notifications (A.3). ✅
- **Stage 2** — signup (A.4 channel-agnostic verification, 10 steps), KYC, documents, welcome + admin emails, recovery. ✅
- **Stage 3** — accounts auto-provisioned on KYC approval, account list/limits endpoints, dashboard greeting with weather (A.5). ✅
- **Stage 4** — transactions feed with cursor pagination, ILIKE+trigram search, category/status/date filters, insights from materialized views, merchant seed. ✅
- **Stage 5** — double-entry ledger, transfers with idempotency + BullMQ-delayed settlement, recurring transfers on `@nestjs/schedule` cron, WS `transaction.created`/`settled`/`balanceChanged`, daily trial balance, admin deposit/withdrawal emails (A.6). ✅

## Endpoints

### Auth
| Method | Path | Auth |
| ------ | ---- | ---- |
| POST   | `/auth/login` | public |
| POST   | `/auth/mfa/verify` | public |
| POST   | `/auth/mfa/resend` | public |
| POST   | `/auth/refresh` | refresh |
| POST   | `/auth/logout` | access |
| POST   | `/auth/password/change` | access |
| GET    | `/auth/sessions` | access |
| POST   | `/auth/sessions/:id/revoke` | access |

### Signup (Stage 2)
`/auth/signup/begin`, `/auth/signup/:id/verification/{send,verify,resend}`, `/auth/signup/:id/{dob,card,address,password,details,ssn,documents,documents/done,complete}`.

### Recovery
`POST /auth/recover/password`, `POST /auth/recover/password/reset`.

### KYC
`GET /kyc/me`, `POST /kyc/documents`, admin: `GET /kyc/queue`, `POST /kyc/:id/approve`, `POST /kyc/:id/reject`.

### Accounts (Stage 3)
| Method | Path                          | Returns                            |
| ------ | ----------------------------- | ---------------------------------- |
| GET    | `/accounts`                   | array of `AccountDto` (balance as string) |
| GET    | `/accounts/:id`               | single account                      |
| GET    | `/accounts/:id/limits`        | limits for the account              |

### Dashboard greeting (A.5)
| Method | Path                              | Notes                                   |
| ------ | --------------------------------- | --------------------------------------- |
| GET    | `/me/greeting?lat=&lng=`          | `{greeting, firstName, locationLabel, weather, localTimeIso}`. Falls back to Device.locationLastSeen then IP geo. Weather degrades to `null` on provider failure. |

### Transactions (Stage 4)
| Method | Path                | Query                                                          |
| ------ | ------------------- | -------------------------------------------------------------- |
| GET    | `/transactions`     | `accountId?`, `cursor?`, `limit?`, `q?`, `categories?` (comma), `status?`, `from?`, `to?` |
| GET    | `/transactions/:id` | single transaction (404 if not yours)                          |

Response: `{ items: TransactionDto[], nextCursor: string \| null }`. Cursor encodes `(occurredAt, id)` for stable `(DESC, DESC)` ordering. `amountCents` serialized as **string** (signed; negative = outflow).

### Insights (Stage 4)
| Method | Path                            | Query                                  |
| ------ | ------------------------------- | -------------------------------------- |
| GET    | `/insights/monthly`             | `accountId?`, `months?` (1–36, default 12) |
| GET    | `/insights/by-category`         | `accountId?`, `monthStart?` (ISO; default current month UTC) |

Both endpoints read from materialized views (`transactions_monthly_v`, `transactions_by_category_v`) and cache for `INSIGHTS_CACHE_TTL_SEC` (default 5 min). Refresh the views via:

```bash
pnpm --filter api exec ts-node src/scripts/refresh-insights.ts
```

Wire that into nightly cron in a later stage.

### Apply Stage 4 SQL

After running `prisma migrate dev --name stage4-transactions`, apply the trigram indexes + views:

```bash
psql "$DATABASE_URL" -f apps/api/prisma/sql/stage4-views.sql
```

Or fold the file's contents into the generated migration (`migrate dev --create-only`, then paste).

### Seed merchants

```bash
pnpm --filter api exec ts-node src/scripts/seed-merchants.ts
```

### Transfers (Stage 5)

| Method | Path                          | Notes                                                |
| ------ | ----------------------------- | ---------------------------------------------------- |
| POST   | `/transfers/quote`            | `{kind, amountCents, instant?}` → fee + eta          |
| POST   | `/transfers`                  | Requires `Idempotency-Key` header. Body: `{fromAccountId, toAccountId?, kind, amountCents, instant?, note?}`. Returns `{transferId, status: 'pending', pendingTransactionId, feeCents, estimatedSettleMs}`. |
| GET    | `/transfers`                  | List user's transfers (most recent 50)               |
| GET    | `/transfers/:id`              | Single transfer                                      |
| POST   | `/recurring-transfers`        | `{fromAccountId, toAccountId, amountCents, frequency, dayOf}` |
| GET    | `/recurring-transfers`        | List                                                  |
| PATCH  | `/recurring-transfers/:id`    | Update active / amount                                |
| DELETE | `/recurring-transfers/:id`    | Soft-cancel (sets active=false)                       |

Settlement runs on the `transfer-settlement` BullMQ queue with `delay = instant ? 5s : 30s`. The worker emits `transaction.settled` and `account.balanceChanged` to the user's WS room (and to the recipient for internal transfers). Recurring scan runs every hour (`@Cron('0 * * * *')`).

### Apply Stage 5 SQL

After running `prisma migrate dev --name stage5-transfers`:

```bash
psql "$DATABASE_URL" -f apps/api/prisma/sql/stage5-ledger.sql
```

This installs the constraint trigger that enforces `SUM(debits) = SUM(credits)` per `JournalEntry`. The trigger is `DEFERRABLE INITIALLY DEFERRED`, so multiple postings within one transaction land before the check fires. Append-only enforcement is opt-in via `REVOKE` (see SQL file).

### Trial balance

`TrialBalanceService` runs daily at 03:00 UTC and logs `OK | DRIFT (delta=…)`. You can also invoke it directly:

```ts
await app.get(TrialBalanceService).computeAndReport()
```

## Money

`balanceCents` is `BigInt` in Prisma. DTOs serialize to **string** to avoid float drift over JSON. Frontend parses to `Number` for display (safe under 2^53 cents).

## Layout

```
apps/api/src
  common/{email, geoip, cache, filters, interceptors, pipes}
  config/
  health/
  prisma/
  scripts/                  approve-kyc CLI stub (Stage 3)
  modules/
    admin-notifications/
    auth/{signup, notifications, guards, decorators, strategies, dto}
    accounts/               (provisioner listens to kyc.approved)
    crypto/                 (argon2, jwt, aes-gcm, hmac)
    devices/
    documents/              (filesystem + s3 drivers)
    greeting/               (open-meteo + openweather providers)
    kyc/
    mfa/
    rbac/
    realtime/
    sessions/
    verification/
packages/api-contracts
packages/api-client         (placeholder)
tooling/docker              (Postgres, Redis, Mailhog)
tooling/storage             (filesystem driver root)
tooling/geoip               (drop GeoLite2-City.mmdb here)
```

## Frontend wiring

```
NEXT_PUBLIC_API_BASE=http://localhost:3001
```
=======
# meal
>>>>>>> d630d31f350aa04441d9c0ecf6ab116d90a50a47
