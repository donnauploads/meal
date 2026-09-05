/**
 * Seed personas + sample data for the demo.
 *
 * What it creates:
 *   - 1 customer (KYC approved, 1 checking + 1 savings, 30 transactions across last 60 days)
 *   - 1 admin (role = admin, KYC approved)
 *   - Reuses or seeds the Stage 4 merchant catalog so transactions reference real merchants
 *
 * Idempotent: re-running upserts the users, skips account provisioning if accounts already exist,
 * and skips transactions if the checking account already has any rows.
 *
 * How to run:
 *   1. Make sure Postgres + Redis are up:
 *        pnpm docker:up
 *   2. Apply migrations + Stage-4 SQL views (transactions filter on them):
 *        pnpm --filter api exec prisma migrate dev
 *        psql "$env:DATABASE_URL" -f apps/api/prisma/sql/stage4-views.sql
 *   3. Run the seed:
 *        pnpm --filter api exec ts-node src/scripts/seed-personas.ts
 *   4. Credentials are printed at the end. Use them to log in via the frontend or
 *      `POST /api/v1/auth/login`.
 *
 * Re-seed transactions:
 *   pnpm --filter api exec ts-node src/scripts/seed-personas.ts --refresh-tx
 *   (Deletes existing transactions on the customer's checking + savings, then re-creates 30.)
 */

