// The one rent-standing rule every payment display reads: Bookings > Active
// (Due, Overdue, Late), Drivers Payment column, Payments Outstanding, the late
// fee sweep and the rent reminders. Pure; no database or Stripe access.
//
// Why this exists (Schrita Thomas, Nov 19 2026): her Nov 16 rent row stayed
// "Overdue" with a late fee after she paid $350 through a Payment Link on Nov 18,
// because the Overdue badge counted from rentals.next_payment_due and the oldest
// unpaid row, while the Due cell showed the latest row of any type ("Paid").
// Here a rent week counts as settled when paid rent rows billed for that week
// (due -EARLY_PAYMENT_DAYS .. due+6) add up to what the week owes, whatever row
// the payment landed on. Late fees and waivers stay with the late fee ledger.
//
// Daily rent (Regina, Nov 16 2026: $50/day while her weekly autopay is paused):
// a rental with a daily plan owes dailyRate for every ET day from startsOn
// through today. Paid rent rows dated startsOn or later pay those days in order.
// Weekly rows due on or after startsOn are replaced by the plan and owe nothing.
import { isRentRow, type CategorizableRow } from "@/lib/payment-category";

export const COVER_EARLY_DAYS = 2; // same as EARLY_PAYMENT_DAYS in stripe-link.ts
export const COVER_LATE_DAYS = 6;

/** Statuses that mean a row still owes money. */
export const UNPAID_RENT_STATUSES = new Set(["failed", "overdue", "past_due", "late", "unpaid", "collections", "current"]);
/** Statuses that mean the row is closed and owes nothing. */
const EXCLUDED = new Set(["void", "waived", "cancelled", "canceled", "refunded"]);

export type StandingPayment = CategorizableRow & {
  status: string | null;
  amount: number | string | null;
  balanceDue?: number | string | null;
  lateFees?: number | string | null;
  dueDate: string | null;
  paidDate?: string | null;
  createdAt?: string | null;
  stripeInvoiceId?: string | null;
  stripePaymentIntentId?: string | null;
};

export type DailyRentPlan = { dailyRate: number; startsOn: string; endsOn?: string | null; note?: string | null };

export type RentStanding = {
  cadence: "weekly" | "daily";
  /** Next rent due date after everything paid is applied (ET date), or null. */
  nextDue: string | null;
  /** Days past the oldest unsettled rent day/week. 0 = Current; null = no due date at all. */
  overdueDays: number | null;
  /** Due date of the oldest unsettled rent week or unpaid daily-rent day, or null. */
  oldestOwedDue: string | null;
  /** Rent still owed now (no late fees), dollars. Daily: includes today's day. */
  rentOwed: number;
  /** Unpaid rent rows that a later payment already covers (ledger rows to close). */
  coveredRows: StandingPayment[];
  /** Weekly rent rows the daily plan replaced (they owe nothing). */
  supersededRows: StandingPayment[];
  /** Daily plan only. */
  daily?: { rate: number; startsOn: string; daysCharged: number; paidSince: number; paidThrough: string | null };
  /** Late fees accrue only on weekly rent; a daily plan carries none. */
  lateFeesApply: boolean;
};

const n = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function day(value: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? "").trim());
  return m ? m[1] : null;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export function addDaysISO(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function status(p: StandingPayment): string {
  return String(p.status ?? "").trim().toLowerCase();
}

export function isPaidRent(p: StandingPayment): boolean {
  return isRentRow(p) && status(p) === "paid";
}

export function isOpenRent(p: StandingPayment): boolean {
  return isRentRow(p) && UNPAID_RENT_STATUSES.has(status(p)) && !EXCLUDED.has(status(p));
}

/** Paid rent billed for the week starting `due` (rows dated due-2 .. due+6). */
export function paidTowardWeek(due: string, payments: StandingPayment[]): number {
  let total = 0;
  for (const p of payments) {
    if (!isPaidRent(p)) continue;
    const d = day(p.dueDate) ?? day(p.paidDate);
    if (!d) continue;
    const off = daysBetween(due, d);
    if (off >= -COVER_EARLY_DAYS && off <= COVER_LATE_DAYS) total += n(p.amount);
  }
  return r2(total);
}

/**
 * The week's rent is paid and only late fees are left on the row: balance_due
 * is positive and no more than late_fees (a multi-week Payment Link paid the
 * rent; Damon, Nov 22 2026). balance_due defaults to 0, so a 0 balance alone
 * never counts. The fees stay owed in the late fee ledger.
 */
export function onlyLateFeesLeft(row: StandingPayment): boolean {
  if (row.balanceDue == null || row.balanceDue === "" || row.lateFees == null || row.lateFees === "") return false;
  const bal = n(row.balanceDue), fees = n(row.lateFees);
  return fees > 0 && bal > 0 && bal <= fees + 0.005;
}

/** An open rent row is settled when paid rent for its week covers its rent amount. */
export function isRentRowCovered(row: StandingPayment, payments: StandingPayment[]): boolean {
  const due = day(row.dueDate);
  if (!due || !isOpenRent(row)) return false;
  if (onlyLateFeesLeft(row)) return true;
  const owed = n(row.amount);
  return owed > 0 && paidTowardWeek(due, payments) + 0.005 >= owed;
}

/** Validated plan from app_settings.daily_rent_plans[rentalId]. Null when absent or malformed. */
export function readDailyPlan(value: unknown): DailyRentPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const rate = Number(v.dailyRate ?? v.daily_rate);
  const startsOn = day(String(v.startsOn ?? v.starts_on ?? ""));
  if (!Number.isFinite(rate) || rate <= 0 || !startsOn) return null;
  const endsOn = day(String(v.endsOn ?? v.ends_on ?? "")) ?? null;
  return { dailyRate: rate, startsOn, endsOn, note: typeof v.note === "string" ? v.note : null };
}

