import { customerSuffix, easternDay, invoiceIsLinked, type LocalLink } from "./stripe-unmatched";

/** Balance transaction types that settle a customer payment. */
export const CHARGE_TYPES = new Set(["charge", "payment"]);

export type PayoutCharge = {
  payoutId: string;
  chargeId: string;
  paymentIntentId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  invoiceSeen: boolean;
  amountCents: number | null;
};

export type UnmatchedCharge = {
  payoutId: string;
  chargeId: string;
  paymentIntentId: string | null;
  customerSuffix: string;
  amountCents: number | null;
  fleetLinked: boolean | null;
};

export type PaidGap = {
  paymentId: string;
  paymentIntentId: string;
  amountCents: number | null;
  paidOn: string;
};

export type LinkLimits = {
  directoryComplete: boolean;
  invoicesComplete: boolean;
};

/**
 * Fleet linkage is invoiceIsLinked. A positive link stands on a partial read.
 * A negative link is withheld when the directory or the invoice index is incomplete,
 * because a later page could still hold the subscription or the customer.
 */
export function fleetLink(
  charge: { subscriptionId: string | null; customerId: string | null; invoiceSeen: boolean },
  rentals: readonly LocalLink[],
  applications: readonly LocalLink[],
  limits: LinkLimits,
): boolean | null {
  const linked = invoiceIsLinked(
    { subscriptionId: charge.subscriptionId, customerId: charge.customerId },
    rentals,
    applications,
  );
  if (linked) return true;
  if (!limits.directoryComplete) return null;
  if (!limits.invoicesComplete && !charge.invoiceSeen) return null;
  return false;
}

/** A charge is unmatched when no payments row carries its payment intent. */
export function unmatchedCharges(
  charges: readonly PayoutCharge[],
  paymentIntentIds: ReadonlySet<string>,
  rentals: readonly LocalLink[],
  applications: readonly LocalLink[],
  limits: LinkLimits,
): UnmatchedCharge[] {
  return charges
    .filter((charge) => !charge.paymentIntentId || !paymentIntentIds.has(charge.paymentIntentId))
    .map((charge) => ({
      payoutId: charge.payoutId,
      chargeId: charge.chargeId,
      paymentIntentId: charge.paymentIntentId,
      customerSuffix: customerSuffix(charge.customerId),
      amountCents: charge.amountCents,
      fleetLinked: fleetLink(charge, rentals, applications, limits),
    }))
    .sort((a, b) => (a.payoutId < b.payoutId ? -1 : a.payoutId > b.payoutId ? 1 : a.chargeId < b.chargeId ? -1 : a.chargeId > b.chargeId ? 1 : 0));
}

export function paidNotInPayout(input: {
  payments: readonly { id: string; status: string; paidDate: string | null; paymentIntentId: string | null; amount: unknown }[];
  seenIntents: ReadonlySet<string>;
  from: string;
  to: string;
}): PaidGap[] {
  const rows: PaidGap[] = [];
  for (const payment of input.payments) {
    const intent = payment.paymentIntentId?.trim() ?? "";
    const paidOn = paidDay(payment.paidDate);
    const status = payment.status.trim().toLowerCase();
    if (!intent || !paidOn || (status !== "paid" && status !== "refunded")) continue;
    if (paidOn < input.from || paidOn > input.to) continue;
    if (input.seenIntents.has(intent)) continue;
    rows.push({
      paymentId: payment.id,
      paymentIntentId: intent,
      amountCents: dollarsToCents(payment.amount),
      paidOn,
    });
  }
  rows.sort((a, b) => (a.paidOn < b.paidOn ? 1 : a.paidOn > b.paidOn ? -1 : a.paymentId < b.paymentId ? -1 : a.paymentId > b.paymentId ? 1 : 0));
  return rows;
}

export function dollarsToCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(Number(amount.toFixed(2)) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function arrivalDay(unixSeconds: number): string | null {
  if (!Number.isSafeInteger(unixSeconds) || unixSeconds <= 0) return null;
  const day = easternDay(new Date(unixSeconds * 1000));
  return day || null;
}

export function statusLabel(status: string): string {
  return status
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function paidDay(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? null;
}
