import {
  Transaction,
  Merchant,
  TransactionOverride,
  OverrideStatus,
  TransactionStatus,
} from '@prisma/client';

export interface MerchantDto {
  id: string;
  name: string;
  logoUrl: string | null;
  category: string | null;
}

export interface TransactionDto {
  id: string;
  accountId: string;
  kind: string;
  status: string;
  amountCents: string;
  currency: string;
  description: string;
  category: string;
  note: string | null;
  occurredAt: string;
  postedAt: string | null;
  merchant: MerchantDto | null;
  counterpartyName: string | null;
}

export function toMerchantDto(m: Merchant | null): MerchantDto | null {
  if (!m) return null;
  return { id: m.id, name: m.name, logoUrl: m.logoUrl, category: m.category };
}

/**
 * Translate the override status enum back into a customer-facing
 * TransactionStatus. `settled` maps to `posted`; `hidden` is filtered
 * out before this is ever called.
 */
function overrideStatusToTxStatus(s: OverrideStatus): TransactionStatus {
  switch (s) {
    case OverrideStatus.pending:
      return TransactionStatus.pending;
    case OverrideStatus.settled:
      return TransactionStatus.posted;
    case OverrideStatus.declined:
      return TransactionStatus.declined;
    case OverrideStatus.reversed:
      return TransactionStatus.reversed;
    case OverrideStatus.hidden:
      // Caller filters before mapping; fall back to posted to satisfy TS.
      return TransactionStatus.posted;
  }
}

export function toTransactionDto(
  t: Transaction & {
    merchant?: Merchant | null;
    override?: TransactionOverride | null;
  },
  counterpartyName: string | null = null,
): TransactionDto {
  const o = t.override ?? null;
  // Merge override fields onto the base row so admin edits are visible
  // to the customer without a second roundtrip. Mirrors `effectiveOf()`
  // in the admin-transactions service.
  const amountCents = (o?.overrideAmountCents ?? t.amountCents).toString();
  const occurredAt = (o?.overrideOccurredAt ?? t.occurredAt).toISOString();
  const description = o?.overrideDescription ?? t.description;
  const category = o?.overrideCategory ?? t.category;
  const status = o?.overrideStatus
    ? overrideStatusToTxStatus(o.overrideStatus)
    : t.status;
  return {
    id: t.id,
    accountId: t.accountId,
    kind: t.kind,
    status,
    amountCents,
    currency: t.currency,
    description,
    category,
    note: t.note,
    occurredAt,
    postedAt: t.postedAt ? t.postedAt.toISOString() : null,
    merchant: toMerchantDto(t.merchant ?? null),
    counterpartyName,
  };
}

/** True if the row has an admin "hidden" override and should be dropped. */
export function isHiddenByOverride(
  t: { override?: TransactionOverride | null },
): boolean {
  return t.override?.overrideStatus === OverrideStatus.hidden;
}
