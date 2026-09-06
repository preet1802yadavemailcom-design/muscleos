import {
  DEFAULT_TIMEZONE,
  formatGymDate,
  getGymEndOfDay,
  getGymEndOfMonth,
  getGymStartOfDay,
  getGymStartOfMonth,
  getZonedDateParts,
  parseGymTimeToDate,
  zonedTimeToUtc,
} from './timezone.util';

describe('TimezoneUtil', () => {
  it('correctly extracts zoned date parts for Asia/Kolkata', () => {
    // 2026-09-06 00:30:00 UTC = 2026-09-06 06:00:00 IST
    const date = new Date('2026-09-06T00:30:00.000Z');
    const parts = getZonedDateParts(date, 'Asia/Kolkata');
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(9);
    expect(parts.day).toBe(6);
    expect(parts.hour).toBe(6);
    expect(parts.minute).toBe(0);
    expect(parts.second).toBe(0);
    expect(parts.weekday).toBe('SUNDAY');
  });

  it('computes exact gym start-of-day in UTC', () => {
    const date = new Date('2026-09-06T10:00:00.000Z'); // 15:30 IST
    const start = getGymStartOfDay(date, 'Asia/Kolkata');
    // Start of day in IST is 2026-09-06 00:00:00 IST = 2026-09-05 18:30:00 UTC
    expect(start.toISOString()).toBe('2026-09-05T18:30:00.000Z');
  });

  it('computes exact gym end-of-day in UTC', () => {
    const date = new Date('2026-09-06T10:00:00.000Z');
    const end = getGymEndOfDay(date, 'Asia/Kolkata');
    // End of day in IST is 2026-09-06 23:59:59.999 IST = 2026-09-06 18:29:59.999 UTC
    expect(end.toISOString()).toBe('2026-09-06T18:29:59.999Z');
  });

  it('computes exact gym start-of-month in UTC', () => {
    const date = new Date('2026-09-15T12:00:00.000Z');
    const startOfMonth = getGymStartOfMonth(date, 'Asia/Kolkata');
    // 2026-09-01 00:00:00 IST = 2026-08-31 18:30:00 UTC
    expect(startOfMonth.toISOString()).toBe('2026-08-31T18:30:00.000Z');
  });

  it('computes exact gym end-of-month in UTC', () => {
    const date = new Date('2026-09-15T12:00:00.000Z');
    const endOfMonth = getGymEndOfMonth(date, 'Asia/Kolkata');
    // September has 30 days. 2026-09-30 23:59:59.999 IST = 2026-09-30 18:29:59.999 UTC
    expect(endOfMonth.toISOString()).toBe('2026-09-30T18:29:59.999Z');
  });

  it('parses gym time strings correctly on a reference date', () => {
    const ref = new Date('2026-09-06T08:00:00.000Z');
    const batchStart = parseGymTimeToDate('06:00', ref, 'Asia/Kolkata');
    expect(batchStart.toISOString()).toBe('2026-09-06T00:30:00.000Z');

    const batchEnd = parseGymTimeToDate('19:45', ref, 'Asia/Kolkata');
    // 19:45 IST = 14:15 UTC
    expect(batchEnd.toISOString()).toBe('2026-09-06T14:15:00.000Z');
  });

  it('formats gym date strings as YYYY-MM-DD', () => {
    // 2026-09-05 20:00:00 UTC is already 2026-09-06 01:30:00 in IST
    const date = new Date('2026-09-05T20:00:00.000Z');
    expect(formatGymDate(date, 'Asia/Kolkata')).toBe('2026-09-06');
  });
});
