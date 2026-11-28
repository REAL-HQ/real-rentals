import { COUNTED_ID_BATCH, readCounted, readInIdBatches } from "./count-paged-read";
import { sumDriverRevenue } from "./driver-revenue";

/**
 * Server-side Driver Revenue totals. See driver-revenue.ts for the definition.
 *
 * Reads only the rows that carry money (net_collected > 0), in count-checked
 * pages, so a short or clamped page is a failure, never a silently low total.
 * Callers gate on manager tier first: payments are manager-only data.
 */
type Db = { from: (table: string) => any };

const PAGE = 1000;

export type DriverRevenueResult = { ok: true; totals: Record<string, number> } | { ok: false };

async function rentalApplications(db: Db, rentalIds: string[]): Promise<Map<string, string> | null> {
  const map = new Map<string, string>();
  if (!rentalIds.length) return map;
  const read = await readInIdBatches(
    rentalIds,
    (chunk, from, to) =>
      db
        .from("rentals")
        .select("id,application_id", { count: "exact" })
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    COUNTED_ID_BATCH,
  );
  if (!read.ok) return null;
  for (const row of read.rows) {
    const id = row.id as string;
    const app = row.application_id as string | null;
    if (id && app) map.set(id, app);
  }
  return map;
}

/** Totals in dollars per application id. Pass `applicationIds` for a page of rows, or omit for every driver. */
export async function loadDriverRevenue(db: Db, applicationIds?: readonly string[]): Promise<DriverRevenueResult> {
  const columns = "id,driver_id,rental_id,net_collected";
  const base = () => db.from("payments").select(columns, { count: "exact" }).gt("net_collected", 0);
  let rows: Record<string, unknown>[];
  if (applicationIds) {
    const ids = [...new Set(applicationIds.filter(Boolean))];
    if (!ids.length) return { ok: true, totals: {} };
    const read = await readInIdBatches(
      ids,
      (chunk, from, to) => base().in("driver_id", chunk).order("id", { ascending: true }).range(from, to),
      COUNTED_ID_BATCH,
    );
    if (!read.ok) return { ok: false };
    rows = read.rows;
  } else {
    const read = await readCounted((from, to) => base().order("id", { ascending: true }).range(from, to), undefined, PAGE);
    if (!read.ok || read.truncated) return { ok: false };
    rows = read.rows;
  }
  const orphan = [...new Set(rows.filter((r) => !r.driver_id && r.rental_id).map((r) => String(r.rental_id)))];
  const rentalApp = await rentalApplications(db, orphan);
  if (!rentalApp) return { ok: false };
  return { ok: true, totals: sumDriverRevenue(rows, rentalApp) };
}
