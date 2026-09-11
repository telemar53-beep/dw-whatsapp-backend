const { isOutsideBusinessHours } = require('./business-hours.service');

const CONFIG = { startTime: '08:00', endTime: '18:00' };

describe('isOutsideBusinessHours', () => {
  test('is false in the middle of a weekday inside the window', () => {
    // Monday 2026-09-14, 12:00 São Paulo = 15:00 UTC
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-14T15:00:00.000Z'))).toBe(false);
  });

  test('is false exactly at the start time (inclusive)', () => {
    // Monday 2026-09-14, 08:00 São Paulo = 11:00 UTC
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-14T11:00:00.000Z'))).toBe(false);
  });

  test('is true one minute before the start time', () => {
    // Monday 2026-09-14, 07:59 São Paulo = 10:59 UTC
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-14T10:59:00.000Z'))).toBe(true);
  });

  test('is true exactly at the end time (exclusive)', () => {
    // Monday 2026-09-14, 18:00 São Paulo = 21:00 UTC
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-14T21:00:00.000Z'))).toBe(true);
  });

  test('is true one minute before the end time is false, one minute after is true', () => {
    // Monday 2026-09-14, 17:59 São Paulo = 20:59 UTC (still inside)
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-14T20:59:00.000Z'))).toBe(false);
    // Monday 2026-09-14, 18:01 São Paulo = 21:01 UTC (outside)
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-14T21:01:00.000Z'))).toBe(true);
  });

  test('is true on Saturday even during normal weekday hours', () => {
    // Saturday 2026-09-12, 12:00 São Paulo = 15:00 UTC
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-12T15:00:00.000Z'))).toBe(true);
  });

  test('is true on Sunday even during normal weekday hours', () => {
    // Sunday 2026-09-13, 12:00 São Paulo = 15:00 UTC
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-13T15:00:00.000Z'))).toBe(true);
  });

  test('handles midnight correctly (Node ICU formats it as hour 24, must normalize to 0)', () => {
    // Monday 2026-09-14, 00:00 São Paulo = 03:00 UTC
    expect(isOutsideBusinessHours(CONFIG, new Date('2026-09-14T03:00:00.000Z'))).toBe(true);
  });
});
