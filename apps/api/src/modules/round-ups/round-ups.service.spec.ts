import { roundUpCents } from './round-ups.service';
import { allocateCents, normalizeSplits } from '../autosave/splits.util';

describe('round-up math', () => {
  it('rounds $4.30 to 70 cents', () => {
    expect(roundUpCents(430n)).toBe(70n);
  });
  it('whole-dollar purchase yields 0', () => {
    expect(roundUpCents(500n)).toBe(0n);
  });
  it('rounds $0.01 to 99 cents', () => {
    expect(roundUpCents(1n)).toBe(99n);
  });
});

describe('splits normalize + allocate', () => {
  it('rescales to 100', () => {
    const s = normalizeSplits([{ goalId: 'a', percent: 30 }, { goalId: 'b', percent: 70 }, { goalId: 'c', percent: 100 }]);
    expect(s.reduce((a, x) => a + x.percent, 0)).toBe(100);
  });
  it('allocates fractional cents to largest split', () => {
    const out = allocateCents(101n, [
      { goalId: 'a', percent: 50 },
      { goalId: 'b', percent: 50 },
    ]);
    const sum = out.reduce((a, x) => a + x.cents, 0n);
    expect(sum).toBe(101n);
  });
});
