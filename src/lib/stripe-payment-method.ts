// Stored label for a Stripe charge. payments.payment_method is plain text and
// has no brand or last4 column, so those stay off the row. Display labels are
// separate and never written back.
import { formatStatusLabel } from "@/lib/ui-display-labels";

const STORED: Readonly<Record<string, string>> = {
  card: "card",
  link: "link",
  us_bank_account: "ach",
  cashapp: "cash_app",
};

type ChargeLike = { payment_method_details?: { type?: unknown } | null } | null | undefined;

/** card, link, ach, cash_app, or the raw Stripe type. Null when the charge did not say. */
export function stripeChargePaymentMethod(charge: ChargeLike): string | null {
  const type = charge?.payment_method_details?.type;
  if (typeof type !== "string") return null;
  const key = type.trim().toLowerCase();
  if (!key || key.length > 64) return null;
  return Object.prototype.hasOwnProperty.call(STORED, key) ? STORED[key] : key;
}

function chargeCandidates(invoice: any): unknown[] {
  const out: unknown[] = [invoice?.charge, invoice?.latest_charge, invoice?.payment_intent?.latest_charge];
  const payments = invoice?.payments?.data ?? invoice?.invoice_payments?.data;
  if (Array.isArray(payments)) {
    for (const row of payments) {
      const payment = row?.payment ?? row;
      out.push(payment?.charge, payment?.payment_intent?.latest_charge);
    }
  }
  return out;
}

/** Method from an invoice's charge when Stripe included one. Otherwise card, matching the previous invoice default. */
export function invoicePaymentMethod(invoice: any): string {
  for (const candidate of chargeCandidates(invoice)) {
    const method = stripeChargePaymentMethod(candidate as ChargeLike);
    if (method) return method;
  }
  return "card";
}

const DISPLAY: Readonly<Record<string, string>> = {
  cashapp: "Cash App",
  cash_app: "Cash App",
};

/**
 * Title Case for the Payments Method column. A blank method on a Stripe
 * PaymentIntent or invoice reads Stripe, so older rows are not a dash.
 */
export function paymentMethodLabel(
  method: string | null | undefined,
  row?: { stripe_payment_intent_id?: string | null; stripe_invoice_id?: string | null },
): string {
  const raw = typeof method === "string" ? method.trim() : "";
  if (!raw) {
    const intent = typeof row?.stripe_payment_intent_id === "string" ? row.stripe_payment_intent_id.trim() : "";
    const invoice = typeof row?.stripe_invoice_id === "string" ? row.stripe_invoice_id.trim() : "";
    return intent || invoice ? "Stripe" : "—";
  }
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (Object.prototype.hasOwnProperty.call(DISPLAY, key)) return DISPLAY[key];
  return formatStatusLabel(raw);
}