import {
  AccountStatus,
  AccountType,
  KycStatus,
  PrismaClient,
  TransactionCategory,
  TransactionKind,
  TransactionStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { randomInt, randomUUID } from 'crypto';

const CUSTOMER = {
  email: 'maya@secure-access.site',
  password: 'Password123!',
  // Transaction/login PIN. Required for money-movement elevation AND the
  // dashboard inactivity lock (which only arms when the user has a PIN).
  pin: '1234',
  firstName: 'Maya',
  lastName: 'Patel',
  phoneE164: '+14155550101',
  novaTag: '@maya',
  dob: new Date('1995-03-14T00:00:00Z'),
};

const ADMIN = {
  email: 'admin@secure-access.site',
  password: 'AdminPassword123!',
  pin: '1234',
  firstName: 'Avery',
  lastName: 'Singh',
  phoneE164: '+14155550010',
  novaTag: '@avery_admin',
  dob: new Date('1988-08-02T00:00:00Z'),
};

const MERCHANT_SEEDS: { name: string; mcc: string; category: TransactionCategory }[] = [
  { name: 'Whole Foods Market', mcc: '5411', category: TransactionCategory.groceries },
  { name: 'Trader Joe\'s',     mcc: '5411', category: TransactionCategory.groceries },
  { name: 'Chipotle',          mcc: '5812', category: TransactionCategory.dining },
  { name: 'Starbucks',         mcc: '5814', category: TransactionCategory.dining },
  { name: 'Sweetgreen',        mcc: '5812', category: TransactionCategory.dining },
  { name: 'Uber',              mcc: '4121', category: TransactionCategory.transport },
  { name: 'Lyft',              mcc: '4121', category: TransactionCategory.transport },
  { name: 'NYC MTA',           mcc: '4111', category: TransactionCategory.transport },
  { name: 'Netflix',           mcc: '4899', category: TransactionCategory.entertainment },
  { name: 'Spotify',           mcc: '5815', category: TransactionCategory.entertainment },
  { name: 'Amazon',            mcc: '5942', category: TransactionCategory.shopping },
  { name: 'Target',            mcc: '5310', category: TransactionCategory.shopping },
  { name: 'Apple Store',       mcc: '5732', category: TransactionCategory.shopping },
  { name: 'Con Edison',        mcc: '4900', category: TransactionCategory.utilities },
  { name: 'Verizon',           mcc: '4814', category: TransactionCategory.utilities },
  { name: 'CVS Pharmacy',      mcc: '5912', category: TransactionCategory.health },
  { name: 'Delta Air Lines',   mcc: '4511', category: TransactionCategory.travel },
];

const DEMO_ROUTING = '021000099';

function mockAccountNumber(): string {
  let n = '';
  for (let i = 0; i < 12; i++) n += randomInt(0, 10).toString();
  return n;
}

async function upsertUser(prisma: PrismaClient, p: typeof CUSTOMER, role: UserRole) {
  const passwordHash = await argon2.hash(p.password, { type: argon2.argon2id });
  const transactionPinHash = await argon2.hash(p.pin, { type: argon2.argon2id });

  // phoneE164 has its own UNIQUE constraint. If a different email
  // already owns this persona's phone number (e.g. a manual signup,
  // a half-deleted prior seed, an old fixture), the upsert below
  // would fall through to `create` and fail with P2002 on
  // (phoneE164). Detect + free up the conflicting row first so the
  // persona seed is always idempotent on production data too.
  const phoneOwner = await prisma.user.findUnique({
    where: { phoneE164: p.phoneE164 },
    select: { id: true, email: true },
  });
  if (phoneOwner && phoneOwner.email !== p.email) {
    console.log(
      `   ↻ freeing phone ${p.phoneE164} from existing user ${phoneOwner.email} so persona ${p.email} can claim it`,
    );
    await prisma.user.update({
      where: { id: phoneOwner.id },
      data: { phoneE164: null },
    });
  }

  // novaTag has its own UNIQUE constraint — same story as phoneE164. If a
  // different email already owns this persona's tag (a stale fixture, an old
  // seed under a different email, e.g. admin@nova.demo holding @avery_admin),
  // the upsert would fail with P2002 on (novaTag). Free it first so the
  // persona seed stays idempotent against existing data.
  if (p.novaTag) {
    const tagOwner = await prisma.user.findUnique({
      where: { novaTag: p.novaTag },
      select: { id: true, email: true },
    });
    if (tagOwner && tagOwner.email !== p.email) {
      console.log(
        `   ↻ freeing tag ${p.novaTag} from existing user ${tagOwner.email} so persona ${p.email} can claim it`,
      );
      await prisma.user.update({
        where: { id: tagOwner.id },
        data: { novaTag: null },
      });
    }
  }

  const user = await prisma.user.upsert({
    where: { email: p.email },
    update: {
      passwordHash,
      transactionPinHash,
      firstName: p.firstName,
      lastName: p.lastName,
      novaTag: p.novaTag,
      phoneE164: p.phoneE164,
      dob: p.dob,
      role,
      status: UserStatus.active,
    },
    create: {
      email: p.email,
      passwordHash,
      transactionPinHash,
      firstName: p.firstName,
      lastName: p.lastName,
      novaTag: p.novaTag,
      phoneE164: p.phoneE164,
      dob: p.dob,
      role,
      status: UserStatus.active,
    },
  });
  await prisma.kycRecord.upsert({
    where: { userId: user.id },
    update: { status: KycStatus.approved, reviewedAt: new Date() },
    create: { userId: user.id, status: KycStatus.approved, reviewedAt: new Date(), missingFields: [] },
  });
  return user;
}

async function provisionAccounts(prisma: PrismaClient, userId: string) {
  const existing = await prisma.account.findMany({ where: { userId } });
  const haveChecking = existing.find((a) => a.type === AccountType.checking);
  const haveSavings = existing.find((a) => a.type === AccountType.savings);

  const checking = haveChecking ?? (await prisma.account.create({
    data: {
      userId,
      type: AccountType.checking,
      label: 'Checking',
      mockRoutingNumber: DEMO_ROUTING,
      mockAccountNumber: mockAccountNumber(),
      status: AccountStatus.active,
    },
  }));
  if (!haveChecking) {
    await prisma.accountLimits.create({
      data: {
        accountId: checking.id,
        // Marketing-spec limits: wire $5M, mobile check $500k,
        // cash deposit $50k, card purchases $100k/day.
        atmDailyCents: 50_000n,
        cardPurchasesDailyCents: 10_000_000n,
        cashDepositCents: 5_000_000n,
        mobileCheckCents: 50_000_000n,
        outgoingWireCents: 500_000_000n,
      },
    });
  }

  const savings = haveSavings ?? (await prisma.account.create({
    data: {
      userId,
      type: AccountType.savings,
      label: 'Savings',
      mockRoutingNumber: DEMO_ROUTING,
      mockAccountNumber: mockAccountNumber(),
      status: AccountStatus.active,
      apyBps: 450,
    },
  }));

  return { checking, savings };
}

async function ensureMerchants(prisma: PrismaClient) {
  const out: { id: string; name: string; category: TransactionCategory }[] = [];
  for (const m of MERCHANT_SEEDS) {
    const row = await prisma.merchant.upsert({
      where: { name: m.name },
      update: { mcc: m.mcc, category: m.category },
      create: { name: m.name, mcc: m.mcc, category: m.category },
    });
    out.push({ id: row.id, name: row.name, category: m.category });
  }
  return out;
}

function pick<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length)];
}

