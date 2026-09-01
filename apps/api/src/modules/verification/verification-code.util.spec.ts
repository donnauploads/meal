import { generateCode, maskDestination, maskEmail, maskPhone } from './verification-code.util';

describe('verification-code util', () => {
  it('generates 6-digit codes', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateCode()).toMatch(/^\d{6}$/);
    }
  });
  it('masks email keeping domain', () => {
    expect(maskEmail('alice@example.com')).toMatch(/^al\W+@example\.com$/);
  });
  it('masks phone keeping last 4', () => {
    expect(maskPhone('+14155551234')).toMatch(/^\W+1234$/);
  });
  it('routes by channel', () => {
    expect(maskDestination('email', 'a@b.co')).toContain('@b.co');
    expect(maskDestination('sms', '+14155551234')).toContain('1234');
  });
});
