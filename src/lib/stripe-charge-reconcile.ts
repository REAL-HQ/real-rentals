// Nightly comparison of succeeded Stripe charges against payments rows.
// Pure. No Stripe client, no phone numbers, no secrets.

export type SucceededChargeRef = {
  chargeId: string;
  paymentIntentId: string | null;
  invoiceId: string | null;
  amountCents: number;
  currency: string;
};

export type RecordedChargeRef = {
  stripeChargeId: string | null;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
};

export function chargeGaps(charges: readonly SucceededChargeRef[], payments: readonly RecordedChargeRef[]): SucceededChargeRef[] {
  const chargesSeen = new Set<string>();
  const intents = new Set<string>();
  const invoices = new Set<string>();
  for (const p of payments) {
    if (p.stripeChargeId) chargesSeen.add(p.stripeChargeId);
    if (p.stripePaymentIntentId) intents.add(p.stripePaymentIntentId);
    if (p.stripeInvoiceId) invoices.add(p.stripeInvoiceId);
  }
  const gaps: SucceededChargeRef[] = [];
  const seen = new Set<string>();
  for (const c of charges) {
    if (!c.chargeId || seen.has(c.chargeId)) continue;
    seen.add(c.chargeId);
    if (chargesSeen.has(c.chargeId)) continue;
    if (c.paymentIntentId && intents.has(c.paymentIntentId)) continue;
    if (c.invoiceId && invoices.has(c.invoiceId)) continue;
    gaps.push(c);
  }
  return gaps;
}

export function chargeGapAlert(gap: SucceededChargeRef): { title: string; lines: string[]; dedupeKey: string } {
  const amount = (gap.amountCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const ref = gap.paymentIntentId || gap.invoiceId || gap.chargeId;
  return {
    title: "Stripe Payment Not On File",
    dedupeKey: gap.chargeId,
    lines: [
      `${amount} succeeded in Stripe and is not on a payments row.`,
      `Reference ${ref}.`,
      "Open Unmatched Payments to assign it to a rental or dismiss it.",
    ],
  };
}

/** A charge object from charges.list, reduced to the fields the comparison uses. */
export function succeededChargeRef(charge: Record<string, any> | null | undefined): SucceededChargeRef | null {
  if (!charge || charge.status !== "succeeded" || charge.paid !== true) return null;
  const captured = Number(charge.amount_captured ?? charge.amount ?? 0);
  const refunded = Number(charge.amount_refunded ?? 0);
  if (!Number.isFinite(captured) || captured <= 0) return null;
  if (Number.isFinite(refunded) && refunded >= captured) return null;
  const id = typeof charge.id === "string" ? charge.id : "";
  if (!id.startsWith("ch_") && !id.startsWith("py_")) return null;
  const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null;
  const invoice = typeof charge.invoice === "string" ? charge.invoice : charge.invoice?.id ?? null;
  return {
    chargeId: id,
    paymentIntentId: typeof pi === "string" ? pi : null,
    invoiceId: typeof invoice === "string" ? invoice : null,
    amountCents: Math.round(captured),
    currency: typeof charge.currency === "string" ? charge.currency : "usd",
  };
}
