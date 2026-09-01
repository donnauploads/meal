import { computeFingerprint, parseUaSummary } from './fingerprint.util';

describe('fingerprint util', () => {
  it('is deterministic for same inputs', () => {
    const a = computeFingerprint({ userAgent: 'UA', acceptLanguage: 'en', timezone: 'UTC' });
    const b = computeFingerprint({ userAgent: 'UA', acceptLanguage: 'en', timezone: 'UTC' });
    expect(a).toBe(b);
  });
  it('changes when a field changes', () => {
    const a = computeFingerprint({ userAgent: 'UA', acceptLanguage: 'en', timezone: 'UTC' });
    const b = computeFingerprint({ userAgent: 'UA', acceptLanguage: 'fr', timezone: 'UTC' });
    expect(a).not.toBe(b);
  });
  it('parses UA summary', () => {
    const s = parseUaSummary('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/120.0');
    expect(s.os).toBe('Windows');
    expect(s.browser).toBe('Chrome');
  });
});
