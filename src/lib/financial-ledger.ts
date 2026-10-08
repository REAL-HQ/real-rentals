/**
 * Step C1 canonical ledger — pure rules (no I/O). The database enforces the
 * same rules (fin_* functions + constraints); this module mirrors them for
 * validation, reporting helpers and tests.
 */
export const TXN_TYPES = [
  "obligation", "invoice", "expense", "payment", "refund",
  "deposit_received", "deposit_returned", "deposit_applied",
  "capital_expenditure", "financing_draw", "financing_payment",
] as const;
export type TxnType = (typeof TXN_TYPES)[number];
export type Basis = "accrual" | "cash" | "both";
export type TxnStatus = "proposed" | "confirmed" | "posted" | "reversed" | "corrected" | "discarded";

export function basisOf(t: TxnType): Basis {
  if (t === "obligation" || t === "invoice") return "accrual";
  if (t === "expense" || t === "capital_expenditure") return "both";
  return "cash";
}

/** Categories that always carry Owner-only sensitivity (acquisition and financing). */
export const OWNER_ONLY_CATEGORIES = new Set(["acquisition", "financing", "lien", "payoff"]);
export function requiredSensitivity(t: TxnType, category: string): "owner_only" | "standard" {
  return OWNER_ONLY_CATEGORIES.has(category) || t === "financing_draw" || t === "financing_payment" ? "owner_only" : "standard";
}

/** Not operating expense: capital spend and loan principal. Interest is expense. */
export function isOperatingExpense(t: TxnType, category: string): boolean {
  if (t === "capital_expenditure" || t === "financing_draw" || t === "deposit_received" || t === "deposit_returned") return false;
  if (OWNER_ONLY_CATEGORIES.has(category) && category !== "financing") return false;
  return true;
}

export type LedgerRow = {
  txn_type: TxnType; basis: Basis; direction: "in" | "out"; status: TxnStatus;
  amount: number; recognition_date: string | null; cash_date: string | null;
};

/** Rows that count in a report: posted originals plus posted reversal/correction mirrors. */
const counts = (r: LedgerRow) => r.status === "posted" || r.status === "reversed" || r.status === "corrected";
const signed = (r: LedgerRow) => (r.direction === "out" ? -1 : 1) * Number(r.amount);

/** Accrual: invoices/obligations/expenses by recognition date. Payments never count here. */
export function accrualNet(rows: LedgerRow[], from: string, to: string): number {
  return round(rows.filter((r) => counts(r) && r.basis !== "cash" && r.recognition_date && r.recognition_date >= from && r.recognition_date <= to).reduce((s, r) => s + signed(r), 0));
}
/** Cash: money that actually moved, by cash date. Invoices never count here. */
export function cashNet(rows: LedgerRow[], from: string, to: string): number {
  return round(rows.filter((r) => counts(r) && r.basis !== "accrual" && r.cash_date && r.cash_date >= from && r.cash_date <= to).reduce((s, r) => s + signed(r), 0));
}
const round = (n: number) => Math.round(n * 100) / 100;

/** Reference normalization: a duplicate HINT only, never identity. */
export function normalizeReference(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return s.length >= 3 ? s : null;
}