async function seedTransactions(
  prisma: PrismaClient,
  checkingId: string,
  savingsId: string,
  merchants: { id: string; name: string; category: TransactionCategory }[],
) {
  const now = new Date();
  const rows: Array<{
    accountId: string;
    kind: TransactionKind;
    status: TransactionStatus;
    amountCents: bigint;
    description: string;
    category: TransactionCategory;
    merchantId?: string;
    occurredAt: Date;
    postedAt: Date;
    note?: string;
  }> = [];

  // Two paychecks
  for (const daysAgo of [3, 17]) {
    const at = new Date(now.getTime() - daysAgo * 86_400_000);
    rows.push({
      accountId: checkingId,
      kind: TransactionKind.ach_in,
      status: TransactionStatus.posted,
      amountCents: 285_000n,
      description: 'Direct deposit — Acme Co.',
      category: TransactionCategory.income,
      occurredAt: at,
      postedAt: at,
    });
  }

  // Rent
  for (const daysAgo of [1, 31]) {
    const at = new Date(now.getTime() - daysAgo * 86_400_000);
    rows.push({
      accountId: checkingId,
      kind: TransactionKind.ach_out,
      status: TransactionStatus.posted,
      amountCents: -185_000n,
      description: 'Rent — landlord ACH',
      category: TransactionCategory.bills,
      occurredAt: at,
      postedAt: at,
    });
  }

  // Internet bill
  const internetAt = new Date(now.getTime() - 12 * 86_400_000);
  rows.push({
    accountId: checkingId,
    kind: TransactionKind.ach_out,
    status: TransactionStatus.posted,
    amountCents: -7_999n,
    description: 'Verizon Fios',
    category: TransactionCategory.utilities,
    merchantId: merchants.find((m) => m.name === 'Verizon')?.id,
    occurredAt: internetAt,
    postedAt: internetAt,
  });

  // Savings auto-transfer
  for (const daysAgo of [4, 18, 32, 46]) {
    const at = new Date(now.getTime() - daysAgo * 86_400_000);
    rows.push({
      accountId: checkingId,
      kind: TransactionKind.adjustment,
      status: TransactionStatus.posted,
      amountCents: -10_000n,
      description: 'Autosave to Savings',
      category: TransactionCategory.transfer,
      occurredAt: at,
      postedAt: at,
    });
    rows.push({
      accountId: savingsId,
      kind: TransactionKind.adjustment,
      status: TransactionStatus.posted,
      amountCents: 10_000n,
      description: 'Autosave from Checking',
      category: TransactionCategory.transfer,
      occurredAt: at,
      postedAt: at,
    });
  }

  // Card purchases — fill remaining slots up to 30 total
  while (rows.length < 30) {
    const merchant = pick(merchants);
    const daysAgo = randomInt(1, 60);
    const at = new Date(now.getTime() - daysAgo * 86_400_000);
    const amount = BigInt(-randomInt(300, 9_500));
    rows.push({
      accountId: checkingId,
      kind: TransactionKind.card_purchase,
      status: TransactionStatus.posted,
      amountCents: amount,
      description: merchant.name,
      category: merchant.category,
      merchantId: merchant.id,
      occurredAt: at,
      postedAt: at,
    });
  }

  // Insert + bump cached balances
  let checkingDelta = 0n;
  let savingsDelta = 0n;
  for (const r of rows) {
    await prisma.transaction.create({
      data: {
        id: randomUUID(),
        accountId: r.accountId,
        kind: r.kind,
        status: r.status,
        amountCents: r.amountCents,
        description: r.description,
        category: r.category,
        merchantId: r.merchantId,
        occurredAt: r.occurredAt,
        postedAt: r.postedAt,
      },
    });
    if (r.accountId === checkingId) checkingDelta += r.amountCents;
    else if (r.accountId === savingsId) savingsDelta += r.amountCents;
  }
  await prisma.account.update({
    where: { id: checkingId },
    data: { balanceCents: { increment: checkingDelta } },
  });
  await prisma.account.update({
    where: { id: savingsId },
    data: { balanceCents: { increment: savingsDelta } },
  });
  return rows.length;
}

