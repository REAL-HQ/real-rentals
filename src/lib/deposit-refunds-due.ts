/** Eastern calendar day. A stored rental end date is not shifted. */
export const DEPOSIT_REFUNDS_TIME_ZONE = "America/New_York";

export const CLOSED_RENTAL_STATUSES = ["closed", "returned"] as const;

const FINISHED_DEPOSIT = new Set(["refunded", "applied", "forfeited"]);
const COUNTED_PAYMENT = new Set(["paid", "refunded"]);
const IGNORED_PAYMENT = new Set(["void", "waived", "cancelled", "canceled"]);

export type DepositRentalInput = {
  id: string;
  status: string | null;
  endDate: string | null;
  depositHeld: boolean | null;
  depositStatus: string | null;
  depositRefundAmount: string | number | null;
  applicationId: string | null;
};

export type DepositPaymentInput = {
  id: string;
  rentalId: string | null;
  type: string | null;
  status: string | null;
  amount: string | number | null;
  netCollected: string | number | null;
  refundedAmount: string | number | null;
};

export type DepositDeductionInput = {
  id: string;
  rentalId: string | null;
  amount: string | number | null;
};

export type DepositApplicationInput = {
  id: string;
  fullName: string | null;
};

export type DepositRefundDueRow = {
  rentalId: string;
  renter: string;
  daysSinceReturn: number | null;
  daysLabel: string;
  cents: number | null;
};

export type DepositRefundsDueReport = {
  asOf: string;
  rows: DepositRefundDueRow[];
};

export type DepositRefundsDueResponse =
  | { status: "disabled" }
  | { status: "capped" }
  | { status: "degraded" }
  | { status: "ready"; report: DepositRefundsDueReport };

export function easternToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEPOSIT_REFUNDS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

/** Calendar days from a stored YYYY-MM-DD end date to the Eastern as-of day. */
export function daysSinceReturn(endDate: string | null | undefined, asOf: string): number | null {
  if (endDate == null) return null;
  const text = String(endDate).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  const days = (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${text}T00:00:00Z`)) / 86400000;
  if (!Number.isInteger(days) || days < 0) return null;
  return days;
}

export function formatDaysSinceReturn(days: number | null): string {
  if (days == null) return "Unknown";
  if (days === 0) return "Today";
  if (days === 1) return "1 Day";
  return `${days} Days`;
}

/** Integer cents. Unknown stays a word so it cannot be read as zero dollars. */
export function formatCents(cents: number | null): string {
  if (cents == null || !Number.isSafeInteger(cents) || cents < 0) return "Unknown";
  return String(cents);
}

function norm(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Decimal major units to integer cents. Rejects rounding, negatives, and a third decimal. */
function moneyCents(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole ?? "0") * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

function renterLabel(name: string | null | undefined): string {
  const text = String(name ?? "").trim();
  return text || "Renter";
}

/** Blank net falls back to amount minus refunded. A present net is used alone. */
function paymentCollected(payment: DepositPaymentInput): number | "skip" | "unknown" {
  if (norm(payment.type) !== "deposit") return "skip";
  const status = norm(payment.status);
  if (IGNORED_PAYMENT.has(status)) return "skip";
  if (!COUNTED_PAYMENT.has(status)) return "unknown";
  if (payment.netCollected != null && payment.netCollected !== "") {
    const net = moneyCents(payment.netCollected);
    return net == null ? "unknown" : net;
  }
  const amount = moneyCents(payment.amount);
  const refunded =
    payment.refundedAmount == null || payment.refundedAmount === "" ? 0 : moneyCents(payment.refundedAmount);
  if (amount == null || refunded == null) return "unknown";
  const net = amount - refunded;
  if (!Number.isSafeInteger(net) || net < 0) return "unknown";
  return net;
}

export function classifyDepositRefunds(input: {
  rentals: DepositRentalInput[];
  payments: DepositPaymentInput[];
  deductions: DepositDeductionInput[];
  applications: DepositApplicationInput[];
  asOf: string;
}): DepositRefundDueRow[] {
  const names = new Map(input.applications.map((row) => [row.id, row.fullName]));
  const payments = new Map<string, DepositPaymentInput[]>();
  for (const payment of input.payments) {
    if (!payment.rentalId) continue;
    const list = payments.get(payment.rentalId) ?? [];
    list.push(payment);
    payments.set(payment.rentalId, list);
  }
  const deductions = new Map<string, DepositDeductionInput[]>();
  for (const deduction of input.deductions) {
    if (!deduction.rentalId) continue;
    const list = deductions.get(deduction.rentalId) ?? [];
    list.push(deduction);
    deductions.set(deduction.rentalId, list);
  }

  const rows: DepositRefundDueRow[] = [];
  for (const rental of input.rentals) {
    if (!CLOSED_RENTAL_STATUSES.includes(norm(rental.status) as (typeof CLOSED_RENTAL_STATUSES)[number])) continue;
    if (rental.depositHeld !== true) continue;
    if (FINISHED_DEPOSIT.has(norm(rental.depositStatus))) continue;

    let unknown = false;
    let collected = 0;
    let sawCollected = false;
    for (const payment of payments.get(rental.id) ?? []) {
      const part = paymentCollected(payment);
      if (part === "skip") continue;
      if (part === "unknown") {
        unknown = true;
        continue;
      }
      sawCollected = true;
      const next = collected + part;
      if (!Number.isSafeInteger(next)) unknown = true;
      else collected = next;
    }

    let applied = 0;
    for (const deduction of deductions.get(rental.id) ?? []) {
      const cents = moneyCents(deduction.amount);
      if (cents == null) {
        unknown = true;
        continue;
      }
      const next = applied + cents;
      if (!Number.isSafeInteger(next)) unknown = true;
      else applied = next;
    }

    let refunded = 0;
    if (rental.depositRefundAmount != null && rental.depositRefundAmount !== "") {
      const cents = moneyCents(rental.depositRefundAmount);
      if (cents == null) unknown = true;
      else refunded = cents;
    }

    const days = daysSinceReturn(rental.endDate, input.asOf);
    const renter = renterLabel(rental.applicationId ? names.get(rental.applicationId) : null);
    if (unknown || !sawCollected) {
      rows.push({
        rentalId: rental.id,
        renter,
        daysSinceReturn: days,
        daysLabel: formatDaysSinceReturn(days),
        cents: null,
      });
      continue;
    }

    const remaining = collected - applied - refunded;
    if (!Number.isSafeInteger(remaining) || remaining < 0) {
      rows.push({
        rentalId: rental.id,
        renter,
        daysSinceReturn: days,
        daysLabel: formatDaysSinceReturn(days),
        cents: null,
      });
      continue;
    }
    if (remaining === 0) continue;
    rows.push({
      rentalId: rental.id,
      renter,
      daysSinceReturn: days,
      daysLabel: formatDaysSinceReturn(days),
      cents: remaining,
    });
  }

  rows.sort((a, b) => {
    if (a.daysSinceReturn == null && b.daysSinceReturn == null) return a.rentalId.localeCompare(b.rentalId);
    if (a.daysSinceReturn == null) return 1;
    if (b.daysSinceReturn == null) return -1;
    if (a.daysSinceReturn !== b.daysSinceReturn) return b.daysSinceReturn - a.daysSinceReturn;
    return a.rentalId.localeCompare(b.rentalId);
  });
  return rows;
}
