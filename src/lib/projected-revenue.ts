/**
 * Overview projected vs collected rent for the current ET week and month.
 *
 * Projected is the full expected rent for that period: the current weekly_rate
 * on every charge date inside the window. Charge dates sit on the rental's
 * 7-day cadence, anchored to next_payment_due, and they run back through the
 * period as well as forward. Paying a week moves next_payment_due ahead; those
 * weeks already due still count. Nothing is counted before start_date or after
 * end_date.
 *
 * Collected is rent only (type rent, net_collected, paid_date in the window).
 * Deposits, late fees, and reservation fees are not included. No database access.
 */
import {
  addCalendarDays,
  dollarsToCents,
  etToday,
  type ForecastRental,
} from "./revenue-forecast";

/** Active rental plus the date its weekly schedule began. */
export type PeriodRental = ForecastRental & {
  startDate?: string | null;
};

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
 * weekly schedule. Includes weeks already due in the window, not only dates
 * from next_payment_due forward. A missing next_payment_due is counted and skipped.
 */
export function projectedRentCents(
  rentals: PeriodRental[],
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
    const start = dateOnly(rental.startDate ?? null);
    for (const date of chargeDates(due, from, through, end, start)) {
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
  rentals: PeriodRental[];
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

function chargeDates(
  due: string,
  windowStart: string,
  windowEnd: string,
  end: string | null,
  start: string | null,
): string[] {
  // A start date lets the cadence run back to the later of the window start
  // and the rental start, so a paid week still counts. Without a start date
  // the next due date is the earliest known point — do not invent earlier weeks.
  const floor = start && start > windowStart ? start : windowStart;
  const notBefore = start ? floor : (due > windowStart ? due : windowStart);
  let cursor = firstCadenceOnOrAfter(due, notBefore);
  const dates: string[] = [];
  // A calendar month holds at most five weekly dates. The cap sits above that.
  for (let step = 0; cursor && step < 10 && cursor <= windowEnd; step++) {
    if (end && cursor > end) break;
    if (cursor >= windowStart && (!start || cursor >= start)) dates.push(cursor);
    cursor = addCalendarDays(cursor, 7);
  }
  return dates;
}

/** Earliest date on `due`'s 7-day cadence that is on or after `notBefore`. */
function firstCadenceOnOrAfter(due: string, notBefore: string): string | null {
  const delta = calendarDays(due, notBefore);
  if (delta === null) return null;
  if (delta <= 0) {
    const stepsBack = Math.floor(-delta / 7);
    return addCalendarDays(due, -stepsBack * 7);
  }
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
