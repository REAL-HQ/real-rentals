/**
 * Overview projected vs collected rent for the current ET week and month.
 * Projection reuses the revenue-forecast charge schedule: weekly_rate on
 * next_payment_due and every 7 days after, while on or before end_date.
 * Collected is rent only (never deposits or late fees). No database access.
 */
import {
  addCalendarDays,
  dollarsToCents,
  etToday,
  type ForecastRental,
} from "./revenue-forecast";

export type PeriodSummary = {
  from: string;
  through: string;
  label: string;
  projectedCents: number;
  collectedCents: number;
  excludedMissingDue: number;
};

export type ProjectedRevenueSummary = {
  today: string;
  week: PeriodSummary;
  month: PeriodSummary;
};

export type CollectedRentRow = {
  paidDate: string | null;
  netCollected: number | null;
  type: string | null;
};

/** Monday–Sunday containing today (America/New_York calendar date). */
export function weekRange(today: string): { from: string; through: string } | null {
  const monday = mondayOf(today);
  if (!monday) return null;
  const through = addCalendarDays(monday, 6);
  return through ? { from: monday, through } : null;
}

/** Calendar month containing today (America/New_York calendar date). */
export function monthRange(today: string): { from: string; through: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const [year, month] = today.split("-").map(Number);
  const from = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? 1 : month! + 1;
  const nextYear = month === 12 ? year! + 1 : year!;
  const firstNext = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
  const through = addCalendarDays(firstNext, -1);
  return through ? { from, through } : null;
}

/**
 * Expected rent charges falling in [from, through], from active rentals'
 * weekly_rate schedule. A missing next_payment_due is counted and skipped.
 */
export function projectedRentCents(
  rentals: ForecastRental[],
  from: string,
  through: string,
): { cents: number; excludedMissingDue: number } {
  let cents = 0;
  let excludedMissingDue = 0;
  for (const rental of rentals) {
    if (rental.status.trim().toLowerCase() !== "active") continue;
    const due = dateOnly(rental.nextPaymentDue);
    if (!due) {
      excludedMissingDue += 1;
      continue;
    }
    const amount = dollarsToCents(rental.weeklyRate);
    if (amount === null) continue;
    const end = dateOnly(rental.endDate);
    if (rental.endDate && !end) continue;
    for (const date of chargeDates(due, from, through, end)) {
      cents += amount;
    }
  }
  return { cents, excludedMissingDue };
}

/** Sum of rent (type === "rent") net_collected with paid_date in the window. */
export function collectedRentCents(rows: CollectedRentRow[], from: string, through: string): number {
  let cents = 0;
  for (const row of rows) {
    if (String(row.type ?? "").trim().toLowerCase() !== "rent") continue;
    const paid = dateOnly(row.paidDate);
    if (!paid || paid < from || paid > through) continue;
    if (row.netCollected == null || !Number.isFinite(row.netCollected)) continue;
    const amount = dollarsToCents(row.netCollected);
    if (amount === null) continue;
    cents += amount;
  }
  return cents;
}

export function buildProjectedRevenueSummary(input: {
  today?: string;
  rentals: ForecastRental[];
  collected: CollectedRentRow[];
}): ProjectedRevenueSummary | null {
  const today = input.today ?? etToday();
  const week = weekRange(today);
  const month = monthRange(today);
  if (!week || !month) return null;
  const weekProj = projectedRentCents(input.rentals, week.from, week.through);
  const monthProj = projectedRentCents(input.rentals, month.from, month.through);
  return {
    today,
    week: {
      ...week,
      label: "This Week",
      projectedCents: weekProj.cents,
      collectedCents: collectedRentCents(input.collected, week.from, week.through),
      excludedMissingDue: weekProj.excludedMissingDue,
    },
    month: {
      ...month,
      label: "This Month",
      projectedCents: monthProj.cents,
      collectedCents: collectedRentCents(input.collected, month.from, month.through),
      excludedMissingDue: monthProj.excludedMissingDue,
    },
  };
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

function chargeDates(due: string, windowStart: string, windowEnd: string, end: string | null): string[] {
  let cursor = due < windowStart ? firstOnOrAfter(due, windowStart) : due;
  const dates: string[] = [];
  for (let step = 0; cursor && step < 10 && cursor <= windowEnd; step++) {
    if (end && cursor > end) break;
    if (cursor >= windowStart) dates.push(cursor);
    cursor = addCalendarDays(cursor, 7);
  }
  return dates;
}

function firstOnOrAfter(due: string, start: string): string | null {
  const delta = calendarDays(due, start);
  if (delta === null) return null;
  if (delta <= 0) return due;
  return addCalendarDays(due, Math.ceil(delta / 7) * 7);
}

function mondayOf(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  const delta = weekday === 0 ? -6 : 1 - weekday;
  return addCalendarDays(ymd, delta);
}

function calendarDays(from: string, to: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function dateOnly(value: string | null): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? "").trim());
  return match ? match[1]! : null;
}
