// Renter reimbursements: money paid BACK to a renter (lost revenue while their
// car was down, a cost they covered for us, an overpayment). Client-safe:
// labels and the one validation rule shared by the form and the server.
// Not rent, not a vehicle expense. Nothing here sends anything.

export const REIMBURSEMENT_METHODS = [
  { value: "zelle", label: "Zelle" },
  { value: "cash_app", label: "Cash App" },
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "venmo", label: "Venmo" },
  { value: "paypal", label: "PayPal" },
  { value: "card", label: "Card Refund" },
  { value: "other", label: "Other" },
] as const;

export const REIMBURSEMENT_REASONS = [
  { value: "lost_revenue", label: "Lost Revenue (Car Down)" },
  { value: "out_of_pocket", label: "Out-Of-Pocket Cost" },
  { value: "overpayment", label: "Overpayment" },
  { value: "goodwill", label: "Goodwill Credit" },
  { value: "other", label: "Other" },
] as const;

export type ReimbursementMethod = (typeof REIMBURSEMENT_METHODS)[number]["value"];
export type ReimbursementReason = (typeof REIMBURSEMENT_REASONS)[number]["value"];

export const METHOD_VALUES = REIMBURSEMENT_METHODS.map((m) => m.value) as unknown as [ReimbursementMethod, ...ReimbursementMethod[]];
export const REASON_VALUES = REIMBURSEMENT_REASONS.map((r) => r.value) as unknown as [ReimbursementReason, ...ReimbursementReason[]];

export function methodLabel(value: string | null | undefined): string {
  return REIMBURSEMENT_METHODS.find((m) => m.value === value)?.label ?? "Other";
}
export function reasonLabel(value: string | null | undefined): string {
  return REIMBURSEMENT_REASONS.find((r) => r.value === value)?.label ?? "Other";
}

export type ReimbursementDraft = {
  applicationId: string;
  rentalId?: string | null;
  vehicleId?: string | null;
  paidOn: string;
  amount: number | string;
  method: string;
  reference?: string | null;
  reason: string;
  notes?: string | null;
  receiptPath?: string | null;
  receiptName?: string | null;
  receiptMime?: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Cents-exact amount, or null when it is not a positive dollar figure. */
export function parseReimbursementAmount(raw: number | string): number | null {
  const text = typeof raw === "number" ? String(raw) : String(raw ?? "").trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const n = Math.round(Number(text) * 100) / 100;
  return n > 0 && n <= 100000 ? n : null;
}

/** The single rule for a new reimbursement. Returns the first problem in plain words. */
export function reimbursementProblem(d: ReimbursementDraft): string | null {
  if (!UUID.test(d.applicationId ?? "")) return "Choose The Renter";
  if (d.rentalId && !UUID.test(d.rentalId)) return "That Rental Was Not Found";
  if (d.vehicleId && !UUID.test(d.vehicleId)) return "That Vehicle Was Not Found";
  if (!validDate(d.paidOn ?? "")) return "Enter The Date Paid";
  if (parseReimbursementAmount(d.amount) == null) return "Enter An Amount Above $0";
  if (!REIMBURSEMENT_METHODS.some((m) => m.value === d.method)) return "Choose How It Was Paid";
  if (!REIMBURSEMENT_REASONS.some((r) => r.value === d.reason)) return "Choose A Reason";
  if ((d.reference ?? "").length > 120) return "Reference Is Too Long";
  if ((d.notes ?? "").length > 2000) return "Note Is Too Long";
  return null;
}

/** Eastern calendar day, so a late-evening entry is not dated tomorrow. */
export function todayEasternISO(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
