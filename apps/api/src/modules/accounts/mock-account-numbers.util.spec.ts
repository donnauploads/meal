import { generateMockAccountNumber, generateMockRoutingNumber } from './mock-account-numbers.util';

describe('mock account numbers', () => {
  it('routing is 9 digits with the demo prefix', () => {
    const r = generateMockRoutingNumber();
    expect(r).toMatch(/^021000\d{3}$/);
    expect(r.length).toBe(9);
  });
  it('account number is 12 digits and varies', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const n = generateMockAccountNumber();
      expect(n).toMatch(/^\d{12}$/);
      seen.add(n);
    }
    expect(seen.size).toBeGreaterThan(50);
  });
});
