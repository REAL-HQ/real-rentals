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
};

/** Sum of manual receipts Stripe later collected. Each row is still one receipt in revenue. */
export function paymentOverlap(result: { data: OverlapRow[] | null; error: unknown; count: number | null }): number | null {
  if (result.error || !Array.isArray(result.data) || result.count !== result.data.length) return null;
  let overlap = 0;
  for (const row of result.data) {
    if (row.net_collected === null || row.net_collected === undefined || row.net_collected === "") return null;
    const amount = Number(row.net_collected);
    if (!Number.isFinite(amount)) return null;
    const reason = row.failure_reason;
    const manual = typeof reason === "string" && reason.trim() !== "";
    if (manual && row.notified_status === "paid") overlap += amount;
  }
  return overlap;
}
