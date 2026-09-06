/**
 * Timezone Utility for MuscleOS.
 * Default timezone: 'Asia/Kolkata' (IST = UTC+05:30).
 * Handles IANA timezones accurately across environments (including UTC cloud servers).
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export interface ZonedDateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
  millisecond: number;
  weekday: string; // 'MONDAY', 'TUESDAY', ...
}

/**
 * Extracts date parts of a given Date in the specified IANA timeZone.
 */
export function getZonedDateParts(date: Date = new Date(), timeZone: string = DEFAULT_TIMEZONE): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    weekday: 'long',
  });

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const part of parts) {
    partMap[part.type] = part.value;
  }

  let hour = parseInt(partMap.hour, 10);
  if (hour === 24) hour = 0; // Some ICU implementations format midnight as 24

  return {
    year: parseInt(partMap.year, 10),
    month: parseInt(partMap.month, 10),
    day: parseInt(partMap.day, 10),
    hour,
    minute: parseInt(partMap.minute, 10),
    second: parseInt(partMap.second, 10),
    millisecond: date.getMilliseconds(),
    weekday: (partMap.weekday || '').toUpperCase(),
  };
}

/**
 * Converts a specific local calendar date and time in the specified timeZone into an exact UTC Date object.
 */
export function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number = 0,
  minute: number = 0,
  second: number = 0,
  millisecond: number = 0,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const utcGuessMs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const guessDate = new Date(utcGuessMs);
  const guessParts = getZonedDateParts(guessDate, timeZone);
  const guessZonedMs = Date.UTC(
    guessParts.year,
    guessParts.month - 1,
    guessParts.day,
    guessParts.hour,
    guessParts.minute,
    guessParts.second,
    guessParts.millisecond,
  );
  const offsetDiff = guessZonedMs - utcGuessMs;
  return new Date(utcGuessMs - offsetDiff);
}

/**
 * Returns an exact UTC Date representing the start of day (00:00:00.000)
 * in the specified timeZone for the given date.
 */
export function getGymStartOfDay(date: Date = new Date(), timeZone: string = DEFAULT_TIMEZONE): Date {
  const parts = getZonedDateParts(date, timeZone);
  return zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, 0, timeZone);
}

/**
 * Returns an exact UTC Date representing the end of day (23:59:59.999)
 * in the specified timeZone for the given date.
 */
export function getGymEndOfDay(date: Date = new Date(), timeZone: string = DEFAULT_TIMEZONE): Date {
  const parts = getZonedDateParts(date, timeZone);
  return zonedTimeToUtc(parts.year, parts.month, parts.day, 23, 59, 59, 999, timeZone);
}

/**
 * Returns an exact UTC Date representing the start of month (1st day 00:00:00.000)
 * in the specified timeZone for the given date.
 */
export function getGymStartOfMonth(date: Date = new Date(), timeZone: string = DEFAULT_TIMEZONE): Date {
  const parts = getZonedDateParts(date, timeZone);
  return zonedTimeToUtc(parts.year, parts.month, 1, 0, 0, 0, 0, timeZone);
}

/**
 * Returns an exact UTC Date representing the end of month (last day 23:59:59.999)
 * in the specified timeZone for the given date.
 */
export function getGymEndOfMonth(date: Date = new Date(), timeZone: string = DEFAULT_TIMEZONE): Date {
  const parts = getZonedDateParts(date, timeZone);
  const lastDay = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  return zonedTimeToUtc(parts.year, parts.month, lastDay, 23, 59, 59, 999, timeZone);
}

/**
 * Returns an exact UTC Date representing the start of week (Sunday 00:00:00.000)
 * in the specified timeZone for the given date.
 */
export function getGymStartOfWeek(date: Date = new Date(), timeZone: string = DEFAULT_TIMEZONE): Date {
  const parts = getZonedDateParts(date, timeZone);
  const temp = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const dayOfWeek = temp.getUTCDay();
  const startDay = parts.day - dayOfWeek;
  return zonedTimeToUtc(parts.year, parts.month, startDay, 0, 0, 0, 0, timeZone);
}

/**
 * Returns an exact UTC Date representing the start of year (Jan 1 00:00:00.000)
 * in the specified timeZone for the given date.
 */
export function getGymStartOfYear(date: Date = new Date(), timeZone: string = DEFAULT_TIMEZONE): Date {
  const parts = getZonedDateParts(date, timeZone);
  return zonedTimeToUtc(parts.year, 1, 1, 0, 0, 0, 0, timeZone);
}

/**
 * Parses a HH:mm time string (in gym local time) on the given referenceDate
 * and returns the corresponding exact UTC Date.
 */
export function parseGymTimeToDate(
  timeStr: string,
  referenceDate: Date = new Date(),
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10) || 0;
  const m = parseInt(mStr, 10) || 0;
  const parts = getZonedDateParts(referenceDate, timeZone);
  return zonedTimeToUtc(parts.year, parts.month, parts.day, h, m, 0, 0, timeZone);
}

/**
 * Returns the ISO 8601 formatted string (YYYY-MM-DD) for the given date in the gym timezone.
 */
export function formatGymDate(date: Date = new Date(), timeZone: string = DEFAULT_TIMEZONE): string {
  const parts = getZonedDateParts(date, timeZone);
  const mm = String(parts.month).padStart(2, '0');
  const dd = String(parts.day).padStart(2, '0');
  return `${parts.year}-${mm}-${dd}`;
}

