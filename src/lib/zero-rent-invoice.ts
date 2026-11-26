// A $0 subscription invoice is an anchor, not rent. Setting trial_end on a
// subscription makes Stripe emit a paid $0 invoice (Regina, in_1UevF3 /
// BUKZ1ZXD-0007, Nov 23 2026). That must not become a payments row, move
// next_payment_due, or send Payment Received.

export function ignoredZeroOrTrialInvoice(invoice: {
  amount_paid?: unknown;
  amount_due?: unknown;
  total?: unknown;
  billing_reason?: unknown;
  lines?: { data?: Array<{ amount?: unknown; description?: unknown }> | null } | null;
} | null | undefined): boolean {
  if (!invoice) return false;
  const paid = Number(invoice.amount_paid ?? 0);
  const due = Number(invoice.amount_due ?? 0);
  const total = Number(invoice.total ?? invoice.amount_paid ?? 0);
  const noMoney = !(paid > 0) && !(due > 0) && !(total > 0);
  const reason = String(invoice.billing_reason ?? "");
  const lines = invoice.lines?.data ?? [];
  const trialLinesOnly = lines.length > 0 && lines.every((line) => {
    const desc = String(line.description ?? "").toLowerCase();
    const amount = Number(line.amount ?? 0);
    return desc.includes("trial") || amount === 0;
  });
  if (noMoney && (reason === "subscription_create" || reason === "subscription_update")) return true;
  if (trialLinesOnly && !(paid > 0)) return true;
  // A paid event with nothing collected is not rent, whatever the reason.
  if (!(paid > 0) && !(due > 0)) return true;
  return false;
}
