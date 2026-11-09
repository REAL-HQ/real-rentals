import { tierAllows, type StaffTier } from "./roles";
import { VEHICLE_PROFITABILITY_OFF } from "./vehicle-profitability-flag";
import {
  DIRECTORY_INCOMPLETE,
  buildVehicleProfit,
  defaultProfitRange,
  profitRange,
  type ProfitExpense,
  type ProfitMaintenance,
  type ProfitPayment,
  type ProfitRange,
  type ProfitRental,
  type ProfitVehicle,
  type VehicleProfitReport,
} from "./vehicle-profitability";

/**
 * Owners and managers. The flag is checked here again so a direct call still
 * throws before any read. Payments are attributed through the rental.
 * There is no Stripe call.
 */

export type VehicleProfitResponse =
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: VehicleProfitReport };

export type VehicleProfitDirectory = {
  vehicles: ProfitVehicle[];
  rentals: ProfitRental[];
  payments: ProfitPayment[];
  expenses: ProfitExpense[];
  maintenance: ProfitMaintenance[];
};
export type VehicleProfitLoad = { ok: true; directory: VehicleProfitDirectory } | { ok: false; capped: boolean };

export async function runVehicleProfit(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  now: Date;
  range: { from: string; through: string } | null;
  load: () => Promise<VehicleProfitLoad>;
}): Promise<VehicleProfitResponse> {
  if (!input.enabled) throw new Error(VEHICLE_PROFITABILITY_OFF);
  if (!input.userId || !tierAllows(input.tier, "manager")) throw new Error("Forbidden");
  const range = input.range ? profitRange(input.range.from, input.range.through) : defaultProfitRange(input.now);
  if (!range) throw new Error("The date range is not valid");
  const loaded = await input.load();
  if (!loaded.ok) return { status: "unavailable", reason: DIRECTORY_INCOMPLETE, report: null };
  return { status: "ready", report: buildVehicleProfit({ range, ...loaded.directory }) };
}

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
};
export type VehicleProfitClient = {
  from: (table: string) => { select: (columns: string) => Query };
};

const VEHICLE_COLUMNS = "id,year,make,model,license_plate,created_at,archived_at";
const RENTAL_COLUMNS = "id,vehicle_id,start_date,end_date,status";
const PAYMENT_COLUMNS = "id,rental_id,vehicle_id,status,type,amount,net_collected,refunded_amount,paid_date";
const EXPENSE_COLUMNS = "id,vehicle_id,amount,incurred_on,maintenance_record_id";
const MAINTENANCE_COLUMNS = "id,vehicle_id,company_share,total_cost,performed_on,completed_at,created_at";

export async function loadVehicleProfitDirectory(supabase: VehicleProfitClient): Promise<VehicleProfitLoad> {
  const vehicles = await readPages(supabase, "vehicles", VEHICLE_COLUMNS);
  if (!vehicles.ok) return vehicles;
  const rentals = await readPages(supabase, "rentals", RENTAL_COLUMNS);
  if (!rentals.ok) return rentals;
  const payments = await readPages(supabase, "payments", PAYMENT_COLUMNS);
  if (!payments.ok) return payments;
  const expenses = await readPages(supabase, "vehicle_expenses", EXPENSE_COLUMNS);
  if (!expenses.ok) return expenses;
  const maintenance = await readPages(supabase, "maintenance_records", MAINTENANCE_COLUMNS);
  if (!maintenance.ok) return maintenance;
  const directory: VehicleProfitDirectory = { vehicles: [], rentals: [], payments: [], expenses: [], maintenance: [] };
  for (const row of vehicles.rows) {
    if (typeof row.id !== "string" || typeof row.make !== "string" || typeof row.model !== "string") return { ok: false, capped: false };
    directory.vehicles.push({
      id: row.id,
      year: typeof row.year === "number" ? row.year : null,
      make: row.make,
      model: row.model,
      licensePlate: text(row.license_plate),
      createdAt: text(row.created_at),
      archivedAt: text(row.archived_at),
    });
  }
  for (const row of rentals.rows) {
    if (typeof row.id !== "string" || typeof row.status !== "string" || typeof row.start_date !== "string") return { ok: false, capped: false };
    directory.rentals.push({
      id: row.id,
      vehicleId: text(row.vehicle_id),
      startDate: row.start_date,
      endDate: text(row.end_date),
      status: row.status,
    });
  }
  for (const row of payments.rows) {
    if (typeof row.id !== "string" || typeof row.status !== "string" || typeof row.type !== "string") return { ok: false, capped: false };
    directory.payments.push({
      id: row.id,
      rentalId: text(row.rental_id),
      vehicleId: text(row.vehicle_id),
      status: row.status,
      type: row.type,
      amount: row.amount,
      netCollected: row.net_collected,
      refundedAmount: row.refunded_amount,
      paidDate: text(row.paid_date),
    });
  }
  for (const row of expenses.rows) {
    if (typeof row.id !== "string") return { ok: false, capped: false };
    directory.expenses.push({
      id: row.id,
      vehicleId: text(row.vehicle_id),
      amount: row.amount,
      incurredOn: text(row.incurred_on),
      maintenanceRecordId: text(row.maintenance_record_id),
    });
  }
  for (const row of maintenance.rows) {
    if (typeof row.id !== "string") return { ok: false, capped: false };
    directory.maintenance.push({
      id: row.id,
      vehicleId: text(row.vehicle_id),
      companyShare: row.company_share,
      totalCost: row.total_cost,
      performedOn: text(row.performed_on),
      completedAt: text(row.completed_at),
      createdAt: text(row.created_at),
    });
  }
  return { ok: true, directory };
}

async function readPages(supabase: VehicleProfitClient, table: string, columns: string): Promise<{ ok: true; rows: Array<Record<string, unknown>> } | { ok: false; capped: boolean }> {
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    let query = supabase.from(table).select(columns).order("id", { ascending: true }).limit(1000);
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

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type { ProfitRange };
