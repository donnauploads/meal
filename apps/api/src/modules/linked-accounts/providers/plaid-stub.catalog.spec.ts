import { STUB_INSTITUTIONS, findInstitution, searchInstitutions } from './plaid-stub.catalog';

describe('plaid-stub catalog', () => {
  it('has exactly 20 institutions', () => {
    expect(STUB_INSTITUTIONS.length).toBe(20);
  });

  it('all entries carry id/name/color/accountTypes', () => {
    for (const i of STUB_INSTITUTIONS) {
      expect(i.id).toMatch(/^ins_[a-z0-9_]+_stub$/);
      expect(i.name.length).toBeGreaterThan(0);
      expect(i.color).toMatch(/^#[0-9A-F]{6}$/i);
      expect(i.accountTypes.length).toBeGreaterThan(0);
    }
  });

  it('case-insensitive search hits names and ids', () => {
    expect(searchInstitutions('chase').length).toBe(1);
    expect(searchInstitutions('CHASE').length).toBe(1);
    expect(searchInstitutions('marcus')[0].id).toBe('ins_marcus_stub');
  });

  it('search under 50ms over the full catalog', () => {
    const start = process.hrtime.bigint();
    for (let i = 0; i < 1000; i++) searchInstitutions('bank');
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    expect(elapsedMs / 1000).toBeLessThan(50);
  });

  it('findInstitution returns undefined for unknown id', () => {
    expect(findInstitution('ins_nope')).toBeUndefined();
  });
});
