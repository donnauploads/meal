import { Account, AccountLimits } from '@prisma/client';

export interface AccountDto {
  id: string;
  type: 'checking' | 'savings';
  label: string;
  balanceCents: string;
  apyBps: number | null;
  status: 'active' | 'frozen' | 'closed';
  mockRoutingNumber: string;
  mockAccountNumberMasked: string;
  openedAt: string;
}

export interface AccountLimitsDto {
  accountId: string;
  atmDailyCents: string;
  cardPurchasesDailyCents: string;
  cashDepositCents: string;
  mobileCheckCents: string;
  outgoingWireCents: string;
}

export function toAccountDto(a: Account): AccountDto {
  return {
    id: a.id,
    type: a.type,
    label: a.label,
    balanceCents: a.balanceCents.toString(),
    apyBps: a.apyBps,
    status: a.status,
    mockRoutingNumber: a.mockRoutingNumber,
    mockAccountNumberMasked: `••••${a.mockAccountNumber.slice(-4)}`,
    openedAt: a.openedAt.toISOString(),
  };
}

export function toLimitsDto(l: AccountLimits): AccountLimitsDto {
  return {
    accountId: l.accountId,
    atmDailyCents: l.atmDailyCents.toString(),
    cardPurchasesDailyCents: l.cardPurchasesDailyCents.toString(),
    cashDepositCents: l.cashDepositCents.toString(),
    mobileCheckCents: l.mobileCheckCents.toString(),
    outgoingWireCents: l.outgoingWireCents.toString(),
  };
}
