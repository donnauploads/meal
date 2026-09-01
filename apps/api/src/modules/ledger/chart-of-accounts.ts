import { LedgerAccountType, PostingDirection } from '@prisma/client';

export const SYSTEM_LEDGER_CODES = {
  Cash: 'CASH',
  PendingOut: 'PENDING_OUT',
  PendingIn: 'PENDING_IN',
  FeeRevenue: 'FEE_REV',
  InterestExpense: 'INT_EXP',
} as const;

export interface SystemLedgerSeed {
  code: string;
  type: LedgerAccountType;
  normalBalance: PostingDirection;
}

export const SYSTEM_LEDGER_SEEDS: SystemLedgerSeed[] = [
  { code: SYSTEM_LEDGER_CODES.Cash,           type: LedgerAccountType.asset,     normalBalance: PostingDirection.debit },
  { code: SYSTEM_LEDGER_CODES.PendingOut,     type: LedgerAccountType.liability, normalBalance: PostingDirection.credit },
  { code: SYSTEM_LEDGER_CODES.PendingIn,      type: LedgerAccountType.asset,     normalBalance: PostingDirection.debit },
  { code: SYSTEM_LEDGER_CODES.FeeRevenue,     type: LedgerAccountType.revenue,   normalBalance: PostingDirection.credit },
  { code: SYSTEM_LEDGER_CODES.InterestExpense, type: LedgerAccountType.expense,  normalBalance: PostingDirection.debit },
];

export function custLiabilityCode(userId: string): string {
  return `CUST_LIAB_${userId}`;
}

export function accountSubLedgerCode(accountId: string): string {
  return `ACCT_${accountId}`;
}
