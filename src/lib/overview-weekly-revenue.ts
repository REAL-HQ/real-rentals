/**
 * Overview "Billed vs Collected" series.
 *
 * Same money rules as the Revenue card's payments ledger: rent / late_fee /
 * other only (deposits out). Collected is multi-method — Stripe, Zelle, Cash
 * App, Venmo, cash, wire — whatever net_collected recorded. Billed is the
 * amount due in the week, same type filter, so the chart cannot disagree with
 * the card about what counts as revenue.
 */
export const OVERVIEW_REVENUE_TYPES = ["rent", "late_fee", "other"] as const;
export type OverviewRevenueType = (typeof OVERVIEW_REVENUE_TYPES)[number];

export type WeekPoint = { label: string; iso: string; collected: number; billed: number };

export type CollectedRow = {
  paid_date?: string | null;
  net_collected?: number | null;
  type?: string | null;
};

export type BilledRow = {
  due_date?: string | null;
  amount?: number | null;
  type?: string | null;
};

export function isOverviewRevenueType(type: string | null | undefined): boolean {
  return type != null && (OVERVIEW_REVENUE_TYPES as readonly string[]).includes(type);
}

function bucketStart(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  c.setDate(c.getDate() - c.getDay());
  return c;
}

export function buildWeeklyBilledCollected(input: {
  now: Date;
  collected: CollectedRow[];
  billed: BilledRow[];
  label: (d: Date) => string;
  weeks?: number;
}): WeekPoint[] {
  const weeks = input.weeks ?? 12;
  const start = bucketStart(new Date(input.now.getTime() - (weeks - 1) * 7 * 864e5));
  const series: WeekPoint[] = [];
  for (let i = 0; i < weeks; i++) {
    const d = new Date(start.getTime() + i * 7 * 864e5);
    series.push({ label: input.label(d), iso: d.toISOString(), collected: 0, billed: 0 });
  }
  for (const p of input.collected) {
    if (!p.paid_date || !isOverviewRevenueType(p.type ?? "rent")) continue;
    // Rows without an explicit type historically counted as rent on this chart.
    const w = bucketStart(new Date(p.paid_date));
    const idx = Math.round((w.getTime() - start.getTime()) / (7 * 864e5));
    if (idx >= 0 && idx < weeks) series[idx].collected += Number(p.net_collected ?? 0);
  }
  for (const p of input.billed) {
    if (!p.due_date || !isOverviewRevenueType(p.type)) continue;
    const w = bucketStart(new Date(p.due_date));
    const idx = Math.round((w.getTime() - start.getTime()) / (7 * 864e5));
    if (idx >= 0 && idx < weeks) series[idx].billed += Number(p.amount ?? 0);
  }
  return series;
}
