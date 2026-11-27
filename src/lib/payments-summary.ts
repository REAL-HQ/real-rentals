// The summary cards at the top of Payments (Overdue Now, Due This Week, Collected This Week,
// In Collections, Failed Payments). Pure: PaymentsPanel passes the same rows, covered-row set
// and owed rule it uses for the table and the Outstanding total, so the cards and the rows
// always agree. Collections rows (status 'collections') are never Overdue.
import { COLLECTIONS_WATCH_STATUSES } from "@/lib/collections-watch";
import { collectionsTotal, type CollectionItemLike } from "@/lib/collections";
import { isReservationRow } from "@/lib/payment-category";
import { onlyLateFeesLeft, type StandingPayment } from "@/lib/rent-standing";

/** Statuses the Overdue filter and the Overdue Now card count (no 'collections'). */
export const OVERDUE_STATUSES: ReadonlySet<string> = new Set<string>(COLLECTIONS_WATCH_STATUSES);
/** Owed now (the Outstanding total). Upcoming isn't due yet; Collections is tracked on its own tab. */
export const OWED_STATUSES: ReadonlySet<string> = new Set(["pending", "current", "late", "overdue", "past_due", "failed", "unpaid"]);
/** Filter value the Failed Payments alert applies. */
export const FAILED_RECENT_FILTER = "failed_recent";
export const FAILED_RECENT_DAYS = 3;

export type SummaryPayment = {
  id: string;
  driver_id?: string | null;
  rental_id?: string | null;
  type?: string | null;
  reason?: string | null;
  notes?: string | null;
  status?: string | null;
  amount?: number | string | null;
  balance_due?: number | string | null;
  late_fees?: number | string | null;
  net_collected?: number | string | null;
  refunded_amount?: number | string | null;
  due_date?: string | null;
  paid_date?: string | null;
  failure_reason?: string | null;
  last_attempt_at?: string | null;
  updated_at?: string | null;
  stripe_invoice_id?: string | null;
  stripe_subscription_id?: string | null;
};

export type SummaryRental = {
  id: string;
  status?: string | null;
  next_payment_due?: string | null;
  weekly_rate?: number | string | null;
  autopay_active?: boolean | null;
  stripe_subscription_id?: string | null;
};

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const day = (v: string | null | undefined) => (/^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? "")) ?? [])[1] ?? null;

export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetweenYmd(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}
/** Today's calendar date in Eastern Time. */
export function easternToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
/** Monday of the ET week containing `ymd`. */
export function weekStartMonday(ymd: string): string {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0 Sun .. 6 Sat
  return addDaysYmd(ymd, -((dow + 6) % 7));
}

/** What a row still owes, exactly as the Outstanding total reads it. A settled balance of 0 is 0. */
export function rowOwed(p: SummaryPayment): number {
  return p.balance_due == null || p.balance_due === "" ? num(p.amount) : num(p.balance_due);
}

/**
 * A $0.00 row, such as the invoice Stripe writes when a subscription is paused.
 * Hidden from the Payments list. It owes nothing, so Outstanding is unchanged.
 */
export function isZeroMoneyRow(p: { amount?: unknown; balance_due?: unknown }): boolean {
  return num(p.amount) === 0 && rowOwed(p as SummaryPayment) === 0;
}

/**
 * A Reservation Fee that is not paid, refunded, void, waived, or expired.
 * Checkout leaves the row unpaid while the renter still holds the car; that
 * is a pending hold, not money owed. Expired is a released hold (the 24-hour
 * window, or staff Release). isReservationRow reads type, reason and notes.
 */
const RESERVATION_FEE_SETTLED = new Set(["paid", "refunded", "void", "waived", "expired"]);
export function isUnpaidReservationFee(row: { type?: unknown; reason?: unknown; notes?: unknown; status?: unknown }): boolean {
  if (!isReservationRow(row)) return false;
  return !RESERVATION_FEE_SETTLED.has(String(row.status ?? "").trim().toLowerCase());
}

/** Holds in this set: total still on the rows, and how many rows. Not part of Outstanding. */
export function awaitingReservationFee(payments: readonly SummaryPayment[]): { total: number; count: number } {
  const rows = payments.filter((p) => isUnpaidReservationFee(p));
  return { total: r2(rows.reduce((s, p) => s + rowOwed(p), 0)), count: rows.length };
}

/** True when the row counts toward Outstanding (owed status, not paid on another row). */
export function countsAsOwed(p: SummaryPayment, coveredIds: ReadonlySet<string>): boolean {
  if (isUnpaidReservationFee(p)) return false;
  return OWED_STATUSES.has(String(p.status ?? "")) && (!coveredIds.has(p.id) || feesOnlyLeft(p));
}

/** A covered rent row still owes its late fees when only fees are left on it (Damon, Nov 22 2026). */
export function feesOnlyLeft(p: SummaryPayment): boolean {
  return onlyLateFeesLeft({ type: p.type, status: p.status, amount: p.amount, dueDate: p.due_date, balanceDue: p.balance_due, lateFees: p.late_fees } as StandingPayment);
}

export function isOverdueRow(p: SummaryPayment): boolean {
  if (isUnpaidReservationFee(p)) return false;
  return OVERDUE_STATUSES.has(String(p.status ?? ""));
}

