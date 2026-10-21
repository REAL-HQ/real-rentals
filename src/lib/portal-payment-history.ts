/**
 * Driver payment history. The reader uses the signed-in user's client, so RLS
 * stays in force. A payments row is a charge. A payment is that charge collected
 * through a verified source. Balance due is the open balance, in cents.
 */
import { decimalSourceCents } from "@/lib/unified-finance-live-mapping";

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
  stripe_payment_intent_id?: string | null;
  stripe_invoice_id?: string | null;
};

export type HistoryCharge = {
  id: string;
  typeLabel: string;
  statusLabel: string;
  /** Null when the stored amount is not a valid dollar value. */
  amountCents: number | null;
  balanceDueCents: number | null;
  dueDate: string | null;
  paidDate: string | null;
};

export type HistoryPayment = {
  id: string;
  typeLabel: string;
  statusLabel: string;
  amountCents: number | null;
  collectedCents: number | null;
  refundedCents: number | null;
  sourceLabel: string;
  paidDate: string | null;
};

export type PortalPaymentHistory = {
  charges: HistoryCharge[];
  payments: HistoryPayment[];
  /** Cents when every open balance was valid. Null when unknown or not checked. */
  balanceDueCents: number | null;
  balanceState: "known" | "unknown" | "not_checked";
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

function cents(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  return decimalSourceCents(value);
}

export function formatHistoryCents(cents: number | null): string {
  if (cents == null) return "Unknown";
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  return `$${whole}.${String(rest).padStart(2, "0")}`;
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

function methodKey(method: string | null | undefined): string {
  return typeof method === "string" ? method.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
}

/** A known collection source. An empty or unknown method is not verified. */
export function verifiedSourceLabel(method: string | null | undefined): string | null {
  const key = methodKey(method);
  if (!key) return null;
  return VERIFIED_SOURCE_LABEL[key] ?? null;
}

/**
 * Card, Stripe, and ACH count only when the row names a Stripe payment intent
 * or invoice. Cash and the other non-card sources do not need one.
 */
export function verifiedPaymentSource(row: Pick<HistoryRow, "payment_method" | "stripe_payment_intent_id" | "stripe_invoice_id">): string | null {
  const label = verifiedSourceLabel(row.payment_method);
  if (!label) return null;
  const key = methodKey(row.payment_method);
  if (key === "stripe" || key === "card" || key === "ach") {
    const intent = row.stripe_payment_intent_id?.trim() ?? "";
    const invoice = row.stripe_invoice_id?.trim() ?? "";
    if (!intent && !invoice) return null;
  }
  return label;
}

export function buildPortalPaymentHistory(input: {
  rows: readonly HistoryRow[];
  truncated: boolean;
}): PortalPaymentHistory {
  const seen = new Set<string>();
  const charges: HistoryCharge[] = [];
  const payments: HistoryPayment[] = [];
  let balance = 0;
  let balanceUnknown = false;

  const ordered = [...input.rows].sort((a, b) => {
    const left = a.created_at ?? a.due_date ?? "";
    const right = b.created_at ?? b.due_date ?? "";
    return right.localeCompare(left) || a.id.localeCompare(b.id);
  });

  for (const row of ordered) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    const status = statusKey(row.status);
    const balanceDueCents = cents(row.balance_due);
    charges.push({
      id: row.id,
      typeLabel: historyTypeLabel(row.type),
      statusLabel: historyStatusLabel(row.status),
      amountCents: cents(row.amount),
      balanceDueCents,
      dueDate: row.due_date,
      paidDate: row.paid_date,
    });
    if (!(CLOSED_CHARGE_STATUSES as readonly string[]).includes(status)) {
      if (balanceDueCents == null) balanceUnknown = true;
      else if (balanceDueCents > 0) balance += balanceDueCents;
    }
    const source = verifiedPaymentSource(row);
    if ((status === "paid" || status === "refunded") && source) {
      const collectedCents = row.net_collected != null && row.net_collected !== "" ? cents(row.net_collected) : cents(row.amount);
      payments.push({
        id: row.id,
        typeLabel: historyTypeLabel(row.type),
        statusLabel: historyStatusLabel(row.status),
        amountCents: cents(row.amount),
        collectedCents,
        refundedCents: cents(row.refunded_amount ?? 0),
        sourceLabel: source,
        paidDate: row.paid_date,
      });
    }
  }

  return {
    charges,
    payments,
    balanceDueCents: input.truncated || balanceUnknown ? null : balance,
    balanceState: input.truncated ? "not_checked" : balanceUnknown ? "unknown" : "known",
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
    `Amount: ${formatHistoryCents(payment.amountCents)}`,
    `Collected: ${formatHistoryCents(payment.collectedCents)}`,
    `Refunded: ${formatHistoryCents(payment.refundedCents)}`,
    payment.paidDate ? `Paid: ${payment.paidDate.slice(0, 10)}` : "Paid: Not Recorded",
  ].join("\n");
}

/** The signed-in user's client. RLS applies to every query this reader makes. */
export type PaymentHistoryClient = {
  from: (table: string) => any;
};

const PAYMENT_COLUMNS =
  "id,type,status,amount,balance_due,net_collected,refunded_amount,due_date,paid_date,created_at,payment_method,stripe_payment_intent_id,stripe_invoice_id";

function chunks(ids: readonly string[]): string[][] {
  const groups: string[][] = [];
  for (let index = 0; index < ids.length; index += HISTORY_CHUNK) groups.push(ids.slice(index, index + HISTORY_CHUNK));
  return groups;
}

/**
 * Charges for the JWT user. Applications are this user's rows. Payments are
 * those whose driver_id is one of those applications. There is no rental_id read.
 */
export async function readOwnPaymentHistory(client: PaymentHistoryClient, userId: string): Promise<PortalPaymentHistory> {
  const applications = await client
    .from("applications")
    .select("id")
    .eq("user_id", userId)
    .order("id", { ascending: true })
    .limit(HISTORY_READ_CAP + 1);
  if (applications.error) throw new Error("Payment history could not be loaded.");
  const applicationRows = (applications.data ?? []) as { id?: string }[];
  const truncatedApplications = applicationRows.length > HISTORY_READ_CAP;
  const applicationIds = (truncatedApplications ? applicationRows.slice(0, HISTORY_READ_CAP) : applicationRows)
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string" && id !== "");

  const rows: HistoryRow[] = [];
  let truncatedPayments = false;
  for (const group of chunks(applicationIds)) {
    const page = await client
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .in("driver_id", group)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HISTORY_READ_CAP + 1);
    if (page.error) throw new Error("Payment history could not be loaded.");
    const found = (page.data ?? []) as HistoryRow[];
    if (found.length > HISTORY_READ_CAP) truncatedPayments = true;
    rows.push(...(found.length > HISTORY_READ_CAP ? found.slice(0, HISTORY_READ_CAP) : found));
  }

  return buildPortalPaymentHistory({
    rows,
    truncated: truncatedApplications || truncatedPayments,
  });
}
