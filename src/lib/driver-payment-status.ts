/**
 * The single driver Payment / Deposit status calculation. Derived only from
 * real rentals and payments rows — never from applications.payment_status,
 * whose column default ("current") made every new applicant look paid up.
 */
export type PayRental = {
  id: string;
  status: string | null;
  deposit_amount: number | string | null;
  deposit_held: boolean | null;
  deposit_status: string | null;
  deposit_refund_amount: number | string | null;
};
export type PayRow = {
  rental_id: string | null;
  type: string | null;
  amount: number | string | null;
  balance_due: number | string | null;
  net_collected: number | string | null;
  refunded_amount: number | string | null;
  status: string | null;
  due_date: string | null;
};

export type PaymentStatus = "none" | "not_due" | "due" | "partial" | "current" | "overdue" | "failed";
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  none: "—",
  not_due: "Not Due",
  due: "Due",
  partial: "Partial",
  current: "Current",
  overdue: "Overdue",
  failed: "Failed",
};

const n = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
// Excluded entirely: not an obligation (any more).
const EXCLUDED = new Set(["void", "waived", "cancelled", "canceled"]);
const CLOSED = new Set(["paid", "refunded"]);
const FAILED = new Set(["failed", "unpaid"]);
const LATE = new Set(["late", "overdue", "past_due", "collections"]);
const ACTIVE_RENTAL = new Set(["active", "pending", "reserved"]);

/**
 * Precedence: Failed > Overdue > Partial > Due > Not Due > Current > —.
 * A problem anywhere on the account wins over good standing elsewhere.
 */
export function derivePaymentStatus(rentals: PayRental[], payments: PayRow[], today = new Date()): PaymentStatus {
  const day = today.toISOString().slice(0, 10);
  const rows = payments.filter((p) => (p.type ?? "rent") !== "deposit" && !EXCLUDED.has(p.status ?? ""));
  // A payments row is one charge; a retry that succeeds moves the same row to
  // paid. A row still marked failed but with nothing left owing is resolved too.
  const resolved = (p: PayRow) =>
    CLOSED.has(p.status ?? "") || (FAILED.has(p.status ?? "") && p.balance_due != null && n(p.balance_due) <= 0);
  const open = rows.filter((p) => !resolved(p));
  if (open.some((p) => FAILED.has(p.status ?? ""))) return "failed";
  if (open.some((p) => LATE.has(p.status ?? "") || (p.due_date != null && p.due_date < day))) return "overdue";
  const dueNow = open.filter((p) => p.due_date == null || p.due_date <= day);
  if (dueNow.some((p) => n(p.balance_due) > 0 && n(p.balance_due) < n(p.amount))) return "partial";
  if (dueNow.length) return "due";
  const hasActiveRental = rentals.some((r) => ACTIVE_RENTAL.has(r.status ?? ""));
  const anyPaid = rows.some(resolved);
  if (open.length || (hasActiveRental && !anyPaid)) return "not_due";
  if (anyPaid) return "current";
  return "none";
}

export type DepositDisplay = { text: string; detail: string | null };
const money = (v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** Deposit from rentals (required amount, held, disposition) plus deposit payments (collected). */
export function deriveDepositDisplay(rentals: PayRental[], payments: PayRow[]): DepositDisplay {
  const required = rentals.reduce((s, r) => s + n(r.deposit_amount), 0);
  const deps = payments.filter((p) => p.type === "deposit" && !EXCLUDED.has(p.status ?? ""));
  const collected = deps.reduce((s, p) => s + (p.status === "paid" ? n(p.net_collected ?? p.amount) || n(p.amount) : 0), 0);
  const heldOnRental = rentals.some((r) => r.deposit_held);
  if (required <= 0 && collected <= 0 && !heldOnRental) return { text: "—", detail: null };
  const refunded = rentals.reduce((s, r) => s + n(r.deposit_refund_amount), 0);
  const disp = rentals.map((r) => r.deposit_status).find((s) => s && s !== "none" && s !== "held") ?? null;
  if (disp === "refunded" || disp === "partially_refunded") return { text: money(refunded), detail: disp === "refunded" ? "Refunded" : "Partly Refunded" };
  if (disp === "applied" || disp === "forfeited") return { text: money(required), detail: "Applied" };
  if (disp === "pending_disposition") return { text: money(collected || required), detail: "Awaiting Disposition" };
  if (heldOnRental || (required > 0 && collected >= required)) return { text: money(collected || required), detail: "Held" };
  if (collected > 0) return { text: money(collected), detail: `Partial Of ${money(required)}` };
  return { text: money(0), detail: `Unpaid · ${money(required)} Due` };
}

export type PayCells = { pay: string; dep: DepositDisplay };
/** Group rentals (by application_id) and payments (by driver_id) and compute both cells per driver. */
export function computePayCells(
  rentals: (PayRental & { application_id: string | null })[],
  payments: (PayRow & { driver_id: string | null })[],
  today = new Date(),
): Record<string, PayCells> {
  const idx: Record<string, { rentals: PayRental[]; payments: PayRow[] }> = {};
  const slot = (k: string) => (idx[k] ??= { rentals: [], payments: [] });
  for (const r of rentals) if (r.application_id) slot(r.application_id).rentals.push(r);
  for (const p of payments) if (p.driver_id) slot(p.driver_id).payments.push(p);
  const out: Record<string, PayCells> = {};
  for (const [k, v] of Object.entries(idx))
    out[k] = { pay: PAYMENT_STATUS_LABEL[derivePaymentStatus(v.rentals, v.payments, today)], dep: deriveDepositDisplay(v.rentals, v.payments) };
  return out;
}
export const NO_PAY_CELLS: PayCells = { pay: "—", dep: { text: "—", detail: null } };
