/** Eastern calendar for the unmatched-invoice window. Date-only values are not shifted. */
export const UNMATCHED_TIME_ZONE = "America/New_York";
/** Inclusive Eastern days ending today. */
export const UNMATCHED_WINDOW_DAYS = 60;

export type StripeLink = {
  subscriptionId: string | null;
  customerId: string | null;
};

export type LocalLink = {
  subscriptionId?: string | null;
  customerId?: string | null;
};

export function easternDay(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: UNMATCHED_TIME_ZONE,
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

function shiftDay(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function offsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: UNMATCHED_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "NaN");
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour") % 24, pick("minute"), pick("second"));
  return asUtc - instant.getTime();
}

/** Unix seconds when this Eastern calendar day starts. */
export function easternDayStart(ymd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const guess = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(guess)) return null;
  let instant = guess - offsetMs(new Date(guess));
  instant = guess - offsetMs(new Date(instant));
  const seconds = Math.floor(instant / 1000);
  if (easternDay(new Date(seconds * 1000)) !== ymd) return null;
  if (easternDay(new Date(seconds * 1000 - 1000)) === ymd) return null;
  return seconds;
}

export function unmatchedWindow(now = new Date()): { gte: number; lt: number; from: string; to: string } | null {
  const today = easternDay(now);
  if (!today) return null;
  const from = shiftDay(today, -(UNMATCHED_WINDOW_DAYS - 1));
  const end = shiftDay(today, 1);
  const gte = easternDayStart(from);
  const lt = easternDayStart(end);
  if (gte == null || lt == null || lt <= gte) return null;
  return { gte, lt, from, to: today };
}

export function stripeId(value: unknown): string | null {
  if (typeof value === "string") {
    const id = value.trim();
    return id || null;
  }
  if (value && typeof value === "object" && "id" in value && typeof (value as { id?: unknown }).id === "string") {
    const id = (value as { id: string }).id.trim();
    return id || null;
  }
  return null;
}

export function subscriptionIdOf(invoice: {
  subscription?: unknown;
  parent?: { subscription_details?: { subscription?: unknown } } | null;
} | null | undefined): string | null {
  return stripeId(invoice?.subscription) ?? stripeId(invoice?.parent?.subscription_details?.subscription);
}

export function customerIdOf(record: { customer?: unknown } | null | undefined): string | null {
  return stripeId(record?.customer);
}

/** Last four characters. The full customer id is not logged. */
export function customerSuffix(customerId: string | null | undefined): string {
  const id = customerId?.trim() ?? "";
  if (!id) return "";
  return id.slice(-4);
}

/**
 * A paid invoice is matched when its subscription is on a rental, or its
 * customer is on a rental or an application. Either link is enough.
 */
export function invoiceIsLinked(invoice: StripeLink, rentals: readonly LocalLink[], applications: readonly LocalLink[]): boolean {
  const subscriptionId = invoice.subscriptionId?.trim() ?? "";
  const customerId = invoice.customerId?.trim() ?? "";
  if (subscriptionId && rentals.some((row) => (row.subscriptionId ?? "").trim() === subscriptionId)) return true;
  if (!customerId) return false;
  return rentals.some((row) => (row.customerId ?? "").trim() === customerId)
    || applications.some((row) => (row.customerId ?? "").trim() === customerId);
}

export function formatCents(cents: number | null): string {
  if (cents == null || !Number.isSafeInteger(cents)) return "Unknown";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}$${whole}.${frac}`;
}

export function formatUnmatchedWarn(input: {
  invoiceId?: string | null;
  paymentIntentId?: string | null;
  subscriptionId?: string | null;
  customerId?: string | null;
  amountCents: number | null;
  status: "paid" | "failed";
}): string {
  const amount = Number.isSafeInteger(input.amountCents) ? input.amountCents : null;
  return JSON.stringify({
    event: "stripe_unmatched_payment",
    invoice_id: input.invoiceId ?? null,
    payment_intent_id: input.paymentIntentId ?? null,
    subscription_id: input.subscriptionId ?? null,
    customer_suffix: customerSuffix(input.customerId),
    amount_cents: amount,
    status: input.status,
  });
}
