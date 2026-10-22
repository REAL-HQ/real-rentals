/**
 * Read-only payment history for a signed-in driver.
 *
 * Rows come from public.payments. "Drivers can view their own payments"
 * already lets a driver SELECT a row whose driver_id is one of their
 * applications. This module only decides which of those rows are history
 * and how to read the date. It does not write, and it does not call Stripe.
 *
 * History is a row whose status is paid, failed, or refunded. A charge that
 * is still pending, current, late, or unpaid is not history.
 */

export const PORTAL_PAYMENT_HISTORY_ENABLED: boolean = false;

export const PORTAL_PAYMENT_HISTORY_STATUSES = ["paid", "failed", "refunded"] as const;

export type PortalPaymentStatus = (typeof PORTAL_PAYMENT_HISTORY_STATUSES)[number];

export const PORTAL_PAYMENT_TIME_ZONE = "America/New_York";

const PURPOSE_LABEL: Record<string, string> = {
  rent: "Rent",
  deposit: "Deposit",
  late_fee: "Late Fee",
  toll: "Toll",
  damage: "Damage",
  fee: "Fee",
  cleaning: "Cleaning",
  fuel: "Fuel",
  other: "Other",
};

export type PaymentHistoryRow = {
  id: string;
  status: string | null;
  amount: number | string | null;
  type: string | null;
  reason: string | null;
  paid_date: string | null;
  refunded_at: string | null;
  last_attempt_at: string | null;
  created_at: string | null;
};

export type PaymentHistoryItem = {
  id: string;
  /** Eastern calendar day, YYYY-MM-DD, or null when no date was recorded. */
  date: string | null;
  amount: number | null;
  status: PortalPaymentStatus;
  /** What the payment was for, when type or reason was recorded. */
  purpose: string | null;
};

export function assertPortalPaymentHistoryEnabled(): void {
  if (PORTAL_PAYMENT_HISTORY_ENABLED !== true) {
    throw new Error("Portal payment history is not enabled.");
  }
}

/** YYYY-MM-DD in Eastern Time. */
export function easternCalendarDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PORTAL_PAYMENT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** A date column stays that calendar day. A timestamp becomes its Eastern day. */
export function asEasternCalendarDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return easternCalendarDate(new Date(parsed));
}

function money(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function purposeLabel(value: string | null | undefined): string | null {
  const key = (value ?? "").trim().toLowerCase();
  if (!key) return null;
  return PURPOSE_LABEL[key] ?? null;
}

function moment(raw: string | null | undefined): { date: string; sort: string } | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const date = asEasternCalendarDate(trimmed);
  if (!date) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { date, sort: `${date}|` };
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return { date, sort: `${date}|` };
  return { date, sort: `${date}|${new Date(parsed).toISOString()}` };
}

function when(row: PaymentHistoryRow, status: PortalPaymentStatus): { date: string; sort: string } | null {
  if (status === "refunded") {
    return moment(row.refunded_at) ?? moment(row.paid_date) ?? moment(row.created_at);
  }
  if (status === "failed") {
    return moment(row.last_attempt_at) ?? moment(row.created_at) ?? moment(row.paid_date);
  }
  return moment(row.paid_date) ?? moment(row.created_at) ?? moment(row.refunded_at);
}

/**
 * Past payments, newest Eastern day first. Same day keeps the later timestamp
 * first. Pending and other open charges are left out.
 */
export function paymentHistory(rows: PaymentHistoryRow[]): PaymentHistoryItem[] {
  const items: Array<PaymentHistoryItem & { sort: string }> = [];
  for (const row of rows) {
    const status = row.status?.trim().toLowerCase();
    if (status !== "paid" && status !== "failed" && status !== "refunded") continue;
    const at = when(row, status);
    const recorded = purposeLabel(row.reason) ?? purposeLabel(row.type);
    items.push({
      id: row.id,
      date: at?.date ?? null,
      amount: money(row.amount),
      status,
      purpose: recorded,
      sort: at?.sort ?? "",
    });
  }
  items.sort((a, b) => b.sort.localeCompare(a.sort) || b.id.localeCompare(a.id));
  return items.map(({ sort: _sort, ...item }) => item);
}
