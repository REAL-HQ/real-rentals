import { tierAllows, type StaffTier } from "@/lib/roles";
import {
  buildVehicleExpenseLine,
  type ExpenseMovement,
  type ExpenseVehicle,
  type ServiceMovement,
  type VehicleExpenseReport,
} from "./vehicle-expenses";

/**
 * Read-only directory for the expense line. The caller has already required
 * a manager, because supabaseAdmin bypasses RLS. Two identical scans, or the
 * line is withheld. This file never writes.
 */

export const EXPENSE_RECORDS_INCOMPLETE = "Expense records were incomplete";
const DIRECTORY_PAGE = 1000;
const DIRECTORY_MAX_PAGES = 100;

type Page<T> = { data: T[] | null; error: { message: string } | null };
type Scan<T extends { id: string }> = (cursor: string | null) => PromiseLike<Page<T>>;
type Query = PromiseLike<Page<{ id: string }>> & { gt: (column: string, value: string) => PromiseLike<Page<{ id: string }>> };
type AdminDb = {
  from: (table: string) => {
    select: (columns: string) => {
      order: (column: string, options: { ascending: boolean }) => { limit: (count: number) => Query };
    };
  };
};

type ExpenseRow = {
  id: string;
  vehicle_id: string | null;
  category: string | null;
  amount: string | number | null;
  incurred_on: string | null;
  maintenance_record_id: string | null;
  vendor_id: string | null;
  receipt_path: string | null;
};
type ServiceRow = {
  id: string;
  vehicle_id: string | null;
  category: string | null;
  company_share: string | number | null;
  total_cost: string | number | null;
  performed_on: string | null;
  completed_at: string | null;
  created_at: string | null;
  vendor_id: string | null;
  vendor_name_raw: string | null;
};
type VehicleRow = { id: string; year: number | null; make: string | null; model: string | null; license_plate: string | null; unit_number: string | null };
type VendorRow = { id: string; name: string | null };

export type VehicleExpenseRecords = { expenses: ExpenseMovement[]; services: ServiceMovement[]; vehicles: ExpenseVehicle[] };

export type VehicleExpensesResponse =
  | { status: "disabled"; report: null }
  | { status: "unavailable"; report: null; reason: string }
  | { status: "ready"; report: VehicleExpenseReport };

export function vehicleExpenseScans(db: AdminDb | unknown) {
  const admin = db as AdminDb;
  const page = <T extends { id: string }>(table: string, columns: string): Scan<T> => async (cursor) => {
    const query = admin.from(table).select(columns).order("id", { ascending: true }).limit(DIRECTORY_PAGE);
    if (cursor) return query.gt("id", cursor) as unknown as PromiseLike<Page<T>>;
    return query as unknown as PromiseLike<Page<T>>;
  };
  return {
    expenses: page<ExpenseRow>("vehicle_expenses", "id,vehicle_id,category,amount,incurred_on,maintenance_record_id,vendor_id,receipt_path"),
    services: page<ServiceRow>("maintenance_records", "id,vehicle_id,category,company_share,total_cost,performed_on,completed_at,created_at,vendor_id,vendor_name_raw"),
    vehicles: page<VehicleRow>("vehicles", "id,year,make,model,license_plate,unit_number"),
    vendors: page<VendorRow>("vendors", "id,name"),
  };
}

export async function loadVehicleExpenseRecords(source: {
  expenses: Scan<ExpenseRow>;
  services: Scan<ServiceRow>;
  vehicles: Scan<VehicleRow>;
  vendors: Scan<VendorRow>;
}): Promise<{ ok: true; records: VehicleExpenseRecords } | { ok: false }> {
  const [expenses, services, vehicles, vendors] = await Promise.all([
    readPages(source.expenses),
    readPages(source.services),
    readPages(source.vehicles),
    readPages(source.vendors),
  ]);
  if (!expenses || !services || !vehicles || !vendors) return { ok: false };
  const names = new Map(vendors.map((vendor) => [vendor.id, text(vendor.name)]));
  return {
    ok: true,
    records: {
      expenses: expenses.map((row) => ({
        id: row.id,
        vehicleId: text(row.vehicle_id),
        category: text(row.category),
        amount: money(row.amount),
        incurredOn: text(row.incurred_on),
        maintenanceRecordId: text(row.maintenance_record_id),
        vendorName: row.vendor_id ? names.get(row.vendor_id) ?? null : null,
        receiptPath: text(row.receipt_path),
      })),
      services: services.map((row) => ({
        id: row.id,
        vehicleId: text(row.vehicle_id),
        category: text(row.category),
        companyShare: money(row.company_share),
        totalCost: money(row.total_cost),
        performedOn: text(row.performed_on),
        completedAt: text(row.completed_at),
        createdAt: text(row.created_at),
        vendorName: (row.vendor_id ? names.get(row.vendor_id) : null) ?? text(row.vendor_name_raw),
      })),
      vehicles: vehicles.map((row) => ({
        id: row.id,
        year: typeof row.year === "number" ? row.year : null,
        make: text(row.make),
        model: text(row.model),
        licensePlate: text(row.license_plate),
        unitNumber: text(row.unit_number),
      })),
    },
  };
}

export async function runVehicleExpenses(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  load: () => Promise<{ ok: true; records: VehicleExpenseRecords } | { ok: false }>;
}): Promise<VehicleExpensesResponse> {
  if (!input.enabled) return { status: "disabled", report: null };
  if (!input.userId || !tierAllows(input.tier, "manager")) throw new Error("Forbidden");
  const loaded = await input.load();
  if (!loaded.ok) return { status: "unavailable", report: null, reason: EXPENSE_RECORDS_INCOMPLETE };
  return { status: "ready", report: buildVehicleExpenseLine(loaded.records) };
}

async function readPages<T extends { id: string }>(load: Scan<T>): Promise<T[] | null> {
  async function scan(): Promise<T[] | null> {
    const rows: T[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < DIRECTORY_MAX_PAGES; page++) {
      const response = await load(cursor);
      if (response.error || !Array.isArray(response.data) || response.data.length > DIRECTORY_PAGE) return null;
      for (const row of response.data) {
        if (!row || typeof row.id !== "string" || !row.id || (cursor !== null && row.id <= cursor)) return null;
        cursor = row.id;
        rows.push(row);
      }
      if (response.data.length < DIRECTORY_PAGE) return rows;
    }
    return null;
  }
  const first = await scan();
  const second = await scan();
  if (!first || !second || JSON.stringify(first) !== JSON.stringify(second)) return null;
  return first;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function money(value: unknown): string | number | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}
