import { tierAllows, type StaffTier } from "./roles";
import { TAX_EXPORT_OFF } from "./tax-export-flag";
import {
  DIRECTORY_INCOMPLETE,
  buildTaxExport,
  currentTaxYear,
  taxYear,
  type TaxDriver,
  type TaxExpense,
  type TaxExportReport,
  type TaxMaintenance,
  type TaxPayment,
  type TaxRefund,
  type TaxRental,
  type TaxVehicle,
} from "./tax-export";

/**
 * Owners only. The flag is checked here again so a direct call still throws
 * before any read. There is no Stripe call.
 */

export type TaxExportResponse =
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: TaxExportReport };

export type TaxExportDirectory = {
  payments: TaxPayment[];
  refunds: TaxRefund[];
  expenses: TaxExpense[];
  maintenance: TaxMaintenance[];
  vehicles: TaxVehicle[];
  drivers: TaxDriver[];
  rentals: TaxRental[];
};
export type TaxExportLoad = { ok: true; directory: TaxExportDirectory } | { ok: false; capped: boolean };

export async function runTaxExport(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  now: Date;
  year: number | null;
  load: () => Promise<TaxExportLoad>;
}): Promise<TaxExportResponse> {
  if (!input.enabled) throw new Error(TAX_EXPORT_OFF);
  if (!input.userId || !tierAllows(input.tier, "owner")) throw new Error("Forbidden");
  const year = taxYear(input.year ?? currentTaxYear(input.now) ?? Number.NaN);
  if (!year) throw new Error("The tax year is not valid");
  const loaded = await input.load();
  if (!loaded.ok) return { status: "unavailable", reason: DIRECTORY_INCOMPLETE, report: null };
  return { status: "ready", report: buildTaxExport({ year, ...loaded.directory }) };
}

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
};
export type TaxExportClient = { from: (table: string) => { select: (columns: string) => Query } };

const PAYMENT_COLUMNS = "id,driver_id,rental_id,status,type,amount,net_collected,refunded_amount,paid_date,refunded_at";
const REFUND_COLUMNS = "id,amount,status,created_at,payment_ids";
const EXPENSE_COLUMNS = "id,vehicle_id,category,amount,incurred_on";
const MAINTENANCE_COLUMNS = "id,vehicle_id,company_share,performed_on,completed_at,created_at";
const VEHICLE_COLUMNS = "id,year,make,model,license_plate";
const DRIVER_COLUMNS = "id,full_name,deleted_at";
const RENTAL_COLUMNS = "id,deposit_held";

export async function loadTaxExportDirectory(supabase: TaxExportClient): Promise<TaxExportLoad> {
  const payments = await readPages(supabase, "payments", PAYMENT_COLUMNS);
  if (!payments.ok) return payments;
  const refunds = await readPages(supabase, "payment_refunds", REFUND_COLUMNS);
  if (!refunds.ok) return refunds;
  const expenses = await readPages(supabase, "vehicle_expenses", EXPENSE_COLUMNS);
  if (!expenses.ok) return expenses;
  const maintenance = await readPages(supabase, "maintenance_records", MAINTENANCE_COLUMNS);
  if (!maintenance.ok) return maintenance;
  const vehicles = await readPages(supabase, "vehicles", VEHICLE_COLUMNS);
  if (!vehicles.ok) return vehicles;
  const drivers = await readPages(supabase, "applications", DRIVER_COLUMNS);
  if (!drivers.ok) return drivers;
  const rentals = await readPages(supabase, "rentals", RENTAL_COLUMNS);
  if (!rentals.ok) return rentals;
  const directory: TaxExportDirectory = { payments: [], refunds: [], expenses: [], maintenance: [], vehicles: [], drivers: [], rentals: [] };
  for (const row of payments.rows) {
    if (typeof row.id !== "string" || typeof row.status !== "string" || typeof row.type !== "string") return { ok: false, capped: false };
    directory.payments.push({
      id: row.id,
      driverId: text(row.driver_id),
      rentalId: text(row.rental_id),
      status: row.status,
      type: row.type,
      amount: row.amount,
      netCollected: row.net_collected,
      refundedAmount: row.refunded_amount,
      paidDate: text(row.paid_date),
      refundedAt: text(row.refunded_at),
    });
  }
  for (const row of refunds.rows) {
    const paymentIds = row.payment_ids == null ? [] : row.payment_ids;
    if (typeof row.id !== "string" || !Array.isArray(paymentIds) || paymentIds.some((id) => typeof id !== "string")) return { ok: false, capped: false };
    directory.refunds.push({
      id: row.id,
      amount: row.amount,
      status: text(row.status),
      createdAt: text(row.created_at),
      paymentIds: paymentIds as string[],
    });
  }
  for (const row of expenses.rows) {
    if (typeof row.id !== "string") return { ok: false, capped: false };
    directory.expenses.push({ id: row.id, vehicleId: text(row.vehicle_id), category: text(row.category), amount: row.amount, incurredOn: text(row.incurred_on) });
  }
  for (const row of maintenance.rows) {
    if (typeof row.id !== "string") return { ok: false, capped: false };
    directory.maintenance.push({
      id: row.id,
      vehicleId: text(row.vehicle_id),
      companyShare: row.company_share,
      performedOn: text(row.performed_on),
      completedAt: text(row.completed_at),
      createdAt: text(row.created_at),
    });
  }
  for (const row of vehicles.rows) {
    if (typeof row.id !== "string") return { ok: false, capped: false };
    directory.vehicles.push({
      id: row.id,
      year: typeof row.year === "number" ? row.year : null,
      make: text(row.make),
      model: text(row.model),
      licensePlate: text(row.license_plate),
    });
  }
  for (const row of drivers.rows) {
    if (typeof row.id !== "string") return { ok: false, capped: false };
    directory.drivers.push({ id: row.id, name: text(row.full_name) ?? "Driver", deleted: row.deleted_at != null && row.deleted_at !== "" });
  }
  for (const row of rentals.rows) {
    if (typeof row.id !== "string") return { ok: false, capped: false };
    directory.rentals.push({ id: row.id, depositHeld: row.deposit_held === true });
  }
  return { ok: true, directory };
}

async function readPages(supabase: TaxExportClient, table: string, columns: string): Promise<{ ok: true; rows: Array<Record<string, unknown>> } | { ok: false; capped: boolean }> {
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
