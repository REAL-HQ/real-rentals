/**
 * Owners and managers (collections viewers). Read-only projected vs collected
 * rent for the current ET week and month.
 */
import { etToday, type ForecastRental } from "./revenue-forecast";
import {
  buildProjectedRevenueSummary,
  type CollectedRentRow,
  type ProjectedRevenueSummary,
} from "./projected-revenue";
import { tierAllows, type StaffTier } from "./roles";

export type ProjectedRevenueResponse =
  | { status: "forbidden"; summary: null }
  | { status: "unavailable"; reason: string; summary: null }
  | { status: "ready"; summary: ProjectedRevenueSummary };

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  eq: (column: string, value: string) => Query;
  in: (column: string, values: string[]) => Query;
  gte: (column: string, value: string) => Query;
  lte: (column: string, value: string) => Query;
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
};
export type ProjectedRevenueClient = {
  from: (table: string) => { select: (columns: string) => Query };
};

const RENTAL_COLUMNS = "id,vehicle_id,status,weekly_rate,next_payment_due,end_date";
const PAYMENT_COLUMNS = "id,type,status,net_collected,paid_date";

export async function runProjectedRevenueSummary(input: {
  userId: string | null;
  tier: StaffTier | null;
  today?: string;
  load: () => Promise<
    | { ok: true; rentals: ForecastRental[]; collected: CollectedRentRow[] }
    | { ok: false; reason: string }
  >;
}): Promise<ProjectedRevenueResponse> {
  if (!input.userId || !tierAllows(input.tier, "manager")) {
    return { status: "forbidden", summary: null };
  }
  const loaded = await input.load();
  if (!loaded.ok) return { status: "unavailable", reason: loaded.reason, summary: null };
  const summary = buildProjectedRevenueSummary({
    today: input.today ?? etToday(),
    rentals: loaded.rentals,
    collected: loaded.collected,
  });
  if (!summary) return { status: "unavailable", reason: "Could not build the week or month window", summary: null };
  return { status: "ready", summary };
}

export async function loadProjectedRevenue(
  supabase: ProjectedRevenueClient,
  today: string,
): Promise<{ ok: true; rentals: ForecastRental[]; collected: CollectedRentRow[] } | { ok: false; reason: string }> {
  const { weekRange, monthRange } = await import("./projected-revenue");
  const week = weekRange(today);
  const month = monthRange(today);
  if (!week || !month) return { ok: false, reason: "Invalid today date" };

  const rentals: ForecastRental[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    let query = supabase
      .from("rentals")
      .select(RENTAL_COLUMNS)
      .eq("status", "active")
      .order("id", { ascending: true })
      .limit(500);
    if (cursor) query = query.gt("id", cursor);
    const response = await query;
    if (response.error || !response.data) return { ok: false, reason: "Could not read active rentals" };
    for (const row of response.data) {
      if (typeof row.id !== "string") return { ok: false, reason: "Rental row missing id" };
      cursor = row.id;
      const mapped = mapRental(row);
      if (!mapped) return { ok: false, reason: "Rental row incomplete" };
      rentals.push(mapped);
    }
    if (response.data.length < 500) break;
    if (page === 49) return { ok: false, reason: "Active rental page cap reached" };
  }

  // Month window covers the week; one paid-rent read is enough.
  let payQuery = supabase
    .from("payments")
    .select(PAYMENT_COLUMNS)
    .eq("type", "rent")
    .in("status", ["paid", "refunded"])
    .gte("paid_date", month.from)
    .lte("paid_date", month.through)
    .order("id", { ascending: true })
    .limit(2000);
  const payments = await payQuery;
  if (payments.error || !payments.data) return { ok: false, reason: "Could not read collected rent" };
  if (payments.data.length >= 2000) return { ok: false, reason: "Collected rent page cap reached" };

  const collected: CollectedRentRow[] = [];
  for (const row of payments.data) {
    collected.push({
      paidDate: text(row.paid_date),
      netCollected: money(row.net_collected),
      type: text(row.type),
    });
  }
  return { ok: true, rentals, collected };
}

function mapRental(row: Record<string, unknown>): ForecastRental | null {
  if (typeof row.id !== "string" || typeof row.vehicle_id !== "string" || typeof row.status !== "string") return null;
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    status: row.status,
    weeklyRate: money(row.weekly_rate),
    nextPaymentDue: text(row.next_payment_due),
    endDate: text(row.end_date),
  };
}

function money(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
