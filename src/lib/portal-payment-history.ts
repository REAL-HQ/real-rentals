/**
 * Driver payment history rules. No database access and no writes.
 * A payments row is a charge. A payment is that charge collected through a
 * verified source. Balance due is the open balance on the charges we read.
 */

export const HISTORY_READ_CAP = 999;
export const HISTORY_CHUNK = 50;

const CLOSED_CHARGE_STATUSES = ["paid", "refunded", "void", "waived"] as const;

/** Sources a collected payment may name. Card covers a Stripe card or ACH charge. */
const VERIFIED_SOURCE_LABEL: Record<string, string> = {
  stripe: "Card",
  card: "Card",
  ach: "Card",
  cash: "Cash",
  cash_app: "Cash App",
  cashapp: "Cash App",
  venmo: "Venmo",
  zelle: "Zelle",
  bank_transfer: "Bank Transfer",
  bank: "Bank Transfer",
  check: "Check",
  money_order: "Money Order",
  other: "Other",
};

export type HistoryRow = {
  id: string;
  type: string | null;
  status: string | null;
  amount: number | string | null;
  balance_due: number | string | null;
  net_collected: number | string | null;
  refunded_amount: number | string | null;
  due_date: string | null;
  paid_date: string | null;
  created_at: string | null;
  payment_method: string | null;
};

export type HistoryCharge = {
  id: string;
  typeLabel: string;
  statusLabel: string;
  amount: number;
  balanceDue: number;
  dueDate: string | null;
  paidDate: string | null;
};

export type HistoryPayment = {
  id: string;
  typeLabel: string;
  statusLabel: string;
  amount: number;
  collected: number;
  refunded: number;
  sourceLabel: string;
  paidDate: string | null;
};

export type PortalPaymentHistory = {
  charges: HistoryCharge[];
  payments: HistoryPayment[];
  /** Null when a capped read means the total would be incomplete. */
  balanceDue: number | null;
  truncated: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  upcoming: "Upcoming",
  pending: "Processing",
  current: "Due",
  paid: "Paid",
  overdue: "Overdue",
  past_due: "Past Due",
  failed: "Failed",
  unpaid: "Unpaid",
  collections: "In Collections",
  refunded: "Refunded",
  waived: "Waived",
  void: "Void",
  late: "Late",
};

function money(value: number | string | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function statusKey(status: string | null | undefined): string {
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

export function historyStatusLabel(status: string | null | undefined): string {
  const key = statusKey(status);
  if (!key) return "Not Recorded";
  return STATUS_LABEL[key] ?? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function historyTypeLabel(type: string | null | undefined): string {
  const key = typeof type === "string" ? type.trim().toLowerCase() : "";
  if (!key) return "Charge";
  if (key === "rent") return "Rent";
  if (key === "deposit") return "Deposit";
  if (key === "late_fee") return "Late Fee";
  return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** A known collection source. An empty or unknown method is not verified. */
export function verifiedSourceLabel(method: string | null | undefined): string | null {
  const key = typeof method === "string" ? method.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (!key) return null;
  return VERIFIED_SOURCE_LABEL[key] ?? null;
}

function collectedAmount(row: HistoryRow): number {
  if (row.net_collected != null && row.net_collected !== "") return money(row.net_collected);
  return money(row.amount);
}

export function buildPortalPaymentHistory(input: {
  rows: readonly HistoryRow[];
  truncated: boolean;
}): PortalPaymentHistory {
  const seen = new Set<string>();
  const charges: HistoryCharge[] = [];
  const payments: HistoryPayment[] = [];
  let balance = 0;

  const ordered = [...input.rows].sort((a, b) => {
    const left = a.created_at ?? a.due_date ?? "";
    const right = b.created_at ?? b.due_date ?? "";
    return right.localeCompare(left) || a.id.localeCompare(b.id);
  });

  for (const row of ordered) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    const status = statusKey(row.status);
    const balanceDue = money(row.balance_due);
    charges.push({
      id: row.id,
      typeLabel: historyTypeLabel(row.type),
      statusLabel: historyStatusLabel(row.status),
      amount: money(row.amount),
      balanceDue,
      dueDate: row.due_date,
      paidDate: row.paid_date,
    });
    if (!(CLOSED_CHARGE_STATUSES as readonly string[]).includes(status) && balanceDue > 0) {
      balance += balanceDue;
    }
    const source = verifiedSourceLabel(row.payment_method);
    if ((status === "paid" || status === "refunded") && source) {
      payments.push({
        id: row.id,
        typeLabel: historyTypeLabel(row.type),
        statusLabel: historyStatusLabel(row.status),
        amount: money(row.amount),
        collected: collectedAmount(row),
        refunded: money(row.refunded_amount),
        sourceLabel: source,
        paidDate: row.paid_date,
      });
    }
  }

  return {
    charges,
    payments,
    balanceDue: input.truncated ? null : Math.round(balance * 100) / 100,
    truncated: input.truncated,
  };
}

export function receiptText(payment: HistoryPayment): string {
  return [
    "REAL RENTALS",
    "Receipt",
    "",
    `Receipt ${payment.id}`,
    `Type: ${payment.typeLabel}`,
    `Status: ${payment.statusLabel}`,
    `Source: ${payment.sourceLabel}`,
    `Amount: ${payment.amount.toFixed(2)}`,
    `Collected: ${payment.collected.toFixed(2)}`,
    `Refunded: ${payment.refunded.toFixed(2)}`,
    payment.paidDate ? `Paid: ${payment.paidDate.slice(0, 10)}` : "Paid: Not Recorded",
  ].join("\n");
}
