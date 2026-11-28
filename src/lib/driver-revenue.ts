/**
 * Driver Revenue: how much money a driver has paid us to date.
 *
 * Source: public.payments, one row per charge. Revenue is the sum of
 * payments.net_collected for the driver's rows, across every rental. The
 * column is generated in the database:
 *
 *   net_collected = status IN ('paid','refunded')
 *                     ? max(amount - refunded_amount, 0)
 *                     : 0
 *
 * So a paid row counts its full amount, a partly refunded row counts what is
 * left, a fully refunded row counts 0, and failed, void, waived, unpaid,
 * late, overdue, pending and upcoming rows count 0. This is the same number
 * the Overview Revenue card sums (recordedRevenueTotal), so the two never
 * disagree.
 *
 * Paid out of band: staff "Mark as Paid" (and a Stripe invoice marked paid
 * outside Stripe) leaves the payments row status = 'paid', so those rows count.
 * A row is never counted twice, and nothing is read from Stripe.
 *
 * Payment type is not filtered: rent, reservation fee, deposit and late fee
 * rows all count once paid, net of refunds, exactly as the Overview card does.
 *
 * A payment belongs to payments.driver_id (an application id). A row with no
 * driver_id falls back to its rental's application_id. A driver with several
 * submissions (primary_application_id) sums every submission id.
 *
 * Client-safe: no imports.
 */

export type RevenueRow = {
  driver_id?: string | null;
  rental_id?: string | null;
  net_collected?: unknown;
};

function dollars(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** Sum net_collected per application id. `rentalApp` maps rental id to application id for rows with no driver_id. */
export function sumDriverRevenue(
  rows: readonly RevenueRow[],
  rentalApp: ReadonlyMap<string, string> = new Map(),
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const amount = dollars(row.net_collected);
    if (amount <= 0) continue;
    const id = row.driver_id || (row.rental_id ? rentalApp.get(row.rental_id) : undefined);
    if (!id) continue;
    out[id] = cents((out[id] ?? 0) + amount);
  }
  return out;
}

/** One driver's total across all of their application ids. */
export function revenueForIds(totals: Readonly<Record<string, number>> | null | undefined, ids: readonly (string | null | undefined)[]): number | null {
  if (!totals) return null;
  let sum = 0;
  for (const id of new Set(ids)) if (id) sum += totals[id] ?? 0;
  return cents(sum);
}

/** `$1,234`. Whole dollars, no cents. Null (not loaded or not allowed) shows a dash. */
export function formatRevenue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export const DRIVER_SORTS = ["newest", "revenue"] as const;
export type DriverSort = (typeof DRIVER_SORTS)[number];
export const DRIVER_SORT_LABEL: Record<DriverSort, string> = { newest: "Newest", revenue: "Top Revenue" };

/** Highest revenue first; ties and blanks fall back to newest first so the order is stable. */
export function compareByRevenueDesc(
  a: { revenue: number | null; createdAt: string | null },
  b: { revenue: number | null; createdAt: string | null },
): number {
  const diff = (b.revenue ?? 0) - (a.revenue ?? 0);
  if (diff !== 0) return diff;
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}
