import { tierAllows, type StaffTier } from "./roles";
import { MONTHLY_PL_OFF } from "./finance-monthly-pl-flag";
import {
  MONTHLY_PL_INCOMPLETE,
  MONTHLY_PL_MONTH,
  buildMonthlyPl,
  currentMonth,
  monthBounds,
  type MonthlyPlReport,
  type PlExpense,
  type PlMaintenance,
  type PlPayment,
  type PlRental,
  type PlVehicle,
} from "./finance-monthly-pl";

/**
 * Managers and owners. The flag is checked by the server function before this
 * runs, and again here so a direct call still throws before any read.
 * No writes and no Stripe.
 */

export type MonthlyPlResponse =
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: MonthlyPlReport };

export type MonthlyPlLoad =
  | { ok: true; vehicles: PlVehicle[]; rentals: PlRental[]; payments: PlPayment[]; expenses: PlExpense[]; maintenance: PlMaintenance[] }
  | { ok: false };

export async function runMonthlyPl(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  month: string | null;
  asOf: Date;
  load: () => Promise<MonthlyPlLoad>;
}): Promise<MonthlyPlResponse> {
  if (!input.enabled) throw new Error(MONTHLY_PL_OFF);
  if (!input.userId || !tierAllows(input.tier, "manager")) throw new Error("Forbidden");
  const month = input.month ?? currentMonth(input.asOf);
  if (!month || !monthBounds(month)) return { status: "unavailable", reason: MONTHLY_PL_MONTH, report: null };
  const loaded = await input.load();
  if (!loaded.ok) return { status: "unavailable", reason: MONTHLY_PL_INCOMPLETE, report: null };
  const built = buildMonthlyPl({ month, ...loaded });
  if (!built.ok) return { status: "unavailable", reason: MONTHLY_PL_INCOMPLETE, report: null };
  return { status: "ready", report: built.report };
}

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
};
export type MonthlyPlClient = {
  from: (table: string) => { select: (columns: string) => Query };
};

const VEHICLE_COLUMNS = "id,year,make,model,license_plate";
const RENTAL_COLUMNS = "id,vehicle_id";
const PAYMENT_COLUMNS = "id,status,type,amount,net_collected,refunded_amount,paid_date,rental_id,vehicle_id";
const EXPENSE_COLUMNS = "id,vehicle_id,amount,category,incurred_on,maintenance_record_id";
const MAINTENANCE_COLUMNS = "id,vehicle_id,category,company_share,total_cost,performed_on,completed_at,created_at";

export async function loadMonthlyPlDirectory(supabase: MonthlyPlClient): Promise<MonthlyPlLoad> {
  const vehicles = await readPages(supabase, "vehicles", VEHICLE_COLUMNS);
  if (!vehicles.ok) return { ok: false };
  const rentals = await readPages(supabase, "rentals", RENTAL_COLUMNS);
  if (!rentals.ok) return { ok: false };
  const payments = await readPages(supabase, "payments", PAYMENT_COLUMNS);
  if (!payments.ok) return { ok: false };
  const expenses = await readPages(supabase, "vehicle_expenses", EXPENSE_COLUMNS);
  if (!expenses.ok) return { ok: false };
  const maintenance = await readPages(supabase, "maintenance_records", MAINTENANCE_COLUMNS);
  if (!maintenance.ok) return { ok: false };

  const vehicleRows: PlVehicle[] = [];
  for (const row of vehicles.rows) {
    const vehicle = mapVehicle(row);
    if (!vehicle) return { ok: false };
    vehicleRows.push(vehicle);
  }
  const rentalRows: PlRental[] = [];
  for (const row of rentals.rows) {
    if (typeof row.id !== "string") return { ok: false };
    rentalRows.push({ id: row.id, vehicleId: text(row.vehicle_id) });
  }
  const paymentRows: PlPayment[] = [];
  for (const row of payments.rows) {
    const payment = mapPayment(row);
    if (!payment) return { ok: false };
    paymentRows.push(payment);
  }
  const expenseRows: PlExpense[] = [];
  for (const row of expenses.rows) {
    const expense = mapExpense(row);
    if (!expense) return { ok: false };
    expenseRows.push(expense);
  }
  const maintenanceRows: PlMaintenance[] = [];
  for (const row of maintenance.rows) {
    const record = mapMaintenance(row);
    if (!record) return { ok: false };
    maintenanceRows.push(record);
  }
  return { ok: true, vehicles: vehicleRows, rentals: rentalRows, payments: paymentRows, expenses: expenseRows, maintenance: maintenanceRows };
}

type PageRead = { ok: true; rows: Array<Record<string, unknown>> } | { ok: false };

async function readPages(supabase: MonthlyPlClient, table: string, columns: string): Promise<PageRead> {
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    let query = supabase.from(table).select(columns).order("id", { ascending: true }).limit(1000);
    if (cursor) query = query.gt("id", cursor);
    const response = await query;
    if (response.error || !response.data) return { ok: false };
    for (const row of response.data) {
      if (typeof row.id !== "string" || (cursor !== null && row.id <= cursor)) return { ok: false };
      cursor = row.id;
      rows.push(row);
    }
    if (response.data.length < 1000) return { ok: true, rows };
  }
  return { ok: false };
}

function mapVehicle(row: Record<string, unknown>): PlVehicle | null {
  if (typeof row.id !== "string") return null;
  if (row.year !== null && row.year !== undefined && typeof row.year !== "number") return null;
  return {
    id: row.id,
    year: typeof row.year === "number" ? row.year : null,
    make: text(row.make),
    model: text(row.model),
    licensePlate: text(row.license_plate),
  };
}

function mapPayment(row: Record<string, unknown>): PlPayment | null {
  if (typeof row.id !== "string" || typeof row.status !== "string") return null;
  if (!readableMoney(row.amount) || !readableMoney(row.net_collected) || !readableMoney(row.refunded_amount)) return null;
  return {
    id: row.id,
    rentalId: text(row.rental_id),
    vehicleId: text(row.vehicle_id),
    status: row.status,
    type: text(row.type) ?? "",
    amount: row.amount ?? null,
    netCollected: row.net_collected ?? null,
    refundedAmount: row.refunded_amount ?? null,
    paidDate: text(row.paid_date),
  };
}

function mapExpense(row: Record<string, unknown>): PlExpense | null {
  if (typeof row.id !== "string" || !readableMoney(row.amount)) return null;
  return {
    id: row.id,
    vehicleId: text(row.vehicle_id),
    amount: row.amount ?? null,
    category: text(row.category),
    incurredOn: text(row.incurred_on),
    maintenanceRecordId: text(row.maintenance_record_id),
  };
}

function mapMaintenance(row: Record<string, unknown>): PlMaintenance | null {
  if (typeof row.id !== "string" || !readableMoney(row.company_share) || !readableMoney(row.total_cost)) return null;
  return {
    id: row.id,
    vehicleId: text(row.vehicle_id),
    category: text(row.category),
    companyShare: row.company_share ?? null,
    totalCost: row.total_cost ?? null,
    performedOn: text(row.performed_on),
    completedAt: text(row.completed_at),
    createdAt: text(row.created_at),
  };
}

function readableMoney(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string" && value.trim() !== "") return Number.isFinite(Number(value));
  return false;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
