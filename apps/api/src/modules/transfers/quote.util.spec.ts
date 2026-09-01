import { computeQuote } from './quote.util';

const baseline = {
  minCents: 500n,
  maxCents: 2_500_000n,
  instantFeeBps: 175,
  instantFeeMinCents: 25n,
};

describe('computeQuote', () => {
  it('rejects below minimum', () => {
    const q = computeQuote({ kind: 'ach_out', amountCents: 100n, instant: false, ...baseline });
    expect(q.valid).toBe(false);
  });

  it('rejects above maximum', () => {
    const q = computeQuote({ kind: 'ach_out', amountCents: 10_000_000n, instant: false, ...baseline });
    expect(q.valid).toBe(false);
  });

  it('internal transfer has no fee, instant eta', () => {
    const q = computeQuote({ kind: 'internal', amountCents: 1000n, instant: false, ...baseline });
    expect(q.valid).toBe(true);
    expect(q.feeCents).toBe(0n);
    expect(q.etaText).toBe('Instant');
  });

  it('external instant uses max(min, bps)', () => {
    const small = computeQuote({ kind: 'ach_out', amountCents: 1000n, instant: true, ...baseline });
    expect(small.feeCents).toBe(25n);
    const big = computeQuote({ kind: 'ach_out', amountCents: 200000n, instant: true, ...baseline });
    expect(big.feeCents).toBe((200000n * 175n) / 10000n);
  });

  it('instant on internal is rejected', () => {
    const q = computeQuote({ kind: 'internal', amountCents: 1000n, instant: true, ...baseline });
    expect(q.valid).toBe(false);
  });
});
