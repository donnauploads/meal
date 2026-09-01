import { decodeCursor, encodeCursor } from './cursor.util';

describe('cursor util', () => {
  it('round-trips a valid cursor', () => {
    const c = { occurredAt: new Date('2026-04-01T10:00:00Z').toISOString(), id: '11111111-1111-1111-1111-111111111111' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it('returns null for garbage', () => {
    expect(decodeCursor('not-base64-or-json')).toBeNull();
    expect(decodeCursor(Buffer.from('{}').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('{"occurredAt":"bad","id":"x"}').toString('base64url'))).toBeNull();
  });
});
