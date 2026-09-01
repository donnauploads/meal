import { computeNextRunAt } from './recurring-transfers.service';
import { RecurringFrequency } from '@prisma/client';

describe('computeNextRunAt', () => {
  it('weekly moves to the chosen weekday in the future', () => {
    const base = new Date(Date.UTC(2026, 4, 26, 12, 0, 0)); // Tue 2026-05-26
    const next = computeNextRunAt(base, RecurringFrequency.weekly, 5); // Friday
    expect(next.getUTCDay()).toBe(5);
    expect(next.getTime()).toBeGreaterThan(base.getTime());
  });

  it('monthly advances to next month and clamps to last day', () => {
    const base = new Date(Date.UTC(2026, 0, 31, 12, 0, 0));
    const next = computeNextRunAt(base, RecurringFrequency.monthly, 31);
    expect(next.getUTCMonth()).toBe(1); // Feb
    expect(next.getUTCDate()).toBe(28); // 2026 not leap
  });

  it('biweekly is two weeks out', () => {
    const base = new Date(Date.UTC(2026, 4, 1, 12, 0, 0));
    const next = computeNextRunAt(base, RecurringFrequency.biweekly, base.getUTCDay());
    const diffDays = (next.getTime() - base.getTime()) / 86400000;
    expect(diffDays).toBeCloseTo(14, 0);
  });
});
