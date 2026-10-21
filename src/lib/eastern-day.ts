/** Eastern calendar used by payments, refunds, and the Stripe reporting window. */
export const EASTERN_TIME_ZONE = "America/New_York";
export const MAX_REPORT_DAYS = 366;

export function isRealDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

export function easternCalendarDay(instant: Date): string | null {
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const iso = year && month && day ? `${year}-${month}-${day}` : null;
  return iso && isRealDay(iso) ? iso : null;
}

export function easternToday(now = new Date()): string {
  const day = easternCalendarDay(now);
  if (!day) throw new Error("Eastern date unavailable");
  return day;
}

/** Date-only values stay as written. Timestamps become the Eastern calendar day. */
export function reportingDay(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return isRealDay(value) ? value : null;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : easternCalendarDay(instant);
}

function easternHour(instant: Date): number | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return Number.isInteger(hour) ? hour : null;
}

/** UTC instant of midnight at the start of this Eastern calendar day. */
export function easternMidnightIso(day: string): string | null {
  if (!isRealDay(day)) return null;
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  for (const hour of [4, 5]) {
    const guess = new Date(Date.UTC(year, month - 1, date, hour, 0, 0));
    if (easternCalendarDay(guess) === day && easternHour(guess) === 0) return guess.toISOString();
  }
  return null;
}

export function nextCalendarDay(day: string): string | null {
  if (!isRealDay(day)) return null;
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  const iso = new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
  return isRealDay(iso) ? iso : null;
}

export function inclusiveReportDays(from: string, to: string): number | null {
  if (!isRealDay(from) || !isRealDay(to) || from > to) return null;
  const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  return Number.isSafeInteger(span) ? span : null;
}

export function rangeMessage(range: { from: string; to: string } | null): string | null {
  if (!range) return null;
  if (!isRealDay(range.from) || !isRealDay(range.to) || range.from > range.to) {
    return "The date range is not a real calendar range.";
  }
  const days = inclusiveReportDays(range.from, range.to);
  if (days === null || days > MAX_REPORT_DAYS) return "Choose a range of up to 366 days.";
  return null;
}
