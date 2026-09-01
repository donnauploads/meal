import { GREETING_LABEL, bucketHour } from './time-of-day.util';

describe('bucketHour', () => {
  it('03:00 → night', () => {
    expect(bucketHour(3)).toBe('night');
    expect(GREETING_LABEL[bucketHour(3)]).toBe('Good night');
  });
  it('09:00 → morning', () => {
    expect(bucketHour(9)).toBe('morning');
    expect(GREETING_LABEL[bucketHour(9)]).toBe('Good morning');
  });
  it('13:00 → afternoon', () => {
    expect(bucketHour(13)).toBe('afternoon');
  });
  it('19:00 → evening', () => {
    expect(bucketHour(19)).toBe('evening');
  });
  it('boundaries', () => {
    expect(bucketHour(5)).toBe('morning');
    expect(bucketHour(12)).toBe('afternoon');
    expect(bucketHour(17)).toBe('evening');
    expect(bucketHour(22)).toBe('night');
  });
});
