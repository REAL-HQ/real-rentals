import { tierAllows, type StaffTier } from "./roles";
import {
  FORECAST_PAGE_CAP,
  buildRevenueForecast,
  type ForecastRental,
  type ForecastVehicle,
  type RevenueForecastReport,
} from "./revenue-forecast";

/**
 * Owners only. The flag is checked by the server function before this runs,
 * and again here so a direct call still returns disabled before any read.
 * Database reads only. No writes.
 */

export type RevenueForecastResponse =
  | { status: "disabled"; report: null }
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: RevenueForecastReport };

export type ForecastLoad =
  | { ok: true; rentals: ForecastRental[]; vehicles: ForecastVehicle[] }
  | { ok: false; capped: boolean };

export async function runRevenueForecast(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  today: string;
  load: () => Promise<ForecastLoad>;
}): Promise<RevenueForecastResponse> {
  if (!input.enabled) return { status: "disabled", report: null };
  if (!input.userId || !tierAllows(input.tier, "owner")) throw new Error("Forbidden");
  const loaded = await input.load();
  if (!loaded.ok) {
    if (loaded.capped) {
      return {
        status: "ready",
        report: {
          projectionLabel: "Projection, Not Collected Money",
          today: input.today,
          weeks: [],
          vehicles: [],
          totalCents: 0,
          excludedMissingDue: 0,
          idleCount: 0,
          idlePotentialCents: 0,
          idleRateNotSet: 0,
          warnings: [FORECAST_PAGE_CAP],
        },
      };
    }
    return { status: "unavailable", reason: "Rental records were incomplete", report: null };
  }
  const report = buildRevenueForecast({ today: input.today, rentals: loaded.rentals, vehicles: loaded.vehicles });
  if (!report) return { status: "unavailable", reason: "The forecast week could not be read", report: null };
  return { status: "ready", report };
}

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  eq: (column: string, value: string) => Query;
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
};
export type ForecastDirectoryClient = {
  from: (table: string) => { select: (columns: string) => Query };
};

const RENTAL_COLUMNS = "id,vehicle_id,status,weekly_rate,next_payment_due,end_date";
const VEHICLE_COLUMNS = "id,unit_number,year,make,model,license_plate,status,weekly_rate,archived_at";

export async function loadRevenueForecast(supabase: ForecastDirectoryClient): Promise<ForecastLoad> {
  const rentals = await readPages(supabase, "rentals", RENTAL_COLUMNS, "active");
  if (!rentals.ok) return rentals;
  const vehicles = await readPages(supabase, "vehicles", VEHICLE_COLUMNS);
  if (!vehicles.ok) return vehicles;
  const mappedRentals: ForecastRental[] = [];
  for (const row of rentals.rows) {
    const rental = mapRental(row);
    if (!rental) return { ok: false, capped: false };
    mappedRentals.push(rental);
  }
  const mappedVehicles: ForecastVehicle[] = [];
  for (const row of vehicles.rows) {
    const vehicle = mapVehicle(row);
    if (!vehicle) return { ok: false, capped: false };
    mappedVehicles.push(vehicle);
  }
  return { ok: true, rentals: mappedRentals, vehicles: mappedVehicles };
}

async function readPages(
  supabase: ForecastDirectoryClient,
  table: string,
  columns: string,
  status?: string,
): Promise<{ ok: true; rows: Array<Record<string, unknown>> } | { ok: false; capped: boolean }> {
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    let query = supabase.from(table).select(columns);
    if (status) query = query.eq("status", status);
    query = query.order("id", { ascending: true }).limit(1000);
    if (cursor) query = query.gt("id", cursor);
    const response = await query;
    if (response.error || !response.data) return { ok: false, capped: false };
    for (const row of response.data) {
      if (typeof row.id !== "string" || (cursor !== null && row.id <= cursor)) return { ok: false, capped: false };
      cursor = row.id;
      rows.push(row);
    }
    if (response.data.length < 1000) return { ok: true, rows };
  }
  return { ok: false, capped: true };
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

function mapVehicle(row: Record<string, unknown>): ForecastVehicle | null {
  if (typeof row.id !== "string" || typeof row.status !== "string") return null;
  return {
    id: row.id,
    label: vehicleLabel(row),
    status: row.status,
    weeklyRate: money(row.weekly_rate),
    archived: typeof row.archived_at === "string" && row.archived_at.trim().length > 0,
  };
}

function vehicleLabel(row: Record<string, unknown>): string {
  const year = typeof row.year === "number" && Number.isSafeInteger(row.year) ? String(row.year) : null;
  const name = [year, text(row.make), text(row.model)].filter(Boolean).join(" ");
  const label = [text(row.unit_number) ? `Unit ${text(row.unit_number)}` : null, name || null, text(row.license_plate)].filter(Boolean).join(" · ");
  return label || "Vehicle";
}

function money(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