/**
 * Persona seed is OPT-IN. It does nothing unless ENABLE_PERSONA_SEED=1
 * is set in the calling environment.
 *
 * Why opt-in (not opt-out): personas like `maya@secure-access.site` ship with
 * known passwords + full account access. The earlier "is the DB local?"
 * check was unreliable because a VPS's own Postgres ALSO looks "local"
 * (it runs on localhost from the API's perspective). The only safe
 * default is to refuse unless someone explicitly says yes.
 *
 * Local dev:  add `ENABLE_PERSONA_SEED=1` to backend/apps/api/.env
 * One-off:    `ENABLE_PERSONA_SEED=1 pnpm exec ts-node src/scripts/seed-personas.ts`
 */
function refuseUnlessOptedIn() {
  if (process.env.ENABLE_PERSONA_SEED === '1') return;

  console.log(
    '\n▸ Persona seed skipped — opt-in required.\n' +
      '  This script creates demo users (maya@secure-access.site, admin@secure-access.site)\n' +
      '  with known passwords. Set ENABLE_PERSONA_SEED=1 in your env to run\n' +
      '  it (typically only on a developer machine).\n',
  );
  process.exit(0);
}

async function main() {
  refuseUnlessOptedIn();
  const refresh = process.argv.includes('--refresh-tx');
  const prisma = new PrismaClient();
  try {
    const customer = await upsertUser(prisma, CUSTOMER, UserRole.customer);
    const admin = await upsertUser(prisma, ADMIN, UserRole.admin);

    const { checking, savings } = await provisionAccounts(prisma, customer.id);
    const merchants = await ensureMerchants(prisma);

    const existingTx = await prisma.transaction.count({ where: { accountId: checking.id } });
    let inserted = 0;
    if (refresh && existingTx > 0) {
      const deletedChk = await prisma.transaction.deleteMany({ where: { accountId: checking.id } });
      const deletedSav = await prisma.transaction.deleteMany({ where: { accountId: savings.id } });
      await prisma.account.update({ where: { id: checking.id }, data: { balanceCents: 0n } });
      await prisma.account.update({ where: { id: savings.id }, data: { balanceCents: 0n } });
      console.log(`Cleared ${deletedChk.count + deletedSav.count} existing transactions.`);
      inserted = await seedTransactions(prisma, checking.id, savings.id, merchants);
    } else if (existingTx === 0) {
      inserted = await seedTransactions(prisma, checking.id, savings.id, merchants);
    } else {
      console.log(`Checking already has ${existingTx} transactions — skipping (rerun with --refresh-tx to wipe & redo).`);
    }

    const checkingFresh = await prisma.account.findUnique({ where: { id: checking.id } });
    const savingsFresh = await prisma.account.findUnique({ where: { id: savings.id } });

    console.log('\n=== Seed complete ===');
    console.log(`Customer:  ${CUSTOMER.email}  / ${CUSTOMER.password}`);
    console.log(`           novaTag=${CUSTOMER.novaTag}  userId=${customer.id}`);
    console.log(`Admin:     ${ADMIN.email}  / ${ADMIN.password}`);
    console.log(`           novaTag=${ADMIN.novaTag}  userId=${admin.id}  role=admin`);
    console.log('\nCustomer accounts:');
    console.log(`  Checking  id=${checking.id}  balance=$${(Number(checkingFresh!.balanceCents) / 100).toFixed(2)}  acct=••••${checking.mockAccountNumber.slice(-4)}`);
    console.log(`  Savings   id=${savings.id}  balance=$${(Number(savingsFresh!.balanceCents) / 100).toFixed(2)}  acct=••••${savings.mockAccountNumber.slice(-4)}`);
    if (inserted) console.log(`\nInserted ${inserted} transactions across the last 60 days.`);
    console.log('\nLog in at the frontend or POST /api/v1/auth/login.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
