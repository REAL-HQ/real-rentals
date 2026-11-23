// The money figure Bookings > Active and the FLEET status API both report.
// Rent owed and overdue days come from rentStanding (the one rent rule).
// Late fees, non-rent charges and a return balance are added on top so a
// toll or a final balance is not dropped, and a daily plan with no open
// payment row is not reported as $0.
import { isRentRow, type CategorizableRow } from "@/lib/payment-category";
import { rentStanding, type DailyRentPlan, type StandingPayment } from "@/lib/rent-standing";

const SETTLED = new Set(["paid", "void", "voided", "refunded", "cancelled", "canceled", "waived", "entered_in_error"]);

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));
const money = (n: number) => Math.round(n * 100) / 100;

export function paymentOwed(p: { status?: unknown; balance_due?: unknown; amount?: unknown; late_fees?: unknown }): number {
  if (SETTLED.has(String(p.status ?? "").toLowerCase())) return 0;
  if (p.balance_due != null && p.balance_due !== "") return Math.max(0, num(p.balance_due));
  return Math.max(0, num(p.amount) + num(p.late_fees));
}

function day(value: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? "").trim());
  return m ? m[1] : null;
}

function asStanding(p: StandingPayment): CategorizableRow & StandingPayment {
  return p;
}

export type ReportedOwes = {
  total_owed: number;
  overdue_owed: number;
  rent_owed: number;
  late_fees_owed: number;
  return_balance: number;
  overdue_days: number | null;
  next_due: string | null;
  cadence: "weekly" | "daily";
};

/**
 * Shared owes / overdue for one rental.
 * `today` is the Eastern calendar day (YYYY-MM-DD), the same day Bookings uses.
 */
export function reportedOwes(args: {
  today: string;
  payments: readonly StandingPayment[];
  rental: { weekly_rate?: unknown; next_payment_due?: string | null; balance_due_cents?: unknown } | null;
  dailyPlan?: DailyRentPlan | null;
}): ReportedOwes {
  const standing = rentStanding({
    today: args.today,
    nextPaymentDue: args.rental?.next_payment_due ?? null,
    weeklyRate: args.rental?.weekly_rate == null || args.rental.weekly_rate === "" ? null : Number(args.rental.weekly_rate),
    payments: [...args.payments],
    dailyPlan: args.dailyPlan ?? null,
  });
  let nonRent = 0;
  let nonRentOverdue = 0;
  let late = 0;
  for (const p of args.payments) {
    const row = asStanding(p);
    const owed = paymentOwed({
      status: row.status,
      balance_due: row.balanceDue,
      amount: row.amount,
      late_fees: row.lateFees,
    });
    if (isRentRow(row)) {
      if (!standing.lateFeesApply) continue;
      const due = day(row.dueDate);
      if (owed <= 0 || !due || due >= args.today) continue;
      late += Math.max(0, num(row.lateFees));
      continue;
    }
    if (owed <= 0) continue;
    nonRent += owed;
    const due = day(row.dueDate);
    if (due && due < args.today) nonRentOverdue += owed;
  }
  const returnBalance = args.rental ? Math.max(0, num(args.rental.balance_due_cents) / 100) : 0;
  const rentOwed = standing.rentOwed;
  const overdueDays = standing.overdueDays;
  const rentOverdue = (overdueDays ?? 0) > 0 ? rentOwed : 0;
  return {
    total_owed: money(rentOwed + nonRent + late + returnBalance),
    overdue_owed: money(rentOverdue + nonRentOverdue + late),
    rent_owed: money(rentOwed),
    late_fees_owed: money(late),
    return_balance: money(returnBalance),
    overdue_days: overdueDays,
    next_due: standing.nextDue,
    cadence: standing.cadence,
  };
}

export function standingFromPaymentRow(p: Record<string, unknown>): StandingPayment {
  return {
    type: p.type as string | null,
    reason: (p.reason as string | null) ?? null,
    notes: (p.notes as string | null) ?? null,
    status: (p.status as string | null) ?? null,
    amount: p.amount as number | string | null,
    balanceDue: p.balance_due as number | string | null,
    lateFees: p.late_fees as number | string | null,
    dueDate: (p.due_date as string | null) ?? null,
    paidDate: (p.paid_date as string | null) ?? null,
  };
}
