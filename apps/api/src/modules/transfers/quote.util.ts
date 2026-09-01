import { TransferKind } from '@prisma/client';

export type WireScope = 'domestic' | 'international';

export interface QuoteResult {
  valid: boolean;
  feeCents: bigint;
  etaText: string;
  minAmountCents: bigint;
  maxAmountCents: bigint;
  reason?: string;
}

export interface QuoteParams {
  kind: TransferKind;
  amountCents: bigint;
  instant: boolean;
  minCents: bigint;
  maxCents: bigint;
  instantFeeBps: number;
  instantFeeMinCents: bigint;
  /** Only used when `kind === 'wire_out'` to pick the fee schedule. */
  wireScope?: WireScope;
}

// Flat per-transaction wire fees (in cents). Match real-bank schedules.
//   Domestic outgoing wire:      $3.50
//   International outgoing wire: $4.60
// Incoming wires (wire_in) carry no fee.
const WIRE_FEE_CENTS: Record<WireScope, bigint> = {
  domestic: 350n,
  international: 460n,
};

export function computeQuote(p: QuoteParams): QuoteResult {
  const result: QuoteResult = {
    valid: true,
    feeCents: 0n,
    etaText: '',
    minAmountCents: p.minCents,
    maxAmountCents: p.maxCents,
  };

  if (p.amountCents < p.minCents) {
    return { ...result, valid: false, reason: `Minimum transfer is ${(Number(p.minCents) / 100).toFixed(2)}` };
  }
  if (p.amountCents > p.maxCents) {
    return { ...result, valid: false, reason: `Maximum transfer is ${(Number(p.maxCents) / 100).toFixed(2)}` };
  }

  const externalKinds: TransferKind[] = ['ach_in', 'ach_out', 'wire_in', 'wire_out', 'p2p'];
  const isExternal = externalKinds.includes(p.kind);
  const eligibleForInstant = isExternal;

  if (p.instant && !eligibleForInstant) {
    return { ...result, valid: false, reason: 'Instant not available for internal transfers' };
  }

  let feeCents = 0n;
  let etaText: string;
  if (p.instant) {
    const calc = (p.amountCents * BigInt(p.instantFeeBps)) / 10000n;
    feeCents = calc > p.instantFeeMinCents ? calc : p.instantFeeMinCents;
    etaText = 'Within minutes';
  } else if (p.kind === 'wire_out') {
    // Default to domestic when the caller didn't tell us — safer for the
    // customer than guessing high.
    const scope: WireScope = p.wireScope ?? 'domestic';
    feeCents = WIRE_FEE_CENTS[scope];
    etaText =
      scope === 'international'
        ? '1–3 business days · international'
        : 'Same business day · domestic';
  } else if (isExternal) {
    etaText = '1–3 business days';
  } else {
    etaText = 'Instant';
  }

  return { ...result, feeCents, etaText };
}
