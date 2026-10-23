/**
 * Signed-in driver's payment history.
 *
 * Drivers already have SELECT on their own rows: "Drivers can view their own
 * payments" (supabase/migrations/20260615003005). paid_date and due_date are
 * calendar dates and are not timezone-shifted. A real timestamp is shown in
 * America/New_York.
 */
import { fmtDate } from "@/lib/date-format";

export const DRIVER_PAYMENT_HISTORY_ENABLED: boolean = false as boolean;

export const DRIVER_PAYMENT_COLUMNS =
  "id,driver_id,paid_date,due_date,amount,balance_due,payment_method,status" as const;

const PAST_STATUSES = new Set(["paid", "refunded"]);
const OPEN_STATUSES = new Set([
  "upcoming",
  "pending",
  "current",
  "failed",
  "late",
  "overdue",
  "past_due",
  "unpaid",
  "collections",
]);

const STATUS_LABEL: Record<string, string> = {
  paid: "Paid",
  refunded: "Refunded",
  pending: "Pending",
  current: "Current",
  failed: "Failed",
  late: "Late",
  overdue: "Overdue",
  past_due: "Past Due",
  unpaid: "Unpaid",
  collections: "Collections",
  upcoming: "Upcoming",
  waived: "Waived",
  void: "Void",
};

const METHOD_LABEL: Record<string, string> = {
  card: "Card",
  cash: "Cash",
  ach: "ACH",
  check: "Check",
  wire: "Wire",
  zelle: "Zelle",
};

export type PaymentRow = {
  id?: string | null;
  driver_id?: string | null;
  paid_date?: string | null;
  due_date?: string | null;
  amount?: number | null;
  balance_due?: number | null;
  payment_method?: string | null;
  status?: string | null;
};

export type PaymentLine = {
  id: string;
  dateLabel: string;
  amountLabel: string;
  methodLabel: string;
  statusLabel: string;
};

export type PaymentHistoryView = {
  upcoming: PaymentLine | null;
  past: PaymentLine[];
};

export function assertDriverPaymentHistoryEnabled() {
  if (DRIVER_PAYMENT_HISTORY_ENABLED !== true) {
    throw new Error("Driver payment history is disabled.");
  }
}

export function paymentDateLabel(value: string | null | undefined): string {
  if (!value || !value.trim()) return "Not On File";
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return fmtDate(trimmed) || "Not On File";
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return "Not On File";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export function moneyLabel(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function statusLabel(status: string | null | undefined): string {
  const key = (status ?? "").trim().toLowerCase();
  if (!key) return "Not On File";
  return STATUS_LABEL[key] ?? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function methodLabel(method: string | null | undefined): string {
  const key = (method ?? "").trim().toLowerCase();
  if (!key) return "Not On File";
  return METHOD_LABEL[key] ?? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function amountOf(row: PaymentRow, open: boolean): number {
  if (open && typeof row.balance_due === "number" && Number.isFinite(row.balance_due) && row.balance_due > 0) {
    return row.balance_due;
  }
  return typeof row.amount === "number" && Number.isFinite(row.amount) ? row.amount : 0;
}

function line(row: PaymentRow, open: boolean): PaymentLine {
  const date = open ? row.due_date : row.paid_date || row.due_date;
  return {
    id: String(row.id),
    dateLabel: paymentDateLabel(date),
    amountLabel: moneyLabel(amountOf(row, open)),
    methodLabel: methodLabel(row.payment_method),
    statusLabel: statusLabel(row.status),
  };
}

/**
 * Keeps only rows whose driver_id is one of this driver's application ids.
 * Paid and refunded are history. The soonest open charge is the amount due.
 */
export function buildPaymentHistory(rows: PaymentRow[], ownApplicationIds: string[]): PaymentHistoryView {
  const own = new Set(ownApplicationIds);
  const kept = rows.filter((row) => {
    const driverId = (row.driver_id ?? "").trim();
    return Boolean(row.id) && driverId.length > 0 && own.has(driverId);
  });

  const past = kept
    .filter((row) => PAST_STATUSES.has((row.status ?? "").trim().toLowerCase()))
    .sort((a, b) => String(b.paid_date ?? b.due_date ?? "").localeCompare(String(a.paid_date ?? a.due_date ?? "")))
    .map((row) => line(row, false));

  const open = kept
    .filter((row) => OPEN_STATUSES.has((row.status ?? "").trim().toLowerCase()))
    .sort((a, b) => {
      const ad = a.due_date ?? "9999-12-31";
      const bd = b.due_date ?? "9999-12-31";
      return ad.localeCompare(bd);
    });

  return {
    upcoming: open[0] ? line(open[0], true) : null,
    past,
  };
}
