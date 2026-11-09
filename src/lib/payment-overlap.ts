/** Staff sentence when cash (or Zelle, and so on) and Stripe both collected one charge. */
export function doubleCollectionMessage(amount: number, when = new Date()): string {
  const money = `$${amount.toFixed(2)}`;
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(when);
  return `Possible double collection: marked paid manually, then Stripe collected ${money} on ${date}; refund may be owed.`;
}

type OverlapRow = {
  net_collected: unknown;
  failure_reason?: string | null;
  notified_status?: string | null;
  stripe_invoice_id?: string | null;
  stripe_payment_intent_id?: string | null;
};

function filled(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Cash or Zelle kept on a Stripe invoice after Stripe also collected it.
 * A receipt with no invoice id is not overlap. A payment intent means the
 * row is the Stripe charge, so it is not overlap either.
 */
export function paymentOverlap(result: { data: OverlapRow[] | null; error: unknown; count: number | null }): number | null {
  if (result.error || !Array.isArray(result.data) || result.count !== result.data.length) return null;
  let overlap = 0;
  for (const row of result.data) {
    if (row.net_collected === null || row.net_collected === undefined || row.net_collected === "") return null;
    const amount = Number(row.net_collected);
    if (!Number.isFinite(amount)) return null;
    const manual = filled(row.failure_reason) && filled(row.stripe_invoice_id) && !filled(row.stripe_payment_intent_id);
    if (manual && row.notified_status === "paid") overlap += amount;
  }
  return overlap;
}
