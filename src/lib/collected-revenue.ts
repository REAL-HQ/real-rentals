/** Existing net_collected means collected minus refunds, not processor fees. */
export function readCollectedRevenue(result: {
  data: { net_collected: unknown }[] | null;
  error: unknown;
}): number | null {
  if (result.error || !Array.isArray(result.data)) return null;
  let cents = 0;
  for (const row of result.data) {
    if (row.net_collected == null || row.net_collected === "") return null;
    const amount = Number(row.net_collected);
    if (!Number.isFinite(amount) || amount < 0) return null;
    cents += Math.round(amount * 100);
  }
  return cents / 100;
}