/** A charge that failed or a card declined in the last FAILED_RECENT_DAYS days and is still unpaid. An unpaid Reservation Fee is not on the Payments list, so it is not a Failed Payment either. */
export function isRecentFailure(p: SummaryPayment, now: Date = new Date()): boolean {
  if (isUnpaidReservationFee(p)) return false;
  const s = String(p.status ?? "");
  if (s !== "failed" && !(s === "unpaid" && p.failure_reason)) return false;
  const at = Date.parse(String(p.last_attempt_at ?? p.updated_at ?? ""));
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at <= FAILED_RECENT_DAYS * 86400000 && now.getTime() >= at - 60000;
}

export type PaymentsSummary = {
  overdue: { total: number; renters: number; oldestDaysLate: number | null; rows: number };
  dueThisWeek: { total: number; autopay: number; manual: number; count: number };
  collectedThisWeek: { collected: number; expected: number; weekStart: string };
  inCollections: { total: number; renters: number } | null;
  failedRecent: { count: number; total: number };
};

export function buildPaymentsSummary(input: {
  payments: readonly SummaryPayment[];
  coveredIds: ReadonlySet<string>;
  rentals?: readonly SummaryRental[];
  collectionItems?: readonly (CollectionItemLike & { application_id?: string | null })[] | null;
  now?: Date;
}): PaymentsSummary {
  const now = input.now ?? new Date();
  const today = easternToday(now);
  const payments = input.payments;

  // 1. Overdue Now: the Overdue filter's rows that still owe (same owed rule as Outstanding).
  const overdueRows = payments.filter((p) => isOverdueRow(p) && (!input.coveredIds.has(p.id) || feesOnlyLeft(p)) && rowOwed(p) > 0);
  let oldest: number | null = null;
  for (const p of overdueRows) {
    const d = day(p.due_date);
    if (!d) continue;
    const late = daysBetweenYmd(d, today);
    if (late > 0 && (oldest == null || late > oldest)) oldest = late;
  }
  const overdue = {
    total: r2(overdueRows.reduce((s, p) => s + rowOwed(p), 0)),
    renters: new Set(overdueRows.map((p) => p.driver_id ?? p.rental_id ?? p.id)).size,
    oldestDaysLate: oldest,
    rows: overdueRows.length,
  };

  // 2. Due This Week: each active rental's next rent date in today..today+6.
  const end = addDaysYmd(today, 6);
  let autopay = 0, manual = 0, count = 0;
  for (const r of input.rentals ?? []) {
    if (String(r.status ?? "") !== "active") continue;
    const d = day(r.next_payment_due);
    if (!d || d < today || d > end) continue;
    const amt = num(r.weekly_rate);
    if (amt <= 0) continue;
    count += 1;
    if (r.autopay_active && r.stripe_subscription_id) autopay += amt;
    else manual += amt;
  }
  const dueThisWeek = { total: r2(autopay + manual), autopay: r2(autopay), manual: r2(manual), count };

  // 3. Collected This Week (Mon..today, ET) vs expected: rent billed for this week's dates.
  const weekStart = weekStartMonday(today);
  const weekEnd = addDaysYmd(weekStart, 6);
  let collected = 0;
  for (const p of payments) {
    if (String(p.status ?? "") !== "paid" && String(p.status ?? "") !== "refunded") continue;
    const d = day(p.paid_date);
    if (!d || d < weekStart || d > today) continue;
    if (String(p.type ?? "") === "deposit") continue;
    const gross = p.net_collected == null || p.net_collected === "" ? num(p.amount) : num(p.net_collected);
    collected += Math.max(0, gross - num(p.refunded_amount));
  }
  const billedDates = new Map<string, Set<string>>();
  let expected = 0;
  for (const p of payments) {
    if (String(p.type ?? "rent") !== "rent") continue;
    if (["void", "waived", "refunded", "collections"].includes(String(p.status ?? ""))) continue;
    const d = day(p.due_date);
    if (!d || d < weekStart || d > weekEnd) continue;
    expected += num(p.amount);
    if (p.rental_id) (billedDates.get(p.rental_id) ?? billedDates.set(p.rental_id, new Set()).get(p.rental_id)!).add(d);
  }
  for (const r of input.rentals ?? []) {
    if (String(r.status ?? "") !== "active") continue;
    const d = day(r.next_payment_due);
    if (!d || d < weekStart || d > weekEnd) continue;
    // Not billed yet (no row for that week): the weekly rate is still expected.
    const billed = [...(billedDates.get(r.id) ?? [])].some((b) => Math.abs(daysBetweenYmd(b, d)) <= 2);
    if (!billed) expected += num(r.weekly_rate);
  }
  const collectedThisWeek = { collected: r2(collected), expected: r2(expected), weekStart };

  // 4. In Collections: open Collections lines (never part of Outstanding).
  const items = input.collectionItems;
  const inCollections = items == null
    ? null
    : { total: collectionsTotal(items), renters: new Set(items.filter((i) => collectionsTotal([i]) > 0).map((i) => i.application_id ?? "")).size };

  // 5. Failed Payments (last 3 days).
  const failed = payments.filter((p) => isRecentFailure(p, now));
  const failedRecent = { count: failed.length, total: r2(failed.reduce((s, p) => s + rowOwed(p), 0)) };

  return { overdue, dueThisWeek, collectedThisWeek, inCollections, failedRecent };
}
