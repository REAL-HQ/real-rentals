/**
 * Overview "Billed vs Collected" series.
 *
 * Same money rules as the Revenue card's payments ledger and the Revenue
 * report (REVENUE_TYPES in revenue-report.ts): rent, late_fee, other, toll,
 * damage and fee. Deposits stay out. A fee (a one-day rental paid by Payment
 * Link, a Reservation Fee credited to week 1) is money the renter paid us, so
 * it is revenue; before Nov 17 2026 it was silently dropped here. Collected is multi-method — Stripe, Zelle, Cash
 * App, Venmo, cash, wire — whatever net_collected recorded. Billed is the
 * amount due in the week, same type filter, so the chart cannot disagree with
 * the card about what counts as revenue.
 */
export const OVERVIEW_REVENUE_TYPES = ["rent", "late_fee", "other", "toll", "damage", "fee", "reservation"] as const;
export type OverviewRevenueType = (typeof OVERVIEW_REVENUE_TYPES)[number];

export type WeekPoint = {
  label: string;
  /** Sunday that starts the week, as a calendar date (YYYY-MM-DD, Eastern Time). */
  iso: string;
  collected: number;
  billed: number;
  /** True for the in-progress week that contains today. */
  current: boolean;
};

export type CollectedRow = {
  paid_date?: string | null;
  net_collected?: number | null;
  type?: string | null;
};

export type BilledRow = {
  due_date?: string | null;
  amount?: number | null;
  type?: string | null;
};

export function isOverviewRevenueType(type: string | null | undefined): boolean {
  return type != null && (OVERVIEW_REVENUE_TYPES as readonly string[]).includes(type);
}

const DAY = 864e5;
const BUSINESS_TZ = "America/New_York";

/**
 * Everything below works in whole calendar days (UTC-midnight day numbers), so
 * a daylight-saving change can never move a week boundary. The old code added
 * 7 * 24h to a local midnight, which after Nov 1 landed on 11 PM Saturday and
 * labeled the Nov 15 week "Nov 14". Date-only values are never run through
 * new Date(), which read them as UTC midnight (Saturday evening in ET).
 */
function dayNumber(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY;
}

function ymdFromDay(n: number): string {
  return new Date(n * DAY).toISOString().slice(0, 10);
}

/** Today's calendar date in Eastern Time. */
export function todayInET(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Sunday on or before the given day number. 1970-01-01 was a Thursday. */
function sundayOf(day: number): number {
  const dow = (((day + 4) % 7) + 7) % 7;
  return day - dow;
}

/** Payments store a date; a timestamp is read as its Eastern Time date. */
function toEtDay(v: string): number | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return dayNumber(v);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : dayNumber(todayInET(d));
}

export function buildWeeklyBilledCollected(input: {
  now: Date;
  collected: CollectedRow[];
  billed: BilledRow[];
  /** Formats a week's Sunday (a local Date at that calendar day) for the axis. */
  label: (d: Date) => string;
  weeks?: number;
}): WeekPoint[] {
  const weeks = input.weeks ?? 12;
  const today = dayNumber(todayInET(input.now))!;
  const thisWeek = sundayOf(today);
  const start = thisWeek - (weeks - 1) * 7;
  const series: WeekPoint[] = [];
  for (let i = 0; i < weeks; i++) {
    const day = start + i * 7;
    const ymd = ymdFromDay(day);
    const [y, m, dd] = ymd.split("-").map(Number);
    const current = day === thisWeek;
    series.push({
      label: current ? "This Week" : input.label(new Date(y, m - 1, dd)),
      iso: ymd,
      collected: 0,
      billed: 0,
      current,
    });
  }
  for (const p of input.collected) {
    if (!p.paid_date || !isOverviewRevenueType(p.type ?? "rent")) continue;
    // Rows without an explicit type historically counted as rent on this chart.
    const day = toEtDay(p.paid_date);
    if (day == null || day > today) continue;
    const idx = Math.floor((sundayOf(day) - start) / 7);
    if (idx >= 0 && idx < weeks) series[idx].collected += Number(p.net_collected ?? 0);
  }
  for (const p of input.billed) {
    if (!p.due_date || !isOverviewRevenueType(p.type)) continue;
    // The in-progress week counts what has come due through today, so the
    // chart advances day by day instead of showing Saturday's bills on Monday.
    const day = toEtDay(p.due_date);
    if (day == null || day > today) continue;
    const idx = Math.floor((sundayOf(day) - start) / 7);
    if (idx >= 0 && idx < weeks) series[idx].billed += Number(p.amount ?? 0);
  }
  return series;
}