export function readDailyPlans(value: unknown): Map<string, DailyRentPlan> {
  const out = new Map<string, DailyRentPlan>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [rentalId, plan] of Object.entries(value as Record<string, unknown>)) {
    const p = readDailyPlan(plan);
    if (p) out.set(rentalId, p);
  }
  return out;
}

/** The plan in force on `today` (started, not ended). */
export function activeDailyPlan(plan: DailyRentPlan | null | undefined, today: string): DailyRentPlan | null {
  if (!plan) return null;
  if (plan.startsOn > today) return null;
  if (plan.endsOn && plan.endsOn < today) return null;
  return plan;
}

export function rentStanding(args: {
  today: string;
  nextPaymentDue: string | null;
  weeklyRate: number | null;
  payments: StandingPayment[];
  dailyPlan?: DailyRentPlan | null;
}): RentStanding {
  const { today } = args;
  const rent = args.payments.filter(isRentRow);
  const plan = activeDailyPlan(args.dailyPlan, today);
  const weekly = n(args.weeklyRate);

  const supersededRows = plan ? rent.filter((p) => isOpenRent(p) && (day(p.dueDate) ?? "") >= plan.startsOn) : [];
  const superseded = new Set(supersededRows);
  const open = rent.filter((p) => isOpenRent(p) && !superseded.has(p));
  const coveredRows = open.filter((p) => isRentRowCovered(p, rent));
  const covered = new Set(coveredRows);
  const owedRows = open.filter((p) => !covered.has(p) && day(p.dueDate) != null);

  let oldestWeekly: string | null = null;
  let weeklyOwed = 0;
  for (const p of owedRows) {
    const d = day(p.dueDate)!;
    if (d > today) continue;
    if (oldestWeekly == null || d < oldestWeekly) oldestWeekly = d;
    weeklyOwed += Math.max(0, n(p.amount) - paidTowardWeek(d, rent));
  }

  if (plan) {
    const daysCharged = daysBetween(plan.startsOn, today) + 1;
    const paidSince = r2(rent.filter((p) => isPaidRent(p) && (day(p.dueDate) ?? day(p.paidDate) ?? "") >= plan.startsOn).reduce((s, p) => s + n(p.amount), 0));
    const daysPaid = Math.floor((paidSince + 0.005) / plan.dailyRate);
    const firstUnpaid = addDaysISO(plan.startsOn, daysPaid);
    const dailyOwed = Math.max(0, r2(daysCharged * plan.dailyRate - paidSince));
    const overdueFromDaily = Math.max(0, daysBetween(firstUnpaid, today));
    const overdueFromWeekly = oldestWeekly ? Math.max(0, daysBetween(oldestWeekly, today)) : 0;
    return {
      cadence: "daily",
      nextDue: firstUnpaid,
      overdueDays: Math.max(overdueFromDaily, overdueFromWeekly),
      oldestOwedDue: oldestWeekly ?? (dailyOwed > 0 ? firstUnpaid : null),
      rentOwed: r2(dailyOwed + weeklyOwed),
      coveredRows,
      supersededRows,
      daily: { rate: plan.dailyRate, startsOn: plan.startsOn, daysCharged, paidSince, paidThrough: daysPaid > 0 ? addDaysISO(plan.startsOn, daysPaid - 1) : null },
      lateFeesApply: false,
    };
  }

  // Weekly: next_payment_due moves past every week already paid for.
  let nextDue = day(args.nextPaymentDue);
  if (nextDue && weekly > 0) {
    for (let i = 0; i < 8 && nextDue <= addDaysISO(today, COVER_EARLY_DAYS); i++) {
      if (paidTowardWeek(nextDue, rent) + 0.005 < weekly) break;
      nextDue = addDaysISO(nextDue, 7);
    }
  }
  const fromDue = nextDue ? Math.max(0, daysBetween(nextDue, today)) : null;
  const fromRows = oldestWeekly ? Math.max(0, daysBetween(oldestWeekly, today)) : null;
  const overdueDays = fromDue == null ? fromRows : fromRows == null ? fromDue : Math.max(fromDue, fromRows);
  // A due date reached with no open row for it still owes the week (manual payers).
  if (nextDue && nextDue <= today && !owedRows.some((p) => day(p.dueDate) === nextDue)) {
    weeklyOwed += Math.max(0, weekly - paidTowardWeek(nextDue, rent));
  }
  const oldest = [oldestWeekly, nextDue && nextDue <= today ? nextDue : null].filter(Boolean).sort()[0] ?? null;
  return {
    cadence: "weekly",
    nextDue,
    overdueDays,
    oldestOwedDue: oldest,
    rentOwed: r2(weeklyOwed),
    coveredRows,
    supersededRows,
    lateFeesApply: true,
  };
}

/** Rent rows a display should treat as still owed (not covered, not replaced by a daily plan). */
export function rentRowStillOwed(row: StandingPayment, standing: Pick<RentStanding, "coveredRows" | "supersededRows">): boolean {
  if (!isOpenRent(row)) return false;
  return !standing.coveredRows.includes(row) && !standing.supersededRows.includes(row);
}

export function dailyRateLabel(rate: number): string {
  return `$${Number.isInteger(rate) ? rate : rate.toFixed(2)}/Day`;
}

export const DAILY_RENT_PLANS_KEY = "daily_rent_plans";
